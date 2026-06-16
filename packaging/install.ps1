# Formula Inserter — per-user installer for Word on Windows (no admin required).
#
# What it does: copies manifest.xml into a local catalog folder and registers
# that folder as a Trusted Add-in Catalog under HKEY_CURRENT_USER (per-user, so
# no administrator rights are needed). After running, restart Word and pick the
# add-in from Insert > Add-ins > My Add-ins > SHARED FOLDER.
#
# The add-in's web files are hosted by your organisation (the manifest points to
# them); this script only registers the manifest on your machine.
#
# Run it by right-clicking install.ps1 > "Run with PowerShell", or in a terminal:
#   powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"

$manifest = Join-Path $PSScriptRoot "manifest.xml"
if (-not (Test-Path $manifest)) { throw "manifest.xml not found next to this script." }

# 1. Local catalog folder containing the manifest.
$catalogDir = Join-Path $env:LOCALAPPDATA "FormulaInserter\catalog"
New-Item -ItemType Directory -Force -Path $catalogDir | Out-Null
Copy-Item -Path $manifest -Destination $catalogDir -Force

# 2. Register the folder as a Trusted Catalog (fixed GUID = idempotent re-runs).
$catalogId = "7f3c9a10-2b4d-4e8a-9c1f-aa01bb02cc03"
$wef = "HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs"
$key = Join-Path $wef $catalogId
New-Item -Path $key -Force | Out-Null
New-ItemProperty -Path $key -Name "Id"    -Value $catalogId -PropertyType String -Force | Out-Null
New-ItemProperty -Path $key -Name "Url"   -Value $catalogDir -PropertyType String -Force | Out-Null
New-ItemProperty -Path $key -Name "Flags" -Value 1           -PropertyType DWord  -Force | Out-Null

Write-Host ""
Write-Host "Formula Inserter registered for your user account." -ForegroundColor Green
Write-Host "Catalog: $catalogDir"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Fully close and reopen Word."
Write-Host "  2. Insert tab > Add-ins (or 'My Add-ins') > SHARED FOLDER tab."
Write-Host "  3. Choose 'Formula Inserter' and click Add."
Write-Host ""
Write-Host "To uninstall later, run uninstall.ps1 (or delete the registry key above)."
