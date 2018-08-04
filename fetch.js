// @ts-check
const https = require('https');
const url = require('url');
const fs = require('fs');

/** Maximum number of retries when fetching  */
const MAX_RETRIES = 3;

/** Maximum number of redirects to follow before fetching */
const MAX_REDIRECTS = 10;

/** HTTPS request timeout */
const REQUEST_TIMEOUT = 60000; // 1 minute

/** Maximum number of UTF-16 chars (not bytes!) allows in text or JSON response */
const MAX_TEXT_LENGTH = 3 * 1024 * 1024;

/**
 * Returns a promise that relves
 * @param {number} tryNum current try number
 */
function waitBeforeRetry(tryNum) {
    return new Promise(fulfill => {
        setTimeout(() => fulfill(), Math.pow(2, tryNum) * 100);
    });
}

/**
 * Initiates get request and returns a promise resolving to response object.
 *
 * Handles redirects up to MAX_REDIRECTS.
 * Repeats on errors (except for 404) up to MAX_RETRIES times.
 *
 * On success, the response must be fully consumed by the caller to avoid
 * leaking memory.
 *
 * @param {string} address - requested URL (must start with `https://`)
 * @param {string?} [contentType] - expected content-type or undefined/null to not check it
 * @returns {Promise<https.IncomingMessage>}
 */
function get(address, contentType, redirs = 0, tries = 0) {
    return new Promise((fulfill, reject) => {
        const { host, path } = url.parse(address);
        const options = {
            headers: { 'User-Agent': 'peerio-updater/1.0' },
            timeout: REQUEST_TIMEOUT,
            host,
            path
        };
        const req = https.get(options, res => {
            if (res.statusCode === 404) {
                reject(new Error(`Not found: ${address}`));
                return;
            }
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers['location']) {
                res.resume();
                if (redirs >= MAX_REDIRECTS) {
                    reject(new Error('Too many redirects'));
                    return;
                }
                let location = res.headers['location']; // always string according to Node docs
                if (!/^https?:/.test(location)) {
                    location = url.resolve(address, location);
                }
                if (!location.startsWith('https:')) {
                    reject(new Error(`Unsafe redirect to ${location}`));
                    return;
                }
                fulfill(get(location, contentType, redirs + 1, tries));
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                if (tries < MAX_RETRIES) {
                    fulfill(waitBeforeRetry(tries).then(() =>
                        get(address, contentType, 0, tries + 1))
                    );
                } else {
                    reject(new Error(`Request failed with status ${res.statusCode}`));
                }
                return;
            }
            if (contentType) {
                let got = res.headers['content-type'] || '';
                // Strip anything after ';' (e.g. application/json; charset=utf8)
                const semicolon = got.indexOf(';')
                if (semicolon >= 0) got = got.substring(0, semicolon);
                if (contentType !== got) {
                    res.resume();
                    reject(new Error(`Unexpected content type: ${got}`));
                    return;
                }
            }
            fulfill(res);
        });

        const handleError = err => {
            if (tries < MAX_RETRIES) {
                fulfill(waitBeforeRetry(tries).then(() =>
                    get(address, contentType, 0, tries + 1))
                );
            } else {
                reject(new Error(`Request failed: ${err.message}`));
            }
        };

        req.on('error', handleError);
        req.on('timeout', () => {
            req.abort();
            handleError(new Error('Request timed out'));
        });
    });
}

/**
 * Reads the given stream and returns it as string.
 * Rejects if data is larger than MAX_TEXT_LENGTH.
 *
 * @param {stream.Readable} stream
 * @returns {Promise<string>} received text
 */
function streamToText(stream) {
    return new Promise((fulfill, reject) => {
        let chunks = [];
        let length = 0;
        stream.setEncoding('utf8');
        stream.on('data', chunk => {
            length += chunk.length;
            if (length > MAX_TEXT_LENGTH) {
                reject(new Error('Response is too big'));
                return;
            }
            chunks.push(chunk);
        });
        stream.on('end', () => {
            fulfill(chunks.join(''));
        });
        stream.on('error', err => {
            reject(err);
        });
    });
}

/**
 * Fetches text from the given address.
 * Rejects if received text is larger than MAX_TEXT_LENGTH.
 *
 * @param {string} address source URL
 * @param {string?} [contentType] expected content type or undefined if any
 * @returns {Promise<string>} resulting text
 */
function fetchText(address, contentType) {
    return get(address, contentType)
        .then(streamToText)
        .catch(err => {
            console.error(`Fetch error: ${err.message}`);
            throw err; // re-throw
        });
}

/**
 * Fetches JSON from the given address.
 * Rejects if received text is larger than MAX_TEXT_LENGTH.
 *
 * @param {string} address source URL
 * @returns {Promise<Object>} resulting JSON
 */
function fetchJSON(address) {
    return fetchText(address, 'application/json').then(JSON.parse);
}

/**
 * Fetches all pages from GitHub(-like) JSON API, where
 * the address of the next page response is contained
 * in the Link header:
 *
 * Link: <https://api.github.com/user/repos?page=3&per_page=100>; rel="next",
 *       <https://api.github.com/user/repos?page=50&per_page=100>; rel="last"
 *
 * @param {string} address - requested URL (must start with `https://`)
 */
function fetchAllJSONPages(address) {
    return get(address, 'application/json').then(res => {
        return streamToText(res).then(JSON.parse).then(json => {
            // Extract next page link if it's there.
            if (res.headers['link']) {
                const m = res.headers['link'].match(/<(https:\/\/.+)>;\s*rel=["']next["']/);
                if (!m || m.length <= 1) {
                    // This page is final.
                    return json;
                }
                // Have one more page, fetch it.
                return fetchAllJSONPages(m[1]).then(r => json.concat(r));
            } else {
                return json;
            }
        });
    });
}


/**
 * Fetches file from the given address, creating a file
 * into the given file path.
 *
 * @param {string} address source URL
 * @param {string} filepath destination file path
 * @returns {Promise<string>} promise resolving to the destination file path
 */
function fetchFile(address, filepath) {
    return get(address)
        .then(res => new Promise((fulfill, reject) => {
            const file = fs.createWriteStream(filepath);
            res.on('error', err => {
                // reading error
                file.close();
                fs.unlink(filepath, err => {   // best effort
                    if (err) console.error(err);
                });
                reject(err);
            });
            file.on('error', err => {
                // writing error
                fs.unlink(filepath, err => {   // best effort
                    if (err) console.error(err);
                });
                reject(err);
            });
            file.on('finish', () => {
                fulfill(filepath);
            });
            res.pipe(file);
        }));
}

module.exports = {
    fetchText,
    fetchJSON,
    fetchAllJSONPages,
    fetchFile
};
