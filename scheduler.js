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
      const currentTimestamp = new Date().toISOString(); // Get the current timestamp
      const updatedPostedArray = content.posted || []; // Initialize as empty array if null or undefined
      updatedPostedArray.push(currentTimestamp); // Append current timestamp to the array

      await db.query(
        "UPDATE content SET scheduled = $1, posted = $2 WHERE content_id = $3",
        [false, updatedPostedArray, content.content_id]
      );
    }

    console.log("Content publishing task executed successfully.");
  } catch (error) {
    console.error("Error executing content publishing task:", error);
  }
}

// Invoke the function immediately when the script is executed
publishContent();