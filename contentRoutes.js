const express = require("express");
const multer = require("multer");
const { S3 } = require("aws-sdk"); // Import only the S3 module
const { v4: uuidv4 } = require("uuid");
const db = require("./db");

const router = express.Router();

// Configure multer for handling multipart/form-data
const upload = multer();

// Configure AWS S3 client
const s3 = new S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

// Route for creating new content
router.post(
  "/content/create",
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { creator_user_uuid, title, focus, description, creator_name, creator_profile_url } = req.body;
      const videoFile = req.files["video"][0];
      const thumbnailFile = req.files["thumbnail"][0];

      // Generate unique filenames for video and thumbnail
      const videoFilename = uuidv4() + "-" + videoFile.originalname;
      const thumbnailFilename = uuidv4() + "-" + thumbnailFile.originalname;

      // Upload video file to S3
      const videoParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: `videos/${creator_user_uuid}/${videoFilename}`, // Use creator_user_uuid for S3 key
        Body: videoFile.buffer,
        ContentType: videoFile.mimetype,
      };
      const videoUploadResult = await s3.upload(videoParams).promise();

      // Upload thumbnail file to S3
      const thumbnailParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: `thumbnails/${creator_user_uuid}/${thumbnailFilename}`, // Use creator_user_uuid for S3 key
        Body: thumbnailFile.buffer,
        ContentType: thumbnailFile.mimetype,
      };
      const thumbnailUploadResult = await s3.upload(thumbnailParams).promise();

      // Save content metadata to the database
      await db.query(
        "INSERT INTO videos (title, focus, description, s3_video_url, s3_thumbnail, creator_name, creator_profile_url, creator_user_uuid) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [
          title,
          focus,
          description,
          videoUploadResult.Location,
          thumbnailUploadResult.Location,
          creator_name,
          creator_profile_url,
          creator_user_uuid
        ]
      );

      res.status(201).json({ message: "Content created successfully" });
    } catch (error) {
      console.error("Error creating content:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Route for listing content by creator ID
router.get("/content/:creatorId", async (req, res) => {
  try {
    const { creatorId } = req.params; // Use req.params instead of req.query

    // Fetch content from the database for the given creatorId
    const queryResult = await db.query(
      `SELECT video_id, title, description, focus, s3_video_url, s3_thumbnail, created_at, updated_at, status,
       creator_user_uuid, creator_name, creator_profile_url
       FROM videos
       WHERE creator_user_uuid = $1`,
      [creatorId] // Update the parameter name to creatorId
    );

    // Extract the rows from the query result
    const contentList = queryResult.rows;

    res.status(200).json(contentList);
  } catch (error) {
    console.error("Error fetching content:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});



router.get("/contentStatus", (req, res) => {
  const status = {
    Status: "Content Routes Working",
  };

  res.send(status);
});

module.exports = router;
