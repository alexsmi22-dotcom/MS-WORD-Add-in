// Jones calculus engine (jones.ts) and the three pane calculators (filmCalcs.ts).
//
// EXTERNAL ORACLE for the Jones chain, an independent numpy build of the same
// conventions (exp(−iωt), fast axis at θ, slow component × e^{iδ}):
//
//   import numpy as np
//   def R(t): c, s = np.cos(t), np.sin(t); return np.array([[c, s], [-s, c]])
//   def ret(th, d): t = np.radians(th); return R(-t) @ np.diag([1, np.exp(1j*np.radians(d))]) @ R(t)
//   def pol(th): t = np.radians(th); return R(-t) @ np.diag([1, 0]) @ R(t)
//   def rot(r): return R(-np.radians(r))
//   v = np.array([1, 0.5j]); v = v / np.linalg.norm(v)
//   for M in [ret(30, 60), rot(15), pol(10)]: v = M @ v
//   # → [0.94064052+0.28977039j, 0.1658603+0.05109434j], S0 = 0.9988917462410056
//   # without the polariser: [0.94300727+0.29504452j, 0.15243785+0.02118324j],
//   #   S = (1, 0.9526279441628827, 0.3, −0.05), ψ = 8.740085101380183°, χ = −1.432991991299424°

import {
  propagate,
  ellipse,
  DARK,
  stokes,
  readElements,
  linearState,
  RIGHT_CIRCULAR,
  LEFT_CIRCULAR,
  type JonesElement,
} from "../jones";
import { FILM_CALCS, readComplex } from "../filmCalcs";
import { polarisationEllipseSvg } from "../filmCharts";
import { qNum } from "../assayQuant";
import { cx } from "../thinFilm";
import { refraction } from "../optics";

const els = (t: string): JonesElement[] => {
  const r = readElements(t);
  if (!r.ok) throw new Error(r.reason);
  return r.elements;
};

