const expect = require('chai').expect;
const signing = require('../signing');

describe('Signing', () => {

    it('should generate key pair', () => {
        const keys = signing.generateKeyPair();
        console.log('Key pair', keys);
        expect(keys.publicKey).to.be.a('string');
        expect(keys.secretKey).to.be.a('string');
    });

    it('should sign and verify', () => {
        const keys = signing.generateKeyPair();
        const msg = "Hello world";
        const sig = signing.sign(keys.secretKey, msg);
        console.log('Signature', sig);
        expect(sig).to.be.a('string');
        signing.verify([keys.publicKey], sig, msg); // expecting not to throw
    });

    it('should verify with multiple keys', () => {
        const keys1 = signing.generateKeyPair();
        const keys2 = signing.generateKeyPair();
        const msg = "Hello world";
        const sig = signing.sign(keys2.secretKey, msg);
        signing.verify([keys1.publicKey, keys2.publicKey], sig, msg); // expecting not to throw
    });

    it('should not verify with wrong key', () => {
        const keys1 = signing.generateKeyPair();
        const keys2 = signing.generateKeyPair();
        const msg = "Hello world";
        const sig = signing.sign(keys1.secretKey, msg);
        expect(() => {
            signing.verify([keys2.publicKey], sig, msg);
        }).to.throw(/Invalid signature/);
    });

    it('should not verify wrong signature', () => {
        const keys1 = signing.generateKeyPair();
        const keys2 = signing.generateKeyPair();
        const msg = "Hello world";
        const sig1 = signing.sign(keys1.secretKey, msg);
        const sig2 = signing.sign(keys2.secretKey, msg);
        const badSig = sig1.substring(0, 20) + sig2.substring(20);
        expect(() => {
            signing.verify([keys2.publicKey], badSig, msg);
        }).to.throw(/Invalid signature/);
    });

    it('should not verify wrong message', () => {
        const keys = signing.generateKeyPair();
        const msg = "Hello world";
        const badMsg = "Goodbye world";
        const sig = signing.sign(keys.secretKey, msg);
        expect(() => {
            signing.verify([keys.publicKey], sig, badMsg);
        }).to.throw(/Invalid signature/);
    });

});
