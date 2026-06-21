# Builds docs\Formula-Inserter-Capabilities.docx from docs\CAPABILITIES.md
# (Markdown -> HTML via scripts/md-to-html.js, then Word COM saves it as .docx).
# A shareable/printable handout. Requires Node.js + desktop Word.
#
#   powershell -ExecutionPolicy Bypass -File scripts\make-capabilities-docx.ps1

$ErrorActionPreference = "Stop"
$proj = Split-Path -Parent $PSScriptRoot
$md   = Join-Path $proj "docs\CAPABILITIES.md"
$html = Join-Path $env:TEMP ("cap_" + [guid]::NewGuid().ToString("N") + ".html")
$docx = Join-Path $proj "docs\Formula-Inserter-Capabilities.docx"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $env:Path = "C:\Program Files\nodejs;$env:Path" }

Write-Output "1/2  Markdown -> HTML"
node (Join-Path $proj "scripts\md-to-html.js") $md $html

Write-Output "2/2  HTML -> .docx (Word COM; saved to TEMP then copied to avoid sync hangs)"
$tmpDocx = Join-Path $env:TEMP ("capbuild_" + [guid]::NewGuid().ToString("N") + ".docx")
$job = Start-Job -ScriptBlock {
  param($html, $tmpDocx)
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false; $word.DisplayAlerts = 0
  try {
    $doc = $word.Documents.Open($html)
    $doc.SaveAs2($tmpDocx, 16) # 16 = wdFormatDocumentDefault (.docx)
    $doc.Close($false)
  } finally {
    $word.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  }
} -ArgumentList $html, $tmpDocx

if (Wait-Job $job -Timeout 180) {
  Receive-Job $job | Out-Null
} else {
  Stop-Job $job
  Get-Process WINWORD -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq "" } | ForEach-Object { Stop-Process -Id $_.Id -Force }
  throw "Word conversion timed out after 180s."
}
if (-not (Test-Path $tmpDocx)) { throw "Conversion produced no file." }

Copy-Item $tmpDocx $docx -Force
Write-Output "Saved: $docx"
