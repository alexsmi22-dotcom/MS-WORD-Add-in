// Generates review-sheet.html — every compound in the dictionary rendered as
// name -> formula -> MW -> SMILES -> 2D structure, so a chemist can verify the
// dictionary's chemical correctness in one pass before claim-critical use.
//
//   node scripts/review-sheet.js   (then open review-sheet.html in a browser)

const fs = require("fs");
const path = require("path");
const OCL = require("openchemlib");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "lib", "compounds.json"), "utf8"));

function cell(name, smiles) {
  let svg = "";
  let formula = "";
  let mw = "";
  let err = "";
  try {
    const mol = OCL.Molecule.fromSmiles(smiles);
    mol.inventCoordinates();
    svg = mol.toSVG(150, 120);
    const mf = mol.getMolecularFormula();
    formula = mf.formula;
    mw = (Math.round(mf.relativeWeight * 100) / 100).toString();
  } catch (e) {
    err = e.message;
  }
  return `<div class="card${err ? " err" : ""}">
    <div class="struct">${svg || "(no structure)"}</div>
    <div class="name">${name}</div>
    <div class="meta">${formula}${mw ? " · MW " + mw : ""}</div>
    <div class="smi">${smiles}</div>
    ${err ? `<div class="errmsg">${err}</div>` : ""}
  </div>`;
}

function section(title, dict) {
  const cells = Object.keys(dict)
    .sort()
    .map((k) => cell(k, dict[k]))
    .join("\n");
  return `<h2>${title} (${Object.keys(dict).length})</h2><div class="grid">${cells}</div>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Compound dictionary review</title>
<style>
 body{font-family:'Segoe UI',sans-serif;margin:24px;color:#201f1e;}
 h1{font-size:22px;} h2{font-size:16px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:4px;}
 .note{color:#605e5c;font-size:13px;}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-top:10px;}
 .card{border:1px solid #d0d0d0;border-radius:6px;padding:8px;text-align:center;}
 .card.err{border-color:#a4262c;background:#fdf3f4;}
 .struct{height:120px;display:flex;align-items:center;justify-content:center;}
 .struct svg{max-width:100%;max-height:120px;}
 .name{font-weight:600;font-size:13px;margin-top:4px;text-transform:capitalize;}
 .meta{font-size:12px;color:#605e5c;}
 .smi{font-family:Consolas,monospace;font-size:11px;color:#888;word-break:break-all;margin-top:2px;}
 .errmsg{color:#a4262c;font-size:11px;}
 @media print{.card{break-inside:avoid;}}
</style></head><body>
<h1>Formula Inserter — compound dictionary review</h1>
<p class="note">Verify each structure matches the name. Tick / annotate as needed.
 Entries that fail to parse are highlighted red. Source: <code>src/lib/compounds.json</code>.</p>
${section("Names", data.names)}
${section("Formulas", data.formulas)}
</body></html>`;

fs.writeFileSync(path.join(__dirname, "..", "review-sheet.html"), html);
const total = Object.keys(data.names).length + Object.keys(data.formulas).length;
console.log(`Wrote review-sheet.html (${total} compounds).`);
