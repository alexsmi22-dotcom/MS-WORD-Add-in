// The three figures a statistics result needs and `buildPlotSvg` cannot draw.
//
// WHY A SEPARATE MODULE. `plot.ts` draws series against continuous axes. The
// figures below are all CATEGORICAL on one axis — groups, comparisons,
// categories — which that plotter has no notion of. Trying to fake a category
// axis with numeric positions loses the labels, which are the point.
//
// WHY THESE THREE. Statistics shipped 21 calculators and 5 of them drew. The
// missing 16 are not 16 different pictures; they are three, used repeatedly:
//
//   - a comparison of GROUPS      -> box plot   (t-tests, ANOVA, Kruskal-Wallis,
//                                                Friedman, Mann-Whitney,
//                                                Wilcoxon, descriptive)
//   - a set of pairwise INTERVALS -> forest plot (Tukey, Dunnett, corrections)
//   - OBSERVED against EXPECTED   -> grouped bars (chi-square, both kinds)
//
// The forest plot is the one worth arguing for. A post-hoc test's output IS a
// list of confidence intervals, and a table of them is the same information a
// reader cannot see; whether an interval crosses zero is the entire question,
// and on a chart it is one glance. Tukey's own caveat currently tells the user
// to go and run a different calculator by hand.
//
// Colours are literal hex, never a CSS variable or the inherited-colour
// keyword: this artwork goes into a Word document as line art and must not
// follow the pane's theme. `insertedFiguresIgnoreTheme.test.ts` scans the
// SOURCE for that, so this comment cannot name the keyword either.
//
// Ticks come from the shared axis engine (axis.ts) rather than a local copy. It
// carries the hard-won postconditions — a BOUNDED ARRAY rather than an open
// `t += step` loop, finite on Inf/NaN/1e308 — and labels a row from its step,
// so decimals are constant and the minus is U+2212. A second copy of that logic
// is a second chance to get it wrong, and getting it wrong here does not
// produce a bad chart, it produces a frozen Word.

import { linearAxis, logDecades, decadeLabel, fmtValue, fmtSig, trueMinus } from "./axis";
import { planBrackets, bracketMarkup, type SigBracketSet, type BracketDisplay, type BracketPlan } from "./sigBrackets";
import { currentFigCtx, wrapLabel } from "./figContext";

/**
 * Significance brackets for boxPlotSvg / groupedBarSvg. The set comes ONLY from
 * sigBrackets' engine-result constructors (bracketsFromTukey / bracketsFromPairwise);
 * group indices are the chart's group / category order. Absent or empty: the
 * output is byte-identical to a chart drawn without this option.
 */
export interface ChartBrackets {
  set: SigBracketSet;
  display?: BracketDisplay;
}

/**
 * The y axis extended until `need` px fit between the top of the data and the top
 * of the plot. Iterates through the shared axis engine (loose ticks round the top
 * out, so the room is measured on the axis actually drawn, not assumed).
 */
/**
 * The brackets do not fit the plot. A RangeError (callers that catch RangeError
 * keep working) carrying the numbers, so a caller that knows which remedies are
 * actually open (statsBrackets: is the figure already tall?) can name only those.
 */
/** Brackets may take less than this share of the plot height; above it the data are squashed into a sliver. */
export const BRACKET_ROOM_SHARE = 0.6;

export class BracketFitError extends RangeError {
  constructor(
    readonly needPx: number,
    readonly plotPx: number,
  ) {
    super(`${BracketFitError.findingFor(needPx, plotPx)}; make the chart taller or hide the non-significant brackets`);
    this.name = "BracketFitError";
    Object.setPrototypeOf(this, BracketFitError.prototype);
  }
  /**
   * The finding, stated against the REAL limit: brackets must take less than
   * BRACKET_ROOM_SHARE of the plot height (axisWithHeadroom). It used to quote
   * the whole plot height — "need 236 px … the plot area is 350 px tall" reads
   * as if they fit (v2.143.0 second review).
   */
  static findingFor(needPx: number, plotPx: number): string {
    const pct = Math.round(BRACKET_ROOM_SHARE * 100);
    return (
      `the significance brackets need ${Math.ceil(needPx)} px above the data, but brackets must stay below ${pct}% ` +
      `of the ${Math.round(plotPx)} px plot area (${Math.floor(plotPx * BRACKET_ROOM_SHARE)} px)`
    );
  }
  /** The finding without the generic remedy. */
  get finding(): string {
    return BracketFitError.findingFor(this.needPx, this.plotPx);
  }
}

function axisWithHeadroom(lo: number, hi: number, ph: number, need: number): AxisRange {
  if (!(need < ph * BRACKET_ROOM_SHARE)) throw new BracketFitError(need, ph);
  const halfSpan = hi / 2 - lo / 2 > 0 ? hi / 2 - lo / 2 : Math.max((Math.abs(hi) / 2) * 0.1, 0.5);
  let ax = axisRange(lo, hi, 5);
  for (let k = 0; k < 40; k++) {
    const room = ph * (1 - (hi / 2 - ax.mid) / ax.half);
    if (room >= need) return ax;
    // Half-space arithmetic: `hi + extra` overflows near 1.8e308.
    const topHalf = hi / 2 + halfSpan * (need / (ph - need)) * (1 + 0.25 * k);
    const top = topHalf * 2;
    if (!Number.isFinite(top)) break;
    ax = axisRange(lo, top, 5);
  }
  throw new RangeError("the y axis cannot be extended to fit the significance brackets (the data are too close to the largest representable number)");
}

/** Plan brackets only when some are given; null keeps the no-bracket path untouched. */
function planIfAny(b: ChartBrackets | undefined, groups: number, xOf: (k: number) => number | null): BracketPlan | null {
  if (!b || !b.set || !b.set.brackets || b.set.brackets.length === 0) return null;
  return planBrackets(b.set, groups, xOf, b.display);
}

const INK = "#111111";
const RULE = "#888888";
const FAINT = "#cccccc";
const PAPER = "#ffffff";
const BLUE = "#2563eb";
const RED = "#b91c1c";
const GREY = "#6b7280";

/**
 * A figure-style re-render (lib/figContext.ts): the canvas at the context's width and the height in proportion to the
 * builder's own aspect; outside a context the caller's size, unchanged.
 */
function canvasOf(w: number | undefined, h: number | undefined, def: { w: number; h: number }): { W: number; H: number } {
  const W0 = w ?? def.w;
  const H0 = h ?? def.h;
  const fctx = currentFigCtx();
  return fctx ? { W: fctx.width, H: Math.round((H0 * fctx.width) / W0) } : { W: W0, H: H0 };
}

/**
 * Row labels cut to `maxChars` with an ellipsis, and kept DISTINCT: two names with the same prefix ("income quintile
 * 1", "income quintile 2") cut at the end read the same, so a colliding label keeps its END ("inco…ntile 1"), and if
 * that still collides it is numbered.
 */
