/**
 * Plain-language readings (lib/calcReading.ts) for five Stats pane calculators whose modules other registries import,
 * so the readings live here as wrappers rather than inside those modules:
 *  - iv-2sls       (ivCalcs.ts):       iv2slsWithReading
 *  - game-nash     (gameMacroCalcs.ts): gameNashWithReading
 *  - macro-solow   (gameMacroCalcs.ts): macroSolowWithReading
 *  - macro-islm    (gameMacroCalcs.ts): macroIslmWithReading
 *  - macro-taylor  (gameMacroCalcs.ts): macroTaylorWithReading
 *
 * Each wrapper returns the module's StatOutput unchanged (text, tables, figure) plus `reading` on a result (never on a
 * refusal). The numbers in a reading are taken from the result's own table cells, or formatted from the engine's own
 * values with the module's own formatter, so a reading never shows a number the text and tables do not. The text is
 * never parsed. Inputs needed only to choose the WORDING (is saving below the golden rule, is inflation above target)
 * are read with the module's own reader (readRat), exactly as the calculator reads them.
 */
import type { StatOutput, StatTable } from "./analyzeBlocks";
import { READING_MAX } from "./calcReading";
import { iv2slsCalcFrom, ivFitFromRead } from "./ivCalcs";
import { BOUNDARY_CLAUSE, printedNumber, printedPVerdict } from "./pReading";
import { fmtFixed, fmtP, intText, P_BELOW } from "./regTable";
import { gameNashCalc, macroIslmCalc, macroSolowCalc, macroTaylorCalc, readRat } from "./gameMacroCalcs";
import { ratAdd, ratMul, ratSign, ratSub, ratToNumber, type Rat } from "./cas";

type Read = (k: string) => string;

/** The table whose label starts with `prefix`. */
function tableStarting(out: StatOutput, prefix: string): StatTable | undefined {
  return (out.tables ?? []).find((t) => t.label.startsWith(prefix));
}

/** The cell in the row whose first cell starts with `rowStart`, at column `col` (0 = the row label). */
function cell(t: StatTable | undefined, rowStart: string, col = 1): string | undefined {
  const row = t?.rows.find((r) => r[0].startsWith(rowStart));
  const v = row?.[col];
  return v === undefined || v === "" ? undefined : v;
}

/** The first candidate that fits the reading limit (the last one regardless). */
function firstFitting(candidates: string[]): string {
  for (const c of candidates) if (c.length <= READING_MAX) return c;
  return candidates[candidates.length - 1];
}

/** A table cell read as a sign: −1, 0 or 1 (a true or ASCII minus is negative; any nonzero digit is nonzero). */
function cellSign(c: string): number {
  const s = c.trim();
  // The mantissa decides: "−0.0000" is zero, not negative (R6 #8); "3.5×10⁻¹⁵" is positive by its digits.
  const mant = s.replace(/×10.*$/, "");
  if (!/[1-9]/.test(mant)) return 0;
  return /^[−-]/.test(s) ? -1 : 1;
}

function withReading(out: StatOutput, build: () => string | undefined): StatOutput {
  if (out.ok === false) return out;
  const reading = build();
  return reading ? { ...out, reading } : out;
}

// ---------------------------------------------------------------------------------------------------------------
// iv-2sls

