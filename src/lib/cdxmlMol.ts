/**
 * The page ↔ OpenChemLib Molecule (docs/SCOPE-CHEM-CANVAS.md, stage 1). The canvas keeps a CDXML page
 * (structures, brackets, arrows, text, as ChemDraw draws them); everything chemical the pane reports —
 * formula, SMILES, idcode, Markush, Clean, 3D — is computed by OCL from the Molecule these give. So the
 * mapping is exact or refused by name, never approximate:
 *
 *   elements, charges, isotopes, radicals, explicit H, bond orders (aromatic = delocalized), wedges
 *   (ChemDraw's narrow end at B for …Begin, at E for …End ↔ OCL up/down from bond atom 0), generic
 *   atoms R1–R16 (OCL atomic numbers 142, 143, 144 for R1–R3 and 129–141 for R4–R16), abbreviations
 *   expanded from the fragment ChemDraw keeps inside them (Ph, OMe, Boc …).
 *
 * A labelled atom keeps the hydrogens it is drawn with (its valence set to match when OCL's usual one
 * differs); one no valence can give is refused: the formula would not be the one drawn.
 */
import { Molecule } from "openchemlib/full";
import type { CdxDoc } from "./cdxml";
import type { XNode } from "./xmlLite";
import { findById, nextIdFrom, setAtomLabel } from "./cdxmlEdit";
import { symbolFor } from "./periodic";
import { groupSmiles } from "./labelExpand";

const elementSymbol = (z: number): string => symbolFor(z) ?? `element ${z}`;

type P2 = [number, number];

/** A double bond of unknown (either) geometry: JurisLab's own bond attribute (ChemDraw ignores it). */
export const EITHER = "JurisLabEitherGeometry";

/** R1–R16 ↔ OCL's R-group atomic numbers (the editor's: 142 = R1, 143 = R2, 144 = R3, 129 = R4 …). */
const R_TO_Z = (n: number): number => (n <= 3 ? 141 + n : 125 + n);
const Z_TO_R = (z: number): number | null => (z >= 142 && z <= 144 ? z - 141 : z >= 129 && z <= 141 ? z - 125 : null);

const RADICAL_TO_OCL: Record<string, number> = { Singlet: Molecule.cAtomRadicalStateS, Doublet: Molecule.cAtomRadicalStateD, Triplet: Molecule.cAtomRadicalStateT };
const OCL_TO_RADICAL = new Map(Object.entries(RADICAL_TO_OCL).map(([k, v]) => [v, k]));

const posOf = (n: XNode): P2 => (n.attrs.p ?? "0 0").trim().split(/\s+/).map(Number) as P2;
const labelWords = (n: XNode): string => n.children.find((c) => c.name === "t")?.children.filter((c) => c.name === "s").map((c) => c.text).join("").replace(/\s+/g, "") ?? "";

export interface PageMolecule {
  mol: Molecule;
  /** Which page atom (node id) each Molecule atom came from ("" for atoms of an expanded abbreviation). */
  atomIds: string[];
}

/**
 * The structures of the page (or of the given top-level objects) as one OCL Molecule, coordinates in
 * bond lengths (y down, as on the page). Refused by name when something drawn has no exact Molecule form.
 */
