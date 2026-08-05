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
// `niceStep` and `ticks` are imported rather than reimplemented. Both carry
// hard-won postconditions — a step that is finite and strictly positive, and a
// tick list that is a BOUNDED ARRAY rather than an open `t += step` loop. A
// second copy of that logic is a second chance to get it wrong, and getting it
// wrong here does not produce a bad chart, it produces a frozen Word.

import { niceStep, ticks } from "./mechchart";

const INK = "#111111";
const RULE = "#888888";
const FAINT = "#cccccc";
const PAPER = "#ffffff";
const BLUE = "#2563eb";
const RED = "#b91c1c";
const GREY = "#6b7280";

export const BOX_CHART_SIZE = { w: 380, h: 280 };
export const FOREST_CHART_SIZE = { w: 400, h: 240 };
export const GROUPED_BAR_SIZE = { w: 380, h: 260 };

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Significant figures without exponent noise, and never "NaN". */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(1);
  return String(Number(v.toPrecision(4)));
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
    return xs[lo] + (xs[hi] - xs[lo]) * (h - lo);
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
  opts: { title?: string; ylabel?: string; w?: number; h?: number },
): string {
  const W = opts.w ?? BOX_CHART_SIZE.w;
  const H = opts.h ?? BOX_CHART_SIZE.h;
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
  const MT = opts.title ? 26 : 12;
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

  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (!(hi > lo)) {
    // A single distinct value: give it a band so the box has somewhere to sit.
    const pad = Math.abs(hi) > 0 ? Math.abs(hi) * 0.1 : 1;
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, 5);
  const axLo = Math.floor(lo / step) * step;
  const axHi = Math.ceil(hi / step) * step;
  const span = axHi - axLo || 1;
  const y = (v: number): number => MT + ph - ((v - axLo) / span) * ph;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>`,
  ];
  if (opts.title) {
    parts.push(
      `<text x="${W / 2}" y="17" text-anchor="middle" font-family="Segoe UI, Arial" ` +
        `font-size="12" fill="${INK}">${esc(opts.title)}</text>`,
    );
  }

  for (const t of ticks(axLo, axHi, step)) {
    const yy = y(t);
    parts.push(`<line x1="${ML}" y1="${yy.toFixed(1)}" x2="${ML + pw}" y2="${yy.toFixed(1)}" stroke="${FAINT}" stroke-width="1"/>`);
    parts.push(
      `<text x="${ML - 6}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" ` +
        `font-family="Segoe UI, Arial" font-size="10" fill="${GREY}">${esc(fmt(t))}</text>`,
    );
  }
  parts.push(`<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + ph}" stroke="${RULE}" stroke-width="1"/>`);
  parts.push(`<line x1="${ML}" y1="${MT + ph}" x2="${ML + pw}" y2="${MT + ph}" stroke="${RULE}" stroke-width="1"/>`);
  if (opts.ylabel) {
    parts.push(
      `<text x="12" y="${MT + ph / 2}" text-anchor="middle" font-family="Segoe UI, Arial" ` +
        `font-size="10" fill="${INK}" transform="rotate(-90 12 ${MT + ph / 2})">${esc(opts.ylabel)}</text>`,
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
    const pts = g.values.filter(Number.isFinite).slice(0, 60);
    pts.forEach((v, k) => {
      const off = pts.length === 1 ? 0 : ((k % 5) - 2) * (bw / 6);
      const isOut = s.outliers.includes(v);
      parts.push(
        `<circle cx="${(cx + off).toFixed(1)}" cy="${y(v).toFixed(1)}" r="1.8" ` +
          `fill="${isOut ? RED : GREY}" fill-opacity="0.75"/>`,
      );
    });

    const label = g.label.slice(0, 12);
    const n = g.values.filter(Number.isFinite).length;
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
          `font-family="Segoe UI, Arial" font-size="9" fill="${GREY}">n=${n}</text>`,
      );
    }
  });

  if (clipped > 0) {
    parts.push(
      `<text x="${W - MR}" y="${H - 6}" text-anchor="end" font-family="Segoe UI, Arial" ` +
        `font-size="9" fill="${RED}">${clipped} more group(s) not shown</text>`,
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
 */
export function forestPlotSvg(
  rows: ForestRow[],
  opts: { title?: string; xlabel?: string; zero?: number; w?: number },
): string {
  const W = opts.w ?? FOREST_CHART_SIZE.w;
  const CAP = 14;
  const shown = rows.slice(0, CAP);
  const clipped = rows.length - shown.length;
  const ROW_H = 20;
  const MT = opts.title ? 28 : 14;
  const MB = 40;
  const H = MT + Math.max(1, shown.length) * ROW_H + MB;

  const zero = Number.isFinite(opts.zero as number) ? (opts.zero as number) : 0;
  const finite = shown.filter(
    (r) => Number.isFinite(r.estimate) && Number.isFinite(r.low) && Number.isFinite(r.high),
  );
  if (!finite.length) return emptyChart(W, H, "No finite intervals to chart");

  const longest = Math.max(...finite.map((r) => r.label.length));
  const ML = Math.min(150, Math.max(64, longest * 5.6 + 10));
  const MR = 18;
  const pw = W - ML - MR;

  let lo = Math.min(zero, ...finite.map((r) => r.low));
  let hi = Math.max(zero, ...finite.map((r) => r.high));
  if (!(hi > lo)) {
    const pad = Math.abs(hi) > 0 ? Math.abs(hi) * 0.1 : 1;
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, 5);
  const axLo = Math.floor(lo / step) * step;
  const axHi = Math.ceil(hi / step) * step;
  const span = axHi - axLo || 1;
  const x = (v: number): number => ML + ((v - axLo) / span) * pw;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>`,
  ];
  if (opts.title) {
    parts.push(
      `<text x="${W / 2}" y="18" text-anchor="middle" font-family="Segoe UI, Arial" ` +
        `font-size="12" fill="${INK}">${esc(opts.title)}</text>`,
    );
  }

  const yBase = MT + shown.length * ROW_H;
  for (const t of ticks(axLo, axHi, step)) {
    parts.push(
      `<text x="${x(t).toFixed(1)}" y="${yBase + 15}" text-anchor="middle" ` +
        `font-family="Segoe UI, Arial" font-size="10" fill="${GREY}">${esc(fmt(t))}</text>`,
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
        `font-family="Segoe UI, Arial" font-size="10" fill="${INK}">${esc(r.label.slice(0, 26))}</text>`,
    );
    if (!Number.isFinite(r.estimate) || !Number.isFinite(r.low) || !Number.isFinite(r.high)) {
      parts.push(
        `<text x="${ML + 6}" y="${(cy + 3.5).toFixed(1)}" font-family="Segoe UI, Arial" ` +
          `font-size="9" fill="${GREY}">not estimable</text>`,
      );
      return;
    }
    // Crossing the null line is the whole question, so it is what sets colour.
    const crosses = r.low <= zero && r.high >= zero;
    const c = crosses ? GREY : BLUE;
    parts.push(`<line x1="${x(r.low).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${x(r.high).toFixed(1)}" y2="${cy.toFixed(1)}" stroke="${c}" stroke-width="1.5"/>`);
    for (const v of [r.low, r.high]) {
      parts.push(`<line x1="${x(v).toFixed(1)}" y1="${(cy - 4).toFixed(1)}" x2="${x(v).toFixed(1)}" y2="${(cy + 4).toFixed(1)}" stroke="${c}" stroke-width="1.5"/>`);
    }
    parts.push(`<circle cx="${x(r.estimate).toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="${c}"/>`);
  });

  if (opts.xlabel) {
    parts.push(
      `<text x="${ML + pw / 2}" y="${H - 8}" text-anchor="middle" ` +
        `font-family="Segoe UI, Arial" font-size="10" fill="${INK}">${esc(opts.xlabel)}</text>`,
    );
  }
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
  series: BarSeries[],
  opts: { title?: string; ylabel?: string; w?: number; h?: number },
): string {
  const W = opts.w ?? GROUPED_BAR_SIZE.w;
  const H = opts.h ?? GROUPED_BAR_SIZE.h;
  const CAP = 16;
  const cats = categories.slice(0, CAP);
  const clipped = categories.length - cats.length;
  const vals = series.flatMap((s) => s.values.slice(0, CAP)).filter(Number.isFinite);
  if (!cats.length || !series.length || !vals.length) {
    return emptyChart(W, H, "There are no finite values to chart");
  }

  const ML = 50;
  const MR = 12;
  const MT = opts.title ? 26 : 12;
  const MB = 46;
  const pw = W - ML - MR;
  const ph = H - MT - MB;

  const hi = Math.max(0, ...vals);
  const lo = Math.min(0, ...vals);
  const step = niceStep(hi - lo || 1, 5);
  const axHi = Math.ceil(hi / step) * step;
  const axLo = Math.floor(lo / step) * step;
  const span = axHi - axLo || 1;
  const y = (v: number): number => MT + ph - ((v - axLo) / span) * ph;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${PAPER}"/>`,
  ];
  if (opts.title) {
    parts.push(
      `<text x="${W / 2}" y="17" text-anchor="middle" font-family="Segoe UI, Arial" ` +
        `font-size="12" fill="${INK}">${esc(opts.title)}</text>`,
    );
  }
  for (const t of ticks(axLo, axHi, step)) {
    const yy = y(t);
    parts.push(`<line x1="${ML}" y1="${yy.toFixed(1)}" x2="${ML + pw}" y2="${yy.toFixed(1)}" stroke="${FAINT}" stroke-width="1"/>`);
    parts.push(
      `<text x="${ML - 6}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" ` +
        `font-family="Segoe UI, Arial" font-size="10" fill="${GREY}">${esc(fmt(t))}</text>`,
    );
  }
  parts.push(`<line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + ph}" stroke="${RULE}" stroke-width="1"/>`);
  parts.push(`<line x1="${ML}" y1="${y(0).toFixed(1)}" x2="${ML + pw}" y2="${y(0).toFixed(1)}" stroke="${RULE}" stroke-width="1"/>`);
  if (opts.ylabel) {
    parts.push(
      `<text x="12" y="${MT + ph / 2}" text-anchor="middle" font-family="Segoe UI, Arial" ` +
        `font-size="10" fill="${INK}" transform="rotate(-90 12 ${MT + ph / 2})">${esc(opts.ylabel)}</text>`,
    );
  }

  const palette = [BLUE, RED, "#059669", "#d97706"];
  const slot = pw / cats.length;
  const bw = Math.max(2, Math.min(18, (slot * 0.7) / series.length));
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
        `font-family="Segoe UI, Arial" font-size="9" fill="${INK}">${esc(cat.slice(0, 10))}</text>`,
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
  if (clipped > 0) {
    parts.push(
      `<text x="${W - MR}" y="${MT + ph + 26}" text-anchor="end" font-family="Segoe UI, Arial" ` +
        `font-size="9" fill="${RED}">${clipped} more category(s) not shown</text>`,
    );
  }
  parts.push("</svg>");
  return parts.join("");
}
