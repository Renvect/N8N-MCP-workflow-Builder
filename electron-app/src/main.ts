/**
 * N8N Agent Middleware - Electron Main Process
 * 
 * Manages the application lifecycle, spawns MCP server, and handles IPC.
 */

import { app, BrowserWindow, BrowserView, ipcMain, dialog, shell, Menu, crashReporter } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import Store from 'electron-store';
import { startApiServer, stopApiServer, API_PORT } from './api-server';
import { initUpdater } from './updater';
import { CdpClient } from './cdp-client';

// ... imports ...

const isMcpMode = process.argv.includes('--mcp');

try {
    if (process.platform === 'win32') {
        app.setAppUserModelId('com.n8nlibrary.mcp-guardrail');
    }
} catch {
    // ignore
}

let logFilePath: string | null = null;
let fallbackLogFilePath: string | null = null;

function initFallbackLog(): void {
    try {
        if (!process.env.APPDATA) {
            fallbackLogFilePath = null;
            return;
        }
        const dir = path.join(process.env.APPDATA, 'N8N MCP Guardrail', 'logs');
        fs.mkdirSync(dir, { recursive: true });
        fallbackLogFilePath = path.join(dir, 'main.log');
    } catch {
        fallbackLogFilePath = null;
    }
}

initFallbackLog();

