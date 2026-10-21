// Plane stress: the patch test (uniform stress reproduced exactly), Poisson contraction, a cantilever converging on
// beam theory with shear (Timoshenko) as the mesh is refined, reactions balancing loads, refusals.
import { analyzePlate, parsePlate, type PlateResult } from "../planeStress";

const run = (text: string): PlateResult => {
  const p = parsePlate(text);
  if (!p.model) throw new Error(p.errors.join(" | "));
  const r = analyzePlate(p.model);
  if (!r.ok) throw new Error(r.errors.join(" | "));
  return r;
};

describe("plane stress", () => {
  test("patch test: a plate in uniform tension has σx = traction in every element, σy = τ = 0", () => {
    const r = run("plate 50 x 10 t=2\nmaterial E=200000 nu=0.3\nmesh 10 x 4\nsupport left x\nsupport bottom y\ntraction right tx=100");
    for (const [sx, sy, txy] of r.stress) {
      expect(sx).toBeCloseTo(100, 6);
      expect(Math.abs(sy)).toBeLessThan(1e-6);
      expect(Math.abs(txy)).toBeLessThan(1e-6);
    }
    // ε = σ/E, lateral −νσ/E.
    const tip = r.nodes.findIndex(([x, y]) => x === 50 && y === 10);
    expect(r.disp[tip][0]).toBeCloseTo((100 / 200000) * 50, 9);
    expect(r.disp[tip][1]).toBeCloseTo((-0.3 * 100 / 200000) * 10, 9);
    expect(r.reaction[0]).toBeCloseTo(-100 * 10 * 2, 6);
  });
  test("a cantilever under an end shear converges on Timoshenko beam theory as the mesh is refined", () => {
    const L = 100, H = 10, t = 1, E = 200000, nu = 0.3, P = -100;
    const I = (t * H ** 3) / 12, G = E / (2 * (1 + nu));
    const exact = (P * L ** 3) / (3 * E * I) + (P * L) / ((5 / 6) * G * t * H);
    const tip = (nx: number, ny: number): number => {
      const r = run(`plate ${L} x ${H} t=${t}\nmaterial E=${E} nu=${nu}\nmesh ${nx} x ${ny}\nsupport left fixed\ntraction right ty=${P / (H * t)}`);
      const k = r.nodes.findIndex(([x, y]) => x === L && Math.abs(y - H / 2) < 1e-9);
      return r.disp[k][1];
    };
    const coarse = tip(10, 2), fine = tip(80, 8);
    expect(Math.abs(fine - exact)).toBeLessThan(Math.abs(coarse - exact));
    expect(Math.abs(fine / exact - 1)).toBeLessThan(0.06);
    expect(Math.abs(coarse) / Math.abs(exact)).toBeLessThan(1);
  });
  test("reactions balance a point load; the nearest node is said", () => {
    const r = run("plate 40 x 10\nmaterial E=70000 nu=0.33\nmesh 8 x 2\nsupport left fixed\nload 39,10 Fy=-500");
    expect(r.reaction[1]).toBeCloseTo(500, 6);
    expect(r.notes.join(" ")).toMatch(/nearest mesh node \(40, 10\)/);
    expect(r.maxVM.value).toBeGreaterThan(0);
  });
  test("pressure pushes into the plate", () => {
    const r = run("plate 10 x 10\nmaterial E=1000 nu=0\nmesh 4 x 4\nsupport bottom y\nsupport left x\npressure top 5");
    for (const [, sy] of r.stress) expect(sy).toBeCloseTo(-5, 6);
  });
  test("refusals: no supports, a mechanism, bad Poisson's ratio, a load off the plate, a huge mesh", () => {
    expect(parsePlate("plate 10 x 10\nmaterial E=1\nmesh 2 x 2").model).not.toBeNull();
    const p = parsePlate("plate 10 x 10\nmaterial E=1\nmesh 2 x 2").model!;
    expect(analyzePlate(p).ok).toBe(false);
    const slide = parsePlate("plate 10 x 10\nmaterial E=1\nmesh 2 x 2\nsupport left x\ntraction right tx=1").model!;
    expect(analyzePlate(slide).ok).toBe(false);
    expect(parsePlate("plate 10 x 10\nmaterial E=1 nu=0.5\nsupport left fixed").model && analyzePlate(parsePlate("plate 10 x 10\nmaterial E=1 nu=0.5\nsupport left fixed").model!).ok).toBe(false);
    expect(parsePlate("plate 10 x 10\nmaterial E=1\nsupport left fixed\nload 20,5 Fy=1").errors.join(" ")).toMatch(/outside the plate/);
    expect(analyzePlate({ ...parsePlate("plate 10 x 10\nmaterial E=1\nsupport left fixed").model!, nx: 100, ny: 100 }).ok).toBe(false);
  });
});
