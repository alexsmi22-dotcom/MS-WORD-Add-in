// 3D model engine (src/lib/mol3d.ts): real geometry oracles (bond lengths and
// angles against published values), determinism from the idcode, named
// refusals, projection invariants, and the one-draw-list contract.

import { Molecule } from "openchemlib/full";
import {
  generate3d, isMol3dError, Mol3dModel, MOL3D_MAX_HEAVY,
  defaultMol3dView, rotateView, projectScene, opsToSvg,
  elementColor, elementVdw, formulaSubscripts, chargeSuperscript,
} from "../mol3d";

const idOf = (smiles: string): string => {
  const m = Molecule.fromSmiles(smiles);
  return m.getIDCode();
};

const model = (smiles: string): Mol3dModel => {
  const r = generate3d(idOf(smiles));
  if (isMol3dError(r)) throw new Error(r.error);
  return r;
};

const dist = (m: Mol3dModel, i: number, j: number): number =>
  Math.hypot(m.atoms[i].x - m.atoms[j].x, m.atoms[i].y - m.atoms[j].y, m.atoms[i].z - m.atoms[j].z);

describe("geometry against published values", () => {
  test("methane: C–H ≈ 1.09 Å, H–C–H = 109.5° (MMFF94s-minimised)", () => {
    const m = model("C");
    expect(m.atoms).toHaveLength(5);
    const hs = m.atoms.map((a, i) => ({ a, i })).filter((x) => x.a.isH).map((x) => x.i);
    expect(hs).toHaveLength(4);
    for (const h of hs) expect(dist(m, 0, h)).toBeCloseTo(1.09, 1);
    const v = (h: number): number[] => [
      m.atoms[h].x - m.atoms[0].x, m.atoms[h].y - m.atoms[0].y, m.atoms[h].z - m.atoms[0].z,
    ];
    const [v1, v2] = [v(hs[0]), v(hs[1])];
    const ang = Math.acos(
      (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) /
      (Math.hypot(...v1) * Math.hypot(...v2)),
    ) * 180 / Math.PI;
    expect(ang).toBeGreaterThan(108);
    expect(ang).toBeLessThan(111);
  });

  test("benzene: planar ring, C–C ≈ 1.39 Å", () => {
    const m = model("c1ccccc1");
    const ring = m.atoms.map((a, i) => ({ a, i })).filter((x) => !x.a.isH).map((x) => x.i);
    expect(ring).toHaveLength(6);
    // Ring bond lengths from the bond list restricted to ring atoms.
    const ringSet = new Set(ring);
    const ringBonds = m.bonds.filter((b) => ringSet.has(b.a) && ringSet.has(b.b));
    expect(ringBonds.length).toBe(6);
    for (const b of ringBonds) expect(dist(m, b.a, b.b)).toBeCloseTo(1.39, 1);
    // Planarity: every ring atom within 0.05 Å of the plane of the first three.
    const p = (i: number): number[] => [m.atoms[i].x, m.atoms[i].y, m.atoms[i].z];
    const [p0, p1, p2] = [p(ring[0]), p(ring[1]), p(ring[2])];
    const u = p1.map((v, k) => v - p0[k]);
    const v2 = p2.map((v, k) => v - p0[k]);
    const nrm = [
      u[1] * v2[2] - u[2] * v2[1],
      u[2] * v2[0] - u[0] * v2[2],
      u[0] * v2[1] - u[1] * v2[0],
    ];
    const nn = Math.hypot(...nrm);
    for (const i of ring) {
      const d = p(i).map((v, k) => v - p0[k]);
      const off = Math.abs(d[0] * nrm[0] + d[1] * nrm[1] + d[2] * nrm[2]) / nn;
      expect(off).toBeLessThan(0.05);
    }
  });

  test("the model is 3D, not a flat layout (ethanol has z-spread)", () => {
    const m = model("CCO");
    const zs = m.atoms.map((a) => a.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.5);
  });

  test("ADV: a drawn CIS alkene is never shown TRANS (the seed-42 flip)", () => {
    // OCL's generator builds Z-2-butene trans at seed 42 — the adversarial
    // pass caught it. The engine must either deliver verified-Z geometry or
    // refuse; a confident trans model for a cis drawing is the one output
    // this test exists to make impossible.
    // Methyl carbons = heavy atoms with exactly ONE heavy neighbour (atom
    // order in the model is canonical, not SMILES order).
    const methyls = (m: Mol3dModel): number[] => {
      const deg = new Map<number, number>();
      for (const b of m.bonds) {
        if (m.atoms[b.a].isH || m.atoms[b.b].isH) continue;
        deg.set(b.a, (deg.get(b.a) ?? 0) + 1);
        deg.set(b.b, (deg.get(b.b) ?? 0) + 1);
      }
      return m.atoms.map((a, i) => i).filter((i) => !m.atoms[i].isH && deg.get(i) === 1);
    };
    const r = generate3d(idOf("C/C=C\\C"));
    if (!isMol3dError(r)) {
      const me = methyls(r);
      expect(me).toHaveLength(2);
      expect(dist(r, me[0], me[1])).toBeLessThan(3.3); // cis ≈ 3.0 Å; trans ≈ 3.9 Å
    } else {
      expect(r.error).toMatch(/stereo/i);
    }
    // And the trans drawing stays trans.
    const t = generate3d(idOf("C/C=C/C"));
    expect(isMol3dError(t)).toBe(false);
    if (!isMol3dError(t)) {
      const me = methyls(t);
      expect(me).toHaveLength(2);
      expect(dist(t, me[0], me[1])).toBeGreaterThan(3.5);
    }
  });

  test("ADV: unspecified stereocentres are specified by geometry — and SAY so", () => {
    const m = model("CC(C)Cc1ccc(cc1)C(C)C(=O)O"); // ibuprofen, no wedges drawn
    expect(m.caveats.join(" ")).toMatch(/stereoisomer/i);
  });

  test("deterministic: the same idcode gives identical coordinates", () => {
    const a = model("CC(C)Cc1ccc(cc1)C(C)C(=O)O");
    const b = model("CC(C)Cc1ccc(cc1)C(C)C(=O)O");
    expect(b.atoms.map((x) => [x.x, x.y, x.z])).toEqual(a.atoms.map((x) => [x.x, x.y, x.z]));
  });

  test("caveats always state what the conformer IS", () => {
    expect(model("CCO").caveats.join(" ")).toMatch(/MMFF94s|conformer/);
  });
});

