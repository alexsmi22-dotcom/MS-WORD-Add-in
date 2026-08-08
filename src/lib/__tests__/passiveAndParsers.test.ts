// Circuits, trusses, the CAS's abs rule, and messages that were false.
//
//   B1  exact rational elimination on a 120-node mesh took 1362 ms, and its sweep
//       another 1102 ms — about 2.5 s in a pane that recomputes on every keystroke.
//   B2  `parseValue("1e-6")` was refused while `1u` — the same number — was accepted.
//   B4  the singular-matrix fallback said "check for a shorted or duplicated
//       source", but a duplicated source is caught upstream, so it named a fault
//       that cannot reach it.
//   B5  a negative resistance was accepted in silence by a module documented as
//       linear and PASSIVE.
//   B6  member tension/compression came from the FLOAT while the zero test used the
//       exact rational — discarding the one guarantee the exact path exists for.
//   B8  `abs(u)^2` never reduced, so casint's advertised canonical correctness net
//       could not recognise d/dx ln|x| as 1/x and did not run on any `ln|·|` result.
//   B12 parser errors named internal token types: "Expected lparen".
//   B13 `A ->> B` left "> B" as a component, handed to OpenChemLib as SMILES.
//   C3  `isSymmetric` used an absolute floor and was wrong in BOTH directions.

import { parseValue, parseNetlist, solveDc, frequencySweep } from "../circuit";
import { parseTruss, analyzeTruss } from "../truss";
import { parseReaction } from "../reactions";
import { exprEqual } from "../cas";
import { parseExpr, simplify, derivative, format, integrate, differentiate } from "../solve";
import { parseMathAst } from "../mathParse";
import { isSymmetric } from "../linalg";

// ---------------------------------------------------------------------------
// B2 — scientific notation
// ---------------------------------------------------------------------------

describe("B2: component values in scientific notation", () => {
  test.each([
    ["1e-6", 1e-6], ["1E-9", 1e-9], ["2.2e3", 2200], ["1e6", 1e6],
    ["4.7e-12", 4.7e-12], ["-1e3", -1000], ["1e+3", 1000], ["1.5e-3", 1.5e-3],
  ])("%s parses to %s", (text, want) => {
    const v = parseValue(text);
    expect(v).not.toBeNull();
    expect(v!.value).toBeCloseTo(want, 20);
  });

  test("the exact rational survives the exponent", () => {
    // This module's DC path is exact, so a value written 1e-6 must be as exact as
    // one written 1u. Otherwise the notation silently changes the guarantee.
    const a = parseValue("1e-6")!;
    const b = parseValue("1u")!;
    expect(a.exact).not.toBeNull();
    expect(b.exact).not.toBeNull();
    expect(exprEqual(simplify(parseExpr(`${a.exact!.n}/${a.exact!.d}`)), simplify(parseExpr(`${b.exact!.n}/${b.exact!.d}`)))).toBe(true);
  });

  test("the suffix forms still work, and nonsense is still refused", () => {
    for (const [t, want] of [["1k", 1000], ["1u", 1e-6], ["1meg", 1e6], ["2k2", 2200], ["4r7", 4.7]] as [string, number][]) {
      expect({ t, v: parseValue(t)?.value }).toEqual({ t, v: want });
    }
    for (const t of ["abc", "", "1e", "e6", "1e999999", "1..2"]) {
      expect({ t, v: parseValue(t) }).toEqual({ t, v: null });
    }
  });
});

// ---------------------------------------------------------------------------
// B5 — passivity
// ---------------------------------------------------------------------------

