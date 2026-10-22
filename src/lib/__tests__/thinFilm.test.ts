// Fresnel and thin-film stack engine (src/lib/thinFilm.ts).
//
// EXTERNAL ORACLE: S. J. Byrnes' `tmm` package (pip install tmm), run in the
// scratch venv. Every pinned value below came from this script, verbatim:
//
//   import tmm, numpy as np
//   from numpy import inf, radians
//   def fr(n1, n2, th):            # one interface, both polarisations
//       return {p: tmm.coh_tmm(p, [n1, n2], [inf, inf], radians(th), 550) for p in "sp"}
//   fr(1, 1.52, 45); fr(1.5, 1.0, 60); fr(1, 0.05+3.4j, 50); fr(1, 0.05+3.4j, 0)
//   def st(ns, ds, th, lam):
//       return {p: tmm.coh_tmm(p, ns, ds, radians(th), lam) for p in "sp"}
//   st([1]+[2.35,1.38]*4+[2.35,1.52], [inf]+[550/4/2.35,550/4/1.38]*4+[550/4/2.35,inf], 0, 550)   # (HL)^4 H
//   st([1,1.38,2.0+0.1j,0.05+3.4j,1.52+0.01j], [inf,100,50,20,inf], 40, 600)                     # absorbing, oblique
//   st([1,0.05+3.4j,2.0+0.1j,1.38,1.52+0.01j], [inf,20,50,100,inf], 40, 600)                     # the same, reversed
//   st([1.5,1.0,1.5], [inf,200,inf], 60, 550)                                                     # frustrated TIR
//   st([1,1.38,1.52], [inf,550/4/1.38,inf], 30, 500)                                              # QW AR off-design, oblique
//
// tmm uses exp(−iωt), n + ik absorbing, and rp = −rs at normal incidence; so
// does thinFilm.ts, which is why the complex amplitudes can be compared too.

import { fresnel, fresnelAt, readIndex, readLayers, stackRTA, cx, type Cx, type Layer } from "../thinFilm";
import { refraction } from "../optics";

const close = (a: Cx, re: number, im: number, digits = 12) => {
  expect(a.re).toBeCloseTo(re, digits);
  expect(a.im).toBeCloseTo(im, digits);
};
const L = (n: Cx | number, d: number, label = ""): Layer => ({ label, n: typeof n === "number" ? cx(n) : n, dNm: d, wave: "" });

describe("fresnelAt against tmm", () => {
  test("air → glass 1.52 at 45°", () => {
    const f = fresnelAt(1, cx(1.52), 45)!;
    close(f.rs, -0.3110195491738344, 0);
    close(f.rp, 0.0967331599682952, 0);
    close(f.ts, 0.6889804508261655, 0);
    close(f.tp, 0.7215349736633521, 0);
    expect(f.Rs).toBeCloseTo(0.0967331599682952, 13);
    expect(f.Rp).toBeCloseTo(0.009357304237451788, 13);
    expect(f.Ts).toBeCloseTo(0.9032668400317045, 13);
    expect(f.Tp).toBeCloseTo(0.9906426957625479, 13);
  });
  test("TIR glass → air at 60°: |r| = 1, tmm's phases, no power transmitted", () => {
    const f = fresnelAt(1.5, cx(1.0), 60)!;
    close(f.rs, -0.10000000000000026, -0.9949874371066197);
    close(f.rp, -0.7217391304347825, -0.6921651736393877);
    close(f.ts, 0.8999999999999997, -0.9949874371066197);
    close(f.tp, 0.41739130434782595, -1.0382477604590814);
    expect(f.Rs).toBeCloseTo(1, 14);
    expect(f.Rp).toBeCloseTo(1, 14);
    expect(f.Ts).toBe(0);
    expect(f.Tp).toBe(0);
  });
  test("metal 0.05+3.4i at 50° and at normal incidence", () => {
    const f = fresnelAt(1, cx(0.05, 3.4), 50)!;
    close(f.rs, -0.9295792942253768, -0.354892236625944);
    close(f.rp, 0.6319350396058093, 0.7597584550535731);
    close(f.ts, 0.07042070577462321, -0.354892236625944);
    close(f.tp, 0.23046707019783252, -0.47659167238115224);
    expect(f.Ts).toBeCloseTo(0.009933836130085312, 13);
    expect(f.Tp).toBeCloseTo(0.02342519569301206, 13);
    expect(f.Rs + f.Ts).toBeCloseTo(1, 13);
    expect(f.Rp + f.Tp).toBeCloseTo(1, 13);
    const g = fresnelAt(1, cx(0.05, 3.4), 0)!;
    close(g.rs, -0.8341559723593285, -0.5370187561697926);
    close(g.rp, 0.8341559723593285, 0.5370187561697926); // rp = −rs at normal incidence
    expect(g.Rs).toBeCloseTo(0.9842053307008879, 13);
  });
});