describe("Jones engine", () => {
  test("numpy oracle: retarder, rotator, polariser on an elliptical input", () => {
    const r = propagate([cx(1), cx(0, 0.5)], els("retarder 30 60\nrotator 15\npolariser 10"))!;
    expect(r.output[0].re).toBeCloseTo(0.94064052, 8);
    expect(r.output[0].im).toBeCloseTo(0.28977039, 8);
    expect(r.output[1].re).toBeCloseTo(0.1658603, 7);
    expect(r.output[1].im).toBeCloseTo(0.05109434, 8);
    expect(r.transmitted).toBeCloseTo(0.9988917462410056, 13);
    const r2 = propagate([cx(1), cx(0, 0.5)], els("retarder 30 60\nrotator 15"))!;
    const s = stokes(r2.output);
    expect(s.S0).toBeCloseTo(1, 13);
    expect(s.S1).toBeCloseTo(0.9526279441628827, 13);
    expect(s.S2).toBeCloseTo(0.3, 13);
    expect(s.S3).toBeCloseTo(-0.05, 13);
    const e = ellipse(r2.output)!;
    expect(e.azimuthDeg).toBeCloseTo(8.740085101380183, 11);
    expect(e.ellipticityDeg).toBeCloseTo(-1.432991991299424, 11);
    expect(e.handedness).toBe("left");
  });
  test("QWP at 45° on horizontal: left-handed circular (IEEE), S₃ = −1; at −45°: right-handed", () => {
    const a = propagate(linearState(0), els("qwp 45"))!;
    const ea = ellipse(a.output)!;
    expect(ea.shape).toBe("circular");
    expect(ea.handedness).toBe("left");
    expect(stokes(a.output).S3).toBeCloseTo(-1, 14);
    const b = propagate(linearState(0), els("qwp -45"))!;
    expect(ellipse(b.output)!.handedness).toBe("right");
    expect(stokes(b.output).S3).toBeCloseTo(1, 14);
  });
  test("(1, i)/√2 is right-handed with S₃ = +1; a HWP flips handedness; QWP turns circular back to linear", () => {
    expect(ellipse(RIGHT_CIRCULAR)!.handedness).toBe("right");
    expect(stokes(RIGHT_CIRCULAR).S3).toBeCloseTo(1, 15);
    expect(ellipse(LEFT_CIRCULAR)!.handedness).toBe("left");
    for (const ang of [0, 17, 45, 90]) {
      const r = propagate(RIGHT_CIRCULAR, els(`hwp ${ang}`))!;
      expect(ellipse(r.output)!.handedness).toBe("left");
      expect(r.transmitted).toBeCloseTo(1, 14);
    }
    const q = propagate(RIGHT_CIRCULAR, els("qwp 0"))!;
    expect(ellipse(q.output)!.shape).toBe("linear");
  });
  test("HWP at θ rotates linear light by 2θ", () => {
    const r = propagate(linearState(10), els("hwp 30"))!;
    const e = ellipse(r.output)!;
    expect(e.shape).toBe("linear");
    expect(e.azimuthDeg).toBeCloseTo(50, 12);
  });
  test("Malus: a polariser pair at θ passes cos²θ; crossed pair 0; 0°/45°/90° passes ¼", () => {
    for (const t of [0, 10, 30, 45, 60, 89, 90, 135]) {
      const r = propagate(linearState(0), els(`polariser 0\npolariser ${t}`))!;
      const c = Math.cos((t * Math.PI) / 180);
      expect(r.transmitted).toBeCloseTo(c * c, 14);
    }
    const crossed = propagate(linearState(0), els("polariser 0\npolariser 90"))!;
    expect(crossed.transmitted).toBeLessThan(DARK); // cos(90°)² in double precision, ~3.7×10⁻³³
    expect(ellipse(crossed.output, DARK)).toBeNull();
    expect(propagate(linearState(0), els("polariser 0\npolariser 45\npolariser 90"))!.transmitted).toBeCloseTo(0.25, 14);
  });
  test("rotator by ρ turns linear light by ρ; a general retarder at δ = 180° equals a HWP", () => {
    expect(ellipse(propagate(linearState(20), els("rotator 25"))!.output)!.azimuthDeg).toBeCloseTo(45, 12);
    const a = propagate(linearState(5), els("retarder 33 180"))!.output;
    const b = propagate(linearState(5), els("hwp 33"))!.output;
    expect(a[0].re).toBeCloseTo(b[0].re, 14);
    expect(a[1].im).toBeCloseTo(b[1].im, 14);
  });
  test("azimuth range (−90°, 90°]", () => {
    expect(ellipse(linearState(90))!.azimuthDeg).toBeCloseTo(90, 12);
    expect(ellipse(linearState(-90))!.azimuthDeg).toBeCloseTo(90, 12);
    expect(ellipse(linearState(135))!.azimuthDeg).toBeCloseTo(-45, 12);
  });
  test("readElements refusals", () => {
    for (const t of ["mirror 30", "polariser", "retarder 30", "polariser 30 40", "qwp abc", "polariser 1e9", "hwp 40000"]) {
      expect(readElements(t).ok).toBe(false);
    }
    expect(readElements(Array.from({ length: 101 }, () => "hwp 0").join("\n")).ok).toBe(false);
    const ok = readElements("Polarizer 30°\nHWP 22.5 deg\nquarter-wave plate −45\n# c\nanalyser 0");
    expect(ok.ok && ok.elements.map((e) => e.kind)).toEqual(["polariser", "hwp", "qwp", "polariser"]);
    expect(ok.ok && ok.elements[2].angleDeg).toBe(-45);
  });
  test("propagate refuses zero and non-finite inputs", () => {
    expect(propagate([cx(0), cx(0)], [])).toBeNull();
    expect(propagate([cx(NaN), cx(0)], [])).toBeNull();
    expect(propagate([cx(Infinity), cx(0)], [])).toBeNull();
  });
  test("readComplex", () => {
    const v = (t: string) => {
      const r = readComplex(t, "E");
      return r.ok ? [r.z.re, r.z.im] : null;
    };
    expect(v("1")).toEqual([1, 0]);
    expect(v("−0.5")).toEqual([-0.5, 0]);
    expect(v("0.5i")).toEqual([0, 0.5]);
    expect(v("-i")).toEqual([0, -1]);
    expect(v("1+i")).toEqual([1, 1]);
    expect(v("0.6 − 0.8i")).toEqual([0.6, -0.8]);
    expect(v("2j")).toEqual([0, 2]);
    for (const t of ["", "x", "1+2", "i2i", "1++i", "NaN", "1e400"]) expect(v(t)).toBeNull();
  });
});

