// The three deferred equation-engine items: i on input (complexAlgebra.ts),
// partial fractions as a verb (algebraTools.ts + casint.ts), and parametric
// linear systems (systems.ts). Oracles by hand.

import { tryComplex, gSqrt, ratSqrt, fmtG, evalComplex } from "../complexAlgebra";
import { tryAlgebraVerb } from "../algebraTools";
import { solveSystem, splitEquations } from "../systems";
import { partialFractionDecompose } from "../casint";
import { parseExpr, evalAst } from "../solve";
import { foldPastedMath } from "../pasteMath";
import { ratInt, ratMake } from "../cas";

const cx = (s: string) => tryComplex(s)!;
const evalComplexReal = (s: string): number => {
  const v = evalComplex(parseExpr(foldPastedMath(s).text), {});
  if (Math.abs(v.im) > 1e-12) throw new Error("not real: " + s);
  return v.re;
};
const first = (s: string) => cx(s).lines[0].text;
const pf = (s: string) => tryAlgebraVerb(s)!;

describe("complex arithmetic on input", () => {
  it("the wrong answers of the previous release are now right", () => {
    expect(first("(2+3i)(1-i)")).toBe("= 5 + i");
    expect(first("(1+i)^8")).toBe("= 16");
    expect(first("simplify (2+3i)(1-i)")).toBe("= 5 + i");
  });
  it("exact Gaussian-rational arithmetic", () => {
    expect(first("1/(2+i)")).toBe("= 2/5 − (1/5)i");
    expect(first("(3+4i)/(1-2i)")).toBe("= −1 + 2i");
    expect(first("i^2")).toBe("= −1");
    expect(first("i^3")).toBe("= −i");
    expect(first("i^(-1)")).toBe("= −i");
    expect(first("(1+i)^2")).toBe("= 2i");
    expect(first("conj(3-4i)")).toBe("= 3 + 4i");
    expect(first("abs(3+4i)")).toBe("= 5");
    expect(first("re(3+4i) + im(3+4i)")).toBe("= 7");
    expect(first("sqrt(-4)")).toBe("= 2i");
    expect(first("sqrt(2i)")).toBe("= 1 + i");
    expect(first("(1+i)^(1/2)")).toMatch(/^≈ 1\.098684113 \+ 0\.4550898606i$/);
    expect(tryComplex("(-8)^(1/3)")).toBeNull(); // the real evaluator already gives the real cube root −2: not ours
  });
  it("modulus, argument, conjugate and polar form", () => {
    const r = cx("1+i");
    const all = r.lines.map((l) => l.text).join("\n");
    expect(all).toMatch(/\|z\| = √\(2\) ≈ 1\.414213562/);
    expect(all).toMatch(/arg z = π\/4/);
    expect(all).toMatch(/conj z = 1 − i/);
    const s = cx("-3 + 0i");
    expect(s.lines.map((l) => l.text).join("\n")).toMatch(/arg z = π/);
    const t = cx("3+4i").lines.map((l) => l.text).join("\n");
    expect(t).toMatch(/\|z\| = 5/);
    expect(t).toMatch(/arg z = ≈ 0\.92729522 rad \(53\.1301°\)/);
    expect(cx("-1+i").lines.map((l) => l.text).join("\n")).toMatch(/arg z = 3π\/4/);
    expect(cx("1-sqrt(3)*i".replace("sqrt(3)*i", "1.7320508075688772i")).lines.map((l) => l.text).join("\n")).toMatch(/arg z ≈ (-|−)1\.0471976 rad/);
  });
  it("every exact display parses back and re-evaluates to itself", () => {
    for (const s of ["(2+3i)(1-i)", "1/(2+i)", "(3+4i)/(1-2i)", "(1+i)^8", "i^3", "(1/2 + (1/3)i)(2 - i)"]) {
      const shown = first(s).replace(/^= /, "");
      const back = parseExpr(foldPastedMath(shown).text);
      const a = evalComplex(back), b = evalComplex(parseExpr(s));
      expect(`${s}: ${Math.hypot(a.re - b.re, a.im - b.im) < 1e-9}`).toBe(`${s}: true`);
    }
  });
  it("numeric when π, e or a transcendental is involved, and says so", () => {
    const r = cx("e^(i*pi)");
    expect(r.lines[0].text).toBe("≈ −1");
    expect(r.caveats.join(" ")).toMatch(/NUMERIC/);
    expect(first("exp(i*pi/2)")).toBe("≈ i");
    expect(first("2^i")).toBe("≈ 0.7692389014 + 0.6389612763i");
  });
  it("equations over ℂ in one unknown", () => {
    expect(first("(1+i)z = 2")).toBe("z = 1 − i");
    expect(first("x = 3 + 2i")).toBe("x = 3 + 2i");
    const q = cx("z^2 = 2i");
    expect(q.lines.map((l) => l.text).slice(0, 2).sort()).toEqual(["z = 1 + i", "z = −1 − i"].sort());
    expect(q.lines.map((l) => l.text).join(" ")).toMatch(/Verified/);
    const w = cx("z^2 = i");
    expect(w.lines.map((l) => l.text).slice(0, 2).sort()).toEqual(["z ≈ −0.7071067812 − 0.7071067812i", "z ≈ 0.7071067812 + 0.7071067812i"].sort());
    expect(w.caveats.join(" ")).toMatch(/NUMERIC/);
    const cube = cx("z^3 = i");
    expect(cube.lines.filter((l) => l.math).map((l) => l.text).sort()).toEqual(["z ≈ −0.8660254038 + 0.5i", "z ≈ 0.8660254038 + 0.5i", "z ≈ −i"].sort());
    expect(cx("i*z^2 + i = 0").lines.filter((l) => l.math).map((l) => l.text).sort()).toEqual(["z = i", "z = −i"].sort());
    expect(first("2z + i = i")).toBe("z = 0");
    // Without an i the solver keeps the equation (it already gives complex roots).
    expect(tryComplex("z^2 + 1 = 0")).toBeNull();
    expect(tryComplex("z^2 - 2z + 2 = 0")).toBeNull();
  });
  it("arg and abs of an exact value are exact where the table or a surd allows", () => {
    expect(first("arg(1+i)")).toBe("= π/4");
    expect(first("arg(i)")).toBe("= π/2");
    expect(first("arg(-1+0i)")).toBe("= π");
    expect(first("arg(1-i)")).toBe("= −π/4");
    expect(first("arg(-1-i)")).toBe("= −3π/4");
    expect(first("arg(sqrt(3)+i)")).toMatch(/^≈ 0\.5235987756$/); // sqrt(3) is not Gaussian rational: numeric, honestly
    expect(first("abs(1+i)")).toBe("= √(2)");
    expect(first("abs(1/2 + (1/3)i)")).toBe("= √(13/36)");
    expect(first("abs(3+4i)")).toBe("= 5");
    for (const s of ["arg(1+i)", "abs(1+i)", "abs(1/2 + (1/3)i)"]) {
      const shown = first(s).slice(2);
      expect(Math.abs(evalAst(parseExpr(foldPastedMath(shown).text), {}) - evalComplexReal(s))).toBeLessThan(1e-9);
    }
    // A real-valued numeric result does not get a meaningless |z| / arg z line.
    const r = cx("arg(2+3i)");
    expect(r.lines.map((l) => l.text).join(" ")).not.toMatch(/arg z/);
    expect(first("arg(2+3i)")).toBe("≈ 0.9827937232");
    expect(first("arg(1+i) + 1")).toBe("≈ 1.785398163");
  });

  it("does not claim what is not a complex-number input", () => {
    expect(tryComplex("x^2 - 5x + 6 = 0")).toBeNull();
    expect(first("i + j = 3")).toBe("j = 3 − i"); // one unknown (j) with a complex constant: ours
    expect(tryComplex("sin(x) = 0")).toBeNull();
    expect(tryComplex("integral of x")).toBeNull();
    expect(tryComplex("2 + 3")).toBeNull();
    expect(tryComplex("i")).not.toBeNull();
    expect(tryComplex("x + y = 2i")).toBeNull(); // two unknowns
  });
  it("refuses by name", () => {
    expect(cx("1/(1+i-1-i)").caveats[0]).toMatch(/Division by zero/);
    expect(cx("i^5000").caveats[0]).toMatch(/4096/);
    expect(cx("z^2 = pi*i").caveats[0]).toMatch(/exact complex numbers/);
    expect(cx("1/z = i").caveats[0]).toMatch(/multiply through/);
  });
  it("helpers", () => {
    expect(ratSqrt(ratMake(9n, 4n))).toEqual(ratMake(3n, 2n));
    expect(ratSqrt(ratInt(2))).toBeNull();
    expect(fmtG(gSqrt({ re: ratInt(-9), im: ratInt(0) })!)).toBe("3i");
    expect(gSqrt({ re: ratInt(2), im: ratInt(0) })).toBeNull();
  });
});

