// The IUPAC namer's correctness gate (docs/SCOPE-IUPAC-STAGES.md): every name it emits for the oracle corpus must read
// back — through OPSIN, the name→structure parser the pane already uses — to the SAME structure, and no name may be given
// to two different structures. OPSIN's answers are cached in fixtures/opsin-names.json (fetched by
// scripts/iupac-oracle.mjs), so this runs offline. Names are constitutional, so both sides are compared without stereo.
//
//   A name missing from the cache fails the gate. To fetch: IUPAC_ORACLE_MISSING=<file> npx jest iupacOracle, then
//   node scripts/iupac-oracle.mjs <file>.
import * as fs from "fs";
import * as path from "path";
import { Molecule } from "openchemlib/full";
import { iupacName, nameWithDescriptors } from "../iupacName";
import { stereoText } from "../cipText";

// ---- the corpus: generated parents × substituents × positions, the compound dictionary, drug-like structures ----

/** A ring SMILES with branches at ring positions 1…size, the ring closed between atoms 1 and size. */
function ringOf(atom: string, size: number, at: Record<number, string>): string {
  let s = "";
  for (let i = 1; i <= size; i++) s += (i === 1 || i === size ? `${atom}1` : atom) + (at[i] ? `(${at[i]})` : "");
  return s;
}
const benzene = (at: Record<number, string>): string => ringOf("c", 6, at);
const ring = (size: number, at: Record<number, string>): string => ringOf("C", size, at);

const SUBS = ["F", "Cl", "Br", "I", "C", "CC", "OC", "[N+](=O)[O-]", "C(C)C", "C(C)(C)C"];
const BENZENE_GROUPS = ["O", "N", "C(=O)O", "C=O", "C#N", "C(N)=O"];
const RING_GROUPS = ["O", "N", "C(=O)O", "C=O", "C#N", "C(N)=O", "=O"];

