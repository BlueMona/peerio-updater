// @ts-check
const fs = require('fs');
const path = require('path');
const Updater = require('./updater');
const { app } = require('electron');

/*

 config = {
     version: "1.0.0",
     publicKeys: [
         "xxx...",
         "yyy..."
     ],
     manifests: [
         "github:bla/bla"
         "https://example.com/manifest.txt"
     ]
 }

or in package.json

{
    ...
    "version": "1.0.0", // as usual
    "updater": {
        publicKeys: ...,
        manifests: ...
    }
}

*/

function init(config) {
    if (!config) config = getConfigFromPackageJSON();
    if (!config.version || !config.publicKeys || !config.manifests) {
        throw new Error('Malformed updater config');
    }
    return new Updater(config.version, config.publicKeys, config.manifests, config.nightly);
}

function getConfigFromPackageJSON() {
    // See https://github.com/electron/electron/blob/v1.7.4/lib/browser/init.js#L103
    const pkg = require(path.join(app.getAppPath(), 'package.json'));
    if (!pkg) {
        throw new Error(`Unable to find package.json (resources path: ${process.resourcesPath})`);
    }
    if (!pkg.updater || !pkg.updater.publicKeys || !pkg.updater.manifests) {
        throw new Error('Malformed or missing "updater" in package.json');
    }
    return {
        version: pkg.version,
        publicKeys: pkg.updater.publicKeys,
        manifests: pkg.updater.manifests,
        nightly: !!pkg.updater.nightly
    };
}

module.exports = init;
