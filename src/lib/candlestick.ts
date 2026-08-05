// Candlestick (OHLC) charts: one candle per period, from four numeric columns.
//
// The form's job is to show, for each period, where trading opened and closed AND how
// far it ranged in between — four numbers per period, which no ordinary chart carries.
// A line chart of closes throws the range away; a bar chart of closes throws away the
// direction as well.
//
// THREE THINGS THIS GETS RIGHT THAT ARE EASY TO GET WRONG.
//
// 1. THE UP/DOWN CONVENTION IS STATED, NOT ASSUMED. Green-up/red-down is a Western
//    convention; in much of East Asia red is UP. A chart that relies on colour alone
//    is therefore ambiguous to a large part of its audience before colour blindness or
//    a photocopier is even considered. So direction is carried FIRST by the body —
//    hollow for up, filled for down, which is the older Japanese convention and
//    survives greyscale — with colour as reinforcement, and the legend says in words
//    which is which.
//
// 2. THE COLUMNS ARE IDENTIFIED, NOT GUESSED. Open/high/low/close are read from the
//    column names. Falling back to position is only allowed when the OHLC invariants
//    then hold on every row, which is a real check rather than a hope: if the columns
//    were in another order, high would not be the largest and the fallback is refused.
//
// 3. NO VOLUME ON A SECOND Y-AXIS. Volume is the obvious thing to add and the wrong
//    thing to add here: two y-scales on one plot make the alignment arbitrary and
//    invent a correlation the data does not contain. If volume is wanted it belongs in
//    its own panel beneath, sharing the x-axis — a separate change, not a second scale.

import { TableChart } from "./tablechart";
import { INK } from "./chartPalette";
import { niceStep, fmtTick, TICK_CAP, TICK_EPS } from "./plot";

/** Up and down, from the reserved status palette. Never carries meaning alone. */
const UP = "#0ca30c";
const DOWN = "#d03b3b";

export interface CandlestickOptions {
  /** Black-and-white rendering; direction then rests entirely on hollow vs filled. */
  grey?: boolean;
  /**
   * Invert the colour convention (red = up), as is usual in much of East Asia.
   * The legend follows it either way, which is the point of having the option.
   */
  redIsUp?: boolean;
}

