// Figures for the Release E3-e transmission-line calculators (transmissionLine.ts): the Smith chart (impedance grid,
// the load, the rotation toward the generator to the input and the VSWR circle), the matching networks' |Γ| against
// frequency, and the two-port S-parameter summary. Colours are literal hex (inserted artwork never follows the pane's
// theme); Arial, as engCharts2026.ts.
//
// The Smith chart is drawn analytically — full <circle>s for constant r, SVG arcs for constant x computed from where
// each x circle meets the rim and the real axis — with no clipPath, so it renders the same in every SVG consumer.
// Screen y runs down: a point Γ = u + jv is at (cx + R·u, cy − R·v). Moving toward the generator is CLOCKWISE in the
// Γ plane, which is SVG sweep-flag 1 (clockwise on screen).

import { buildPlotSvg, type Series } from "./plot";
import { fmtSig, linearAxis } from "./axis";
import { cAbs, type Cx } from "./transmissionLine";

const FONT = "Arial, Helvetica, sans-serif";
const f = (v: number): string => String(Math.round(v * 100) / 100);
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** 4 significant figures, trailing zeros dropped, U+2212, ×10ⁿ outside 10⁻³…10⁵. */
export const sig = (v: number, n = 4): string =>
  Math.abs(v) < 1e-12 ? "0" : fmtSig(v, n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

/** A complex impedance or normalised value for a label: "100 + j50", "50 − j50", "j0.5". */
export function cxText(z: Cx, n = 4): string {
  const mag = Math.max(Math.abs(z.re), Math.abs(z.im));
  if (mag < 1e-12) return "0";
  const re = Math.abs(z.re) <= 1e-9 * mag ? 0 : z.re;
  const im = Math.abs(z.im) <= 1e-9 * mag ? 0 : z.im;
  if (im === 0) return sig(re === 0 ? 0 : re, n);
  const jPart = `j${sig(Math.abs(im), n)}`;
  if (re === 0) return im < 0 ? `−${jPart}` : jPart;
  return `${sig(re, n)} ${im < 0 ? "−" : "+"} ${jPart}`;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const ADV = 0.58;
const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
/** The box a text occupies (the layout audit's estimate: 0.58 em per character, 0.78 em tall). */
function textBox(x: number, y: number, chars: number, size: number, anchor: string): Box {
  const w = chars * ADV * size;
  const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  return { x0, y0: y - 0.78 * size, x1: x0 + w, y1: y + 0.15 * size };
}
const txt = (x: number, y: number, t: string, anchor = "middle", size = 10, fill = "#000000", extra = ""): string =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" fill="${fill}"${extra}>${esc(t)}</text>`;
/** [before] "Z" with a subscript ("L", "in"), then optional text after it on the baseline (a dx stands in for its leading space, which SVG renderers collapse after a tspan). */
const zSub = (x: number, y: number, sub: string, anchor: string, size: number, fill: string, after = "", before = ""): string =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" fill="${fill}">${esc(before)}Z<tspan dy="${f(size * 0.3)}" font-size="${f(size * 0.75)}">${esc(sub)}</tspan>${after ? `<tspan dy="${f(-size * 0.3)}"${/^ /.test(after) ? ` dx="${f(size * 0.28)}"` : ""}>${esc(after.replace(/^ /, ""))}</tspan>` : ""}</text>`;

export interface SmithInput {
  /** Reflection coefficient of the load. */
  gammaL: Cx;
  /** Reflection coefficient at the input (after the rotation); null when the line length is zero. */
  gammaIn: Cx | null;
  /** The rotation toward the generator, in wavelengths (already reduced modulo λ/2). */
  turns: number;
  /** Whole half wavelengths removed from the rotation (stated, not drawn). */
  halfWaves: number;
  z0: number;
  /** Legend texts for the load and the input impedance (ohms, as shown in the result). */
  zlText: string;
  zinText: string | null;
  vswr: number | null;
}

export const SMITH_WIDTH = 460;
const R_VALUES = [0.2, 0.5, 1, 2, 5];
const X_VALUES = [0.2, 0.5, 1, 2, 5];

/** The impedance Smith chart with the load, the rotation toward the generator to Z_in, and the VSWR circle. */
export function smithChartSvg(inp: SmithInput, width = SMITH_WIDTH): string {
  const W = width;
  const R = Math.round(W * 0.365);
  const cx = W / 2;
  const top = 40;
  const cy = top + R;
  const P = (g: Cx): [number, number] => [cx + R * g.re, cy - R * g.im];
  const out: string[] = [];
  const boxes: Box[] = [];
  const GRID = "#a6a6a6";
  // Constant-resistance circles: centre r/(1+r), radius 1/(1+r).
  for (const r of R_VALUES) {
    const c = r / (1 + r), rad = 1 / (1 + r);
    out.push(`<circle cx="${f(cx + R * c)}" cy="${f(cy)}" r="${f(R * rad)}" fill="none" stroke="${GRID}" stroke-width="0.6"/>`);
  }
  // Constant-reactance arcs: circle centre (1, 1/x), radius 1/|x|, from the rim point to Γ = 1.
  for (const x of X_VALUES) {
    for (const sgn of [1, -1]) {
      const xv = sgn * x;
      const rim: Cx = { re: (xv * xv - 1) / (xv * xv + 1), im: (2 * xv) / (xv * xv + 1) };
      const [x0, y0] = P(rim);
      const [x1, y1] = P({ re: 1, im: 0 });
      out.push(`<path d="M${f(x0)} ${f(y0)} A${f(R / x)} ${f(R / x)} 0 0 ${sgn > 0 ? 0 : 1} ${f(x1)} ${f(y1)}" fill="none" stroke="${GRID}" stroke-width="0.6"/>`);
    }
  }
  // The real axis and the rim.
  out.push(`<line x1="${f(cx - R)}" y1="${f(cy)}" x2="${f(cx + R)}" y2="${f(cy)}" stroke="${GRID}" stroke-width="0.6"/>`);
  // The axis is a line: a point label must not sit across it.
  boxes.push({ x0: cx - R, y0: cy - 0.5, x1: cx + R, y1: cy + 0.5 });
  out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${R}" fill="none" stroke="#000000" stroke-width="1.1"/>`);
  // Resistance labels on the real axis (above it, right of each circle's crossing), 0 and ∞ at the ends.
  for (const r of R_VALUES) {
    const gx = cx + R * ((r - 1) / (r + 1)) + 2;
    const t = sig(r);
    out.push(txt(gx, cy - 3, t, "start", 9, "#444444"));
    boxes.push(textBox(gx, cy - 3, t.length, 9, "start"));
  }
  out.push(txt(cx - R - 4, cy + 3.5, "0", "end", 9, "#444444"));
  boxes.push(textBox(cx - R - 4, cy + 3.5, 1, 9, "end"));
  out.push(txt(cx + R + 4, cy + 3.5, "∞", "start", 10, "#444444"));
  boxes.push(textBox(cx + R + 4, cy + 3.5, 1, 10, "start"));
  // Reactance labels outside the rim, where each arc meets it.
  for (const x of X_VALUES) {
    for (const sgn of [1, -1]) {
      const xv = sgn * x;
      const ang = Math.atan2(2 * xv, xv * xv - 1);
      const lx = cx + (R + 9) * Math.cos(ang);
      const ly = cy - (R + 9) * Math.sin(ang) + 3.5;
      const anchor = Math.cos(ang) > 0.3 ? "start" : Math.cos(ang) < -0.3 ? "end" : "middle";
      const t = `${sgn < 0 ? "−" : ""}j${sig(x)}`;
      out.push(txt(lx, ly, t, anchor, 9, "#444444"));
      boxes.push(textBox(lx, ly, t.length, 9, anchor));
    }
  }
  // Normalisation note, top left.
  const note = `z = Z/Z₀, Z₀ = ${sig(inp.z0)} Ω`;
  out.push(txt(10, 16, note, "start", 10, "#000000"));
  boxes.push(textBox(10, 16, note.length, 10, "start"));

  const rho = cAbs(inp.gammaL);
  const markR = 3.6;
  const BLUE = "#1f5fa8", RED = "#c00000";
  // VSWR circle (dashed), unless it is the rim or a point.
  if (rho > 0.004 && rho < 0.999) out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R * rho)}" fill="none" stroke="#555555" stroke-width="0.9" stroke-dasharray="4 3"/>`);
  // The rotation arc toward the generator, stopping short of both markers, with an arrowhead.
  const alpha = 4 * Math.PI * inp.turns; // radians, clockwise
  const radPx = R * rho;
  const gap = radPx > 0 ? (markR + 2.5) / radPx : Infinity;
  const arcDrawn = inp.gammaIn !== null && rho > 0.04 && alpha > 2 * gap + 0.12 && alpha < 2 * Math.PI - 2 * gap;
  if (arcDrawn) {
    const phiL = Math.atan2(inp.gammaL.im, inp.gammaL.re);
    const a0 = phiL - gap, a1 = phiL - alpha + gap + 0.06;
    const pt = (a: number): [number, number] => [cx + radPx * Math.cos(a), cy - radPx * Math.sin(a)];
    const [sx, sy] = pt(a0), [ex, ey] = pt(a1);
    const sweepAng = a0 - a1;
    out.push(`<path d="M${f(sx)} ${f(sy)} A${f(radPx)} ${f(radPx)} 0 ${sweepAng > Math.PI ? 1 : 0} 1 ${f(ex)} ${f(ey)}" fill="none" stroke="${BLUE}" stroke-width="1.8"/>`);
    // Arrowhead: tip a little past the arc end along the clockwise tangent (screen direction (sin a, cos a)).
    const tipA = phiL - alpha + gap;
    const [tx, ty] = pt(tipA);
    const dx = Math.sin(tipA), dy = Math.cos(tipA);
    const L = 8, Wd = 3.6;
    const bx = tx - dx * L, by = ty - dy * L;
    out.push(`<polygon points="${f(tx)},${f(ty)} ${f(bx - dy * Wd)},${f(by + dx * Wd)} ${f(bx + dy * Wd)},${f(by - dx * Wd)}" fill="${BLUE}"/>`);
  }
  // Points: the load (filled red), the input (open blue).
  const pL = P(inp.gammaL);
  const pIn = inp.gammaIn ? P(inp.gammaIn) : null;
  // Equal: a whole number of half wavelengths (one marker). Close: distinct impedances whose markers overlap at this
  // scale (both markers drawn, one shared label) — never labelled equal.
  const equal = pIn !== null && inp.gammaIn !== null && (inp.turns === 0 || cAbs({ re: inp.gammaIn.re - inp.gammaL.re, im: inp.gammaIn.im - inp.gammaL.im }) < 1e-9);
  const coincide = pIn !== null && (equal || Math.hypot(pIn[0] - pL[0], pIn[1] - pL[1]) < 2 * markR);
  for (const p of [pL, ...(pIn && !coincide ? [pIn] : [])]) boxes.push({ x0: p[0] - markR - 1, y0: p[1] - markR - 1, x1: p[0] + markR + 1, y1: p[1] + markR + 1 });
  if (pIn && !equal) out.push(`<circle cx="${f(pIn[0])}" cy="${f(pIn[1])}" r="${markR}" fill="#ffffff" stroke="${BLUE}" stroke-width="1.6"/>`);
  out.push(`<circle cx="${f(pL[0])}" cy="${f(pL[1])}" r="${markR}" fill="${RED}" stroke="#ffffff" stroke-width="0.8"/>`);
  // Point labels: the free spot nearest the outward radial direction; a white backing keeps the grid off the glyphs.
  const H = cy + R + 34 + 4 * 16;
  const placeLabel = (p: [number, number], g: Cx, sub: string, colour: string, pairSep = ""): void => {
    const size = 11;
    const chars = 1 + sub.length * 0.75 + (pairSep ? pairSep.length + 2.5 : 0);
    // Outward from the centre, except near the rim, where the reactance labels are: there, inward.
    const rg = cAbs(g);
    const out0 = Math.atan2(-(p[1] - cy), p[0] - cx);
    const pref = rg <= 0.05 ? Math.PI / 4 : rg > 0.82 ? out0 + Math.PI : out0;
    const cands: number[] = [];
    for (let k = 0; k < 16; k++) cands.push(pref + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8));
    let chosen: { x: number; y: number; anchor: string; box: Box } | null = null;
    for (const dist of [9, 16, 24]) {
      for (const a of cands) {
        const c = Math.cos(a), s = Math.sin(a);
        const anchor = c > 0.38 ? "start" : c < -0.38 ? "end" : "middle";
        const x = p[0] + dist * c;
        const y = p[1] - dist * s + (s > 0.38 ? 0 : s < -0.38 ? 0.78 * size : 0.39 * size);
        const box = textBox(x, y, chars, size, anchor);
        if (box.x0 < 2 || box.x1 > W - 2 || box.y0 < 22 || box.y1 > cy + R + 26) continue;
        const pad: Box = { x0: box.x0 - 3, y0: box.y0 - 3, x1: box.x1 + 3, y1: box.y1 + 3 };
        if (boxes.some((b) => overlaps(b, pad))) continue;
        chosen = { x, y, anchor, box };
        break;
      }
      if (chosen) break;
    }
    if (!chosen) {
      const x = p[0] + 9, y = p[1] - 9;
      chosen = { x, y, anchor: "start", box: textBox(x, y, chars, size, "start") };
    }
    const b = chosen.box;
    out.push(`<rect x="${f(b.x0 - 1.5)}" y="${f(b.y0 - 1)}" width="${f(b.x1 - b.x0 + 3)}" height="${f(b.y1 - b.y0 + 2)}" fill="#ffffff" fill-opacity="0.85"/>`);
    out.push(
      pairSep
        ? `<text x="${f(chosen.x)}" y="${f(chosen.y)}" text-anchor="${chosen.anchor}" font-family="${FONT}" font-size="${size}" fill="#000000">Z<tspan dy="${f(size * 0.3)}" font-size="${f(size * 0.75)}">L</tspan><tspan dy="${f(-size * 0.3)}"${/^ /.test(pairSep) ? ` dx="${f(size * 0.28)}"` : ""}>${esc(pairSep.replace(/^ /, ""))}Z</tspan><tspan dy="${f(size * 0.3)}" font-size="${f(size * 0.75)}">in</tspan></text>`
        : zSub(chosen.x, chosen.y, sub, chosen.anchor, size, colour),
    );
    boxes.push(b);
  };
  placeLabel(pL, inp.gammaL, "L", RED, coincide ? (equal ? " = " : ", ") : "");
  if (pIn && inp.gammaIn && !coincide) placeLabel(pIn, inp.gammaIn, "in", BLUE);

  // Legend: one entry per line under the chart.
  const lx = 28;
  let ly = cy + R + 40;
  const legend: string[] = [];
  legend.push(`<circle cx="${lx + 8}" cy="${f(ly - 3.5)}" r="${markR}" fill="${RED}"/>`);
  legend.push(zSub(lx + 22, ly, "L", "start", 11, "#000000", ` = ${inp.zlText}`, "Load "));
  ly += 16;
  if (inp.gammaIn !== null) {
    legend.push(`<circle cx="${lx + 8}" cy="${f(ly - 3.5)}" r="${markR}" fill="#ffffff" stroke="${BLUE}" stroke-width="1.6"/>`);
    legend.push(zSub(lx + 22, ly, "in", "start", 11, "#000000", ` = ${inp.zinText ?? "open circuit"}`, "Input "));
    ly += 16;
  }
  if (rho > 0.004 && rho < 0.999 && inp.vswr !== null) {
    legend.push(`<line x1="${lx}" y1="${f(ly - 3.5)}" x2="${lx + 16}" y2="${f(ly - 3.5)}" stroke="#555555" stroke-width="0.9" stroke-dasharray="4 3"/>`);
    legend.push(txt(lx + 22, ly, `VSWR circle: VSWR ${sig(inp.vswr)}, |Γ| = ${sig(rho)}`, "start", 11));
    ly += 16;
  } else if (rho >= 0.999) {
    legend.push(txt(lx + 22, ly, "|Γ| = 1: the VSWR circle is the rim (total reflection)", "start", 11));
    ly += 16;
  } else {
    legend.push(txt(lx + 22, ly, "Matched: the load sits at the centre, Γ = 0", "start", 11));
    ly += 16;
  }
  if (inp.gammaIn !== null) {
    const ell = `ℓ = ${sig(inp.turns + 0.5 * inp.halfWaves, 4)}λ toward the generator`;
    const turnsNote = inp.halfWaves > 0 ? (inp.turns > 0 ? ` (${inp.halfWaves} × λ/2 + ${sig(inp.turns, 4)}λ drawn)` : ` (${inp.halfWaves} × λ/2: input = load)`) : "";
    if (arcDrawn) {
      legend.push(`<line x1="${lx}" y1="${f(ly - 3.5)}" x2="${lx + 10}" y2="${f(ly - 3.5)}" stroke="${BLUE}" stroke-width="1.8"/>`);
      legend.push(`<polygon points="${lx + 17},${f(ly - 3.5)} ${lx + 9},${f(ly - 7.1)} ${lx + 9},${f(ly + 0.1)}" fill="${BLUE}"/>`);
    }
    const why = arcDrawn ? "" : equal ? "" : coincide ? "; the two points overlap at this scale" : rho <= 0.04 ? "; arc not drawn (load near the centre)" : "; arc too short to draw";
    legend.push(txt(lx + 22, ly, ell + turnsNote + why, "start", 11));
    ly += 16;
  }
  out.push(...legend);
  const Hf = Math.max(H, ly + 6);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${f(Hf)}" viewBox="0 0 ${W} ${f(Hf)}"><rect width="${W}" height="${f(Hf)}" fill="#ffffff"/>${out.join("")}</svg>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Matching networks: |Γ_in| against f/f₀