export function distinctLabels(labels: string[], maxChars: number): string[] {
  const m = Math.max(4, Math.floor(maxChars));
  const endCut = (s: string): string => (s.length > m ? s.slice(0, m - 1).trimEnd() + "…" : s);
  /** Cut in the middle keeping `head` characters of the start (0: only the end, "…disagree"). */
  const cutKeeping = (s: string, head: number): string => {
    if (s.length <= m) return s;
    const tail = m - 1 - head;
    return (head ? s.slice(0, head).trimEnd() : "") + "…" + s.slice(s.length - tail).trimStart();
  };
  // Collisions are counted on FROZEN copies (round 2): counting on the array being rewritten let the first of two
  // colliding labels change and the second then see no collision ("stron…gree" beside "strongly…"). A colliding group
  // takes the first cut that tells ALL of its labels apart (half start and half end, then more of the end, then the
  // end alone: "…ly agree" / "…disagree"), the same cut for every label of the group; numbered only when none does.
  const ends = labels.map(endCut);
  const count = (arr: string[], v: string): number => arr.filter((x) => x === v).length;
  const mids = ends.slice();
  const heads = [m - 1 - Math.floor((m - 1) / 2), Math.floor(m / 3), 2, 0];
  for (const e of new Set(ends)) {
    const group = ends.flatMap((x, i) => (x === e && labels[i].length > m ? [i] : []));
    if (count(ends, e) < 2 || group.length < 2) continue;
    for (const h of heads) {
      const cand = group.map((i) => cutKeeping(labels[i], h));
      const others = ends.filter((_, i) => !group.includes(i));
      if (new Set(cand).size === cand.length && cand.every((c) => !others.includes(c))) {
        group.forEach((i, k) => (mids[i] = cand[k]));
        break;
      }
      if (h === heads[heads.length - 1]) group.forEach((i) => (mids[i] = cutKeeping(labels[i], heads[0])));
    }
  }
  const out = mids.slice();
  const seen = new Map<string, number>();
  for (let i = 0; i < out.length; i++) {
    if (count(mids, mids[i]) > 1) {
      const k = (seen.get(out[i]) ?? 0) + 1;
      seen.set(out[i], k);
      const suffix = ` (${k})`;
      out[i] = labels[i].length + suffix.length <= m ? labels[i] + suffix : endCut(labels[i]).slice(0, Math.max(1, m - suffix.length - 1)) + "…" + suffix;
    }
  }
  return out;
}

export const BOX_CHART_SIZE = { w: 380, h: 280 };
export const FOREST_CHART_SIZE = { w: 400, h: 240 };
export const GROUPED_BAR_SIZE = { w: 380, h: 260 };

/**
 * XML-escape, AND remove characters XML cannot carry at all.
 *
 * Escaping `& < >` is not enough: a C0 control character is not representable
 * in XML 1.0 in any form, escaped or raw, so one in a label makes the whole
 * SVG not-well-formed. The pane's `innerHTML` preview is lenient and renders it
 * fine; `svgToPngBase64` is not, and rejects — so the chart looks perfect on
 * screen and the insert fails with "could not rasterize". Preview is not
 * insert, again.
 *
 * REACHABLE: two-way ANOVA takes its factor levels as raw user substrings, and
 * `statTwoWay` splits on `[\s,]+` which does not remove 0x00-0x08 or 0x0E-0x1F.
 * The realistic vector is 0x07 (BEL) — Word's own table-cell marker — which
 * arrives by pasting a cell out of a Word table as a factor level.
 *
 * Written with char codes rather than an escape class: this repo has shipped a
 * defect where backslash escapes were eaten on the way into the file and became
 * literal control characters, and it recurred twice during this campaign.
 */
const esc = (s: string): string => {
  let out = "";
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || (c >= 127 && c <= 159)) continue;
    out += ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch;
  }
  return out;
};

/** Significant figures without exponent noise, and never "NaN". */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return fmtSig(v, 2);
  return trueMinus(String(Number(v.toPrecision(4))));
}

/**
 * A chart that says why it is empty.
 *
 * An empty frame passes every well-formedness check and every layout audit —
 * "an empty page cannot overlap itself" is this repo's recorded worst gate
 * failure. So a builder that cannot draw says so ON the artwork, where the
 * reader sees it, rather than returning a blank that looks like a rendering
 * bug.
 */
function emptyChart(w: number, h: number, why: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${PAPER}"/>` +
    `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-family="Segoe UI, Arial" ` +
    `font-size="12" fill="${GREY}">${esc(why)}</text></svg>`
  );
}

/**
 * A plotting range that survives values near the ends of the double range.
 *
 * WHY THIS EXISTS. `hi - lo` overflows to `Infinity` for two finite values near
 * ±1.8e308, and every scale of the form `(v - lo) / span` is then
 * `Infinity / Infinity` = **NaN**, which goes straight into the markup and into
 * a Word document. `hBarSvg` has carried this guard since the Engineering
 * campaign (mechchart.ts:854); statchart did not inherit it.
 *
 * IT IS REACHABLE, and by an ordinary route rather than a contrived one: a RANK
 * test is immune to magnitude by construction, so Mann-Whitney on
 * `1.7e308 -1.7e308 1 2 3` returns a perfectly finite U, z and p. The
 * insertability gate sees clean text and enables the button; the box plot
 * beside it emits `cy="NaN"`. Kruskal-Wallis, Friedman and Wilcoxon are the
 * same shape.
 *
 * Halve into range rather than refuse, as hBarSvg does — the figure stays
 * proportionally true at half scale. `mid` is the pre-halved origin, so callers
 * scale with `(v/2 - mid)` and never re-form the overflowing difference.
 *
 * The SECOND failure this prevents is not a NaN: with a span of 3.4e308, a
 * `niceStep` of 1 satisfies its postcondition (finite, strictly positive) and
 * still yields 201 gridlines that are all the same pixel and 201 tick labels
 * that all read the same number. The step is derived from the HALVED span for
 * that reason.
 */
interface AxisRange {
  /** Half of the lower bound — callers compare against `v / 2`. */
  mid: number;
  /** Half of the span; always finite and strictly positive. */
  half: number;
  /** Tick positions in ORIGINAL units. */
  tickAt: number[];
  /** The label of each tick, index for index — one row, constant decimals. */
  tickLabel: string[];
  /** "" or "×10ⁿ" — belongs on the axis title (titleWithMultiplier). */
  multiplier: string;
}

