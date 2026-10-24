// Systematic IUPAC names from structures — the SUBSET namer.
//
// ChemDraw's namer is decades of work; pretending to match it would produce
// confident wrong names, which for a patent document is worse than none.
// This module names a well-defined subset COMPLETELY and refuses everything
// else BY NAME:
//
//   IN COVERAGE
//   - acyclic hydrocarbons to C12, branched, with -ene/-yne unsaturation
//     (simple alkyl substituents incl. isopropyl/isobutyl/sec-/tert-butyl,
//     and phenyl as a substituent)
//   - ONE kind of principal characteristic group: -oic acid, -amide,
//     -nitrile, -al, -one, -ol, -amine (multiples of that kind allowed:
//     -dioic, -diol, -dione…)
//   - prefix substituents: fluoro/chloro/bromo/iodo, nitro, hydroxy, oxo,
//     amino, methoxy/ethoxy
//   - plain monocycles to CYCLOHEPTANE (OCL's ring perception stops at
//     7-rings; larger carbocycles refuse honestly), with prefix
//     substituents and an optional -ol/-one/-amine; benzene rings with
//     prefix substituents
//
//   Chain selection follows the traditional (1979) priority — maximum
//   unsaturation before maximum length — so a few 2013 PINs differ
//   (3-methylidenehexane names here as 2-ethylpent-1-ene); every emitted
//   name is unambiguous, correct general nomenclature.
//
//   v2.168.0 (stage 1a, docs/SCOPE-IUPAC-STAGES.md): benzene principal groups with their retained parents (phenol,
//   aniline, benzoic acid, benzaldehyde, benzonitrile, benzamide), groups on carbocycles (cyclohexanecarboxylic acid,
//   -carbaldehyde, -carbonitrile, -carboxamide; several of a kind), esters (ethyl acetate), N-substituted amines and
//   amides (N,N-dimethylaniline), cycloalkyl substituents, retained formic/acetic acid, formamide/acetamide. Every
//   name for the oracle corpus reads back to its structure through OPSIN (iupacOracle.test.ts).
//
//   v2.169.0 (stage 1b): heteromonocyclic parents with fixed numbering — pyridine, pyrimidine, pyrazine, pyridazine,
//   furan, thiophene, 1H-pyrrole, 1H-imidazole, 1H-pyrazole, 1,3-/1,2-oxazole, 1,3-thiazole, piperidine, piperazine,
//   morpholine, pyrrolidine, oxolane, oxane (indicated hydrogen where drawn) — and as substituents (pyridin-2-yl).
//
//   v2.170.0 (stage 2): ortho-fused aromatic bicycles with peripheral numbering — naphthalene, quinoline,
//   isoquinoline, quinazoline, quinoxaline, 1H-indole, 1H-indazole, 1H-benzimidazole, 1-benzofuran,
//   1-benzothiophene, 1,3-benzoxazole, 1,3-benzothiazole — as parents and as substituents.
//
//   v2.177.0 (stage 3a): lactams, lactones and imides of the saturated parents named as their ketones, the 2013 form —
//   pyrrolidin-2-one, piperidin-2-one, morpholin-3-one, oxolan-2-one, oxan-2-one, pyrrolidine-2,5-dione — and cyclic
//   anhydrides of those parents as their diones (oxolane-2,5-dione, P-65.7.7).
//
//   v2.178.0 (stage 3b): sulfonic acids and sulfonamides as suffixes (benzenesulfonic acid, 4-methylbenzene-1-sulfonamide,
//   N-substituted: 4-methyl-N-propylbenzene-1-sulfonamide), sulfo and sulfamoyl as junior prefixes, sulfones by the
//   preferred acyl prefix ((methanesulfonyl)benzene) — sulfonyl S on carbon only.
//
//   v2.179.0 (stage 3c): carbamates — on a saturated ring N as the ester of the ring's carboxylic acid (tert-butyl
//   piperidine-1-carboxylate), on an open-chain N whole (tert-butyl methylcarbamate, methyl phenylcarbamate).
//
//   v2.180.0 (stage 3d): a ring bonded directly to another ring, named on the senior one (4-phenylpyridine,
//   4-(pyridin-2-yl)benzoic acid, cyclohexylbenzene) by P-44.1.1 then ringRank (P-44.2.1 (a)–(g), P-44.4.1); ring
//   assemblies of identical rings and rings joined through an atom are refused.
//
//   v2.181.0 (stage 3e): partly saturated benzo-fused parents with fixed hydro locants — 2,3-dihydro-1H-indole,
//   1,2,3,4-tetrahydroquinoline, 1,2,3,4-tetrahydroisoquinoline, 2,3-dihydro-1-benzofuran, 2,3-dihydro-1-benzothiophene,
//   2,3-dihydro-1H-indene (hydro prefixes before indicated hydrogen, after the alphabetized prefixes, P-31.2.1).
//
//   REFUSED BY NAME (each with its reason)
//   - lactones and lactams of rings the namer does not number (4-, 7-membered, oxazolidine), aromatic pyridinones,
//     thiolactones, N-acyl lactams (an N-Boc lactam is the ring-N carboxylate: tert-butyl 2-oxopiperidine-1-carboxylate),
//     open-chain anhydrides, Cbz and junior carbamates, esters of two alcohols, two substituted
//     nitrogens, a substituted amino group beside a senior group, sulfur and other
//     elements, charged species (except the internal nitro pair), isotopes,
//     radicals, fused or hetero rings, ring unsaturation beyond benzene,
//     complex branched substituents, chains beyond C12
//
// The 359-compound dictionary is consulted FIRST by the caller — retained
// names (toluene, phenol, acetic acid) come from there; this module only
// speaks when systematic construction is safe. Stereodescriptors are NOT
// generated: when the structure carries specified stereo, the name is
// constitutional only and a caveat says so.
//
// Naming style: current IUPAC locant placement — pent-2-ene, propan-2-ol,
// hexane-2,4-dione — with the standard final-e elision before a vowel.

import { Molecule } from "openchemlib/full";
import { rgroupLabels } from "./builder";

export interface IupacNameResult {
  name?: string;
  refusal?: string;
  caveats: string[];
  /**
   * The parent chain's locants, as caller atom index → locant (an acyclic name only): what a stereodescriptor needs
   * to say where it is ((2R)-butan-2-ol). Absent for ring names and refusals.
   */
  locants?: Map<number, number>;
  /** Internal: the chosen chain, in the namer's working copy. */
  chain?: number[];
  /** The chain may be numbered from either end with the same name (locant L ↔ length + 1 − L). */
  reversible?: boolean;
  /**
   * Where stereodescriptors go in the name (an index into it): the start, unless a word comes first — an ester's
   * alcohol: "methyl (2R)-2-chloropropanoate".
   */
  descriptorAt?: number;
}

const STEM = ["", "methan", "ethan", "propan", "butan", "pentan", "hexan", "heptan", "octan", "nonan", "decan", "undecan", "dodecan"];
const ALKYL = ["", "methyl", "ethyl", "propyl", "butyl", "pentyl", "hexyl", "heptyl", "octyl", "nonyl", "decyl"];
const MULT = ["", "", "di", "tri", "tetra", "penta", "hexa"];
/**
 * A multiplier joined to its suffix, the multiplier's terminal "a" elided before a suffix beginning with a or o
 * (P-16.7.1(c)): benzenehexol, butane-1,2,3,4-tetramine, cyclohexane-1,2,4,5-tetrone (not hexaol, tetraamine, tetraone).
 */
const multiplied = (mult: string, suffix: string): string => (/a$/.test(mult) && /^[ao]/.test(suffix) ? mult.slice(0, -1) + suffix : mult + suffix);
const HALO: Record<number, string> = { 9: "fluoro", 17: "chloro", 35: "bromo", 53: "iodo" };
export const IUPAC_MAX_CHAIN = 12;

interface G {
  n: number;
  el: number[];
  adj: { to: number; order: number }[][];
  aromatic: boolean[];
  inRing: boolean[];
  /** Hydrogens on each atom (implicit and explicit): where an indicated hydrogen is (1H-imidazole). */
  h: number[];
}

interface Group {
  kind: "acid" | "sulfonic" | "amide" | "sulfonamide" | "nitrile" | "al" | "one" | "ol" | "amine";
  /** The chain carbon that anchors the group. */
  carbon: number;
  /** Group atoms outside the chain (O, N…) — never re-read as substituents. */
  satellites: number[];
  /** Terminal groups must sit at a chain end and take locant 1/end. */
  terminal: boolean;
}

// Seniority of classes, P-41 Table 4.1 / P-43 Table 4.4 (IUPAC 2013): carboxylic before sulfonic acids, carboxamides
// before sulfonamides (stage 3b).
const SENIORITY: Group["kind"][] = ["acid", "sulfonic", "amide", "sulfonamide", "nitrile", "al", "one", "ol", "amine"];
const SUFFIX: Record<Group["kind"], string> = {
  acid: "oic acid", sulfonic: "sulfonic acid", amide: "amide", sulfonamide: "sulfonamide", nitrile: "nitrile", al: "al", one: "one", ol: "ol", amine: "amine",
};
/** The group's class name in a refusal ("an aldehyde group", not "a al group"). */
const GROUP_WORD: Record<Group["kind"], string> = {
  acid: "a carboxylic acid", sulfonic: "a sulfonic acid", amide: "an amide", sulfonamide: "a sulfonamide", nitrile: "a nitrile", al: "an aldehyde", one: "a ketone", ol: "an alcohol", amine: "an amine",
};
// Junior groups as prefixes: sulfo and sulfamoyl (P-65.3.2.3, P-66.1.1.4.2 — sulfamoyl is the preselected prefix).
const PREFIX_FORM: Partial<Record<Group["kind"], string>> = {
  sulfonic: "sulfo", sulfonamide: "sulfamoyl", one: "oxo", ol: "hydroxy", amine: "amino",
};

/**
 * A sulfonyl sulfur outside a ring: S with exactly two terminal =O and two single bonds (to C, O or N). The only
 * sulfur the namer reads outside thiophene and thiazole (stage 3b): sulfonic acids, sulfonamides and sulfones.
 */
function isSulfonyl(g: G, s: number): boolean {
  if (g.el[s] !== 16 || g.inRing[s]) return false;
  const oxo = g.adj[s].filter((e) => g.el[e.to] === 8 && e.order === 2 && g.adj[e.to].length === 1);
  const single = g.adj[s].filter((e) => e.order === 1 && [6, 7, 8].includes(g.el[e.to]));
  return oxo.length === 2 && single.length === 2 && g.adj[s].length === 4;
}

/** A name with its stereodescriptors where they belong: in front, or before an ester's acid part (`descriptorAt`). */
export function nameWithDescriptors(name: string, prefix: string, at?: number): string {
  const i = at && at > 0 && at < name.length ? at : 0;
  const rest = name.slice(i);
  // A part with no numbered positions takes its one descriptor without a locant: (S)-chloro(phenyl)acetic acid.
  const one = /^\((\d+)([RSEZrs])\)-$/.exec(prefix);
  const shown = one && !/\d/.test(rest) ? `(${one[2]})-` : prefix;
  return `${name.slice(0, i)}${shown}${rest}`;
}

function refuse(why: string): IupacNameResult {
  return { refusal: why, caveats: [] };
}

export function iupacName(mol0: Molecule): IupacNameResult {
  if (mol0.getAllAtoms() === 0) return refuse("Nothing to name — the structure is empty.");
  if (mol0.isFragment() || rgroupLabels(mol0).length > 0) {
    return refuse("A generic structure (R-groups/query features) has no single name.");
  }
  const mol = mol0.getCompactCopy();
  // The caller's atom numbers ride through the removal of explicit hydrogens (it renumbers): for the chain's locants.
  for (let i = 0; i < mol.getAllAtoms(); i++) mol.setAtomMapNo(i, i + 1, false);
  try {
    mol.removeExplicitHydrogens(false);
  } catch {
    // keep going with whatever we have
  }
  mol.ensureHelperArrays(Molecule.cHelperRings);

  // Multiple fragments have no single substitutive name.
  const fragNo = new Array(mol.getAllAtoms());
  if (mol.getFragmentNumbers(fragNo, false, false) > 1) {
    return refuse("Two or more separate molecules — name each on its own.");
  }

  // Esters and N-substituents (v2.168.0) are named from a SIMPLER molecule: the ester's alcohol part and the
  // nitrogen's extra carbon branches are cut off and named as words or N-prefixes, and the rest — an acid, a primary
  // amine or an unsubstituted amide — is named by the core. Every cut atom is named, or the whole is refused.
  // Every atom is screened BEFORE anything is cut off: an isotope, charge or radical in an ester's alcohol part or an
  // N-substituent must refuse like one anywhere else (review: [13CH3]OC(C)=O came out "methyl acetate").
  const screen = screenAtoms(mol);
  if (screen) return refuse(screen);
  // Rings are counted on the WHOLE molecule before anything is cut off: a bicyclic alcohol or amine cut as an ester's
  // alcohol part or an N-substituent was named as a monocycle (review: CC(=O)NC1CC2CC1N2 came out
  // "N-(piperidin-2-yl)acetamide").
  // Separate rings may be cut off as a word or an N-prefix (phenyl benzoate, N-phenylaniline); rings that SHARE atoms
  // (fused, bridged, spiro) never may.
  {
    const g0 = graphOf(mol);
    for (const sys of ringSystems(mol)) {
      if (sys.rings > 1 && !matchHetero(g0, sys.atoms)) return refuse(FUSED_REFUSAL);
    }
  }
  // A carbamate on an open-chain nitrogen (stage 3c) is named whole: "tert-butyl methylcarbamate".
  const carb = nameCarbamate(mol);
  if (carb) return carb;
  const prep = prepare(mol);
  if ("refusal" in prep) return refuse(prep.refusal);
  const core = nameCore(prep.mol, prep.nPrefixes);
  if (core.refusal) return core;
  const name = core.name!;
  if (prep.nPrefixes.length && core.principalKind !== "amine" && core.principalKind !== "amide" && core.principalKind !== "sulfonamide") {
    return refuse("A substituted amino group alongside a more senior group is outside the namer's subset.");
  }
  // The cut nitrogen must BE the principal group's nitrogen: N-methyl in "N-methylpropanamide" means the amide N. A
  // methyl cut from an amino group elsewhere would be named onto the wrong atom (review: CNCCC(N)=O came out
  // "3-amino-N-methylpropanamide", which is NCCC(=O)NC).
  if (prep.cutN !== null && !cutNIsPrincipal(prep.mol, prep.cutN, core)) {
    return refuse("A substituted amino group alongside a more senior group is outside the namer's subset.");
  }
  // Stereo anywhere in the molecule (also in a part cut off for naming) makes the name constitutional: said.
  if (hasStereo(mol) && !core.caveats.some((c) => /stereodescriptors/i.test(c))) core.caveats.unshift(STEREO_CAVEAT);
  if (prep.esters) {
    const { alcohol, count } = prep.esters;
    if (core.principalKind !== "acid" || core.principalCount !== count || !/ic acid$/.test(name)) {
      return refuse("An ester alongside a free acid (or another senior group) is outside the namer's subset.");
    }
    const anion = name.replace(/ic acid$/, "ate");
    const complex = /\d/.test(alcohol);
    const multTable = complex ? MULT_COMPLEX : MULT;
    if (count >= multTable.length) return refuse(`More than ${multTable.length - 1} ester groups is outside the namer's subset.`);
    const word = count > 1 ? `${multTable[count]}${complex ? `(${alcohol})` : /^(tert|sec)-/.test(alcohol) ? `-${alcohol}` : alcohol}` : alcohol;
    // Stereodescriptors belong to the acid part: methyl (2R)-2-chloropropanoate (P-93.1.1).
    return { ...core, name: `${word} ${anion}`, descriptorAt: word.length + 1 };
  }
  return core;
}

