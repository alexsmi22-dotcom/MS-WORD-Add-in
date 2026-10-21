// The Solid form tool's one entry point (docs/SCOPE-SOLID-FORM.md): what the user pasted in, everything the pane shows
// out — the figure (with its re-render for figure styles), the table, the sentences and every note. Lives in lib/ so
// the pane holds no logic a test cannot reach.

import {
  claimText,
  dscEvents,
  isPattern,
  parsePeakList,
  parseTable,
  peakRows,
  pickPeaks,
  thermalText,
  tgaSteps,
  Peak,
  WAVELENGTHS,
  WavelengthId,
  XY,
} from "./solidform";
import { dscChartSvg, tgaChartSvg, xrpdChartSvg } from "./solidformChart";

export type SolidKind = "xrpd" | "dsc" | "tga";

export interface SolidOptions {
  wavelength?: WavelengthId;
  /** XRPD: smallest peak kept, % of the strongest. */
  minRelative?: number;
  /** XRPD: how many peaks the claim text cites. */
  cite?: number;
  /** XRPD: ± tolerance, ° 2θ. */
  tolerance?: number;
  /** DSC: endotherms point down ("exo up"). */
  endoDown?: boolean;
  /** DSC: the heat-flow units, for the axis label. */
  yUnits?: string;
  /** The form the sentences describe ("Crystalline Form A of compound 1"). */
  subject?: string;
  /** DSC: take the heat-flow unit from the column header (“Heat Flow (mW)”) when it names one. */
  unitsFromHeader?: boolean;
  /** Thermal data with more than two columns: the temperature and signal columns (0-based); chosen when omitted. */
  xCol?: number;
  yCol?: number;
}

/** The columns a multi-column export offered, and which were used (for the pane's pickers). */
export interface ColumnChoice {
  names: string[];
  x: number;
  y: number;
}

export type SolidResult =
  | {
      ok: true;
      /** The figure at its own size, and the same figure on a canvas w units wide (figure styles refit it). */
      svg: string;
      render: (w: number) => string;
      /** Header row first; just the header when there is nothing to tabulate. */
      rows: string[][];
      tableLabel: string;
      /** The sentence; "" when there is nothing to cite. */
      text: string;
      notes: string[];
      /** "pattern" when peaks were picked from a measured trace, "list" when typed. */
      source: "pattern" | "list" | "trace";
      peaks: Peak[];
      columns: ColumnChoice | null;
      /** DSC: the heat-flow unit the figure is labelled in. */
      units?: string;
    }
  | { ok: false; errors: string[]; notes: string[]; columns?: ColumnChoice | null };