function axisRange(lo: number, hi: number, targetTicks = 5): AxisRange {
  let l = Number.isFinite(lo) ? lo : 0;
  let h = Number.isFinite(hi) ? hi : 0;
  if (!(h > l)) {
    // A single distinct value needs a band to sit in.
    const pad = Math.abs(h) > 0 ? Math.abs(h) * 0.1 : 1;
    l -= pad;
    h += pad;
    // At ±1.7e308 the pad itself overflows; keep the band finite.
    if (!Number.isFinite(l) || !Number.isFinite(h)) {
      l = Number.isFinite(l) ? l : -Number.MAX_VALUE;
      h = Number.isFinite(h) ? h : Number.MAX_VALUE;
    }
  }
  // THE STEP IS CHOSEN ON THE FULL SPAN (axis.ts, loose extended Wilkinson),
  // never in half-space. Choosing a 1/2/5 step on the halved span and doubling
  // it is what produced steps of 4 (B.6: `0, 4, 8 … 20`). axis.ts normalises
  // the range by its power of ten before searching, so a 3.4e308 span neither
  // overflows nor collapses into 201 identical labels — the failure the old
  // half-space step existed to prevent.
  const row = linearAxis(l, h, { target: targetTicks, loose: true });
  // THE SCALE STAYS IN HALF-SPACE: `hi - lo` overflows near ±1.8e308, and
  // `(v/2 - mid) / half` never re-forms that difference. When the rounded-out
  // bounds would not fit (±1e308 rounded out is 2e308 = Infinity), linearAxis
  // keeps the exact ones.
  const axLo = Number.isFinite(row.lo) ? row.lo : l;
  const axHi = Number.isFinite(row.hi) ? row.hi : h;
  const mid = axLo / 2;
  let half = axHi / 2 - axLo / 2;
  if (!Number.isFinite(half) || half <= 0) half = 1;
  if (row.values.length >= 2) {
    return { mid, half, tickAt: row.values, tickLabel: row.labels, multiplier: row.multiplier };
  }
  return { mid, half, tickAt: [l, h], tickLabel: [fmtValue(l), fmtValue(h)], multiplier: "" };
}

/**
 * UNDER A FIGURE-STYLE RE-RENDER (round 2), an axis whose tick labels would run into each other at the canvas the
 * style chose takes fewer ticks: a lower tick-count target while that gives fewer, then every other tick (zero kept).
 * Measured with the layout audit's 0.58 em advance (`vertical`: the 0.78 em line height). As drawn: `make(5)`.
 */
function fitAxisTicks(make: (target: number) => AxisRange, pos: (ax: AxisRange, v: number) => number, fs: number, vertical = false): AxisRange {
  const crowded = (ax: AxisRange): boolean => {
    const p = ax.tickAt.map((v, i) => ({ p: pos(ax, v), w: vertical ? fs * 0.78 * 2 : ax.tickLabel[i].length * fs * 0.58 })).sort((a, b) => a.p - b.p);
    return p.some((t, i) => i > 0 && t.p - p[i - 1].p < (t.w + p[i - 1].w) / 2 + 3);
  };
  let ax = make(5);
  if (!currentFigCtx() || !crowded(ax)) return ax;
  for (let t = 4; t >= 2; t--) {
    const a = make(t);
    if (a.tickAt.length < ax.tickAt.length && a.tickAt.length >= 2) ax = a;
    if (!crowded(ax)) return ax;
  }
  for (let guard = 0; guard < 6 && crowded(ax) && ax.tickAt.length > 2; guard++) {
    const z = ax.tickAt.findIndex((v) => v === 0);
    const parity = z >= 0 ? z % 2 : 0;
    const keep = (_: unknown, i: number): boolean => i % 2 === parity;
    const tickAt = ax.tickAt.filter(keep);
    if (tickAt.length < 2) break;
    ax = { ...ax, tickAt, tickLabel: ax.tickLabel.filter(keep) };
  }
  return ax;
}

/** A title's lines: one as drawn; under a figure-style re-render, wrapped to the canvas (two lines at most). */
function titleLinesFor(title: string | undefined, room: number, fs: number): string[] {
  if (!title) return [];
  return currentFigCtx() ? wrapLabel(title, room, fs) : [title];
}

/**
 * The axis title with the row's ×10ⁿ, stated ONCE (never on every tick, where
 * it widens labels past a fixed margin and into the title). No title → the
 * multiplier alone takes the title's place.
 */
function titleWithMultiplier(title: string | undefined, multiplier: string): string | undefined {
  if (!multiplier) return title;
  return title ? `${title} (${multiplier})` : multiplier;
}

/** The five-number summary, plus whisker ends and the points beyond them. */
export interface BoxStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  loWhisker: number;
  hiWhisker: number;
  outliers: number[];
}

/**
 * Quartiles by linear interpolation (the "type 7" definition, which is what
 * R, NumPy and every spreadsheet use by default).
 *
 * Stated because quartiles are not one thing: there are nine published
 * definitions and they disagree on small samples, which is exactly where these
 * calculators are used. Naming the convention is the difference between a
 * reader reproducing the box and thinking the box is wrong.
 */