function initMainLog(): void {
    try {
        const dir = path.join(app.getPath('userData'), 'logs');
        fs.mkdirSync(dir, { recursive: true });
        logFilePath = path.join(dir, 'main.log');

        // Redirect console output to log file
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;

        console.log = (...args: any[]) => {
            originalLog(...args);
            logToFile(`[INFO] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
        };

        console.error = (...args: any[]) => {
            originalError(...args);
            logToFile(`[ERROR] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
        };

        console.warn = (...args: any[]) => {
            originalWarn(...args);
            logToFile(`[WARN] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
        };

    } catch {
        logFilePath = null;
    }
}

function logToFile(message: string): void {
    const targetPath = logFilePath || fallbackLogFilePath;
    if (!targetPath) return;
    try {
        fs.appendFileSync(targetPath, `${new Date().toISOString()} ${message}\n`, 'utf8');
    } catch {
        // ignore
    }
}

function initDiagnostics(): void {
    try {
        if (!process.env.APPDATA) return;
        const dir = path.join(process.env.APPDATA, 'N8N MCP Guardrail', 'logs');
        fs.mkdirSync(dir, { recursive: true });
        const chromiumLogPath = path.join(dir, 'chromium.log');
        app.commandLine.appendSwitch('enable-logging');
        app.commandLine.appendSwitch('v', '1');
        app.commandLine.appendSwitch('log-file', chromiumLogPath);
    } catch (e: any) {
        logToFile(`[diagnostics] chromium logging init failed: ${e?.message || String(e)}`);
    }

    try {
        if (!process.env.APPDATA) return;
        const dir = path.join(process.env.APPDATA, 'N8N MCP Guardrail', 'crash');
        fs.mkdirSync(dir, { recursive: true });
        app.setPath('crashDumps', dir);
    } catch (e: any) {
        logToFile(`[diagnostics] crashDumps path init failed: ${e?.message || String(e)}`);
    }

    try {
        crashReporter.start({
            productName: 'N8N MCP Guardrail',
            submitURL: 'https://example.com',
            uploadToServer: false,
            compress: true,
        });
        logToFile('[diagnostics] crashReporter started');
    } catch (e: any) {
        logToFile(`[diagnostics] crashReporter start failed: ${e?.message || String(e)}`);
    }
}

process.on('uncaughtException', (err) => {
    logToFile(`[uncaughtException] ${err?.stack || err?.message || String(err)}`);
});

process.on('unhandledRejection', (reason) => {
    logToFile(`[unhandledRejection] ${String(reason)}`);
});

initDiagnostics();

// Persistent configuration store
const storeDir = (() => {
    try {
        const base = app.getPath('userData');
        return app.isPackaged ? base : `${base} Dev`;
    } catch {
        // Fallback for early startup edge-cases
        return process.env.APPDATA
            ? path.join(process.env.APPDATA, app.isPackaged ? 'N8N MCP Guardrail' : 'N8N MCP Guardrail Dev')
            : path.join(process.cwd(), app.isPackaged ? '.n8n-mcp-guardrail-config' : '.n8n-mcp-guardrail-config-dev');
    }
})();
const store = new Store({
    cwd: storeDir,
    defaults: {
        // Self-hosted config
        n8nUrl: '',
        n8nAuthType: 'apikey', // 'apikey' | 'basic' | 'none'
        n8nApiKey: '',
        n8nEmail: '',
        n8nPassword: '',
        // External services
        slackWebhookUrl: '',
        jiraUrl: '',
        jiraApiToken: '',
    },
});

let mainWindow: BrowserWindow | null = null;
let mcpServer: ChildProcess | null = null;
let servicesStarted = false;
const cdpClient = new CdpClient();
let ghostPilotView: BrowserView | null = null;

function setupGhostPilot(): void {
    if (!mainWindow) return;
    const n8nUrl = (store.get('n8nUrl') as string) || '';
    console.log('[GhostPilot] setupGhostPilot called. URL:', n8nUrl);

    if (!n8nUrl) {
        console.warn('[GhostPilot] n8nUrl is missing in store. Skipping setup.');
        return;
    }

    // Create BrowserView for Ghost Pilot
    ghostPilotView = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        }
    });

    // FORCE IN-APP NAVIGATION: Intercept window.open/target=_blank and load in the same view
    ghostPilotView.webContents.setWindowOpenHandler(({ url }) => {
        console.log('[GhostPilot] Intercepted popup/new-window. Loading in same view:', url);
        ghostPilotView?.webContents.loadURL(url);
        return { action: 'deny' };
    });

    ghostPilotView.webContents.on('will-navigate', (event, url) => {
        console.log('[GhostPilot] Navigation:', url);
    });
    mainWindow.setBrowserView(ghostPilotView);
    // Start hidden, agent can resize if needed
    ghostPilotView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    ghostPilotView.webContents.loadURL(n8nUrl);
    cdpClient.attach(ghostPilotView);

    // Auto-Login Logic (Self-hosted only)
    ghostPilotView.webContents.on('did-finish-load', () => {
        const email = (store.get('n8nEmail') as string) || '';
        const password = (store.get('n8nPassword') as string) || '';

        if (email && password) {
            ghostPilotView?.webContents.executeJavaScript(`
                (function() {
                    const emailInput = document.querySelector('input[name="email"], input[type="email"]');
                    const passInput = document.querySelector('input[name="password"], input[type="password"]');
                    if (emailInput && passInput) {
                        emailInput.value = '${email.replace(/'/g, "\\'")}';
                        passInput.value = '${password.replace(/'/g, "\\'")}';
                        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
                        passInput.dispatchEvent(new Event('input', { bubbles: true }));
                        setTimeout(() => {
                            const btn = document.querySelector('button[type="submit"], button.el-button--primary');
                            if (btn) btn.click();
                        }, 500);
                    }
                })();
            `).catch(() => { });
        }
    });

    console.log('[GhostPilot] Initialized with URL:', n8nUrl);
}

function areServicesRunning(): boolean {
    return mcpServer !== null;
}

function ensureWindowsShortcuts(): void {
    if (process.platform !== 'win32' || !app.isPackaged) return;
    const exePath = app.getPath('exe');
    const installDir = path.dirname(exePath);
    const iconCandidate = path.join(installDir, 'resources', 'assets', 'n8n mcp.ico');
    const iconLocation = fs.existsSync(iconCandidate) ? iconCandidate : exePath;

    const shortcutName = 'N8N MCP Guardrail';
    const appUserModelId = 'com.n8nlibrary.mcp-guardrail';

    try {
        const desktopDir = app.getPath('desktop');
        const startMenuDir = path.join(app.getPath('appData'), 'Microsoft\\Windows\\Start Menu\\Programs');
        try {
            fs.mkdirSync(startMenuDir, { recursive: true });
        } catch {
            // ignore
        }

        const desktopShortcutPath = path.join(desktopDir, `${shortcutName}.lnk`);
        const startMenuShortcutPath = path.join(startMenuDir, `${shortcutName}.lnk`);

        const shortcutOptions = {
            target: exePath,
            cwd: installDir,
            args: '',
            description: shortcutName,
            icon: iconLocation,
            iconIndex: 0,
            appUserModelId,
        };

        let desktopOk = false;
        let startMenuOk = false;

        try {
            desktopOk = shell.writeShortcutLink(desktopShortcutPath, 'replace', shortcutOptions as any);
        } catch (e: any) {
            logToFile(`[shortcut] writeShortcutLink desktop exception: ${e?.message || String(e)}`);
        }

        try {
            startMenuOk = shell.writeShortcutLink(startMenuShortcutPath, 'replace', shortcutOptions as any);
        } catch (e: any) {
            logToFile(`[shortcut] writeShortcutLink startMenu exception: ${e?.message || String(e)}`);
        }

        logToFile(
            `[shortcut] writeShortcutLink desktopOk=${String(desktopOk)} startMenuOk=${String(startMenuOk)} iconExists=${String(
                fs.existsSync(iconLocation),
            )}`,
        );

        if (desktopOk && startMenuOk) {
            return;
        }
    } catch (e: any) {
        logToFile(`[shortcut] writeShortcutLink init exception: ${e?.message || String(e)}`);
    }

    const safePsString = (v: string) => v.replace(/'/g, "''");

    const ps = `
$ErrorActionPreference = 'Stop'
$targetPath = '${safePsString(exePath)}'
$workingDir = '${safePsString(installDir)}'
$iconLoc = '${safePsString(iconLocation)}'
$name = 'N8N MCP Guardrail'

$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'

function Ensure-Shortcut($shortcutPath) {
  $w = New-Object -ComObject WScript.Shell
  $s = $w.CreateShortcut($shortcutPath)
  $s.TargetPath = $targetPath
  $s.WorkingDirectory = $workingDir
  $s.IconLocation = $iconLoc
  $s.Save()
}

Ensure-Shortcut (Join-Path $desktop "$name.lnk")
Ensure-Shortcut (Join-Path $startMenu "$name.lnk")
`;

    try {
        const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
            windowsHide: true,
        });

        let out = '';
        let err = '';
        child.stdout?.on('data', (d) => {
            out += String(d);
            if (out.length > 2000) out = out.slice(-2000);
        });
        child.stderr?.on('data', (d) => {
            err += String(d);
            if (err.length > 2000) err = err.slice(-2000);
        });

        child.on('error', (e: any) => {
            logToFile(`[shortcut] powershell spawn error: ${e?.message || String(e)}`);
        });

        child.on('close', (code) => {
            logToFile(`[shortcut] ensure close code=${code} stdout=${JSON.stringify(out)} stderr=${JSON.stringify(err)}`);
        });
    } catch (e: any) {
        logToFile(`[shortcut] ensure exception: ${e?.message || String(e)}`);
    }
}

ipcMain.on('renderer-log', (_event, payload: any) => {
    try {
        logToFile(`[renderer] ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
    } catch {
        logToFile('[renderer] (unserializable payload)');
    }
});

