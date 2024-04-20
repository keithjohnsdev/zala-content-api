const cron = require('node-cron');
const db = require('./db');

// Schedule the task to run every minute
cron.schedule('* * * * *', async () => {
  try {
    // Query the database for content scheduled for publishing
    const queryResult = await db.query(
      'SELECT * FROM content WHERE status = $1 AND publish_time <= NOW()',
      ['scheduled']
    );

    const scheduledContent = queryResult.rows;

    // Iterate over the scheduled content
    scheduledContent.length && console.log(`Scheduler - found ${scheduledContent.length} items ready to publish`)
    for (const content of scheduledContent) {
      // Update status to "published"
      await db.query(
        'UPDATE content SET status = $1 WHERE content_id = $2',
        ['published', content.content_id]
      );
    }

    console.log('Content publishing task executed successfully.');
  } catch (error) {
    console.error('Error executing content publishing task:', error);
  }
});
