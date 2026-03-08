# Auto-Update System Plan

## Overview

Complete auto-update system for N8N MCP Guardrail Electron app with:
- **Supabase Backend**: Storage + Database for version management
- **Electron Middleware**: Update checker, downloader, UI components
- **Admin Dashboard**: Web UI for version management and uploads

---

## Architecture

```
┌─────────────────────────┐     ┌─────────────────────────────────────┐
│   Electron App          │     │   Supabase (n8nlibrary.net)         │
│   (User's PC)           │     │                                     │
├─────────────────────────┤     ├─────────────────────────────────────┤
│ src/updater.ts          │────►│ Storage: releases bucket            │
│ - checkForUpdates()     │     │ - /0.2.0/app-setup.exe              │
│ - downloadUpdate()      │     │ - /0.2.0/latest.yml                 │
│ - installUpdate()       │     │                                     │
├─────────────────────────┤     ├─────────────────────────────────────┤
│ renderer/               │     │ Database: app_releases table        │
│ - Update banner         │     │ - version, notes, download_url      │
│ - Progress modal        │     │ - is_latest, min_required           │
│ - Release notes view    │     │                                     │
└─────────────────────────┘     ├─────────────────────────────────────┤
                                │ Edge Functions:                      │
┌─────────────────────────┐     │ - check-update                      │
│   Admin Dashboard       │     │ - upload-release                    │
│   (Web App)             │     │                                     │
├─────────────────────────┤     └─────────────────────────────────────┘
│ - Upload new versions   │
│ - Manage releases       │
│ - View analytics        │
│ - Rollback versions     │
└─────────────────────────┘
```

---

## Part 1: Supabase Schema

### 1.1 Database Table: `app_releases`

```sql
-- Create app_releases table
CREATE TABLE public.app_releases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version text NOT NULL UNIQUE,
    version_code integer NOT NULL,
    release_date timestamptz DEFAULT now(),
    release_notes text,
    
    -- File information
    download_url text NOT NULL,
    file_name text NOT NULL,
    file_size bigint,
    sha512 text,
    
    -- Release management
    is_latest boolean DEFAULT false,
    is_published boolean DEFAULT false,
    is_critical boolean DEFAULT false,
    min_required_version text,
    
    -- Platform support
    platform text DEFAULT 'win32',
    arch text DEFAULT 'x64',
    
    -- Metadata
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    created_by uuid REFERENCES auth.users(id),
    download_count integer DEFAULT 0
);

-- Index for quick latest lookup
CREATE INDEX idx_app_releases_latest ON app_releases(is_latest, is_published);
CREATE INDEX idx_app_releases_version ON app_releases(version_code DESC);

-- RLS Policies
ALTER TABLE app_releases ENABLE ROW LEVEL SECURITY;

-- Public can read published releases
CREATE POLICY "Public can view published releases"
ON app_releases FOR SELECT
USING (is_published = true);

-- Only admins can manage releases
CREATE POLICY "Admins can manage releases"
ON app_releases FOR ALL
USING (
    auth.uid() IN (
        SELECT user_id FROM admin_users WHERE role = 'admin'
    )
);
```

### 1.2 Database Table: `admin_users`

```sql
CREATE TABLE public.admin_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) UNIQUE,
    email text NOT NULL,
    role text DEFAULT 'viewer',
    created_at timestamptz DEFAULT now()
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
```

### 1.3 Database Table: `update_analytics`

```sql
CREATE TABLE public.update_analytics (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id uuid REFERENCES app_releases(id),
    event_type text NOT NULL,
    from_version text,
    to_version text,
    platform text,
    arch text,
    success boolean,
    error_message text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_analytics_release ON update_analytics(release_id);
CREATE INDEX idx_analytics_date ON update_analytics(created_at DESC);
```

### 1.4 Storage Bucket