/**
 * A carbamate (or carbamic acid) on an OPEN-CHAIN nitrogen, named whole (stage 3c): the alcohol part as a word, the
 * N-substituents as prefixes with no N locant, then "carbamate" — "tert-butyl methylcarbamate", "methyl
 * phenylcarbamate", "ethyl carbamate", "dimethylcarbamic acid" (P-65.2.1.1, whose example "2-hydroxypropyl
 * (2-aminoethyl)carbamate (PIN)" carries no N locant; P-65.6.3.3.1 "tert-butyl octanoate (PIN)"). Every other atom must
 * be in the alcohol part or an N-substituent, each a plain substituent classifySub names; anything more (a Boc on a
 * chain that carries its own group, a benzyl ester — Cbz — whose PIN form is not checked) is refused by name. Returns
 * null when the molecule has no such carbamate.
 */
function nameCarbamate(mol: Molecule): IupacNameResult | null {
  const g = graphOf(mol);
  const { n: nitroN } = nitroAtoms(g);
  const carbamates: { c: number; dO: number; o: number; nn: number }[] = [];
  for (let c = 0; c < g.n; c++) {
    if (g.el[c] !== 6 || g.inRing[c]) continue;
    const dO = g.adj[c].filter((e) => g.el[e.to] === 8 && e.order === 2 && g.adj[e.to].length === 1);
    const sO = g.adj[c].filter((e) => g.el[e.to] === 8 && e.order === 1);
    const sN = g.adj[c].filter((e) => g.el[e.to] === 7 && e.order === 1 && !g.inRing[e.to] && !nitroN.has(e.to));
    if (dO.length === 1 && sO.length === 1 && sN.length === 1 && g.adj[c].length === 3) carbamates.push({ c, dO: dO[0].to, o: sO[0].to, nn: sN[0].to });
  }
  if (!carbamates.length) return null;
  if (carbamates.length > 1) return refuse("More than one carbamate group is outside the namer's subset.");
  const { c, dO, o, nn } = carbamates[0];
  const used = new Set<number>([c, dO, o, nn]);
  let alcohol = "";
  const oOthers = g.adj[o].filter((e) => e.to !== c);
  if (oOthers.length === 1) {
    const r = oOthers[0].to;
    if (g.el[r] !== 6 || oOthers[0].order !== 1) return refuse("This carbamate's O–substituent is outside the namer's subset.");
    const cls = classifySub(g, r, o, nitroN);
    if (typeof cls === "string") return refuse(`The carbamate's alcohol part: ${cls.replace(/^This substituent/, "it")}`);
    alcohol = cls.name;
    for (const x of subtree(g, r, o)) used.add(x);
  } else if (oOthers.length > 1) return refuse("This carbamate is outside the namer's subset.");
  if (g.adj[nn].some((e) => e.order !== 1)) return refuse("This carbamate nitrogen is outside the namer's subset.");
  const subs: { loc: null; name: string; key: string }[] = [];
  for (const e of g.adj[nn]) {
    if (e.to === c) continue;
    if (g.el[e.to] !== 6) return refuse("A carbamate nitrogen bonded to N, O or S is outside the namer's subset.");
    const cls = classifySub(g, e.to, nn, nitroN);
    if (typeof cls === "string") return refuse(`A substituent on the carbamate nitrogen: ${cls.replace(/^This substituent/, "it")}`);
    subs.push({ loc: null, ...cls });
    for (const x of subtree(g, e.to, nn)) used.add(x);
  }
  // Accounting: the carbamate, its alcohol part and its N-substituents are the whole molecule.
  if (used.size !== g.n) return refuse("A carbamate beside other groups (a protected amine on a substituted chain, a junior carbamate) is outside the namer's subset.");
  // Two DIFFERENT N-substituents: the 2013 form (ethyl(methyl)carbamate or N-ethyl-N-methylcarbamate) is not
  // confirmed in the recommendations — refused by name, not guessed (stage 3c review).
  if (new Set(subs.map((x) => x.name)).size > 1) return refuse("A carbamate nitrogen with two different substituents is outside the namer's subset (its N-locant form is not confirmed).");
  const nPart = prefixString(subs);
  if (typeof nPart !== "string") return refuse(nPart.refusal);
  const caveats: string[] = [];
  if (hasStereo(mol)) caveats.push(STEREO_CAVEAT);
  caveats.push("Systematic name from the offline subset namer — verify against your house style before filing.");
  if (!alcohol) return { name: `${nPart}carbamic acid`, caveats };
  return { name: `${alcohol} ${nPart}carbamate`, caveats, descriptorAt: alcohol.length + 1 };
}

const STEREO_CAVEAT =
  "The structure carries stereochemistry; this name is CONSTITUTIONAL — its CIP stereodescriptors ((R/S), (E/Z)) are added from lib/cip.ts where every stereo element is given (stereoText).";

function hasStereo(mol: Molecule): boolean {
  for (let i = 0; i < mol.getAllAtoms(); i++) if (mol.getAtomParity(i) !== 0) return true;
  for (let b = 0; b < mol.getAllBonds(); b++) if (mol.getBondParity(b) !== 0) return true;
  return false;
}

/** Element, isotope, radical and charge screens over the whole molecule (nitro's internal +/- pair exempted). */
function screenAtoms(mol: Molecule): string | null {
  const n = mol.getAllAtoms();
  for (let i = 0; i < n; i++) {
    const z = mol.getAtomicNo(i);
    // An explicit hydrogen isotope (deuterium [2H], tritium [3H]) is an isotopic label, not an element outside the
    // subset: said so (the isotopic descriptor, e.g. (1-²H₁)ethan-1-ol, P-82, is not written here).
    if (z === 1 && mol.getAtomMass(i) >= 2) {
      const what = mol.getAtomMass(i) === 2 ? "deuterium, ²H" : mol.getAtomMass(i) === 3 ? "tritium, ³H" : "a hydrogen isotope";
      return `Isotope labels (${what}) are outside the namer's subset — the isotopic descriptor (P-82, e.g. (1-²H₁)ethan-1-ol) is not written here; name the unlabelled compound and add the label by hand.`;
    }
    if (![6, 7, 8, 9, 16, 17, 35, 53].includes(z)) return `${mol.getAtomLabel(i)} is outside the namer's subset (C, H, N, O, halogens, and S in thiophene or thiazole rings or in a sulfonyl group).`;
    if (mol.getAtomMass(i) !== 0) return "Isotope labels are outside the namer's subset.";
    if (mol.getAtomRadical(i) !== 0) return "Radicals are outside the namer's subset.";
  }
  // An impossible valence (an uncharged O with three bonds, C=O–ring) is not a structure to name: the group reader
  // assumes a carbonyl O ends there, and the rest of the molecule would drop out of the name (review oracle).
  mol.ensureHelperArrays(Molecule.cHelperRings);
  for (let i = 0; i < n; i++) {
    if (mol.getAtomCharge(i) === 0 && mol.getOccupiedValence(i) > mol.getMaxValence(i)) return `The ${mol.getAtomLabel(i)} atom has more bonds than it can (an impossible valence) — check the structure.`;
  }
  const g = graphOf(mol);
  const { n: nitroN, sat: nitroSat } = nitroAtoms(g);
  for (let i = 0; i < n; i++) {
    if (mol.getAtomCharge(i) !== 0 && !nitroN.has(i) && !nitroSat.has(i)) return "Charged species are outside the namer's subset (ions carry their own nomenclature).";
  }
  return null;
}

/** The cut nitrogen (by its map number) is the satellite of the core's one principal amine or amide group. */
function cutNIsPrincipal(mol: Molecule, mapNo: number, core: CoreResult): boolean {
  if ((core.principalKind !== "amine" && core.principalKind !== "amide" && core.principalKind !== "sulfonamide") || core.principalCount !== 1) return false;
  let idx = -1;
  for (let i = 0; i < mol.getAllAtoms(); i++) if (mol.getAtomMapNo(i) === mapNo) idx = i;
  if (idx < 0) return false;
  const g = graphOf(mol);
  const { n: nitroN, sat: nitroSat } = nitroAtoms(g);
  const det = detectGroups(g, nitroN, nitroSat);
  return det.groups.some((gr) => gr.kind === core.principalKind && gr.satellites.includes(idx));
}

interface Prepared {
  mol: Molecule;
  /** The map number of the nitrogen whose branches were cut (N-prefixes), or null. */
  cutN: number | null;
  /** N-substituent prefixes (N-methyl, N-phenyl) for the core's principal amine or amide. */
  nPrefixes: { name: string; key: string }[];
  /** The ester's alcohol part (ethyl, phenyl) and how many ester groups carry it. */
  esters?: { alcohol: string; count: number };
}

/** Atom sets cut off the molecule, each named; the rest goes to the core. */
function prepare(mol: Molecule): Prepared | { refusal: string } {
  const g0 = graphOf(mol);
  const n = g0.n;
  const systems0 = ringSystems(mol);
  const remove = new Set<number>();
  const nPrefixes: { name: string; key: string }[] = [];
  const nitroN0 = nitroAtoms(g0).n;
  const isCarbonyl = (c: number): boolean => g0.el[c] === 6 && g0.adj[c].some((e) => g0.el[e.to] === 8 && e.order === 2);

  // Esters: C(=O)–O–R, with R a plain alkyl, phenyl or cycloalkyl (not a carbonyl: that is an anhydride).
  const alcohols: string[] = [];
  for (let o = 0; o < n; o++) {
    if (g0.el[o] !== 8 || g0.adj[o].length !== 2 || g0.adj[o].some((e) => e.order !== 1)) continue;
    const [a, b] = g0.adj[o].map((e) => e.to);
    const acyl = isCarbonyl(a) ? a : isCarbonyl(b) ? b : null;
    if (acyl === null) continue;
    const r = acyl === a ? b : a;
    // An anhydride or a carbonate: the core refuses an open-chain one by name, and names a cyclic anhydride of a
    // parent it numbers as the ring's dione (oxolane-2,5-dione: the P-65.7.7 pseudoketone form, stage 3a).
    if (g0.el[r] !== 6 || isCarbonyl(r)) continue;
    // A ring O (OCL marks ring atoms of every size): a lactone, named by the core as the ring's ketone (oxolan-2-one,
    // stage 3a), or refused there by name. So the alcohol part below never reaches back to its own acyl carbon.
    if (g0.inRing[o]) continue;
    // A carbonyl carbon with a second single-bonded O or N is a carbonate or carbamate, not an ester — except a
    // carbamate on a saturated ring N, which is the ester of the ring's carboxylic acid (tert-butyl
    // piperidine-1-carboxylate, stage 3c). A carbamate on an open-chain N is named by nameCarbamate.
    const acylHetero = g0.adj[acyl].filter((e) => e.order === 1 && (g0.el[e.to] === 8 || g0.el[e.to] === 7));
    const ringNCarbamate =
      acylHetero.length === 2 && acylHetero.some((e) => g0.el[e.to] === 7 && g0.inRing[e.to] && !g0.aromatic[e.to]) && !g0.adj[acyl].some((e) => g0.el[e.to] === 6);
    if (acylHetero.length > 1 && !ringNCarbamate) continue;
    const cls = classifySub(g0, r, o, nitroN0);
    if (typeof cls === "string") return { refusal: `The ester's alcohol part: ${cls.replace(/^This substituent/, "it")}` };
    alcohols.push(cls.name);
    for (const x of subtree(g0, r, o)) remove.add(x);
  }
  if (alcohols.length && new Set(alcohols).size > 1) return { refusal: "Esters of two different alcohols are outside the namer's subset." };

  // N-substituents: an amide N, or an amine N with two or three carbon branches. The parent branch stays; the others
  // become N-prefixes. Only one substituted nitrogen (N and N′ would need primes).
  let substitutedN = 0;
  let cutN: number | null = null;
  for (let nn = 0; nn < n; nn++) {
    // A ring nitrogen (piperidine) is the core's to refuse: its ring bonds are not substituents.
    if (g0.el[nn] !== 7 || nitroN0.has(nn) || remove.has(nn) || g0.inRing[nn]) continue;
    if (g0.adj[nn].some((e) => e.order !== 1)) continue; // C=N, C≡N: the core refuses or names them
    const cs = g0.adj[nn].map((e) => e.to);
    // A sulfonamide N's acyl is its sulfonyl S (stage 3b: 4-methyl-N-propylbenzene-1-sulfonamide).
    const sulfonylS = (c: number): boolean => isSulfonyl(g0, c);
    if (!cs.every((c) => g0.el[c] === 6 || sulfonylS(c))) continue; // N–O, N–N, N–halogen: the core refuses them
    const acyls = cs.filter((c) => isCarbonyl(c) || sulfonylS(c));
    let keep: number;
    if (acyls.length === 1) {
      if (cs.length === 1) continue;
      keep = acyls[0];
    } else if (acyls.length === 0 && cs.length >= 2) {
      // The parent branch: an aromatic ring, then a ring, then the larger branch (2013: rings before chains).
      // Every other branch must be a plain substituent.
      // The parent branch by seniority (P-44.1.2.2, P-44.2.1.2 — the parts this namer applies): rings before chains;
      // then a nitrogenous ring; then, only when neither has nitrogen, O before S; then more rings (a fused pair);
      // then more ring atoms; then aromatic; for chains, the longer chain from the nitrogen. So the parent never depends
      // on drawing order.
      // The ring part is ringRank, the one ring-seniority function (P-44.2.1 (a)–(g), P-44.4.1): an N between
      // pyridin-2-yl and morpholin-2-yl makes MORPHOLINE the parent by (f) — the old rank, missing (f) and (g), chose
      // pyridine (stage 3d).
      const rank = (c: number): number[] => {
        const t = subtree(g0, c, nn);
        // Only the ring system the branch is attached through: a ring that carries its own ring (4-(morpholin-4-yl)phenyl)
        // is ranked as the phenyl it is, not as phenyl + morpholine (stage 3d review).
        const ringAtoms = g0.inRing[c] ? (systems0.find((sy) => sy.atoms.includes(c))?.atoms ?? []) : [];
        // The longest carbon path from the attachment (a chain's length, not its atom count: butyl beats neopentyl).
        const tset = new Set(t);
        const depth = (a: number, from: number): number => 1 + Math.max(0, ...g0.adj[a].filter((e) => e.to !== from && tset.has(e.to) && g0.el[e.to] === 6 && !g0.inRing[e.to]).map((e) => depth(e.to, a)));
        const chainLen = g0.inRing[c] ? 0 : depth(c, nn);
        // Last, the larger branch (benzyl over methyl: N-methyl-1-phenylmethanamine).
        return [g0.inRing[c] ? 1 : 0, ...ringRank(g0, ringAtoms), chainLen, t.length];
      };
      const plain = (c: number): boolean => typeof classifySub(g0, c, nn, nitroN0) !== "string";
      const ranked = [...cs].sort((p, q) => lexCompare(rank(q), rank(p)));
      // Two DIFFERENT branches of equal rank (pyridin-2-yl and pyrimidin-2-yl): the choice needs heteroatom-count and
      // locant rules this stage does not carry — refused by name, never decided by drawing order. Identical ones (two
      // phenyls: N-phenylaniline) are one name either way.
      // Two ring branches whose skeletons differ but tie except for hydrogenation: not decided by saturation (hydroOnlyTie).
      const sysAtoms = (c: number): number[] => (g0.inRing[c] ? systems0.find((sy) => sy.atoms.includes(c))?.atoms ?? [] : []);
      if (ranked.length > 1 && sysAtoms(ranked[0]).length && sysAtoms(ranked[1]).length && hydroOnlyTie(g0, sysAtoms(ranked[0]), sysAtoms(ranked[1]))) {
        return { refusal: "Two different groups of equal seniority on one nitrogen (which is the parent?) are outside the namer's subset." };
      }
      if (ranked.length > 1 && lexCompare(rank(ranked[0]), rank(ranked[1])) === 0) {
        const n0 = classifySub(g0, ranked[0], nn, nitroN0), n1 = classifySub(g0, ranked[1], nn, nitroN0);
        if (typeof n0 === "string" || typeof n1 === "string" || n0.name !== n1.name) {
          return { refusal: "Two different groups of equal seniority on one nitrogen (which is the parent?) are outside the namer's subset." };
        }
      }
      // The senior branch IS the parent; when the others cannot all be named as plain N-prefixes (a substituted
      // phenyl, an undecyl), the name is refused — never handed to a junior branch (review: "4-methyl-N-(naphthalen-
      // 2-yl)aniline" for what is N-(4-methylphenyl)naphthalen-2-amine).
      keep = ranked[0];
      if (!cs.every((d) => d === keep || plain(d))) {
        return { refusal: "A group on this nitrogen that is not a plain N-prefix beside the parent branch (a substituted ring, a group carrying its own OH, NH₂ or COOH) is outside the namer's subset." };
      }
    } else continue; // imides and the like: the core refuses them by name
    const others = cs.filter((c) => c !== keep);
    if (!others.length) continue;
    substitutedN++;
    cutN = mol.getAtomMapNo(nn);
    if (substitutedN > 1) return { refusal: "Two substituted nitrogens (N and N′ locants) are outside the namer's subset." };
    for (const c of others) {
      const cls = classifySub(g0, c, nn, nitroN0);
      if (typeof cls === "string") return { refusal: `A substituent on nitrogen: ${cls}` };
      if (subtree(g0, c, nn).includes(keep)) return { refusal: "A nitrogen in a ring is outside the namer's subset." };
      nPrefixes.push(cls);
      for (const x of subtree(g0, c, nn)) remove.add(x);
    }
  }

  if (!remove.size) return { mol, nPrefixes, cutN: null };
  const copy = mol.getCompactCopy();
  const del = [...remove].sort((x, y) => y - x);
  for (const a of del) copy.markAtomForDeletion(a);
  copy.deleteMarkedAtomsAndBonds();
  copy.ensureHelperArrays(Molecule.cHelperRings);
  // Accounting: the core sees exactly the atoms not cut off (each cut atom was named above).
  if (copy.getAllAtoms() !== n - remove.size) return { refusal: "The structure could not be divided for naming." };
  return { mol: copy, nPrefixes, cutN, ...(alcohols.length ? { esters: { alcohol: alcohols[0], count: alcohols.length } } : {}) };
}

