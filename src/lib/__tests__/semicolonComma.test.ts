// "0,5;1,5;2,5" can be three decimals or three groups of two (six values). The readers disagreed in silence —
// a Stats group or table field took the pairs, a list field the decimals — and the user chose to be ASKED
// (2026-10-21). numberList.ts semicolonCommaRefusal names both readings and how to type each; the Finance and
// Assay lists (calcList.ts) and every Stats list and group field (taskpane.ts updateStatsPreview) refuse with it.
import * as fs from "fs";
import * as path from "path";
import { semicolonCommaRefusal } from "../numberList";
import { ListTokenError, readCalcList } from "../calcList";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");

describe("the ambiguous shape is asked about", () => {
  it.each(["0,5;1,5;2,5", "0,5; 1,5; 2,5", "10,20;30,40", "1,250;2,5", "0,5;3;2,5", "−1,5;2,5", "0,5;\t1,5;"])("%s", (s) => {
    expect(semicolonCommaRefusal(s, "numbers")).toMatch(/can be read two ways/);
    expect(semicolonCommaRefusal(s, "groups")).toMatch(/can be read two ways/);
  });

  it("a list field names the numbers and the separate values, with how to type each", () => {
    expect(semicolonCommaRefusal("0,5;1,5;2,5", "numbers")).toBe(
      "“0,5;1,5;2,5” can be read two ways: as the numbers 0.5; 1.5; 2.5, or as 6 separate values (0, 5, 1, …). " +
        "Write 0.5 for the first reading, or a comma then a space (0, 5) for the second.",
    );
  });

  it("a group field names the numbers and the groups (groups of one value cannot be what ANOVA was given: review 2)", () => {
    const m = semicolonCommaRefusal("0,5;1,5;2,5", "groups");
    expect(m).toBe(
      "“0,5;1,5;2,5” can be read two ways: as the numbers 0.5; 1.5; 2.5, or as 3 groups (0, 5; 1, 5; 2, 5). " +
        "Write 0.5 for the first reading, or a comma then a space (0, 5) for the second.",
    );
    expect(m).not.toMatch(/groups of one/);
  });

  it("a list of thousands is not asked: semicolons are how such a list is typed (review 2)", () => {
    expect(semicolonCommaRefusal("-10,000; 2,500; 3,000", "numbers")).toBe("");
    expect(semicolonCommaRefusal("1,250;2,500", "numbers")).toBe("");
    // A group field still asks: its reader would take 10 and 0, silently.
    expect(semicolonCommaRefusal("1,250;2,500", "groups")).toContain("as the numbers 1250; 2500, or as 2 groups (1, 250; 2, 500)");
  });

  it("a field that proves a decimal comma reads 1,250 as 1.25 — in the sentence AND the advice (review 1)", () => {
    const m = semicolonCommaRefusal("1,250;2,5", "numbers");
    expect(m).toContain("as the numbers 1.25; 2.5,");
    expect(m).toContain("Write 1.25 for the first reading");
  });

  it.each([
    ["percent", "1,5%;2,5%", "(1, 5%)"],
    ["×10ⁿ", "1,5×10⁻³;2,5×10⁻³", "(1, 5×10⁻³)"],
    ["a no-break space before %", `1,5;2,5${String.fromCharCode(160)}%`, "(1, 5)"],
  ])("the %s variant is the same question (review 2)", (_k, s, part) => {
    expect(semicolonCommaRefusal(s, "numbers")).toContain(part);
    expect(semicolonCommaRefusal(s, "groups")).toMatch(/can be read two ways/);
  });

  it("a ×10ⁿ value is shown and advised as typed with a point, never rounded to 0 (review 2 blocker)", () => {
    const m = semicolonCommaRefusal("6,626×10⁻³⁴;1,5", "numbers");
    expect(m).toContain("as the numbers 6.626×10⁻³⁴; 1.5,");
    expect(m).toContain("Write 6.626×10⁻³⁴ for the first reading");
    expect(semicolonCommaRefusal("1,5×10⁻²⁰;2,5", "groups")).toContain("Write 1.5×10⁻²⁰ for");
    expect(semicolonCommaRefusal("0,000000000000000000001;1,5", "numbers")).toContain("Write 0.000000000000000000001 for");
  });

  it("the separate values are shown as the reader reads them, not as typed (review 5)", () => {
    expect(semicolonCommaRefusal("0,05;0,01", "groups")).toContain("2 groups (0, 5; 0, 1)");
    expect(semicolonCommaRefusal("1,000;2,000", "groups")).toContain("2 groups (1, 0; 2, 0)");
    expect(semicolonCommaRefusal("5%;1,5", "groups")).toContain("2 groups (5%; 1, 5)");
  });

  it("every digit of the value read, and no binary noise (review 6)", () => {
    expect(semicolonCommaRefusal("123456789012345,5;1,5", "numbers")).toContain("Write 123456789012345.5 for");
    expect(semicolonCommaRefusal("0,0000001;0,5", "numbers")).toContain("as the numbers 0.0000001; 0.5,");
    expect(semicolonCommaRefusal("0,3;1,1", "numbers")).toContain("as the numbers 0.3; 1.1,");
  });

  it("line breaks and tabs in the quoted field do not break the message (review 7)", () => {
    expect(semicolonCommaRefusal("0,5\r\n;\t1,5", "numbers")).toMatch(/^“0,5 ; 1,5” can be read/);
  });

  it("a minus is the true minus in the message (display contract)", () => {
    const m = semicolonCommaRefusal("-1,5;2,5", "groups");
    expect(m).toContain("as the numbers −1.5; 2.5,");
    expect(m).toContain("(−1, 5)");
    expect(m).not.toMatch(/(^|[\s(;,])-\d/);
  });
});

describe("shapes that already say what they mean are not asked about", () => {
  it.each([
    ["values separated by spaces prove decimal commas", "1,5 2,5"],
    ["a comma then a space is a separator", "0, 5; 1, 5"],
    ["two commas in a piece is comma-listing", "1,2,3;4,5,6"],
    ["a dot before the comma proves it decimal", "1.000,5;2.000,5"],
    ["no comma at all", "0.5;1.5"],
    ["plain integers", "4;5;6"],
    ["no semicolon (newline tables keep their v2.160.0 reading)", "10,20\n30,40"],
    ["a line break proves decimal commas, as spaces do (review 4: statGroups reads [[0.5, 1.5], [2.5]])", "0,5\n1,5;2,5"],
    ["one run without a semicolon (the documented comma list)", "1,5"],
    ["a word in the field (refused by its own reader)", "a,5;1,5"],
    ["an empty field", ""],
  ])("%s: %s", (_why, s) => {
    expect(semicolonCommaRefusal(s, "numbers")).toBe("");
    expect(semicolonCommaRefusal(s, "groups")).toBe("");
  });
});

describe("Finance and Bio/Assay list fields refuse it", () => {
  it("readCalcList throws the refusal as a ListTokenError (both panes show its message)", () => {
    expect(() => readCalcList("0,5;1,5;2,5")).toThrow(ListTokenError);
    expect(() => readCalcList("0,5;1,5;2,5")).toThrow(/can be read two ways/);
  });
  it("an unambiguous list still reads", () => {
    expect(readCalcList("0.5; 1.5; 2.5").values).toEqual([0.5, 1.5, 2.5]);
    expect(readCalcList("0, 5, 1, 5").values).toEqual([0, 5, 1, 5]);
  });
  it("both panes turn a ListTokenError into the shown message", () => {
    expect(PANE).toMatch(/if \(error instanceof ListTokenError\) refusal = error\.message;/);
    expect(PANE).toMatch(/error instanceof ListTokenError \? error\.message : "Could not compute — check the inputs\."/);
  });
});

describe("every Stats list and group field is checked before the calculator runs", () => {
  const at = PANE.indexOf("const ambiguous = calc.fields");
  const ask = PANE.slice(PANE.indexOf("const asksComma = "), at);
  it("lists are asked as numbers, groups split at semicolons as groups, and the message is labelled", () => {
    expect(at).toBeGreaterThan(0);
    expect(ask).toMatch(/f\.kind === "list" \? "numbers"/);
    expect(ask).toMatch(/f\.kind === "groups" && \(f\.table === undefined \|\| f\.table === "groups"\) \? "groups" : null/);
    expect(PANE.slice(at, at + 400)).toMatch(/\$\{calc\.fields\[i\]\.label\}: \$\{msg\}/);
  });
  it("fields whose rows need two values are never asked: the pairs are their one reading (review 3)", () => {
    // Kaplan–Meier "5,1;6,1;6,0;8,1" stays times 5, 6, 6, 8 with events 1, 1, 0, 1, as it always was.
    for (const shape of ["survival", "survival-groups", "rows", "subjects", "subjects-between", "counts", "cox", "factorial"]) {
      expect(PANE).toContain(`table: "${shape}"`);
    }
    expect(ask).not.toMatch(/survival|rows|subjects|counts|cox|factorial/);
  });
  it("it sits in updateStatsPreview, before the one compute call, and refuses with ok: false", () => {
    const fn = PANE.indexOf("function updateStatsPreview(): void {");
    const compute = PANE.indexOf("out = calc.compute(read);", fn);
    expect(fn).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(fn);
    expect(at).toBeLessThan(compute);
    expect(PANE.slice(at, compute)).toMatch(/out = \{ text: ambiguous, ok: false \};/);
  });
});
