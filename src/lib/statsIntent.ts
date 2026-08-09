// Statistics questions pasted as PROSE, answered by the real stats engines.
//
// "Find the mean of 3, 5, 8 and 12" · "standard deviation of 2.1, 2.5, 2.2"
// · "is A: 1,2,3,4 different from B: 5,6,7,8" (Welch t-test) ·
// "correlation between x: 1,2,3,4 and y: 2,4,5,9".
//
// HONESTY RULES:
//   1. The values READ are always listed back — a comma is treated as a
//      separator (never a thousands mark), and showing the parsed list is
//      what makes that reading checkable at a glance.
//   2. Sample vs population is stated, not assumed silently: the standard
//      deviation reported is the SAMPLE one (n − 1), with the population
//      value alongside.
//   3. A statistics question with no numbers, mismatched pair lengths, or
//      too few values for the statistic is refused BY NAME.

import {
  describe, twoSampleTTest, pairedTTest, linearRegression, reportT, formatP,
} from "./stats";

export interface StatsIntentResult {
  title: string;
  /** The headline answer first, context after. */
  lines: string[];
  steps: string[];
  caveats: string[];
}

const fmt = (v: number): string => {
  if (!Number.isFinite(v)) return "n/a";
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(8)));
};

/** Standalone numbers — not digits glued to letters (x2 stays out). A number
 *  at a sentence end ("… and 12.") still counts: only a CONTINUING digit or
 *  decimal tail disqualifies, not trailing punctuation. */
function numbersIn(text: string): number[] {
  const out: number[] = [];
  const re = /(?<![\w.])-?\d+(?:\.\d+)?(?!\.?\d)(?![\w])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(Number(m[0]));
  return out;
}

/** Two labelled lists ("A: 1,2,3 … B: 4,5,6") or two lines of numbers. */
function twoGroups(text: string): { aName: string; a: number[]; bName: string; b: number[] } | null {
  const labelled = [...text.matchAll(/([A-Za-z]\w*)\s*[:=]\s*((?:-?\d+(?:\.\d+)?[,\s]+)*-?\d+(?:\.\d+)?)/g)];
  if (labelled.length >= 2) {
    const [g1, g2] = labelled;
    return {
      aName: g1[1], a: numbersIn(g1[2]),
      bName: g2[1], b: numbersIn(g2[2]),
    };
  }
  const lines = text.split("\n").map((l) => numbersIn(l)).filter((l) => l.length >= 2);
  if (lines.length >= 2) {
    return { aName: "group 1", a: lines[0], bName: "group 2", b: lines[1] };
  }
  return null;
}

/**
 * Reads a statistics question out of pasted prose. Null when the text has no
 * statistics intent at all; a NAMED refusal when it has the intent but not
 * the ingredients.
 */
