// Figures for the Astronomy & lunar calculators: the time-scale offsets, a sky dome (alt-az, looking up), the lit
// Moon disc with its terminator and bright limb, a month calendar of Moon phases, the ecliptic strip of the Sun, Moon
// and planets, a telescope field of view against a target, an HR-diagram position with lines of constant radius,
// distances against redshift, a transit light curve, and surface-gravity bars. Colours are literal hex (inserted
// artwork never follows the pane's theme); Arial; U+2212 minus in every label.

import { buildPlotSvg, type Series } from "./plot";
import { fmtSig } from "./axis";

const W = 460;
const BLUE = "#1f5fa8";
const RED = "#c00000";
const GREEN = "#2e7d32";
const GREY = "#888888";
const ORANGE = "#d46a00";
const PURPLE = "#6a3d9a";
const INK = "#222222";
const LIT = "#f3e7c3";
const DARK = "#3a3f4a";

const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/-(?=\d)/g, "−");
const f1 = (v: number): string => v.toFixed(1);
const text = (x: number, y: number, s: string, anchor: "start" | "middle" | "end" = "middle", size = 11, fill = INK, weight = "normal"): string =>
  `<text x="${f1(x)}" y="${f1(y)}" text-anchor="${anchor}" font-family="Arial" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`;
const open = (w: number, h: number): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#ffffff"/>`;
/** A label value: 4 significant figures, trailing zeros dropped, true minus. */
export const sig = (v: number, n = 4): string => fmtSig(Number(v.toPrecision(n)), n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

// ---------------------------------------------------------------------------------------------------------------
// Time scales
// ---------------------------------------------------------------------------------------------------------------

/** Horizontal bars: how far each time scale runs ahead of UTC, in seconds. */
export function timeScalesChartSvg(rows: Array<{ name: string; offset: number; note: string }>): string {
  const H = 60 + rows.length * 34;
  const x0 = 70, x1 = W - 120;
  const max = Math.max(1, ...rows.map((r) => r.offset));
  const min = Math.min(0, ...rows.map((r) => r.offset));
  const sx = (v: number): number => x0 + ((v - min) / (max - min)) * (x1 - x0);
  const out = [open(W, H), text(W / 2, 18, "Time scales against UTC (seconds ahead)", "middle", 12, INK, "bold")];
  out.push(`<line x1="${f1(sx(0))}" y1="30" x2="${f1(sx(0))}" y2="${H - 26}" stroke="${GREY}" stroke-width="1"/>`);
  rows.forEach((r, i) => {
    const y = 42 + i * 34;
    const a = sx(Math.min(0, r.offset)), b = sx(Math.max(0, r.offset));
    out.push(text(x0 - 8, y + 13, r.name, "end", 11, INK, "bold"));
    out.push(`<rect x="${f1(a)}" y="${y}" width="${f1(Math.max(1.5, b - a))}" height="18" fill="${[BLUE, GREEN, ORANGE, PURPLE, RED][i % 5]}" opacity="0.85"/>`);
    out.push(text(Math.max(a, b) + 6, y + 13, r.note, "start", 10));
  });
  const ticks = [0, 10, 20, 30, 40, 50, 60, 70].filter((t) => t <= max + 1e-9);
  for (const t of ticks) {
    out.push(`<line x1="${f1(sx(t))}" y1="${H - 26}" x2="${f1(sx(t))}" y2="${H - 22}" stroke="${INK}"/>`);
    out.push(text(sx(t), H - 10, String(t), "middle", 10));
  }
  out.push("</svg>");
  return out.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// Sky dome
// ---------------------------------------------------------------------------------------------------------------

export interface DomePoint {
  altDeg: number;
  azDeg: number;
  label: string;
  colour?: string;
  /** Radius of the marker, px. */
  r?: number;
}

/** An alt-az sky dome LOOKING UP: zenith at the centre, horizon the circle, north at the top and east on the LEFT. */
export function skyDomeSvg(points: DomePoint[], title: string, paths: Array<Array<{ altDeg: number; azDeg: number }>> = []): string {
  const H = 380;
  const cx = W / 2, cy = 200, R = 150;
  const pt = (alt: number, az: number): [number, number] => {
    const rr = (R * (90 - Math.max(alt, -12))) / 90;
    const a = (az * Math.PI) / 180;
    return [cx - rr * Math.sin(a), cy - rr * Math.cos(a)];
  };
  const out = [open(W, H), text(W / 2, 18, title, "middle", 12, INK, "bold")];
  out.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="#eef3fb" stroke="${INK}" stroke-width="1.2"/>`);
  for (const alt of [30, 60]) out.push(`<circle cx="${cx}" cy="${cy}" r="${f1((R * (90 - alt)) / 90)}" fill="none" stroke="${GREY}" stroke-dasharray="3 3"/>`);
  out.push(`<line x1="${cx - R}" y1="${cy}" x2="${cx + R}" y2="${cy}" stroke="#cccccc"/><line x1="${cx}" y1="${cy - R}" x2="${cx}" y2="${cy + R}" stroke="#cccccc"/>`);
  out.push(text(cx + 4, cy - (R * 60) / 90 - 3, "30°", "start", 9, GREY), text(cx + 4, cy - (R * 30) / 90 - 3, "60°", "start", 9, GREY));
  out.push(text(cx, cy - R - 6, "N", "middle", 12, INK, "bold"), text(cx, cy + R + 16, "S", "middle", 12, INK, "bold"));
  out.push(text(cx - R - 10, cy + 4, "E", "middle", 12, INK, "bold"), text(cx + R + 10, cy + 4, "W", "middle", 12, INK, "bold"));
  for (const path of paths.filter((p) => p.length > 1)) {
    const vis = path.map((p) => pt(p.altDeg, p.azDeg));
    out.push(`<polyline points="${vis.map((p) => `${f1(p[0])},${f1(p[1])}`).join(" ")}" fill="none" stroke="${ORANGE}" stroke-width="1.3" stroke-dasharray="4 3"/>`);
  }
  for (const p of points) {
    const [x, y] = pt(p.altDeg, p.azDeg);
    out.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${p.r ?? 5}" fill="${p.colour ?? RED}" stroke="${INK}" stroke-width="0.6"${p.altDeg < 0 ? ' opacity="0.45"' : ""}/>`);
  }
  // Labels in a legend box below the dome so a crowded sky never collides.
  points.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const lx = 20 + col * 220, ly = H - 22 + row * 14 - Math.floor((points.length - 1) / 2) * 14;
    out.push(`<circle cx="${lx}" cy="${ly - 4}" r="4" fill="${p.colour ?? RED}"/>`);
    out.push(text(lx + 8, ly, p.label + (p.altDeg < 0 ? " (below the horizon)" : ""), "start", 10));
  });
  out.push(text(W - 8, 36, "looking up: zenith at the centre", "end", 9, GREY));
  out.push("</svg>");
  return out.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// The Moon's disc