```sql
-- Create releases bucket via Supabase Dashboard or:
INSERT INTO storage.buckets (id, name, public)
VALUES ('releases', 'releases', true);

-- Storage structure:
-- releases/
--   ├── 0.1.0/
--   │   ├── N8N-MCP-Guardrail-Setup-0.1.0.exe
--   │   ├── N8N-MCP-Guardrail-Setup-0.1.0.exe.blockmap
--   │   └── latest.yml
--   ├── 0.2.0/
--   │   ├── N8N-MCP-Guardrail-Setup-0.2.0.exe
--   │   └── latest.yml
--   └── latest.yml  (symlink to current latest)
```

### 1.5 Edge Function: `check-update`

```typescript
// supabase/functions/check-update/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { currentVersion, platform = 'win32', arch = 'x64' } = await req.json()
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    // Get latest published release
    const { data: latest, error } = await supabase
      .from('app_releases')
      .select('*')
      .eq('is_latest', true)
      .eq('is_published', true)
      .eq('platform', platform)
      .single()

    if (error || !latest) {
      return new Response(
        JSON.stringify({ updateAvailable: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Compare versions
    const currentParts = currentVersion.split('.').map(Number)
    const latestParts = latest.version.split('.').map(Number)
    
    let updateAvailable = false
    for (let i = 0; i < 3; i++) {
      if (latestParts[i] > currentParts[i]) {
        updateAvailable = true
        break
      } else if (latestParts[i] < currentParts[i]) {
        break
      }
    }

    // Check if update is mandatory
    let mandatory = false
    if (latest.min_required_version) {
      const minParts = latest.min_required_version.split('.').map(Number)
      for (let i = 0; i < 3; i++) {
        if (minParts[i] > currentParts[i]) {
          mandatory = true
          break
        }
      }
    }

    return new Response(
      JSON.stringify({
        updateAvailable,
        mandatory,
        currentVersion,
        latestVersion: latest.version,
        releaseNotes: latest.release_notes,
        downloadUrl: latest.download_url,
        fileSize: latest.file_size,
        sha512: latest.sha512,
        releaseDate: latest.release_date,
        isCritical: latest.is_critical
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
```

---

## Part 2: Electron Middleware Components

### 2.1 File Structure

```
electron-app/src/
├── updater.ts              # Core update logic
├── updater-ui.ts           # IPC handlers for UI
└── main.ts                 # Initialize updater

electron-app/renderer/
├── components/
│   ├── update-banner.html  # Top banner component
│   └── update-modal.html   # Full update modal
├── js/
│   └── updater-ui.js       # UI logic for updates
└── index.html              # Add update components
```

### 2.2 Core Updater (`src/updater.ts`)

