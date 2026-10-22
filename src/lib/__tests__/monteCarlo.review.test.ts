// Adversarial-review pins for the Monte Carlo verb (each failed before its fix).
// JCGM 101:2008 §7.9: u is first written to two significant digits, c·10^ℓ,
// and δ = ½·10^ℓ — so u = 0.9999999999621 is "1.0" and δ = 0.05.

import { monteCarlo, tryMonteCarlo, numericalTolerance, fmtShared, plannedSamples, reciprocalParts, compileFormula, noiseAdvice, MC_DEFAULT_SAMPLES, MC_MAX_SAMPLES } from "../monteCarlo";
import { evalFormula } from "../stats";

const THIN = String.fromCharCode(0x2009);
const plain = (s: string): string => s.split(THIN).join(" ");
const text = (q: string): string => {
  const r = tryMonteCarlo(q)!;
  return plain([...r.lines.map((l) => l.text), ...r.caveats].join("\n"));
};

describe("B3: two significant digits of u before the decade", () => {
  it("δ and the display place round u first", () => {
    expect(numericalTolerance(0.9999999999621)).toBeCloseTo(0.05, 15);
    expect(numericalTolerance(0.0996)).toBeCloseTo(0.005, 15); // 0.0996 → 0.10
    expect(numericalTolerance(0.0994)).toBeCloseTo(0.0005, 15); // 0.0994 → 0.099
    expect(numericalTolerance(1.05)).toBeCloseTo(0.05, 15);
    expect(fmtShared([5, 0.9999999999621], 0.9999999999621).texts).toEqual(["5.0", "1.0"]);
  });
  it("y = a with a = 5 ± 1: the GUM line reads 5.0 ± 1.0", () => {
    expect(text("monte carlo a a = 5 ± 1 samples 20000")).toMatch(/First-order \(GUM\): 5\.0 ± 1\.0 /);
  });
  it("y = a with a = 5 ± 1 AGREES on at least 38 of 40 seeds (5×10⁴ draws)", () => {
    let agree = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = monteCarlo("a", [{ name: "a", value: 5, u: 1 }], { samples: 50000, seed });
      if (r.verdict === "agree") agree++;
    }
    expect(agree).toBeGreaterThanOrEqual(38);
  }, 120000);
});

describe("4: a fixed per-draw cost in the work budget", () => {
  it("the default stays 10⁵ for a short formula; a huge request is capped and says so", () => {
    expect(plannedSamples(MC_DEFAULT_SAMPLES, 5, 3)).toBe(MC_DEFAULT_SAMPLES);
    expect(plannedSamples(1e7, 3, 2)).toBeLessThan(2e5);
    expect(plannedSamples(1e7, 1, 1)).toBeLessThan(plannedSamples(1e7, 0, 1) + 1);
    const t = text("monte carlo a*b a = 1 ± 0.1, b = 2 ± 0.1 samples 10^7 seed 3");
    expect(t).toMatch(/\d[\d ]* draws \(capped from 10 000 000 to keep Word responsive\)/);
  });
});

describe("5: unsettled moments name the right cause", () => {
  it("1/c through zero names the denominator", () => {
    expect(text("monte carlo 1/c c = 0.1 ± 0.1")).toMatch(/the draws of a denominator \(c\) pass through zero/);
    expect(text("monte carlo a*c^-1 a = 1 ± 0.1, c = 0.1 ± 0.1")).toMatch(/the draws of a denominator \(c\) pass through zero/);
  });
  it("lognormal outputs are heavy-tailed, with no invented denominator", () => {
    // At the default 10⁵ draws both ARE unsettled (asserted), so the wording is really tested.
    for (const [q, f, u] of [["monte carlo exp(a) a = 0 ± 2", "exp(a)", 2], ["monte carlo 10^a a = 0 ± 1", "10^a", 1]] as const) {
      const r = monteCarlo(f, [{ name: "a", value: 0, u }]);
      expect(r.verdict).toBe("unsettled");
      expect(r.throughZero).toEqual([]);
      const t = text(q);
      expect(t).toMatch(/heavy-tailed/);
      expect(t).not.toMatch(/denominator/);
    }
  }, 60000);
  it("the reciprocal parts are found in the formula's shape", () => {
    expect(reciprocalParts("a*b/c")).toEqual(["c"]);
    expect(reciprocalParts("a/(b-1)^2 + c^-1 + d^(-2)")).toEqual(["(b-1)^2", "c", "d"]);
    expect(reciprocalParts("exp(a)")).toEqual([]);
  });
});

