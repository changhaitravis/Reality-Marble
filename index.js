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

//GLOBALS
const IS_GOOGLE_FUNCTION = true;
//https://stackoverflow.com/questions/47242340/how-to-perform-an-http-file-upload-using-express-on-cloud-functions-for-firebase/47603055#47603055

// [START functions_imagemagick_setup]
const exec = require('child_process').exec,
fs = require('fs'),
path = require('path'),
os = require('os'),
util = require('util'),
Busboy = require('busboy'),
formidable = require('formidable');

// [END functions_imagemagick_setup]

// [START functions_imagemagick_analyze]

/*
 * Create multipart parser to parse given request
 */

// Soratamafies images
exports.soratamafy = (req, res) => {
    //res.header('Content-Type','application/json');
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');

    //respond to CORS preflight requests
    if (req.method == 'OPTIONS') {
        res.status(204).send('');
    }
    
    if (req.method.toLowerCase() === 'post'){
        
        if(IS_GOOGLE_FUNCTION){
                const busboy = new Busboy({ headers: req.headers });
                // This object will accumulate all the uploaded files, keyed by their name
                var upload = null;

                // This callback will be invoked for each file uploaded
                busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
                    console.log(`File [${fieldname}] filename: ${filename}, encoding: ${encoding}, mimetype: ${mimetype}`);
                    // Note that os.tmpdir() is an in-memory file system, so should only 
                    // be used for files small enough to fit in memory.
                    const filepath = path.join(os.tmpdir(), filename);
                    upload = { path: filepath, name: filename }
                    console.log(util.inspect(upload))
                    console.log(`Saving '${fieldname}' to ${filepath}`);
                    file.pipe(fs.createWriteStream(filepath));
                });

                // This callback will be invoked after all uploaded files are saved.
                busboy.on('finish', () => {
                    console.log("busboy finished");
                    if(upload){
                        soratamafyImage(upload, res, req.query.base64 !== undefined);
                    }else{
                        res.end();
                    }
        //             for (const name in uploads) {
        //                 const upload = uploads[name];
        //                 
        //                 //const file = upload.file;
        //                 //res.write(`${file}\n`);
        //                 //fs.unlinkSync(file);
        //             }
                    
                });

                // The raw bytes of the upload will be in req.rawBody.  Send it to busboy, and get
                // a callback when it's finished.
                if(req.rawBody){
                    busboy.end(req.rawBody);
                }else{
                    busboy.end();
                }
        }else{
            var form = new formidable.IncomingForm();
            form.parse(req, function(err, fields, files) {
                //res.writeHead(200, {'content-type': 'image/png'});
                //res.write('received upload:\n\n');
                
                    console.log(util.inspect({errors: err, fields: fields, files: files}));
                    if(err){
                        res.end("encountered an error: " + err);
                        return;
                    }
                    if(!files || !files.upload){
                        res.end("no files uploaded...");
                        return;
                    }
                
                var file = files.upload;
                
                soratamafyImage(
                    file, res, req.query.base64 !== undefined
                );
                //res.end(util.inspect({errors: err, fields: fields, files: files}));
            });
            
            //form.on('progress', function(bytesReceived, bytesExpected) {
                //For use with upload progress bar.
            //});
        }
    }
  return;
};
// [END functions_imagemagick_analyze]