describe("partial fractions as a verb", () => {
  it("textbook decompositions, each verified by recombination", () => {
    expect(pf("partial fractions 1/(x^2-1)").lines[0].text).toMatch(/^1\/\(x\^2-1\) = (1\/2\/\(x - 1\) - 1\/2\/\(x \+ 1\)|-1\/2\/\(x \+ 1\) \+ 1\/2\/\(x - 1\))$/);
    expect(pf("partial fractions (3x+5)/((x-1)(x+2))").lines[0].text).toBe("(3x+5)/((x-1)(x+2)) = 8/3/(x - 1) + 1/3/(x + 2)");
    expect(pf("partial fractions 1/(x*(x+1)^2)").lines[0].text).toBe("1/(x*(x+1)^2) = 1/x - 1/(x + 1) - 1/(x + 1)^2");
    expect(pf("partial fractions 1/(x^3+1)").lines[0].text).toBe("1/(x^3+1) = 1/3/(x + 1) + (-1/3*x + 2/3)/(x^2 - x + 1)");
    expect(pf("partial fractions x^3/(x^2+1)").lines[0].text).toBe("x^3/(x^2+1) = x - x/(x^2 + 1)");
    expect(pf("partial fractions (x+1)/(x^2-1)").lines[0].text).toBe("(x+1)/(x^2-1) = 1/(x - 1)");
    expect(pf("decompose 1/(x^2-1)").lines[0].text).toMatch(/= 1\/2\/\(x - 1\)/);
    // Every displayed decomposition parses back and equals the original at sample points.
    for (const s of ["1/(x^2-1)", "(3x+5)/((x-1)(x+2))", "1/(x*(x+1)^2)", "1/(x^3+1)", "x^3/(x^2+1)"]) {
      const shown = pf(`partial fractions ${s}`).lines[0].text.split(" = ")[1];
      for (const xv of [2.5, -3.25, 0.7]) expect(Math.abs(evalAst(parseExpr(shown), { x: xv }) - evalAst(parseExpr(s), { x: xv }))).toBeLessThan(1e-9);
    }
    for (const s of ["1/(x^2-1)", "(3x+5)/((x-1)(x+2))", "1/(x*(x+1)^2)", "1/(x^3+1)", "x^3/(x^2+1)"]) {
      expect(pf(`partial fractions ${s}`).lines.map((l) => l.text).join(" ")).toMatch(/recombined to confirm/);
    }
  });
  it("refuses by name", () => {
    expect(pf("partial fractions 1/(x^3+x+1)").caveats[0]).toMatch(/degree 3 that is irreducible over ℚ/);
    expect(pf("partial fractions x^2 + 1").caveats[0]).toMatch(/already a polynomial/);
    expect(pf("partial fractions sin(x)/x").caveats[0]).toMatch(/not a rational function/);
    expect(pf("partial fractions 1/(x*y)").caveats[0]).toMatch(/ONE variable/);
    expect(tryAlgebraVerb("partial fractions = 2")).toBeNull();
  });
  it("the decomposition API recombines exactly", () => {
    const d = partialFractionDecompose([ratInt(1)], [ratInt(-1), ratInt(0), ratInt(1)])!; // 1/(x²−1)
    expect(d.terms.map((t) => (t.kind === "linear" ? `${t.A.n}/${t.A.d}@${t.root.n}` : "q")).sort()).toEqual(["-1/2@-1", "1/2@1"]);
    expect(partialFractionDecompose([ratInt(1)], [ratInt(1), ratInt(1), ratInt(0), ratInt(1)])!.refusal).toMatch(/degree 3/);
  });
});

