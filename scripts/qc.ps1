# JurisLab — automated QC gate.
#
# Runs everything that can be verified WITHOUT the Word host, in one command:
#   1. Type-check (tsc)         3. Production build (webpack)   5. Task-pane id wiring audit
#   2. Unit tests (jest)        4. Manifest validation          6. Headless render check
#
# Prints a PASS/FAIL summary and exits non-zero if anything fails. The remaining
# in-Word functional pass is the manual checklist in docs\TEST-SCRIPT.md — step 6
# now covers the pane WIRING (every tool renders its own section, Home shows only
# tiles), which is the class of bug that had been shipping unnoticed; the manual
# pass still owns layout, styling, and anything needing a live document.
#
#   powershell -ExecutionPolicy Bypass -File scripts\qc.ps1     (or: npm run qc)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (Test-Path "C:\Program Files\nodejs") { $env:Path = "C:\Program Files\nodejs;$env:Path" }

$results = [ordered]@{}

function Invoke-Step {
  param([string]$Name, [scriptblock]$Action)
  Write-Host ""
  Write-Host "==> $Name" -ForegroundColor Cyan
  & $Action | Out-Host
  $ok = ($LASTEXITCODE -eq 0)
  $results[$Name] = $ok
  Write-Host ("    {0}: {1}" -f $(if ($ok) { "PASS" } else { "FAIL" }), $Name) -ForegroundColor $(if ($ok) { "Green" } else { "Red" })
}

Invoke-Step "Type-check (tsc)"    { npm run lint }
Invoke-Step "Unit tests (jest)"   { npm test }
Invoke-Step "Production build"     { npm run build }
Invoke-Step "Manifest validation" { npx office-addin-manifest validate manifest.xml }
Invoke-Step "Render check"        { node scripts/render-check.js }

# 5. Task-pane id wiring audit — every getElementById has a matching HTML id.
Write-Host ""
Write-Host "==> Task-pane id wiring audit" -ForegroundColor Cyan
$ts = Get-Content "src\taskpane\taskpane.ts" -Raw
$html = Get-Content "src\taskpane\taskpane.html" -Raw
$tsIds = [regex]::Matches($ts, 'getElementById\("([^"]+)"\)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
$htmlIds = [regex]::Matches($html, 'id="([^"]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
# Some elements are created at runtime rather than authored in the HTML (e.g. the
# update banner: the code assigns `bar.id = "update-banner"` and the matching
# getElementById is only a guard against creating it twice). Those ids are wired
# correctly and must not be reported as missing.
$dynamicIds = [regex]::Matches($ts, '\.id\s*=\s*"([^"]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
$knownIds = @($htmlIds) + @($dynamicIds)
$missing = $tsIds | Where-Object { $_ -notin $knownIds }
$idOk = (@($missing).Count -eq 0)
$results["Id wiring audit"] = $idOk
if ($idOk) {
  Write-Host ("    PASS: all {0} ids matched" -f @($tsIds).Count) -ForegroundColor Green
} else {
  Write-Host ("    FAIL: ids with no matching HTML element -> {0}" -f ($missing -join ", ")) -ForegroundColor Red
}

# Summary
Write-Host ""
Write-Host "================= QC SUMMARY =================" -ForegroundColor Cyan
$allOk = $true
foreach ($k in $results.Keys) {
  if (-not $results[$k]) { $allOk = $false }
  Write-Host ("  {0,-26} {1}" -f $k, $(if ($results[$k]) { "PASS" } else { "FAIL" })) -ForegroundColor $(if ($results[$k]) { "Green" } else { "Red" })
}
Write-Host "============================================="
if ($allOk) {
  Write-Host "ALL AUTOMATED QC PASSED." -ForegroundColor Green
  Write-Host "Next (manual): load the add-in in Word and run docs\TEST-SCRIPT.md." -ForegroundColor Green
  exit 0
} else {
  Write-Host "QC FAILED - fix the items above before release." -ForegroundColor Red
  exit 1
}