ipcMain.on('toggle-ghost-pilot', (_event, visible: boolean) => {
    console.log('[IPC] toggle-ghost-pilot called. Visible:', visible);

    // Lazy init if missing (e.g. if config was just added)
    if (!ghostPilotView) {
        console.log('[IPC] ghostPilotView missing, attempting setup...');
        setupGhostPilot();
    }

    if (!ghostPilotView || !mainWindow) {
        console.error('[IPC] Failed to toggle: ghostPilotView or mainWindow still missing.');
        return;
    }

    if (visible) {
        const contentBounds = mainWindow.getContentBounds();
        console.log('[IPC] Showing Ghost Pilot. Bounds target:', contentBounds);

        // Ensure it is attached (idempotent operation usually, but good to be safe)
        mainWindow.setBrowserView(ghostPilotView);

        ghostPilotView.setBounds({
            x: 50,
            y: 50,
            width: contentBounds.width - 100,
            height: contentBounds.height - 100
        });
        ghostPilotView.setAutoResize({ width: true, height: true });
    } else {
        console.log('[IPC] Hiding Ghost Pilot');
        ghostPilotView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
});

app.on('child-process-gone', (_event, details) => {
    try {
        logToFile(`[child-process-gone] ${JSON.stringify(details)}`);
    } catch {
        logToFile('[child-process-gone]');
    }
});

/**
 * Create the main application window
 */
function createWindow(): void {
    const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'assets', 'n8n mcp.ico')
        : path.join(__dirname, '..', 'assets', 'n8n mcp.ico');

    const preloadPath = path.join(__dirname, 'preload.js');
    try {
        logToFile(`[startup] preloadPath=${preloadPath} exists=${fs.existsSync(preloadPath)}`);
    } catch {
        // ignore
    }

    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        icon: iconPath,
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            devTools: true, // DEBUG: Enable DevTools 
        },
        title: 'N8N MCP Guardrail',
        resizable: true,
        minWidth: 700,
        minHeight: 500,
        autoHideMenuBar: true, // Hide menu bar
    });

    // SECURITY: Remove application menu completely to prevent access to dev controls
    mainWindow.setMenu(null);
    Menu.setApplicationMenu(null);

    // SECURITY: Block keyboard shortcuts for debugging and reloading
    mainWindow.webContents.on('before-input-event', (event, input) => {
        // DEBUG: Allow manual toggle
        if (input.control && input.shift && input.key.toLowerCase() === 'i') {
            mainWindow?.webContents.toggleDevTools();
            event.preventDefault();
            return;
        }
        if (input.key === 'F12') {
            mainWindow?.webContents.toggleDevTools();
            event.preventDefault();
            return;
        }

        if (
            // (input.control && input.shift && input.key.toLowerCase() === 'i') || // DevTools
            // (input.key === 'F12') || // DevTools
            (input.control && input.key.toLowerCase() === 'r') || // Reload
            (input.control && input.shift && input.key.toLowerCase() === 'r') // Force Reload
        ) {
            event.preventDefault();
        }
    });

    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    // DEBUG: Force open DevTools - ENABLED FOR DEBUGGING
    mainWindow.webContents.openDevTools({ mode: 'detach' });

    mainWindow.webContents.on('did-finish-load', () => {
        try {
            mainWindow?.webContents
                .executeJavaScript(
                    "typeof window !== 'undefined' && !!window.electronAPI && typeof window.electronAPI.getConfig === 'function'",
                )
                .then((ok: any) => {
                    logToFile(`[preload-check] electronAPI.getConfig=${String(ok)}`);
                })
                .catch((e: any) => {
                    logToFile(`[preload-check] executeJavaScript failed: ${e?.message || String(e)}`);
                });
        } catch (e: any) {
            logToFile(`[preload-check] exception: ${e?.message || String(e)}`);
        }
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        try {
            logToFile(`[render-process-gone] ${JSON.stringify(details)}`);
        } catch {
            logToFile('[render-process-gone]');
        }
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        logToFile(`[did-fail-load] code=${errorCode} desc=${errorDescription} url=${validatedURL}`);
    });

    mainWindow.webContents.on('unresponsive', () => {
        logToFile('[unresponsive]');
    });

    mainWindow.webContents.on('responsive', () => {
        logToFile('[responsive]');
    });

    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        logToFile(`[renderer-console] level=${level} line=${line} source=${sourceId} msg=${message}`);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