// ------------------------------------------------------------- calculators

const run = (id: string, over: Record<string, string> = {}) => {
  const c = FILM_CALCS.find((x) => x.id === id)!;
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
};

/** The display contract as the insert gate and the user see it. */
function contract(text: string) {
  expect(text).not.toMatch(/—/); // em dash = the non-finite sentinel
  expect(text).not.toMatch(/NaN|Infinity|undefined|not finite/);
  expect(text).not.toMatch(/\d[eE][+-]?\d/); // e-notation
  expect(text).not.toMatch(/\^/);
  expect(text).not.toMatch(/(^|[\s(=,:])-\d/m); // hyphen-minus as a sign
}

describe("FILM_CALCS", () => {
  test("shape: three Optics & photonics calculators with unique ids", () => {
    expect(FILM_CALCS.map((c) => c.id)).toEqual(["optics-fresnel", "optics-thin-film", "optics-jones"]);
    for (const c of FILM_CALCS) {
      expect(c.group).toBe("Optics & photonics");
      expect(c.hint.length).toBeGreaterThan(40);
      for (const f of c.fields) expect(["text", "block", "select"]).toContain(f.kind);
    }
  });
  test.each(FILM_CALCS.map((c) => c.id))("%s at its defaults: ok, draws a figure, contract-clean", (id) => {
    const out = run(id);
    expect(out.ok).not.toBe(false);
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    expect(plots.length).toBeGreaterThanOrEqual(1);
    for (const p of plots) {
      if (p.kind !== "plot") continue;
      expect(p.svg.startsWith("<svg")).toBe(true);
      expect(p.svg).toMatch(/<text/);
      expect(p.svg).not.toMatch(/NaN|Infinity/);
      expect(p.w).toBeGreaterThan(100);
      expect(p.h).toBeGreaterThan(100);
      // The block's size is the size the builder actually drew at (legend gutters widen plot.ts canvases).
      const m = /^<svg[^>]*\swidth="([\d.]+)"/.exec(p.svg);
      expect(Number(m![1])).toBe(p.w);
      contract(p.caption);
    }
    contract(out.text);
  });

  test("every option of every select field at otherwise-default inputs: ok, draws, contract-clean", () => {
    for (const c of FILM_CALCS) {
      for (const f of c.fields.filter((x) => x.kind === "select")) {
        for (const o of f.options ?? []) {
          const out = run(c.id, { [f.key]: o.value });
          expect(out.ok).not.toBe(false);
          expect((out.blocks ?? []).some((b) => b.kind === "plot")).toBe(true);
          contract(out.text);
        }
      }
    }
  });
  test("Thin film: a thick layer is flagged as undersampled; the default is not", () => {
    expect(run("optics-thin-film", { layers: "1.5 1000000" }).text).toMatch(/UNDERSAMPLED/);
    expect(run("optics-thin-film").text).not.toMatch(/UNDERSAMPLED/);
  });
  test("Fresnel: Brewster from refraction(), Rp = 0 there; TIR beyond critical", () => {
    const ref = refraction(1, 1.52, 0)!;
    const out = run("optics-fresnel", { th: String(ref.brewsterDeg) });
    expect(out.text).toMatch(/Rp = 0 %/);
    expect(out.text).toContain("Brewster angle");
    const tir = run("optics-fresnel", { n1: "1.5", n2: "1.0", th: "60" });
    expect(tir.text).toMatch(/totally internally reflected/);
    expect(tir.text).toMatch(/Rs = 100 %/);
    expect(tir.text).toMatch(/Ts = 0 %/);
    expect(tir.text).toMatch(/Critical angle\s+41\.81°/);
    contract(tir.text);
    const metal = run("optics-fresnel", { n2: "0.05+3.4i", th: "70" });
    expect(metal.text).toMatch(/Pseudo-Brewster/);
    expect(metal.text).toMatch(/none \(absorbing second medium\)/);
    contract(metal.text);
  });
  test("Fresnel refusals", () => {
    for (const over of <Record<string, string>[]>[
      { n1: "1+0.1i" },
      { n2: "0.05-3.4i" },
      { n2: "" },
      { th: "90" },
      { th: "-5" },
      { th: "abc" },
      { n1: "0" },
      { th: "Infinity" },
    ]) {
      const out = run("optics-fresnel", over);
      expect(out.ok).toBe(false);
      expect(out.text).not.toMatch(/NaN|undefined/);
    }
  });

  test("Thin film: default single MgF₂ QW AR gives the closed form at 550 nm", () => {
    const out = run("optics-thin-film", { pol: "s" });
    const closed = ((1.52 - 1.38 ** 2) / (1.52 + 1.38 ** 2)) ** 2;
    expect(out.text).toContain(`R = ${Number((closed * 100).toPrecision(4))} %`);
    expect(out.text).toMatch(/Uncoated substrate .* R = 4\.258 %/);
  });
  test("Thin film: mirror via repeat, absorbing layers draw A, oblique avg shows s and p", () => {
    const out = run("optics-thin-film", { layers: "repeat 4\nH 2.35 QW\nL 1.38 QW\nend\nH 2.35 QW", lmin: "400", lmax: "750" });
    expect(out.text).toMatch(/R = 98\.46 %/);
    contract(out.text);
    const abs = run("optics-thin-film", { layers: "Ag 0.05+3.4i 40 nm", th: "45" });
    expect(abs.text).toMatch(/s: R = .* p: R = /);
    const p = abs.blocks!.find((b) => b.kind === "plot");
    expect(p && p.kind === "plot" && p.svg).toMatch(/>A</);
    contract(abs.text);
    const bare = run("optics-thin-film", { layers: "" });
    expect(bare.text).toMatch(/no layers were given/);
    const opaque = run("optics-thin-film", { layers: "Au 0.2+3.5i 1 mm".replace("1 mm", "1000000") });
    expect(opaque.text).toMatch(/optically opaque/);
    contract(opaque.text);
  });
  test("Thin film refusals", () => {
    for (const over of <Record<string, string>[]>[
      { n0: "1+0.2i" },
      { ns: "1.52-0.1i" },
      { lam0: "0" },
      { lmin: "800", lmax: "400" },
      { lmin: "500", lmax: "500" },
      { th: "90" },
      { layers: "MgF2 1.38 100 mn" },
      { layers: "MgF2 QW" },
      { lam0: "abc" },
    ]) {
      const out = run("optics-thin-film", over);
      expect(out.ok).toBe(false);
    }
  });

  test("Jones: default QWP 45 gives left-handed circular and states the convention", () => {
    const out = run("optics-jones");
    expect(out.text).toMatch(/Output state: left-handed circular/);
    expect(out.text).toMatch(/IEEE/);
    expect(out.text).toMatch(/S₃ = −1/);
  });
  test("Jones: Malus line, crossed polarisers draw 'no light', custom elliptical input", () => {
    const m = run("optics-jones", { elements: "polariser 0\npolariser 60" });
    expect(m.text).toMatch(/Malus's law.*0\.25 \(the Jones result above is 0\.25\)/);
    const x = run("optics-jones", { elements: "polariser 0\npolariser 90" });
    expect(x.ok).not.toBe(false);
    expect(x.text).toMatch(/No light is transmitted/);
    const p = x.blocks!.find((b) => b.kind === "plot");
    expect(p && p.kind === "plot" && p.svg).toMatch(/no light/);
    contract(x.text);
    const c = run("optics-jones", { input: "custom", ex: "1", ey: "0.5i", elements: "retarder 30 60\nrotator 15" });
    expect(c.text).toMatch(/left-handed elliptical, azimuth 8\.74°/);
    contract(c.text);
    const r = run("optics-jones", { input: "right", elements: "hwp 10" });
    expect(r.text).toMatch(/Output state: left-handed circular/);
    const none = run("optics-jones", { elements: "" });
    expect(none.text).toMatch(/No elements/);
  });
  test("Jones refusals", () => {
    for (const over of <Record<string, string>[]>[
      { input: "custom", ex: "0", ey: "0" },
      { input: "custom", ex: "abc" },
      { angle: "x" },
      { elements: "mirror 10" },
      { elements: "retarder 10" },
    ]) {
      expect(run("optics-jones", over).ok).toBe(false);
    }
  });
});

describe("review fixes (integration)", () => {
  test("absorbing substrate: T is labelled as entering the substrate, A as layers only, in text and legend", () => {
    const out = run("optics-thin-film", { ns: "0.05+3.4i" });
    expect(out.text).toMatch(/T into the substrate = \d/);
    expect(out.text).toMatch(/A in the layers = 0 %/);
    expect(out.text).toMatch(/absorbed there/);
    const p = out.blocks!.find((b) => b.kind === "plot");
    expect(p && p.kind === "plot" && p.svg).toMatch(/T into the substrate/);
    expect(p && p.kind === "plot" && p.svg).not.toMatch(/>A</);
    contract(out.text);
    // A lossless substrate keeps the plain labels.
    expect(run("optics-thin-film").text).toMatch(/ T = 98\.74 %/);
  });
  test("extremes include λ₀; the undersampling note names the real cause", () => {
    const out = run("optics-thin-film", { ns: "0.05+3.4i", lmin: "1", lmax: "10000000" });
    const r0 = /R = ([\d.]+) %/.exec(out.text)![1];
    const lo = /lowest R = ([\d.]+) %/.exec(out.text)![1];
    expect(Number(lo)).toBeLessThanOrEqual(Number(r0));
    expect(out.text).toMatch(/UNDERSAMPLED/);
    expect(out.text).toMatch(/range is too wide for the grid/);
    expect(out.text).not.toMatch(/optically thick/);
    const thick = run("optics-thin-film", { layers: "1.5 1000000" });
    expect(thick.text).toMatch(/optically thick/);
  });
  test("Jones: 89.99995° is echoed as typed and its REAL 7.6×10⁻¹³ transmission is reported with its state", () => {
    const out = run("optics-jones", { elements: `polariser 0
polariser 89.99995` });
    expect(out.text).toContain("axis 89.99995°");
    expect(out.text).not.toMatch(/axis 90°/);
    expect(out.text).not.toMatch(/No light/);
    expect(out.text).toMatch(/I\/I₀ = 7\.6154\d*×10⁻¹³/);
    expect(out.text).toMatch(/Output state: linear at 89\.99995°/);
    expect(out.text).toMatch(/azimuth ψ = 89\.99995°/);
    expect(out.text).toMatch(/Malus's law.*7\.6154\d*×10⁻¹³/);
    const p = out.blocks!.find((b) => b.kind === "plot");
    expect(p && p.kind === "plot" && p.svg).not.toMatch(/no light/);
    contract(out.text);
    expect(run("optics-jones", { elements: `polariser 0
polariser 89.99999` }).text).toMatch(/Output state: linear at 89\.99999°/);
  });
  test("Jones: exactly crossed polarisers are 'no light' (I is rounding, ~10⁻³³ or 0)", () => {
    const out = run("optics-jones", { input: "linear", angle: "0", elements: `polariser 0
polariser 90` });
    expect(out.text).toMatch(/No light is transmitted/);
    expect(out.text).not.toMatch(/Output state:/);
    const p = out.blocks!.find((b) => b.kind === "plot");
    expect(p && p.kind === "plot" && p.svg).toMatch(/no light/);
    const tilted = run("optics-jones", { angle: "30", elements: `polariser 30
polariser 120` });
    expect(tilted.text).toMatch(/No light is transmitted/);
    contract(out.text);
    contract(tilted.text);
    // 1° off crossed is real light and keeps its state.
    expect(run("optics-jones", { elements: `polariser 0
polariser 89` }).text).toMatch(/Output state: linear at 89°/);
  });
  test("Jones: tiny but valid amplitudes normalise (scaled before squaring)", () => {
    const r = propagate([cx(1e-200), cx(0)], []);
    expect(r).not.toBeNull();
    expect(r!.input[0].re).toBe(1);
    const out = run("optics-jones", { input: "custom", ex: "1e-200", ey: "1e-200i", elements: "" });
    expect(out.ok).not.toBe(false);
    expect(out.text).toMatch(/right-handed circular/);
  });
  test("Fresnel k = 1e-9: the pseudo-Brewster minimum is printed in significant figures, not 0 %", () => {
    const out = run("optics-fresnel", { n2: "1.52+0.000000001i" });
    const m = /minimum Rp = ([^)]*) %\)/.exec(out.text)!;
    expect(m[1]).not.toBe("0");
    expect(m[1]).toMatch(/×10⁻/);
    contract(out.text);
  });
});

describe("polarisationEllipseSvg", () => {
  test("arrow direction follows S₃: counter-clockwise (screen y down) for right-handed", () => {
    const svg = polarisationEllipseSvg([{ title: "R", vec: RIGHT_CIRCULAR, lines: ["a"], colour: "#2563eb" }]);
    expect(svg).toMatch(/<polygon/);
    const lin = polarisationEllipseSvg([{ title: "L", vec: linearState(30), lines: ["a"], colour: "#2563eb" }]);
    expect(lin).not.toMatch(/<polygon/);
    const none = polarisationEllipseSvg([{ title: "0", vec: [cx(0), cx(0)], lines: [], colour: "#2563eb" }]);
    expect(none).toMatch(/no light/);
  });
});

// ------------------------------------------------- review probes, rounds 1–3

/** Reads a qNum-formatted number back ("3.04617×10⁻¹⁶", "−0.5"). */
function readQ(t: string): number {
  const sup: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-" };
  const m = /^(−?[\d.]+)(?:×10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+))?$/.exec(t.trim());
  if (!m) return NaN;
  const e = m[2] ? Number([...m[2]].map((c) => sup[c]).join("")) : 0;
  return Number(m[1].replace("−", "-")) * 10 ** e;
}
const d2r = (d: number) => (d * Math.PI) / 180;
const LONG = (() => {
  const many = Array.from({ length: 40 }, (_, i) => "qwp " + ((17.3 * i) % 180).toFixed(3));
  const back = [...many].reverse().map((l) => l.replace(/qwp (\S+)/, (_m, a) => "qwp " + ((+a + 90) % 180).toFixed(3)));
  return ["pol 0", ...many, ...back, "pol 90"].join("\n");
})();

