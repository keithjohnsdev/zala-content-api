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

router.get("/contentStatus", (req, res) => {
  const status = {
    Status: "Content Routes Working",
  };

  res.send(status);
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
      const {
        creator_user_uuid,
        title,
        description,
        creator_name,
        creator_profile_url,
        status,
        accessibility,
        tags,
        publish_time,
        org_id,
        zala_library,
      } = req.body;
      const videoFile = req.files["video"][0];
      const thumbnailFile = req.files["thumbnail"][0];

      // Parse the JSON arrays
      const parsedTags = JSON.parse(tags);
      const parsedAccessibility = JSON.parse(accessibility); // Parse accessibility as JSON

      // Handle empty string
      const publishTime = publish_time === "" ? null : publish_time;

      // Get filenames for video and thumbnail
      const videoFilename = videoFile.originalname;
      const thumbnailFilename = thumbnailFile.originalname;

      // Upload video file to S3
      const videoParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: `videos/${creator_user_uuid}/${videoFilename}`,
        Body: videoFile.buffer,
        ContentType: videoFile.mimetype,
      };
      const videoUploadResult = await s3.upload(videoParams).promise();

      // Upload thumbnail file to S3
      const thumbnailParams = {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: `thumbnails/${creator_user_uuid}/${thumbnailFilename}`,
        Body: thumbnailFile.buffer,
        ContentType: thumbnailFile.mimetype,
      };
      const thumbnailUploadResult = await s3.upload(thumbnailParams).promise();

      // Save content metadata to the database
      await db.query(
        "INSERT INTO content (title, description, s3_video_url, s3_thumbnail, creator_name, creator_profile_url, creator_user_uuid, status, accessibility, tags, publish_time, org_id, zala_library) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
        [
          title,
          description,
          videoUploadResult.Location,
          thumbnailUploadResult.Location,
          creator_name,
          creator_profile_url,
          creator_user_uuid,
          status,
          parsedAccessibility, // Store parsedAccessibility as a JSON array
          parsedTags, // Use the parsed JSON array of tags
          publishTime,
          org_id,
          zala_library,
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
      `SELECT * FROM content WHERE creator_user_uuid = $1`,
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

// Route for deleting content
router.delete("/content/delete/:videoId", async (req, res) => {
  try {
    const { videoId } = req.params; // Get the videoId from the request parameters

    // Fetch content metadata including S3 URLs from the database
    const queryResult = await db.query(
      "SELECT s3_video_url, s3_thumbnail FROM content WHERE content_id = $1",
      [videoId]
    );

    // Extract S3 URLs from the query result
    const { s3_video_url, s3_thumbnail } = queryResult.rows[0];

    // Extract S3 keys from URLs
    const videoKey = extractS3Key(s3_video_url);
    const thumbnailKey = extractS3Key(s3_thumbnail);

    // Delete content metadata from the database
    await db.query("DELETE FROM content WHERE content_id = $1", [videoId]);

    // Delete video and thumbnail files from S3
    const deletePromises = Promise.all([
      s3
        .deleteObject({ Bucket: process.env.S3_BUCKET_NAME, Key: videoKey })
        .promise(),
      s3
        .deleteObject({ Bucket: process.env.S3_BUCKET_NAME, Key: thumbnailKey })
        .promise(),
    ]);

    const deleteResults = await deletePromises;
    console.log(deleteResults);

    res.status(200).json({ message: "Content deleted successfully" });
  } catch (error) {
    console.error("Error deleting content:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Function to extract S3 key from URL
function extractS3Key(url) {
  // Split the URL by '/'
  const parts = url.split("/");
  // The key is the portion after the bucket name
  // Join the parts starting from index 3
  return parts.slice(3).join("/");
}

// Route for fetching a single content item by content ID
router.get("/content/id/:contentId", async (req, res) => {
  try {
    const { contentId } = req.params; // Extract the contentId from the route parameters

    // Fetch the content from the database for the given contentId
    const queryResult = await db.query(
      `SELECT * FROM content WHERE content_id = $1`,
      [contentId]
    );

    // Check if the content exists
    if (queryResult.rows.length === 0) {
      return res.status(404).json({ error: "Content not found" });
    }

    // Extract the content data from the query result
    const contentData = queryResult.rows[0];

    res.status(200).json(contentData);
  } catch (error) {
    console.error("Error fetching content:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Route for editing existing content
router.put(
  "/content/edit/:contentId",
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { contentId } = req.params; // Extract contentId from route params
      const {
        creator_user_uuid,
        title,
        description,
        creator_name,
        creator_profile_url,
        status,
        accessibility,
        tags,
        publish_time,
        org_id,
        zala_library,
        new_video,
        new_thumbnail,
      } = req.body;
      const videoFile = req.files["video"] ? req.files["video"][0] : false;
      const thumbnailFile = req.files["thumbnail"]
        ? req.files["thumbnail"][0]
        : false;

      // Parse the JSON arrays
      const parsedTags = JSON.parse(tags);
      const parsedAccessibility = JSON.parse(accessibility); // Parse accessibility as JSON

      // Handle empty string
      const publishTime = publish_time === "" ? null : publish_time;

      // Fetch existing content data from the database
      const existingContent = await db.query(
        `SELECT s3_video_url, s3_thumbnail FROM content WHERE content_id = $1`,
        [contentId]
      );

      // Extract existing S3 URLs
      const { s3_video_url, s3_thumbnail } = existingContent.rows[0];

      // Handle video upload if new_video is true and there is a videoFile
      let newVideoUrl = s3_video_url;
      if (new_video === "true" && videoFile) {
        // Upload new video file to S3
        const videoParams = {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: `videos/${creator_user_uuid}/${videoFile.originalname}`, // Use contentId for S3 key
          Body: videoFile.buffer,
          ContentType: videoFile.mimetype,
        };
        const videoUploadResult = await s3.upload(videoParams).promise();
        newVideoUrl = videoUploadResult.Location;

        // Delete previous video from S3
        await s3
          .deleteObject({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: s3_video_url.split("/").slice(-2).join("/"), // Extract video key from URL
          })
          .promise();
      }

      // Handle thumbnail upload if new_thumbnail is true
      let newThumbnailUrl = s3_thumbnail;
      if (new_thumbnail === "true" && thumbnailFile) {
        // Upload new thumbnail file to S3
        const thumbnailParams = {
          Bucket: process.env.S3_BUCKET_NAME,
          Key: `thumbnails/${creator_user_uuid}/${thumbnailFile.originalname}`, // Use contentId for S3 key
          Body: thumbnailFile.buffer,
          ContentType: thumbnailFile.mimetype,
        };
        const thumbnailUploadResult = await s3
          .upload(thumbnailParams)
          .promise();
        newThumbnailUrl = thumbnailUploadResult.Location;

        // Delete previous thumbnail from S3
        await s3
          .deleteObject({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: s3_thumbnail.split("/").slice(-2).join("/"), // Extract thumbnail key from URL
          })
          .promise();
      }

      // Update content metadata in the database
      await db.query(
        `UPDATE content 
       SET title = $1, description = $2, s3_video_url = $3, s3_thumbnail = $4, 
           creator_name = $5, creator_profile_url = $6, status = $7, 
           tags = $8, publish_time = $9, org_id = $10, zala_library = $11, accessibility = $12
       WHERE content_id = $13`,
        [
          title,
          description,
          newVideoUrl,
          newThumbnailUrl,
          creator_name,
          creator_profile_url,
          status,
          parsedTags,
          publishTime,
          org_id,
          zala_library,
          parsedAccessibility,
          contentId, // Update the content with the specified contentId
        ]
      );

      res.status(200).json({ message: "Content updated successfully" });
    } catch (error) {
      console.error("Error updating content:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