/**
 * Build environment variables for MCP server based on config
 */
function buildMcpEnv(): Record<string, string> {
    const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        N8N_TYPE: 'selfhosted',
        N8N_URL: store.get('n8nUrl') as string,
        N8N_AUTH_TYPE: store.get('n8nAuthType') as string,
        N8N_API_KEY: store.get('n8nApiKey') as string,
        N8N_EMAIL: store.get('n8nEmail') as string,
        N8N_PASSWORD: store.get('n8nPassword') as string,
        SLACK_WEBHOOK_URL: store.get('slackWebhookUrl') as string,
        JIRA_URL: store.get('jiraUrl') as string,
        JIRA_API_TOKEN: store.get('jiraApiToken') as string,
    };

    return env;
}

function resolveMcpServerPath(): string {
    return app.isPackaged
        ? path.join(process.resourcesPath, 'mcp-server', 'dist', 'server.js')
        : path.join(__dirname, '..', '..', 'mcp-server', 'dist', 'server.js');
}

/**
 * Start the MCP server process
 */
function startMcpServer(): void {
    const mcpServerPath = resolveMcpServerPath();

    if (!fs.existsSync(mcpServerPath)) {
        logToFile(`[mcp] server.js not found at ${mcpServerPath}`);
        return;
    }

    const mcpEnv: Record<string, string> = buildMcpEnv();

    if (app.isPackaged) {
        logToFile(`[mcp] starting via execPath=${process.execPath} --mcp`);
        mcpServer = spawn(process.execPath, ['--mcp'], {
            env: mcpEnv,
            windowsHide: true,
        });
    } else {
        mcpServer = spawn('node', [mcpServerPath], {
            env: mcpEnv,
        });
    }

    mcpServer.on('error', (err) => {
        logToFile(`[mcp] spawn error: ${err?.message || String(err)}`);
        mcpServer = null;
    });

    mcpServer.stdout?.on('data', (data) => {
        console.log(`MCP Server: ${data}`);
    });

    mcpServer.stderr?.on('data', (data) => {
        console.error(`MCP Server: ${data}`);
    });

    mcpServer.on('close', (code) => {
        console.log(`MCP Server exited with code ${code}`);
        mcpServer = null;
    });
}

