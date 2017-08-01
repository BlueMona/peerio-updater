// @ts-check
/*

Parts taken from
https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater

Author: Vladimir Krivosheev

Copyright (c) 2015 Loopline Systems

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

const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

async function install(updatePath, restart) {
    console.log('Installing update');
    const args = ['--updated', '/S'];
    if (restart) {
        args.push('--force-run');
    }

    // See https://github.com/electron-userland/electron-builder/blob/83ca284c4727bf48b45de56d27f9fe2da16e1b41/packages/electron-updater/src/NsisUpdater.ts#L203-L223
    let failed = false;
    try {
        spawn(updatePath, args, { detached: true, stdio: 'ignore' }).unref();
    } catch (err) {
        if (err.code === 'UNKNOWN' || err.code === 'EACCES') {
            console.log('Trying to install with elevated privileges');
            try {
                spawn(path.join(process.resourcesPath, "elevate.exe"),
                    [updatePath].concat(args)).unref();
            } catch (err) {
                failed = true;
                console.error('Failed to install update with elevated priveleges: ' + err.code);
            }
        } else {
            failed = true;
            console.error('Failed to install update: ' + err.code);
        }
    }
    setTimeout(() => {
        console.log('Quitting');
        if (failed && restart) {
            // Failed to install update, so start the same version.
            app.restart();
        } else {
            app.quit();
        }
    });
}

module.exports = install;