/** Temperature and signal columns of a thermal export: by header name, else by shape; always said. */
export function chooseThermalColumns(header: string[] | null, rows: number[][], kind: "dsc" | "tga", o: { xCol?: number; yCol?: number }): { x: number; y: number; names: string[]; note: string | null } {
  const w = rows[0].length;
  const names = Array.from({ length: w }, (_, i) => header?.[i]?.trim() || `column ${i + 1}`);
  if (w === 2) return { x: 0, y: 1, names, note: null };
  const valid = (c: number | undefined) => c !== undefined && Number.isInteger(c) && c >= 0 && c < w;
  const col = (c: number) => rows.map((r) => r[c]);
  const rising = (c: number) => {
    const v = col(c);
    let up = 0;
    for (let i = 1; i < v.length; i++) if (v[i] >= v[i - 1]) up++;
    return up / Math.max(1, v.length - 1);
  };
  let x = valid(o.xCol) ? o.xCol! : -1;
  // Header scores: a sample temperature (Temperature, Ts, Tsample, °C) scores high; time, index and the reference
  // temperature (Tr, Tref) score below zero, so "t [s]" and "Tr [°C]" are never read as the scan's temperature.
  const tempScore = (h: string): number =>
    (/temp|tsample|sample\s*t/i.test(h) ? 4 : 0) +
    (/sample/i.test(h) ? 2 : 0) -
    (/program|set\s*point|\bset\b|furnace|oven/i.test(h) ? 3 : 0) +
    (/°\s*c|[([]\s*°?\s*c\s*[)\]]|\/\s*°?c\b/i.test(h) ? 3 : 0) +
    (/^ts\b/i.test(h) ? 3 : 0) -
    (/time|\bmin\b|[([]\s*(s|min|h)\s*[)\]]|index|tref|reference|^tr\b/i.test(h) ? 6 : 0);
  if (x < 0 && header) {
    const sc = names.map(tempScore);
    const best = sc.indexOf(Math.max(...sc));
    if (sc[best] >= 3) x = best;
  }
  if (x < 0) {
    // The steadily rising column whose range looks like a temperature scan (and is not a time column starting at 0).
    let best = -1, score = -1;
    for (let c = 0; c < w; c++) {
      const v = col(c);
      const lo = Math.min(...v.slice(0, 50)), hi = Math.max(...v.slice(-50));
      if (rising(c) < 0.95 || hi - lo < 10 || lo < -200 || hi > 1800) continue;
      const sc = (Math.abs(v[0]) > 5 ? 2 : 0) + (c > 0 ? 1 : 0);
      if (sc > score) (score = sc), (best = c);
    }
    x = best >= 0 ? best : 0;
  }
  let y = valid(o.yCol) && o.yCol !== x ? o.yCol! : -1;
  if (y < 0 && header) {
    // The signal itself, never its derivative (Deriv. Weight %/°C) or a time or temperature column.
    const sigScore = (h: string): number =>
      (kind === "dsc" ? (/heat\s*flow|\bhf\b|\bdsc\b|\bvalue\b|\bmw\b|w\/g|µv|\buv\b/i.test(h) ? 4 : 0) : (/weight|mass|\btg\b|\btga\b/i.test(h) ? 4 : 0) + (/%|\bmg\b/i.test(h) ? 1 : 0)) -
      (/deriv|\bdtg\b|\/\s*°?c\b|\/\s*min|per\s/i.test(h) ? 8 : 0) -
      (tempScore(h) >= 3 || /time|index/i.test(h) ? 6 : 0);
    const sc = names.map((h, i) => (i === x ? -Infinity : sigScore(h)));
    const best = sc.indexOf(Math.max(...sc));
    if (sc[best] > 0) y = best;
  }
  if (y < 0) y = w - 1 === x ? w - 2 : w - 1;
  const left = names.filter((_, i) => i !== x && i !== y);
  return { x, y, names, note: `Read “${names[x]}” as the temperature and “${names[y]}” as the ${kind === "dsc" ? "heat flow" : "weight"}${left.length ? `; ${left.map((n) => `“${n}”`).join(", ")} left out` : ""} — change the columns below if that is wrong.` };
}

