// Sequence diagrams (docs/SCOPE-DIAGRAMS.md): a column per participant with its lifeline, a row per message —
// solid arrows for calls, dashed for replies, a loop back for a message to itself.

import { DiagramOptions, DiagramResult, FONT_PT, LINE_HEIGHT, NUMERAL, arrowhead, f, finishFigure, leadLine, line, polyline, text, textW, wrap } from "./diagramCore";

interface Participant {
  id: string;
  label: string;
  numeral: string | null;
}
interface Message {
  from: string;
  to: string;
  label: string;
  dashed: boolean;
}

const MAX = 16;
const MAX_MESSAGES = 60;

export function drawSequence(input: string, opts: DiagramOptions = {}): DiagramResult {
  const errors: string[] = [];
  const notes: string[] = [];
  const parts: Participant[] = [];
  const byId = new Map<string, Participant>();
  const msgs: Message[] = [];
  const addP = (id: string, label: string): void => {
    if (byId.has(id)) return;
    if (parts.length >= MAX) {
      if (!errors.some((e) => e.startsWith("More than"))) errors.push(`More than ${MAX} participants — split the figure.`);
      return;
    }
    const p = { id, label, numeral: NUMERAL.test(id) ? id : null };
    byId.set(id, p);
    parts.push(p);
  };
  const undeclared: string[] = [];
  input.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith("#")) return;
    const pm = /^participant\s+(\S+)(?:\s+(.+))?$/i.exec(t);
    if (pm) {
      if (byId.has(pm[1])) errors.push(`Line ${i + 1}: participant “${pm[1]}” is declared twice.`);
      else addP(pm[1], (pm[2] ?? pm[1]).trim());
      return;
    }
    // Lazy ids, so "A-->B" is A, a dashed reply, B — never a participant called "A-".
    const mm = /^(\S+?)\s*(-->|->)\s*(\S+?)\s*(?::\s*(.*))?$/.exec(t);
    if (mm) {
      if (msgs.length >= MAX_MESSAGES) {
        if (!errors.some((e) => e.startsWith("More than"))) errors.push(`More than ${MAX_MESSAGES} messages — split the figure.`);
        return;
      }
      for (const id of [mm[1], mm[3]]) if (!byId.has(id)) addP(id, id), undeclared.push(id);
      msgs.push({ from: mm[1], to: mm[3], label: (mm[4] ?? "").trim(), dashed: mm[2] === "-->" });
      return;
    }
    errors.push(`Line ${i + 1}: “${t}” is not “participant 102 Client” or a message (“102 -> 104 : request”).`);
  });
  // Messages may introduce their own participants; when others were declared, an undeclared one is likely a typo.
  if (undeclared.length && parts.length > undeclared.length)
    notes.push(`Not declared, so drawn with the id as its label: ${undeclared.map((u) => `“${u}”`).join(", ")} — add “participant ${undeclared[0]} …” if that is a new participant.`);
  if (!errors.length && !parts.length) errors.push("Nothing to draw yet.");
  if (errors.length) return { ok: false, errors, notes };

  const style = opts.numerals ?? "inside";
  const pad = 9;
  const heads = parts.map((p) => {
    const lines = wrap(p.label, 130);
    if (style === "inside" && p.numeral) lines.push(p.numeral);
    const w = Math.max(70, ...lines.map((l) => textW(l))) + 2 * pad;
    const h = (lines.length - 1) * LINE_HEIGHT + FONT_PT + 2 * pad;
    return { p, lines, w, h };
  });
  const maxLabel = Math.max(0, ...msgs.filter((m) => m.from !== m.to).map((m) => textW(m.label)));
  // Columns far enough apart for every adjacent message label and every self-message's loop and label.
  const selfLabel = Math.max(0, ...msgs.filter((m) => m.from === m.to).map((m) => 50 + textW(m.label)));
  const spacing = Math.max(150, maxLabel + 40, selfLabel + 20, ...heads.map((h) => h.w + 30));
  const top = style === "lead" ? 26 : 0;
  const headH = Math.max(...heads.map((h) => h.h));
  const xs = heads.map((_, i) => heads[0].w / 2 + i * spacing);
  const rowH = 44;
  const out: string[] = [];
  const firstRow = top + headH + 34;
  msgs.forEach((m, k) => {
    const y = firstRow + k * rowH;
    const i = parts.findIndex((p) => p.id === m.from), j = parts.findIndex((p) => p.id === m.to);
    if (i === j) {
      const x = xs[i];
      out.push(polyline([[x, y - 8], [x + 36, y - 8], [x + 36, y + 8], [x, y + 8]], m.dashed));
      out.push(arrowhead(x, y + 8, -1, 0));
      if (m.label) out.push(text(x + 42, y + 4, m.label, { anchor: "start", halo: true }));
      return;
    }
    out.push(line(xs[i], y, xs[j], y, m.dashed));
    out.push(arrowhead(xs[j], y, xs[j] - xs[i], 0));
    // Over a message that spans lifelines, the label sits by its source, clear of the lifelines it crosses.
    const lx = Math.abs(j - i) > 1 ? xs[i] + Math.sign(j - i) * (spacing / 2) : (xs[i] + xs[j]) / 2;
    if (m.label) out.push(text(lx, y - 6, m.label, { halo: true }));
  });
  const bottom = firstRow + Math.max(0, msgs.length - 1) * rowH + 30;
  heads.forEach((h, i) => {
    const x = xs[i] - h.w / 2, y = top + (headH - h.h) / 2;
    out.unshift(line(xs[i], top + headH, xs[i], bottom, true));
    out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(h.w)}" height="${f(h.h)}" fill="#fff" stroke="#000" stroke-width="1.1"/>`);
    const ty = y + h.h / 2 - ((h.lines.length - 1) * LINE_HEIGHT) / 2 + FONT_PT * 0.35;
    h.lines.forEach((l, k) => out.push(text(xs[i], ty + k * LINE_HEIGHT, l, { underline: style === "inside" && !!h.p.numeral && k === h.lines.length - 1 })));
    if (style === "lead" && h.p.numeral) out.push(leadLine(x + h.w + 18, y - 6, x + h.w - 6, y + 8, h.p.numeral));
  });
  // The rightmost thing drawn: the last header, or a self-message's loop and label.
  const selfReach = msgs.filter((m) => m.from === m.to).map((m) => xs[parts.findIndex((p) => p.id === m.from)] + 42 + textW(m.label) + 4);
  const width = Math.max(xs[xs.length - 1] + heads[heads.length - 1].w / 2 + (style === "lead" ? 40 : 0), ...selfReach);
  const fin = finishFigure(out.join(""), width, bottom + 4, opts, notes);
  return { ok: true, svg: fin.svg, widthPt: fin.widthPt, heightPt: fin.heightPt, notes, numerals: parts.map((p) => p.numeral).filter((x): x is string => !!x) };
}