export function pageToMolecule(doc: CdxDoc, objectIds?: ReadonlySet<string>): { ok: true; value: PageMolecule } | { ok: false; reason: string } {
  const mol = new Molecule(32, 32);
  const atomIds: string[] = [];
  const L = doc.style.bondLength || 30;
  const index = new Map<string, number>();
  const frags: XNode[] = [];
  for (const o of doc.objects) {
    if (objectIds && !objectIds.has(o.id)) continue;
    for (const it of o.items) if (it.kind === "fragment") frags.push(it.v.el);
  }
  for (const f of frags) {
    // Atoms first.
    const expanded = new Map<string, { inner: Map<string, number>; attach: string[] }>();
    for (const n of f.children) {
      if (n.name !== "n" || !n.attrs.id) continue;
      const type = n.attrs.NodeType ?? "Element";
      const [x, y] = posOf(n);
      if (type === "Element") {
        const z = Number(n.attrs.Element ?? 6);
        if (!Number.isInteger(z) || z < 1 || z > 118) return { ok: false, reason: `an atom has element number ${n.attrs.Element}, which is not an element` };
        const a = mol.addAtom(z);
        mol.setAtomX(a, x / L);
        mol.setAtomY(a, y / L);
        const q = Number(n.attrs.Charge ?? 0);
        if (q) mol.setAtomCharge(a, q);
        const iso = Number(n.attrs.Isotope ?? 0);
        if (iso) mol.setAtomMass(a, iso);
        if (n.attrs.Radical) {
          const r = RADICAL_TO_OCL[n.attrs.Radical];
          if (r === undefined) return { ok: false, reason: `a ${n.attrs.Radical} radical has no exact form in a structure` };
          mol.setAtomRadical(a, r);
        }
        index.set(n.attrs.id, a);
        atomIds.push(n.attrs.id);
        continue;
      }
      if (type === "GenericNickname") {
        const nick = n.attrs.GenericNickname ?? labelWords(n);
        const m = /^R(\d{0,2})$/.exec(nick);
        const k = m ? (m[1] ? Number(m[1]) : 1) : 0;
        if (!(k >= 1 && k <= 16)) return { ok: false, reason: `the generic atom ${nick || "(unnamed)"} has no exact form in a structure (R1 to R16 do)` };
        const a = mol.addAtom(R_TO_Z(k));
        mol.setAtomX(a, x / L);
        mol.setAtomY(a, y / L);
        index.set(n.attrs.id, a);
        atomIds.push(n.attrs.id);
        continue;
      }
      if ((type === "Unspecified" || type === "Nickname" || type === "Fragment") && !n.children.some((c) => c.name === "fragment")) {
        // A label standing for a group (OMe, CO₂H, Ph …): its structure from the table, one bond to the rest.
        const words = labelWords(n);
        const smi = groupSmiles(words);
        if (!smi) return { ok: false, reason: `${words || "a label"} is ${type === "Unspecified" ? "text" : "an abbreviation"} this does not know as a group — its structure is not in the file` };
        const degree = f.children.filter((b) => b.name === "b" && (b.attrs.B === n.attrs.id || b.attrs.E === n.attrs.id)).length;
        if (degree > 1) return { ok: false, reason: `${words} stands for a group with one bond, but it is drawn with ${degree}` };
        let g: Molecule;
        try {
          g = Molecule.fromSmiles(smi);
        } catch {
          return { ok: false, reason: `${words}: its group could not be built` };
        }
        g.inventCoordinates();
        const map = mol.addMolecule(g);
        // OCL reads a bracket atom's open bond (the [Si] of TMS, the [N+] of NO₂) as a radical; bonded here, it is not one.
        mol.setAtomRadical(map[0], 0);
        // Laid out beyond the label, away from the atom it is bonded to.
        const nbB = f.children.find((b) => b.name === "b" && (b.attrs.B === n.attrs.id || b.attrs.E === n.attrs.id));
        const other = nbB ? f.children.find((c) => c.name === "n" && c.attrs.id === (nbB.attrs.B === n.attrs.id ? nbB.attrs.E : nbB.attrs.B)) : undefined;
        const out = other ? Math.atan2(y - posOf(other)[1], x - posOf(other)[0]) : 0;
        const gl = g.getAllAtoms() > 1 ? g.getAverageBondLength(true) || 1 : 1;
        let cx = 0, cy = 0;
        for (let k = 0; k < g.getAllAtoms(); k++) (cx += g.getAtomX(k) - g.getAtomX(0)), (cy += g.getAtomY(k) - g.getAtomY(0));
        const turn = out - (cx || cy ? Math.atan2(cy, cx) : 0);
        for (let k = 0; k < g.getAllAtoms(); k++) {
          const dx = (g.getAtomX(k) - g.getAtomX(0)) / gl, dy = (g.getAtomY(k) - g.getAtomY(0)) / gl;
          mol.setAtomX(map[k], x / L + dx * Math.cos(turn) - dy * Math.sin(turn));
          mol.setAtomY(map[k], y / L + dx * Math.sin(turn) + dy * Math.cos(turn));
        }
        index.set(n.attrs.id, map[0]);
        atomIds.push(n.attrs.id, ...new Array(g.getAllAtoms() - 1).fill(""));
        continue;
      }
      if (type === "Nickname" || type === "Fragment") {
        // ChemDraw keeps the abbreviation's own structure inside it, with an external connection point
        // standing for each bond to the rest.
        const inner = n.children.find((c) => c.name === "fragment")!;
        const words = labelWords(n) || "an abbreviation";
        const map = new Map<string, number>();
        const attach: string[] = [];
        const innerPos = new Map<number, P2>();
        for (const c of inner.children) {
          if (c.name !== "n" || !c.attrs.id) continue;
          if (c.attrs.NodeType === "ExternalConnectionPoint") {
            attach.push(c.attrs.id);
            continue;
          }
          if (c.attrs.NodeType && c.attrs.NodeType !== "Element") return { ok: false, reason: `${words} holds an atom this cannot read (${c.attrs.NodeType})` };
          const a = mol.addAtom(Number(c.attrs.Element ?? 6));
          innerPos.set(a, posOf(c));
          const q = Number(c.attrs.Charge ?? 0);
          if (q) mol.setAtomCharge(a, q);
          const iso = Number(c.attrs.Isotope ?? 0);
          if (iso) mol.setAtomMass(a, iso);
          map.set(c.attrs.id, a);
          atomIds.push("");
        }
        for (const b of inner.children) {
          if (b.name !== "b") continue;
          const ia = map.get(b.attrs.B), ib = map.get(b.attrs.E);
          if (ia === undefined || ib === undefined) continue; // a bond to the connection point
          const why = addBondOf(mol, ia, ib, b);
          if (why) return { ok: false, reason: `${words}: ${why}` };
        }
        // Each connection point: the inner atom bonded to it.
        const inAt = attach.map((cp) => {
          const b = inner.children.find((q) => q.name === "b" && (q.attrs.B === cp || q.attrs.E === cp));
          return b ? map.get(b.attrs.B === cp ? b.attrs.E : b.attrs.B) : undefined;
        });
        if (!attach.length || inAt.some((v) => v === undefined)) return { ok: false, reason: `${words} does not say where it is bonded` };
        // Its atoms are laid out in their own frame: moved so the atom that bonds sits where the label is.
        const at = innerPos.get(inAt[0]!)!;
        for (const [a, [ix, iy]] of innerPos) {
          mol.setAtomX(a, (ix - at[0] + x) / L);
          mol.setAtomY(a, (iy - at[1] + y) / L);
        }
        expanded.set(n.attrs.id, { inner: map, attach: inAt.map(String) });
        continue;
      }
      return { ok: false, reason: `an atom drawn as ${type} has no exact form in a structure` };
    }
    // Bonds: to an abbreviation, the bond goes to its connection atom (in order, for several bonds).
    const used = new Map<string, number>();
    const atomFor = (id: string): number | undefined => {
      if (index.has(id)) return index.get(id);
      const e = expanded.get(id);
      if (!e) return undefined;
      const k = used.get(id) ?? 0;
      used.set(id, k + 1);
      const v = e.attach[Math.min(k, e.attach.length - 1)];
      return v === undefined ? undefined : Number(v);
    };
    for (const b of f.children) {
      if (b.name !== "b") continue;
      const ia = atomFor(b.attrs.B), ib = atomFor(b.attrs.E);
      if (ia === undefined || ib === undefined) return { ok: false, reason: "a bond joins an atom that is not in the structure" };
      const why = addBondOf(mol, ia, ib, b);
      if (why) return { ok: false, reason: why };
    }
  }
  // Drawn hydrogens are the ones the structure has: where OCL's usual valence gives another count
  // (a hypervalent S or P drawn with its H), the atom takes the valence drawn — the formula is the one
  // drawn, and the pane's valence note still says when that valence is unusual.
  mol.ensureHelperArrays(Molecule.cHelperNeighbours);
  for (const f of frags)
    for (const n of f.children) {
      if (n.name !== "n" || !n.attrs.id || n.attrs.NumHydrogens === undefined) continue;
      const a = index.get(n.attrs.id);
      if (a === undefined || (n.attrs.NodeType && n.attrs.NodeType !== "Element")) continue;
      const drawn = Number(n.attrs.NumHydrogens);
      if (!Number.isInteger(drawn) || drawn < 0 || drawn === mol.getImplicitHydrogens(a)) continue;
      let bonds = 0;
      for (let k = 0; k < mol.getConnAtoms(a); k++) bonds += mol.getConnBondOrder(a, k);
      mol.setAtomAbnormalValence(a, bonds + drawn);
      mol.ensureHelperArrays(Molecule.cHelperNeighbours);
      const has = mol.getImplicitHydrogens(a);
      if (has !== drawn) {
        const sym = elementSymbol(Number(n.attrs.Element ?? 6));
        return { ok: false, reason: `${labelWords(n) || sym} is drawn with ${drawn} H, which no valence of ${sym} with its bonds and charge gives — the formula would not be the one drawn` };
      }
    }
  return { ok: true, value: { mol, atomIds } };
}

