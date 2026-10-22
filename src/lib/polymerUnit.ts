/**
 * The formula of a polymer's repeat unit, drawn as a structure in SRU brackets ("–[CH₂CH]ₙ–", the polymer-bound
 * metallocene template): every atom inside the brackets with its own hydrogens — a bond that crosses the brackets
 * holds a valence like any bond, so the backbone's CH₂ and CH take no hydrogen in its place. The end groups outside the
 * brackets are not part of the unit. One structure, one SRU bracket pair, every bond leaving it listed as crossing it;
 * anything else is refused by name (a bracket of another kind — a salt or a charge — has no repeat unit).
 */
import { Molecule } from "openchemlib";
import type { CdxDoc } from "./cdxml";
import { pageToMolecule } from "./cdxmlMol";
import { ELEMENT_SYMBOLS, symbolFor } from "./periodic";

export interface RepeatUnit {
  /** OpenChemLib's order: C, H, then by atomic number ("C13H14Cl2Zr"). */
  formula: string;
  /** Average weight per repeat unit, g/mol (OpenChemLib's atomic weights, as every other weight in the pane). */
  mw: number;
}

export function repeatUnitOf(doc: CdxDoc, objectIds?: ReadonlySet<string>): { ok: true; unit: RepeatUnit } | { ok: false; reason: string } {
  const inScope = (id: string): boolean => !objectIds || objectIds.has(id);
  const nodesOf = new Map<string, string[]>(); // structure → its node ids
  for (const o of doc.objects) {
    if (!inScope(o.id)) continue;
    for (const it of o.items) if (it.kind === "fragment") nodesOf.set(o.id, it.v.nodes.map((n) => n.id));
  }
  const allNodes = new Set([...nodesOf.values()].flat());
  const groups = doc.brackets.filter((g) => g.objectIds.some((id) => allNodes.has(id)));
  if (groups.length !== 1) return { ok: false, reason: "a polymer's formula is given for one repeat unit — draw one pair of brackets" };
  const g = groups[0];
  if (g.usage !== "SRU") return { ok: false, reason: "brackets that are not a polymer's repeat unit (a salt or a charge bracket) have no formula here" };
  if (nodesOf.size !== 1) return { ok: false, reason: "a polymer's repeat unit is read from one structure — select it (Select tool)" };
  const r = pageToMolecule(doc, objectIds);
  if (!r.ok) return r;
  const { mol, atomIds } = r.value;
  // Atoms with no page id: an expanded abbreviation (refused), or the hydride ions an η-bound metal's drawn H became —
  // those belong to their metal, inside the unit (review round 2: refused as "an abbreviation").
  const hydride = (a: number): boolean => atomIds[a] === "" && mol.getAtomicNo(a) === 1 && mol.getAtomCharge(a) === -1;
  if (atomIds.some((id, a) => id === "" && !hydride(a))) return { ok: false, reason: "an abbreviation inside a polymer's repeat unit is not counted here — expand it first" };
  const inside = new Set(g.objectIds);
  const isInside = (a: number): boolean => inside.has(atomIds[a]) || hydride(a);
  const crossing = new Set(g.attachments.map((a) => a.bondId));
  // Every bond from inside to outside must be one the brackets list as crossing them (else the unit is not closed).
  mol.ensureHelperArrays(Molecule.cHelperNeighbours);
  let crossed = 0;
  for (let b = 0; b < mol.getAllBonds(); b++) {
    const i0 = isInside(mol.getBondAtom(0, b)), i1 = isInside(mol.getBondAtom(1, b));
    if (i0 !== i1) crossed++;
  }
  if (crossed !== crossing.size || crossed === 0) {
    return { ok: false, reason: `the brackets cross ${crossed} bond${crossed === 1 ? "" : "s"} of the structure but name ${crossing.size} — draw them across the bonds that join the repeat units` };
  }
  const counts: Record<string, number> = {};
  for (let a = 0; a < mol.getAllAtoms(); a++) {
    if (!isInside(a)) continue;
    if (mol.getAtomMass(a)) return { ok: false, reason: "an isotope-labelled atom in a repeat unit is not counted here" };
    const sym = symbolFor(mol.getAtomicNo(a));
    if (!sym) return { ok: false, reason: "an atom in the repeat unit is not an element" };
    const h = mol.getImplicitHydrogens(a);
    counts[sym] = (counts[sym] ?? 0) + 1;
    if (h) counts.H = (counts.H ?? 0) + h;
  }
  // OpenChemLib's order, as the formula of any other structure on the pane: C, H, then by atomic number.
  const z = (e: string): number => ELEMENT_SYMBOLS.indexOf(e) + 1;
  const order = Object.keys(counts).sort((p, q) => (p === "C" ? -1 : q === "C" ? 1 : p === "H" ? -1 : q === "H" ? 1 : z(p) - z(q)));
  const formula = order.map((e) => e + (counts[e] > 1 ? counts[e] : "")).join("");
  // The weight: the unit alone (the atoms outside deleted), less the hydrogen each cut crossing bond gave its inner atom.
  const unit = mol.getCompactCopy();
  for (let a = unit.getAllAtoms() - 1; a >= 0; a--) if (!isInside(a)) unit.deleteAtom(a);
  const hWeight = Molecule.fromSmiles("[H][H]").getMolecularFormula().relativeWeight / 2;
  const mw = unit.getMolecularFormula().relativeWeight - crossed * hWeight;
  return { ok: true, unit: { formula, mw: Math.round(mw * 100) / 100 } };
}