function generatedCorpus(): string[] {
  const out = new Set<string>();
  // Benzene parents with one or two prefix substituents.
  for (const gr of BENZENE_GROUPS) {
    out.add(benzene({ 1: gr }));
    for (const sub of SUBS) for (const pos of [2, 3, 4]) out.add(benzene({ 1: gr, [pos]: sub }));
    for (const [p, q] of [[2, 4], [3, 5], [2, 6], [3, 4]]) out.add(benzene({ 1: gr, [p]: "Cl", [q]: "C" }));
    // Two of the same principal group.
    for (const pos of [2, 3, 4]) out.add(benzene({ 1: gr, [pos]: gr }));
    // A junior group beside a senior one (4-hydroxybenzoic acid, 3-aminophenol).
    for (const junior of ["O", "N"]) for (const pos of [2, 3, 4]) if (junior !== gr) out.add(benzene({ 1: gr, [pos]: junior }));
  }
  // Plain substituted benzenes.
  for (const sub of SUBS) {
    out.add(benzene({ 1: sub }));
    for (const pos of [2, 3, 4]) out.add(benzene({ 1: sub, [pos]: "Br" }));
  }
  // Cycloalkanes with a principal group, a substituent, two groups.
  for (let size = 3; size <= 7; size++) {
    for (const gr of RING_GROUPS) {
      if (gr === "=O" && size < 4) continue;
      out.add(ring(size, { 1: gr }));
      for (const pos of [2, 3]) out.add(ring(size, { 1: gr, [pos]: "C" }));
      if (size >= 5) out.add(ring(size, { 1: gr, 3: gr }));
    }
    out.add(ring(size, { 1: "C", 2: "Cl" }));
  }
  // Ring substituents on chains.
  for (const r of ["c1ccccc1", "C1CCCCC1", "C1CCC1", "C1CC1"]) {
    for (const chain of ["CO", "CCO", "CC(O)C", "CC(=O)O", "CCC(=O)O", "CN", "CC#N", "CC(C)=O", "CCC=O"]) out.add(`${r}${chain}`);
  }
  // Esters: acids × alcohols.
  const ACIDS = ["CC(=O)", "CCC(=O)", "CCCC(=O)", "O=C", "c1ccccc1C(=O)", "Clc1ccc(cc1)C(=O)", "C1CCCCC1C(=O)", "CC(=O)CC(=O)", "OCC(=O)", "ClCC(=O)"];
  const ALCOHOLS = ["C", "CC", "CCC", "C(C)C", "CCCC", "C(C)(C)C", "c1ccccc1", "C1CCCCC1", "CC(C)C"];
  for (const a of ACIDS) for (const r of ALCOHOLS) out.add(`${a}O${r}`);
  out.add("CCOC(=O)CCC(=O)OCC");
  out.add("COC(=O)c1ccc(cc1)C(=O)OC");
  // N-substituted amines and amides.
  const N_SUB = ["C", "CC", "C(C)C", "c1ccccc1", "C1CCCCC1"];
  for (const s of N_SUB) {
    out.add(`CCN${s}`);
    out.add(`c1ccccc1N${s}`);
    out.add(`C1CCCCC1N${s}`);
    out.add(`CC(=O)N${s}`);
    out.add(`c1ccccc1C(=O)N${s}`);
    out.add(`CCC(=O)N(C)${s}`);
    out.add(`CN(C)${s}`);
    out.add(`Clc1ccc(cc1)N(C)${s}`);
  }
  // Heteromonocycles (v2.169.0): each parent bare, with a substituent at every position, with each principal group at
  // every carbon, and as a substituent on a chain.
  const HETERO = ["c1ccncc1", "c1cncnc1", "c1cnccn1", "c1ccnnc1", "c1ccoc1", "c1ccsc1", "c1cc[nH]c1", "c1c[nH]cn1", "c1cn[nH]c1", "c1cocn1", "c1conc1", "c1cscn1", "C1CCNCC1", "C1CNCCN1", "C1COCCN1", "C1CCNC1", "C1CCOC1", "C1CCOCC1"];
  /** The parent with one group on ring atom `a` (C, Cl, NH2, OH, COOH, CN, CHO, CONH2, CH2CH2OH). */
  const attach = (smiles: string, a: number, kind: string): string | null => {
    const m = Molecule.fromSmiles(smiles);
    if (m.getAllHydrogens(a) === 0) return null;
    const add = (z: number, to: number, order = 1): number => {
      const x = m.addAtom(z);
      m.setBondOrder(m.addBond(to, x), order);
      return x;
    };
    if (kind === "Cl") add(17, a);
    else if (kind === "N") add(7, a);
    else if (kind === "O") add(8, a);
    else if (kind === "C") add(6, a);
    else {
      const c = add(6, a);
      if (kind === "COOH") (add(8, c, 2), add(8, c));
      else if (kind === "CN") add(7, c, 3);
      else if (kind === "CHO") add(8, c, 2);
      else if (kind === "CONH2") (add(8, c, 2), add(7, c));
      else if (kind === "CCO") add(8, add(6, c));
    }
    try {
      return m.toIsomericSmiles();
    } catch {
      return null;
    }
  };
  for (const h of HETERO) {
    out.add(h);
    const n = Molecule.fromSmiles(h).getAllAtoms();
    for (let a = 0; a < n; a++) {
      for (const kind of ["C", "Cl", "N", "O", "COOH", "CN", "CHO", "CONH2", "CCO"]) {
        const smi = attach(h, a, kind);
        if (smi) out.add(smi);
      }
    }
  }
  for (const r of ["c1ccncc1", "c1ccsc1", "c1ccoc1"]) for (const head of ["OC(=O)", "O=C", "N#C", "NC(=O)", "OC", "OC(=O)C", "N"]) out.add(`${head}${r}`);
  for (const nring of ["N1CCOCC1", "N1CCCCC1", "N1CCCC1", "n1ccnc1", "n1cccc1", "N1CCN(C)CC1"]) for (const head of ["OCC", "OC(=O)C", "OC(=O)CC", "NCC", "CC(C)"]) out.add(`${head}${nring}`);
  return [...out];
}

/** The compound dictionary's structures (bypassing the dictionary's names). */
function dictionaryCorpus(): string[] {
  const dict = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "compounds.json"), "utf8")) as { names: Record<string, string> };
  return [...new Set(Object.values(dict.names))];
}

/** Drug-like structures, most outside the namer's subset: a guard against confident names for what it cannot do. */
const DRUG_LIKE = [
  "CC(C)Cc1ccc(cc1)C(C)C(=O)O", "CC(=O)Nc1ccc(O)cc1", "CC(=O)Oc1ccccc1C(=O)O", "CN1C=NC2=C1C(=O)N(C(=O)N2C)C",
  "COc1ccc2cc(ccc2c1)C(C)C(=O)O", "CN(C)CCC=C1c2ccccc2CCc2ccccc12", "OC(=O)CCc1ccccc1", "CCOC(=O)c1ccc(N)cc1",
  "CCN(CC)C(=O)c1cccc(C)c1", "NCCc1ccc(O)c(O)c1", "CC(N)Cc1ccccc1", "OCC(O)CO", "CC(C)NCC(O)c1ccc(O)c(O)c1",
  "COC(=O)C1CCCCC1", "CC1=CC(=O)CC(C)(C)C1", "CC(=O)C1CCCCC1", "O=C1CCCC1C(=O)O", "OC(=O)C1CCC(CC1)C(=O)O",
  "CC(=O)NC1CCCCC1", "CCOC(=O)C(C)Oc1ccccc1", "COc1ccc(cc1)C=O", "Oc1ccc(cc1)C(=O)OCCC", "CC(C)(C)c1ccc(O)cc1",
  "CCCCCCCCCCCCCCCC(=O)O", "CC(=O)OCC(=O)O", "CC(O)C(=O)O", "OC(=O)CC(O)(CC(=O)O)C(=O)O", "NC(CC(=O)O)C(=O)O",
  "CN(C)C(=O)Cc1ccccc1", "CC(=O)c1ccc(Cl)cc1", "Nc1ccc(cc1)S(N)(=O)=O", "OC(=O)c1ccccc1Nc1cccc(c1)C(F)(F)F",
  "CC(C)OC(=O)CCc1ccccc1", "CCN(CC)c1ccccc1", "CN(C)c1ccc(C=O)cc1", "OC(=O)C=Cc1ccccc1", "C=CC(=O)OC",
  "CC(=C)C(=O)OC", "N#CCc1ccccc1", "OCCN(CCO)CCO", "C1CCC(CC1)NC1CCCCC1", "Fc1ccc(cc1)C(=O)NC",
];