export interface CandlestickResult {
  svg: string;
  notes: string[];
  /** Null when the four columns could not be established. */
  error: string | null;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface Ohlc {
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  how: "named" | "positional";
}

/**
 * Matches a column name to one of the four roles, or null.
 *
 * EXACT match on the normalised name, with only a trailing unit word removed, and
 * deliberately not a prefix match. "Open Price" must resolve to open; "Open Interest"
 * — a real futures column, and a completely different quantity — must NOT. A
 * startsWith rule would take both, and would then hand the open-interest figures to
 * the renderer as prices.
 */
function roleOf(name: string): "open" | "high" | "low" | "close" | null {
  let n = name.trim().toLowerCase().replace(/[^a-z]/g, "");
  for (const suffix of ["price", "px", "value"]) {
    if (n.length > suffix.length && n.endsWith(suffix)) {
      n = n.slice(0, -suffix.length);
      break;
    }
  }
  if (n === "open" || n === "o") return "open";
  if (n === "high" || n === "h" || n === "max") return "high";
  if (n === "low" || n === "l" || n === "min") return "low";
  if (n === "close" || n === "c" || n === "adjclose" || n === "closing" || n === "last") return "close";
  return null;
}

/**
 * Works out which columns are open, high, low and close.
 *
 * By NAME first. Position is a fallback, and only when the OHLC invariants hold on
 * every row afterwards — high really is the largest of the four and low the smallest.
 * That is what makes the fallback safe rather than a guess: a table whose columns are
 * in a different order fails the check and is refused instead of drawn wrongly.
 */
export function identifyOhlc(chart: TableChart): Ohlc | string {
  const cols = chart.series;
  const n = chart.categories.length;
  if (n === 0) return "There are no rows to draw candles for.";

  const num = (c: { values: (number | null)[] }): number[] =>
    Array.from({ length: n }, (_, i) => {
      const v = c.values[i];
      return v === null || v === undefined || !Number.isFinite(v) ? NaN : v;
    });

  const byRole: Partial<Record<"open" | "high" | "low" | "close", number[]>> = {};
  for (const c of cols) {
    const r = roleOf(c.name);
    if (r && !byRole[r]) byRole[r] = num(c);
  }
  if (byRole.open && byRole.high && byRole.low && byRole.close) {
    return {
      open: byRole.open,
      high: byRole.high,
      low: byRole.low,
      close: byRole.close,
      how: "named",
    };
  }

  if (cols.length < 4) {
    return (
      `A candlestick chart needs four numeric columns — open, high, low and close — and this ` +
      `table has ${cols.length}. The columns found are: ${cols.map((c) => `"${c.name}"`).join(", ") || "none"}.`
    );
  }

  // Positional fallback, then VERIFIED.
  const [o, h, l, c] = [num(cols[0]), num(cols[1]), num(cols[2]), num(cols[3])];
  let checked = 0;
  for (let i = 0; i < n; i++) {
    if (![o[i], h[i], l[i], c[i]].every(Number.isFinite)) continue;
    checked++;
    if (h[i] < Math.max(o[i], c[i]) || l[i] > Math.min(o[i], c[i]) || h[i] < l[i]) {
      return (
        `The columns could not be identified. None of them is named open, high, low or close, so ` +
        `the first four were tried in that conventional order — but then row ${i + 1} has a "high" ` +
        `of ${fmtTick(h[i])} that is not the largest of its four values, which means the order is ` +
        `something else. Rename the columns (Open, High, Low, Close) so there is no guessing: ` +
        `drawing this with the columns swapped would produce candles that look perfectly ` +
        `plausible and are wrong.`
      );
    }
  }
  if (checked === 0) {
    return "None of the rows has four numeric values, so there is nothing to draw.";
  }
  return { open: o, high: h, low: l, close: c, how: "positional" };
}

export function buildCandlestickSvg(
  chart: TableChart,
  title: string,
  opts: CandlestickOptions = {},
  W = 620,
  H = 420,
): CandlestickResult {
  const notes: string[] = [];
  const blank = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"></svg>`;

  const ohlc = identifyOhlc(chart);
  if (typeof ohlc === "string") return { svg: blank, notes: [], error: ohlc };
  if (ohlc.how === "positional") {
    notes.push(
      "The columns are not named open/high/low/close, so the first four were read in that " +
        "conventional order. That reading was CHECKED against the data — in every row the " +
        "second column really is the largest of the four and the third the smallest — so it is " +
        "consistent, but naming the columns removes the assumption entirely.",
    );
  }

  const n = chart.categories.length;
  const grey = opts.grey === true;
  const upColour = grey ? INK.primary : opts.redIsUp ? DOWN : UP;
  const downColour = grey ? INK.primary : opts.redIsUp ? UP : DOWN;

  // Rows that are impossible are SKIPPED, not drawn. A candle whose high is below its
  // close is not a candle; drawing it anyway would render a shape that means nothing
  // and let a data-entry error pass as a market event.
  const usable: number[] = [];
  let impossible = 0;
  let incomplete = 0;
  for (let i = 0; i < n; i++) {
    const o = ohlc.open[i];
    const h = ohlc.high[i];
    const l = ohlc.low[i];
    const c = ohlc.close[i];
    if (![o, h, l, c].every(Number.isFinite)) {
      incomplete++;
      continue;
    }
    if (h < Math.max(o, c) || l > Math.min(o, c) || h < l) {
      impossible++;
      continue;
    }
    usable.push(i);
  }
  if (!usable.length) {
    return {
      svg: blank,
      notes,
      error:
        "No row has a usable set of four values: a candle needs the high to be at least as large " +
        "as the open and close, and the low at least as small.",
    };
  }
  if (incomplete) {
    notes.push(
      `${incomplete} row${incomplete === 1 ? "" : "s"} ${incomplete === 1 ? "is" : "are"} missing ` +
        "one or more of the four values and no candle is drawn there. The gap is left visible " +
        "rather than closed up, so the time axis stays honest.",
    );
  }
  if (impossible) {
    notes.push(
      `${impossible} row${impossible === 1 ? "" : "s"} could not be drawn because the high is not ` +
        "the largest of its four values or the low is not the smallest. That is impossible for a " +
        "real period, so it is a data error rather than a market event, and no candle is drawn " +
        "for it.",
    );
  }

  // Scale. Padded so the extreme wicks are not flush against the frame.
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of usable) {
    lo = Math.min(lo, ohlc.low[i]);
    hi = Math.max(hi, ohlc.high[i]);
  }
  if (!(hi > lo)) {
    const pad = Math.max(Math.abs(hi) * 0.01, 1);
    lo -= pad;
    hi += pad;
    notes.push("Every value is the same, so the price axis is given an arbitrary span to draw on.");
  }
  const span = hi - lo;
  lo -= span * 0.06;
  hi += span * 0.06;

  const PAD = 10;
  const titleH = title ? 22 : 0;
  const legendH = 30;
  const axisW = 52;
  const xLabelH = 26;
  const plotX = PAD + axisW;
  const plotY = PAD + titleH;
  const plotW = W - plotX - PAD;
  const plotH = H - plotY - xLabelH - legendH - PAD;
  if (plotW < 40 || plotH < 40) {
    return { svg: blank, notes, error: "The figure is too small to draw a candlestick chart." };
  }

  const yOf = (v: number): number => plotY + plotH - ((v - lo) / (hi - lo)) * plotH;
  const slot = plotW / n;
  const bodyW = Math.max(1.5, Math.min(14, slot * 0.62));

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(`<rect width="${W}" height="${H}" fill="${INK.surface}"/>`);
  if (title) {
    parts.push(
      `<text x="${PAD}" y="${PAD + 15}" font-family="Segoe UI, Arial, sans-serif" font-size="13" ` +
        `font-weight="600" fill="${INK.primary}">${esc(title)}</text>`,
    );
  }

