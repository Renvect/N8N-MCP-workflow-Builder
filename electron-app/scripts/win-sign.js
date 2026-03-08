'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isFileLockedErrorMessage(message) {
    const m = String(message || '');
    return m.includes('being used by another process') || m.includes('cannot access the file');
}

function tryOpenForWrite(filePath) {
    const fd = fs.openSync(filePath, 'r+');
    fs.closeSync(fd);
}

async function waitForFileReady(filePath, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            tryOpenForWrite(filePath);
            return;
        } catch (e) {
            await sleep(250);
        }
    }
}

async function execWithTimeout(command, args, timeoutMs) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

        let stdout = '';
        let stderr = '';

        const timer = setTimeout(() => {
            try {
                child.kill();
            } catch {
                // ignore
            }
            reject(new Error(`signtool timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
        child.stderr.on('data', (d) => (stderr += d.toString('utf8')));

        child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }
            reject(new Error(`signtool exited with code ${code}. stderr: ${stderr}. stdout: ${stdout}`));
        });
    });
}

async function getSigntoolPath() {
    // Use the same vendor path electron-builder uses
    const { getSignVendorPath, isOldWin6 } = require('app-builder-lib/out/codeSign/windowsSignToolManager');
    const vendorPath = await getSignVendorPath();
    if (isOldWin6()) {
        return path.join(vendorPath, 'windows-6', 'signtool.exe');
    }
    return path.join(vendorPath, 'windows-10', process.arch, 'signtool.exe');
}

exports.sign = async function sign(configuration /*, packager */) {
    const args = configuration.computeSignToolArgs(true);
    const inputFile = args[args.length - 1];

    const timeout = parseInt(process.env.SIGNTOOL_TIMEOUT, 10) || 10 * 60 * 1000;

    // Extra retries for intermittent Windows file locks (common with NSIS/uninstaller signing)
    const retries = parseInt(process.env.N8N_SIGN_RETRIES, 10) || 10;
    const delayMs = parseInt(process.env.N8N_SIGN_RETRY_DELAY, 10) || 5000;

    const signtoolPath = await getSigntoolPath();

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await waitForFileReady(inputFile, 60_000);
            await execWithTimeout(signtoolPath, args, timeout);
            return;
        } catch (e) {
            const message = e && e.message ? e.message : String(e);
            const lockLike = isFileLockedErrorMessage(message);
            if (attempt < retries && lockLike) {
                await sleep(delayMs);
                continue;
            }
            throw e;
        }
    }
};
