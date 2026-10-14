/**
 * LIVE WRONG ANSWERS in the shipped Stats calculators — docs/SCOPE-STATS-BATCH.md
 * §A WRONG 1–8 and the same defect class found beside them. Each test runs the
 * CHAIN the pane runs (table → feed text → numbers → the real engine) and
 * compares with an independent oracle, so a green feed test cannot hide a
 * wrong χ². Every one of these failed on the code shipped in v2.128.0.
 */
import { feedSubjects, feedSurvival, feedSurvivalGroups, feedGroups, feedRows, type TableFeedResult } from "../tableFeed";
import { readNumberList, decimalCommaNote } from "../numberList";
const parseNumberList = (s: string): number[] => readNumberList(s).values;
import { friedman } from "../nonparametric";
import { kaplanMeier, readSurvivalRows } from "../survival";
import { mannWhitneyU, wilcoxonSignedRank } from "../stats2";

const ok = (r: TableFeedResult): { text: string; note: string } => {
  if ("error" in r) throw new Error("unexpected error: " + r.error);
  return r;
};
const err = (r: TableFeedResult): string => {
  if (!("error" in r)) throw new Error("expected an error, got text: " + r.text + " / " + r.note);
  return r.error;
};
/** The Friedman pane's own reading of the field: one subject per line. */
const friedmanOf = (text: string) =>
  friedman(
    text
      .split(/[\n;]+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map(parseNumberList),
  );

// Truth: 3 subjects, every one rising T1 < T2 < T3 → ranks 1,2,3 in every
// row → χ²(2) = 12/(3·3·4)·(3²+6²+9²) − 3·3·4 = 6 exactly, p = e^(−3).
const WIDE_TRUTH = [
  [5, 7, 9],
  [4, 6, 8],
  [6, 8, 10],
];
const P6 = Math.exp(-3);

describe("§A1 — long repeated measures (Subject | Time | Score) is pivoted, not read as 9 subjects", () => {
  const LONG = [
    ["Subject", "Time", "Score"],
    ["1", "1", "5"],
    ["1", "2", "7"],
    ["1", "3", "9"],
    ["2", "1", "4"],
    ["2", "2", "6"],
    ["2", "3", "8"],
    ["3", "1", "6"],
    ["3", "2", "8"],
    ["3", "3", "10"],
  ];
  it("pivots to 3 × 3 and Friedman gives χ²(2) = 6, p = 0.0498 (was χ² 14.73 on '9 subject rows × 3 conditions')", () => {
    const r = ok(feedSubjects(LONG));
    expect(r.text).toBe(WIDE_TRUTH.map((x) => x.join(" ")).join("\n"));
    expect(r.note).toMatch(/long format/i);
    expect(r.note).toContain("3 subjects × 3");
    const f = friedmanOf(r.text);
    expect(f.ok).toBe(true);
    expect(f.chi2).toBeCloseTo(6, 10);
    expect(f.df).toBe(2);
    expect(f.p).toBeCloseTo(P6, 10);
  });
  it("column order and row order do not matter (Time | Subject | Score, sorted by time)", () => {
    const byTime = [["Time", "Subject", "Score"]];
    for (const t of [1, 2, 3]) for (const s of [0, 1, 2]) byTime.push([String(t), String(s + 1), String(WIDE_TRUTH[s][t - 1])]);
    const r = ok(feedSubjects(byTime));
    expect(r.text).toBe(WIDE_TRUTH.map((x) => x.join(" ")).join("\n"));
    expect(friedmanOf(r.text).chi2).toBeCloseTo(6, 10);
  });
  it("text condition levels (Pre / Mid / Post) and text subject ids", () => {
    const rows = [["Patient", "Visit", "Score"]];
    const lv = ["Pre", "Mid", "Post"];
    WIDE_TRUTH.forEach((w, s) => lv.forEach((v, k) => rows.push([`P0${s + 1}`, v, String(w[k])])));
    const r = ok(feedSubjects(rows));
    expect(r.text).toBe(WIDE_TRUTH.map((x) => x.join(" ")).join("\n"));
    expect(r.note).toContain("Pre, Mid, Post");
  });
  it("§A2 — a subject label MERGED across its rows is forward-filled and said (was '6 subject rows × 2 conditions')", () => {
    const rows = [["Subject", "Time", "Score"]];
    WIDE_TRUTH.forEach((w, s) => w.forEach((v, k) => rows.push([k === 0 ? String(s + 1) : "", String(k + 1), String(v)])));
    const r = ok(feedSubjects(rows));
    expect(r.text).toBe(WIDE_TRUTH.map((x) => x.join(" ")).join("\n"));
    expect(r.note).toMatch(/6 merged subject cells filled from the row above/);
    expect(friedmanOf(r.text).chi2).toBeCloseTo(6, 10);
  });
  it("UNHEADED long (subject, time, score) is refused with a request for a header, not read as 3 conditions", () => {
    expect(err(feedSubjects(LONG.slice(1)))).toMatch(/long format.*Add a header row/);
  });
  it("a subject missing a condition is refused BY SUBJECT ID", () => {
    expect(err(feedSubjects(LONG.slice(0, 9)))).toMatch(/Subject 3.*no value for Time 3/);
  });
  it("a duplicated subject × condition cell is refused by name", () => {
    const dup = [...LONG, ["2", "2", "6.5"]];
    expect(err(feedSubjects(dup))).toMatch(/Subject 2.*Time 2.*more than once/);
  });
  it("a group column in a long table is a between factor: Friedman refuses it by name", () => {
    const rows = [["Subject", "Group", "Time", "Score"]];
    WIDE_TRUTH.forEach((w, s) => w.forEach((v, k) => rows.push([String(s + 1), s < 2 ? "A" : "B", String(k + 1), String(v)])));
    expect(err(feedSubjects(rows))).toMatch(/Friedman is within-subjects only; a group column \(Group\) was found/);
  });
});

describe("§A3–6 — group, covariate, unheaded id and transposed tables are never conditions", () => {
  it("§A3 Subject | Group | T1 | T2 | T3 (arms 1/2): Friedman refuses by name (was χ²(3) = 12 on 4 'conditions')", () => {
    const rows = [
      ["Subject", "Group", "T1", "T2", "T3"],
      ["1", "1", "5", "7", "9"],
      ["2", "1", "4", "6", "8"],
      ["3", "2", "6", "8", "10"],
      ["4", "2", "3", "5", "7"],
    ];
    expect(err(feedSubjects(rows))).toMatch(
      /Friedman is within-subjects only; a group column \(Group\) was found — use repeated-measures ANOVA \(mixed design\)/,
    );
  });
  it("§A4 Patient | Age | Day 1 | Day 7 | Day 14: Age is excluded and SAID (was a 4th condition)", () => {
    const rows = [["Patient", "Age", "Day 1", "Day 7", "Day 14"]];
    WIDE_TRUTH.forEach((w, s) => rows.push([`P${s + 1}`, String(50 + 7 * s), ...w.map(String)]));
    const r = ok(feedSubjects(rows));
    expect(r.text).toBe(WIDE_TRUTH.map((x) => x.join(" ")).join("\n"));
    expect(r.note).toContain("3 conditions: Day 1, Day 7, Day 14");
    expect(r.note).toMatch(/Age.*excluded/);
    const f = friedmanOf(r.text);
    expect(f.df).toBe(2);
    expect(f.chi2).toBeCloseTo(6, 10);
  });
  it("the randomised-block layout Block | A | B | C (B1–B4, distinct) still reads: the block label is the subject, not a group", () => {
    const r = ok(feedSubjects([["Block", "A", "B", "C"], ["B1", "5", "7", "9"], ["B2", "4", "6", "8"], ["B3", "6", "8", "10"], ["B4", "3", "5", "7"]]));
    expect(r.text).toBe("5 7 9\n4 6 8\n6 8 10\n3 5 7");
    expect(r.note).toContain("4 subject rows × 3 conditions: A, B, C");
    expect(r.note).toMatch(/Block.*dropped/);
  });
  it("§A5 unheaded ids 101 / 205 / 309 are refused with a request for a header (was 'condition 1')", () => {
    expect(err(feedSubjects([["101", "5", "7", "9"], ["205", "4", "6", "8"], ["309", "6", "8", "10"]]))).toMatch(
      /id or a measurement.*header row/,
    );
  });
  it("…but the Friedman default typed unheaded into a table still reads as 4 subjects × 3 conditions", () => {
    const r = ok(feedSubjects([["10", "12", "14"], ["9", "11", "15"], ["12", "13", "16"], ["8", "10", "13"]]));
    expect(r.text).toBe("10 12 14\n9 11 15\n12 13 16\n8 10 13");
    expect(r.note).toContain("4 subject rows × 3 conditions");
  });
  it("§A6 a TRANSPOSED table (Condition | S1 | S2 | S3 | S4) is refused (was χ²(3) testing SUBJECTS)", () => {
    const rows = [
      ["Condition", "S1", "S2", "S3", "S4"],
      ["T1", "5", "4", "6", "3"],
      ["T2", "7", "6", "8", "5"],
      ["T3", "9", "8", "10", "7"],
    ];
    expect(err(feedSubjects(rows))).toMatch(/subjects are in COLUMNS — transpose the table \(one row per subject\)/);
    const bySubjectHeaders = [["", "Subject 1", "Subject 2", "Subject 3"], ["Pre", "5", "4", "6"], ["Post", "7", "6", "8"]];
    expect(err(feedSubjects(bySubjectHeaders))).toMatch(/subjects are in COLUMNS/);
  });
});

describe("§A7 — start/stop (counting-process) survival tables: the ID is never the time", () => {
  const START_STOP = [
    ["ID", "Start", "Stop", "Event", "Age"],
    ["1", "0", "5", "1", "60"],
    ["2", "0", "8", "0", "55"],
    ["3", "0", "12", "1", "70"],
    ["4", "0", "15", "0", "65"],
  ];
  it("one interval per subject, all starting at 0: time = Stop, said; never 'time = ID'", () => {
    const r = ok(feedSurvival(START_STOP));
    expect(r.text).toBe("5 1\n8 0\n12 1\n15 0");
    expect(r.note).not.toMatch(/time = ID/);
    expect(r.note).toMatch(/Start\/Stop/);
    expect(r.note).toMatch(/Age/);
    const km = kaplanMeier([5, 8, 12, 15], [1, 0, 1, 0]);
    expect(km.ok).toBe(true);
  });
  it("one interval per subject with a later entry: time = Stop − Start, said", () => {
    const rows = START_STOP.map((r) => [...r]);
    rows[3][1] = "2"; // subject 3 entered at 2, left at 12
    const r = ok(feedSurvival(rows));
    expect(r.text).toBe("5 1\n8 0\n10 1\n15 0");
    expect(r.note).toMatch(/time = Stop − Start/);
  });
  it("several intervals per subject (time-varying data) are refused by name, in Survival AND Log-rank", () => {
    const rows = [
      ["ID", "Start", "Stop", "Event", "Treatment"],
      ["1", "0", "3", "0", "A"],
      ["1", "3", "9", "1", "A"],
      ["2", "0", "4", "0", "B"],
      ["2", "4", "11", "0", "B"],
      ["3", "0", "7", "1", "A"],
    ];
    const msg = /counting-process data with several intervals per subject is not supported by Kaplan–Meier here/;
    expect(err(feedSurvival(rows))).toMatch(msg);
    expect(err(feedSurvivalGroups(rows))).toMatch(msg);
  });
  it("Stop ≤ Start is refused by row", () => {
    const rows = START_STOP.map((r) => [...r]);
    rows[2][2] = "0";
    expect(err(feedSurvival(rows))).toMatch(/Row 2.*Stop/);
  });
  it("an ID / Subject / Patient column, or a strictly increasing integer key, is never chosen as time", () => {
    for (const idName of ["ID", "Id", "Subject", "Patient", "Patient ID"]) {
      // "Dur" names no role, so time comes from the content fallback — which
      // took the first numeric column, the ID, before.
      const r = ok(feedSurvival([[idName, "Dur", "Event"], ["101", "5", "1"], ["102", "8", "0"], ["103", "3", "1"]]));
      expect(r.text).toBe("5 1\n8 0\n3 1");
      expect(r.note).toContain(`${idName} (id)`);
    }
    const key = ok(feedSurvival([["Key", "Event", "Dur"], ["11", "1", "5"], ["12", "0", "8"], ["13", "1", "3"]]));
    expect(key.text).toBe("5 1\n8 0\n3 1");
  });
  it("TYPED rows: exactly two numbers per row ('1 0 5 1' was time = 1, event = 0)", () => {
    expect(readSurvivalRows("5 1\n8 0\n12,5 1")).toEqual({ times: [5, 8, 12.5], events: [1, 0, 1] });
    const e = readSurvivalRows("1 0 5 1\n2 0 8 0");
    expect("error" in e && e.error).toMatch(/Row 1 \("1 0 5 1"\) has 4 numbers.*start\/stop/);
  });
  it("…while unheaded SORTED survival times (5, 8, 12, 15) are still the time", () => {
    expect(ok(feedSurvival([["5", "1"], ["8", "1"], ["12", "1"], ["15", "0"]])).text).toBe("5 1\n8 1\n12 1\n15 0");
  });
});

describe("survival — the same class beside it", () => {
  it("log-rank: a text ID column (P01, P02…) is never the GROUP — Treatment is (was one patient per group)", () => {
    const r = ok(
      feedSurvivalGroups([
        ["ID", "Time", "Event", "Treatment"],
        ["P01", "5", "1", "Drug"],
        ["P02", "8", "0", "Drug"],
        ["P03", "6", "1", "Placebo"],
        ["P04", "3", "1", "Placebo"],
      ]),
    );
    expect(r.text).toBe("5 1\n8 0\n\n6 1\n3 1");
    expect(r.note).toContain("1 = Drug (n 2), 2 = Placebo (n 2)");
  });
  it("a repeating 'Site' (A/A/B/B) is a GROUP, not an id: log-rank still reads it", () => {
    const r = ok(feedSurvivalGroups([["Time", "Event", "Site"], ["5", "1", "A"], ["8", "0", "A"], ["6", "1", "B"], ["3", "1", "B"]]));
    expect(r.note).toContain("1 = A (n 2), 2 = B (n 2)");
  });
  it("Log-rank on ID | Start | Stop | Event | Age with repeated ids names the counting-process problem, not 'need a group'", () => {
    const rows = [["ID", "Start", "Stop", "Event", "Age"], ["1", "0", "3", "0", "60"], ["1", "3", "9", "1", "60"], ["2", "0", "4", "0", "50"]];
    expect(err(feedSurvivalGroups(rows))).toMatch(/several intervals per subject/);
  });
  it("the Cox-shaped table in Survival names EVERY ignored column (Age and Sex vanished before)", () => {
    const r = ok(
      feedSurvival([
        ["Patient", "Time (months)", "Status", "Age", "Treatment", "Sex"],
        ["1", "5", "1", "60", "A", "M"],
        ["2", "8", "0", "55", "B", "F"],
        ["3", "12", "1", "70", "A", "F"],
      ]),
    );
    expect(r.note).toMatch(/Age/);
    expect(r.note).toMatch(/Sex/);
    expect(r.note).toMatch(/Treatment/);
  });
});

describe("§A8 — typed decimal commas follow the table's comma rule (one shared function)", () => {
  it("'1,5 2,3 3,1' is three decimals, not six numbers; Mann–Whitney U = 0 (was n = 6 + 6, U = 11)", () => {
    expect(parseNumberList("1,5 2,3 3,1")).toEqual([1.5, 2.3, 3.1]);
    const a = parseNumberList("1,5 2,3 3,1");
    const b = parseNumberList("4,2 5,0 6,6");
    expect(a.length).toBe(3);
    expect(mannWhitneyU(a, b).statistic).toBe(0);
  });
  it("Wilcoxon '1,5 2,5 3,5' vs '1,0 2,0 3,0' is 3 pairs, no zero differences", () => {
    const a = parseNumberList("1,5 2,5 3,5");
    const b = parseNumberList("1,0 2,0 3,0");
    expect(a).toEqual([1.5, 2.5, 3.5]);
    expect(b).toEqual([1, 2, 3]);
    expect(wilcoxonSignedRank(a, b).n1).toBe(3);
  });
  it("the disambiguation: '1, 5' and '1,2,3' are lists; '1,200' is twelve hundred; ';' separates", () => {
    expect(parseNumberList("1, 5")).toEqual([1, 5]);
    expect(parseNumberList("1, 2, 3, 4, 5")).toEqual([1, 2, 3, 4, 5]);
    expect(parseNumberList("1,2,3")).toEqual([1, 2, 3]);
    expect(parseNumberList("1,2,3 4,5,6")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parseNumberList("1,200 1,500")).toEqual([1200, 1500]);
    expect(parseNumberList("1,5; 2,3")).toEqual([1.5, 2.3]);
    expect(parseNumberList("1,5\n2,3")).toEqual([1.5, 2.3]);
    expect(parseNumberList("125, 115, 130")).toEqual([125, 115, 130]);
    expect(parseNumberList("10 12 14")).toEqual([10, 12, 14]);
  });
  it("matches the table feed cell for cell", () => {
    const g = ok(feedGroups([["A", "B"], ["1,5", "4,2"], ["2,3", "5,0"], ["3,1", "6,6"]]));
    const [ga, gb] = g.text.split("\n\n").map(parseNumberList);
    expect(ga).toEqual(parseNumberList("1,5 2,3 3,1"));
    expect(gb).toEqual(parseNumberList("4,2 5,0 6,6"));
  });
  it("says how it read a typed comma, and reports the non-numbers it dropped", () => {
    const r = readNumberList("1,5 2,3 n/a 3,1");
    expect(r.dropped).toEqual(["n/a"]);
    expect(decimalCommaNote(r)).toBe("3 decimal commas read as decimals (1,5 → 1.5).");
    expect(decimalCommaNote(readNumberList("1, 2, 3"))).toBe("");
  });
});

describe("independent review round (stats.review.test.ts) — the RIGHT reading, not only the absent wrong one", () => {
  it("underscored headers: cBioPortal PATIENT_ID | AGE | OS_MONTHS | OS_STATUS reads time = OS_MONTHS, the id named", () => {
    const r = ok(feedSurvival([["PATIENT_ID", "AGE", "OS_MONTHS", "OS_STATUS"], ["1", "61", "5.2", "1"], ["2", "45", "8.1", "0"], ["3", "70", "12.5", "1"]]));
    expect(r.text).toBe("5.2 1\n8.1 0\n12.5 1");
    expect(r.note).toMatch(/time = OS_MONTHS, event = OS_STATUS/);
    expect(r.note).toMatch(/PATIENT_ID \(id\), AGE/);
    expect(ok(feedSurvival([["age", "time_months", "status"], ["61", "5", "1"], ["45", "8", "0"]])).text).toBe("5 1\n8 0");
  });
  it("'Survival time (months)' beats 'Time since diagnosis (years)'; two endpoints (OS, PFS) are refused by name", () => {
    const r = ok(feedSurvival([["Patient", "Time since diagnosis (years)", "Survival time (months)", "Status"], ["P1", "2", "5", "1"], ["P2", "1", "8", "0"]]));
    expect(r.note).toMatch(/time = Survival time \(months\)/);
    const two = [["OS (months)", "OS status", "PFS (months)", "PFS status", "Age"], ["5", "1", "3", "1", "60"], ["9", "0", "4", "1", "50"]];
    expect(err(feedSurvival(two))).toMatch(/Two time columns found \(OS \(months\), PFS \(months\)\)/);
  });
  it("Mouse 101–104 / Rat 2,4,1,3 / subject_id are ids, dropped and said — never a condition", () => {
    const r = ok(feedSubjects([["Mouse", "Pre", "Post"], ["101", "5", "7"], ["102", "6", "9"], ["103", "4", "6"]]));
    expect(r.text).toBe("5 7\n6 9\n4 6");
    expect(r.note).toMatch(/Mouse\) was dropped/);
    expect(ok(feedSubjects([["subject_id", "pre", "post"], ["101", "5", "7"], ["102", "6", "9"]])).text).toBe("5 7\n6 9");
  });
  it("a Total / Mean row under subject labels is dropped and SAID", () => {
    const r = ok(feedSubjects([["Subject", "A", "B"], ["S1", "5", "7"], ["S2", "6", "9"], ["S3", "4", "6"], ["Mean", "5", "7.3"]]));
    expect(r.text).toBe("5 7\n6 9\n4 6");
    expect(r.note).toMatch(/Summary row \(Mean\) dropped/);
  });
  it("typed: '1,250 2,5 3,75' → 1.25, said; '0,5 1,000 1,5' → 1; '1,200 1,500' (no decimal proof) stays thousands", () => {
    const r = readNumberList("1,250 2,5 3,75");
    expect(r.values).toEqual([1.25, 2.5, 3.75]);
    expect(decimalCommaNote(r)).toMatch(/1,250 read as 1\.25, not thousands, because this field writes decimal commas/);
    expect(readNumberList("0,5 1,000 1,5").values).toEqual([0.5, 1, 1.5]);
    expect(readNumberList("1,200 1,500").values).toEqual([1200, 1500]);
  });
});

