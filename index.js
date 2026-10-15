/**
 * Copyright 2026, Travis P. Juntara.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const functions = require('@google-cloud/functions-framework');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Busboy = require('busboy');

const execAsync = promisify(exec);

// Dimensions & constants
const SPHERE_SIZE = 600; // Resolution of the marble sphere
const BG_WIDTH = 2048;   // Background canvas width
const BG_HEIGHT = 1536;  // Background canvas height

// Persistent sphere maps in temp directory
const sphere_lutxFilename = path.join(os.tmpdir(), 'sphere_lutx_v2.png');
const sphere_lutyFilename = path.join(os.tmpdir(), 'sphere_luty_v2.png');
const sphere_maskFilename = path.join(os.tmpdir(), 'sphere_mask_v2.png');
const sphere_overlayFilename = path.join(os.tmpdir(), 'sphere_overlay_v2.png');

/**
 * Ensures that the sphere distortion LUTs, mask, and 3D glass shading overlay exist.
 * Uses true 2D radial spherical distortion for authentic Soratama optical refraction.
 */
async function ensureSphereMaps() {
  if (
    fs.existsSync(sphere_lutxFilename) &&
    fs.existsSync(sphere_lutyFilename) &&
    fs.existsSync(sphere_maskFilename) &&
    fs.existsSync(sphere_overlayFilename)
  ) {
    return;
  }

  const radius = SPHERE_SIZE / 2 - 2;
  const center = SPHERE_SIZE / 2;

  // 1. Generate 2D Radial Spherical Distortion LUTs (X and Y coordinate maps)
  // Radial mapping: r_src = sin(r * pi / 2), where r = 2 * hypot(x, y) <= 1 inside sphere
  const cmdLutX = `convert -size ${SPHERE_SIZE}x${SPHERE_SIZE} xc: -channel R -fx 'xx=(i+0.5)/w-0.5; yy=(j+0.5)/h-0.5; r=2*hypot(xx,yy); (r>0 && r<=1) ? (xx*sin(r*pi/2)/r + 0.5) : (i/w)' -separate +channel "${sphere_lutxFilename}"`;
  const cmdLutY = `convert -size ${SPHERE_SIZE}x${SPHERE_SIZE} xc: -channel R -fx 'xx=(i+0.5)/w-0.5; yy=(j+0.5)/h-0.5; r=2*hypot(xx,yy); (r>0 && r<=1) ? (yy*sin(r*pi/2)/r + 0.5) : (j/h)' -separate +channel "${sphere_lutyFilename}"`;

  // 2. Generate smooth anti-aliased circular alpha mask
  const cmdMask = `convert -size ${SPHERE_SIZE}x${SPHERE_SIZE} xc:black -fill white -draw "circle ${center},${center} ${center},2" -blur 0x1 "${sphere_maskFilename}"`;

  // 3. Generate 3D glass sphere lighting & specular highlight overlay
  const cmdOverlay = `convert "${sphere_maskFilename}" \\( +clone -blur 0x30 -shade 120x30 -contrast-stretch 0% +sigmoidal-contrast 5x50% -fill grey50 -colorize 15% \\) -composite "${sphere_overlayFilename}"`;

  await execAsync(`${cmdLutX} && ${cmdLutY} && ${cmdMask} && ${cmdOverlay}`);
}

/**
 * Transforms an input image file into a Soratama (crystal marble) photo using ImageMagick.
 */
async function processSoratamaImage(inputPath, outputPath) {
  await ensureSphereMaps();

  const reqId = crypto.randomBytes(8).toString('hex');
  const marbleFileName = path.join(os.tmpdir(), `marble_${reqId}.png`);
  const blurredBgFileName = path.join(os.tmpdir(), `blurred_bg_${reqId}.jpg`);

  try {
    // 1. Create the Soratama marble:
    // - Crop center square and resize to SPHERE_SIZE
    // - Invert image (-flip -flop) to simulate optical ball lens refraction
    // - Apply 2D radial spherical distortion via LUTs
    // - Composite 3D glass lighting overlay (HardLight)
    // - Apply anti-aliased circular alpha mask
    const createMarbleCmd = `convert "${inputPath}" -resize ${SPHERE_SIZE}x${SPHERE_SIZE}^ -gravity Center -crop ${SPHERE_SIZE}x${SPHERE_SIZE}+0+0 +repage -flip -flop "${sphere_lutxFilename}" "${sphere_lutyFilename}" -fx 'p{ u[1]*w, u[2]*h }' "${sphere_overlayFilename}" -compose HardLight -composite "${sphere_maskFilename}" -alpha off -compose CopyOpacity -composite "${marbleFileName}"`;
    await execAsync(createMarbleCmd);

    // 2. Create the bokeh blurred background:
    // - Maintain original upright orientation (no flip/flop)
    // - Resize and crop to wide landscape aspect
    // - Apply rich photographic bokeh Gaussian blur
    const createBgCmd = `convert "${inputPath}" -resize ${BG_WIDTH}x${BG_HEIGHT}^ -gravity Center -crop ${BG_WIDTH}x${BG_HEIGHT}+0+0 +repage -channel RGBA -blur 0x32 "${blurredBgFileName}"`;
    await execAsync(createBgCmd);

    // 3. Composite the marble onto the center of the blurred background
    const compositeCmd = `convert "${blurredBgFileName}" "${marbleFileName}" -gravity Center -composite -format jpg -quality 92 "${outputPath}"`;
    await execAsync(compositeCmd);
  } finally {
    fs.promises.unlink(marbleFileName).catch(() => {});
    fs.promises.unlink(blurredBgFileName).catch(() => {});
  }
}