/** One page bond into the Molecule; a refusal (string) for an order or style with no exact form. */
function addBondOf(mol: Molecule, ia: number, ib: number, b: XNode): string | null {
  const order = (b.attrs.Order ?? "1").split(/\s+/)[0];
  const display = b.attrs.Display ?? "Solid";
  const wedge = /^Wedge(Begin|End)$/.exec(display), hash = /^WedgedHash(Begin|End)$/.exec(display);
  // The narrow end is bond atom 0 in OCL.
  const [a0, a1] = (wedge?.[1] ?? hash?.[1]) === "End" ? [ib, ia] : [ia, ib];
  const bond = mol.addBond(a0, a1);
  if (order === "1") {
    if (wedge || hash) {
      mol.setBondType(bond, wedge ? Molecule.cBondTypeUp : Molecule.cBondTypeDown);
      return null;
    }
    mol.setBondType(bond, Molecule.cBondTypeSingle);
    return null;
  }
  if (wedge || hash) return "a wedge on a double or triple bond has no meaning";
  if (order === "2") return mol.setBondType(bond, b.attrs[EITHER] === "yes" ? Molecule.cBondTypeCross : Molecule.cBondTypeDouble), null;
  if (order === "3") return mol.setBondType(bond, Molecule.cBondTypeTriple), null;
  if (order === "1.5") return mol.setBondType(bond, Molecule.cBondTypeDelocalized), null;
  return `a bond of order "${order}" has no exact form in a structure`;
}

