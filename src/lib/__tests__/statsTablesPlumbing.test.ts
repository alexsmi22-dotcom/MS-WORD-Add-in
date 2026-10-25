/**
 * Release E2 plumbing: Stats results may carry tables (StatOutput.tables). taskpane.ts cannot be imported by jest
 * (Office.js), so these pin the source: the preview gates the cells, the insert sends text + tables + figure as ONE
 * package through insertTextTablesFigure, a table's legend line goes in directly under it, and a result without
 * tables takes exactly the path it took before.
 */
import * as fs from "fs";
import * as path from "path";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");

function bodyOf(name: string): string {
  const i = PANE.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found`);
  return PANE.slice(i, PANE.indexOf("\n}\n", i));
}

describe("Stats tables reach Word as one package", () => {
  test("the preview gates every cell and the legend line, and clears the tables on a refusal", () => {
    const b = bodyOf("updateStatsPreview");
    expect(b).toContain("const statTables = out.ok !== false ? (out.tables ?? []) : [];");
    expect(b).toContain("tableCellsInsertable(t.rows) && (!t.note || insertableResultText(t.note))");
    expect(b).toContain("const insertable = out.ok !== false && insertableResultText(out.text) && tablesInsertable;");
    expect(b).toContain("currentStatsTables = insertable ? statTables : [];");
  });
  test("insert: tables → insertTextTablesFigure before the old text/figure branches", () => {
    const b = bodyOf("insertStatsResult");
    const tables = b.indexOf("if (currentStatsTables.length)");
    expect(tables).toBeGreaterThan(0);
    expect(b.indexOf("insertTextTablesFigure(", tables)).toBeGreaterThan(tables);
    // The pre-E2 paths are still there, after it, unchanged.
    expect(b.indexOf("await insertPlainText(currentStatsText, \"Statistics\");")).toBeGreaterThan(tables);
    expect(b.indexOf("await insertTextWithFigure(currentStatsText, \"Statistics\", {")).toBeGreaterThan(tables);
  });
  test("a table's note goes in right after the table, and in the plain-text fallback", () => {
    const b = bodyOf("insertTextTablesFigure");
    // E2 fix round: the table's column alignment rides along (the regression table centres its models).
    expect(b).toContain('items.push({ kind: "table", label: t.label, rows: t.rows, align: t.align });\n      // A table\'s legend line');
    expect(b).toContain('if (t.note) items.push({ kind: "text", content: t.note });');
    expect(b).toContain('(t.note ? `\\n${t.note}` : "")');
  });
  test("both regression calculators are registered with a data-table field", () => {
    expect(PANE).toContain('id: "econ-ols",');
    expect(PANE).toContain('id: "econ-regtable",');
    expect(PANE).toMatch(/key: "data", label: "Data: a header row of column names, then one row per observation", default: LONGLEY_DEFAULT, kind: "block"/);
  });
});
