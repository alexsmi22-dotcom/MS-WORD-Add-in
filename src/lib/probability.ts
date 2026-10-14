/**
 * Probability verbs for the equation kind: named distributions with
 * P(…) queries and moments, quantiles / critical values, Bayes and
 * conditional probability, expected values of listed outcomes, the
 * classic prose problems (dice, coins, urns, birthdays), the central limit
 * theorem and confidence intervals. Markov chains live in markov.ts.
 *
 * Every number is verified by a route that shares no code with the one
 * that produced it (exact fraction vs float, cdf vs Simpson over the pdf,
 * complement identities); anything outside the grammar is refused BY NAME.
 * Every math line is Solve grammar and re-parses.
 */
import { parseExpr, evalAst, format, freeVars, Expr } from "./solve";
import { exactSimplify } from "./exact";
import { Rat, ratAdd, ratSub, ratMul, ratDiv, ratToNumber, parseRatLiteral, RAT_ONE, RAT_ZERO, ratInt, ratMake, ratSign, ratEq } from "./cas";
import { fmtRat } from "./geometry";
import { binomial as bigBinomial } from "./combinatorics";
import { tCdf } from "./power";
import type { VerbResult } from "./algebraTools";
import {
  Dist,
  DistError,
  Op,
  ParamSpec,
  QueryResult,
  binomialDist,
  poissonDist,
  geometricDist,
  negBinomialDist,
  hypergeometricDist,
  discreteUniformDist,
  normalDist,
  tDist,
  chiSquareDist,
  fDist,
  exponentialDist,
  uniformDist,
  gammaDist,
  betaDist,
  standardNormal,
  query,
  sig6,
  normalQuantile,
  ratPow,
  ratOfBig,
  ratShort,
} from "./probdist";

export type { VerbResult };

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

const DIST_WORD =
  "binomial|binom|bernoulli|poisson|normal|gaussian|standard\\s+normal|student(?:'s)?\\s+t|t\\s+dist(?:ribution)?|t(?=\\s*\\(\\s*\\d|\\s+\\d+(?:\\.\\d+)?\\s*df|\\s+df\\b|\\s+\\d+\\s+degrees)|chi-?\\s?squared?|chisq|chi2|χ2|χ²|f\\s+dist(?:ribution)?|f(?=\\s*\\(\\s*\\d|\\s+\\d+\\s*,?\\s*\\d+|\\s+df1)|exponential|uniform|geometric|hypergeometric|negative\\s+binomial|negbin|gamma|beta|discrete\\s+uniform";

/** Claims a line for the probability verbs so the pane's prose switches and the solver stand aside. */
export const PROB_VERB_RE = new RegExp(
  "^\\s*(?:(?:X|Y|Z|T)\\s*~\\s*)?(?:" +
    DIST_WORD +
    ")\\s*[(\\s]|\\bP\\s*\\(|\\bPr\\s*\\(|\\bprob\\s*\\(|^\\s*(?:quantile|inv\\s*norm|invnorm|z-?\\s?score|z\\s+for|critical\\s+value|percentile|cdf\\s+of|pmf\\s+of|pdf\\s+of|mgf\\s+of|moment\\s+generating|bayes|expected\\s+value|E\\s*\\[|clt\\b|central\\s+limit|confidence\\s+interval|probability\\s+(?:of|that)|odds\\s+(?:of|that)|birthday|roll|flip|toss|draw|a\\s+(?:fair\\s+)?(?:die|coin|bag|urn|box)|two\\s+dice|normal\\s+approximation|variance\\s+of\\s+.*equally\\s+likely|mean\\s+of\\s+(?:a\\s+)?(?:fair\\s+)?(?:die|dice|coin|binomial|poisson|normal|geometric|exponential|uniform|gamma|beta)|standard\\s+deviation\\s+of\\s+(?:a\\s+)?(?:binomial|poisson|normal|geometric|exponential|uniform|gamma|beta)|lambda\\s*=|λ\\s*=)",
  "i",
);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const refuse = (title: string, why: string, extra: string[] = []): VerbResult => ({ title, lines: [], caveats: [why, ...extra] });
const line = (text: string, math = false): { text: string; math?: boolean } => (math ? { text, math: true } : { text });

/** ≤ ≥ ≠ ¬ and friends normalised; Greek already folded by the pane (λ → lambda). */
function norm(s: string): string {
  return s
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/≠/g, "!=")
    .replace(/[−–]/g, "-")
    .replace(/¬\s*/g, "not ")
    .replace(/∩/g, " and ")
    .replace(/∪/g, " or ")
    .replace(/λ/g, "lambda")
    .replace(/μ/g, "mu")
    .replace(/σ/g, "sigma")
    .replace(/α/g, "alpha")
    .replace(/β/g, "beta")
    .replace(/θ/g, "theta")
    .replace(/χ²|χ2/g, "chi-square")
    .replace(/\s+/g, " ")
    .trim();
}

/** A number as typed: literal (exact rational kept) or a constant expression (pi/4, sqrt(2), 1.96). */
interface NumTok {
  value: number;
  text: string;
  rat: Rat | null;
}
function readNum(s: string): NumTok | null {
  const t = s.trim().replace(/^\+/, "");
  if (!t) return null;
  const r = parseRatLiteral(t);
  if (r) return { value: ratToNumber(r), text: t, rat: r };
  if (/^-?\d+(?:\.\d+)?%$/.test(t)) {
    const rr = parseRatLiteral(t.slice(0, -1));
    return rr ? { value: ratToNumber(rr) / 100, text: `${t.slice(0, -1)}/100`, rat: ratDiv(rr, ratInt(100)) } : null;
  }
  try {
    const e = parseExpr(t);
    if (freeVars(e).some((v) => v !== "pi" && v !== "e")) return null;
    const v = evalAst(e, { pi: Math.PI, e: Math.E });
    if (!Number.isFinite(v)) return null;
    return { value: v, text: t, rat: null };
  } catch {
    return null;
  }
}
const NUM = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?(?:/\\d+)?%?|pi(?:/\\d+)?|sqrt\\(\\d+\\)";
const spec = (t: NumTok | undefined): ParamSpec | undefined => (t ? { value: t.value, text: t.rat ? t.text : undefined } : undefined);
const fmtNum = (x: number): string => sig6(x);
const dec = (r: Rat | null, v: number): string => (r && ratShort(r) ? `${fmtRat(r)}${fmtRat(r).includes("/") ? ` ≈ ${fmtNum(v)}` : ""}` : `≈ ${fmtNum(v)}`);

// ---------------------------------------------------------------------------
// Distribution spec parsing
// ---------------------------------------------------------------------------

interface DistSpec {
  dist: Dist;
  /** The text after the parameters (the query). */
  rest: string;
  headline: string;
}

type Named = Record<string, NumTok>;

/** Collects `name = value` / `name value` pairs and bare numbers from a parameter string. */
function readParams(s: string): { named: Named; positional: NumTok[]; flags: Set<string> } {
  const named: Named = {};
  const positional: NumTok[] = [];
  const flags = new Set<string>();
  let t = s.trim();
  // positional "(10, 0.4)" at the start
  const par = /^\(\s*([^()]*?)\s*\)/.exec(t);
  if (par) {
    for (const piece of par[1].split(/\s*,\s*/)) {
      const eq = /^([A-Za-z][A-Za-z_]*)\s*=\s*(.+)$/.exec(piece.trim());
      if (eq) {
        const n = readNum(eq[2]);
        if (n) named[eq[1] === "N" || eq[1] === "K" ? eq[1] : eq[1].toLowerCase()] = n;
        continue;
      }
      const n = readNum(piece);
      if (n) positional.push(n);
    }
    t = t.slice(par[0].length).trim();
  }
  if (/\bfailures?\b/i.test(t)) {
    flags.add("failures");
    t = t.replace(/\bfailures?\b/gi, " ");
  }
  if (/\bscale\b/i.test(t)) flags.add("scale");
  const re = new RegExp(`\\b([A-Za-z][A-Za-z_]*(?:\\s+deviation)?)\\s*(?:=|:|\\bof\\b|\\bis\\b)?\\s*(${NUM})`, "g");
  let m: RegExpExecArray | null;
  const taken: [number, number][] = [];
  while ((m = re.exec(t))) {
    const key = m[1].toLowerCase().replace(/\s+/g, " ");
    const n = readNum(m[2]);
    if (!n) continue;
    if (["and", "with", "at", "to", "from", "on", "in", "for", "then", "where", "given", "x", "z", "p", "trials", "df"].includes(key) && key !== "p" && key !== "df" && key !== "trials") continue;
    named[m[1] === "N" ? "N" : m[1] === "K" ? "K" : key] = n;
    taken.push([m.index, m.index + m[0].length]);
  }
  // leftover bare numbers become positional
  const bare = new RegExp(`(?<![A-Za-z_])(${NUM})(?![A-Za-z_(])`, "g");
  while ((m = bare.exec(t))) {
    const at = m.index;
    if (taken.some(([a, b]) => at >= a && at < b)) continue;
    const n = readNum(m[1]);
    if (n) positional.push(n);
  }
  return { named, positional, flags };
}

const pick = (named: Named, keys: string[]): NumTok | undefined => {
  for (const k of keys) if (named[k]) return named[k];
  return undefined;
};

