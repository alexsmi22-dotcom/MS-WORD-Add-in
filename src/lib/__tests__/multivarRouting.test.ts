/**
 * Routing, not engine: a green multivar.test.ts proves nothing about whether
 * the pane can REACH tryMultivar (three Solve features once shipped fully
 * tested and unreachable). taskpane.ts cannot be imported under jest (Office.js),
 * so the wiring is asserted on the source text.
 */
import * as fs from "fs";
import * as path from "path";
import { MULTIVAR_VERB_RE, tryMultivar } from "../multivar";
import { tryLaplace } from "../laplace";
import { tryFourierSeries } from "../fourier";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");

describe("the pane reaches the multivariable verbs", () => {
  it("imports tryMultivar and the verb guard", () => {
    expect(PANE).toMatch(/import \{ tryMultivar, MULTIVAR_VERB_RE \} from "\.\.\/lib\/multivar";/);
  });
  it("tries the multivariable verbs FIRST in the transform chain, on both the raw and the folded text", () => {
    expect(PANE).toMatch(/const verb =\s*tryMultivar\(text\) \?\?\s*tryMultivar\(taskText\) \?\?\s*tryLaplace\(taskText\)/);
  });
  it("the prose-switch guard stands aside for a multivariable verb", () => {
    expect(PANE).toMatch(/MULTIVAR_VERB_RE\.test\(text\)/);
  });
});

describe("the verb guard and the engine agree", () => {
  const verbs = [
    "gradient x^2 y",
    "grad x y z",
    "hessian x^3 + y^3",
    "jacobian (x + y, x - y)",
    "directional derivative x y at (1,1) in direction (1,0)",
    "critical points x^2 + y^2",
    "stationary points x^2 - y^2",
    "lagrange x y subject to x + y = 1",
    "maximize x y subject to x + y = 1",
    "minimise x^2 + y^2 subject to x + y = 1",
    "double integral x y over x from 0 to 1, y from 0 to 1",
    "triple integral 1 over x from 0 to 1, y from 0 to 1, z from 0 to 1",
    "divergence (x, y)",
    "curl (-y, x)",
    "potential (2 x, 2 y)",
    "line integral (2 x, 2 y) from (0,0) to (1,1)",
  ];
  it.each(verbs)("%s is guarded AND handled", (q) => {
    expect(MULTIVAR_VERB_RE.test(q)).toBe(true);
    expect(tryMultivar(q)).not.toBeNull();
  });
  const prose = ["gradient descent converges", "divide 10 by 2", "rotate the figure", "curly braces", "delta t = 3", "laplace t^2", "fourier series t on (-1, 1)", "x^2 + y^2 = 1"];
  it.each(prose)("%s is left alone", (q) => {
    expect(tryMultivar(q)).toBeNull();
  });
  it("does not steal the Laplace and Fourier verbs", () => {
    expect(tryLaplace("laplace t^2")).not.toBeNull();
    expect(tryFourierSeries("fourier series t on (-1, 1)")).not.toBeNull();
  });
});
