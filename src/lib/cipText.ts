/**
 * CIP descriptors as text for the readouts (docs/SCOPE-CIP.md): a stereo prefix for a systematic name when every
 * stereo element is given and has a locant — "(2R)-butan-2-ol", "rac-(2R,3S)-…", "(2E)-but-2-ene" — and otherwise a
 * plain-words line: what is given, and what is not and why. Never a partial prefix: a name that names some centres
 * and silently leaves others out would read as fully specified.
 */
import { Molecule } from "openchemlib/full";
import { cipDescriptors, type CipCentre, type CipLabel } from "./cip";
import { symbolFor } from "./periodic";

export interface StereoText {
  /** "(2R,3S)-" or "rac-(2R)-" when the name can carry the descriptors; null otherwise. */
  prefix: string | null;
  /** The readout line ("Stereo (CIP): 2R, 3S — …"), or null when the structure has no stereo element. */
  line: string | null;
}

export interface StereoTextOptions {
  /** The namer's chain may be numbered from either end with the same name (IUPAC P-31.1.4.3.4 then decides). */
  reversible?: boolean;
  /** The structure came from text (SMILES, a name, an idcode): passed to the engine (cip.ts CipOptions.fromText), and
   *  lone-pair centres get a caveat (toolkits read them differently in SMILES). */
  fromText?: boolean;
}

/** A stereocentre described by what it carries, for a structure with no locants: "C(O)", "C(N, O)". */
function describe(mol: Molecule, atom: number): string {
  const hetero: string[] = [];
  for (let i = 0; i < mol.getAllConnAtoms(atom); i++) {
    const z = mol.getAtomicNo(mol.getConnAtom(atom, i));
    if (z !== 6 && z !== 1) hetero.push(symbolFor(z) ?? "?");
  }
  const sym = symbolFor(mol.getAtomicNo(atom)) ?? "?";
  return hetero.length ? `${sym}(${hetero.sort().join(", ")})` : sym;
}

/** P-31.1.4.3.4's preference where numbering is free: Z before E, R before S. */
const PREFERENCE: Record<CipLabel, number> = { Z: 0, E: 1, R: 0, S: 1 };
const INVERT: Record<CipLabel, CipLabel> = { R: "S", S: "R", E: "E", Z: "Z" };

/**
 * The structure's stereo as text. `locants` (caller atom index → locant) come from the systematic name's parent chain;
 * with them, and every element given, the prefix is built.
 */
