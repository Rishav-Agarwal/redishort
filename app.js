const http = require("http");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const MultiMap = require("mnemonist/multi-map");
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
const cache = new MultiMap(Set);
const CACHE_LIMIT = 100000;

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
 *
 * @param {Response} res The response object
 * @param {String} filePath The path of the file to send
 * @param {String} type Type of file
 *
 * Sends the file present in the specified path as the response back to the client.
 */
function sendFile(res, filePath, type) {
	const _path = path.join(__dirname, filePath);
	const stat = fs.statSync(_path);

	res.writeHead(200, {
		"Content-Type": type,
		"Content-Length": stat.size,
	});

	const readStream = fs.createReadStream(_path);
	readStream.pipe(res);
}

/**
 *
 * @param {Request} req
 * @param {Response} res
 *
 * This function handles requests at homepage ie,'/'
 * It returns the `index.html` file
 */
function homepage(req, res) {
	sendFile(res, "client/index.html", "text/html");
}

/**
 *
 * @param {Request} req
 * @param {Response} res
 *
 * Handles the url shortening requests
 */
function shortenUrl(req, res) {
	let body = [];
	// Read data in chunks and append to an array
	req.on("data", (chunk) => {
		body.push(chunk);
	});
	req.on("end", () => {
		// Get the request body in JSON format
		body = JSON.parse(body);
		// Get the url to shorten
		const urlToShorten = body.url;

		// If the requested url is already small (smaller than what we can produce), return the original url
		const host = "https://" + req.headers.host + "/";
		const genL = host.length + 8;
		if (urlToShorten.length <= genL) {
			// Send the shortened url back to the client
			res.writeHead(200, {
				"Content-Type": "text/json",
			});
			res.write('{"shortUrl":"*"}');
			return res.end();
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
				res.writeHead(200, {
					"Content-Type": "text/json",
				});
				res.write('{"shortUrl":"' + shortUrl + '"}');
				res.end();
			});
	});
}

/**
 * @param {Request} req
 * @param {Response} res
 *
 * Returns the top 5 short urls that have been used
 */
function getTopRedishorts(req, res) {
	db.collection("urls")
		.find()
		.limit(5)
		.project({ _id: 0, hash: 1 })
		.sort({ visits: -1 })
		.toArray((err, docs) => {
			if (err) return;

			// Send the shortened url back to the client
			res.writeHead(200, {
				"Content-Type": "text/json",
			});
			const topRedishorts = docs.map((item) => item.hash);
			res.write(topRedishorts.toString());
			res.end();
		});
}

/**
 *
 * @param {Request} req
 * @param {Response} res
 *
 * Handle all the requests made to our API
 */
function handleApiRequests(req, res) {
	const url = req.url;

	// Handle request received for shortening url
	if (url === "/api/shorten" && req.method === "POST") {
		return shortenUrl(req, res);
	}
	if (url === "/api/top-redishorts" && req.method === "GET") {
		return getTopRedishorts(req, res);
	}
}

/**
 *
 * @param {Request} req
 * @param {Response} res
 *
 * Handles the redirection requests from short url to original url
 * If the the url is found, it redirects
 * Otherwise, 404 error is sent
 */
function handleRedirect(req, res) {
	// Get the hash
	const hash = req.url.slice(1);

	/**
	 * Check the cache
	 * If cache hits, return from the cache and update the db for visit count
	 * Else, get the data from the database and update cache if required
	 */

	if (cacheMap[hash]) {
		// Cache hit!
		console.log("Cache hit for " + cacheMap[hash].url);

		// Send the data back to the user
		res.statusCode = 302;
		res.setHeader("Location", cacheMap[hash].url);
		res.end();

		// Update the cache with visits, last visit and the new value for the url

		// Get the old value for current url and delete it from the cache to update
		const oldVal = cacheMap[hash].value;
		cache.delete(oldVal);

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
				sendFile(res, "client/404.html", "text/html");
				return null;
			}

			// Url found, redirect the user
			res.statusCode = 302;
			res.setHeader("Location", _res.url);
			res.end();
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
			if (cache.size < CACHE_LIMIT) {
				cache.set(newNode.value, newNode.hash);
				cacheMap[newNode.hash] = newNode;
			} else {
				// Otherwise, comapare its value with the smallest value and cache
				// If lesser, continue else pop the element with least value and push current one
				const leastEle = cache.entries().next().value;
				if (newNode.value > leastEle[0]) {
					delete cacheMap[leastEle[1][hash]];
					cache.delete(leastEle[0]);
					cacheMap[newNode.hash] = newNode;
					cache.set(newNode.value, newNode.hash);
				}
			}

			// Update the database and return
			return db
				.collection("urls")
				.findOneAndUpdate({ url: _res.url }, { $inc: { visits: 1 } });
		});
}

/**
 *
 * @param {Request} req Request object
 * @param {Response} res Response object
 *
 * Everytime the server recieves a request, this function is called
 */
function serveListener(req, res) {
	const url = req.url;

	// Home page
	if (url === "/") {
		return homepage(req, res);
	}
	// Starts with /api/
	if (url.match(/^\/api\//)) {
		return handleApiRequests(req, res);
	}
	// Starts with /____ (short url)
	if (url.match(/^\/[a-zA-Z0-9]{4,16}$/)) {
		return handleRedirect(req, res);
	}
	// Invalid request, send 404
	sendFile(res, "client/404.html", "text/html");
}

// Create the server and listen for incoming requests
const server = http.createServer(serveListener);
server.listen(PORT, () => console.log("Listening at port " + PORT));
