/**
 * The two table shapes added for the Stats batch (docs/SCOPE-STATS-BATCH.md
 * §B1, §B3): `subjects-between` (repeated-measures ANOVA, optional between
 * factor) and `cox` (Cox regression). Layouts humans type: wide, long, with
 * and without ids, group as text and as codes, Censored instead of Event, an
 * Age covariate that must stay a covariate.
 */
import {
  readSubjectsBetween,
  feedSubjectsBetween,
  feedSubjects,
  readCoxTable,
  feedCox,
  feedTable,
  betweenLabel,
  type TableFeedResult,
} from "../tableFeed";
import { rmAnova } from "../rmAnova";
import { parseNumberList } from "../numberList";

const ok = <T,>(r: T | { error: string }): T => {
  if (typeof r === "object" && r !== null && "error" in r) throw new Error("unexpected error: " + (r as { error: string }).error);
  return r as T;
};
const err = (r: object): string => {
  if (!("error" in r)) throw new Error("expected an error, got " + JSON.stringify(r));
  return (r as { error: string }).error;
};

const DATA = [
  [5, 7, 9],
  [4, 6, 9],
  [6, 8, 11],
  [3, 7, 8],
];
const ARMS = ["Drug", "Drug", "Placebo", "Placebo"];

describe("subjects-between — wide", () => {
  it("Subject | Group | T1 | T2 | T3 with text arms: rows, per-subject groups, condition labels in order", () => {
    const rows = [["Subject", "Group", "T1", "T2", "T3"], ...DATA.map((d, i) => [`S${i + 1}`, ARMS[i], ...d.map(String)])];
    const r = ok(readSubjectsBetween(rows));
    expect(r.rows).toEqual(DATA);
    expect(r.groups).toEqual(ARMS);
    expect(r.conditions).toEqual(["T1", "T2", "T3"]);
    expect(r.subjects).toEqual(["S1", "S2", "S3", "S4"]);
    expect(r.note).toContain("Between-subject factor: Group (Drug, n 2; Placebo, n 2)");
    // …and Friedman, within-only, still refuses the same table by name.
    expect(err(feedSubjects(rows))).toMatch(/Friedman is within-subjects only; a group column \(Group\)/);
  });
  it("numeric arm codes become tokens no number parser can read as a value", () => {
    const rows = [["Subject", "Arm", "Pre", "Post"], ["1", "1", "5", "7"], ["2", "1", "4", "6"], ["3", "2", "6", "8"], ["4", "2", "3", "7"]];
    const t = ok(feedSubjectsBetween(rows) as { text: string; note: string });
    expect(t.text).toBe("Arm_1 5 7\nArm_1 4 6\nArm_2 6 8\nArm_2 3 7");
    // The label token survives a numbers-only parse as NOT a number.
    expect(parseNumberList(t.text.split("\n")[0])).toEqual([5, 7]);
    expect(betweenLabel("Dose", "Dose 10")).toBe("Dose_10");
  });
  it("no group column: a one-way design (groups undefined), plain lines", () => {
    const rows = [["Patient", "Day 1", "Day 7", "Day 14"], ...DATA.map((d, i) => [`P${i + 1}`, ...d.map(String)])];
    const r = ok(readSubjectsBetween(rows));
    expect(r.groups).toBeUndefined();
    expect(ok(feedSubjectsBetween(rows) as { text: string }).text).toBe("5 7 9\n4 6 9\n6 8 11\n3 7 8");
  });
  it("Age is a covariate (excluded, said) — never a condition, never the group", () => {
    const rows = [["Patient", "Age", "Arm", "Pre", "Post"], ["P1", "61", "A", "5", "7"], ["P2", "55", "A", "4", "6"], ["P3", "70", "B", "6", "8"], ["P4", "48", "B", "3", "7"]];
    const r = ok(readSubjectsBetween(rows));
    expect(r.rows).toEqual([[5, 7], [4, 6], [6, 8], [3, 7]]);
    expect(r.groups).toEqual(["A", "A", "B", "B"]);
    expect(r.note).toMatch(/Age excluded/);
  });
  it("a missing cell is reported by subject and condition — not imputed", () => {
    const rows = [["Subject", "Group", "T1", "T2"], ["S1", "A", "5", "7"], ["S2", "A", "4", ""], ["S3", "B", "6", "8"]];
    expect(err(readSubjectsBetween(rows))).toMatch(/Subject S2 has no value for T2/);
  });
});

