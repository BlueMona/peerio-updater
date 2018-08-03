// @ts-check
/*

Parts taken from
https://github.com/megahertz/electron-simple-updater/blob/master/lib/linux.js

The MIT License (MIT)

Copyright (c) 2016 Alexey Prokhorov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, exec } = require('child_process');
const { app } = require('electron');

async function install(updatePath, restart) {
    console.log('Installing update');
    const appImagePath = await getOriginalAppImagePath();
    await setExecFlag(updatePath);

    // Check if we need to elevate privileges to replace file.
    let uid = null;
    try {
        uid = await getDirectoryUidIfCannotModify(path.dirname(appImagePath));
    } catch (e) {
        console.error(e); // stat failed? will just try to replace it
    }
    if (uid == null) {
        // No, we can just replace the file.
        await replaceFile(updatePath, appImagePath);
    } else {
        // Yes, we need to elevate privileges.
        await elevatePrivilegesAndReplaceFile(uid, updatePath, appImagePath);
    }
    console.log('Update successfully installed');
    setTimeout(() => {
        console.log('Quitting');
        // Note: restaring is not handled here, in the hook, it's scheduled in updater.js.
        app.quit();
    });
}

function getOriginalAppImagePath() {
    const appImagePath = process.env.APPIMAGE;
    return new Promise((fulfill, reject) => {
        if (!appImagePath) {
            return reject('It seems that the app is not in AppImage format');
        }
        fs.access(appImagePath, fs.constants.F_OK, (err) => {
            if (err) {
                return reject(`AppImage file not found at ${appImagePath}`);
            }
            fulfill(appImagePath);
        });
    });
}

function setExecFlag(filePath) {
    return new Promise((fulfill, reject) => {
        fs.access(filePath, fs.constants.X_OK, (err) => {
            if (!err) {
                // Already executable.
                return fulfill(filePath);
            }
            fs.chmod(filePath, '0755', (err) => {
                if (err) {
                    return reject(`Could not make a file ${filePath} executable`);
                }
                fulfill(filePath);
            });
        });
    });
}

function replaceFile(src, dest) {
    return new Promise((fulfill, reject) => {
        fs.rename(src, dest, (err) => {
            if (err) {
                // Files are probably on a different filesystem, so rename
                // syscall doesn't work. Try renaming using /bin/mv.
                execFile('/bin/mv', ['-f', src, dest], (err, stdout, stderr) => {
                    if (stderr) console.error(stderr);
                    if (stdout) console.log(stdout);
                    if (err) {
                        return reject(err)
                    }
                    fulfill(dest);
                });
                return;
            }
            fulfill(dest);
        });
    });
}

/**
 * Asks the user for password of the destination directory
 * owner and moves the source file into the destination
 * file with elevated privileges.
 *
 * Uses `pkexec` to ask for password/elevate privileges.
 *
 * @param {number} uid destination directory owner uid
 * @param {string} src source file path
 * @param {string} dest destination file path
 */
function elevatePrivilegesAndReplaceFile(uid, src, dest) {
    return new Promise((fulfill, reject) => {
        const mv = shellescape(['mv', '-f', src, dest]);
        exec(`pkexec --user $(id -nu ${+uid}) ${mv}`, (err, stdout, stderr) => {
            if (stderr) console.error(stderr);
            if (stdout) console.log(stdout);
            if (err) {
                return reject(err)
            }
            fulfill(dest);
        });
    });
}

/**
 * Check if the current process can modify the directory
 * (i.e. rename files in it). Returns promise resolving
 * to uid of the directory if it CANNOT modify, otherwise
 * resolving to null.
 *
 * Rejects if stat call on the directory fails or the
 * path is not a directory.
 *
 * @param {string} dir path to directory
 * @returns {Promise<number | null>}
 */
function getDirectoryUidIfCannotModify(dir) {
    return new Promise((fulfill, reject) => {
        fs.stat(dir, (err, stats) => {
            if (err) {
                return reject(err);
            }
            if (!stats.isDirectory()) {
                return reject(new Error('Not a directory'));
            }
            fs.access(dir, fs.constants.W_OK, err => {
                if (err) {
                    // user can't write to this directory
                    fulfill(stats.uid);
                    return;
                }
                fulfill(null); // user can write to this directory
            });
        })
    });
}

// Copied from
// https://github.com/xxorax/node-shell-escape
// MIT License
/**
 * Escapes an array of arguments good for use with shell.
 * @param {Array<string>} a array of strings
 */
function shellescape(a) {
    var ret = [];
    a.forEach(function (s) {
        if (/[^A-Za-z0-9_\/:=-]/.test(s)) {
            s = "'" + s.replace(/'/g, "'\\''") + "'";
            s = s.replace(/^(?:'')+/g, '') // unduplicate single-quote at the beginning
                .replace(/\\'''/g, "\\'"); // remove non-escaped single-quote if there are enclosed between 2 escaped
        }
        ret.push(s);
    });
    return ret.join(' ');
}


module.exports = install;
