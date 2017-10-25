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
const { execFile, spawn } = require('child_process');
const { app } = require('electron');

async function install(updatePath, restart) {
    console.log('Installing update');
    const appImagePath = await getOriginalAppImagePath();
    await setExecFlag(updatePath);
    await replaceFile(updatePath, appImagePath);
    console.log('Update successfully installed');
    if (restart) {
        // TODO: doesn't work: prevents this instance from quitting
        // so comment-out until we find a way.
        // console.log('Launching updated instance');
        // launchDetachedInstance(appImagePath);
    }
    setTimeout(() => {
        console.log('Quitting');
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
                return reject(`Cannot write update to ${appImagePath}`);
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

function launchDetachedInstance(programPath) {
    const child = spawn('setsid', [programPath], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
}

module.exports = install;
