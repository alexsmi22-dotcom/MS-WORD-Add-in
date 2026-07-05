# Builds distributable JurisLab packages (separate per OS).
#
#   powershell -ExecutionPolicy Bypass -File scripts\package.ps1 -HostUrl https://your-host/formula-inserter
#
# Produces under release\ :
#   formula-inserter-host\           -> the HTTPS-hosted files (upload ONCE)
#     web\, manifest.xml, HOST-SETUP.md
#   formula-inserter-windows\ (.zip) -> emailed to Windows users
#     manifest.xml, install.ps1/.bat, uninstall.ps1/.bat, INSTALL.md, FEATURES.md
#   formula-inserter-mac\ (.zip)     -> emailed to macOS users
#     manifest.xml, install.command, uninstall.command,
#     START HERE - Install on Mac.txt, INSTALL-MAC.md, FEATURES.md
#     Double-click install: user right-clicks install.command > Open the FIRST
#     time (Gatekeeper allows unsigned scripts only via right-click > Open; a
#     plain double-click is blocked). zip-mac.mjs preserves the exec bit so it
#     can run at all. START HERE txt also documents a no-script copy-paste
#     fallback for anyone the script still won't run for.
#
# The same stamped manifest.xml serves both OSes; only the per-user installer differs.

param(
  [Parameter(Mandatory = $true)][string]$HostUrl,
  [string]$OutDir = "release"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$HostUrl = $HostUrl.TrimEnd("/")
if ($HostUrl -notmatch "^https://") { throw "HostUrl must start with https://" }

$release = Join-Path $root $OutDir
$hostPack = Join-Path $release "formula-inserter-host"
$winPack  = Join-Path $release "formula-inserter-windows"
$macPack  = Join-Path $release "formula-inserter-mac"

Write-Host "1/6 Building production bundle..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

Write-Host "2/6 Assembling hosting files..." -ForegroundColor Cyan
foreach ($p in @($hostPack, $winPack, $macPack)) {
  if (Test-Path $p) { [System.IO.Directory]::Delete($p, $true) }
  New-Item -ItemType Directory -Force -Path $p | Out-Null
}
New-Item -ItemType Directory -Force -Path (Join-Path $hostPack "web") | Out-Null
Copy-Item -Path (Join-Path $root "dist\*") -Destination (Join-Path $hostPack "web") -Recurse -Force
# The hosted web folder doesn't need the manifests (webpack copies them into dist).
Get-ChildItem (Join-Path $hostPack "web") -Filter "manifest*.xml" | Remove-Item -Force

Write-Host "3/6 Stamping manifest with $HostUrl ..." -ForegroundColor Cyan
$manifest = Join-Path $hostPack "manifest.xml"
(Get-Content (Join-Path $root "manifest.prod.xml") -Raw) -replace "https://ADDIN-HOST.example.com", $HostUrl |
  Set-Content $manifest -NoNewline

Write-Host "4/6 Validating manifest..." -ForegroundColor Cyan
npx office-addin-manifest validate $manifest
if ($LASTEXITCODE -ne 0) { throw "Manifest validation failed." }

Copy-Item (Join-Path $root "packaging\HOST-SETUP.md") $hostPack -Force

Write-Host "5/6 Assembling per-OS install packs..." -ForegroundColor Cyan
# Windows install pack
Copy-Item $manifest $winPack -Force
Copy-Item (Join-Path $root "packaging\install.bat")   $winPack -Force
Copy-Item (Join-Path $root "packaging\uninstall.bat") $winPack -Force
Copy-Item (Join-Path $root "packaging\install.ps1")   $winPack -Force
Copy-Item (Join-Path $root "packaging\uninstall.ps1") $winPack -Force
Copy-Item (Join-Path $root "packaging\INSTALL.md")    $winPack -Force
Copy-Item (Join-Path $root "FEATURES.md")             $winPack -Force

# macOS install pack — manifest + docs only. We deliberately ship NO runnable
# script: macOS Gatekeeper flags an unsigned downloaded *.command as malware, so
# INSTALL-MAC.md installs via a copy-paste Terminal command instead.
Copy-Item $manifest $macPack -Force
Copy-Item (Join-Path $root "packaging\install.command")   $macPack -Force
Copy-Item (Join-Path $root "packaging\uninstall.command") $macPack -Force
Copy-Item (Join-Path $root "packaging\START HERE - Install on Mac.txt") $macPack -Force
Copy-Item (Join-Path $root "packaging\INSTALL-MAC.md")    $macPack -Force
Copy-Item (Join-Path $root "FEATURES.md")                 $macPack -Force

Write-Host "6/6 Zipping per-OS packs..." -ForegroundColor Cyan
$winZip = Join-Path $release "formula-inserter-windows.zip"
$macZip = Join-Path $release "formula-inserter-mac.zip"
foreach ($z in @($winZip, $macZip)) { if (Test-Path $z) { Remove-Item -Force $z } }
Compress-Archive -Path (Join-Path $winPack "*") -DestinationPath $winZip
# Mac zip is built by a Node zipper that preserves the Unix executable bit on the
# .command files — Compress-Archive writes a DOS zip with no permission bits, so
# install.command would extract non-executable and fail before macOS even prompts.
node (Join-Path $root "scripts\zip-mac.mjs") $macPack $macZip
if ($LASTEXITCODE -ne 0) { throw "Mac zip build failed." }

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Hosting files (upload once): $hostPack\web  ->  $HostUrl"
Write-Host "  Windows install pack:        $winZip"
Write-Host "  macOS install pack:          $macZip"
Write-Host ""
Write-Host "Next: upload 'formula-inserter-host\web' to $HostUrl (one time),"
Write-Host "then email each user the pack for their OS:"
Write-Host "  Windows -> formula-inserter-windows.zip"
Write-Host "  macOS   -> formula-inserter-mac.zip"
