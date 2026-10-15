require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command
} = require('@aws-sdk/client-s3');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_IP = process.env.PUBLIC_IP || 'localhost';
const COMPRESSED_PREFIX = (process.env.S3_COMPRESSED_PREFIX || 'compress/').replace(/^\/+/, '');

// Fallback JSON in case MySQL is unreachable
const FALLBACK_DB_PATH = path.join(__dirname, 'metadata-fallback.json');

// -------------------------------------------------------------
// CORS Configuration for EC2 & Localhost
// -------------------------------------------------------------
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

if (PUBLIC_IP && PUBLIC_IP !== 'localhost') {
  allowedOrigins.push(`http://${PUBLIC_IP}:${PORT}`);
  allowedOrigins.push(`http://${PUBLIC_IP}`);
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.indexOf(origin) !== -1 ||
        origin.includes(PUBLIC_IP) ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1')
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true
  })
);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer in-memory storage for S3 uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// -------------------------------------------------------------
// AWS S3 Client Setup
// -------------------------------------------------------------
function getS3Client() {
  const region = process.env.AWS_REGION || 'ap-south-1';
  const clientConfig = { region };

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();

  if (accessKeyId && secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId,
      secretAccessKey
    };
  }
  return new S3Client(clientConfig);
}

// -------------------------------------------------------------
// MySQL Database Pool & Schema Setup
// Supports AWS RDS and local MySQL gracefully
// -------------------------------------------------------------
let dbPool = null;
let dbConnected = false;
let dbActiveHost = null;

async function initMySQL() {
  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT, 10) || 3306;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const dbName = process.env.DB_NAME || 'photogalleryDB';

  console.log(`[MySQL] Connecting to server at ${host}:${port} as ${user}...`);

  try {
    // Step 1: Connect to server without database to create the database if missing
    const bootstrapConn = await mysql.createConnection({
      host,
      port,
      user,
      password,
      connectTimeout: 8000
    });

    console.log(`[MySQL] Server connection OK. Ensuring database "${dbName}" exists...`);
    await bootstrapConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await bootstrapConn.end();
    console.log(`[MySQL] Database "${dbName}" is verified.`);

    // Step 2: Create connection pool for the verified database
    dbPool = mysql.createPool({
      host,
      port,
      user,
      password,
      database: dbName,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 8000
    });

    const conn = await dbPool.getConnection();
    conn.release();

    dbConnected = true;
    dbActiveHost = host;
    console.log(`[MySQL] Connected successfully to MySQL database: ${dbActiveHost}:${port}/${dbName}`);

    // Step 3: Ensure table "photos" exists for storing photo metadata ONLY
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS photos (
        id VARCHAR(64) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        filename VARCHAR(255) NOT NULL,
        original_key VARCHAR(255) NOT NULL,
        compressed_key VARCHAR(255) NOT NULL,
        bucket_name VARCHAR(255) DEFAULT '',
        url TEXT,
        size BIGINT DEFAULT 0,
        compressed_size BIGINT DEFAULT 0,
        mime_type VARCHAR(100) DEFAULT 'image/jpeg',
        format VARCHAR(20) DEFAULT 'JPEG',
        camera VARCHAR(100) DEFAULT 'Fine Art Camera',
        lens VARCHAR(100) DEFAULT '35mm Lens',
        focal_length VARCHAR(50) DEFAULT '35mm',
        aperture VARCHAR(50) DEFAULT 'ƒ/2.0',
        shutter_speed VARCHAR(50) DEFAULT '1/250s',
        iso VARCHAR(50) DEFAULT '100',
        location VARCHAR(100) DEFAULT 'S3 Bucket',
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        favorite BOOLEAN DEFAULT FALSE,
        tags TEXT,
        color_palette TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log(`[MySQL] Table "photos" verified and ready in active database.`);
    return true;
  } catch (err) {
    console.error(`[MySQL] Connection/Initialization failed:`, err.message);
    dbConnected = false;
    dbPool = null;
    return false;
  }
}