// ---------------------------------------------------------------------------------------------------------------

/** The outline of the lit part of a disc of radius r, bright limb toward +u, as [u, v] points. */
function litOutline(k: number, r: number, n = 48): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const th = -Math.PI / 2 + (Math.PI * i) / n;
    pts.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  const ut = (1 - 2 * k) * r;
  for (let i = 0; i <= n; i++) {
    const th = Math.PI / 2 - (Math.PI * i) / n;
    pts.push([ut * Math.cos(th), r * Math.sin(th)]);
  }
  return pts;
}

/** A small Moon icon (lit fraction k, waxing lit on the right as seen from the northern hemisphere) at (x, y). */
export function moonIcon(x: number, y: number, r: number, k: number, waxing: boolean): string {
  const s = waxing ? 1 : -1;
  const pts = litOutline(k, r, 16).map(([u, v]) => `${f1(x + s * u)},${f1(y + v)}`);
  return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r}" fill="${DARK}"/><polygon points="${pts.join(" ")}" fill="${LIT}"/>`;
}

/**
 * The lit Moon as seen at the site: the bright limb at position angle χ from north (toward east), the disc turned by
 * the parallactic angle q so the zenith is up (the view in the sky); with no site, north up and east left.
 */
export function moonDiscSvg(k: number, chiDeg: number, qDeg: number | null, title: string, caption: string): string {
  const H = 300;
  const cx = W / 2, cy = 150, r = 100;
  // On a north-up, east-left chart a position angle p points to (−sin p, −cos p) in SVG axes; zenith-up turns by q.
  const rot = ((qDeg === null ? chiDeg : chiDeg - qDeg) * Math.PI) / 180;
  const dir: [number, number] = [-Math.sin(rot), -Math.cos(rot)];
  const perp: [number, number] = [-dir[1], dir[0]];
  const pts = litOutline(k, r).map(([u, v]) => `${f1(cx + u * dir[0] + v * perp[0])},${f1(cy + u * dir[1] + v * perp[1])}`);
  const out = [open(W, H), text(W / 2, 18, title, "middle", 12, INK, "bold")];
  out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${DARK}" stroke="${INK}" stroke-width="1"/>`);
  if (k > 0.002) out.push(`<polygon points="${pts.join(" ")}" fill="${LIT}"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${INK}" stroke-width="1"/>`);
  // The bright-limb direction arrow.
  const ax = cx + dir[0] * (r + 8), ay = cy + dir[1] * (r + 8);
  const bx = cx + dir[0] * (r + 30), by = cy + dir[1] * (r + 30);
  out.push(`<line x1="${f1(ax)}" y1="${f1(ay)}" x2="${f1(bx)}" y2="${f1(by)}" stroke="${ORANGE}" stroke-width="2"/>`);
  out.push(text(30, 44, qDeg === null ? "north up, east left" : "as seen: zenith up", "start", 10, GREY));
  out.push(text(30, 58, "orange: toward the Sun", "start", 10, ORANGE));
  out.push(text(W / 2, H - 12, caption, "middle", 11));
  out.push("</svg>");
  return out.join("");
}

