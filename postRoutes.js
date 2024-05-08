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

// Route for "for you" view (Zala public from all superusers and content from subscribed superusers)
router.post("/posts/forYou", upload.none(), async (req, res) => {
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
        const subscribedListQuery = await db.query(
            `SELECT * FROM posts 
      WHERE creator_user_uuid IN (${parsedIds
          .map((id, index) => `$${index + 1}`)
          .join(", ")})
      AND scheduled = false
      AND post_time < NOW()`,
            parsedIds
        );

        // Fetch all zala public content from the given creatorIds
        const zalaPublicQuery = await db.query(
            `SELECT * FROM zala_public 
        WHERE creator_user_uuid IN (${parsedIds
            .map((id, index) => `$${index + 1}`)
            .join(", ")})`,
            parsedIds
        );

        // Extract the rows from the query result
        const subscribedList = subscribedListQuery.rows;
        const zalaPublicList = zalaPublicQuery.rows;

        // Concatenate the two arrays
        let combinedList = [...subscribedList, ...zalaPublicList];
        console.log(combinedList);
        // Remove duplicates based on post_id
        const uniquePostIds = new Set();
        combinedList = combinedList.filter((item) => {
            if (!uniquePostIds.has(item.post_id)) {
                uniquePostIds.add(item.post_id);
                return true;
            }
            return false;
        });

        // Sort the combined array by post_time in descending order
        combinedList.sort(
            (a, b) => new Date(b.post_time) - new Date(a.post_time)
        );

        // Now combinedList contains both sets of rows sorted by post_time without duplicates
        console.log(combinedList);
        res.status(200).json(combinedList);
    } catch (error) {
        console.error("Error fetching content:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Route for "Browse All" view, all public content
router.get("/posts/browseAll", async (req, res) => {
    try {
        // Fetch published content from the database for the given creatorIds
        const queryResult = await db.query(
            `SELECT * FROM zala_public ORDER BY created_at DESC`
        );

        // Extract the rows from the query result
        const contentList = queryResult.rows;

        res.status(200).json(contentList);
    } catch (error) {
        console.error("Error fetching content:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Route for listing posts by superuser UUID
router.get("/posts/:creatorId", async (req, res) => {
    try {
        // Fetch published content from the database for the given creatorId
        const queryResult = await db.query(
            `SELECT * FROM posts 
            WHERE creator_user_uuid = $1
            ORDER BY post_time DESC`, // Add ORDER BY clause to sort by post_id descending
            [req.params.creatorId]
        );

        // Extract the rows from the query result
        const postsLists = queryResult.rows;

        // Send the sorted list of posts
        res.json(postsLists);
    } catch (error) {
        // Handle error
        console.error("Error fetching posts:", error);
        res.status(500).send("Error fetching posts");
    }
});

// Route for liking post
router.post("/post/like/:postId", upload.fields([]), async (req, res) => {
    try {
        const { postId } = req.params;
        const userId = req.headers.authorization; // Extract userId from the Authorization header

        // Convert postId to integer
        const postIdInt = parseInt(postId);

        // Check if the user has already disliked the post
        const existingDislikeInteraction = await db.query(
            `SELECT * FROM interactions WHERE user_uuid = $1 AND post_id = $2 AND disliked = true`,
            [userId, postIdInt]
        );

        // If the user had previously disliked the post, delete the dislike interaction
        if (existingDislikeInteraction.rows.length > 0) {
            await db.query(
                `DELETE FROM interactions WHERE user_uuid = $1 AND post_id = $2 AND disliked = true`,
                [userId, postIdInt]
            );

            // Decrement dislikes for the post
            await db.query(
                `UPDATE posts SET dislikes = COALESCE(dislikes, 0) - 1 WHERE post_id = $1`,
                [postIdInt]
            );
        }

        // Check if the user has already liked the post
        const existingLikeInteraction = await db.query(
            `SELECT * FROM interactions WHERE user_uuid = $1 AND post_id = $2 AND liked = true`,
            [userId, postIdInt]
        );

        // If the user has not already liked the post, insert a new like interaction
        if (existingLikeInteraction.rows.length === 0) {
            // Insert a new like interaction
            await db.query(
                `INSERT INTO interactions (user_uuid, post_id, liked) VALUES ($1, $2, true)`,
                [userId, postIdInt]
            );

            // Increment likes for the post
            await db.query(
                `UPDATE posts SET likes = COALESCE(likes, 0) + 1 WHERE post_id = $1`,
                [postIdInt]
            );

            res.status(200).json({ message: "Post liked" });
        } else {
            res.status(200).json({ message: "Post already liked" });
        }
    } catch (error) {
        console.error("Error liking post:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Route for disliking post
router.post("/post/dislike/:postId", upload.fields([]), async (req, res) => {
    try {
        const { postId } = req.params;
        const userId = req.headers.authorization; // Extract userId from the Authorization header

        // Convert postId to integer
        const postIdInt = parseInt(postId);

        // Check if the user has already liked the post
        const existingLikeInteraction = await db.query(
            `SELECT * FROM interactions WHERE user_uuid = $1 AND post_id = $2 AND liked = true`,
            [userId, postIdInt]
        );

        // If the user had previously liked the post, delete the like interaction
        if (existingLikeInteraction.rows.length > 0) {
            await db.query(
                `DELETE FROM interactions WHERE user_uuid = $1 AND post_id = $2 AND liked = true`,
                [userId, postIdInt]
            );

            // Decrement likes for the post
            await db.query(
                `UPDATE posts SET likes = COALESCE(likes, 0) - 1 WHERE post_id = $1`,
                [postIdInt]
            );
        }

        // Check if the user has already disliked the post
        const existingDislikeInteraction = await db.query(
            `SELECT * FROM interactions WHERE user_uuid = $1 AND post_id = $2 AND disliked = true`,
            [userId, postIdInt]
        );

        // If the user has not already disliked the post, insert a new dislike interaction
        if (existingDislikeInteraction.rows.length === 0) {
            // Insert a new dislike interaction
            await db.query(
                `INSERT INTO interactions (user_uuid, post_id, disliked) VALUES ($1, $2, true)`,
                [userId, postIdInt]
            );

            // Increment dislikes for the post
            await db.query(
                `UPDATE posts SET dislikes = COALESCE(dislikes, 0) + 1 WHERE post_id = $1`,
                [postIdInt]
            );

            res.status(200).json({ message: "Post disliked" });
        } else {
            res.status(200).json({ message: "Post already disliked" });
        }
    } catch (error) {
        console.error("Error disliking post:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});


// Route for liking post, 1st implementation
// router.post("/post/like/:postId", upload.fields([]), async (req, res) => {
//     try {
//         const { postId } = req.params;
//         const { userId } = req.body;

//         // Convert postId to integer
//         const postIdInt = parseInt(postId);

//         // Check if the user has already liked or disliked the post
//         const userLikesQuery = await db.query(
//             `SELECT likes, dislikes FROM users WHERE user_uuid = $1`,
//             [userId]
//         );

//         const { likes, dislikes } = userLikesQuery.rows[0];
//         const likedPostIds = likes || [];
//         const dislikedPostIds = dislikes || [];

//         // If the postId is already in the dislikes array, decrement dislikes and remove it from dislikes array
//         if (dislikedPostIds.includes(postIdInt)) {
//             await db.query(
//                 `UPDATE posts SET dislikes = COALESCE(dislikes, 0) - 1 WHERE post_id = $1`,
//                 [postIdInt]
//             );

//             await db.query(
//                 `UPDATE zala_public SET dislikes = COALESCE(dislikes, 0) - 1 WHERE post_id = $1`,
//                 [postIdInt]
//             );

//             await db.query(
//                 `UPDATE users SET dislikes = array_remove(dislikes, $1) WHERE user_uuid = $2`,
//                 [postIdInt, userId]
//             );
//         }

//         // If the postId is not in the likes array, increment likes and add it to likes array
//         if (!likedPostIds.includes(postIdInt)) {
//             await db.query(
//                 `UPDATE posts SET likes = COALESCE(likes, 0) + 1 WHERE post_id = $1`,
//                 [postIdInt]
//             );

//             await db.query(
//                 `UPDATE zala_public SET likes = COALESCE(likes, 0) + 1 WHERE post_id = $1`,
//                 [postIdInt]
//             );

//             await db.query(
//                 `UPDATE users SET likes = array_append(likes, $1) WHERE user_uuid = $2`,
//                 [postIdInt, userId]
//             );
//         }

//         res.status(200).json({ message: "Post liked" });
//     } catch (error) {
//         console.error("Error liking post:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// });

// Route for disliking post, 1st implementation
// router.post("/post/dislike/:postId", upload.fields([]), async (req, res) => {
//     try {
//         const { postId } = req.params;
//         const { userId } = req.body;

//         // Convert postId to integer
//         const postIdInt = parseInt(postId);

//         // Check if the user has already liked or disliked the post
//         const userLikesQuery = await db.query(
//             `SELECT likes, dislikes FROM users WHERE user_uuid = $1`,
//             [userId]
//         );

//         const { likes, dislikes } = userLikesQuery.rows[0];
//         const likedPostIds = likes || [];
//         const dislikedPostIds = dislikes || [];

//         // If the postId is already in the likes array, decrement likes and remove it from likes array
//         if (likedPostIds.includes(postIdInt)) {
//             await db.query(
//                 `UPDATE posts SET likes = COALESCE(likes, 0) - 1 WHERE post_id = $1`,
//                 [postIdInt]
//             );

//             await db.query(
//                 `UPDATE zala_public SET likes = COALESCE(likes, 0) - 1 WHERE post_id = $1`,
//                 [postIdInt]
//             );

//             await db.query(
//                 `UPDATE users SET likes = array_remove(likes, $1) WHERE user_uuid = $2`,
//                 [postIdInt, userId]
//             );
//         }

//         // If the postId is not in the dislikes array, increment dislikes and add it to dislikes array
//         if (!dislikedPostIds.includes(postIdInt)) {
//             await db.query(
//                 `UPDATE posts SET dislikes = COALESCE(dislikes, 0) + 1 WHERE post_id = $1`,
//                 [postIdInt]
//             );

//             await db.query(
//                 `UPDATE zala_public SET dislikes = COALESCE(dislikes, 0) + 1 WHERE post_id = $1`,
//                 [postIdInt]
//             );

//             await db.query(
//                 `UPDATE users SET dislikes = array_append(dislikes, $1) WHERE user_uuid = $2`,
//                 [postIdInt, userId]
//             );
//         }

//         res.status(200).json({ message: "Post disliked" });
//     } catch (error) {
//         console.error("Error disliking post:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// });


// Route for handling post views
router.post("/post/view/:postId", upload.fields([]), async (req, res) => {
    try {
        const { postId } = req.params;
        const { userId } = req.body;

        // Convert postId to integer
        const postIdInt = parseInt(postId);

        // Check if the user has already viewed the post
        const userViewsQuery = await db.query(
            `SELECT views FROM users WHERE user_uuid = $1`,
            [userId]
        );

        const { views } = userViewsQuery.rows[0];
        const viewedPostIds = views || [];

        // If the postId is not in the views array, increment views for the post
        if (!viewedPostIds.includes(postIdInt)) {
            await db.query(
                `UPDATE posts SET views = COALESCE(views, 0) + 1 WHERE post_id = $1`,
                [postIdInt]
            );

            await db.query(
                `UPDATE zala_public SET views = COALESCE(views, 0) + 1 WHERE post_id = $1`,
                [postIdInt]
            );

            // Update views array for the user
            await db.query(
                `UPDATE users SET views = array_append(views, $1) WHERE user_uuid = $2`,
                [postIdInt, userId]
            );

            res.status(200).json({ message: "Post viewed" });
        } else {
            res.status(200).json({ message: "Post already viewed" });
        }
    } catch (error) {
        console.error("Error handling post view:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;