const lexCompare = (a: number[], b: number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? -Infinity, y = b[i] ?? -Infinity;
    if (x !== y) return x - y;
  }
  return 0;
};

const FUSED_REFUSAL =
  "This ring system is outside the namer's subset — fused parents named: naphthalene, quinoline, isoquinoline, quinazoline, quinoxaline, 1H-indole, 1H-indazole, 1H-benzimidazole, 1-benzofuran, 1-benzothiophene, 1,3-benzoxazole, 1,3-benzothiazole (fully aromatic, as drawn), and 2,3-dihydro-1H-indole, 1,2,3,4-tetrahydroquinoline, 1,2,3,4-tetrahydroisoquinoline, 2,3-dihydro-1-benzofuran, 2,3-dihydro-1-benzothiophene and 2,3-dihydro-1H-indene; bridged, spiro and larger systems are refused.";

/** Rings grouped into systems: rings that share an atom are one system. */
function ringSystems(mol: Molecule): Array<{ atoms: number[]; rings: number }> {
  const rs = mol.getRingSet();
  const sets: Array<{ atoms: Set<number>; rings: number }> = [];
  for (let r = 0; r < rs.getSize(); r++) {
    const atoms = new Set<number>(Array.from(rs.getRingAtoms(r)));
    const hit = sets.filter((x) => [...atoms].some((a) => x.atoms.has(a)));
    const merged = { atoms, rings: 1 };
    for (const h of hit) {
      for (const a of h.atoms) merged.atoms.add(a);
      merged.rings += h.rings;
      sets.splice(sets.indexOf(h), 1);
    }
    sets.push(merged);
  }
  return sets.map((x) => ({ atoms: [...x.atoms], rings: x.rings }));
}

/** The namer's graph of a molecule (hydrogens implicit). */
function graphOf(mol: Molecule): G {
  mol.ensureHelperArrays(Molecule.cHelperRings);
  const n = mol.getAllAtoms();
  const g: G = {
    n,
    el: Array.from({ length: n }, (_, i) => mol.getAtomicNo(i)),
    adj: Array.from({ length: n }, () => []),
    aromatic: Array.from({ length: n }, (_, i) => mol.isAromaticAtom(i)),
    inRing: Array.from({ length: n }, (_, i) => mol.isRingAtom(i)),
    h: Array.from({ length: n }, (_, i) => mol.getAllHydrogens(i)),
  };
  for (let b = 0; b < mol.getAllBonds(); b++) {
    const a1 = mol.getBondAtom(0, b), a2 = mol.getBondAtom(1, b);
    const order = mol.getBondOrder(b);
    g.adj[a1].push({ to: a2, order });
    g.adj[a2].push({ to: a1, order });
  }
  return g;
}

/** Nitro groups as units (commonly stored as an internal [N+][O-] pair whose charges cancel). */
function nitroAtoms(g: G): { n: Set<number>; sat: Set<number> } {
  const nitroN = new Set<number>();
  const nitroSat = new Set<number>();
  for (let i = 0; i < g.n; i++) {
    if (g.el[i] !== 7) continue;
    const os = g.adj[i].filter((e) => g.el[e.to] === 8 && g.adj[e.to].length === 1);
    const cs = g.adj[i].filter((e) => g.el[e.to] === 6);
    if (os.length === 2 && cs.length === 1 && os.reduce((s, e) => s + e.order, 0) >= 3) {
      nitroN.add(i);
      os.forEach((e) => nitroSat.add(e.to));
    }
  }
  return { n: nitroN, sat: nitroSat };
}

interface CoreResult extends IupacNameResult {
  principalKind?: Group["kind"];
  principalCount?: number;
}

function nameCore(mol: Molecule, nPrefixes: { name: string; key: string }[]): CoreResult {
  const n = mol.getAllAtoms();
  // Element and per-atom screens (nitro's internal +/- pair is exempted later).
  for (let i = 0; i < n; i++) {
    const z = mol.getAtomicNo(i);
    if (![6, 7, 8, 9, 16, 17, 35, 53].includes(z)) {
      return refuse(`${mol.getAtomLabel(i)} is outside the namer's subset (C, H, N, O, halogens, and S in thiophene or thiazole rings or in a sulfonyl group).`);
    }
    if (mol.getAtomMass(i) !== 0) return refuse("Isotope labels are outside the namer's subset.");
    if (mol.getAtomRadical(i) !== 0) return refuse("Radicals are outside the namer's subset.");
  }

  const g = graphOf(mol);
  // Sulfur as a ring atom of thiophene or thiazole, or (stage 3b) a sulfonyl S on carbon: a sulfonic acid, a
  // sulfonamide or a sulfone, each read by detectGroups or classifySub. A thiol, a thioether, a sulfoxide, a sulfonyl
  // on a ring N or on O (a sulfonate ester, a sulfate) is outside the subset; a sulfur ring that is neither ring is
  // refused where the ring is matched.
  for (let i = 0; i < n; i++) {
    if (g.el[i] !== 16) continue;
    if (isSulfonyl(g, i)) {
      const others = g.adj[i].filter((e) => e.order === 1);
      const onC = others.filter((e) => g.el[e.to] === 6);
      const o = others.find((e) => g.el[e.to] === 8);
      const nn = others.find((e) => g.el[e.to] === 7);
      const ok =
        (onC.length === 2) ||
        (onC.length === 1 && o !== undefined && g.adj[o.to].length === 1) ||
        (onC.length === 1 && nn !== undefined && !g.inRing[nn.to] && g.adj[nn.to].length === 1);
      if (!ok) return refuse("This sulfonyl group (a sulfonate ester, a sulfonyl on a ring nitrogen or an N-substituted one the namer cannot place, a sulfate, a sulfonyl halide) is outside the namer's subset.");
      continue;
    }
    if (!g.inRing[i] || g.adj[i].some((e) => !g.inRing[e.to] || e.order !== 1 && !g.aromatic[i])) {
      return refuse("Sulfur outside a thiophene or thiazole ring, other than a sulfonyl group (thiols, thioethers, sulfoxides), is outside the namer's subset.");
    }
  }
  const { n: nitroN, sat: nitroSat } = nitroAtoms(g);
  for (let i = 0; i < n; i++) {
    const c = mol.getAtomCharge(i);
    if (c !== 0 && !nitroN.has(i) && !nitroSat.has(i)) {
      return refuse("Charged species are outside the namer's subset (ions carry their own nomenclature).");
    }
  }

  // Ring routing.
  const rings = mol.getRingSet();
  const ringCount = rings.getSize();
  const systems = ringSystems(mol);
  if (systems.some((s) => s.rings > 1 && !matchHetero(g, s.atoms))) return refuse(FUSED_REFUSAL);
  // Two or more ring systems (stage 3d): one is the parent, the others ring substituents bonded to it directly
  // (4-phenylpyridine) — chosen by principal groups, then ring seniority (P-44.1, P-44.2.1, P-44.4.1).
  let parentSys = systems[0];
  if (systems.length > 1) {
    const pick = pickParentRing(g, systems, nitroN, nitroSat);
    if (typeof pick === "string") return refuse(pick);
    parentSys = pick;
  }
  // OCL's ring set only perceives rings up to 7 atoms — larger rings leave
  // ring-flagged atoms with ringCount 0, and pretending they are chains
  // would misname them (adversarial pass: cyclooctane read "no carbon
  // chain"). The honest boundary is cycloheptane.
  if (ringCount === 0 && g.inRing.some(Boolean)) {
    return refuse("Rings beyond cycloheptane are outside the namer's subset.");
  }

  const caveats: string[] = [];
  let stereo = false;
  for (let i = 0; i < n; i++) if (mol.getAtomParity(i) !== 0) stereo = true;
  for (let b = 0; b < mol.getAllBonds(); b++) if (mol.getBondParity(b) !== 0) stereo = true;
  if (stereo) {
    caveats.push(
      "The structure carries stereochemistry; this name is CONSTITUTIONAL — its CIP stereodescriptors ((R/S), (E/Z)) are added from lib/cip.ts where every stereo element is given (stereoText).",
    );
  }
  caveats.push("Systematic name from the offline subset namer — verify against your house style before filing.");

  const finish = (r: CoreResult): CoreResult => {
    const base = { name: r.name!, caveats, principalKind: r.principalKind, principalCount: r.principalCount };
    if (!r.chain) return base;
    const locants = new Map<number, number>();
    r.chain.forEach((a, i) => locants.set(mol.getAtomMapNo(a) - 1, i + 1));
    return { ...base, locants, ...(r.reversible ? { reversible: true } : {}) };
  };

  if (parentSys) {
    const members: number[] = parentSys.atoms;
    const allC = members.every((a) => g.el[a] === 6);
    const fused = parentSys.rings > 1;
    const hetero = allC && !fused ? null : matchHetero(g, members);
    if (!allC && !hetero) {
      return refuse(
        "This heteroatom ring is outside the namer's subset — it names pyridine, pyrimidine, pyrazine, pyridazine, furan, thiophene, pyrrole, imidazole, pyrazole, oxazole, isoxazole, thiazole, piperidine, piperazine, morpholine, pyrrolidine, oxolane and oxane, as drawn (aromatic, or fully saturated).",
      );
    }
    const size = members.length;
    const isBenzene = size === 6 && members.every((a) => g.aromatic[a]);
    if (!isBenzene && !hetero) {
      for (const a of members) {
        for (const e of g.adj[a]) {
          if (g.inRing[e.to] && e.order !== 1) {
            return refuse("Ring double bonds (beyond benzene) are outside the namer's subset.");
          }
        }
      }
    }
    // The ring is the parent when it carries the principal group, or the group's carbon (COOH, CHO, CN, CONH₂)
    // hangs on it directly (benzoic acid, cyclohexanecarboxylic acid). A principal group on a chain makes the ring a
    // SUBSTITUENT (2-phenylethan-1-ol, cyclohexylmethanol).
    const det = detectGroups(g, nitroN, nitroSat);
    if (det.refusal) return refuse(det.refusal);
    // detectGroups reads chain carbons only: a ring carbon's =O is the ring's ketone (cyclohexanone, piperidin-4-one).
    for (const a of members) {
      for (const e of g.adj[a]) {
        if (g.el[e.to] === 8 && e.order === 2 && !nitroSat.has(e.to)) {
          // A ring C=O on a hydro parent needs ADDED hydrogen (1,3-dihydro-2H-indol-2-one, quinolin-2(1H)-one): stage 3e refuses it.
          if (hetero && hetero.parent.hydro) return refuse("A ring C=O on a partly saturated ring (an oxindole, a 3,4-dihydroquinolin-2(1H)-one) needs added hydrogen — outside the namer's subset.");
          if (hetero && hetero.parent.aromatic) return refuse("A ring C=O in an aromatic heterocycle (a pyridinone, an oxazolone) needs added hydrogen — outside the namer's subset.");
          // Beside a ring N or O of a SATURATED parent the namer numbers, it is a lactam, lactone or imide, named as
          // the heterocycle's ketone — the 2013 form (P-66.1.4.1, P-65.6.3.5): pyrrolidin-2-one, oxolan-2-one,
          // pyrrolidine-2,5-dione (stage 3a). Beside a ring S (a thiolactone) it stays refused.
          if (g.adj[a].some((x) => members.includes(x.to) && g.el[x.to] !== 6) && (!hetero || g.adj[a].some((x) => members.includes(x.to) && g.el[x.to] === 16))) {
            return refuse("This lactam or lactone ring is outside the namer's subset (named: the saturated rings pyrrolidine, piperidine, piperazine, morpholine, oxolane and oxane as their ketones — pyrrolidin-2-one, oxolan-2-one).");
          }
          det.groups.push({ kind: "one", carbon: a, satellites: [e.to], terminal: false });
        }
      }
    }
    const principalKind = SENIORITY.find((k) => det.groups.some((gr) => gr.kind === k));
    const memberSet = new Set(members);
    const onRing = (gr: Group): boolean => memberSet.has(gr.carbon) || ringAttached(g, gr, memberSet);
    const principal = det.groups.filter((gr) => gr.kind === principalKind);
    if (principalKind && principal.every((gr) => !onRing(gr))) {
      const r = nameAcyclic(g, nitroN, nitroSat, null, nPrefixes);
      return r.refusal ? r : finish(r);
    }
    if (principal.some((gr) => !onRing(gr))) return refuse("The principal groups are split between the ring and a chain — outside the namer's subset.");
    const r = hetero
      ? nameHeteroRing(g, members, hetero, nitroN, det.groups, principalKind ?? null, nPrefixes)
      : nameWithOneRing(g, members, isBenzene, nitroN, nitroSat, det.groups, principalKind ?? null, nPrefixes);
    return r.refusal ? r : finish(r);
  }

  const r = nameAcyclic(g, nitroN, nitroSat, null, nPrefixes);
  return r.refusal ? r : finish(r);
}