export function boxStats(values: number[]): BoxStats | null {
  const xs = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const q = (p: number): number => {
    const h = (xs.length - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    // Interpolate as a WEIGHTED MEAN, not `a + (b - a) * f`. The difference
    // form overflows for two values near opposite ends of the double range and
    // returns Infinity for a quartile of perfectly finite data. This form
    // stays finite and is identical for every ordinary input.
    const f = h - lo;
    return xs[lo] * (1 - f) + xs[hi] * f;
  };
  const q1 = q(0.25);
  const median = q(0.5);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  // Tukey's 1.5 x IQR fences. With a zero IQR (many tied values) the fences
  // collapse onto the quartiles, every distinct value becomes an "outlier",
  // and the box degenerates to a line - which is the honest picture of that
  // data, so it is drawn rather than special-cased away.
  const loFence = q1 - 1.5 * iqr;
  const hiFence = q3 + 1.5 * iqr;
  const inside = xs.filter((v) => v >= loFence && v <= hiFence);
  return {
    min: xs[0],
    q1,
    median,
    q3,
    max: xs[xs.length - 1],
    loWhisker: inside.length ? inside[0] : q1,
    hiWhisker: inside.length ? inside[inside.length - 1] : q3,
    outliers: xs.filter((v) => v < loFence || v > hiFence),
  };
}

export interface BoxGroup {
  label: string;
  values: number[];
}

/**
 * Box-and-whisker plot, one box per group, with the individual observations
 * drawn beside each box.
 *
 * THE POINTS ARE NOT DECORATION. A box plot alone cannot distinguish a
 * bimodal group from a uniform one — they can share all five summary numbers —
 * and these calculators are routinely run on the six or eight values where
 * that difference decides whether the test means anything. Showing the raw
 * observations is the check on the summary.
 */
export function boxPlotSvg(
  groups: BoxGroup[],
  opts: { title?: string; ylabel?: string; w?: number; h?: number; brackets?: ChartBrackets },
): string {
  const { W, H } = canvasOf(opts.w, opts.h, BOX_CHART_SIZE);
  // Twelve boxes is already a crowded 380px; beyond that the labels collide and
  // the figure stops being readable. The cap is stated on the artwork rather
  // than silently applied - a truncation nobody is told about reads as "that is
  // all the data there was".
  const CAP = 12;
  const shown = groups.slice(0, CAP);
  const clipped = groups.length - shown.length;

  const all = shown.flatMap((g) => g.values).filter(Number.isFinite);
  if (!shown.length || !all.length) {
    return emptyChart(W, H, "There are no finite values to chart");
  }

  const stats = shown.map((g) => boxStats(g.values));
  const ML = 52;
  const MR = 14;
  const tLines = titleLinesFor(opts.title, W - 8, 12);
  const MT = opts.title ? 26 + 15 * (tLines.length - 1) : 12;
  const pw = W - ML - MR;

  // WHEN THE SLOT IS NARROWER THAN THE LABEL, ROTATE. Measured against the
  // widest label actually present rather than against the group count: twelve
  // groups labelled "g1".."g12" fit horizontally and eight labelled
  // "condition 10" do not, so the count alone decides it wrongly. Labels are
  // truncated at 12 characters, so the crossover for a full-width label lands
  // at about five groups. ~5.4 px per character at 10px Segoe UI, plus a gap.
  const widest = Math.max(...shown.map((g) => Math.min(12, g.label.length)));
  const rotate = widest * 5.4 + 6 > pw / shown.length;
  // A vertical label needs its whole text length as room below the axis.
  const MB = rotate ? Math.min(104, 16 + widest * 5.4) : 44;
  const ph = H - MT - MB;

  // REDUCED, NOT SPREAD. `Math.min(...all)` throws RangeError past roughly
  // 125,000 arguments, and `all` is every observation the user pasted across
  // every group - which is exactly the size that reaches this builder from a
  // descriptive-statistics paste. A crash here is a dead pane, not a bad chart.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of all) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  // Overflow-safe: see axisRange. `v / 2 - ax.mid` never re-forms the
  // difference that would become Infinity.
  // Brackets (optional): planned on the same slot centres the boxes use; groups
  // beyond the 12-box cap have no centre and are counted in the clipped note.
  const bp = planIfAny(opts.brackets, groups.length, (k) => (k < shown.length ? ML + (pw / shown.length) * (k + 0.5) : null));
  const ax =
    bp && bp.levels
      ? axisWithHeadroom(lo, hi, ph, bp.heightPx)
      : fitAxisTicks((t) => axisRange(lo, hi, t), (a, v) => MT + ph - ((v / 2 - a.mid) / a.half) * ph, 10, true);
  const y = (v: number): number => MT + ph - ((v / 2 - ax.mid) / ax.half) * ph;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>`,
  ];
  tLines.forEach((line, i) =>
    parts.push(
      `<text data-figure-title="1" x="${W / 2}" y="${17 + 15 * i}" text-anchor="middle" font-family="Segoe UI, Arial" ` +
        `font-size="12" fill="${INK}">${esc(line)}</text>`,
    ),
  );

  for (const [ti, t] of ax.tickAt.entries()) {
    const yy = y(t);
    parts.push(`<line x1="${ML}" y1="${yy.toFixed(1)}" x2="${ML + pw}" y2="${yy.toFixed(1)}" stroke="${FAINT}" stroke-width="1"/>`);
    parts.push(
      `<text x="${ML - 6}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" ` +
        `font-family="Segoe UI, Arial" font-size="10" fill="${GREY}">${esc(ax.tickLabel[ti])}</text>`,
    );
  }
  parts.push(`<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + ph}" stroke="${RULE}" stroke-width="1"/>`);
  parts.push(`<line x1="${ML}" y1="${MT + ph}" x2="${ML + pw}" y2="${MT + ph}" stroke="${RULE}" stroke-width="1"/>`);
  const yTitle = titleWithMultiplier(opts.ylabel, ax.multiplier);
  if (yTitle) {
    parts.push(
      `<text x="12" y="${MT + ph / 2}" text-anchor="middle" font-family="Segoe UI, Arial" ` +
        `font-size="10" fill="${INK}" transform="rotate(-90 12 ${MT + ph / 2})">${esc(yTitle)}</text>`,
    );
  }

  const slot = pw / shown.length;
  const bw = Math.min(38, slot * 0.5);
  shown.forEach((g, i) => {
    const s = stats[i];
    const cx = ML + slot * (i + 0.5);
    if (!s) return;
    // Whisker, box, median.
    parts.push(`<line x1="${cx.toFixed(1)}" y1="${y(s.hiWhisker).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${y(s.loWhisker).toFixed(1)}" stroke="${INK}" stroke-width="1"/>`);
    for (const v of [s.loWhisker, s.hiWhisker]) {
      parts.push(`<line x1="${(cx - bw / 4).toFixed(1)}" y1="${y(v).toFixed(1)}" x2="${(cx + bw / 4).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${INK}" stroke-width="1"/>`);
    }
    const yTop = y(s.q3);
    const yBot = y(s.q1);
    parts.push(
      `<rect x="${(cx - bw / 2).toFixed(1)}" y="${Math.min(yTop, yBot).toFixed(1)}" width="${bw.toFixed(1)}" ` +
        `height="${Math.max(1, Math.abs(yBot - yTop)).toFixed(1)}" fill="${PAPER}" stroke="${BLUE}" stroke-width="1.5"/>`,
    );
    parts.push(`<line x1="${(cx - bw / 2).toFixed(1)}" y1="${y(s.median).toFixed(1)}" x2="${(cx + bw / 2).toFixed(1)}" y2="${y(s.median).toFixed(1)}" stroke="${RED}" stroke-width="2"/>`);

    // The observations. Spread across the box width by INDEX, not at random:
    // a chart must be identical every time it is drawn from the same data, or
    // the same result inserted twice gives two different pictures.
    // 60 points drawn at most — and the count below says so when it bites.
    // Printing `n=200` beside sixty dots is the figure contradicting its own
    // caption, which is the defect already fixed once on the Wilcoxon box.
    const finiteVals = g.values.filter(Number.isFinite);
    const pts = finiteVals.slice(0, 60);
    pts.forEach((v, k) => {
      const off = pts.length === 1 ? 0 : ((k % 5) - 2) * (bw / 6);
      const isOut = s.outliers.includes(v);
      parts.push(
        `<circle cx="${(cx + off).toFixed(1)}" cy="${y(v).toFixed(1)}" r="1.8" ` +
          `fill="${isOut ? RED : GREY}" fill-opacity="0.75"/>`,
      );
    });

    const label = g.label.slice(0, 12);
    const n = finiteVals.length;
    const nText = pts.length < n ? `n=${n} (${pts.length} shown)` : `n=${n}`;
    if (rotate) {
      // ROTATED, because horizontal labels COLLIDE once the groups get narrow.
      // Found by the figure-layout corpus, not by eye: twelve groups labelled
      // "condition 1" … "condition 12" produced 22 overlapping label pairs, and
      // every one renders as unreadable mush in a document.
      //
      // -90 AND NOT -45, WHICH WAS THE FIRST ATTEMPT AND MADE IT WORSE (22
      // collisions became 34). Two reasons, and only one of them is about the
      // picture. A 45-degree label still advances horizontally by most of its
      // own width, so at a 26px slot it overlaps its neighbour anyway; and the
      // layout auditor only models `rotate(-90`, so a 45-degree label is
      // measured as though it were horizontal. Fighting the instrument instead
      // of the layout would have produced a figure that scores well and reads
      // badly.
      //
      // The n is dropped here rather than appended: a longer string is a taller
      // rotated box, and the count is already in the result text beside the
      // figure.
      // ANCHORED AT ITS MIDDLE, and pushed down by half its own length. With
      // `end` anchoring the glyphs run downward from the anchor while the
      // layout auditor models a rotated label as CENTRED on it, so the drawn
      // text and the measured box were two different rectangles — the auditor
      // then reported the axis line striking through every label, and moving
      // the label to satisfy it would have moved the real text somewhere else
      // again. Centring makes the two agree, so what the gate measures is what
      // a reader sees.
      const ly = MT + ph + 6 + (label.length * 5.4) / 2;
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" ` +
          `font-family="Segoe UI, Arial" font-size="9" fill="${INK}" ` +
          `transform="rotate(-90 ${cx.toFixed(1)} ${ly.toFixed(1)})">${esc(label)}</text>`,
      );
    } else {
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${MT + ph + 14}" text-anchor="middle" ` +
          `font-family="Segoe UI, Arial" font-size="10" fill="${INK}">${esc(label)}</text>`,
      );
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${MT + ph + 26}" text-anchor="middle" ` +
          `font-family="Segoe UI, Arial" font-size="9" fill="${GREY}">${esc(nText)}</text>`,
      );
    }
  });

  if (bp && bp.items.length) parts.push(bracketMarkup(bp, y(hi), INK));

  if (clipped > 0) {
    const off = bp && bp.offChart ? `; ${bp.offChart} bracket(s) involve them` : "";
    parts.push(
      `<text x="${W - MR}" y="${H - 6}" text-anchor="end" font-family="Segoe UI, Arial" ` +
        `font-size="9" fill="${RED}">${clipped} more group(s) not shown${off}</text>`,
    );
  }
  parts.push("</svg>");
  return parts.join("");
}

