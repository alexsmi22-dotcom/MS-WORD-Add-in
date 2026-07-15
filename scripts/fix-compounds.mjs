// Applies the corrections found by verify-compounds-pubchem.mjs.
//
// Every edit is guarded: an entry is only rewritten if the replacement keeps the
// SAME heavy-atom skeleton (for stereo adoption) or is an explicitly reviewed
// structural correction. Nothing is adopted blindly from PubChem — the folate
// case proved PubChem's name lookup can return a non-natural stereoisomer
// (its "Folate" record is the (2R)/D-glutamate form; natural folic acid is (2S),
// and JurisLab already had it right).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OCL from "openchemlib";

const { Molecule } = OCL;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DICT = path.join(ROOT, "src/lib/compounds.json");
const CACHE = path.join(ROOT, "src/lib/__tests__/fixtures/pubchem-names.json");

const dict = JSON.parse(fs.readFileSync(DICT, "utf8"));
const cache = JSON.parse(fs.readFileSync(CACHE, "utf8"));

const skel = (s) => {
  try {
    const m = Molecule.fromSmiles(s);
    if (!m.getAllAtoms()) return null;
    m.stripStereoInformation();
    for (let b = 0; b < m.getAllBonds(); b++) m.setBondType(b, Molecule.cBondTypeSingle);
    for (let a = 0; a < m.getAllAtoms(); a++) { m.setAtomCharge(a, 0); m.setAtomRadical(a, 0); }
    m.setFragment(true);
    m.ensureHelperArrays(Molecule.cHelperNeighbours);
    return m.getIDCode();
  } catch { return null; }
};
const formulaOf = (s) => Molecule.fromSmiles(s).getMolecularFormula().formula;
const nStereo = (s) => {
  const m = Molecule.fromSmiles(s);
  m.ensureHelperArrays(Molecule.cHelperCIP);
  let n = 0;
  for (let a = 0; a < m.getAllAtoms(); a++) if ([1, 2].includes(m.getAtomParity(a))) n++;
  for (let b = 0; b < m.getAllBonds(); b++)
    if (m.getBondOrder(b) === 2 && !m.isAromaticBond(b) && [1, 2].includes(m.getBondParity(b))) n++;
  return n;
};

const changes = [];

// --- 1. Structural corrections (reviewed individually) ----------------------
// alpha-tocopherol is 5,7,8-TRImethyltocol (C29H50O2, MW 430.71). The shipped
// entry carried only TWO aromatic methyls (C28H48O2, MW 416.69) — that molecule
// is beta/gamma-tocopherol, a different vitamer. A 14 Da error silently wrong in
// Mass Spec, NMR and properties. PubChem CID 14985 (RRR-alpha-tocopherol).
const ALPHA_TOCOPHEROL = "CC1=C(C2=C(CC[C@@](O2)(C)CCC[C@H](C)CCC[C@H](C)CCCC(C)C)C(=C1O)C)C";
// Epsom salt IS the heptahydrate MgSO4.7H2O (MW 246.47). The shipped entry was
// anhydrous MgSO4 (MW 120.37) — byte-identical to the "magnesium sulfate" entry,
// which stays anhydrous because THAT name is correct for it.
const EPSOM = "O.O.O.O.O.O.O.[O-]S(=O)(=O)[O-].[Mg+2]";

const STRUCTURAL = [
  ["alpha-tocopherol", ALPHA_TOCOPHEROL, "was beta/gamma-tocopherol (missing an aromatic methyl)"],
  ["vitamin e", ALPHA_TOCOPHEROL, "was beta/gamma-tocopherol (missing an aromatic methyl)"],
  ["epsom salt", EPSOM, "was anhydrous MgSO4; Epsom salt is the heptahydrate"],
];

for (const [name, next, why] of STRUCTURAL) {
  if (!(name in dict.names)) { console.log(`SKIP ${name} — not in dictionary`); continue; }
  const prev = dict.names[name];
  dict.names[name] = next;
  changes.push({ name, prev, next, why, kind: "structure" });
}

// --- 2. Stereo adoption -----------------------------------------------------
// Only for entries whose connectivity ALREADY matched PubChem exactly and where
// we simply omitted stereo. The skeleton guard below re-proves that per entry, so
// a bad cache record cannot silently rewrite a structure.
//
// folate is deliberately EXCLUDED: PubChem's "Folate" title-match (CID 135405876)
// is the (2R) D-glutamate form. Natural folic acid is (2S) — which is what we
// already ship. Adopting PubChem there would INTRODUCE an error.
//
// arginine and histidine are here despite ALSO differing by tautomer. The first
// pass missed them: the tautomer difference survives stripStereoInformation(), so
// they landed in the "isomer" bucket and never reached the stereo sweep — leaving
// two L-amino acids drawn achiral. The skeleton guard below is what makes adopting
// them safe: it proves the tautomer is a tautomer (same heavy-atom graph) and not
// a different molecule.
const STEREO_ADOPT = [
  "arginine", "histidine",
  "tartaric acid", "oleic acid", "glucose", "galactose", "deoxyribose",
  "alanine", "valine", "leucine", "isoleucine", "proline", "serine", "threonine",
  "cysteine", "methionine", "aspartic acid", "glutamic acid", "asparagine",
  "glutamine", "lysine", "phenylalanine", "tyrosine", "tryptophan",
  "naproxen", "nicotine", "ascorbic acid", "vitamin c", "adrenaline",
  "epinephrine", "penicillin g",
];

for (const name of STEREO_ADOPT) {
  const prev = dict.names[name];
  const pc = cache[name];
  if (!prev || !pc?.smiles) { console.log(`SKIP ${name} — no entry/cache`); continue; }
  const next = pc.smiles;

  // GUARD: same heavy-atom skeleton, same formula, and strictly MORE stereo.
  const sPrev = skel(prev), sNext = skel(next);
  if (!sPrev || !sNext || sPrev !== sNext) { console.log(`REFUSE ${name} — skeleton differs`); continue; }
  if (formulaOf(prev) !== formulaOf(next)) { console.log(`REFUSE ${name} — formula differs`); continue; }
  if (nStereo(next) <= nStereo(prev)) { console.log(`REFUSE ${name} — no stereo gained`); continue; }

  dict.names[name] = next;
  changes.push({ name, prev, next, why: `stereo ${nStereo(prev)} -> ${nStereo(next)}`, kind: "stereo" });
}

fs.writeFileSync(DICT, JSON.stringify(dict, null, 1) + "\n");

console.log(`\nApplied ${changes.length} change(s):\n`);
for (const c of changes) {
  console.log(`[${c.kind}] ${c.name} — ${c.why}`);
  console.log(`   before: ${c.prev}`);
  console.log(`   after : ${c.next}`);
}
