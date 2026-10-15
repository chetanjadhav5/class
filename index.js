/**
 * AWS LAMBDA FUNCTION: Image 1:1 Square Ratio & Compression Pipeline
 * File: index.js
 * 
 * Pipeline Specification:
 * 1. Triggered on S3 PutObject with prefix "new"
 * 2. Uploaded original image name: "new" + "image name" (e.g. new-photo.jpg or newphoto.jpg)
 * 3. Downloads the newly uploaded original photo from S3
 * 4. Corrects EXIF rotation & adjusts aspect ratio to 1:1 (square center-crop, distortion-free)
 * 5. Compresses the photo (MozJPEG / PNG8 / WebP)
 * 6. Renames the photo from "new" to "compressed" + "image name"
 *    (e.g., "new-photo.jpg" -> "compressed-photo.jpg", "newphoto.jpg" -> "compressedphoto.jpg")
 * 7. Uploads the compressed 1:1 image back to the S3 bucket
 * 8. Deletes the original "new" photo from the S3 bucket
 */

const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand
} = require("@aws-sdk/client-s3");
const sharp = require("sharp");
const path = require("path");

// S3 Client: Picks up IAM Role in Lambda, or local credentials when tested locally
const s3Config = {
  region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1"
};

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  s3Config.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim()
  };
}

const s3 = new S3Client(s3Config);

// Compression parameters tailored for high visual quality & low file weight
const COMPRESSION_CONFIG = {
  jpeg: { quality: 80, mozjpeg: true },
  jpg: { quality: 80, mozjpeg: true },
  png: { compressionLevel: 8, quality: 80 },
  webp: { quality: 80 },
  avif: { quality: 65 }
};

/**
 * Main AWS Lambda Event Handler
 */
