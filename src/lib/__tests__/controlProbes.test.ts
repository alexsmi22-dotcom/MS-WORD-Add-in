// CUMULATIVE GATE for the control-design tools: every probe input the independent
// reviewers used in rounds 1–3 (scratchpad review-control-titration, review-round2,
// review-round3) is pinned here with its settled outcome, so none can silently regress.
//
// The fixture (fixtures/controlProbes.json) was generated from the implementation the
// round-3 review confirmed right (margins vs numpy on 22 plants, exact breakaways and
// crossings, Nyquist N/P/Z, c2d vs scipy). Sources inside it:
//   c2d      review-control-titration/c2d.json: scipy.signal.cont2discrete coefficients
//            (the reviewer's oracle, compared here directly, not regenerated)
//   margins  review-round2/orc.json, review-round3/orc.json: numpy crossing scan. Three
//            plants where the scan MISSED a crossing are pinned to the closed form instead:
//              type1_4 50/(s(s+1)(s+2)(s+3)): at w = 1 the phase is
//                -90-45-26.565-18.435 = -180 exactly and |L| = 50/10 = 5 -> GM -13.979 dB
//              lowk_4 0.5/(s+1)^4: at w = 1 phase -180, |L| = 0.5/4 -> GM +18.062 dB
//              touch 2/(s(s+1)^2): L(j1) = 2/(j(2j)) = -1 -> PM 0 and GM 0 at w = 1
//            (a sample landing exactly on the crossing defeats a sign-change scan).
//   rlocus / nyquist / leadlag  review-round2 rlc*.json, ll.json; review-round3 rs*.json,
//            ny.json, llh*.json: the outcomes as verified in rounds 2–3.
// The 300-plant root-locus fuzz is the reviewer's t3/t3x generator, verbatim.

import * as fs from "fs";
import * as path from "path";
import { parseTf, margins, Margins } from "../control";
import { rootLocus, nyquist, c2d, expm, RootLocusResult, NyquistResult, C2dResult } from "../controlDesign";
import { CONTROL_CALCS } from "../controlCalcs";

const FX: { rlocus: any[]; nyquist: any[]; leadlag: any[]; c2d: any[]; margins: any[] } = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "controlProbes.json"), "utf8"));
const rs = (q: { n: bigint; d: bigint } | null): string | null => (q ? `${q.n}/${q.d}` : null);
const r6 = (v: number | null): number | string | null =>
  v === null ? null : Number.isFinite(v) ? Number(v.toPrecision(6)) : String(v);
const tf = (n: string, d: string) => {
  const r = parseTf(n, d);
  if ("ok" in r) throw new Error(r.error);
  return r;
};
// Per probe, under ts-jest on a machine shared with other test runs. Measured standalone:
// <= 200 ms for every probe and tool at its cap; the freezes these guard against were
// 5–74 s, so a generous jest budget still catches them.
const PROBE_MS = 1500;

describe("cumulative gate: root locus probes (rounds 1–3)", () => {
  test.each(FX.rlocus.map((o: { num: string; den: string }) => [`${o.num} / ${o.den}`, o] as [string, any]))("%s", (_name, o: any) => {
    const t0 = Date.now();
    const p = parseTf(o.num, o.den);
    if ("ok" in p) {
      expect(o.refused).toBeDefined();
      return;
    }
    const r = rootLocus(p);
    expect(Date.now() - t0).toBeLessThan(PROBE_MS);
    if (!r.ok) {
      expect(o.refused).toBeDefined();
      return;
    }
    const rl = r as RootLocusResult;
    expect(rl.crossings.map((x) => ({ K: r6(x.K), kExact: rs(x.kExact), routh: x.routhConfirmed, irr: x.w2Irrational }))).toEqual(o.crossings);
    expect(rl.breakaways.map((b) => ({ s: rs(b.sExact) ?? r6(b.s.re), im: r6(b.s.im), K: rs(b.kExact) ?? r6(b.K) }))).toEqual(o.breakaways);
    expect(rl.realSegments.map((s) => [r6(s.from), r6(s.to)])).toEqual(o.segments);
    expect(rl.stableRanges.map((s) => [r6(s.lo), r6(s.hi)])).toEqual(o.stable);
    expect(rl.jwAxisLocus).toBe(o.jwAxis);
  });
});