describe("7: display contract", () => {
  it("e-notation inputs are typeset; ^ is drawn as superscripts or pow()", () => {
    const t = text("monte carlo a*b a = 1e6 ± 1e3, b = 2 ± 0.1 samples 2000");
    expect(t).toMatch(/a = 1×10⁶ ± 1×10³/);
    expect(t).not.toMatch(/\de[+-]?\d/);
    expect(text("monte carlo P = V^2/R, V = 12.0 ± 0.1, R = 4.7 ± 0.05 samples 2000")).toMatch(/^P = V²\/R$/m);
    expect(text("monte carlo y = (a+b)^2 a = 1 ± 0.1, b = 2 ± 0.1 samples 2000")).toMatch(/^y = \(a\+b\)²$/m);
    expect(text("monte carlo y = a^-1 a = 1 ± 0.01 samples 2000")).toMatch(/^y = a⁻¹$/m);
    expect(text("monte carlo y = 10^a a = 1 ± 0.01 samples 2000")).toMatch(/^y = pow\(10, a\)$/m);
    expect(text("monte carlo y = a^0.5 a = 1 ± 0.01 samples 2000")).toMatch(/^y = pow\(a, 0\.5\)$/m);
    expect(text("monte carlo y = 2^a^2 a = 1 ± 0.01 samples 2000")).toMatch(/^y = pow\(2, a²\)$/m);
  });
  it("a negative uncertainty is refused with U+2212", () => {
    const c = tryMonteCarlo("monte carlo a*b a = 1 ± -0.1, b = 2 ± 0.1")!.caveats[0];
    expect(c).toMatch(/negative uncertainty \(−0\.1\)/);
    expect(c).not.toMatch(/-\d/);
  });
  it("thousands separators and decimal commas refuse by name", () => {
    expect(tryMonteCarlo("monte carlo a*2 a = 1,000 ± 10")!.caveats[0]).toMatch(/write 1000 without the comma/);
    expect(tryMonteCarlo("monte carlo a*2 a = 1,5 ± 0,1")!.caveats[0]).toMatch(/decimal comma/);
    expect(tryMonteCarlo("monte carlo a*2 a = 1 ± 0.1 samples 20,000")!.caveats[0]).toMatch(/write 20000 without the comma/);
    const EM = String.fromCharCode(0x2014);
    for (const q of ["monte carlo a*2 a = 1,000 ± 10", "monte carlo a*2 a = 1,5 ± 0,1", "monte carlo a a = 1 ± 0.1 seed 4294967296", "monte carlo a a = 1 ± 0.1 seed x", "monte carlo a*1 a = 0 ± 5 %", "monte carlo a*b a = 1 ± -0.1, b = 2 ± 0.1"]) {
      const c = tryMonteCarlo(q)!.caveats[0];
      expect(c).not.toContain(EM);
      expect(c).not.toMatch(/\^|\de[+-]?\d|(^|[\s(=])-\d/);
    }
    // A comma inside the formula is an argument separator, not a number.
    expect(tryMonteCarlo("monte carlo pow(a,2) a = 1 ± 0.1 samples 2000")!.lines.length).toBeGreaterThan(0);
  });
});

describe("nits", () => {
  it("a − a has exactly zero spread, said plainly", () => {
    const t = text("monte carlo a - a a = 1 ± 0.1 samples 2000");
    expect(t).toMatch(/Every draw gives the same value: 0/);
    expect(t).not.toMatch(/0\.000000|still spread/);
  });
  it("seeds beyond 2³² − 1 refuse instead of wrapping", () => {
    expect(plain(tryMonteCarlo("monte carlo a a = 1 ± 0.1 seed 4294967296")!.caveats[0])).toMatch(/seed must be a whole number from 0 to 4 294 967 295/);
    expect(() => monteCarlo("a", [{ name: "a", value: 1, u: 0.1 }], { seed: 2 ** 32, samples: 1000 })).toThrow(/seed/);
  });
  it("a unit after the uncertainty is dropped and said so", () => {
    const t = text("monte carlo a*2 a = 10.0 ± 0.1 kg samples 2000");
    expect(t).toMatch(/First-order \(GUM\): 20\.00 ± 0\.20/);
    expect(t).toMatch(/Units are not carried: “kg” after a was dropped/);
  });
  it("a relative uncertainty ± 5 % is 5 % of the value", () => {
    const r = tryMonteCarlo("monte carlo a*1 a = 10.0 ± 5 % samples 20000")!;
    const t = plain(r.lines.map((l) => l.text).join("\n"));
    expect(t).toMatch(/a = 10\.0 ± 5 % \(± 0\.5\)/);
    expect(t).toMatch(/First-order \(GUM\): 10\.00 ± 0\.50/);
  });
  it("1.5×10^3 and 1.5×10³ read as 1500", () => {
    for (const v of ["1.5×10^3", "1.5×10³", "1.5 x 10^3"]) {
      const t = text(`monte carlo a*1 a = ${v} ± 10 samples 2000`);
      expect(t).toMatch(/First-order \(GUM\): 1500 ± 10/);
      expect(t).toMatch(/a = 1\.5×10³ ± 10/);
    }
  });
});

// Review round 3. Oracle (numpy, 2×10⁷ draws, default_rng(12345)):
//   a·b/c, a = 10.0 ± 0.45, b = 4.00 ± 0.05, c = 2.00 ± 0.055: u = 1.084, δ = 0.05,
//     dLow = 0.0604, dHigh = 0.0679 → beyond δ: genuinely DISAGREE, narrowly.
//   √a·b + c², a = 4.0 ± 0.4, b = 2.0 ± 0.1, c = 1.0 ± 0.1: u = 0.346, δ = 0.005,
//     dLow = 0.0172, dHigh = 0.0209 → DISAGREE.
describe("R3-4: a budget that can reach a verdict", () => {
  const marginal = [
    { name: "a", value: 10, u: 0.45 },
    { name: "b", value: 4, u: 0.05 },
    { name: "c", value: 2, u: 0.055 },
  ];
  it("the compiled formula is bit-identical to evalFormula", () => {
    const fs = ["a*b/c", "2*a + 3*b", "sqrt(a)*b+c^2", "-a^2", "2^-a", "a^b^c", "exp(-a*b)*sin(c)+log(b)", "if(a>b,a,b)+mod(a,c)", "hypot(a,b)/clamp(c,0,1)", "pi*e*a", "logbase(a,b)+atan2(a,c)+step(b-4)", "(a<=b)+(a>=c)+(a==a)+(a!=b)"];
    const names = ["a", "b", "c"];
    for (const f of fs) {
      const fn = compileFormula(f, names);
      expect(fn).not.toBeNull();
      for (let t = 0; t < 50; t++) {
        const v = new Float64Array([Math.sin(t) * 3 + 1, Math.cos(t * 1.7) + 4, Math.sin(t * 0.3) + 2]);
        const want = evalFormula(f, { a: v[0], b: v[1], c: v[2] });
        const got = fn!(v);
        expect(Object.is(got, want) || (Number.isNaN(got) && Number.isNaN(want))).toBe(true);
      }
    }
    expect(compileFormula("a*q", names)).toBeNull(); // unknown names fall back to evalFormula (and its own message)
    expect(compileFormula("nosuch(a)", names)).toBeNull();
  });
  it("the default stays 10⁵; short formulas may ask for 10⁶ and up to the 2×10⁶ cap", () => {
    expect(plannedSamples(MC_DEFAULT_SAMPLES, 5, 3, true)).toBe(MC_DEFAULT_SAMPLES);
    expect(plannedSamples(1e6, 5, 3, true, true)).toBe(1e6);
    expect(plannedSamples(1e9, 5, 3, true, true)).toBe(MC_MAX_SAMPLES);
    // With no count typed (every keystroke) a long formula is held to the smaller default budget.
    expect(plannedSamples(MC_DEFAULT_SAMPLES, 599, 1, true, false)).toBe(Math.floor(1.5e7 / 607));
    expect(plannedSamples(MC_DEFAULT_SAMPLES, 130, 3, true, false)).toBe(MC_DEFAULT_SAMPLES);
    expect(MC_MAX_SAMPLES).toBe(2e6);
    expect(monteCarlo("a*b/c", marginal).samples).toBe(MC_DEFAULT_SAMPLES);
    expect(monteCarlo("a*b/c", marginal).compiled).toBe(true);
  });
  it("10⁶ draws of a·b/c stay bounded even under ts-jest (≈ 0.2 s bundled)", () => {
    const t0 = Date.now();
    monteCarlo("a*b/c", marginal, { samples: 1e6 });
    expect(Date.now() - t0).toBeLessThan(6000);
  }, 30000);
  it("the narrow a·b/c case DISAGREES on at least 7 of 8 seeds at the cap", () => {
    let dis = 0;
    for (let seed = 1; seed <= 8; seed++) if (monteCarlo("a*b/c", marginal, { samples: MC_MAX_SAMPLES, seed }).verdict === "disagree") dis++;
    expect(dis).toBeGreaterThanOrEqual(7);
  }, 120000);
  it("at the default it says noise, and the advised count settles it as DISAGREE", () => {
    const t = text("monte carlo a*b/c a = 10.0 ± 0.45, b = 4.00 ± 0.05, c = 2.00 ± 0.055");
    expect(t).toMatch(/sampling noise/);
    const m = /samples (\d+)/.exec(t);
    expect(m).not.toBeNull();
    const n = Number(m![1]);
    expect(n).toBeLessThanOrEqual(MC_MAX_SAMPLES);
    expect(text(`monte carlo a*b/c a = 10.0 ± 0.45, b = 4.00 ± 0.05, c = 2.00 ± 0.055 samples ${n}`)).toMatch(/The two DISAGREE/);
  }, 60000);
  it("√a·b + c² disagrees, at the default and at the cap", () => {
    expect(text("monte carlo sqrt(a)*b+c^2 a = 4.0 ± 0.4, b = 2.0 ± 0.1, c = 1.0 ± 0.1")).toMatch(/The two DISAGREE/);
    expect(text("monte carlo sqrt(a)*b+c^2 a = 4.0 ± 0.4, b = 2.0 ± 0.1, c = 1.0 ± 0.1 samples 2000000")).toMatch(/The two DISAGREE/);
  }, 60000);
  it("never advises a count that cannot settle it: at the cap it says so", () => {
    const base = monteCarlo("a*b/c", marginal, { samples: 2000 });
    const atCap = { ...base, samples: MC_MAX_SAMPLES, delta: 0.05, dLow: 0.0501, dHigh: 0.01, seLow: 0.01, seHigh: 0.01, compiled: true };
    expect(plain(noiseAdvice(atCap, 3))).toMatch(/most draws this runs for this formula \(2 000 000\).*cannot be settled here/);
    // Below the cap no failure is forecast: the cap is offered, plainly.
    const short = { ...atCap, samples: 1e5 };
    expect(noiseAdvice(short, 3)).toMatch(/“samples 2000000”, the most this runs for this formula/);
    expect(noiseAdvice(short, 3)).not.toMatch(/not settle|cannot/);
  });
  it("a LINEAR formula's noise is never forecast as unsettleable; its advised count settles it as AGREE", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const q = `monte carlo 2*a + 3*b a = 1 ± 0.1, b = 2 ± 0.2 seed ${seed}`;
      const t = text(q);
      expect(t).not.toMatch(/not settle|cannot be settled|DISAGREE/);
      const m = /samples (\d+)/.exec(t);
      if (m) expect(text(`${q} samples ${m[1]}`)).toMatch(/The two AGREE|sampling noise/);
    }
  }, 120000);
});

