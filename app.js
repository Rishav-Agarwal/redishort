const path = require("path");
const dotenv = require("dotenv");
const TreeMap = require("treemap-js");
const app = require("express")();
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");

/**
 * Server configuration
 */
// Access environment variables
dotenv.config();
// Mongodb setup and connection
const uri = process.env.SHORTEN_MONGODB_URI;
let db = new MongoClient(uri, { useUnifiedTopology: true });
db.connect().then(() => {
	console.log("Connected to database");
	db = db.db("redishort");
});
// Process port number
const PORT = process.env.PORT || 3000;

// This will be appended as the last digit
let counter = 0;

// Cache short urls
const cacheMap = {};
const cache = new TreeMap();
const CACHE_LIMIT = 100000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(bodyParser.text());
app.use(bodyParser.raw());

/**
 * @returns {String} A unique shortened url
 *
 * Generates a unique hash value for a url shortening request
 *
 * Converts the current time in millis to a 62-base number (containg alphanumeric characters).
 * This gives us a 7-digit string.
 * Append a counter digit at the end.
 */
function generateUniqueHash() {
	// Get the current time in millis
	let _time = Date.now();

	// All the possible chars in the generated url
	const hex_chars =
		"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

	// This stores the generated url hash
	let time_hex = "";

	// Convert the current time into a 62-base number to get a unique hash
	while (_time) {
		const pos = _time % 62;
		time_hex += hex_chars[pos];
		_time = Math.floor(_time / 62);
	}

	// Add counter digit at the end
	time_hex += hex_chars[counter];
	counter = (counter + 1) % 62;

	return time_hex;
}

/**
 * @param {Request} req
 * @param {Response} res
 *
 * This function handles requests at homepage ie,'/'
 * It returns the `index.html` file
 */
app.get("/", (req, res) => {
	const filePath = "client/index.html";
	res.sendFile(path.join(__dirname, filePath));
});

/**
 *
 * @param {Request} req
 * @param {Response} res
 *
 * Handles the url shortening requests
 */
app.post("/api/shorten", (req, res) => {
	// Get the request body in JSON format
	body = req.body;
	// Get the url to shorten
	const urlToShorten = body.url;

	// If the requested url is already small (smaller than what we can produce), return the original url
	const host = "https://" + req.headers.host + "/";
	const genL = host.length + 8;
	if (urlToShorten.length <= genL) {
		// Send the shortened url back to the client
		return res.json({ shortUrl: "*" });
	}

	// We can produce smaller url, continue
	db.collection("urls")
		.findOne({ url: urlToShorten })
		.then(async (res) => {
			if (res !== null) {
				// If the hash of the url is already present, return
				return res.hash;
			} else {
				// Generate the shortened url
				const shortUrl = generateUniqueHash();
				// Create the url-hash entry to the database
				await db.collection("urls").insertOne({
					url: urlToShorten,
					hash: shortUrl,
					createdAt: Date.now(),
				});

				return shortUrl;
			}
		})
		.then((shortUrl) => {
			// Send the shortened url back to the client
			res.json({ shortUrl });
		});
});

/**
 * @param {Request} req
 * @param {Response} res
 *
 * Returns the top 5 short urls from the cache that have been used
 */
app.get("/api/top-redishorts", (req, res) => {
	const docs = [];

	// Get 5 urls with best values
	for (let i = 1; i <= 5 && cache.getLength() > 0; ++i) {
		const curKey = cache.getMaxKey();
		docs.push({
			key: curKey,
			val: cache.get(curKey),
		});
		cache.remove(curKey);
	}
	// Push them back to the cache as we removed while reading
	for (cacheItem of docs) {
		cache.set(cacheItem.key, cacheItem.val);
	}

	// Send the top redishorts back to the client
	const topRedishorts = docs.map((item) => item.val);
	res.send(topRedishorts.toString());
});

/**
 *
 * @param {Request} req
 * @param {Response} res
 *
 * Handles the redirection requests from short url to original url
 * If the the url is found, it redirects
 * Otherwise, 404 error is sent
 */
app.get(/^\/[a-zA-Z0-9]{4,16}$/, (req, res) => {
	// Get the hash
	const hash = req.url.slice(1);

	/**
	 * Check the cache
	 * If cache hits, return from the cache and update the db for visit count
	 * Else, get the data from the database and update cache if required
	 */

	if (cacheMap[hash]) {
		// Send the data back to the user
		res.redirect(cacheMap[hash].url);

		// Update the cache with visits, last visit and the new value for the url

		// Get the old value for current url and delete it from the cache to update
		const oldVal = cacheMap[hash].value;
		cache.remove(oldVal);

		// Create new document, update visits, last visit and its value and update the cache
		const newDoc = { ...cacheMap[hash] };
		++newDoc.visits;
		newDoc.lastVisit = Date.now();
		newDoc.value =
			(Math.log(newDoc.lastVisit) * newDoc.visits) /
			(newDoc.lastVisit - newDoc.createdAt);
		cache.set(newDoc.value, newDoc.hash);
		cacheMap[hash] = newDoc;

		// Update the database and return
		return db
			.collection("urls")
			.findOneAndUpdate({ hash }, { $inc: { visits: 1 } });
	}

	/**
	 * Cache not hit, get data from the database, send back to the user and update the cache if necessary
	 */

	// Try getting the orginal url
	db.collection("urls")
		.findOne({ hash })
		.then((_res) => {
			if (_res === null) {
				// If hash not found, return 404 error page
				const filePath = "client/404.html";
				res.sendFile(path.join(__dirname, filePath));
				return null;
			}

			// Url found, redirect the user
			res.redirect(_res.url);
			return _res;
		})
		.then((_res) => {
			// Got the url from database. Check if can be pushed to the cache

			// Create a node for the current url
			const newNode = { ..._res };
			newNode.lastVisit = Date.now();
			++newNode.visits;
			newNode.value =
				(Math.log(newNode.lastVisit) * newNode.visits) /
				(newNode.lastVisit - newNode.createdAt);

			// If we have enough space in cache, push to the cache directly
			if (cache.getLength() < CACHE_LIMIT) {
				cache.set(newNode.value, newNode.hash);
				cacheMap[newNode.hash] = newNode;
			} else {
				// Otherwise, comapare its value with the smallest value and cache
				// If lesser, continue else pop the element with least value and push current one
				const leastEle = cache.getMinKey();
				if (newNode.value > leastEle) {
					delete cacheMap[leastEle[1][hash]];
					cache.remove(leastEle[0]);
					cacheMap[newNode.hash] = newNode;
					cache.set(newNode.value, newNode.hash);
				}
			}

			// Update the database and return
			return db
				.collection("urls")
				.findOneAndUpdate({ url: _res.url }, { $inc: { visits: 1 } });
		});
});

/**
 *
 * @param {Request} req Request object
 * @param {Response} res Response object
 *
 * Everytime the server recieves a request, this function is called
 */
app.use((req, res) => {
	// Invalid request, send 404
	const filePath = "client/404.html";
	res.sendFile(path.join(__dirname, filePath));
});

// Create the server and listen for incoming requests
app.listen(PORT, () => console.log("Listening at port " + PORT));
