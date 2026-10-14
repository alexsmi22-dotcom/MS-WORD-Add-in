/**
 * Routing, not engine (v2.135.0): the pane must REACH abstract algebra from
 * the default Equation kind. Asserted on the taskpane source (it cannot be
 * imported under jest): the import, the call on the RAW input, and the call's
 * position — BEFORE transformVerb (whose INTERP_VERB_RE reads "lagrange:" as
 * interpolation) and before the inequality path (`<3>` is not a comparison).
 * Also pins the tryAlgebraVerb stand-aside: `factor x^2 + 1 over F_2`
 * printed "F_2" as the factorisation (SCOPE-ABSTRACT-ALGEBRA §E.6).
 */
import * as fs from "fs";
import * as path from "path";
import { algebraKindFor, algebraSwitchNote, ALGEBRA_SWITCH_NOTE } from "../algebraSwitch";
import { tryAlgebraVerb } from "../algebraTools";
import { solveDiscrete } from "../discrete";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");

describe("the pane reaches abstract algebra", () => {
  it("imports the shared decision function", () => {
    expect(PANE).toMatch(/import \{ algebraKindFor, algebraSwitchNote \} from "\.\.\/lib\/algebraSwitch";/);
  });
  it("decides on the RAW input and inserts the note", () => {
    expect(PANE).toMatch(/const algebraOwner = algebraKindFor\(solveInput\.value\);/);
    expect(PANE).toMatch(/const note = algebraSwitchNote\(solveInput\.value\);/);
  });
  it("the switch comes before transformVerb, the computation-theory switch and the inequality path", () => {
    const at = PANE.indexOf("const algebraOwner = algebraKindFor(solveInput.value);");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(PANE.indexOf("const transformVerb ="));
    expect(at).toBeLessThan(PANE.indexOf("const owner = computationKindFor(solveInput.value);"));
    expect(at).toBeLessThan(PANE.indexOf("const iq = solveInequality(text);"));
  });
});

describe("lagrange: the group-theory phrases switch; the interpolation ones do not", () => {
  it.each(["lagrange: subgroups of order 4 in Z/12", "lagrange's theorem for Z/12"])("%s → Discrete kind", (q) => {
    expect(algebraKindFor(q)).toBe("discrete");
    expect(algebraSwitchNote(q)).toBe(ALGEBRA_SWITCH_NOTE);
    expect(solveDiscrete(q)!.title).toMatch(/Subgroups/);
  });
  it.each([
    "lagrange polynomial through (1, 2), (2, 3), (4, 7)",
    "lagrange interpolation (0, 1), (1, 3), (2, 2)",
    "interpolate (1, 2), (2, 3), (4, 7)",
    "maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x >= 0, y >= 0",
    "lagrange multipliers f = x*y subject to x + y = 10",
  ])("%s stays in the Equation kind", (q) => {
    expect(algebraKindFor(q)).toBeNull();
  });
});

describe("tryAlgebraVerb stands aside for polynomials over a finite ring", () => {
  it.each([
    "factor x^2 + 1 over F_2", "factor x^4 + x + 1 over F_2", "factor x^3 + x + 1 over F_2", "factor x^4 + x^2 + 1 over F_2",
    "factor x^2 + 1 mod 3", "factor x^2 + 1 in Z/5", "factor x^2 + 2 over GF(3)", "expand (x + 1)^2 over F_2", "simplify (x+1)(x+2) mod 3",
  ])("%s → null (algebra's 𝔽p[x] owns it)", (q) => {
    expect(tryAlgebraVerb(q)).toBeNull();
  });
  it("factor over ℚ is untouched", () => {
    expect(tryAlgebraVerb("factor x^2 - 5x + 6")).not.toBeNull();
  });
});
