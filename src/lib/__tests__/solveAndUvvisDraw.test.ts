// Solve and Spectra/UV-Vis draw, and their figures describe themselves honestly.
//
// WHY A SOURCE GATE RATHER THAN THE PANE AUDIT. `scripts/pane-audit.js` drives
// the four registries that share the `<mode>-calc / -inputs / -result / -insert`
// DOM contract. Solve does not have that shape — one textarea, a kind
// dropdown, two optional bound boxes — and Spectra is driven by a structure
// string, so neither fits the driver's loop.
//
// Leaving them out would put the two surfaces wired LAST in exactly the
// position the four registries were in when this campaign opened: a figure
// could be lost and nothing would fail. That is the founding complaint
// reproduced for the newest code, so they get the strongest gate that fits
// them instead of none.
//
// What this can and cannot see, stated rather than implied: it proves the
// producing branches exist and are wired to the right state, and it proves the
// UV-Vis builder returns a real figure for a real molecule. It cannot prove
// Word honours the insert — only the manual pass in docs/TEST-SCRIPT.md can.

import * as fs from "fs";
import * as path from "path";
import { predictUvVis } from "../uvvis";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");

/**
 * The `uvvis` branch of `buildSpectrumSvg`, matched by braces.
 *
 * NOT a fixed byte window after the `if`. A 1,800-character slice ran past the
 * branch into the neighbouring 2-D chart sizing and the IR code, so a check for
 * "this branch does not simulate a band" matched the word "lorentz" belonging
 * to a different function. A gate that reads code it is not scoped to reports
 * on something other than what it names.
 */
function uvvisBranch(): string {
  const at = PANE.indexOf('if (cur.kind === "uvvis")');
  expect(at).toBeGreaterThan(0);
  const open = PANE.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < PANE.length; i++) {
    if (PANE[i] === "{") depth++;
    else if (PANE[i] === "}") {
      depth--;
      if (depth === 0) return PANE.slice(at, i + 1);
    }
  }
  throw new Error("uvvis branch not closed");
}

/** The body of `updateSolve`, where every Solve figure is produced. */
function updateSolveSource(): string {
  const at = PANE.indexOf("function updateSolve(): void {");
  expect(at).toBeGreaterThan(0);
  const NL = String.fromCharCode(10);
  const end = PANE.indexOf(NL + "}" + NL, at);
  expect(end).toBeGreaterThan(at);
  return PANE.slice(at, end);
}

describe("Solve draws for every kind that has something to draw", () => {
  test("the equation, derivative and integral branches each produce a figure", () => {
    const src = updateSolveSource();
    // Four calls to the shared plotter (equation, derivative, integral, and
    // the ODE solution family), plus the topology barcode elsewhere.
    const produced = (src.match(/currentSolveSvg = solveFunctionSvg\(/g) ?? []).length;
    expect(produced).toBe(4);
  });

  test("the ODE branch draws its solution family with its own caption", () => {
    const src = updateSolveSource();
    const at = src.indexOf("Solution family of");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at - 800, at + 400)).toContain("solveFunctionSvg");
  });

  test("the geometry branch draws composite figures (ratchet raised, not lowered)", () => {
    const src = updateSolveSource();
    // Composite figures came with their own builder; the branch must wire it
    // to the same figure state the insert path reads, with its own alt text.
    expect(src).toContain("currentSolveSvg = compositeShapeSvg(");
    expect(src).toMatch(/currentSolveAlt =[\s\S]{0,300}placement of inner shapes illustrative/);
    // And PREVIEW it in the pane — a figure first seen inside the document is
    // the preview-is-not-insert trap inverted.
    const at = src.indexOf("compositeShapeSvg(");
    expect(src.slice(at, at + 700)).toContain("fig.innerHTML = currentSolveSvg");
  });

  test("every figure carries a caption written by the branch that made it", () => {
    // ALT TEXT THAT LIES IS WORSE THAN NONE. The insert path hardcoded
    // "Persistence barcode: each bar is a topological feature" — true while the
    // barcode was the only figure Solve could make, and false the moment a root
    // plot went through the same path. A root plot was landing in documents
    // describing itself as a topological feature diagram.
    const svgAssignments = (PANE.match(/currentSolveSvg = (?!null)/g) ?? []).length;
    const altAssignments = (PANE.match(/currentSolveAlt =\s*$|currentSolveAlt =[^;]*;/gm) ?? []).length;
    // One reset (to "") plus one per producing branch.
    expect(altAssignments).toBeGreaterThanOrEqual(svgAssignments + 1);
    expect(PANE).toContain("pic.altTextDescription = currentSolveAlt");
    expect(PANE).not.toContain('pic.altTextDescription = "Persistence barcode');
  });

  test("the status message no longer claims a barcode for every figure", () => {
    expect(PANE).not.toContain("Solution and barcode inserted");
    expect(PANE).toContain("Solution and figure inserted");
  });

  test("no Solve sweep bound is taken raw from user input", () => {
    // This runs on every keystroke. The window is derived from the marked
    // points or a fixed span, and clamped — an unbounded one here is a frozen
    // Word, not a slow chart.
    const at = PANE.indexOf("function solveFunctionSvg(");
    expect(at).toBeGreaterThan(0);
    const helper = PANE.slice(at, at + 4000);
    expect(helper).toMatch(/span > 1e12/);
    expect(helper).toMatch(/const N = 200;/);
  });
});

describe("UV-Vis draws its arithmetic, and never a simulated band", () => {
  test("the increment ledger is real: a known chromophore returns contributions", () => {
    // Anti-vacuity: if the predictor stopped producing contributions, the
    // figure below would be empty and the source check alone would still pass.
    // beta-ionone is a Woodward-Fieser case the module handles.
    const uv = predictUvVis("CC1=C(C(CCC1)(C)C)/C=C/C(=O)C");
    // The predictor returns null when it cannot read the structure at all —
    // distinct from returning a result whose lambdaMax is null (a refusal).
    expect(uv).not.toBeNull();
    if (!uv) return;
    expect(uv.lambdaMax).not.toBeNull();
    expect(uv.contributions.length).toBeGreaterThan(0);
    // The ledger must add up to the reported answer — that is the whole claim
    // the waterfall makes.
    const summed = uv.contributions.reduce((a, c) => a + c.nm, 0);
    expect(summed).toBeCloseTo(uv.lambdaMax as number, 6);
  });

  test("the pane draws that ledger and refuses when there is nothing to add up", () => {
    const branch = uvvisBranch();
    expect(branch).toContain("ladderSvg");
    expect(branch).toMatch(/Woodward-Fieser/);
    // A refusal (lambdaMax null) still draws nothing, rather than a ladder of
    // increments leading to no answer.
    expect(branch).toMatch(/uv\.lambdaMax === null/);
  });

  test("it does not invent an absorption band", () => {
    // The reason this returned null for years was sound: a bell curve at lambda
    // max would invent a width, a shape and an intensity the rules do not
    // predict. The ledger is real arithmetic; a band would not be.
    //
    // COMMENTS STRIPPED FIRST. The branch's own comment explains why it does
    // not simulate a band, and naming the thing it refuses to do made the check
    // match the explanation rather than the code — a test failing on prose that
    // agrees with it.
    const code = uvvisBranch()
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/gauss|lorentz|exp\(-/i);
    // And positively: what it DOES draw is the ledger.
    expect(code).toContain("ladderSvg");
  });
});