  // Price gridlines — recessive, behind the candles.
  const step = niceStep(hi - lo, 6);
  const first = Math.ceil(lo / step) * step;
  // BOUNDED, AND THE SLACK IS RELATIVE — plot.ts's TICK_CAP / TICK_EPS carry the
  // full explanation. The absolute `1e-9` this used to carry is wider than the
  // WHOLE AXIS on prices quoted at 1e-15 magnitude, which produced 2,000,014 tick
  // labels and a 458 MB SVG built synchronously in the task pane.
  for (let i = 0, v = first; i <= TICK_CAP && v <= hi + step * TICK_EPS; i++, v += step) {
    const y = yOf(v);
    parts.push(
      `<line x1="${plotX}" y1="${y.toFixed(1)}" x2="${(plotX + plotW).toFixed(1)}" y2="${y.toFixed(1)}" ` +
        `stroke="${INK.gridline}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${(plotX - 6).toFixed(1)}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" ` +
        `font-family="Segoe UI, Arial, sans-serif" font-size="9.5" fill="${INK.muted}">${esc(fmtTick(v))}</text>`,
    );
  }
  parts.push(
    `<line x1="${plotX}" y1="${(plotY + plotH).toFixed(1)}" x2="${(plotX + plotW).toFixed(1)}" ` +
      `y2="${(plotY + plotH).toFixed(1)}" stroke="${INK.baseline}" stroke-width="1"/>`,
  );

  // Candles.
  for (const i of usable) {
    const o = ohlc.open[i];
    const h = ohlc.high[i];
    const l = ohlc.low[i];
    const c = ohlc.close[i];
    const cx = plotX + slot * i + slot / 2;
    const up = c >= o;
    const colour = up ? upColour : downColour;

    // Wick first, so the body sits over it.
    parts.push(
      `<line x1="${cx.toFixed(1)}" y1="${yOf(h).toFixed(1)}" x2="${cx.toFixed(1)}" ` +
        `y2="${yOf(l).toFixed(1)}" stroke="${colour}" stroke-width="1.2"/>`,
    );

    const yTop = yOf(Math.max(o, c));
    const yBot = yOf(Math.min(o, c));
    // A period that opened and closed at the same price has no body; a hairline keeps
    // it visible instead of vanishing.
    const bodyH = Math.max(1, yBot - yTop);
    // HOLLOW FOR UP, FILLED FOR DOWN — the primary encoding, and the one that survives
    // greyscale, colour blindness and a photocopier.
    parts.push(
      `<rect x="${(cx - bodyW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bodyW.toFixed(1)}" ` +
        `height="${bodyH.toFixed(1)}" fill="${up ? INK.surface : colour}" stroke="${colour}" ` +
        `stroke-width="1.2"/>`,
    );
  }

  // Period labels, thinned so they cannot collide.
  const every = Math.max(1, Math.ceil((n * 46) / plotW));
  for (let i = 0; i < n; i += every) {
    const cx = plotX + slot * i + slot / 2;
    const label = chart.categories[i];
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${(plotY + plotH + 14).toFixed(1)}" text-anchor="middle" ` +
        `font-family="Segoe UI, Arial, sans-serif" font-size="9.5" fill="${INK.muted}">` +
        `${esc(label.length > 10 ? `${label.slice(0, 9)}…` : label)}</text>`,
    );
  }
  if (every > 1) {
    notes.push(
      `There are ${n} periods and only every ${every}${every === 2 ? "nd" : every === 3 ? "rd" : "th"} ` +
        "label is shown, so they do not overlap. Every candle is drawn.",
    );
  }

  // The legend, which STATES the convention rather than leaving it to be inferred.
  const ly = H - legendH + 12;
  const swatch = (x: number, up: boolean): string => {
    const colour = up ? upColour : downColour;
    return (
      `<rect x="${x}" y="${ly - 8}" width="7" height="11" fill="${up ? INK.surface : colour}" ` +
      `stroke="${colour}" stroke-width="1.2"/>`
    );
  };
  parts.push(swatch(PAD, true));
  parts.push(
    `<text x="${PAD + 12}" y="${ly + 1}" font-family="Segoe UI, Arial, sans-serif" font-size="9.5" ` +
      `fill="${INK.secondary}">hollow = close at or above open</text>`,
  );
  parts.push(swatch(PAD + 190, false));
  parts.push(
    `<text x="${PAD + 202}" y="${ly + 1}" font-family="Segoe UI, Arial, sans-serif" font-size="9.5" ` +
      `fill="${INK.secondary}">filled = close below open</text>`,
  );
  if (!grey) {
    parts.push(
      `<text x="${PAD + 370}" y="${ly + 1}" font-family="Segoe UI, Arial, sans-serif" font-size="9.5" ` +
        `fill="${INK.muted}">${opts.redIsUp ? "red = up" : "green = up"}</text>`,
    );
  }
  parts.push("</svg>");

  if (grey) {
    notes.push(
      "In black and white the direction is carried entirely by hollow versus filled bodies, " +
        "which is the older convention and the reason it is the primary encoding here rather " +
        "than the colour.",
    );
  }

  return { svg: parts.join(""), notes, error: null };
}
