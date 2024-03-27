const express = require('express');
const multer = require('multer');
const aws = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const router = express.Router();

// Configure multer for handling multipart/form-data
const upload = multer();

// Configure AWS SDK
const s3 = new aws.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

// Route for creating new content
router.post('/createContent', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), async (req, res) => {
  try {
    const { title, focus, description } = req.body;
    const videoFile = req.files['video'][0];
    const thumbnailFile = req.files['thumbnail'][0];

    // Generate unique filenames for video and thumbnail
    const videoFilename = uuidv4() + '-' + videoFile.originalname;
    const thumbnailFilename = uuidv4() + '-' + thumbnailFile.originalname;

    // Upload video file to S3
    const videoParams = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: `videos/${videoFilename}`,
      Body: videoFile.buffer,
      ContentType: videoFile.mimetype
    };
    const videoUploadResult = await s3.upload(videoParams).promise();

    // Upload thumbnail file to S3
    const thumbnailParams = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: `thumbnails/${thumbnailFilename}`,
      Body: thumbnailFile.buffer,
      ContentType: thumbnailFile.mimetype
    };
    const thumbnailUploadResult = await s3.upload(thumbnailParams).promise();

    // Save content metadata to your database
    await db.query(
      'INSERT INTO videos (title, focus, description, s3_video_url, s3_thumbnail) VALUES ($1, $2, $3, $4, $5)',
      [title, focus, description, videoUploadResult.Location, thumbnailUploadResult.Location]
    );

    res.status(201).json({ message: 'Content created successfully' });
  } catch (error) {
    console.error('Error creating content:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/contentRouteStatus', (req, res) => {
  const status = {
    Status: "Content Routes Working",
  };

  res.send(status);
})

module.exports = router;
