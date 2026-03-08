# ============================================================================
#  N8N MCP Guardrail — PowerShell Uninstaller
# ============================================================================
#  Usage (paste in PowerShell):
#    irm https://YOUR-DOMAIN.com/uninstall.ps1 | iex
# ============================================================================

$ErrorActionPreference = "Stop"

$AppName    = "N8N MCP Guardrail"
$AppFolder  = "N8N-MCP-Guardrail"
$InstallDir = Join-Path $env:LOCALAPPDATA $AppFolder

function Write-Step($msg) {
    Write-Host "  [$([char]0x2192)] $msg" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "  [OK] $msg" -ForegroundColor Green
}

# ── Banner ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host "  $AppName Uninstaller" -ForegroundColor White
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host ""

if (-not (Test-Path $InstallDir)) {
    Write-Host "  $AppName is not installed at: $InstallDir" -ForegroundColor Yellow
    Write-Host "  Nothing to do." -ForegroundColor Yellow
    Write-Host ""
    exit 0
}

# ── Confirm ─────────────────────────────────────────────────────────────────
$confirm = Read-Host "  Uninstall $AppName from $InstallDir? [Y/n]"
if ($confirm -and $confirm -ne "Y" -and $confirm -ne "y") {
    Write-Host "  Cancelled." -ForegroundColor Yellow
    exit 0
}

# ── Stop running instance ───────────────────────────────────────────────────
Write-Step "Checking for running instances..."

$proc = Get-Process -Name "N8N MCP Guardrail" -ErrorAction SilentlyContinue
if ($proc) {
    Write-Step "Stopping $AppName..."
    $proc | Stop-Process -Force
    Start-Sleep -Seconds 2
    Write-OK "Process stopped"
} else {
    Write-OK "No running instance found"
}

# ── Remove install directory ────────────────────────────────────────────────
Write-Step "Removing application files..."
Remove-Item $InstallDir -Recurse -Force
Write-OK "Application files removed"

# ── Remove Desktop shortcut ─────────────────────────────────────────────────
Write-Step "Removing Desktop shortcut..."
$desktopLnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "$AppName.lnk"
if (Test-Path $desktopLnk) {
    Remove-Item $desktopLnk -Force
    Write-OK "Desktop shortcut removed"
} else {
    Write-OK "No desktop shortcut found"
}

# ── Remove Start Menu shortcuts ─────────────────────────────────────────────
Write-Step "Removing Start Menu shortcuts..."
$startMenuDir = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\$AppName"
if (Test-Path $startMenuDir) {
    Remove-Item $startMenuDir -Recurse -Force
    Write-OK "Start Menu shortcuts removed"
} else {
    Write-OK "No Start Menu shortcuts found"
}

# ── Remove from User PATH ──────────────────────────────────────────────────
Write-Step "Removing from user PATH..."
$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($userPath -like "*$InstallDir*") {
    $newPath = ($userPath.Split(";") | Where-Object { $_ -ne $InstallDir }) -join ";"
    [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
    Write-OK "Removed from PATH"
} else {
    Write-OK "Was not in PATH"
}

# ── Done ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "  Uninstall Complete!" -ForegroundColor White
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  $AppName has been removed from your system." -ForegroundColor White
Write-Host ""