describe("cumulative gate: Nyquist probes", () => {
  test.each(FX.nyquist.map((o: { num: string; den: string }) => [`${o.num} / ${o.den}`, o] as [string, any]))("%s", (_name, o: any) => {
    const t0 = Date.now();
    const r = nyquist(tf(o.num, o.den));
    expect(Date.now() - t0).toBeLessThan(PROBE_MS);
    if (!r.ok) {
      expect(o.refused).toBeDefined();
      return;
    }
    const ny = r as NyquistResult;
    expect({ P: ny.P, N: ny.N, Z: ny.Z, agree: ny.agree, verdict: ny.verdict.split(/[ .:]/)[0] }).toEqual({
      P: o.P,
      N: o.N,
      Z: o.Z,
      agree: o.agree,
      verdict: o.verdict,
    });
  });
});

describe("cumulative gate: lead/lag probes (never 'Target met' unless the closed loop is stable)", () => {
  const ll = CONTROL_CALCS.find((c) => c.id === "control-leadlag")!;
  test.each(FX.leadlag.map((o: { ov: Record<string, string> }, i: number) => [i, JSON.stringify(o.ov).slice(0, 90), o] as [number, string, any]))(
    "#%i %s",
    (_i, _name, o: any) => {
      const v: Record<string, string> = Object.fromEntries(ll.fields.map((f) => [f.key, f.default]));
      Object.assign(v, o.ov);
      const t0 = Date.now();
      const out = ll.compute((k) => v[k] ?? "");
      expect(Date.now() - t0).toBeLessThan(PROBE_MS);
      expect(out.ok !== false).toBe(o.ok);
      expect(/Target met\./.test(out.text)).toBe(o.met);
      if (o.met) expect(out.text).toMatch(/Closed loop with C\(s\): STABLE/);
      if (o.head) expect(out.text.slice(0, 40)).toBe(o.head);
    },
  );
});

describe("cumulative gate: c2d against the reviewer's scipy coefficients", () => {
  test.each(FX.c2d.map((o: any, i: number) => [i, `${o.n} / ${o.d} T=${o.T} ${o.meth}`, o] as [number, string, any]))("#%i %s", (_i, _n, o: any) => {
    const r = c2d(tf(o.n, o.d), o.T, o.meth === "bilinear" ? "tustin" : o.meth, o.pw ?? null);
    if (!o.ok) {
      expect(r.ok).toBe(false);
      return;
    }
    expect(r.ok).toBe(true);
    const g = (r as C2dResult).gd;
    const close = (a: number[], b: number[]): void => {
      expect(a.length).toBe(b.length);
      a.forEach((x, i) => expect(Math.abs(x - b[i])).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b[i]))));
    };
    close(g.num, o.num);
    close(g.den, o.den);
  });
});

describe("cumulative gate: margins against numpy (closed form where the scan missed)", () => {
  test.each(FX.margins.map((o: any) => [o.name, o] as [string, any]))("%s", (_n, o: any) => {
    const m = margins(tf(o.num, o.den)) as Margins;
    expect(m.ok).toBe(true);
    expect(m.gainCrossings.map((x) => [r6(x.w), r6(x.marginDeg)])).toEqual(o.pm);
    expect(m.phaseCrossings.map((x) => [r6(x.w), r6(x.marginDb)])).toEqual(o.gm);
    const missedByScan = ["type1_4", "lowk_4", "touch"].includes(o.name);
    if (!missedByScan) {
      // the numpy scan agrees crossing for crossing
      expect(o.pm.length).toBe(o.numpyPm.length);
      expect(o.gm.length).toBe(o.numpyGm.length);
      o.numpyPm.forEach(([w, v]: number[], i: number) => {
        expect(m.gainCrossings[i].w).toBeCloseTo(w, 6);
        expect(m.gainCrossings[i].marginDeg).toBeCloseTo(v, 6);
      });
      o.numpyGm.forEach(([w, v]: number[], i: number) => {
        expect(m.phaseCrossings[i].w).toBeCloseTo(w, 6);
        expect(m.phaseCrossings[i].marginDb).toBeCloseTo(v, 6);
      });
    }
  });
  test("the three closed forms", () => {
    const g = (n: string, d: string): Margins => margins(tf(n, d)) as Margins;
    expect(g("50", "s^4+6*s^3+11*s^2+6*s").phaseCrossings[0].marginDb).toBeCloseTo(-20 * Math.log10(5), 9);
    expect(g("0.5", "s^4+4*s^3+6*s^2+4*s+1").phaseCrossings[0].marginDb).toBeCloseTo(20 * Math.log10(8), 9);
    const t = g("2", "s^3+2*s^2+s");
    expect(t.phaseMarginDeg!).toBeCloseTo(0, 8);
    expect(t.gainMarginDb!).toBeCloseTo(0, 8);
  });
});

