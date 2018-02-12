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

const fs = require('fs');
const http = require('http');
const { app, autoUpdater } = require('electron');

async function install(updatePath, restart, deleteAfterInstall) {
    console.log('Installing update');

    // We use the build-in updater for Mac installation for now, by creating a
    // local server serving update to it. This is what electron-updater does,
    // but this should be changed in the long-term: while it simplifies dealing
    // with macOS-specific stuff, it's not a good design.

    const server = http.createServer();
    const getServerURL = () => 'http://' + server.address().address + ':' + server.address().port;

    server.on('close', () => {
        console.log('Local update server closed.');
    });

    server.on('request', (req, resp) => {
        switch (req.url) {
            case '/':
                // Serve JSON with file URL.
                const data = Buffer.from(JSON.stringify({ url: getServerURL() + '/app.zip' }));
                resp.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Content-Length': data.length
                });
                resp.end(data);
                break;

            case '/app.zip':
                // Serve file.
                fs.stat(updatePath, (err, stats) => {
                    if (err) {
                        resp.writeHead(500, { 'Content-Type': 'text/plain' });
                        resp.end('File stat error: ' + err + ' for ' + updatePath);
                        return;
                    }
                    resp.writeHead(200, {
                        'Content-Type': 'application/octet-stream',
                        'Content-Disposition': 'attachment; filename=app.zip',
                        'Content-Length': stats.size
                    });
                    fs.createReadStream(updatePath)
                        .pipe(resp)
                        .on('error', err => {
                            updateFailed('Failed to send file to native updater: ' + err);
                        });
                });
                break;

            default:
                // Unexpected URL.
                resp.writeHead(404, { 'Content-Type': 'text/plain' });
                resp.end('Bad request URL: ' + req.url);
        }
    });

    server.listen(0, '127.0.0.1', 16, () => {
        autoUpdater.setFeedURL(getServerURL(), { "Cache-Control": "no-cache" });
        autoUpdater.once('error', err => {
            updateFailed('Native updater error: ' + err);
        });
        autoUpdater.once('update-not-available', () => {
            updateFailed('Native updater failed to discover update');
        });
        autoUpdater.once('update-available', () => {
            console.log('Native updater discovered update');
        });
        autoUpdater.once('update-downloaded', () => {
            server.close();
            // Delete original update file.
            try {
                if (deleteAfterInstall) {
                    fs.unlinkSync(updatePath);
                }
            } catch (err) {
                console.error('Failed to delete update file');
                // continue updating even if failed to delete
            }
            // TODO: handle the case when we don't need to restart.
            autoUpdater.quitAndInstall();
        });
        autoUpdater.checkForUpdates();
    });

    function updateFailed(reason) {
        server.close();
        console.error(reason);
        setTimeout(() => {
            if (restart) {
                // Failed to install update, so start the same version.
                app.relaunch();
            } else {
                app.quit();
            }
        });
    }
}

module.exports = install;