```typescript
// src/updater.ts
import { app, BrowserWindow, ipcMain } from 'electron';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface UpdateInfo {
  updateAvailable: boolean;
  mandatory: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  downloadUrl: string;
  fileSize: number;
  sha512: string;
  releaseDate: string;
  isCritical: boolean;
}

interface DownloadProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const CHECK_UPDATE_ENDPOINT = `${SUPABASE_URL}/functions/v1/check-update`;

let mainWindow: BrowserWindow | null = null;
let updateInfo: UpdateInfo | null = null;
let downloadPath: string | null = null;

export function initUpdater(window: BrowserWindow) {
  mainWindow = window;
  
  // Check for updates on startup (after 5 seconds)
  setTimeout(() => checkForUpdates(), 5000);
  
  // Check every 4 hours
  setInterval(() => checkForUpdates(), 4 * 60 * 60 * 1000);
  
  // IPC Handlers
  ipcMain.handle('updater:check', () => checkForUpdates());
  ipcMain.handle('updater:download', () => downloadUpdate());
  ipcMain.handle('updater:install', () => installUpdate());
  ipcMain.handle('updater:getInfo', () => updateInfo);
  ipcMain.handle('updater:skip', (_, version) => skipVersion(version));
}

async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    const currentVersion = app.getVersion();
    
    const response = await fetch(CHECK_UPDATE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentVersion,
        platform: process.platform,
        arch: process.arch
      })
    });
    
    const data = await response.json() as UpdateInfo;
    updateInfo = data;
    
    if (data.updateAvailable && mainWindow) {
      mainWindow.webContents.send('updater:available', data);
    }
    
    return data;
  } catch (error) {
    console.error('Update check failed:', error);
    return null;
  }
}

async function downloadUpdate(): Promise<boolean> {
  if (!updateInfo || !updateInfo.downloadUrl) {
    return false;
  }
  
  const tempDir = app.getPath('temp');
  const fileName = `n8n-mcp-update-${updateInfo.latestVersion}.exe`;
  downloadPath = path.join(tempDir, fileName);
  
  return new Promise((resolve) => {
    const file = fs.createWriteStream(downloadPath!);
    let receivedBytes = 0;
    const totalBytes = updateInfo!.fileSize;
    const startTime = Date.now();
    
    https.get(updateInfo!.downloadUrl, (response) => {
      response.pipe(file);
      
      response.on('data', (chunk) => {
        receivedBytes += chunk.length;
        const elapsed = (Date.now() - startTime) / 1000;
        const bytesPerSecond = receivedBytes / elapsed;
        
        const progress: DownloadProgress = {
          percent: (receivedBytes / totalBytes) * 100,
          transferred: receivedBytes,
          total: totalBytes,
          bytesPerSecond
        };
        
        if (mainWindow) {
          mainWindow.webContents.send('updater:progress', progress);
        }
      });
      
      file.on('finish', async () => {
        file.close();
        
        // Verify SHA512
        const valid = await verifySha512(downloadPath!, updateInfo!.sha512);
        if (valid) {
          mainWindow?.webContents.send('updater:ready');
          resolve(true);
        } else {
          fs.unlinkSync(downloadPath!);
          mainWindow?.webContents.send('updater:error', 'Checksum verification failed');
          resolve(false);
        }
      });
    }).on('error', (err) => {
      fs.unlinkSync(downloadPath!);
      mainWindow?.webContents.send('updater:error', err.message);
      resolve(false);
    });
  });
}

async function verifySha512(filePath: string, expectedHash: string): Promise<boolean> {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => {
      const computed = hash.digest('base64');
      resolve(computed === expectedHash);
    });
    stream.on('error', () => resolve(false));
  });
}

function installUpdate(): void {
  if (!downloadPath || !fs.existsSync(downloadPath)) {
    return;
  }
  
  const { spawn } = require('child_process');
  
  // Launch installer and quit app
  spawn(downloadPath, ['/S'], {
    detached: true,
    stdio: 'ignore'
  }).unref();
  
  app.quit();
}

function skipVersion(version: string): void {
  // Store skipped version in electron-store
  const Store = require('electron-store');
  const store = new Store();
  store.set('skippedVersion', version);
}

export { checkForUpdates, downloadUpdate, installUpdate };
```

### 2.3 Main Process Integration (`src/main.ts` additions)

```typescript
// Add to src/main.ts
import { initUpdater } from './updater';

// After window creation:
initUpdater(mainWindow);
```

### 2.4 Preload Script Additions (`src/preload.ts`)

```typescript
// Add to preload.ts contextBridge.exposeInMainWorld
updater: {
  check: () => ipcRenderer.invoke('updater:check'),
  download: () => ipcRenderer.invoke('updater:download'),
  install: () => ipcRenderer.invoke('updater:install'),
  getInfo: () => ipcRenderer.invoke('updater:getInfo'),
  skip: (version: string) => ipcRenderer.invoke('updater:skip', version),
  onAvailable: (cb: Function) => ipcRenderer.on('updater:available', (_, info) => cb(info)),
  onProgress: (cb: Function) => ipcRenderer.on('updater:progress', (_, progress) => cb(progress)),
  onReady: (cb: Function) => ipcRenderer.on('updater:ready', () => cb()),
  onError: (cb: Function) => ipcRenderer.on('updater:error', (_, error) => cb(error))
}
```

