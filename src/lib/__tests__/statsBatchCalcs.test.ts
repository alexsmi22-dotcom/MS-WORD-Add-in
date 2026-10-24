/**
 * The v2.134.0 Stats calculators as the PANE runs them: field text → engine →
 * report text → figure (src/lib/statsBatchCalcs.ts, which the STAT_CALCS
 * entries `rmanova` and `cox` call and nothing else). Values are the §D
 * oracle values from docs/SCOPE-STATS-BATCH.md (pingouin / SciPy for RM
 * ANOVA, lifelines + statsmodels for Cox) — compared on the printed strings,
 * because the printed string is what a user inserts.
 */
import * as fs from "fs";
import * as path from "path";
import { rmAnovaCalc, readRmField, rmFieldText, coxCalc, readCoxField, safeName, pText } from "../statsBatchCalcs";
import { readCoxTable, feedCox, readSubjectsBetween, feedSubjectsBetween } from "../tableFeed";
import larynxJson from "./fixtures/cox-larynx.json";
import rossiJson from "./fixtures/cox-rossi.json";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
/** The pane's insert gate (insertableResultText), replayed. */
const insertable = (t: string): boolean => !!t && !t.includes("—") && !t.includes("NaN") && !t.includes("Infinity");
const realSvg = (s: string | undefined): boolean =>
  !!s && /^<svg\b/.test(s) && s.trim().endsWith("</svg>") && /<text[ >]/.test(s) && !/NaN|Infinity|undefined/.test(s);

const BUSH =
  "Stick_insect Kangaroo_testicle Fish_eye Witchetty_grub\n8 7 1 6\n9 5 2 5\n6 2 3 8\n5 3 1 9\n8 4 5 8\n7 5 6 7\n10 2 7 2\n12 6 8 1";
const MIXED =
  "Drug 10 12 14\nDrug 9 11 15\nDrug 12 13 16\nDrug 8 10 13\nPlacebo 11 11 12\nPlacebo 10 12 11\nPlacebo 12 12 13\nPlacebo 9 10 10";
const sixMP = {
  t: [6, 6, 6, 6, 7, 9, 10, 10, 11, 13, 16, 17, 19, 20, 22, 23, 25, 32, 32, 34, 35],
  e: [1, 1, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0],
};
const PLACEBO = [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23];
const GEHAN = ["time status placebo", ...sixMP.t.map((t, i) => `${t} ${sixMP.e[i]} 0`), ...PLACEBO.map((t) => `${t} 1 1`)].join("\n");

/** A shipped default, read out of the STAT_CALCS source. */
function paneDefault(id: string): string {
  const start = PANE.indexOf("const STAT_CALCS: StatCalc[] = [");
  const src = PANE.slice(start, PANE.indexOf("\n];", start));
  const at = src.indexOf(`id: "${id}"`);
  expect(at).toBeGreaterThan(0);
  const d = /default: "((?:[^"\\]|\\.)*)"/.exec(src.slice(at))!;
  return d[1].replace(/\\n/g, "\n");
}

describe("repeated-measures ANOVA calculator (§D3 bushtucker — the shipped default)", () => {
  const out = rmAnovaCalc(BUSH, "holm");
  test("the shipped default IS the bushtucker set", () => {
    expect(paneDefault("rmanova")).toBe(BUSH);
  });
  test("ANOVA, Mauchly, ε, corrected df to 2 decimals, the lead stated", () => {
    expect(out.ok).toBe(true);
    expect(insertable(out.text)).toBe(true);
    expect(out.text).toContain("Conditions: F(3, 21) = 3.794, p = 0.0256 (sphericity assumed); partial η² = 0.3515");
    expect(out.text).toContain("Greenhouse–Geisser: F(1.60, 11.19) = 3.794, p = 0.0626 (ε(GG) = 0.5328)");
    expect(out.text).toContain("Huynh–Feldt: F(2.00, 13.98) = 3.794, p = 0.0483 (ε(HF) = 0.6658)");
    expect(out.text).toContain("Reported p (Greenhouse–Geisser): p = 0.0626");
    expect(out.text).toContain("W = 0.1362, χ²(5) = 11.41, p = 0.0468");
    expect(out.text).toMatch(/Girden 1992/);
    expect(out.text).toMatch(/Huynh–Feldt formula: Huynh–Feldt \(1976\)/);
  });
  test("condition names come from the header line; Holm pairs match pingouin", () => {
    expect(out.text).toContain("Stick insect: mean 8.125, SD 2.232, n = 8");
    expect(out.text).toContain("Stick insect vs Kangaroo testicle: mean difference 3.875, t(7) = 4.775, p = 0.00202, Holm p = 0.0101");
    expect(out.text).toContain("Stick insect vs Fish eye: mean difference 4, t(7) = 5.465, p = 0.000941, Holm p = 0.00564");
  });
  test("the profile plot draws, names its CI method, and labels conditions", () => {
    expect(realSvg(out.svg)).toBe(true);
    expect(out.svg).toContain("Cousineau");
    expect(out.svg).toContain("Stick insect");
    expect(out.svg).toContain("Grey lines: individual subjects.");
  });
});

