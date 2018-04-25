// @ts-check
const semver = require('semver');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const EventEmitter = require('events').EventEmitter;
const mkdirp = require('mkdirp');
const { fetchJSON, fetchAllJSONPages, fetchText, fetchFile } = require('./fetch');
const { verifyHash } = require('./hash');
const { verifySize } = require('./size');
const Manifest = require('./manifest');
const currentPlatform = require('./platform');

/** Manifest filename in GitHub releases */
const MANIFEST_FILENAME = 'manifest.txt';

/** Check intervals */
const DEFAULT_INTERVAL = 10 * 60 * 60 * 1000; // 10 hours
const MIN_INTERVAL = 15 * 60 * 1000; // 15 minutes

/**
 * Update info file stores the information
 * about update before attempting installation
 * in the downloads directory.
 */
const UPDATE_INFO_FILENAME = 'update-info.json';

class Updater extends EventEmitter {
    /**
     * A manifest URL can be an actual URL to manifest,
     * e.g. https://example.com/latest-manifest.txt
     * or a GitHub repository 'github:username/repo',
     * which must contain MANIFEST_FILENAME in release assets.
     *
     * Accepts options argument with the following parameters:
     *
     * @typedef {Object} UpdaterConfig
     * @property {string} version current semver version (1.0.0)
     * @property {Array<string>} publicKeys public keys for manifest verification
     * @property {Array<string>} manifests manifest URLs as described above
     * @property {boolean} nightly if true, uses a different "nightly" installer for Mac
     *
     * @param {UpdaterConfig} config updater configuration
     */
    constructor(config) {
        super();
        this.currentVersion = semver.valid(config.version);
        if (!this.currentVersion) {
            throw new Error(`Not a valid semver version: ${this.currentVersion}`);
        }
        this.manifestURLs = config.manifests;
        if (this.manifestURLs.length === 0) {
            throw new Error('No manifest URLs given');
        }
        this.publicKeys = config.publicKeys;
        if (this.publicKeys.length === 0) {
            throw new Error('No public keys given');
        }
        this.nightly = !!config.nightly;
        this.allowPrerelease = false;
        this.newVersion = null;
        this.downloadedFile = null;
        this.autoInstall = true;

        this.checking = false;
        this.downloading = false;

        this._directory = path.join(os.tmpdir(), 'peerio-updates');
    }

    /**
     * Sets directory for storing downloads.
     *
     * @param {string} directory directory for downloads
     */
    setDownloadsDirectory(directory) {
        this._directory = directory;
    }

    /**
     * Returns directory for storing downloads.
     */
    getDownloadsDirectory() {
        return this._directory;
    }

    /**
     * Checks for new update.
     *
     * Emits one of:
     *  'update-available'
     *  'update-not-available'
     *  'error'
     *
     * @param {number?} manifestURLIndex - optional manifest URL index to check
     */
    async checkForUpdates(manifestURLIndex = 0) {
        this.lastCheckTime = new Date();
        this.checking = true;
        this.emit('checking-for-update');
        try {
            if (await this._check()) {
                this.emit('update-available', this.newVersion);
                if (!this.downloading && !this.downloadedFile) {
                    // Start download automatically.
                    // Don't care to await it, since it's event-based.
                    this._downloadUpdate();
                }
            } else {
                this.emit('update-not-available');
            }
        } catch (err) {
            this.emit('error', err);
        }
    }

    /**
     * Downloads the update.
     *
     * Emits one of:
     *   'update-downloaded'
     *   'error'
     *
     * @param {string?} [platform] optional platform. Current platform by default.
     */
    async _downloadUpdate(platform) {
        try {
            await this._download()
            this.emit('update-downloaded', this.downloadedFile, this.newVersion);
        } catch (err) {
            this.emit('error', err);
        }
    }

    /**
     * Checks for updates periodically.
     * By default, every 10 hours.
     *
     * @param {number?} [interval] check interval in milliseconds
     */
    checkPeriodically(interval) {
        if (this._intervalId) {
            this.stopCheckingPeriodically();
        }
        if (interval == null) interval = DEFAULT_INTERVAL;
        if (interval < MIN_INTERVAL) interval = MIN_INTERVAL;
        this._intervalId = setInterval(() => { this.checkForUpdates(); }, interval);
    }

