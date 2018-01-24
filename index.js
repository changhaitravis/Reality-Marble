/**
 * Copyright 2017, Google, Inc.
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

// [START functions_imagemagick_setup]
const exec = require('child_process').exec;
const fs = require('fs');
const path = require('path');
const storage = require('@google-cloud/storage')();
// [END functions_imagemagick_setup]

// [START functions_imagemagick_analyze]
// Blurs uploaded images that are flagged as Adult or Violence.
exports.soratamafyImages = (event) => {
  const object = event.data;

  // Exit if this is a deletion or a deploy event.
  if (object.resourceState === 'not_exists') {
    console.log('This is a deletion event.');
    return;
  } else if (!object.name) {
    console.log('This is a deploy event.');
    return;
  }

  const file = storage.bucket(object.bucket).file(object.name);
  
  if (file.name.indexOf('soratama/') !== -1){
      console.log("this has already been processed");
      return;
  }

  console.log(`Blurring and flipping ${file.name}.`);

  return soratamafyImage(file);
};
// [END functions_imagemagick_analyze]

// [START functions_imagemagick_blur]
// Blurs the given file using ImageMagick.
function soratamafyImage (file) {
  const tempLocalFilename = `/tmp/${path.parse(file.name).base}`;
  const blurredBgFileName = `/tmp/blurred_${path.parse(file.name).base}`;
  const marbleFileName = `/tmp/sphered_${path.parse(file.name).base}.png`;//needs to be png for transparency
  const sphere_maskFilename = `/tmp/sphere_mask.png`;
  const sphere_overlayFilename = `/tmp/sphere_overlay.png`;
  const sphere_lutxFilename = `/tmp/sphere_lutx.png`;
  const sphere_lutyFilename = `/tmp/sphere_luty.png`;
  
  // Download file from bucket.
  return file.download({ destination: tempLocalFilename })
    .catch((err) => {
      console.error('Failed to download file.', err);
      return Promise.reject(err);
    })
    .then(() => {
        console.log(`Image ${file.name} has been downloaded to ${tempLocalFilename}.`);
        
        //check if sphere maps not_exists
        if(fs.existsSync(sphere_maskFilename) && fs.existsSync(sphere_overlayFilename) && fs.existsSync(sphere_lutxFilename) && fs.existsSync(sphere_lutyFilename)){
            return Promise.resolve("sphere maps already exist");
        }
        
        //if any is missing then create all
        return new Promise((resolve, reject) => {
            exec(`convert -size 200x200 xc: -channel R -fx 'yy=(j+.5)/h-.5; (i/w-.5)/acos(3.14*yy^2)+.5' -separate  +channel  ${sphere_lutxFilename} &&
                convert ${sphere_lutxFilename} -rotate 90 ${sphere_lutyFilename} && 
                convert -size 200x200 xc:black -fill white -draw 'circle 99,99 99,0' ${sphere_maskFilename} &&
                convert ${sphere_maskFilename} \\( +clone -blur 0x20 -shade 110x21.7 -contrast-stretch 0% +sigmoidal-contrast 6x50% -fill grey50 -colorize 10%  \\) -composite ${sphere_overlayFilename}`, 
                 {stdio: 'ignore'}, (err, stdout) => {
                    if (err) {
                        console.error('Failed to create sphere maps.', err);
                        reject(err);
                    } else {
                        resolve(stdout);
                    }
            });
        });
    })
    .then(() => {
      // Create marble
      return new Promise((resolve, reject) => {
        exec(`convert ${tempLocalFilename} -resize 200x200^ \\
        -gravity Center -crop 200x200+0+0 +repage \\
        ${sphere_lutxFilename} ${sphere_lutyFilename} -fx 'p{ u[1]*w, u[2]*h }' \\
          ${sphere_overlayFilename}   -compose HardLight  -composite \\
          ${sphere_maskFilename} -alpha off -compose CopyOpacity -composite \\
          ${marbleFileName}`, { stdio: 'ignore' }, (err, stdout) => {
          if (err) {
            console.error('Failed to create reality marble.', err);
            reject(err);
          } else {
            resolve(stdout);
          }
        });
      });
    })
    .then(() => {
      // Blur and flip the image using ImageMagick.
      return new Promise((resolve, reject) => {
        exec(`convert ${tempLocalFilename} -resize 1280x960^ -gravity Center -crop 1024x768+0+0 +repage -flip -flop -channel RGBA -blur 0x24 ${blurredBgFileName}`, { stdio: 'ignore' }, (err, stdout) => {
          if (err) {
            console.error('Failed to blur image.', err);
            reject(err);
          } else {
            resolve(stdout);
          }
        });
      });
    })
    .then(() => {
      // Overlay the bg and the marble using ImageMagick.
      return new Promise((resolve, reject) => {
        exec(`convert ${blurredBgFileName} ${marbleFileName} -gravity center -composite -format jpg -quality 90 ${tempLocalFilename} `, { stdio: 'ignore' }, (err, stdout) => {
          if (err) {
            console.error('Failed to overlay image.', err);
            reject(err);
          } else {
            resolve(stdout);
          }
        });
      });
    })
    .then(() => {
      console.log(`Image ${file.name} has been soratamafied.`);

      // Upload the Blurred image back into the bucket.
      return file.bucket.upload(tempLocalFilename, { destination: "soratama/" + file.name })
        .catch((err) => {
          console.error('Failed to upload blurred image.', err);
          return Promise.reject(err);
        });
    })
    .then(() => {
      console.log(`Blurred image has been uploaded to ${file.name}.`);

      // Delete the temporary file.
      var origDel = new Promise((resolve, reject) => {
        fs.unlink(tempLocalFilename, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      
      var bgDel = new Promise((resolve, reject) => {
        fs.unlink(blurredBgFileName, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      
      var marbleDel = new Promise((resolve, reject) => {
        fs.unlink(marbleFileName, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      
      return Promise.all([origDel, bgDel, marbleDel]);
    });
}
// [END functions_imagemagick_blur]