/**
 * A ring or ring system's seniority as a parent, larger is senior: P-44.2.1 (a) a heterocycle, (b) has N, (c) in
 * the absence of N, a heteroatom earlier in F > … > O > S, (d) more rings, (e) more skeletal atoms, (f) more
 * heteroatoms, (g) more heteroatoms earlier in O > S > … > N; then P-44.4.1.1 more multiple bonds (benzene >
 * cyclohexene > cyclohexane) and P-44.4.1.2 more double bonds. One function for every choice between rings — a ring
 * on a ring (stage 3d) and the branches of a substituted nitrogen (prepare()) — so the two never disagree. An empty
 * set (a chain) ranks below every ring.
 */
function ringRank(g: G, atoms: number[]): number[] {
  const set = new Set(atoms);
  const het = atoms.filter((a) => g.el[a] !== 6);
  const count = (z: number): number => het.filter((a) => g.el[a] === z).length;
  const hasN = count(7) > 0;
  const c = hasN ? 0 : count(8) ? 2 : count(16) ? 1 : 0;
  let edges = 0, multiple = 0, double = 0;
  for (const a of atoms) {
    for (const e of g.adj[a]) {
      if (a > e.to || !set.has(e.to)) continue;
      edges++;
      if (e.order > 1) multiple++;
      if (e.order === 2) double++;
    }
  }
  const rings = atoms.length ? edges - atoms.length + 1 : 0;
  return [het.length ? 1 : 0, hasN ? 1 : 0, c, rings, atoms.length, het.length, count(8), count(16), count(7), multiple, double];
}

/**
 * Two DIFFERENT ring skeletons that tie on everything but hydrogenation (tetrahydroquinoline against isoquinoline):
 * P-44.4.1 (multiple bonds) applies only when P-44.1–P-44.3 decide nothing, and P-44.2.2.2.3 ranks such fused systems
 * by their skeletons (quinoline > isoquinoline), which ringRank does not carry — so the saturation must not decide;
 * refused as a tie (stage 3e review). The same skeleton in two states (pyridine against piperidine) is decided by
 * P-44.4.1.1 as before.
 */
function hydroOnlyTie(g: G, a: number[], b: number[], samePrincipal = true): boolean {
  if (!samePrincipal) return false;
  const ra = ringRank(g, a), rb = ringRank(g, b);
  if (lexCompare(ra.slice(0, -2), rb.slice(0, -2)) !== 0) return false;
  const skeleton = (atoms: number[]): string => {
    const m = matchHetero(g, atoms);
    return m ? (m.parent.base ?? m.parent.name).replace(/^(piperidine|piperazine|pyrrolidine|oxolane)$/, (x) => ({ piperidine: "pyridine", piperazine: "pyrazine", pyrrolidine: "1H-pyrrole", oxolane: "furan" })[x]!) : `C${atoms.length}`;
  };
  return skeleton(a) !== skeleton(b);
}

/** What a ring system IS as a parent hydride, for the ring-assembly test: pyridine, benzene, cyclohexane, naphthalene. */
function ringIdentity(g: G, atoms: number[]): string {
  const hetero = matchHetero(g, atoms);
  if (hetero) return hetero.parent.name;
  const set = new Set(atoms);
  const unsat = atoms.some((a) => g.adj[a].some((e) => set.has(e.to) && e.order > 1));
  if (atoms.length === 6 && atoms.every((a) => g.aromatic[a] && g.el[a] === 6)) return "benzene";
  return `${atoms.every((a) => g.el[a] === 6) ? "C" : "X"}${atoms.length}${unsat ? "=" : ""}`;
}

/**
 * The parent among two or more ring systems (stage 3d), or a refusal. Every other system must be a ring SUBSTITUENT
 * of the parent: bonded to it directly by its one bond to the rest of the molecule (4-phenylpyridine). Rings joined
 * through a chain or an atom (diphenylmethane, a diaryl ether, a diaryl sulfone) take multiplicative names, and two
 * IDENTICAL rings bonded directly are a ring assembly (1,1′-biphenyl, P-28) whose substituted forms are not confirmed
 * — both refused by name. Identity is the parent hydride's, never the drawn substituents': 4-methylbiphenyl is an
 * assembly, not "1-methyl-4-phenylbenzene". The parent carries the most principal groups (P-44.1.1), then is the
 * senior ring (ringRank); a tie between different rings is refused.
 */
function pickParentRing(g: G, systems: Array<{ atoms: number[]; rings: number }>, nitroN: Set<number>, nitroSat: Set<number>): { atoms: number[]; rings: number } | string {
  const sysOf = new Map<number, number>();
  systems.forEach((s, i) => s.atoms.forEach((a) => sysOf.set(a, i)));
  const external = systems.map((s, i) => s.atoms.flatMap((a) => g.adj[a].filter((e) => sysOf.get(e.to) !== i).map((e) => ({ from: a, to: e.to }))));
  // A ring assembly: two systems bonded directly whose parents are the same ring. Also the same ring in two hydrogenation
  // states — pyridine on piperidine is 1,2,3,4,5,6-hexahydro-2,2′-bipyridine (PIN), not 2-(piperidin-2-yl)pyridine
  // (P-54.3) — except ONE benzene with ONE cyclohexane, which is named substitutively (cyclohexylbenzene); a benzene with
  // two cyclohexanes is a hydro terphenyl (P-31.2.3.3.5.1). (Stage 3d review.)
  const ids = systems.map((s) => ringIdentity(g, s.atoms));
  const HYDRO_OF: Record<string, string> = { piperidine: "pyridine", piperazine: "pyrazine", pyrrolidine: "1H-pyrrole", oxolane: "furan", benzene: "C6", "C6=": "C6" };
  // The hydro fused parents (stage 3e) are their mancude parents too: indoline on indole is a hydro assembly.
  for (const p of HETERO_PARENTS) if (p.base) HYDRO_OF[p.name] = p.base;
  const base = (id: string): string => HYDRO_OF[id] ?? id;
  const bonded = (i: number): number[] => external[i].map((e) => sysOf.get(e.to)).filter((j): j is number => j !== undefined);
  for (let i = 0; i < systems.length; i++) {
    for (const j of bonded(i)) {
      if (ids[j] === ids[i]) return "Ring assemblies (identical rings bonded directly: 1,1′-biphenyl, 2,2′-bipyridine) are outside the namer's subset — the forms of their substituted names are not confirmed.";
      if (base(ids[j]) !== base(ids[i])) continue;
      const pair = new Set([ids[i], ids[j]]);
      const benzeneCyclohexane = pair.has("benzene") && pair.has("C6");
      const b = ids[i] === "benzene" ? i : j, c = b === i ? j : i;
      const lone = benzeneCyclohexane && bonded(b).filter((k) => ids[k] === "C6").length === 1 && bonded(c).filter((k) => ids[k] === "benzene").length === 1;
      if (!lone) return "A ring bonded to its own hydrogenated form is a hydro ring assembly (2-(piperidin-2-yl)pyridine is hexahydro-2,2′-bipyridine; dicyclohexylbenzene a hydro terphenyl) — outside the namer's subset.";
    }
  }
  const candidates = systems
    .map((_, p) => p)
    .filter((p) => systems.every((_, j) => j === p || (external[j].length === 1 && sysOf.get(external[j][0].to) === p)));
  if (!candidates.length) return "Ring systems joined through a chain or an atom, or a ring substituent carrying its own groups (diphenylmethane, a diaryl ether, 4-(4-methylphenyl)pyridine), are outside the namer's subset.";
  // P-44.1.1: the parent carries the most principal groups — ring-attached ones (COOH on a ring C or ring N) and a
  // ring's own C=O (a lactam's) included.
  const det = detectGroups(g, nitroN, nitroSat);
  if (det.refusal) return det.refusal;
  const ringKetones = (set: Set<number>): number =>
    [...set].filter((a) => g.adj[a].some((e) => g.el[e.to] === 8 && e.order === 2 && !nitroSat.has(e.to) && !set.has(e.to))).length;
  const allRingAtoms = new Set(systems.flatMap((s) => s.atoms));
  const kinds = det.groups.map((gr) => gr.kind);
  if (ringKetones(allRingAtoms) > 0) kinds.push("one");
  const top = SENIORITY.find((k) => kinds.includes(k));
  const principalOn = (s: { atoms: number[] }): number => {
    const set = new Set(s.atoms);
    if (!top) return 0;
    const onIt = det.groups.filter((gr) => gr.kind === top && (set.has(gr.carbon) || ringAttached(g, gr, set))).length;
    return onIt + (top === "one" ? ringKetones(set) : 0);
  };
  const score = (p: number): number[] => [principalOn(systems[p]), ...ringRank(g, systems[p].atoms)];
  // Ranked over ALL systems, not only those the shape allows: when the senior ring cannot be the parent (it is the
  // one carrying the other groups' ring), the name would put the wrong ring first — "1-methyl-4-(pyridin-4-yl)benzene"
  // for what is 4-(4-methylphenyl)pyridine — so it is refused (stage 3d).
  const ranked = systems.map((_, p) => p).sort((p, q) => lexCompare(score(q), score(p)));
  if (lexCompare(score(ranked[0]), score(ranked[1])) === 0 || hydroOnlyTie(g, systems[ranked[0]].atoms, systems[ranked[1]].atoms, principalOn(systems[ranked[0]]) === principalOn(systems[ranked[1]]))) {
    return "Two different ring systems of equal seniority (which is the parent?) are outside the namer's subset.";
  }
  if (!candidates.includes(ranked[0])) return "The senior ring here carries a ring that has its own substituents (4-(4-methylphenyl)pyridine) — outside the namer's subset.";
  return systems[ranked[0]];
}

/** A group whose own carbon (COOH, CHO, C≡N, CONH₂) sits OFF the ring, bonded to a ring atom and nothing else. */
function ringAttached(g: G, gr: Group, ring: Set<number>): boolean {
  if (!["acid", "amide", "nitrile", "al"].includes(gr.kind) || ring.has(gr.carbon)) return false;
  // Its one bond besides the group's own atoms goes to the ring: a ring carbon, or (stage 3c) a saturated ring N —
  // piperidine-1-carboxylic acid, the parent of tert-butyl piperidine-1-carboxylate (P-65.1.2.2.2).
  const others = g.adj[gr.carbon].filter((e) => !gr.satellites.includes(e.to));
  return others.length === 1 && ring.has(others[0].to) && others[0].order === 1 && (g.el[others[0].to] === 6 || g.el[others[0].to] === 7);
}

// ---------------------------------------------------------------------------
// Substituent classification (shared by chains and rings)
// ---------------------------------------------------------------------------

interface Sub {
  /** Prefix name, e.g. "methyl", "chloro", "methoxy", "phenyl". */
  name: string;
  /** Alphabetization key (sec-/tert- ignored). */
  key: string;
}

/** Collects the subtree atoms hanging off `root` away from `from`. */
function subtree(g: G, root: number, from: number): number[] {
  const seen = new Set<number>([from, root]);
  const out = [root];
  const stack = [root];
  while (stack.length) {
    const a = stack.pop()!;
    for (const e of g.adj[a]) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        out.push(e.to);
        stack.push(e.to);
      }
    }
  }
  return out;
}