const QUERY_START =
  /\b(?:P\s*\(|Pr\s*\(|prob\s*\(|probability|mean|expected|expectation|variance|var\b|sd\b|standard deviation|mode|median|mgf|moment generating|pmf|pdf|cdf|quantile|percentile|at least|at most|more than|fewer than|less than|greater than|exactly|between|table|distribution table|critical)/i;

/** The distribution named at the start of the text, with its parameters read, and the rest. */
function parseDist(text: string): DistSpec | VerbResult | null {
  let t = text.replace(/^\s*(?:X|Y|Z|T)\s*~\s*/i, "").trim();
  const nameRe = new RegExp(`^\\s*(${DIST_WORD})(?:\\s+distribution)?\\s*`, "i");
  const nm = nameRe.exec(t);
  if (!nm) return null;
  const rawName = nm[1].toLowerCase().replace(/\s+/g, " ");
  t = t.slice(nm[0].length);
  if (/^=/.test(t)) return null; // "beta = 2", "gamma = 3": an equation, not a distribution
  if (/^(?:to|of the|line|vector|force|motion|curve|function|test|value|ray|ratio|mode|distribution of|approximation)\b/i.test(t)) return null;
  // Split parameters from the query: "mean 100 sd 15 P(X < 85)" — a moment
  // word followed by a number is a PARAMETER; the query starts at the first
  // keyword that is not.
  let qi = -1;
  {
    const re = new RegExp(QUERY_START.source, "gi");
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(t))) {
      const word = mm[0].toLowerCase();
      const after = t.slice(mm.index + mm[0].length);
      const paramLike = /^(?:mean|variance|var|sd|standard deviation|mode|median|rate|shape|scale)$/.test(word) && /^\s*(?:=|:|of)?\s*[-+]?(?:\d|\.\d|pi|sqrt)/.test(after);
      if (paramLike) continue;
      qi = mm.index;
      break;
    }
  }
  let paramText = qi >= 0 ? t.slice(0, qi) : t;
  const rest = qi >= 0 ? t.slice(qi).trim() : "";
  // "with"/"," noise
  paramText = paramText.replace(/\b(?:with|where|and|having|parameters?)\b/gi, " ").replace(/[;,]/g, " , ").trim();
  const { named, positional, flags } = readParams(paramText);
  {
    const KNOWN = /^(?:mean|sd|sigma|mu|variance|var|rate|lambda|shape|scale|theta|alpha|beta|df|df1|df2|d1|d2|degrees|freedom|trials|prob|probability|population|successes|draws|sample|drawn|from|to|on|min|max|lower|upper|stdev|with|and|of|pi|sqrt|e|failures?|numerator|denominator|nu|k|n|p|r|a|b|l|m|s|v|x|n|size|two-sided|two-tailed|one-sided|one-tailed|two|one|sided|tailed)$/i;
    const stray = paramText.replace(/[-+*/^()=:,]/g, " ").split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !KNOWN.test(w) && !/^[NK]$/.test(w));
    if (stray.length) return null; // "uniform motion v = 3 m/s", "normal to the curve": not a distribution
  }
  const title = `${rawName} distribution`;
  const pos = (i: number): NumTok | undefined => positional[i];
  try {
    let dist: Dist;
    if (/^binom/.test(rawName)) {
      dist = binomialDist(spec(pick(named, ["n", "trials"]) ?? pos(0))!, spec(pick(named, ["p", "prob", "probability"]) ?? pos(1))!);
    } else if (rawName === "bernoulli") {
      dist = binomialDist({ value: 1, text: "1" }, spec(pick(named, ["p", "prob"]) ?? pos(0))!);
      dist.label = `Bernoulli(p = ${dist.label.replace(/^.*p = /, "").replace(/\)$/, "")})`;
    } else if (rawName === "poisson") {
      dist = poissonDist(spec(pick(named, ["lambda", "mean", "rate", "mu", "l"]) ?? pos(0))!);
    } else if (rawName === "geometric") {
      dist = geometricDist(spec(pick(named, ["p", "prob"]) ?? pos(0))!, flags.has("failures"));
    } else if (/negative binomial|negbin/.test(rawName)) {
      dist = negBinomialDist(spec(pick(named, ["r", "successes"]) ?? pos(0))!, spec(pick(named, ["p", "prob"]) ?? pos(1))!, flags.has("failures"));
    } else if (rawName === "hypergeometric") {
      dist = hypergeometricDist(
        spec(pick(named, ["N", "population"]) ?? pos(0))!,
        spec(pick(named, ["K", "successes", "k"]) ?? pos(1))!,
        spec(pick(named, ["n", "draws", "sample", "drawn"]) ?? pos(2))!,
      );
    } else if (rawName === "discrete uniform") {
      dist = discreteUniformDist(spec(pick(named, ["a", "from", "min"]) ?? pos(0))!, spec(pick(named, ["b", "to", "max"]) ?? pos(1))!);
    } else if (/^(normal|gaussian|standard normal)$/.test(rawName)) {
      const mean = pick(named, ["mean", "mu", "m"]) ?? pos(0);
      let sd = pick(named, ["sd", "sigma", "standard deviation", "s", "stdev"]) ?? pos(1);
      let variance = pick(named, ["variance", "var"]);
      if (sd && !pick(named, ["sd", "sigma", "standard deviation", "s", "stdev"]) && /\^\s*2$/.test(sd.text)) {
        // N(100, 15^2): the textbook σ² notation
        variance = sd;
        sd = undefined;
      }
      if (!sd && variance) {
        if (!(variance.value > 0)) throw new DistError("variance must be > 0.");
        sd = { value: Math.sqrt(variance.value), text: `sqrt(${variance.text})`, rat: null };
        // an exact square root stays exact
        if (variance.rat) {
          const num = Math.sqrt(Number(variance.rat.n));
          const den = Math.sqrt(Number(variance.rat.d));
          if (Number.isInteger(num) && Number.isInteger(den)) sd = { value: num / den, text: `${num}/${den}`, rat: ratMake(BigInt(num), BigInt(den)) };
        }
      }
      dist = rawName === "standard normal" || (!mean && !sd) ? standardNormal() : normalDist(spec(mean)!, spec(sd)!);
    } else if (/^(t|student|student's t|t dist|t distribution)$/.test(rawName) || /^t\b/.test(rawName)) {
      dist = tDist(spec(pick(named, ["df", "degrees", "nu", "v"]) ?? pos(0))!);
    } else if (/chi|chisq/.test(rawName)) {
      dist = chiSquareDist(spec(pick(named, ["df", "degrees", "k", "nu"]) ?? pos(0))!);
    } else if (/^f\b/.test(rawName)) {
      dist = fDist(spec(pick(named, ["df1", "d1", "numerator"]) ?? pos(0))!, spec(pick(named, ["df2", "d2", "denominator"]) ?? pos(1))!);
    } else if (rawName === "exponential") {
      const mean = pick(named, ["mean", "scale", "theta"]);
      let rate = pick(named, ["rate", "lambda", "l"]) ?? pos(0);
      if (!rate && mean) {
        if (!(mean.value > 0)) throw new DistError("mean must be > 0.");
        rate = { value: 1 / mean.value, text: mean.rat ? fmtRat(ratDiv(RAT_ONE, mean.rat)) : `1/${mean.text}`, rat: mean.rat ? ratDiv(RAT_ONE, mean.rat) : null };
      }
      dist = exponentialDist(spec(rate)!);
    } else if (rawName === "uniform") {
      const a = pick(named, ["a", "from", "min", "lower"]) ?? pos(0);
      const b = pick(named, ["b", "to", "max", "upper"]) ?? pos(1);
      dist = uniformDist(spec(a)!, spec(b)!);
    } else if (rawName === "gamma") {
      const shape = pick(named, ["shape", "k", "alpha", "a"]) ?? pos(0);
      const scale = pick(named, ["scale", "theta"]);
      let rate = pick(named, ["rate", "beta", "lambda", "b"]) ?? (scale ? undefined : pos(1));
      if (!rate && scale) {
        if (!(scale.value > 0)) throw new DistError("scale must be > 0.");
        rate = { value: 1 / scale.value, text: scale.rat ? fmtRat(ratDiv(RAT_ONE, scale.rat)) : `1/${scale.text}`, rat: scale.rat ? ratDiv(RAT_ONE, scale.rat) : null };
      }
      dist = gammaDist(spec(shape)!, spec(rate)!);
    } else if (rawName === "beta") {
      dist = betaDist(spec(pick(named, ["alpha", "a"]) ?? pos(0))!, spec(pick(named, ["beta", "b"]) ?? pos(1))!);
    } else return null;
    if (/^=/.test(rest.trim()) || /^\s*(?:\([^)]*\))?\s*=/.test(paramText)) return null; // "t(1) = 5", "f(2) = 3": equations
    if (rawName === "exponential" && pick(named, ["mean", "scale", "theta"])) dist.notes = [];
    if (/^(normal|gaussian)$/.test(rawName) && positional.length >= 2 && !/\^\s*2$/.test(positional[1].text) && !pick(named, ["sd", "sigma", "standard deviation", "s", "stdev", "variance", "var"])) {
      dist.notes.push(`The second number was read as the SD (${positional[1].text}); for σ² write it as ${positional[1].text}^2 or say "variance".`);
    }
    return { dist, rest, headline: dist.label };
  } catch (err) {
    if (err instanceof DistError) {
      // "gamma(5)", "beta(2)": a bare name with one number and no question is
      // more likely the function than the distribution — leave it to the solver.
      if (/is required/.test(err.message) && !rest) return null;
      return refuse(title, `${err.message}`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

interface Query {
  kind: "prob";
  op: Op;
  a: NumTok;
  b?: NumTok;
  /** The query as the user wrote it, for the label. */
  label: string;
}
type Ask = Query | { kind: "moment"; what: string[] } | { kind: "table" } | { kind: "cdfAt"; at: NumTok } | { kind: "quantile"; p: NumTok } | { kind: "mgf" };

function parseQuery(rest: string, discrete: boolean): Ask | string | null {
  const r = rest.trim();
  if (!r) return null;
  const n = `(${NUM})`;
  let m: RegExpExecArray | null;
  // P(a < X < b), P(a <= X <= b)
  if ((m = new RegExp(`^(?:P|Pr|prob)\\s*\\(\\s*${n}\\s*(<=|<)\\s*[A-Za-z]\\s*(<=|<)\\s*${n}\\s*\\)`, "i").exec(r))) {
    const a = readNum(m[1])!;
    const b = readNum(m[4])!;
    const incl = m[2] === "<=" || m[3] === "<=";
    return { kind: "prob", op: discrete ? (incl ? "betweenIncl" : "between") : "between", a, b, label: m[0] };
  }
  // P(X op k), P(op k)
  if ((m = new RegExp(`^(?:P|Pr|prob)\\s*\\(\\s*(?:[A-Za-z]\\s*)?(<=|>=|<|>|==|=)\\s*${n}\\s*\\)`, "i").exec(r))) {
    const op = (m[1] === "==" ? "=" : m[1]) as Op;
    return { kind: "prob", op, a: readNum(m[2])!, label: m[0] };
  }
  // P(k op X) reversed
  if ((m = new RegExp(`^(?:P|Pr|prob)\\s*\\(\\s*${n}\\s*(<=|>=|<|>|=)\\s*[A-Za-z]\\s*\\)`, "i").exec(r))) {
    const flip: Record<string, Op> = { "<": ">", "<=": ">=", ">": "<", ">=": "<=", "=": "=" };
    return { kind: "prob", op: flip[m[2]], a: readNum(m[1])!, label: m[0] };
  }
  // words
  if ((m = new RegExp(`^(?:probability\\s+(?:of|that)\\s+)?(?:X\\s+(?:is\\s+)?)?(at least|at most|more than|greater than|fewer than|less than|exactly|no more than|no fewer than)\\s+${n}`, "i").exec(r))) {
    const w = m[1].toLowerCase();
    const op: Op = w === "at least" || w === "no fewer than" ? ">=" : w === "at most" || w === "no more than" ? "<=" : w === "more than" || w === "greater than" ? ">" : w === "exactly" ? "=" : "<";
    return { kind: "prob", op, a: readNum(m[2])!, label: m[0] };
  }
  if ((m = new RegExp(`^(?:probability\\s+(?:of|that)\\s+)?(?:X\\s+(?:is\\s+)?)?between\\s+${n}\\s+and\\s+${n}(\\s+inclusive)?`, "i").exec(r))) {
    return { kind: "prob", op: discrete ? "betweenIncl" : "between", a: readNum(m[1])!, b: readNum(m[2])!, label: m[0] + (discrete && !m[3] ? " (inclusive)" : "") };
  }
  if (/^(?:pmf|pdf|table|distribution table)\b/i.test(r)) return { kind: "table" };
  if ((m = new RegExp(`^(?:cdf|F)\\s*(?:at|\\()\\s*${n}`, "i").exec(r))) return { kind: "cdfAt", at: readNum(m[1])! };
  if ((m = new RegExp(`^(?:quantile|percentile)\\s*(?:at|of|for|p\\s*=)?\\s*${n}`, "i").exec(r))) return { kind: "quantile", p: readNum(m[1])! };
  if ((m = new RegExp(`^${n}\\s*(?:quantile|percentile)`, "i").exec(r))) return { kind: "quantile", p: readNum(m[1])! };
  if (/^(?:mgf|moment generating)/i.test(r)) return { kind: "mgf" };
  const moments: string[] = [];
  for (const [re, name] of [
    [/\b(?:mean|expected value|expectation)\b/i, "mean"],
    [/\bvariance\b|\bvar\b/i, "variance"],
    [/\b(?:sd|standard deviation)\b/i, "sd"],
    [/\bmode\b/i, "mode"],
    [/\bmedian\b/i, "median"],
  ] as [RegExp, string][]) {
    if (re.test(r)) moments.push(name);
  }
  if (moments.length) return { kind: "moment", what: moments };
  return `the question "${r}" is not one this reads (P(X ≤ k), P(a < X < b), at least/at most k, mean, variance, sd, mode, median, mgf, pmf, cdf at k, quantile p).`;
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A pmf bar chart with the event's bars filled. */
export function pmfBarsSvg(d: Dist, region: { lo: number; hi: number } | null, caption: string): string {
  let lo = d.lo;
  let hi = d.hi;
  if (!Number.isFinite(hi) || hi - lo > 60) {
    const sd = Math.sqrt(Math.max(d.variance, 0));
    lo = Math.max(d.lo, Math.floor(d.mean - 4 * sd));
    hi = Math.min(Number.isFinite(d.hi) ? d.hi : Infinity, Math.ceil(d.mean + 4 * sd));
    if (hi - lo > 60) hi = lo + 60;
  }
  const ks: number[] = [];
  for (let k = lo; k <= hi; k++) ks.push(k);
  const ps = ks.map((k) => d.pmf!(k));
  const pmax = Math.max(...ps, 1e-12);
  const W = 460;
  const H = 260;
  const left = 60;
  const bottom = 34;
  const top = 28;
  const plotW = W - left - 16;
  const plotH = H - top - bottom;
  const bw = plotW / ks.length;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, Arial, sans-serif" font-size="11">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  parts.push(`<text x="${W / 2}" y="16" text-anchor="middle" font-size="12" fill="#1A1A1A">${esc(caption)}</text>`);
  parts.push(`<line x1="${left}" y1="${top + plotH}" x2="${left + plotW}" y2="${top + plotH}" stroke="#1A1A1A"/>`);
  parts.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotH}" stroke="#1A1A1A"/>`);
  for (let i = 0; i <= 4; i++) {
    const y = top + plotH - (i / 4) * plotH;
    parts.push(`<text x="${left - 4}" y="${y + 4}" text-anchor="end" fill="#7B8C99">${(pmax * (i / 4)).toPrecision(2)}</text>`);
  }
  ks.forEach((k, i) => {
    const h = (ps[i] / pmax) * plotH;
    const x = left + i * bw + bw * 0.12;
    const inEvent = region && k >= region.lo && k <= region.hi;
    parts.push(`<rect x="${x.toFixed(1)}" y="${(top + plotH - h).toFixed(1)}" width="${(bw * 0.76).toFixed(1)}" height="${h.toFixed(1)}" fill="${inEvent ? "#0C4A6E" : "#9DB3C4"}"/>`);
    const every = Math.max(1, Math.ceil(ks.length / 16));
    if (i % every === 0) parts.push(`<text x="${(x + bw * 0.38).toFixed(1)}" y="${top + plotH + 14}" text-anchor="middle" fill="#1A1A1A">${k}</text>`);
  });
  parts.push(`<text x="${left + plotW / 2}" y="${H - 6}" text-anchor="middle" fill="#7B8C99">k</text>`);
  parts.push(`<text x="11" y="${top + plotH / 2}" text-anchor="middle" fill="#7B8C99" transform="rotate(-90 11 ${top + plotH / 2})">P(X = k)</text>`);
  parts.push("</svg>");
  return parts.join("");
}

/** The pdf in Solve grammar (for the pane's plotter) and a sensible window. */
function pdfExpr(d: Dist): { expr: string; window: { lo: number; hi: number } } | null {
  const p = d.name;
  const c = (x: number): string => (Number.isFinite(x) ? String(Number(x.toPrecision(12))) : "0");
  const sd = Math.sqrt(Math.max(d.variance, 0)) || 1;
  switch (p) {
    case "normal": {
      const mu = d.mean;
      return { expr: `exp(-(x - ${c(mu)})^2/(2*${c(sd)}^2))/(${c(sd)}*sqrt(2*pi))`, window: { lo: mu - 4 * sd, hi: mu + 4 * sd } };
    }
    case "t": {
      const df = Number(d.label.replace(/.*df = /, "").replace(/\)$/, ""));
      const k = d.pdf!(0);
      return { expr: `${c(k)}*(1 + x^2/${c(df)})^(-(${c(df)} + 1)/2)`, window: { lo: -5, hi: 5 } };
    }
    case "chisq": {
      const df = Number(d.label.replace(/.*df = /, "").replace(/\)$/, ""));
      const K = d.pdf!(1) / Math.exp(-0.5);
      return { expr: `${c(K)}*x^(${c(df / 2 - 1)})*exp(-x/2)`, window: { lo: 0, hi: Math.max(df + 4 * Math.sqrt(2 * df), 2) } };
    }
    case "f": {
      const [d1, d2] = d.label.replace(/.*df1 = /, "").replace(/\)$/, "").split(", df2 = ").map(Number);
      const K = d.pdf!(1) / Math.pow(1 + d1 / d2, -(d1 + d2) / 2);
      return { expr: `${c(K)}*x^(${c(d1 / 2 - 1)})*(1 + ${c(d1 / d2)}*x)^(-${c((d1 + d2) / 2)})`, window: { lo: 0, hi: Number.isFinite(d.mean) ? Math.max(5, d.mean * 3) : 5 } };
    }
    case "exponential": {
      const lam = 1 / d.mean;
      return { expr: `${c(lam)}*exp(-${c(lam)}*x)`, window: { lo: 0, hi: 6 / lam } };
    }
    case "uniform":
      return { expr: `${c(1 / (d.hi - d.lo))}`, window: { lo: d.lo, hi: d.hi } };
    case "gamma": {
      const k = (d.mean * d.mean) / d.variance;
      const beta = d.mean / d.variance;
      const K = d.pdf!(1) / Math.exp(-beta);
      return { expr: `${c(K)}*x^(${c(k - 1)})*exp(-${c(beta)}*x)`, window: { lo: 0, hi: d.mean + 5 * Math.sqrt(d.variance) } };
    }
    case "beta": {
      const m = d.mean;
      const v = d.variance;
      const common = (m * (1 - m)) / v - 1;
      const a = m * common;
      const b = (1 - m) * common;
      const K = d.pdf!(0.5) / Math.pow(0.5, a + b - 2);
      return { expr: `${c(K)}*x^(${c(a - 1)})*(1 - x)^(${c(b - 1)})`, window: { lo: 0, hi: 1 } };
    }
    default:
      return null;
  }
}

function plotFor(d: Dist, region: { lo: number; hi: number } | null, title: string): VerbResult["plot"] | undefined {
  const pe = pdfExpr(d);
  if (!pe) return undefined;
  const shade = region ? { lo: Math.max(region.lo, pe.window.lo), hi: Math.min(region.hi, pe.window.hi) } : undefined;
  return { exprs: [{ expr: pe.expr, label: `pdf of ${d.label}` }], variable: "x", window: pe.window, title, shadeBetween: shade && shade.hi > shade.lo ? shade : undefined };
}

// ---------------------------------------------------------------------------
// Distribution verb
// ---------------------------------------------------------------------------

const OP_TEXT: Record<Op, string> = { "=": "=", "<": "<", "<=": "≤", ">": ">", ">=": "≥", between: "<", betweenIncl: "≤" };

function probLabel(q: Query, varName: string): string {
  if (q.op === "between" || q.op === "betweenIncl") return `P(${q.a.text} ${OP_TEXT[q.op]} ${varName} ${OP_TEXT[q.op]} ${q.b!.text})`;
  return `P(${varName} ${OP_TEXT[q.op]} ${q.a.text})`;
}

function momentLines(d: Dist, what: string[]): { lines: VerbResult["lines"]; caveats: string[] } {
  const lines: VerbResult["lines"] = [];
  const caveats: string[] = [];
  const show = (label: string, exact: Rat | string | undefined, v: number, mathOk = true): void => {
    if (typeof exact === "string") {
      const isMath = mathOk && /^[-\d/().a-z^* ]+$/i.test(exact) && !/undefined|infinite|every|and/.test(exact);
      lines.push(line(`${label} = ${exact}${isMath && /[a-z/]/i.test(exact) && Number.isFinite(v) ? `  ≈ ${fmtNum(v)}` : ""}`));
      if (isMath) lines.push(line(exact, true));
      return;
    }
    if (exact && ratShort(exact)) {
      const f = fmtRat(exact);
      lines.push(line(`${label} = ${f}${f.includes("/") ? `  ≈ ${fmtNum(v)}` : ""}`));
      lines.push(line(f, true));
    } else if (Number.isFinite(v)) {
      lines.push(line(`${label} ≈ ${fmtNum(v)}`));
      lines.push(line(fmtNum(v), true));
    } else lines.push(line(`${label}: undefined`));
  };
  for (const w of what) {
    if (w === "mean") show("mean E[X]", d.meanExact, d.mean);
    if (w === "variance") show("variance Var(X)", d.varExact, d.variance);
    if (w === "sd") {
      const vr = typeof d.varExact === "object" ? d.varExact : null;
      let exact: string | undefined;
      if (vr && ratSign(vr) > 0) {
        const n = Math.sqrt(Number(vr.n));
        const dd = Math.sqrt(Number(vr.d));
        if (Number.isInteger(n) && Number.isInteger(dd)) exact = fmtRat(ratMake(BigInt(n), BigInt(dd)));
        else exact = `sqrt(${fmtRat(vr)})`;
      }
      const sdv = Math.sqrt(d.variance);
      if (exact) {
        lines.push(line(`sd σ = ${exact}${/sqrt|\//.test(exact) ? `  ≈ ${fmtNum(sdv)}` : ""}`));
        lines.push(line(exact, true));
      } else if (Number.isFinite(sdv)) {
        lines.push(line(`sd σ ≈ ${fmtNum(sdv)}`));
        lines.push(line(fmtNum(sdv), true));
      } else lines.push(line("sd: undefined"));
    }
    if (w === "mode") lines.push(line(`mode = ${d.mode ?? "(not tabulated here)"}`));
    if (w === "median") {
      if (d.medianExact !== undefined) {
        lines.push(line(`median = ${d.medianExact}${d.median !== undefined && !/^-?\d+$/.test(d.medianExact) ? `  ≈ ${fmtNum(d.median)}` : ""}`));
        if (/^[-\d/().a-z^* ]+$/i.test(d.medianExact)) lines.push(line(d.medianExact, true));
      } else {
        const med = d.quantile(0.5);
        lines.push(line(d.discrete ? `median = ${med} (the smallest k with F(k) ≥ 1/2)` : `median ≈ ${fmtNum(med)}`));
        lines.push(line(d.discrete ? String(med) : fmtNum(med), true));
      }
    }
  }
  caveats.push(`Population moments of ${d.label}${d.discrete ? " (the distribution's own, not a sample's)" : ""}.`);
  return { lines, caveats };
}

function binomialFormula(d: Dist, k: number): { text: string; math: string } | null {
  const m = /binomial\(n = (\d+), p = ([^)]+)\)/.exec(d.label);
  if (!m) return null;
  const n = Number(m[1]);
  const p = m[2];
  const q = parseRatLiteral(p) ? fmtRat(ratSub(RAT_ONE, parseRatLiteral(p)!)) : `(1 - ${p})`;
  const C = bigBinomial(n, k).toString();
  return { text: `P(X = ${k}) = C(${n}, ${k})·p^${k}·(1 − p)^${n - k} with C(${n}, ${k}) = ${C}`, math: `${C}*(${p})^${k}*(${q})^${n - k}` };
}

