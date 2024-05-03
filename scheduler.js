const db = require("./db");

// Define the function to perform content publishing task
async function publishContent() {
  console.log("Schedule function ran");
  try {
    // Query the posts database for content posts scheduled for publishing
    const queryResult = await db.query(
      "SELECT * FROM posts WHERE scheduled = $1 AND post_time <= NOW()",
      [true]
    );

    const scheduledContent = queryResult.rows;

    // Log the number of items ready to publish
    console.log(
      `Scheduler - found ${scheduledContent.length} items ready to publish`
    );

    // Iterate over the scheduled content and update status to "published"
    for (const content of scheduledContent) {
      const postId = content.post_id;

      // Query the content table to get the current posts array
      const contentQueryResult = await db.query(
        "SELECT posts FROM content WHERE content_id = $1",
        [content.content_id]
      );

      // Extract the posts array from the query result
      const currentPostsArray = contentQueryResult.rows[0].posts;

      let updateContentQuery;
      let updateContentParams;

      if (currentPostsArray && currentPostsArray.length > 0) {
        // If the posts array is not null or empty, append to it
        updateContentQuery =
          "UPDATE content SET scheduled = $1, posts = array_append(posts, $2) WHERE content_id = $3";
        updateContentParams = [false, postId, content.content_id];
      } else {
        // If the posts array is null or empty, initialize it with the post_id
        updateContentQuery =
          "UPDATE content SET scheduled = $1, posts = ARRAY[$2] WHERE content_id = $3";
        updateContentParams = [false, postId, content.content_id];
      }

      // Update content table
      await db.query(updateContentQuery, updateContentParams);

      // Update posts table
      await db.query("UPDATE posts SET scheduled = $1 WHERE post_id = $2", [
        false,
        postId,
      ]);
    }

    console.log("Content publishing task executed successfully.");
  } catch (error) {
    console.error("Error executing content publishing task:", error);
  }
}

// Invoke the function immediately when the script is executed
publishContent();
