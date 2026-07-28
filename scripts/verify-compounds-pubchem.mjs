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

/**
 * A formula string parsed into element -> count.
 *
 * WHY THIS EXISTS. Formulas were compared as STRINGS, so "NH3" against OCL's
 * Hill-ordered "H3N" read as a mismatch, and heme's "C34H32N4O4Fe" against
 * "C34H32FeN4O4" was reported as a WRONG MOLECULE. Those are the same
 * composition written in a different order. 32 of the 46 things the last run
 * asked a human to review were this, and a check that needs a chemist to triage
 * 46 items to find zero problems is a check that stops being run.
 *
 * This does NOT weaken detection: a genuinely different composition still has
 * different counts. It removes a false-positive class, not a true-positive one.
 * Charge suffixes ("-2", "+") are stripped — they are not composition, and the
 * ionic-versus-covalent depiction of a salt is a drawing choice.
 */
function parseFormula(f) {
  if (!f) return null;
  const cleaned = String(f).replace(/[+-]\d*$/, "").trim();
  if (!/^[A-Za-z0-9]+$/.test(cleaned)) return null;
  const counts = {};
  const re = /([A-Z][a-z]?)(\d*)/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(cleaned)) !== null) {
    if (m[0] === "") break;
    consumed += m[0].length;
    counts[m[1]] = (counts[m[1]] ?? 0) + (m[2] ? parseInt(m[2], 10) : 1);
  }
  // Anything the element pattern could not account for means this is not a
  // formula, and guessing at it would be worse than saying so.
  return consumed === cleaned.length ? counts : null;
}

