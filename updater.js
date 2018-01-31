// @ts-check
const semver = require('semver');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const EventEmitter = require('events').EventEmitter;
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

class Updater extends EventEmitter {
    /**
     *
     * A manifest URL can be an actual URL to manifest,
     * e.g. https://example.com/latest-manifest.txt
     * or a GitHub repository 'github:username/repo',
     * which must contain MANIFEST_FILENAME in release assets.
     *
     * @param {string} currentVersion semver version (1.0.0)
     * @param {Array<string>} publicKeys array of public keys for manifest verification
     * @param {Array<string>} manifestURLs array of manifest URLs as described above
     * @param {boolean} nightly if true, uses a different "nightly" installer for Mac
     */
    constructor(currentVersion, publicKeys, manifestURLs, nightly = false) {
        super();
        currentVersion = semver.valid(currentVersion);
        if (!currentVersion) {
            throw new Error(`Not a valid semver version: ${currentVersion}`);
        }
        if (manifestURLs.length === 0) {
            throw new Error('No manifest URLs given');
        }
        if (publicKeys.length === 0) {
            throw new Error('No public keys given');
        }
        this.currentVersion = currentVersion;
        this.manifestURLs = manifestURLs;
        this.publicKeys = publicKeys;
        this.nightly = nightly;
        this.allowPrerelease = false;
        this.manifest = null;
        this.newVersion = null;
        this.downloadedFile = null;
        this.checking = false;
        this.downloading = false;
        this.autoInstall = true;
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
    checkForUpdates(manifestURLIndex = 0) {
        this.lastCheckTime = new Date();
        this.checking = true;
        this.emit('checking-for-update');
        return this._fetchManifest(this.manifestURLs[manifestURLIndex])
            .then(manifest => {
                this.checking = false;
                if (manifest && manifest.isNewerVersionThan(this.currentVersion)) {
                    console.log(`Updater: new version ${manifest.version}`);
                    this.newVersion = manifest;
                    this.emit('update-available', this.manifest);
                    this._download(); // start download automatically
                } else {
                    this.emit('update-not-available');
                }
                return manifest;
            })
            .catch(err => {
                if (manifestURLIndex < this.manifestURLs.length - 1) {
                    return this.checkForUpdates(manifestURLIndex + 1); // try next URL
                } else {
                    this.checking = false;
                    console.log('Error checking for update: ', err);
                    this.emit('error', err);
                }
            });
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

    /**
     * Downloads the update.
     *
     * @param {string?} [platform] optional platform. Current platform by default.
     */
    _download(platform) {
        if (!this.newVersion) {
            return Promise.reject(new Error('No new version to download'));
        }
        const address = this.newVersion.getFile(platform);
        const size = this.newVersion.getSize(platform);
        const hash = this.newVersion.getSha512(platform);
        if (address == null || size == null || hash == null) {
            return Promise.reject(new Error('No file in manifest for the current platform'));
        }
        // TODO: check if there's a better temporary location to use
        const tmpfile = path.join(
            os.tmpdir(),
            `peerio-updater-${crypto.randomBytes(10).toString('hex')}.tmp`
        );
        this.downloading = true;
        console.log('Fetching file', address);
        return fetchFile(address, tmpfile)
            .then(() => verifySize(size, tmpfile))
            .then(() => verifyHash(hash, tmpfile))
            .then(() => {
                this.downloading = false;
                this.downloadedFile = tmpfile;
                this.emit('update-downloaded', this.downloadedFile);
                if (this.autoInstall) {
                    // setup exit hook to install this update
                    this._setupExitHook();
                }
                return tmpfile;
            })
            .catch(err => {
                this.downloading = false;
                console.log('Error downloading update:', err);
                this.emit('error', err);
            });
    }

    _setupExitHook() {
        if (this._exitHookInstalled)
            return;

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

    _install() {
        if (!this.downloadedFile) return;
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

    quitAndInstall() {
        this.restart = true;

        this._setupExitHook();
        if (process.versions && process.versions.electron) {
            const { app } = require('electron');
            if (process.platform === 'linux') {
                // On Linux, we need to schedule restart here due to AppImage quirks.
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
}

module.exports = Updater;
