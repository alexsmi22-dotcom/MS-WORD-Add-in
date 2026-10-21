// Digital timing diagrams (docs/SCOPE-DIAGRAMS.md): a row per signal on a shared time grid. Levels per period: 0, 1,
// x (unknown, cross-hatched), z (high impedance, mid-level); any other token is a bus value drawn as a labelled
// segment; "clock N" is N full clock periods.

import { DiagramOptions, DiagramResult, FONT_PT, f, finishFigure, line, polyline, text, textW } from "./diagramCore";

const MIN_PERIOD = 30;
const ROW = 40;
const MAX_SIGNALS = 24;
const MAX_PERIODS = 64;

type Seg = { kind: "0" | "1" | "x" | "z" } | { kind: "bus"; label: string };

export function drawTiming(input: string, opts: DiagramOptions = {}): DiagramResult {
  const errors: string[] = [];
  const notes: string[] = [];
  const signals: Array<{ name: string; segs: Seg[]; clock: boolean }> = [];
  input.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith("#")) return;
    const m = /^([^:]+):\s*(.*)$/.exec(t);
    if (!m) {
      errors.push(`Line ${i + 1}: “${t}” is not a signal (“CLK: clock 8”, “DATA: 0 1 1 x 0”).`);
      return;
    }
    if (signals.length >= MAX_SIGNALS) {
      if (!errors.some((e) => e.startsWith("More than"))) errors.push(`More than ${MAX_SIGNALS} signals — split the figure.`);
      return;
    }
    const name = m[1].trim();
    const body = m[2].trim();
    const ck = /^clock\s+(\d+)$/i.exec(body);
    if (ck) {
      const n = Number(ck[1]);
      if (n < 1 || n > MAX_PERIODS) {
        errors.push(`Line ${i + 1}: a clock of ${n} periods — 1 to ${MAX_PERIODS}.`);
        return;
      }
      signals.push({ name, segs: Array.from({ length: n }, () => ({ kind: "1" as const })), clock: true });
      return;
    }
    const toks = body.split(/\s+/).filter(Boolean);
    if (!toks.length) {
      errors.push(`Line ${i + 1}: signal “${name}” has no levels.`);
      return;
    }
    if (toks.length > MAX_PERIODS) {
      errors.push(`Line ${i + 1}: ${toks.length} periods — at most ${MAX_PERIODS}.`);
      return;
    }
    const segs: Seg[] = toks.map((tk) => (/^[01xzXZ]$/.test(tk) ? { kind: tk.toLowerCase() as "0" | "1" | "x" | "z" } : { kind: "bus" as const, label: tk === "=" ? "" : tk }));
    signals.push({ name, segs, clock: false });
  });
  if (!errors.length && !signals.length) errors.push("Nothing to draw yet.");
  if (errors.length) return { ok: false, errors, notes };

  const periods = Math.max(...signals.map((s) => s.segs.length));
  // A period wide enough for every bus value in its run (never smaller lettering: wider periods instead).
  let PERIOD = MIN_PERIOD;
  for (const s of signals) {
    let k = 0;
    while (k < s.segs.length) {
      const sg = s.segs[k];
      let j = k;
      while (j + 1 < s.segs.length && sg.kind === "bus" && s.segs[j + 1].kind === "bus" && ((s.segs[j + 1] as { label: string }).label === "" || (s.segs[j + 1] as { label: string }).label === (sg as { label: string }).label)) j++;
      if (sg.kind === "bus" && sg.label) PERIOD = Math.max(PERIOD, (textW(sg.label) + 14) / (j - k + 1));
      k = j + 1;
    }
  }
  PERIOD = Math.ceil(PERIOD);
  if (signals.some((s) => s.segs.length !== periods)) notes.push(`Signals of different lengths: the shorter ones hold their last level to ${periods} periods.`);
  const nameW = Math.max(...signals.map((s) => textW(s.name))) + 14;
  // A pattern id of this figure's own, so two figures in one page never share it.
  let hsh = 0;
  for (const ch of input) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  const hatchId = `jlhatch${hsh.toString(36)}`;
  const out: string[] = [];
  // The time grid: a light dotted line at each period boundary.
  const gridBottom = signals.length * ROW;
  for (let k = 0; k <= periods; k++) out.push(`<line x1="${f(nameW + k * PERIOD)}" y1="0" x2="${f(nameW + k * PERIOD)}" y2="${f(gridBottom)}" stroke="#000" stroke-width="0.4" stroke-dasharray="1 3"/>`);
  signals.forEach((s, r) => {
    const yTop = r * ROW + 8, yBot = r * ROW + ROW - 10, yMid = (yTop + yBot) / 2;
    out.push(text(nameW - 10, yMid + FONT_PT * 0.35, s.name, { anchor: "end" }));
    const segs = [...s.segs];
    while (segs.length < periods) segs.push(segs[segs.length - 1]);
    if (s.clock) {
      // A clock runs its own N periods, then holds low (as the note says) — never more cycles than written.
      const pts: Array<[number, number]> = [];
      for (let k = 0; k < s.segs.length; k++) {
        const x0 = nameW + k * PERIOD;
        pts.push([x0, yBot], [x0, yTop], [x0 + PERIOD / 2, yTop], [x0 + PERIOD / 2, yBot]);
      }
      pts.push([nameW + periods * PERIOD, yBot]);
      out.push(polyline(pts));
      return;
    }
    const lv = (sg: Seg): number => (sg.kind === "1" ? yTop : sg.kind === "0" ? yBot : yMid);
    let k = 0;
    while (k < periods) {
      const sg = segs[k];
      let j = k;
      // A run of the same level (or the same bus value) is one segment.
      while (j + 1 < periods && segs[j + 1].kind === sg.kind && (sg.kind !== "bus" || (segs[j + 1] as { label: string }).label === "" || (segs[j + 1] as { label: string }).label === (sg as { label: string }).label)) j++;
      const x0 = nameW + k * PERIOD, x1 = nameW + (j + 1) * PERIOD;
      if (sg.kind === "bus" || sg.kind === "x") {
        const e = 4;
        out.push(`<polygon points="${f(x0)},${f(yMid)} ${f(x0 + e)},${f(yTop)} ${f(x1 - e)},${f(yTop)} ${f(x1)},${f(yMid)} ${f(x1 - e)},${f(yBot)} ${f(x0 + e)},${f(yBot)}" fill="${sg.kind === "x" ? `url(#${hatchId})` : "#fff"}" stroke="#000" stroke-width="1.1"/>`);
        if (sg.kind === "bus" && sg.label) out.push(text((x0 + x1) / 2, yMid + FONT_PT * 0.35, sg.label, { size: FONT_PT }));
      } else {
        out.push(line(x0, lv(sg), x1, lv(sg)));
      }
      // The transition into the next segment.
      if (j + 1 < periods) {
        const nx = segs[j + 1];
        if (sg.kind !== "bus" && sg.kind !== "x" && nx.kind !== "bus" && nx.kind !== "x" && lv(sg) !== lv(nx)) out.push(line(x1, lv(sg), x1, lv(nx)));
      }
      k = j + 1;
    }
  });
  const defs = `<defs><pattern id="${hatchId}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#000" stroke-width="0.8"/></pattern></defs>`;
  const fin = finishFigure(defs + out.join(""), nameW + periods * PERIOD + 6, gridBottom + 2, opts, notes);
  return { ok: true, svg: fin.svg, widthPt: fin.widthPt, heightPt: fin.heightPt, notes, numerals: [] };
}
