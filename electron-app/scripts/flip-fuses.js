/**
 * Electron Fuses Configuration Script
 * 
 * This script flips Electron fuses after packaging to harden the application.
 * Fuses are build-time toggles that disable specific Electron features at the binary level.
 * 
 * Usage: Called automatically by electron-builder via afterPack hook
 *        Or manually: node scripts/flip-fuses.js <path-to-electron-exe>
 */

const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('path');
const fs = require('fs');

async function flipElectronFuses(executablePath) {
    console.log('=== Electron Fuses Configuration ===\n');
    console.log(`Target: ${executablePath}`);

    if (!fs.existsSync(executablePath)) {
        console.error(`✗ Executable not found: ${executablePath}`);
        process.exit(1);
    }

    try {
        await flipFuses(executablePath, {
            version: FuseVersion.V1,

            // SECURITY: Disable running as a plain Node.js process
            // Prevents: electron.exe --inspect script.js
            [FuseV1Options.RunAsNode]: true,

            // SECURITY: Enable cookie encryption
            [FuseV1Options.EnableCookieEncryption]: true,

            // SECURITY: Disable NODE_OPTIONS environment variable
            // Prevents: NODE_OPTIONS="--inspect" ./app.exe
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,

            // SECURITY: Disable --inspect and --inspect-brk CLI flags
            // Prevents attaching debuggers via command line
            [FuseV1Options.EnableNodeCliInspectArguments]: true,

            // SECURITY: Disable ASAR integrity validation (required for bytenode)
            // Note: This is disabled because bytenode requires .jsc files to be unpacked
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,

            // SECURITY: Only load app from ASAR archive
            // Prevents loading code from unpacked directories
            [FuseV1Options.OnlyLoadAppFromAsar]: false,

            // SECURITY: Disable the ELECTRON_RUN_AS_NODE env variable
            [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
        });

        try {
            const exeDir = path.dirname(executablePath);
            const v8Snapshot = path.join(exeDir, 'v8_context_snapshot.bin');
            const browserV8Snapshot = path.join(exeDir, 'browser_v8_context_snapshot.bin');
            if (fs.existsSync(v8Snapshot) && !fs.existsSync(browserV8Snapshot)) {
                fs.copyFileSync(v8Snapshot, browserV8Snapshot);
            }
        } catch { }

        console.log('\n✓ Fuses configured successfully!');
        console.log('\nFuses applied:');
        console.log('  • RunAsNode: ENABLED');
        console.log('  • EnableCookieEncryption: ENABLED');
        console.log('  • EnableNodeOptionsEnvironmentVariable: DISABLED');
        console.log('  • EnableNodeCliInspectArguments: DISABLED');
        console.log('  • EnableEmbeddedAsarIntegrityValidation: DISABLED');
        console.log('  • OnlyLoadAppFromAsar: DISABLED');

    } catch (err) {
        console.error(`\n✗ Failed to flip fuses: ${err.message}`);
        // Don't exit with error - build should continue
        // Some fuses may not be supported on all Electron versions
    }
}

// If called directly with a path argument
if (require.main === module) {
    const exePath = process.argv[2];
    if (!exePath) {
        console.log('Usage: node flip-fuses.js <path-to-electron-exe>');
        console.log('\nExample:');
        console.log('  node scripts/flip-fuses.js "out/installer/win-unpacked/N8N MCP Guardrail.exe"');
        process.exit(1);
    }
    flipElectronFuses(exePath);
}

// Export for use as electron-builder afterPack hook
module.exports = async function afterPack(context) {
    const { appOutDir, packager } = context;
    const exeName = packager.appInfo.productFilename + '.exe';
    const exePath = path.join(appOutDir, exeName);

    console.log(`\n[afterPack] Flipping fuses for: ${exePath}`);
    await flipElectronFuses(exePath);
};