/** Names a substituent rooted at `root` (attached from `from`), or a refusal string. */
function classifySub(g: G, root: number, from: number, nitroN: Set<number>): Sub | string {
  const z = g.el[root];
  if (z in HALO) return { name: HALO[z], key: HALO[z] };
  if (nitroN.has(root)) return { name: "nitro", key: "nitro" };
  if (z === 8) {
    const others = g.adj[root].filter((e) => e.to !== from);
    if (others.length === 0) return { name: "hydroxy", key: "hydroxy" };
    if (others.length === 1 && g.el[others[0].to] === 6 && others[0].order === 1) {
      const tail = subtree(g, others[0].to, root);
      if (tail.every((a) => g.el[a] === 6) && isPlainAlkane(g, tail)) {
        if (tail.length === 1) return { name: "methoxy", key: "methoxy" };
        if (tail.length === 2) return { name: "ethoxy", key: "ethoxy" };
      }
      return "Ether groups beyond methoxy/ethoxy are outside the namer's subset.";
    }
    return "This oxygen arrangement is outside the namer's subset.";
  }
  // A sulfonyl S: a sulfone's other side, named as the acyl prefix of its sulfonic acid — methanesulfonyl,
  // ethanesulfonyl, propane-1-sulfonyl, propane-2-sulfonyl, benzenesulfonyl (P-65.3.2.2.2: the preferred prefixes,
  // not methylsulfonyl). Anything else on the S is refused.
  if (z === 16) {
    if (!isSulfonyl(g, root)) return "This sulfur arrangement is outside the namer's subset.";
    const rs = g.adj[root].filter((e) => e.order === 1 && e.to !== from);
    if (rs.length !== 1 || g.el[rs[0].to] !== 6) return "A sulfonyl group carrying its own group (sulfamoyl, sulfo) here is outside the namer's subset.";
    const r = rs[0].to;
    const tail = subtree(g, r, root);
    if (isPlainPhenyl(g, tail, r)) return { name: "benzenesulfonyl", key: "benzenesulfonyl" };
    const named = "This sulfonyl substituent is outside the namer's subset (named: methane-, ethane-, propane-1-, propane-2- and benzenesulfonyl).";
    if (tail.some((a) => g.inRing[a]) || !tail.every((a) => g.el[a] === 6) || !isPlainAlkane(g, tail)) return named;
    const set = new Set(tail);
    const degR = g.adj[r].filter((e) => set.has(e.to)).length;
    if (tail.length === 1) return { name: "methanesulfonyl", key: "methanesulfonyl" };
    if (tail.length === 2) return { name: "ethanesulfonyl", key: "ethanesulfonyl" };
    // Same letters, so the locant decides the order (lower first) — one key for both made the name follow the
    // drawing order (stage 3b review).
    if (tail.length === 3 && degR === 1) return { name: "propane-1-sulfonyl", key: "propanesulfonyl1" };
    if (tail.length === 3 && degR === 2) return { name: "propane-2-sulfonyl", key: "propanesulfonyl2" };
    return named;
  }
  // A ring nitrogen as the attachment is a heterocyclic substituent (morpholin-4-yl), read below with the rings.
  if (z === 7 && !g.inRing[root]) {
    const others = g.adj[root].filter((e) => e.to !== from);
    if (others.length === 0 && g.adj[root][0].order === 1) return { name: "amino", key: "amino" };
    return "Substituted amines are outside the namer's subset.";
  }
  // Carbon branch: plain alkyl, or phenyl.
  const atoms = subtree(g, root, from);
  if (atoms.some((a) => g.inRing[a])) {
    if (isPlainPhenyl(g, atoms, root)) return { name: "phenyl", key: "phenyl" };
    if (g.inRing[root] && atoms.every((a) => g.inRing[a]) && (atoms.some((a) => g.el[a] !== 6) || !isOneCycle(g, atoms))) {
      const hs = heteroSubstituent(g, root, atoms);
      if (hs) return hs;
      return "This ring substituent is outside the namer's subset (only unsubstituted parents: pyridin-2-yl, morpholin-4-yl, naphthalen-2-yl, 1H-indol-3-yl …).";
    }
    // A plain saturated carbocycle attached by one of its own atoms: cyclopropyl … cycloheptyl.
    if (g.inRing[root] && atoms.length >= 3 && atoms.length < STEM.length && atoms.every((a) => g.el[a] === 6 && g.inRing[a] && !g.aromatic[a]) && isPlainAlkane(g, atoms) && isOneCycle(g, atoms)) {
      const nm = `cyclo${ALKYL[atoms.length]}`;
      return { name: nm, key: nm };
    }
    return "Ring substituents other than plain phenyl and cycloalkyl are outside the namer's subset.";
  }
  if (!atoms.every((a) => g.el[a] === 6)) return "This substituent carries its own groups — outside the namer's subset.";
  if (!isPlainAlkane(g, atoms)) {
    // Ethenyl and ethynyl (preferred prefixes, P-32.1.1); longer unsaturated branches are refused by name.
    const other = atoms.find((x) => x !== root);
    const bond = atoms.length === 2 && other !== undefined ? g.adj[root].find((e) => e.to === other) : undefined;
    if (bond?.order === 2) return { name: "ethenyl", key: "ethenyl" };
    if (bond?.order === 3) return { name: "ethynyl", key: "ethynyl" };
    return "Unsaturated substituents other than ethenyl and ethynyl are outside the namer's subset.";
  }
  return alkylName(g, root, from, atoms);
}

/** A branch joined to the chain by a double bond: methylidene (=CH₂) or ethylidene (=CH–CH₃); anything else refused. */
function alkylidene(g: G, root: number, from: number, order: number): Sub | string {
  const atoms = subtree(g, root, from);
  if (order === 2 && atoms.every((a) => g.el[a] === 6 && !g.inRing[a]) && isPlainAlkane(g, atoms)) {
    if (atoms.length === 1) return { name: "methylidene", key: "methylidene" };
    if (atoms.length === 2) return { name: "ethylidene", key: "ethylidene" };
  }
  return "A double-bonded branch other than methylidene or ethylidene is outside the namer's subset.";
}

function isPlainAlkane(g: G, atoms: number[]): boolean {
  const set = new Set(atoms);
  return atoms.every((a) =>
    g.adj[a].every((e) => !set.has(e.to) || e.order === 1),
  );
}

/** The atoms form exactly one simple ring: each has two neighbours inside the set (no branch, no second ring). */
function isOneCycle(g: G, atoms: number[]): boolean {
  const set = new Set(atoms);
  return atoms.every((a) => g.adj[a].filter((e) => set.has(e.to)).length === 2);
}

function isPlainPhenyl(g: G, atoms: number[], root: number): boolean {
  return atoms.length === 6 && atoms.every((a) => g.el[a] === 6 && g.aromatic[a] && g.inRing[a]) && g.inRing[root];
}

function alkylName(g: G, root: number, from: number, atoms: number[]): Sub | string {
  // Unbranched?
  const set = new Set(atoms);
  const degIn = (a: number): number => g.adj[a].filter((e) => set.has(e.to)).length;
  const branched = atoms.some((a) => degIn(a) > 2);
  if (!branched) {
    // Is root an END of the path? (attachment mid-chain would be sec-.)
    if (degIn(root) <= 1) {
      const len = atoms.length;
      if (len < ALKYL.length) return { name: ALKYL[len], key: ALKYL[len] };
      return "Substituent chains beyond decyl are outside the namer's subset.";
    }
    if (atoms.length === 3) return { name: "propan-2-yl", key: "propanyl" };
    // sec-butyl and isobutyl are no longer recommended (P-29.6.3): butan-2-yl, 2-methylpropyl (preferred prefixes).
    if (atoms.length === 4 && degIn(root) === 2) return { name: "butan-2-yl", key: "butanyl" };
    return "This attachment pattern is outside the namer's subset.";
  }
  // Small named branched alkyls, recognized by shape from the root. tert-butyl is a retained PREFERRED prefix
  // (P-29.6.1: "tert-butyldi(methyl)phosphane (PIN)"); isobutyl is not (P-29.6.3) — 2-methylpropyl, alphabetised
  // at its first letter m (P-14.5.2).
  const rootDeg = degIn(root);
  if (atoms.length === 4 && rootDeg === 3) return { name: "tert-butyl", key: "butyl" };
  if (atoms.length === 4 && rootDeg === 1) {
    // CH2-CH(CH3)2
    const next = g.adj[root].find((e) => set.has(e.to))!.to;
    if (degIn(next) === 3) return { name: "2-methylpropyl", key: "methylpropyl" };
  }
  return "Complex branched substituents are outside the namer's subset.";
}

const MULT_COMPLEX = ["", "", "bis", "tris", "tetrakis", "pentakis", "hexakis"];
/** Prefixes that can themselves carry substituents (so "chloro" + "methoxy" could fuse into "chloromethoxy"). */
// Any -yl, -oxy (but hydroxy) or amino prefix: ready for propoxy/phenoxy when classifySub learns them (review).
const SUBSTITUTABLE = /(yl|(?<!hydr)oxy|amino)$/;

/** Assembles "3-chloro-2,2-dimethyl…" from locant→name pairs, or a refusal
 *  when the multiplier tables run out (never a garbled "7-fold-"). Names
 *  that contain their own locants (propan-2-yl) get enclosing marks and
 *  bis/tris multipliers, per the rules. */
function prefixString(subs: { loc: number | string | null; name: string; key: string }[]): string | { refusal: string } {
  const byName = new Map<string, { locs: (number | string | null)[]; key: string; enclose?: boolean }>();
  for (const s of subs) {
    const cur = byName.get(s.name) ?? { locs: [], key: s.key };
    cur.locs.push(s.loc);
    byName.set(s.name, cur);
  }
  const parts: string[] = [];
  const entries = [...byName.entries()].sort((a, b) => a[1].key.localeCompare(b[1].key));
  // With no locants, "chloromethoxy" reads as ONE substituent (ClCH₂O–): a later prefix that can itself carry
  // substituents (an alkyl, alkoxy, phenyl, cycloalkyl, amino) is enclosed — chloro(methoxy)acetic acid,
  // chloro(phenyl)methanol (P-16.5.1; review).
  const noLocants = subs.every((x) => x.loc === null);
  entries.forEach(([name, { locs }], idx) => {
    void locs;
    if (noLocants && idx > 0 && SUBSTITUTABLE.test(name)) byName.get(name)!.enclose = true;
  });
  for (const [name, { locs, enclose }] of entries) {
    const count = locs.length;
    // A sulfonyl prefix is a compound prefix, always enclosed: (methanesulfonyl)benzene, 2-(methanesulfonyl)benzoic
    // acid (P-65.4.1); two of them are bis(methanesulfonyl).
    const complex = /\d/.test(name) || !!enclose || /sulfonyl$/.test(name);
    // A SIMPLE prefix that carries its own locant (propan-2-yl, butan-2-yl, pyridin-2-yl) is enclosed but multiplied by
    // di/tri: di(propan-2-yl) (P-61.2.3; "ethyldi(propan-2-yl)silane (PIN)"). bis/tris are for compound and complex
    // prefixes — a substituted one (bis(2-methylpropyl)) or a sulfonyl.
    const simpleWithLocant = /^[a-z]+-\d+(,\d+)*-yl$/.test(name) && !enclose;
    const multTable = complex && !simpleWithLocant ? MULT_COMPLEX : MULT;
    if (count >= multTable.length || (count > 1 && !multTable[count])) {
      return { refusal: `More than ${multTable.length - 1} identical substituents is outside the namer's subset.` };
    }
    // "di-tert-butyl": a multiplier before an italic prefix takes a hyphen.
    const mult = count > 1 ? `${multTable[count]}${!complex && /^(tert|sec)-/.test(name) ? "-" : ""}` : "";
    const shown = complex ? `(${name})` : name;
    // Letter locants first, then numbers: N,N-dimethyl, N,4-dimethyl (P-14.3.5).
    const ordered = [...(locs as (number | string)[])].sort((x, y) =>
      typeof x === typeof y ? (typeof x === "number" ? (x as number) - (y as number) : String(x).localeCompare(String(y))) : typeof x === "string" ? -1 : 1,
    );
    const withLoc = locs.every((l) => l !== null) ? `${ordered.join(",")}-` : "";
    parts.push(`${withLoc}${mult}${shown}`);
  }
  // Hyphens separate locants from words; two word-parts join directly, an enclosed one too (chloro(methoxy)acetic acid)
  // (chlorodifluoromethane), a following locant re-introduces the hyphen
  // (3-chloro-2-methylpentane).
  return parts.reduce((acc, p) => (acc === "" ? p : /^[0-9N]/.test(p) ? `${acc}-${p}` : `${acc}${p}`), "");
}

// ---------------------------------------------------------------------------
// Acyclic naming
// ---------------------------------------------------------------------------

function detectGroups(g: G, nitroN: Set<number>, nitroSat: Set<number>): { groups: Group[]; refusal?: string } {
  const groups: Group[] = [];
  for (let c = 0; c < g.n; c++) {
    if (g.el[c] !== 6 || g.inRing[c]) continue;
    const dblO = g.adj[c].filter((e) => g.el[e.to] === 8 && e.order === 2 && !nitroSat.has(e.to));
    const singleO = g.adj[c].filter((e) => g.el[e.to] === 8 && e.order === 1 && !nitroSat.has(e.to));
    const dblN = g.adj[c].filter((e) => g.el[e.to] === 7 && e.order === 2 && !nitroN.has(e.to));
    const nS = g.adj[c].filter((e) => g.el[e.to] === 7 && e.order === 1 && !nitroN.has(e.to));
    const tripleN = g.adj[c].filter((e) => g.el[e.to] === 7 && e.order === 3);
    const cN = g.adj[c].filter((e) => g.el[e.to] === 6);
    // C=N is NOT in the subset, and skipping it silently would name a
    // different chemical formula (ethanimine came out "ethane" in the
    // adversarial pass) — the exact worst case for a patent tool.
    if (dblN.length > 0) {
      return { groups, refusal: "C=N groups (imines, oximes, amidines) are outside the namer's subset." };
    }
    // A carbonyl or nitrile carbon on sulfur (an acyl sulfone, an acyl sulfonamide, a sulfonyl cyanide, a thioester) is
    // not one of these groups: the counts below never see the S, so it would drop out of the name — "benzaldehyde" for
    // CS(=O)(=O)C(=O)c1ccccc1 (stage 3b review).
    if ((dblO.length > 0 || tripleN.length > 0) && g.adj[c].some((e) => g.el[e.to] === 16)) {
      return { groups, refusal: "A carbonyl or nitrile carbon bonded to sulfur (an acyl sulfone, a sulfonyl cyanide, a thioester) is outside the namer's subset." };
    }
    // A group's own O or N ends there: one that carries anything else is not this group, and skipping its other
    // bonds would drop atoms from the name (C=O–ring named "methanal" — review oracle).
    if ([...tripleN, ...dblO].some((e) => g.adj[e.to].length !== 1)) {
      return { groups, refusal: "A group atom with further bonds here is outside the namer's subset." };
    }
    if (tripleN.length === 1) {
      groups.push({ kind: "nitrile", carbon: c, satellites: [tripleN[0].to], terminal: true });
      continue;
    }
    if (dblO.length === 0) continue;
    // From here the carbon is a CARBONYL carbon — every decoration must be
    // accounted for, or refused. An unmatched pattern must never fall
    // through (urea and carbonic acid lost their =O entirely).
    if (dblO.length > 1) return { groups, refusal: "This carbonyl arrangement (CO₂-like) is outside the namer's subset." };
    if (g.adj[c].some((e) => g.el[e.to] in HALO)) {
      return { groups, refusal: "Acyl halides are outside the namer's subset." };
    }
    if (cN.some((e) => e.order !== 1)) {
      return { groups, refusal: "Cumulated carbonyls (ketene-like C=C=O) are outside the namer's subset." };
    }
    // A carboxy group on a saturated RING nitrogen (stage 3c): the ring's carboxylic acid — pyrrolidine-1-carboxylic
    // acid (PIN, P-65.1.2.2.2), and its esters (the Boc of tert-butyl piperidine-1-carboxylate, cut off by prepare()).
    // On an aromatic ring N (a Boc-indole): no 2013 example confirms the form for a carboxy group there — refused by
    // name. (A nitrile there is named, 1H-pyrrole-1-carbonitrile: P-66.5.1.1.3.)
    if (singleO.length === 1 && nS.length === 1 && cN.length === 0 && g.inRing[nS[0].to]) {
      const ringN = nS[0].to;
      if (g.aromatic[ringN]) return { groups, refusal: "A carboxy group or carbamate ester on an aromatic ring nitrogen (an indole-1-carboxylate, a Boc-pyrrole) is outside the namer's subset." };
      const o = singleO[0].to;
      if (g.adj[o].length !== 1) return { groups, refusal: "Ester/anhydride linkages are outside the namer's subset." };
      groups.push({ kind: "acid", carbon: c, satellites: [dblO[0].to, o], terminal: true });
      continue;
    }
    if (singleO.length === 1 && nS.length === 0) {
      const o = singleO[0].to;
      const oOthers = g.adj[o].filter((e) => e.to !== c);
      if (oOthers.length > 0) return { groups, refusal: "Ester/anhydride linkages are outside the namer's subset." };
      groups.push({ kind: "acid", carbon: c, satellites: [dblO[0].to, o], terminal: true });
      continue;
    }
    if (nS.length === 1 && singleO.length === 0) {
      const nn = nS[0].to;
      const nOthers = g.adj[nn].filter((e) => e.to !== c);
      if (nOthers.length > 0) return { groups, refusal: "N-substituted amides are outside the namer's subset." };
      groups.push({ kind: "amide", carbon: c, satellites: [dblO[0].to, nn], terminal: true });
      continue;
    }
    if (singleO.length === 0 && nS.length === 0) {
      groups.push({ kind: cN.length <= 1 ? "al" : "one", carbon: c, satellites: [dblO[0].to], terminal: cN.length <= 1 });
      continue;
    }
    return {
      groups,
      refusal: "This carbonyl arrangement (carbonic acid, urea, carbamate…) is outside the namer's subset.",
    };
  }
  // Sulfonic acids and sulfonamides (stage 3b): a sulfonyl S on ONE carbon, with -OH or -NH2 (an N-substituent was cut
  // off by prepare() and comes back as an N-prefix). The S, its two O and the OH/NH2 are the group; a sulfone (S on two
  // carbons) is a substituent, named by classifySub.
  for (let s = 0; s < g.n; s++) {
    if (!isSulfonyl(g, s)) continue;
    const single = g.adj[s].filter((e) => e.order === 1);
    const cs = single.filter((e) => g.el[e.to] === 6);
    if (cs.length !== 1) continue;
    const other = single.find((e) => g.el[e.to] !== 6)!.to;
    if (g.adj[other].length !== 1) return { groups, refusal: "This sulfonyl group (a sulfonate ester, a substituted sulfonamide the namer cannot place) is outside the namer's subset." };
    const oxo = g.adj[s].filter((e) => e.order === 2).map((e) => e.to);
    groups.push({ kind: g.el[other] === 8 ? "sulfonic" : "sulfonamide", carbon: cs[0].to, satellites: [s, ...oxo, other], terminal: false });
  }
  // -OH and -NH2 anchored on carbons not already claimed.
  const claimed = new Set(groups.flatMap((gr) => gr.satellites));
  for (let i = 0; i < g.n; i++) {
    if (claimed.has(i) || nitroSat.has(i) || nitroN.has(i)) continue;
    // On a carbon, or (stage 3e review) on a RING nitrogen, where it is the ring's suffix too: "piperidin-1-ol (PIN)"
    // (P-63.1.3, not 1-hydroxypiperidine) and "piperidin-1-amine (PIN)" (P-62.2.1.3). The anchor is then that N.
    const anchorOk = (a: number): boolean => g.el[a] === 6 || (g.el[a] === 7 && g.inRing[a] && !nitroN.has(a));
    if (g.el[i] === 8 && g.adj[i].length === 1 && g.adj[i][0].order === 1 && anchorOk(g.adj[i][0].to)) {
      groups.push({ kind: "ol", carbon: g.adj[i][0].to, satellites: [i], terminal: false });
    }
    if (g.el[i] === 7 && !g.inRing[i] && g.adj[i].length === 1 && g.adj[i][0].order === 1 && anchorOk(g.adj[i][0].to)) {
      groups.push({ kind: "amine", carbon: g.adj[i][0].to, satellites: [i], terminal: false });
    }
  }
  return { groups };
}