// [elements, expected I/I₀ from closed form (null = analytically dark), expected output azimuth text or null]
// Input: linear 0° (the default). Oracles: Malus cos²; two HWPs at a, b rotate by 2(b − a); QWP pairs.
const JONES_PROBES: [string, number | null, string | null][] = [
  ["pol 90", null, null],
  ["pol 0\npol 90", null, null],
  ["qwp 45\nqwp 45\npol 0", null, null],
  ["hwp 22.5\nhwp 22.5\npol 0", 1, "linear at 0°"],
  ["pol 30\npol 120", null, null],
  ["pol 33.3\nhwp 11.1\nhwp 56.1\npol 33.3", null, null],
  [LONG, null, null],
  ["pol 12.345\nqwp 67.89\nqwp 67.89\nhwp 12.345\npol 102.345", Math.cos(d2r(12.345)) ** 2 * Math.cos(d2r(21.09)) ** 2, "linear at −77.655°"],
  ["pol 45\nqwp 0\nqwp 0\npol 45", null, null],
  ["pol 89.999999", Math.sin(d2r(1e-6)) ** 2, "linear at 89.999999°"],
  ["pol 89.9999999", Math.sin(d2r(1e-7)) ** 2, "linear at 89.9999999°"],
  ["pol 89.99995", Math.sin(d2r(5e-5)) ** 2, "linear at 89.99995°"],
  ["pol 89.9999", Math.sin(d2r(1e-4)) ** 2, "linear at 89.9999°"],
  ["pol 0.00001", Math.cos(d2r(1e-5)) ** 2, "linear at 1×10⁻⁵°"],
  ["pol 0\npol 89.999999", Math.sin(d2r(1e-6)) ** 2, "linear at 89.999999°"],
  ["pol 45\npol 134.99999", 0.5 * Math.sin(d2r(1e-5)) ** 2, "linear at −45.00001°"],
];

