// Verifies every compound-dictionary NAME against PubChem — the external ground
// truth check the audit flagged as P0 #1.
//
// Why this exists: validate-compounds.mjs and compounds.test.ts only assert that
// each SMILES *parses* (getAllAtoms() > 0). A SMILES that is perfectly valid but
// is the WRONG MOLECULE for its name passes that check silently, and then feeds a
// confident wrong structure — and a wrong predicted spectrum, pKa and mass — into
// Chemical, Spectra, Mass Spec and pKa modes. That is the same defect class as the
// arginine pKa bug (net charge +2.00 against a true +1.0) that shipped live.
//
// Method: fetch PubChem's structure for each name, then parse PubChem's SMILES and
// OUR SMILES through the SAME OpenChemLib canonicalizer and compare ID codes. Both
// sides go through one canonicalizer, so the comparison is apples-to-apples and is
// exact on connectivity — a formula check alone would pass a wrong isomer.
//
// This script REPORTS. It never auto-corrects: a mismatch is often a naming
// ambiguity ("iodine" = I2 or the atom?) that needs a chemist, not a script.
//
//   node scripts/verify-compounds-pubchem.mjs          # use cache, fetch misses
//   node scripts/verify-compounds-pubchem.mjs --refresh # re-fetch everything

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OCL from "openchemlib";

const { Molecule } = OCL;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const DICT = path.join(ROOT, "src/lib/compounds.json");
const CACHE = path.join(ROOT, "src/lib/__tests__/fixtures/pubchem-names.json");

const REFRESH = process.argv.includes("--refresh");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** OCL canonical ID code for a SMILES, or null if unparseable. */
function idcode(smiles, { stripStereo = false } = {}) {
  try {
    const m = Molecule.fromSmiles(smiles);
    if (m.getAllAtoms() === 0) return null;
    if (stripStereo) m.stripStereoInformation();
    return m.getIDCode();
  } catch {
    return null;
  }
}

function formulaOf(smiles) {
  try {
    const m = Molecule.fromSmiles(smiles);
    if (m.getAllAtoms() === 0) return null;
    return m.getMolecularFormula().formula;
  } catch {
    return null;
  }
}

/** PubChem PUG-REST: name -> {cid, formula, smiles, inchikey}. null = not found. */
async function pubchem(name) {
  const url =
    "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/" +
    encodeURIComponent(name) +
    "/property/MolecularFormula,SMILES,InChIKey/JSON";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
      if (res.status === 404) return { notFound: true };
      if (res.status === 503 || res.status === 429) {
        await sleep(2000 * (attempt + 1)); // PubChem throttle — back off
        continue;
      }
      if (!res.ok) return { error: "HTTP " + res.status };
      const j = await res.json();
      const p = j?.PropertyTable?.Properties?.[0];
      if (!p) return { notFound: true };
      return {
        cid: p.CID,
        formula: p.MolecularFormula ?? null,
        smiles: p.SMILES ?? p.IsomericSMILES ?? p.ConnectivitySMILES ?? null,
        inchikey: p.InChIKey ?? null,
      };
    } catch (e) {
      if (attempt === 3) return { error: String(e?.message ?? e) };
      await sleep(1500 * (attempt + 1));
    }
  }
  return { error: "retries exhausted" };
}

const dict = JSON.parse(fs.readFileSync(DICT, "utf8"));
const names = dict.names;
const formulas = dict.formulas;

// ---------------------------------------------------------------------------
// Part 1: formulas — fully offline. The key IS the assertion: OCL's formula for
// the mapped SMILES must equal the key it is filed under.
// ---------------------------------------------------------------------------
const formulaBad = [];
for (const [key, smiles] of Object.entries(formulas)) {
  const got = formulaOf(smiles);
  if (got !== key) formulaBad.push({ key, smiles, got: got ?? "UNPARSEABLE" });
}
console.log(`FORMULAS: ${Object.keys(formulas).length - formulaBad.length}/${Object.keys(formulas).length} self-consistent`);
for (const b of formulaBad) console.log(`  MISMATCH  ${b.key}  ->  ${b.smiles}  (OCL says ${b.got})`);

// ---------------------------------------------------------------------------
// Part 2: names — needs PubChem. Cached so the check is repeatable offline.
// ---------------------------------------------------------------------------
let cache = {};
if (!REFRESH && fs.existsSync(CACHE)) cache = JSON.parse(fs.readFileSync(CACHE, "utf8"));

