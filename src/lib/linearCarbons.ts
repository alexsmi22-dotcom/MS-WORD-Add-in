/**
 * Carbons a skeletal drawing must label because a bare vertex would vanish (IUPAC 2008 graphical representation,
 * GR-2.1: a carbon whose bonds meet at 180° is shown explicitly). Without it CO₂ drew as "O══O" and allene as one
 * long double bond.
 *
 * - A carbon with exactly two bonds of the SAME order whose directions are within LINEAR_TOLERANCE_DEG of opposite
 *   (O=C=O, S=C=S, the central allene carbon, a ketene): the two bonds draw as one line and the carbon disappears.
 *   Where the order changes at the carbon (C–C≡N, Ph–C≡C–Ph, CH₃–C≡CH) the end of the triple bond already marks the
 *   atom, as printed in the literature; those stay bare (a label there squeezed the triple bond to a stub).
 * - A two-atom triple bond with nothing else drawn (HC≡CH, HC≡N): its carbons labelled — a bare "≡N" reads as a
 *   fragment, not hydrogen cyanide.
 *
 * Pure on a minimal Molecule shape so both OCL packages (openchemlib, openchemlib/full) can use it.
 */
export interface LinearMol {
  getAllAtoms(): number;
  getAtomicNo(a: number): number;
  getAllConnAtomsPlusMetalBonds(a: number): number;
  getConnAtom(a: number, i: number): number;
  getConnBondOrder(a: number, i: number): number;
}

export const LINEAR_TOLERANCE_DEG = 5;

export function linearCarbons(mol: LinearMol, pos: (a: number) => readonly [number, number]): Set<number> {
  const n = mol.getAllAtoms();
  const out = new Set<number>();
  const cos = Math.cos(((180 - LINEAR_TOLERANCE_DEG) * Math.PI) / 180);
  for (let a = 0; a < n; a++) {
    if (mol.getAtomicNo(a) !== 6) continue;
    const deg = mol.getAllConnAtomsPlusMetalBonds(a);
    if (deg === 1 && mol.getConnBondOrder(a, 0) === 3) {
      const b = mol.getConnAtom(a, 0);
      if (mol.getAllConnAtomsPlusMetalBonds(b) === 1) out.add(a);
      continue;
    }
    if (deg !== 2 || mol.getConnBondOrder(a, 0) !== mol.getConnBondOrder(a, 1)) continue;
    const p = pos(a), q0 = pos(mol.getConnAtom(a, 0)), q1 = pos(mol.getConnAtom(a, 1));
    const ux = q0[0] - p[0], uy = q0[1] - p[1], vx = q1[0] - p[0], vy = q1[1] - p[1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (!(lu > 0) || !(lv > 0)) continue;
    if ((ux * vx + uy * vy) / (lu * lv) <= cos) out.add(a);
  }
  return out;
}
