// @ts-check
/**
 * OpenBSD's signify-compatible signatures.
 */

const nacl = require('tweetnacl');

/**
 * Verifies signature.
 * Throws if signature is invalid.
 *
 * @param {Array<string>} publicKeys list of base64-encoded public key in signify format
 * @param {string} sig base64-encoded signature in signify format
 * @param {string} text message to verify
 */
function verify(publicKeys, sig, text) {
    // Parse signature.
    const binsig = Buffer.from(sig, 'base64');

    // Check signature length.
    if (binsig.length !== 10 + nacl.sign.signatureLength) {
        throw new Error('Bad signature length');
    }

    // Check signature algorithm.
    if (binsig[0] !== 69 /* 'E' */ || binsig[1] !== 100 /* 'd' */) {
        throw new Error('Unknown signature algorithm');
    }

    // Find the appropriate key for signature based on
    // algorithm and public key fingerprint embedded into signature.
    let key = null;
    for (let i = 0; i < publicKeys.length; i++) {
        const binkey = Buffer.from(publicKeys[i], 'base64');

        // Check public  key format.
        if (binkey.length !== 10 + nacl.sign.publicKeyLength) {
            throw new Error('Bad public key length');
        }

        // If algorithm (2 bytes) and key number (8) bytes match,
        // we found the needed key.
        if (nacl.verify(binkey.subarray(0, 10), binsig.subarray(0, 10))) {
            key = binkey;
            break;
        }
    }
    if (!key) {
        throw new Error('Invalid signature: no matching key found');
    }

    const bintext = Buffer.from(text, 'utf8');
    if (!nacl.sign.detached.verify(bintext, binsig.subarray(10), key.subarray(10))) {
        throw new Error('Invalid signature');
    }
}

/**
 * Signs text with the given secret key, returning signature.
 *
 * Note that secret key is stored in the same format as signify,
 * but uses no KDF (kdf is 0x00 0x00), so signify doesn't support it.
 *
 * Secret key format:
 *
 *   2 bytes - signature algorithm
 *   2 bytes - kdf algorithm (00 00)
 *   4 bytes - kdf rounds (00 00 00 00)
 *  16 bytes - salt (all zeroes)
 *   8 bytes - checksum (SHA512(secret key))
 *   8 bytes - key num (random bytes, embedded in signature and public key)
 *  64 bytes - secret key
 *
 * @param {string} secretKey
 * @param {string} text
 * @returns {string} signature
 */
function sign(secretKey, text) {
    const sec = parseSecretKey(secretKey);
    const bintext = Buffer.from(text, 'utf8');
    const sig = nacl.sign.detached(bintext, sec.key);
    // Full signature includes algorithm id ('Ed'), key number,
    // and the signature itself.
    const fullsig = new Uint8Array(2 + 8 + 64);
    fullsig[0] = 69 // 'E'
    fullsig[1] = 100; // 'd'
    fullsig.set(sec.num, 2) // key number
    fullsig.set(sig, 10); // signature
    return Buffer.from(fullsig.buffer).toString('base64');
}

/**
 * Converts secretKey from base64-encoded representation
 * into a Uint8Array acceptable for nacl.sign.
 *
 * Returns an object with key num and secret key.
 *
 * {
 *   num: Uint8Array
 *   key: Uint8Array
 * }
 *
 * Throws if key format is incorrect.
 *
 * @param {string} secretKey
 * @returns {Object} object { num, key }
 */
function parseSecretKey(secretKey) {
    const k = Buffer.from(secretKey, 'base64');

    if (k.length < 2 + 2 + 4 + 16 + 8 + 8 + 64) {
        throw new Error('Incorrect secret key length');
    }

    // Check signature algorithm.
    if (k[0] !== 69 /* 'E' */ || k[1] !== 100 /* 'd' */) {
        throw new Error('Unknown signature algorithm');
    }

    // Check KDF algorithm
    if (k[2] !== 0 || k[3] !== 0) {
        throw new Error('Unsupported KDF algorithm');
    }

    // Extract fields.
    const checksum = k.subarray(24, 32);
    const num = k.subarray(32, 40);
    const key = k.subarray(40);

    // Verify key checksum.
    if (!nacl.verify(checksum, nacl.hash(key).subarray(0, 8))) {
        throw new Error('Key checksum verification failure');
    }

    return {
        num,
        key
    };
}

/**
 * Generates a new random signing key pair.
 * Returns {
 *  publicKey: string // base64-encoded public key in signify format
 *  secretKey: string // base64-encoded secret key in format suitable for sign()
 * }
 */
function generateKeyPair() {
    const plain = nacl.sign.keyPair();
    const num = nacl.randomBytes(8);

    const publicKey = new Uint8Array(2 + 8 + 32);
    const secretKey = new Uint8Array(2 + 2 + 4 + 16 + 8 + 8 + 64);

    publicKey[0] = secretKey[0] = 69; // 'E'
    publicKey[1] = secretKey[1] = 100; // 'd'

    publicKey.set(num, 2);
    secretKey.set(num, 32);

    publicKey.set(plain.publicKey, 10);
    secretKey.set(plain.secretKey, 40);

    const checksum = nacl.hash(plain.secretKey).subarray(0, 8);
    secretKey.set(checksum, 24)

    return {
        publicKey: Buffer.from(publicKey.buffer).toString('base64'),
        secretKey: Buffer.from(secretKey.buffer).toString('base64')
    };
}

module.exports = {
    verify,
    sign,
    generateKeyPair
};