describe("repeated-measures ANOVA — the other §D3 sets", () => {
  test("well-conditioned: HF raw 1.2978 printed, capped at 1, HF leads", () => {
    const o = rmAnovaCalc("10 12 14\n9 11 15\n12 13 16\n8 10 13\n11 14 15\n10 11 14", "holm");
    expect(o.text).toContain("Huynh–Feldt 1.2978 (raw; capped at 1 for the df)");
    expect(o.text).toContain("Huynh–Feldt: F(2, 10) = 79, p < 0.0001 (ε(HF), capped at 1 = 1.0000)");
    expect(o.text).toContain("Reported p (Huynh–Feldt)");
    expect(o.text).toContain("W = 0.8522, χ²(2) = 0.6395, p = 0.726");
  });
  test("n < k: Mauchly REFUSED by name, the lower bound leads, still insertable", () => {
    const o = rmAnovaCalc("1 2 4 3\n2 3 5 5\n1 4 4 6", "holm");
    expect(o.ok).toBe(true);
    expect(insertable(o.text)).toBe(true);
    expect(o.text).toContain(
      "Mauchly's test needs at least as many subjects as conditions: 3 < 4 - the covariance of the contrasts is singular.",
    );
    expect(o.text).not.toContain("Mauchly's test: Mauchly's test");
    expect(o.text).toContain("Reported p (lower bound): p = 0.0816");
    expect(o.text).toContain("Reported p (lower bound)");
    expect(o.text).not.toMatch(/W = 2\.9e|W = 0\.0000/);
  });
  test("mixed design: between, within, interaction F (pingouin mixed_anova)", () => {
    const o = rmAnovaCalc(MIXED, "holm");
    expect(o.ok).toBe(true);
    expect(o.text).toContain("Between groups: F(1, 6) = 0.8982, p = 0.38");
    expect(o.text).toContain("Conditions: F(2, 12) = 54.41, p < 0.0001 (sphericity assumed); partial η² = 0.9007");
    expect(o.text).toContain("Group × conditions: F(2, 12) = 24.68, p < 0.0001");
    expect(o.text).toContain("Greenhouse–Geisser 0.9081");
    expect(o.text).toContain("original SPSS form 1.4973");
    expect(realSvg(o.svg)).toBe(true);
    expect(o.svg).toContain("Drug (n = 4)");
    expect(o.svg).toContain("Placebo (n = 4)");
  });
  test("a missing cell is refused by subject, never dropped", () => {
    const o = rmAnovaCalc("1 2 3\n4 n/a 6\n7 8 9", "holm");
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/^Subject 2 \("4 n\/a 6"\): "n\/a" is not a number/);
  });
  test("a group label on some subjects but not others is refused", () => {
    expect(readRmField("Drug 1 2 3\n4 5 6")).toEqual({ error: expect.stringMatching(/Subject 2 has no group label/) });
  });
  test("a decimal-comma field reads 1,5 as 1.5 (the product comma rule)", () => {
    const f = readRmField("1,5 2,5 3,5\n2,0 3,5 4,0\n1,0 2,0 3,5");
    if ("error" in f) throw new Error(f.error);
    expect(f.rows[0]).toEqual([1.5, 2.5, 3.5]);
  });
  test("the table feed's text + condition header round-trips, numeric condition names stay names", () => {
    const grid = [["Subject", "Time", "Score"], ["1", "1", "5"], ["1", "2", "7"], ["1", "3", "9"], ["2", "1", "4"], ["2", "2", "6"], ["2", "3", "8"], ["3", "1", "6"], ["3", "2", "9"], ["3", "3", "10"]];
    const r = readSubjectsBetween(grid);
    const fed = feedSubjectsBetween(grid);
    if ("error" in r || "error" in fed) throw new Error("feed");
    const text = rmFieldText(r.conditions, fed.text);
    const f = readRmField(text);
    if ("error" in f) throw new Error(f.error);
    expect(f.rows).toEqual([[5, 7, 9], [4, 6, 8], [6, 9, 10]]);
    expect(f.conditions).toEqual(r.conditions);
    expect(safeName("2")).toBe("C2");
    expect(safeName("Day 7")).toBe("Day_7");
  });
});

