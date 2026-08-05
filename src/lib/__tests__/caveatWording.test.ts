// Two honesty fixes that live entirely in what the user is told.
//
// F9 / defect 0.31 — reactions.arrowWarning is computed, tested, and never read by
// the pane, so `A ->> B` draws as though the arrow were fine: the stray ">" is
// stripped (correctly, so it is not handed to OpenChemLib as SMILES) and the user
// is never told. This test pins the SHAPE the pane has to render.
//
// F10 / Tier 1.10 — nmr2d.ts:274 said "a nominal value is shown because the
// configuration is not specified in the structure" even when the user DID specify
// it: C/C=C/C(=O)O is explicitly trans and still yielded a nominal J. Refusing to
// guess is fine; blaming the user's input for the tool's own limitation is not.

import { parseReaction } from "../reactions";
import { predictCoupling } from "../nmr2d";

describe("F9 — a malformed arrow is reported, not silently swallowed", () => {
  it("A ->> B strips the stray delimiter AND returns a warning", () => {
    const spec = parseReaction("A ->> B");
    expect(spec.stages).toEqual([["A"], ["B"]]);
    expect(spec.arrowWarning).toBeDefined();
    expect(spec.arrowWarning!).toContain("> B");
    expect(spec.arrowWarning!).toMatch(/chemical\s+formula/);
    expect(spec.arrowWarning!).toContain("->");
  });

  it("a well-formed arrow produces no warning", () => {
    expect(parseReaction("CCO + CC(=O)O >> CC(=O)OCC").arrowWarning).toBeUndefined();
    expect(parseReaction("A -> B").arrowWarning).toBeUndefined();
    expect(parseReaction("A <=> B").arrowWarning).toBeUndefined();
  });

  it("the warning is a single renderable string, not an array or an object", () => {
    const spec = parseReaction("A ->> B");
    expect(typeof spec.arrowWarning).toBe("string");
    expect(spec.arrowWarning!.length).toBeGreaterThan(20);
  });
});

describe("F10 — the alkene coupling caveat does not blame the user's input", () => {
  const trans = predictCoupling("C/C=C/C(=O)O");

  it("still fires on an alkene", () => {
    expect(trans).not.toBeNull();
    const alkene = trans!.caveats.find((c) => /alkene/i.test(c));
    expect(alkene).toBeDefined();
  });

  it("no longer claims the configuration is missing from a structure that states it", () => {
    const alkene = trans!.caveats.find((c) => /alkene/i.test(c))!;
    expect(alkene).not.toMatch(/not specified/i);
    expect(alkene).not.toMatch(/because the configuration/i);
  });

  it("still states the ranges and names the limitation as the tool's own", () => {
    const alkene = trans!.caveats.find((c) => /alkene/i.test(c))!;
    expect(alkene).toMatch(/cis/i);
    expect(alkene).toMatch(/trans/i);
    expect(alkene).toMatch(/this tool|not read|does not/i);
  });

  it("fires identically for a structure with NO stated configuration", () => {
    const plain = predictCoupling("CC=CC(=O)O");
    const a = plain!.caveats.find((c) => /alkene/i.test(c))!;
    const b = trans!.caveats.find((c) => /alkene/i.test(c))!;
    expect(a).toBe(b);
  });
});