describe("subjects-between — long", () => {
  const long = (withGroup: boolean): string[][] => {
    const out = [withGroup ? ["Subject", "Group", "Time", "Score"] : ["Subject", "Time", "Score"]];
    DATA.forEach((d, i) => d.forEach((v, k) => out.push([String(101 + i), ...(withGroup ? [ARMS[i]] : []), String(k + 1), String(v)])));
    return out;
  };
  it("Subject | Group | Time | Score pivots to the same rows/groups as the wide table — and the same rmAnova", () => {
    const r = ok(readSubjectsBetween(long(true)));
    expect(r.rows).toEqual(DATA);
    expect(r.groups).toEqual(ARMS);
    expect(r.subjects).toEqual(["101", "102", "103", "104"]);
    expect(r.conditions).toEqual(["Time 1", "Time 2", "Time 3"]);
    const a = rmAnova(r.rows, r.groups);
    const b = rmAnova(DATA, ARMS);
    expect(a).toEqual(b);
  });
  it("without a group column, a one-way design", () => {
    const r = ok(readSubjectsBetween(long(false)));
    expect(r.rows).toEqual(DATA);
    expect(r.groups).toBeUndefined();
  });
  it("a subject missing a time point is refused by subject and condition", () => {
    const rows = long(true).filter((r) => !(r[0] === "103" && r[2] === "2"));
    expect(err(readSubjectsBetween(rows))).toMatch(/Subject 103 has no value for Time 2/);
  });
  it("a subject in two groups is refused by name", () => {
    const rows = long(true).map((r) => [...r]);
    rows[2][1] = "Placebo"; // subject 101, time 2
    expect(err(readSubjectsBetween(rows))).toMatch(/Subject 101 is in two Group levels/);
  });
  it("dispatch", () => {
    const r: TableFeedResult = feedTable("subjects-between", long(true));
    expect("text" in r && r.text.split("\n")[0]).toBe("Drug 5 7 9");
  });
});