describe("fresnel agrees with optics.ts refraction()", () => {
  test.each([
    [1.0, 1.52],
    [1.0, 2.4],
    [1.33, 1.0],
    [1.5, 1.0],
    [3.5, 1.45],
  ])("n1 = %p, n2 = %p", (n1, n2) => {
    const ref = refraction(n1, n2, 10)!;
    const f = fresnel(n1, cx(n2), 10)!;
    expect(f.brewsterDeg).toBe(ref.brewsterDeg);
    expect(f.criticalDeg).toBe(ref.criticalDeg);
    expect(f.reflectanceNormal).toBe(ref.reflectanceNormal);
    expect(fresnelAt(n1, cx(n2), ref.brewsterDeg)!.Rp).toBeLessThan(1e-15);
    const n0 = fresnelAt(n1, cx(n2), 0)!;
    expect(n0.Rs).toBeCloseTo(ref.reflectanceNormal, 15);
    expect(n0.Rp).toBeCloseTo(ref.reflectanceNormal, 15);
    if (ref.criticalDeg !== null) {
      for (const t of [ref.criticalDeg + 0.01, (ref.criticalDeg + 90) / 2, 89.9]) {
        const q = fresnelAt(n1, cx(n2), t)!;
        expect(q.Rs).toBeCloseTo(1, 13);
        expect(q.Rp).toBeCloseTo(1, 13);
        expect(fresnel(n1, cx(n2), t)!.tir).toBe(refraction(n1, n2, t)!.tir);
      }
      expect(fresnel(n1, cx(n2), ref.criticalDeg + 0.01)!.tir).toBe(true);
    }
  });
  test("lossless: R + T = 1 for s and p across all angles", () => {
    for (let t = 0; t < 90; t += 1.5) {
      for (const [a, b] of [
        [1, 1.52],
        [1.52, 1],
        [1, 4.0],
      ]) {
        const q = fresnelAt(a, cx(b), t)!;
        expect(q.Rs + q.Ts).toBeCloseTo(1, 12);
        expect(q.Rp + q.Tp).toBeCloseTo(1, 12);
      }
    }
  });
  test("absorbing: pseudo-Brewster, no critical angle, Rp minimum is a real minimum", () => {
    const f = fresnel(1, cx(0.05, 3.4), 30)!;
    expect(f.brewsterIsPseudo).toBe(true);
    expect(f.criticalDeg).toBeNull();
    expect(f.tir).toBe(false);
    const rp = (t: number) => fresnelAt(1, cx(0.05, 3.4), t)!.Rp;
    expect(rp(f.brewsterDeg)).toBeLessThanOrEqual(rp(f.brewsterDeg - 0.01));
    expect(rp(f.brewsterDeg)).toBeLessThanOrEqual(rp(f.brewsterDeg + 0.01));
    expect(f.rpAtBrewster).toBeGreaterThan(0.5);
  });
  test("refusals", () => {
    expect(fresnelAt(1, cx(1.5), 90)).toBeNull();
    expect(fresnelAt(1, cx(1.5), -1)).toBeNull();
    expect(fresnelAt(NaN, cx(1.5), 0)).toBeNull();
    expect(fresnelAt(1, cx(1.5, -0.1), 0)).toBeNull();
    expect(fresnelAt(0, cx(1.5), 0)).toBeNull();
    expect(fresnel(1, cx(Infinity), 0)).toBeNull();
  });
});