/**
 * Stop the MCP server process
 */
function stopMcpServer(): void {
    if (mcpServer) {
        mcpServer.kill();
        mcpServer = null;
    }
}

/**
 * Test connection to n8n instance
 */
async function testN8nConnection(): Promise<{ success: boolean; version?: string; error?: string }> {
    return new Promise((resolve) => {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        let tokenScheme: 'x' | 'bearer' | null = null;
        let tokenValue: string | null = null;

        const attemptRequest = (requestUrl: string, requestHeaders: Record<string, string>) => {
            return new Promise<{ statusCode?: number; body: string }>((attemptResolve) => {
                try {
                    const parsedUrl = new URL(requestUrl);
                    const protocol = parsedUrl.protocol === 'https:' ? https : http;

                    const req = protocol.request({
                        hostname: parsedUrl.hostname,
                        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                        path: parsedUrl.pathname + parsedUrl.search,
                        method: 'GET',
                        headers: requestHeaders,
                        timeout: 10000,
                    }, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => {
                            attemptResolve({ statusCode: res.statusCode, body: data });
                        });
                    });

                    req.on('error', (e) => {
                        attemptResolve({ statusCode: undefined, body: e.message });
                    });

                    req.on('timeout', () => {
                        req.destroy();
                        attemptResolve({ statusCode: undefined, body: 'Connection timeout' });
                    });

                    req.end();
                } catch (e: any) {
                    attemptResolve({ statusCode: undefined, body: e?.message || 'Request failed' });
                }
            });
        };

        const baseUrl = (store.get('n8nUrl') as string || '').trim().replace(/\/$/, '');
        let url = `${baseUrl}/api/v1/workflows?limit=1`;

        const apiKey = (store.get('n8nApiKey') as string || '').trim();
        console.log(`[Test Connection] DEBUG: URL=${baseUrl}`);
        console.log(`[Test Connection] DEBUG: API Key exists? ${!!apiKey}, Length=${apiKey.length}`);

        const email = (store.get('n8nEmail') as string || '').trim();
        const password = (store.get('n8nPassword') as string || '').trim();

        if (apiKey) {
            tokenValue = apiKey;
            tokenScheme = 'x';
            headers['X-N8N-API-KEY'] = apiKey;
            console.log(`[Test Connection] Using API Key auth, key length: ${apiKey.length}`);
        } else if (email && password) {
            headers['Authorization'] = `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`;
            console.log(`[Test Connection] Using Basic auth for user: ${email}`);
        } else {
            console.log(`[Test Connection] No authentication provided`);
        }

        console.log(`[Test Connection] Testing URL: ${url}`);

        (async () => {
            try {
                let attemptHeaders = { ...headers };
                let attempt = await attemptRequest(url, attemptHeaders);

                if (attempt.statusCode === 401 && tokenScheme && tokenValue) {
                    const retryHeaders = { ...headers };
                    if (tokenScheme === 'x') {
                        delete retryHeaders['X-N8N-API-KEY'];
                        retryHeaders['Authorization'] = `Bearer ${tokenValue}`;
                        console.log('[Test Connection] Retrying with Bearer auth');
                    } else {
                        delete retryHeaders['Authorization'];
                        retryHeaders['X-N8N-API-KEY'] = tokenValue;
                        console.log('[Test Connection] Retrying with API Key auth');
                    }

                    attemptHeaders = retryHeaders;
                    attempt = await attemptRequest(url, attemptHeaders);
                }

                console.log(`[Test Connection] Response status: ${attempt.statusCode}`);
                console.log(`[Test Connection] Response body: ${(attempt.body || '').substring(0, 200)}`);

                if (attempt.statusCode === 200) {
                    try {
                        const json = JSON.parse(attempt.body);
                        const count = json.data?.length || 0;
                        resolve({ success: true, version: `Connected (${count} workflows)` });
                    } catch {
                        resolve({ success: true, version: 'Connected' });
                    }
                    return;
                }

                if (attempt.statusCode === 401) {
                    resolve({ success: false, error: `Authentication failed: ${(attempt.body || '').substring(0, 100)}` });
                    return;
                }
                if (attempt.statusCode === 403) {
                    resolve({ success: false, error: `Forbidden - API access may be disabled: ${(attempt.body || '').substring(0, 100)}` });
                    return;
                }
                if (!attempt.statusCode) {
                    resolve({ success: false, error: attempt.body || 'Connection failed' });
                    return;
                }

                resolve({ success: false, error: `HTTP ${attempt.statusCode}: ${(attempt.body || '').substring(0, 100)}` });
            } catch (e: any) {
                console.error(`[Test Connection] Exception: ${e.message}`);
                resolve({ success: false, error: e.message });
            }
        })();
    });
}