export function stereoText(mol: Molecule, locants?: Map<number, number>, opts: StereoTextOptions = {}): StereoText {
  const { centres } = cipDescriptors(mol, undefined, { fromText: opts.fromText });
  if (!centres.length) return { prefix: null, line: null };
  mol.ensureHelperArrays(Molecule.cHelperParities);
  const given = centres.filter((c) => c.label);
  const refused = centres.filter((c) => !c.label);

  // A symmetric chain: of the two numberings, the one giving the preferred descriptor the lower locant (tartaric acid
  // is (2R,3S), not (2S,3R); hexa-2,4-diene (2Z,4E)) — review: the namer's arbitrary direction was used.
  let loc = locants;
  let numberingUnsettled = false;
  if (locants && opts.reversible && given.length) {
    const len = Math.max(...locants.values());
    const flipped = new Map([...locants].map(([a, l]) => [a, len + 1 - l] as [number, number]));
    const seq = (m: Map<number, number>): Array<[number, CipLabel]> =>
      given.map((c) => [c.kind === "atom" ? m.get(c.atom) ?? 0 : Math.min(m.get(c.atom) ?? 0, m.get(c.atom2!) ?? 0), c.label!] as [number, CipLabel]).sort((p, q) => p[0] - q[0]);
    const a = seq(locants), b = seq(flipped);
    // When the two numberings differ in both an E/Z and an R/S position, the order in which P-31.1.4.3.4 weighs them
    // is not settled here: no prefix rather than a possibly non-preferred one (review round 2).
    const diff = a.map((x, i) => (x[1] !== b[i][1] ? x[1] : null)).filter((x): x is CipLabel => !!x);
    numberingUnsettled = diff.some((l) => l === "E" || l === "Z") && diff.some((l) => l === "R" || l === "S");
    for (let i = 0; i < a.length && !numberingUnsettled; i++) {
      if (a[i][1] === b[i][1]) continue;
      if (PREFERENCE[b[i][1]] < PREFERENCE[a[i][1]]) loc = flipped;
      break;
    }
  }
  const where = (c: CipCentre): number | null => {
    if (!loc) return null;
    const l1 = loc.get(c.atom);
    if (c.kind === "atom") return l1 ?? null;
    const l2 = loc.get(c.atom2!);
    return l1 !== undefined && l2 !== undefined ? Math.min(l1, l2) : null;
  };

  // Stereo groups (ChemDraw's AND / OR, OCL's ESR): one group of one kind over every given centre → rac- / rel-, the
  // descriptors written with R at the lowest locant (rac-(2R,3S), the convention). Centres in different groups, or
  // groups beside absolute centres, have no drawn relative configuration: no prefix, and the line says so (review:
  // separate AND groups read rac-(2R,3R), asserting a relation never drawn).
  const atomGiven = given.filter((c) => c.kind === "atom");
  const groups = atomGiven.map((c) => ({ type: mol.getAtomESRType(c.atom), group: mol.getAtomESRGroup(c.atom) }));
  const allAbs = groups.every((g) => g.type === Molecule.cESRTypeAbs);
  const oneGroup = groups.length > 0 && groups.every((g) => g.type !== Molecule.cESRTypeAbs && g.type === groups[0].type && g.group === groups[0].group);
  const kind = oneGroup ? (groups[0].type === Molecule.cESRTypeAnd ? "rac-" : "rel-") : "";
  const splitGroups = !allAbs && !oneGroup;
  const sorted = [...given].sort((p, q) => (where(p) ?? 1e9) - (where(q) ?? 1e9) || p.atom - q.atom);
  // rac / rel: R at the lowest-numbered centre.
  const firstRS = sorted.find((c) => c.label === "R" || c.label === "S");
  const invert = !!kind && firstRS?.label === "S";
  const shown = (c: CipCentre): CipLabel => (invert ? INVERT[c.label!] : c.label!);

  let prefix: string | null = null;
  if (!refused.length && !splitGroups && !numberingUnsettled && given.every((c) => where(c) !== null)) {
    prefix = `${kind}(${sorted.map((c) => `${where(c)}${shown(c)}`).join(",")})-`;
  }

  const name = (c: CipCentre): string => {
    const l = where(c);
    if (l !== null) return c.kind === "atom" ? `${symbolFor(mol.getAtomicNo(c.atom)) ?? "C"}-${l}` : `the double bond at C-${l}`;
    return c.kind === "atom" ? describe(mol, c.atom) : `${describe(mol, c.atom)}=${describe(mol, c.atom2!)}`;
  };
  const groupTag = (c: CipCentre): string => {
    if (!splitGroups || c.kind !== "atom") return "";
    const t = mol.getAtomESRType(c.atom);
    return t === Molecule.cESRTypeAbs ? " (abs)" : ` (${t === Molecule.cESRTypeAnd ? "&" : "or"}${mol.getAtomESRGroup(c.atom) + 1})`;
  };
  const bits: string[] = [];
  if (given.length) bits.push(`${kind}${sorted.map((c) => (where(c) !== null ? `${where(c)}${shown(c)}` : `${shown(c)} at ${name(c)}`) + groupTag(c)).join(", ")}`);
  const nC = centres.filter((c) => c.kind === "atom").length, nB = centres.length - nC;
  const count = [nC ? `${nC} stereocentre${nC > 1 ? "s" : ""}` : "", nB ? `${nB} stereo double bond${nB > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ");
  // What is given, how many elements there are, then each one not given and why (where it is, when there is more than
  // one to tell apart).
  let line = `Stereo (CIP): ${bits.length ? `${bits.join("; ")} — ` : ""}${count}`;
  if (kind === "rac-") line += "; rac-: the structure is marked racemic (an AND stereo group — a molfile without the chiral flag reads this way)";
  if (kind === "rel-") line += "; rel-: relative configuration only (an OR stereo group)";
  if (numberingUnsettled) line += "; the chain can be numbered from either end and the choice between its E/Z and R/S descriptors is not settled here — no prefix";
  if (splitGroups) line += "; the centres are in different stereo groups — their relative configuration is not drawn, so no single name";
  for (const c of refused) line += centres.length > 1 ? `; not given at ${name(c)}: ${c.reason}` : `; not given: ${c.reason}`;
  if (opts.fromText && given.some((c) => c.lonePair)) line += "; a lone-pair centre (S, P, N) read from text — toolkits differ on where its lone pair sits in SMILES: confirm against the drawing";
  return { prefix, line };
}
