// Figure for the Release Q linear-optics tools (part Q4): output-pattern probabilities of a multiphoton linear network
// as grouped bars — the indistinguishable (quantum) probability beside the same photons made distinguishable, the
// comparison every boson-sampling and HOM figure draws. Bars are labelled with Fock occupation patterns |2,0,1⟩ (not
// qubit bit strings, which probabilityBarsSvg in quantumCharts.ts draws). Colours literal hex; Arial, as
// engCharts2026.ts.

import { textWidthPt } from "./arialMetrics";
import { fmtSig } from "./axis";

const FONT = "Arial, Helvetica, sans-serif";
const f = (v: number): string => String(Math.round(v * 100) / 100);
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const text = (x: number, y: number, t: string, anchor = "middle", size = 11, fill = "#000000", extra = ""): string =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" fill="${fill}"${extra}>${esc(t)}</text>`;
const line = (x1: number, y1: number, x2: number, y2: number, stroke = "#000000", w = 1): string =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${stroke}" stroke-width="${w}"/>`;
const sig = (v: number, n = 3): string =>
  Math.abs(v) < 5e-13 ? "0" : fmtSig(v, n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");

export interface FockBar {
  /** The occupation pattern, e.g. [2, 0, 1]. */
  t: number[];
  /** Indistinguishable-photon probability. */
  p: number;
  /** Distinguishable-photon probability (omitted: not drawn). */
  pDist?: number;
}

/** The most patterns one chart draws; beyond it the most probable are drawn and the rest summarised. */
export const FOCK_MAX_BARS = 16;

const BLUE = "#1f5fa8";
const GREY = "#a6a6a6";

/**
 * Output-pattern probabilities as grouped bars over the Fock patterns, in the order given. When more than
 * FOCK_MAX_BARS are given, the most probable (indistinguishable) are drawn, in the order given, and the probability
 * the others carry is written under the axis.
 */
export function fockBarsSvg(bars: FockBar[], opts: { title?: string } = {}): string {
  let shown = bars.map((b, i) => ({ ...b, i }));
  let rest = 0, restDist = 0, restCount = 0;
  if (shown.length > FOCK_MAX_BARS) {
    const keep = new Set([...shown].sort((a, b) => b.p - a.p || a.i - b.i).slice(0, FOCK_MAX_BARS).map((b) => b.i));
    const others = shown.filter((b) => !keep.has(b.i));
    rest = others.reduce((s, b) => s + b.p, 0);
    restDist = others.reduce((s, b) => s + (b.pDist ?? 0), 0);
    restCount = others.length;
    shown = shown.filter((b) => keep.has(b.i));
  }
  const dist = shown.some((b) => b.pDist !== undefined);
  const labels = shown.map((b) => `|${b.t.join(",")}⟩`);
  const maxLab = Math.max(...labels.map((l) => textWidthPt(l, 11)));
  const slot = Math.max(dist ? 34 : 24, Math.min(64, Math.floor(600 / Math.max(1, shown.length))));
  const rotate = maxLab + 6 > slot;
  const L = 60, Rm = 16;
  const T = (opts.title ? 30 : 12) + (dist ? 22 : 0);
  const plotW = shown.length * slot;
  const W = Math.max(360, L + plotW + Rm);
  const plotH = 200;
  const B = T + plotH;
  const pmax = Math.max(0, ...shown.map((b) => Math.max(b.p, b.pDist ?? 0)));
  const top = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1].find((v) => v >= pmax - 1e-12) ?? 1;
  const xs0 = L + (W - L - Rm - plotW) / 2;
  const out: string[] = [];
  if (opts.title) out.push(text(W / 2, 18, opts.title, "middle", 12));
  if (dist) {
    // Legend above the plot, centred: two swatches.
    const a = "Indistinguishable photons", b = "Distinguishable photons";
    const wa = 16 + textWidthPt(a, 11), wb = 16 + textWidthPt(b, 11);
    const gap = 22;
    let x = (W - (wa + gap + wb)) / 2;
    const y = (opts.title ? 30 : 12) + 8;
    out.push(`<rect x="${f(x)}" y="${f(y - 9)}" width="11" height="11" fill="${BLUE}"/>`);
    out.push(text(x + 16, y + 1, a, "start", 11));
    x += wa + gap;
    out.push(`<rect x="${f(x)}" y="${f(y - 9)}" width="11" height="11" fill="${GREY}"/>`);
    out.push(text(x + 16, y + 1, b, "start", 11));
  }
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const v = (top * i) / ticks;
    const y = B - (plotH * i) / ticks;
    out.push(line(L, y, W - Rm, y, i === 0 ? "#000000" : "#e3e3e3", i === 0 ? 1 : 0.8));
    out.push(line(L - 4, y, L, y));
    out.push(text(L - 7, y + 4, sig(v, 3), "end", 11));
  }
  out.push(line(L, T, L, B));
  const yTitle = T + plotH / 2;
  out.push(`<text x="16" y="${f(yTitle)}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="#000000" transform="rotate(-90 16 ${f(yTitle)})">Probability</text>`);
  const bw = Math.min(dist ? 20 : 30, slot * (dist ? 0.38 : 0.7));
  shown.forEach((b, i) => {
    const xc = xs0 + slot * (i + 0.5);
    const hq = (plotH * b.p) / top;
    const xq = dist ? xc - bw - 1 : xc - bw / 2;
    if (hq > 0) out.push(`<rect x="${f(xq)}" y="${f(B - hq)}" width="${f(bw)}" height="${f(hq)}" fill="${BLUE}"/>`);
    if (dist && b.pDist !== undefined) {
      const hd = (plotH * b.pDist) / top;
      if (hd > 0) out.push(`<rect x="${f(xc + 1)}" y="${f(B - hd)}" width="${f(bw)}" height="${f(hd)}" fill="${GREY}"/>`);
    }
    if (rotate) {
      const y = B + 6 + textWidthPt(labels[i], 11) / 2;
      out.push(`<text x="${f(xc + 4)}" y="${f(y)}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#000000" transform="rotate(-90 ${f(xc + 4)} ${f(y)})">${esc(labels[i])}</text>`);
    } else out.push(text(xc, B + 15, labels[i], "middle", 11));
  });
  const xLabH = rotate ? maxLab + 10 : 18;
  let yb = B + xLabH + 18;
  out.push(text(L + (W - L - Rm) / 2, yb, "Output pattern (photons in modes 0, 1, 2, …)", "middle", 12));
  if (restCount > 0) {
    yb += 16;
    out.push(
      text(L + (W - L - Rm) / 2, yb, `${restCount} other patterns not drawn: total ${sig(rest, 3)}${dist ? ` (distinguishable ${sig(restDist, 3)})` : ""}`, "middle", 11, "#444444"),
    );
  }
  const H = yb + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}" height="${f(H)}" viewBox="0 0 ${f(W)} ${f(H)}"><rect x="0" y="0" width="${f(W)}" height="${f(H)}" fill="#ffffff"/>${out.join("")}</svg>`;
}
