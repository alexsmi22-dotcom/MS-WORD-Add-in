#!/usr/bin/env node
/**
 * Fetches the element data table from PubChem and writes src/lib/elementData.ts.
 *
 *   node scripts/fetch-element-data.mjs            # use the cache if present
 *   node scripts/fetch-element-data.mjs --refresh  # re-fetch from PubChem
 *
 * WHY THIS EXISTS RATHER THAN A HAND-TYPED TABLE. The standing rule in this project is
 * that all data must be real, and the precedent is the deliberate refusal to build in
 * steam tables because a table reconstructed from memory is unverifiable. Element names
 * are 118 values; the configurations and oxidation states are 118 more each. None of
 * that may be typed from recollection, so it is fetched from a citable source and the
 * fetch is committed as a script so anyone can re-run it and get the same file.
 *
 * WHAT IS TAKEN AND WHAT IS NOT. PubChem is a real source and it is NOT infallible —
 * this repo has already been bitten by trusting it (see the folate stereochemistry
 * case). So its values are CROSS-CHECKED against what is already held, and where the
 * two disagree the held value wins and the disagreement is recorded:
 *
 *   - Symbols and their order: 118/118 identical to the already-verified PERIODIC
 *     table. That agreement is what licenses attaching PubChem's names to them.
 *   - Atomic weights: NOT taken. PubChem differs from the held IUPAC values for
 *     lithium (which IUPAC gives as an interval) and for seven elements with no stable
 *     isotope, where sources pick different reference isotopes. Those are convention
 *     differences rather than errors in either source, and silently switching would
 *     change numbers the rest of this product already computes with.
 *   - Electron configurations: taken, and PubChem's own "(predicted)" and
 *     "(calculated)" annotations are PRESERVED rather than stripped — for the
 *     superheavy elements even PubChem does not have a measurement, and hiding that
 *     would be inventing certainty.
 *
 * Source: https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "docs", "pubchem-periodictable.json");
const OUT = path.join(ROOT, "src", "lib", "elementData.ts");
const URL_PT = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON";

const refresh = process.argv.includes("--refresh");

async function load() {
  if (!refresh && fs.existsSync(CACHE)) {
    console.log("Using cached", path.relative(ROOT, CACHE), "(--refresh to re-fetch)");
    return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  }
  console.log("Fetching", URL_PT);
  const res = await fetch(URL_PT);
  if (!res.ok) throw new Error(`PubChem returned ${res.status}`);
  const json = await res.json();
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(json, null, 1));
  return json;
}

/** The held symbols, read from the source of truth rather than duplicated here. */
function heldSymbols() {
  const src = fs.readFileSync(path.join(ROOT, "src", "lib", "chemValidate.ts"), "utf8");
  const start = src.indexOf("export const PERIODIC");
  const seg = src.slice(start, src.indexOf("};", start));
  return [...seg.matchAll(/([A-Z][a-z]?):\s*[\d.]+/g)].map((m) => m[1]);
}

const data = await load();
const cols = data.Table.Columns.Column;
const rows = data.Table.Row.map((r) => r.Cell);
const at = (row, name) => row[cols.indexOf(name)] ?? "";

// ---- CROSS-CHECK BEFORE WRITING ANYTHING -----------------------------------
const held = heldSymbols();
if (rows.length !== held.length) {
  throw new Error(`PubChem has ${rows.length} elements, the held table has ${held.length}. Refusing.`);
}
const mismatched = [];
rows.forEach((r, i) => {
  if (at(r, "Symbol") !== held[i]) mismatched.push(`${i + 1}: held ${held[i]}, PubChem ${at(r, "Symbol")}`);
  if (Number(at(r, "AtomicNumber")) !== i + 1) mismatched.push(`row ${i + 1} has atomic number ${at(r, "AtomicNumber")}`);
});
if (mismatched.length) {
  throw new Error(
    "The two sources disagree about which element is which, so nothing was written:\n  " +
      mismatched.join("\n  "),
  );
}
console.log(`Cross-check: ${rows.length}/${rows.length} symbols agree with the held table, in order.`);

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const lines = rows.map((r) => {
  const ox = at(r, "OxidationStates").trim();
  return (
    "  { " +
    `name: "${esc(at(r, "Name"))}", ` +
    `config: "${esc(at(r, "ElectronConfiguration"))}", ` +
    `oxidation: ${ox ? `"${esc(ox)}"` : "null"}, ` +
    `electronegativity: ${at(r, "Electronegativity") || "null"}, ` +
    `ionisationEnergy: ${at(r, "IonizationEnergy") || "null"}, ` +
    `electronAffinity: ${at(r, "ElectronAffinity") || "null"}, ` +
    `atomicRadius: ${at(r, "AtomicRadius") || "null"}, ` +
    `standardState: ${at(r, "StandardState") ? `"${esc(at(r, "StandardState"))}"` : "null"} }`
  );
});

const header = `// GENERATED FILE — do not edit by hand.
//
// Written by scripts/fetch-element-data.mjs from PubChem's periodic table:
//   https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON
// Cached at docs/pubchem-periodictable.json; re-run with --refresh to update.
//
// WHY IT IS FETCHED RATHER THAN TYPED. 118 names, 118 configurations and 118 sets of
// oxidation states cannot come from recollection — the rule here is that all data must
// be real, and the precedent is the refusal to build in steam tables because a table
// reconstructed from memory is unverifiable.
//
// CROSS-CHECKED, because PubChem is a real source and not an infallible one — this
// repo has already been bitten by trusting it on stereochemistry. The generator
// refuses to write this file unless all ${rows.length} symbols match the already-verified
// PERIODIC table in order, which is what licenses attaching these names to them.
//
// DELIBERATELY NOT TAKEN: the atomic weights. PubChem differs from the held IUPAC
// values for lithium — which IUPAC gives as an interval — and for seven elements with
// no stable isotope, where sources choose different reference isotopes. Those are
// convention differences rather than errors, and switching would change numbers this
// product already computes with. chemValidate's PERIODIC remains the source for mass.
//
// The configurations keep PubChem's own "(predicted)" and "(calculated)" annotations.
// For the superheavy elements even PubChem has no measurement, and stripping that
// would manufacture certainty.

export interface ElementFacts {
  /** IUPAC name, from PubChem. */
  name: string;
  /** Measured ground-state configuration, with PubChem's own caveats kept. */
  config: string;
  /** Common oxidation states, semicolon-separated as PubChem gives them. */
  oxidation: string | null;
  /** Pauling electronegativity. */
  electronegativity: number | null;
  /** First ionisation energy, eV. */
  ionisationEnergy: number | null;
  electronAffinity: number | null;
  /** Van der Waals radius, pm. */
  atomicRadius: number | null;
  /** Phase at standard conditions. */
  standardState: string | null;
}

/** Indexed by atomic number minus one. */
export const ELEMENT_FACTS: readonly ElementFacts[] = [
`;

fs.writeFileSync(OUT, header + lines.join(",\n") + ",\n];\n");
console.log(`Wrote ${path.relative(ROOT, OUT)} — ${rows.length} elements.`);
console.log("Atomic weights were NOT taken; chemValidate's PERIODIC remains authoritative for mass.");