describe("named refusals", () => {
  test("generic structures (fragment flag) name the R-group problem", () => {
    const frag = Molecule.fromSmiles("c1ccccc1");
    frag.setFragment(true);
    const r = generate3d(frag.getIDCode());
    expect(isMol3dError(r)).toBe(true);
    expect((r as { error: string }).error).toMatch(/generic structure/i);
  });

  test("empty input refuses by name", () => {
    const r = generate3d(Molecule.fromSmiles("").getIDCode());
    expect(isMol3dError(r)).toBe(true);
    expect((r as { error: string }).error).toMatch(/empty/i);
  });

  test("oversize refuses by name with the limit stated", () => {
    const chain = "C".repeat(MOL3D_MAX_HEAVY + 10);
    const r = generate3d(idOf(chain));
    expect(isMol3dError(r)).toBe(true);
    expect((r as { error: string }).error).toContain(String(MOL3D_MAX_HEAVY));
  });

  test("ADV: flexibility refuses by its own name — cost is rotatable bonds, not size", () => {
    // 40 carbons: comfortably under the heavy-atom cap, 37 rotatable bonds —
    // exactly the shape that took minutes at the old atoms-only gate.
    const r = generate3d(idOf("C".repeat(40)));
    expect(isMol3dError(r)).toBe(true);
    expect((r as { error: string }).error).toMatch(/rotatable/i);
  });
});

describe("element data (published values)", () => {
  test("Bondi vdW radii spot checks", () => {
    expect(elementVdw(1)).toBe(1.20);  // H
    expect(elementVdw(6)).toBe(1.70);  // C
    expect(elementVdw(7)).toBe(1.55);  // N
    expect(elementVdw(8)).toBe(1.52);  // O
    expect(elementVdw(16)).toBe(1.80); // S
  });
  test("CPK colors spot checks", () => {
    expect(elementColor(8)).toBe("#FF0D0D");  // O red
    expect(elementColor(7)).toBe("#3050F8");  // N blue
    expect(elementColor(6)).toBe("#909090");  // C gray
  });
  test("ADV: an invented radius is never silent — Fe has a CPK color but NO published vdW radius", () => {
    const m = model("Cl[Fe](Cl)Cl");
    expect(m.caveats.join(" ")).toMatch(/van der Waals radius.*Fe/);
    expect(m.caveats.join(" ")).toMatch(/2\.00/);
    // The color IS published — no color caveat for Fe.
    expect(m.caveats.join(" ")).not.toMatch(/No CPK color.*Fe/);
  });

  test("an element in neither table is named for both gaps", () => {
    const m = model("[W]");
    expect(m.caveats.join(" ")).toMatch(/van der Waals radius.*W/);
    expect(m.caveats.join(" ")).toMatch(/No CPK color.*W/);
  });

  test("In and U carry their real Bondi radii (the sourcing rule holds)", () => {
    expect(elementVdw(49)).toBe(1.93); // In, Bondi 1964
    expect(elementVdw(92)).toBe(1.86); // U, Bondi 1964
  });
});

