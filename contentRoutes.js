const express = require("express");
const multer = require("multer");
const { S3 } = require("aws-sdk"); // Import only the S3 module
const { v4: uuidv4, parse } = require("uuid");
const db = require("./db");

const router = express.Router();

// Configure multer for handling multipart/form-data
const upload = multer();

// Configure AWS S3 client
const s3 = new S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

function handleFalsyValues(req, res, next) {
    console.log("handle Falsies ran");
    for (const key in req.body) {
        if (
            req.body[key] === undefined ||
            req.body[key] === "undefined" ||
            req.body[key] === "null"
        ) {
            req.body[key] = null;
        } else if (req.body[key] === "false") {
            req.body[key] = false;
        } else if (
            typeof req.body[key] === "object" &&
            req.body[key] !== null
        ) {
            req.body[key] = handleNestedFalsyValues(req.body[key]);
        }
    }

    function handleNestedFalsyValues(obj) {
        console.log("nested object in falsy function", obj);
        for (const key in obj) {
            if (
                obj[key] === undefined ||
                obj[key] === "undefined" ||
                obj[key] === "null"
            ) {
                obj[key] = null;
            } else if (obj[key] === "false") {
                obj[key] = false;
            } else if (typeof req.body[key] === "object" && obj[key] !== null) {
                obj[key] = handleNestedFalsyValues(obj[key]);
            }

            return obj;
        }
    }
    next();
}

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
    handleFalsyValues,
    async (req, res) => {
        try {
            const {
                creator_user_uuid,
                title,
                description,
                description_markup,
                creator_name,
                creator_profile_url,
                scheduled,
                accessibility,
                tags,
                scheduled_time,
                org_id,
                zala_library,
                zala_public,
            } = req.body;
            const videoFile = req.files["video"][0];
            const thumbnailFile = req.files["thumbnail"][0];

            // Parse the JSON arrays
            const parsedTags = JSON.parse(tags);
            const parsedAccessibility = JSON.parse(accessibility); // Parse accessibility as JSON
            console.log(parsedAccessibility);

            // Handle empty undefined boolean variables
            const scheduledValue = scheduled === "true";
            const zalaPublic = zala_public === "true";
            console.log(zalaPublic);

            // Handle undefined or empty string values for scheduled_time
            const scheduledTime = scheduledValue ? scheduled_time : null;

            // Get filenames for video and thumbnail
            const videoFilename = videoFile.originalname;
            const thumbnailFilename = thumbnailFile.originalname;

            // Upload video file to S3
            const videoParams = {
                Bucket: process.env.S3_BUCKET_NAME,
                Key: `videos/${creator_user_uuid}/${uuidv4()}-${videoFilename}`,
                Body: videoFile.buffer,
                ContentType: videoFile.mimetype,
            };
            const videoUploadResult = await s3.upload(videoParams).promise();

            // Upload thumbnail file to S3
            const thumbnailParams = {
                Bucket: process.env.S3_BUCKET_NAME,
                Key: `thumbnails/${creator_user_uuid}/${uuidv4()}-${thumbnailFilename}`,
                Body: thumbnailFile.buffer,
                ContentType: thumbnailFile.mimetype,
            };
            const thumbnailUploadResult = await s3
                .upload(thumbnailParams)
                .promise();

            // Save content metadata to the database
            const result = await db.query(
                "INSERT INTO content (title, description, s3_video_url, s3_thumbnail, creator_name, creator_profile_url, creator_user_uuid, scheduled, accessibility, tags, scheduled_time, org_id, zala_library, description_markup, zala_public) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING content_id",
                [
                    title,
                    description,
                    videoUploadResult.Location,
                    thumbnailUploadResult.Location,
                    creator_name,
                    creator_profile_url,
                    creator_user_uuid,
                    scheduledValue,
                    parsedAccessibility,
                    parsedTags,
                    scheduledTime,
                    org_id,
                    zala_library,
                    description_markup,
                    zalaPublic,
                ]
            );

            const contentId = result.rows[0].content_id;

            let postId;

            if (scheduledValue) {
                try {
                    // Begin a transaction
                    await db.query("BEGIN");

                    // Insert a new row into the posts table and retrieve the generated post_id
                    const insertedPost = await db.query(
                        `INSERT INTO posts (
                content_id, 
                post_time, 
                creator_user_uuid, 
                scheduled, 
                accessibility,
                title,
                description,
                s3_video_url,
                s3_thumbnail,
                creator_name,
                creator_profile_url,
                tags,
                org_id,
                zala_library,
                description_markup,
                zala_public
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING post_id`,
                        [
                            contentId,
                            scheduledTime,
                            creator_user_uuid,
                            true,
                            parsedAccessibility,
                            title,
                            description,
                            videoUploadResult.Location,
                            thumbnailUploadResult.Location,
                            creator_name,
                            creator_profile_url,
                            parsedTags,
                            org_id,
                            zala_library,
                            description_markup,
                            zalaPublic,
                        ]
                    );

                    postId = insertedPost.rows[0].post_id;

                    // Append the post_id to the "posts" column of the content table
                    await db.query(
                        `UPDATE content SET posts = array_append(posts, $1) WHERE content_id = $2`,
                        [postId, contentId]
                    );

                    // Commit the transaction
                    await db.query("COMMIT");
                } catch (error) {
                    // Rollback the transaction if an error occurs
                    await db.query("ROLLBACK");
                    throw error;
                }
            }

            if (zala_library === "true") {
                try {
                    // Insert a new row into the zala_library table
                    await db.query(
                        `INSERT INTO zala_library (
                    content_id, 
                    title, 
                    description, 
                    s3_video_url, 
                    s3_thumbnail, 
                    created_at, 
                    updated_at, 
                    creator_user_uuid, 
                    creator_name, 
                    creator_profile_url, 
                    tags, 
                    org_id, 
                    description_markup
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                        [
                            contentId,
                            title,
                            description,
                            videoUploadResult.Location,
                            thumbnailUploadResult.Location,
                            new Date(),
                            new Date(),
                            creator_user_uuid,
                            creator_name,
                            creator_profile_url,
                            parsedTags,
                            org_id,
                            description_markup,
                        ]
                    );
                } catch (error) {
                    console.error(
                        "Error inserting into zala_library table:",
                        error
                    );
                    throw error;
                }
            }

            // Check if "public" exists in parsedAccessibility
            const isPublic = zalaPublic;

            // If "public" exists, insert into zala_public
            // if (isPublic) {
            //   try {
            //     // Check if content already exists in zala_public table
            //     const existingContent = await db.query(
            //       "SELECT * FROM zala_public WHERE title = $1 AND description = $2",
            //       [title, description]
            //     );

            //     if (existingContent.rows.length === 0) {
            //       // Insert new row into zala_public table
            //       await db.query(
            //         `INSERT INTO zala_public (
            //             title,
            //             description,
            //             s3_video_url,
            //             s3_thumbnail,
            //             created_at,
            //             updated_at,
            //             creator_user_uuid,
            //             creator_name,
            //             creator_profile_url,
            //             tags,
            //             org_id,
            //             description_markup,
            //             content_id
            //         )
            //         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            //         [
            //           title,
            //           description,
            //           videoUploadResult.Location,
            //           thumbnailUploadResult.Location,
            //           new Date(),
            //           new Date(),
            //           creator_user_uuid,
            //           creator_name,
            //           creator_profile_url,
            //           parsedTags,
            //           org_id,
            //           description_markup,
            //           contentId,
            //         ]
            //       );
            //     }
            //   } catch (error) {
            //     console.error("Error inserting into zala_public table:", error);
            //     throw error;
            //   }
            // }

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
        const { creatorId } = req.params;

        // Fetch content from the database for the given creatorId and sort by content_id descending
        const queryResult = await db.query(
            `SELECT * FROM content WHERE creator_user_uuid = $1 ORDER BY content_id DESC`,
            [creatorId]
        );

        // Extract the rows from the query result
        const contentList = queryResult.rows;

        res.status(200).json(contentList);
    } catch (error) {
        console.error("Error fetching content:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Route for listing content by superusers
router.post("/content/bySuperusers", upload.none(), async (req, res) => {
    try {
        const { creatorIds } = req.body;

        // Parse JSON string to array if needed
        const parsedIds =
            typeof creatorIds === "string"
                ? JSON.parse(creatorIds)
                : creatorIds;

        // Ensure parsedIds is an array
        if (!Array.isArray(parsedIds)) {
            return res
                .status(400)
                .json({ error: "creatorIds must be an array" });
        }

        // Fetch published content from the database for the given creatorIds
        const queryResult = await db.query(
            `SELECT * FROM content 
      WHERE creator_user_uuid IN (${parsedIds
          .map((id, index) => `$${index + 1}`)
          .join(", ")})
      AND scheduled = false
      AND scheduled_time < NOW()
      AND array_length(posts, 1) > 0`,
            parsedIds
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
router.delete("/content/delete/:contentId", async (req, res) => {
    try {
        const { contentId } = req.params; // Get the videoId from the request parameters

        // Fetch content metadata including S3 URLs from the database
        const queryResult = await db.query(
            "SELECT s3_video_url, s3_thumbnail FROM content WHERE content_id = $1",
            [contentId]
        );

        // Extract S3 URLs from the query result
        const { s3_video_url, s3_thumbnail } = queryResult.rows[0];

        // Extract S3 keys from URLs
        const videoKey = extractS3Key(s3_video_url);
        const thumbnailKey = extractS3Key(s3_thumbnail);

        // Delete content metadata from the content table
        await db.query("DELETE FROM content WHERE content_id = $1", [
            contentId,
        ]);

        // Delete related entries from the posts table
        await db.query("DELETE FROM posts WHERE content_id = $1", [contentId]);

        // Delete related entry from the zala_library table
        await db.query("DELETE FROM zala_library WHERE content_id = $1", [
            contentId,
        ]);

        // Delete related entry from the zala_public table (added a db trigger to keep it updated with posts instead)
        // await db.query("DELETE FROM zala_public WHERE content_id = $1", [contentId]);

        // Delete video and thumbnail files from S3
        const deletePromises = Promise.all([
            s3
                .deleteObject({
                    Bucket: process.env.S3_BUCKET_NAME,
                    Key: videoKey,
                })
                .promise(),
            s3
                .deleteObject({
                    Bucket: process.env.S3_BUCKET_NAME,
                    Key: thumbnailKey,
                })
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

        // Transform the accessibility array into an object
        const accessibilityObject = contentData.accessibility.reduce(
            (acc, accessibilityLevel) => {
                acc[accessibilityLevel] = true;
                return acc;
            },
            {}
        );

        // Replace the accessibility array with the transformed object
        contentData.accessibility = accessibilityObject;

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
    handleFalsyValues,
    async (req, res) => {
        try {
            const { contentId } = req.params; // Extract contentId from route params
            let {
                creator_user_uuid,
                creator_name,
                creator_profile_url,
                org_id,
                title,
                description,
                description_markup,
                accessibility,
                tags,
                zala_library,
                zala_public,
            } = req.body;
            const videoFile = req.files["video"]
                ? req.files["video"][0]
                : false;
            const thumbnailFile = req.files["thumbnail"]
                ? req.files["thumbnail"][0]
                : false;

            console.log(req.user);

            // Parse the JSON arrays
            const parsedTags = JSON.parse(tags);
            const parsedAccessibility = JSON.parse(accessibility); // Parse accessibility as JSON

            // Fetch existing content data from the database
            const existingContent = await db.query(
                `SELECT s3_video_url, s3_thumbnail FROM content WHERE content_id = $1`,
                [contentId]
            );

            // Extract existing S3 URLs
            const { s3_video_url, s3_thumbnail } = existingContent.rows[0];

            // Handle video upload if videoFile is true and there is a videoFile
            let newVideoUrl = s3_video_url;
            if (videoFile) {
                // Upload new video file to S3
                const videoParams = {
                    Bucket: process.env.S3_BUCKET_NAME,
                    Key: `videos/${creator_user_uuid}/${uuidv4()}-${
                        videoFile.originalname
                    }`, // Use contentId for S3 key
                    Body: videoFile.buffer,
                    ContentType: videoFile.mimetype,
                };
                const videoUploadResult = await s3
                    .upload(videoParams)
                    .promise();
                newVideoUrl = videoUploadResult.Location;

                // Delete previous video from S3
                await s3
                    .deleteObject({
                        Bucket: process.env.S3_BUCKET_NAME,
                        Key: extractS3Key(s3_video_url), // Extract video key from URL
                    })
                    .promise();
            }

            // Handle thumbnail upload if thumbnailFile is true
            let newThumbnailUrl = s3_thumbnail;
            if (thumbnailFile) {
                // Upload new thumbnail file to S3
                const thumbnailParams = {
                    Bucket: process.env.S3_BUCKET_NAME,
                    Key: `thumbnails/${creator_user_uuid}/${uuidv4()}-${
                        thumbnailFile.originalname
                    }`, // Use contentId for S3 key
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
                        Key: extractS3Key(s3_thumbnail), // Extract thumbnail key from URL
                    })
                    .promise();
            }

            zala_library = zala_library === "true";
            zala_public = zala_public === "true";

            // Update content metadata in the database
            await db.query(
                `UPDATE content 
       SET title = $1, description = $2, description_markup = $3, s3_video_url = $4, s3_thumbnail = $5, 
           tags = $6, zala_library = $7, accessibility = $8, zala_public = $9,
           updated_at = NOW()
       WHERE content_id = $10`,
                [
                    title,
                    description,
                    description_markup,
                    newVideoUrl,
                    newThumbnailUrl,
                    parsedTags,
                    zala_library,
                    parsedAccessibility,
                    zala_public,
                    contentId, // Update the content with the specified contentId
                ]
            );

            if (zala_library) {
                const existingRows = await db.query(
                    "SELECT * FROM zala_library WHERE content_id = $1",
                    [contentId]
                );

                if (existingRows.rows.length === 0) {
                    try {
                        // Insert a new row into the zala_library table
                        await db.query(
                            `INSERT INTO zala_library (
                    content_id, 
                    title, 
                    description, 
                    s3_video_url, 
                    s3_thumbnail, 
                    created_at, 
                    updated_at, 
                    creator_user_uuid, 
                    creator_name, 
                    creator_profile_url, 
                    tags, 
                    org_id, 
                    description_markup
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                            [
                                contentId,
                                title,
                                description,
                                newVideoUrl,
                                newThumbnailUrl,
                                new Date(),
                                new Date(),
                                creator_user_uuid,
                                creator_name,
                                creator_profile_url,
                                parsedTags,
                                org_id,
                                description_markup,
                            ]
                        );
                    } catch (error) {
                        console.error(
                            "Error inserting into zala_library table:",
                            error
                        );
                        throw error;
                    }
                }
            } else {
                console.log("else block ran zala library");
                try {
                    // Delete the row from the zala_library table that matches the content_id
                    await db.query(
                        "DELETE FROM zala_library WHERE content_id = $1",
                        [contentId]
                    );
                } catch (error) {
                    console.error(
                        "Error deleting row from zala_library table:",
                        error
                    );
                    throw error;
                }
            }

            res.status(200).json({ message: "Content updated" });
        } catch (error) {
            console.error("Error updating content:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

// Route for scheduling content post
router.post(
    "/content/schedule/:contentId",
    upload.fields([]),
    async (req, res) => {
        try {
            const { contentId } = req.params;
            const { scheduled_time } = req.body;

            // Query the database to find the content by contentId
            const queryResult = await db.query(
                "SELECT * FROM content WHERE content_id = $1",
                [contentId]
            );

            // Check if content with the provided contentId exists
            if (queryResult.rows.length === 0) {
                return res.status(404).json({ error: "Content not found" });
            }

            // Handle empty time string
            let scheduledTime = null;
            if (!scheduled_time || scheduled_time === "") {
                return res
                    .status(400)
                    .json({ error: "Publish failed - date not provided" });
            }

            // Parse scheduled_time into a Date object
            console.log("parsing date string into date");
            const scheduledDate = new Date(scheduled_time);
            console.log(scheduledDate);

            // Compare scheduled_date with the current date
            if (scheduledDate <= new Date()) {
                return res.status(400).json({
                    error: "Publish failed - provided date not in the future",
                });
            }

            scheduledTime = scheduled_time;

            // Update the content to schedule it with the provided timestamp
            await db.query(
                "UPDATE content SET scheduled = $1, scheduled_time = $2 WHERE content_id = $3",
                [true, scheduledTime, contentId]
            );

            let postId;

            if (!queryResult.rows[0].scheduled) {
                try {
                    // Begin a transaction
                    await db.query("BEGIN");

                    // Insert a new row into the posts table and retrieve the generated post_id
                    const insertedPost = await db.query(
                        `INSERT INTO posts (
                  content_id, 
                  post_time, 
                  creator_user_uuid, 
                  scheduled, 
                  accessibility,
                  title,
                  description,
                  s3_video_url,
                  s3_thumbnail,
                  creator_name,
                  creator_profile_url,
                  tags,
                  org_id,
                  zala_library,
                  description_markup,
                  zala_public
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
              RETURNING post_id`,
                        [
                            queryResult.rows[0].content_id,
                            scheduledTime,
                            queryResult.rows[0].creator_user_uuid,
                            true,
                            queryResult.rows[0].accessibility,
                            queryResult.rows[0].title,
                            queryResult.rows[0].description,
                            queryResult.rows[0].s3_video_url,
                            queryResult.rows[0].s3_thumbnail,
                            queryResult.rows[0].creator_name,
                            queryResult.rows[0].creator_profile_url,
                            queryResult.rows[0].tags,
                            queryResult.rows[0].org_id,
                            queryResult.rows[0].zala_library,
                            queryResult.rows[0].description_markup,
                            queryResult.rows[0].zala_public,
                        ]
                    );

                    postId = insertedPost.rows[0].post_id;

                    // Append the post_id to the "posts" column of the content table
                    await db.query(
                        `UPDATE content SET posts = array_append(posts, $1) WHERE content_id = $2`,
                        [postId, queryResult.rows[0].content_id]
                    );

                    // Commit the transaction
                    await db.query("COMMIT");
                } catch (error) {
                    // Rollback the transaction if an error occurs
                    await db.query("ROLLBACK");
                    throw error;
                }
            } else {
                try {
                    // Begin a transaction
                    await db.query("BEGIN");

                    // Iterate over the posts array from the content table
                    for (const postId of queryResult.rows[0].posts) {
                        // Update the post_time for the corresponding post_id in the posts table
                        await db.query(
                            `UPDATE posts SET post_time = $1 WHERE post_id = $2 AND scheduled = true`,
                            [scheduledTime, postId]
                        );
                    }

                    // Commit the transaction
                    await db.query("COMMIT");
                } catch (error) {
                    // Rollback the transaction if an error occurs
                    await db.query("ROLLBACK");
                    throw error;
                }
            }

            res.status(200).json({ message: "Content scheduled" });
        } catch (error) {
            console.error("Error scheduling content:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

// Route for removing content from the schedule
router.post("/content/removeFromSchedule/:contentId", async (req, res) => {
    try {
        const { contentId } = req.params;

        // Query the database to find the content by contentId
        const queryResult = await db.query(
            "SELECT * FROM content WHERE content_id = $1",
            [contentId]
        );

        // Check if content with the provided contentId exists
        if (queryResult.rows.length === 0) {
            return res.status(404).json({ error: "Content not found" });
        }

        // Retrieve the posts array from the content table
        const postsArray = queryResult.rows[0].posts;

        // Variable to store the deleted post ID
        let deletedPostId = null;

        // Iterate over each postId in the posts array
        for (const postId of postsArray) {
            // Execute a DELETE query on the posts table
            const deleteResult = await db.query(
                "DELETE FROM posts WHERE post_id = $1 AND scheduled = $2 RETURNING post_id",
                [postId, true]
            );

            // Check if any rows were deleted and set the deleted post_id
            if (deleteResult.rows.length > 0) {
                deletedPostId = deleteResult.rows[0].post_id;
                break; // Exit the loop since only one row is deleted
            }
        }

        // Update the content to remove the deleted post ID from the posts array
        await db.query(
            "UPDATE content SET posts = array_remove(posts, $1), scheduled = $2, scheduled_time = NULL WHERE content_id = $3",
            [deletedPostId, false, contentId]
        );

        res.status(200).json({ message: "Content removed from schedule" });
    } catch (error) {
        console.error("Error removing content from schedule:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Route for searching content from creator
router.post(
    "/content/search/:creatorId",
    upload.fields([]),
    async (req, res) => {
        try {
            const { creatorId } = req.params;
            const { searchValue } = req.body;

            console.log(req.body);
            console.log("searchValue: " + searchValue);

            // Constructing the SQL query
            let query = `
        SELECT * 
        FROM content 
        WHERE creator_user_uuid = $1 
        AND (
          content_id::text ILIKE $2 
          OR title ILIKE $2 
          OR description ILIKE $2 
          OR creator_name ILIKE $2 
          OR accessibility @> ARRAY[$3] 
          OR tags @> ARRAY[$3] 
          OR posts @> ARRAY[$3] 
          OR (zala_public AND $4)
        ) 
        ORDER BY content_id DESC
      `;

            // Fetch content from the database for the given creatorId and filter by searchValue
            const queryResult = await db.query(query, [
                creatorId,
                `%${searchValue}%`,
                searchValue, // For searching within arrays
                searchValue.toLowerCase().includes("public") ||
                    searchValue.toLowerCase().includes("zala"), // For zala_public
            ]);

            // Extract the rows from the query result
            const contentList = queryResult.rows;

            res.status(200).json(contentList);
        } catch (error) {
            console.error("Error fetching content:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

module.exports = router;