describe("parametric linear systems", () => {
  const sys = (s: string) => solveSystem(splitEquations(s))!;
  it("a x + y = 1, x − y = 2: generic solution and the special value", () => {
    const r = sys("a*x + y = 1\nx - y = 2");
    expect(r.kind).toBe("parametric");
    expect(r.parameter).toBe("a");
    const g = r.general!.join("\n");
    expect(g).toMatch(/For a ∉ \{−1\} \(a \+ 1 ≠ 0\):/);
    expect(g).toMatch(/x = 3\/\(a \+ 1\)/);
    expect(g).toMatch(/y = \(−2a \+ 1\)\/\(a \+ 1\)|y = \(1 − 2a\)\/\(a \+ 1\)/);
    expect(g).toMatch(/a = −1: NO solution/);
  });
  it("x + a y = 1, a x + y = 1: a = 1 infinite, a = −1 none", () => {
    const r = sys("x + a*y = 1\na*x + y = 1");
    const g = r.general!.join("\n");
    expect(g).toMatch(/For a ∉ \{−1, 1\}/);
    expect(g).toMatch(/x = 1\/\(a \+ 1\)/);
    expect(g).toMatch(/y = 1\/\(a \+ 1\)/);
    expect(g).toMatch(/a = −1: NO solution/);
    expect(g).toMatch(/a = 1: INFINITELY MANY/);
  });
  it("k as the parameter, implicit multiplication, and a parameter on the right", () => {
    const r = sys("k x + y = 1\nx + k y = k");
    expect(r.kind).toBe("parametric");
    expect(r.parameter).toBe("k");
    expect(r.general!.join("\n")).toMatch(/For k ∉ \{−1, 1\}/);
  });
  it("one unknown, one parameter", () => {
    const r = sys("a*x = a + 1\nx = x");
    expect(r.kind).toBe("parametric");
    expect(r.general!.join("\n")).toMatch(/x = \(a \+ 1\)\/a/);
    expect(r.general!.join("\n")).toMatch(/a = 0: NO solution/);
  });
  it("still refuses what it should: two parameters, nonlinear in the unknown", () => {
    expect(sys("a*x + b*y = 1\nx - y = 2").kind).toBe("unsolved");
    expect(sys("a*x^2 + y = 1\nx - y = 2").kind).toBe("unsolved");
    // No parameter at all: the ordinary exact path is untouched.
    expect(sys("x + y = 3\nx - y = 1").kind).toBe("unique");
  });
  it("the special values are classified by substitution into the ORIGINAL system", () => {
    const r = sys("a*x + y = a\nx + y = 1"); // generic: x = (a−1)/(a−1) = 1, y = 0; a = 1: infinite
    const g = r.general!.join("\n");
    expect(g).toMatch(/x = 1\b/);
    expect(g).toMatch(/a = 1: INFINITELY MANY/);
  });
});