describe("RULE F: time budgets", () => {
  test("the reviewer's 300-plant root-locus fuzz (t3x generator): total and worst case bounded, no bad branch", () => {
    let rng = 777;
    const rnd = (): number => (rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648;
    function pr(rts: Array<{ re: number; im: number }>): number[] {
      let p = [{ re: 1, im: 0 }];
      for (const r of rts) {
        const q = new Array(p.length + 1).fill(0).map(() => ({ re: 0, im: 0 }));
        for (let i = 0; i < p.length; i++) {
          q[i].re += p[i].re;
          q[i].im += p[i].im;
          q[i + 1].re -= r.re * p[i].re - r.im * p[i].im;
          q[i + 1].im -= r.re * p[i].im + r.im * p[i].re;
        }
        p = q;
      }
      return p.map((c) => +c.re.toFixed(6));
    }
    function randRoots(k: number): Array<{ re: number; im: number }> {
      const out: Array<{ re: number; im: number }> = [];
      while (out.length < k) {
        if (rnd() < 0.4 && out.length <= k - 2) {
          const a = -(rnd() * 6);
          const b = rnd() * 5 + 0.1;
          out.push({ re: +a.toFixed(2), im: +b.toFixed(2) }, { re: +a.toFixed(2), im: -b.toFixed(2) });
        } else out.push({ re: +(-(rnd() * 8) + (rnd() < 0.15 ? 3 : 0)).toFixed(2), im: 0 });
      }
      return out;
    }
    const t0 = Date.now();
    let worst = 0;
    for (let it = 0; it < 300; it++) {
      const n = 1 + Math.floor(rnd() * 7);
      const m = Math.floor(rnd() * (n + 1));
      const den = pr(randRoots(n)).join(" ");
      const num = pr(randRoots(m)).join(" ");
      const p = parseTf(num, den);
      if ("ok" in p) continue;
      const t1 = Date.now();
      const r = rootLocus(p);
      worst = Math.max(worst, Date.now() - t1);
      expect(r.ok).toBe(true);
    }
    // standalone: about 2.3 s total, worst about 70 ms (round 2 was 26.7 s / 1.1 s)
    expect(Date.now() - t0).toBeLessThan(30000);
    expect(worst).toBeLessThan(1000);
  }, 60000);

  test.each(CONTROL_CALCS.map((c) => [c.id] as [string]))("%s at the order cap (20) on decimal plants stays within budget", (id) => {
    const c = CONTROL_CALCS.find((x) => x.id === id)!;
    let seed = 5;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
    const dig = (): string => (rnd() * 100).toFixed(1 + Math.floor(rnd() * 5));
    for (const ord of [12, 16, 20]) {
      for (let t = 0; t < 2; t++) {
        const v: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
        v.num = [dig(), dig()].join(" ");
        v.den = ["1", ...Array.from({ length: ord }, dig)].join(" ");
        if (id === "control-leadlag") {
          v.err = "";
          if (t === 1) v.kind = "lag";
        }
        const t0 = Date.now();
        c.compute((k) => v[k] ?? "");
        // loaded full jest runs (3 workers + other suites) need headroom; standalone this is <= 200 ms
        expect(Date.now() - t0).toBeLessThan(5000);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Round 4 (review-round4 A–E). Each defect pinned.
// ---------------------------------------------------------------------------
describe("round 4: stiff plants are simulated exactly, never a diverged number", () => {
  const run = (id: string, ov: Record<string, string>) => {
    const c = CONTROL_CALCS.find((x) => x.id === id)!;
    const v: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(v, ov);
    return c.compute((k) => v[k] ?? "");
  };
  test("lead on 20000/(s² + 20000s): overshoot ~0 % (poles −1, −19999), not 7.95×10²⁹⁶ %", () => {
    const o = run("control-leadlag", { num: "20000", den: "1 20000 0", kind: "lead", pm: "50", err: "20" });
    const m = /Step overshoot \(simulated\): ([^\n]*)/.exec(o.text)![1];
    expect(m).not.toMatch(/×10/);
    expect(m).toMatch(/^0 % before, 0 % after/);
  });
  test.each([
    ["20000", "1 20001 20000", "0.01"],
    ["50000", "1 50001 50000", "0.001"],
  ])("c2d %s/(%s), T = %s: no ×10ⁿ axis from a diverged continuous trace; ZOH check exact", (num, den, T) => {
    const o = run("control-c2d", { num, den, T });
    const svg = (o.blocks ?? []).map((b) => (b.kind === "plot" ? b.svg : "")).join("");
    expect(svg).not.toMatch(/×10[⁰¹²³⁴⁵⁶⁷⁸⁹]{2,}/);
    expect(o.text).toMatch(/integration error only/);
  });
  test("lag on stiff third-order plants: verified, finite overshoot", () => {
    for (const den of ["1 5001 5000 0", "1 20001 20000 0"]) {
      const o = run("control-leadlag", { num: "1", den, kind: "lag", pm: "45", err: "5" });
      expect(o.text).not.toMatch(/×10[⁰¹²³⁴⁵⁶⁷⁸⁹]{2,} %/);
    }
  });
});

describe("round 4: exact root extraction near clusters", () => {
  test("(s+1)⁴(s² + 2.002s + 1.001999): poles real, breakaways −501/500 and −2999/3000 exact, segment from the true poles", () => {
    const rl = rootLocus(tf("1", "1 6.002 15.009999 20.019996 15.019994 6.009996 1.001999")) as RootLocusResult;
    expect(rl.poles.every((p) => p.im === 0)).toBe(true);
    expect(rl.poles.filter((p) => p.re === -1)).toHaveLength(4);
    // the quadratic's roots: −1.001 ± √(2×10⁻⁶)
    const q = rl.poles.filter((p) => p.re !== -1).map((p) => p.re).sort((a, b) => a - b);
    expect(q[0]).toBeCloseTo(-1.001 - Math.sqrt(2e-6), 12);
    expect(q[1]).toBeCloseTo(-1.001 + Math.sqrt(2e-6), 12);
    expect(rl.breakaways.map((b) => rs(b.sExact))).toEqual(["-501/500", "-2999/3000"]);
    expect(rl.realSegments).toHaveLength(1);
    expect(rl.realSegments[0].from).toBeCloseTo(-1.001 - Math.sqrt(2e-6), 12);
    expect(rl.realSegments[0].to).toBeCloseTo(-1.001 + Math.sqrt(2e-6), 12);
  });
  test("(s+1)³(s² + 2.0002s + 1.00019999): the spurious K ~ 10⁻¹⁶ points are gone; the genuine break-in is confirmed by exact K", () => {
    // decimal oracle (60 digits): the break-in is the root of 5s² + 10.0008s + 5.00079997 in
    // (−1, −0.99996): s = −0.99996864471274…, K = −den(s) = 8.4645×10⁻²³ (> 0, genuine)
    const rl = rootLocus(tf("1", "1.0 5.0002 10.00079999 10.00119997 5.00079997 1.00019999")) as RootLocusResult;
    expect(rl.breakaways).toHaveLength(1);
    expect(rl.breakaways[0].s.re).toBeCloseTo(-0.9999686447127434, 10);
    expect(rl.breakaways[0].K / 8.464463466262493e-23).toBeCloseTo(1, 4);
    expect(rl.unresolvedBreakaways).toEqual([]);
    // segments from the true poles −1 (×3), −1.0001 ± √(2×10⁻⁸)
    expect(rl.realSegments.length).toBe(2);
    expect(rl.realSegments[0].to).toBeCloseTo(-1.0001 - Math.sqrt(2e-8), 12);
    expect(rl.realSegments[1].from).toBe(-1);
    expect(rl.realSegments[1].to).toBeCloseTo(-1.0001 + Math.sqrt(2e-8), 12);
  });
});

describe("round 4 verification: a genuine break-in at tiny K is reported", () => {
  test("den 1 7.76 22.4037 …: s ≈ −2.71 at K = 7.635×10⁻⁹ (exact K at the double root, confirmed at s ± δ)", () => {
    // decimal oracle: den(−2.71) = −152699/20000000000000 = −7.63495×10⁻⁹; dK/ds = 0 at s = −2.70999999992
    const rl = rootLocus(tf("1", "1 7.76 22.4037 33.57702 40.66282203 50.17449925 40.03117687 12.59130706")) as RootLocusResult;
    const b = rl.breakaways.find((x) => Math.abs(x.s.re + 2.71) < 1e-6)!;
    expect(b).toBeDefined();
    expect(b.K).toBeCloseTo(7.63495e-9, 13);
  });
});

describe("round 4: freezes", () => {
  test("integer square root from an over-estimate: 12-digit and 20-digit integer plants", () => {
    for (const den of [
      "1 211290812274 594148326195 850796469795 636720387400 228697112917 238313877792",
      "1 21129081227412345678 59414832619512345678 85079646979512345678 63672038740012345678",
    ]) {
      const t0 = Date.now();
      rootLocus(tf("1", den));
      expect(Date.now() - t0).toBeLessThan(PROBE_MS);
    }
  });
  test("a genuinely repeated pole with decimal factors (order 20): stability, Nyquist, root locus within budget", () => {
    const mul = (a: bigint[], b: bigint[]): bigint[] => {
      const r = new Array(a.length + b.length - 1).fill(0n);
      for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] += a[i] * b[j];
      return r;
    };
    const roots: number[] = [];
    for (let i = 0; i < 18; i++) roots.push(1234 + 777 * i);
    roots.push(5000, 5000);
    let p = [1n];
    for (const r of roots) p = mul(p, [10000n, BigInt(r)]);
    const D = 10n ** 80n;
    const dec = p.map((c) => {
      const ip = c / D;
      const fp = (c % D).toString().padStart(80, "0").replace(/0+$/, "");
      return ip.toString() + (fp ? "." + fp : "");
    });
    const t = tf("1", dec.join(" "));
    const t0 = Date.now();
    const rl = rootLocus(t) as RootLocusResult;
    const ny = nyquist(t);
    expect(Date.now() - t0).toBeLessThan(3 * PROBE_MS);
    expect(rl.ok).toBe(true);
    expect(ny.ok).toBe(true);
  });
});

describe("round 4: clustered closed-loop roots are undecided, not UNSTABLE", () => {
  test("triple pair at −10⁻⁶ ± j: the numeric verdict withholds (agreeing with the exact analysis' UNCERTAIN)", () => {
    // closed den = (10^6 s² + 2s + 10^6)³, open den = closed − 10^18, num = 10^18
    const mul = (a: bigint[], b: bigint[]): bigint[] => {
      const r = new Array(a.length + b.length - 1).fill(0n);
      for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] += a[i] * b[j];
      return r;
    };
    const D = 10n ** 6n;
    let p = [1n];
    for (let i = 0; i < 3; i++) p = mul(p, [D, 2n, D]);
    const DM = D ** 3n;
    p[p.length - 1] -= DM;
    const L = tf(String(DM), p.map(String).join(" "));
    const m = margins(L) as Margins;
    expect(m.notes.join(" ")).not.toMatch(/say it is UNSTABLE/);
  });
});

// ---------------------------------------------------------------------------
// Round 4 verification (review-round4/V5).
// ---------------------------------------------------------------------------
import { timeResponse, analyzeStability as anSt } from "../control";

describe("round 4 verification: the exact stepping is verified or not used", () => {
  const win = (t: ReturnType<typeof tf>): number => {
    const st = anSt(t);
    if (!st.ok) throw new Error("stab");
    return 6 / Math.min(...st.poles.map((p) => Math.abs(p.re)).filter((v) => v > 1e-9));
  };
  test("(s² + 0.2s + 25)⁶(s + 0.001) (existing control-step): never a wrong trace labelled exact (oracle peak 275.15)", () => {
    const t = tf("244140.625", "1 1.201 150.6012 150.3106 9435.17416 7521.436944 314758.71206592 188114.799200064 5897077.800048 2352146.89 58830471.25 11777578.125 244152343.75 244140.625");
    const r = timeResponse(t, "step", win(t), 400);
    if (r.ok) {
      expect(Math.abs(r.peak.y - 275.15) / 275.15).toBeLessThan(0.01);
      expect(r.y.every((v) => Number.isFinite(v) && Math.abs(v) < 1e3)).toBe(true);
    }
  });
  test.each([
    // cascade-of-sections oracle (scipy.signal.lsim per factor, 400 001-point grid): peak values
    ["2904803210408260000", "1 7676.68867 23574986.2378355 37115956985.7875 31428457137471.6 13058754386696900 1818173035512250000 64477398862835800000 5.92932696958168e+21 1.82649996694618e+21 222353253159262000000 2904803210408260000", 0.9971703076096183],
    ["1.18909154117778e+23", "1 2781.134753 9174193.24491089 12019571329.3222 17571723853596.5 8426620767049520 5993039094544950000 884090061695964000000 3.65327588088676e+23 3.66456201207694e+24 2.50351148841891e+25 1.18909154117778e+23", 0.9975195225142248],
  ])("stiff order-11 plant stepped exactly matches the cascade oracle: %s", (n, d, peak) => {
    const t = tf(n, d);
    const r = timeResponse(t, "step", win(t), 400);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.notes.join(" ")).toMatch(/EXACTLY/);
      expect(r.peak.y).toBeCloseTo(peak, 7);
    }
  });
  test("verified Padé expm: exp of a rotation, and a stiff 2×2 against the closed form", () => {
    const E = expm([
      [0, 2],
      [-2, 0],
    ])!;
    expect(E[0][1]).toBeCloseTo(Math.sin(2), 14);
    // diag(-1, -19999)·0.5 with a coupling: [[−0.5, 0.5], [0, −9999.5]]
    const F = expm([
      [-0.5, 0.5],
      [0, -9999.5],
    ])!;
    expect(F[0][0]).toBeCloseTo(Math.exp(-0.5), 12);
    expect(F[1][1]).toBeCloseTo(0, 14);
    expect(F[0][1]).toBeCloseTo((0.5 * (Math.exp(-0.5) - Math.exp(-9999.5))) / (9999.5 - 0.5), 12);
  });
});

describe("round 4 verification: overshoot of each simulated loop over its own window (scipy.signal.step oracles)", () => {
  const run = (ov: Record<string, string>): string => {
    const c = CONTROL_CALCS.find((x) => x.id === "control-leadlag")!;
    const v: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(v, ov);
    return c.compute((k) => v[k] ?? "").text;
  };
  const after = (t: string): number => Number(/, ([\d.]+) % after/.exec(t)![1]);
  test("lag on 1/(s³ + 5001s² + 5000s), Kv 5, PM 45: 26.1 % (scipy 26.145 for the printed C(s)); was 0.0083 %", () => {
    expect(after(run({ num: "1", den: "1 5001 5000 0", kind: "lag", pm: "45", err: "5" }))).toBeCloseTo(26.1, 1);
  });
  test("lag on 1/(s(s+10)), defaults: 20.1 % (scipy 20.081 for the printed C(s))", () => {
    expect(after(run({ num: "1", den: "s^2+10*s", kind: "lag" }))).toBeCloseTo(20.1, 1);
  });
  test("llh3 #7 (order 15 lead, PM 45): 10.2 % again (scipy 10.17), not withheld", () => {
    const t = run({
      num: "4.782969e+18",
      den: "1 935.887697686 353966.171734 71191283.1577 8452034206.8 623195671999 2.92993949765e+13 8.89221995514e+14 1.74605282682e+16 2.20263052558e+17 1.75289563018e+18 8.49794733216e+18 2.35099698619e+19 3.25044850982e+19 1.594323e+19 0",
      kind: "lead",
      pm: "45",
      err: "",
    });
    expect(after(t)).toBeCloseTo(10.2, 1);
  });
});

describe("round 4 verification: no em dash in control.ts text that reaches a result", () => {
  test("verdicts and refusal/notes strings", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "control.ts"), "utf8");
    const offenders = src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .filter((l) => /["`][^"`]*—[^"`]*["`]/.test(l));
    expect(offenders).toEqual([]);
    for (const den of ["s^2+3*s+2", "s^2-1", "s^2+1", "s^4+2*s^2+1"]) {
      const st = anSt(tf("1", den));
      if (st.ok) expect(st.verdict).not.toMatch(/—/);
    }
  });
});

// ---------------------------------------------------------------------------
// Round 5 (review-round5).
// ---------------------------------------------------------------------------
import { eigenvaluesGeneral } from "../linalg";

describe("round 5: eigenvaluesGeneral balances (a real bug: also behind polyRoots, Markov and the Matrix tool)", () => {
  test("the stiff step matrix of V5 case 39: spectral radius 0.98507491 (numpy.linalg.eigvals), was 8.59", () => {
    const P: number[][] = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "controlPhi39.json"), "utf8"));
    const mags = eigenvaluesGeneral(P)!.map((z) => Math.hypot(z.re, z.im)).sort((a, b) => b - a);
    // numpy: 0.98507491, 0.64680873, 0.64680873, 0.29489682, 0.29489682, 0.00915668, 0.00200586
    expect(mags[0]).toBeCloseTo(0.98507491, 6);
    expect(mags[1]).toBeCloseTo(0.64680873, 6);
    expect(mags[3]).toBeCloseTo(0.29489682, 6);
    expect(mags[5]).toBeCloseTo(0.00915668, 7);
  });
  test("so case 39 is stepped exactly again and matches the cascade oracle (peak 0.9975041138274)", () => {
    const t = tf(
      "5194425456539290000",
      "1 985.0575 3490839.214358 1815306721.6402 1955529209004.51 401512881448996 8419039946324970 339941220221903000 4450323405906880000 24201393678192300000 94717098843623700000 268218606440008000000 5194425456539290000",
    );
    const st = anSt(t);
    if (!st.ok) throw new Error("stab");
    const tEnd = 6 / Math.min(...st.poles.map((p) => Math.abs(p.re)).filter((v) => v > 1e-9));
    const r = timeResponse(t, "step", tEnd, 400);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.notes.join(" ")).toMatch(/EXACTLY/);
      expect(r.peak.y).toBeCloseTo(0.9975041138274365, 7);
    }
  });
});

