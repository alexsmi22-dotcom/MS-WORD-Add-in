// The independent review of the v2.175.0 engineering engines, pinned: a plate free to move is refused (not solved
// through rounding), tall meshes stay fast, zero-order shelf life counts 10 % of the starting assay in its own units,
// kelvin typed as °C and a negative activation energy are refused, typos and non-numbers are refused, and a moment on a
// fully pinned joint is refused rather than dropped.
import { analyzeFrame, parseFrame } from "../frame2d";
import { analyzePlate, parsePlate } from "../planeStress";
import { arrhenius, parseStability } from "../arrhenius";
import { nernst } from "../electrochem";

const plate = (text: string) => {
  const p = parsePlate(text);
  if (!p.model) return { ok: false as const, errors: p.errors };
  return analyzePlate(p.model);
};
const frame = (text: string) => {
  const p = parseFrame(text);
  if (!p.model) return { ok: false as const, errors: p.errors };
  return analyzeFrame(p.model);
};

describe("plate", () => {
  test("a plate held only in x is refused, not answered with 1e11 displacements", () => {
    for (const t of [
      "plate 10 x 4\nmaterial E=1000 nu=0.3\nmesh 4 x 4\nsupport left x\nload 10,4 Fy=1",
      "plate 10 x 4\nmaterial E=1000 nu=0.3\nmesh 4 x 4\nsupport left x\nsupport right x\ntraction top ty=1",
    ]) {
      const r = plate(t);
      expect(r.ok).toBe(false);
    }
  });
  test("a tall mesh is numbered across its short side: 4 × 1000 solves quickly", () => {
    const t0 = Date.now();
    const r = plate("plate 4 x 1000\nmaterial E=200000 nu=0.3\nmesh 4 x 1000\nsupport bottom fixed\ntraction top ty=1");
    expect(r.ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000);
    // Uniform tension: σy = 1 everywhere.
    if (r.ok) expect(Math.abs(r.stress[0][1] - 1)).toBeLessThan(0.05);
  });
  test("the tall and the wide plate give the same answer (numbering does not change it)", () => {
    const a = plate("plate 100 x 20\nmaterial E=200000 nu=0.3\nmesh 20 x 4\nsupport left fixed\ntraction right ty=-5");
    const b = plate("plate 20 x 100\nmaterial E=200000 nu=0.3\nmesh 4 x 20\nsupport bottom fixed\ntraction top tx=5");
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.maxDisp.value).toBeCloseTo(a.maxDisp.value, 9);
  });
  test("typos and non-numbers are refused", () => {
    for (const t of ["material E=1000 v=0.45", "load 10,4 Fz=5 Fy=1", "load 10,4 Fy=abc", "load 10,4 Fy=1e999"]) {
      const r = parsePlate(`plate 10 x 4\nmesh 4 x 4\nsupport left fixed\n${t.startsWith("material") ? t : "material E=1000 nu=0.3\n" + t}`);
      expect([t, r.model]).toEqual([t, null]);
    }
  });
  test("a negative Poisson's ratio above −1 is allowed", () => {
    expect(plate("plate 10 x 4\nmaterial E=1000 nu=-0.2\nmesh 8 x 4\nsupport left fixed\ntraction right tx=1").ok).toBe(true);
  });
});

describe("shelf life", () => {
  const series = "40: 0 5, 3 4.85, 6 4.7\n50: 0 5, 3 4.7, 6 4.4\n60: 0 5, 3 4.4, 6 3.8";
  test("zero order in mg/mL from 5: t90 = 0.1·C0/k, not 10/k", () => {
    const p = parseStability(series, "zero");
    const r = arrhenius(p.points, 40, "zero");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.storage.t90).toBeCloseTo((0.1 * 5) / r.storage.k, 6);
    if (r.ok) expect(r.storage.t90).toBeCloseTo(10, 0);
  });
  test("temperatures in kelvin are refused", () => {
    const r = arrhenius([{ tC: 313.15, k: 0.01 }, { tC: 323.15, k: 0.03 }, { tC: 333.15, k: 0.08 }], 25, "first");
    expect(!r.ok && r.errors.join(" ")).toMatch(/look like kelvin/);
  });
});

describe("frame", () => {
  test("a moment on a joint where every member is pinned is refused", () => {
    const r = frame("node A 0,0\nnode B 4,0\nnode C 8,0\nE=200e6 A=0.01 I=1e-4\nmember 1 A-B hinge=j\nmember 2 B-C hinge=i\nsupport A fixed\nsupport C fixed\nload B M=5");
    expect(r.ok).toBe(false);
  });
  test("typos, a second support on one node and infinite coordinates are refused", () => {
    const base = "node A 0,0\nnode B 4,0\nE=200e6 A=0.01 I=1e-4\nmember 1 A-B\nsupport A fixed\n";
    for (const extra of ["load B Fz=-1", "support A pin", "node C 1e999,0"]) expect([extra, parseFrame(base + extra).model]).toEqual([extra, null]);
    expect(parseFrame("node A 0,0\nnode B 4,0\nE=200e6 A=0.01 I=1e-4\nmember 1 A-B Iz=1e-2\nsupport A fixed").model).toBeNull();
  });
});

describe("Nernst", () => {
  test("a non-finite activity or temperature is refused", () => {
    expect(typeof nernst(0.34, 2, 25, [], [{ a: Infinity, nu: 1 }])).toBe("string");
    expect(typeof nernst(0.34, 2, Infinity, [], [{ a: 0.01, nu: 1 }])).toBe("string");
  });
});

describe("round 2", () => {
  test("slender but well-supported plates solve (the pivot floor is rounding level only)", () => {
    for (const t of [
      "plate 1000 x 5\nmaterial E=200000 nu=0.3\nmesh 800 x 4\nsupport left fixed\nload 1000,5 Fy=-1",
      "plate 100 x 1\nmaterial E=200000 nu=0.3\nmesh 2000 x 2\nsupport left fixed\nload 100,1 Fy=-1",
      "plate 1000 x 1\nmaterial E=200000 nu=0.3\nmesh 1000 x 4\nsupport left fixed\ntraction right tx=1",
    ]) {
      const r = plate(t);
      expect([t, r.ok]).toEqual([t, true]);
    }
  });
  test("a storage temperature in kelvin, a zero starting assay and a flat rate are refused, each in its own words", () => {
    const pts = [{ tC: 40, k: 0.01 }, { tC: 50, k: 0.03 }, { tC: 60, k: 0.08 }];
    const k = arrhenius(pts, 298.15, "first");
    expect(!k.ok && k.errors.join(" ")).toMatch(/storage temperature of 298\.15 °C looks like kelvin/);
    const z = arrhenius(parseStability("40: 10 -1, 20 -2\n50: 10 -2, 20 -4", "zero").points, 25, "zero");
    expect(!z.ok && z.errors.join(" ")).toMatch(/starting assay is zero or below/);
    const flat = arrhenius([{ tC: 40, k: 0.01 }, { tC: 50, k: 0.01 }], 25, "first");
    expect(!flat.ok && flat.errors.join(" ")).toMatch(/same at every temperature/);
  });
});
