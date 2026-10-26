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

// Persistent sphere maps in temp directory (v3 = Snell's Law physics rewrite)
const sphere_lutxFilename = path.join(os.tmpdir(), 'sphere_lutx_v3.png');
const sphere_lutyFilename = path.join(os.tmpdir(), 'sphere_luty_v3.png');
const sphere_maskFilename = path.join(os.tmpdir(), 'sphere_mask_v3.png');
const sphere_overlayFilename = path.join(os.tmpdir(), 'sphere_overlay_v3.png');

/**
 * Ensures that the sphere distortion LUTs, mask, and glass lighting overlay exist.
 *
 * Physics model: orthographic camera at z=+∞, background at z=−∞, solid glass
 * sphere (n=1.5) at origin.  For each output pixel at normalised disc position
 * (nx, ny) with r = ‖(nx,ny)‖ ∈ [0,1]:
 *
 *   1. Surface normal  N = (nx, ny, pz),  pz = √(1−r²)
 *   2. Snell's law at front surface (air→glass):
 *        cos_θi = pz,  cos_θt = √(1 − r²/n²)
 *        Refracted direction T (unit vector) via vector Snell's law
 *   3. Ray exits sphere at t_exit = 2·cos_θt from entry point (closed form).
 *   4. Snell's law at back surface (glass→air):
 *        exit angle equals entry angle (sphere symmetry)
 *        l_exit derived from vector Snell's law
 *   5. Background source angle = l_exit_x / |l_exit_z| (transverse/longitudinal)
 *
 * Key intermediate quantities (used in LUT -fx expressions):
 *   A    = pz/n − cos_θt  (= 2pz/3 − ct for n=1.5)
 *   Bfac = n·cos_θt − pz  (= 1.5·ct − pz)
 *   lez  = z-component of exit ray (always negative → toward background)
 *   lex/ley = x/y transverse exit ray components
 *
 * Source sample = 0.5 + (lex/lez)·FOV_SCALE  for the X-LUT (similar for Y).
 * FOV_SCALE=0.45 maps the entire source image into the inner ~80% of the marble;
 * the outer 20% rim fades via Fresnel darkening.
 *
 * The input image is pre-inverted (−flip −flop) before LUT sampling because a
 * glass sphere inverts the transmitted image.  With pre-inversion, the LUT
 * formula samples in the same direction as the screen position (lex/lez > 0 for
 * screen_x > 0), which correctly recovers the right content from the flipped image.
 *
 * Overlay (composited with HardLight over the distorted marble):
 *   − Fresnel rim darkening: real glass becomes reflective at grazing angles;
 *     modelled as 0.5·(1 − r^5) → drops from 0.5 (neutral) at centre to 0 at rim.
 *   − Specular highlight: Phong model with light L ≈ (−0.28, −0.47, 0.84);
 *     half-vector H ≈ (−0.144, −0.192, 0.971) places the hot-spot upper-left.
 *   HardLight semantics: overlay < 0.5 → darkens base; overlay > 0.5 → brightens.
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

  const center = SPHERE_SIZE / 2;

  // FOV scale: how much of the source image maps into the marble disc.
  // 0.45 → full image visible within r≈0.80 of the marble; outer rim darkens.
  const FOV_SCALE = 0.45;

  // Shared intermediate variables used by both LUT axes.
  const lutShared = [
    'xx=(i+0.5)/w-0.5',
    'yy=(j+0.5)/h-0.5',
    'r2=4*(xx*xx+yy*yy)',       // r² in [0,1] (normalised to sphere edge)
    'r=sqrt(r2)',
    'pz=sqrt(max(0,1-r2))',     // z-component of sphere surface normal
    'ct=sqrt(max(0,1-r2/2.25))',// cos(θ_refracted) via Snell: sin_t = r/1.5
    'A=2*pz/3-ct',              // = pz/n − ct  (n=1.5 → pz/1.5 = 2pz/3)
    'Bfac=1.5*ct-pz',           // = n·ct − pz
    // z-component of exit ray: n·Tz − Bfac·Pbz
    //   Tz   = −r²/n − pz·ct  →  n·Tz = −r2 − 1.5·pz·ct
    //   Pbz  = pz − 2·ct·(r²/n + pz·ct)  =  pz − 2·ct·(r2/1.5 + pz·ct)
    'lez=(-r2-1.5*pz*ct)-Bfac*(pz-2*ct*(r2/1.5+pz*ct))',
  ].join('; ');

  // X-LUT: for each output pixel, the x source coordinate in the (pre-flipped) image.
  //   lex = n·Tx − Bfac·Pbx = 2·xx·(1.5·A − Bfac·(1 + 2·ct·A))
  const cmdLutX = `convert -size ${SPHERE_SIZE}x${SPHERE_SIZE} xc: -channel R -fx '${lutShared}; lex=2*xx*(1.5*A-Bfac*(1+2*ct*A)); (r<=0)?0.5:(r>1)?(i/w):(0.5+lex/lez*${FOV_SCALE})' -separate +channel "${sphere_lutxFilename}"`;

  // Y-LUT: identical formula with yy / ley.
  const cmdLutY = `convert -size ${SPHERE_SIZE}x${SPHERE_SIZE} xc: -channel R -fx '${lutShared}; ley=2*yy*(1.5*A-Bfac*(1+2*ct*A)); (r<=0)?0.5:(r>1)?(j/h):(0.5+ley/lez*${FOV_SCALE})' -separate +channel "${sphere_lutyFilename}"`;

  // Smooth anti-aliased circular alpha mask (slightly softer blur for cleaner edge)
  const cmdMask = `convert -size ${SPHERE_SIZE}x${SPHERE_SIZE} xc:black -fill white -draw "circle ${center},${center} ${center},2" -blur 0x1.5 "${sphere_maskFilename}"`;

  // Glass sphere lighting overlay (for HardLight composite).
  // Output: greyscale [0,1] where 0.5=neutral, <0.5 darkens, >0.5 brightens.
  //   fresnel = 0.5·(1 − r^5)  →  0.5 at centre, 0 at rim
  //   spec    = (N·H)^80        →  tight white specular at half-vector position
  //   combined = clamp(fresnel + spec, 0, 1)
  const cmdOverlay = `convert -size ${SPHERE_SIZE}x${SPHERE_SIZE} xc: -fx 'nx=2*(i+0.5)/w-1; ny=2*(j+0.5)/h-1; r2=nx*nx+ny*ny; nz=sqrt(max(0,1-r2)); spec=pow(max(0,nx*(-0.144)+ny*(-0.192)+nz*0.971),80); fresnel=0.5*(1-pow(r2,2.5)); (r2<=1)?min(1,fresnel+spec):(0)' "${sphere_overlayFilename}"`;

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
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(`<img src="${dataUri}" alt="Soratama Photo" />`);
      }
    } else {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Disposition', 'inline; filename="soratama.jpg"');
      res.status(200);
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