---

## Part 3: Electron UI Components

### 3.1 Update Banner HTML (add to `renderer/index.html`)

```html
<!-- Add after <body> tag -->
<div id="update-banner" class="update-banner hidden">
  <div class="update-banner-content">
    <span class="update-icon">🚀</span>
    <span class="update-text">
      Version <strong id="update-version"></strong> is available!
    </span>
    <div class="update-actions">
      <button id="update-view-btn" class="btn btn-sm btn-primary">View Update</button>
      <button id="update-dismiss-btn" class="btn btn-sm btn-ghost">Later</button>
    </div>
  </div>
</div>

<!-- Update Modal -->
<div id="update-modal" class="modal hidden">
  <div class="modal-overlay"></div>
  <div class="modal-content update-modal-content">
    <div class="modal-header">
      <h2>🎉 Update Available</h2>
      <button id="update-modal-close" class="modal-close">&times;</button>
    </div>
    
    <div class="modal-body">
      <div class="update-version-info">
        <span class="current-version">Current: <strong id="current-ver"></strong></span>
        <span class="arrow">→</span>
        <span class="new-version">New: <strong id="new-ver"></strong></span>
      </div>
      
      <div class="release-notes" id="release-notes">
        <!-- Release notes injected here -->
      </div>
      
      <div class="download-progress hidden" id="download-progress">
        <div class="progress-bar">
          <div class="progress-fill" id="progress-fill"></div>
        </div>
        <div class="progress-text">
          <span id="progress-percent">0%</span>
          <span id="progress-size">0 MB / 0 MB</span>
          <span id="progress-speed">0 MB/s</span>
        </div>
      </div>
    </div>
    
    <div class="modal-footer" id="update-modal-footer">
      <button id="update-skip-btn" class="btn btn-ghost">Skip This Version</button>
      <button id="update-later-btn" class="btn btn-secondary">Remind Me Later</button>
      <button id="update-download-btn" class="btn btn-primary">Download & Install</button>
    </div>
    
    <div class="modal-footer hidden" id="update-ready-footer">
      <button id="update-install-btn" class="btn btn-primary">
        Install Now & Restart
      </button>
    </div>
  </div>
</div>
```

### 3.2 Update Styles (add to CSS)

```css
/* Update Banner */
.update-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 10px 20px;
  z-index: 10000;
  transform: translateY(-100%);
  transition: transform 0.3s ease;
}

.update-banner.visible {
  transform: translateY(0);
}

.update-banner-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15px;
  max-width: 800px;
  margin: 0 auto;
}

.update-icon {
  font-size: 20px;
}

.update-actions {
  display: flex;
  gap: 10px;
}

/* Update Modal */
.update-modal-content {
  max-width: 500px;
  width: 90%;
}

.update-version-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15px;
  padding: 15px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  margin-bottom: 20px;
}

.arrow {
  font-size: 20px;
  color: var(--accent);
}

.new-version strong {
  color: var(--accent);
}

.release-notes {
  max-height: 200px;
  overflow-y: auto;
  padding: 15px;
  background: var(--bg-secondary);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
}

.release-notes h3 {
  margin-top: 0;
  color: var(--accent);
}

.release-notes ul {
  padding-left: 20px;
  margin: 10px 0;
}

/* Progress Bar */
.download-progress {
  margin-top: 20px;
}

.progress-bar {
  height: 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2);
  width: 0%;
  transition: width 0.2s ease;
}

.progress-text {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-secondary);
}
```

### 3.3 Update UI JavaScript (`renderer/js/updater-ui.js`)

