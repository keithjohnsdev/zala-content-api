const express = require("express");
const contentRoutes = require("./contentRoutes");
const postRoutes = require("./postRoutes");
const cors = require("cors");
const jwt = require('jsonwebtoken');

// Create a new Express application
const app = express();

// Middleware function to extract and log JWT Bearer token
app.use((req, res, next) => {
    // Get the Authorization header
    const authHeader = req.headers['Authorization'];

    console.log(authHeader);

    // Check if the header exists and starts with 'Bearer '
    if (authHeader && authHeader.startsWith('Bearer ')) {
        // Extract the token (remove 'Bearer ' from the beginning)
        const token = authHeader.substring(7);

        try {
            // Decode the token
            const decodedToken = jwt.verify(token, 'your_secret_key');
            
            // Log the decoded token
            console.log('Decoded token:', decodedToken);

            // Attach the decoded token to the request object for further use
            req.user = decodedToken;

            // Call the next middleware
            next();
        } catch (error) {
            // If the token is invalid or expired, return an error response
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
    } else {
        // If the Authorization header is missing or doesn't start with 'Bearer ',
        // return a 401 Unauthorized response
        return res.status(401).json({ error: 'Unauthorized' });
    }
});

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
