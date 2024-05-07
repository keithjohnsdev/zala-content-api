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
    console.log(scheduledContent[0]);

    // Log the number of items ready to publish
    console.log(
      `Scheduler - found ${scheduledContent.length} items ready to publish`
    );

    // Iterate over the scheduled content and update status to "published"
    for (const content of scheduledContent) {
      const postId = content.post_id;

      // Update content table
      await db.query(
        "UPDATE content SET scheduled = $1 WHERE content_id = $2",
        [false, content.content_id]
      );

      // Update posts table
      await db.query("UPDATE posts SET scheduled = $1 WHERE post_id = $2", [
        false,
        postId,
      ]);

      // Check if "public" exists in parsedAccessibility
      const isPublic = content.accessibility.includes("public");

      // If "public" exists, insert into zala_public
      if (isPublic) {
        try {
          // Insert new row into zala_public table
          await db.query(
            `INSERT INTO zala_public (
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
                  description_markup,
                  content_id,
                  post_id
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              content.title,
              content.description,
              content.s3_video_url,
              content.s3_thumbnail,
              new Date(),
              new Date(),
              content.creator_user_uuid,
              content.creator_name,
              content.creator_profile_url,
              content.tags,
              content.org_id,
              content.description_markup,
              content.content_id,
              content.post_id
            ]
          );
        } catch (error) {
          console.error("Error inserting into zala_public table:", error);
          throw error;
        }
      }
    }

    console.log("Content publishing task executed successfully.");
  } catch (error) {
    console.error("Error executing content publishing task:", error);
  }
}

// Invoke the function immediately when the script is executed
publishContent();