export interface ForestRow {
  label: string;
  estimate: number;
  low: number;
  high: number;
}

/**
 * A forest plot of comparisons against a reference line.
 *
 * THE REFERENCE LINE IS THE ANSWER. For a difference of means the null value is
 * 0; an interval that crosses it is a comparison the data cannot resolve, and
 * that is a fact about EVERY row at once, which is precisely what a table of
 * numbers makes the reader assemble in their head.
 *
 * `zero` is a parameter rather than a constant because a ratio comparison
 * (a hazard ratio, an odds ratio) is null at 1, not at 0. Drawing the line at 0
 * for those would mark every interval as significant.
 *
 * `log: true` draws a RATIO on a log₁₀ axis (reference defaults to 1). On a
 * linear axis HR 0.5 and HR 2 are not equidistant from 1 and every protective
 * effect looks small — a wrong figure that looks right (scope §E8, finding 7).
 * A value ≤ 0 cannot sit on a log axis and is REFUSED BY NAME on the artwork,
 * never dropped. The linear path is byte-identical to what it always was.
 */
export function forestPlotSvg(
  rows: ForestRow[],
  opts: { title?: string; xlabel?: string; zero?: number; w?: number; log?: boolean; maxRows?: number },
): string {
  if (opts.log) return forestPlotLogSvg(rows, opts);
  const W = canvasOf(opts.w, undefined, FOREST_CHART_SIZE).W;
  const bw = currentFigCtx()?.bw === true;
  // maxRows (v2.206.0, the meta-analysis forest: every study plus the pooled rows): default 14, at most 40.
  const CAP = Math.min(40, Math.max(1, opts.maxRows ?? 14));
  const shown = rows.slice(0, CAP);
  const clipped = rows.length - shown.length;
  const ROW_H = 20;
  // Under a figure-style re-render the title and the axis title wrap to the canvas (titleLinesFor; as drawn, one line).
  const tLines = titleLinesFor(opts.title, W - 8, 12);
  const MT = opts.title ? 28 + 15 * (tLines.length - 1) : 14;
  let MB = 40;
  let H = MT + Math.max(1, shown.length) * ROW_H + MB;

  const zero = Number.isFinite(opts.zero as number) ? (opts.zero as number) : 0;
  const finite = shown.filter(
    (r) => Number.isFinite(r.estimate) && Number.isFinite(r.low) && Number.isFinite(r.high),
  );
  if (!finite.length) return emptyChart(W, H, "No finite intervals to chart");

  // Row labels at 5.8 px per character (10 px face), cut with an ellipsis to the margin they get and kept distinct
  // (distinctLabels): a long name ran off the left edge, and two names cut at 26 characters read the same.
  const longest = Math.max(...shown.map((r) => r.label.length));
  const ML = Math.min(150, W * 0.4, Math.max(64, longest * 5.8 + 12));
  const rowLabels = distinctLabels(
    shown.map((r) => r.label),
    (ML - 10) / 5.8,
  );
  const MR = 18;
  const pw = W - ML - MR;

  const lo = Math.min(zero, ...finite.map((r) => r.low));
  const hi = Math.max(zero, ...finite.map((r) => r.high));
  const ax = fitAxisTicks((t) => axisRange(lo, hi, t), (a, v) => ML + ((v / 2 - a.mid) / a.half) * pw, 10);
  const x = (v: number): number => ML + ((v / 2 - ax.mid) / ax.half) * pw;
  const xTitle = titleWithMultiplier(opts.xlabel, ax.multiplier);
  const xLines = titleLinesFor(xTitle, 2 * Math.min(ML + pw / 2, W - ML - pw / 2) - 4, 10);
  MB += 13 * Math.max(0, xLines.length - 1);
  H += 13 * Math.max(0, xLines.length - 1);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>`,
  ];
  tLines.forEach((line, i) =>
    parts.push(
      `<text data-figure-title="1" x="${W / 2}" y="${18 + 15 * i}" text-anchor="middle" font-family="Segoe UI, Arial" ` +
        `font-size="12" fill="${INK}">${esc(line)}</text>`,
    ),
  );

  const yBase = MT + shown.length * ROW_H;
  for (const [ti, t] of ax.tickAt.entries()) {
    parts.push(
      `<text x="${x(t).toFixed(1)}" y="${yBase + 15}" text-anchor="middle" ` +
        `font-family="Segoe UI, Arial" font-size="10" fill="${GREY}">${esc(ax.tickLabel[ti])}</text>`,
    );
  }
  parts.push(`<line x1="${ML}" y1="${yBase}" x2="${ML + pw}" y2="${yBase}" stroke="${RULE}" stroke-width="1"/>`);
  // The null line, drawn dashed and behind the intervals.
  parts.push(
    `<line x1="${x(zero).toFixed(1)}" y1="${MT - 4}" x2="${x(zero).toFixed(1)}" y2="${yBase}" ` +
      `stroke="${RED}" stroke-width="1" stroke-dasharray="4 3"/>`,
  );

  shown.forEach((r, i) => {
    const cy = MT + ROW_H * i + ROW_H / 2;
    parts.push(
      `<text x="${ML - 8}" y="${(cy + 3.5).toFixed(1)}" text-anchor="end" ` +
        `font-family="Segoe UI, Arial" font-size="10" fill="${INK}">${esc(rowLabels[i])}</text>`,
    );
    if (!Number.isFinite(r.estimate) || !Number.isFinite(r.low) || !Number.isFinite(r.high)) {
      parts.push(
        `<text x="${ML + 6}" y="${(cy + 3.5).toFixed(1)}" font-family="Segoe UI, Arial" ` +
          `font-size="9" fill="${GREY}">not estimable</text>`,
      );
      return;
    }
    // Crossing the null line is the whole question, so it is what sets colour (in black and white: an open marker).
    const crosses = r.low <= zero && r.high >= zero;
    const c = crosses ? GREY : BLUE;
    parts.push(`<line x1="${x(r.low).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${x(r.high).toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${c}" stroke-width="1.5"/>`);
    for (const v of [r.low, r.high]) {
      parts.push(`<line x1="${x(v).toFixed(1)}" y1="${(cy - 4).toFixed(1)}" x2="${x(v).toFixed(1)}" y2="${(cy + 4).toFixed(1)}" stroke="${c}" stroke-width="1.5"/>`);
    }
    parts.push(
      bw && crosses
        ? `<circle cx="${x(r.estimate).toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="#fff" stroke="#000" stroke-width="1.2"/>`
        : `<circle cx="${x(r.estimate).toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="${c}"/>`,
    );
  });

  xLines.forEach((line, i) =>
    parts.push(
      `<text x="${ML + pw / 2}" y="${H - 8 - 13 * (xLines.length - 1 - i)}" text-anchor="middle" ` +
        `font-family="Segoe UI, Arial" font-size="10" fill="${INK}">${esc(line)}</text>`,
    ),
  );
  if (clipped > 0) {
    parts.push(
      `<text x="${W - MR}" y="${H - 8}" text-anchor="end" font-family="Segoe UI, Arial" ` +
        `font-size="9" fill="${RED}">${clipped} more not shown</text>`,
    );
  }
  parts.push("</svg>");
  return parts.join("");
}