/** iv-2sls with its reading: the instrumented effect(s), whether they differ from zero, and instrument strength. */
export function iv2slsWithReading(read: Read): StatOutput {
  // ONE fit for the output and the reading (bug test 2026-10-28, R5 MAJOR 11: the reading refitted, 2.2 s against
  // 0.9 s at 40,000 rows).
  const r = ivFitFromRead(read);
  if ("error" in r) return { text: r.error, ok: false };
  const out = iv2slsCalcFrom(r);
  return withReading(out, () => {
    const { fit } = r;
    const d = r.p.decimals;
    const m = fit.model;
    const pTxt = (p: number): string => (p < 0.001 ? `p ${P_BELOW}` : `p = ${fmtP(p)}`);
    const effects = fit.firstStage
      .map((fs) => ({ fs, t: m.terms.find((t) => t.name === fs.endog) }))
      .filter((e): e is { fs: (typeof fit.firstStage)[number]; t: NonNullable<typeof e.t> } => !!e.t && Number.isFinite(e.t.coef));
    if (!effects.length) return undefined;
    // The same "below 10" test as the text's weak-instrument line (ivCalcs), so the two never disagree.
    const weak = fit.firstStage.filter((fs) => fs.fClassical.value < 10);
    // The overidentification test the diagnostics table shows for these SEs: Wooldridge's robust score test with
    // robust or clustered SEs (when computed), else Sargan. A rejection outranks "the instruments pass" (R5 BLOCKER 2:
    // the reading said they pass while Sargan, Basmann and Wooldridge all rejected at p < 0.001).
    const overid = (() => {
      const done = fit.diagnostics.filter((t): t is Extract<typeof t, { stat: number }> => !("skipped" in t) && /overidentification/.test(t.name));
      const pick = (r.p.se !== "classical" ? done.find((t) => t.name.startsWith("Wooldridge")) : undefined) ?? done.find((t) => t.name.startsWith("Sargan"));
      return pick ?? null;
    })();
    const overV = overid ? printedPVerdict(fmtP(overid.p)) : null;
    const overName = overid ? overid.name.replace(/ \(overidentification\)$/, "").replace(/^Wooldridge score$/, "Wooldridge score test") : "";
    const weakShort = weak.length ? `the first-stage F (${weak.map((w) => fmtFixed(w.fClassical.value, d)).join(", ")}) is also below 10` : "";
    const strength = (withWeak = true): string => {
      if (overid && overV === "clear") {
        // Both warnings when both apply (weak AND rejected); the shorter candidate below drops the weak clause.
        return (
          `The overidentification test rejects the instruments (${overName} ${pTxt(overid.p)}): at least one looks invalid, so the ${effects.length > 1 ? "estimates are" : "estimate is"} suspect` +
          (withWeak && weakShort ? `, and ${weakShort}.` : ".")
        );
      }
      if (weak.length) {
        const fsText = weak.map((w) => `${fmtFixed(w.fClassical.value, d)}${fit.firstStage.length > 1 ? ` for ${w.endog}` : ""}`).join(", ");
        return `The first-stage F (${fsText}) is below the rule-of-thumb 10, so the instruments are weak and the ${effects.length > 1 ? "estimates" : "estimate"} may be biased toward OLS.`;
      }
      const fsText = fit.firstStage.map((w) => fmtFixed(w.fClassical.value, d)).join(", ");
      if (overid && overV === "borderline") {
        return `The instruments pass the strength check (first-stage F ${fsText}), but the overidentification test (${overName} ${pTxt(overid.p)}) is ${BOUNDARY_CLAUSE}.`;
      }
      return `The instruments pass the usual strength check (first-stage F ${fsText}, above 10)${overid ? ` and the overidentification test does not reject them (${overName} ${pTxt(overid.p)})` : ""}.`;
    };
    // The one p rule (lib/pReading.ts): decided on the p as the coefficient table prints it.
    const sigWord = (p: number): string => {
      if (!Number.isFinite(p)) return "";
      const v = printedPVerdict(fmtP(p));
      return v === "clear" ? ", clearly different from zero" : v === "borderline" ? `, ${BOUNDARY_CLAUSE}` : ", not clearly different from zero";
    };
    if (effects.length === 1) {
      const { t } = effects[0];
      const ci = Number.isFinite(t.ciLo) && Number.isFinite(t.ciHi) ? `95% CI [${fmtFixed(t.ciLo, d)}; ${fmtFixed(t.ciHi, d)}], ` : "";
      const pPart = Number.isFinite(t.p) ? `${pTxt(t.p)}` : "";
      const paren = ci || pPart ? ` (${ci}${pPart})`.replace(/, \)$/, ")") : "";
      const head = `The estimated effect of a one-unit rise in ${t.name} on ${m.depName} is about ${fmtFixed(t.coef, d)}`;
      const short = `${head}${Number.isFinite(t.p) ? ` (${pTxt(t.p)})` : ""}${sigWord(t.p)}.`;
      return firstFitting([
        `${head}${paren}${sigWord(t.p)}. ${strength()}`,
        `${short} ${strength()}`,
        `${short} ${strength(false)}`,
        `${head}${sigWord(t.p)}.`,
      ]);
    }
    const list = effects.map(({ t }) => `${t.name} ${fmtFixed(t.coef, d)}${Number.isFinite(t.p) ? ` (${pTxt(t.p)})` : ""}`);
    const nSig = effects.filter(({ t }) => printedPVerdict(fmtP(t.p)) === "clear").length;
    const sigSummary =
      nSig === effects.length ? "each clearly different from zero" : nSig === 0 ? "none clearly different from zero" : "not all clearly different from zero";
    const head = `The estimated effects on ${m.depName} per one-unit rise are about`;
    return firstFitting([
      `${head} ${list.join(", ")}, ${sigSummary}. ${strength()}`,
      `${head} ${list.slice(0, 3).join(", ")}, with the rest in the table. ${strength()}`,
      `${head} ${list.slice(0, 3).join(", ")}, with the rest in the table. ${strength(false)}`,
      `The estimated effects on ${m.depName} are in the coefficient table; ${sigSummary}.`,
    ]);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// game-nash

/** game-nash with its reading: how many equilibria, and what they are, under these payoffs. */
export function gameNashWithReading(read: Read): StatOutput {
  const out = gameNashCalc(read);
  return withReading(out, () => {
    // The count line says "… found" exactly when the game is degenerate or a support pair was skipped: then the
    // list may not be complete and the reading says "found" too.
    const firstLine = out.text.split("\n", 1)[0];
    const partial = / found$/.test(firstLine);
    const eq = tableStarting(out, "Nash equilibria");
    const rows = eq ? eq.rows.slice(1) : [];
    if (!rows.length) {
      return "The search found no equilibrium among equal-size supports under these payoffs; the game is degenerate, so its equilibria lie where this search does not look.";
    }
    const pure = rows.filter((r) => r[1] === "Pure");
    const mixed = rows.filter((r) => r[1] !== "Pure");
    if (rows.length === 1) {
      const [, , rowS, colS, u1, u2] = rows[0];
      const lead = partial ? "The only equilibrium found under these payoffs" : "Under these payoffs the only equilibrium";
      if (pure.length) {
        return firstFitting([
          `${lead} is ${rowS} for the row player and ${colS} for the column player, paying ${u1} and ${u2}; from there neither player gains by switching alone.`,
          `${lead} is ${rowS} for the row player and ${colS} for the column player.`,
          `${lead} is the pure one in the table.`,
        ]);
      }
      return firstFitting([
        `${lead} is mixed: the row player mixes ${rowS} and the column player ${colS}, for expected payoffs ${u1} and ${u2}.`,
        `${lead} is mixed, with expected payoffs ${u1} and ${u2}; the probabilities are in the table.`,
        `${lead} is the mixed one in the table.`,
      ]);
    }
    const count = `${partial ? "the search found" : "there are"} ${rows.length} equilibria (${pure.length} pure, ${mixed.length} mixed)`;
    const pureList = pure.map((r) => `${r[2]} with ${r[3]}`);
    const which = pure.length ? `; the pure ones are ${pureList.length > 1 ? `${pureList.slice(0, -1).join(", ")} and ${pureList[pureList.length - 1]}` : pureList[0]}` : "";
    return firstFitting([
      `Under these payoffs ${count}, so the payoffs alone do not single out one outcome${which}.`,
      `Under these payoffs ${count}, so the payoffs alone do not single out one outcome; they are listed in the table.`,
    ]);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// macro-solow

/** macro-solow with its reading: where the economy settles, and whether it saves too little or too much. */
export function macroSolowWithReading(read: Read): StatOutput {
  const out = macroSolowCalc(read);
  return withReading(out, () => {
    const ss = tableStarting(out, "Steady state");
    const path = tableStarting(out, "Simulated path");
    const kStar = cell(ss, "k* ");
    const yStar = cell(ss, "y* ");
    const cStar = cell(ss, "c* ");
    const sGold = cell(ss, "Golden-rule saving");
    const half = cell(ss, "Half-life");
    const cGold = cell(ss, "c(gold)");
    if (!kStar || !yStar || !cStar || !sGold) return undefined;
    // Direction of travel from the path table's period-0 gap (negative: k₀ below k*).
    const gap0 = path?.rows[1]?.[4];
    const k0 = path?.rows[1]?.[1];
    // Decided on the PRINTED values (R6 #8): k₀ that prints as k* is already at the steady state, whatever rounding
    // noise the gap carries ("rises from 16.0000 toward 16.0000" came from a gap of −3.5×10⁻¹⁵).
    const atSteady = k0 !== undefined && k0 === kStar.trim();
    const dir = gap0 === undefined || k0 === undefined || atSteady ? 0 : cellSign(gap0);
    const move = dir < 0 ? `rises from ${k0} toward` : dir > 0 ? `falls from ${k0} toward` : atSteady ? "is already at" : "starts at";
    const s = readRat(String(read("s") ?? ""), "s", { percent: true });
    const a = readRat(String(read("alpha") ?? ""), "alpha", { percent: true });
    if ("error" in s || "error" in a) return undefined;
    const sv = ratToNumber(s.value);
    const av = ratToNumber(a.value);
    const gold =
      sv < av
        ? `Saving is below the golden-rule rate of ${sGold}, so saving more would raise long-run consumption${cGold ? ` (to ${cGold})` : ""}`
        : sv > av
          ? `Saving is above the golden-rule rate of ${sGold}, so saving less would raise consumption in every period`
          : `Saving is at the golden-rule rate of ${sGold}, the rate that maximises long-run consumption`;
    const first = `Under the model's assumptions, capital per effective worker ${move} a steady state of ${kStar}, where output is ${yStar} and consumption ${cStar}.`;
    return firstFitting([
      `${first} ${gold}${half && dir !== 0 ? `; half of any remaining gap closes in about ${half} periods` : ""}.`,
      `${first} ${gold}.`,
      first,
    ]);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// macro-islm

/** macro-islm with its reading: the equilibrium, and what the policy does to output, the rate and investment. */
export function macroIslmWithReading(read: Read): StatOutput {
  const out = macroIslmCalc(read);
  return withReading(out, () => {
    const eq = tableStarting(out, "IS–LM equilibrium");
    const mu = tableStarting(out, "Multipliers");
    const adas = tableStarting(out, "AD–AS");
    const Y0 = cell(eq, "Output Y", 1);
    const r0 = cell(eq, "Interest rate", 1);
    if (!Y0 || !r0) return undefined;
    const rd = (k: string): Rat | null => {
      const raw = String(read(k) ?? "");
      if (raw.trim() === "") return null;
      const v = readRat(raw, k);
      return "error" in v ? null : v.value;
    };
    const policy = ["dG", "dT", "dM"].some((k) => {
      const v = rd(k);
      return v !== null && ratSign(v) !== 0;
    });
    const vertical = (read("as") || "horizontal") === "vertical";
    // With a vertical AS the IS–LM part is the short run at the given price level; the long run is the second sentence.
    const base = `Under the model's assumptions, ${vertical ? "with prices fixed in the short run " : ""}output settles at ${Y0} with an interest rate of ${r0}%`;
    let first: string;
    if (policy) {
      const Y1 = cell(eq, "Output Y", 2);
      const dY = cell(eq, "Output Y", 3);
      const r1 = cell(eq, "Interest rate", 2);
      const dI = cell(eq, "Investment I", 3);
      if (!Y1 || !dY || !r1 || !dI) return undefined;
      const yWord = cellSign(dY) > 0 ? `raises output by ${dY} to ${Y1}` : cellSign(dY) < 0 ? `changes output by ${dY} to ${Y1}` : "leaves output unchanged";
      const rS = cellSign(cell(eq, "Interest rate", 3) ?? "0");
      const rWord = rS > 0 ? `pushes the rate up to ${r1}%` : rS < 0 ? `brings the rate down to ${r1}%` : "leaves the rate unchanged";
      const iS = cellSign(dI);
      const iWord = iS < 0 ? `, crowding out investment (it changes by ${dI})` : iS > 0 ? `, and investment rises by ${dI}` : "";
      first = `${base}; the policy ${yWord} and ${rWord}${iWord}.`;
    } else {
      const mG = cell(mu, "∂Y/∂G", 1);
      const kG = cell(mu, "∂Y/∂G", 2);
      first = mG && kG ? `${base}; each extra unit of government spending would raise output by ${mG} once crowding out is counted (${kG} without it).` : `${base}.`;
    }
    if (!vertical) return firstFitting([first]);
    // Room for the long-run sentence: the short-run one without its investment clause.
    const shortFirst = first.replace(/, (crowding out investment \(it changes by [^)]*\)|and investment rises by [^.]*)\.$/, ".");
    let second: string;
    let secondShort = "";
    if (adas) {
      const P0 = cell(adas, "Price level", 1);
      const P1 = cell(adas, "Price level", 2);
      const Yp = cell(adas, "Output Y", 1);
      // R6 #13: output RETURNS to full employment after the short-run move, and P0 is the long-run price level before
      // the policy (not the fixed short-run P), so the sentence says both.
      const pDir = P0 && P1 ? Math.sign(printedNumber(P1) - printedNumber(P0)) : 0;
      const pMove = pDir > 0 ? "rises" : pDir < 0 ? "falls" : "stays";
      second =
        policy && P0 && P1 && Yp
          ? pDir === 0
            ? `In the long run output returns to full employment (${Yp}) and the price level stays at ${P0}.`
            : `In the long run output returns to full employment (${Yp}); the price level ${pMove} from ${P0} (long run, before the policy) to ${P1}.`
          : P0 && Yp
            ? `In the long run output is at full employment (${Yp}) with a price level of ${P0}.`
            : "";
      if (policy && P0 && P1 && Yp && pDir !== 0) secondShort = `Long run: output returns to full employment (${Yp}); the price level ${pMove} from ${P0} (pre-policy) to ${P1}.`;
    } else {
      second = "No positive price level puts demand at full-employment output, so the long-run part is not shown.";
    }
    return firstFitting(
      second
        ? [`${first} ${second}`, `${shortFirst} ${second}`, ...(secondShort ? [`${shortFirst} ${secondShort}`] : []), first]
        : [first],
    );
  });
}

// ---------------------------------------------------------------------------------------------------------------
// macro-taylor

/** macro-taylor with its reading: the rate the rule prescribes, and whether that is tight or loose. */
export function macroTaylorWithReading(read: Read): StatOutput {
  const out = macroTaylorCalc(read);
  return withReading(out, () => {
    const series = String(read("series") ?? "").trim() !== "";
    if (series) {
      const t = tableStarting(out, "Taylor rule by period");
      if (!t || t.rows.length < 2) return undefined;
      const head = t.rows[0];
      const hasFloor = head.includes("Policy rate (%)");
      const col = hasFloor ? head.indexOf("Policy rate (%)") : head.indexOf("Rule rate i (%)");
      const ruleCol = head.indexOf("Rule rate i (%)");
      const data = t.rows.slice(1);
      const first = data[0];
      const last = data[data.length - 1];
      const nBound = hasFloor ? data.filter((r) => r[col] !== r[ruleCol]).length : 0;
      // Counts grouped as the text prints them (intText; R6 #14: "over 10000 periods").
      const bound = hasFloor
        ? nBound
          ? `; the lower bound binds in ${intText(nBound)} of them`
          : "; the lower bound never binds"
        : "";
      if (data.length === 1) return `As a benchmark, the rule prescribes a policy rate of ${last[col]}% in ${last[0]}${bound}.`;
      return firstFitting([
        `As a benchmark over ${intText(data.length)} periods, the rule prescribes a policy rate of ${first[col]}% in ${first[0]} and ${last[col]}% in ${last[0]}${bound}.`,
        `As a benchmark, the rule prescribes ${last[col]}% in the last period${bound}.`,
      ]);
    }
    const t = tableStarting(out, "Taylor rule terms");
    const rule = cell(t, "Rule rate i");
    const after = cell(t, "Policy rate after the lower bound");
    const real = cell(t, "Real rate i − π");
    const rnCell = cell(t, "Neutral real rate");
    if (!rule || !real || !rnCell) return undefined;
    const get = (k: string): Rat | null => {
      const v = readRat(String(read(k) ?? ""), k, { percentAsIs: true });
      return "error" in v ? null : v.value;
    };
    const rn = get("rn");
    const pi = get("pi");
    const piStar = get("piStar");
    const gap = get("gap");
    const aPi = readRat(String(read("aPi") ?? ""), "aPi", {});
    const aY = readRat(String(read("aY") ?? ""), "aY", {});
    if (!rn || !pi || !piStar || !gap || "error" in aPi || "error" in aY) return undefined;
    // The rule's rate, as the engine forms it, to set the wording (the numbers shown come from the table).
    const raw = ratAdd(ratAdd(rn, pi), ratAdd(ratMul(aPi.value, ratSub(pi, piStar)), ratMul(aY.value, gap)));
    const floorRaw = String(read("floor") ?? "").trim();
    let i = raw;
    let bound = false;
    if (floorRaw !== "") {
      const f = readRat(floorRaw, "floor", { percentAsIs: true });
      if (!("error" in f) && ratSign(ratSub(raw, f.value)) < 0) {
        i = f.value;
        bound = true;
      }
    }
    const stance = ratSign(ratSub(ratSub(i, pi), rn));
    const piS = ratSign(ratSub(pi, piStar));
    const gS = ratSign(gap);
    const piWord = piS > 0 ? "inflation above target" : piS < 0 ? "inflation below target" : "inflation on target";
    const gWord = gS > 0 ? "output above potential" : gS < 0 ? "output below potential" : "output at potential";
    const stanceWord =
      stance > 0 ? `above the neutral ${rnCell}%, so policy is tighter than neutral` : stance < 0 ? `below the neutral ${rnCell}%, so policy is looser than neutral` : `equal to the neutral ${rnCell}%, a neutral stance`;
    const rate = bound && after ? `the rule gives ${rule}%, but the lower bound sets the policy rate at ${after}%` : `the rule prescribes a policy rate of ${rule}%`;
    return firstFitting([
      `As a benchmark, ${rate}, with ${piWord} and ${gWord}. That is a real rate of ${real}%, ${stanceWord}.`,
      `As a benchmark, ${rate}; the real rate of ${real}% is ${stanceWord}.`,
    ]);
  });
}