exports.handler = async (event, context) => {
  console.log("[Lambda] Invoked with event:", JSON.stringify(event, null, 2));

  const results = [];

  for (const record of event.Records ?? []) {
    // Only process S3 events
    if (record.eventSource !== "aws:s3") {
      console.log(`[Lambda] Skipping non-S3 event source: ${record.eventSource}`);
      continue;
    }

    const bucket = record.s3.bucket.name;
    // S3 event keys are URL-encoded; spaces are encoded as '+'
    const rawKey = record.s3.object.key.replace(/\+/g, " ");
    const key = decodeURIComponent(rawKey);

    console.log(`[Lambda] Analyzing object: s3://${bucket}/${key}`);

    // Infinite Loop Protection: Never process already compressed files
    if (key.includes("compressed")) {
      console.log(`[Lambda] Skipping already compressed object: ${key}`);
      continue;
    }

    // Filter by "new" prefix
    const baseName = path.posix.basename(key);
    const isNew = key.startsWith("new") || baseName.startsWith("new");
    if (!isNew) {
      console.log(`[Lambda] Skipping object without "new" prefix: ${key}`);
      continue;
    }

    // Only process valid image file extensions
    const isImage = /\.(jpe?g|png|webp|tiff?|avif|gif)$/i.test(key);
    if (!isImage) {
      console.log(`[Lambda] Skipping non-image object: ${key}`);
      continue;
    }

    // Generate output key by removing "new" and renaming to "compressed" + "image name"
    // Examples:
    //   "new-photo.jpg" -> "compressed-photo.jpg"
    //   "new_photo.jpg" -> "compressed_photo.jpg"
    //   "newphoto.jpg"  -> "compressedphoto.jpg"
    //   "new/photo.jpg" -> "compressed/photo.jpg"
    const dir = path.posix.dirname(key);
    let newBase;
    if (baseName.startsWith("new-")) {
      newBase = baseName.replace(/^new-/, "compressed-");
    } else if (baseName.startsWith("new_")) {
      newBase = baseName.replace(/^new_/, "compressed_");
    } else if (baseName.startsWith("new/")) {
      newBase = baseName.replace(/^new\//, "compressed/");
    } else if (baseName.startsWith("new")) {
      newBase = `compressed-${baseName.slice(3).replace(/^[-_]/, "")}`;
    } else {
      newBase = `compressed-${baseName}`;
    }

    let outputKey = dir === "." ? newBase : path.posix.join(dir, newBase);
    if (key.startsWith("new/")) {
      outputKey = key.replace(/^new\//, "compressed/");
    }

    console.log(`[Lambda] Target transformed key: s3://${bucket}/${outputKey}`);

    try {
      // Step 1: Download the original "new" photo from S3
      console.log(`[Lambda Step 1/5] Downloading: s3://${bucket}/${key}`);
      const s3Response = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key
        })
      );

      const originalBytes = await s3Response.Body.transformToByteArray();
      const originalBuffer = Buffer.from(originalBytes);
      const originalSize = originalBuffer.length;

      // Step 2: Initialize Sharp and read metadata
      console.log(`[Lambda Step 2/5] Inspecting image properties (${(originalSize / 1024).toFixed(1)} KB)...`);
      const image = sharp(originalBuffer, {
        limitInputPixels: 100000000,
        failOn: "none"
      });

      const metadata = await image.metadata();
      const rawFormat = (metadata.format || "jpeg").toLowerCase();
      const format = rawFormat === "jpg" ? "jpeg" : rawFormat;

      // Step 3: Adjust aspect ratio to 1:1 (square center-crop)
      // Auto-rotates according to EXIF orientation tag first to ensure correct portrait/landscape orientation
      const width = metadata.width || 1000;
      const height = metadata.height || 1000;
      const targetDimension = Math.min(width, height);

      console.log(`[Lambda Step 3/5] Cropping to 1:1 ratio: ${width}x${height} -> ${targetDimension}x${targetDimension}`);

      let processed = image
        .rotate() // Autorotate based on EXIF tag
        .resize(targetDimension, targetDimension, {
          fit: "cover",
          position: "center"
        });

      // Step 4: Compress image
      console.log(`[Lambda Step 4/5] Compressing image (format: ${format})...`);
      if (format === "jpeg" || format === "jpg") {
        processed = processed.jpeg(COMPRESSION_CONFIG.jpeg);
      } else if (format === "png") {
        processed = processed.png(COMPRESSION_CONFIG.png);
      } else if (format === "webp") {
        processed = processed.webp(COMPRESSION_CONFIG.webp);
      } else if (format === "avif") {
        processed = processed.avif(COMPRESSION_CONFIG.avif);
      } else {
        processed = processed.jpeg(COMPRESSION_CONFIG.jpeg);
      }

      const compressedBuffer = await processed.toBuffer();
      const compressedSize = compressedBuffer.length;
      const savingsPct = Math.round((1 - compressedSize / originalSize) * 100);

      console.log(
        `[Lambda] Compression complete: ${(originalSize / 1024).toFixed(1)} KB -> ${(compressedSize / 1024).toFixed(1)} KB (${savingsPct}% saved)`
      );

      // Step 5: Upload the 1:1 compressed photo back to S3 named "compressed" + "image name"
      const mimeType = format === "jpeg" ? "image/jpeg" : `image/${format}`;
      console.log(`[Lambda Step 5/5] Uploading compressed 1:1 photo to s3://${bucket}/${outputKey}`);

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: outputKey,
          Body: compressedBuffer,
          ContentType: mimeType,
          Metadata: {
            "processed-by": "aws-lambda-image-compressor",
            "aspect-ratio": "1:1",
            "source-key": key,
            "original-size": String(originalSize),
            "compressed-size": String(compressedSize),
            "savings-percent": `${savingsPct}%`
          }
        })
      );
      console.log(`[Lambda] Successfully uploaded: s3://${bucket}/${outputKey}`);

      // Step 6: Delete the original "new" photo from S3
      console.log(`[Lambda Cleanup] Deleting original: s3://${bucket}/${key}`);
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key
        })
      );
      console.log(`[Lambda Cleanup] Successfully deleted original: s3://${bucket}/${key}`);

      results.push({
        sourceKey: key,
        outputKey,
        originalSize,
        compressedSize,
        savingsPct,
        status: "SUCCESS"
      });
    } catch (err) {
      console.error(`[Lambda] Failed processing s3://${bucket}/${key}:`, err);
      results.push({
        sourceKey: key,
        error: err.message,
        status: "FAILED"
      });
      // Throw error so AWS Lambda marks invocation as failed and triggers retry/alarm if configured
      throw err;
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "1:1 Aspect Ratio & Compression Pipeline completed",
      processedCount: results.length,
      results
    })
  };
};

/**
 * Local CLI / Diagnostic Runner
 * Allows testing the Lambda logic directly via: `node index.js`
 */
if (require.main === module) {
  require("dotenv").config();
  console.log("=============================================================");
  console.log("   AWS LAMBDA IMAGE 1:1 COMPRESSION & RENAMING PIPELINE     ");
  console.log("=============================================================");
  console.log(" Handler:         index.handler");
  console.log(" Trigger Prefix:  'new'");
  console.log(" Output Prefix:   'compressed'");
  console.log(" Aspect Ratio:    1:1 (Center-Crop)");
  console.log(" Compression:     MozJPEG / PNG8 / WebP");
  console.log(" Action on Original: DELETE old 'new' file");
  console.log(" Target Bucket:   ", process.env.AWS_BUCKET_NAME || "(configured via S3 event)");
  console.log(" Region:          ", process.env.AWS_REGION || "ap-south-1");
  console.log("=============================================================\n");

  const testKey = process.argv[2];
  if (testKey) {
    console.log(`[CLI] Running simulated S3 event for key: ${testKey}`);
    const mockEvent = {
      Records: [
        {
          eventSource: "aws:s3",
          s3: {
            bucket: { name: process.env.AWS_BUCKET_NAME },
            object: { key: encodeURIComponent(testKey) }
          }
        }
      ]
    };
    exports.handler(mockEvent)
      .then((res) => console.log("[CLI Test Result]:", JSON.stringify(res, null, 2)))
      .catch((err) => console.error("[CLI Test Failed]:", err));
  } else {
    console.log("Ready to deploy to AWS Lambda.");
    console.log("To test against an S3 object locally, run:");
    console.log("  node index.js new-photo.jpg\n");
  }
}