// [START functions_imagemagick_blur]
// Blurs the given file using ImageMagick.
function soratamafyImage (file, res, isBase64) {
    console.log(file);
    if(!file){
        res.end("no files uploaded...");
        return;
    }
  const tempLocalFilename = `${file.path}`;
  const blurredBgFileName = `${os.tmpdir()}/blurred_${file.name}`;
  const marbleFileName = `${os.tmpdir()}/sphered_${file.name}.png`;//needs to be png for transparency
  const sphere_maskFilename = `${os.tmpdir()}/sphere_mask.png`;
  const sphere_overlayFilename = `${os.tmpdir()}/sphere_overlay.png`;
  const sphere_lutxFilename = `${os.tmpdir()}/sphere_lutx.png`;
  const sphere_lutyFilename = `${os.tmpdir()}/sphere_luty.png`;
  
  // Download file from bucket.
//   return file.download({ destination: tempLocalFilename })
//     .catch((err) => {
//       console.error('Failed to download file.', err);
//       return Promise.reject(err);
//     })
//     .then(() => {
        console.log(`Image ${file.name} has been downloaded to ${tempLocalFilename}.`);
        
        var makeSphereMaps;
        
        //check if sphere maps not_exists
        if(fs.existsSync(sphere_maskFilename) && fs.existsSync(sphere_overlayFilename) && fs.existsSync(sphere_lutxFilename) && fs.existsSync(sphere_lutyFilename)){
            makeSphereMaps = Promise.resolve("sphere maps already exist");
        }else{
            //if any is missing then create all
            makeSphereMaps = new Promise((resolve, reject) => {
                exec(`convert -size 400x400 xc: -channel R -fx 'yy=(j+.5)/h-.5; (i/w-.5)/acos(3.14*yy^2)+.5' -separate +channel "${sphere_lutxFilename}" &&
                    convert "${sphere_lutxFilename}" -rotate 90 "${sphere_lutyFilename}" && 
                    convert -size 400x400 xc:black -fill white -draw 'circle 198,198 198,0' "${sphere_maskFilename}" &&
                    convert "${sphere_maskFilename}" \\( +clone -blur 0x20 -shade 110x21.7 -contrast-stretch 0% +sigmoidal-contrast 6x50% -fill grey50 -colorize 10%  \\) -composite "${sphere_overlayFilename}"`, 
                    {stdio: 'ignore'}, (err, stdout) => {
                        if (err) {
                            console.error('Failed to create sphere maps.', err);
                            reject(err);
                        } else {
                            console.log("Successfully created sphere maps");
                            resolve(stdout);
                        }
                });
            })
        }
//     })
    makeSphereMaps.then(() => {
      // Create marble
      return new Promise((resolve, reject) => {
        exec(`convert "${tempLocalFilename}" -resize 400x400^ \\
        -gravity Center -crop 400x400+0+0 +repage \\
        "${sphere_lutxFilename}" "${sphere_lutyFilename}" -fx 'p{ u[1]*w, u[2]*h }' \\
          "${sphere_overlayFilename}"  -compose HardLight  -composite \\
          "${sphere_maskFilename}" -alpha off -compose CopyOpacity -composite \\
          "${marbleFileName}"`, { stdio: 'ignore' }, (err, stdout) => {
          if (err) {
            console.error('Failed to create reality marble.', err);
            reject(err);
          } else {
            console.log("Successfully created reality marble");
            resolve(stdout);
          }
        });
      });
    })
    .then(() => {
      // Blur and flip the image using ImageMagick.
      return new Promise((resolve, reject) => {
        exec(`convert "${tempLocalFilename}" -resize 2048x1536^ -gravity Center -crop 1600x1200+0+0 +repage -flip -flop -channel RGBA -blur 0x24 "${blurredBgFileName}"`, { stdio: 'ignore' }, (err, stdout) => {
          if (err) {
            console.error('Failed to blur image.', err);
            reject(err);
          } else {
            console.log("Successfully blurred image");
            resolve(stdout);
          }
        });
      });
    })
    .then(() => {
      // Overlay the bg and the marble using ImageMagick.
      return new Promise((resolve, reject) => {
        exec(`convert "${blurredBgFileName}" "${marbleFileName}" -gravity center -composite -format jpg -quality 90 "${tempLocalFilename}" `, { stdio: 'ignore' }, (err, stdout) => {
          if (err) {
            console.error('Failed to overlay image.', err);
            reject(err);
          } else {
            console.log("Successfully overlaid image");
            resolve(stdout);
          }
        });
      });
    })
    .then(() => {
      console.log(`Image ${file.name} has been soratamafied.`);
    if(isBase64){
        //res.setEncoding('base64');
        return new Promise((resolve, reject) => {
            
            fs.readFile(tempLocalFilename, (err, data) =>
                {
                    if (err) {
                        reject("problems reading file for converting to base64");
                    }
                    var b64uri = "data:image/jpeg;base64," + Buffer(data).toString('base64');
                    res.end('<img src="' + b64uri + '" />');
                    resolve("successfully returned base64 image");
//                     res.on('end', () => {
//                         console.log(body);
//                         return res.json({result: body, status: 'success'});
//                         resolve("success, probably");
//                     });
                }
            );
            
        });
        
    }else{    
        res.writeHead(200, {'Content-Type': 'image/jpeg' });
        return new Promise((resolve, reject) => {
            var rs = fs.createReadStream(tempLocalFilename);
            //if(isBase64){ rs.pipe(new Base64Encode()) }
            rs.pipe(res);
            rs.on('finish', () => {
              resolve("success!");
            })
            rs.on('error', () => {
              reject("welp.");
            })
        });
     }
    //Promise.resolve();
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
