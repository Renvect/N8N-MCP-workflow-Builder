# package-portable.ps1
# Run AFTER dist:win to zip the win-unpacked folder for PowerShell distribution
# Usage: powershell -ExecutionPolicy Bypass -File scripts/package-portable.ps1

$ErrorActionPreference = "Stop"

$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$pkgJson     = Get-Content (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$version     = $pkgJson.version
$appName     = "N8N-MCP-Guardrail"

$unpackedDir = Join-Path $projectRoot "out\installer\win-unpacked"
$outputDir   = Join-Path $projectRoot "out\installer"
$zipName     = "$appName-$version-win-x64-portable.zip"
$zipPath     = Join-Path $outputDir $zipName

if (-not (Test-Path $unpackedDir)) {
    Write-Error "win-unpacked not found at: $unpackedDir`nRun 'npm run dist:win' first."
    exit 1
}

# Remove old zip if exists
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
    Write-Host "Removed previous: $zipName"
}

Write-Host "Packaging portable zip from win-unpacked..."
Write-Host "  Source : $unpackedDir"
Write-Host "  Output : $zipPath"

Compress-Archive -Path "$unpackedDir\*" -DestinationPath $zipPath -CompressionLevel Optimal

$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host ""
Write-Host "Done! Created: $zipName ($sizeMB MB)" -ForegroundColor Green
Write-Host ""
Write-Host "Upload this file to your hosting (Supabase Storage, S3, GitHub Releases, etc.)"
Write-Host "Then update the `$DownloadUrl in scripts/install.ps1 to point to it."
