const router = require("express").Router();

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
 * @param {Request} req
 * @param {Response} res
 *
 * Handles the url shortening requests
 */
router.post("/shorten", (req, res) => {
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
router.get("/top-redishorts", (req, res) => {
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

module.exports = router;
