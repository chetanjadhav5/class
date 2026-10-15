require('dotenv').config();
const mysql = require('mysql2/promise');

async function checkAndSetupDatabase() {
  const host = process.env.DB_HOST;
  const port = parseInt(process.env.DB_PORT, 10) || 3306;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const dbName = process.env.DB_NAME || 'photogalleryDB';

  console.log(`[DB Check] Connecting to MySQL server at ${host}:${port} as ${user}...`);

  let connection;
  try {
    // 1. Connect without selecting a database first
    connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
      connectTimeout: 10000
    });
    console.log('[DB Check] MySQL connection established successfully!');

    // 2. Create the database if it doesn't exist
    console.log(`[DB Check] Checking database "${dbName}"...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`[DB Check] Database "${dbName}" is ready.`);

    // 3. Switch to the database
    await connection.query(`USE \`${dbName}\``);

    // 4. Create the photos table if it doesn't exist
    console.log('[DB Check] Checking table "photos"...');
    await connection.query(`
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
    console.log('[DB Check] Table "photos" is verified and ready.');

    // 5. Verify tables & columns
    const [tables] = await connection.query('SHOW TABLES');
    console.log(`[DB Check] Current tables in "${dbName}":`, tables);

    const [countRows] = await connection.query('SELECT COUNT(*) AS total FROM photos');
    console.log(`[DB Check] Current photo metadata count in database: ${countRows[0].total}`);

    return { success: true };
  } catch (error) {
    console.error('[DB Check] Error:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

if (require.main === module) {
  checkAndSetupDatabase()
    .then(() => {
      console.log('[DB Check] Completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[DB Check] Failed:', err);
      process.exit(1);
    });
}

module.exports = { checkAndSetupDatabase };