describe("Cox regression calculator (§D1)", () => {
  test("the shipped default is Gehan and reproduces β, HR, CI, the three tests", () => {
    expect(paneDefault("cox")).toBe(GEHAN);
    const o = coxCalc(GEHAN, "efron");
    expect(o.ok).toBe(true);
    expect(insertable(o.text)).toBe(true);
    expect(o.text).toContain("Cox regression (Efron ties): n = 42, 30 events, 1 parameter (30 events per parameter)");
    expect(o.text).toContain("placebo: β = 1.5721 (SE 0.4124), HR = 4.817 (95% CI 2.147 to 10.81), z = 3.81, p = 0.00014");
    expect(o.text).toContain("Likelihood-ratio test: χ²(1) = 16.35");
    expect(o.text).toContain("Wald test: χ²(1) = 14.53");
    expect(o.text).toContain("Score (log-rank) test: χ²(1) = 17.25");
    expect(o.text).toMatch(/Peto/);
    // Every string TEST-SCRIPT §0ca quotes for this default is pinned here.
    expect(o.text).toContain("Likelihood-ratio test: χ²(1) = 16.35, p < 0.0001");
    expect(o.text).toContain("Concordance (Harrell's C) = 0.69");
    expect(o.text).toContain("placebo: χ²(1) = 0.004312, p = 0.948");
    expect(o.svg).toContain("Breslow baseline.");
    expect(realSvg(o.svg)).toBe(true);
    expect(o.svg).toContain("Hazard ratio (log scale)");
    expect(o.svg).toContain("placebo = 1");
  });
  test("Breslow is selectable and named", () => {
    const o = coxCalc(GEHAN, "breslow");
    expect(o.text).toContain("Cox regression (Breslow ties)");
    expect(o.text).toContain("β = 1.5092 (SE 0.4096)");
  });
  test("Rossi: PH violations are caveats with the em dash made insertable", () => {
    const R = rossiJson as { columns: string[]; rows: number[][] };
    const o = coxCalc([R.columns.join(" "), ...R.rows.map((r) => r.join(" "))].join("\n"), "efron");
    expect(o.ok).toBe(true);
    expect(o.text).toContain("age: χ²(1) = 11.03, p = 0.0009 - the effect of age changes over time");
    expect(insertable(o.text)).toBe(true);
  });
  test("Larynx through the table feed: factor labels survive via the memo; typed text falls back to indicators", () => {
    const L = larynxJson as { columns: string[]; rows: number[][] };
    const grid = [["Time", "Status", "Age", "Stage"], ...L.rows.map((r) => [String(r[0]), String(r[2]), String(r[1]), r[3] ? "II" : r[4] ? "III" : r[5] ? "IV" : "I"])];
    const fed = feedCox(grid);
    const rc = readCoxTable(grid);
    if ("error" in fed || "error" in rc) throw new Error("feed");
    const memo = coxCalc(fed.text, "efron", { text: fed.text, input: rc.input });
    expect(memo.text).toContain("Stage IV vs I: β = 1.706 (SE 0.4219), HR = 5.507 (95% CI 2.409 to 12.59)");
    expect(memo.svg).toContain("Stage IV");
    const typed = coxCalc(fed.text + " ", "efron", { text: fed.text, input: rc.input });
    expect(typed.text).toContain("Stage_IV: β = 1.706");
  });
  test("refusals are the reason, never a crash", () => {
    const epv = coxCalc("Time Status Age Dose Sex\n5 1 60 10 0\n8 0 55 20 1\n12 1 70 10 1\n3 1 65 30 0\n9 0 50 20 1\n15 0 45 10 0", "efron");
    expect(epv.ok).toBe(false);
    expect(epv.text).toMatch(/^3 events for 3 parameters/);
    expect(coxCalc("6 1 0\n7 1 1", "efron").text).toMatch(/first line names the columns/);
    expect(readCoxField("t e x\n1 1")).toEqual({ error: expect.stringMatching(/Row 1 .* has 2 numbers; the header names 3 columns/) });
    expect(readCoxField("t e x\n1 1 n/a")).toEqual({ error: expect.stringMatching(/"n\/a" is not a number/) });
  });
  test("pText", () => {
    expect(pText(0.0625841)).toBe("p = 0.0626");
    expect(pText(5e-7)).toBe("p < 0.0001");
  });
});

describe("pane wiring (taskpane.ts cannot be imported; its source is pinned)", () => {
  test("both calculators are registered with their table shapes and draw via statsBatchCalcs", () => {
    expect(PANE).toMatch(/id: "rmanova",[\s\S]{0,900}table: "subjects-between"/);
    expect(PANE).toMatch(/id: "cox",[\s\S]{0,1400}table: "cox"/);
    expect(PANE).toContain('compute: (r) => rmAnovaCalc(r("data"), r("posthoc") === "none" ? "none" : "holm"),');
    expect(PANE).toContain('compute: (r) => coxCalc(r("data"), r("ties") === "breslow" ? "breslow" : "efron", coxFeedMemo),');
  });
  test("statDroppedTokens exempts the cox header and the subjects-between labels — narrowly", () => {
    expect(PANE).toMatch(/if \(f\.table === "cox"\) \{\s*text = text\.replace/);
    expect(PANE).toMatch(/f\.table === "subjects-between"/);
    expect(PANE).toContain("const reading = readNumberList(text);");
  });
  test("the typed-comma note is produced on every Stats compute", () => {
    expect(PANE).toContain("statCommaLog.clear();");
    expect(PANE).toContain("const commaNote = statCommaNote();");
  });
  test("survival and log-rank read rows through readSurvivalRows", () => {
    expect((PANE.match(/readSurvivalRows\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