/** The decade axis a log-scale forest plot is drawn on. */
export interface ForestLogAxis {
  /** Axis ends as decade exponents: the axis runs 10^decLo … 10^decHi. */
  decLo: number;
  decHi: number;
  /** Decade ticks (labelled): 0.1, 1, 10 … */
  major: number[];
  /** 2…9 × each decade, inside the axis (a gridline-length tick, no label unless in `labelled`). */
  minor: number[];
  /** Every tick that carries a label, with its text. */
  labelled: { v: number; text: string }[];
}

/** More decades than this and a forest plot is not a picture of anything. */
export const FOREST_LOG_MAX_DECADES = 12;

/**
 * The log axis for ratios spanning [lo, hi] (both > 0): rounded OUT to whole
 * decades so the ticks are 10ᵏ; when it spans one or two decades only, the
 * minor ticks at 2 and 5 are labelled too (0.1, 0.2, 0.5, 1, …) — otherwise a
 * HR of 0.68 would sit between two labels a factor of ten apart. A domain that
 * sits on a single power of ten (every interval exactly 1) is widened to a
 * decade each side. A value ≤ 0 or non-finite is refused by the caller.
 */
export function forestLogAxis(lo: number, hi: number): ForestLogAxis | { error: string } {
  if (!(lo > 0) || !(hi > 0) || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    return { error: "a log axis needs finite positive values" };
  }
  // `+ 0` turns Math.ceil's −0 (ceil(−1e−12)) into 0.
  let decLo = Math.floor(Math.log10(lo) + 1e-12) + 0;
  let decHi = Math.ceil(Math.log10(hi) - 1e-12) + 0;
  if (decHi <= decLo) {
    decLo -= 1;
    decHi += 1;
  }
  if (decHi - decLo > FOREST_LOG_MAX_DECADES) {
    return { error: `the intervals span ${decHi - decLo} decades (more than ${FOREST_LOG_MAX_DECADES})` };
  }
  const t = logDecades(decLo, decHi);
  const fewDecades = decHi - decLo <= 2;
  // ONE NOTATION PER AXIS (B.7): three decades or more read 10ⁿ throughout,
  // 10⁰ included, as journals set them; fewer stay plain while every decade is
  // an ordinary number (10⁻³ … 10³).
  const uniform = !fewDecades || decLo < -3 || decHi > 3;
  const labelled = t.major.map((v) => ({ v, text: uniform ? decadeLabel(v) : fmtValue(v) }));
  if (fewDecades) {
    for (const v of t.minor) {
      const e = Math.floor(Math.log10(v) + 1e-12);
      const m = Math.round(v / Math.pow(10, e));
      if (m === 2 || m === 5) {
        labelled.push({ v, text: uniform ? `${m}${decadeLabel(Math.pow(10, e)).replace(/^10/, "×10")}` : String(Number(v.toPrecision(6))) });
      }
    }
    labelled.sort((a, b) => a.v - b.v);
  }
  return { decLo, decHi, major: t.major, minor: t.minor, labelled };
}

