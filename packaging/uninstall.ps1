# Formula Inserter — per-user uninstaller. Removes the trusted-catalog registry
# entry and the local catalog folder. Does not require admin.

$ErrorActionPreference = "SilentlyContinue"

$catalogId = "7f3c9a10-2b4d-4e8a-9c1f-aa01bb02cc03"
$key = "HKCU:\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\$catalogId"
Remove-Item -Path $key -Recurse -Force
Remove-Item -Path (Join-Path $env:LOCALAPPDATA "FormulaInserter") -Recurse -Force

Write-Host "Formula Inserter unregistered. Restart Word to complete removal." -ForegroundColor Green
