// @ts-check

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, exec, spawn } = require('child_process');
const { app } = require('electron');

/**
 * Note: deleteAfterInstall is ignored, because we always move
 * the .app into the original location, not copy.
 */
async function install(updatePath, restart, deleteAfterInstall) {
    console.log('Installing update');
    const appPath = getOriginalAppPath();
    console.log('Extracting ZIP file');
    await unzip(updatePath);
    // Extracted path name is .zip directory + original .app filename
    // This means that ZIP must contain the same app name as original
    // for the update to work.
    const appUpdatePath = path.join(path.dirname(updatePath), path.basename(appPath));
    console.log('Dropping quarantine');
    await dropQuarantine(updatePath);

    // Check if we need to elevate privileges to replace file.
    let uid = null;
    try {
        uid = await getDirectoryUidIfCannotModify(path.dirname(appPath));
    } catch (e) {
        console.error(e); // stat failed? will just try to replace it
    }
    if (appPath === "" || appPath === "/" || !appPath.endsWith(".app")) {
        // For safety.
        console.error("Bad app path; aborting.");
        return;
    }
    if (uid == null) {
        // No, we can just replace the file.
        await replaceFile(appUpdatePath, appPath);
    } else {
        // Yes, we need to elevate privileges.
        await elevatePrivilegesAndReplaceFile(uid, appUpdatePath, appPath);
    }
    console.log('Update successfully installed');
    if (restart) {
        console.log('Launching updated instance');
        launchDetachedInstance(appPath);
    }
    setTimeout(() => {
        console.log('Quitting');
        app.quit();
    });
}

function getOriginalAppPath() {
    // We have: /path/to/Electron.app/Contents/MacOS/Electron
    // We need: /path/to/Electron.app
    return path.dirname(path.dirname(path.dirname(app.getPath('exe'))));
}

function unzip(zipPath) {
    return new Promise((fulfill, reject) => {
        execFile('/usr/bin/unzip', ['-q', '-o', zipPath], {
            cwd: path.dirname(zipPath)
        }, (err, stdout, stderr) => {
            if (stderr) console.error(stderr);
            if (stdout) console.log(stdout);
            if (err) {
                return reject(err)
            }
            fulfill();
        });
    });
}

function dropQuarantine(filePath) {
    return new Promise((fulfill, reject) => {
        execFile('/usr/bin/xattr', ['-d', '-r', 'com.apple.quarantine', filePath], (err, stdout, stderr) => {
            if (stderr) console.error(stderr);
            if (stdout) console.log(stdout);
            if (err) {
                return reject(err)
            }
            fulfill(filePath);
        });
    });
}

function replaceFile(src, dest) {
    return new Promise((fulfill, reject) => {
        // Rename syscall doesn't work for overwriting directories,
        // so we need to remove destination directory first.
        // This is not atomic :-(
        const rm = shellescape(['rm', '-rf', dest]);
        const mv = shellescape(['mv', '-f', src, dest]);
        exec(`${rm} && ${mv}`, (err, stdout, stderr) => {
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
        const qsrc = src.replace(/"/g, '\\"'); // escape for AppleScript
        const qdst = dest.replace(/"/g, '\\"');  // escape for AppleScript
        execFile('/usr/bin/osascript', [
            '-e',
            `do shell script "rm -rf " & quoted form of "${qdst}" & " && mv -f " & quoted form of "${qsrc}" & space & quoted form of "${qdst}" with administrator privileges`
        ], (err, stdout, stderr) => {
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

function launchDetachedInstance(programPath) {
    const child = spawn('open', ['-n', programPath], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
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
