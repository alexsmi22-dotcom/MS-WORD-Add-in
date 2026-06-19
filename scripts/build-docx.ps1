# Builds release/Formula-Inserter-Architecture.docx from ARCHITECTURE.md.
#   1) Markdown -> HTML            (scripts/md-to-html.js)
#   2) SVG diagrams -> PNG @2x     (headless Edge; Word's own SVG->docx save hangs on this build)
#   3) Word (COM) opens the HTML, swaps each [[DIAGRAM:<name>]] placeholder for the
#      rasterized PNG (centered, fit to text width), and saves as .docx.
#
# Requires: Node.js on PATH, desktop Word, and Microsoft Edge.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\build-docx.ps1

$ErrorActionPreference = "Stop"
$proj    = Split-Path -Parent $PSScriptRoot
$md      = Join-Path $proj "ARCHITECTURE.md"
$html    = Join-Path $proj "ARCHITECTURE.html"
$docx    = Join-Path $proj "release\Formula-Inserter-Architecture.docx"
$diagDir = Join-Path $proj "docs\diagrams"
$edge    = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw "Microsoft Edge not found." }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $env:Path = "C:\Program Files\nodejs;$env:Path"
}

Write-Output "1/3  Markdown -> HTML"
node (Join-Path $proj "scripts\md-to-html.js") $md $html

Write-Output "2/3  SVG diagrams -> PNG @2x (headless Edge)"
$cache = Join-Path $env:TEMP ("diag_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $cache | Out-Null
$diagrams = @{}   # name -> @{ Png; WidthPt }
foreach ($svg in Get-ChildItem -Path $diagDir -Filter *.svg) {
  $name = [System.IO.Path]::GetFileNameWithoutExtension($svg.Name)
  $raw  = Get-Content $svg.FullName -Raw
  $w = [int]([regex]::Match($raw, 'width="(\d+)"').Groups[1].Value)
  $h = [int]([regex]::Match($raw, 'height="(\d+)"').Groups[1].Value)
  if ($w -le 0) { $w = 640 }; if ($h -le 0) { $h = 400 }
  $png = Join-Path $cache "$name.png"
  $url = "file:///" + ($svg.FullName -replace '\\','/')
  $udd = Join-Path $cache ("u_" + $name)
  $eArgs = @(
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
    "--default-background-color=FFFFFFFF", "--window-size=$w,$h",
    "--screenshot=$png", "--virtual-time-budget=3000", "--user-data-dir=$udd", $url
  )
  # Start-Process keeps Edge's noisy stderr out of PowerShell's error stream.
  Start-Process -FilePath $edge -ArgumentList $eArgs -Wait -NoNewWindow `
    -RedirectStandardError (Join-Path $cache "$name.err.log") | Out-Null
  if (-not (Test-Path $png)) { throw "Edge failed to rasterize $name" }
  $diagrams[$name] = @{ Png = $png; WidthPt = [math]::Round($w * 0.75) }   # px @96dpi -> pt
  Write-Output "      rasterized $name ($w x $h)"
}

Write-Output "3/3  HTML -> .docx (embedding diagrams)"
# Word is driven inside a timeout-guarded job, saving to a TEMP path. Saving headless
# Word directly into the (OneDrive-synced) project folder blocks indefinitely; saving to
# %TEMP% and copying the finished file in avoids the sync hook entirely.
$tmpDocx = Join-Path $env:TEMP ("archbuild_" + [guid]::NewGuid().ToString("N") + ".docx")
$job = Start-Job -ScriptBlock {
  param($html, $tmpDocx, $diagrams)
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false; $word.DisplayAlerts = 0
  try {
    $doc  = $word.Documents.Open($html)
    $maxW = $doc.PageSetup.PageWidth - $doc.PageSetup.LeftMargin - $doc.PageSetup.RightMargin
    foreach ($name in $diagrams.Keys) {
      $rng = $doc.Content; $f = $rng.Find
      $f.ClearFormatting(); $f.Forward = $true; $f.Wrap = 1; $f.Text = "[[DIAGRAM:$name]]"
      if ($f.Execute()) {
        $rng.Text = ""; $rng.Collapse(0)
        $shape = $doc.InlineShapes.AddPicture($diagrams[$name].Png, $false, $true, $rng)
        $shape.LockAspectRatio = -1
        $shape.Width = [math]::Min($diagrams[$name].WidthPt, $maxW)
        $shape.Range.ParagraphFormat.Alignment = 1
        "embedded $name"
      } else { "WARNING: placeholder not found for $name" }
    }
    $doc.SaveAs2($tmpDocx, 16); $doc.Close($false)
  } finally {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  }
} -ArgumentList $html, $tmpDocx, $diagrams

if (Wait-Job $job -Timeout 180) {
  Receive-Job $job | ForEach-Object { Write-Output "      $_" }
} else {
  Stop-Job $job
  Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq "" } | ForEach-Object { Stop-Process -Id $_.Id -Force }
  throw "Word conversion timed out after 180s."
}
if (-not (Test-Path $tmpDocx)) { throw "Conversion produced no file." }

Copy-Item $tmpDocx $docx -Force
Write-Output "Saved: $docx"
Get-Item $docx | Select-Object Name, @{n='KB';e={[math]::Round($_.Length/1KB,1)}}, LastWriteTime | Format-List
