// @ts-check
/**
 * Update manifest parsing
 */
const semver = require('semver');
const signing = require('./signing');
const currentPlatform = require('./platform');

// Comment to add as a first line when creating a manifest.
// No need to verify that it exists, it's purely info for humans.
const COMMENT = 'Peerio Updater manifest';

// Update urgency constants.
const URGENCY_MANDATORY = 'mandatory'; // default
const URGENCY_OPTIONAL = 'optional';

class Manifest {
    /**
     * Creates a new manifest instance.
     * @param {string?} platform operating system
     */
    constructor(platform = currentPlatform()) {
        this.platform = platform;
        this.data = {};
    }

    // Accessors
    get version() {
        return this.data.version;
    }

    set version(value) {
        value = semver.valid(value);
        if (!value) {
            throw new Error(`Invalid version: invalid ${value}`)
        }
        this.data.version = value;
    }

    get urgency() {
        return this.data.urgency || URGENCY_MANDATORY;
    }

    set urgency(value) {
        this.data.urgency = value;
    }

    get date() {
        return new Date(this.data.date);
    }

    set date(value) {
        this.data.date = value.toISOString();
    }

    get changelog() {
        return this.data.changelog;
    }

    set changelog(value) {
        this.data.changelog = value;
    }

    _getPlatformField(platform, field) {
        platform = platform || this.platform;
        return this.data[`${platform}-${field}`];
    }

    _setPlatformField(platform, field, value) {
        platform = platform || this.platform;
        this.data[`${platform}-${field}`] = value;
    }

    getFile(platform) {
        return this._getPlatformField(platform, 'file');
    }

    getSize(platform) {
        return parseInt(this._getPlatformField(platform, 'size'), 10);
    }

    getSha512(platform) {
        return this._getPlatformField(platform, 'sha512');
    }

    setFile(platform, value) {
        return this._setPlatformField(platform, 'file', value);
    }

    setSize(platform, value) {
        return this._setPlatformField(platform, 'size', value);
    }

    setSha512(platform, value) {
        return this._setPlatformField(platform, 'sha512', value);
    }

    get file() {
        return this.getFile(this.platform);
    }

    get size() {
        return this.getSize(this.platform);
    }

    get sha512() {
        return this.getSha512(this.platform);
    }

    // No need for platform-specific setters, since
    // builder will generate all platforms.

    // Helpers

    get isMandatory() {
        return this.urgency === URGENCY_MANDATORY;
    }

    set isMandatory(value) {
        this.urgency = value ? URGENCY_MANDATORY : URGENCY_OPTIONAL;
    }

    isNewerVersionThan(currentVersion) {
        return semver.gt(this.version, currentVersion);
    }

    /**
     * Loads manifest from string, parses it,
     * and returns Manifest.
     *
     * @param {Array<string>} publicKeys signing public keys
     * @param {string} source string
     * @returns {Manifest}
     * @public
     */
    static loadFromString(publicKeys, source) {
        const manifest = new Manifest();
        manifest._deserialize(publicKeys, source);
        return manifest;
    }

    /**
     * Verifies signature and parses manifest.
     * Throws if signature is invalid or manifest validation fails.
     *
     * @param {string} source string
     */
    _deserialize(publicKeys, source) {
        // Parse lines.
        let lines = source.split('\n');

        if (lines.length < 3) {
            throw new Error(`Bad manifest`);
        }

        // First line is a untrusted comment, skip it.
        lines.shift();

        // Next line is signature. Extract it and verify.
        const sig = lines.shift();

        // Reconstruct text without command and signature
        // to verify it.
        const text = lines.join('\n');

        // Verify signature (throws if invalid).
        signing.verify(publicKeys, sig, text);

        // Trim and remove empty lines.
        lines = lines.map(line => line.trim()).filter(line => line.length > 0);

        // Parse lines as key-value pairs.
        const data = {};
        lines.forEach(line => {
            const split = line.indexOf(':');
            const key = line.substring(0, split).trim();
            const value = split > 0 ? line.substring(split + 1).trim() : '';
            data[key] = value;
        });

        this._validate(data);
        this.data = data;
    }

    /**
     * Validates manifest data.
     * Throws if validation fails.
     *
     * @param {Object<string, string>} data
     * @throws
     * @private
     */
    _validate(data) {
        if (!data.version || !semver.valid(data.version)) {
            throw new Error(`Invalid version: ${data.version}`);
        }
    }

    /**
     * @returns {string}
     * @private
     */
    serialize(secretKey) {
        // Copy data.
        const d = Object.assign({}, this.data);

        if (!d.version) {
            throw new Error('Version is empty');
        }

        const lines = [
            '' // start with empty line for readability
        ];
        const add = (k, v) => lines.push(`${k}: ${v}`);

        // Initial keys will be serialized first in the given order.
        const initialKeys = [
            'version',
            'urgency',
            'date',
            'changelog',
        ];

        // Add initial keys.
        initialKeys.forEach(key => {
            const value = d[key];
            if (value) add(key, value);
            delete d[key];
        })

        // Add the rest of the keys after empty line, in sort order.
        let group = '';
        Object.keys(d).sort().forEach(key => {
            const value = d[key];
            if (value) {
                const newgroup = key.substring(0, key.indexOf('-'));
                if (group !== newgroup) {
                    lines.push(''); // insert empty line
                }
                group = newgroup;
                add(key, value);
            }
        });

        lines.push(''); // empty line to make file end with new line
        const text = lines.join('\n')

        // Sign, comment and prepend signature.
        const sig = signing.sign(secretKey, text);
        return `untrusted comment: ${COMMENT}\n${sig}\n${text}`;
    }
}

module.exports = Manifest;
