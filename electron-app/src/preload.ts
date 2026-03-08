/**
 * Preload script - exposes safe IPC methods to renderer
 */

import { contextBridge, ipcRenderer } from 'electron';

try {
    try {
        console.log('[preload] loaded');
    } catch {
        // ignore
    }

    window.addEventListener('error', (event: any) => {
        try {
            ipcRenderer.send('renderer-log', {
                type: 'error',
                message: event?.message,
                filename: event?.filename,
                lineno: event?.lineno,
                colno: event?.colno,
                stack: event?.error?.stack,
            });
        } catch {
            ipcRenderer.send('renderer-log', 'window.error (failed to serialize)');
        }
    });

    window.addEventListener('unhandledrejection', (event: any) => {
        try {
            ipcRenderer.send('renderer-log', {
                type: 'unhandledrejection',
                reason: String(event?.reason),
                stack: event?.reason?.stack,
            });
        } catch {
            ipcRenderer.send('renderer-log', 'window.unhandledrejection (failed to serialize)');
        }
    });
} catch {
    // ignore
}

try {
    contextBridge.exposeInMainWorld('electronAPI', {
        // Configuration
        getConfig: () => ipcRenderer.invoke('get-config'),
        saveConfig: (config: Record<string, string>) => ipcRenderer.invoke('save-config', config),

        // Services
        startServices: () => ipcRenderer.invoke('start-services'),

        stopServices: () => ipcRenderer.invoke('stop-services'),

        // Server status
        getServerStatus: () => ipcRenderer.invoke('get-server-status'),

        // n8n Connection
        testN8nConnection: () => ipcRenderer.invoke('test-n8n-connection'),

        // App paths for MCP configuration
        getAppPaths: () => ipcRenderer.invoke('get-app-paths'),

        // External links
        openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

        // Open folder in file explorer
        openPath: (folderPath: string) => ipcRenderer.invoke('open-path', folderPath),

        // Static content (Rules/Commands)
        getStaticContent: (type: string) => ipcRenderer.invoke('get-static-content', type),

        clipboard: {
            writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
        },

        // Ghost Pilot
        toggleGhostPilot: (visible: boolean) => ipcRenderer.send('toggle-ghost-pilot', visible),

        // Auto-updater (silent mode)
        updater: {
            check: () => ipcRenderer.invoke('updater:check'),
            getInfo: () => ipcRenderer.invoke('updater:getInfo'),
            skip: (version: string) => ipcRenderer.invoke('updater:skip', version),
            onStatus: (callback: (status: any) => void) => {
                ipcRenderer.on('updater:status', (_event, status) => callback(status));
            },
            onError: (callback: (error: string) => void) => {
                ipcRenderer.on('updater:error', (_event, error) => callback(error));
            }
        },
    });

    try {
        ipcRenderer.send('renderer-log', { type: 'preload', message: 'electronAPI exposed' });
    } catch {
        // ignore
    }
} catch (e: any) {
    try {
        console.error('[preload] exposeInMainWorld failed', e);
    } catch {
        // ignore
    }
    try {
        ipcRenderer.send('renderer-log', {
            type: 'preload',
            message: 'exposeInMainWorld failed',
            error: e?.message || String(e),
            stack: e?.stack,
        });
    } catch {
        // ignore
    }
}

