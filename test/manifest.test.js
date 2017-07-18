const expect = require('chai').expect;
const { generateKeyPair } = require('../signing');
const Manifest = require('../manifest');

describe('Manifest', () => {
    it('should create and load manifest', () => {
        const keys = generateKeyPair();
        console.log('Keys', keys);

        const m = new Manifest();
        m.version = '1.2.3';
        m.date = new Date();
        m.changelog = 'https://example.com/changelog';
        m.isMandatory = true;
        m.setFile('mac', 'https://example.com/file-mac.zip');
        m.setSha512('mac', '876811d9f53cbbf8be653a37ac6b53d3dfd401c9dfecf202a1875997548455ed3ad0f52d0503af79a6c730c5074d125df7de19e40380a4a3c03568ad831a82e4');
        m.setSize('mac', 1024);
        m.setFile('windows', 'https://example.com/file-win.exe');
        m.setSha512('windows', '109fff3200ca1171f03e4cb817268fdf440328efc394c6b1dd0cc72c2c6b9e8c4ceb26af5d345011367e034112c102991393c504b1629080105a1936ee634479');
        m.setSize('windows', 2048);

        const serialized = m.serialize(keys.secretKey);

        console.log('---\n' + serialized + '\n----');
        expect(serialized).to.be.a('string');

        const p = Manifest.loadFromString([keys.publicKey], serialized);
        console.log(p.data);
        expect(p.version).to.equal(m.version);
        expect(p.date.toString()).to.equal(m.date.toString());
        expect(p.urgency).to.equal('mandatory');
        expect(p.changelog).to.equal(m.changelog);
        ['mac', 'windows'].forEach(platform => {
            expect(p.getFile(platform)).to.equal(m.getFile(platform));
            expect(p.getSha512(platform)).to.equal(m.getSha512(platform));
            expect(p.getSize(platform)).to.equal(m.getSize(platform));
        });

        expect(p.isNewerVersionThan('1.2.0')).to.equal(true);
        expect(p.isNewerVersionThan('1.2.3')).to.equal(false);
        expect(p.isNewerVersionThan('1.2.4')).to.equal(false);
    });
});
