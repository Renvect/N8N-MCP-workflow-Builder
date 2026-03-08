# PowerShell One-Liner Distribution Guide

## How It Works

Instead of downloading an `.exe` through a browser (which triggers SmartScreen + Chrome warnings), users paste a single PowerShell command that:

1. Fetches `install.ps1` from your **`get-install-script` Supabase edge function**
2. The script downloads the NSIS `.exe` via your **`download-middleware` edge function** (which proxies from your private GitHub release using a server-side GitHub token)
3. Strips **Mark of the Web** (Zone.Identifier) from the downloaded file
4. Runs the NSIS installer **silently** (`/S` flag — no UI, no prompts)
5. Launches the app

**No browser download = No MOTW = No SmartScreen = No Chrome warning.**  
**No new file uploads needed** — uses your existing GitHub release + proxy infrastructure.

---

## The Install Command (share this with users)

**Standard (paste in PowerShell):**
```powershell
irm https://tvxezpnyhgzqtzccdjeu.supabase.co/functions/v1/get-install-script | iex
```

**For restricted systems (explicit bypass):**
```powershell
powershell -ExecutionPolicy Bypass -Command "irm https://tvxezpnyhgzqtzccdjeu.supabase.co/functions/v1/get-install-script | iex"
```

---

## Infrastructure (already deployed, nothing to upload)

| Component | What it does |
|-----------|-------------|
| `get-install-script` edge function | Serves `install.ps1` as `text/plain` so `irm \| iex` works |
| `download-middleware` edge function | Proxies the `.exe` from private GitHub release via GitHub token |
| GitHub release `v1.0.1` | Hosts the actual `N8N.MCP.Guardrail.Setup.0.1.1.exe` asset |

---

## Releasing a New Version

When you build and release a new version:

### Step 1: Build
```bash
npm run dist:win
```

### Step 2: Upload new `.exe` to GitHub release
Upload `out/installer/N8N.MCP.Guardrail.Setup.X.Y.Z.exe` as a new GitHub release asset (or new tag).

### Step 3: Update `download-middleware`
Update the `GITHUB_RELEASE_URL` constant in the `download-middleware` edge function to point to the new asset URL.

### Step 4: Update `get-install-script`
Update `$Version` and `$InstallerName` in the `get-install-script` edge function body.

Both edge functions are in your Supabase project and can be redeployed from the `electron-app/scripts/` folder or directly via the Supabase dashboard.

---

## What Users See

```
=========================================
  N8N MCP Guardrail Installer v0.1.1
=========================================

  [>] Downloading N8N MCP Guardrail v0.1.1 via secure proxy...
  [OK] Downloaded (83.6 MB)
  [>] Removing Mark-of-the-Web (SmartScreen bypass)...
  [OK] File unblocked
  [>] Running silent installer (30-60 seconds)...
  [OK] Installation complete

=========================================
  Installation Complete!
=========================================

  Version : 0.1.1
  Location: C:\Users\John\AppData\Local\Programs\N8N MCP Guardrail

  To uninstall: Add/Remove Programs or Start Menu > Uninstall

  [>] Launching N8N MCP Guardrail...
```

---

## Website HTML Snippet

```html
<div style="background: #1a1a2e; border-radius: 8px; padding: 24px; font-family: monospace;">
  <span style="color: #888; font-size: 12px;">Run in PowerShell:</span>
  <div style="display: flex; align-items: center; margin-top: 8px;">
    <code id="install-cmd" style="color: #00ff88; font-size: 14px; flex: 1;">
      irm https://tvxezpnyhgzqtzccdjeu.supabase.co/functions/v1/get-install-script | iex
    </code>
    <button onclick="navigator.clipboard.writeText(document.getElementById('install-cmd').textContent.trim())"
            style="background: #333; color: #fff; border: 1px solid #555; border-radius: 4px; padding: 6px 12px; cursor: pointer; margin-left: 12px;">
      Copy
    </button>
  </div>
</div>
```

---

## FAQ

**Q: Does this require admin/elevated privileges?**
A: No. The NSIS installer is configured with `perMachine: false` — installs to `%LOCALAPPDATA%\Programs\`, no UAC prompt.

**Q: Does SmartScreen trigger?**
A: No. The `.exe` is downloaded via PowerShell's `WebClient` (not a browser), so Windows never attaches a Zone.Identifier NTFS stream. `Unblock-File` strips any residual MOTW just in case.

**Q: What about Chrome download warnings?**
A: Nothing goes through Chrome. Users copy-paste a command in PowerShell.

**Q: What if PowerShell execution policy blocks the script?**
A: `irm ... | iex` pipes the script directly into memory — execution policy typically doesn't apply to piped content. The alternative command uses `-ExecutionPolicy Bypass` for fully restricted systems.

**Q: Will the Electron app + license validation still work?**
A: Yes. The NSIS installer installs the exact same app. All bytecode protection, license checks, and electron-store data persist in `%APPDATA%` as before.

**Q: How do auto-updates work?**
A: The built-in `electron-updater` still works. The `publish` config in `electron-builder.yml` points to your Supabase `desktop-updates` endpoint. Once installed, the app updates itself normally.
