// E1a routing: the three damages calculators are REACHABLE from the Finance pane, wired to the engines, take their
// table fields with the data-source bar, and insert text + table + figure as one package. (A green engine suite
// proves nothing about whether the pane can reach it: routing-vs-engine-tests.)
import { paneCode } from "./paneCode";

const PANE = paneCode();

function finCalcsBlock(): string {
  const start = PANE.indexOf("const FIN_CALCS: FinCalc[] = [");
  expect(start).toBeGreaterThan(0);
  const end = PANE.indexOf("\n];\n", start);
  return PANE.slice(start, end);
}

function entry(id: string): string {
  const block = finCalcsBlock();
  const at = block.indexOf(`id: "${id}"`);
  expect(at).toBeGreaterThan(0);
  const next = block.indexOf("\n    id: ", at + 5);
  return block.slice(at, next < 0 ? block.length : next);
}

describe("damages calculators in the Finance registry", () => {
  test("one contiguous block near the end of FIN_CALCS, under its header comment", () => {
    const block = finCalcsBlock();
    const header = block.indexOf("// Litigation damages: interest and lost earnings (E1a)");
    expect(header).toBeGreaterThan(0);
    const ids = ["dmg-prejudgment", "dmg-postjudgment", "dmg-lost-earnings"].map((id) => block.indexOf(`id: "${id}"`));
    expect(ids.every((i) => i > header)).toBe(true);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });
  test("each compute calls its engine and refuses by finRefuse", () => {
    expect(entry("dmg-prejudgment")).toMatch(/prejudgmentReport\(\{ tranches: r\("tranches"\), rates: r\("rates"\)/);
    expect(entry("dmg-postjudgment")).toMatch(/postjudgmentReport\(/);
    expect(entry("dmg-lost-earnings")).toMatch(/lostEarningsReport\(/);
    for (const id of ["dmg-prejudgment", "dmg-postjudgment", "dmg-lost-earnings"]) expect(entry(id)).toContain("finRefuse(out.text)");
  });
  test("the tranche and rate fields are block fields (so the Use-table-at-cursor bar is built for them)", () => {
    const e = entry("dmg-prejudgment");
    expect(e).toMatch(/key: "tranches",[\s\S]*?kind: "block"/);
    expect(e).toMatch(/key: "rates",[\s\S]*?kind: "block"/);
    expect(PANE).toContain('const DATA_FIELD_KINDS = new Set(["block", "list", "matrix"]);');
    expect(PANE).toContain('const MULTILINE_FIELD_KINDS = new Set(["groups", "vars", "matrix", "block", "line", "plot"]);');
  });
  test("date and table fields skip the number reader", () => {
    expect(PANE).toContain('if (f.kind === "select" || f.kind === "list" || f.kind === "text" || f.kind === "block") continue;');
  });
  test("the table rides with the text and figure in one package; without a figure, text and table together", () => {
    // One table (E1a) or several (E1b) become the same list, inserted by insertTextTablesFigure as one package
    // (figure or none).
    expect(PANE).toContain("tables = out.tables ?? (out.table ? [out.table] : []);");
    expect(PANE).toMatch(/if \(currentFinTables\.length\) \{[\s\S]{0,400}await insertTextTablesFigure\(/);
    // table cells pass the insert gate too
    expect(PANE).toContain("const tableOk = tables.every((t) => tableCellsInsertable(t.rows));");
  });
});
});