describe("view and projection", () => {
  test("rotation stays orthonormal over hundreds of drags", () => {
    let v = defaultMol3dView();
    for (let i = 0; i < 300; i++) v = rotateView(v, (i * 7) % 13 - 6, (i * 3) % 11 - 5);
    const R = v.rot;
    const dot = (a: number, b: number): number =>
      R[3 * a] * R[3 * b] + R[3 * a + 1] * R[3 * b + 1] + R[3 * a + 2] * R[3 * b + 2];
    expect(dot(0, 0)).toBeCloseTo(1, 6);
    expect(dot(1, 1)).toBeCloseTo(1, 6);
    expect(dot(2, 2)).toBeCloseTo(1, 6);
    expect(dot(0, 1)).toBeCloseTo(0, 6);
    expect(dot(0, 2)).toBeCloseTo(0, 6);
    expect(dot(1, 2)).toBeCloseTo(0, 6);
  });

  test("draw list is depth-sorted far → near and fits the canvas", () => {
    const m = model("CC(C)Cc1ccc(cc1)C(C)C(=O)O");
    const ops = projectScene(m, defaultMol3dView(), 400, 300);
    expect(ops.length).toBeGreaterThan(m.atoms.length - 1);
    for (let i = 1; i < ops.length; i++) expect(ops[i].depth).toBeGreaterThanOrEqual(ops[i - 1].depth);
    for (const op of ops) {
      if (op.kind === "sphere") {
        expect(op.x - op.r).toBeGreaterThanOrEqual(-1);
        expect(op.x + op.r).toBeLessThanOrEqual(401);
        expect(op.y - op.r).toBeGreaterThanOrEqual(-1);
        expect(op.y + op.r).toBeLessThanOrEqual(301);
      }
    }
  });

  test("hiding hydrogens removes their spheres AND their bonds, and refits", () => {
    const m = model("CCO");
    const withH = projectScene(m, defaultMol3dView(), 400, 300);
    const view = { ...defaultMol3dView(), showH: false };
    const noH = projectScene(m, view, 400, 300);
    expect(noH.filter((o) => o.kind === "sphere")).toHaveLength(3);
    expect(noH.length).toBeLessThan(withH.length);
    // Refit: the heavy-atom skeleton should still use the canvas, not
    // huddle at the scale the hydrogen shell dictated.
    const spheres = noH.filter((o) => o.kind === "sphere");
    const spanX = Math.max(...spheres.map((s) => s.kind === "sphere" ? s.x : 0)) -
                  Math.min(...spheres.map((s) => s.kind === "sphere" ? s.x : 1e9));
    expect(spanX).toBeGreaterThan(100);
  });

  test("spacefill spheres are full vdW; ball-and-stick are smaller; stick has rods", () => {
    const m = model("CCO");
    const space = projectScene(m, { ...defaultMol3dView(), style: "spacefill" }, 400, 300);
    const ball = projectScene(m, defaultMol3dView(), 400, 300);
    expect(space.every((o) => o.kind === "sphere")).toBe(true);
    const maxSpace = Math.max(...space.map((o) => (o.kind === "sphere" ? o.r : 0)));
    const maxBall = Math.max(...ball.map((o) => (o.kind === "sphere" ? o.r : 0)));
    expect(maxSpace).toBeGreaterThan(maxBall);
    const stick = projectScene(m, { ...defaultMol3dView(), style: "stick" }, 400, 300);
    expect(stick.some((o) => o.kind === "rod")).toBe(true);
  });

  test("the inserted SVG is the SAME draw list: width/height set, no NaN, parses", () => {
    const m = model("c1ccccc1");
    const ops = projectScene(m, defaultMol3dView(), 480, 360);
    const svg = opsToSvg(ops, 480, 360);
    expect(svg).toContain('width="480"');
    expect(svg).toContain('height="360"');
    expect(svg).not.toContain("NaN");
    expect((svg.match(/<circle/g) ?? []).length).toBe(ops.filter((o) => o.kind === "sphere").length);
    // "<line " with the space — "<linearGradient" (one per rod) must not count.
    expect((svg.match(/<line /g) ?? []).length).toBe(ops.filter((o) => o.kind === "rod").length);
    // White ground for the printed page.
    expect(svg).toContain('fill="#ffffff"');
  });

  test("the caption states what the figure IS, with the formula subscripted", () => {
    const m = model("c1ccccc1");
    const caption = `${formulaSubscripts(m.formula)} — ball-and-stick, MMFF94s conformer`;
    const svg = opsToSvg(projectScene(m, defaultMol3dView(), 640, 454), 640, 480, caption);
    expect(svg).toContain("C₆H₆");
    expect(svg).toContain("MMFF94s conformer");
    // The scene band (454) keeps the molecule off its own caption line.
    const ys = [...svg.matchAll(/cy="([\d.]+)"/g)].map((x) => Number(x[1]));
    expect(Math.max(...ys)).toBeLessThan(454);
  });

  test("LOAD-BEARING: conformer order matches fromIDCode(idcode) + appended H — 3D edits depend on it", () => {
    // The dialog edits Molecule.fromIDCode(idcode) at indices hit-tested on
    // the conformer. If the generator reordered atoms or bonds, every click
    // would edit the WRONG atom. Heavy atoms come first in idcode order;
    // hydrogens are appended after.
    // Adversarial-pass upgrade: pinned not just on a neutral connected
    // molecule but on a charged one and a TWO-FRAGMENT one (the exact
    // template-beside-structure flow the dialog produces).
    const pinOrder = (smiles: string): void => {
      const idcode = Molecule.fromSmiles(smiles).getIDCode();
      const base = Molecule.fromIDCode(idcode);
      const r = generate3d(idcode);
      expect(isMol3dError(r)).toBe(false);
      if (isMol3dError(r)) return;
      const m = r;
      for (let i = 0; i < base.getAllAtoms(); i++) {
        expect(m.atoms[i].atomicNo).toBe(base.getAtomicNo(i));
      }
      for (let i = base.getAllAtoms(); i < m.atoms.length; i++) {
        expect(m.atoms[i].isH).toBe(true);
      }
      base.ensureHelperArrays(1); // cHelperNeighbours
      for (let bi = 0; bi < base.getAllBonds(); bi++) {
        expect(m.bonds[bi].a).toBe(base.getBondAtom(0, bi));
        expect(m.bonds[bi].b).toBe(base.getBondAtom(1, bi));
        expect(m.bonds[bi].order).toBe(base.getBondOrder(bi));
      }
    };
    pinOrder("CC(C)Cc1ccc(cc1)C(C)C(=O)O"); // neutral, connected
    pinOrder("c1ccccc1[N+](=O)[O-]");        // charged
    pinOrder("CCO.c1ccccc1");                // two fragments (template flow)
  });

  test("ADV: an ion's net charge rides with the model, and displays as a superscript", () => {
    const phenolate = generate3d(idOf("[O-]c1ccccc1"));
    expect(isMol3dError(phenolate)).toBe(false);
    if (!isMol3dError(phenolate)) {
      expect(phenolate.netCharge).toBe(-1);
      // OCL's formula string is charge-blind — the caption pieces restore it.
      expect(`${formulaSubscripts(phenolate.formula)}${chargeSuperscript(phenolate.netCharge)}`).toBe("C₆H₅O⁻");
    }
    expect(chargeSuperscript(0)).toBe("");
    expect(chargeSuperscript(1)).toBe("⁺");
    expect(chargeSuperscript(-2)).toBe("²⁻");
  });

  test("QC-CAUGHT: stick-style rods stop short of atom letters — no strikethrough", () => {
    const m = model("CCO");
    const ops = projectScene(m, { ...defaultMol3dView(), style: "stick" }, 480, 360);
    const label = ops.find((o) => o.kind === "label" && o.text === "O")!;
    expect(label).toBeDefined();
    if (label.kind !== "label") return;
    for (const op of ops) {
      if (op.kind !== "rod") continue;
      const dx = op.x2 - op.x1, dy = op.y2 - op.y1;
      const L2 = dx * dx + dy * dy;
      const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((label.x - op.x1) * dx + (label.y - op.y1) * dy) / L2));
      const qx = op.x1 + t * dx, qy = op.y1 + t * dy;
      // Nearest point of every rod stays outside the letter's core box.
      expect(Math.hypot(label.x - qx, label.y - qy)).toBeGreaterThan(label.size * 0.5);
    }
  });

  test("formulaSubscripts holds the display contract", () => {
    expect(formulaSubscripts("C6H12O6")).toBe("C₆H₁₂O₆");
    expect(formulaSubscripts("H2O")).toBe("H₂O");
    expect(formulaSubscripts("CH4")).toBe("CH₄");
  });
});
