// SAT-style rate interpretation: the exchange rates computed exactly from the
// pasted equation, and each checkable answer-choice statement judged.

import { tryRateInterpretation } from "../rateInterpretation";
import { solveWordProblem } from "../wordproblem";

const SAT_CORRECT =
  "C=(5/9)(F−32)\n\n" +
  "The equation above shows how temperature F, measured in degrees Fahrenheit, " +
  "relates to a temperature C, measured in degrees Celsius. Based on the equation, " +
  "which of the following must be true?\n\n" +
  "A temperature increase of 1 degree Fahrenheit is equivalent to a temperature increase of 5/9 degree Celsius.\n" +
  "A temperature increase of 1 degree Celsius is equivalent to a temperature increase of 1.8 degrees Fahrenheit.\n" +
  "A temperature increase of 5/9 degree Fahrenheit is equivalent to a temperature increase of 1 degree Celsius.";

describe("the SAT temperature question, faithfully pasted", () => {
  test("both exchange rates are exact, all three statements judged correctly", () => {
    const r = tryRateInterpretation(SAT_CORRECT);
    expect(r).not.toBeNull();
    const all = r!.steps.join("\n");
    // dC/dF = 5/9 and dF/dC = 9/5, exact strings from the CAS.
    expect(all).toMatch(/changes C by 5\/9/);
    expect(all).toMatch(/changes F by 9\/5/);
    // Verdicts: I true, II true, III false — the real answer key.
    const verdicts = r!.steps.filter((s) => s.startsWith("TRUE") || s.startsWith("FALSE"));
    expect(verdicts).toHaveLength(3);
    expect(verdicts[0]).toMatch(/^TRUE/);
    expect(verdicts[1]).toMatch(/^TRUE/);
    expect(verdicts[2]).toMatch(/^FALSE/);
    // The false one shows the real value: 5/9 °F is ~0.308642 °C, not 1.
    expect(verdicts[2]).toContain("0.308642");
  });

  test("it is reachable through solveWordProblem (the pane's word kind)", () => {
    const r = solveWordProblem(SAT_CORRECT);
    expect(r?.template).toBe("rate-interpretation");
  });

  test("the verdicts disclose their premise (the pasted-equation caveat)", () => {
    const r = tryRateInterpretation(SAT_CORRECT)!;
    expect(r.caveats.some((c) => c.includes("exactly as it was read"))).toBe(true);
    expect(r.caveats.some((c) => c.includes("5/9 pastes as 59"))).toBe(true);
  });
});

describe("the mangled paste (59 for 5/9) stays honest by disclosure", () => {
  test("verdicts are computed from the pasted 59, and the premise is shown", () => {
    const mangled = SAT_CORRECT.split("(5/9)").join("59").split("5/9 degree").join("59 degree");
    const r = tryRateInterpretation(mangled)!;
    // The equation used is restated verbatim — garbage in, DISCLOSED garbage out.
    expect(r.equation).toContain("59");
    expect(r.steps.join("\n")).toMatch(/changes C by 59/);
  });
});

describe("direction words are judged, not assumed", () => {
  test("negative slope: 'increase of 1 x is a DECREASE of 2 y' on y = -2x is TRUE", () => {
    const r = tryRateInterpretation(
      "y = -2x\nAn increase of 1 unit x is equivalent to a decrease of 2 units y.",
    )!;
    expect(r.steps.join("\n")).toMatch(/^TRUE/m);
  });

  test("positive slope: 'increase of 1 x is a DECREASE of 2 y' on y = 2x is FALSE", () => {
    const r = tryRateInterpretation(
      "y = 2x\nAn increase of 1 unit x is equivalent to a decrease of 2 units y.",
    )!;
    expect(r.steps.join("\n")).toMatch(/^FALSE/m);
  });

  test("both-decrease on a positive slope is TRUE (signs cancel)", () => {
    const r = tryRateInterpretation(
      "y = 2x\nA decrease of 1 unit x is equivalent to a decrease of 2 units y.",
    )!;
    expect(r.steps.join("\n")).toMatch(/^TRUE/m);
  });

  test("negative slope: both-increase claim is FALSE", () => {
    const r = tryRateInterpretation(
      "y = -2x\nAn increase of 1 unit x is equivalent to an increase of 2 units y.",
    )!;
    expect(r.steps.join("\n")).toMatch(/^FALSE/m);
  });

  test("neutral 'change of' both sides judges magnitude, even on a negative slope", () => {
    const r = tryRateInterpretation(
      "y = -2x\nA change of 1 unit x is equivalent to a change of 2 units y.",
    )!;
    expect(r.steps.join("\n")).toMatch(/^TRUE/m);
  });

  test("a neutral 'change' paired with a signed direction is NOT judged", () => {
    // Which way the change went is unknowable, so guessing is refused.
    const r = tryRateInterpretation(
      "y = 2x\nA change of 1 unit x is equivalent to an increase of 2 units y.",
    )!;
    const all = r.steps.join("\n");
    expect(all).not.toMatch(/^TRUE/m);
    expect(all).not.toMatch(/^FALSE/m);
    expect(all).toContain("NOT judged");
  });
});

describe("honest refusals and guards", () => {
  test("nonlinear relations are refused by name (no fixed exchange rate)", () => {
    const r = tryRateInterpretation("A = (3.14)r^2\nWhat does an increase of 1 in r do to A?");
    expect(r).not.toBeNull();
    expect(r!.answer).toContain("not constant");
    expect(Number.isNaN(r!.value)).toBe(true);
  });

  test("no equation → null (the other templates get their turn)", () => {
    expect(tryRateInterpretation("An increase of 5 percent on 200 dollars.")).toBeNull();
  });

  test("no increase/change prose → null (a bare equation is Solve's job)", () => {
    expect(tryRateInterpretation("C = (5/9)(F - 32)")).toBeNull();
  });

  test("three variables → null (which pair is not guessable)", () => {
    expect(tryRateInterpretation("P V = n * 8\nWhat does an increase in V change?")).toBeNull();
  });

  test("unreadable statements are counted, not judged", () => {
    const text =
      "y = 2x\nAn increase of 1 unit x is equivalent to an increase of 2 units y.\n" +
      "An increase in x makes y bigger in a way that feels right.";
    const r = tryRateInterpretation(text)!;
    const all = r.steps.join("\n");
    expect(all).toMatch(/^TRUE/m);
    expect(all).toContain("NOT judged");
  });

  test("the variable's own letter resolves as its unit word without prose naming", () => {
    const r = tryRateInterpretation(
      "K = 1.8 R\nAn increase of 1 unit R is equivalent to an increase of 1.8 units K.",
    )!;
    expect(r.steps.join("\n")).toMatch(/^TRUE/m);
  });

  test("full unit words WITHOUT prose naming are disclosed as unjudged, not dropped", () => {
    // No "K, measured in kelvins" prose anywhere, so "Kelvin"/"Rankine" can't
    // be attributed to a variable — the statement must be COUNTED, not
    // silently skipped, and never guessed at by first letter.
    const r = tryRateInterpretation(
      "K = 1.8 R\nAn increase of 1 degree Rankine is equivalent to an increase of 1.8 degrees Kelvin.",
    )!;
    const all = r.steps.join("\n");
    expect(all).not.toMatch(/^TRUE/m);
    expect(all).not.toMatch(/^FALSE/m);
    expect(all).toContain("NOT judged");
  });

  test("existing word-problem templates are untouched", () => {
    expect(solveWordProblem("what is 15% of 200")?.template).not.toBe("rate-interpretation");
    expect(solveWordProblem("twice a number plus 7 is 15")).not.toBeNull();
  });
});