describe("R3-5: a denominator that only touches zero is named", () => {
  it.each(["a/b^2", "a/(b*b)"])("%s with b = 0.1 ± 0.1", (f) => {
    const t = text(`monte carlo ${f} a = 1 ± 0.1, b = 0.1 ± 0.1`);
    expect(t).toMatch(/do NOT settle.*the draws of a denominator \((b²|b·b)\) come down to zero/);
    expect(t).not.toMatch(/heavy-tailed|\(\(/);
  });
  it("the through-zero sentence says “so” once", () => {
    const t = text("monte carlo 1/c c = 0.1 ± 0.1");
    const line = t.split("\n").find((l) => /do NOT settle/.test(l))!;
    expect(line.match(/\bso\b/g)!.length).toBe(1);
  });
});

describe("R3-6: a constant output is described, not explained", () => {
  it.each([
    ["monte carlo floor(a) a = 5.5 ± 0.01", "5"],
    ["monte carlo a*b a = 1e-200 ± 1e-201, b = 1e-200 ± 1e-201", "0"],
    ["monte carlo a - a a = 1 ± 0.1 samples 2000", "0"],
  ])("%s", (q, v) => {
    const t = text(q);
    expect(t).toContain(`Every draw gives the same value: ${v}.`);
    expect(t).not.toMatch(/cancels|exactly 0 by both/);
  });
  it("tiny values keep their spread (no squared underflow to 0)", () => {
    const r = monteCarlo("a*b", [{ name: "a", value: 1e-200, u: 1e-201 }, { name: "b", value: 2, u: 0.1 }], { samples: 20000 });
    expect(r.sd / 2.236e-201).toBeGreaterThan(0.95);
    expect(r.sd / 2.236e-201).toBeLessThan(1.05);
    expect(text("monte carlo a*b a = 1e-200 ± 1e-201, b = 2 ± 0.1 samples 20000")).not.toMatch(/slope vanishes|standard deviation 0(?![.\d])/);
  });
});

describe("R3-7: display nits", () => {
  it("a**2 is a power", () => {
    expect(text("monte carlo a**2 a = 1 ± 0.1 samples 2000")).toMatch(/^y = a²$/m);
  });
  it("an unbalanced power is refused without a caret", () => {
    const c = tryMonteCarlo("monte carlo a^(b a = 1 ± 0.1, b = 2 ± 0.1")!.caveats[0];
    expect(c).toMatch(/a to the power \(b/);
    expect(c).not.toMatch(/\^|··/);
  });
});