/** Altitude against local time (hours from the start), one line per body, the horizon at 0°. */
export function altitudeChartSvg(series: Array<{ label: string; pts: Array<{ x: number; y: number }>; colour: string }>, xLabel: string, startHour: number): string {
  const s: Series[] = series.map((z) => ({ points: z.pts, type: "line", color: z.colour, label: z.label }));
  const xs = series.flatMap((z) => z.pts.map((p) => p.x));
  s.push({ points: [{ x: Math.min(...xs), y: 0 }, { x: Math.max(...xs), y: 0 }], type: "line", color: GREY, label: "horizon" });
  return buildPlotSvg(s, {
    xlabel: xLabel,
    ylabel: "Altitude (°)",
    xLimits: { min: Math.min(...xs), max: Math.max(...xs) },
    yLimits: { min: -90, max: 90 },
    xTickLabel: (v) => `${String(Math.round((((v + startHour) % 24) + 24) % 24)).padStart(2, "0")}h`,
    width: W,
    height: 300,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Month calendar
// ---------------------------------------------------------------------------------------------------------------

export interface CalendarCell {
  day: number;
  /** Illuminated fraction and waxing at local midnight starting the day... (the caller chooses the instant). */
  k: number;
  waxing: boolean;
  /** A principal phase on this day, with its local time. */
  mark: string | null;
}

/** A month grid (weeks as rows, Sunday first) with a Moon icon in every day. */
export function moonCalendarSvg(title: string, firstWeekday: number, cells: CalendarCell[]): string {
  const cw = 62, ch = 62, x0 = 13, y0 = 50;
  const rows = Math.ceil((firstWeekday + cells.length) / 7);
  const H = y0 + rows * ch + 12;
  const out = [open(W, H), text(W / 2, 18, title, "middle", 12, INK, "bold")];
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((d, i) => out.push(text(x0 + i * cw + cw / 2, 42, d, "middle", 10, GREY)));
  cells.forEach((c, i) => {
    const pos = firstWeekday + i;
    const x = x0 + (pos % 7) * cw, y = y0 + Math.floor(pos / 7) * ch;
    out.push(`<rect x="${x}" y="${y}" width="${cw - 2}" height="${ch - 2}" fill="${c.mark ? "#fff4d6" : "#f6f7f9"}" stroke="#d0d4da"/>`);
    out.push(text(x + 4, y + 12, String(c.day), "start", 10, INK, "bold"));
    out.push(moonIcon(x + cw / 2 - 1, y + 32, 12, c.k, c.waxing));
    if (c.mark) out.push(text(x + cw / 2 - 1, y + ch - 7, c.mark, "middle", 8, RED));
  });
  out.push("</svg>");
  return out.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// Ecliptic strip
// ---------------------------------------------------------------------------------------------------------------

const BODY_COLOURS: Record<string, string> = { Sun: "#e0a800", Moon: "#777777", Mercury: "#8c6d46", Venus: "#d4a017", Mars: RED, Jupiter: ORANGE, Saturn: "#b08d57", Uranus: "#2aa198", Neptune: BLUE };

/** Ecliptic longitude (decreasing to the right, as the sky looks facing south) against latitude, every body a series. */
export function eclipticStripSvg(bodies: Array<{ label: string; lonDeg: number; latDeg: number }>): string {
  const s: Series[] = bodies.map((b) => ({ points: [{ x: -b.lonDeg, y: b.latDeg }], type: "scatter", color: BODY_COLOURS[b.label] ?? INK, label: b.label }));
  s.push({ points: [{ x: -360, y: 0 }, { x: 0, y: 0 }], type: "line", color: GREY, label: "ecliptic" });
  return buildPlotSvg(s, {
    xlabel: "Ecliptic longitude (°), east to the left",
    ylabel: "Ecliptic latitude (°)",
    xLimits: { min: -360, max: 0 },
    yLimits: { min: -8, max: 8 },
    xTickLabel: (v) => String(Math.round(-v)),
    width: W,
    height: 300,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Telescope field of view
// ---------------------------------------------------------------------------------------------------------------

/** The eyepiece circle, the camera rectangle and the target disc, all to one angular scale (arcminutes). */
export function fovSvg(eyeFovArcmin: number | null, cam: [number, number] | null, targetArcmin: number | null, targetLabel: string): string {
  const H = 330;
  const cx = 165, cy = 170;
  const extent = Math.max(eyeFovArcmin ?? 0, cam ? Math.hypot(cam[0], cam[1]) : 0, targetArcmin ?? 0, 1e-9);
  const sc = 250 / extent; // px per arcmin
  const out = [open(W, H), text(W / 2, 18, "Field of view to scale", "middle", 12, INK, "bold")];
  out.push(`<rect x="${cx - 140}" y="${cy - 140}" width="280" height="280" fill="#0f1830"/>`);
  if (targetArcmin !== null) out.push(`<circle cx="${cx}" cy="${cy}" r="${f1((targetArcmin * sc) / 2)}" fill="${LIT}" opacity="0.9"/>`);
  if (eyeFovArcmin !== null) out.push(`<circle cx="${cx}" cy="${cy}" r="${f1((eyeFovArcmin * sc) / 2)}" fill="none" stroke="#7fc8ff" stroke-width="2"/>`);
  if (cam) out.push(`<rect x="${f1(cx - (cam[0] * sc) / 2)}" y="${f1(cy - (cam[1] * sc) / 2)}" width="${f1(cam[0] * sc)}" height="${f1(cam[1] * sc)}" fill="none" stroke="#ff9f43" stroke-width="2"/>`);
  let ly = 50;
  const key = (colour: string, label: string): void => {
    out.push(`<rect x="318" y="${ly - 8}" width="10" height="10" fill="${colour}"/>`);
    out.push(text(332, ly + 1, label, "start", 10));
    ly += 16;
  };
  if (eyeFovArcmin !== null) key("#7fc8ff", `eyepiece ${sig(eyeFovArcmin, 3)}′`);
  if (cam) key("#ff9f43", `camera ${sig(cam[0], 3)}′ × ${sig(cam[1], 3)}′`);
  if (targetArcmin !== null) key("#d9c48a", `${targetLabel} ${sig(targetArcmin, 3)}′`);
  out.push(text(cx, H - 8, `square: ${sig(280 / sc, 3)}′ across`, "middle", 10, GREY));
  out.push("</svg>");
  return out.join("");
}

// ---------------------------------------------------------------------------------------------------------------
// Stars, cosmology, transits, gravity
// ---------------------------------------------------------------------------------------------------------------

/** HR position: luminosity (log) against temperature (falling to the right), lines of constant radius, the Sun. */
export function hrDiagramSvg(T: number, L: number, label: string): string {
  const radii = [0.01, 0.1, 1, 10, 100, 1000];
  const tGrid: number[] = [];
  for (let i = 0; i <= 60; i++) tGrid.push(2000 * Math.pow(50000 / 2000, i / 60));
  const s: Series[] = radii.map((R, i) => ({
    points: tGrid.map((t) => ({ x: -Math.log10(t), y: R * R * (t / 5772) ** 4 })).filter((p) => p.y >= 1e-5 && p.y <= 1e7),
    type: "line" as const,
    color: i === 2 ? "#999999" : "#cfcfcf",
    label: i === 0 || i === 5 ? `R = ${sig(R)} R☉` : undefined,
  }));
  s.push({ points: [{ x: -Math.log10(5772), y: 1 }], type: "scatter", color: "#e0a800", label: "Sun" });
  s.push({ points: [{ x: -Math.log10(T), y: L }], type: "scatter", color: RED, label });
  return buildPlotSvg(s, {
    xlabel: "Effective temperature (K), hotter to the left",
    ylabel: "Luminosity (L☉)",
    yScale: "log",
    xLimits: { min: -Math.log10(50000), max: -Math.log10(2000) },
    yLimits: { min: 1e-5, max: 1e7 },
    xTickLabel: (v) => sig(Math.pow(10, -v), 2),
    width: W,
    height: 320,
  });
}

/** Apparent magnitude against distance (log) for an absolute magnitude, the star marked. */
export function modulusChartSvg(M: number, dPc: number, m: number, A: number): string {
  // Magnitudes run backwards (brighter is smaller): the coordinate is −m and the tick labels undo the sign.
  const pts: Array<{ x: number; y: number }> = [];
  const lo = Math.max(1e-3, dPc / 100), hi = dPc * 100;
  for (let i = 0; i <= 80; i++) {
    const d = lo * Math.pow(hi / lo, i / 80);
    pts.push({ x: d, y: -(M + 5 * Math.log10(d / 10) + A) });
  }
  return buildPlotSvg(
    [
      { points: pts, type: "line", color: BLUE, label: `M = ${sig(M, 3)}${A ? `, A = ${sig(A, 3)}` : ""}` },
      { points: [{ x: dPc, y: -m }], type: "scatter", color: RED, label: "this star" },
    ],
    { xlabel: "Distance (pc)", ylabel: "Apparent magnitude m (brighter up)", xScale: "log", yTickLabel: (v) => sig(-v, 3), width: W, height: 300 },
  );
}

/** Distances against redshift: comoving, luminosity, angular-diameter and the Hubble law, the chosen z marked. */
export function cosmologyChartSvg(curves: { z: number[]; dc: number[]; dl: number[]; da: number[]; hub: number[] }, z: number, dl: number): string {
  const mk = (ys: number[]): Array<{ x: number; y: number }> => curves.z.map((x, i) => ({ x, y: ys[i] }));
  return buildPlotSvg(
    [
      { points: mk(curves.dl), type: "line", color: RED, label: "luminosity distance" },
      { points: mk(curves.dc), type: "line", color: BLUE, label: "comoving distance" },
      { points: mk(curves.da), type: "line", color: GREEN, label: "angular-diameter distance" },
      { points: mk(curves.hub), type: "line", color: GREY, label: "Hubble law cz/H₀" },
      { points: [{ x: z, y: dl }], type: "scatter", color: INK, label: `z = ${sig(z, 3)}` },
    ],
    { xlabel: "Redshift z", ylabel: "Distance (Mpc)", width: W, height: 300 },
  );
}

/** Transit light curve: relative flux against hours from mid-transit. */
export function transitChartSvg(pts: Array<{ x: number; y: number }>, depth: number): string {
  return buildPlotSvg([{ points: pts, type: "line", color: BLUE, label: `depth ${sig(depth * 100, 3)} %` }], {
    xlabel: "Hours from mid-transit",
    ylabel: "Relative flux",
    yLimits: { min: 1 - depth * 1.3, max: 1 + depth * 0.3 },
    width: W,
    height: 290,
  });
}

/** Kepler's third law: period against semi-major axis (log–log) for the central mass, the orbit marked. */
export function keplerChartSvg(curve: Array<{ x: number; y: number }>, aAu: number, pDays: number): string {
  return buildPlotSvg(
    [
      { points: curve, type: "line", color: BLUE, label: "P² ∝ a³ for this mass" },
      { points: [{ x: aAu, y: pDays }], type: "scatter", color: RED, label: "this orbit" },
    ],
    { xlabel: "Semi-major axis (au)", ylabel: "Period (days)", xScale: "log", yScale: "log", width: W, height: 300 },
  );
}

/** Horizontal bars of surface gravity (m/s²) for every body, the chosen one highlighted. */
export function gravityBarsSvg(rows: Array<{ label: string; g: number }>, chosen: string): string {
  const rowH = 15;
  const H = 52 + rows.length * rowH + 30;
  const x0 = 90, x1 = W - 70;
  const max = Math.max(...rows.map((r) => r.g));
  const out = [open(W, H), text(W / 2, 18, "Surface gravity (m/s²), equatorial", "middle", 12, INK, "bold")];
  rows.forEach((r, i) => {
    const y = 34 + i * rowH;
    const w = Math.max(1, ((x1 - x0) * r.g) / max);
    const hl = r.label === chosen;
    out.push(text(x0 - 6, y + 10, r.label, "end", 10, INK, hl ? "bold" : "normal"));
    out.push(`<rect x="${x0}" y="${y + 1}" width="${f1(w)}" height="${rowH - 4}" fill="${hl ? RED : r.label === "Earth" ? BLUE : "#9aa5b1"}"/>`);
    out.push(text(x0 + w + 4, y + 10, sig(r.g, 3), "start", 9));
  });
  const ticks = [0, 5, 10, 15, 20, 25].filter((t) => t <= max);
  const yb = 34 + rows.length * rowH + 6;
  for (const t of ticks) {
    const x = x0 + ((x1 - x0) * t) / max;
    out.push(`<line x1="${f1(x)}" y1="${yb}" x2="${f1(x)}" y2="${yb + 4}" stroke="${INK}"/>`);
    out.push(text(x, yb + 16, String(t), "middle", 9));
  }
  out.push("</svg>");
  return out.join("");
}