// IPC Handlers
ipcMain.handle('get-config', () => {
    return {
        n8nUrl: store.get('n8nUrl'),
        n8nAuthType: store.get('n8nAuthType'),
        n8nApiKey: store.get('n8nApiKey'),
        n8nEmail: store.get('n8nEmail'),
        n8nPassword: store.get('n8nPassword'),
        slackWebhookUrl: store.get('slackWebhookUrl'),
        jiraUrl: store.get('jiraUrl'),
        jiraApiToken: store.get('jiraApiToken'),
    };
});

ipcMain.handle('save-config', (_, config: Record<string, string>) => {
    const allowedKeys = new Set([
        'n8nUrl', 'n8nAuthType', 'n8nApiKey', 'n8nEmail', 'n8nPassword',
        'slackWebhookUrl', 'jiraUrl', 'jiraApiToken'
    ]);

    for (const [key, value] of Object.entries(config)) {
        if (!allowedKeys.has(key)) {
            console.warn(`[Security] save-config: Blocked non-whitelisted key: ${key}`);
            continue;
        }
        if (typeof value !== 'string') {
            console.warn(`[Security] save-config: Blocked non-string value for key: ${key}`);
            continue;
        }
        const sanitizedValue = value.substring(0, 2000).trim();
        store.set(key, sanitizedValue);
    }

    if (servicesStarted || areServicesRunning()) {
        stopMcpServer();
        startMcpServer();
    }
    return { success: true };
});

