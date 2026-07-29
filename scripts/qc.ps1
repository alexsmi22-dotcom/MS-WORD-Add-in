# JurisLab — automated QC gate.
#
# Runs everything that can be verified WITHOUT the Word host, in one command:
#    1. Type-check (tsc)          5. Production build (webpack)   9. Tool detail pages
#    2. Unit tests (jest)         6. Manifest validation         10. Pane layout
#    3. Compound dictionary       7. Headless render check       11. Engineering audit
#    4. Compound vs PubChem       8. Landing-page layout        12. Task-pane id wiring audit
#
# (11 Invoke-Step gates plus the id-wiring audit at the end. This list had itself
# gone stale, naming eight steps for a file that ran eleven — the same drift the
# gates below exist to catch, in the header describing them.)
#
# Exit codes: 0 all passed - 1 something failed - 3 nothing failed but a gate was
# SKIPPED (the two headless gates need a Chromium-family browser).
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

# Three states, not two. A step that exits 2 has SKIPPED — it ran but inspected
# nothing (no browser installed). Recording that as PASS is how "ALL AUTOMATED QC
# PASSED" came to be printed for a run where neither of the two gates that see
# real rendered output had looked at anything.
#
# $LASTEXITCODE is cleared first: with $ErrorActionPreference = "Continue", a
# command that fails to LAUNCH leaves the previous step's exit code in place, so
# a missing `node` would inherit the preceding success.
function Invoke-Step {
  param([string]$Name, [scriptblock]$Action)
  Write-Host ""
  Write-Host "==> $Name" -ForegroundColor Cyan
  $global:LASTEXITCODE = $null
  & $Action | Out-Host
  $code = $LASTEXITCODE
  $state = if ($null -eq $code) { "FAIL" } elseif ($code -eq 0) { "PASS" } elseif ($code -eq 2) { "SKIPPED" } else { "FAIL" }
  $results[$Name] = $state
  $colour = switch ($state) { "PASS" { "Green" } "SKIPPED" { "Yellow" } default { "Red" } }
  Write-Host ("    {0}: {1}" -f $state, $Name) -ForegroundColor $colour
}

Invoke-Step "Type-check (tsc)"    { npm run lint }
Invoke-Step "Unit tests (jest)"   { npm test }
# The compound dictionary feeds Chemical, Spectra, Mass Spec, pKa and properties.
# A wrong entry there is a confident wrong answer in five modes at once, so it gets
# its own gate. The structural check against PubChem runs inside jest above
# (compoundsVsPubChem.test.ts); this is the cheap parse/consistency sweep.
Invoke-Step "Compound dictionary" { npm run validate:compounds }
Invoke-Step "Compound vs PubChem" { npm run verify:compounds }
Invoke-Step "Production build"     { npm run build }
Invoke-Step "Manifest validation" { npx office-addin-manifest validate manifest.xml }
Invoke-Step "Render check"        { node scripts/render-check.js }
# The landing page is the most public artefact here and the least covered by jest:
# a leader line through a label, a feature name printed over a tick, and a stats
# table silently losing two columns below 940px all shipped because the markup
# reads fine and only a laid-out browser shows the collision.
Invoke-Step "Landing layout"      { node scripts/check-landing-overlap.js }
# A layout gate cannot see a page with NO layout. tool.html?tool=engineering was
# broken from the day Engineering shipped and stayed broken for ten releases: the
# entry carried `body`/`limits` where the renderer reads `does`/`examples`, so it
# threw and rendered a title and nothing else — no capabilities, no examples, no
# honest-limits text, no prev/next. An empty page cannot overlap itself, so the
# layout gate passed it every time. This asserts the renderer's contract instead.
Invoke-Step "Tool detail pages"   { node scripts/check-tool-pages.js }
# The landing pages had a layout gate; the PANE — the actual product — had none.
# The pane scrolls vertically only, so anything past the right edge is
# unreachable rather than awkward: Align's mode <select> sat 21px off the edge at
# 320px, where the control could not be clicked at all.
Invoke-Step "Pane layout"         { node scripts/check-pane-layout.js }
# Engineering is 36 calculators whose engines carry thousands of unit tests, and
# every Engineering defect that reached a user still lived ABOVE them: a formula
# path that was never routed, an OOXML package that swallowed the paragraphs
# after it, a figure chain that dropped the second figure. Unit tests cannot see
# any of those, because none of them is a wrong number. This drives the real
# bundle instead — computes, empties, corrupts, then inserts against a recording
# Word mock — and self-tests its own predicates first, since three earlier runs
# of it reported the harness rather than the product.
Invoke-Step "Engineering audit"   { node scripts/engineering-audit.js }

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
$results["Id wiring audit"] = $(if ($idOk) { "PASS" } else { "FAIL" })
if ($idOk) {
  Write-Host ("    PASS: all {0} ids matched" -f @($tsIds).Count) -ForegroundColor Green
} else {
  Write-Host ("    FAIL: ids with no matching HTML element -> {0}" -f ($missing -join ", ")) -ForegroundColor Red
}

# Summary
Write-Host ""
Write-Host "================= QC SUMMARY =================" -ForegroundColor Cyan
$allOk = $true
$anySkipped = $false
foreach ($k in $results.Keys) {
  $state = $results[$k]
  if ($state -eq "FAIL") { $allOk = $false }
  if ($state -eq "SKIPPED") { $anySkipped = $true }
  $colour = switch ($state) { "PASS" { "Green" } "SKIPPED" { "Yellow" } default { "Red" } }
  Write-Host ("  {0,-26} {1}" -f $k, $state) -ForegroundColor $colour
}
Write-Host "============================================="
if ($allOk -and -not $anySkipped) {
  Write-Host "ALL AUTOMATED QC PASSED." -ForegroundColor Green
  Write-Host "Next (manual): load the add-in in Word and run docs\TEST-SCRIPT.md." -ForegroundColor Green
  exit 0
} elseif ($allOk) {
  # Nothing failed, but something did not run. Saying "all passed" here would be
  # a claim the run cannot support.
  Write-Host "QC INCOMPLETE - nothing failed, but one or more gates were SKIPPED." -ForegroundColor Yellow
  Write-Host "The skipped gates need a Chromium-family browser; set CHROME_PATH to run them." -ForegroundColor Yellow
  exit 3
} else {
  Write-Host "QC FAILED - fix the items above before release." -ForegroundColor Red
  exit 1
}
