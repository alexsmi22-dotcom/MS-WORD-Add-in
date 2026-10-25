/**
 * Release E5c: game-nash, macro-solow, macro-islm, macro-taylor end to end, pinned to scripts/econ-e5c-oracle.py
 * (fixtures/econ-e5c-oracle.json: an independent Fraction support enumeration, mpmath Solow closed forms and paths,
 * sympy IS–LM and Taylor), then the display contract, the hostile fields and the largest inputs allowed.
 */
import * as fs from "fs";
import * as path from "path";
import type { StatOutput } from "../analyzeBlocks";
import { parseRatLiteral, ratEq, ratToNumber, type Rat } from "../cas";
import {
  GAME_NASH_DEFAULTS,
  GAME_NASH_FIELDS,
  MACRO_SOLOW_DEFAULTS,
  MACRO_SOLOW_FIELDS,
  MACRO_ISLM_DEFAULTS,
  MACRO_ISLM_FIELDS,
  MACRO_TAYLOR_DEFAULTS,
  MACRO_TAYLOR_FIELDS,
  gameNashCalc,
  gameNashRun,
  macroSolowCalc,
  macroIslmCalc,
  macroTaylorCalc,
  parseGame,
  readRat,
  fmtExact,
  fmtExactDec,
  fmtSig,
  cellDec,
} from "../gameMacroCalcs";
import { enumerateSupports, eliminate, pureEquilibria, degeneracyEvidence, zeroSumValue, solveExact, solveSquare, solveIntSystem, supportPairs, type Game } from "../nash";
import { solowSteady, solowPath, measuredHalfLife, islmSolve, islmMultipliers, taylorRate } from "../macroModels";

interface GameCase {
  name: string;
  rowNames: string[];
  colNames: string[];
  row: string;
  col: string;
  equilibria: { x: string[]; y: string[]; u1: string; u2: string }[];
  constantSum: boolean;
  lpValue?: number;
}
interface SolowCase {
  name: string;
  fields: Record<string, string>;
  D: number;
  kStar: number;
  yStar: number;
  cStar: number;
  kGold: number;
  cGold: number;
  phi: number;
  lambda: number;
  halfLife: number;
  lambdaC: number;
  path: Record<string, number>;
}
interface IslmCase {
  name: string;
  fields: Record<string, string>;
  Y0: string;
  r0: string;
  Y1: string;
  r1: string;
  dYdG: string;
  dYdT: string;
  dYdM: string;
  drdG: string;
  drdM: string;
  kG: string;
  I0v: string;
  Yf?: string;
  Pv0?: string;
  Pv1?: string;
}
interface TaylorCase {
  name: string;
  fields: Record<string, string>;
  i: string;
  real: string;
}
const ORACLE: { games: GameCase[]; solow: SolowCase[]; islm: IslmCase[]; taylor: TaylorCase[] } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "econ-e5c-oracle.json"), "utf8"),
);

const rat = (s: string): Rat => {
  const r = parseRatLiteral(s);
  if (!r) throw new Error(`bad rational ${s}`);
  return r;
};
const reader = (base: Record<string, string>, over: Record<string, string> = {}) => (k: string): string => (k in over ? over[k] : base[k] ?? "");
const nash = (over: Record<string, string> = {}): StatOutput => gameNashCalc(reader(GAME_NASH_DEFAULTS, over));
const solow = (over: Record<string, string> = {}): StatOutput => macroSolowCalc(reader(MACRO_SOLOW_DEFAULTS, over));
const islm = (over: Record<string, string> = {}): StatOutput => macroIslmCalc(reader(MACRO_ISLM_DEFAULTS, over));
const taylor = (over: Record<string, string> = {}): StatOutput => macroTaylorCalc(reader(MACRO_TAYLOR_DEFAULTS, over));

function shown(o: StatOutput): string {
  return [o.text, ...(o.tables ?? []).flatMap((t) => [t.label, t.note ?? "", ...t.rows.flat()])].join("\n");
}

