# Formula Inserter — per-user uninstaller. Removes the registration and local
# files. No admin required. Restart Word afterwards to complete removal.

$ErrorActionPreference = "SilentlyContinue"

$dir = Join-Path $env:LOCALAPPDATA "FormulaInserter"
$manifest = Join-Path $dir "manifest.xml"

# Remove the developer-add-in registration.
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer" -Name $manifest -Force

# Clean up the older trusted-catalog entry, if a previous version created one.
Remove-Item -Path "HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\7f3c9a10-2b4d-4e8a-9c1f-aa01bb02cc03" -Recurse -Force

Remove-Item -Path $dir -Recurse -Force

Write-Host "Formula Inserter removed. Restart Word to complete removal." -ForegroundColor Green
