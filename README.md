# "Reality Marble" Web App
- For making digital soratama images from Node.js Imagemagick
- Compatible with Google Functions through `IS_GOOGLE_FUNCTION` flag and fact that Google Functions container has ImageMagick Installed
- Returns images in Base64 to achieve interactivity and async without persisting the images on the server.
- Images generated during the course of the run are delete immediately afterwards


Local development outside of Cloud Functions Emulator:
`node server.js` runs on localhost:3000

Also it's fairly slow on google cloud functions. Larger source images can take up to 2 minutes or so.