/**
 * The Molecule as a new structure on the page (a fragment appended to the page), bond length `L` points,
 * placed with its top-left at `origin`. Refused by name for what a page cannot draw exactly (query
 * features, atom lists, custom atom labels).
 */
export function moleculeToPage(doc: CdxDoc, mol: Molecule, origin: P2 = [60, 60]): { ok: true; fragmentId: string } | { ok: false; reason: string } {
  const page = doc.root.children.find((c) => c.name === "page");
  if (!page) return { ok: false, reason: "the document has no page" };
  mol.ensureHelperArrays(Molecule.cHelperNeighbours);
  const n = mol.getAllAtoms(), nb = mol.getAllBonds();
  for (let a = 0; a < n; a++) {
    if (mol.getAtomList(a)) return { ok: false, reason: "an atom stands for a list of elements, which this page cannot draw yet" };
    if (mol.getAtomCustomLabel(a)) return { ok: false, reason: `an atom carries the text label "${mol.getAtomCustomLabel(a)}", which this page cannot draw as chemistry` };
  }
  const L = doc.style.bondLength || 30;
  const avg = n > 1 ? mol.getAverageBondLength(true) || 1 : 1;
  const k = L / avg;
  let minX = Infinity, minY = Infinity;
  for (let a = 0; a < n; a++) (minX = Math.min(minX, mol.getAtomX(a))), (minY = Math.min(minY, mol.getAtomY(a)));
  const id = nextIdFrom(doc.root);
  const fmt = (v: number): string => String(Math.round(v * 100) / 100);
  const frag: XNode = { name: "fragment", attrs: { id: id() }, children: [], text: "", line: 0 };
  const nodeIds: string[] = [];
  for (let a = 0; a < n; a++) {
    const z = mol.getAtomicNo(a);
    const nid = id();
    nodeIds.push(nid);
    const attrs: Record<string, string> = { id: nid, p: `${fmt(origin[0] + (mol.getAtomX(a) - minX) * k)} ${fmt(origin[1] + (mol.getAtomY(a) - minY) * k)}` };
    const q = mol.getAtomCharge(a);
    if (q) attrs.Charge = String(q);
    const r = mol.getAtomRadical(a);
    if (r) {
      const name = OCL_TO_RADICAL.get(r);
      if (!name) return { ok: false, reason: "an atom's radical state has no CDXML form" };
      attrs.Radical = name;
    }
    if (Z_TO_R(z) === null && z !== 6) {
      if (z < 1 || z > 118) return { ok: false, reason: `an atom (number ${z}) is not an element or R1–R16` };
      attrs.Element = String(z);
    }
    frag.children.push({ name: "n", attrs, children: [], text: "", line: 0 });
  }
  for (let b = 0; b < nb; b++) {
    const a0 = mol.getBondAtom(0, b), a1 = mol.getBondAtom(1, b);
    const type = mol.getBondType(b);
    const attrs: Record<string, string> = { id: id(), B: nodeIds[a0], E: nodeIds[a1] };
    if (type === Molecule.cBondTypeCross) {
      // ChemDraw has no mark for a double bond of unknown geometry (it reads the drawn geometry as the
      // stereo); OCL does. The page keeps it in its own attribute, drawn crossed.
      attrs.Order = "2";
      attrs[EITHER] = "yes";
    } else if (type === Molecule.cBondTypeUp) attrs.Display = "WedgeBegin";
    else if (type === Molecule.cBondTypeDown) attrs.Display = "WedgedHashBegin";
    else if ((type & Molecule.cBondTypeMaskSimple) === Molecule.cBondTypeDelocalized) attrs.Order = "1.5";
    else {
      const o = mol.getBondOrder(b);
      if (o === 0) return { ok: false, reason: "a metal–ligand bond has no exact CDXML form here yet" };
      if (o > 3) return { ok: false, reason: `a bond of order ${o} has no CDXML form` };
      if (o !== 1) attrs.Order = String(o);
    }
    frag.children.push({ name: "b", attrs, children: [], text: "", line: 0 });
  }
  page.children.push(frag);
  // Labels as ChemDraw draws them: heteroatoms and charged / isotopic carbons with their hydrogens; R groups.
  for (let a = 0; a < n; a++) {
    const z = mol.getAtomicNo(a);
    const rk = Z_TO_R(z);
    const node = findById(doc.root, nodeIds[a])!.el;
    if (rk !== null) {
      const r = setAtomLabel(doc, nodeIds[a], `R${rk}`);
      if (!r.ok) return { ok: false, reason: r.reason };
      continue;
    }
    const mass = mol.getAtomMass(a);
    const unusual = mol.getAtomAbnormalValence(a) !== -1;
    if (z === 6 && !mass && !node.attrs.Radical && !unusual) continue;
    const r = setAtomLabel(doc, nodeIds[a], elementSymbol(z));
    if (!r.ok) return { ok: false, reason: r.reason };
    const fresh = findById(doc.root, nodeIds[a])!.el;
    // The hydrogens are the Molecule's own (an atom of unusual valence keeps its count), in the label too.
    const h = mol.getImplicitHydrogens(a);
    if (fresh.attrs.NumHydrogens !== String(h)) {
      fresh.attrs.NumHydrogens = String(h);
      const t = fresh.children.find((c) => c.name === "t");
      const runs = t?.children.filter((c) => c.name === "s") ?? [];
      if (t && runs.length) {
        runs[0].text = elementSymbol(z) + (h ? "H" + (h > 1 ? h : "") : "");
        t.children = t.children.filter((c) => c.name !== "s" || c === runs[0]);
      }
    }
    if (mass) {
      fresh.attrs.Isotope = String(mass);
      const t = fresh.children.find((c) => c.name === "t");
      const s0 = t?.children.find((c) => c.name === "s");
      if (t && s0) t.children.unshift({ name: "s", attrs: { ...s0.attrs, face: String(0x20) }, children: [], text: String(mass), line: 0 });
    }
  }
  return { ok: true, fragmentId: frag.attrs.id };
}
