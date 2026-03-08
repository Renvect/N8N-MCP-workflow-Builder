# ============================================================================
#  N8N MCP Guardrail — PowerShell One-Liner Installer
# ============================================================================
#  Usage (paste in PowerShell):
#    irm https://tvxezpnyhgzqtzccdjeu.supabase.co/functions/v1/get-install-script | iex
#
#  Or with explicit execution-policy bypass (for restricted systems):
#    powershell -ExecutionPolicy Bypass -Command "irm https://tvxezpnyhgzqtzccdjeu.supabase.co/functions/v1/get-install-script | iex"
#
#  What this does:
#    1. Downloads the NSIS installer .exe via your Supabase download-middleware
#       (proxied from private GitHub release — no browser, no MOTW, no SmartScreen)
#    2. Strips Zone.Identifier (Mark of the Web) from the downloaded file
#    3. Runs the NSIS installer silently (/S flag — no UI at all)
#    4. Launches the app
#
#  The NSIS installer already handles:
#    - Extracting to the install directory
#    - Creating Desktop + Start Menu shortcuts
#    - Adding to user PATH
#    - Uninstaller registration
# ============================================================================

$ErrorActionPreference = "Stop"

# ── Configuration ───────────────────────────────────────────────────────────
$AppName        = "N8N MCP Guardrail"
$Version        = "0.1.1"
# Download via your existing download-middleware edge function (proxies from private GitHub)
$DownloadUrl    = "https://tvxezpnyhgzqtzccdjeu.supabase.co/functions/v1/download-middleware"
$InstallerName  = "N8N.MCP.Guardrail.Setup.$Version.exe"
# ── End Configuration ───────────────────────────────────────────────────────

$TempInstaller  = Join-Path $env:TEMP $InstallerName

function Write-Step($msg) {
    Write-Host "  [>] $msg" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "  [OK] $msg" -ForegroundColor Green
}

function Write-Fail($msg) {
    Write-Host "  [FAIL] $msg" -ForegroundColor Red
}

# ── Banner ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host "  $AppName Installer v$Version" -ForegroundColor White
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host ""

# ── Download via Supabase proxy ──────────────────────────────────────────────
#    download-middleware fetches the asset from your private GitHub release
#    using a server-side GitHub token. The file arrives via PowerShell's
#    WebClient — NOT a browser — so Windows never attaches a Zone.Identifier
#    (Mark of the Web) NTFS stream. No MOTW = no SmartScreen prompt.
Write-Step "Downloading $AppName v$Version..."
Write-Host "         Via : Supabase download proxy" -ForegroundColor DarkGray

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

    $webClient = New-Object System.Net.WebClient
    $webClient.Headers.Add("User-Agent", "N8N-MCP-Guardrail-PS-Installer/$Version")
    $webClient.DownloadFile($DownloadUrl, $TempInstaller)
}
catch {
    Write-Fail "Download failed: $($_.Exception.Message)"
    Write-Host ""
    Write-Host "  Check your internet connection and try again." -ForegroundColor Yellow
    Write-Host "  Proxy URL: $DownloadUrl" -ForegroundColor DarkGray
    Write-Host ""
    exit 1
}

$sizeMB = [math]::Round((Get-Item $TempInstaller).Length / 1MB, 1)
Write-OK "Downloaded ($sizeMB MB) -> $TempInstaller"

# ── Strip Zone.Identifier just in case ──────────────────────────────────────
#    WebClient doesn't add MOTW, but Unblock-File is a no-op if there's
#    nothing to remove — so this is always safe to call.
Write-Step "Removing Mark-of-the-Web (SmartScreen bypass)..."
Unblock-File -Path $TempInstaller -ErrorAction SilentlyContinue
Write-OK "File unblocked"

# ── Silent install ───────────────────────────────────────────────────────────
#    NSIS /S flag = fully silent, no UI, no prompts.
#    The installer runs under the current user (perMachine: false in config)
#    so no UAC elevation is required.
Write-Step "Running silent installer..."
Write-Host "         This may take 30-60 seconds..." -ForegroundColor DarkGray

$proc = Start-Process -FilePath $TempInstaller -ArgumentList "/S" -Wait -PassThru

if ($proc.ExitCode -ne 0) {
    Write-Fail "Installer exited with code $($proc.ExitCode)"
    Write-Host ""
    Write-Host "  Try running the installer manually: $TempInstaller" -ForegroundColor Yellow
    exit 1
}

Write-OK "Installation complete"

# ── Cleanup temp installer ───────────────────────────────────────────────────
Remove-Item $TempInstaller -Force -ErrorAction SilentlyContinue

# ── Locate the installed exe ─────────────────────────────────────────────────
$defaultInstallDir = Join-Path $env:LOCALAPPDATA "Programs\$AppName"
$exePath = Join-Path $defaultInstallDir "$AppName.exe"

# ── Done ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "  Installation Complete!" -ForegroundColor White
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Version      : $Version" -ForegroundColor White
if (Test-Path $exePath) {
    Write-Host "  Installed to : $defaultInstallDir" -ForegroundColor White
}
Write-Host ""
Write-Host "  To uninstall: use Add/Remove Programs or Start Menu > Uninstall" -ForegroundColor DarkGray
Write-Host ""

# ── Launch ───────────────────────────────────────────────────────────────────
if (Test-Path $exePath) {
    Write-Step "Launching $AppName..."
    Start-Process -FilePath $exePath
} else {
    Write-Host "  App launched by installer. Check your Desktop or Start Menu." -ForegroundColor DarkGray
}
Write-Host ""