describe("thin-film stack", () => {
  test("bare substrate reproduces Fresnel to 1e-12 (s, p, oblique, absorbing)", () => {
    for (const ns of [cx(1.52), cx(0.05, 3.4), cx(1.0)]) {
      for (const t of [0, 25, 55, 80]) {
        const n0 = ns.re === 1.0 ? 1.5 : 1.0;
        const s = stackRTA(n0, [], ns, 550, t, "s")!;
        const f = fresnelAt(n0, ns, t)!;
        expect(Math.abs(s.R - f.Rs)).toBeLessThan(1e-12);
        expect(Math.abs(s.Rp - f.Rp)).toBeLessThan(1e-12);
        expect(Math.abs(s.T - f.Ts)).toBeLessThan(1e-12);
        expect(Math.abs(s.Tp - f.Tp)).toBeLessThan(1e-12);
      }
    }
  });
  test("single quarter-wave AR: R = ((n0·ns − n1²)/(n0·ns + n1²))²", () => {
    for (const [n0, n1, ns] of [
      [1, 1.38, 1.52],
      [1, 1.23, 1.52],
      [1.33, 1.6, 1.9],
    ]) {
      const r = readLayers(`${n1} QW`, 550);
      if (!r.ok) throw new Error(r.reason);
      const s = stackRTA(n0, r.layers, cx(ns), 550, 0, "avg")!;
      const closed = ((n0 * ns - n1 * n1) / (n0 * ns + n1 * n1)) ** 2;
      expect(Math.abs(s.R - closed)).toBeLessThan(1e-14);
    }
    // n1 = √(n0 ns) is a perfect AR coating.
    const s = stackRTA(1, [L(Math.sqrt(1.52), 550 / 4 / Math.sqrt(1.52))], cx(1.52), 550, 0, "s")!;
    expect(s.R).toBeLessThan(1e-28);
  });
  test("(HL)⁴H quarter-wave mirror: closed form Y = (nH/nL)^(2N)·nH²/ns, and tmm", () => {
    const r = readLayers("repeat 4\nH 2.35 QW\nL 1.38 QW\nend\nH 2.35 QW", 550);
    if (!r.ok) throw new Error(r.reason);
    expect(r.layers.length).toBe(9);
    const Y = (2.35 / 1.38) ** 8 * (2.35 * 2.35) / 1.52;
    const closed = ((1 - Y) / (1 + Y)) ** 2;
    const s = stackRTA(1, r.layers, cx(1.52), 550, 0, "avg")!;
    expect(Math.abs(s.R - closed)).toBeLessThan(1e-13);
    expect(s.R).toBeCloseTo(0.9845516013303248, 13);
    expect(s.T).toBeCloseTo(0.015448398669675371, 13);
    expect(Math.abs(s.R + s.T - 1)).toBeLessThan(1e-12);
  });
  test("absorbing asymmetric stack at 40°: tmm, both orders (catches a reversed layer order)", () => {
    const fwd = [L(1.38, 100), L(cx(2.0, 0.1), 50), L(cx(0.05, 3.4), 20)];
    const sub = cx(1.52, 0.01);
    const a = stackRTA(1, fwd, sub, 600, 40, "s")!;
    expect(a.R).toBeCloseTo(0.3608197570327226, 12);
    expect(a.T).toBeCloseTo(0.39603010801181365, 12);
    expect(a.Rp).toBeCloseTo(0.2759239912237113, 12);
    expect(a.Tp).toBeCloseTo(0.481640629246618, 12);
    const b = stackRTA(1, [...fwd].reverse(), sub, 600, 40, "p")!;
    expect(b.Rs).toBeCloseTo(0.53899996367321, 12);
    expect(b.Ts).toBeCloseTo(0.3824357670579484, 12);
    expect(b.R).toBeCloseTo(0.42127488941299784, 12);
    expect(b.T).toBeCloseTo(0.4906140843822687, 12);
    expect(b.A).toBeCloseTo(1 - 0.42127488941299784 - 0.4906140843822687, 12);
  });
  test("frustrated TIR through a 200 nm gap (the evanescent branch)", () => {
    const s = stackRTA(1.5, [L(1.0, 200)], cx(1.5), 550, 60, "s")!;
    expect(s.R).toBeCloseTo(0.9142681064029523, 12);
    expect(s.T).toBeCloseTo(0.08573189359704789, 12);
    expect(s.Rp).toBeCloseTo(0.9565910335726625, 12);
    expect(s.Tp).toBeCloseTo(0.043408966427337776, 12);
  });
  test("QW AR at 30°, 500 nm (off design): tmm", () => {
    const s = stackRTA(1, [L(1.38, 550 / 4 / 1.38)], cx(1.52), 500, 30, "avg")!;
    expect(s.Rs).toBeCloseTo(0.02021710991197193, 13);
    expect(s.Rp).toBeCloseTo(0.006814951590913362, 13);
    expect(s.R).toBeCloseTo((0.02021710991197193 + 0.006814951590913362) / 2, 13);
  });
  test("lossless random stacks: R + T = 1 to 1e-12, A snapped to 0", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 40; k++) {
      const layers = Array.from({ length: 1 + Math.floor(rnd() * 30) }, () => L(1.2 + rnd() * 2.5, 5 + rnd() * 400));
      const t = rnd() * 85;
      for (const pol of ["s", "p", "avg"] as const) {
        const s = stackRTA(1 + rnd() * 0.5, layers, cx(1.3 + rnd()), 300 + rnd() * 900, t, pol)!;
        expect(Math.abs(s.R + s.T - 1)).toBeLessThan(1e-12);
        expect(s.A).toBe(0);
      }
    }
  });
  test("opaque layer 10⁶ nm of metal: finite, R matches the bare metal, capped", () => {
    const s = stackRTA(1, [L(cx(0.05, 3.4), 1e6)], cx(1.52), 550, 0, "s")!;
    expect(Number.isFinite(s.R) && Number.isFinite(s.T)).toBe(true);
    expect(s.T).toBeLessThan(1e-25);
    expect(s.capped).toBe(true);
    expect(s.R).toBeCloseTo(0.9842053307008879, 12);
  });
  test("400 layers at grazing incidence stay finite", () => {
    const layers = Array.from({ length: 400 }, (_, i) => L(i % 2 ? 1.38 : 2.35, 60));
    const s = stackRTA(1, layers, cx(1.52), 550, 89.9, "avg")!;
    expect(Number.isFinite(s.R) && s.R >= 0 && s.R <= 1 + 1e-12).toBe(true);
  });
  test("refusals", () => {
    expect(stackRTA(1, [], cx(1.5), 0, 0, "s")).toBeNull();
    expect(stackRTA(1, [], cx(1.5), 550, 90, "s")).toBeNull();
    expect(stackRTA(1, [L(NaN, 10)], cx(1.5), 550, 0, "s")).toBeNull();
    expect(stackRTA(1, [L(cx(1.5, -1), 10)], cx(1.5), 550, 0, "s")).toBeNull();
  });
});