```javascript
// Updater UI Logic
(function() {
  const banner = document.getElementById('update-banner');
  const modal = document.getElementById('update-modal');
  const versionEl = document.getElementById('update-version');
  const currentVerEl = document.getElementById('current-ver');
  const newVerEl = document.getElementById('new-ver');
  const releaseNotesEl = document.getElementById('release-notes');
  const progressContainer = document.getElementById('download-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressPercent = document.getElementById('progress-percent');
  const progressSize = document.getElementById('progress-size');
  const progressSpeed = document.getElementById('progress-speed');
  const modalFooter = document.getElementById('update-modal-footer');
  const readyFooter = document.getElementById('update-ready-footer');
  
  let updateInfo = null;

  // Listen for update available
  window.electronAPI.updater.onAvailable((info) => {
    updateInfo = info;
    showUpdateBanner(info);
  });

  // Listen for download progress
  window.electronAPI.updater.onProgress((progress) => {
    updateProgress(progress);
  });

  // Listen for download complete
  window.electronAPI.updater.onReady(() => {
    showReadyToInstall();
  });

  // Listen for errors
  window.electronAPI.updater.onError((error) => {
    showError(error);
  });

  function showUpdateBanner(info) {
    versionEl.textContent = info.latestVersion;
    banner.classList.remove('hidden');
    setTimeout(() => banner.classList.add('visible'), 100);
  }

  function showUpdateModal() {
    if (!updateInfo) return;
    
    currentVerEl.textContent = updateInfo.currentVersion;
    newVerEl.textContent = updateInfo.latestVersion;
    releaseNotesEl.innerHTML = formatReleaseNotes(updateInfo.releaseNotes);
    
    progressContainer.classList.add('hidden');
    modalFooter.classList.remove('hidden');
    readyFooter.classList.add('hidden');
    
    modal.classList.remove('hidden');
    banner.classList.remove('visible');
  }

  function formatReleaseNotes(notes) {
    if (!notes) return '<p>No release notes available.</p>';
    // Convert markdown-like notes to HTML
    return notes
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(.+)$/, '<p>$1</p>');
  }

  function startDownload() {
    progressContainer.classList.remove('hidden');
    modalFooter.classList.add('hidden');
    window.electronAPI.updater.download();
  }

  function updateProgress(progress) {
    progressFill.style.width = `${progress.percent}%`;
    progressPercent.textContent = `${Math.round(progress.percent)}%`;
    progressSize.textContent = `${formatBytes(progress.transferred)} / ${formatBytes(progress.total)}`;
    progressSpeed.textContent = `${formatBytes(progress.bytesPerSecond)}/s`;
  }

  function showReadyToInstall() {
    progressContainer.classList.add('hidden');
    readyFooter.classList.remove('hidden');
  }

  function installUpdate() {
    window.electronAPI.updater.install();
  }

  function skipVersion() {
    if (updateInfo) {
      window.electronAPI.updater.skip(updateInfo.latestVersion);
    }
    closeModal();
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Event Listeners
  document.getElementById('update-view-btn')?.addEventListener('click', showUpdateModal);
  document.getElementById('update-dismiss-btn')?.addEventListener('click', () => {
    banner.classList.remove('visible');
  });
  document.getElementById('update-modal-close')?.addEventListener('click', closeModal);
  document.getElementById('update-download-btn')?.addEventListener('click', startDownload);
  document.getElementById('update-skip-btn')?.addEventListener('click', skipVersion);
  document.getElementById('update-later-btn')?.addEventListener('click', closeModal);
  document.getElementById('update-install-btn')?.addEventListener('click', installUpdate);
  
  // Close modal on overlay click
  modal?.querySelector('.modal-overlay')?.addEventListener('click', closeModal);
})();
```

---

## Part 4: Admin Dashboard

### 4.1 Location

