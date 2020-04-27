const path = require("path");
const dotenv = require("dotenv");
const TreeMap = require("treemap-js");
const express = require("express");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");

const apiRoutes = require("./routes/api");
const redirectionRoutes = require("./routes/redirection");

const rootDir = require("./util/path");

/**
 * Server configuration
 */

// Access environment variables
dotenv.config();

// Mongodb setup and connection
const uri = process.env.SHORTEN_MONGODB_URI;

/**
 * `db` is a GLOBAL variable
 */
db = new MongoClient(uri, { useUnifiedTopology: true });
db.connect().then(() => {
	console.log("Connected to database");
	db = db.db("redishort");
});

// Process port number
const PORT = process.env.PORT || 3000;

// This will be appended as the last digit
let counter = 0;

// Cache short urls
/**
 * All of the cache variables are global
 */
cacheMap = {};
cache = new TreeMap();
CACHE_LIMIT = 100000;

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(bodyParser.text());
app.use(bodyParser.raw());
app.use(express.static(path.join(rootDir, "client")));

/**
 * @param {Request} req
 * @param {Response} res
 *
 * This function handles requests at homepage ie,'/'
 * It returns the `index.html`
 */
app.get("/", (req, res) => {
	res.sendFile(path.join(rootDir, "client", "index.html"));
});

app.use("/api", apiRoutes);

app.use(redirectionRoutes);

/**
 *
 * @param {Request} req Request object
 * @param {Response} res Response object
 *
 * Everytime the server recieves a request, this function is called
 */
app.use((req, res) => {
	// Invalid request, send 404
	res.status(404).sendFile(path.join(rootDir, "client", "404.html"));
});

// Create the server and listen for incoming requests
app.listen(PORT, () => console.log("Listening at port " + PORT));
