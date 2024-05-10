const express = require("express");
const contentRoutes = require("./contentRoutes");
const postRoutes = require("./postRoutes");
const cors = require("cors");
const axios = require("axios");

// Create a new Express application
const app = express();

// Use cors middleware to handle CORS headers
app.use(cors());

// Middleware function to extract user details from JWT
app.use(async (req, res, next) => {
    console.log("------- auth middleware run");
    // Get the Authorization header
    const authHeader = req.headers["authorization"];
    console.log("---- authHeader:");
    console.log(authHeader);

    // Check if the header exists and starts with 'Bearer '
    if (authHeader) {
        if (authHeader.startsWith("Bearer ")) {
            // Extract the token (remove 'Bearer ' from the beginning)
            const token = authHeader.substring(7);
        } else {
            const token = authHeader;
        }

        try {
            // Make a POST request to the external API with the GraphQL query
            const response = await axios.post(
                "https://zala-stg.herokuapp.com/gql",
                {
                    query: `
                        query {
                            me {
                                id
                            }
                        }
                    `,
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            console.log("-----response:");
            console.log(response);

            // Extract the userId from the response data
            const userId = response.data.data.me.id;

            // Set the userId in the request object for use in subsequent middleware or routes
            req.userId = userId;

            // Continue to the next middleware or route handler
            next();
        } catch (error) {
            // If the token is invalid or expired, or the API call fails, return an error response
            console.error("Error validating token:", error);
            return res.status(401).json({ error: "Invalid or expired token" });
        }
    } else {
        // If the Authorization header is missing or doesn't start with 'Bearer ',
        // return a 401 Unauthorized response
        return res.status(401).json({ error: "Unauthorized" });
    }
});

// Middleware for parsing JSON bodies
app.use(express.json());

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
