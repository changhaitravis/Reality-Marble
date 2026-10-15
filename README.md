# "Reality Marble" (Soratama Photo Generator)

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![Google Cloud Functions 2nd Gen](https://img.shields.io/badge/Google%20Cloud-Functions%20(2nd%20Gen)-blue.svg)](https://cloud.google.com/functions)
[![Cloud Run](https://img.shields.io/badge/Google%20Cloud-Cloud%20Run-blue.svg)](https://cloud.google.com/run)

[Demo Site](https://changhaitravis.github.io/Reality-Marble/)

Transform regular images into authentic **Soratama** (宙玉 / glass marble) style photography using ImageMagick and modern Google Cloud serverless architecture.

---

## What is a Soratama Photo?

Soratama is a photographic technique where a clear glass sphere is positioned in front of the lens. The physics of a glass ball lens produces:
1. **Optical Inversion**: Light rays invert inside the sphere (upside down and flipped horizontally).
2. **2D Radial Spherical Distortion**: Radial magnification in the center with optical compression towards the sphere boundary.
3. **Glass Marble 3D Shading & Specular Highlights**: Directional light highlights and subtle edge darkening give the sphere physical depth.
4. **Bokeh Background**: The surrounding background outside the marble remains in its upright orientation with an out-of-focus blur.

---

## Modern Cloud Architecture

- **Google Cloud Functions (2nd Gen) / Cloud Run Functions**: Uses `@google-cloud/functions-framework` with Node.js 20+ runtime.
- **Google Cloud Run Container Deployment**: Includes a `Dockerfile` with pre-installed `imagemagick` for fully portable container execution.
- **Standalone Express Server**: Built-in `server.js` for local development and self-hosted environments.
- **Enhanced 2D Radial Distortion**: Mathematical 2D coordinate LUTs replace 1D approximations for authentic radial refraction.

---

## Local Development & Testing

### Prerequisites
- Node.js >= 20.0.0
- ImageMagick (`convert` CLI) installed on your system

### 1. Install Dependencies
```bash
npm install
```

### 2. Run with Google Cloud Functions Framework (recommended)
```bash
npm start
```
The function will be available at `http://localhost:8080`.

### 3. Run with Express Server
```bash
npm run server
```
Access the interactive web UI at `http://localhost:3000`.

---

## Deployment

### Option A: Google Cloud Functions (2nd Gen)
Deploy directly using the Google Cloud CLI:
```bash
gcloud functions deploy soratamafy \
  --gen2 \
  --runtime=nodejs20 \
  --region=us-central1 \
  --source=. \
  --entry-point=soratamafy \
  --trigger-http \
  --allow-unauthenticated
```

### Option B: Google Cloud Run
Deploy using Cloud Build and Cloud Run with the included `Dockerfile`:
```bash
gcloud run deploy reality-marble \
  --source=. \
  --region=us-central1 \
  --allow-unauthenticated
```

---

## API Reference

### `POST /soratamafy`
Transforms an uploaded image into a Soratama photo.

- **Content-Type**: `multipart/form-data`
- **Form Field**: `upload` (image file)

#### Query Parameters:
- `?base64`: Returns HTML image tag containing base64 data URI (or JSON when `?json` is also passed).
- *(default)*: Streams the processed JPEG image directly (`Content-Type: image/jpeg`).

#### Example with cURL:
```bash
# Get binary JPEG
curl -X POST -F "upload=@photo.jpg" http://localhost:8080/soratamafy --output soratama.jpg

# Get Base64 image
curl -X POST -F "upload=@photo.jpg" "http://localhost:8080/soratamafy?base64"
```

---

## License
Apache-2.0