// ---------------------------------------------------------------------------
// Independent adversarial pass (2026-10-13): 16 confirmed defects, each pinned.
describe("adversarial pass: complex layer", () => {
  it("1. a negative-zero imaginary part no longer flips the branch cut", () => {
    expect(first("ln(-1)")).toBe("≈ 3.141592654i");
    expect(first("ln(-2)")).toBe("≈ 0.6931471806 + 3.141592654i");
    expect(first("(-2)^(1/2)")).toBe("≈ 1.414213562i");
    expect(first("(-4)^(3/2)")).toBe("≈ −8i");
    expect(first("(-1)^(3/2)")).toBe("≈ −i");
    expect(first("(-1)^0.25")).toBe("≈ 0.7071067812 + 0.7071067812i");
    expect(first("(-8)^(1/3) + 0i")).toBe("≈ 1 + 1.732050808i");
    expect(first("(-1)^i")).toBe("≈ 0.04321391826"); // e^(−π)
  });
  it("2. the floating cross-check never blames a correct exact result", () => {
    for (const s of ["(-1)^(1/2)", "(-4)^(1/2)", "(-4)^0.5", "sqrt((-2i)^2)", "sqrt((-1)^3)", "sqrt((conj(i))^2)", "(1+i)^60 - (1-i)^60", "(1+i)^100 - ((1+i)^50)^2 + 1", "(3+4i)^500", "(3+4i)^500/(3+4i)^499", "(1+i)^4096/(1-i)^4096", "(1+i)^(-4096)"]) {
      const r = cx(s);
      expect(`${s}: ${r.caveats.join(" ")}`).not.toMatch(/CROSS-CHECK FAILED/);
    }
    expect(first("(-1)^(1/2)")).toBe("= i");
    expect(first("sqrt((-2i)^2)")).toBe("= 2i");
    expect(first("(1+i)^60 - (1-i)^60")).toBe("= 0");
    expect(first("(3+4i)^500/(3+4i)^499")).toBe("= 3 + 4i");
    expect(first("(1+i)^4096/(1-i)^4096")).toBe("= 1");
    // An overflowing or vanishing float check is named as such, never "Verified".
    expect(cx("(3+4i)^500").lines.map((l) => l.text).join(" ")).toMatch(/overflows double precision/);
    expect(cx("(1+i)^(-4096)").lines.map((l) => l.text).join(" ")).not.toMatch(/Verified: .* gives 0\./);
    // A cancellation agrees "within double precision", stated with the scale.
    expect(cx("(1+i)^100 - ((1+i)^50)^2 + 1").lines.map((l) => l.text).join(" ")).toMatch(/within double precision/);
  });
  it("3. nothing escapes tryComplex: unsupported functions are refusals by name", () => {
    for (const s of ["sinh(i)", "cosh(i)", "tanh(i)", "asin(i)", "acos(i)", "atan(i)", "log10(i)", "log2(i)", "cbrt(i)", "sec(i)", "csc(i)", "cot(i)", "abs(sinh(i))", "sinh(i)^0", "sinh(1) + i"]) {
      let r: ReturnType<typeof tryComplex> = null;
      expect(() => { r = tryComplex(s); }).not.toThrow();
      expect(r).not.toBeNull();
      expect(r!.lines.length).toBe(0);
      expect(r!.caveats[0]).toMatch(/is not defined for complex arguments here/);
    }
  });
  it("4. high degrees converge, and a non-convergence is refused rather than shown as NaN", () => {
    const r39 = cx("z^39 = i");
    expect(r39.lines.filter((l) => l.math).length).toBe(39);
    expect(r39.lines.map((l) => l.text).join(" ")).not.toMatch(/NaN/);
    expect(r39.lines.map((l) => l.text).join(" ")).toMatch(/Verified/);
    const r64 = cx("z^64 = i");
    expect(r64.lines.filter((l) => l.math).length).toBe(64);
    expect(r64.lines.map((l) => l.text).join(" ")).not.toMatch(/NaN/);
    const r20 = cx("(z+2i)^10 * (z-3)^10 = 1");
    expect(r20.lines.filter((l) => l.math).length).toBe(20);
    expect(r20.lines.map((l) => l.text).join(" ")).not.toMatch(/NaN|unverified/);
    // Every root of the degree-20 equation is a genuine root of (z+2i)(z−3) = ω.
    for (const l of r20.lines.filter((l) => l.math)) {
      const zv = evalComplex(parseExpr(foldPastedMath(l.text.replace(/^z ≈ /, "")).text));
      const w = evalComplex(parseExpr("(z+2i)*(z-3)"), { z: zv });
      expect(Math.abs(Math.hypot(w.re, w.im) - 1)).toBeLessThan(1e-6);
    }
  });
  it("5. repeated roots are reported once, with multiplicity and honest precision", () => {
    const r3 = cx("(z - i)^3 = 0");
    expect(r3.lines.filter((l) => l.math).map((l) => l.text)).toEqual(["z ≈ i"]);
    expect(r3.lines.map((l) => l.text).join(" ")).toMatch(/multiplicity 3 — shown to 5 significant figures/);
    const r4 = cx("(z-i)^4 = 0");
    expect(r4.lines.filter((l) => l.math).map((l) => l.text)).toEqual(["z ≈ i"]);
    expect(r4.lines.map((l) => l.text).join(" ")).toMatch(/multiplicity 4/);
    const mixed = cx("(z-1)^2 * (z+i) = 0");
    expect(mixed.lines.filter((l) => l.math).map((l) => l.text).sort()).toEqual(["z ≈ 1", "z ≈ −i"].sort());
    expect(mixed.lines.map((l) => l.text).join(" ")).toMatch(/multiplicity 2/);
  });
  it("12. a constant raised to a large power is a coefficient, not a power of the unknown", () => {
    expect(first("(1+i)^100 z = 1")).toBe("z = −1/1125899906842624");
    expect(first("(1+i)^65 * z = 1")).toBe("z = 1/8589934592 − (1/8589934592)i");
    expect(first("z/((1+i)^65) = 1")).toBe("z = 4294967296 + 4294967296i");
    expect(first("(1+i)^4096 = z")).toMatch(/^z = 3231700607131100730071487668866995196044410266971548403213034542752465513886789089319720141152291346368871796092189801949411955915049092109508815238644828312063087736730099609175019775038965210679605763838406756827679221864261975616183809433847617047058164585203630504288757589154106580860755239912393038552191433338966834242068497478656456949485617603532632205807780565933102619270846031415025859286417711672594360371846185735759835115230164590440369761323328723122712568471082020972515710172693132346967854258065669793504599726835299863821552516638943733554360213543322960464531847860495214819355585361105959623065/);
    expect(cx("(1+i)^4096 = z").lines.map((l) => l.text).join(" ")).toMatch(/overflows double precision/);
  });
  it("13. exact growth is capped by name, in milliseconds, and never throws", () => {
    for (const s of ["((1+i)^4096)^4096", "((((1+i)^64)^64)^64)^64", "(((((1+i)^64)^64)^64)^64)^64"]) {
      const t0 = Date.now();
      let r: ReturnType<typeof tryComplex> = null;
      expect(() => { r = tryComplex(s); }).not.toThrow();
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(r!.caveats[0]).toMatch(/20,000 bits/);
    }
  });
  it("14. undefined values are refused, not answered as 0", () => {
    expect(cx("0^i").caveats[0]).toMatch(/undefined/);
    expect(cx("arg(0i)").caveats[0]).toMatch(/arg\(0\) is undefined/);
    expect(cx("0^(-1) + i").caveats[0]).toMatch(/Division by zero/);
  });
  it("judgment calls: constant statements are judged, bad-shape equations refused with the right reason", () => {
    expect(first("i^2 = -1")).toBe("TRUE: both sides equal −1.");
    expect(first("2i = 4")).toBe("FALSE: the left side is 2i and the right side is 4.");
    expect(first("i = i")).toBe("TRUE: both sides equal i.");
    expect(cx("2^z = i").caveats[0]).toMatch(/must appear polynomially/);
    expect(cx("conj(z) = 1+i").caveats[0]).toMatch(/must appear polynomially/);
    expect(cx("abs(z) = 1+i").caveats[0]).toMatch(/must appear polynomially/);
  });
});

