// @ts-check
/**
 * Returns current operating system.
 * @returns {string}
 */
function currentPlatform() {
    switch (process.platform) {
        case 'darwin':
            return 'mac';
        case 'linux':
            return 'linux-' + process.arch;
        case 'win32':
            return 'windows';
        default:
            throw new Error(`Unsupported platform: ${process.platform}`);
    }
}

module.exports = currentPlatform;