/** True when two formula strings describe the same composition, whatever their order. */
function sameComposition(a, b) {
  const pa = parseFormula(a);
  const pb = parseFormula(b);
  if (!pa || !pb) return false;
  const keys = new Set([...Object.keys(pa), ...Object.keys(pb)]);
  for (const k of keys) if ((pa[k] ?? 0) !== (pb[k] ?? 0)) return false;
  return true;
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
  if (!sameComposition(got, key)) formulaBad.push({ key, smiles, got: got ?? "UNPARSEABLE" });
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


// ---------------------------------------------------------------------------
// Reviewed exceptions
//
// Each entry records a disagreement with PubChem that a human looked at and
// decided OUR structure is right, or that the name is genuinely ambiguous.
//
// THE SAFETY PROPERTY IS THE PIN. An exception is keyed to the EXACT SMILES it
// was reviewed against. If our entry is ever edited, the pin stops matching and
// the compound flags again — so an exception cannot silently bless a structure
// nobody reviewed. That is the difference between "this name may always differ"
// (which would hide a future regression) and "this structure was checked".
//
// It deliberately does NOT pin PubChem's side: PubChem changing its mind is not
// a reason to re-litigate a decision that was made on chemistry.
// ---------------------------------------------------------------------------
const REVIEWED = [
  {
    name: "folate",
    ours: "C1=CC(=CC=C1C(=O)N[C@@H](CCC(=O)O)C(=O)O)NCC2=CN=C3C(=N2)C(=O)NC(=N3)N",
    reason:
      "PubChem's entry carries the (2R) glutamate; natural folate is (2S). Ours is correct and " +
      "PubChem is wrong here — refreshing the fixture from upstream would REPLACE A CORRECT " +
      "STRUCTURE WITH AN INCORRECT ONE. This is the case that proves --refresh must never be automatic.",
  },
  {
    name: "vitamin b6",
    ours: "CC1=NC=C(C(=C1O)CO)CO",
    reason:
      "Vitamin B6 is a family. Ours is pyridoxine, the form sold and tabulated as 'vitamin B6'; " +
      "PubChem resolves the name to pyridoxal 5'-phosphate, the active coenzyme. Both are defensible; " +
      "pyridoxine is the conventional reading.",
  },
  {
    name: "iron oxide",
    ours: "[Fe+3].[Fe+3].[O-2].[O-2].[O-2]",
    reason:
      "Ours is Fe2O3, which is what 'iron oxide' means in ordinary use (hematite, rust). PubChem " +
      "resolves the ambiguous name to FeO2.",
  },
  {
    name: "sodium phosphate",
    ours: "[Na+].[Na+].[Na+].[O-]P(=O)([O-])[O-]",
    reason:
      "Ours is trisodium phosphate, the usual reading. PubChem returns a mono-sodium phosphate anion. " +
      "The name does not specify stoichiometry.",
  },
  {
    name: "calcium oxide",
    ours: "[Ca+2].[O-2]",
    reason: "Same composition; ours depicts CaO ionically, which is what it is. PubChem draws it covalently.",
  },
  {
    name: "quicklime",
    ours: "[Ca+2].[O-2]",
    reason: "Same as calcium oxide — ionic depiction of the same composition.",
  },
  {
    name: "asprin",
    ours: "CC(=O)Oc1ccccc1C(=O)O",
    reason: "A DELIBERATE misspelling alias so a typo still resolves. PubChem has no such name, correctly.",
  },
  {
    name: "limestone",
    ours: "[Ca+2].[O-]C([O-])=O",
    reason: "A common name for calcium carbonate; PubChem indexes the chemical name, not the mineral one.",
  },
  {
    name: "vitamin d",
    ours: "C[C@H](CCCC(C)C)[C@H]1CC[C@@H]\\2[C@@]1(CCC/C2=C\\C=C/3\\C[C@H](CCC3=C)O)C",
    reason:
      "'Vitamin D' is ambiguous between D2 and D3; ours is cholecalciferol (D3), the human form. " +
      "PubChem declines the bare name.",
  },
  // Nucleobase and sugar TAUTOMERS. These differ only in which ring nitrogen
  // carries the hydrogen, which is genuinely different connectivity to a graph
  // comparison and the same substance to a chemist. Each is pinned, so editing
  // any of them re-opens the question.
  {
    name: "adenine",
    ours: "Nc1ncnc2[nH]cnc12",
    reason: "9H tautomer; PubChem draws the 7H form. Same substance in equilibrium.",
  },
  {
    name: "guanine",
    ours: "Nc1nc2[nH]cnc2c(=O)[nH]1",
    reason: "Tautomer of PubChem's depiction; same substance.",
  },
  {
    name: "cytosine",
    ours: "Nc1cc[nH]c(=O)n1",
    reason: "Amino-oxo tautomer, the dominant form; PubChem draws an equivalent tautomer.",
  },
  {
    name: "histamine",
    ours: "NCCc1c[nH]cn1",
    reason: "Imidazole tautomer (which ring N carries the H); same substance.",
  },
  {
    name: "hydrogen",
    ours: "[H][H]",
    reason: "Dihydrogen written as two bonded H atoms; PubChem writes [HH]. Same molecule, different SMILES idiom.",
  },
  {
    name: "fructose",
    ours: "OCC(=O)C(O)C(O)C(O)CO",
    reason:
      "Ours is the OPEN-CHAIN keto form, which is how fructose is drawn when teaching and how its " +
      "ketose chemistry is explained; PubChem gives the cyclic furanose. This one is a real choice, " +
      "not a notation difference — the open chain is a small fraction of fructose in solution — but " +
      "it is the conventional textbook depiction and is recorded here rather than hidden.",
  },
  {
    name: "heme",
    ours:
      "CC1=C(C2=CC3=NC(=CC4=C(C(=C([N-]4)C=C5C(=C(C(=N5)C=C1[N-]2)C)C=C)C)C=C)C(=C3CCC(=O)O)C)CCC(=O)O.[Fe+2]",
    reason:
      "Same composition (C34H32FeN4O4, confirmed by element count). The porphyrin core differs only in " +
      "which pyrrole nitrogens carry the formal charge and where the double bonds are drawn — a " +
      "tautomer/Kekulé choice in a fully conjugated macrocycle.",
  },
  {
    name: "haem",
    ours:
      "CC1=C(C2=CC3=NC(=CC4=C(C(=C([N-]4)C=C5C(=C(C(=N5)C=C1[N-]2)C)C=C)C)C=C)C(=C3CCC(=O)O)C)CCC(=O)O.[Fe+2]",
    reason: "The British spelling of heme, sharing its structure and the same Kekulé note.",
  },
  {
    name: "ribose",
    ours: "OCC1OC(O)C(O)C1O",
    reason:
      "Furanose ring without stereocentres assigned; PubChem gives the fully-specified D-ribofuranose. " +
      "Ours is deliberately unspecified, and is flagged rather than hidden.",
  },
];

const reviewedFor = (name, ours) => REVIEWED.find((r) => r.name === name && r.ours === ours) ?? null;

const R = { EXACT: [], STEREO: [], ISOMER: [], WRONG: [], NOTFOUND: [], ERROR: [], REVIEWED: [] };

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
  if (sameComposition(ourF, pc.formula)) R.ISOMER.push(rec);
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
// Move anything a human already reviewed AND whose structure still matches the
// pin out of the failing buckets. Anything unpinned stays a failure.
for (const bucket of ["WRONG", "ISOMER", "STEREO", "NOTFOUND"]) {
  const keep = [];
  for (const rec of R[bucket]) {
    const rev = reviewedFor(rec.name, rec.ours);
    if (rev) R.REVIEWED.push({ ...rec, bucket, reason: rev.reason });
    else keep.push(rec);
  }
  R[bucket] = keep;
}
dump("REVIEWED — known and accepted, pinned to the structure checked", R.REVIEWED, (x) =>
  `${x.name}  [${x.bucket}]\n      ${x.reason}`);


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
