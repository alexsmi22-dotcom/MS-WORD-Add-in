// Arrhenius and shelf life: exact data return their own Ea; a noisy set matches scipy (linregress and Student t,
// run locally, numbers kept here); fitted rates from assay series; t90 for both orders; refusals and warnings.
import { arrhenius, fitRate, parseStability, R_GAS, t90 } from "../arrhenius";

const close = (a: number, b: number, rel = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1e-12, Math.abs(b)));

describe("arrhenius", () => {
  test("exact data return their own activation energy and pre-exponential factor", () => {
    const Ea = 85e3, A = 3.2e11;
    const pts = [40, 50, 60].map((tC) => ({ tC, k: A * Math.exp(-Ea / (R_GAS * (tC + 273.15))) }));
    const r = arrhenius(pts, 25, "first");
    if (!r.ok) throw new Error(r.errors.join());
    close(r.EaKJ, 85, 1e-9);
    close(Math.exp(r.lnA), A, 1e-8);
    close(r.storage.k, A * Math.exp(-Ea / (R_GAS * 298.15)), 1e-8);
    close(r.storage.t90, Math.log(10 / 9) / r.storage.k, 1e-12);
  });
  test("a noisy four-temperature set matches scipy: Ea and its 95 % interval, k(25 °C) and its upper bound, t90", () => {
    const r = arrhenius([40, 50, 60, 70].map((tC, i) => ({ tC, k: [0.00412, 0.0119, 0.0318, 0.0805][i] })), 25, "first");
    if (!r.ok) throw new Error(r.errors.join());
    close(r.EaKJ, 88.47547664688882, 1e-9);
    close(r.EaCI![0], 87.63756137371891, 1e-6);
    close(r.EaCI![1], 89.31339192005873, 1e-6);
    close(r.storage.k, 0.0007481520018711276, 1e-9);
    close(r.storage.kUpper!, 0.0007647299990788353, 1e-6);
    close(r.storage.t90, 140.82768661223892, 1e-9);
    close(r.storage.t90Lower!, 137.7747908212567, 1e-6);
    close(r.r2, 0.9999903103611998, 1e-9);
    expect(r.notes.join(" ")).toMatch(/outside the measured range/);
  });
  test("two temperatures: the fit is exact and no interval is invented", () => {
    const r = arrhenius([{ tC: 40, k: 0.01 }, { tC: 60, k: 0.05 }], 50, "first");
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.EaCI).toBeNull();
    expect(r.storage.kUpper).toBeNull();
    expect(r.notes.join(" ")).toMatch(/no interval/);
  });
  test("zero order: t90 = 10 %/k", () => {
    expect(t90(0.5, "zero")).toBe(20);
    expect(t90(Math.log(10 / 9), "first")).toBeCloseTo(1, 12);
  });
  test("rates fitted from assay series: first order from ln C, zero order from C", () => {
    const k = 0.02;
    const first = fitRate([0, 3, 6, 12].map((t) => [t, 100 * Math.exp(-k * t)] as [number, number]), "first");
    expect(typeof first === "string" ? NaN : first.k).toBeCloseTo(k, 12);
    const zero = fitRate([0, 3, 6, 12].map((t) => [t, 100 - 0.5 * t] as [number, number]), "zero");
    expect(typeof zero === "string" ? NaN : zero.k).toBeCloseTo(0.5, 12);
    expect(fitRate([[0, 100], [6, 101]], "first")).toMatch(/does not fall/);
    expect(fitRate([[0, 100], [6, -1]], "first")).toMatch(/above zero/);
  });
  test("parseStability reads rate lines and series lines; refuses what it cannot read", () => {
    const p = parseStability("40 °C 0.0123\n50: 0 100, 2 97.0, 4 94.1, 8 88.6\n# a comment\n60, 0.07", "first");
    expect(p.errors).toEqual([]);
    expect(p.points.map((x) => x.tC)).toEqual([40, 50, 60]);
    expect(p.points[1].from!.n).toBe(4);
    expect(parseStability("hello", "first").errors.join(" ")).toMatch(/is not “40 0.0123”/);
    expect(parseStability("50: 0 100, 2", "first").errors.join(" ")).toMatch(/time and assay pairs/);
  });
  test("refusals and warnings: one temperature, k ≤ 0, a falling rate, a bent plot", () => {
    expect(arrhenius([{ tC: 40, k: 0.01 }], 25, "first").ok).toBe(false);
    expect(arrhenius([{ tC: 40, k: 0.01 }, { tC: 50, k: 0 }], 25, "first").ok).toBe(false);
    const down = arrhenius([{ tC: 40, k: 0.05 }, { tC: 60, k: 0.01 }], 50, "first");
    expect(!down.ok && down.errors.join(" ")).toMatch(/negative activation energy.*no shelf life/);
    const bent = arrhenius([{ tC: 30, k: 0.001 }, { tC: 40, k: 0.01 }, { tC: 50, k: 0.012 }, { tC: 60, k: 0.1 }], 25, "first");
    expect(bent.ok && bent.notes.join(" ")).toMatch(/not straight/);
  });
});
