const expect = require('chai').expect;
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { verifyHash } = require('../hash');

describe('Hash', () => {
    let filename, badfile, hash;

    before(done => {
        filename = path.join(
            os.tmpdir(),
            `updater-test-${crypto.randomBytes(8).toString('hex')}.tmp`
        );
        badfile = filename + '.bad';
        // SHA512('Test file\nOK\n')
        hash = 'c3ff3dc57711c22a729e6d8575d30e216052cb5873824c44299bd184780154479e8245685a9c6d308f9ec25cdcb6ec7a1236ef0039b406f79264544a2c1ea295';
        fs.writeFile(filename, 'Test file\nOK\n', err => {
            if (err) return done(err);
            fs.writeFile(badfile, 'Test file\nBad\n', done);
        });
    });

    after(() => {
        if (filename) fs.unlinkSync(filename);
        if (badfile) fs.unlinkSync(badfile);
    });

    it('should verify correct hash', () => {
        return verifyHash(hash, filename);
    });

    it('should not verify incorrect hash', done => {
        const incorrectHash = '3af58f785950604030618187fedf3462676efe36a72987dd02e6bb20d1131cf062434fb839d822fc76a793a8f47fa4ebdb121390d76aa877eae5f5a6622c98af';
        verifyHash(incorrectHash, filename)
            .then(() => done(new Error('Verified incorrect hash')))
            .catch(() => done());
    });

    it('should not verify incorrect file', done => {
        verifyHash(hash, badfile)
            .then(() => done(new Error('Verified incorrect file')))
            .catch(() => done());
    });
});