function nameAcyclic(
  g: G,
  nitroN: Set<number>,
  nitroSat: Set<number>,
  phenylOf: null,
  nPrefixes: { name: string; key: string }[] = [],
): CoreResult {
  const det = detectGroups(g, nitroN, nitroSat);
  if (det.refusal) return refuse(det.refusal);

  // The principal kind is the most senior present; everything junior must
  // have a prefix form or the molecule is refused.
  const present = SENIORITY.filter((k) => det.groups.some((gr) => gr.kind === k));
  const principalKind = present[0];
  const principal = det.groups.filter((gr) => gr.kind === principalKind);
  const junior = det.groups.filter((gr) => gr.kind !== principalKind);
  for (const j of junior) {
    if (!PREFIX_FORM[j.kind]) {
      return refuse(`${GROUP_WORD[j.kind].replace(/^a/, "A")} group alongside a more senior group is outside the namer's subset.`);
    }
  }

  const satAtoms = new Set(det.groups.flatMap((gr) => gr.satellites));
  if (nPrefixes.length && principal.length > 1) return refuse("N-substituents with more than one principal group (N, N′) are outside the namer's subset.");

  // Candidate chains: carbon paths (the carbon skeleton is a tree here).
  const carbons: number[] = [];
  for (let i = 0; i < g.n; i++) if (g.el[i] === 6 && !g.inRing[i]) carbons.push(i);
  if (carbons.length === 0) return refuse("No carbon chain to name.");
  const cAdj = new Map<number, number[]>();
  for (const c of carbons) {
    cAdj.set(c, g.adj[c].filter((e) => g.el[e.to] === 6 && !g.inRing[e.to]).map((e) => e.to));
  }
  const pathBetween = (a: number, b: number): number[] | null => {
    const prev = new Map<number, number>([[a, -1]]);
    const q = [a];
    while (q.length) {
      const x = q.shift()!;
      if (x === b) break;
      for (const y of cAdj.get(x) ?? []) if (!prev.has(y)) { prev.set(y, x); q.push(y); }
    }
    if (!prev.has(b)) return null;
    const path = [b];
    let cur = b;
    while (prev.get(cur) !== -1) { cur = prev.get(cur)!; path.push(cur); }
    return path.reverse();
  };
  const candidates: number[][] = [];
  for (let i = 0; i < carbons.length; i++) {
    for (let j = i; j < carbons.length; j++) {
      const p = pathBetween(carbons[i], carbons[j]);
      if (p) candidates.push(p);
    }
  }

  const principalCarbons = principal.map((p) => p.carbon);
  const terminal = principal.length > 0 && principal[0].terminal;
  const viable = candidates.filter((chain) => {
    const set = new Set(chain);
    if (!principalCarbons.every((c) => set.has(c))) return false;
    if (terminal) {
      // Terminal groups must sit at chain ends.
      const ends = [chain[0], chain[chain.length - 1]];
      if (!principalCarbons.every((c) => ends.includes(c))) return false;
    }
    return true;
  });
  if (viable.length === 0) {
    return refuse("The principal groups cannot all lie on one chain — outside the namer's subset.");
  }

  interface Scored {
    chain: number[];
    unsat: { loc: number; order: number }[];
    suffixLocs: number[];
    subs: { loc: number; name: string; key: string }[];
    scoreKey: number[];
    /** Both numbering directions give the same name: the chain may be numbered from either end. */
    reversible?: boolean;
  }

  const analyse = (chainIn: number[]): Scored | string => {
    // Try both directions; keep the better numbering.
    let best: Scored | null = null;
    for (const chain of [chainIn, [...chainIn].reverse()]) {
      const pos = new Map(chain.map((a, i) => [a, i + 1]));
      const set = new Set(chain);
      // Unsaturation within the chain.
      const unsat: { loc: number; order: number }[] = [];
      for (const a of chain) {
        for (const e of g.adj[a]) {
          if (e.order === 1) continue;
          if (set.has(e.to) && pos.get(e.to)! === pos.get(a)! + 1) unsat.push({ loc: pos.get(a)!, order: e.order });
        }
      }
      // Suffix locants.
      const suffixLocs = principal.map((p) => pos.get(p.carbon)!).sort((x, y) => x - y);
      // Substituents (junior groups in prefix form + everything else).
      const subs: { loc: number; name: string; key: string }[] = [];
      for (const j of junior) {
        const nm = PREFIX_FORM[j.kind]!;
        subs.push({ loc: pos.get(j.carbon)!, name: nm, key: nm });
      }
      let subRefusal: string | null = null;
      for (const a of chain) {
        for (const e of g.adj[a]) {
          if (set.has(e.to) || satAtoms.has(e.to)) continue;
          if (g.el[e.to] === 6 && !set.has(e.to) && g.inRing[e.to]) {
            const cls = classifySub(g, e.to, a, nitroN);
            if (typeof cls === "string") { subRefusal = cls; break; }
            subs.push({ loc: pos.get(a)!, ...cls });
            continue;
          }
          if (e.order !== 1 && g.el[e.to] === 6 && !g.inRing[e.to]) {
            // A double bond leaving the chain to a branch carbon: an alkylidene prefix (P-31.1.4.2.4; 2013 rules put
            // chain length before unsaturation, so CCC(=C)CC is 3-methylidenepentane, not 2-ethylbut-1-ene).
            const yl = alkylidene(g, e.to, a, e.order);
            if (typeof yl === "string") return yl;
            subs.push({ loc: pos.get(a)!, ...yl });
            continue;
          }
          if (e.order !== 1 && g.el[e.to] !== 6) {
            // Every legitimate heteroatom multiple bond was claimed as a
            // group satellite above — anything still here is outside the
            // subset, and silently skipping it would drop atoms from the
            // name (the imine trap).
            return "A heteroatom multiple bond here is outside the namer's subset.";
          }
          const cls = classifySub(g, e.to, a, nitroN);
          if (typeof cls === "string") { subRefusal = cls; break; }
          subs.push({ loc: pos.get(a)!, ...cls });
        }
        if (subRefusal) break;
      }
      if (subRefusal) return subRefusal;
      // Alphabetical, and by locant within one name: identical groups listed in array order made the two directions of
      // a symmetric chain (tartaric acid's two OH) score differently, so it was never seen as reversible (review).
      const alphaLocs = [...subs].sort((x, y) => x.key.localeCompare(y.key) || x.loc - y.loc).map((s) => s.loc);
      const scoreKey = [
        ...suffixLocs,
        99, ...unsat.map((u) => u.loc).sort((x, y) => x - y),
        // ene/yne tie: when the combined locant set ties in both directions,
        // the DOUBLE bonds take the lower locants (pent-1-en-4-yne, from
        // either input order — without this the winner was enumeration
        // order, a nondeterministic wrong name).
        99, ...unsat.filter((u) => u.order === 2).map((u) => u.loc).sort((x, y) => x - y),
        99, ...subs.map((s) => s.loc).sort((x, y) => x - y),
        99, ...alphaLocs,
      ];
      const cand: Scored = { chain, unsat, suffixLocs, subs, scoreKey };
      // The same name either way (a symmetric chain): IUPAC P-31.1.4.3.4 then lets the stereodescriptors choose.
      const sameName = (p: Scored, q: Scored): boolean =>
        p.scoreKey.join() === q.scoreKey.join() &&
        JSON.stringify([...p.subs].map((x) => [x.loc, x.name]).sort()) === JSON.stringify([...q.subs].map((x) => [x.loc, x.name]).sort()) &&
        JSON.stringify(p.unsat) === JSON.stringify(q.unsat) &&
        p.suffixLocs.join() === q.suffixLocs.join();
      if (best && sameName(cand, best)) best.reversible = true;
      else if (!best || lexLess(cand.scoreKey, best.scoreKey)) best = cand;
    }
    return best!;
  };

  const lexLess = (a: number[], b: number[]): boolean => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] ?? Infinity, y = b[i] ?? Infinity;
      if (x !== y) return x < y;
    }
    return false;
  };

  // Chain selection (2013 rules, P-44.3): the LONGEST chain first, then the most multiple bonds in it → most
  // substituents → best locant key. (Unsaturation before length was the 1979/1993 rule.) Only chains of the
  // greatest length can be principal: when every one of them is refused, the molecule is refused — a shorter chain
  // would give a name that is not the PIN.
  const longest = Math.max(...viable.map((c) => c.length));
  let chosen: Scored | null = null;
  let refusalSeen: string | null = null;
  let refusalLen = -1;
  for (const cand of viable) {
    if (cand.length < longest) continue;
    const a = analyse(cand);
    if (typeof a === "string") {
      // Keep the refusal from the LONGEST failing chain — a one-carbon
      // stub's complaint ("substituent carries groups") must not shadow the
      // real story ("substituted amines are outside the subset").
      if (cand.length > refusalLen) { refusalSeen = a; refusalLen = cand.length; }
      continue;
    }
    if (!chosen) { chosen = a; continue; }
    const better =
      a.chain.length !== chosen.chain.length ? a.chain.length > chosen.chain.length :
      a.unsat.length !== chosen.unsat.length ? a.unsat.length > chosen.unsat.length :
      a.subs.length !== chosen.subs.length ? a.subs.length > chosen.subs.length :
      lexLess(a.scoreKey, chosen.scoreKey);
    if (better) chosen = a;
  }
  if (!chosen) return refuse(refusalSeen ?? "No viable chain found.");

  const len = chosen.chain.length;
  if (len >= STEM.length) return refuse(`Chains beyond C${IUPAC_MAX_CHAIN} are outside the namer's subset.`);

  // Assemble.
  const stemBase = STEM[len].slice(0, -2); // "butan" → "but"
  const enes = chosen.unsat.filter((u) => u.order === 2).map((u) => u.loc).sort((a, b) => a - b);
  const ynes = chosen.unsat.filter((u) => u.order === 3).map((u) => u.loc).sort((a, b) => a - b);
  let parent: string;
  if (enes.length === 0 && ynes.length === 0) {
    parent = STEM[len]; // saturated: "butan"
  } else {
    let s = stemBase;
    // Ethene/ethyne: a two-carbon chain has only one possible position, so
    // the locant is omitted (prop-1-ene and up keep theirs — PIN style).
    if (enes.length) s += len <= 2 ? "en" : (enes.length > 1 ? `a-${enes.join(",")}-${MULT[enes.length]}en` : `-${enes.join(",")}-en`);
    if (ynes.length) s += len <= 2 ? "yn" : (ynes.length > 1 ? `a-${ynes.join(",")}-${MULT[ynes.length]}yn` : `-${ynes.join(",")}-yn`);
    parent = s;
  }

  let name: string;
  if (!principalKind) {
    name = parent + (enes.length || ynes.length ? "e" : "e");
  } else {
    const suffix = SUFFIX[principalKind];
    const count = chosen.suffixLocs.length;
    if (count >= MULT.length) {
      return refuse(`More than ${MULT.length - 1} identical principal groups is outside the namer's subset.`);
    }
    const mult = count > 1 ? MULT[count] : "";
    // Terminal suffixes (-oic acid, -al…) never take locants. Short chains
    // drop the locant ONLY when nothing else in the name is numbered:
    // "ethanol", but "2-aminoethan-1-ol" (PIN keeps the 1). A ONE-carbon
    // parent has no meaningful locants at all (phenylmethanol, not
    // phenylmethan-1-ol).
    const bare = len <= 2 && chosen.subs.length === 0 && chosen.unsat.length === 0 && count === 1;
    const needLocants = !principal[0].terminal && !bare && len > 1;
    const locStr = needLocants ? `-${chosen.suffixLocs.join(",")}-` : "";
    const suffixPart = `${locStr}${multiplied(mult, suffix)}`;
    // Final-e elision: the stem keeps its "e" before a consonant-initial
    // suffix (butanenitrile, pentane-2,4-dione) and drops it before a
    // vowel-initial one (butanal, propan-2-ol).
    // (s: ethanesulfonic acid, ethane-1-sulfonamide — stage 3b.)
    name = /^[-0-9,]*(d|n|t|h|p|s)/.test(suffixPart)
      ? `${parent}e${suffixPart}`
      : `${parent}${suffixPart}`;
  }

  // Locant omission where positions are unambiguous: every locant on a
  // one-carbon parent (tetrachloromethane), or a lone substituent on a
  // two-carbon parent (chloroethane, methoxyethane).
  const subList: { loc: number | string | null; name: string; key: string }[] =
    chosen.subs.map((s) => ({ loc: s.loc, name: s.name, key: s.key }));
  // Retained names (P-65.1.1.1, P-66.1.1.1, P-66.6.1.1): formic and acetic acid, formamide and acetamide. Acetic
  // acid keeps its name when substituted on carbon, with no locant (only C2 can carry one): chloroacetic acid,
  // phenylacetic acid. Unsaturated or otherwise numbered chains stay systematic.
  let retained = false;
  if (principalKind && chosen.unsat.length === 0 && chosen.suffixLocs.length === 1 && len <= 2) {
    if (principalKind === "acid" && len === 1 && subList.length === 0) (name = "formic acid"), (retained = true);
    else if (principalKind === "acid" && len === 2) (name = "acetic acid"), (retained = true);
    else if (principalKind === "amide" && len === 1 && subList.length === 0) (name = "formamide"), (retained = true);
    else if (principalKind === "amide" && len === 2 && subList.length === 0) (name = "acetamide"), (retained = true);
  }
  // A one-carbon parent drops its locants — unless N-prefixes are numbered too: N-methyl-1-phenylmethanamine, not
  // "N-methylphenylmethanamine" (read as N-(methylphenyl)…; review).
  if ((len === 1 || retained) && !nPrefixes.length) {
    for (const s of subList) s.loc = null;
  } else if (!principalKind && chosen.unsat.length === 0 && len <= 2 && subList.length === 1) {
    subList[0].loc = null;
  }
  for (const p of nPrefixes) subList.push({ loc: "N", name: p.name, key: p.key });
  const prefixes = prefixString(subList);
  if (typeof prefixes !== "string") return refuse(prefixes.refusal);
  const full = prefixes ? `${prefixes}${/^[0-9]/.test(name) ? "-" : ""}${name}` : name;
  return { name: full, caveats: [], chain: chosen.chain, reversible: chosen.reversible, principalKind, principalCount: chosen.suffixLocs.length };
}

