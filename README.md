# Lumina — Modern Matte Photo Gallery

A high-performance, modern matte photo gallery built using the **"Modern Matte Photo Gallery" (Obscura Matte)** design system from Stitch, integrated with **Amazon S3** and **MySQL (RDS)**.

---

## Architecture

```
                      +---------------------------------------+
                      |               Browser                 |
                      | (Tactile Obscura Matte Exhibition UI) |
                      +-------------------+-------------------+
                                          |
                        HTTP / REST APIs  |  Upload & Query
                                          v
                      +---------------------------------------+
                      |         Node.js Express Server        |
                      |   (Localhost & EC2 via PUBLIC_IP)     |
                      +---------+-------------------+---------+
                                |                   |
                 Streams from   |                   | SQL Queries & Inserts
             `compress/filename`|                   | (photos table)
                                v                   v
                     +--------------------+   +-------------------+
                     |   Amazon S3 Bucket |   |    MySQL (RDS)    |
                     |  (mybucket-...-an) |   |  (Metadata Store) |
                     +---------+----------+   +-------------------+
                               |
                        S3 ObjectCreated
                               v
                     +--------------------+
                     | AWS Lambda Function|
                     | (Image Compressor) |
                     |  -> compress/key   |
                     +--------------------+
```

---

## Key Features

1. **Strictly Real Photos from S3 Bucket**:
   - **Zero mock/example photos**: All photographs in the gallery originate directly from your Amazon S3 bucket (`mybucket-301126926087-ap-south-1-an`).
   - The server inspects the S3 bucket on startup and syncs images (`compress/`, `compressed/`, and root images) into the MySQL database.
   - You can also click **"Rescan S3 Bucket Now"** in the infrastructure dropdown at any time to discover newly compressed images.

2. **MySQL Relational Database (RDS) Metadata Store**:
   - Replaced Redis with **MySQL (RDB)**.
   - All photo metadata (camera optics, lens, focal length, aperture, shutter speed, ISO, S3 compressed keys, file sizes, and favorite flags) is stored in the `photos` table in MySQL (`photogallery` database).

3. **S3 Ingestion & Lambda Compression (`compress/filename`)**:
   - Newly uploaded images are pushed to your S3 bucket.
   - Images are served through `/api/photos/:id/image`, pulling from **`compress/filename`** as requested.
   - Smooth candidate resolution checks `compress/filename`, `compressed/filename`, and original keys to ensure no broken images while Lambda finishes processing.

4. **Obscura Matte Aesthetic (from Stitch)**:
   - Deep charcoal canvas (`#0e0e13` / `#131318`), warm champagne gold accents (`#d4af37`), muted teal badges (`#5e8c8a`), and 1px micro-rim keylines (`rgba(255, 255, 255, 0.08)`).
   - Space Grotesk, Hanken Grotesk, and Space Mono typography.
   - Fullscreen Photo Detail & EXIF Lightbox with MySQL telemetry drawer.

5. **EC2 & Localhost Ready**:
   - Configured with `PUBLIC_IP` in `.env`.
   - The server binds to `0.0.0.0:3000`, operating smoothly on both `http://localhost:3000` and `http://<PUBLIC_IP>:3000`.

---

## Environment Configuration (`.env`)

```env
# AWS S3 Configuration
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_BUCKET_NAME=your_s3_bucket_name

# S3 prefix where Lambda pushes compressed photos
S3_COMPRESSED_PREFIX=compress/

# MySQL / RDS Database Configuration
DB_HOST=your_db_host
DB_PORT=3306
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=photogalleryDB

# Server & EC2 Deployment
PUBLIC_IP=your_public_ip_or_localhost
PORT=3000
HOST=0.0.0.0
ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

---

## MySQL Table Schema

```sql
CREATE TABLE IF NOT EXISTS photos (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  original_key VARCHAR(255) NOT NULL,
  compressed_key VARCHAR(255) NOT NULL,
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
);
```

---

## Running the Application

### 1. Start the Server
```bash
npm start
```
Or for development with auto-reload:
```bash
npm run dev
```

### 2. Access the Gallery
- **Local machine**: [http://localhost:3000](http://localhost:3000)
- **EC2 instance**: `http://52.66.9.153:3000` (or `http://<YOUR_EC2_PUBLIC_IP>:3000`)