export function analyzeSolid(kind: SolidKind, input: string, o: SolidOptions = {}): SolidResult {
  if (!input.trim()) return { ok: false, errors: ["Nothing to read yet — paste the data, or press Example."], notes: [] };
  if (kind === "xrpd") {
    const wl = o.wavelength ?? "CuKa1";
    const lambda = WAVELENGTHS[wl].a;
    const table = parseTable(input);
    const notes: string[] = [];
    let peaks: Peak[];
    let pattern: XY[] | null = null;
    let amorphous: { center: number } | null = null;
    if (!table.errors.length && table.rows[0].length >= 2 && isPattern(table.rows.map((r) => r[0]))) {
      pattern = table.rows.map((r) => [r[0], r[1]]);
      notes.push(...table.notes);
      const r = pickPeaks(pattern, lambda, { minRelative: o.minRelative ?? 5, wavelength: wl });
      if (r.errors.length) return { ok: false, errors: r.errors, notes: [...notes, ...r.notes] };
      peaks = r.peaks;
      amorphous = r.amorphous;
      notes.push(...r.notes);
    } else {
      const r = parsePeakList(input, lambda);
      if (r.errors.length) return { ok: false, errors: r.errors, notes: r.notes };
      peaks = r.peaks;
      notes.push(...r.notes);
    }
    const dec = (o.tolerance ?? 0.2) < 0.1 ? 2 : 1;
    const svg = xrpdChartSvg(pattern, peaks, wl);
    if (!svg) return { ok: false, errors: ["Nothing to draw."], notes };
    const base = { ok: true as const, svg, render: (w: number) => xrpdChartSvg(pattern, peaks, wl, w) ?? svg, tableLabel: `XRPD peak list (${WAVELENGTHS[wl].name})`, source: (pattern ? "pattern" : "list") as "pattern" | "list", peaks, columns: null };
    if (!peaks.length) {
      notes.push(
        amorphous
          ? `No sharp peaks: the pattern looks amorphous (a broad halo at about ${amorphous.center.toFixed(0)}° 2θ). There is nothing to cite as peaks.`
          : "No peak stands clear of the noise — lower “Smallest peak”, or check the data.",
      );
      return { ...base, rows: [["2θ (°)", "d (Å)", "Relative intensity (%)"]], text: "", notes };
    }
    const c = claimText(peaks, { count: o.cite ?? 5, tolerance: o.tolerance ?? 0.2, wavelength: wl, subject: o.subject });
    notes.push(...c.notes);
    return { ...base, rows: [["2θ (°)", "d (Å)", "Relative intensity (%)"], ...peakRows(peaks, dec)], text: c.text, notes };
  }
  const table = parseTable(input);
  if (table.errors.length) return { ok: false, errors: table.errors, notes: table.notes };
  if (table.rows[0].length < 2) return { ok: false, errors: ["Two columns are needed: temperature and signal."], notes: table.notes };
  const pick = chooseThermalColumns(table.header, table.rows, kind, o);
  const columns: ColumnChoice | null = table.rows[0].length > 2 ? { names: pick.names, x: pick.x, y: pick.y } : null;
  // A temperature in °F (or K) by its header is converted to °C, and said.
  const tName = pick.names[pick.x];
  const toC = /°\s*F|\(\s*F\s*\)|\[\s*F\s*\]/.test(tName) ? (t: number) => ((t - 32) * 5) / 9 : /\(\s*K\s*\)|\[\s*K\s*\]|\bkelvin\b/i.test(tName) ? (t: number) => t - 273.15 : null;
  const pts: XY[] = table.rows.map((r) => [toC ? toC(r[pick.x]) : r[pick.x], r[pick.y]]);
  const notes = [...table.notes, ...(pick.note ? [pick.note] : []), ...(toC ? [`“${tName}” converted to °C.`] : [])];
  if (kind === "dsc") {
    const endoDown = o.endoDown ?? true;
    const r = dscEvents(pts, endoDown);
    if (r.errors.length) return { ok: false, errors: r.errors, notes: [...notes, ...r.notes], columns };
    notes.push(...r.notes);
    // The header’s own unit (“Heat Flow (mW)”, “DSC/(mW/mg)”) unless the user typed one.
    const fromHeader = o.unitsFromHeader ? /[([]\s*([^()[\]]*?(?:W|µV|uV|cal)[^()[\]]*?)\s*[)\]]\s*$/.exec(pick.names[pick.y])?.[1] : undefined;
    const units = fromHeader ?? o.yUnits ?? "W/g";
    const svg = dscChartSvg(pts, endoDown, units);
    if (!svg) return { ok: false, errors: ["Nothing to draw."], notes, columns };
    const name = (k: string) => (k === "step" ? "Step (glass transition)" : k === "endotherm" ? "Endotherm" : "Exotherm");
    return {
      ok: true,
      svg,
      render: (w) => dscChartSvg(pts, endoDown, units, w) ?? svg,
      rows: [["Event", "Onset (°C)", "Peak or midpoint (°C)"], ...r.events.map((e) => [name(e.kind), e.onset !== null ? e.onset.toFixed(1) : "—", e.peak.toFixed(1)])],
      tableLabel: "DSC events",
      units,
      text: thermalText("dsc", { events: r.events }, o.subject).join(" "),
      notes,
      source: "trace",
      peaks: [],
      columns,
    };
  }
  const r = tgaSteps(pts);
  if (r.errors.length) return { ok: false, errors: r.errors, notes: [...notes, ...r.notes], columns };
  notes.push(...r.notes);
  // The figure in % of the starting weight whenever the data were not already %, so the axis and the table agree.
  const plotted = r.converted ? r.percent : pts;
  const yLabel = r.converted ? "% of initial" : "%";
  const svg = tgaChartSvg(plotted, yLabel);
  if (!svg) return { ok: false, errors: ["Nothing to draw."], notes, columns };
  return {
    ok: true,
    svg,
    render: (w) => tgaChartSvg(plotted, yLabel, w) ?? svg,
    rows: [
      ["Step", "From (°C)", "To (°C)", "Weight loss (%)", "Fastest loss (°C)"],
      ...r.steps.map((s, i) => [String(i + 1), s.start.toFixed(1), s.end.toFixed(1), s.loss.toFixed(1), s.dtgPeak.toFixed(1)]),
    ],
    tableLabel: "TGA weight-loss steps",
    text: thermalText("tga", { steps: r.steps }, o.subject).join(" "),
    notes,
    source: "trace",
    peaks: [],
    columns,
  };
}

