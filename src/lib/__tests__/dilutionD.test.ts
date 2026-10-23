// Release D, data entry, defect 2: the qPCR dilution-series reader (assayQuant.readDilutionSeries) now reads its
// numbers through dataBlock.readDataBlock (RULE N), so it gets the shared separators (N1), the mixed-decimal-mark
// refusal naming one example of each (N2), the comma rules (N3) and line-numbered refusals (N4).
//
// PINNED FIRST: every row marked SAME is today's (v2.188.0) output, byte-identical, captured before the change.
// Rows marked CHANGED are the defect rows, with the old output in a comment.
import { readDilutionSeries } from "../assayQuant";
import { ASSAY_QUANT_CALCS } from "../assayQuantCalcs";

type Out = { amount: number; cts: (number | null)[] }[] | { ok: false; error: string };
const W = "Target dilution series";
const NBSP = String.fromCharCode(0xa0);
const read = (t: string): { r: Out; notes: string[] } => {
  const notes: string[] = [];
  const r = readDilutionSeries(t, W, notes) as Out;
  return { r, notes };
};
const NOTE_DEC = (ex: string, v: string, why = ""): string =>
  `Commas in the target dilution series were read as decimal points (European notation): “${ex}” is ${v}${why}.`;

// [input, expected output, expected notes]
const SAME: Array<[string, Out, string[]]> = [
  ["1\t20.11\t20.05\t20.17\n0.1\t23.49\t23.55\t23.44\n0.01\t26.90\t26.82\t26.95", [{ amount: 1, cts: [20.11, 20.05, 20.17] }, { amount: 0.1, cts: [23.49, 23.55, 23.44] }, { amount: 0.01, cts: [26.9, 26.82, 26.95] }], []],
  ["1 20.11 20.05\n0.1 23.49 23.55\n0.01 26.90 26.82", [{ amount: 1, cts: [20.11, 20.05] }, { amount: 0.1, cts: [23.49, 23.55] }, { amount: 0.01, cts: [26.9, 26.82] }], []],
  ["1;20.11;20.05\n0.1;23.49;23.55", [{ amount: 1, cts: [20.11, 20.05] }, { amount: 0.1, cts: [23.49, 23.55] }], []],
  ["1; 20.11; 20.05\n0.1; 23.49; 23.55", [{ amount: 1, cts: [20.11, 20.05] }, { amount: 0.1, cts: [23.49, 23.55] }], []],
  ["Input\tCt1\tCt2\n1\t20.11\t20.05\n0.1\t23.49\t23.55", [{ amount: 1, cts: [20.11, 20.05] }, { amount: 0.1, cts: [23.49, 23.55] }], []],
  ["Input Ct Ct\n1 20.11 20.05\n0.1 23.49 23.55", [{ amount: 1, cts: [20.11, 20.05] }, { amount: 0.1, cts: [23.49, 23.55] }], []],
  ["Dilution\t1\t2\t3\n1\t20.11\t20.05\t20.2\n0.1\t23.49\t23.55\t23.5", [{ amount: 1, cts: [20.11, 20.05, 20.2] }, { amount: 0.1, cts: [23.49, 23.55, 23.5] }], []],
  ["1:1\t20.11\n1:10\t23.49\n1:100\t26.90", [{ amount: 1, cts: [20.11] }, { amount: 0.1, cts: [23.49] }, { amount: 0.01, cts: [26.9] }], []],
  ["1/1\t20.11\n1/10\t23.49\n1/100\t26.90", [{ amount: 1, cts: [20.11] }, { amount: 0.1, cts: [23.49] }, { amount: 0.01, cts: [26.9] }], []],
  ["10^0\t20.11\n10^-1\t23.49\n10^-2\t26.90", [{ amount: 1, cts: [20.11] }, { amount: 0.1, cts: [23.49] }, { amount: 0.01, cts: [26.9] }], []],
  ["10^−1\t23.49", [{ amount: 0.1, cts: [23.49] }], []],
  ["1:10 20.11 20.05\n1:100 23.49 23.55", [{ amount: 0.1, cts: [20.11, 20.05] }, { amount: 0.01, cts: [23.49, 23.55] }], []],
  ["1\t20.11\tUndetermined\n0.1\t23.49\t-\n0.01\tNo Ct\t26.9", [{ amount: 1, cts: [20.11, null] }, { amount: 0.1, cts: [23.49] }, { amount: 0.01, cts: [null, 26.9] }], []],
  ["1\t20.11\tnan\n0.1\t23.49\tneg\n0.01\tNA\t26.9", [{ amount: 1, cts: [20.11, null] }, { amount: 0.1, cts: [23.49, null] }, { amount: 0.01, cts: [null, 26.9] }], []],
  ["1\t20.11\t\t20.2\n0.1\t23.49\t\t23.5", [{ amount: 1, cts: [20.11, 20.2] }, { amount: 0.1, cts: [23.49, 23.5] }], []],
  ["1\t20,11\t20,05\n0,1\t23,49\t23,55\n0,01\t26,90\t26,82", [{ amount: 1, cts: [20.11, 20.05] }, { amount: 0.1, cts: [23.49, 23.55] }, { amount: 0.01, cts: [26.9, 26.82] }], [NOTE_DEC("20,11", "20.11")]],
  ["1 20,11 20,05\n0,1 23,49 23,55", [{ amount: 1, cts: [20.11, 20.05] }, { amount: 0.1, cts: [23.49, 23.55] }], [NOTE_DEC("20,11", "20.11")]],
  ["1;20,11;20,05\n0,1;23,49;23,55", [{ amount: 1, cts: [20.11, 20.05] }, { amount: 0.1, cts: [23.49, 23.55] }], [NOTE_DEC("20,11", "20.11")]],
  ["1\t18,123\t18,2\n0,1\t21,5\t21,4", [{ amount: 1, cts: [18.123, 18.2] }, { amount: 0.1, cts: [21.5, 21.4] }], [NOTE_DEC("18,123", "18.123", " (a Ct cannot exceed 60 cycles)")]],
  // The CT_MAX evidence alone decides "18,123" (no other comma evidence in the block).
  ["1\t18,123\n10\t15,456", [{ amount: 1, cts: [18.123] }, { amount: 10, cts: [15.456] }], [NOTE_DEC("18,123", "18.123", " (a Ct cannot exceed 60 cycles)")]],
  ["1\t20.11\r\n\r\n0.1\t23.49\r\n", [{ amount: 1, cts: [20.11] }, { amount: 0.1, cts: [23.49] }], []],
  ["1e-3\t30.3\n1e-2\t26.9", [{ amount: 0.001, cts: [30.3] }, { amount: 0.01, cts: [26.9] }], []],
  ["1\t70", [{ amount: 1, cts: [70] }], []],
  ["1\t20.11\t20.05\n0.1\t23.49\t23.55\n1\t20.2", [{ amount: 1, cts: [20.11, 20.05] }, { amount: 0.1, cts: [23.49, 23.55] }, { amount: 1, cts: [20.2] }], []],
  // A no-break space grouping digits inside a tab field (R3, SI shape) is still read.
  [`1${NBSP}000\t20.1`, [{ amount: 1000, cts: [20.1] }], []],
  ["Input\tCt\n1:10\t20.1\n1:100\t23.4", [{ amount: 0.1, cts: [20.1] }, { amount: 0.01, cts: [23.4] }], []],
  // refusals that keep their exact wording
  ["1\t-20.1", { ok: false, error: "Target dilution series, line 1: “-20.1” is not a Ct." }, []],
  ["0\t20.1", { ok: false, error: "Target dilution series, line 1: an input amount must be positive (its log is taken)." }, []],
  ["1\tabc", { ok: false, error: "Target dilution series, line 1: “abc” is not a Ct." }, []],
  ["1", { ok: false, error: "Target dilution series, line 1: no Ct after the amount." }, []],
  ["", { ok: false, error: "Target dilution series: no dilution points." }, []],
  ["Input\tCt", { ok: false, error: "Target dilution series: no dilution points." }, []],
  ["1\t20.11\t20.05\nfoo\t23.49", { ok: false, error: "Target dilution series, line 2: “foo” is not an input amount (write 1, 0.1, 0.01 or 1:10)." }, []],
];

