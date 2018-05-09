const expect = require('chai').expect;
const fs = require('fs');
const Updater = require('../updater');

describe('Updater', () => {
    it('should check for updates', function (done) {
        this.timeout(10000);
        const updater = new Updater({
            version: '1.0.0',
            publicKeys: ['RWRmSs9OkM8MtW1xBavNyjCxdcjwpnabs690k2y7+0SJuryXOeKtelwr'],
            // secret key: RWQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJz9MEdpVP/1mSs9OkM8MtQtUSSaMApafaQk4MTVEts9mp7HzG9BcC+nVJZ/cX46rbXEFq83KMLF1yPCmdpuzr3STbLv7RIm6vJc54q16XCs=
            manifests: ['github:dchest/updater-test-repo']
        });
        updater.on('update-available', () => {
            console.log('Update available:', updater.newVersion);
        });
        updater.on('error', err => {
            done(err);
        });
        updater.on('update-downloaded', file => {
            console.log('Downloaded update:', file);
            if (file) {
                fs.unlinkSync(file);
                console.log('(Deleted update file)');
            }
            done();
        });
        updater.checkForUpdates();
    });
});
