# Builds a distributable Formula Inserter package.
#
#   powershell -ExecutionPolicy Bypass -File scripts\package.ps1 -HostUrl https://your-host/formula-inserter
#
# Produces release\formula-inserter\ (and a .zip) containing:
#   web\           -> upload to <HostUrl> (the add-in's HTTPS-hosted files)
#   manifest.xml   -> stamped with <HostUrl>; users register this
#   install.ps1    -> per-user installer (no admin)
#   uninstall.ps1, INSTALL.md, HOST-SETUP.md

param(
  [Parameter(Mandatory = $true)][string]$HostUrl,
  [string]$OutDir = "release"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$HostUrl = $HostUrl.TrimEnd("/")
if ($HostUrl -notmatch "^https://") { throw "HostUrl must start with https://" }

Write-Host "1/5 Building production bundle..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

Write-Host "2/5 Assembling package..." -ForegroundColor Cyan
$stage = Join-Path (Join-Path $root $OutDir) "formula-inserter"
if (Test-Path $stage) { [System.IO.Directory]::Delete($stage, $true) }
New-Item -ItemType Directory -Force -Path (Join-Path $stage "web") | Out-Null
Copy-Item -Path (Join-Path $root "dist\*") -Destination (Join-Path $stage "web") -Recurse -Force
# The hosted web folder doesn't need the manifests (webpack copies them into dist).
Get-ChildItem (Join-Path $stage "web") -Filter "manifest*.xml" | Remove-Item -Force

Write-Host "3/5 Stamping manifest with $HostUrl ..." -ForegroundColor Cyan
(Get-Content (Join-Path $root "manifest.prod.xml") -Raw) -replace "https://ADDIN-HOST.example.com", $HostUrl |
  Set-Content (Join-Path $stage "manifest.xml") -NoNewline

Write-Host "4/5 Validating manifest..." -ForegroundColor Cyan
npx office-addin-manifest validate (Join-Path $stage "manifest.xml")
if ($LASTEXITCODE -ne 0) { throw "Manifest validation failed." }

Copy-Item (Join-Path $root "packaging\install.bat")   $stage -Force
Copy-Item (Join-Path $root "packaging\uninstall.bat") $stage -Force
Copy-Item (Join-Path $root "packaging\install.ps1")   $stage -Force
Copy-Item (Join-Path $root "packaging\uninstall.ps1") $stage -Force
Copy-Item (Join-Path $root "packaging\INSTALL.md")    $stage -Force
Copy-Item (Join-Path $root "packaging\HOST-SETUP.md") $stage -Force

Write-Host "5/5 Zipping..." -ForegroundColor Cyan
$zip = Join-Path (Join-Path $root $OutDir) "formula-inserter.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Package folder: $stage"
Write-Host "  Zip:            $zip"
Write-Host ""
Write-Host "Next: upload the 'web' folder to $HostUrl, then send manifest.xml + install.ps1 + INSTALL.md to users."
