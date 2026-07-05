# JurisLab — per-user installer for Word on Windows (no admin required).
#
# Registers the add-in for your user account so Word loads it from its hosted
# location. After running, restart Word and find it under:
#   Insert > Add-ins > Developer Add-ins > JurisLab
#
# Run it: right-click install.ps1 > "Run with PowerShell", or in a terminal:
#   powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"

$src = Join-Path $PSScriptRoot "manifest.xml"
if (-not (Test-Path $src)) { throw "manifest.xml not found next to this script." }

# 1. Copy the manifest to a stable per-user location.
$dir = Join-Path $env:LOCALAPPDATA "FormulaInserter"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$manifest = Join-Path $dir "manifest.xml"
Copy-Item -Path $src -Destination $manifest -Force

# 2. Register it as a per-user add-in under HKCU (no admin, no debugger prompt).
$dev = "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer"
New-Item -Path $dev -Force | Out-Null
New-ItemProperty -Path $dev -Name $manifest -Value $manifest -PropertyType String -Force | Out-Null

Write-Host ""
Write-Host "JurisLab installed for your user account." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Fully close and reopen Word (all windows)."
Write-Host "  2. Insert tab > Add-ins > Developer Add-ins > JurisLab."
Write-Host ""
Write-Host "To remove it later, run uninstall.ps1."
