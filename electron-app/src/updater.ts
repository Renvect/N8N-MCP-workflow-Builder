import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import Store from 'electron-store';

interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  releaseDate?: string;
}

interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

// Update feed URL - configure via UPDATER_FEED_URL env variable
const UPDATE_FEED_URL = process.env.UPDATER_FEED_URL || '';

let mainWindow: BrowserWindow | null = null;
let updateStore: Store<any> | null = null;
let updateInfo: UpdateInfo | null = null;

function normalizeReleaseNotes(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const parts = raw
      .map((v) => {
        if (typeof v === 'string') return v;
        if (typeof v === 'object' && v && 'note' in v) return String((v as any).note ?? '');
        return '';
      })
      .filter(Boolean);
    return parts.join('\n\n');
  }
  if (typeof raw === 'object' && raw && 'note' in raw) return String((raw as any).note ?? '');
  return String(raw);
}

function toUpdateInfo(updateAvailable: boolean, update: any | null): UpdateInfo {
  const currentVersion = app.getVersion();
  const latestVersion = update?.version ? String(update.version) : currentVersion;
  return {
    updateAvailable,
    currentVersion,
    latestVersion,
    releaseNotes: normalizeReleaseNotes(update?.releaseNotes),
    releaseDate: update?.releaseDate ? String(update.releaseDate) : undefined,
  };
}

export function initUpdater(window: BrowserWindow, store: Store<any>) {
  mainWindow = window;
  updateStore = store;

  // Only enable updater in packaged builds (electron-updater expects update artifacts)
  if (!app.isPackaged) {
    console.log('[Updater] Skipping auto-updater in dev mode');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED_URL });

  // Allow self-signed certificates for updates (required since we don't have a trusted code signing cert)
  (autoUpdater as any).verifySource = false;


  autoUpdater.on('update-available', (info: any) => {
    updateInfo = toUpdateInfo(true, info);
    const skippedVersion = (updateStore?.get('skippedUpdateVersion') as string) || '';
    if (skippedVersion && skippedVersion === updateInfo.latestVersion) {
      console.log(`[Updater] Update ${updateInfo.latestVersion} skipped by user`);
      return;
    }
    // Silent update: just send status, no modal popup
    mainWindow?.webContents.send('updater:status', { state: 'downloading', version: updateInfo.latestVersion });
  });

  autoUpdater.on('download-progress', (p: any) => {
    // Silent update: just update status text, no progress bar
    mainWindow?.webContents.send('updater:status', { state: 'downloading', percent: Math.round(p?.percent ?? 0) });
  });

  autoUpdater.on('update-downloaded', (info: any) => {
    updateInfo = toUpdateInfo(true, info);
    // Silent update: send ready status, will install on quit
    mainWindow?.webContents.send('updater:status', { state: 'ready', version: updateInfo.latestVersion });
  });

  autoUpdater.on('error', (err: any) => {
    const message = (err as any)?.message || String(err);
    console.error('[Updater] Error:', message);
    mainWindow?.webContents.send('updater:error', message);
  });

  // Check for updates on startup (after 10 seconds to allow app to settle)
  // setTimeout(() => checkForUpdates(false), 10000);

  // Check every 4 hours
  // setInterval(() => checkForUpdates(false), 4 * 60 * 60 * 1000);

  // IPC Handlers
  ipcMain.handle('updater:check', () => checkForUpdates(true));
  ipcMain.handle('updater:getInfo', () => updateInfo);
  ipcMain.handle('updater:skip', (_, version) => skipVersion(version));
}

async function checkForUpdates(userInitiated: boolean = false): Promise<UpdateInfo | null> {
  try {
    if (!app.isPackaged) {
      return null;
    }

    const result = await autoUpdater.checkForUpdates();
    const info = (result as any)?.updateInfo ?? null;

    if (!info || !info.version) {
      updateInfo = toUpdateInfo(false, null);
      return updateInfo;
    }

    const next = toUpdateInfo(true, info);
    const skippedVersion = (updateStore?.get('skippedUpdateVersion') as string) || '';
    if (!userInitiated && skippedVersion && skippedVersion === next.latestVersion) {
      console.log(`[Updater] Skipping check - version ${skippedVersion} was skipped by user`);
      return null;
    }

    updateInfo = next;
    return updateInfo;
  } catch (error: any) {
    console.error('[Updater] Update check failed:', error?.message || String(error));
    mainWindow?.webContents.send('updater:error', error?.message || String(error));
    return null;
  }
}

function skipVersion(version: string): void {
  if (!updateStore) return;

  console.log('[Updater] User skipped version:', version);
  updateStore.set('skippedUpdateVersion', version);

  // Clear update info
  updateInfo = null;
}

export { checkForUpdates };
