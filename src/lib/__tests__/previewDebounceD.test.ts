// Release D, data entry, defect 3: Stats/Solve keystroke recompute.
//
// MEASURED FIRST (production bundle in headless Edge, one input event + layout of the result; numbers in
// lib/previewDebounce.ts): most tools 1–30 ms on 2000 values, but polynomial regression 162 ms, the integral of
// x³·eˣ·sin x 94–112 ms, Tukey HSD 0.5 s at 20 groups / 4.0 s at 50 / 31.8 s at 500, Dunnett 0.8 s at 50 / 5.3 s at
// 500. So: a 200 ms debounce on keystrokes, Insert flushes first, and Tukey/Dunnett get the 20-group cap that
// Games–Howell and Welch's ANOVA already had.
import * as fs from "fs";
import * as path from "path";
import { debouncedPreview, flushBeforeInsert, previewListener, PREVIEW_DEBOUNCE_MS } from "../previewDebounce";
import { tukeyGroupLimit, TUKEY_MAX_GROUPS } from "../tukey";
import { dunnettTest, DUNNETT_MAX_GROUPS } from "../dunnett";
import { WELCH_MAX_GROUPS } from "../welch";

describe("debouncedPreview", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("keystrokes coalesce into one run after the pause", () => {
    const run = jest.fn();
    const p = debouncedPreview(run);
    p.schedule();
    jest.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 1);
    p.schedule();
    jest.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 1);
    expect(run).not.toHaveBeenCalled();
    expect(p.pending()).toBe(true);
    jest.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(p.pending()).toBe(false);
  });

  test("flush runs a pending preview synchronously, once; with nothing pending it does nothing", () => {
    const run = jest.fn();
    const p = debouncedPreview(run);
    expect(p.flush()).toBe(false);
    p.schedule();
    expect(p.flush()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(10 * PREVIEW_DEBOUNCE_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("cancel drops the pending run (a direct recompute superseded it)", () => {
    const run = jest.fn();
    const p = debouncedPreview(run);
    p.schedule();
    p.cancel();
    jest.advanceTimersByTime(10 * PREVIEW_DEBOUNCE_MS);
    expect(run).not.toHaveBeenCalled();
  });

  test("previewListener: input waits, change and a direct call run now", () => {
    const run = jest.fn();
    const p = debouncedPreview(run);
    const on = previewListener(p, run);
    on({ type: "input" });
    expect(run).not.toHaveBeenCalled();
    on({ type: "change" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(p.pending()).toBe(false);
    on();
    expect(run).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(10 * PREVIEW_DEBOUNCE_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  test("Insert never inserts the stale result: the flush decides the button first", () => {
    // A model of the pane: the preview sets `text` and the button from the CURRENT input.
    let input = "1 2 3";
    let text = "";
    const button = { disabled: true };
    const recompute = (): void => {
      const ok = !/x/.test(input);
      text = ok ? `mean of ${input}` : "";
      button.disabled = !ok;
    };
    const p = debouncedPreview(recompute);
    recompute();
    expect(button.disabled).toBe(false);
    // The user types a character that breaks the input and clicks Insert before the pause ends.
    input = "1 2 x";
    p.schedule();
    expect(button.disabled).toBe(false); // the stale state still says insertable…
    expect(flushBeforeInsert(p, button)).toBe(false); // …but the flush recomputes first, and nothing is inserted
    expect(text).toBe("");
    // And the other way round: a fix typed just before Insert is what gets inserted.
    input = "4 5 6";
    p.schedule();
    expect(flushBeforeInsert(p, button)).toBe(true);
    expect(text).toBe("mean of 4 5 6");
  });
});

describe("the pane wires it (taskpane.ts is not importable; source scan)", () => {
  const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
  test("Stats and Solve keystrokes are debounced and every Insert flushes first", () => {
    // E1 fix: the same import also brings Finance's block-field debounce (pinned in damagesE1fix.test.ts).
    expect(PANE).toMatch(/import \{ blockFieldListener, debouncedPreview, FIN_BLOCK_DEBOUNCE_MS, flushBeforeInsert, previewListener \} from "\.\.\/lib\/previewDebounce";/);
    expect(PANE).toContain("const statsPreview = debouncedPreview(() => updateStatsPreview());");
    expect(PANE).toContain("const solvePreview = debouncedPreview(() => updateSolve());");
    expect(PANE).toContain('renderCalcFields(calc.fields, statsInputs, "stats", previewListener(statsPreview, updateStatsPreview));');
    expect(PANE).toContain("if (flushBeforeInsert(statsPreview, statsInsertBtn)) void runCompositeInsert(statsInsertBtn, insertStatsResult);");
    expect(PANE).toContain("if (flushBeforeInsert(statsPreview, statsInsertChartBtn)) void insertStatsChart();");
    expect(PANE).toContain("if (flushBeforeInsert(solvePreview, solveInsertBtn)) void runCompositeInsert(solveInsertBtn, insertSolveResult);");
    for (const el of ["solveInput", "solveA", "solveB"]) expect(PANE).toContain(`${el}.addEventListener("change", () => solvePreview.flush());`);
    // No Solve field still recomputes synchronously per keystroke.
    expect(PANE).not.toMatch(/solve(Input|A|B)\.addEventListener\("input", updateSolve\)/);
    expect(PANE).not.toMatch(/solveInput\.addEventListener\("input", \(\) => \{ solveVarChoice = null; updateSolve\(\); \}\)/);
    // "Add this figure to the panels" snapshots the current figure: it flushes first too.
    expect(PANE).toMatch(/function addCurrentFigureToPanels\(\): void \{\n(\s+\/\/[^\n]*\n)?\s+statsPreview\.flush\(\);\n\s+solvePreview\.flush\(\);\n\s+finPreview\.flush\(\);\n\s+const item = currentModeFigure\(\);/);
    // A direct recompute supersedes a pending one.
    expect(PANE).toMatch(/function updateStatsPreview\(\): void \{\n\s+statsPreview\.cancel\(\);/);
    expect(PANE).toMatch(/function updateSolve\(\): void \{\n\s+solvePreview\.cancel\(\);/);
  });
  test("the QC pane audit leaves each field (change) after typing, so it reads a current result", () => {
    const drv = fs.readFileSync(path.join(__dirname, "..", "..", "..", "scripts", "pane-audit-driver.js"), "utf8");
    expect(drv).toContain('if (el.tagName !== "SELECT") el.dispatchEvent(new Event("change", { bubbles: true }));');
    const trace = fs.readFileSync(path.join(__dirname, "..", "..", "..", "scripts", "host-trace-driver.js"), "utf8");
    // host-trace already sends input then change for every seeded value.
    expect(trace).toMatch(/el\.dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\);\s*\n\s*el\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\);/);
  });
  test("Tukey's pane entry refuses above the cap before computing", () => {
    expect(PANE).toMatch(/const tooMany = tukeyGroupLimit\(groups\.length\);\n\s+if \(tooMany\) return \{ text: tooMany, ok: false \};\n\s+const alpha = Number\(r\("alpha"\)\) \|\| 0\.05;\n\s+const res = tukeyHSD\(groups, alpha\);/);
  });
});

describe("Tukey HSD and Dunnett: the 20-group cap Games–Howell already had", () => {
  const group = (g: number, n: number): number[] => Array.from({ length: n }, (_, i) => 10 + g + ((i % 7) * 0.37) + i * 0.001);
  test("one limit across the post-hoc tools", () => {
    expect(TUKEY_MAX_GROUPS).toBe(WELCH_MAX_GROUPS);
    expect(DUNNETT_MAX_GROUPS).toBe(WELCH_MAX_GROUPS);
  });
  test.each([
    [2, null],
    [20, null],
    [21, "Tukey HSD is limited to 20 groups here (21 were entered). Each of the 210 pairs needs its own studentized-range probability, and beyond this the pane would stall while you type."],
    [500, "Tukey HSD is limited to 20 groups here (500 were entered). Each of the 124750 pairs needs its own studentized-range probability, and beyond this the pane would stall while you type."],
  ])("tukeyGroupLimit(%i)", (k, msg) => {
    expect(tukeyGroupLimit(k)).toBe(msg);
  });
  test("Dunnett: 20 groups run, 21 are refused by name", () => {
    const groups20 = Array.from({ length: 20 }, (_, g) => group(g, 5));
    expect(dunnettTest(groups20[0], groups20.slice(1)).ok).toBe(true);
    const groups21 = Array.from({ length: 21 }, (_, g) => group(g, 5));
    const r = dunnettTest(groups21[0], groups21.slice(1));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(
      "Dunnett's test is limited to 20 groups here, the control included (21 were entered). Every treatment's p-value is a multivariate-t probability over all the comparisons, and beyond this the pane would stall while you type.",
    );
  });
});