Create in the root project directory:
```
Agentic middleware controller/
├── admin-dashboard/           # NEW - Admin web app
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx       # Dashboard home
│   │   │   ├── releases/
│   │   │   │   ├── page.tsx   # Releases list
│   │   │   │   └── new/
│   │   │   │       └── page.tsx  # Upload new release
│   │   │   └── analytics/
│   │   │       └── page.tsx   # Download analytics
│   │   ├── components/
│   │   │   ├── ReleaseForm.tsx
│   │   │   ├── ReleaseList.tsx
│   │   │   ├── FileUploader.tsx
│   │   │   └── AnalyticsChart.tsx
│   │   └── lib/
│   │       └── supabase.ts
│   ├── package.json
│   └── next.config.js
├── electron-app/
├── mcp-server/
└── rust-core/
```

### 4.2 Tech Stack for Admin Dashboard

- **Framework**: Next.js 14 (App Router)
- **UI**: Tailwind CSS + shadcn/ui
- **Auth**: Supabase Auth
- **Storage**: Supabase Storage
- **Database**: Supabase Postgres

### 4.3 Key Admin Features

1. **Release Management**
   - Upload new versions (.exe files)
   - Auto-generate SHA512 hash
   - Write release notes (Markdown)
   - Set as latest / critical / published
   - Rollback to previous version

2. **Version Control**
   - View all versions
   - Compare versions
   - Set minimum required version
   - Draft / publish workflow

3. **Analytics**
   - Download counts per version
   - Active versions in use
   - Update success/failure rates
   - Geographic distribution

4. **Security**
   - Admin-only access via Supabase Auth
   - Role-based permissions (admin/viewer)
   - Audit log of changes

---

## Part 5: Implementation Order

### Phase 1: Supabase Setup (Day 1)
1. [ ] Create `app_releases` table
2. [ ] Create `admin_users` table  
3. [ ] Create `update_analytics` table
4. [ ] Create `releases` storage bucket
5. [ ] Deploy `check-update` edge function
6. [ ] Set up RLS policies

### Phase 2: Electron Updater (Day 2-3)
1. [ ] Create `src/updater.ts`
2. [ ] Add IPC handlers to preload
3. [ ] Initialize updater in main.ts
4. [ ] Add update banner to index.html
5. [ ] Add update modal to index.html
6. [ ] Create updater-ui.js
7. [ ] Add CSS styles
8. [ ] Test update flow

### Phase 3: Admin Dashboard (Day 4-5)
1. [ ] Initialize Next.js project
2. [ ] Set up Supabase client
3. [ ] Create auth pages (login)
4. [ ] Create release list page
5. [ ] Create upload/new release page
6. [ ] Create analytics page
7. [ ] Deploy to Vercel/n8nlibrary.net

### Phase 4: Testing & Polish (Day 6)
1. [ ] End-to-end update test
2. [ ] Test mandatory updates
3. [ ] Test skip version
4. [ ] Test rollback
5. [ ] Polish UI/UX
6. [ ] Documentation

---

## Configuration Required

### electron-builder.yml additions

```yaml
# Add to electron-builder.yml
publish:
  provider: generic
  url: https://YOUR_PROJECT.supabase.co/storage/v1/object/public/releases
  channel: latest
```

### Environment Variables

```env
# Electron App (hardcoded or via build)
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your_anon_key

# Admin Dashboard (.env.local)
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

---

## Estimated Timeline

| Phase | Duration | Description |
|-------|----------|-------------|
| Phase 1 | 2-3 hours | Supabase schema + edge function |
| Phase 2 | 4-6 hours | Electron updater + UI |
| Phase 3 | 6-8 hours | Admin dashboard |
| Phase 4 | 2-3 hours | Testing + polish |
| **Total** | **14-20 hours** | Full implementation |

---

## Notes

- The admin dashboard can be deployed alongside n8nlibrary.net main site
- Consider using the same Supabase project for both
- SHA512 verification ensures download integrity
- Mandatory updates can be forced for security patches
- Analytics help track adoption and issues