/** forestPlotSvg's log-axis path (see `log` there). */
function forestPlotLogSvg(
  rows: ForestRow[],
  opts: { title?: string; xlabel?: string; zero?: number; w?: number; maxRows?: number },
): string {
  const W = canvasOf(opts.w, undefined, FOREST_CHART_SIZE).W;
  const bw = currentFigCtx()?.bw === true;
  const CAP = Math.min(40, Math.max(1, opts.maxRows ?? 14));
  const shown = rows.slice(0, CAP);
  const clipped = rows.length - shown.length;
  const ROW_H = 20;
  const tLines = titleLinesFor(opts.title, W - 8, 12);
  const MT = opts.title ? 28 + 15 * (tLines.length - 1) : 14;
  let H = MT + Math.max(1, shown.length) * ROW_H + 40;

  const ref = Number.isFinite(opts.zero as number) ? (opts.zero as number) : 1;
  if (!(ref > 0)) return emptyChart(W, H, `Log axis: the reference line ${fmt(ref)} is not positive`);
  const finite = shown.filter(
    (r) => Number.isFinite(r.estimate) && Number.isFinite(r.low) && Number.isFinite(r.high),
  );
  if (!finite.length) return emptyChart(W, H, "No finite intervals to chart");
  // REFUSED BY NAME: a ratio ≤ 0 is not a ratio, and dropping it would draw
  // the other rows as if it were not there.
  for (const r of finite) {
    for (const v of [r.low, r.estimate, r.high]) {
      if (!(v > 0)) {
        return emptyChart(W, H, `Log axis cannot show ${r.label.slice(0, 40)}: ${fmt(v)} is not positive`);
      }
    }
  }
  const lo = Math.min(ref, ...finite.map((r) => r.low));
  const hi = Math.max(ref, ...finite.map((r) => r.high));
  const ax = forestLogAxis(lo, hi);
  if ("error" in ax) return emptyChart(W, H, `Log axis: ${ax.error}`);

  // Row labels are sized at 5.8 px per character (10 px face) and cut with an
  // ellipsis to the margin they get — a long covariate name ("financial aid
  // received at release") must never run off the left edge of the picture.
  const longest = Math.max(...shown.map((r) => r.label.length));
  const ML = Math.min(170, W * 0.4, Math.max(64, longest * 5.8 + 12));
  const maxChars = Math.max(4, Math.floor((ML - 10) / 5.8));
  const distinct = distinctLabels(
    shown.map((r) => r.label),
    maxChars,
  );
  const rowLabel = (_s: string, i: number): string => distinct[i];
  const MR = 18;
  const pw = W - ML - MR;
  const span = ax.decHi - ax.decLo;
  const x = (v: number): number => ML + ((Math.log10(v) - ax.decLo) / span) * pw;
  // Under a figure-style re-render: crowded decade labels thinned (every other, 1 kept), the axis title wrapped.
  let labelled = ax.labelled;
  if (currentFigCtx()) {
    const crowded = (ls: { v: number; text: string }[]): boolean =>
      ls.some((l, i) => i > 0 && x(l.v) - x(ls[i - 1].v) < ((l.text.length + ls[i - 1].text.length) * 10 * 0.58) / 2 + 3);
    for (let guard = 0; guard < 6 && labelled.length > 2 && crowded(labelled); guard++) {
      const one = labelled.findIndex((l) => l.v === 1);
      const parity = one >= 0 ? one % 2 : 0;
      labelled = labelled.filter((_, i) => i % 2 === parity);
    }
  }
  // " (log scale)" is appended only when the caller's title does not already say it (v2.206.0 review: the clinical
  // forests printed "(log scale) (log scale)"). No earlier caller's title says it, so their figures are unchanged.
  const xBase = opts.xlabel ?? "ratio";
  const xText = /log scale/i.test(xBase) ? xBase : `${xBase} (log scale)`;
  const xLines = titleLinesFor(xText, 2 * Math.min(ML + pw / 2, W - ML - pw / 2) - 4, 10);
  H += 13 * Math.max(0, xLines.length - 1);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>`,
  ];
  tLines.forEach((line, i) =>
    parts.push(
      `<text data-figure-title="1" x="${W / 2}" y="${18 + 15 * i}" text-anchor="middle" font-family="Segoe UI, Arial" ` +
        `font-size="12" fill="${INK}">${esc(line)}</text>`,
    ),
  );
  const yBase = MT + shown.length * ROW_H;
  // Decade gridlines (faint) and minor ticks on the baseline.
  for (const v of ax.major) {
    parts.push(
      `<line x1="${x(v).toFixed(1)}" y1="${MT - 4}" x2="${x(v).toFixed(1)}" y2="${yBase + 5}" stroke="${FAINT}" stroke-width="1"/>`,
    );
  }
  for (const v of ax.minor) {
    parts.push(
      `<line x1="${x(v).toFixed(1)}" y1="${yBase}" x2="${x(v).toFixed(1)}" y2="${yBase + 3}" stroke="${RULE}" stroke-width="1"/>`,
    );
  }
  for (const l of labelled) {
    parts.push(
      `<text x="${x(l.v).toFixed(1)}" y="${yBase + 15}" text-anchor="middle" ` +
        `font-family="Segoe UI, Arial" font-size="10" fill="${GREY}">${esc(l.text)}</text>`,
    );
  }
  parts.push(`<line x1="${ML}" y1="${yBase}" x2="${ML + pw}" y2="${yBase}" stroke="${RULE}" stroke-width="1"/>`);
  parts.push(
    `<line x1="${x(ref).toFixed(1)}" y1="${MT - 4}" x2="${x(ref).toFixed(1)}" y2="${yBase}" ` +
      `stroke="${RED}" stroke-width="1" stroke-dasharray="4 3"/>`,
  );

  shown.forEach((r, i) => {
    const cy = MT + ROW_H * i + ROW_H / 2;
    parts.push(
      `<text x="${ML - 8}" y="${(cy + 3.5).toFixed(1)}" text-anchor="end" ` +
        `font-family="Segoe UI, Arial" font-size="10" fill="${INK}">${esc(rowLabel(r.label, i))}</text>`,
    );
    if (!Number.isFinite(r.estimate) || !Number.isFinite(r.low) || !Number.isFinite(r.high)) {
      parts.push(
        `<text x="${ML + 6}" y="${(cy + 3.5).toFixed(1)}" font-family="Segoe UI, Arial" ` +
          `font-size="9" fill="${GREY}">not estimable</text>`,
      );
      return;
    }
    const crosses = r.low <= ref && r.high >= ref;
    const c = crosses ? GREY : BLUE;
    parts.push(`<line x1="${x(r.low).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${x(r.high).toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${c}" stroke-width="1.5"/>`);
    for (const v of [r.low, r.high]) {
      parts.push(`<line x1="${x(v).toFixed(1)}" y1="${(cy - 4).toFixed(1)}" x2="${x(v).toFixed(1)}" y2="${(cy + 4).toFixed(1)}" stroke="${c}" stroke-width="1.5"/>`);
    }
    parts.push(
      bw && crosses
        ? `<circle cx="${x(r.estimate).toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="#fff" stroke="#000" stroke-width="1.2"/>`
        : `<circle cx="${x(r.estimate).toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="${c}"/>`,
    );
  });

  xLines.forEach((line, i) =>
    parts.push(
      `<text x="${ML + pw / 2}" y="${H - 8 - 13 * (xLines.length - 1 - i)}" text-anchor="middle" ` +
        `font-family="Segoe UI, Arial" font-size="10" fill="${INK}">${esc(line)}</text>`,
    ),
  );
  if (clipped > 0) {
    parts.push(
      `<text x="${W - MR}" y="${H - 8}" text-anchor="end" font-family="Segoe UI, Arial" ` +
        `font-size="9" fill="${RED}">${clipped} more not shown</text>`,
    );
  }
  parts.push("</svg>");
  return parts.join("");
}

export interface BarSeries {
  label: string;
  values: number[];
  colour?: string;
}

/**
 * Grouped bars — built for observed against expected.
 *
 * A chi-square statistic is a single number summarising where a table departs
 * from what the model predicted, and it cannot say WHERE. Drawing the two
 * side by side answers that directly: the reader sees which category carries
 * the discrepancy, which is the question they asked the test in order to
 * approximate.
 */