// ---------------------------------------------------------------------------
// Single-ring naming (benzene + cycloalkanes)
// ---------------------------------------------------------------------------

/** Benzene parents with a retained name for ONE principal group (P-2013: phenol, aniline, benzoic acid …). */
const BENZENE_RETAINED: Partial<Record<Group["kind"], string>> = {
  ol: "phenol", amine: "aniline", acid: "benzoic acid", al: "benzaldehyde", nitrile: "benzonitrile", amide: "benzamide",
};
/** Suffixes for groups whose carbon hangs on the ring (cyclohexanecarboxylic acid, benzene-1,4-dicarbaldehyde). */
const RING_ATTACHED_SUFFIX: Partial<Record<Group["kind"], string>> = {
  acid: "carboxylic acid", al: "carbaldehyde", nitrile: "carbonitrile", amide: "carboxamide",
};

function nameWithOneRing(
  g: G,
  members: number[],
  isBenzene: boolean,
  nitroN: Set<number>,
  nitroSat: Set<number>,
  groups: Group[],
  principalKind: Group["kind"] | null,
  nPrefixes: { name: string; key: string }[],
): CoreResult {
  const memberSet = new Set(members);
  // Order members around the ring.
  const ring: number[] = [members[0]];
  while (ring.length < members.length) {
    const cur = ring[ring.length - 1];
    const next = g.adj[cur].map((e) => e.to).find((a) => memberSet.has(a) && !ring.includes(a));
    if (next === undefined) break;
    ring.push(next);
  }
  if (ring.length !== members.length) return refuse("Could not walk the ring — outside the namer's subset.");

  // Junior groups become prefixes; one without a prefix form (an aldehyde beside an acid) is refused by name.
  for (const gr of groups) {
    if (gr.kind !== principalKind && !PREFIX_FORM[gr.kind]) {
      return refuse(`${GROUP_WORD[gr.kind].replace(/^a/, "A")} group alongside a more senior group is outside the namer's subset.`);
    }
  }
  // Every atom bonded to the ring is: a principal group (or its carbon), a junior group in prefix form, or a
  // substituent classifySub names — nothing falls through (the imine trap: an unclaimed atom drops out of the name).
  const byAtom = new Map<number, Group>();
  for (const gr of groups) {
    for (const s of gr.satellites) byAtom.set(s, gr);
    if (!memberSet.has(gr.carbon)) byAtom.set(gr.carbon, gr);
  }
  interface RingSub { idx: number; name: string; key: string; suffix?: boolean }
  const subs: RingSub[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    for (const e of g.adj[a]) {
      if (memberSet.has(e.to)) continue;
      const gr = byAtom.get(e.to);
      if (gr && (gr.carbon === a || gr.carbon === e.to)) {
        // A group on this ring atom: its O/N satellite (ol, amine, one), or its own carbon (acid, al, nitrile, amide).
        if (gr.carbon === e.to && !ringAttached(g, gr, memberSet)) return refuse("A substituent that carries its own group (hydroxymethyl, aminoethyl …) is outside the namer's subset.");
        if (gr.kind === principalKind) subs.push({ idx: i, name: "", key: "", suffix: true });
        else {
          const nm = PREFIX_FORM[gr.kind]!;
          subs.push({ idx: i, name: nm, key: nm });
        }
        continue;
      }
      // classifySub never sees bond orders — an exocyclic double bond
      // (methylidenecyclohexane) must not be read as a saturated alkyl.
      if (e.order !== 1) return refuse("An exocyclic double bond on the ring is outside the namer's subset.");
      const cls = classifySub(g, e.to, a, nitroN);
      if (typeof cls === "string") return refuse(cls);
      subs.push({ idx: i, ...cls });
    }
  }
  void nitroSat;
  const suffixSubs = subs.filter((s) => s.suffix);
  const prefixSubs = subs.filter((s) => !s.suffix);
  if (principalKind && suffixSubs.length !== groups.filter((gr) => gr.kind === principalKind).length) {
    return refuse("The principal groups could not all be placed on the ring — outside the namer's subset.");
  }
  if (nPrefixes.length && suffixSubs.length > 1) return refuse("N-substituents with more than one principal group (N, N′) are outside the namer's subset.");

  const size = ring.length;
  if (size >= STEM.length) return refuse(`Rings beyond C${IUPAC_MAX_CHAIN} are outside the namer's subset.`);

  // Numbering: all rotations, both directions — the principal groups take the lowest locants, then all prefixes,
  // then the prefixes in alphabetical order (P-31.1.4).
  let best: { locs: { loc: number; name: string; key: string }[]; sufLocs: number[]; key: number[] } | null = null;
  for (const dir of [1, -1]) {
    for (let start = 0; start < size; start++) {
      const locOf = (idx: number): number => ((idx - start) * dir + size * 10) % size + 1;
      const sufLocs = suffixSubs.map((s) => locOf(s.idx)).sort((x, y) => x - y);
      const locs = prefixSubs.map((s) => ({ loc: locOf(s.idx), name: s.name, key: s.key }));
      const sorted = locs.map((l) => l.loc).sort((x, y) => x - y);
      const alpha = [...locs].sort((x, y) => x.key.localeCompare(y.key) || x.loc - y.loc).map((l) => l.loc);
      const key = [...sufLocs, 99, ...sorted, 99, ...alpha];
      if (!best || lexLessArr(key, best.key)) best = { locs, sufLocs, key };
    }
  }
  if (!best) return refuse("Could not number the ring.");
  const count = suffixSubs.length;
  const kind = count ? principalKind : null;
  const result = (name: string): CoreResult => ({ name, caveats: [], principalKind: kind ?? undefined, principalCount: count });

  // A monosubstituted ring, or one principal group and nothing else, needs no locant: chlorobenzene, phenol,
  // cyclohexanol, cyclohexanecarboxylic acid. With anything else every position is numbered.
  const allSubs = [...best.locs.map((l) => ({ loc: l.loc as number | string | null, name: l.name, key: l.key })), ...nPrefixes.map((p) => ({ loc: "N" as number | string | null, name: p.name, key: p.key }))];
  const lone = (count === 1 && best.locs.length === 0) || (count === 0 && best.locs.length === 1);
  if (lone) for (const s of allSubs) if (typeof s.loc === "number") s.loc = null;
  const prefixes = prefixString(allSubs);
  if (typeof prefixes !== "string") return refuse(prefixes.refusal);
  const join = (p: string, rest: string): string => (p ? `${p}${/^[0-9]/.test(rest) ? "-" : ""}${rest}` : rest);

  if (!kind) return result(join(prefixes, isBenzene ? "benzene" : `cyclo${STEM[size]}e`));
  if (count >= MULT.length) return refuse(`More than ${MULT.length - 1} identical principal groups is outside the namer's subset.`);
  const mult = count > 1 ? MULT[count] : "";
  const locStr = lone ? "" : `-${best.sufLocs.join(",")}-`;
  if (isBenzene && count === 1 && BENZENE_RETAINED[kind]) {
    // The retained parent carries its group at C1: 4-chlorophenol, N,N-dimethylaniline.
    return result(join(prefixes, BENZENE_RETAINED[kind]!));
  }
  if (isBenzene && (kind === "one")) return refuse("A ketone on a benzene ring is not a ring ketone — outside the namer's subset.");
  const stem = isBenzene ? "benzen" : `cyclo${STEM[size]}`;
  const suffixWord = RING_ATTACHED_SUFFIX[kind] && groups.some((gr) => gr.kind === kind && ringAttached(g, gr, memberSet)) ? RING_ATTACHED_SUFFIX[kind]! : SUFFIX[kind];
  const suffixPart = `${locStr}${multiplied(mult, suffixWord)}`;
  // Final-e elision: the stem keeps its "e" before a consonant (cyclohexane-1,2-diol, cyclohexanecarboxylic acid)
  // and drops it before a vowel (cyclohexanol, cyclohexanone, cyclohexanamine).
  const body = /^[-0-9,]*[aeiouy]/.test(suffixPart) ? `${stem}${suffixPart}` : `${stem}e${suffixPart}`;
  return result(join(prefixes, body));
}

// ---------------------------------------------------------------------------
// Heteromonocycles (v2.169.0, stage 1b): retained parents with FIXED numbering
// ---------------------------------------------------------------------------

/**
 * One heteromonocyclic parent: the element at each locant 1…n (H marks the indicated-hydrogen nitrogen, which must
 * carry H or a substituent; N alone is a pyridine-type nitrogen in an aromatic ring), aromatic or fully saturated.
 * Retained names and their numbering, P-22.2.1 / P-22.2.2 (IUPAC 2013).
 */
interface HeteroParent {
  name: string;
  /** Atoms in locant order around the ring (a fused system: its periphery; F = a fusion carbon, 4a/8a). */
  pattern: Array<"C" | "N" | "O" | "S" | "H" | "F">;
  aromatic: boolean;
  /** Locants by position (a fused system's periphery: 1, 2, 3, 4, 4a, 5 … 8a); 1…n when absent. */
  labels?: string[];
  /**
   * Stage 3e: a partly saturated (hydro) parent — the positions (indices into `pattern`) that are saturated, every other
   * position aromatic. The heteroatom or the indicated hydrogen fixes which ring is saturated, so the hydro locants
   * are fixed by the name ("2,3-dihydro-1H-indole (PIN)": hydro prefixes before indicated hydrogen, P-31.2.1).
   */
  hydro?: number[];
  /** The mancude parent a hydro parent is a hydrogenated form of (the ring-assembly test). */
  base?: string;
}
const NAPH = ["1", "2", "3", "4", "4a", "5", "6", "7", "8", "8a"];
const INDOLE = ["1", "2", "3", "3a", "4", "5", "6", "7", "7a"];
const HETERO_PARENTS: HeteroParent[] = [
  { name: "pyridine", pattern: ["N", "C", "C", "C", "C", "C"], aromatic: true },
  { name: "pyrimidine", pattern: ["N", "C", "N", "C", "C", "C"], aromatic: true },
  { name: "pyrazine", pattern: ["N", "C", "C", "N", "C", "C"], aromatic: true },
  { name: "pyridazine", pattern: ["N", "N", "C", "C", "C", "C"], aromatic: true },
  { name: "furan", pattern: ["O", "C", "C", "C", "C"], aromatic: true },
  { name: "thiophene", pattern: ["S", "C", "C", "C", "C"], aromatic: true },
  { name: "1H-pyrrole", pattern: ["H", "C", "C", "C", "C"], aromatic: true },
  { name: "1H-imidazole", pattern: ["H", "C", "N", "C", "C"], aromatic: true },
  { name: "1H-pyrazole", pattern: ["H", "N", "C", "C", "C"], aromatic: true },
  { name: "1,3-oxazole", pattern: ["O", "C", "N", "C", "C"], aromatic: true },
  { name: "1,2-oxazole", pattern: ["O", "N", "C", "C", "C"], aromatic: true },
  { name: "1,3-thiazole", pattern: ["S", "C", "N", "C", "C"], aromatic: true },
  { name: "piperidine", pattern: ["N", "C", "C", "C", "C", "C"], aromatic: false },
  { name: "piperazine", pattern: ["N", "C", "C", "N", "C", "C"], aromatic: false },
  { name: "morpholine", pattern: ["O", "C", "C", "N", "C", "C"], aromatic: false },
  { name: "pyrrolidine", pattern: ["N", "C", "C", "C", "C"], aromatic: false },
  { name: "oxolane", pattern: ["O", "C", "C", "C", "C"], aromatic: false },
  { name: "oxane", pattern: ["O", "C", "C", "C", "C", "C"], aromatic: false },
  // Stage 2 (v2.170.0): ortho-fused bicyclic parents, peripheral numbering (P-25.2.1, P-25.3.1.3).
  { name: "naphthalene", pattern: ["C", "C", "C", "C", "F", "C", "C", "C", "C", "F"], aromatic: true, labels: NAPH },
  { name: "quinoline", pattern: ["N", "C", "C", "C", "F", "C", "C", "C", "C", "F"], aromatic: true, labels: NAPH },
  { name: "isoquinoline", pattern: ["C", "N", "C", "C", "F", "C", "C", "C", "C", "F"], aromatic: true, labels: NAPH },
  { name: "quinazoline", pattern: ["N", "C", "N", "C", "F", "C", "C", "C", "C", "F"], aromatic: true, labels: NAPH },
  { name: "quinoxaline", pattern: ["N", "C", "C", "N", "F", "C", "C", "C", "C", "F"], aromatic: true, labels: NAPH },
  { name: "1H-indole", pattern: ["H", "C", "C", "F", "C", "C", "C", "C", "F"], aromatic: true, labels: INDOLE },
  { name: "1H-indazole", pattern: ["H", "N", "C", "F", "C", "C", "C", "C", "F"], aromatic: true, labels: INDOLE },
  { name: "1H-benzimidazole", pattern: ["H", "C", "N", "F", "C", "C", "C", "C", "F"], aromatic: true, labels: INDOLE },
  { name: "1-benzofuran", pattern: ["O", "C", "C", "F", "C", "C", "C", "C", "F"], aromatic: true, labels: INDOLE },
  { name: "1-benzothiophene", pattern: ["S", "C", "C", "F", "C", "C", "C", "C", "F"], aromatic: true, labels: INDOLE },
  { name: "1,3-benzoxazole", pattern: ["O", "C", "N", "F", "C", "C", "C", "C", "F"], aromatic: true, labels: INDOLE },
  { name: "1,3-benzothiazole", pattern: ["S", "C", "N", "F", "C", "C", "C", "C", "F"], aromatic: true, labels: INDOLE },
  // Stage 3e: the benzo-fused parents with their hetero ring saturated (P-31.2; examples "2,3-dihydro-1H-indole (PIN)",
  // "1,2,3,4-tetrahydroisoquinoline-3-carboxylic acid (PIN)", "2,3-dihydro-1H-indene (PIN)" — not indoline or indane).
  { name: "2,3-dihydro-1H-indole", pattern: ["H", "C", "C", "F", "C", "C", "C", "C", "F"], aromatic: false, labels: INDOLE, hydro: [0, 1, 2], base: "1H-indole" },
  { name: "2,3-dihydro-1-benzofuran", pattern: ["O", "C", "C", "F", "C", "C", "C", "C", "F"], aromatic: false, labels: INDOLE, hydro: [0, 1, 2], base: "1-benzofuran" },
  { name: "2,3-dihydro-1-benzothiophene", pattern: ["S", "C", "C", "F", "C", "C", "C", "C", "F"], aromatic: false, labels: INDOLE, hydro: [0, 1, 2], base: "1-benzothiophene" },
  { name: "2,3-dihydro-1H-indene", pattern: ["C", "C", "C", "F", "C", "C", "C", "C", "F"], aromatic: false, labels: INDOLE, hydro: [0, 1, 2], base: "1H-indene" },
  { name: "1,2,3,4-tetrahydroquinoline", pattern: ["H", "C", "C", "C", "F", "C", "C", "C", "C", "F"], aromatic: false, labels: NAPH, hydro: [0, 1, 2, 3], base: "quinoline" },
  { name: "1,2,3,4-tetrahydroisoquinoline", pattern: ["C", "H", "C", "C", "F", "C", "C", "C", "C", "F"], aromatic: false, labels: NAPH, hydro: [0, 1, 2, 3], base: "isoquinoline" },
];

