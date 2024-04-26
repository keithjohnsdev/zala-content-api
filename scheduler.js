// contentPublishingTask.js

// Import required modules and setup database connection
const db = require("./db");

// Define the function to perform content publishing task
async function publishContent() {
  console.log("Schedule function ran");
  try {
    // Query the database for content scheduled for publishing
    const queryResult = await db.query(
      "SELECT * FROM content WHERE scheduled = $1 AND scheduled_time <= NOW()",
      [true]
    );

    const scheduledContent = queryResult.rows;

    // Log the number of items ready to publish
    console.log(
      `Scheduler - found ${scheduledContent.length} items ready to publish`
    );

    // Iterate over the scheduled content and update status to "published"
    for (const content of scheduledContent) {
      await db.query("UPDATE content SET scheduled = $1 WHERE content_id = $2", [
        false,
        content.content_id,
      ]);
    }

    console.log("Content publishing task executed successfully.");
  } catch (error) {
    console.error("Error executing content publishing task:", error);
  }
}

// Export the function to be invoked externally
module.exports = publishContent;

// Invoke the function immediately when the script is executed
publishContent();