// Fallback JSON helpers
function readFallback() {
  try {
    if (fs.existsSync(FALLBACK_DB_PATH)) {
      return JSON.parse(fs.readFileSync(FALLBACK_DB_PATH, 'utf-8')) || [];
    }
  } catch (e) {}
  return [];
}

function writeFallback(data) {
  try {
    fs.writeFileSync(FALLBACK_DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {}
}

// -------------------------------------------------------------
// Database Operations (MySQL with fallback)
// -------------------------------------------------------------

async function savePhotoToDB(photo) {
  const currentBucket = process.env.AWS_BUCKET_NAME || '';
  photo.bucketName = currentBucket;

  if (dbPool) {
    try {
      const tagsJson = JSON.stringify(photo.tags || []);
      const paletteJson = JSON.stringify(photo.colorPalette || []);
      const uploadedAt = photo.uploadedAt
        ? new Date(photo.uploadedAt).toISOString().slice(0, 19).replace('T', ' ')
        : new Date().toISOString().slice(0, 19).replace('T', ' ');

      await dbPool.query(
        `INSERT INTO photos (
          id, title, filename, original_key, compressed_key, bucket_name, url,
          size, compressed_size, mime_type, format, camera, lens,
          focal_length, aperture, shutter_speed, iso, location,
          uploaded_at, favorite, tags, color_palette
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          filename = VALUES(filename),
          original_key = VALUES(original_key),
          compressed_key = VALUES(compressed_key),
          bucket_name = VALUES(bucket_name),
          url = VALUES(url),
          size = VALUES(size),
          compressed_size = VALUES(compressed_size),
          mime_type = VALUES(mime_type),
          format = VALUES(format),
          camera = VALUES(camera),
          lens = VALUES(lens),
          focal_length = VALUES(focal_length),
          aperture = VALUES(aperture),
          shutter_speed = VALUES(shutter_speed),
          iso = VALUES(iso),
          location = VALUES(location),
          favorite = VALUES(favorite),
          tags = VALUES(tags),
          color_palette = VALUES(color_palette)`,
        [
          photo.id,
          photo.title,
          photo.filename,
          photo.originalKey || photo.filename,
          photo.compressedKey || `${COMPRESSED_PREFIX}${photo.filename}`,
          currentBucket,
          photo.url || null,
          photo.size || 0,
          photo.compressedSize || 0,
          photo.mimeType || 'image/jpeg',
          photo.format || 'JPEG',
          photo.camera || 'S3 Camera',
          photo.lens || 'Prime Lens',
          photo.focalLength || '35mm',
          photo.aperture || 'ƒ/2.0',
          photo.shutterSpeed || '1/250s',
          photo.iso || '100',
          photo.location || 'S3 Archive',
          uploadedAt,
          photo.favorite ? 1 : 0,
          tagsJson,
          paletteJson
        ]
      );
      return true;
    } catch (err) {
      console.error('Error saving to MySQL:', err.message);
    }
  }

  // Fallback
  const list = readFallback();
  const idx = list.findIndex((p) => p.id === photo.id);
  if (idx >= 0) list[idx] = photo;
  else list.unshift(photo);
  writeFallback(list);
  return true;
}

async function getPhotosFromDB() {
  const currentBucket = process.env.AWS_BUCKET_NAME || '';

  if (dbPool) {
    try {
      const [rows] = await dbPool.query(
        `SELECT * FROM photos 
         WHERE (bucket_name = ? OR bucket_name = '') 
           AND (compressed_key LIKE 'compressed%' OR compressed_key LIKE 'compress%') 
         ORDER BY uploaded_at DESC`,
        [currentBucket]
      );
      return rows.map(formatPhotoRow);
    } catch (err) {
      console.error('Error querying MySQL:', err.message);
    }
  }

  const list = readFallback();
  return list.filter(
    (p) =>
      (!p.bucketName || p.bucketName === currentBucket) &&
      p.compressedKey &&
      (p.compressedKey.startsWith('compressed') || p.compressedKey.startsWith('compress'))
  );
}

async function getPhotoByIdFromDB(id) {
  if (dbPool) {
    try {
      const [rows] = await dbPool.query(`SELECT * FROM photos WHERE id = ? LIMIT 1`, [id]);
      if (rows.length > 0) return formatPhotoRow(rows[0]);
    } catch (err) {
      console.error('Error querying photo by id:', err.message);
    }
  }
  const list = readFallback();
  return list.find((p) => p.id === id) || null;
}

async function deletePhotoFromDB(id) {
  if (dbPool) {
    try {
      await dbPool.query(`DELETE FROM photos WHERE id = ?`, [id]);
    } catch (err) {
      console.error('Error deleting from MySQL:', err.message);
    }
  }
  const list = readFallback();
  writeFallback(list.filter((p) => p.id !== id));
  return true;
}

async function toggleFavoriteInDB(id) {
  if (dbPool) {
    try {
      await dbPool.query(`UPDATE photos SET favorite = NOT favorite WHERE id = ?`, [id]);
      return await getPhotoByIdFromDB(id);
    } catch (err) {
      console.error('Error toggling favorite:', err.message);
    }
  }
  const list = readFallback();
  const p = list.find((x) => x.id === id);
  if (p) {
    p.favorite = !p.favorite;
    writeFallback(list);
    return p;
  }
  return null;
}

function formatPhotoRow(row) {
  let tags = [];
  try {
    tags = typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags || [];
  } catch (e) {
    tags = String(row.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  }

  let colorPalette = ['#131318', '#35343a', '#d4af37', '#a0cfcd'];
  try {
    if (row.color_palette) {
      colorPalette = typeof row.color_palette === 'string' ? JSON.parse(row.color_palette) : row.color_palette;
    }
  } catch (e) {}

  return {
    id: row.id,
    title: row.title,
    filename: row.filename,
    originalKey: row.original_key,
    compressedKey: row.compressed_key,
    bucketName: row.bucket_name,
    url: row.url,
    size: parseInt(row.size, 10) || 0,
    compressedSize: parseInt(row.compressed_size, 10) || 0,
    mimeType: row.mime_type,
    format: row.format,
    camera: row.camera,
    lens: row.lens,
    focalLength: row.focal_length,
    aperture: row.aperture,
    shutterSpeed: row.shutter_speed,
    iso: row.iso,
    location: row.location,
    uploadedAt: row.uploaded_at ? new Date(row.uploaded_at).toISOString() : new Date().toISOString(),
    favorite: Boolean(row.favorite),
    tags,
    colorPalette
  };
}

// Stream to buffer helper
async function streamToBuffer(stream) {
  if (typeof stream.transformToByteArray === 'function') {
    const bytes = await stream.transformToByteArray();
    return Buffer.from(bytes);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// -------------------------------------------------------------
// Auto-Sync Active S3 Bucket Objects with Database
// Strictly syncs actual images from the currently connected bucket
// -------------------------------------------------------------
async function syncS3BucketToDB() {
  const bucket = process.env.AWS_BUCKET_NAME;
  if (!bucket || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.log('[S3 Sync] AWS credentials or bucket not set. Skipping sync.');
    return;
  }

  try {
    const s3 = getS3Client();
    const listRes = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    const contents = listRes.Contents || [];

    console.log(`[S3 Sync] Querying bucket "${bucket}"... Found ${contents.length} object(s).`);

    // ONLY take pictures whose names start with "compressed" in the S3 bucket
    const compressedObjects = contents.filter((item) => {
      if (!item.Key) return false;
      const isImage = /\.(jpe?g|png|webp|tiff?|avif|raw|arw|dng)$/i.test(item.Key);
      if (!isImage) return false;
      const base = path.posix.basename(item.Key);
      return item.Key.startsWith('compressed') || base.startsWith('compressed');
    });

    const validKeys = new Set(compressedObjects.map((item) => item.Key));

    // Prune any records from database that do not exist as compressed objects in S3
    if (dbPool && validKeys.size > 0) {
      const placeholders = Array.from(validKeys).map(() => '?').join(',');
      try {
        await dbPool.query(
          `DELETE FROM photos WHERE bucket_name = ? AND compressed_key NOT IN (${placeholders})`,
          [bucket, ...Array.from(validKeys)]
        );
      } catch (pruneErr) {
        // ignore prune query errors
      }
    }

    const existingPhotos = await getPhotosFromDB();
    const existingKeys = new Set(existingPhotos.map((p) => p.compressedKey));

    for (const item of compressedObjects) {
      const key = item.Key;
      const s3Base = path.posix.basename(key);
      const displayFilename = s3Base
        .replace(/^compressed[-_]?/, '')
        .replace(/^compress\//, '');

      const cleanTitle = displayFilename
        .replace(/\.[^/.]+$/, '')
        .replace(/[-_]/g, ' ')
        .trim();

      const id = `s3_${Math.abs(key.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0))}`;

      if (!existingKeys.has(key)) {
        const photoObj = {
          id,
          title: cleanTitle || 'S3 Compressed Photo',
          filename: displayFilename,
          originalKey: `new-${displayFilename}`,
          compressedKey: key,
          url: `/api/photos/${id}/image`,
          size: item.Size * 3, // Estimated original size
          compressedSize: item.Size,
          mimeType: key.endsWith('.png') ? 'image/png' : 'image/jpeg',
          format: path.extname(displayFilename).replace('.', '').toUpperCase() || 'JPEG',
          camera: 'AWS S3 Cloud',
          lens: '1:1 Square Sharp Optics',
          focalLength: '35mm',
          aperture: 'ƒ/2.0',
          shutterSpeed: '1/250s',
          iso: '100',
          location: `S3: ${bucket}`,
          uploadedAt: item.LastModified ? new Date(item.LastModified).toISOString() : new Date().toISOString(),
          favorite: false,
          tags: ['S3-Bucket', 'Lambda-Compressed', '1:1-Square'],
          colorPalette: ['#131318', '#35343a', '#d4af37', '#a0cfcd']
        };

        await savePhotoToDB(photoObj);
        console.log(`[S3 -> DB] Synced compressed photo from active bucket: ${key}`);
      }
    }
  } catch (err) {
    console.warn('[S3 Sync] S3 sync error:', err.message);
  }
}

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// 1. Health & Config Status Check
app.get('/api/status', async (req, res) => {
  const bucket = process.env.AWS_BUCKET_NAME || null;
  const region = process.env.AWS_REGION || 'ap-south-1';
  const hasAccessKey = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_ACCESS_KEY_ID.trim());
  const hasSecretKey = !!(process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_SECRET_ACCESS_KEY.trim());

  let s3Connected = false;
  let s3ObjectCount = 0;

  if (bucket && hasAccessKey && hasSecretKey) {
    try {
      const s3 = getS3Client();
      const listRes = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          MaxKeys: 10
        })
      );
      s3Connected = true;
      s3ObjectCount = (listRes.Contents || []).length;
    } catch (e) {
      s3Connected = false;
    }
  }

  res.json({
    app: 'Modern Matte Photo Gallery',
    status: 'online',
    publicIp: PUBLIC_IP,
    port: PORT,
    accessUrls: {
      local: `http://localhost:${PORT}`,
      ec2: PUBLIC_IP !== 'localhost' ? `http://${PUBLIC_IP}:${PORT}` : null
    },
    s3: {
      configured: Boolean(bucket),
      connected: s3Connected,
      bucket,
      region,
      hasAccessKey,
      hasSecretKey,
      compressedPrefix: COMPRESSED_PREFIX,
      objectCount: s3ObjectCount
    },
    database: {
      type: 'MySQL (RDS)',
      connected: dbConnected,
      host: dbActiveHost || process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      database: process.env.DB_NAME || 'photogalleryDB'
    }
  });
});

// 2. Fetch all photos strictly starting with "compressed" from S3 bucket
app.get('/api/photos', async (req, res) => {
  try {
    await syncS3BucketToDB();
    const photos = await getPhotosFromDB();
    res.json({
      success: true,
      count: photos.length,
      photos
    });
  } catch (error) {
    console.error('Error fetching photos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. Fetch single photo metadata
app.get('/api/photos/:id', async (req, res) => {
  try {
    const photo = await getPhotoByIdFromDB(req.params.id);
    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }
    res.json({ success: true, photo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. Stream compressed image directly from S3 (pulls from compress/filename)
app.get('/api/photos/:id/image', async (req, res) => {
  try {
    const photo = await getPhotoByIdFromDB(req.params.id);
    if (!photo) {
      return res.status(404).send('Photo not found');
    }

    const bucket = process.env.AWS_BUCKET_NAME;
    if (!bucket || !process.env.AWS_ACCESS_KEY_ID) {
      if (photo.url) return res.redirect(photo.url);
      return res.status(404).send('S3 not configured and no external URL');
    }

    const s3 = getS3Client();

    // Prioritized list of S3 candidate keys - strictly compressed files only
    const candidateKeys = [];
    if (photo.compressedKey) candidateKeys.push(photo.compressedKey);
    candidateKeys.push(`compressed-${photo.filename}`);
    candidateKeys.push(`compressed_${photo.filename}`);
    candidateKeys.push(`compressed/${photo.filename}`);
    candidateKeys.push(`compress/${photo.filename}`);

    const uniqueKeys = [...new Set(candidateKeys)];

    for (const key of uniqueKeys) {
      try {
        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: key
        });
        const s3Response = await s3.send(command);

        res.setHeader('Content-Type', s3Response.ContentType || photo.mimeType || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');

        if (typeof s3Response.Body.pipe === 'function') {
          return s3Response.Body.pipe(res);
        } else {
          const buf = await streamToBuffer(s3Response.Body);
          return res.send(buf);
        }
      } catch (err) {
        continue;
      }
    }

    if (photo && photo.url) {
      return res.redirect(photo.url);
    }
    return res.status(404).send('Compressed photo not found in S3');
  } catch (error) {
    console.error('Error serving image:', error);
    res.status(500).send('Failed to stream image');
  }
});

// Proxy route for arbitrary S3 key
app.get('/api/image/*', async (req, res) => {
  const s3Key = req.params[0];
  const bucket = process.env.AWS_BUCKET_NAME;

  if (!bucket) {
    return res.status(400).send('AWS_BUCKET_NAME not set');
  }

  try {
    const s3 = getS3Client();
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: s3Key
    });
    const s3Response = await s3.send(command);

    res.setHeader('Content-Type', s3Response.ContentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    if (typeof s3Response.Body.pipe === 'function') {
      s3Response.Body.pipe(res);
    } else {
      const buf = await streamToBuffer(s3Response.Body);
      res.send(buf);
    }
  } catch (err) {
    res.status(404).send('Object not found in S3');
  }
});

// 5. Upload Photo to S3 & Save Metadata
app.post('/api/upload', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image file provided' });
    }

    const originalName = req.file.originalname;
    const cleanName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const photoId = `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // While uploading to S3: Name must strictly be "new" and then "image name"
    // e.g. "new-photo.jpg" (or "newphoto.jpg")
    const baseNameWithoutNew = cleanName.replace(/^new[-_]?/, '');
    const originalS3Key = `new-${baseNameWithoutNew}`;
    const compressedS3Key = `compressed-${baseNameWithoutNew}`;

    const bucket = process.env.AWS_BUCKET_NAME;
    let s3UploadSuccess = false;

    // Upload directly to active S3 bucket with prefix "new" and image name (triggers AWS Lambda)
    if (bucket && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      try {
        const s3 = getS3Client();
        const putCmd = new PutObjectCommand({
          Bucket: bucket,
          Key: originalS3Key,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
          Metadata: {
            photoId,
            title: req.body.title || baseNameWithoutNew
          }
        });
        await s3.send(putCmd);
        s3UploadSuccess = true;
        console.log(`[Upload] Uploaded photo to S3 with prefix "new": s3://${bucket}/${originalS3Key}`);
      } catch (s3Err) {
        console.warn('S3 upload warning:', s3Err.message);
      }
    }

    const originalSize = req.file.size;
    const estimatedCompressedSize = Math.round(originalSize * 0.25);
    const ext = path.extname(baseNameWithoutNew).replace('.', '').toUpperCase();

    // Do NOT name the photo as "compressed" when uploading
    // Filename in the app is the photo's original image name
    const photoMetadata = {
      id: photoId,
      title: req.body.title || baseNameWithoutNew.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
      filename: baseNameWithoutNew,
      originalKey: originalS3Key,
      compressedKey: compressedS3Key,
      bucketName: bucket,
      url: `/api/photos/${photoId}/image`,
      size: originalSize,
      compressedSize: estimatedCompressedSize,
      mimeType: req.file.mimetype,
      format: ext || 'JPEG',
      camera: req.body.camera || 'Fine Art Camera',
      lens: req.body.lens || 'FE 35mm F1.4 GM',
      focalLength: req.body.focalLength || '35mm',
      aperture: req.body.aperture || 'ƒ/1.8',
      shutterSpeed: req.body.shutterSpeed || '1/500s',
      iso: req.body.iso || '200',
      location: req.body.location || `S3: ${bucket}`,
      uploadedAt: new Date().toISOString(),
      favorite: false,
      tags: req.body.tags
        ? req.body.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : ['S3-Upload', '1:1-Square'],
      colorPalette: ['#131318', '#35343a', '#d4af37', '#a0cfcd']
    };

    // Store in Database
    await savePhotoToDB(photoMetadata);

    res.json({
      success: true,
      message: 'Photo uploaded to S3 and metadata recorded in database',
      photo: photoMetadata,
      s3: {
        bucket,
        uploadedOriginalKey: originalS3Key,
        targetCompressedKey: compressedS3Key,
        s3Direct: s3UploadSuccess
      },
      database: {
        connected: dbConnected
      }
    });
  } catch (error) {
    console.error('Upload handler error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. Toggle Favorite Status
app.patch('/api/photos/:id/favorite', async (req, res) => {
  try {
    const updated = await toggleFavoriteInDB(req.params.id);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }
    res.json({ success: true, photo: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 7. Delete Photo from S3 and DB
app.delete('/api/photos/:id', async (req, res) => {
  try {
    const photo = await getPhotoByIdFromDB(req.params.id);
    if (!photo) {
      return res.status(404).json({ success: false, error: 'Photo not found' });
    }

    const bucket = process.env.AWS_BUCKET_NAME;
    if (bucket && process.env.AWS_ACCESS_KEY_ID) {
      try {
        const s3 = getS3Client();
        if (photo.compressedKey) {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: photo.compressedKey }));
        }
        if (photo.originalKey) {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: photo.originalKey }));
        }
      } catch (s3Err) {
        console.warn('S3 deletion warning:', s3Err.message);
      }
    }

    await deletePhotoFromDB(req.params.id);
    res.json({ success: true, message: `Photo ${req.params.id} deleted from S3 and database` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 8. Manual Sync Endpoint
app.post('/api/sync-s3', async (req, res) => {
  try {
    await syncS3BucketToDB();
    const photos = await getPhotosFromDB();
    res.json({ success: true, count: photos.length, photos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Catch-all route to serve gallery SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -------------------------------------------------------------
// Start Server
// -------------------------------------------------------------
app.listen(PORT, HOST, async () => {
  await initMySQL();
  await syncS3BucketToDB();

  console.log(`=============================================================`);
  console.log(`   MODERN MATTE PHOTO GALLERY (S3 + MYSQL RDS)               `);
  console.log(`=============================================================`);
  console.log(` Host Bound:     ${HOST}:${PORT}`);
  console.log(` Local Access:   http://localhost:${PORT}`);
  console.log(` EC2 Access:     http://${PUBLIC_IP}:${PORT}`);
  console.log(` Active S3:      ${process.env.AWS_BUCKET_NAME}`);
  console.log(` Compressed Key: ${COMPRESSED_PREFIX}<filename>`);
  console.log(` DB Host:        ${dbActiveHost}`);
  console.log(` DB Status:      ${dbConnected ? 'CONNECTED' : 'STANDBY'}`);
  console.log(` Source:         STRICT S3 BUCKET ONLY`);
  console.log(`=============================================================`);
});