const MIX = (dot: string, comma: string): string => `${W}: this block mixes ${dot} and ${comma}; use one decimal mark throughout (2.88 or 2,88).`;
const CHANGED: Array<[string, Out, string[]]> = [
  // was ACCEPTED: 20,11 read as 20.11 beside 20.05 (two decimal marks in one block, silently)
  ["1\t20,11\t20.05\n0.1\t23.49\t23.55", { ok: false, error: MIX("20.05", "20,11") }, []],
  ["1\t20,11\n0.1\t23.49", { ok: false, error: MIX("0.1", "20,11") }, []],
  ["0,1\t23.49\n0.01\t26.90", { ok: false, error: MIX("23.49", "0,1") }, []],
  // was: "…mixes decimal commas (“18,123”) and decimal points (“0.1”), so “18,123” cannot be read safely…"
  ["1\t18,123\n0.1\t21.5", { ok: false, error: MIX("0.1", "18,123") }, []],
  // was: "“1,234” cannot be read safely" (same commaReading message)
  ["1\t1,234\n0.1\t23.5", { ok: false, error: MIX("0.1", "1,234") }, []],
  // was REFUSED, misleadingly: "line 2: “0.1,” is not an input amount" (line 1 silently taken as a header)
  ["1, 20.11, 20.05\n0.1, 23.49, 23.55", [{ amount: 1, cts: [20.11, 20.05] }, { amount: 0.1, cts: [23.49, 23.55] }], []],
  // was REFUSED: "line 2: “0.1,23.49,23.55” is not an input amount" (bare commas are N1's last-resort separator)
  ["1,20.11,20.05\n0.1,23.49,23.55", [{ amount: 1, cts: [20.11, 20.05] }, { amount: 0.1, cts: [23.49, 23.55] }], []],
  // was ACCEPTED with the first point SILENTLY DROPPED as a "header": [{0.1, [23.5]}]
  ["1 20.1\n0.1\t23.5", { ok: false, error: `${W}: line 1: "1 20.1" has spaces inside one tab-separated field. Separate the values with tabs, or remove the spaces (digit groups are written without them).` }, []],
  // was: "line 1: “20.11 20.05” is not a Ct." — now the shared R2 wording
  ["1\t20.11 20.05\n0.1\t23.49 23.55", { ok: false, error: `${W}: line 1: "20.11 20.05" has spaces inside one tab-separated field. Separate the values with tabs, or remove the spaces (digit groups are written without them).` }, []],
  // was ACCEPTED as 1000: an ASCII space inside a tab field is not digit grouping (R2: "362 371 380" is 3 numbers or 1)
  ["1 000\t20.1", { ok: false, error: `${W}: line 1: "1 000" has spaces inside one tab-separated field. Separate the values with tabs, or remove the spaces (digit groups are written without them).` }, []],
  // was ACCEPTED (space AND semicolon as separators on one line); R2: a space inside a semicolon field is refused
  ["1 20.11;20.05\n0.1 23.49;23.55", { ok: false, error: `${W}: line 1: "1 20.11" has spaces inside one semicolon-separated field. Separate the values with semicolons, or remove the spaces (digit groups are written without them).` }, []],
];