describe("adversarial pass: partial fractions", () => {
  it("9. large coefficients: the rational-root search reaches past 10,000 and says when it is capped", () => {
    expect(pf("partial fractions 1/((10007x - 1)(x+1))").lines[0].text).toBe("1/((10007x - 1)(x+1)) = -1/10008/(x + 1) + 1/10008/(x - 1/10007)");
    expect(pf("partial fractions 1/(1000000x - 1)").lines[0].text).toBe("1/(1000000x - 1) = 1/1000000/(x - 1/1000000)");
    expect(pf("partial fractions 1/(x^2 - 10007^2)").lines[0].text).toBe("1/(x^2 - 10007^2) = 1/20014/(x - 10007) - 1/20014/(x + 10007)");
    for (const s of ["1/((10007x - 1)(x+1))", "1/(x^2 - 10007^2)"]) {
      const shown = pf(`partial fractions ${s}`).lines[0].text.split(" = ")[1];
      for (const xv of [2.5, -3.25, 0.7]) expect(Math.abs(evalAst(parseExpr(shown), { x: xv }) - evalAst(parseExpr(s), { x: xv }))).toBeLessThan(1e-12);
    }
    const r = pf("partial fractions 1/((1000000007x - 1)(1000000009x+1))");
    expect(r.lines.length === 0 ? r.caveats[0] : "decomposed").toMatch(/capped|decomposed/);
    expect(r.caveats.join(" ")).not.toMatch(/no rational root/);
  });
  it("11. quadratic factors over ℚ, repeated and distinct, decompose; true irreducibles are refused by name", () => {
    expect(pf("partial fractions 1/(x^2+1)^2").lines[0].text).toBe("1/(x^2+1)^2 = 1/(x^2 + 1)^2");
    expect(pf("partial fractions 1/((x^2+1)(x^2+2))").lines[0].text).toBe("1/((x^2+1)(x^2+2)) = 1/(x^2 + 1) - 1/(x^2 + 2)");
    expect(pf("partial fractions 1/(x^4+4)").lines[0].text).toBe("1/(x^4+4) = (-1/8*x + 1/4)/(x^2 - 2*x + 2) + (1/8*x + 1/4)/(x^2 + 2*x + 2)");
    expect(pf("partial fractions 1/(x^6-1)").lines[0].text).toBe("1/(x^6-1) = 1/6/(x - 1) - 1/6/(x + 1) + (1/6*x - 1/3)/(x^2 - x + 1) + (-1/6*x - 1/3)/(x^2 + x + 1)");
    expect(pf("partial fractions 1/(x*(x^2+1)^2)").lines[0].text).toBe("1/(x*(x^2+1)^2) = 1/x - x/(x^2 + 1) - x/(x^2 + 1)^2");
    for (const s of ["1/(x^2+1)^2", "1/((x^2+1)(x^2+2))", "1/(x^4+4)", "1/(x^6-1)", "1/(x*(x^2+1)^2)", "(x^3+2)/((x^2+x+1)^2*(x-2))"]) {
      const shown = pf(`partial fractions ${s}`).lines[0].text.split(" = ")[1];
      for (const xv of [2.5, -3.25, 0.7]) expect(Math.abs(evalAst(parseExpr(shown), { x: xv }) - evalAst(parseExpr(s), { x: xv }))).toBeLessThan(1e-9);
    }
    expect(pf("partial fractions 1/(x^4+1)").caveats[0]).toMatch(/degree 4 that is irreducible over ℚ/);
    expect(pf("partial fractions 1/(x^3+2)").caveats[0]).toMatch(/degree 3 that is irreducible over ℚ/);
    expect(pf("partial fractions 1/(x^5+x+1)").caveats[0]).toMatch(/irreducible over ℚ/); // = (x²+x+1)(x³−x²+1)
  });
  it("16. cosmetics: 'of', powers in the factor list, no bracketed constants, and bare 'decompose' falls through", () => {
    expect(pf("partial fractions of 1/(x^2-1)").lines[0].text).toBe("1/(x^2-1) = 1/2/(x - 1) - 1/2/(x + 1)");
    expect(pf("partial fractions 1/(x+1)^2").lines[1].text).toMatch(/\(x \+ 1\)\^2 with repeated factors/);
    expect(pf("partial fractions 1/((x+1)^10*(x-1)^10)").lines[1].text).toMatch(/\(x - 1\)\^10\(x \+ 1\)\^10/);
    expect(pf("partial fractions 1/(x^2-2)").lines[0].text).toBe("1/(x^2-2) = 1/(x^2 - 2)");
    expect(tryAlgebraVerb("decompose 12 into primes")).toBeNull();
    expect(tryAlgebraVerb("decompose the vector (1,2)")).toBeNull();
    expect(pf("decompose 1/(x^2-1)").lines[0].text).toMatch(/= 1\/2\/\(x - 1\)/);
  });
});

