const express = require("express");
const contentRoutes = require("./contentRoutes");
const postRoutes = require("./postRoutes");
const cors = require("cors");
const axios = require("axios");
const db = require("./db");

// Create a new Express application
const app = express();

// Use cors middleware to handle CORS headers
app.use(cors());

// Middleware for parsing JSON bodies
app.use(express.json());

app.get("/status", (req, res) => {
    const status = {
        Status: "Running",
    };

    res.send(status);
});

// Middleware function to extract user details from JWT
app.use(async (req, res, next) => {
    console.log("------- auth middleware run");
    // Get the Authorization header
    const authHeader = req.headers["authorization"];

    // Check if the header exists and starts with 'Bearer '
    if (authHeader) {
        let token;
        if (authHeader.startsWith("Bearer ")) {
            // Extract the token (remove 'Bearer ' from the beginning)
            token = authHeader.substring(7);
        } else {
            token = authHeader;
        }

        try {
            // Make a POST request to the external API with the GraphQL query
            const response = await axios.post(
                `${BASE_URL}/gql`,
                {
                    query: `
                        query {
                            me {
                                id
                                email
                                fullName
                            }
                        }
                    `,
                },
                {
                    headers: {
                        Authorization: token,
                        "Content-Type": "application/json",
                    },
                }
            );

            console.log("-----response.data:");
            console.log(response.data);

            // Extract the userId from the response data
            const userId = response.data.data.me.id;
            const userFullName = response.data.data.me.fullName;
            const userEmail = response.data.data.me.email;

            console.log("------------userId:");
            console.log(userId);

            // Set the userId in the request object for use in subsequent middleware or routes
            req.userId = userId;
            req.userFullName = userFullName;
            req.userEmail = userEmail;

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

// Middleware to check if user exists in the database and add if not
app.use(async (req, res, next) => {
    try {
        const { userId, userFullName, userEmail } = req;

        // Query to check if the user exists
        const userCheckQuery = `
            SELECT * FROM users WHERE user_uuid = $1 OR name = $2 OR email = $3;
        `;
        const userCheckParams = [userId, userFullName, userEmail];
        const userCheckResult = await db.query(userCheckQuery, userCheckParams);

        if (userCheckResult.rowCount === 0) {
            // If user does not exist, insert the new user
            const insertUserQuery = `
            INSERT INTO users (user_uuid, name, email, created_at, updated_at)
            VALUES ($1, $2, $3, NOW(), NOW());
        `;
            const insertUserParams = [userId, userFullName, userEmail];
            await db.query(insertUserQuery, insertUserParams);
            console.log('New user added to the database');
        } else {
            console.log('User already exists in the database');
        }

        next(); // Continue to the next middleware or route handler
    } catch (error) {
        console.error("Error checking or adding user:", error);
        res.status(500).json({ error: "Internal server error" });
    }
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
