// Validates that every SMILES in compounds.json parses with OpenChemLib and
// produces a non-empty molecule. Run after editing the dictionary:
//
//   node src/lib/__tests__/validate-compounds.mjs
//
// Exits non-zero if any entry is invalid, so it can gate a commit/build.

import { readFileSync } from "fs";
import OCL from "openchemlib";

const data = JSON.parse(readFileSync(new URL("../compounds.json", import.meta.url)));

let total = 0;
const bad = [];

for (const [section, dict] of Object.entries(data)) {
  for (const [key, smiles] of Object.entries(dict)) {
    total++;
    try {
      const mol = OCL.Molecule.fromSmiles(smiles);
      if (mol.getAllAtoms() === 0) bad.push(`${section}.${key} ("${smiles}") -> 0 atoms`);
    } catch (e) {
      bad.push(`${section}.${key} ("${smiles}") -> ${e.message}`);
    }
  }
}

console.log(`Checked ${total} entries: ${total - bad.length} valid, ${bad.length} invalid.`);
if (bad.length) {
  console.log("\nInvalid entries:");
  for (const line of bad) console.log("  " + line);
  process.exit(1);
}
console.log("All compound SMILES are valid.");
