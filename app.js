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

// Process port number
const PORT = process.env.PORT || 3000;

// This will be appended as the last digit
counter = 0;

// Cache short urls
/**
 * All of the cache variables are global
 */
cacheMap = {};
cache = new TreeMap();
CACHE_LIMIT = 100000;
cache_total = 0;
cache_hit = 0;

const app = express();

if (process.env.NODE_ENV === "production") {
	/*
	 * Redirect user to https if requested on http
	 *
	 * Refer this for explaination:
	 * https://www.tonyerwin.com/2014/09/redirecting-http-to-https-with-nodejs.html
	 */
	app.enable("trust proxy");
	app.use((req, res, next) => {
		// console.log('secure check');
		if (req.secure) {
			// console.log('secure');
			// request was via https, so do no special handling
			next();
		} else {
			//
			// request was via http, so redirect to https
			res.redirect(`https://${req.headers.host}${req.url}`);
		}
	});

	// Heroku free account sleeps after 30 mins of inacivity
	// To prevent sleeping, call a dummy function every 29 mins
	// Should be removed when upgrading to paid account using a different service
	setInterval(() => console.log("Prevent sleep"), 29 * 60 * 1000);
}

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(bodyParser.text());
app.use(bodyParser.raw());

app.use("/api", apiRoutes);

app.use(redirectionRoutes);

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

// Serve static files
app.use(express.static(path.join(rootDir, "client")));

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

// Connect to the database, create the server and listen for incoming requests
db.connect().then(() => {
	console.log("Connected to database");
	db = db.db("redishort");
	app.listen(PORT, () => console.log("Listening at port " + PORT));
});