describe("adversarial pass: parametric systems", () => {
  const gen = (lines: string[]) => solveSystem(lines)!;
  it("6. a squared parameter survives substitution: special values are classified, never 'unsolved'", () => {
    const r = gen(["(2 + a)x = -2", "(2 + 3a^2)x + 3y = 1 + 2a"]);
    expect(r.kind).toBe("parametric");
    expect(r.general!.join("\n")).toMatch(/a = −2: NO solution/);
    expect(r.general!.join("\n")).not.toMatch(/unsolved|nonlinear/);
    expect(solveSystem(["(2)^2 x + y = 1", "x - y = 2"])!.kind).toBe("unique");
    expect(solveSystem(["(2)^2 x + y = 1", "x - y = 2"])!.exact).toEqual({ x: "3/5", y: "-7/5" });
  });
  it("7. a parameter glued to a digit is substituted with an explicit ×", () => {
    expect(gen(["x + y = 1", "2a x + y = 2"]).general!.join("\n")).toMatch(/a = 1\/2: NO solution/);
    expect(gen(["a x + a y = 1", "2a x + 2a y = 2"]).general!.join("\n")).toMatch(/a = 0: NO solution/);
    expect(gen(["(2a) x + y = 2", "x - y = 0"]).general!.join("\n")).toMatch(/a = −1\/2: NO solution/);
  });
  it("8. bounded by name: at most 4 unknowns and degree-8 coefficients, in well under a second", () => {
    const t0 = Date.now();
    const big = gen(["a x + y + z + w + u = 1", "x + a y = 2", "x + z = 3", "y + w = 4", "z + u = a"]);
    expect(big.kind).toBe("unsolved");
    expect(big.caveats[0]).toMatch(/bounded to 4 unknowns/);
    const deg = gen(["a^9 x + y + z = 1", "x - y + a z = 2", "x + a^3 y = 1"]);
    expect(deg.kind).toBe("unsolved");
    expect(deg.caveats[0]).toMatch(/degree 8/);
    const ok = gen(["a^8 x + y + z + w = 1", "x - a^2 y + z = 2", "x + a^3 y + w = 1", "a x + y - z + a^5 w = 0"]);
    expect(ok.kind).toBe("parametric");
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  it("9. a rational special value with a large denominator is found, and a² + 1 raises no 'irrational' caveat", () => {
    const r = gen(["x + y = 1", "10007a x + y = 2"]);
    expect(r.general!.join("\n")).toMatch(/a = 1\/10007: NO solution/);
    expect(r.caveats.join(" ")).not.toMatch(/irrational/);
    const q = gen(["(a^2+1) x + y = 1", "x - y = 2"]);
    expect(q.general![0]).toBe("For every a:");
    expect(q.caveats.join(" ")).not.toMatch(/irrational/);
    expect(gen(["a^9 x + y = 1", "x - y = 2"]).caveats.join(" ")).toMatch(/may also vanish at irrational values/);
  });
  it("10. fractional coefficients are bracketed, never '1/2a'", () => {
    const r = gen(["a x + y = 1", "x + 2y = a"]);
    expect(r.general!.join("\n")).toMatch(/x = \(−\(1\/2\)a \+ 1\)\/\(a − 1\/2\)/);
    expect(r.general!.join("\n")).not.toMatch(/[0-9]\/[0-9]+a/);
    const g = gen(["(2 + a)x = -2", "(2 + 3a^2)x + 3y = 1 + 2a"]).general!.join("\n");
    expect(g).toMatch(/\(8\/3\)a²/);
    expect(g).not.toMatch(/[0-9]\/[0-9]+a/);
  });
  it("15. a parameter in a divisor: the value where the equations are undefined is listed as such", () => {
    const r = gen(["x/a + y = 1", "x/a - y = 0"]);
    expect(r.general![0]).toBe("For a ∉ {0}:");
    expect(r.general!.join("\n")).toMatch(/x = \(1\/2\)a/);
    expect(r.general!.join("\n")).toMatch(/a = 0: the equations are UNDEFINED/);
    const s = gen(["a x + y = 1/a", "x - y = 2"]);
    expect(s.general!.join("\n")).toMatch(/a = 0: the equations are UNDEFINED/);
    expect(s.general!.join("\n")).toMatch(/a = −1: NO solution/);
  });
  it("judgment calls: covered values are not special; a parameter on the right side is still a parameter", () => {
    const r = gen(["a x + y = 1", "(a+1) x + y = 2"]);
    expect(r.general).toEqual(["For every a:", "  x = 1", "  y = −a + 1"]);
    const s = gen(["x + y = a", "x - y = 1"]);
    expect(s.kind).toBe("parametric");
    expect(s.general).toEqual(["For every a:", "  x = (1/2)a + 1/2", "  y = (1/2)a − 1/2"]);
    // Plain systems are untouched by the earlier parametric check.
    expect(solveSystem(["x + y = 3", "x - y = 1"])!.exact).toEqual({ x: "2", y: "1" });
    expect(solveSystem(["x + y + z = 1", "x - y = 2"])!.kind).toBe("infinite");
    expect(solveSystem(["a + b = 3", "a - b = 1"])!.exact).toEqual({ a: "2", b: "1" });
    expect(solveSystem(["x + y = a"])!.kind).toBe("infinite"); // one equation: underdetermined as before
  });
});