describe("independent groups and regression — the id / group / status steal", () => {
  it("Patient | Arm | Score is long (id dropped), not two groups 'Arm' and 'Score'", () => {
    const r = ok(
      feedGroups([
        ["Patient", "Arm", "Score"],
        ["P1", "1", "5"],
        ["P2", "1", "6"],
        ["P3", "2", "9"],
        ["P4", "2", "8"],
      ]),
    );
    expect(r.text).toBe("5, 6\n\n9, 8");
    expect(r.note).toMatch(/Patient.*dropped/);
  });
  it("Arm | Patient | Score (numeric ids in the middle) is long too", () => {
    const r = ok(feedGroups([["Arm", "Patient", "Score"], ["A", "101", "5"], ["A", "102", "6"], ["B", "103", "9"], ["B", "104", "8"]]));
    expect(r.text).toBe("5, 6\n\n9, 8");
    expect(r.note).toMatch(/Patient column was dropped as an id/);
  });
  it("…but 'Smoking status' 0/1 in a regression WITHOUT a time column still reads", () => {
    const r = ok(feedRows([["BP", "Age", "Smoking status"], ["120", "50", "1"], ["130", "61", "0"], ["118", "45", "0"], ["140", "70", "1"]], "regression"));
    expect(r.note).toContain("response = BP");
  });
  it("multiple regression refuses a Status/Event column (OLS on censored times answers nothing)", () => {
    const rows = [["Time", "Status", "Age", "Dose"], ["5", "1", "60", "10"], ["8", "0", "55", "20"], ["12", "1", "70", "10"], ["15", "0", "65", "20"]];
    expect(err(feedRows(rows, "regression"))).toMatch(/Status.*survival/i);
  });
});