ipcMain.handle('start-services', async () => {
    if (!servicesStarted || !areServicesRunning()) {
        await startApiServer(store, cdpClient.handleAction.bind(cdpClient));
        startMcpServer();
        setupGhostPilot();
        servicesStarted = true;
    }
    return { success: true };
});

ipcMain.handle('stop-services', async () => {
    try {
        stopMcpServer();
        await stopApiServer();
        servicesStarted = false;
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
    }
});

ipcMain.handle('get-server-status', () => {
    return {
        running: servicesStarted || mcpServer !== null,
        pid: mcpServer?.pid,
    };
});

ipcMain.handle('test-n8n-connection', async () => {
    return await testN8nConnection();
});

ipcMain.handle('get-app-paths', () => {
    const isPackaged = app.isPackaged;
    const exePath = app.getPath('exe');
    const appPath = app.getAppPath();

    // In production, MCP server is bundled with the app
    // In development, it's in the sibling mcp-server directory
    const mcpServerPath = isPackaged
        ? exePath // In production, use the exe itself with --mcp flag
        : path.join(__dirname, '..', 'mcp-server', 'dist', 'server.js');

    // Skills path - in production bundled, in dev in sibling skills directory
    const skillsPath = isPackaged
        ? path.join(path.dirname(exePath), 'resources', 'skills')
        : path.join(__dirname, '..', '..', 'skills');

    return {
        isPackaged,
        exePath: exePath.replace(/\\/g, '/'),
        appPath: appPath.replace(/\\/g, '/'),
        mcpServerPath: mcpServerPath.replace(/\\/g, '/'),
        skillsPath: skillsPath.replace(/\\/g, '/'),
        platform: process.platform,
        userDataPath: app.getPath('userData').replace(/\\/g, '/')
    };
});

ipcMain.handle('open-external', (_, url: string) => {
    // SECURITY: Validate URL before opening externally
    // Only allow http:// and https:// URLs to prevent file://, javascript:, etc.
    if (!url || typeof url !== 'string') {
        console.warn('[Security] open-external: Invalid URL type');
        return { success: false, error: 'Invalid URL' };
    }

    try {
        const parsedUrl = new URL(url);
        const allowedProtocols = ['http:', 'https:'];

        if (!allowedProtocols.includes(parsedUrl.protocol)) {
            console.warn(`[Security] open-external: Blocked URL with protocol ${parsedUrl.protocol}`);
            return { success: false, error: 'URL protocol not allowed' };
        }

        shell.openExternal(url);
        return { success: true };
    } catch (e) {
        console.warn('[Security] open-external: Invalid URL format');
        return { success: false, error: 'Invalid URL format' };
    }
});

