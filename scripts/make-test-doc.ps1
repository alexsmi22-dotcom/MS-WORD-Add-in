# Generates a ready-made Word test document (docs\Formula-Inserter-Test.docx) with
# planted inconsistencies so the Audit / Numerals / Refs steps of the manual test
# script are one-click. A .docx is just a zip of OOXML parts, assembled here with
# no Word dependency.
#
#   powershell -ExecutionPolicy Bypass -File scripts\make-test-doc.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$outPath = Join-Path $root "docs\Formula-Inserter-Test.docx"

# Body paragraphs — each line carries deliberate issues for the audit to catch:
#  - reference-numeral callouts (10),(12) and an ORPHAN (99)
#  - a "Figure 1" caption, with prose refs to Fig. 1 / Fig. 3 / Fig. 7
#    (→ figure-number gap, and dangling Fig. 3 / Fig. 7 with no caption)
#  - SEQ ID NO: 5 (out of range when the listing is empty)
$paras = @(
  "JurisLab - Audit Test Document",
  "",
  "A widget (10) is connected to a housing (12) by a fastener (99).",
  "",
  "Figure 1. The widget assembly.",
  "",
  "As shown in Fig. 1 and Fig. 3, the device operates as described; see Fig. 7 for the variant.",
  "",
  "The polypeptide of SEQ ID NO: 5 binds the target receptor.",
  "",
  "(Generated test document - run docs/TEST-SCRIPT.md against this. Expected audit flags: orphan numeral (99); SEQ ID NO 5 out of range; figure-number gaps; dangling Fig. 3 and Fig. 7.)"
)

function Escape-Xml([string]$s) {
  return $s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;")
}

$body = ($paras | ForEach-Object {
  "<w:p><w:r><w:t xml:space=`"preserve`">$(Escape-Xml $_)</w:t></w:r></w:p>"
}) -join ""

$documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  "<w:body>$body<w:sectPr/></w:body></w:document>"

$contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>'

$rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $outPath) { Remove-Item $outPath -Force }
$enc = New-Object System.Text.UTF8Encoding($false) # no BOM

$zip = [System.IO.Compression.ZipFile]::Open($outPath, [System.IO.Compression.ZipArchiveMode]::Create)
function Add-ZipEntry($zip, $name, $content, $enc) {
  $entry = $zip.CreateEntry($name)
  $stream = $entry.Open()
  $writer = New-Object System.IO.StreamWriter($stream, $enc)
  $writer.Write($content)
  $writer.Flush()
  $writer.Dispose()
}
Add-ZipEntry $zip "[Content_Types].xml" $contentTypes $enc
Add-ZipEntry $zip "_rels/.rels" $rels $enc
Add-ZipEntry $zip "word/document.xml" $documentXml $enc
$zip.Dispose()

Write-Host "Wrote $outPath" -ForegroundColor Green