describe("review probes (rounds 1–3): Jones", () => {
  test.each(JONES_PROBES.map((c, i) => [i, ...c] as const))("probe %i", (_i, elements, want, state) => {
    const out = run("optics-jones", { elements });
    contract(out.text);
    const iLine = /Transmitted intensity I\/I₀ = (0 \(below the 10⁻²⁸ rounding level\)|\S+)/.exec(out.text)!;
    const plot = out.blocks!.find((b) => b.kind === "plot");
    if (want === null) {
      expect(iLine[1]).toBe("0 (below the 10⁻²⁸ rounding level)");
      expect(out.text).toMatch(/No light is transmitted/);
      expect(out.text).not.toMatch(/Output state:/);
      expect(out.text).toMatch(/Stokes, output: S₀ = S₁ = S₂ = S₃ = 0/);
      expect(plot && plot.kind === "plot" && plot.svg).toMatch(/no light/);
      // No rounding noise anywhere: every intensity on the page is the same "0 (below …)".
      expect(out.text).not.toMatch(/×10⁻(2[89]|[3-9]\d)/);
    } else {
      expect(Math.abs(readQ(iLine[1]) / want - 1)).toBeLessThan(1e-5);
      expect(out.text).toContain(`Output state: ${state}`);
      expect(out.text).not.toMatch(/No light/);
    }
    // The Malus line, when present, prints the SAME text as the Jones line.
    const malus = /Malus's law[^:]*: (.*) \(the Jones result above is (.*)\)\./.exec(out.text);
    if (malus) expect(malus[1]).toBe(malus[2]);
  });
  test("Ex = 1e-200 normalises; 89.99999 is echoed as typed", () => {
    expect(run("optics-jones", { input: "custom", ex: "1e-200", ey: "1e-200i", elements: "" }).text).toMatch(/right-handed circular/);
    expect(run("optics-jones", { elements: "pol 89.99999" }).text).toContain("axis 89.99999°");
  });
});

