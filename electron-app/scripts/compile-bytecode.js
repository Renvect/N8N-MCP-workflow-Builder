/**
 * Bytecode Compilation Script for Electron
 * 
 * This script compiles JavaScript files to V8 bytecode using bytenode.
 * It uses Electron's V8 engine to ensure compatibility.
 * 
 * Usage: node scripts/compile-bytecode.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const FILES_TO_COMPILE = ['main.js', 'api-server.js', 'updater.js'];

console.log('=== V8 Bytecode Compilation ===\n');

// Check if bytenode is installed
try {
    require.resolve('bytenode');
    console.log('✓ bytenode found');
} catch (e) {
    console.error('✗ bytenode not found. Run: npm install bytenode');
    process.exit(1);
}

const bytenode = require('bytenode');

// Get Electron path for compilation
let electronPath;
try {
    electronPath = process.execPath;
    console.log(`✓ Electron execPath: ${electronPath}`);
} catch (e) {
    console.error('✗ Electron not found. This script must run from the electron-app directory.');
    process.exit(1);
}

try {
    const stalePreloadJsc = path.join(DIST_DIR, 'preload.jsc');
    if (fs.existsSync(stalePreloadJsc)) {
        fs.unlinkSync(stalePreloadJsc);
        console.log('✓ Removed stale preload.jsc');
    }
} catch {
    // ignore
}

// Compile each file
const missingOutputs = [];

(async () => {
    for (const filename of FILES_TO_COMPILE) {
        const jsPath = path.join(DIST_DIR, filename);
        const jscPath = jsPath.replace('.js', '.jsc');
        const loaderPath = jsPath; // We'll overwrite the .js with a loader

        if (!fs.existsSync(jsPath)) {
            console.log(`⚠ Skipping ${filename} (not found)`);
            missingOutputs.push(jscPath);
            continue;
        }

        console.log(`\nCompiling ${filename}...`);

        try {
            // Read original source
            const originalSource = fs.readFileSync(jsPath, 'utf8');

            // Compile to bytecode using Electron's V8
            // bytenode.compileFile() uses the current Node/Electron V8
            await bytenode.compileFile({
                filename: jsPath,
                output: jscPath,
                electron: true, // Use Electron for compilation
                electronPath,
                createLoader: false,
            });

            console.log(`  ✓ Created ${path.basename(jscPath)}`);

            // Create ASAR-compatible loader stub
            // This reads the .jsc file as a buffer and correctly invokes the module wrapper
            const loaderContent = `'use strict';
const fs = require('fs');
const path = require('path');
const bytenode = require('bytenode');

// Read bytecode from ASAR-compatible path
let bytecodePath = path.join(__dirname, '${path.basename(jscPath)}');
if (!fs.existsSync(bytecodePath) && bytecodePath.includes('app.asar')) {
    const unpackedPath = bytecodePath.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpackedPath)) {
        bytecodePath = unpackedPath;
    }
}

if (!fs.existsSync(bytecodePath)) {
    const e = new Error('Bytecode file not found: ' + bytecodePath);
    try {
        const p = path.join(process.env.TEMP || process.cwd(), 'n8n-mcp-guardrail-loader.log');
        fs.appendFileSync(p, new Date().toISOString() + ' ' + e.stack + '\\n', 'utf8');
    } catch {}
    throw e;
}

let bytecodeBuffer;
try {
    bytecodeBuffer = fs.readFileSync(bytecodePath);
} catch (e) {
    try {
        const p = path.join(process.env.TEMP || process.cwd(), 'n8n-mcp-guardrail-loader.log');
        fs.appendFileSync(p, new Date().toISOString() + ' ' + (e && e.stack ? e.stack : String(e)) + '\\n', 'utf8');
    } catch {}
    throw e;
}

// Execute the bytecode
// Note: runBytecode returns the module wrapper function for CommonJS modules
const result = bytenode.runBytecode(bytecodeBuffer);

if (typeof result === 'function') {
    // Invoke the module wrapper with standard Node.js module arguments
    // arguments: exports, require, module, __filename, __dirname
    result.apply(this, [exports, require, module, bytecodePath, __dirname]);
}
`;

            fs.writeFileSync(loaderPath, loaderContent, 'utf8');
            console.log(`  ✓ Created loader ${path.basename(loaderPath)}`);

            // Verify the .jsc was created
            if (fs.existsSync(jscPath)) {
                const stats = fs.statSync(jscPath);
                console.log(`  ✓ Bytecode size: ${(stats.size / 1024).toFixed(1)} KB`);
            } else {
                console.log(`  ✗ Failed to create ${jscPath}`);
                missingOutputs.push(jscPath);
            }
        } catch (err) {
            console.error(`  ✗ Error compiling ${filename}:`, err && err.stack ? err.stack : err);
            missingOutputs.push(jscPath);
            // Continue with other files
        }
    }

    console.log('\n=== Compilation Complete ===\n');

    // Summary
    console.log('Files in dist/:');
    const distFiles = fs.readdirSync(DIST_DIR);
    for (const file of distFiles) {
        const stats = fs.statSync(path.join(DIST_DIR, file));
        const size = (stats.size / 1024).toFixed(1);
        const type = file.endsWith('.jsc') ? '[BYTECODE]' :
            file.endsWith('.js') ? '[LOADER]' : '';
        console.log(`  - ${file} (${size} KB) ${type}`);
    }

    if (missingOutputs.length > 0) {
        console.error(`\n✗ Missing bytecode outputs:\n${missingOutputs.map((p) => `  - ${p}`).join('\n')}`);
        process.exit(1);
    }

    process.exit(0);
})().catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
});