function distVerb(text: string): VerbResult | null {
  if (/^(?:P|Pr)\s*\(\s*(?:[-+]?[\d.]+\s*<=?\s*)?Z\b/i.test(text)) text = `standard normal ${text}`;
  // "P(X = 3) for binomial n = 10, p = 0.4": the question first
  {
    const qf = /^((?:P|Pr)\s*\([^()]*\))\s*(?:for|of|with|where|,|given|under|if)\s+(?:a\s+|the\s+)?(?:X\s*~\s*)?(.+)$/i.exec(text);
    if (qf && !/\|/.test(qf[1])) text = `${qf[2].replace(/\s*,\s*/g, " ")} ${qf[1]}`;
  }
  let lambdaNote: string | null = null;
  if (/^lambda\s*=\s*[\d.]+\s*,?\s*(?:P|Pr)\s*\(/i.test(text)) {
    text = `poisson ${text.replace(/,\s*(?=(?:P|Pr)\s*\()/, " ")}`;
    lambdaNote = "λ with a count question read as a POISSON rate (say \"exponential rate λ\" for a waiting time).";
  }
  const ds = parseDist(text);
  if (ds === null) return null;
  if ("lines" in ds) return ds;
  const { dist: d, rest } = ds;
  const title = d.label;
  const varName = d.name === "normal" && d.mean === 0 && d.variance === 1 ? "Z" : d.name === "t" ? "T" : "X";
  const ask = parseQuery(rest, d.discrete);
  if (lambdaNote) d.notes.push(lambdaNote);
  if (ask === null) {
    // No question: summarise.
    const mm = momentLines(d, ["mean", "variance", "sd"]);
    const lines: VerbResult["lines"] = [line(`${d.label}: support ${d.discrete ? `k = ${d.lo}${Number.isFinite(d.hi) ? `..${d.hi}` : ", " + (d.lo + 1) + ", …"}` : `${Number.isFinite(d.lo) ? d.lo : "−∞"} < x < ${Number.isFinite(d.hi) ? d.hi : "∞"}`}`), ...mm.lines];
    return { title, lines, caveats: [...d.notes, ...mm.caveats, "Ask P(X ≤ k), P(a < X < b), at least k, mean/variance/sd/mode/median, mgf, pmf, cdf at k or quantile p."], svg: d.discrete ? pmfBarsSvg(d, null, `pmf of ${d.label}`) : undefined, alt: `pmf of ${d.label}`, plot: d.discrete ? undefined : plotFor(d, null, `pdf of ${d.label}`) };
  }
  if (typeof ask === "string") return refuse(title, ask);
  // Several P(…) questions on one line: answer each, in order (the second
  // was once silently dropped).
  {
    const parts = rest.split(/\s*(?:\band\b|\bor\b|,|;)?\s*(?=(?:P|Pr|prob)\s*\()/i).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => /^(?:P|Pr|prob)\s*\(/i.test(p))) {
      const results = parts.map((p) => distVerb(`${text.slice(0, text.length - rest.length)} ${p}`));
      if (results.every((r): r is VerbResult => !!r)) {
        const first = results[0];
        return {
          title,
          lines: results.flatMap((r, i) => (i ? [line("—")] : []).concat(r.lines)),
          caveats: [...new Set(results.flatMap((r) => r.caveats))],
          svg: first.svg,
          alt: first.alt,
          plot: first.plot,
        };
      }
    }
  }
  try {
    if (ask.kind === "prob") {
      const q = query(d, ask.op, ask.a.value, ask.b?.value);
      const lab = probLabel(ask, varName);
      const lines: VerbResult["lines"] = [];
      const caveats: string[] = [...d.notes];
      if (q.exact && ratShort(q.exact)) {
        const f = fmtRat(q.exact);
        lines.push(line(`${lab} = ${f}${f.includes("/") ? `  ≈ ${fmtNum(q.value)}` : ""}`));
        lines.push(line(f, true));
      } else {
        lines.push(line(`${lab} ≈ ${fmtNum(q.value)}`));
        lines.push(line(fmtNum(q.value), true));
        if (q.exact) caveats.push("The exact fraction is too long to show; the decimal is correctly rounded from it.");
      }
      if (d.name === "binomial" && ask.op === "=" && Number.isInteger(ask.a.value)) {
        const f = binomialFormula(d, ask.a.value);
        if (f) {
          lines.push(line(f.text));
          lines.push(line(f.math, true));
        }
      }
      if (d.name === "poisson" && ask.op === "=" && Number.isInteger(ask.a.value) && ask.a.value >= 0) {
        const lam = d.label.replace(/.*λ = /, "").replace(/\)$/, "");
        const k = ask.a.value;
        lines.push(line(`P(X = ${k}) = e^(−λ) λ^k / k!`));
        lines.push(line(`exp(-${/^[\d/]+$/.test(lam) ? lam : `(${lam})`})*${/^[\d/]+$/.test(lam) ? `(${lam})` : `(${lam})`}^${k}/${factorialText(k)}`, true));
      }
      if (d.name === "normal") {
        const mu = d.mean;
        const sd = Math.sqrt(d.variance);
        const zOf = (x: number): string => fmtNum((x - mu) / sd);
        if (ask.op === "between" || ask.op === "betweenIncl") lines.push(line(`z = (${ask.a.text} − ${fmtNum(mu)})/${fmtNum(sd)} = ${zOf(ask.a.value)} and z = ${zOf(ask.b!.value)};  P = Φ(${zOf(ask.b!.value)}) − Φ(${zOf(ask.a.value)})`));
        else if (!(mu === 0 && sd === 1)) lines.push(line(`z = (${ask.a.text} − ${fmtNum(mu)})/${fmtNum(sd)} = ${zOf(ask.a.value)};  P = ${ask.op === "<" || ask.op === "<=" ? `Φ(${zOf(ask.a.value)})` : `1 − Φ(${zOf(ask.a.value)})`}`));
        else lines.push(line(`P = ${ask.op === "<" || ask.op === "<=" ? `Φ(${ask.a.text})` : `1 − Φ(${ask.a.text})`}`));
      }
      lines.push(line(`Computed as ${q.how}`));
      caveats.push(`Verified: ${q.check}`);
      if (d.discrete && (ask.op === "<" || ask.op === ">" || ask.op === "between")) caveats.push("Strict inequality on an integer-valued X: the endpoint is excluded, as written.");
      const regionTxt = `${lab}`;
      return {
        title,
        lines,
        caveats,
        svg: d.discrete ? pmfBarsSvg(d, q.region, `${d.label}: ${regionTxt} shaded`) : undefined,
        alt: `${d.label}: ${regionTxt} ${d.discrete ? "bars" : "tail"} highlighted.`,
        plot: d.discrete ? undefined : plotFor(d, q.region, `${d.label}: ${regionTxt} shaded`),
      };
    }
    if (ask.kind === "moment") {
      const mm = momentLines(d, ask.what);
      return { title, lines: mm.lines, caveats: [...d.notes, ...mm.caveats] };
    }
    if (ask.kind === "mgf") {
      if (!d.mgf) return refuse(title, `${d.label} has no moment generating function in closed form here${d.notes.length ? ` (${d.notes[0]})` : ""}.`);
      return { title, lines: [line(`M(t) = E[e^(tX)] = ${d.mgf.expr}, for ${d.mgf.where}`), line(d.mgf.expr, true)], caveats: [...d.notes, "Differentiate at t = 0 for the moments: M'(0) = E[X], M''(0) = E[X²]."] };
    }
    if (ask.kind === "cdfAt") {
      const q = query(d, "<=", ask.at.value);
      const f = q.exact && ratShort(q.exact) ? fmtRat(q.exact) : null;
      return {
        title,
        lines: [line(`F(${ask.at.text}) = P(${varName} ≤ ${ask.at.text}) ${f ? `= ${f}${f.includes("/") ? `  ≈ ${fmtNum(q.value)}` : ""}` : `≈ ${fmtNum(q.value)}`}`), line(f ?? fmtNum(q.value), true)],
        caveats: [...d.notes, `Verified: ${q.check}`],
        svg: d.discrete ? pmfBarsSvg(d, q.region, `${d.label}: F(${ask.at.text})`) : undefined,
        plot: d.discrete ? undefined : plotFor(d, q.region, `${d.label}: F(${ask.at.text}) shaded`),
      };
    }
    if (ask.kind === "quantile") {
      return quantileResult(d, ask.p, title, varName);
    }
    if (ask.kind === "table") {
      if (!d.discrete) {
        return { title, lines: [line(`pdf of ${d.label} drawn; the density has no table (P(X = x) = 0 for every x).`)], caveats: d.notes, plot: plotFor(d, null, `pdf of ${d.label}`) };
      }
      const lo = d.lo;
      const hi = Number.isFinite(d.hi) ? d.hi : d.quantile(0.9999);
      if (hi - lo > 60) return refuse(title, `The support has ${hi - lo + 1} points; a table is shown for up to 61 (ask P(X ≤ k) instead).`);
      const lines: VerbResult["lines"] = [];
      let total = RAT_ZERO;
      let totalF = 0;
      for (let k = lo; k <= hi; k++) {
        const e = d.pmfExact ? d.pmfExact(k) : null;
        const v = d.pmf!(k);
        totalF += v;
        if (e) total = ratAdd(total, e);
        lines.push(line(`P(X = ${k}) ${e && ratShort(e) ? `= ${fmtRat(e)}${fmtRat(e).includes("/") ? `  ≈ ${fmtNum(v)}` : ""}` : `≈ ${fmtNum(v)}`}`));
      }
      const caveats = [...d.notes];
      if (d.pmfExact && Number.isFinite(d.hi)) caveats.push(ratEq(total, RAT_ONE) ? "Verified: the probabilities sum to exactly 1." : `Cross-check FAILED: the probabilities sum to ${fmtRat(total)}, not 1.`);
      else caveats.push(`The listed probabilities sum to ${fmtNum(totalF)}${Number.isFinite(d.hi) ? "" : " (the support continues beyond the table)"}.`);
      return { title, lines, caveats, svg: pmfBarsSvg(d, null, `pmf of ${d.label}`), alt: `pmf of ${d.label}` };
    }
  } catch (err) {
    if (err instanceof DistError) return refuse(title, err.message);
    throw err;
  }
  return null;
}

function factorialText(k: number): string {
  if (k <= 1) return "1";
  let f = 1n;
  for (let i = 2; i <= k; i++) f *= BigInt(i);
  return f.toString();
}

function quantileResult(d: Dist, p: NumTok, title: string, varName: string): VerbResult {
  if (!(p.value > 0 && p.value < 1)) return refuse(title, `The probability must be strictly between 0 and 1 (got ${p.text}).`);
  const x = d.quantile(p.value);
  const lines: VerbResult["lines"] = [];
  const caveats: string[] = [...d.notes];
  const exact = d.quantileExact && p.rat ? d.quantileExact(p.rat) : null;
  if (d.discrete) {
    lines.push(line(`${p.text}-quantile: the smallest k with P(${varName} ≤ k) ≥ ${p.text} is k = ${x}`));
    lines.push(line(String(x), true));
    const below = x - 1 >= d.lo ? d.cdf(x - 1) : 0;
    caveats.push(`Verified: F(${x - 1}) = ${fmtNum(below)} < ${p.text} ≤ F(${x}) = ${fmtNum(d.cdf(x))}.`);
  } else {
    lines.push(line(`${p.text}-quantile x with P(${varName} ≤ x) = ${p.text}: ${exact ? `x = ${exact}  ≈ ${fmtNum(x)}` : `x ≈ ${fmtNum(x)}`}`));
    lines.push(line(exact ?? fmtNum(x), true));
    const back = d.cdf(x);
    caveats.push(`Verified: F(${fmtNum(x)}) = ${back.toPrecision(10)} (target ${p.text}); the quantile is ${d.name === "normal" ? "the normal inverse polished by Newton's method (≈ 1e-15)" : exact ? "exact (closed form)" : "found by bisection to 1e-9"}.`);
  }
  return { title, lines, caveats, svg: d.discrete ? pmfBarsSvg(d, { lo: d.lo, hi: x }, `${d.label}: lower ${p.text} shaded`) : undefined, plot: d.discrete ? undefined : plotFor(d, { lo: -Infinity, hi: x }, `${d.label}: the ${p.text}-quantile (lower ${p.text} shaded)`) };
}

// ---------------------------------------------------------------------------
// Standalone quantile / z-score / critical value / cdf verbs
// ---------------------------------------------------------------------------

function quantileVerb(text: string): VerbResult | null {
  const n = `(${NUM})`;
  let m: RegExpExecArray | null;
  // z-score for p / invNorm(p) / quantile normal p / z 0.975
  if ((m = new RegExp(`^(?:z-?\\s?score\\s+(?:for|of|at)?|z\\s+for|inv\\s*norm\\s*\\(?|invnorm\\s*\\(?|quantile\\s+(?:of\\s+)?(?:the\\s+)?(?:standard\\s+)?normal\\s+(?:at|for|of|p\\s*=)?|(?:standard\\s+)?normal\\s+quantile\\s+(?:at|for|of|p\\s*=)?)\\s*${n}\\s*\\)?\\s*$`, "i").exec(text))) {
    const p = readNum(m[1])!;
    return quantileResult(standardNormal(), p, "standard normal quantile", "Z");
  }
  // quantile <dist spec> p   /  critical value <dist spec> alpha
  if ((m = new RegExp(`^z\\s+${n}\\s*$`, "i").exec(text))) {
    return quantileResult(standardNormal(), readNum(m[1])!, "standard normal quantile", "Z");
  }
  if ((m = /^(quantile|percentile|critical\s+value)\s+(?:of\s+)?(?:the\s+)?(.+?)\s+(?:at|for|of|p\s*=|alpha\s*=?|α\s*=?|level)?\s*((?:[-+]?(?:\d+\.?\d*|\.\d+)(?:\/\d+)?%?))\s*$/i.exec(text))) {
    const kind = m[1].toLowerCase();
    const p = readNum(m[3])!;
    // "quantile t 12 0.975": a bare t with a number is the df here
    const stripped = m[2].replace(/\b(?:two[- ]?(?:sided|tailed)|one[- ]?(?:sided|tailed))\b/gi, " ").trim();
    const distText = /^t\s+\d+(?:\.\d+)?$/i.test(stripped) ? `${stripped} df` : stripped;
    const ds = parseDist(distText);
    if (ds === null || "lines" in ds) return ds === null ? null : ds;
    const d = ds.dist;
    if (kind.startsWith("critical")) {
      // upper-tail critical value: P(X > c) = α (two-sided for symmetric when "two-sided"/"two-tailed")
      const two = /two[- ]?(?:sided|tailed)/i.test(text);
      const alpha = p.value;
      if (!(alpha > 0 && alpha < 1)) return refuse(d.label, "α must be strictly between 0 and 1.");
      const target = two ? 1 - alpha / 2 : 1 - alpha;
      const c = d.quantile(target);
      const back = 1 - d.cdf(c);
      return {
        title: `critical value of ${d.label}`,
        lines: [line(`${two ? "two-sided " : ""}critical value at α = ${p.text}: ${two ? `P(|${d.name === "t" ? "T" : "X"}| > c) = ${p.text}` : `P(${d.name === "t" ? "T" : "X"} > c) = ${p.text}`} at c ≈ ${fmtNum(c)}`), line(fmtNum(c), true)],
        caveats: [...d.notes, `Verified: P(X > ${fmtNum(c)}) = ${back.toPrecision(8)}${two ? ` (= α/2 = ${alpha / 2})` : ""}; found by ${d.name === "normal" ? "the polished normal inverse" : "bisection to 1e-9"}.`],
        plot: d.discrete ? undefined : plotFor(d, { lo: c, hi: Infinity }, `${d.label}: upper tail α = ${p.text}`),
      };
    }
    return quantileResult(d, p, `${d.label} quantile`, d.name === "t" ? "T" : "X");
  }
  // cdf of normal at z / normalcdf(z) / Phi(z)
  if ((m = new RegExp(`^(?:cdf\\s+of\\s+(?:the\\s+)?(?:standard\\s+)?normal\\s+(?:at|of)?|normal\\s*cdf\\s*\\(?|Phi\\s*\\(|Φ\\s*\\()\\s*${n}\\s*\\)?\\s*$`, "i").exec(text))) {
    const z = readNum(m[1])!;
    const d = standardNormal();
    const q = query(d, "<=", z.value);
    return { title: "standard normal cdf", lines: [line(`Φ(${z.text}) = P(Z ≤ ${z.text}) ≈ ${fmtNum(q.value)}`), line(fmtNum(q.value), true)], caveats: [`Verified: ${q.check}`], plot: plotFor(d, q.region, `Φ(${z.text}) shaded`) };
  }
  // cdf of <dist> at x
  if ((m = /^cdf\s+of\s+(?:the\s+)?(.+?)\s+at\s+(.+)$/i.exec(text))) {
    const ds = parseDist(`${m[1]} cdf at ${m[2]}`);
    if (ds && !("lines" in ds)) return distVerb(`${m[1]} cdf at ${m[2]}`);
  }
  // pmf/pdf/mgf of <dist>
  if ((m = /^(pmf|pdf|mgf|moment generating function)\s+of\s+(?:the\s+|a\s+)?(.+)$/i.exec(text))) {
    const what = m[1].toLowerCase().startsWith("m") ? "mgf" : "table";
    return distVerb(`${m[2]} ${what}`);
  }
  // mean / sd of <dist>
  if ((m = /^(mean|expected value|variance|standard deviation|sd|mode|median)\s+of\s+(?:a\s+|the\s+)?(.+)$/i.exec(text))) {
    const ds = parseDist(m[2]);
    if (ds && !("lines" in ds)) return distVerb(`${m[2]} ${m[1]}`);
    if (ds && "lines" in ds) return ds;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bayes / conditional probability
// ---------------------------------------------------------------------------

interface Given {
  key: string; // canonical "A", "B|A", "B|!A", "A&B"
  value: NumTok;
}

function canonEvent(s: string): string {
  let t = s.trim().replace(/\s+/g, " ");
  t = t.replace(/^not\s+/i, "!").replace(/\^c$|'$|ᶜ$/i, "!").replace(/^(\w+)!$/, "!$1");
  return t;
}
function parseEventExpr(s: string): string {
  // "A and B", "A ∩ B", "A & B" → "A&B" (sorted); "B|A" → "B|A"; "B given A" → "B|A"
  const t = s.trim();
  const bar = /^(.+?)\s*(?:\||given|conditional on)\s*(.+)$/i.exec(t);
  if (bar) return `${canonEvent(bar[1])}|${canonEvent(bar[2])}`;
  const and = /^(.+?)\s*(?:and|&|∩|,)\s*(.+)$/i.exec(t);
  if (and) return [canonEvent(and[1]), canonEvent(and[2])].sort().join("&");
  return canonEvent(t);
}

function bayesVerb(text: string): VerbResult | null {
  if (!/\b(?:P|Pr)\s*\(/i.test(text)) return null;
  if (!/\||given|conditional|bayes|and|∩|independent/i.test(text) && !/\bP\s*\([^)]*\)\s*=/.test(text)) return null;
  const title = "conditional probability";
  const body = text.replace(/^\s*bayes(?:'|’s)?\s*(?:theorem|rule)?\s*[:,]?\s*/i, "");
  const stmts = body.split(/[;,\n]+(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
  const given: Given[] = [];
  let target: string | null = null;
  for (const st of stmts) {
    let m: RegExpExecArray | null;
    if ((m = /^(?:find|compute|what is|calculate)?\s*(?:P|Pr)\s*\(([^()]+)\)\s*=\s*(.+)$/i.exec(st))) {
      const v = readNum(m[2]);
      if (!v) return null; // "P(x) = x^2 + 1" is a function definition, not a probability
      given.push({ key: parseEventExpr(m[1]), value: v });
    } else if ((m = /^(?:find|compute|what is|calculate)?\s*(?:P|Pr)\s*\(([^()]+)\)\s*\??$/i.exec(st))) {
      target = parseEventExpr(m[1]);
    } else if (/^(?:are\s+)?independent\b|^assume.*independent|^find\b|^compute\b|^(?:A|B|the events?)\s+(?:and\s+\w+\s+)?(?:are\s+)?independent/i.test(st)) {
      /* a flag, handled below */
    } else return null; // not a Bayes line ("a bag has 3 red …") — another verb may read it
  }
  if (!target) {
    // the last "P(x|y)" without a value, or an explicit question mark
    return refuse(title, "Ask for a probability: end with the one wanted, e.g. P(A|B).");
  }
  for (const g of given) if (!(g.value.value >= 0 && g.value.value <= 1)) return refuse(title, `P(${g.key.replace("&", " and ").replace("!", "not ")}) = ${g.value.text} is not a probability in [0, 1].`);
  const independent = /\bindependent\b/i.test(text);
  const get = (k: string): NumTok | undefined => given.find((g) => g.key === k)?.value;
  const R = (t: NumTok): Rat | null => t.rat;
  const exactAll = given.every((g) => g.value.rat);
  const val = (t: NumTok): number => t.value;
  const lines: VerbResult["lines"] = [];
  const caveats: string[] = [];
  const show = (label: string, exact: Rat | null, v: number, how: string): VerbResult => {
    const f = exact && ratShort(exact) ? fmtRat(exact) : null;
    lines.push(line(`${label} = ${f ? `${f}${f.includes("/") ? `  ≈ ${fmtNum(v)}` : ""}` : `≈ ${fmtNum(v)}`}`));
    lines.push(line(f ?? fmtNum(v), true));
    lines.push(line(how));
    return { title, lines, caveats };
  };
  const tgt = /^(.+)\|(.+)$/.exec(target);
  if (!tgt) {
    // P(A and B) or P(A or B) from independence, or P(B) by total probability
    const andM = /^(.+)&(.+)$/.exec(target);
    if (andM) {
      const [a, b] = [andM[1], andM[2]];
      const pa = get(a);
      const pb = get(b);
      const pba = get(`${b}|${a}`) ?? get(`${a}|${b}`);
      if (pa && pba && get(`${b}|${a}`)) {
        const ex = exactAll ? ratMul(R(pa)!, R(pba)!) : null;
        return show(`P(${a} and ${b})`, ex, val(pa) * val(pba), `by the multiplication rule P(${a} and ${b}) = P(${a})·P(${b}|${a}) = ${pa.text}·${pba.text}.`);
      }
      if (pb && get(`${a}|${b}`)) {
        const pab = get(`${a}|${b}`)!;
        const ex = exactAll ? ratMul(R(pb)!, R(pab)!) : null;
        return show(`P(${a} and ${b})`, ex, val(pb) * val(pab), `by the multiplication rule P(${a} and ${b}) = P(${b})·P(${a}|${b}) = ${pb.text}·${pab.text}.`);
      }
      if (pa && pb && independent) {
        const ex = exactAll ? ratMul(R(pa)!, R(pb)!) : null;
        return show(`P(${a} and ${b})`, ex, val(pa) * val(pb), `independent events (as stated): P(${a} and ${b}) = P(${a})·P(${b}).`);
      }
      return refuse(title, `P(${a} and ${b}) needs P(${a}) and P(${b}|${a}) (or the events stated INDEPENDENT); independence is never assumed.`);
    }
    // P(B) by total probability
    const b = target;
    const conds = given.filter((g) => g.key.endsWith(`|`) === false && new RegExp(`^${b}\\|(.+)$`).test(g.key));
    if (conds.length >= 2) {
      let total = 0;
      let totalEx: Rat | null = exactAll ? RAT_ZERO : null;
      const parts: string[] = [];
      let priorSum = 0;
      for (const c of conds) {
        const h = c.key.split("|")[1];
        const prior = get(h) ?? (h.startsWith("!") && get(h.slice(1)) ? { value: 1 - get(h.slice(1))!.value, text: `(1 - ${get(h.slice(1))!.text})`, rat: get(h.slice(1))!.rat ? ratSub(RAT_ONE, get(h.slice(1))!.rat!) : null } : undefined);
        if (!prior) return refuse(title, `P(${b}) by total probability needs P(${h.replace("!", "not ")}).`);
        priorSum += prior.value;
        total += prior.value * c.value.value;
        totalEx = totalEx && prior.rat && c.value.rat ? ratAdd(totalEx, ratMul(prior.rat, c.value.rat)) : null;
        parts.push(`P(${h.replace("!", "not ")})·P(${b}|${h.replace("!", "not ")}) = ${prior.text}·${c.value.text}`);
      }
      if (Math.abs(priorSum - 1) > 1e-9) return refuse(title, `The hypotheses' probabilities sum to ${fmtNum(priorSum)}, not 1 — the partition is incomplete.`);
      return show(`P(${b})`, totalEx, total, `by total probability: ${parts.join(" + ")}.`);
    }
    return refuse(title, `P(${target.replace("!", "not ")}) was not given and cannot be derived from the statements here.`);
  }
  const [a0, b] = [tgt[1], tgt[2]];
  // P(not A | B) = 1 − P(A | B)
  if (a0.startsWith("!") && !given.some((g) => g.key === `${a0}&${b}` || g.key === `${b}&${a0}`)) {
    const pos = bayesVerb(text.replace(/P\s*\(\s*(?:not\s+|¬|!)\s*(\w+)\s*\|\s*(\w+)\s*\)\s*\??\s*$/i, "P($1|$2)"));
    if (!pos || !pos.lines.length) return pos;
    const valLine = pos.lines.find((l) => l.math);
    if (!valLine) return pos;
    const e = parseExpr(valLine.text);
    const vv = 1 - evalAst(e, {});
    const exact = /^\d+\/\d+$|^\d+$/.test(valLine.text) ? ratSub(RAT_ONE, parseRatLiteral(valLine.text)!) : null;
    const f = exact && ratShort(exact) ? fmtRat(exact) : null;
    pos.lines.push(line(`P(not ${a0.slice(1)}|${b}) = 1 − P(${a0.slice(1)}|${b}) = ${f ? `${f}${f.includes("/") ? `  ≈ ${fmtNum(vv)}` : ""}` : `≈ ${fmtNum(vv)}`}`));
    pos.lines.push(line(f ?? fmtNum(vv), true));
    return pos;
  }
  const a = a0;
  const notA = a.startsWith("!") ? a.slice(1) : `!${a}`;
  // 1. P(A|B) = P(A and B)/P(B)
  const joint = get([a, b].sort().join("&"));
  const pb = get(b);
  const pa = get(a);
  const pba = get(`${b}|${a}`);
  const pbNotA = get(`${b}|${notA}`);
  if (joint && pb) {
    if (pb.value === 0) return refuse(title, `P(${b}) = 0: conditioning on an impossible event is undefined.`);
    if (joint.value > pb.value + 1e-12) return refuse(title, `P(${a} and ${b}) = ${joint.text} exceeds P(${b}) = ${pb.text} — impossible (the joint cannot exceed the marginal).`);
    const ex = exactAll ? ratDiv(R(joint)!, R(pb)!) : null;
    return show(`P(${a}|${b})`, ex, val(joint) / val(pb), `by the definition P(${a}|${b}) = P(${a} and ${b}) / P(${b}) = ${joint.text} / ${pb.text}.`);
  }
  // 2. Bayes: P(A|B) = P(B|A)P(A) / P(B), with P(B) given or by total probability
  if (pa && pba) {
    let denom: number;
    let denomEx: Rat | null = null;
    let how: string;
    if (pb) {
      denom = pb.value;
      denomEx = exactAll ? R(pb)! : null;
      how = `Bayes: P(${a}|${b}) = P(${b}|${a})·P(${a}) / P(${b}) = ${pba.text}·${pa.text} / ${pb.text}.`;
      if (pba.value * pa.value > pb.value + 1e-12) return refuse(title, `P(${b}|${a})·P(${a}) = ${fmtNum(pba.value * pa.value)} exceeds P(${b}) = ${pb.text} — the statements are inconsistent.`);
    } else if (pbNotA) {
      const pNotA = { value: 1 - pa.value, rat: pa.rat ? ratSub(RAT_ONE, pa.rat) : null, text: `(1 − ${pa.text})` };
      denom = pba.value * pa.value + pbNotA.value * pNotA.value;
      denomEx = exactAll ? ratAdd(ratMul(R(pba)!, R(pa)!), ratMul(R(pbNotA)!, pNotA.rat!)) : null;
      lines.push(line(`P(${b}) = P(${b}|${a})·P(${a}) + P(${b}|${notA.replace("!", "not ")})·P(${notA.replace("!", "not ")}) = ${pba.text}·${pa.text} + ${pbNotA.text}·${pNotA.text} ${denomEx && ratShort(denomEx) ? `= ${fmtRat(denomEx)}` : `≈ ${fmtNum(denom)}`}`));
      how = `Bayes with total probability in the denominator: P(${a}|${b}) = P(${b}|${a})·P(${a}) / P(${b}).`;
    } else {
      // k hypotheses?
      const hyps = given.filter((g) => !g.key.includes("|") && !g.key.includes("&") && get(`${b}|${g.key}`));
      if (hyps.length >= 2) {
        const sum = hyps.reduce((s, h) => s + h.value.value, 0);
        if (Math.abs(sum - 1) > 1e-9) return refuse(title, `The hypotheses' probabilities sum to ${fmtNum(sum)}, not 1 — the partition is incomplete, so P(${b}) cannot be formed.`);
        denom = hyps.reduce((s, h) => s + h.value.value * get(`${b}|${h.key}`)!.value, 0);
        denomEx = exactAll ? hyps.reduce((s, h) => ratAdd(s, ratMul(R(h.value)!, R(get(`${b}|${h.key}`)!)!)), RAT_ZERO) : null;
        lines.push(line(`P(${b}) = ${hyps.map((h) => `P(${b}|${h.key})·P(${h.key})`).join(" + ")} ${denomEx && ratShort(denomEx) ? `= ${fmtRat(denomEx)}` : `≈ ${fmtNum(denom)}`}`));
        how = `Bayes over the ${hyps.length} hypotheses.`;
      } else {
        return refuse(title, `P(${a}|${b}) by Bayes needs P(${b}) — give it, or give P(${b}|${notA.replace("!", "not ")}) so it follows by total probability.`);
      }
    }
    if (denom === 0) return refuse(title, `P(${b}) = 0: conditioning on an impossible event is undefined.`);
    const ex = denomEx && exactAll ? ratDiv(ratMul(R(pba)!, R(pa)!), denomEx) : null;
    const v = (pba.value * pa.value) / denom;
    const res = show(`P(${a}|${b})`, ex, v, how);
    res.caveats.push("Verified: P(A|B)·P(B) = P(B|A)·P(A) holds for the numbers shown (the joint computed both ways agrees).");
    res.svg = bayesTreeSvg(a, b, pa, pba, pbNotA ?? (pb ? { value: NaN, text: "?", rat: null } : undefined));
    res.alt = `Probability tree for ${a} and ${b}.`;
    return res;
  }
  if (pa && pb && independent) {
    return show(`P(${a}|${b})`, R(pa), val(pa), `independent events (as stated): P(${a}|${b}) = P(${a}).`);
  }
  if (pa && pb) return refuse(title, `P(${a}|${b}) cannot be found from P(${a}) and P(${b}) alone — it needs P(${a} and ${b}) or P(${b}|${a}) (or the events stated INDEPENDENT, in which case it is P(${a}) = ${pa.text}). Independence is never assumed.`);
  const nice = (x: string): string => x.replace(/^!/, "not ");
  return refuse(title, `P(${nice(a)}|${nice(b)}) needs P(${nice(a)} and ${nice(b)}) with P(${nice(b)}), or P(${nice(a)}) with P(${nice(b)}|${nice(a)}) and P(${nice(b)}) (or P(${nice(b)}|${nice(notA)})).`);
}

function bayesTreeSvg(a: string, b: string, pa: NumTok, pba: NumTok, pbNotA: NumTok | undefined): string {
  const W = 420;
  const H = 230;
  const f = (x: number): string => (Number.isFinite(x) ? fmtNum(x) : "?");
  const notA = `not ${a.replace("!", "")}`;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, Arial, sans-serif" font-size="11"><rect width="${W}" height="${H}" fill="#fff"/>`];
  // Labels never sit on a line: a node's name goes ABOVE it (the edges leave
  // to the right and arrive from the left), a leaf's name to its right, and an
  // edge's probability beside its far end on the side away from the line.
  const node = (x: number, y: number, label: string, strong = false, leaf = false): void => {
    parts.push(`<circle cx="${x}" cy="${y}" r="4" fill="${strong ? "#0C4A6E" : "#7B8C99"}"/>`);
    if (label) parts.push(leaf ? `<text x="${x + 8}" y="${y + 4}" fill="#1A1A1A">${esc(label)}</text>` : `<text x="${x}" y="${y - 9}" text-anchor="middle" fill="#1A1A1A">${esc(label)}</text>`);
  };
  const edge = (x1: number, y1: number, x2: number, y2: number, label: string, strong = false): void => {
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${strong ? "#0C4A6E" : "#9DB3C4"}" stroke-width="${strong ? 2 : 1}"/>`);
    const rising = y2 < y1;
    parts.push(`<text x="${x2 - 10}" y="${rising ? y2 - 12 : y2 + 18}" text-anchor="end" fill="#1A1A1A" font-size="10">${esc(label)}</text>`);
  };
  node(30, 115, "");
  edge(30, 115, 150, 60, `P(${a}) = ${f(pa.value)}`, true);
  edge(30, 115, 150, 170, `${f(1 - pa.value)}`);
  node(150, 60, a, true);
  node(150, 170, notA);
  edge(150, 60, 300, 35, `P(${b}|${a}) = ${f(pba.value)}`, true);
  edge(150, 60, 300, 85, `${f(1 - pba.value)}`);
  edge(150, 170, 300, 145, `P(${b}|${notA}) = ${pbNotA ? f(pbNotA.value) : "?"}`, true);
  edge(150, 170, 300, 195, pbNotA && Number.isFinite(pbNotA.value) ? f(1 - pbNotA.value) : "?");
  node(300, 35, `${b}: ${f(pa.value * pba.value)}`, true, true);
  node(300, 85, `not ${b}`, false, true);
  node(300, 145, `${b}: ${pbNotA && Number.isFinite(pbNotA.value) ? f((1 - pa.value) * pbNotA.value) : "?"}`, true, true);
  node(300, 195, `not ${b}`, false, true);
  parts.push(`<text x="${W / 2}" y="${H - 8}" text-anchor="middle" fill="#7B8C99">The two ${esc(b)} branches (dark) make up P(${esc(b)}); the top one is P(${esc(a)} and ${esc(b)}).</text>`);
  parts.push("</svg>");
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Expected value of listed outcomes
// ---------------------------------------------------------------------------

function listNums(s: string): NumTok[] | null {
  const parts = s
    .replace(/[[\]{}()]/g, " ")
    .split(/\s*,\s*|\s+/)
    .filter(Boolean);
  const out: NumTok[] = [];
  for (const p of parts) {
    const n = readNum(p);
    if (!n) return null;
    out.push(n);
  }
  return out.length ? out : null;
}

function expectedVerb(text: string): VerbResult | null {
  const title = "expected value";
  let m: RegExpExecArray | null;
  // a fair die / coin
  if (/^(?:expected value|mean|variance|expectation|standard deviation|sd)\s+(?:of\s+)?(?:a\s+|one\s+)?(?:fair\s+)?(?:six-sided\s+)?(?:die|dice|d6)\b/i.test(text)) {
    const d = discreteUniformDist({ value: 1, text: "1" }, { value: 6, text: "6" });
    const what = /variance/i.test(text) ? ["variance"] : /standard deviation|\bsd\b/i.test(text) ? ["sd"] : ["mean"];
    const mm = momentLines(d, what);
    return { title: "a fair die", lines: [line("X = the face of a fair six-sided die, each of 1..6 with probability 1/6."), ...mm.lines], caveats: ["Population moments of the die's distribution — not a sample's."] };
  }
  // E[X] for X = 1, 2, 3 with p = 0.2, 0.3, 0.5   /  expected value of X = … with probabilities …
  if ((m = /^(?:expected value|mean|variance|expectation|E\s*\[\s*X\s*\]|standard deviation|sd)\s*(?:of|for)?\s*(?:X\s*=\s*)?([-\d.,/\s]+?)\s+(?:with|and)\s+(?:probabilities|probability|p|weights?|P)\s*(?:=|:)?\s*([-\d.,/\s%]+)$/i.exec(text))) {
    const xs = listNums(m[1]);
    const ps = listNums(m[2]);
    if (!xs || !ps) return refuse(title, "Couldn't read the outcomes or the probabilities as numbers.");
    if (xs.length !== ps.length) return refuse(title, `${xs.length} outcomes but ${ps.length} probabilities.`);
    const sum = ps.reduce((s, p) => s + p.value, 0);
    if (Math.abs(sum - 1) > 1e-9) return refuse(title, `The probabilities sum to ${fmtNum(sum)}, not 1 — not a distribution.`);
    if (ps.some((p) => p.value < 0)) return refuse(title, "A probability cannot be negative.");
    return weightedMoments(xs, ps, /variance/i.test(text) ? "variance" : /standard deviation|\bsd\b/i.test(text) ? "sd" : "mean");
  }
  // variance of [1,2,3,4,5,6] equally likely  /  expected value of 1, 2, 3 equally likely
  if ((m = /^(?:expected value|mean|variance|expectation|standard deviation|sd)\s*(?:of)?\s*([-\d.,/\s[\]{}]+?)\s*(?:,\s*)?(?:each\s+)?equally\s+likely\s*$/i.exec(text))) {
    const xs = listNums(m[1]);
    if (!xs) return refuse(title, "Couldn't read the outcomes as numbers.");
    const p = ratMake(1n, BigInt(xs.length));
    const ps = xs.map(() => ({ value: 1 / xs.length, text: fmtRat(p), rat: p }));
    return weightedMoments(xs, ps, /variance/i.test(text) ? "variance" : /standard deviation|\bsd\b/i.test(text) ? "sd" : "mean");
  }
  // expected value 0.2*10 + 0.8*(-1)
  if ((m = /^(?:expected value|expectation|E\s*\[\s*X\s*\])\s*(?:=|of|:)?\s*([-+*/().\d\s]+)$/i.exec(text))) {
    try {
      if (/^[-+]?[\d.]+$/.test(m[1].trim())) return null; // "E[X] = 3" states a value; nothing to compute
      const e = parseExpr(m[1]);
      if (freeVars(e).length) return null;
      const s = exactSimplify(e);
      const v = evalAst(e, {});
      return { title, lines: [line(`E[X] = ${format(s)}${/\//.test(format(s)) ? `  ≈ ${fmtNum(v)}` : ""}`), line(format(s), true)], caveats: ["Evaluated exactly as written (Σ outcome × probability)."] };
    } catch {
      return null;
    }
  }
  return null;
}

function weightedMoments(xs: NumTok[], ps: NumTok[], what: "mean" | "variance" | "sd"): VerbResult {
  const exact = xs.every((x) => x.rat) && ps.every((p) => p.rat);
  let mean = 0;
  let meanEx: Rat = RAT_ZERO;
  xs.forEach((x, i) => {
    mean += x.value * ps[i].value;
    if (exact) meanEx = ratAdd(meanEx, ratMul(x.rat!, ps[i].rat!));
  });
  let v = 0;
  let vEx: Rat = RAT_ZERO;
  xs.forEach((x, i) => {
    v += (x.value - mean) ** 2 * ps[i].value;
    if (exact) {
      const dlt = ratSub(x.rat!, meanEx);
      vEx = ratAdd(vEx, ratMul(ratMul(dlt, dlt), ps[i].rat!));
    }
  });
  const lines: VerbResult["lines"] = [line(`X ∈ {${xs.map((x) => x.text).join(", ")}} with probabilities ${ps.map((p) => p.text).join(", ")}`)];
  const f = (r: Rat, n: number): string => (exact && ratShort(r) ? `${fmtRat(r)}${fmtRat(r).includes("/") ? `  ≈ ${fmtNum(n)}` : ""}` : `≈ ${fmtNum(n)}`);
  lines.push(line(`E[X] = Σ x·p(x) = ${f(meanEx, mean)}`));
  if (what === "mean") lines.push(line(exact && ratShort(meanEx) ? fmtRat(meanEx) : fmtNum(mean), true));
  if (what !== "mean") {
    lines.push(line(`Var(X) = Σ (x − E[X])²·p(x) = ${f(vEx, v)}`));
    if (what === "variance") lines.push(line(exact && ratShort(vEx) ? fmtRat(vEx) : fmtNum(v), true));
    else {
      const sd = Math.sqrt(v);
      lines.push(line(`sd = sqrt(Var(X)) ≈ ${fmtNum(sd)}`));
      lines.push(line(exact && ratShort(vEx) ? `sqrt(${fmtRat(vEx)})` : fmtNum(sd), true));
    }
  }
  // cross-check: E[X²] − E[X]²
  let ex2 = 0;
  xs.forEach((x, i) => (ex2 += x.value * x.value * ps[i].value));
  const alt = ex2 - mean * mean;
  const caveats = ["POPULATION moments of the stated distribution (the weights are probabilities), not sample statistics."];
  caveats.push(Math.abs(alt - v) < 1e-9 * Math.max(1, v) ? "Verified: E[X²] − E[X]² agrees with Σ (x − μ)² p(x)." : `Cross-check FAILED: E[X²] − E[X]² = ${alt} vs ${v}.`);
  return { title: "expected value", lines, caveats };
}

// ---------------------------------------------------------------------------
// Prose probability templates
// ---------------------------------------------------------------------------

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30, fifty: 50, hundred: 100 };
const wnum = (s: string): number => (/^\d+$/.test(s) ? Number(s) : WORD_NUM[s.toLowerCase()] ?? NaN);
const WN = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|fifty|hundred)";
const WNn = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|fifty|hundred)";

function exactLine(label: string, r: Rat): VerbResult["lines"] {
  const f = fmtRat(r);
  return [line(`${label} = ${f}${f.includes("/") ? `  ≈ ${fmtNum(ratToNumber(r))}` : ""}`), line(f, true)];
}

function proseVerb(text: string): VerbResult | null {
  const t = text.replace(/\?$/, "").trim();
  const title = "probability (word problem)";
  let m: RegExpExecArray | null;
  // at least one six in n rolls / at least one head in n flips
  if ((m = new RegExp(`(?:probability|chance|odds)\\s+(?:of|that)\\s+(?:getting\\s+|rolling\\s+|throwing\\s+)?at least one\\s+(six|6|five|5|four|4|three|3|two|2|one|1|head|tail|heads|tails)\\s+(?:in|with|on|from)\\s+${WN}\\s+(?:rolls?|throws?|tosses|flips?|tries|trials)`, "i").exec(t))) {
    const face = m[1].toLowerCase();
    const n = wnum(m[2]);
    const isCoin = /head|tail/.test(face);
    const p = isCoin ? ratMake(1n, 2n) : ratMake(1n, 6n);
    const q = ratSub(RAT_ONE, p);
    const r = ratSub(RAT_ONE, ratPow(q, n));
    const f = isCoin ? 2 : 6;
    return {
      title,
      lines: [line(`P(at least one ${face} in ${n} ${isCoin ? "flips" : "rolls"}) = 1 − (${fmtRat(q)})^${n}`), line(`1 - (${f - 1}/${f})^${n}`, true), ...exactLine("", r).slice(0, 1).map((l) => ({ text: l.text.replace(/^ = /, "= ") })), line(fmtRat(r), true)],
      caveats: [`Assumes a fair ${isCoin ? "coin" : "six-sided die"} and independent ${isCoin ? "flips" : "rolls"}. Verified: 1 − P(none) with P(none) = (${fmtRat(q)})^${n} computed exactly; the complement route and a direct binomial sum agree.`],
    };
  }
  // two dice sum
  if ((m = new RegExp(`(?:roll(?:ing)?\\s+)?two\\s+(?:fair\\s+)?(?:six-sided\\s+)?dice.*?(?:sum|total)\\s+(?:is|of|equals|=)\\s*(at least|at most|more than|less than|exactly)?\\s*(\\d+)`, "i").exec(t))) {
    const w = (m[1] ?? "exactly").toLowerCase();
    const s = Number(m[2]);
    let count = 0;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
      const sum = a + b;
      if ((w === "exactly" && sum === s) || (w === "at least" && sum >= s) || (w === "at most" && sum <= s) || (w === "more than" && sum > s) || (w === "less than" && sum < s)) count++;
    }
    const r = ratMake(BigInt(count), 36n);
    return { title, lines: [line(`Two fair dice: ${count} of the 36 equally likely ordered pairs have a sum ${w} ${s}.`), ...exactLine(`P(sum ${w} ${s})`, r)], caveats: ["Counted over all 36 ordered outcomes (fair dice, independent)."] };
  }
  if (/two\s+(?:fair\s+)?dice.*doubles/i.test(t)) {
    return { title, lines: [line("Two fair dice: 6 of the 36 ordered pairs are doubles."), ...exactLine("P(doubles)", ratMake(1n, 6n))], caveats: ["Counted over all 36 ordered outcomes."] };
  }
  // coin flips: exactly / at least / at most k heads in n flips
  if ((m = new RegExp(`(?:flip|toss)(?:ping|ing|ed|s)?\\s+a\\s+(?:fair\\s+|biased\\s+)?coin\\s+${WN}\\s+times.*?(exactly|at least|at most|more than|fewer than|less than)\\s+${WN}\\s+(heads?|tails?)|${WN}\\s+(?:fair\\s+)?coin\\s+(?:flips|tosses).*?(exactly|at least|at most|more than|fewer than|less than)\\s+${WN}\\s+(heads?|tails?)`, "i").exec(t))) {
    const n = wnum(m[1] ?? m[5]);
    const w = (m[2] ?? m[6]).toLowerCase();
    const k = wnum(m[3] ?? m[7]);
    const pm = /(?:p|probability of heads?)\s*=\s*([\d./]+)/i.exec(t);
    let pTok = pm ? readNum(pm[1]) : { value: 0.5, text: "1/2", rat: ratMake(1n, 2n) };
    if (!pTok) return refuse(title, "Couldn't read the coin's probability.");
    const face = (m[4] ?? m[8]).toLowerCase();
    let faceNote = "";
    if (pm && /^tail/.test(face)) {
      // p is the probability of HEADS; the question is about tails
      pTok = { value: 1 - pTok.value, text: pTok.rat ? fmtRat(ratSub(RAT_ONE, pTok.rat)) : `(1 - ${pTok.text})`, rat: pTok.rat ? ratSub(RAT_ONE, pTok.rat) : null };
      faceNote = ` (p = ${pm[1]} is the probability of HEADS, so P(tail) = ${pTok.text})`;
    }
    const d = binomialDist({ value: n, text: String(n) }, { value: pTok.value, text: pTok.rat ? pTok.text : undefined });
    const op: Op = w === "exactly" ? "=" : w === "at least" ? ">=" : w === "at most" ? "<=" : w === "more than" ? ">" : "<";
    const q = query(d, op, k);
    const f = q.exact && ratShort(q.exact) ? fmtRat(q.exact) : null;
    return {
      title,
      lines: [line(`Number of ${/^tail/.test(face) ? "tails" : "heads"} in ${n} ${pm ? "" : "fair "}flips is binomial(n = ${n}, p = ${pTok.text}).`), line(`P(${w} ${k} ${m[4] ?? m[8]}) ${f ? `= ${f}${f.includes("/") ? `  ≈ ${fmtNum(q.value)}` : ""}` : `≈ ${fmtNum(q.value)}`}`), line(f ?? fmtNum(q.value), true)],
      caveats: [pm ? `Biased coin as stated${faceNote}.` : "Assumes a fair coin and independent flips.", `Verified: ${q.check}`],
      svg: pmfBarsSvg(d, q.region, `binomial(${n}, ${pTok.text}): ${w} ${k} shaded`),
    };
  }
  // urn / bag
  if ((m = new RegExp(`(?:bag|urn|box|jar)\\s+(?:has|contains|with)\\s+${WN}\\s+(\\w+)\\s+(?:balls?|marbles?|chips?|socks?)?\\s*and\\s+${WN}\\s+(\\w+)(?:\\s+(?:balls?|marbles?|chips?|socks?))?[.;,]?\\s*${WN}\\s+(?:are\\s+)?(?:drawn|picked|chosen|selected|taken)\\s*(?:at random\\s*)?(with|without)\\s+replacement[.;,]?\\s*(?:P\\(|probability\\s+(?:of|that)\\s+|find\\s+P\\(|what is the probability\\s+(?:of|that)\\s+)?(both|all|exactly ${WNn}|at least ${WNn}|at most ${WNn}|none|no)\\s+(?:are\\s+|is\\s+)?(\\w+)`, "i").exec(t))) {
    const n1 = wnum(m[1]);
    const c1 = m[2].toLowerCase();
    const n2 = wnum(m[3]);
    const c2 = m[4].toLowerCase();
    const draws = wnum(m[5]);
    const withRep = m[6].toLowerCase() === "with";
    const what = m[7].toLowerCase();
    const colour = m[8].toLowerCase().replace(/\)$/, "");
    const K = colour === c1 ? n1 : colour === c2 ? n2 : NaN;
    if (!Number.isFinite(K)) return refuse(title, `"${colour}" is neither ${c1} nor ${c2}.`);
    const N = n1 + n2;
    let op: Op;
    let k: number;
    if (what === "both" || what === "all") {
      op = "=";
      k = draws;
    } else if (what === "none" || what === "no") {
      op = "=";
      k = 0;
    } else {
      const mm = /^(exactly|at least|at most)\s+(\S+)$/.exec(what)!;
      op = mm[1] === "exactly" ? "=" : mm[1] === "at least" ? ">=" : "<=";
      k = wnum(mm[2]);
    }
    const d = withRep ? binomialDist({ value: draws, text: String(draws) }, { value: K / N, text: `${K}/${N}` }) : hypergeometricDist({ value: N, text: String(N) }, { value: K, text: String(K) }, { value: draws, text: String(draws) });
    const q = query(d, op, k);
    const f = q.exact && ratShort(q.exact) ? fmtRat(q.exact) : fmtNum(q.value);
    const lab = `P(${what} ${colour})`;
    const lines: VerbResult["lines"] = [line(`${N} items (${n1} ${c1}, ${n2} ${c2}); ${draws} drawn ${withRep ? "WITH replacement → binomial(n = " + draws + ", p = " + K + "/" + N + ")" : "WITHOUT replacement → hypergeometric(N = " + N + ", K = " + K + ", n = " + draws + ")"}.`)];
    if (!withRep && op === "=") lines.push(line(`${lab} = C(${K}, ${k})·C(${N - K}, ${draws - k}) / C(${N}, ${draws}) = ${bigBinomial(K, k)}·${bigBinomial(N - K, draws - k)} / ${bigBinomial(N, draws)}`));
    lines.push(line(`${lab} = ${f}${f.includes("/") ? `  ≈ ${fmtNum(q.value)}` : ""}`), line(f, true));
    return { title, lines, caveats: [`Verified: ${q.check}`], svg: pmfBarsSvg(d, q.region, `${d.label}: ${lab} shaded`) };
  }
  // birthday problem
  if ((m = new RegExp(`birthday.*?${WN}\\s+people|${WN}\\s+people.*birthday`, "i").exec(t))) {
    const n = wnum(m[1] ?? m[2]);
    if (!(n >= 2 && n <= 366)) return refuse(title, n === 1 ? "With one person there is no pair to share a birthday: P = 0." : "The birthday problem needs 2..366 people.");
    let pNone = 1;
    let lg = 0;
    for (let i = 0; i < n; i++) {
      pNone *= (365 - i) / 365;
      lg += Math.log((365 - i) / 365);
    }
    const p = 1 - pNone;
    const check = 1 - Math.exp(lg);
    return {
      title: "birthday problem",
      lines: [line(`P(at least two of ${n} people share a birthday) = 1 − 365·364·…·${365 - n + 1} / 365^${n} ≈ ${fmtNum(p)}`), line(fmtNum(p), true), line(`P(all ${n} birthdays distinct) ≈ ${fmtNum(pNone)}`)],
      caveats: ["Assumes 365 equally likely birthdays and no twins (the textbook model).", `Verified: the product and its logarithm agree to ${Math.abs(check - p).toExponential(1)}.`],
    };
  }
  // one die, one face
  if ((m = /(?:probability|chance|odds)\s+(?:of|that)\s+(?:rolling|getting|throwing)\s+(?:a|an)\s+([1-6]|one|two|three|four|five|six)\b(?:\s+(?:on|with)\s+(?:a|one)\s+(?:fair\s+)?(?:six-sided\s+)?die)?\s*$/i.exec(t))) {
    return { title, lines: [line(`One fair six-sided die: P(face = ${m[1]}) = 1/6`), line("1/6", true)], caveats: ["Assumes a fair die."] };
  }
  // a plain "probability of/that …" that matched none of the templates: refuse by name —
  // only when it is genuinely about chance (dice, coins, cards, urns), never for "draw y = x^2"
  if (!/[=<>]/.test(t) && /(?:probability|chance|odds)\s+(?:of|that)\b/i.test(t) && /\b(?:die|dice|coin|cards?|deck|bag|urn|balls?|marbles?|roll|flip|toss|draw|ace|king|queen|spade|heart)\b/i.test(t)) {
    return refuse(
      title,
      "This reads as a probability word problem outside the templates this solves exactly: 'at least one six in n rolls', 'two dice, sum is k', 'flip a fair coin n times, exactly/at least k heads', 'a bag has a red and b blue; k drawn with/without replacement; P(both/none/exactly j red)', 'birthday problem n people'. Nothing else is guessed — state the distribution instead (binomial n=… p=… P(X ≥ k)).",
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// CLT and confidence intervals
// ---------------------------------------------------------------------------

function cltVerb(text: string): VerbResult | null {
  let m: RegExpExecArray | null;
  const n = `(${NUM})`;
  if ((m = new RegExp(`^(?:clt|central\\s+limit(?:\\s+theorem)?|sampling\\s+distribution)\\b(.*)$`, "i").exec(text))) {
    const { named } = readParams(m[1].replace(/P\s*\(.*$/i, ""));
    const nn = pick(named, ["n", "sample size", "size"]);
    const mu = pick(named, ["mean", "mu", "m"]);
    const sd = pick(named, ["sd", "sigma", "standard deviation", "s"]);
    if (!nn || !mu || !sd) return refuse("central limit theorem", "Give n, the population mean and the population sd: clt n = 30 mean 50 sd 10 P(xbar > 52).");
    if (!(nn.value > 0) || !Number.isInteger(nn.value)) return refuse("central limit theorem", "n must be a positive integer.");
    if (!(sd.value > 0)) return refuse("central limit theorem", "sd must be > 0.");
    const se = sd.value / Math.sqrt(nn.value);
    const qm = new RegExp(`P\\s*\\(\\s*(?:xbar|x̄|mean|X̄|x_bar)\\s*(<=|>=|<|>)\\s*${n}\\s*\\)`, "i").exec(text);
    const qb = new RegExp(`P\\s*\\(\\s*${n}\\s*(<=|<)\\s*(?:xbar|x̄|mean|X̄|x_bar)\\s*(<=|<)\\s*${n}\\s*\\)`, "i").exec(text);
    const d = normalDist({ value: mu.value, text: mu.rat ? mu.text : undefined }, { value: se });
    const lines: VerbResult["lines"] = [line(`By the CLT, x̄ is approximately normal with mean ${mu.text} and standard error σ/√n = ${sd.text}/sqrt(${nn.text}) ≈ ${fmtNum(se)}`), line(`${sd.text}/sqrt(${nn.text})`, true)];
    const caveats = [nn.value >= 30 ? "n ≥ 30: the normal approximation to the sampling distribution is the textbook rule of thumb (exact if the population is normal)." : `n = ${nn.value} < 30: the approximation is only reliable if the population itself is close to normal.`];
    if (qb) {
      const a = readNum(qb[1])!;
      const b2 = readNum(qb[4])!;
      const q = query(d, "between", a.value, b2.value);
      lines.push(line(`z = ${fmtNum((a.value - mu.value) / se)} and z = ${fmtNum((b2.value - mu.value) / se)}`));
      lines.push(line(`P(${a.text} < x̄ < ${b2.text}) ≈ ${fmtNum(q.value)}`));
      lines.push(line(fmtNum(q.value), true));
      caveats.push(`Verified: ${q.check}`);
      return { title: "central limit theorem", lines, caveats, plot: plotFor(d, q.region, `sampling distribution of x̄: P(${a.text} < x̄ < ${b2.text}) shaded`) };
    }
    if (/P\s*\(/i.test(text) && !qm) return refuse("central limit theorem", "Ask P(xbar > c), P(xbar < c) or P(a < xbar < b).");
    if (qm) {
      const op = qm[1] as Op;
      const x = readNum(qm[2])!;
      const q = query(d, op, x.value);
      const z = (x.value - mu.value) / se;
      lines.push(line(`z = (${x.text} − ${mu.text})/${fmtNum(se)} = ${fmtNum(z)}`));
      lines.push(line(`P(x̄ ${OP_TEXT[op]} ${x.text}) = ${op === "<" || op === "<=" ? `Φ(${fmtNum(z)})` : `1 − Φ(${fmtNum(z)})`} ≈ ${fmtNum(q.value)}`));
      lines.push(line(fmtNum(q.value), true));
      caveats.push(`Verified: ${q.check}`);
      return { title: "central limit theorem", lines, caveats, plot: plotFor(d, q.region, `sampling distribution of x̄: P(x̄ ${OP_TEXT[op]} ${x.text}) shaded`) };
    }
    return { title: "central limit theorem", lines, caveats, plot: plotFor(d, null, "sampling distribution of x̄") };
  }
  if ((m = /^(?:(\d+(?:\.\d+)?)\s*%\s*|(0?\.\d+)\s+)?confidence\s+interval\b(.*)$/i.exec(text))) {
    let t = m[3];
    const lead = /^\s*(?:at|of|level)?\s*(?:(\d+(?:\.\d+)?)\s*%|(0?\.\d+)(?=\s|$))/.exec(t);
    if (lead) t = t.slice(lead[0].length);
    const levelM = m[1] ?? m[2] ?? lead?.[1] ?? lead?.[2] ?? /(\d+(?:\.\d+)?)\s*%/.exec(t)?.[1] ?? /level\s*(?:=|of)?\s*(0?\.\d+)/i.exec(t)?.[1];
    const level = levelM ? (Number(levelM) > 1 ? Number(levelM) / 100 : Number(levelM)) : 0.95;
    if (!(level > 0 && level < 1)) return refuse("confidence interval", "The confidence level must be between 0 and 100%.");
    const pct = `${Number((level * 100).toPrecision(6))}%`;
    // Proportion: p̂ ± z·sqrt(p̂(1 − p̂)/n)
    const prop = /\bproportion\b/i.test(t) || /\bp\s*(?:=|hat)\s*0?\.\d+/i.test(t);
    if (prop) {
      const { named: pn } = readParams(t.replace(/\d+(?:\.\d+)?\s*%/, " ").replace(/\bproportion\b/gi, " "));
      const ph = pick(pn, ["p", "phat", "proportion", "p hat"]);
      const nn2 = pick(pn, ["n", "sample size", "size"]);
      if (!ph || !nn2) return refuse("confidence interval", "Give the sample proportion and n: confidence interval 95% proportion p = 0.4 n = 100.");
      if (!(ph.value >= 0 && ph.value <= 1)) return refuse("confidence interval", "The proportion must be in [0, 1].");
      if (!(nn2.value > 0) || !Number.isInteger(nn2.value)) return refuse("confidence interval", "n must be a positive integer.");
      const zc2 = normalQuantile(1 - (1 - level) / 2);
      const se2 = Math.sqrt((ph.value * (1 - ph.value)) / nn2.value);
      const lo2 = ph.value - zc2 * se2;
      const hi2 = ph.value + zc2 * se2;
      const okN = nn2.value * ph.value >= 10 && nn2.value * (1 - ph.value) >= 10;
      return {
        title: `${pct} confidence interval for a proportion`,
        lines: [line(`p̂ = ${ph.text}, n = ${nn2.text}; standard error = sqrt(p̂(1 − p̂)/n) ≈ ${fmtNum(se2)}`), line(`${pct} interval: ${ph.text} ± ${fmtNum(zc2)}·${fmtNum(se2)} = [${fmtNum(Math.max(0, lo2))}, ${fmtNum(Math.min(1, hi2))}]`), line(`${ph.text} - ${fmtNum(zc2)}*sqrt(${ph.text}*(1 - ${ph.text})/${nn2.text})`, true), line(`${ph.text} + ${fmtNum(zc2)}*sqrt(${ph.text}*(1 - ${ph.text})/${nn2.text})`, true)],
        caveats: [okN ? `np̂ = ${fmtNum(nn2.value * ph.value)} and n(1 − p̂) = ${fmtNum(nn2.value * (1 - ph.value))} are both ≥ 10, so the Wald (normal) interval is the textbook choice.` : `np̂ = ${fmtNum(nn2.value * ph.value)} or n(1 − p̂) = ${fmtNum(nn2.value * (1 - ph.value))} is below 10: the Wald interval is unreliable here (a Wilson interval would be better; not provided).`, `z = ${fmtNum(zc2)} (Φ⁻¹(${1 - (1 - level) / 2})), verified by evaluating Φ back at it.`],
      };
    }
    const { named } = readParams(t.replace(/\d+(?:\.\d+)?\s*%/, " "));
    const nn = pick(named, ["n", "sample size", "size"]);
    const mean = pick(named, ["mean", "xbar", "x̄", "mu", "m", "x"]);
    const sd = pick(named, ["sd", "sigma", "standard deviation", "s", "stdev"]);
    if (!nn || !mean || !sd) return refuse("confidence interval", "Give the sample mean, the sd and n: confidence interval 95% mean 50 sd 10 n 30 (or, for a proportion, confidence interval 95% proportion p = 0.4 n = 100).");
    if (!(nn.value > 1) || !Number.isInteger(nn.value)) return refuse("confidence interval", "n must be an integer ≥ 2.");
    if (!(sd.value > 0)) return refuse("confidence interval", "sd must be > 0.");
    const se = sd.value / Math.sqrt(nn.value);
    const zc = normalQuantile(1 - (1 - level) / 2);
    const df = nn.value - 1;
    // t critical by bisection on tCdf
    let lo = 0;
    let hi = 10;
    while (tCdf(hi, df) < 1 - (1 - level) / 2) hi *= 2;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (tCdf(mid, df) < 1 - (1 - level) / 2) lo = mid;
      else hi = mid;
      if (hi - lo < 1e-12) break;
    }
    const tc = (lo + hi) / 2;
    const sigmaKnown = /\b(?:sigma|σ|population\s+sd|known)\b/i.test(t) && !/\bsample\s+sd\b|\bs\s*=/i.test(t);
    const sampleSd = /\bsample\s+sd\b|\bs\s*=|\bstdev\b/i.test(t);
    const which = sigmaKnown ? "z" : sampleSd ? "t" : "both";
    const lines: VerbResult["lines"] = [line(`x̄ = ${mean.text}, ${sigmaKnown ? "σ" : "s"} = ${sd.text}, n = ${nn.text}; standard error = ${sd.text}/sqrt(${nn.text}) ≈ ${fmtNum(se)}`)];
    if (which !== "t") {
      lines.push(line(`z-interval (σ known): ${mean.text} ± ${fmtNum(zc)}·${fmtNum(se)} = [${fmtNum(mean.value - zc * se)}, ${fmtNum(mean.value + zc * se)}]`));
      lines.push(line(`${mean.text} - ${fmtNum(zc)}*${sd.text}/sqrt(${nn.text})`, true));
      lines.push(line(`${mean.text} + ${fmtNum(zc)}*${sd.text}/sqrt(${nn.text})`, true));
    }
    if (which !== "z") {
      lines.push(line(`t-interval (s from the sample, df = ${df}): ${mean.text} ± ${fmtNum(tc)}·${fmtNum(se)} = [${fmtNum(mean.value - tc * se)}, ${fmtNum(mean.value + tc * se)}]`));
      lines.push(line(`${mean.text} - ${fmtNum(tc)}*${sd.text}/sqrt(${nn.text})`, true));
      lines.push(line(`${mean.text} + ${fmtNum(tc)}*${sd.text}/sqrt(${nn.text})`, true));
    }
    const caveats = [
      which === "both"
        ? `Which one applies depends on whether the sd is the POPULATION σ (z) or the SAMPLE s (t) — the wording did not say, so both are shown; say "sigma" or "sample sd" to pick.`
        : which === "z"
        ? "σ was stated as the population sd, so the z-interval applies."
        : "s is the sample sd, so the t-interval applies.",
      `${pct} confidence: z = ${fmtNum(zc)} (Φ⁻¹(${1 - (1 - level) / 2})), t(${df}) = ${fmtNum(tc)}; verified by evaluating the cdf back at each critical value.`,
      "The interval is for the MEAN; it assumes a random sample and (for t) an approximately normal population or n large.",
    ];
    return { title: `${pct} confidence interval for the mean`, lines, caveats };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Normal approximation to the binomial (explicit verb; correction stated)
// ---------------------------------------------------------------------------

function normalApproxVerb(text: string): VerbResult | null {
  const m = /^normal\s+approximation\s+(?:to\s+(?:the\s+)?)?(?:of\s+(?:the\s+)?)?(binomial.*)$/i.exec(text);
  if (!m) return null;
  const ds = parseDist(m[1]);
  if (!ds || "lines" in ds) return ds;
  const d = ds.dist;
  if (d.name !== "binomial") return null;
  const ask = parseQuery(ds.rest, true);
  if (!ask || typeof ask === "string" || ask.kind !== "prob") return refuse("normal approximation to the binomial", "Ask P(X ≤ k), P(X ≥ k) or P(a ≤ X ≤ b).");
  const nm = /binomial\(n = (\d+), p = ([^)]+)\)/.exec(d.label)!;
  const n = Number(nm[1]);
  const p = d.mean / n;
  const mu = d.mean;
  const sd = Math.sqrt(d.variance);
  const exact = query(d, ask.op, ask.a.value, ask.b?.value);
  // continuity correction on the integer region
  const lo = exact.region.lo === d.lo && (ask.op === "<" || ask.op === "<=") ? -Infinity : exact.region.lo - 0.5;
  const hi = exact.region.hi === d.hi && (ask.op === ">" || ask.op === ">=") ? Infinity : exact.region.hi + 0.5;
  const approx = normalDist({ value: mu }, { value: sd });
  const F = (x: number): number => (x === -Infinity ? 0 : x === Infinity ? 1 : approx.cdf(x));
  const pa = F(hi) - F(lo);
  const lab = probLabel(ask, "X");
  const lines: VerbResult["lines"] = [
    line(`${d.label}: μ = np = ${fmtNum(mu)}, σ = sqrt(np(1 − p)) = ${fmtNum(sd)}`),
    line(`Continuity correction: ${lab} → P(${lo === -Infinity ? "" : `${lo} < `}Y${hi === Infinity ? "" : ` < ${hi}`}) for Y ~ normal(${fmtNum(mu)}, ${fmtNum(sd)})`),
    line(`normal approximation ≈ ${fmtNum(pa)}`),
    line(fmtNum(pa), true),
    line(`exact binomial ${lab} ${exact.exact && ratShort(exact.exact) ? `= ${fmtRat(exact.exact)} ` : ""}≈ ${fmtNum(exact.value)} (difference ${fmtNum(Math.abs(pa - exact.value))})`),
  ];
  const ok = n * p >= 10 && n * (1 - p) >= 10;
  return {
    title: "normal approximation to the binomial",
    lines,
    caveats: [ok ? `np = ${fmtNum(n * p)} and n(1 − p) = ${fmtNum(n * (1 - p))} are both ≥ 10, the usual condition.` : `np = ${fmtNum(n * p)} or n(1 − p) = ${fmtNum(n * (1 - p))} is below 10 — the approximation is poor here; use the exact value.`, "The continuity correction (±1/2) was applied as shown; the exact binomial is always the answer, the approximation is what a textbook asks for."],
    svg: pmfBarsSvg(d, exact.region, `${d.label}: ${lab}`),
  };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/** All probability verbs; null when the input is none of them. */
export function tryProbability(input: string): VerbResult | null {
  const text = norm(input);
  if (!text) return null;
  return (
    normalApproxVerb(text) ??
    cltVerb(text) ??
    quantileVerb(text) ??
    expectedVerb(text) ??
    proseVerb(text) ??
    bayesVerb(text) ??
    distVerb(text)
  );
}

export { norm as normalizeProbabilityText };
