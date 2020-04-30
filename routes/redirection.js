const router = require("express").Router();
const path = require("path");

const rootDir = require("../util/path");

/**
 *
 * @param {Request} req
 * @param {Response} res
 *
 * Handles the redirection requests from short url to original url
 * If the the url is found, it redirects
 * Otherwise, 404 error is sent
 */
router.get(/^\/[a-zA-Z0-9]{4,16}$/, (req, res) => {
	// Get the hash
	const hash = req.url.slice(1);
	/**
	 * Check the cache
	 * If cache hits, return from the cache and update the db for visit count
	 * Else, get the data from the database and update cache if required
	 */

	if (cacheMap[hash]) {
		++cache_total;
		++cache_hit;
		console.log("Total req: " + cache_total);
		console.log("Total hit: " + cache_hit);
		console.log("Hit ratio: " + cache_hit / cache_total);
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
				res.sendFile(path.join(rootDir, "client", "404.html"));
				return null;
			}

			// Url found, redirect the user
			res.redirect(_res.url);
			return _res;
		})
		.then((_res) => {
			if (_res === null) return;

			// Got the url from database. Check if can be pushed to the cache
			++cache_total;
			console.log("Total req: " + cache_total);
			console.log("Total hit: " + cache_hit);
			console.log("Hit ratio: " + cache_hit / cache_total);

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
					delete cacheMap[cache.get(leastEle)];
					cache.remove(leastEle);
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

module.exports = router;