/** A ring atom's locant in a numbering (the parent's label), as a number — null for a fusion atom (4a, 8a). */
function locNum(parent: HeteroParent, order: number[], a: number): number | null {
  const k = order.indexOf(a);
  const label = parent.labels ? parent.labels[k] : String(k + 1);
  return /^\d+$/.test(label) ? Number(label) : null;
}

/**
 * The atoms of a ring system in a cyclic order to match patterns against: one simple ring walked round, or an
 * ortho-fused bicycle's periphery (two fusion atoms, bonded, each with three ring neighbours; every other atom two).
 * Null for anything else (bridged, spiro, three rings): no parent here is drawn that way.
 */
function ringPeriphery(g: G, members: number[]): { order: number[]; fusion: Set<number> } | null {
  const set = new Set(members);
  const deg = (a: number): number => g.adj[a].filter((e) => set.has(e.to)).length;
  if (isOneCycle(g, members)) {
    const ring = walkRing(g, members);
    return ring ? { order: ring, fusion: new Set() } : null;
  }
  const fusion = members.filter((a) => deg(a) === 3);
  if (fusion.length !== 2 || members.some((a) => !fusion.includes(a) && deg(a) !== 2)) return null;
  const [f1, f2] = fusion;
  if (!g.adj[f1].some((e) => e.to === f2)) return null;
  // Walk the periphery: never along the fusion bond.
  const order = [f1];
  let prev = -1, cur = f1;
  while (order.length < members.length) {
    const next = g.adj[cur].map((e) => e.to).find((x) => set.has(x) && x !== prev && !order.includes(x) && !((cur === f1 && x === f2) || (cur === f2 && x === f1)));
    if (next === undefined) return null;
    order.push(next);
    prev = cur;
    cur = next;
  }
  if (!g.adj[cur].some((e) => e.to === f1)) return null;
  return { order, fusion: new Set(fusion) };
}
const SYMBOL: Record<number, "C" | "N" | "O" | "S"> = { 6: "C", 7: "N", 8: "O", 16: "S" };

/** The ring atoms in walking order (members unordered as OCL gives them), or null. */
function walkRing(g: G, members: number[]): number[] | null {
  const memberSet = new Set(members);
  const ring: number[] = [members[0]];
  while (ring.length < members.length) {
    const cur = ring[ring.length - 1];
    const next = g.adj[cur].map((e) => e.to).find((a) => memberSet.has(a) && !ring.includes(a));
    if (next === undefined) return null;
    ring.push(next);
  }
  // A path through every atom is a ring only if it closes (a bicycle's atoms can be walked too).
  if (!g.adj[ring[ring.length - 1]].some((e) => e.to === ring[0])) return null;
  return ring;
}

/**
 * The parent a heteroring is, with every numbering its fixed locants allow (each numbering lists the ring atoms in
 * locant order 1…n). Null when the ring is not one of the stage-1b parents, as drawn: its atoms, its aromaticity
 * (all aromatic, or all single bonds) and where its hydrogen is (1H-imidazole: the NH is N1).
 */
function matchHetero(g: G, members: number[]): { parent: HeteroParent; numberings: number[][] } | null {
  const per = ringPeriphery(g, members);
  if (!per) return null;
  const ring = per.order;
  const size = ring.length;
  const memberSet = new Set(ring);
  const allAromatic = ring.every((a) => g.aromatic[a]);
  const allSingle = ring.every((a) => g.adj[a].every((e) => !memberSet.has(e.to) || e.order === 1));
  for (const parent of HETERO_PARENTS) {
    if (parent.pattern.length !== size) continue;
    if (parent.pattern.includes("F") !== per.fusion.size > 0) continue;
    if (!parent.hydro && (parent.aromatic ? !allAromatic : !allSingle)) continue;
    const numberings: number[][] = [];
    for (const dir of [1, -1]) {
      for (let start = 0; start < size; start++) {
        const order = Array.from({ length: size }, (_, k) => ring[(start + dir * k + size * 2) % size]);
        const ok = order.every((a, k) => {
          const want = parent.pattern[k];
          const sym = SYMBOL[g.el[a]];
          // Fusion atoms sit exactly at the parent's fusion positions (4a/8a, 3a/7a), and are carbons.
          if ((want === "F") !== per.fusion.has(a)) return false;
          // A hydro parent: its saturated positions sp3 (not aromatic, single ring bonds only), every other aromatic.
          if (parent.hydro) {
            const sat = parent.hydro.includes(k);
            if (sat ? g.aromatic[a] || g.adj[a].some((e) => memberSet.has(e.to) && e.order !== 1) : !g.aromatic[a]) return false;
          }
          if (want === "F") return sym === "C";
          if (want === "H") return sym === "N" && (g.h[a] > 0 || g.adj[a].some((e) => !memberSet.has(e.to)));
          if (sym !== want) return false;
          // In an aromatic parent a plain N is pyridine-type: no hydrogen, nothing on it.
          if (parent.aromatic && want === "N") return g.h[a] === 0 && g.adj[a].every((e) => memberSet.has(e.to));
          return true;
        });
        if (ok) numberings.push(order);
      }
    }
    if (numberings.length) return { parent, numberings };
  }
  return null;
}

/** "pyridin", "1H-pyrrol", "furan": the parent's name without its final e (for -yl and vowel suffixes). */
const heteroStem = (name: string): string => name.replace(/e$/, "");

/** A heteroring as a SUBSTITUENT attached by one of its own atoms, unsubstituted: pyridin-2-yl, morpholin-4-yl. */
function heteroSubstituent(g: G, root: number, atoms: number[]): Sub | null {
  const m = matchHetero(g, atoms);
  if (!m) return null;
  const set = new Set(atoms);
  // Nothing else on the ring: the only bond leaving it is the attachment.
  const exits = atoms.flatMap((a) => g.adj[a].filter((e) => !set.has(e.to)).map(() => a));
  if (exits.length !== 1 || exits[0] !== root) return null;
  // The attachment takes the lowest locant the fixed numbering allows (indicated H first: 1H-pyrrol-1-yl).
  const locs = m.numberings.map((o) => locNum(m.parent, o, root)).filter((x): x is number => x !== null);
  if (!locs.length) return null; // attached at a fusion atom: not possible for these aromatic parents
  const loc = Math.min(...locs);
  const nm = `${heteroStem(m.parent.name)}-${loc}-yl`;
  return { name: nm, key: nm.replace(/^[0-9,H-]+-/, "").replace(/-\d+-yl$/, "yl") };
}

function nameHeteroRing(
  g: G,
  members: number[],
  m: { parent: HeteroParent; numberings: number[][] },
  nitroN: Set<number>,
  groups: Group[],
  principalKind: Group["kind"] | null,
  nPrefixes: { name: string; key: string }[],
): CoreResult {
  const memberSet = new Set(members);
  for (const gr of groups) {
    if (gr.kind !== principalKind && !PREFIX_FORM[gr.kind]) {
      return refuse(`${GROUP_WORD[gr.kind].replace(/^a/, "A")} group alongside a more senior group is outside the namer's subset.`);
    }
  }
  const byAtom = new Map<number, Group>();
  for (const gr of groups) {
    for (const s of gr.satellites) byAtom.set(s, gr);
    if (!memberSet.has(gr.carbon)) byAtom.set(gr.carbon, gr);
  }
  // Every atom bonded to the ring is a principal group, a junior group as a prefix, or a substituent — or refused.
  interface HSub { atom: number; name: string; key: string; suffix?: boolean }
  const subs: HSub[] = [];
  for (const a of members) {
    for (const e of g.adj[a]) {
      if (memberSet.has(e.to)) continue;
      const gr = byAtom.get(e.to);
      if (gr && (gr.carbon === a || gr.carbon === e.to)) {
        if (gr.carbon === e.to && !ringAttached(g, gr, memberSet)) return refuse("A substituent that carries its own group (hydroxymethyl, aminoethyl …) is outside the namer's subset.");
        // A group on the ring N of a hydro parent (a Boc-tetrahydroisoquinoline): its form (…-2(1H)-carboxylate with added
        // hydrogen, or …-2-carboxylate) is not confirmed — refused (stage 3e).
        if (gr.carbon === e.to && g.el[a] === 7 && m.parent.hydro) return refuse("A carboxy, ester or cyano group on the ring nitrogen of a partly saturated ring (a Boc-tetrahydroisoquinoline) is outside the namer's subset (its added-hydrogen form is not confirmed).");
        if (gr.kind === principalKind) subs.push({ atom: a, name: "", key: "", suffix: true });
        else subs.push({ atom: a, name: PREFIX_FORM[gr.kind]!, key: PREFIX_FORM[gr.kind]! });
        continue;
      }
      if (e.order !== 1) return refuse("An exocyclic double bond on the ring is outside the namer's subset.");
      const cls = classifySub(g, e.to, a, nitroN);
      if (typeof cls === "string") return refuse(cls);
      subs.push({ atom: a, ...cls });
    }
  }
  const suffixSubs = subs.filter((s) => s.suffix);
  const prefixSubs = subs.filter((s) => !s.suffix);
  if (principalKind && suffixSubs.length !== groups.filter((gr) => gr.kind === principalKind).length) {
    return refuse("The principal groups could not all be placed on the ring — outside the namer's subset.");
  }
  if (nPrefixes.length && suffixSubs.length > 1) return refuse("N-substituents with more than one principal group (N, N′) are outside the namer's subset.");
  if (nPrefixes.length && suffixSubs.length === 0) return refuse("A substituted nitrogen that is not the principal group here is outside the namer's subset.");

  // Among the numberings the parent allows: lowest locants to the principal groups, then to all prefixes, then to the
  // prefix cited first in alphabetical order (P-31.1.4).
  let best: { order: number[]; key: number[] } | null = null;
  for (const order of m.numberings) {
    const loc = (a: number): number => locNum(m.parent, order, a) ?? 999;
    const suf = suffixSubs.map((s) => loc(s.atom)).sort((x, y) => x - y);
    const pre = prefixSubs.map((s) => loc(s.atom)).sort((x, y) => x - y);
    const alpha = [...prefixSubs].sort((x, y) => x.key.localeCompare(y.key) || loc(x.atom) - loc(y.atom)).map((s) => loc(s.atom));
    const key = [...suf, 99, ...pre, 99, ...alpha];
    if (!best || lexLessArr(key, best.key)) best = { order, key };
  }
  if (!best) return refuse("Could not number the ring.");
  if (subs.some((x) => locNum(m.parent, best!.order, x.atom) === null)) return refuse("A substituent on a fusion atom is outside the namer's subset.");
  const loc = (a: number): number => locNum(m.parent, best!.order, a)!;
  const count = suffixSubs.length;
  const kind = count ? principalKind : null;
  const prefixes = prefixString([
    ...prefixSubs.map((s) => ({ loc: loc(s.atom) as number | string | null, name: s.name, key: s.key })),
    ...nPrefixes.map((p) => ({ loc: "N" as number | string | null, name: p.name, key: p.key })),
  ]);
  if (typeof prefixes !== "string") return refuse(prefixes.refusal);
  const parentName = m.parent.name;
  // A prefix string before a name that starts with a locant ("1H-…", "1,3-…") takes a hyphen: 2-methyl-1H-imidazole.
  const join = (p: string, rest: string): string => (p ? `${p}${/^[0-9]/.test(rest) ? "-" : ""}${rest}` : rest);
  const result = (name: string): CoreResult => ({ name, caveats: [], principalKind: kind ?? undefined, principalCount: count });
  if (!kind) return result(join(prefixes, parentName));
  if (count >= MULT.length) return refuse(`More than ${MULT.length - 1} identical principal groups is outside the namer's subset.`);
  const mult = count > 1 ? MULT[count] : "";
  const sufLocs = suffixSubs.map((s) => loc(s.atom)).sort((x, y) => x - y);
  const attached = RING_ATTACHED_SUFFIX[kind] && groups.some((gr) => gr.kind === kind && ringAttached(g, gr, memberSet));
  const suffixWord = attached ? RING_ATTACHED_SUFFIX[kind]! : SUFFIX[kind];
  // Heterocycles keep every locant (pyridin-2-amine): the position is never implied.
  const suffixPart = `-${sufLocs.join(",")}-${multiplied(mult, suffixWord)}`;
  const body = /^[-0-9,]*[aeiouy]/.test(suffixPart) && parentName.endsWith("e") ? `${heteroStem(parentName)}${suffixPart}` : `${parentName}${suffixPart}`;
  return result(join(prefixes, body));
}

const lexLessArr = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? Infinity, y = b[i] ?? Infinity;
    if (x !== y) return x < y;
  }
  return false;
};
