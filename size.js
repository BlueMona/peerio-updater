// @ts-check
const fs = require('fs');

/**
 * Calculates file size and compares
 * it to the provided one.
 *
 * Returns a promise which rejects if the size is
 * incorrect, otherwise resolves to true.
 *
 * @param {number} correctSize expected file size
 * @param {string} filepath file path
 * @returns {Promise<boolean>}
 */
function verifySize(correctSize, filepath) {
    return calculateSize(filepath).then(size => {
        if (size !== correctSize) {
            throw new Error(`Incorrect file size: expected ${correctSize}, got ${size}`);
        }
        return true;
    });
}

/**
 * Calculates size of the file at the given path.
 *
 * @param {string} filepath
 * @returns Promise<number> hex encoded hash
 */
function calculateSize(filepath) {
    return new Promise((fulfill, reject) => {
        fs.stat(filepath, (err, stats) => {
            if (err) return reject(err);
            fulfill(stats.size);
        });
    });
}

module.exports = {
    verifySize,
    calculateSize
};