test("round 4: the figure uses the text's DARK threshold (3×10⁻²⁰ is drawn, normalised, with its intensity)", () => {
  const out = run("optics-jones", { elements: `pol 0
pol 89.99999999` });
  expect(out.text).toMatch(/Output state: linear at 89\.99999999°/);
  const p = out.blocks!.find((b) => b.kind === "plot");
  const svg = p && p.kind === "plot" ? p.svg : "";
  expect(svg).not.toMatch(/no light/);
  expect(svg).toMatch(/I\/I₀ = 3\.046×10⁻²⁰/);
  expect((svg.match(/<path /g) ?? []).length).toBe(2); // input and output ellipses both drawn
  // Below DARK the panel still says no light.
  const dark = run("optics-jones", { elements: `pol 0
pol 90` });
  const q = dark.blocks!.find((b) => b.kind === "plot");
  expect(q && q.kind === "plot" && q.svg).toMatch(/no light/);
  // A tiny but non-zero vector is drawn by the builder itself.
  expect(polarisationEllipseSvg([{ title: "t", vec: [cx(1e-200), cx(0, 1e-200)], lines: [], colour: "#2563eb" }])).not.toMatch(/no light/);
});

describe("review probes (rounds 1–3): films", () => {
  test.each([
    ["absorbing substrate labels T and A", "optics-thin-film", { ns: "0.05+3.4i" }, [/T into the substrate = \d/, /A in the layers = 0 %/, /absorbed there/]],
    ["1–10⁷ nm blames the range, not the layer", "optics-thin-film", { ns: "0.05+3.4i", lmin: "1", lmax: "10000000" }, [/range is too wide for the grid/]],
    ["a 1 mm layer is optically thick", "optics-thin-film", { layers: "1.5 1000000" }, [/optically thick/]],
    ["k = 1e-9: minimum Rp in significant figures", "optics-fresnel", { n2: "1.52+0.000000001i" }, [/minimum Rp = [\d.]+×10⁻[⁰¹²³⁴⁵⁶⁷⁸⁹]+ %/]],
  ] as [string, string, Record<string, string>, RegExp[]][])("%s", (_n, id, over, pats) => {
    const out = run(id, over);
    contract(out.text);
    for (const p of pats) expect(out.text).toMatch(p);
  });
  test("extremes include λ₀ (lowest R ≤ R at λ₀ ≤ highest R)", () => {
    const out = run("optics-thin-film", { ns: "0.05+3.4i", lmin: "1", lmax: "10000000" });
    const r0 = Number(/ R = ([\d.]+) %/.exec(out.text)![1]);
    expect(Number(/lowest R = ([\d.]+) %/.exec(out.text)![1])).toBeLessThanOrEqual(r0);
    expect(Number(/highest R = ([\d.]+) %/.exec(out.text)![1])).toBeGreaterThanOrEqual(r0);
  });
  test("qNum reader round-trips", () => {
    expect(readQ(qNum(3.0461741978670857e-16, 6))).toBeCloseTo(3.04617e-16, 21);
  });
});
