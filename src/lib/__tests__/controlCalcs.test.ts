// The control-design calculators exactly as the pane registers them (CONTROL_CALCS):
// shape, the display contract on every output (defaults AND adversarial input),
// typeset formulas that actually parse, figures whose declared size is their own,
// and time budgets on order-20 input (the pane recomputes on every keystroke).
//
// Numbers pinned here come from scipy.signal 1.18.1 (oracle lines inline) or from
// closed forms; the engine-level oracle suite is controlDesign.test.ts.

import { CONTROL_CALCS, clean, ratPolyDisplay, numPolyDisplay } from "../controlCalcs";
import { mathToOmml } from "../mathOmml";
import { ratInt, ratMake } from "../cas";
import type { AnalyzeOutput } from "../analyzeBlocks";

const byId = Object.fromEntries(CONTROL_CALCS.map((c) => [c.id, c]));

function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = byId[id];
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}

// The display contract, as the insert gate and the house rules state it.
const FORBIDDEN = /\^|\d[eE][+-]?\d|NaN|Infinity|undefined|—/;
function contract(o: AnalyzeOutput): void {
  const m = FORBIDDEN.exec(o.text);
  if (m) throw new Error(`contract: "${m[0]}" in …${o.text.slice(Math.max(0, m.index - 40), m.index + 40)}…`);
  // a sign hyphen before a digit (" -3", "(-1", "= -2") is never allowed in prose
  const hy = /(^|[\s(=,;:[])-(?=\.?\d)/m.exec(o.text);
  if (hy) throw new Error(`hyphen-minus: …${o.text.slice(Math.max(0, hy.index - 30), hy.index + 30)}…`);
}

const ORDER20 = "1 20 190 1140 4845 15504 38760 77520 125970 167960 184756 167960 125970 77520 38760 15504 4845 1140 190 20 1";

const ADVERSARIAL: Array<[string, Record<string, string>]> = [
  ["control-rlocus", { num: "s+1", den: "s^2" }],
  ["control-rlocus", { num: "1", den: "s^2+1" }],
  ["control-rlocus", { num: "-s+1", den: "s+1" }],
  ["control-rlocus", { num: "1", den: ORDER20 }],
  ["control-rlocus", { num: "1e400", den: "s^2+1" }],
  ["control-rlocus", { num: "1", den: "s^3+3*s^2+2*s", k: "-1" }],
  ["control-rlocus", { num: "1", den: "s^3+3*s^2+2*s", k: "abc" }],
  ["control-rlocus", { num: "0", den: "s+1" }],
  ["control-rlocus", { num: "s^3", den: "s+1" }],
  ["control-rlocus", { num: "", den: "" }],
  ["control-rlocus", { num: "(s+1)", den: "s^2" }],
  ["control-rlocus", { num: "0.000001", den: "s^2+0.000002*s+0.000001" }],
  ["control-rlocus", { num: "1000000", den: "s^3+3000*s^2+2000000*s" }],
  ["control-rlocus", { num: "s+3", den: "s^4+7*s^3+14*s^2+8*s", k: "9.6" }],
  ["control-nyquist", { num: "1", den: "s^2" }],
  ["control-nyquist", { num: "1", den: "s^4+2*s^2+1" }],
  ["control-nyquist", { num: "s+2", den: "s^2-1" }],
  ["control-nyquist", { num: "6", den: "s^3+3*s^2+2*s" }],
  ["control-nyquist", { num: "1", den: ORDER20 }],
  ["control-nyquist", { num: "s^2", den: "s+1" }],
  ["control-nyquist", { num: "1e300", den: "s^2+s" }],
  ["control-leadlag", { pm: "89" }],
  ["control-leadlag", { pm: "abc" }],
  ["control-leadlag", { pm: "" }],
  ["control-leadlag", { pm: "50", err: "-5" }],
  ["control-leadlag", { kind: "lag", num: "1", den: "0.5*s^3+1.5*s^2+s", err: "5", pm: "40" }],
  ["control-leadlag", { kind: "lag", num: "1", den: "s^2+2*s+1", err: "10", pm: "45", wc: "3" }],
  ["control-leadlag", { pm: "50", err: "", wc: "9" }],
  ["control-leadlag", { pm: "50", err: "", wc: "0.01" }],
  ["control-leadlag", { num: "1", den: "s^2", pm: "45", err: "" }],
  ["control-leadlag", { num: "1", den: ORDER20, pm: "45", err: "" }],
  ["control-c2d", { T: "0" }],
  ["control-c2d", { T: "-1" }],
  ["control-c2d", { T: "1e-9" }],
  ["control-c2d", { T: "1000" }],
  ["control-c2d", { num: "1", den: "s-1", T: "0.1" }],
  ["control-c2d", { num: "1", den: "s-1", T: "1000" }],
  ["control-c2d", { method: "tustin" }],
  ["control-c2d", { method: "tustin", prewarp: "2" }],
  ["control-c2d", { method: "tustin", prewarp: "100" }],
  ["control-c2d", { method: "matched", num: "1", den: "s^2+s" }],
  ["control-c2d", { num: "1", den: "s^2+100", T: "0.5" }],
  ["control-c2d", { samples: "1.5" }],
  ["control-c2d", { samples: "100000" }],
  ["control-c2d", { num: "1", den: ORDER20, T: "0.1" }],
];

describe("CONTROL_CALCS shape", () => {
  test("four calculators, unique ids, all in the existing 'Control systems' group, pane field kinds", () => {
    expect(CONTROL_CALCS.map((c) => c.id)).toEqual(["control-rlocus", "control-nyquist", "control-leadlag", "control-c2d"]);
    for (const c of CONTROL_CALCS) {
      expect(c.group).toBe("Control systems");
      expect(c.hint.length).toBeGreaterThan(40);
      for (const f of c.fields) expect(["text", "select", "block"]).toContain(f.kind);
      // the plant is typed with the same keys as the existing four control tools
      expect(c.fields.map((f) => f.key)).toEqual(expect.arrayContaining(["num", "den"]));
    }
  });
});

describe("every calculator returns data AND a figure at its defaults", () => {
  test.each(CONTROL_CALCS.map((c) => c.id))("%s", (id) => {
    const o = run(id);
    expect(o.ok).not.toBe(false);
    contract(o);
    const plots = (o.blocks ?? []).filter((b) => b.kind === "plot");
    expect(plots.length).toBeGreaterThanOrEqual(1);
    for (const p of plots) {
      if (p.kind !== "plot") continue;
      expect(p.svg.startsWith("<svg")).toBe(true);
      expect(p.svg).not.toMatch(/NaN|Infinity|undefined/);
      // the declared size is the SVG's own (a legend outside the frame widens it)
      const head = /^<svg[^>]*>/.exec(p.svg)![0];
      expect(Number(/\swidth="([\d.]+)"/.exec(head)![1])).toBe(p.w);
      expect(Number(/\sheight="([\d.]+)"/.exec(head)![1])).toBe(p.h);
      expect(p.caption).not.toMatch(/—/);
    }
    // every typeset formula must parse, or the document gets the fallback text instead
    for (const b of o.blocks ?? []) if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
  });
});

describe("display contract under adversarial input", () => {
  test.each(ADVERSARIAL)("%s %j", (id, over) => {
    const t0 = Date.now();
    const o = run(id, over);
    expect(Date.now() - t0).toBeLessThan(4000);
    contract(o);
    for (const b of o.blocks ?? []) {
      if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
      if (b.kind === "plot") expect(b.svg).not.toMatch(/NaN|Infinity|undefined/);
    }
    if (o.ok !== false) expect((o.blocks ?? []).some((b) => b.kind === "plot")).toBe(true);
  });
});

describe("pinned results through the pane objects", () => {
  test("root locus default + K = 6 marker: crossing at K = 6, omega = sqrt 2, stable for 0 < K < 6", () => {
    const o = run("control-rlocus", { k: "6" });
    expect(o.text).toContain("s = ±j√2 ≈ 1.414 rad/s at K = 6");
    expect(o.text).toContain("confirmed");
    expect(o.text).toContain("STABLE for 0 < K < 6");
    expect(o.text).toContain("centroid σ = −1");
    expect(o.text).toContain("s = −0.4226 at K = 0.3849");
    expect(o.text).toMatch(/MARGINALLY STABLE/); // poles on the axis at exactly K = 6
  });

  test("Nyquist default: N = 0, P = 0, Z = 0, agreeing with the closed loop; K = 10 gives Z = 2", () => {
    expect(run("control-nyquist").text).toContain("Z = N + P = 0");
    const o = run("control-nyquist", { num: "10" });
    expect(o.text).toContain("Z = N + P = 2");
    expect(o.text).toContain("AGREES");
  });

  test("lead default prints the verified C(s) and the scipy-checked margin", () => {
    const o = run("control-leadlag");
    expect(o.text).toContain("C(s) = (2.268s + 10)/(0.0563s + 1)");
    // scipy brentq on |C G| = 1: PM 49.767611 deg at 8.849037 rad/s
    expect(o.text).toContain("49.77° at 8.849 rad/s after");
    expect(o.text).toContain("Kv: 2 before, 20 after");
    // pasteable into the other control tools exactly as typed there
    expect(o.text).toContain("numerator 2.268 10; denominator 0.0563 1");
  });

  test("c2d default (ZOH, T = 0.2) matches scipy: num [0, 0.06941299, 0.06071468], den [1, -1.54019237, 0.67032005]", () => {
    const o = run("control-c2d");
    expect(o.text).toContain("Gd(z) = (0.069413z + 0.060715)/(z² − 1.5402z + 0.67032)");
    expect(o.text).toContain("final value Gd(1) = 1");
    expect(o.text).toMatch(/integration error only/);
    expect(run("control-c2d", { prewarp: "2" }).text).toContain("applies to Tustin only");
  });

  test("Tustin with rational T prints exact coefficients", () => {
    const o = run("control-c2d", { num: "1", den: "s^2+s", T: "0.5", method: "tustin" });
    expect(o.text).toContain("Gd(z) = (0.05z² + 0.1z + 0.05)/(z² − 1.6z + 0.6)");
    expect(o.text).toContain("exact");
  });
});

describe("formatting helpers", () => {
  test("clean(): e-notation, carets, +/- and sign hyphens", () => {
    expect(clean("x = 1.5e-3 and s^2, +/- 2, = -4")).toBe("x = 1.5×10⁻³ and s², ± 2, = −4");
    expect(clean("STABLE — every pole")).toBe("STABLE: every pole");
  });
  test("polynomials: superscripts in text, carets only in the math source; fractions parenthesised", () => {
    const d = ratPolyDisplay([ratInt(1), ratMake(-1n, 3n), ratInt(0), ratInt(2)]);
    expect(d.text).toBe("s³ − (1/3)s² + 2");
    expect(d.math).toBe("s^3 - (1/3)s^2 + 2");
    expect(numPolyDisplay([1, -0.000012345, 0.5]).text).toBe("z² − 1.2345×10⁻⁵z + 0.5");
    expect(numPolyDisplay([1, -0.000012345, 0.5]).math).toBe("z^2 - 0.000012345z + 0.5");
  });
});

describe("review round 1: display", () => {
  test("a negative constant numerator prints '− K', not '+ −1K'", () => {
    const o = run("control-rlocus", { num: "-1", den: "s^2+2*s+2" });
    expect(o.text).toContain("Characteristic equation: s² + 2s + 2 − K = 0");
    expect(o.text).toContain("On the real axis: the whole real axis");
    expect(run("control-rlocus", { num: "-3", den: "s^2+1" }).text).toContain("s² + 1 − 3K = 0");
  });
  test("(s+1)^5 prints its poles as −1, five times, and the segment as s ≤ −1", () => {
    const o = run("control-rlocus", { num: "1", den: "1 5 10 10 5 1" });
    expect(o.text).toContain("Open-loop poles (n = 5): −1, −1, −1, −1, −1");
    expect(o.text).toContain("On the real axis: s ≤ −1");
  });
  test("1/s^4 carries no 'ON the imaginary axis' note", () => {
    expect(run("control-rlocus", { num: "1", den: "s^4" }).text).not.toMatch(/ON the imaginary axis/);
  });
  test("lead on an unstable-closed-loop plant never prints 'Target met'", () => {
    const o = run("control-leadlag", { num: "1", den: "s^3", err: "" });
    expect(o.text).not.toMatch(/Target met/);
    const o2 = run("control-leadlag", { kind: "lag", num: "3*s-9", den: "s^3+s^2-2*s+5", err: "", pm: "45" });
    if (o2.ok !== false && /NOT STABLE|UNSTABLE/.test(o2.text)) expect(o2.text).not.toMatch(/Target met/);
  });
});
