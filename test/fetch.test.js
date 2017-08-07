const expect = require('chai').expect;
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { fetchJSON, fetchAllJSONPages, fetchFile } = require('../fetch');
const { verifyHash } = require('../hash');

describe('Fetch', () => {
    it('should fetch JSON', () => {
        // XXX: find test endpoint or launch own mock server
        return fetchJSON('https://dchest.org/feed.json')
            .then(json => expect(json.version).to.equal('https://jsonfeed.org/version/1'));
    });

    it('should fetch JSON with redirect', () => {
        return fetchJSON('https://goo.gl/GZFBB4')
            .then(json => expect(json.version).to.equal('https://jsonfeed.org/version/1'));
    });

    it('should reject fetching JSON when 404', done => {
        fetchJSON('https://www.google.com/404-please')
            .then(() => done(new Error('Expected promise to reject due to 404')))
            .catch(() => done())
    });

    it('should reject fetching JSON from bad URL', done => {
        fetchJSON('what is this I don\'t even')
            .then(() => done(new Error('Expected promise to reject due to bad address')))
            .catch(() => done())
    });

    it('should fetch multi-page JSON', () => {
        return fetchAllJSONPages('https://api.github.com/repos/dchest/tweetnacl-js/issues?state=closed')
            .then(json => {
                console.log(`Paged JSON number of items: ${json.length}`);
                expect(json).to.have.lengthOf.above(125);
            });
    });

    it('should fetch a file', () => {
        const src = 'https://cdnjs.cloudflare.com/ajax/libs/react/15.6.1/react.min.js';
        const hash = '9de4a24e4c752ddee0dfe644fb229dd9b6e44e9caeb4c5ff814d0879eb3dc20cf14b090856d0c5b4c0146e3b03f4b7121e5224d923be991c9db325e651c0c39b';
        const dst = path.join(
            os.tmpdir(),
            `updater-test-${crypto.randomBytes(8).toString('hex')}.tmp`
        );
        return fetchFile(src, dst)
            .then(filepath => {
                return verifyHash(hash, filepath).then(() => {
                    fs.unlink(dst, err => {
                        if (err) console.error(err);
                    });
                });
            })
            .catch(err => {
                fs.unlink(dst, () => err => {
                    if (err) console.error(err);
                });
                throw err;
            });
    });

});
