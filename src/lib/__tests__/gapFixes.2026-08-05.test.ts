// The defects found by the 2026-08-05 gap analysis, pinned so they stay fixed.
//
// Two kinds of assertion live here, for one unavoidable reason: taskpane.ts
// cannot be imported by a test (it references the Office.js `Word` namespace at
// module scope), so pane-side fixes can only be checked by reading the source.
// A source assertion proves a string is present or absent; it cannot execute the
// branch. Where the logic lives in src/lib it is EXERCISED instead, and those
// are the assertions that carry real weight.
//
// Each block names the defect number from docs/GAP-ANALYSIS-2026-08-05.md.

import * as fs from "fs";
import * as path from "path";
import { validateFormula, normalizeFormulaText } from "../chemValidate";
import { bondPeriodRefusal, bondPrice, bondYTM } from "../finance";
import { auditDocument } from "../audit";

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const pane = read("src/taskpane/taskpane.ts");

describe("0.16 — the display contract round-trips in Chemical mode", () => {
  it("accepts the subscripted formula the product itself displays", () => {
    // "H₂O" used to return 'Unexpected character "₂"' with no mass, while the
    // pane displayed formulas in exactly that form. Displaying something the
    // parser refuses makes correct rendering a trap.
    const v = validateFormula("H₂O");
    expect(v.valid).toBe(true);
    expect(v.counts).toEqual({ H: 2, O: 1 });
    expect(v.mass).toBeCloseTo(18.015, 2);
  });

  it("agrees exactly with the ASCII spelling", () => {
    const sub = validateFormula("C₆H₁₂O₆");
    const ascii = validateFormula("C6H12O6");
    expect(sub.valid).toBe(true);
    expect(sub.counts).toEqual(ascii.counts);
    expect(sub.mass).toBe(ascii.mass);
    expect(sub.hill).toBe(ascii.hill);
  });

  it("accepts a superscripted charge, which is how a charge is displayed", () => {
    const sup = validateFormula("SO₄²⁻");
    const ascii = validateFormula("SO4^2-");
    expect(sup.valid).toBe(true);
    expect(sup.charge).toBe(ascii.charge);
    expect(sup.counts).toEqual(ascii.counts);
  });

  it("accepts the CH₄ that Engineering's combustion tool renders", () => {
    // The cross-mode trap: energy.ts formatFormula() emits CH₄, and pasting it
    // into Chemical produced an error rather than a molar mass.
    const v = validateFormula("CH₄");
    expect(v.valid).toBe(true);
    expect(v.counts).toEqual({ C: 1, H: 4 });
  });

  it("every typeset ion spelling agrees EXACTLY with its ASCII form", () => {
    // The round-trip rule is only kept if the two spellings mean the same
    // thing. An adversarial pass caught Fe³⁺⁺ folding to charge +4 while
    // Fe3++ gave +2 — one notation, two answers.
    const pairs: [string, string][] = [
      ["SO₄²⁻", "SO4^2-"],
      ["Ca²⁺", "Ca2+"],
      ["NO₃⁻", "NO3-"],
      ["H₃O⁺", "H3O+"],
      ["PO₄³⁻", "PO4^3-"],
      ["Fe³⁺", "Fe3+"],
      ["C₆H₁₂O₆", "C6H12O6"],
    ];
    for (const [typeset, ascii] of pairs) {
      const a = validateFormula(typeset);
      const b = validateFormula(ascii);
      expect({ f: typeset, valid: a.valid, charge: a.charge, counts: a.counts }).toEqual({
        f: typeset,
        valid: b.valid,
        charge: b.charge,
        counts: b.counts,
      });
    }
  });

  it("refuses a malformed charge instead of silently summing it", () => {
    const r = validateFormula("Fe³⁺⁺");
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/not a charge/i);
  });

  it("names isotope notation as unsupported rather than blaming a caret", () => {
    // These used to error with '"^" must be followed by a charge' — naming a
    // character the user never typed, because the fold had already rewritten it.
    for (const iso of ["¹⁴C", "²H", "H₂¹⁸O", "²⁵⁰Cf"]) {
      const r = validateFormula(iso);
      expect(r.valid).toBe(false);
      expect(r.errors.join(" ")).toMatch(/isotope/i);
      expect(r.errors.join(" ")).not.toMatch(/\^/);
    }
  });

  it("normalizes only notation — it does not repair genuine nonsense", () => {
    expect(normalizeFormulaText("H₂O")).toBe("H2O");
    // A superscript run is a CHARGE and must carry the caret, or the 2 would be
    // read as part of the oxygen count.
    expect(normalizeFormulaText("SO₄²⁻")).toBe("SO4^2-");
    expect(normalizeFormulaText("Ca²⁺")).toBe("Ca^2+");
    // An unknown element is still an error; folding subscripts must not turn
    // the parser into something that accepts anything.
    expect(validateFormula("Xz₂O").valid).toBe(false);
  });

  it("the pane prints the typeset formula rather than the ASCII one", () => {
    expect(pane).toMatch(/✓ Valid — \$\{formatFormula\(v\.hill\)\}/);
  });
});