describe("B5: a negative component value is refused", () => {
  test.each([["R1 1 0 -1k", "resistance"], ["L1 1 0 -1m", "inductance"], ["C1 1 0 -1u", "capacitance"]])(
    "%s is rejected",
    (line, word) => {
      const p = parseNetlist(`V1 1 0 5\n${line}`);
      expect(p.errors.length).toBeGreaterThan(0);
      expect(p.errors.join(" ")).toMatch(new RegExp(`negative ${word}`));
      // and it explains WHY rather than just refusing
      expect(p.errors.join(" ")).toMatch(/LINEAR PASSIVE/);
    },
  );

  test("positive values are unaffected", () => {
    const p = parseNetlist("V1 1 0 5\nR1 1 0 1k\nC1 1 0 1u\nL1 1 0 1m");
    expect(p.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// B4 — a message that named an impossible case
// ---------------------------------------------------------------------------

describe("B4: the singular-matrix message names only what it has not ruled out", () => {
  test("a loop of voltage sources is identified as such", () => {
    // Three sources round a loop: none is in parallel with another, so the
    // parallel-pair test cannot see it, and it used to fall through to "check for a
    // shorted or duplicated source" — advice for a fault already excluded.
    const p = parseNetlist("V1 1 0 5\nV2 2 1 3\nV3 2 0 2");
    const r = solveDc(p.elements);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/loop of voltage sources/);
    expect(r.error).toMatch(/over-determines/);
    expect(r.error).not.toMatch(/duplicated source/);
  });

  test("a source shorted through an inductor is named too", () => {
    const p = parseNetlist("V1 1 0 5\nL1 1 0 1m\nR1 1 0 1k");
    const r = solveDc(p.elements);
    // An inductor is a short at DC, and this module refuses it explicitly — either
    // message is honest, but neither may be the old false one.
    if (!r.ok) expect(r.error).not.toMatch(/duplicated source/);
  });

  test("the genuine cases still get their specific messages", () => {
    const parallel = solveDc(parseNetlist("V1 1 0 5\nV2 1 0 3").elements);
    expect(parallel.ok).toBe(false);
    if (!parallel.ok) expect(parallel.error).toMatch(/in parallel with another voltage source/);

    const floating = solveDc(parseNetlist("V1 1 0 5\nR1 2 3 1k").elements);
    expect(floating.ok).toBe(false);
    if (!floating.ok) expect(floating.error).toMatch(/no DC path to ground/);
  });
});

// ---------------------------------------------------------------------------
// B1 — it must not freeze, and must not lie about exactness
// ---------------------------------------------------------------------------

describe("B1: a large mesh solves promptly, and says how", () => {
  /** A dense interconnected ladder at the parser's legal limit. */
  const denseMesh = (): string => {
    const lines = ["V1 1 0 5"];
    let e = 1;
    for (let i = 1; i <= 118 && e < 199; i++) lines.push(`R${e++} ${i} ${i + 1} 1k`);
    for (let i = 1; i <= 118 && e < 199; i += 2) lines.push(`R${e++} ${i} ${Math.min(i + 7, 119)} 2k`);
    lines.push(`R${e++} 119 0 1k`);
    return lines.join("\n");
  };

  test("the DC solve returns in well under a second", () => {
    const p = parseNetlist(denseMesh());
    // MINIMUM of three runs: single-run wall clock flakes under full-QC load
    // (two consecutive gate failures, green solo). A scheduling spike inflates
    // one run; a genuine performance regression raises all three, so the
    // guard keeps its teeth without measuring the box instead of the code.
    let best = Infinity;
    let r: ReturnType<typeof solveDc> | null = null;
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      r = solveDc(p.elements);
      best = Math.min(best, Date.now() - t0);
    }
    expect(r!.ok).toBe(true);
    expect(best).toBeLessThan(400); // was 1362 pre-optimisation
  });

  test("and it does NOT claim to be exact when it used doubles", () => {
    // The trade is honest only if it is disclosed. A result silently no longer
    // exact, in a module that advertises exactness, would be a false claim rather
    // than a slow one.
    const r = solveDc(parseNetlist(denseMesh()).elements);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exact).toBe(false);
    expect(r.notes.join(" ")).toMatch(/double precision/);
    expect(r.notes.join(" ")).toMatch(/not exact/);
  });

  test("a small circuit is still solved EXACTLY", () => {
    // The cap must not cost the guarantee on anything a person types by hand.
    const r = solveDc(parseNetlist("V1 1 0 5\nR1 1 2 1k\nR2 2 0 1k").elements);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.exact).toBe(true);
    expect(r.nodes.find((n) => n.name === "2")!.volts).toBeCloseTo(2.5, 12);
    expect(r.notes.join(" ")).not.toMatch(/double precision/);
  });

  test("the sweep is thinned rather than slow, and says so", () => {
    const p = parseNetlist(denseMesh());
    const t0 = Date.now();
    const sw = frequencySweep(p.elements, "60", 1, 1e6, 120);
    const ms = Date.now() - t0;
    expect("points" in sw).toBe(true);
    expect(ms).toBeLessThan(600); // was 1102
    if ("points" in sw) {
      expect(sw.points.length).toBeLessThan(120);
      expect(sw.error).toMatch(/thinned/);
      // the range must be preserved, not truncated
      expect(sw.points[0].f).toBeCloseTo(1, 6);
      expect(sw.points[sw.points.length - 1].f).toBeCloseTo(1e6, -3);
    }
  });

  test("a small circuit's sweep keeps its full resolution", () => {
    const p = parseNetlist("V1 1 0 5\nR1 1 2 1k\nC1 2 0 1u");
    const sw = frequencySweep(p.elements, "2", 1, 1e6, 120);
    expect("points" in sw).toBe(true);
    if ("points" in sw) {
      expect(sw.points.length).toBe(120);
      expect(sw.error).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// B6 — the exact sign
// ---------------------------------------------------------------------------

describe("B6: member state comes from the exact sign", () => {
  const truss = "joint A 0 0\njoint B 4 0\njoint C 2 2\nmember A B\nmember A C\nmember B C\nsupport A pin\nsupport B roller\nload C 0 -10";

  test("states agree with the exact force sign, not the rounded one", () => {
    const t = parseTruss(truss);
    expect(t.errors).toEqual([]);
    const r = analyzeTruss(t.input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const m of r.members) {
      const expected = m.force > 0 ? "tension" : m.force < 0 ? "compression" : "zero";
      // On this well-conditioned truss the float and exact signs agree, which is the
      // point: the change must not alter any ordinary answer.
      expect({ m: `${m.a}-${m.b}`, state: m.state }).toEqual({ m: `${m.a}-${m.b}`, state: expected });
    }
  });

  test("the classic answer is unchanged", () => {
    // A-B carries 5 in tension for a 10 kN load at the apex of this geometry.
    const r = analyzeTruss(parseTruss(truss).input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ab = r.members.find((m) => m.a === "A" && m.b === "B")!;
    expect(ab.force).toBeCloseTo(5, 9);
    expect(ab.state).toBe("tension");
  });
});

// ---------------------------------------------------------------------------
// B8 — the canonical correctness net
// ---------------------------------------------------------------------------

describe("B8: abs(u)^n reduces, so the canonical check actually runs", () => {
  test("abs(x)^2 is x^2", () => {
    expect(format(simplify(parseExpr("abs(x)^2")))).toBe("x^2");
    expect(format(simplify(parseExpr("abs(x)^4")))).toBe("x^4");
  });

  test("d/dx ln|x| is recognised as 1/x", () => {
    // This is the check casint advertises and could not perform: exprEqual was
    // FALSE for every partial-fraction and g'/g antiderivative, which were accepted
    // on numeric agreement at eight sample points instead.
    // The claim that matters is exprEqual, because that IS casint's gate. Note the
    // distinction: solve.ts's `simplify` is its own peephole and still prints
    // x/abs(x)^2, while cas.ts's canonical normaliser — which exprEqual and the
    // verification gate both use — now reduces abs(x)^2 to x^2 and recognises the
    // two as equal. Asserting the printed string here would have been asserting the
    // wrong layer.
    const d = simplify(derivative(parseExpr("ln(abs(x))"), "x"));
    expect(exprEqual(d, simplify(parseExpr("1/x")))).toBe(true);
    // and the public differentiate() path, which the pane uses, does print 1/x
    expect(differentiate("ln(abs(x))")!.derivative).toBe("1/x");
  });

  test("an odd power keeps exactly one abs", () => {
    // |A|^3 = A^2*|A| — true, and it must not collapse to A^3, which has the wrong
    // sign for negative A.
    const f = format(simplify(parseExpr("abs(x)^3")));
    expect(f).toMatch(/abs/);
  });

  test("integrals whose antiderivative contains ln|.| still evaluate correctly", () => {
    for (const [f, a, b, want] of [
      ["1/x", 1, 2, Math.LN2],
      ["1/(x+3)", 0, 1, Math.log(4 / 3)],
      ["1/(2*x+3)", 2, 3, 0.5 * Math.log(9 / 7)],
    ] as [string, number, number, number][]) {
      const r = integrate(f, a, b);
      expect(r).not.toBeNull();
      expect(Math.abs(r!.value - want)).toBeLessThan(1e-9);
    }
  });
});

// ---------------------------------------------------------------------------
// B12 — messages in the user's notation
// ---------------------------------------------------------------------------

describe("B12: parse errors name characters, not token types", () => {
  test.each([
    ["abs x", /opening bracket "\("/],
    ["|x", /vertical bar "\|"/],
    ["{x", /closing brace "\}"/],
    ["sin(x", /closing bracket "\)"/],
  ])("%s", (input, pattern) => {
    let msg = "";
    try {
      parseMathAst(input);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(pattern);
    // and never the internal name
    expect(msg).not.toMatch(/lparen|rparen|rbrace|lbrace|rbrack|lbrack/);
  });

  test("it says what it found, not only what it wanted", () => {
    let msg = "";
    try {
      parseMathAst("abs x");
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/but found/);
  });
});

// ---------------------------------------------------------------------------
// B13 — a stray delimiter must not become a component
// ---------------------------------------------------------------------------

describe("B13: a malformed arrow is reported, not absorbed", () => {
  test("A ->> B does not produce a component called '> B'", () => {
    const r = parseReaction("A ->> B");
    const flat = r.stages.flat();
    expect(flat).not.toContain("> B");
    for (const c of flat) expect(c).not.toMatch(/^[<>=]/);
    expect(r.arrowWarning).toBeTruthy();
    expect(r.arrowWarning).toMatch(/not one this tool recognises/);
  });

  test("well-formed arrows are unaffected and carry no warning", () => {
    for (const text of ["A -> B", "A <- B", "A <=> B", "A -> B -> C", "A >> B"]) {
      const r = parseReaction(text);
      expect({ text, warn: r.arrowWarning }).toEqual({ text, warn: undefined });
      expect(r.stages.length).toBeGreaterThanOrEqual(2);
    }
  });

  test("SMILES formal charges are not mistaken for arrows", () => {
    // The reason this had to be done by stripping ends rather than by widening the
    // arrow pattern: [O-] and C[N+](C)(C)C contain the same characters.
    const r = parseReaction("C[N+](C)(C)C -> [O-]");
    expect(r.stages[0]).toContain("C[N+](C)(C)C");
    expect(r.stages[1]).toContain("[O-]");
    expect(r.arrowWarning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// C3 — symmetry is a relative question
// ---------------------------------------------------------------------------

describe("C3: isSymmetric is scale-invariant", () => {
  test("a tiny matrix with 100% asymmetry is NOT symmetric", () => {
    // Reported symmetric before: every entry was below the absolute floor, so every
    // difference passed. eigenSymmetric is gated on this, and the Jacobi method it
    // uses is only valid for a symmetric matrix.
    expect(isSymmetric([[1e-20, 1e-20], [2e-20, 1e-20]])).toBe(false);
    expect(isSymmetric([[1e-30, 1e-30], [-1e-30, 1e-30]])).toBe(false);
  });

  test("a huge matrix with negligible asymmetry IS symmetric", () => {
    // Reported not-symmetric before: 1e-7 against a norm of 1e20.
    expect(isSymmetric([[1e20, 1], [1.0000001, 1e20]])).toBe(true);
  });

  test("scaling a matrix cannot change whether it is symmetric", () => {
    const sym = [[1, 2], [2, 3]];
    const asym = [[1, 2], [3, 4]];
    for (const k of [1e-20, 1e-10, 1, 1e10, 1e20]) {
      expect({ k, r: isSymmetric(sym.map((r) => r.map((v) => v * k))) }).toEqual({ k, r: true });
      expect({ k, r: isSymmetric(asym.map((r) => r.map((v) => v * k))) }).toEqual({ k, r: false });
    }
  });

  test("the ordinary cases and the degenerate ones", () => {
    expect(isSymmetric([[0, 0], [0, 0]])).toBe(true);
    expect(isSymmetric([[1]])).toBe(true);
    expect(isSymmetric([[1, 2, 3], [2, 4, 5], [3, 5, 6]])).toBe(true);
    expect(isSymmetric([[1, 2], [2, 3], [4, 5]])).toBe(false); // not square
    expect(isSymmetric([[1, NaN], [NaN, 1]])).toBe(false);
  });
});