// ---- examples: synthetic, deterministic, and labelled as such in the pane ----

/** A small linear-congruential generator, so the example's noise is the same every time. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const pv = (x: number, c: number, fwhm: number): number => {
  const g = Math.exp((-4 * Math.LN2 * (x - c) ** 2) / fwhm ** 2);
  const l = 1 / (1 + (4 * (x - c) ** 2) / fwhm ** 2);
  return 0.5 * g + 0.5 * l;
};

/** The Example button's data: a made-up pattern or thermogram (not any real compound's). */
export function solidExample(kind: SolidKind): string {
  const rnd = lcg(kind === "xrpd" ? 7 : kind === "dsc" ? 11 : 13);
  const lines: string[] = [];
  if (kind === "xrpd") {
    const peaks: Array<[number, number]> = [[6.8, 1800], [9.4, 650], [13.6, 1200], [15.1, 380], [17.2, 2400], [18.9, 900], [21.3, 1500], [24.0, 520], [25.6, 300], [27.5, 700]];
    lines.push("# 2theta (deg)  intensity (counts) — synthetic example");
    for (let x = 3; x <= 40.0001; x += 0.02) {
      const bg = 120 + 260 * Math.exp(-x / 6);
      let y = bg;
      for (const [c, h] of peaks) y += h * pv(x, c, 0.12 + 0.002 * c);
      y += (rnd() - 0.5) * 2 * Math.sqrt(y);
      lines.push(`${x.toFixed(2)}\t${Math.round(y)}`);
    }
  } else if (kind === "dsc") {
    lines.push("# temperature (C)  heat flow (W/g), exo up — synthetic example");
    for (let t = 30; t <= 250.0001; t += 0.5) {
      const melt = -2.4 * Math.exp(-((t - 186) ** 2) / (2 * 1.6 ** 2));
      const y = -0.05 - 0.0006 * (t - 30) + melt + (rnd() - 0.5) * 0.004;
      lines.push(`${t.toFixed(1)}\t${y.toFixed(4)}`);
    }
  } else {
    lines.push("# temperature (C)  weight (%) — synthetic example");
    const logistic = (t: number, c: number, w: number): number => 1 / (1 + Math.exp(-(t - c) / w));
    for (let t = 30; t <= 350.0001; t += 1) {
      const y = 100 - 4.6 * logistic(t, 105, 6) - 58 * logistic(t, 290, 9) + (rnd() - 0.5) * 0.02;
      lines.push(`${t.toFixed(0)}\t${y.toFixed(3)}`);
    }
  }
  return lines.join("\n");
}
