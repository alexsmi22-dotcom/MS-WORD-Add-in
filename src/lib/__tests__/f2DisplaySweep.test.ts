/**
 * F2 review round 1: the display contract and US spelling across every F2 calculator (litigation, forensic, CBA/FX,
 * micro/macro II, time series II, limited dependent, causal II), at the defaults and at every select option, through
 * the pane's read paths (Finance: number fields through readFinanceField first; Stats: every field as typed).
 *  - No "_" or "^" in any text line or table cell (subscripts, superscripts or words instead: i and i* for the domestic
 *    and foreign rates, S(T), gK, Cₖ, "to the power").
 *  - No British -ise/-our forms in output (the house keeps "modelled").
 * Plus the round-1 wording fixes, each pinned on the case that showed it.
 */
import { readFinanceField } from "../finance";
import type { FinCalcDef, FinResult } from "../finCalc";
import type { StatCalcDef } from "../statCalc";
import type { StatOutput } from "../analyzeBlocks";
import { LITIG_CALCS } from "../litigCalcs";
import { FORENSIC_CALCS } from "../forensicCalcs";
import { CBA_CALCS } from "../cbaCalcs";
import { MICROMACRO_STAT_CALCS } from "../micromacroStatCalcs";
import { TS2_STAT_CALCS } from "../ts2StatCalcs";
import { LIMDEP_STAT_CALCS } from "../limdepStatCalcs";
import { CAUSAL_STAT_CALCS } from "../causalStatCalcs";

type Tab = { label?: string; note?: string; rows: string[][] };
type Out = { text: string; tables?: Tab[]; table?: Tab; ok?: boolean };

function runFin(c: FinCalcDef, over: Record<string, string> = {}): Out {
  const raw = (k: string): string => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "";
  const numeric = new Map<string, string>();
  for (const f of c.fields) {
    if (f.kind === "select" || f.kind === "list" || f.kind === "text" || f.kind === "block") continue;
    const v = readFinanceField(raw(f.key));
    if (Number.isFinite(v)) numeric.set(f.key, String(v));
  }
  const r: FinResult = c.compute((k) => numeric.get(k) ?? raw(k));
  return typeof r === "string" ? { text: r } : r;
}
function runStat(c: StatCalcDef, over: Record<string, string> = {}): Out {
  const r: StatOutput = c.compute((k) => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "");
  return r;
}

const FIN = [...LITIG_CALCS, ...FORENSIC_CALCS, ...CBA_CALCS];
const STAT = [...MICROMACRO_STAT_CALCS, ...TS2_STAT_CALCS, ...LIMDEP_STAT_CALCS, ...CAUSAL_STAT_CALCS];

type Case = [string, { fin: boolean; c: FinCalcDef | StatCalcDef; over: Record<string, string> }];
const cases: Case[] = [];
for (const [fin, list] of [
  [true, FIN],
  [false, STAT],
] as const) {
  for (const c of list as (FinCalcDef | StatCalcDef)[]) {
    cases.push([`${c.id} defaults`, { fin, c, over: {} }]);
    for (const f of c.fields) if (f.kind === "select") for (const o of f.options ?? []) if (o.value !== f.default) cases.push([`${c.id} ${f.key}=${o.value}`, { fin, c, over: { [f.key]: o.value } }]);
  }
}
// Optional inputs that switch on more output.
cases.push(["fx-uip with a realized spot", { fin: true, c: CBA_CALCS.find((c) => c.id === "fx-uip")!, over: { st: "1.31" } }]);

const outputs = new Map<string, Out>();
const outOf = (label: string, x: Case[1]): Out => {
  if (!outputs.has(label)) outputs.set(label, x.fin ? runFin(x.c as FinCalcDef, x.over) : runStat(x.c as StatCalcDef, x.over));
  return outputs.get(label)!;
};
// Every table cell, plus each table's label and note (both go into Word with the table).
const cellsOf = (o: Out): string[] => [...(o.tables ?? []), ...(o.table ? [o.table] : [])].flatMap((t) => [...t.rows.flat(), t.label ?? "", t.note ?? ""]);

const BRITISH =
  /\b\w*(?:realis|maximis|minimis|utilis|standardis|normalis|recognis|criticis|organis|summaris|optimis|parametris|generalis|annualis|penalis|randomis|stabilis|capitalis|categoris|amortis|equalis|neutralis|subsidis|visualis|favour|labour|behaviour|colour|honour|neighbour|centre|centred|programme|licence|catalogue|labelled|labelling)\w*/i;