describe("dilution series: today's inputs are byte-identical", () => {
  test.each(SAME)("%j", (input, out, notes) => {
    const got = read(input);
    expect(got.r).toEqual(out);
    expect(got.notes).toEqual(notes);
  });
});

describe("dilution series: the defect rows (mixed separators / decimal marks)", () => {
  test.each(CHANGED)("%j", (input, out, notes) => {
    const got = read(input);
    expect(got.r).toEqual(out);
    expect(got.notes).toEqual(notes);
  });
});

describe("dilution series: adversarial", () => {
  test.each([
    // was: a first-line "1:0" (= ∞) silently skipped as a header
    ["1:0\t20.1\n0.1\t23.4", `${W}, line 1: “1:0” is not an input amount (write 1, 0.1, 0.01 or 1:10).`],
    ["1\t20.1\n10^999\t23.4", `${W}, line 2: “10^999” is not an input amount (write 1, 0.1, 0.01 or 1:10).`],
    ["1\t20.1\n—\t23.4", `${W}, line 2: “—” is not an input amount (write 1, 0.1, 0.01 or 1:10).`],
    ["1\t20.1\n0.1\t.", `${W}, line 2: “.” is not a Ct.`],
    ["1\t20.1\n0.1\tInfinity", `${W}, line 2: “Infinity” is not a Ct.`],
    ["1\t20.1\n0.1\tNaN₃", `${W}, line 2: “NaN₃” is not a Ct.`],
    ["1\t20.1\n\n\n0.1\tabc", `${W}, line 4: “abc” is not a Ct.`],
    ["1:10\t20,11\t20.05", `${W}: this block mixes 20.05 and 20,11; use one decimal mark throughout (2.88 or 2,88).`],
    // review D1 (p16): a first data row whose amount is a ratio/power form is DATA as written; its bad Ct is named
    ["Input\tCt\n1:10\tn.d.\n1:100\t21.6\n1:1000\t25.0\n1:10000\t28.3", `${W}, line 2: “n.d.” is not a Ct.`],
    ["1:10\tn.d.\n1:100\t21.6\n1:1000\t25.0", `${W}, line 1: “n.d.” is not a Ct.`],
    ["Input\tCt\n10^-1\tfailed\n10^-2\t21.6\n10^-3\t25.0", `${W}, line 2: “failed” is not a Ct.`],
    ["Input\tCt\n0.1\tn.d.\n0.01\t21.6\n0.001\t25.0", `${W}, line 2: “n.d.” is not a Ct.`],
    ["Input\tCt\n1:10\t21.6\n1:100\tn.d.\n1:1000\t25.0", `${W}, line 3: “n.d.” is not a Ct.`],
    ["Dilution Ct\n1:100, \n1:1000, 18,12\n1:10000, 21,5", `${W}, line 2: “1:100,” is not an input amount (write 1, 0.1, 0.01 or 1:10).`],
    ["1:10\n1:100\t21.6", `${W}, line 1: no Ct after the amount.`],
  ])("%j", (input, error) => {
    expect(read(input).r).toEqual({ ok: false, error });
  });
  test("all-Undetermined replicates are kept as non-detects", () => {
    expect(read("1\tUndetermined\tUndetermined\n0.1\t23.4").r).toEqual([{ amount: 1, cts: [null, null] }, { amount: 0.1, cts: [23.4] }]);
  });
});

describe("the Pfaffl tool surfaces the shared refusal", () => {
  const calc = ASSAY_QUANT_CALCS.find((c) => c.fields.some((f) => f.key === "tdil"))!;
  test("mixed decimal marks in the target dilution series are refused by name", () => {
    const vals: Record<string, string> = Object.fromEntries(calc.fields.map((f) => [f.key, f.default]));
    vals.tdil = "1\t20,11\t20.05\t20.17\n0.1\t23.49\t23.55\t23.44\n0.01\t26.90\t26.82\t26.95";
    const out = calc.compute((k) => vals[k] ?? "");
    expect(out.ok).toBe(false);
    expect(out.text).toBe(MIX("20.05", "20,11"));
  });
  test("the shipped defaults still compute", () => {
    const vals: Record<string, string> = Object.fromEntries(calc.fields.map((f) => [f.key, f.default]));
    const out = calc.compute((k) => vals[k] ?? "");
    expect(out.ok).not.toBe(false);
  });
});
