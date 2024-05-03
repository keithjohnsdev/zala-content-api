const express = require("express");
const contentRoutes = require("./contentRoutes");
const postRoutes = require("./postRoutes");
const cors = require("cors");

// Create a new Express application
const app = express();

// Middleware for parsing JSON bodies
app.use(express.json());

// Use cors middleware to handle CORS headers
app.use(cors());

// Define routes

app.get("/status", (req, res) => {
  const status = {
    Status: "Running",
  };

  res.send(status);
});

// Mount the content routes
app.use("/", contentRoutes);

// Mount the post routes
app.use("/", postRoutes);

// Start the server
const PORT = process.env.PORT || 3000; // Use the provided port or default to 3000
app.listen(PORT, () => {
  console.log(`Server is now running on port ${PORT}`);
});

module.exports = app;