/**
 * Parses multipart form upload from request (supports Cloud Functions, Cloud Run, and Express).
 */
function parseMultipartUpload(req) {
  return new Promise((resolve, reject) => {
    let busboy;
    try {
      busboy = Busboy({ headers: req.headers });
    } catch (err) {
      return reject(new Error('Invalid multipart request headers: ' + err.message));
    }

    let uploadInfo = null;
    const fileWritePromises = [];

    busboy.on('file', (name, fileStream, info) => {
      const filename = (typeof info === 'object' && info.filename) ? info.filename : (info || 'upload.jpg');
      const tempFilename = `upload_${crypto.randomBytes(8).toString('hex')}_${path.basename(filename)}`;
      const filepath = path.join(os.tmpdir(), tempFilename);
      uploadInfo = { path: filepath, filename };

      const writeStream = fs.createWriteStream(filepath);
      fileStream.pipe(writeStream);

      const filePromise = new Promise((res, rej) => {
        writeStream.on('finish', res);
        writeStream.on('error', rej);
      });
      fileWritePromises.push(filePromise);
    });

    busboy.on('finish', async () => {
      try {
        await Promise.all(fileWritePromises);
        if (!uploadInfo) {
          return reject(new Error('No file uploaded'));
        }
        resolve(uploadInfo);
      } catch (err) {
        reject(err);
      }
    });

    busboy.on('error', (err) => {
      reject(err);
    });

    if (req.rawBody) {
      busboy.end(req.rawBody);
    } else {
      req.pipe(busboy);
    }
  });
}

/**
 * Main HTTP Handler for Soratamafy (Google Cloud Functions 2nd Gen / Cloud Run / Express)
 */
async function soratamafy(req, res) {
  // CORS Headers
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      service: 'Reality Marble (Soratamafy)',
      description: 'Upload an image via POST multipart/form-data to transform it into a Soratama photo.',
      version: '2.0.0'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed. Use POST to upload images.');
  }

  const reqId = crypto.randomBytes(8).toString('hex');
  const outputPath = path.join(os.tmpdir(), `output_${reqId}.jpg`);
  let uploadedFile = null;

  try {
    uploadedFile = await parseMultipartUpload(req);
    await processSoratamaImage(uploadedFile.path, outputPath);

    const isBase64 = req.query && req.query.base64 !== undefined;

    if (isBase64) {
      const data = await fs.promises.readFile(outputPath);
      const b64 = Buffer.from(data).toString('base64');
      const dataUri = `data:image/jpeg;base64,${b64}`;

      if (req.query.json !== undefined) {
        return res.status(200).json({ result: dataUri, status: 'success' });
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`<img src="${dataUri}" alt="Soratama Photo" />`);
      }
    } else {
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Disposition': 'inline; filename="soratama.jpg"'
      });
      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);
    }
  } catch (err) {
    console.error('Error processing soratama image:', err);
    return res.status(500).send('Error processing image: ' + err.message);
  } finally {
    if (uploadedFile && uploadedFile.path) {
      fs.promises.unlink(uploadedFile.path).catch(() => {});
    }
    fs.promises.unlink(outputPath).catch(() => {});
  }
}

// Register for Google Cloud Functions (2nd Gen) Functions Framework
try {
  functions.http('soratamafy', soratamafy);
} catch (e) {
  // Functions framework not in global scope or running standalone
}

exports.soratamafy = soratamafy;
module.exports = { soratamafy };
