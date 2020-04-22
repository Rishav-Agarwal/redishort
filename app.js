const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;

/**
 * @returns {String} A unique shortened url
 *
 * Generates a unique hash value for a url shortening request
 *
 * Converts the current time in millis to a 62-base number (containg alphanumeric characters).
 * This gives us a 7-digit string.
 * It then appends a random digit at the end.
 */
function generateUniqueHash() {
	// Get the current time in millis
	let _time = Date.now();

	// All the possible chars in the generated url
	const hex_chars =
		"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

	// This store the generated url hash
	let time_hex = "";

	// Convert the current time into a 62-base number to get a unique hash
	while (_time) {
		const pos = _time % 62;
		time_hex += hex_chars[pos];
		_time = Math.floor(_time / 62);
	}

	// Extra random digit at the end
	const last = Math.floor(Math.random() * 62);
	time_hex += hex_chars[last];

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
		// Get the shortened url
		const shortUrl = generateUniqueHash();

		// Send the shortened url back to the client
		res.writeHead(200, {
			"Content-Type": "text/json",
		});
		res.write("{shortUrl: " + shortUrl + "}");
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
	console.log(url);

	// Home page
	if (url === "/") {
		console.log("Hit: /");
		return homepage(req, res);
	}
	if (url.match("/api/*")) {
		console.log("Hit: /api");
		return handleApiRequests(req, res);
	}
}

// Create the server and listen for incoming requests
const server = http.createServer(serveListener);
server.listen(PORT, () => console.log("Listening at port " + PORT));
