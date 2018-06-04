// @ts-check
const crypto = require('crypto');
const fs = require('fs');

/**
 * Calculates SHA512 hash of filepath and compares
 * it to the provided correctHash.
 *
 * Returns a promise which rejects if the hash is
 * incorrect, otherwise resolves to true.
 *
 * @param {string} correctHash expected hex-encoded SHA-512 hash
 * @param {string} filepath file path
 * @returns {Promise<boolean>}
 */
function verifyHash(correctHash, filepath) {
    return calculateHash(filepath).then(hash => {
        if (hash !== correctHash) {
            throw new Error(`Incorrect checksum: expected ${correctHash}, got ${hash}`);
        }
        return true;
    });
}

/**
 * Calculates hash of the file at the given path.
 *
 * @param {string} filepath
 * @returns Promise<string> hex encoded hash
 */
function calculateHash(filepath) {
    return new Promise((fulfill, reject) => {
        const file = fs.createReadStream(filepath);
        const hash = crypto.createHash('sha512');
        hash.setEncoding('hex');
        file.on('error', err => {
            reject(err);
        });
        file.on('end', () => {
            hash.end();
            fulfill(hash.read());
        });
        file.pipe(hash);
    });
}

module.exports = {
    verifyHash,
    calculateHash
};