    stopCheckingPeriodically() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
        }
    }

    /**
     * Checks for new update.
     *
     * Returns a promise resolving to manifest if the new version is found,
     * to null if it's not found; throws if there was an error.
     *
     * Also sets this.newVersion to the new update if it was found.
     *
     * @param {number?} manifestURLIndex - optional manifest URL index to check
     * @returns {Promise<Manifest|null>}
     */
   async _check(manifestURLIndex = 0) {
        this.lastCheckTime = new Date();
        this.checking = true;

        try {
            const manifest = await this._fetchManifest(this.manifestURLs[manifestURLIndex]);
            this.checking = false;
            if (manifest && manifest.isNewerVersionThan(this.currentVersion)) {
                console.log(`Updater: new version ${manifest.version}`);
                this.newVersion = manifest;
                return manifest;
            }
            return null;
        } catch (err) {
            if (manifestURLIndex < this.manifestURLs.length - 1) {
                return await this._check(manifestURLIndex + 1); // try next URL
            } else {
                this.checking = false;
                console.log('Error checking for update: ', err);
                throw new Error(`Error checking for update: ${err}`);
            }
        }
    }

    _fetchManifest(address) {
        if (address.startsWith('github:')) {
            return this._fetchManifestFromGitHub(address);
        } else {
            console.log('Fetching', address);
            return fetchText(address).then(text => {
                console.log('Loading manifest');
                return Manifest.loadFromString(this.publicKeys, text)
            });
        }
    }

    _fetchManifestFromGitHub(address) {
        // Address given: github:PeerioTechnologies/peerio-desktop
        // Strip 'github:'
        address = address.substring('github:'.length);
        address = `https://api.github.com/repos/${address}/releases`;

        // Fetch info about latest release
        let promisedRelease;
        if (!this.allowPrerelease) {
            // No prereleases, so use a simple API endpoint which returns latest release.
            console.log(`Fetching ${address}/latest`);
            promisedRelease = fetchJSON(address + '/latest');
        } else {
            // Prereleases require fetching all releases and finding the latest.
            console.log(`Fetching ${address}`);
            promisedRelease = fetchAllJSONPages(address)
                .then(releases => releases.reduce((newest, cur) => {
                    if (!newest || semver.gt(cur.tag_name, newest.tag_name)) {
                        return cur;
                    } else {
                        return newest;
                    }
                }, null));
        }

        return promisedRelease.then(release => {
            if (!release) {
                console.log('No releases on GitHub');
                return;
            }
            console.log('Got release', release);
            // GitHub can lie to us about the latest version, but if they do, they
            // could also not serve the latest manifest, so there's no harm in
            // checking this unsigned version number.
            if (semver.gt(release.tag_name, this.currentVersion)) {
                // Find manifest.
                for (let i = 0; i < release.assets.length; i++) {
                    if (release.assets[i].name === MANIFEST_FILENAME) {
                        return this._fetchManifest(release.assets[i].browser_download_url);
                    }
                }
                throw new Error(`Release ${release.tag_name} doesn't have ${MANIFEST_FILENAME}`);
            } else {
                console.log(`No new version on GitHub: have ${this.currentVersion} got ${release.tag_name} `)
            }
        });
    }


    async _download(platform) {
        if (this.downloading) {
            throw new Error('Download is already in progress')
        }
        if (!this.newVersion) {
            throw new Error('No new version to download');
        }
        const address = this.newVersion.getFile(platform);
        const size = this.newVersion.getSize(platform);
        const hash = this.newVersion.getSha512(platform);
        if (address == null || size == null || hash == null) {
            throw new Error('No file in manifest for the current platform');
        }
        const tmpfile = path.join(
            this._directory,
            `peerio-update-${crypto.randomBytes(10).toString('hex')}.tmp`
        );
        this.downloading = true;
        console.log('Fetching file', address);

        try {
            await this._createDownloadsDirectory();
            await fetchFile(address, tmpfile);
            await verifySize(size, tmpfile);
            await verifyHash(hash, tmpfile);
            this.downloading = false;
            this.downloadedFile = tmpfile;
            if (this.autoInstall) {
                // setup exit hook to install this update
                this._setupExitHook();
            }
            return tmpfile;
        } catch (err) {
            this.downloading = false;
            console.log('Error downloading update:', err);
            throw err;
        }
    }

    _setupExitHook() {
        if (this._exitHookInstalled) {
            return;
        }

        if (process.versions && process.versions.electron) {
            const { app } = require('electron');
            app.once('before-quit', ev => {
                console.log('Called before-quit hook');
                ev.preventDefault();
                this._install();
            });
        } else {
            process.on('exit', () => {
                this._install();
            });
        }
        console.log('Set up before-quit hook');
        this._exitHookInstalled = true;
    }

    _createDownloadsDirectory() {
        return new Promise((fulfill, reject) => {
            mkdirp(this._directory, err => {
                // Note: it's not an error if the directory already exists,
                // (mkdirp just reports success, which is good.)
                if (err) {
                    reject(err);
                    return;
                }
                fulfill(this._directory);
            });
        });
    }

    _getUpdateInfoFilePath() {
        return path.join(this._directory, UPDATE_INFO_FILENAME);
    }

    _rememberInstallAttempt() {
        const info = {
            attempts: 0, // TODO: implement attempt counter
            currentVersion: this.currentVersion,
            updateVersion: this.newVersion.version,
            updateSize: this.newVersion.getSize(),
            updateHash: this.newVersion.getSha512(),
            updateFile: this.downloadedFile
        };
        return new Promise((fulfill, reject) => {
            fs.writeFile(this._getUpdateInfoFilePath(), JSON.stringify(info), err => {
                if (err) {
                    // Can't write install attempt for some reason.
                    // Log the error and continue.
                    console.error('Failed to write install attempt info: ', err);
                }
                fulfill();
            });
        });
    }

    _readUpdateInfoFile() {
        return new Promise((fulfill, reject) => {
            fs.readFile(this._getUpdateInfoFilePath(), (err, data) => {
                if (err) {
                    reject(err);
                    return;
                }
                let info;
                try {
                    info = JSON.parse(data.toString('utf-8'));
                } catch (ex) {
                    reject(ex);
                    return;
                }
                if (!info || !info.currentVersion) {
                    reject(new Error('Update info is invalid'));
                    return;
                }
                fulfill(info);
            });
        });
    }

    /**
     * Returns a promise resolving to true if previous update failed.
     * Should be used after starting a new version.
     *
     * @returns {Promise<boolean>}
     */
    didLastUpdateFail() {
        return this._readUpdateInfoFile()
            .then(info => {
                console.log('Found update installation info', info);
                // If we're running the same version as one before updating,
                // the update failed.
                return (info && (info.currentVersion === this.currentVersion));
            })
            .catch(err => {
                // If there's an error (file doesn't exist, can't be read,
                // or JSON can't be parsed), we assume update succeeded.
                console.log('Update succeeded');
                return false;
            });
    }

    /**
     * Remove update artifacts.
     * Should be used after starting a new version.
     *
     * Will ignore any filesystem errors, as this is best-effort.
     */
    async cleanup() {
        console.log('Update is running cleanup');
        let info;
        try {
            info = await this._readUpdateInfoFile();
        } catch (err) {
            // No update info file or reading/parsing it failed,
            // assume we don't need to cleanup.
            return;
        }
        try {
            // Delete old downloaded update file.
            // Make sure the file is inside our downloads
            // directory, for safety.
            if (info.updateFile.startsWith(this._directory)) {
                console.log('Deleting update file:', info.updateFile);
                await deleteFile(info.updateFile);
            }
            // Delete update info.
            console.log('Deleting update info:', this._getUpdateInfoFilePath());
            await deleteFile(this._getUpdateInfoFilePath());
        } catch (err) {
            console.error('Cleanup failed:', err);
        }
    }

    _install() {
        if (!this.downloadedFile) {
            console.warn('No update to install');
            return;
        }
        console.log('Updater is installing update');
        let install;
        switch (process.platform) {
            case 'darwin':
                if (this.nightly) {
                    install = require('./install-mac-nightly');
                } else {
                    install = require('./install-mac');
                }
                break;
            case 'win32':
                install = require('./install-win');
                break;
            case 'linux':
                install = require('./install-linux');
                break;
            default:
                throw new Error('Unknown platform ' + currentPlatform());
        }
        install(this.downloadedFile, !!this.restart);
    }

    async scheduleInstallOnQuit() {
        this.restart = false;
        await this._rememberInstallAttempt();
        this._setupExitHook();
    }

    /**
     * Installs the update and restarts the app.
     */
    async quitAndInstall() {
        this.restart = true;
        await this._rememberInstallAttempt();
        this._setupExitHook();
        if (process.versions && process.versions.electron) {
            const { app } = require('electron');
            if (process.platform === 'linux') {
                // On Linux, we need to schedule restart here,
                // not in the hook, due to AppImage quirks.
                app.relaunch({
                    args: process.argv.slice(1),
                    execPath: process.env.APPIMAGE
                });
            }
            app.quit();
        } else {
            process.exit(0);
        }
    }

    /**
     * Retries installing the downloaded update, or
     * redownloads the update, and restarts the app.
     */
    async quitAndRetryInstall(allowLocal = true) {
        try {
            this.downloadedFile = await this._getValidUpdateFileOnDisk();
            this.quitAndInstall();
        } catch (err) {
            // Try checking for and downloading the update.
            try {
                if (!await this._check()) {
                    // No update is found... strange.
                    // Restart anyway by throwing exception.
                    throw new Error('No update found');
                }
                await this._download();
                // Success, try installing the update.
                this.quitAndInstall();
            } catch (ex) {
                // TODO: record another failed attempt.
                await this._rememberInstallAttempt();
                if (process.versions && process.versions.electron) {
                    const { app } = require('electron');
                    app.relaunch(); // TODO: check if AppImage needs different execPath
                    app.quit();
                } else {
                    process.exit(0); // won't relaunch if not in Electron (for tests)
                }
            }
        }
    }

    /**
     * Returns a promise resolving to the path of update file
     * on disk if and only if it is valid according to info
     * stored in the update info file; otherwise, throws.
     */
    async _getValidUpdateFileOnDisk() {
        let info = await this._readUpdateInfoFile();
        if (!info || info.updateSize || !info.updateHash || !info.updateFile) {
            throw new Error('Invalid update info');
        }
        await verifySize(info.updateSize, info.updateFile);
        await verifyHash(info.updateHash, info.updateFile);
        // Make sure update file is in our downloads directory.
        if (!info.updateFile.startsWith(this._directory)) {
            throw new Error(`Invalid update file path: ${info.updateFile}`);
        }
        return info.updateFile;
    }
}

function deleteFile(filename) {
    return new Promise((fulfill, reject) => {
        fs.unlink(filename, err => {
            if (err) {
                reject(err);
                return;
            }
            fulfill();
        })
    });
}

module.exports = Updater;
