'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function resolveDefaultExePath() {
  return path.resolve(__dirname, '..', 'out', 'installer', 'win-unpacked', 'N8N MCP Guardrail.exe');
}

const exePath = process.argv[2] ? path.resolve(process.argv[2]) : resolveDefaultExePath();
const args = process.argv.slice(3);

const logPath = path.join(process.env.TEMP || process.cwd(), 'n8n-mcp-guardrail-launcher.log');

function log(line) {
  try {
    fs.appendFileSync(logPath, new Date().toISOString() + ' ' + line + '\n', 'utf8');
  } catch {}
}

log(`launcher exe=${exePath} args=${JSON.stringify(args)}`);

const child = spawn(exePath, args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
});

child.stdout.on('data', (d) => {
  const s = d.toString();
  process.stdout.write(s);
  log('[stdout] ' + s.trimEnd());
});

child.stderr.on('data', (d) => {
  const s = d.toString();
  process.stderr.write(s);
  log('[stderr] ' + s.trimEnd());
});

child.on('error', (err) => {
  const msg = err && err.stack ? err.stack : String(err);
  console.error(msg);
  log('[spawn-error] ' + msg);
});

child.on('exit', (code, signal) => {
  const msg = `exited code=${code} signal=${signal || ''}`;
  console.error(msg);
  log('[exit] ' + msg);
});