/** Structures from the review rounds: each class that once got a confident wrong name (they must now be named right or refused). */
const REVIEW_CASES = [
  // An amino group's N-substituent beside an amide (was moved onto the amide N).
  "CNCCC(N)=O", "CNCC(N)=O", "CN(C)CCC(=O)N", "CNc1ccc(cc1)C(N)=O", "CNC(=O)CCN",
  // Prefixes without locants (were fused: "chloromethoxyacetic acid").
  "OC(=O)C(Cl)OC", "OC(=O)C(N)OC", "CCOC(Cl)C(=O)O", "COC(=O)C(Cl)OC", "OC(Cl)(Cl)OC", "OC(Cl)OCC", "NC(OC)Cl", "OC(N)OC",
  "OC(=O)C(Cl)c1ccccc1", "OC(=O)C(O)c1ccccc1", "OC(Cl)c1ccccc1", "CNCc1ccccc1", "CNCC1CCCCC1",
  // Isotopes, charges and radicals in a cut part (must refuse).
  "[13CH3]OC(C)=O", "CC(=O)O[CH2-]", "CC(=O)O[CH2]", "[13CH3]NC(C)=O", "CN[13CH3]",
  // Stereo in the acid part and in the alcohol part; tert-/sec- multipliers.
  "C[C@@H](Cl)C(=O)OC", "CC[C@@H](C)OC(C)=O",
  // Bicyclic amines and ethers cut as substituents (were named as monocycles: 1b review) — must refuse.
  "CC(=O)NC1CC2CC1N2", "CC(=O)NC1CC2CC2N1", "CC(=O)OC1CC2CCN12", "CC(=O)NC1C2CC2NC1", "CC(=O)NC1CN2CC1C2",
  "CC(=O)NC1CCC2NC12", "CC(=O)NC1C2CCN1C2", "CC(=O)NC1C2NC2C1", "CC(=O)OC1NC2CC12", "CC(=O)OC1C2COC1C2", "CC(=O)NC1COC2CC12",
  // N-aryl amines drawn either way round must get one name.
  "c1ccc(cc1)Nc1ccccn1", "c1ccnc(c1)Nc1ccccc1", "n1ccccc1Nc1ccccc1",
  // Impossible valences (an uncharged O or N with a bond too many): must refuse, never drop the rest (1b oracle).
  "C=Oc1ccncc1", "C#Nc1ccncc1", "CC(C)(C)OC(=O)CCC(=O)OC(C)(C)C", "Cc1ccc(C(C)(C)C)cc1C(C)(C)C",
];

/** Stereo-bearing structures named WITH their descriptors (as the pane shows them) and compared WITH stereo. */
const STEREO_CASES = [
  "C[C@@H](Cl)C(=O)OC", "C[C@H](Cl)C(=O)OC", "COC(=O)[C@H](Cl)[C@@H](Cl)C(=O)OC", "COC(=O)[C@H](Cl)[C@H](Cl)C(=O)OC",
  "C/C=C/C(=O)OC", "C/C=C\\C(=O)OC", "COC(=O)[C@@H](C)N", "CN[C@@H](C)c1ccccc1", "C[C@H](O)CC", "C[C@@H](O)CC",
  "OC(=O)[C@@H](Cl)c1ccccc1", "C[C@@H](N)C(=O)NC",
];

const FIXTURE = path.join(__dirname, "fixtures", "opsin-names.json");

/** Constitution only: stereo stripped, hydrogens implicit. */
function constitution(smiles: string): string | null {
  try {
    const m = Molecule.fromSmiles(smiles);
    m.stripStereoInformation();
    return m.getIDCode();
  } catch {
    return null;
  }
}

