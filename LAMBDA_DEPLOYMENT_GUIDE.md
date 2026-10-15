# AWS Lambda Deployment Guide: 1:1 Image Ratio & Compression Pipeline

This guide explains how to deploy and configure the AWS Lambda function in [`index.js`](file:///d:/class/cloud/photogallery/index.js) with your Amazon S3 bucket (`photogallarybucket-301126926087-ap-south-1-an`).

---

## 1. Architectural Flow

```
[User Browser]
      │
      │ 1. Uploads Photograph
      ▼
[Express Server / EC2]
      │
      │ 2. Prefixes name with "new-" (e.g. new-1792040477_photo.jpg)
      │    Uploads to S3 Bucket
      ▼
[Amazon S3 Bucket]
      │
      │ 3. S3 Event Trigger: ObjectCreated:* (Prefix: "new")
      ▼
[AWS Lambda (index.js)]
      │
      │ 4a. Downloads "new-*.jpg"
      │ 4b. Auto-rotates EXIF orientation & crops to 1:1 square ratio
      │ 4c. Compresses image (MozJPEG / PNG8 / WebP)
      │ 4d. Renames to "compressed-*.jpg"
      │ 4e. Uploads compressed 1:1 image back to S3
      │ 4f. Deletes original "new-*.jpg" from S3
      ▼
[Express Server / EC2]
      │
      │ 5. Streams strictly "compressed-*" photos from S3 to user
      ▼
[Modern Matte Gallery UI]
```

---

## 2. AWS Lambda Function Configuration

In the [AWS Management Console](https://console.aws.amazon.com/lambda/):

1. **Create Function**:
   - **Function name**: `s3-image-compressor-1to1` (or your choice)
   - **Runtime**: `Node.js 20.x` (or `Node.js 18.x`)
   - **Architecture**: `x86_64`

2. **Configuration Settings**:
   - **Memory**: `512 MB` or `1024 MB` (image processing requires sufficient memory for Sharp)
   - **Timeout**: `30 seconds`

3. **Execution Role (IAM Permissions)**:
   - Ensure the Lambda execution role has permission to read, write, and delete objects in your bucket:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:GetObject",
           "s3:PutObject",
           "s3:DeleteObject"
         ],
         "Resource": "arn:aws:s3:::photogallarybucket-301126926087-ap-south-1-an/*"
       }
     ]
   }
   ```

---

## 3. Packaging & Uploading the Lambda Code

AWS Lambda runs on Amazon Linux. Because `sharp` is a native C++ module, install the Linux binaries when packaging:

### Option A: From your project directory (PowerShell)
```powershell
# Create a deployment folder
mkdir lambda-dist
cd lambda-dist

# Copy index.js
copy ..\index.js .

# Initialize minimal package.json
npm init -y

# Install sharp with Linux x64 target platform
npm install --arch=x64 --platform=linux --libc=glibc sharp @aws-sdk/client-s3

# Create the zip archive
Compress-Archive -Path * -DestinationPath ..\lambda-deployment.zip -Force
cd ..
```

### Option B: Upload via AWS CLI
```bash
aws lambda update-function-code \
  --function-name s3-image-compressor-1to1 \
  --zip-file fileb://lambda-deployment.zip \
  --region ap-south-1
```

---

## 4. Configuring the S3 Bucket Trigger

1. Open your S3 Bucket in AWS Console:
   - Bucket: `photogallarybucket-301126926087-ap-south-1-an`
2. Go to the **Properties** tab.
3. Scroll down to **Event notifications** &rarr; click **Create event notification**.
4. Configure:
   - **Event name**: `NewImageUploaded`
   - **Prefix filter**: `new` *(Critical: this triggers Lambda ONLY for newly uploaded photos with the "new" prefix, preventing infinite loops)*
   - **Event types**: Select `All object create events` (`s3:ObjectCreated:*`)
   - **Destination**: Choose **Lambda function**
   - **Lambda function**: Select `s3-image-compressor-1to1`
5. Click **Save changes**.

---

## 5. Local Testing & Verification

The app in [`server.js`](file:///d:/class/cloud/photogallery/server.js) is also equipped with local execution fallback:
- When you upload via the web UI or API, the file is uploaded to S3 with `new-<timestamp>_<filename>`.
- The Lambda handler in [`index.js`](file:///d:/class/cloud/photogallery/index.js) can also be tested locally anytime by running:
  ```powershell
  node index.js new-<filename>.jpg
  ```
- The app strictly serves and displays images with the `compressed-` prefix from your S3 bucket.