describe("F2 display sweep: no _ or ^, US spelling (defaults and every select option)", () => {
  test.each(cases)("%s", (label, x) => {
    const o = outOf(label, x);
    const strings = [o.text, ...cellsOf(o)];
    for (const s of strings) {
      expect(s).not.toMatch(/[_^]/);
      const m = s.match(BRITISH);
      expect(m ? m[0] : null).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------------------- wording fixes

const fin = (id: string): FinCalcDef => FIN.find((c) => c.id === id)!;
const stat = (id: string): StatCalcDef => STAT.find((c) => c.id === id)!;

describe("F2 review round 1: wording", () => {
  test("LIFO out-of-pocket: pre-class shares are matched last, not 'first under FIFO'", () => {
    const lifo = runFin(fin("dmg-sec-oop"), { match: "lifo" }).text;
    expect(lifo).toContain("under LIFO they are the oldest lot, so sales are matched to them only after every later purchase still held");
    expect(lifo).not.toContain("FIFO");
    const fifo = runFin(fin("dmg-sec-oop")).text;
    expect(fifo).toContain("under FIFO they are the oldest lot, so sales are matched to them first");
  });

  test("price discrimination with identical markets does not claim a surplus loss", () => {
    const o = runStat(stat("micro-price-disc"), { a1: "100", b1: "2", a2: "100", b2: "2", c: "10" }).text;
    expect(o).toContain("discrimination changes nothing here");
    expect(o).not.toContain("lowers total surplus");
    // Different markets keep the textbook sentence.
    expect(runStat(stat("micro-price-disc"), { a1: "100", b1: "2", a2: "80", b2: "1", c: "10" }).text).toContain("lowers total surplus by misallocating that output");
  });

  test("lost earnings: the residual capacity is an annual amount from loss year 1", () => {
    const f = fin("dmg-lost-earnings-lpe");
    const lab = f.fields.find((ff) => ff.key === "residual")!.label;
    expect(lab).toContain("per year");
    expect(lab).toContain("loss year 1");
  });

  test("synthetic control: an exact pre-period fit makes the ratio and the permutation p-value 'not informative'", () => {
    // Region A equals donor B to the decimal before 2010, then rises by 5.
    const rows = ["Year\tRegion A\tB\tC\tD"];
    for (let t = 0; t < 14; t++) {
      const b = 20 + t * 0.7 + (t % 3) * 0.3;
      const c = 18 + t * 0.5 + ((t * 7) % 5) * 0.2;
      const d = 25 - t * 0.2 + ((t * 3) % 4) * 0.4;
      const a = t < 8 ? b : b + 5;
      rows.push([2002 + t, a, b, c, d].map((v) => (typeof v === "number" && !Number.isInteger(v) ? v.toFixed(1) : String(v))).join("\t"));
    }
    const o = runStat(stat("causal-synth"), { data: rows.join("\n"), treated: "Region A", start: "2010" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toContain("post/pre ratio = not informative (the pre-period fit is exact to the data's precision");
    expect(o.text).toContain("In-space placebo inference is not informative here");
    expect(o.text).not.toMatch(/ranks \d+ of \d+, permutation p/);
    const pl = o.tables!.find((t) => (t.label ?? "").startsWith("In-space placebos"))!;
    expect(pl.rows.find((r) => r[0].endsWith("(treated)"))!.slice(3)).toEqual(["not informative", "not ranked"]);
    // The default (an inexact fit) still ranks and prints p.
    expect(runStat(stat("causal-synth")).text).toMatch(/ranks \d+ of \d+, permutation p = /);
  });

  test("Poisson and multinomial logit separation are refused by name", () => {
    const rows: string[] = ["y x z"];
    for (let i = 0; i < 60; i++) {
      const x = i % 3 === 0 ? 1 : 0;
      rows.push(`${x ? 0 : 1 + (i % 4)} ${x} ${(((i * 7) % 11) / 3).toFixed(2)}`);
    }
    for (const model of ["poisson", "nb2"]) {
      const o = runStat(stat("econ-count"), { data: rows.join("\n"), spec: "y ~ x + z", exposure: "", model });
      expect(o.ok).toBe(false);
      expect(o.text).toContain("(separation)");
    }
    const m: string[] = ["c x z"];
    for (let i = 0; i < 90; i++) {
      const x = (i % 9) / 2;
      m.push(`${x < 1.5 ? 1 : x < 3 ? 2 : 3} ${x} ${((i * 5) % 7) / 2}`);
    }
    const o = runStat(stat("econ-mlogit"), { data: m.join("\n"), spec: "c ~ x + z" });
    expect(o.ok).toBe(false);
    expect(o.text).toContain("(separation)");
  });
});