describe("round 5: a repeated open-loop pole is a K = 0 break, never a tiny positive K", () => {
  test("(s + 3.7)/((s² + 2.99s + 0.32)²(s − 0.09)): −2.879 and −0.1112 are double poles (numpy: K = 4.7×10⁻¹⁵, 4.8×10⁻¹⁹, i.e. 0)", () => {
    const rl = rootLocus(tf("1 3.7", "1 5.89 9.0419 1.051391 -0.069824 -0.009216")) as RootLocusResult;
    // genuine breakaways (numpy roots of N'D - ND' with K = -D/N): -1.9486 (K 3.4007), 0.024196 (K 0.0027281)
    expect(rl.breakaways.map((b) => r6(b.s.re))).toEqual([-1.9486, 0.0241963]);
    expect(rl.breakaways[0].K).toBeCloseTo(3.4007057179691382, 9);
    expect(rl.breakaways[1].K).toBeCloseTo(0.0027280569146367595, 11);
    expect(rl.repeatedPoleBreaks.map((z) => r6(z.re))).toEqual([-2.87884, -0.111156]);
    expect(rl.breakaways.every((b) => b.K > 1e-12)).toBe(true);
  });
  test("two DISTINCT poles 10⁻⁴ apart keep their genuine tiny-K break-in (s ≈ −2.71, K = 7.635×10⁻⁹)", () => {
    const rl = rootLocus(tf("1", "1 7.76 22.4037 33.57702 40.66282203 50.17449925 40.03117687 12.59130706")) as RootLocusResult;
    expect(rl.repeatedPoleBreaks).toEqual([]);
    expect(rl.breakaways.some((b) => Math.abs(b.s.re + 2.71) < 1e-6 && Math.abs(b.K - 7.63495e-9) < 1e-13)).toBe(true);
  });
  test("the cancelled pair ±2j of (s²+4)/((s²+1)(s²+4)) is listed once each (K = 3), real part exactly 0", () => {
    const rl = rootLocus(tf("s^2+4", "s^4+5*s^2+4")) as RootLocusResult;
    expect(rl.breakaways.map((b) => [b.s.re, r6(b.s.im), r6(b.K)])).toEqual([
      [0, -2, 3],
      [0, 2, 3],
    ]);
  });
});
