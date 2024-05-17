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

        // Step 1: Extract User UUID
        const userId = req.userId;

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

        // Fetch user interactions from database
        const userInteractionsQuery = await db.query(
            "SELECT * FROM interactions WHERE user_uuid = $1",
            [userId]
        );
        const userInteractions = userInteractionsQuery.rows;

        // Step 3: Create a Hash for Faster Lookup
        const interactionsHash = {};
        userInteractions.forEach((interaction) => {
            interactionsHash[interaction.post_id] = interaction;
        });

        // Extract the rows from the query result
        const subscribedList = subscribedListQuery.rows.map((post) => {
            const interaction = interactionsHash[post.post_id];
            return {
                ...post,
                liked: interaction ? interaction.liked : false,
                disliked: interaction ? interaction.disliked : false,
                viewed: interaction ? interaction.viewed : false,
            };
        });

        // Sort the array by post_time in descending order
        subscribedList.sort(
            (a, b) => new Date(b.post_time) - new Date(a.post_time)
        );

        res.status(200).json(subscribedList);
    } catch (error) {
        console.error("Error fetching content:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/posts/browseAll", async (req, res) => {
    try {
        // Step 1: Extract User UUID
        const userId = req.userId;

        // Step 2: Retrieve Data from Database
        const publicPostsQuery = await db.query("SELECT * FROM zala_public");
        const userInteractionsQuery = await db.query(
            "SELECT * FROM interactions WHERE user_uuid = $1",
            [userId]
        );
        const userInteractions = userInteractionsQuery.rows;

        // Step 3: Create a Hash for Faster Lookup
        const interactionsHash = {};
        userInteractions.forEach((interaction) => {
            interactionsHash[interaction.post_id] = interaction;
        });

        // Step 4: Update Posts with Interaction Data
        const publicPosts = publicPostsQuery.rows.map((post) => {
            const interaction = interactionsHash[post.post_id];
            return {
                ...post,
                liked: interaction ? interaction.liked : false,
                disliked: interaction ? interaction.disliked : false,
                viewed: interaction ? interaction.viewed : false,
            };
        });

        // Step 5: Return Updated Array
        const sortedPublicPosts = publicPosts.sort(
            (a, b) => b.created_at - a.created_at
        );
        res.status(200).json(sortedPublicPosts);
    } catch (error) {
        console.error("Error retrieving public posts:", error);
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
router.post("/post/like/:postId", async (req, res) => {
    try {
        const { postId } = req.params;
        const userId = req.userId; // userId provided from auth middleware

        const userExists = await checkForUser(userId);

        if (!userExists) {
            console.log("------------------- user doesnt exist, adding user to db");
            await addUser(userId, req.userFullName, req.userEmail);
        }

        // Convert postId to integer
        const postIdInt = parseInt(postId);

        // Receive post/user interaction
        const existingInteraction = await db.query(
            `SELECT * FROM interactions WHERE user_uuid = $1 AND post_id = $2`,
            [userId, postIdInt]
        );

        if (existingInteraction.rows.length > 0) {
            // If the user had previously disliked the post, negate the dislike interaction
            if (existingInteraction.rows[0].disliked) {
                await db.query(
                    `UPDATE interactions SET disliked = false WHERE user_uuid = $1 AND post_id = $2`,
                    [userId, postIdInt]
                );

                // Decrement dislikes for the post on posts and zala_public table
                await db.query(
                    `UPDATE posts SET dislikes = COALESCE(dislikes, 0) - 1 WHERE post_id = $1`,
                    [postIdInt]
                );
            }

            // If the user has not already liked the post, set liked to true on interactions
            if (!existingInteraction.rows[0].liked) {
                // Insert a new like interaction
                await db.query(
                    `UPDATE interactions SET liked = true WHERE user_uuid = $1 AND post_id = $2`,
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
        } else {
            await db.query(
                `INSERT INTO interactions (user_uuid, post_id, liked, viewed) VALUES ($1, $2, true, true)`,
                [userId, postIdInt]
            );

            // Increment views and likes for the post
            await db.query(
                `UPDATE posts SET likes = COALESCE(likes, 0) + 1, views = COALESCE(views, 0) + 1 WHERE post_id = $1`,
                [postIdInt]
            );
        }
    } catch (error) {
        console.error("Error liking post:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Route for disliking post
router.post("/post/dislike/:postId", async (req, res) => {
    try {
        const { postId } = req.params;
        const userId = req.userId; // userId provided from auth middleware

        const userExists = await checkForUser(userId);

        if (!userExists) {
            console.log("------------------- user doesnt exist, adding user to db");
            await addUser(userId, req.userFullName, req.userEmail);
        }

        // Convert postId to integer
        const postIdInt = parseInt(postId);

        // Receive post/user interaction
        const existingInteraction = await db.query(
            `SELECT * FROM interactions WHERE user_uuid = $1 AND post_id = $2`,
            [userId, postIdInt]
        );

        if (existingInteraction.rows.length > 0) {
            // If the user had previously liked the post, negate the like interaction
            if (existingInteraction.rows[0].liked) {
                await db.query(
                    `UPDATE interactions SET liked = false WHERE user_uuid = $1 AND post_id = $2`,
                    [userId, postIdInt]
                );

                // Decrement likes for the post
                await db.query(
                    `UPDATE posts SET likes = COALESCE(likes, 0) - 1 WHERE post_id = $1`,
                    [postIdInt]
                );
            }

            // If the user has not already disliked the post, set disliked to true on interactions
            if (!existingInteraction.rows[0].disliked) {
                // Insert a new dislike interaction
                await db.query(
                    `UPDATE interactions SET disliked = true WHERE user_uuid = $1 AND post_id = $2`,
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
        } else {
            await db.query(
                `INSERT INTO interactions (user_uuid, post_id, disliked, viewed) VALUES ($1, $2, true, true)`,
                [userId, postIdInt]
            );

            // Increment views and dislikes for the post
            await db.query(
                `UPDATE posts SET dislikes = COALESCE(dislikes, 0) + 1, views = COALESCE(views, 0) + 1 WHERE post_id = $1`,
                [postIdInt]
            );

            res.status(200).json({ message: "Post disliked" });
        }
    } catch (error) {
        console.error("Error disliking post:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Route for handling post views
router.post("/post/view/:postId", async (req, res) => {
    try {
        const { postId } = req.params;
        const userId = req.userId; // userId provided from auth middleware

        const userExists = await checkForUser(userId);

        if (!userExists) {
            console.log("------------------- user doesnt exist, adding user to db");
            await addUser(userId, req.userFullName, req.userEmail);
        }

        // Convert postId to integer
        const postIdInt = parseInt(postId);

        // Check if the user has already viewed the post
        const existingViewInteraction = await db.query(
            `SELECT * FROM interactions WHERE user_uuid = $1 AND post_id = $2`,
            [userId, postIdInt]
        );

        if (existingViewInteraction.rows.length === 0) {
            // If the user has not yet viewed the post, insert a new interaction record
            await db.query(
                `INSERT INTO interactions (user_uuid, post_id, viewed) VALUES ($1, $2, true)`,
                [userId, postIdInt]
            );

            // Increment views for the post
            await db.query(
                `UPDATE posts SET views = COALESCE(views, 0) + 1 WHERE post_id = $1`,
                [postIdInt]
            );

            res.status(200).json({ message: "Post viewed" });
        } else {
            // If the user has already viewed the post, return a response indicating so
            res.status(200).json({ message: "Post already viewed" });
        }
    } catch (error) {
        console.error("Error handling post view:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Route for removing post from the schedule
router.post("/post/removeFromSchedule/:postId", async (req, res) => {
    try {
        const { postId } = req.params;

        // Query the database to find the post by postId
        const queryResult = await db.query(
            "SELECT * FROM posts WHERE post_id = $1 LIMIT 1",
            [postId]
        );

        // Check if content with the provided contentId exists
        if (queryResult.rows.length === 0) {
            return res.status(404).json({ error: "Post not found" });
        }

        // Variable to store the deleted post ID
        let deletedPostId = null;

        // Execute a DELETE query on the posts table
        const deleteResult = await db.query(
            "DELETE FROM posts WHERE post_id = $1 AND scheduled = $2 RETURNING post_id",
            [postId, true]
        );

        // Check if any rows were deleted and set the deleted post_id
        if (deleteResult.rows.length > 0) {
            deletedPostId = deleteResult.rows[0].post_id;
        }

        // Update the content to remove the deleted post ID from the posts array
        await db.query(
            "UPDATE content SET posts = array_remove(posts, $1), scheduled = $2, scheduled_time = NULL WHERE content_id = $3",
            [deletedPostId, false, contentId]
        );

        res.status(200).json({ message: "Post removed from schedule" });
    } catch (error) {
        console.error("Error removing post from schedule:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// Route for deleting posted post
router.post("/post/removePost/:postId", async (req, res) => {
    try {
        const { postId } = req.params;

        // Query the database to find the post by postId
        const queryResult = await db.query(
            "SELECT * FROM posts WHERE post_id = $1 LIMIT 1",
            [postId]
        );

        // Check if content with the provided contentId exists
        if (queryResult.rows.length === 0) {
            return res.status(404).json({ error: "Post not found" });
        }

        // Variable to store the deleted post ID
        let deletedPostId = null;

        // Execute a DELETE query on the posts table
        const deleteResult = await db.query(
            "DELETE FROM posts WHERE post_id = $1 RETURNING post_id",
            [postId]
        );

        // Check if any rows were deleted and set the deleted post_id
        if (deleteResult.rows.length > 0) {
            deletedPostId = deleteResult.rows[0].post_id;
        }

        let contentId = queryResult.rows[0].content_id;

        // Update the content to remove the deleted post ID from the posts array
        await db.query(
            "UPDATE content SET posts = array_remove(posts, $1), WHERE content_id = $2",
            [deletedPostId, contentId]
        );

        res.status(200).json({ message: "Post removed" });
    } catch (error) {
        console.error("Error removing post:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

async function checkForUser(userId) {
    try {
        // Query the database to check if any user_uuid column matches userId
        const queryResult = await db.query(
            "SELECT * FROM users WHERE user_uuid = $1",
            [userId]
        );

        // If there is a match, return true; otherwise, return false
        console.log("------------queryResult.rows:")
        console.log(queryResult.rows)
        return queryResult.rows.length > 0;
    } catch (error) {
        // Handle any errors that occur during the database query
        console.error("Error checking for user:", error);
        throw new Error("Error checking for user");
    }
}

async function addUser(userId, userFullName, userEmail) {
    try {
        // Execute the INSERT query to add a new user to the database
        const query = `
        INSERT INTO users (user_uuid, name, email)
        VALUES ($1, $2, $3)
      `;
        const values = [userId, userFullName, userEmail];

        // Execute the query
        await db.query(query, values);

        // Return success message or any relevant data
        return { success: true, message: "User added successfully" };
    } catch (error) {
        // Handle any errors that occur during the database query
        console.error("Error adding user:", error);
        throw new Error("Error adding user");
    }
}

// Route for searching posts from creator
router.post(
    "/posts/search/:creatorId",
    upload.fields([]),
    async (req, res) => {
        try {
            const { creatorId } = req.params;
            const { searchValue } = req.body;

            // Constructing the SQL query
            let query = `
            SELECT * 
            FROM posts 
            WHERE creator_user_uuid = $1 
            AND (
                title ILIKE $2 
                OR description ILIKE $2 
                OR creator_name ILIKE $2 
            ) 
            ORDER BY content_id DESC
            `;

            // Adding % wildcards to the search value for pattern matching
            const searchPattern = `%${searchValue}%`;

            // Fetch content from the database for the given creatorId and filter by searchValue
            const queryResult = await db.query(query, [
                creatorId,
                searchPattern // For string matching
            ]);

            // Extract the rows from the query result
            const postsList = queryResult.rows;

            res.status(200).json(postsList);
        } catch (error) {
            console.error("Error searching posts:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    }
);

// Route for "Browse All" view, all public content, 1st implementation
// router.get("/posts/browseAll", async (req, res) => {
//     try {
//         // Fetch published content from the database for the given creatorIds
//         const queryResult = await db.query(
//             `SELECT * FROM zala_public ORDER BY created_at DESC`
//         );

//         // Extract the rows from the query result
//         const contentList = queryResult.rows;

//         res.status(200).json(contentList);
//     } catch (error) {
//         console.error("Error fetching content:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// });

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

// Route for handling post views, 1st implementation
// router.post("/post/view/:postId", upload.fields([]), async (req, res) => {
//     try {
//         const { postId } = req.params;
//         const { userId } = req.body;

//         // Convert postId to integer
//         const postIdInt = parseInt(postId);

//         // Check if the user has already viewed the post
//         const userViewsQuery = await db.query(
//             `SELECT views FROM users WHERE user_uuid = $1`,
//             [userId]
//         );

//         const { views } = userViewsQuery.rows[0];
//         const viewedPostIds = views || [];

//         // If the postId is not in the views array, increment views for the post
//         if (!viewedPostIds.includes(postIdInt)) {
//             await db.query(
//                 `UPDATE posts SET views = COALESCE(views, 0) + 1 WHERE post_id = $1`,
//                 [postIdInt]
//             );

//             await db.query(
//                 `UPDATE zala_public SET views = COALESCE(views, 0) + 1 WHERE post_id = $1`,
//                 [postIdInt]
//             );

//             // Update views array for the user
//             await db.query(
//                 `UPDATE users SET views = array_append(views, $1) WHERE user_uuid = $2`,
//                 [postIdInt, userId]
//             );

//             res.status(200).json({ message: "Post viewed" });
//         } else {
//             res.status(200).json({ message: "Post already viewed" });
//         }
//     } catch (error) {
//         console.error("Error handling post view:", error);
//         res.status(500).json({ error: "Internal server error" });
//     }
// });

module.exports = router;