// ---------------------------------------------------------------------------------------------------------------

export interface MatchCurve {
  label: string;
  colour: string;
  dashed?: boolean;
  /** |Γ_in| at F = f/f₀. */
  g: (F: number) => number;
}

const MATCH_WIDTH = 460;

/** |Γ_in| of each matching solution from 0.5 f₀ to 1.5 f₀ (load held constant), with the VSWR limit as a line. */
export function matchBandSvg(curves: MatchCurve[], gLimit: number, vswrLimit: number, width = MATCH_WIDTH): string {
  const N = 400;
  const series: Series[] = curves.map((c) => {
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= N; i++) {
      const F = 0.5 + i / N;
      pts.push({ x: F, y: Math.min(1, c.g(F)) });
    }
    return { points: pts, type: "line" as const, color: c.colour, label: c.label };
  });
  series.push({ points: [{ x: 0.5, y: gLimit }, { x: 1.5, y: gLimit }], type: "line", color: "#777777", label: `VSWR ${sig(vswrLimit, 3)} (|Γ| = ${sig(gLimit, 3)})` });
  return buildPlotSvg(series, {
    xlabel: "Frequency, f/f₀",
    ylabel: "|Γ| at the input",
    xLimits: { min: 0.5, max: 1.5, step: 0.1 },
    yLimits: { min: 0, max: 1, step: 0.2 },
    width,
    height: Math.round(width * 0.72),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Two-port summary: |Sij| in dB as bars, each labelled with its magnitude and angle
// ---------------------------------------------------------------------------------------------------------------

export interface SBar {
  /** The index pair, "11", "21", "12", "22". */
  sub: string;
  /** 20 log₁₀|S| (dB), or null for S = 0 (no bar). */
  db: number | null;
  angleDeg: number;
  kind: "reflection" | "transmission";
}

/** "S" with a two-digit subscript. */
const sSub = (x: number, y: number, sub: string, anchor: string, size: number): string =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" fill="#000000">S<tspan dy="${f(size * 0.3)}" font-size="${f(size * 0.72)}">${esc(sub)}</tspan></text>`;

export function sParamBarsSvg(bars: SBar[], width = 460): string {
  const W = width, H = Math.round(width * 0.66);
  const BLUE = "#1f5fa8", RED = "#c00000";
  const vals = bars.map((b) => b.db).filter((v): v is number => v !== null);
  const lo0 = Math.min(0, ...vals), hi0 = Math.max(0, ...vals);
  const span = Math.max(hi0 - lo0, 1);
  // Head room for the two-line value labels above a positive bar and below a negative one.
  const ax = linearAxis(lo0 - (lo0 < 0 ? 0.32 * span : 0), hi0 + (hi0 > 0 ? 0.32 * span : 0.08 * span), { loose: true });
  const lo = ax.lo, hi = ax.hi;
  const L = 64, Rm = 16, T = 30, B = 46;
  const ph = H - T - B, pw = W - L - Rm;
  const Y = (v: number): number => T + ((hi - v) / (hi - lo)) * ph;
  const out: string[] = [];
  out.push(txt(W / 2, 18, "S-parameters: magnitude (dB) and angle", "middle", 12));
  // Grid and ticks.
  ax.values.forEach((v, i) => {
    const y = Y(v);
    out.push(`<line x1="${L}" y1="${f(y)}" x2="${W - Rm}" y2="${f(y)}" stroke="${Math.abs(v) < 1e-12 ? "#000000" : "#e2e2e2"}" stroke-width="${Math.abs(v) < 1e-12 ? 1 : 0.6}"/>`);
    out.push(txt(L - 6, y + 3.5, ax.labels[i] + (ax.multiplier ?? ""), "end", 10));
  });
  out.push(`<line x1="${L}" y1="${T}" x2="${L}" y2="${T + ph}" stroke="#000000" stroke-width="1"/>`);
  out.push(`<text x="16" y="${f(T + ph / 2)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#000000" transform="rotate(-90 16 ${f(T + ph / 2)})">|S| (dB)</text>`);
  const slot = pw / bars.length;
  const bw = Math.min(54, slot * 0.5);
  bars.forEach((b, i) => {
    const xc = L + slot * (i + 0.5);
    out.push(sSub(xc, T + ph + 16, b.sub, "middle", 12));
    if (b.db === null) {
      out.push(txt(xc, Y(0) - 6, "0 (no bar)", "middle", 10, "#555555"));
      return;
    }
    const y0 = Y(0), y1 = Y(b.db);
    const col = b.kind === "reflection" ? BLUE : RED;
    out.push(`<rect x="${f(xc - bw / 2)}" y="${f(Math.min(y0, y1))}" width="${f(bw)}" height="${f(Math.max(0.8, Math.abs(y1 - y0)))}" fill="${col}"/>`);
    const up = b.db >= 0;
    const l1 = `${(Math.abs(b.db) < 0.005 ? "0.00" : b.db.toFixed(2)).replace(/^-/, "−")} dB`;
    const l2 = `∠${(Math.abs(b.angleDeg) < 0.05 ? "0.0" : b.angleDeg.toFixed(1)).replace(/^-/, "−")}°`;
    // The two baselines: the first spot (moving away from the bar end, 2 px steps) where no grid line runs through
    // either line of text.
    const gridYs = ax.values.map(Y);
    const clear = (yb: number): boolean => gridYs.every((g) => g < yb - 9 || g > yb + 2.5);
    let a1 = up ? y1 - 18 : y1 + 13;
    for (let k = 0; k <= 12; k++) {
      const c1 = up ? y1 - 18 - 2 * k : y1 + 13 + 2 * k;
      if (clear(c1) && clear(c1 + 12)) {
        a1 = c1;
        break;
      }
    }
    out.push(txt(xc, a1, l1, "middle", 10));
    out.push(txt(xc, a1 + 12, l2, "middle", 10, "#444444"));
  });
  // Key: reflection / transmission.
  const ky = H - 10;
  out.push(`<rect x="${L}" y="${ky - 9}" width="10" height="10" fill="${BLUE}"/>`);
  out.push(txt(L + 15, ky, "Reflection", "start", 11));
  out.push(`<rect x="${L + 110}" y="${ky - 9}" width="10" height="10" fill="${RED}"/>`);
  out.push(txt(L + 125, ky, "Transmission", "start", 11));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${out.join("")}</svg>`;
}
