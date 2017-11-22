// @ts-check

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, exec, spawn } = require('child_process');
const { app } = require('electron');

async function install(updatePath, restart) {
    console.log('Installing update');
    const appPath = getOriginalAppPath();
    await dropQuarantine(updatePath);

    // Check if we need to elevate privileges to replace file.
    let uid = null;
    try {
        uid = await getDirectoryUidIfCannotModify(path.dirname(appPath));
    } catch (e) {
        console.error(e); // stat failed? will just try to replace it
    }
    if (uid == null) {
        // No, we can just replace the file.
        await replaceFile(updatePath, appPath);
    } else {
        // Yes, we need to elevate privileges.
        await elevatePrivilegesAndReplaceFile(uid, updatePath, appPath);
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

function dropQuarantine(filePath) {
    return new Promise((fulfill, reject) => {
        execFile('/usr/bin/xattr', ['-c', filePath], (err, stdout, stderr) => {
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
        exec(`osascript -e "do shell script \" ${mv}\" with administrator privileges"`, (err, stdout, stderr) => {
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
            const { uid, gid } = os.userInfo();
            if (
                // Directory is owned by user and user can write to it.
                (stats.uid == uid && ((stats.mode & fs.constants.S_IWUSR) === fs.constants.S_IWUSR)) ||
                // or directory is owned by user's group and group can write to it.
                (stats.gid == gid && ((stats.mode & fs.constants.S_IWGRP) === fs.constants.S_IWGRP)) ||
                // or directory is world-writable
                ((stats.mode & fs.constants.S_IWOTH) === fs.constants.S_IWOTH)
            ) {
                fulfill(null); // user can modify directory
            } else {
                fulfill(stats.uid);
            }
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
