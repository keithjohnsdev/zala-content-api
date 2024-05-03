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

      // Update content table
      await db.query("UPDATE content SET scheduled = $1 WHERE content_id = $2", [false, content.content_id]);

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