export function groupedBarSvg(
  categories: string[],
  // eslint-disable-next-line prefer-const
  series: BarSeries[],
  opts: { title?: string; ylabel?: string; w?: number; h?: number; brackets?: ChartBrackets },
): string {
  const { W, H } = canvasOf(opts.w, opts.h, GROUPED_BAR_SIZE);
  const CAP = 16;
  const cats = categories.slice(0, CAP);
  const clipped = categories.length - cats.length;
  // THE SERIES CAP HAPPENS FIRST. It used to be applied 44 lines below this,
  // after `vals` had already spread every series into Math.max — and a spread
  // of ~128,000 arguments is a RangeError, not a slow chart.
  const SERIES_CAP = 8;
  const droppedSeries = Math.max(0, series.length - SERIES_CAP);
  series = series.slice(0, SERIES_CAP);
  const vals = series.flatMap((s) => s.values.slice(0, CAP)).filter(Number.isFinite);
  if (!cats.length || !series.length || !vals.length) {
    return emptyChart(W, H, "There are no finite values to chart");
  }

  const ML = 50;
  const MR = 12;
  const tLines = titleLinesFor(opts.title, W - 8, 12);
  const MT = opts.title ? 26 + 15 * (tLines.length - 1) : 12;
  const MB = 46;
  const pw = W - ML - MR;
  const ph = H - MT - MB;

  let hi = 0;
  let lo = 0;
  for (const v of vals) {
    if (v > hi) hi = v;
    if (v < lo) lo = v;
  }
  // Brackets compare CATEGORIES (bars of a one-series means chart); categories
  // beyond the 16 cap have no centre and are counted in the clipped note.
  const bp = planIfAny(opts.brackets, categories.length, (k) => (k < cats.length ? ML + (pw / cats.length) * (k + 0.5) : null));
  const ax =
    bp && bp.levels
      ? axisWithHeadroom(lo, hi, ph, bp.heightPx)
      : fitAxisTicks((t) => axisRange(lo, hi, t), (a, v) => MT + ph - ((v / 2 - a.mid) / a.half) * ph, 10, true);
  const y = (v: number): number => MT + ph - ((v / 2 - ax.mid) / ax.half) * ph;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>`,
  ];
  tLines.forEach((line, i) =>
    parts.push(
      `<text data-figure-title="1" x="${W / 2}" y="${17 + 15 * i}" text-anchor="middle" font-family="Segoe UI, Arial" ` +
        `font-size="12" fill="${INK}">${esc(line)}</text>`,
    ),
  );
  for (const [ti, t] of ax.tickAt.entries()) {
    const yy = y(t);
    parts.push(`<line x1="${ML}" y1="${yy.toFixed(1)}" x2="${ML + pw}" y2="${yy.toFixed(1)}" stroke="${FAINT}" stroke-width="1"/>`);
    parts.push(
      `<text x="${ML - 6}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" ` +
        `font-family="Segoe UI, Arial" font-size="10" fill="${GREY}">${esc(ax.tickLabel[ti])}</text>`,
    );
  }
  parts.push(`<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + ph}" stroke="${RULE}" stroke-width="1"/>`);
  parts.push(`<line x1="${ML}" y1="${y(0).toFixed(1)}" x2="${ML + pw}" y2="${y(0).toFixed(1)}" stroke="${RULE}" stroke-width="1"/>`);
  const yTitle = titleWithMultiplier(opts.ylabel, ax.multiplier);
  if (yTitle) {
    parts.push(
      `<text x="12" y="${MT + ph / 2}" text-anchor="middle" font-family="Segoe UI, Arial" ` +
        `font-size="10" fill="${INK}" transform="rotate(-90 12 ${MT + ph / 2})">${esc(yTitle)}</text>`,
    );
  }

  // EIGHT DISTINCT COLOURS, AND A HARD CAP AT EIGHT SERIES.
  //
  // The palette had four and the series count was unbounded, so a two-way ANOVA
  // with six levels of factor B drew levels 1 and 5 in the same blue and 2 and 6
  // in the same red. On an interaction plot the colour IS the mapping, so two
  // levels sharing one is not a cosmetic clash — the figure stops being
  // readable as data. Capping and saying so beats drawing a lie quietly.
  // Eight distinct colours, one per capped series: two levels sharing a colour
  // on an interaction plot is not a clash, it is a wrong figure.
  const palette = [BLUE, RED, "#059669", "#d97706", "#7c3aed", "#0891b2", "#be185d", "#4d7c0f"];
  const slot = pw / cats.length;
  const bw = Math.max(2, Math.min(18, (slot * 0.7) / series.length));
  // Category names cut at 10 characters with an ellipsis (they were cut with none) and kept distinct; under a
  // figure-style re-render, to what the slot holds at 9 px (round 2: they ran into each other at a narrow column).
  const catLabels = distinctLabels(cats, currentFigCtx() ? Math.min(10, Math.floor((slot - 4) / (9 * 0.58))) : 10);
  cats.forEach((cat, i) => {
    const cx = ML + slot * (i + 0.5);
    series.forEach((s, k) => {
      const v = s.values[i];
      if (!Number.isFinite(v)) return;
      const x0 = cx - (series.length * bw) / 2 + k * bw;
      const yv = y(v);
      const y0 = y(0);
      parts.push(
        `<rect x="${x0.toFixed(1)}" y="${Math.min(yv, y0).toFixed(1)}" width="${bw.toFixed(1)}" ` +
          `height="${Math.max(1, Math.abs(y0 - yv)).toFixed(1)}" fill="${s.colour ?? palette[k % palette.length]}"/>`,
      );
    });
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${MT + ph + 14}" text-anchor="middle" ` +
        `font-family="Segoe UI, Arial" font-size="9" fill="${INK}">${esc(catLabels[i] ?? cat)}</text>`,
    );
  });

  // The legend goes UNDER the plot frame, not inside it: a legend drawn over
  // the artwork lands on top of whichever bar happens to be tallest.
  series.forEach((s, k) => {
    const lx = ML + k * Math.min(110, pw / series.length);
    parts.push(`<rect x="${lx}" y="${H - 16}" width="9" height="9" fill="${s.colour ?? palette[k % palette.length]}"/>`);
    parts.push(
      `<text x="${lx + 13}" y="${H - 8}" font-family="Segoe UI, Arial" font-size="10" ` +
        `fill="${INK}">${esc(s.label.slice(0, 16))}</text>`,
    );
  });
  if (bp && bp.items.length) parts.push(bracketMarkup(bp, y(hi), INK));
  const notes: string[] = [];
  if (clipped > 0) notes.push(`${clipped} more category(s) not shown`);
  if (bp && bp.offChart > 0) notes.push(`${bp.offChart} bracket(s) involve them`);
  if (droppedSeries > 0) notes.push(`${droppedSeries} more series not shown`);
  if (notes.length) {
    parts.push(
      `<text x="${W - MR}" y="${MT + ph + 26}" text-anchor="end" font-family="Segoe UI, Arial" ` +
        `font-size="9" fill="${RED}">${esc(notes.join(", "))}</text>`,
    );
  }
  parts.push("</svg>");
  return parts.join("");
}