describe("IUPAC namer oracle: every emitted name reads back to its structure (OPSIN)", () => {
  const cache: Record<string, string | null> = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, "utf8")) : {};
  const corpus = [...new Set([...generatedCorpus(), ...dictionaryCorpus(), ...DRUG_LIKE, ...REVIEW_CASES])];
  const named: { smiles: string; name: string; id: string }[] = [];
  let refused = 0;
  const unreadable: string[] = [];
  for (const smiles of corpus) {
    let mol: Molecule;
    try {
      mol = Molecule.fromSmiles(smiles);
    } catch {
      continue;
    }
    const r = iupacName(mol);
    if (!r.name) {
      refused++;
      continue;
    }
    const id = constitution(smiles);
    if (id) named.push({ smiles, name: r.name, id });
    else unreadable.push(smiles);
  }

  test("the corpus is large and the namer names a real share of it", () => {
    expect(corpus.length).toBeGreaterThan(700);
    expect(named.length).toBeGreaterThan(400);
    expect(refused).toBeGreaterThan(50);
  });

  test("no named structure is dropped from the comparison", () => {
    expect(unreadable).toEqual([]);
  });

  test("the review cases that must refuse do refuse", () => {
    for (const smi of ["CC(=O)NC1CC2CC1N2", "CC(=O)NC1CC2CC2N1", "CC(=O)OC1CC2CCN12", "CC(=O)NC1C2CC2NC1", "CC(=O)NC1CN2CC1C2", "CC(=O)NC1CCC2NC12", "CC(=O)NC1C2CCN1C2", "CC(=O)NC1C2NC2C1", "CC(=O)OC1NC2CC12", "CC(=O)OC1C2COC1C2", "CC(=O)NC1COC2CC12", "C=Oc1ccncc1", "C#Nc1ccncc1", "CNCCC(N)=O", "CNCC(N)=O", "CN(C)CCC(=O)N", "CNc1ccc(cc1)C(N)=O", "[13CH3]OC(C)=O", "CC(=O)O[CH2-]", "CC(=O)O[CH2]", "[13CH3]NC(C)=O", "CN[13CH3]"]) {
      expect([smi, iupacName(Molecule.fromSmiles(smi)).name]).toEqual([smi, undefined]);
    }
  });

  test("every name is in OPSIN's cached answers", () => {
    const missing = [...new Set(named.map((x) => x.name))].filter((nm) => !(nm in cache));
    if (missing.length && process.env.IUPAC_ORACLE_MISSING) fs.writeFileSync(process.env.IUPAC_ORACLE_MISSING, JSON.stringify(missing, null, 1));
    expect(missing).toEqual([]);
  });

  test("0 wrong: OPSIN reads every name as the named structure", () => {
    const wrong: string[] = [];
    for (const x of named) {
      if (!(x.name in cache)) continue;
      const back = cache[x.name];
      if (back === null) {
        wrong.push(`${x.smiles} → “${x.name}”: OPSIN cannot parse the name`);
        continue;
      }
      if (constitution(back) !== x.id) wrong.push(`${x.smiles} → “${x.name}” → OPSIN ${back}`);
    }
    expect(wrong).toEqual([]);
  });

  test("0 collisions: no name is given to two different structures", () => {
    const byName = new Map<string, Set<string>>();
    for (const x of named) (byName.get(x.name) ?? byName.set(x.name, new Set()).get(x.name)!).add(x.id);
    const clashes = [...byName].filter(([, ids]) => ids.size > 1).map(([nm]) => nm);
    expect(clashes).toEqual([]);
  });

  test("0 wrong with stereo: a name with its descriptors reads back to the same stereoisomer", () => {
    const wrong: string[] = [];
    const missing: string[] = [];
    for (const smi of STEREO_CASES) {
      const mol = Molecule.fromSmiles(smi);
      const r = iupacName(mol);
      if (!r.name) {
        wrong.push(`${smi}: refused (${r.refusal})`);
        continue;
      }
      const st = stereoText(Molecule.fromSmiles(smi), r.locants, { reversible: r.reversible, fromText: true });
      if (!st.prefix) {
        wrong.push(`${smi}: no descriptors (${st.line})`);
        continue;
      }
      const name = nameWithDescriptors(r.name, st.prefix, r.descriptorAt);
      if (!(name in cache)) {
        missing.push(name);
        continue;
      }
      const back = cache[name];
      const id = (s: string): string => Molecule.fromSmiles(s).getIDCode();
      if (!back || id(back) !== id(smi)) wrong.push(`${smi} → “${name}” → OPSIN ${back}`);
    }
    if (missing.length && process.env.IUPAC_ORACLE_MISSING) fs.writeFileSync(process.env.IUPAC_ORACLE_MISSING, JSON.stringify(missing, null, 1));
    expect(missing).toEqual([]);
    expect(wrong).toEqual([]);
  });
});