describe("cox", () => {
  const TABLE = [
    ["Patient", "Age", "Time (months)", "Censored", "Treatment", "Sex"],
    ["P01", "61", "5", "0", "Drug", "M"],
    ["P02", "55", "8", "1", "Placebo", "F"],
    ["P03", "70", "12", "0", "Drug", "F"],
    ["P04", "48", "3", "0", "Placebo", "M"],
    ["P05", "66", "20", "1", "Drug", "M"],
  ];
  it("time, inverted Censored (said), id excluded, Age a NUMERIC covariate (never time), text covariates dummy-coded with the reference said", () => {
    const r = ok(readCoxTable(TABLE));
    expect(r.input.times).toEqual([5, 8, 12, 3, 20]);
    expect(r.input.events).toEqual([1, 0, 1, 1, 0]);
    expect(r.input.covariates.map((c) => c.name)).toEqual(["Age", "Treatment_Placebo", "Sex_M"]);
    expect(r.input.covariates[0].values).toEqual([61, 55, 70, 48, 66]);
    expect(r.input.covariates[1].values).toEqual([0, 1, 0, 1, 0]);
    expect(r.input.factors?.map((f) => f.reference)).toEqual(["Drug", "F"]);
    expect(r.note).toContain("Patient = id (not used)");
    expect(r.note).toContain("Time (months) = time");
    expect(r.note).toMatch(/Censored = event \(a censored flag: its 1 was read as censored/);
    expect(r.note).toContain("Treatment: reference Drug");
    expect(r.names).toEqual(["Time_(months)", "event", "Age", "Treatment_Placebo", "Sex_M"]);
  });
  it("field text: a header line of names, then numbers only", () => {
    const t = ok(feedCox(TABLE) as { text: string });
    expect(t.text.split("\n")[0]).toBe("Time_(months) event Age Treatment_Placebo Sex_M");
    expect(t.text.split("\n")[1]).toBe("5 1 61 0 1");
  });
  it("Status 1/2 coding is refused by row (the survival rule, reused)", () => {
    const rows = [["Time", "Status", "Age"], ["5", "1", "60"], ["8", "2", "55"], ["12", "1", "70"]];
    expect(err(readCoxTable(rows))).toMatch(/Row 2.*"2" is not recognised/);
  });
  it("start/stop data is refused by name", () => {
    const rows = [["ID", "Start", "Stop", "Event", "Age"], ["1", "0", "5", "1", "60"], ["2", "0", "8", "0", "55"]];
    expect(err(readCoxTable(rows))).toMatch(/time-varying covariates are not supported; give one row per subject/);
  });
  it("a blank covariate cell refuses its row; a name column with > 10 levels is refused as an id", () => {
    const blank = TABLE.map((r) => [...r]);
    blank[3][1] = "";
    expect(err(readCoxTable(blank))).toMatch(/Age is blank in row 3/);
    const names = [["Name", "Time", "Event", "Age"]];
    for (let i = 0; i < 12; i++) names.push([`Person ${String.fromCharCode(65 + i)}`, String(i + 1), String(i % 2), String(40 + i)]);
    expect(err(readCoxTable(names))).toMatch(/Name has 12 levels — an id, not a covariate/);
  });
  it("a numeric Stage code is kept numeric and the note says how to get indicators", () => {
    const rows = [["Time", "Event", "Stage"], ["5", "1", "1"], ["8", "0", "2"], ["12", "1", "3"], ["4", "1", "2"]];
    expect(ok(readCoxTable(rows)).note).toMatch(/Stage = numeric covariate \(read as a NUMBER/);
  });
  it("a repeating Site column is a dummy-coded covariate, not an id", () => {
    const rows = [["Time", "Event", "Site"], ["5", "1", "A"], ["8", "0", "A"], ["12", "1", "B"], ["4", "1", "B"]];
    const r = ok(readCoxTable(rows));
    expect(r.input.covariates.map((c) => c.name)).toEqual(["Site_B"]);
    expect(r.note).toContain("Site: reference A");
  });
  it("Sex typed M, m, F, f is ONE indicator, and the merge is said", () => {
    const r = ok(readCoxTable([["Time", "Status", "Sex"], ["5", "1", "M"], ["9", "0", "m"], ["12", "1", "F"], ["14", "0", "f"]]));
    expect(r.input.covariates.map((c) => c.name)).toEqual(["Sex_M"]);
    expect(r.input.covariates[0].values).toEqual([1, 1, 0, 0]);
    expect(r.note).toMatch(/levels differing only in case merged: m → M, f → F/);
  });
  it("cBioPortal layout: time = OS_MONTHS, AGE a covariate, PATIENT_ID an id", () => {
    const r = ok(readCoxTable([["PATIENT_ID", "AGE", "OS_MONTHS", "OS_STATUS"], ["1", "61", "5.2", "1"], ["2", "45", "8.1", "0"], ["3", "70", "12.5", "1"]]));
    expect(r.input.times).toEqual([5.2, 8.1, 12.5]);
    expect(r.input.covariates.map((c) => c.name)).toEqual(["AGE"]);
  });
  it("Subject | Treatment | Time | Score: Time within, Treatment between", () => {
    const r = ok(readSubjectsBetween([["Subject", "Treatment", "Time", "Score"], ["1", "Drug", "Pre", "5"], ["1", "Drug", "Post", "8"], ["2", "Placebo", "Pre", "6"], ["2", "Placebo", "Post", "6"]]));
    expect(r.conditions).toEqual(["Time Pre", "Time Post"]);
    expect(r.groups).toEqual(["Drug", "Placebo"]);
  });
  it("needs a header row", () => {
    expect(err(readCoxTable([["5", "1", "60"], ["8", "0", "55"]]))).toMatch(/header row/);
  });
});