export function tryStatsIntent(input: string): StatsIntentResult | null {
  const text = input.trim();
  const lower = text.toLowerCase();

  const wantsTTest =
    /\bt-?test\b/.test(lower) ||
    (/\b(different|differs?|significant\w*|compare)\b/.test(lower) &&
      /\b(groups?|samples?|from|between|vs|versus|than)\b/.test(lower));
  const wantsCorr = /\b(correlat\w*|relationship between)/.test(lower);
  const wantsPaired = /\bpaired\b/.test(lower);
  const DESCRIPTIVE: [RegExp, string][] = [
    [/\b(mean|average)\b/, "mean"],
    [/\bmedian\b/, "median"],
    [/\bmode\b/, "mode"],
    [/\b(standard deviation|std ?dev|stdev|\bsd\b)\b/, "sd"],
    [/\bvariance\b/, "variance"],
    [/\brange\b/, "range"],
  ];
  const asked = DESCRIPTIVE.filter(([re]) => re.test(lower)).map(([, k]) => k);

  if (!wantsTTest && !wantsCorr && asked.length === 0) return null;

  const refuse = (why: string): StatsIntentResult => ({
    title: "Statistics", lines: [], steps: [], caveats: [why],
  });

  if (wantsTTest || wantsCorr) {
    const g = twoGroups(text);
    if (!g) {
      return refuse(
        `This reads as a ${wantsCorr ? "correlation" : "comparison"} question, but I need TWO groups of numbers — ` +
        "label them (A: 1, 2, 3  B: 4, 5, 6) or put each group on its own line."
      );
    }
    if (wantsCorr) {
      if (g.a.length !== g.b.length) {
        return refuse(`Correlation pairs values, so the lists must be the same length — ${g.aName} has ${g.a.length}, ${g.bName} has ${g.b.length}.`);
      }
      if (g.a.length < 3) return refuse("Correlation needs at least 3 pairs to mean anything.");
      // ZERO VARIANCE is a named refusal, not n/a soup or the impossible
      // "r = 0 (r² = 1)" the engine's syy=0 convention would produce.
      const constOf = (xs: number[]): boolean => xs.every((v) => v === xs[0]);
      if (constOf(g.b)) return refuse(`${g.bName} never varies (every value is ${fmt(g.b[0])}) — correlation is undefined for a constant.`);
      if (constOf(g.a)) return refuse(`${g.aName} never varies (every value is ${fmt(g.a[0])}) — correlation is undefined for a constant.`);
      const reg = linearRegression(g.a, g.b);
      const r = Math.sign(reg.slope) * Math.sqrt(Math.max(0, reg.rSquared));
      return {
        title: `Correlation: ${g.aName} vs ${g.bName}`,
        lines: [
          `r = ${fmt(r)} (r² = ${fmt(reg.rSquared)}), ${formatP(reg.slopeP)}`,
          `Best-fit line: ${g.bName} = ${fmt(reg.slope)}·${g.aName} + ${fmt(reg.intercept)}`,
        ],
        steps: [
          `${g.aName}: ${g.a.map(fmt).join(", ")}  (n = ${g.a.length})`,
          `${g.bName}: ${g.b.map(fmt).join(", ")}`,
        ],
        caveats: ["Correlation is not causation, and r describes only the LINEAR part of the relationship. The full regression toolkit (residual and Q-Q diagnostics) lives in the Stats mode."],
      };
    }
    if (g.a.length < 2 || g.b.length < 2) {
      return refuse(`A t-test needs at least 2 values in each group — ${g.aName} has ${g.a.length}, ${g.bName} has ${g.b.length}.`);
    }
    if (wantsPaired && g.a.length !== g.b.length) {
      return refuse(`A PAIRED test pairs the measurements, so the groups must be the same length — ${g.aName} has ${g.a.length}, ${g.bName} has ${g.b.length}. For independent groups, drop the word "paired".`);
    }
    const t = wantsPaired ? pairedTTest(g.a, g.b) : twoSampleTTest(g.a, g.b);
    const da = describe(g.a), db = describe(g.b);
    return {
      title: wantsPaired ? `Paired t-test: ${g.aName} vs ${g.bName}` : `Welch t-test: ${g.aName} vs ${g.bName}`,
      lines: [
        reportT(t),
        `${g.aName}: mean ${fmt(da.mean)} (SD ${fmt(da.sd)}, n = ${da.n}) · ${g.bName}: mean ${fmt(db.mean)} (SD ${fmt(db.sd)}, n = ${db.n})`,
      ],
      steps: [
        `${g.aName}: ${g.a.map(fmt).join(", ")}`,
        `${g.bName}: ${g.b.map(fmt).join(", ")}`,
        wantsPaired
          ? "Paired test: each value in the first group is matched with the same-position value in the second."
          : "Welch's t-test (unequal variances assumed) — the default that does not require checking variance equality first.",
      ],
      caveats: ["Assumption diagnostics (normality, variance equality) and the full test family live in the Stats mode."],
    };
  }

  // Descriptive statistics — on a LIST, never on stray numbers. The first
  // cut fired on a keyword plus ANY number, and stole equations ("x − mean
  // = 4" → "mean = 4") and word problems ("the mean of 5 numbers is 12…"
  // → "mean = 9") with confident wrong answers — the exact failure this
  // module's header forbids. Two guards, both from the adversarial pass:
  //   1. Text carrying =, <, > is algebra — fall through to the solver.
  //   2. The values must be a CONTIGUOUS comma/and-separated run of ≥ 2
  //      numbers ("3, 5, 8 and 12") — prose-embedded strays never qualify.
  if (/[=<>≤≥]/.test(text)) return null;
  const NUM = String.raw`-?\d+(?:\.\d+)?`;
  const runRe = new RegExp(String.raw`(?<![\w.])${NUM}(?:(?:\s*,\s*|\s+and\s+)(?:${NUM}))+(?!\.?\d)`, "g");
  let best: string | null = null;
  for (const m of text.matchAll(runRe)) {
    if (!best || m[0].length > best.length) best = m[0];
  }
  if (!best) {
    return refuse(
      "This reads as a statistics question, but I need the values as a comma-separated list of at " +
      "least two numbers — e.g. mean of 3, 5, 8, 12. A stats question ABOUT numbers it does not " +
      "list (\"the mean of 5 numbers is 12…\") is a word problem — try the Word problem kind."
    );
  }
  const values = numbersIn(best);
  const needTwo = asked.some((k) => k === "sd" || k === "variance");
  if (needTwo && values.length < 2) {
    return refuse("The sample standard deviation and variance need at least TWO values (they divide by n − 1).");
  }
  const d = describe(values);
  // Mode, honestly: report ties, or say there is none.
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const maxCount = Math.max(...counts.values());
  const modes = [...counts.entries()].filter(([, c]) => c === maxCount).map(([v]) => v);
  const modeText = maxCount === 1
    ? "no mode (every value occurs once)"
    : modes.length === 1
      ? `${fmt(modes[0])} (×${maxCount})`
      : `multimodal: ${modes.map(fmt).join(", ")} (×${maxCount} each)`;
  const popSd = Math.sqrt(values.reduce((a, v) => a + (v - d.mean) ** 2, 0) / values.length);

  const STAT_LINES: Record<string, string> = {
    mean: `mean = ${fmt(d.mean)}`,
    median: `median = ${fmt(d.median)}`,
    mode: `mode = ${modeText}`,
    sd: `sample standard deviation = ${fmt(d.sd)} (population: ${fmt(popSd)})`,
    variance: `sample variance = ${fmt(d.variance)}`,
    range: `range = ${fmt(d.max - d.min)} (min ${fmt(d.min)}, max ${fmt(d.max)})`,
  };
  const headline = asked.map((k) => STAT_LINES[k]);
  const context = Object.entries(STAT_LINES)
    .filter(([k]) => !asked.includes(k))
    .map(([, line]) => line);

  return {
    title: `Descriptive statistics (n = ${d.n})`,
    lines: [...headline, ...context],
    steps: [
      `Values read (comma treated as a separator, never a thousands mark): ${values.map(fmt).join(", ")}`,
    ],
    caveats: values.length >= 2 && asked.includes("sd")
      ? ["Sample SD divides by n − 1; the population SD (divide by n) is shown alongside. If these values are the WHOLE population, use the population figure."]
      : [],
  };
}