function expectDisplayContract(o: StatOutput): void {
  expect(o.ok).not.toBe(false);
  const s = shown(o);
  expect(s).not.toMatch(/NaN|Infinity/);
  expect(s).not.toMatch(/[=:[;]\s*(undefined|null)\b/);
  expect(s).not.toMatch(/\bundefined\b/);
  expect(s).not.toMatch(/\d[eE][+-]?\d/);
  expect(s).not.toMatch(/(^|[\s([;:=,/])-\d/m);
  expect(s).not.toContain("—");
  // No combining diacritic anywhere (a hat combined onto a Greek letter renders detached in Word).
  expect(s).not.toMatch(new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`));
  for (const t of o.tables ?? []) {
    expect(t.align).toBeDefined();
    expect(t.align!.length).toBe(t.rows[0].length);
    expect(t.align![0]).toBe("left");
    // Word layout: at most six columns, so Word never squeezes a cell until it breaks a number.
    expect(t.rows[0].length).toBeLessThanOrEqual(6);
    for (const r of t.rows) expect(r.length).toBe(t.rows[0].length);
    for (const cell of t.rows.flat()) expect(cell.trim()).not.toBe("");
  }
  // Real superscripts and subscripts only: no caret powers, no underscore subscripts.
  expect(s).not.toMatch(/\^|[A-Za-zπ]_[A-Za-zπ0-9]/);
  if (o.svg) {
    expect(o.svg).toMatch(/^<svg/);
    expect(o.svg).not.toMatch(/NaN|Infinity|undefined|\^/);
    expect(o.svg).not.toContain("outside the axis limits");
    expect(o.svg).not.toMatch(/…/); // no legend entry cut short
  }
}

function expectRefusal(o: StatOutput, re: RegExp): void {
  expect(o.ok).toBe(false);
  expect(o.text).toMatch(re);
  expect(o.text).not.toMatch(/NaN|Infinity|undefined/);
}

// ---------------------------------------------------------------------------------------------------------------

describe("field declarations", () => {
  it("every field has a default and every select has options", () => {
    const sets: [typeof GAME_NASH_FIELDS, Record<string, string>][] = [
      [GAME_NASH_FIELDS, GAME_NASH_DEFAULTS],
      [MACRO_SOLOW_FIELDS, MACRO_SOLOW_DEFAULTS],
      [MACRO_ISLM_FIELDS, MACRO_ISLM_DEFAULTS],
      [MACRO_TAYLOR_FIELDS, MACRO_TAYLOR_DEFAULTS],
    ];
    for (const [fields, dflt] of sets) {
      for (const f of fields) {
        expect(dflt[f.key]).toBeDefined();
        if (f.kind === "select") {
          expect(f.options!.length).toBeGreaterThan(1);
          expect(f.options!.map((o) => o.value)).toContain(dflt[f.key]);
        }
      }
    }
  });
});

describe("readRat and number text", () => {
  it("reads decimals, fractions, true minus, decimal commas exactly", () => {
    const v = (s: string, o = {}): Rat => {
      const r = readRat(s, "x", o);
      if ("error" in r) throw new Error(r.error);
      return r.value;
    };
    expect(ratEq(v("0.1"), rat("1/10"))).toBe(true);
    expect(ratEq(v("−2/3"), rat("-2/3"))).toBe(true);
    expect(ratEq(v("0,25"), rat("1/4"))).toBe(true);
    expect(ratEq(v("1,500"), rat("1500"))).toBe(true);
    expect(ratEq(v("1.5×10⁻⁵"), rat("3/200000"))).toBe(true);
    expect(ratEq(v("2.5%", { percent: true }), rat("1/40"))).toBe(true);
    expect(ratEq(v("2.5%", { percentAsIs: true }), rat("5/2"))).toBe(true);
    for (const bad of ["", "abc", "1e400", "1e999", "2%", "1/0", "1e-20", "--1", "0x10"]) expect("error" in readRat(bad, "x")).toBe(true);
  });

  it("formats exactly: decimals, short fractions, else six decimals", () => {
    expect(fmtExact(rat("-3/5"))).toBe("−0.6");
    expect(fmtExact(rat("2/3"))).toBe("2/3");
    expect(fmtExact(rat("1234567/8"))).toBe("154,320.875");
    expect(fmtExactDec(rat("5400/7"))).toBe("5400/7 ≈ 771.4286");
    expect(fmtExact(rat("1/123456789012345678901"))).toMatch(/^≈ /);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// game-nash

describe("game-nash against the oracle", () => {
  for (const c of ORACLE.games) {
    it(`${c.name}: every equilibrium, exactly`, () => {
      const p = parseGame(c.row, c.col);
      if ("error" in p) throw new Error(p.error);
      const g = p.game;
      const all = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
      const en = enumerateSupports(g, all(g.rowNames.length), all(g.colNames.length));
      expect(en.equilibria.length).toBe(c.equilibria.length);
      for (const o of c.equilibria) {
        const hit = en.equilibria.find((e) => e.x.every((v, i) => ratEq(v, rat(o.x[i]))) && e.y.every((v, j) => ratEq(v, rat(o.y[j]))));
        expect(hit).toBeDefined();
        expect(ratEq(hit!.u1, rat(o.u1))).toBe(true);
        expect(ratEq(hit!.u2, rat(o.u2))).toBe(true);
      }
      // Elimination never changes the equilibrium set (strict dominance), in either mode.
      for (const mode of [false, true]) {
        const el = eliminate(g, mode);
        const en2 = enumerateSupports(g, el.rows, el.cols);
        expect(en2.equilibria.length).toBe(c.equilibria.length);
      }
      const degen = degeneracyEvidence(g, en.equilibria);
      if (/\bdegenerate/.test(c.name)) expect(degen.length).toBeGreaterThan(0);
      else {
        expect(degen).toEqual([]);
        expect(en.singular).toBe(0);
        expect(en.equilibria.length % 2).toBe(1); // a nondegenerate game has an odd number of equilibria
      }
      if (c.constantSum) {
        const zs = zeroSumValue(g.A);
        expect(ratToNumber(zs.value)).toBeCloseTo(c.lpValue!, 9);
        for (const e of en.equilibria) expect(ratEq(e.u1, zs.value)).toBe(true);
      }
      // Through the calculator: the count and the contract.
      const o = gameNashRun(c.row, c.col, "pure");
      expectDisplayContract(o);
      expect(o.text).toContain(`${c.equilibria.length} Nash equilibri${c.equilibria.length === 1 ? "um" : "a"}`);
      if (/\bdegenerate/.test(c.name)) expect(o.text).toMatch(/DEGENERATE.*may not be all/);
      else expect(o.text).toMatch(/No degeneracy was detected by the tests used/);
    });
  }

  it("the worked default (battle-of-the-sexes shape): 3 equilibria, the mixed one at 3/5 and 2/5, the best-response figure", () => {
    const o = nash();
    expectDisplayContract(o);
    expect(o.text).toMatch(/^Two-player game, 2 × 2: 3 Nash equilibria \(2 pure, 1 mixed\)/);
    expect(o.text).toContain("row player Concert 0.6, Stadium 0.4; column player Concert 0.4, Stadium 0.6; expected payoffs 1.2 and 1.2");
    expect(o.tables![0].rows[1]).toEqual(["Concert", "3, 2 *", "0, 0"]);
    expect(o.svg).toContain("Best-response correspondences");
    expect(o.svg).toContain("Nash equilibria");
  });

  it("prisoner's dilemma shape: Quiet is eliminated and the game is dominance solvable", () => {
    const c = ORACLE.games[0];
    const o = gameNashRun(c.row, c.col, "pure");
    expectDisplayContract(o);
    expect(o.text).toMatch(/removed 2 strategies; Confess × Confess remains \(the game is dominance solvable\)/);
    expect(o.tables!.map((t) => t.label)).toContain("Iterated elimination of strictly dominated strategies");
  });

  it("mixed domination: a row beaten only by a 1/2–1/2 mixture is removed in mixed mode, kept in pure mode", () => {
    const row = "Row\\Col\tL\tR\nTop\t3\t0\nMid\t0\t3\nLow\t1\t1";
    const col = "Row\\Col\tL\tR\nTop\t1\t0\nMid\t0\t1\nLow\t0\t0";
    const pure = gameNashRun(row, col, "pure");
    expect(pure.text).toMatch(/No strategy is strictly dominated by another pure strategy/);
    const mixed = gameNashRun(row, col, "mixed");
    expectDisplayContract(mixed);
    const el = mixed.tables!.find((t) => /elimination/.test(t.label))!;
    expect(el.rows[1]).toEqual(["1", "Row", "Low", "0.5 Top + 0.5 Mid"]);
    // Same equilibria either way.
    expect(pure.text.split("\n")[0]).toBe(mixed.text.split("\n")[0]);
  });

  it("the zero-sum value is printed from the LP, and a constant-sum game is recognised", () => {
    const zs = ORACLE.games.find((c) => /zero-sum 3x3/.test(c.name))!;
    const o = gameNashRun(zs.row, zs.col, "none");
    expectDisplayContract(o);
    expect(o.text).toMatch(/The game is zero-sum\. Value by linear programming: 37\/82 to the row player/);
    const row = "Row\\Col\tL\tR\nU\t3\t7\nD\t6\t4";
    const col = "Row\\Col\tL\tR\nU\t7\t3\nD\t4\t6";
    const c = gameNashRun(row, col, "pure");
    expectDisplayContract(c);
    expect(c.text).toMatch(/constant-sum \(the payoffs add to 10 in every cell/);
    expect(c.text).toMatch(/Value by linear programming: 5 to the row player, 5 to the column player/);
  });

  it("reads U+2212, decimal commas (semicolon CSV) and fractions in payoff cells", () => {
    const row = "Row\\Col;L;R\nA;0,5;−1,25\nB;−0,75;1/3";
    const col = "Row\\Col;L;R\nA;−0,2;0,6\nB;1,1;−0,4";
    const o = gameNashRun(row, col, "pure");
    expectDisplayContract(o);
    expect(o.text).toContain("row player A 15/23, B 8/23; column player L 19/34, R 15/34; expected payoffs −37/136 and 29/115");
  });

  it("a “3,1” cell (a pasted payoff pair) is read as 3.1 and the reading is said", () => {
    const row = "Row\\Col\tL\tR\nU\t3,1\t0\nD\t0\t2";
    const o = gameNashRun(row, row, "pure");
    expectDisplayContract(o);
    expect(o.text).toContain("“3,1” at (U, L) in the row player's table was read as 3.1 (a decimal comma); each player's payoffs go in their own table, one number per cell.");
    // A semicolon table's commas are decimal commas by its convention: nothing to warn about.
    expect(gameNashRun("Row\\Col;L;R\nU;3,1;0\nD;0;2", "Row\\Col;L;R\nU;3,1;0\nD;0;2", "pure").text).not.toMatch(/decimal comma\)/);
  });

  it("all-equal payoffs: every profile is an equilibrium; reported as degenerate, verified, no crash", () => {
    const t = "Row\\Col\tL\tC\tR\nU\t1\t1\t1\nM\t1\t1\t1\nD\t1\t1\t1";
    const o = gameNashRun(t, t, "mixed");
    expectDisplayContract(o);
    expect(o.text).toMatch(/9 Nash equilibria \(9 pure, 0 mixed\) found/);
    expect(o.text).toMatch(/DEGENERATE/);
  });

  it("a 1 × 1 game and a single-row game", () => {
    const one = gameNashRun("Row\\Col\tL\nU\t2", "Row\\Col\tL\nU\t−3", "pure");
    expectDisplayContract(one);
    expect(one.text).toMatch(/1 Nash equilibrium \(1 pure, 0 mixed\)/);
    const r = gameNashRun("Row\\Col\tL\tR\nU\t2\t5", "Row\\Col\tL\tR\nU\t1\t4", "pure");
    expectDisplayContract(r);
    expect(r.text).toContain("Equilibrium 1 (pure): U, R");
  });

  it("hostile tables are refused by name", () => {
    const ok = GAME_NASH_DEFAULTS.row;
    expectRefusal(gameNashRun("", ok, "pure"), /row player's payoff table is empty/);
    expectRefusal(gameNashRun(ok, "  ", "pure"), /column player's payoff table is empty/);
    expectRefusal(gameNashRun("Row\\Col\tL\tR\nU\tabc\t1\nD\t0\t1", ok, "pure"), /payoff at \(U, L\).*“abc” is not a number/);
    expectRefusal(gameNashRun("Row\\Col\tL\tR\nU\t1e400\t1\nD\t0\t1", ok, "pure"), /too large/);
    expectRefusal(gameNashRun("Row\\Col\tL\tR\nU\tNA\t1\nD\t0\t1", ok, "pure"), /empty or missing/);
    expectRefusal(gameNashRun("Row\\Col\tL\tR\nU\t\t1\nD\t0\t1", ok, "pure"), /empty or missing/);
    expectRefusal(gameNashRun("L R\nU 1 2\nD 3 4", ok, "pure"), /corner cell/);
    expectRefusal(gameNashRun("Row\\Col\t1\t2\nU\t1\t2\nD\t3\t4", ok, "pure"), /header row naming the column strategies/);
    expectRefusal(gameNashRun("Row\\Col\tL\tR\n5\t1\t2\nD\t3\t4", ok, "pure"), /starts with the number/);
    expectRefusal(gameNashRun("Row\\Col\tL\tL\nU\t1\t2\nD\t3\t4", ok, "pure"), /appears twice/);
    expectRefusal(gameNashRun(ok, "Row\\Col\tConcert\tStadium\tHome\nConcert\t1\t2\t3\nStadium\t3\t4\t5", "pure"), /different shapes/);
    expectRefusal(gameNashRun(ok, "Row\\Col\tConcert\tStadium\nStadium\t1\t2\nConcert\t3\t4", "pure"), /Row 1 is “Concert”.*“Stadium”/);
    expectRefusal(gameNashRun(ok, ok, "weak"), /Unknown elimination choice/);
    const big = ["Row\\Col\t" + Array.from({ length: 9 }, (_, j) => `c${j}`).join("\t"), ...Array.from({ length: 9 }, (_, i) => `r${i}\t` + Array(9).fill("1").join("\t"))].join("\n");
    expectRefusal(gameNashRun(big, big, "pure"), /9 × 9; the largest game handled is 8 × 8/);
  });

  it("the wall clock refuses by name", () => {
    const c = ORACLE.games.find((x) => /8x8/.test(x.name))!;
    expectRefusal(gameNashRun(c.row, c.col, "none", -1), /stopped at the 0 s limit while enumerating supports \(12,869 support pairs for a 8 × 8 game\)/);
    expectRefusal(gameNashRun(c.row, c.col, "mixed", -1), /stopped at the 0 s limit while eliminating dominated strategies/);
  });

  it("the largest games (8 × 8, no elimination, 12,869 support pairs) finish well inside the clock", () => {
    expect(supportPairs(8, 8)).toBe(12869); // C(16, 8) − 1: every k from 1 to 8
    for (const c of ORACLE.games.filter((x) => /8x8/.test(x.name))) {
      const t0 = Date.now();
      const o = gameNashRun(c.row, c.col, "none");
      const ms = Date.now() - t0;
      expectDisplayContract(o);
      expect(o.text).toContain(`${c.equilibria.length} Nash equilibria`);
      expect(o.text).toContain("12,869 support pairs examined");
      if (/nondegenerate/.test(c.name)) expect(o.text).toMatch(/No degeneracy was detected/);
      else expect(o.text).toMatch(/DEGENERATE \(at a found equilibrium a player has more pure best responses.*an even number of equilibria were found/);
      expect(ms).toBeLessThan(BOUND_MS);
    }
  });

  it("worst cases at 8 × 8: 15-digit decimals at 10¹⁰ and 10⁻⁵ scales with mixed elimination, and all-equal payoffs", () => {
    let seed = 777;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const head = "Row\\Col\t" + Array.from({ length: 8 }, (_, j) => `c${j + 1}`).join("\t");
    const tab = (cell: () => string): string => [head, ...Array.from({ length: 8 }, (_, i) => `r${i + 1}\t` + Array.from({ length: 8 }, cell).join("\t"))].join("\n");
    const big = (): string => `${rnd() < 0.5 ? "−" : ""}${Math.floor(rnd() * 1e10)}.${String(Math.floor(rnd() * 1e5)).padStart(5, "0")}`;
    const tiny = (): string => `${rnd() < 0.5 ? "−" : ""}0.0000${String(Math.floor(rnd() * 1e10)).padStart(10, "0")}`;
    for (const cell of [big, tiny]) {
      const rowT = tab(cell);
      const colT = tab(cell);
      for (const mode of ["mixed", "none"]) {
        const t0 = Date.now();
        const o = gameNashRun(rowT, colT, mode);
        const ms = Date.now() - t0;
        expectDisplayContract(o);
        expect(o.text).toMatch(/Nash equilibri/);
        expect(ms).toBeLessThan(BOUND_MS);
      }
    }
    const t0 = Date.now();
    const eq = gameNashRun(tab(() => "7"), tab(() => "−7"), "mixed");
    const ms = Date.now() - t0;
    expectDisplayContract(eq);
    expect(eq.text).toMatch(/64 Nash equilibria \(64 pure, 0 mixed\) found/);
    expect(eq.text).toMatch(/The game is constant-sum \(the payoffs add to 0|The game is zero-sum/);
    expect(ms).toBeLessThan(BOUND_MS);
  });

  it("solveExact solves and detects singular systems", () => {
    const s = solveExact([[rat("2"), rat("1")], [rat("1"), rat("3")]], [rat("3"), rat("5")]);
    expect(s!.map((v) => `${v.n}/${v.d}`)).toEqual(["4/5", "7/5"]);
    expect(solveExact([[rat("1"), rat("2")], [rat("2"), rat("4")]], [rat("1"), rat("2")])).toBeNull();
  });

  it("the fraction-free integer solver agrees with exact rational elimination, singular systems included", () => {
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let counts = { unique: 0, none: 0, many: 0 };
    for (let trial = 0; trial < 3000; trial++) {
      const n = 1 + Math.floor(rnd() * 6);
      const M: bigint[][] = [];
      for (let i = 0; i < n; i++) M.push(Array.from({ length: n + 1 }, () => BigInt(Math.floor(rnd() * 7) - 3)));
      // Make about a third rank-deficient: copy a multiple of one row (and sometimes its right-hand side).
      if (n > 1 && rnd() < 0.35) {
        const f = BigInt(Math.floor(rnd() * 5) - 2);
        M[n - 1] = M[0].map((v) => v * f);
        if (rnd() < 0.5) M[n - 1][n] += 1n;
      }
      const a = solveIntSystem(M);
      const b = solveSquare(M.map((r) => r.slice(0, n).map((v) => rat(String(v)))), M.map((r) => rat(String(r[n]))));
      expect(a.status).toBe(b.status);
      counts[a.status]++;
      if (a.status === "unique" && b.status === "unique") a.num.forEach((v, i) => expect(ratEq(rat(`${v}/${a.den}`), b.z[i])).toBe(true));
    }
    expect(counts.unique).toBeGreaterThan(500);
    expect(counts.none).toBeGreaterThan(100);
    expect(counts.many).toBeGreaterThan(50);
  });

  it("pure equilibria are found directly as well", () => {
    const p = parseGame(GAME_NASH_DEFAULTS.row, GAME_NASH_DEFAULTS.col) as { game: Game };
    expect(pureEquilibria(p.game)).toEqual([[0, 0], [1, 1]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// macro-solow

describe("macro-solow against the oracle", () => {
  for (const c of ORACLE.solow) {
    it(`${c.name}`, () => {
      const p = { alpha: ratToNumber(rat(c.fields.alpha)), s: ratToNumber(rat(c.fields.s)), n: ratToNumber(rat(c.fields.n)), g: ratToNumber(rat(c.fields.g)), delta: ratToNumber(rat(c.fields.delta)) };
      const ss = solowSteady(p);
      if ("error" in ss) throw new Error(ss.error);
      const rel = (a: number, b: number): number => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
      for (const k of ["D", "kStar", "yStar", "cStar", "kGold", "cGold", "phi", "lambda", "halfLife", "lambdaC"] as const) expect(rel(ss[k], c[k])).toBeLessThan(1e-11);
      const T = Number(c.fields.T);
      const k = solowPath(p, ratToNumber(rat(c.fields.k0)), T);
      for (const [t, v] of Object.entries(c.path)) expect(rel(k[Number(t)], v)).toBeLessThan(1e-11);
      const o = macroSolowCalc(reader(MACRO_SOLOW_DEFAULTS, c.fields));
      expectDisplayContract(o);
      expect(o.text).toContain(`k* = ${c.kStar.toFixed(4)}`);
      // At least two decimals and four significant digits (full depreciation: 0.7565, not 0.76).
      expect(o.text).toContain(`half-life ln 2/λ = ${fmtSig(c.halfLife, 2)} periods`);
    });
  }

  it("the printed half-life agrees with the simulated map near k*, and the gap ratio tends to φ′", () => {
    for (const c of ORACLE.solow) {
      const p = { alpha: ratToNumber(rat(c.fields.alpha)), s: ratToNumber(rat(c.fields.s)), n: ratToNumber(rat(c.fields.n)), g: ratToNumber(rat(c.fields.g)), delta: ratToNumber(rat(c.fields.delta)) };
      const ss = solowSteady(p) as Exclude<ReturnType<typeof solowSteady>, { error: string }>;
      const near = solowPath(p, ss.kStar * 1.001, 400);
      const h = measuredHalfLife(near, ss.kStar)!;
      expect(h).toBeGreaterThanOrEqual(Math.floor(ss.halfLife));
      expect(h).toBeLessThanOrEqual(Math.ceil(ss.halfLife));
      const ratio = (near[11] - ss.kStar) / (near[10] - ss.kStar);
      expect(Math.abs(ratio - ss.phi)).toBeLessThan(1e-3);
    }
    const o = solow();
    expectDisplayContract(o);
    expect(o.text).toMatch(/from 0\.1% above k\* the gap first falls to half in period 13\./);
    expect(o.text).toMatch(/gap ratio is 0\.94\d+ \(it tends to φ′\)/);
  });

  it("the worked default: text, tables, both figures", () => {
    const o = solow();
    expectDisplayContract(o);
    expect(o.text).toMatch(/^Solow model \(discrete time, per effective worker\): k\* = 5\.0743/);
    expect(o.text).toMatch(/n \+ g \+ ng \+ δ = 0\.080200/);
    expect(o.text).toMatch(/saving is below the golden rule/);
    expect(o.tables![1].rows[0]).toEqual(["Period t", "kₜ", "yₜ", "cₜ", "Gap to k* (%)"]);
    expect(o.svg).toContain("Convergence to the steady state");
    expect(o.svg).toContain("Saving and break-even investment");
  });

  it("percent inputs are read and said", () => {
    const o = solow({ s: "25%", n: "1%", g: "2%", delta: "5%" });
    expectDisplayContract(o);
    expect(o.text).toContain("k* = 5.0743");
    expect(o.text).toMatch(/Read as percent and divided by 100: the saving rate s, population growth n/);
  });

  it("hostile fields are refused by name", () => {
    expectRefusal(solow({ alpha: "1" }), /capital share α must be strictly between 0 and 1/);
    expectRefusal(solow({ alpha: "0" }), /capital share/);
    expectRefusal(solow({ s: "0" }), /saving rate s must be strictly between/);
    expectRefusal(solow({ s: "−0.1" }), /saving rate/);
    expectRefusal(solow({ delta: "1.5" }), /depreciation rate δ/);
    expectRefusal(solow({ n: "−1" }), /greater than −1/);
    expectRefusal(solow({ n: "−0.05", g: "0", delta: "0.01" }), /no positive steady state.*negative/);
    expectRefusal(solow({ alpha: "abc" }), /“abc” is not a number/);
    expectRefusal(solow({ s: "" }), /saving rate s is empty/);
    expectRefusal(solow({ k0: "1e400" }), /too large/);
    expectRefusal(solow({ k0: "0" }), /k₀ must be greater than zero/);
    expectRefusal(solow({ T: "0" }), /from 1 to 100,000/);
    expectRefusal(solow({ T: "100001" }), /from 1 to 100,000/);
    expectRefusal(solow({ T: "2.5" }), /not a whole number/);
    expectRefusal(solow({ alpha: "0.999", s: "0.9", n: "0", g: "0", delta: "0.0001" }), /outside 10⁻¹⁵ to 10¹⁵/);
  });

  it("huge and tiny starting capital stay contract-clean", () => {
    for (const k0 of ["1e12", "1e-12"]) {
      const o = solow({ k0, T: "500" });
      expectDisplayContract(o);
    }
    const o = solow({ k0: "1e12" });
    expect(o.svg).toContain("beyond the plotted range");
  });

  it("starting at the steady state", () => {
    const ss = solowSteady({ alpha: 0.5, s: 0.2, n: 0, g: 0, delta: 0.1 }) as { kStar: number };
    expect(ss.kStar).toBeCloseTo(4, 12);
    const o = solow({ alpha: "0.5", s: "0.2", n: "0", g: "0", delta: "0.1", k0: "4" });
    expectDisplayContract(o);
    expect(o.text).toMatch(/the path starts at the steady state/);
  });

  it("the largest T (100,000) runs in bounded time", () => {
    const t0 = Date.now();
    const o = solow({ T: "100000" });
    const ms = Date.now() - t0;
    expectDisplayContract(o);
    expect(o.tables![1].rows.length).toBeLessThan(40);
    expect(ms).toBeLessThan(SOLOW_BOUND_MS);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// macro-islm

describe("macro-islm against the oracle", () => {
  for (const c of ORACLE.islm) {
    it(`${c.name}`, () => {
      const f = c.fields;
      const P = (k: string): Rat => rat(f[k]);
      const p0 = { C0: P("C0"), c: P("c"), T: P("T"), I0: P("I0"), b: P("b"), G: P("G"), M: P("M"), P: P("P"), k: P("k"), h: P("h") };
      const s0 = islmSolve(p0);
      expect(ratEq(s0.Y, rat(c.Y0))).toBe(true);
      expect(ratEq(s0.r, rat(c.r0))).toBe(true);
      expect(ratEq(s0.I, rat(c.I0v))).toBe(true);
      const s1 = islmSolve({ ...p0, G: rat(`${ratToNumber(p0.G) + Number(f.dG)}`), T: rat(`${ratToNumber(p0.T) + Number(f.dT)}`), M: rat(`${ratToNumber(p0.M) + Number(f.dM)}`) });
      expect(ratEq(s1.Y, rat(c.Y1))).toBe(true);
      expect(ratEq(s1.r, rat(c.r1))).toBe(true);
      const mu = islmMultipliers(p0);
      expect(ratEq(mu.dYdG, rat(c.dYdG))).toBe(true);
      expect(ratEq(mu.dYdT, rat(c.dYdT))).toBe(true);
      expect(ratEq(mu.dYdM, rat(c.dYdM))).toBe(true);
      expect(ratEq(mu.drdG, rat(c.drdG))).toBe(true);
      expect(ratEq(mu.drdM, rat(c.drdM))).toBe(true);
      expect(ratEq(mu.kG, rat(c.kG))).toBe(true);
      const o = macroIslmCalc(reader(MACRO_ISLM_DEFAULTS, { ...f, ...(c.Yf ? { as: "vertical", Yf: c.Yf } : {}) }));
      expectDisplayContract(o);
      expect(o.text).toContain(`Y* = ${fmtExactDec(rat(c.Y0))}, r* = ${fmtExactDec(rat(c.r0))}%`);
      if (c.Pv0) {
        expect(o.text).toContain(`P = bM/(D·Yₚ − hA) = ${fmtExactDec(rat(c.Pv0))}`);
        expect(o.text).toContain(`after the policy P = ${fmtExactDec(rat(c.Pv1!))}`);
      }
    });
  }

  it("the worked default: ΔG = 50 raises Y by 100 and r by 1; the Keynesian cross would give 200", () => {
    const o = islm();
    expectDisplayContract(o);
    expect(o.text).toMatch(/^IS–LM equilibrium: Y\* = 1,800, r\* = 6% \(consumption 1,400, investment 150, real balances M\/P = 600\)/);
    expect(o.text).toContain("Y* 1,800 → 1,900 (ΔY = 100), r* 6% → 7% (Δr = 1 percentage points), investment changes by −25.");
    expect(o.text).toContain("(ΔG − cΔT)/(1 − c) = 200");
    expect(o.svg).toContain("IS–LM");
    expect(o.svg).toContain("AD–AS");
    expect(o.svg).toContain("IS after policy");
  });

  it("awkward fractions print exactly with decimals, and a negative r is noted", () => {
    const c = ORACLE.islm[1];
    const o = macroIslmCalc(reader(MACRO_ISLM_DEFAULTS, c.fields));
    expectDisplayContract(o);
    expect(o.text).toContain("Y* = 40300/29 ≈ 1,389.6552, r* = −8/87 ≈ −0.0920%");
    expect(o.text).toMatch(/an equilibrium interest rate is negative/);
  });

  it("money is neutral under a vertical AS", () => {
    const o = islm({ dG: "0", dM: "120", as: "vertical", Yf: "1800" });
    expectDisplayContract(o);
    expect(o.text).toMatch(/money is neutral: P moves in proportion and r is unchanged/);
    const t = o.tables!.find((x) => /AD–AS/.test(x.label))!;
    expect(t.rows[1]).toEqual(["Price level P", "1", "1.2", "0.2"]);
    expect(t.rows[3][3]).toBe("0");
  });

  it("a vertical AS that AD cannot reach is said, not drawn", () => {
    const o = islm({ as: "vertical", Yf: "5000", b: "0" });
    expectDisplayContract(o);
    expect(o.text).toMatch(/no positive price level puts aggregate demand at Yₚ \(with b = 0 or M = 0/);
  });

  it("hostile fields are refused by name", () => {
    expectRefusal(islm({ c: "1" }), /marginal propensity to consume c must be at least 0 and below 1/);
    expectRefusal(islm({ c: "−0.1" }), /marginal propensity/);
    expectRefusal(islm({ h: "0", b: "0" }), /both vertical/);
    expectRefusal(islm({ k: "0" }), /income sensitivity of money demand k/);
    expectRefusal(islm({ P: "0" }), /price level P must be greater than zero/);
    expectRefusal(islm({ b: "−5" }), /cannot be negative/);
    expectRefusal(islm({ G: "abc" }), /Government spending G: “abc” is not a number/);
    expectRefusal(islm({ C0: "" }), /Autonomous consumption C₀ is empty/);
    expectRefusal(islm({ M: "1e400" }), /too large/);
    expectRefusal(islm({ C0: "−5000" }), /no positive-output equilibrium/);
    expectRefusal(islm({ dM: "−700" }), /money supply negative/);
    expectRefusal(islm({ as: "upward" }), /Unknown aggregate supply/);
    expectRefusal(islm({ as: "vertical", Yf: "0" }), /Yₚ must be greater than zero/);
  });

  it("huge and tiny scales stay exact and contract-clean", () => {
    const big = islm({ C0: "2e11", T: "2e11", I0: "3e11", G: "2.5e11", M: "6e11", b: "2.5e10", h: "5e10", dG: "5e10" });
    expectDisplayContract(big);
    expect(big.text).toContain("Y* = 1,800,000,000,000, r* = 6%");
    const tiny = islm({ C0: "2e-10", T: "2e-10", I0: "3e-10", G: "2.5e-10", M: "6e-10", b: "2.5e-11", h: "5e-11", dG: "5e-11" });
    expectDisplayContract(tiny);
    expect(tiny.text).toContain("r* = 6%");
  });

  it("the balanced-budget multiplier with crowding out", () => {
    const o = islm();
    const t = o.tables!.find((x) => x.label === "Multipliers")!;
    expect(t.rows[3]).toEqual(["Balanced budget (ΔG = ΔT)", "0.5", "1"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// macro-taylor

describe("macro-taylor against the oracle", () => {
  for (const c of ORACLE.taylor) {
    it(`${c.name}`, () => {
      const f = c.fields;
      const r = taylorRate({ rn: rat(f.rn), pi: rat(f.pi), piStar: rat(f.piStar), gap: rat(f.gap), aPi: rat(f.aPi), aY: rat(f.aY) });
      expect(ratEq(r.i, rat(c.i))).toBe(true);
      expect(ratEq(r.real, rat(c.real))).toBe(true);
      const o = macroTaylorCalc(reader(MACRO_TAYLOR_DEFAULTS, f));
      expectDisplayContract(o);
      expect(o.text).toContain(`i = ${fmtExactDec(rat(c.i))}%`);
    });
  }

  it("the worked default is Taylor's 1993 rule: 6%", () => {
    const o = taylor();
    expectDisplayContract(o);
    expect(o.text).toMatch(/^Taylor rule policy rate: i = 6%/);
    expect(o.text).toMatch(/Taylor principle: the nominal rate moves by 1 \+ a = 1\.5/);
    expect(o.svg).toContain("Taylor rule");
  });

  it("the lower bound binds and the unconstrained value is shown", () => {
    const o = taylor({ pi: "−1.2", gap: "−6.5", rn: "0.5", aY: "1", floor: "0" });
    expectDisplayContract(o);
    expect(o.text).toContain("i = 0% (the lower bound; the rule gives −8.8%)");
    expect(o.text).toContain("i = 0.5 + (−1.2) + 0.5·(−1.2 − 2) + 1·(−6.5); implied real rate i − π = 1.2%.");
  });

  it("a series: table per period, lower-bound count, figure with period labels", () => {
    const series = "Quarter\tInflation\tGap\n2024 Q1\t3.2\t0.5\n2024 Q2\t2,8\t−0.4\n2024 Q3\t2.1%\t−2\n2024 Q4\t0.4\t−7";
    const o = taylor({ series, floor: "0.25" });
    expectDisplayContract(o);
    expect(o.text).toMatch(/^Taylor rule over 4 periods: 2024 Q4 policy rate 0\.25%/);
    expect(o.text).toMatch(/binds in 1 period/);
    expect(o.tables![0].rows[2]).toEqual(["2024 Q2", "2.8", "−0.4", "5", "5", "2.2"]);
    expect(o.svg).toContain("2024 Q1");
  });

  it("hostile fields are refused by name", () => {
    expectRefusal(taylor({ pi: "abc" }), /Inflation π: “abc” is not a number/);
    expectRefusal(taylor({ rn: "" }), /neutral real rate rⁿ is empty/);
    expectRefusal(taylor({ aPi: "−0.5" }), /cannot be negative/);
    expectRefusal(taylor({ gap: "1e400" }), /too large/);
    expectRefusal(taylor({ series: "Quarter\tInflation\n2024 Q1\t3" }), /three columns/);
    expectRefusal(taylor({ series: "Quarter\tInflation\tGap\n2024 Q1\tNA\t1" }), /missing inflation or output-gap value/);
    expectRefusal(taylor({ series: "Quarter\tInflation\tGap\n2024 Q1\tx\t1" }), /Inflation in “2024 Q1”: “x” is not a number/);
    const many = ["P\tI\tG", ...Array.from({ length: 10001 }, (_, i) => `p${i}\t2\t0`)].join("\n");
    expectRefusal(taylor({ series: many }), /limit is 10,000/);
  });

  it("the largest series (10,000 rows) runs", () => {
    const rows = ["P\tI\tG", ...Array.from({ length: 10000 }, (_, i) => `p${i}\t${(i % 50) / 10}\t${((i % 30) - 15) / 10}`)].join("\n");
    const t0 = Date.now();
    const o = taylor({ series: rows });
    const ms = Date.now() - t0;
    expectDisplayContract(o);
    expect(o.tables![0].rows.length).toBe(10001);
    expect(ms).toBeLessThan(TAYLOR_BOUND_MS);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Adversarial-review and Word-pass regressions (E5 fix round)

describe("E5 fix round: magnitudes are tested on the exact rational", () => {
  it("1e−400 (double 0, rational nonzero) is refused as too small, never read as 0", () => {
    for (const s of ["1e-400", "−1e-400", "1e-16", "1×10⁻²⁰", "3/10000000000000000"]) {
      const r = readRat(s, "x");
      expect("error" in r && r.error).toMatch(/too small/);
    }
    expect("error" in readRat("1×10⁻⁴⁰⁰", "x")).toBe(true);
    // At the floor exactly, and zero itself, are accepted.
    expect("error" in readRat("1e-15", "x")).toBe(false);
    expect("error" in readRat("0", "x")).toBe(false);
    expect("error" in readRat("1e15", "x")).toBe(false);
    expect("error" in readRat("1000000000000001", "x") && (readRat("1000000000000001", "x") as { error: string }).error).toMatch(/too large/);
  });
  it("typed numbers are capped in length (no BigInt on a many-thousand-digit literal)", () => {
    const r = readRat("1".repeat(5000), "x");
    expect("error" in r && r.error).toMatch(/longer than 40 characters/);
    expectRefusal(islm({ G: "0." + "0".repeat(60) + "1" }), /longer than 40 characters/);
  });
  it("IS–LM: h = 1e−400 with b = 0 is refused by name (no 400-digit r*)", () => {
    const o = islm({ h: "1e-400", b: "0" });
    expectRefusal(o, /interest sensitivity h: “1e-400” is too small/);
    expect(o.text.length).toBeLessThan(200);
  });
  it("Taylor π = 1e−400 and a Nash payoff 1e−400 are refused, not printed as 0 or treated as positive", () => {
    expectRefusal(taylor({ pi: "1e-400" }), /Inflation π: “1e-400” is too small/);
    expectRefusal(gameNashRun("Row\\Col\tL\tR\nU\t1e-400\t0\nD\t0\t1", GAME_NASH_DEFAULTS.col, "pure"), /payoff at \(U, L\).*too small/);
  });
});

describe("E5 fix round: macro-taylor weights", () => {
  it("a % sign on a weight is refused (a weight is a coefficient); rates keep percent semantics", () => {
    expectRefusal(taylor({ aPi: "50%" }), /The weight a: “50%” has a % sign; a weight is a coefficient, not a percent/);
    expectRefusal(taylor({ aY: "50 %" }), /The weight b: .* a weight is a coefficient/);
    const o = taylor({ rn: "2%", pi: "3%", piStar: "2%", gap: "1%" });
    expectDisplayContract(o);
    expect(o.text).toMatch(/^Taylor rule policy rate: i = 6%/);
  });
  it("a series with duplicate column names is refused", () => {
    expectRefusal(taylor({ series: "Quarter\tInflation\tinflation\n2024 Q1\t3\t1" }), /two columns named “inflation”/i);
  });
  it("series cells are decimals only; the headline keeps the exact value", () => {
    const o = taylor({ aPi: "1/3", series: "Q\tInflation\tGap\nq1\t3\t1\nq2\t2.5\t0" });
    expectDisplayContract(o);
    for (const cell of o.tables![0].rows.slice(1).flat()) expect(cell).not.toMatch(/\/|≈/);
    // q2: 2 + 2.5 + (1/3)(2.5 − 2) + 0.5·0 = 14/3.
    expect(o.text).toMatch(/q2 policy rate 14\/3 ≈ 4\.6667%/);
    expect(o.tables![0].rows[2][3]).toBe("4.6667");
  });
});

describe("E5 fix round: macro-solow", () => {
  it("small values keep four significant digits (k* 9.025×10⁻⁵, never 0.0001)", () => {
    const o = solow({ alpha: "0.5", s: "0.0095", n: "0", g: "0", delta: "1", k0: "0.0001", T: "50" });
    expectDisplayContract(o);
    expect(o.text).toContain("k* = 9.025×10⁻⁵, y* = 0.009500");
    const ss = o.tables![0];
    expect(ss.rows.find((r) => r[0].startsWith("k* "))![1]).toBe("9.025×10⁻⁵");
    expect(o.tables![1].rows[1][1]).toBe("1.000×10⁻⁴");
    expect(fmtSig(8.97e-5, 4)).toBe("8.970×10⁻⁵");
    expect(fmtSig(0.0123456, 4)).toBe("0.01235");
    expect(fmtSig(0.0123456, 6)).toBe("0.012346");
    expect(fmtSig(5.0743391, 4)).toBe("5.0743");
  });
  it("only k(gold) out of range: everything else is reported and the reason is said", () => {
    const o = solow({ alpha: "0.95", s: "0.05", n: "0", g: "0", delta: "0.05" });
    expectDisplayContract(o);
    expect(o.text).toContain("k* = 1.0000");
    expect(o.text).toMatch(/golden-rule k .* is outside 10⁻¹⁵ to 10¹⁵ for these parameters, so k\(gold\), y\(gold\) and c\(gold\) are not shown/);
    expect(o.text).toMatch(/saving is below the golden rule/);
    expect(o.tables![0].rows.some((r) => /gold\)/.test(r[0]) && !/saving/.test(r[0]))).toBe(false);
  });
});

describe("E5 fix round: macro-islm vertical AS", () => {
  const vert = (over: Record<string, string>): StatOutput => islm({ as: "vertical", Yf: "1800", ...over });
  it("a tax rise crowds investment IN (r falls): ΔI = cΔT − ΔG = 30", () => {
    const o = vert({ dG: "0", dT: "40" });
    expectDisplayContract(o);
    expect(o.text).toContain("investment changes by ΔI = cΔT − ΔG = 30; crowding in: r falls");
    expect(o.text).not.toContain("one for one");
    const t = o.tables!.find((x) => /AD–AS/.test(x.label))!;
    expect(t.rows.find((r) => r[0] === "Investment I")![3]).toBe("30");
  });
  it("ΔG alone crowds out one for one (ΔI = −ΔG)", () => {
    const o = vert({ dG: "50", dT: "0" });
    expectDisplayContract(o);
    expect(o.text).toContain("investment changes by ΔI = cΔT − ΔG = −50; fiscal policy crowds out investment one for one (ΔI = −ΔG)");
  });
  it("Yₚ at or below hA/D: the direction is right and hA/D is printed", () => {
    for (const Yf of ["1000", "1200"]) {
      const o = vert({ Yf, dG: "0" });
      expectDisplayContract(o);
      expect(o.text).toContain("Yₚ is at or below hA/D = 1,200, the output aggregate demand approaches as P grows without bound");
      expect(o.text).not.toMatch(/beyond/);
    }
    const after = vert({ Yf: "1250", dG: "50" });
    expectDisplayContract(after);
    expect(after.text).toContain("no positive price level puts aggregate demand at Yₚ after the policy (Yₚ is at or below hA/D = 1,300");
  });
  it("a negative AD–AS interest rate is noted", () => {
    const o = vert({ Yf: "3000", dG: "0" });
    expectDisplayContract(o);
    expect(o.text).toContain("r = −6%");
    expect(o.text).toContain("Note: an AD–AS (long-run) interest rate is negative.");
    expect(o.text).not.toContain("Note: an equilibrium interest rate is negative.");
  });
  it("IS–LM tables show decimals only, with the exact fractions in the text", () => {
    const c = ORACLE.islm[1];
    const o = macroIslmCalc(reader(MACRO_ISLM_DEFAULTS, c.fields));
    expectDisplayContract(o);
    for (const t of o.tables!) {
      for (const cell of t.rows.slice(1).flatMap((r) => r.slice(1))) expect(cell).not.toMatch(/\/|≈/);
      expect(t.note).toMatch(/Decimals: exact when they terminate within four places/);
    }
    expect(o.tables![0].rows[1][1]).toBe(cellDec(rat("40300/29")));
    expect(cellDec(rat("40300/29"))).toBe("1,389.6552");
    expect(o.text).toContain("Y* = 40300/29 ≈ 1,389.6552");
  });
});

describe("E5 fix round: game-nash figure and tables", () => {
  it("an everywhere-indifferent player is drawn as a hatched square and the caption says so", () => {
    const o = gameNashRun("Row\\Col\tL\tR\nU\t1\t1\nD\t1\t1", "Row\\Col\tL\tR\nU\t2\t0\nD\t0\t1", "none");
    expectDisplayContract(o);
    // The caption wraps across lines in the figure: test its words with the line breaks removed.
    const words = (svg: string): string => (svg.match(/>([^<]*)</g) ?? []).map((s) => s.slice(1, -1)).join(" ").replace(/\s+/g, " ");
    expect(words(o.svg!)).toContain("The row player is indifferent between U and D whatever the column player does: every p is a best response (hatched: the whole square).");
    // Eleven hatch lines across the square in the row player's colour (not just its outline).
    expect((o.svg!.match(/stroke="#0369a1" stroke-width="1.6"/g) ?? []).length).toBe(11);
    const c = gameNashRun("Row\\Col\tL\tR\nU\t2\t0\nD\t0\t1", "Row\\Col\tL\tR\nU\t1\t1\nD\t1\t1", "none");
    expectDisplayContract(c);
    expect(words(c.svg!)).toContain("The column player is indifferent between L and R whatever the row player does");
  });
  it("an 8 × 8 payoff table is split into tables of at most five strategy columns", () => {
    const g = ORACLE.games.find((x) => /8x8/.test(x.name))!;
    const o = gameNashRun(g.row, g.col, "none");
    expectDisplayContract(o);
    const pay = o.tables!.filter((t) => t.label.startsWith("Payoffs"));
    expect(pay.length).toBe(2);
    expect(pay.map((t) => t.rows[0].length)).toEqual([6, 4]);
    expect(pay[0].label).toMatch(/columns .* to /);
  });
});

// Measured on the build machine with one jest worker (2026-10-25): an 8 × 8 game at most 330 ms (15-digit decimals,
// no elimination), Solow T = 100,000 about 120 ms, a 10,000-row Taylor series about 120 ms (the contract checks in
// the test take longer than the calculator). Bounds are 6× or more those measurements and still inside the 6 s clock.
const BOUND_MS = 2000;
const SOLOW_BOUND_MS = 2000;
const TAYLOR_BOUND_MS = 2000;