const todo = Object.keys(names).filter((n) => !cache[n]);
if (todo.length) {
  console.log(`\nFetching ${todo.length} names from PubChem (~${Math.ceil(todo.length / 4)}s)...`);
  let done = 0;
  for (const name of todo) {
    cache[name] = await pubchem(name);
    done++;
    if (done % 25 === 0) {
      console.log(`  ${done}/${todo.length}`);
      fs.mkdirSync(path.dirname(CACHE), { recursive: true });
      fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1)); // checkpoint
    }
    await sleep(220); // PubChem asks for <=5 req/sec
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1));
}

const R = { EXACT: [], STEREO: [], ISOMER: [], WRONG: [], NOTFOUND: [], ERROR: [] };

for (const [name, ours] of Object.entries(names)) {
  const pc = cache[name];
  if (!pc || pc.error) { R.ERROR.push({ name, why: pc?.error ?? "no cache" }); continue; }
  if (pc.notFound) { R.NOTFOUND.push({ name, ours }); continue; }

  const ourId = idcode(ours);
  const pcId = pc.smiles ? idcode(pc.smiles) : null;
  if (ourId && pcId && ourId === pcId) { R.EXACT.push(name); continue; }

  const ourFlat = idcode(ours, { stripStereo: true });
  const pcFlat = pc.smiles ? idcode(pc.smiles, { stripStereo: true }) : null;
  if (ourFlat && pcFlat && ourFlat === pcFlat) {
    R.STEREO.push({ name, ours, pubchem: pc.smiles, cid: pc.cid });
    continue;
  }

  const ourF = formulaOf(ours);
  const rec = { name, ours, pubchem: pc.smiles, ourFormula: ourF, pcFormula: pc.formula, cid: pc.cid };
  // Same formula, different skeleton = wrong isomer. Different formula = flat wrong.
  if (ourF && pc.formula && ourF === pc.formula) R.ISOMER.push(rec);
  else R.WRONG.push(rec);
}

const total = Object.keys(names).length;
console.log(`\n${"=".repeat(72)}\nNAMES vs PubChem  (${total} entries)\n${"=".repeat(72)}`);
console.log(`  EXACT match (structure + stereo) : ${R.EXACT.length}`);
console.log(`  Connectivity match, stereo differs: ${R.STEREO.length}`);
console.log(`  SAME FORMULA, WRONG SKELETON     : ${R.ISOMER.length}   <-- isomer error`);
console.log(`  FORMULA DIFFERS                  : ${R.WRONG.length}   <-- wrong molecule`);
console.log(`  PubChem has no such name         : ${R.NOTFOUND.length}`);
console.log(`  Fetch errors                     : ${R.ERROR.length}`);

const dump = (label, arr, fmt) => {
  if (!arr.length) return;
  console.log(`\n--- ${label} (${arr.length}) ---`);
  for (const x of arr) console.log("  " + fmt(x));
};
dump("FORMULA DIFFERS — wrong molecule", R.WRONG, (x) =>
  `${x.name}\n      ours   : ${x.ours}  [${x.ourFormula}]\n      PubChem: ${x.pubchem}  [${x.pcFormula}]  CID ${x.cid}`);
dump("SAME FORMULA, WRONG SKELETON — isomer error", R.ISOMER, (x) =>
  `${x.name}  [${x.ourFormula}]\n      ours   : ${x.ours}\n      PubChem: ${x.pubchem}  CID ${x.cid}`);
dump("STEREO DIFFERS (connectivity correct)", R.STEREO, (x) =>
  `${x.name}\n      ours   : ${x.ours}\n      PubChem: ${x.pubchem}  CID ${x.cid}`);
dump("NOT IN PubChem BY THIS NAME", R.NOTFOUND, (x) => `${x.name}  ->  ${x.ours}`);
dump("FETCH ERRORS", R.ERROR, (x) => `${x.name}: ${x.why}`);

fs.writeFileSync(
  path.join(ROOT, "docs/compound-verification-report.json"),
  JSON.stringify({ formulaBad, ...R }, null, 1)
);
console.log(`\nReport: docs/compound-verification-report.json`);

const hard = formulaBad.length + R.WRONG.length + R.ISOMER.length;
console.log(hard ? `\nFAIL: ${hard} entr${hard === 1 ? "y" : "ies"} need review.` : `\nPASS: no structural errors.`);
process.exit(hard ? 1 : 0);