describe("readIndex", () => {
  test.each([
    ["1.38", 1.38, 0],
    ["0.05+3.4i", 0.05, 3.4],
    ["0.05 + 3.4 i", 0.05, 3.4],
    ["0.05+i3.4", 0.05, 3.4],
    ["2+0.1j", 2, 0.1],
    ["1.5+i", 1.5, 1],
    ["+1.5", 1.5, 0],
  ])("%p", (t, re, im) => {
    const r = readIndex(t, "n");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.n.re).toBe(re);
      expect(r.n.im).toBe(im);
    }
  });
  test.each(["", "abc", "0.05-3.4i", "0.05−3.4i", "-1.5", "0", "1.5+3.4", "1,5", "1.5+3.4i+2", "Infinity", "1e400"])(
    "refuses %p",
    (t) => {
      const r = readIndex(t, "n");
      expect(r.ok).toBe(false);
    },
  );
  test("negative k names the convention", () => {
    const r = readIndex("0.05-3.4i", "n");
    expect(!r.ok && r.reason).toMatch(/exp\(−iωt\)/);
  });
});

describe("readLayers", () => {
  test("labels with digits, units, QW / HW, comments, blank lines", () => {
    const r = readLayers("MgF2 1.38 99.6 nm\n# comment\n\nTa2O5 2.1 0.06 µm\nLayer 3 1.45 QW\n2.0+0.1i 50\nSiO2 1.45 HW", 550);
    if (!r.ok) throw new Error(r.reason);
    expect(r.layers.map((l) => l.label)).toEqual(["MgF2", "Ta2O5", "Layer 3", "", "SiO2"]);
    expect(r.layers[0].dNm).toBe(99.6);
    expect(r.layers[1].dNm).toBeCloseTo(60, 12);
    expect(r.layers[2].dNm).toBeCloseTo(550 / 4 / 1.45, 12);
    expect(r.layers[2].wave).toBe("QW");
    expect(r.layers[3].n).toEqual(cx(2, 0.1));
    expect(r.layers[4].dNm).toBeCloseTo(550 / 2 / 1.45, 12);
  });
  test("QW is read as a quarter wave, not as a unit", () => {
    const r = readLayers("1.38 QW", 550);
    expect(r.ok && r.layers[0].dNm).toBeCloseTo(550 / 4 / 1.38, 12);
  });
  test("empty is a bare substrate", () => {
    const r = readLayers("  \n", 550);
    expect(r.ok && r.layers.length).toBe(0);
  });
  test.each([
    ["MgF2 1.38", /index and a thickness/],
    ["MgF2 1.38 100 mn", /unit "mn"/],
    ["MgF2 1.38 0", /positive/],
    ["MgF2 1.38 -5", /thickness/],
    ["MgF2 0.05-3.4i 50", /negative extinction/],
    ["repeat 0\n1.38 QW\nend", /whole number/],
    ["repeat 3\n1.38 QW", /no matching "end"/],
    ["end", /without a "repeat"/],
    ["repeat 2\nend", /no layers/],
    ["repeat 200\nrepeat 200\n1.38 QW\nend\nend", /more than 400/],
    ["1.38 2e8", /10 mm/],
    ["MgF2 1.38 QW extra", /thickness/],
  ])("refuses %p", (t, why) => {
    const r = readLayers(t, 550);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(why);
  });
});