describe("0.3 — a GenBank import is not filed as a synthetic construct", () => {
  it("the pane reads the record's organism, not the skipped source feature", () => {
    // seqio.ts SKIPS the `source` feature (SKIP_FEATURES), so the old lookup —
    // rec.features.find(f => f.type === "source")?.qualifiers?.organism — could
    // never succeed. It returned "" for every GenBank file, and sequence.ts
    // turns an empty organism into "synthetic construct". That is a false
    // statement of record in a filed application.
    expect(pane).toMatch(/organism: rec\.organism \?\? ""/);
    expect(pane).not.toMatch(/rec\.features\.find\(\(f\) => f\.type === "source"\)/);
  });
});

describe("0.5 — a refused integral never inserts a number", () => {
  it("the typeset block branches on the same finite test as the readout", () => {
    // `NaN.toPrecision(8)` is the string "NaN", and mathToOmml() typesets it
    // without throwing, so the document received "∫ … = NaN" while the pane
    // said there was no value. The math block must be gated.
    const i = pane.indexOf("const val = Number.isFinite(r.value)");
    expect(i).toBeGreaterThan(0);
    const region = pane.slice(i, i + 2200);
    // Two sayMath calls now: the guarded one that prints a value, and an
    // else-branch that typesets the integral WITHOUT one.
    const guard = region.indexOf("if (Number.isFinite(r.value)) {");
    expect(guard).toBeGreaterThan(0);
    const sayMathCalls = region.match(/sayMath\(`int\([^`]*`/g) ?? [];
    expect(sayMathCalls.length).toBe(2);
    // Exactly one formats the value, and it is the one after the guard.
    const formatting = sayMathCalls.filter((c) => c.includes("r.value.toPrecision"));
    expect(formatting.length).toBe(1);
    expect(region.indexOf(formatting[0])).toBeGreaterThan(guard);
    // The else branch must not print a number at all.
    const bare = sayMathCalls.filter((c) => !c.includes("r.value"));
    expect(bare.length).toBe(1);
  });
});

describe("0.6 — Finance cannot insert a non-finite number", () => {
  it("finPct guards non-finite values, as finMoney always did", () => {
    const i = pane.indexOf("function finPct(");
    expect(i).toBeGreaterThan(0);
    expect(pane.slice(i, i + 400)).toMatch(/if \(!Number\.isFinite\(x\)\) return "—";/);
  });

  it("the insertability gate blocks NaN and Infinity", () => {
    // The check moved but got STRONGER, so this moved with it rather than
    // being deleted. Finance's inline gate was the only one that blocked NaN
    // and Infinity by name; Statistics, Analyze and Bio/Assay ran on the em
    // dash alone, and that gap let "variance = Infinity" become insertable the
    // moment an unrelated fix removed the em dash that had been blocking it by
    // accident. All four now share `insertableResultText`.
    //
    // Asserted on the helper, and separately on Finance still using it, so
    // neither half can drift away from the other.
    const i = pane.indexOf("function insertableResultText");
    expect(i).toBeGreaterThan(0);
    const region = pane.slice(i, i + 400);
    expect(region).toMatch(/!text\.includes\("NaN"\)/);
    expect(region).toMatch(/!text\.includes\("Infinity"\)/);

    const fin = pane.indexOf("const insertable = insertableResultText(text)");
    expect(fin).toBeGreaterThan(0);
    // Finance's own extra condition must survive the move.
    expect(pane.slice(fin, fin + 200)).toMatch(/no solution/);
  });
});

describe("0.7 — the Greeks disclosure matches what is displayed", () => {
  it("no longer tells the user to divide an already-per-day theta by 365", () => {
    const i = pane.indexOf("Same EUROPEAN, no-dividend model");
    expect(i).toBeGreaterThan(0);
    const region = pane.slice(i, i + 500);
    expect(region).not.toMatch(/Theta is per YEAR/);
    expect(region).not.toMatch(/divide by 365/);
    expect(region).toMatch(/PER DAY/);
  });

  it("theta is shown with enough precision to be a number", () => {
    // finMoney's 2 dp rounded -0.017573 to -0.02, a 14% error on the value.
    expect(pane).toMatch(/Theta {2}\$\{finFixed\(g\.theta \/ 365, 4\)\} per day/);
  });
});

describe("0.8 — the perpetuity sensitivity sentence states what it used", () => {
  it("says how much growth it actually added when the full point cannot converge", () => {
    const i = pane.indexOf("The growing form is the Gordon growth model");
    expect(i).toBeGreaterThan(0);
    const region = pane.slice(i - 900, i + 900);
    // The clamp must change the SENTENCE, not just the number.
    expect(region).toMatch(/clamped/);
    expect(region).toMatch(/a full point would not converge/);
  });
});

describe("0.20 — caveats reach the screen and the document", () => {
  it("the ¹H coupling caveats are merged into the spectra caveat block", () => {
    expect(pane).toMatch(/cur\.coupling\?\.caveats \?\? \[\]/);
  });

  it("the coupling caveats also travel into the inserted text", () => {
    expect(pane).toMatch(/dedupe\(\[\.\.\.r\.caveats, \.\.\.\(cpl\?\.caveats \?\? \[\]\)\]\)/);
  });

  it("the isotope-pattern exclusion is in the inserted text, not just on screen", () => {
    const i = pane.indexOf("function massSpecAsText");
    expect(i).toBeGreaterThan(0);
    expect(pane.slice(i, i + 1800)).toMatch(/unsupportedInPattern/);
  });

  it("the Table→Chart renderer notes are merged with the parse-time warnings", () => {
    expect(pane).toMatch(/\[\.\.\.currentTableChart\.warnings, \.\.\.preview\.warnings\]/);
  });

  it("the log-axis drop warning is drawn INTO the plot, not beside it", () => {
    // `currentPlotSvg` is what gets inserted, so a note living in a sibling
    // <div> never reached the document.
    expect(pane).toMatch(/buildPlotSvg\(filtered\.series, \{ \.\.\.opts, notes \}\)/);
  });
});

describe("0.21 — the two most-used pharmacology fits carry their caveats", () => {
  it("dose–response and saturation binding both pass fit.caveats through", () => {
    // assay.ts states the contract: "The UI must show them." Four of six fits
    // honoured it; these two dropped the key entirely.
    for (const anchor of ['xlabel: "concentration", ylabel: "response"', 'xlabel: "[Ligand]", ylabel: "Bound"']) {
      const i = pane.indexOf(anchor);
      expect(i).toBeGreaterThan(0);
      expect(pane.slice(i - 300, i)).toMatch(/caveats: fit\.caveats/);
    }
  });
});

describe("0.27 — no catch block claims the document is untouched", () => {
  it("paragraph numbering admits that some marks may already be applied", () => {
    const i = pane.indexOf("Could not number the document.");
    expect(i).toBeGreaterThan(0);
    const region = pane.slice(i, i + 300);
    expect(region).not.toMatch(/Nothing was changed/);
    expect(region).toMatch(/may already have been numbered/);
  });
});

describe("0.30 — no Math.max spread over user-supplied data", () => {
  it("the regression and curve-fit plots reduce instead of spreading", () => {
    // minmax.ts documents the failure as a CLIFF, not a curve: 100,000 values
    // work and 130,000 throw RangeError. Both fields accept an 8 MB CSV.
    //
    // Comment lines are stripped first: the fix's own explanatory comment names
    // the pattern it removed, and matching that would make this pass or fail on
    // prose rather than on code.
    const code = pane
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/Math\.(max|min)\(\s*\.\.\.(x|xs)\b/);
    expect(pane).toMatch(/const xs = \[minOf\(x\), maxOf\(x\)\]/);
    expect(pane).toMatch(/const lo = minOf\(xs\)/);
  });
});

describe("0.31 — claims in the pane match the shipped product", () => {
  it("the symmetric-eigenvalue hint no longer calls non-symmetric out of scope", () => {
    // eigenvaluesGeneral ships, and "Eigenvalues (any square matrix)" is
    // fifteen lines below the hint that said it was out of scope.
    expect(pane).not.toMatch(/Non-symmetric matrices are out of scope/);
    const i = pane.indexOf('id: "eigen",');
    expect(i).toBeGreaterThan(0);
    expect(pane.slice(i, i + 800)).toMatch(/Eigenvalues \(any square matrix\)/);
  });

  it("declining-balance depreciation states that it is not MACRS", () => {
    // SCOPED TO THE ENTRY, not to a fixed 1,600 characters after its id.
    //
    // The byte window was a proxy for "inside this calculator" and it broke the
    // first time the calculator grew — adding a figure pushed the `assumes:`
    // disclosure past the cut-off, and the test failed while the disclosure was
    // exactly where it had always been. A gate that fires when unrelated code
    // is added near it teaches people to widen the number and move on, which is
    // how a real regression gets waved through next time.
    const i = pane.indexOf('id: "depr",');
    expect(i).toBeGreaterThan(0);
    const next = pane.indexOf('    id: "', i + 10);
    const region = pane.slice(i, next < 0 ? pane.length : next);
    expect(region).toMatch(/assumes:/);
    expect(region).toMatch(/NOT MACRS/);
  });

  it("straight-line depreciation does not truncate a fractional life silently", () => {
    const i = pane.indexOf("Annual depreciation");
    expect(i).toBeGreaterThan(0);
    const region = pane.slice(i, i + 1600);
    expect(region).toMatch(/part year/);
    expect(region).not.toMatch(/the book value reaches salvage in\n/);
  });
});

describe("1.3 — the shipped-but-invisible capabilities are named somewhere", () => {
  const hints = pane.slice(pane.indexOf("const hints: Record<SolveKind, string>"), pane.indexOf("solveInputLabel.textContent"));

  it("inequalities are mentioned in the equation hint", () => {
    expect(hints).toMatch(/INEQUALITIES/);
  });

  it("the indefinite integral is mentioned in the integral hint", () => {
    expect(hints).toMatch(/LEAVE BOTH LIMIT BOXES EMPTY/);
  });

  it("the 3-D transform toolkit is mentioned in the geometry hint", () => {
    expect(hints).toMatch(/TRANSFORMS: rotate/);
  });

  it("the Alexander polynomial and K-theory are mentioned in the topology hint", () => {
    expect(hints).toMatch(/alexander polynomial/i);
    expect(hints).toMatch(/k theory/i);
  });

  it("the integral dropdown no longer says only 'Definite'", () => {
    const html = read("src/taskpane/taskpane.html");
    expect(html).toMatch(/<option value="integral">Integral \(definite or indefinite\)<\/option>/);
  });
});

describe("wiring — library fixes that a user can actually reach", () => {
  // This repo's recorded worst failure is a fully-tested engine the pane could
  // not reach. Every fix below lives in src/lib and is useless unwired, so the
  // call site is pinned here.

  it("Align distinguishes a size refusal from empty input", () => {
    // align() returns null for both, and reporting the size cap as "nothing
    // alignable" blames the user's sequences for a limit.
    expect(pane).toMatch(/alignSizeRefusal\(a, b\)/);
  });

  it("Align's input handler is debounced", () => {
    // The cap stops the freeze; the debounce stops a 4M-cell alignment being
    // recomputed on every keystroke.
    expect(pane).toMatch(/const debouncedAlign = debounce\(updateAlign, \d+\)/);
    expect(pane).toMatch(/alignA\.addEventListener\("input", debouncedAlign\)/);
  });

  it("primer Tm shows a refusal instead of a number it does not have", () => {
    expect(pane).toMatch(/tm\.refusal\n?\s*\? `Primer Tm: \$\{tm\.refusal\}`/);
    expect(pane).toMatch(/tm\.caveats\.length/);
  });

  it("protein properties report the residues they skipped", () => {
    expect(pane).toMatch(/props\.skippedCount/);
    expect(pane).toMatch(/props\.inputLength/);
  });

  it("a sub-minimum sequence BLOCKS the ST.26 build rather than warning", () => {
    // It used to warn and then emit the entry anyway, numbered and counted in
    // SequenceTotalQuantity — a listing the pane had already called non-compliant.
    const i = pane.indexOf("const exclusions = st26Exclusions(entries)");
    expect(i).toBeGreaterThan(0);
    const region = pane.slice(i, i + 700);
    expect(region).toMatch(/seq-warnings error/);
    expect(region).toMatch(/return;/);
  });

  it("chi-square surfaces its expected-count warnings and the exact test", () => {
    expect(pane).toMatch(/caveats: res\.warnings/);
    expect(pane).toMatch(/Fisher's exact \(two-sided\)/);
    expect(pane).toMatch(/report this one on a 2×2/);
  });

  it("ANOVA reports an effect size, which the product mandates for t-tests", () => {
    expect(pane).toMatch(/η² = \$\{effectSize\(res\.etaSquared, 3\)\}/);
    expect(pane).toMatch(/ω² = \$\{effectSize\(res\.omegaSquared, 3\)\}/);
  });

  it("a non-finite effect size does not silently kill the Insert button", () => {
    // assaySig() returns the "—" sentinel for NaN, and the insertability gate
    // blocks any result containing one. ssWithin overflows above ~1e154: f and
    // p stay finite so the outer guard passes, while ω² is NaN.
    expect(pane).toMatch(/Number\.isFinite\(v\) \? assaySig\(v, dp\) : "not computable at this magnitude"/);
  });

  it("ANOVA and Tukey run the assumption check the t-tests already ran", () => {
    const anova = pane.slice(pane.indexOf('id: "anova"'), pane.indexOf('id: "tukey"'));
    expect(anova).toMatch(/describeAssumptions\(groups\)/);
    const tukey = pane.slice(pane.indexOf('id: "tukey"'), pane.indexOf('id: "regression"'));
    expect(tukey).toMatch(/describeAssumptions\(groups\)/);
  });

  it("the assumption calculator uses the variance-robust normality sample", () => {
    // NOT `withinGroupResiduals`. Raw pooled residuals are leptokurtic when the
    // groups differ in spread — measured, that rejected NORMAL data 61% of the
    // time at sd 1:5 and 100% at three groups of 1/1/10. `normalityCheckSample`
    // re-expresses them as normal scores so the pooled vector is standard
    // normal at any group variance; the same measurement falls to ~8%.
    expect(pane).toMatch(/const residuals = normalityCheckSample\(groups\)/);
    expect(pane).not.toMatch(/const residuals = withinGroupResiduals\(groups\)/);
  });

  it("A280 can compute ε from the sequence instead of demanding it", () => {
    expect(pane).toMatch(/extinctionCoefficient\(seq\)/);
    // Both cysteine states, because picking one silently invents a condition
    // the experiment did not state.
    expect(pane).toMatch(/eps\.reduced/);
    expect(pane).toMatch(/eps\.cystines/);
  });

  it("UV-Vis distinguishes 'transparent' from 'outside the model's range'", () => {
    // Both are lambdaMax === null, and reporting β-carotene (bright orange) as
    // "none above 200 nm" would swap one false statement for another.
    expect(pane).toMatch(/r\.outOfDomain/);
    expect(pane).toMatch(/outside this model's range/);
  });

  it("the audit can say 'not checked' rather than showing a false green tick", () => {
    expect(pane).toMatch(/s\.notes\?\.length \? "audit-block" : "audit-block ok"/);
  });

  it("both bond calculators refuse a fractional coupon period", () => {
    // The engine now refuses, and only finMoney gates non-finite values — so
    // without this branch the refusal reached the UI as the literal "NaN yrs".
    const risk = pane.slice(pane.indexOf('id: "bondrisk"'), pane.indexOf('id: "bondrisk"') + 1400);
    expect(risk).toMatch(/bondPeriodRefusal\(years, freq\)/);
    expect(risk).not.toMatch(/a\.macaulay\.toFixed/);
    const price = pane.slice(pane.indexOf('id: "bond",'), pane.indexOf('id: "bond",') + 1200);
    expect(price).toMatch(/bondPeriodRefusal\(\+r\("years"\), \+r\("freq"\)\)/);
  });

  it("IRR names the range it searched instead of claiming none exists", () => {
    expect(pane).toMatch(/IRR = no solution \(searched \$\{IRR_SEARCH_RANGE_TEXT\}\)/);
    expect(pane).toMatch(/XIRR = no solution \(searched \$\{IRR_SEARCH_RANGE_TEXT\}\)/);
  });

  it("the numeral report renders the inverse (one element, two numerals) finding", () => {
    // `ok` was already false on duplicates, so without this branch a
    // duplicates-only report rendered "0 issues found" in red, with no list.
    expect(pane).toMatch(/findings\.duplicates/);
  });

  it("the reaction scheme surfaces its stray-arrow warning", () => {
    expect(pane).toMatch(/spec\.arrowWarning/);
  });
});

describe("found by the adversarial passes — a bond that cannot exist has no price", () => {
  it("refuses a negative or zero maturity, and a negative or zero coupon frequency", () => {
    // `exact = years * freq` is a PRODUCT, and it was the only quantity checked —
    // so two negatives cancelled and sailed through. Measured before the guard:
    // bondPrice(1000, 0.05, 0.06, -10, -2) returned a confident 1139.82 for a
    // bond with a negative maturity paying coupons a negative number of times a
    // year. A price for an instrument that cannot exist, and it looked ordinary.
    for (const [years, freq] of [
      [-10, -2],
      [-10, 2],
      [0, 2],
      [10, 0],
      [10, -2],
    ] as [number, number][]) {
      expect(bondPeriodRefusal(years, freq)).not.toBeNull();
      expect(bondPrice(1000, 0.05, 0.06, years, freq)).toBeNaN();
      expect(bondYTM(950, 1000, 0.05, years, freq)).toBeNull();
    }
  });

  it("still prices every maturity that is a whole number of coupon periods", () => {
    // The guard must not over-refuse: this is the half that makes it a fix
    // rather than a capability removal.
    expect(bondPeriodRefusal(10, 2)).toBeNull();
    expect(bondPeriodRefusal(10.5, 2)).toBeNull(); // 21 periods exactly
    expect(bondPeriodRefusal(10.25, 4)).toBeNull(); // 41 periods exactly
    expect(bondPrice(1000, 0.05, 0.06, 10, 2)).toBeCloseTo(925.61, 2);
    expect(bondPrice(1000, 0.05, 0.06, 10.5, 2)).toBeCloseTo(922.92, 2);
  });

  it("bondYTM survives a fractional maturity — it is a rate, not a clean price", () => {
    // bondPrice returns NaN for a partial period, so a root search over it found
    // nothing and bondYTM returned null for EVERY fractional maturity: 10.25y/2
    // went from 5.637% to "no solution", and the pane's insert gate blocks that
    // string. A refusal introduced by another refusal.
    expect(bondYTM(950, 1000, 0.05, 10.25, 2)).toBeCloseTo(0.0563744, 6);
    expect(bondYTM(950, 1000, 0.05, 3.5, 1)).toBeCloseTo(0.0645812, 6);
  });
});

describe("found by the adversarial passes — prose cannot hijack the Brief Description", () => {
  const figureIssues = (doc: string): string[] => {
    const rep = auditDocument({ documentText: doc, numerals: [], listingCount: 0 });
    return rep.sections.find((s) => /figure/i.test(s.title))?.issues ?? [];
  };

  it("a summary sentence citing a figure does not become the section start", () => {
    // Reproduced on a CORRECT specification. The sentence matches the heading
    // regex, is under 80 characters, and — ending in a digit rather than a full
    // stop — `looksLikeHeading` accepts it. The body then became the one line
    // beneath it, so FIG. 2 was reported missing from a document that describes
    // it. Maximal false alarm, on the surface where false alarms teach an
    // attorney to ignore the audit entirely.
    const doc = [
      "SUMMARY",
      "Brief description of the drawings with reference to FIG. 1",
      "The device is shown in FIG. 1 in its assembled state.",
      "BRIEF DESCRIPTION OF THE DRAWINGS",
      "FIG. 1 is a perspective view.",
      "FIG. 2 is a side view.",
      "DETAILED DESCRIPTION",
      "See FIG. 1 and FIG. 2.",
    ].join("\n");
    expect(figureIssues(doc)).toEqual([]);
  });

  it("still catches the real defect it was written for", () => {
    // The other half: a guard that stops false alarms by never firing is not a
    // fix. A figure discussed in the body and absent from the list must flag.
    const doc = [
      "BRIEF DESCRIPTION OF THE DRAWINGS",
      "FIG. 1 is a perspective view.",
      "FIG. 2 is a side view.",
      "DETAILED DESCRIPTION",
      "See FIG. 1, FIG. 2 and FIG. 3.",
    ].join("\n");
    expect(figureIssues(doc).join(" ")).toMatch(/FIG\. 3/);
  });

  it("a heading carrying a comma still starts the section", () => {
    // Why the test is for a figure CITATION and not for punctuation: tightening
    // the punctuation rule would have silently disabled this heading form.
    const doc = [
      "BRIEF DESCRIPTION OF THE DRAWINGS, FIGURES AND VIEWS",
      "FIG. 1 is a view.",
      "DETAILED DESCRIPTION",
      "See FIG. 1 and FIG. 2.",
    ].join("\n");
    expect(figureIssues(doc).join(" ")).toMatch(/FIG\. 2/);
  });
});

describe("2.1 — the offline promise matches what the build guarantees", () => {
  it("install/README.md no longer promises unqualified offline operation", () => {
    const readme = read("install/README.md");
    // There is no service worker and no precache anywhere in the repo, and the
    // bundle filename carries a contenthash, so the URL changes every release.
    // students.html was already honest about this; these two were not.
    expect(readme).not.toMatch(/After that it works offline\b/);
    expect(readme).toMatch(/delivery is not yet/i);
  });

  it("the manual no longer says flatly that it runs offline after first open", () => {
    const manual = read("landing/manual.html");
    expect(manual).not.toMatch(/\(after that it runs offline\)/);
  });
});