ipcMain.handle('get-static-content', async (_, type: string) => {
    let filename = '';
    if (type === 'rules') filename = 'rules.md';
    if (type === 'commands') filename = 'n8n_middleware_commands.md';

    // Handle skills content requests
    if (type.startsWith('skills/')) {
        const skillName = type.replace('skills/', '');
        const isPackaged = app.isPackaged;
        const exePath = app.getPath('exe');
        const appPath = app.getAppPath();

        // Skills path in production vs development
        const skillsBasePath = isPackaged
            ? path.join(path.dirname(exePath), 'resources', 'skills')
            : path.join(appPath, '..', 'skills');

        const skillFilePath = path.join(skillsBasePath, skillName, 'SKILL.md');

        try {
            if (fs.existsSync(skillFilePath)) {
                return fs.readFileSync(skillFilePath, 'utf8');
            }
            return `Skill not found: ${skillName}`;
        } catch (e: any) {
            console.error(`Failed to read skill ${skillName}:`, e);
            return `Error reading skill: ${e.message}`;
        }
    }

    if (!filename) return '';

    try {
        const appPath = app.getAppPath();
        let filePath = path.join(appPath, filename);

        // Check if file exists, if not try one level up (dev mode safeguard)
        if (!fs.existsSync(filePath)) {
            const devPath = path.join(appPath, '..', filename);
            if (fs.existsSync(devPath)) {
                filePath = devPath;
            }
        }

        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf8');
        }
        return `Content not found: ${filename}`;
    } catch (e: any) {
        console.error(`Failed to read static content ${filename}:`, e);
        return `Error reading content: ${e.message}`;
    }
});

// Open folder in file explorer
ipcMain.handle('open-path', async (_, folderPath: string) => {
    try {
        if (!folderPath || typeof folderPath !== 'string') {
            return { success: false, error: 'Invalid path' };
        }

        // Security: Only allow opening paths within known directories
        const normalizedPath = path.normalize(folderPath);

        // Check if folder exists
        if (!fs.existsSync(normalizedPath)) {
            console.warn(`[open-path] Path does not exist: ${normalizedPath}`);
            return { success: false, error: 'Path does not exist' };
        }

        shell.openPath(normalizedPath);
        return { success: true };
    } catch (e: any) {
        console.error('[open-path] Failed:', e);
        return { success: false, error: e?.message || String(e) };
    }
});

// Clipboard handler for copy buttons
ipcMain.handle('clipboard:writeText', async (_, text: string) => {
    try {
        if (!text || typeof text !== 'string') {
            return { success: false, error: 'Invalid text' };
        }
        const { clipboard } = require('electron');
        clipboard.writeText(text);
        return { success: true };
    } catch (e: any) {
        console.error('[Clipboard] Write failed:', e);
        return { success: false, error: e?.message || String(e) };
    }
});

// App lifecycle
if (isMcpMode) {
    try {
        const mcpServerPath = resolveMcpServerPath();
        require(mcpServerPath);
    } catch (e: any) {
        try {
            const fallbackPath = path.join(process.env.TEMP || process.cwd(), 'n8n-mcp-guardrail-mcp.log');
            fs.appendFileSync(fallbackPath, `${new Date().toISOString()} ${e?.stack || e?.message || String(e)}\n`, 'utf8');
        } catch {
            // ignore
        }
        process.exit(1);
    }
} else {
    app.whenReady().then(async () => {
        initMainLog();
        logToFile(`[startup] isPackaged=${app.isPackaged} exe=${app.getPath('exe')} appPath=${app.getAppPath()}`);
        try {
            logToFile(
                `[startup] userData=${app.getPath('userData')} storeDir=${storeDir} storePath=${(store as any)?.path || 'unknown'} name=${app.getName()}`,
            );
            // License validation removed for open-source release
        } catch {
            // ignore
        }

        createWindow();

        // Initialize auto-updater
        if (mainWindow) {
            initUpdater(mainWindow, store);
        }

        ensureWindowsShortcuts();

        // Services start on-demand via UI Connect button (no license gating)
        logToFile('[startup] Ready — services will start when user clicks Connect');

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });
}

app.on('window-all-closed', () => {
    stopMcpServer();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', async () => {
    stopMcpServer();
    await stopApiServer();
});
