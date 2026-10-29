/**
 * THE LAYOUT AUDIT IN THE PRODUCT (2026-10-28, figure fix round 2). A TypeScript port of scripts/figure-layout-audit.js
 * auditSvg — the instrument the check:figures QC gate runs over the as-drawn corpus — so that a figure STYLE can measure
 * the figure it is about to insert (insertCapability.prepareFigure) and refuse one whose fit made it illegible: tick
 * labels run together, a title or legend runs off the canvas, a line struck through a label.
 *
 * The constants, thresholds and parsing are the script's, byte for byte (ADVANCE 0.58, LINE 0.78, collision
 * max(4, 0.06 × smaller box), the 4.5% clip pad). figureLayoutAudit.test.ts runs both over the same figures and requires
 * identical findings, so the two cannot drift. The script stays the QC gate's copy (it must be requirable from node
 * without a TypeScript step); this one is bundled into the pane.
 */

const ADVANCE = 0.58;
const LINE = 0.78;

export interface TextBox {
  text: string;
  rotated: boolean;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  fs: number;
}

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  at: number;
}

export function flattenTranslates(svg: string): string {
  const num = "(-?[\\d.]+(?:[eE][-+]?\\d+)?)";
  const shift = (frag: string, tx: number, ty: number): string => {
    let out = frag.replace(new RegExp(`\\b(x|x1|x2|cx)="${num}"`, "g"), (_m, k: string, v: string) => `${k}="${Number(v) + tx}"`);
    out = out.replace(new RegExp(`\\b(y|y1|y2|cy)="${num}"`, "g"), (_m, k: string, v: string) => `${k}="${Number(v) + ty}"`);
    out = out.replace(/\bpoints="([^"]*)"/g, (_m, pts: string) => {
      const moved = pts
        .trim()
        .split(/\s+/)
        .map((p) => {
          const [px, py] = p.split(",").map(Number);
          return Number.isFinite(px) && Number.isFinite(py) ? `${px + tx},${py + ty}` : p;
        })
        .join(" ");
      return `points="${moved}"`;
    });
    out = out.replace(/\bd="([^"]*)"/g, (m, d: string) => {
      if (/[^MLZz0-9.,\-+eE\s]/.test(d)) return m;
      const moved = d.replace(new RegExp(`([ML])\\s*${num}[,\\s]+${num}`, "g"), (_mm, cmd: string, px: string, py: string) => `${cmd}${Number(px) + tx},${Number(py) + ty}`);
      return `d="${moved}"`;
    });
    return out;
  };
  const OPEN = /<g\b([^>]*\btransform="translate\(\s*(-?[\d.]+)(?:[,\s]+(-?[\d.]+))?\s*\)"[^>]*)>/g;
  const HAS_TRANSLATE = /<g\b[^>]*\btransform="translate\(/;
  const SCALE_OPEN = /<g\b([^>]*\btransform="scale\(\s*([\d.]+(?:[eE][-+]?\d+)?)\s*\)"[^>]*)>/g;
  const scaleFrag = (frag: string, k: number): string => {
    let out = frag.replace(
      new RegExp(`(?<![\\w-])(x|x1|x2|cx|y|y1|y2|cy|width|height|r|rx|ry|font-size|stroke-width)="${num}"`, "g"),
      (_m, a: string, v: string) => `${a}="${Number(v) * k}"`,
    );
    out = out.replace(/\bpoints="([^"]*)"/g, (_m, pts: string) => {
      const moved = pts
        .trim()
        .split(/\s+/)
        .map((p) => {
          const [px, py] = p.split(",").map(Number);
          return Number.isFinite(px) && Number.isFinite(py) ? `${px * k},${py * k}` : p;
        })
        .join(" ");
      return `points="${moved}"`;
    });
    out = out.replace(
      /\bd="([^"]*)"/g,
      (_m, d: string) => `d="${d.replace(new RegExp(`([ML])\\s*${num}[,\\s]+${num}`, "g"), (_mm, cmd: string, px: string, py: string) => `${cmd}${Number(px) * k},${Number(py) * k}`)}"`,
    );
    out = out.replace(
      new RegExp(`\\brotate\\(\\s*${num}[,\\s]+${num}[,\\s]+${num}\\s*\\)`, "g"),
      (_m, a: string, cx: string, cy: string) => `rotate(${a} ${Number(cx) * k} ${Number(cy) * k})`,
    );
    return out;
  };
  const scalable = (frag: string): boolean => {
    for (const m of frag.matchAll(/\bd="([^"]*)"/g)) if (/[^MLZz0-9.,\-+eE\s]/.test(m[1])) return false;
    for (const m of frag.matchAll(/\btransform="([^"]*)"/g)) {
      if (!new RegExp(`^\\s*rotate\\(\\s*${num}[,\\s]+${num}[,\\s]+${num}\\s*\\)\\s*$`).test(m[1])) return false;
    }
    return !/font-size="[^"\d]/.test(frag);
  };
  const closeOf = (str: string, from: number): number => {
    const tag = /<g\b[^>]*?(\/?)>|<\/g>/g;
    tag.lastIndex = from;
    let depth = 1;
    let t: RegExpExecArray | null;
    while ((t = tag.exec(str))) {
      if (t[0] === "</g>") {
        if (--depth === 0) return t.index;
      } else if (t[1] !== "/") {
        depth++;
      }
    }
    return -1;
  };
  let s = svg;
  for (let pass = 0; pass < 64; pass++) {
    const opens = [...[...s.matchAll(OPEN)].map((m) => ({ m, scale: false })), ...[...s.matchAll(SCALE_OPEN)].map((m) => ({ m, scale: true }))].sort(
      (a, b) => (a.m.index as number) - (b.m.index as number),
    );
    let done = false;
    for (let i = opens.length - 1; i >= 0 && !done; i--) {
      const m = opens[i].m;
      const mi = m.index as number;
      const contentStart = mi + m[0].length;
      const close = closeOf(s, contentStart);
      if (close < 0) continue;
      const content = s.slice(contentStart, close);
      if (HAS_TRANSLATE.test(content)) continue;
      const pendingScale = [...content.matchAll(SCALE_OPEN)].some((sm) => {
        const cs = (sm.index as number) + sm[0].length;
        const ce = closeOf(content, cs);
        if (ce < 0) return false;
        const inner = content.slice(cs, ce);
        return HAS_TRANSLATE.test(inner) || scalable(inner);
      });
      if (pendingScale) continue;
      if (opens[i].scale) {
        const k = Number(m[2]);
        if (!(Number.isFinite(k) && k > 0) || !scalable(content)) continue;
        const attrs = scaleFrag(m[1].replace(/\btransform="scale\([^"]*\)"/, "").trim(), k);
        s = s.slice(0, mi) + `<g ${attrs}>` + scaleFrag(content, k) + "</g>" + s.slice(close + "</g>".length);
        done = true;
        continue;
      }
      const tx = Number(m[2]);
      const ty = m[3] === undefined ? 0 : Number(m[3]);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) continue;
      const attrs = m[1].replace(/\btransform="translate\([^"]*\)"/, "").trim();
      s = s.slice(0, mi) + `<g ${attrs}>` + shift(content, tx, ty) + "</g>" + s.slice(close + "</g>".length);
      done = true;
    }
    if (!done) break;
  }
  return s;
}

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/** Every <text> in an SVG, as a box plus its content (the audit's estimate). */
export function textBoxes(svg: string): TextBox[] {
  const out: TextBox[] = [];
  const groupSize = /<g[^>]*font-size="([\d.]+)"/.exec(svg);
  const inherited = groupSize ? Number(groupSize[1]) : 10;
  const re = /<text\s([^>]*)>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const attrs = m[1];
    const raw = decodeEntities(m[2].replace(/<[^>]*>/g, ""));
    const at = (name: string): string | null => {
      const a = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
      return a ? a[1] : null;
    };
    const x = Number(at("x"));
    const y = Number(at("y"));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const fs = Number(at("font-size")) || inherited;
    const anchor = at("text-anchor") || "start";
    const w = raw.length * fs * ADVANCE;
    const h = fs * LINE;
    const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    const rotated = /rotate\(-?90/.test(attrs);
    out.push({
      text: raw,
      rotated,
      x0: rotated ? x - h / 2 : x0,
      x1: rotated ? x + h / 2 : x0 + w,
      y0: rotated ? y - w / 2 : y - h * 0.8,
      y1: rotated ? y + w / 2 : y + h * 0.2,
      fs,
    });
  }
  return out;
}

function segments(svg: string): Seg[] {
  const out: Seg[] = [];
  let m: RegExpExecArray | null;
  const lineRe = /<line\s([^>]*)\/>/g;
  while ((m = lineRe.exec(svg))) {
    const a = m[1];
    const n = (k: string): number => {
      const r = new RegExp(`\\b${k}="([^"]*)"`).exec(a);
      return r ? Number(r[1]) : NaN;
    };
    const [x1, y1, x2, y2] = [n("x1"), n("y1"), n("x2"), n("y2")];
    if ([x1, y1, x2, y2].every(Number.isFinite)) out.push({ x1, y1, x2, y2, at: m.index });
  }
  const polyRe = /<polyline\s[^>]*points="([^"]*)"/g;
  while ((m = polyRe.exec(svg))) {
    const pts = m[1]
      .trim()
      .split(/\s+/)
      .map((p) => p.split(",").map(Number))
      .filter((p) => p.length === 2 && p.every(Number.isFinite));
    for (let i = 1; i < pts.length; i++) out.push({ x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], at: m.index });
  }
  const pathRe = /<path\s[^>]*\bd="([^"]*)"/g;
  while ((m = pathRe.exec(svg))) {
    const d = m[1];
    if (/[^MLmlZz0-9.,\-+eE\s]/.test(d)) continue;
    const pts: [number, number, boolean][] = [];
    const cmdRe = /([MLml])\s*(-?[\d.]+(?:[eE][-+]?\d+)?)[,\s]+(-?[\d.]+(?:[eE][-+]?\d+)?)/g;
    let c: RegExpExecArray | null;
    let cx = 0;
    let cy = 0;
    while ((c = cmdRe.exec(d))) {
      const rel = c[1] === "l" || c[1] === "m";
      const x = Number(c[2]);
      const y = Number(c[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        pts.length = 0;
        break;
      }
      cx = rel ? cx + x : x;
      cy = rel ? cy + y : y;
      pts.push([cx, cy, c[1].toUpperCase() === "M"]);
    }
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][2]) continue;
      out.push({ x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], at: m.index });
    }
  }
  return out;
}

function opaqueRects(svg: string): { x0: number; y0: number; x1: number; y1: number; at: number }[] {
  const out: { x0: number; y0: number; x1: number; y1: number; at: number }[] = [];
  const re = /<rect\s([^>]*)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const a = m[1];
    const at = (k: string): string | null => {
      const r = new RegExp(`\\b${k}="([^"]*)"`).exec(a);
      return r ? r[1] : null;
    };
    const opacity = at("fill-opacity");
    const fill = at("fill");
    if (opacity !== null && Number(opacity) < 0.99) continue;
    if (!fill || fill === "none") continue;
    const n = (k: string): number => Number(at(k) ?? "0");
    const x = n("x");
    const y = n("y");
    const w = n("width");
    const h = n("height");
    if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) out.push({ x0: x, y0: y, x1: x + w, y1: y + h, at: m.index });
  }
  return out;
}

function overlapArea(a: { x0: number; x1: number; y0: number; y1: number }, b: { x0: number; x1: number; y0: number; y1: number }): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

function segmentHitsBox(s: Seg, b: { x0: number; x1: number; y0: number; y1: number }): boolean {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, s.x1 - b.x0) && clip(dx, b.x1 - s.x1) && clip(-dy, s.y1 - b.y0) && clip(dy, b.y1 - s.y1) && t1 > t0;
}

/** One layout defect, with the text(s) it concerns (for a plain-language refusal). */
export interface LayoutFinding {
  kind: "COLLISION" | "STRIKETHROUGH" | "CLIPPED" | "TRUNCATED" | "DROPPED";
  /** The finding exactly as scripts/figure-layout-audit.js prints it (TRUNCATED is this file's own: see truncatedByFit). */
  line: string;
  a: string;
  b?: string;
}

/** The audit's findings for one figure (scripts/figure-layout-audit.js auditSvg, same order and text). */
export function auditLayout(rawSvg: string): LayoutFinding[] {
  const found: LayoutFinding[] = [];
  const svg = flattenTranslates(rawSvg);
  const boxes = textBoxes(svg);
  const vb = /<svg[^>]*\bviewBox="\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(svg);
  const size = /<svg[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/.exec(svg);
  const X0 = vb ? Number(vb[1]) : 0;
  const Y0 = vb ? Number(vb[2]) : 0;
  const W = vb ? X0 + Number(vb[3]) : size ? Number(size[1]) : 0;
  const H = vb ? Y0 + Number(vb[4]) : size ? Number(size[2]) : 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = overlapArea(boxes[i], boxes[j]);
      const smaller = Math.min((boxes[i].x1 - boxes[i].x0) * (boxes[i].y1 - boxes[i].y0), (boxes[j].x1 - boxes[j].x0) * (boxes[j].y1 - boxes[j].y0));
      if (a > Math.max(4, smaller * 0.06)) {
        found.push({
          kind: "COLLISION",
          line: `COLLISION  "${boxes[i].text.slice(0, 22)}" over "${boxes[j].text.slice(0, 22)}" (${a.toFixed(0)} px²)`,
          a: boxes[i].text,
          b: boxes[j].text,
        });
      }
    }
  }
  const segs = segments(svg);
  const rects = opaqueRects(svg);
  for (const b of boxes) {
    const inner = {
      x0: b.x0 + (b.x1 - b.x0) * 0.12,
      x1: b.x1 - (b.x1 - b.x0) * 0.12,
      y0: b.y0 + (b.y1 - b.y0) * 0.25,
      y1: b.y1 - (b.y1 - b.y0) * 0.25,
    };
    const backing = rects.filter((r) => r.x0 <= inner.x0 && r.x1 >= inner.x1 && r.y0 <= inner.y0 && r.y1 >= inner.y1);
    const coveredUntil = backing.length ? Math.max(...backing.map((r) => r.at)) : -1;
    for (const s of segs) {
      if (s.at < coveredUntil) continue;
      if (segmentHitsBox(s, inner)) {
        found.push({ kind: "STRIKETHROUGH", line: `STRIKETHROUGH  a line crosses "${b.text.slice(0, 26)}"`, a: b.text });
        break;
      }
    }
  }
  if (W && H) {
    for (const b of boxes) {
      const padX = Math.max(1, (b.x1 - b.x0) * 0.045);
      const padY = Math.max(1, (b.y1 - b.y0) * 0.045);
      if (b.x0 < X0 - padX || b.x1 > W + padX || b.y0 < Y0 - padY || b.y1 > H + padY) {
        found.push({ kind: "CLIPPED", line: `CLIPPED  "${b.text.slice(0, 26)}" runs outside the ${W - X0}x${H - Y0} canvas`, a: b.text });
      }
    }
  }
  return found;
}

/** A finding's identity across two renders of one figure: its kind and texts, not its area or canvas size. */
export function findingKey(f: LayoutFinding): string {
  return `${f.kind}|${f.a}|${f.b ?? ""}`;
}

const q = (s: string): string => `“${s.length > 40 ? s.slice(0, 39) + "…" : s}”`;

/** A finding in plain words, for the refusal a user reads. */
export function findingSentence(f: LayoutFinding): string {
  if (f.kind === "COLLISION") return `the labels ${q(f.a)} and ${q(f.b ?? "")} overlap`;
  if (f.kind === "STRIKETHROUGH") return `a line is drawn through the label ${q(f.a)}`;
  if (f.kind === "TRUNCATED") return `the label ${q(f.a)} would be cut short`;
  if (f.kind === "DROPPED") return `${f.a.startsWith("×") ? "the scale" : "the unit"} ${q(f.a)} would be left out`;
  return `the label ${q(f.a)} runs off the edge of the figure`;
}

/**
 * The layout defects a style fit INTRODUCED: findings in `fitted` that the figure as drawn (`asDrawn`) does not have.
 * A defect the figure already has as drawn is the builder's own (the check:figures gate records those), not the
 * style's, and does not refuse the style; a label the fit pushed into its neighbour does.
 */
export function introducedLayoutFindings(asDrawn: string, fitted: string): LayoutFinding[] {
  const before = new Set(auditLayout(asDrawn).map(findingKey));
  // Round 3: a label cut short of a value, and a ×10ⁿ scale the figure prints as drawn that the fit left out. (Only
  // the scale refuses here: a bracketed word can change legitimately under a style, as the USPTO contour's "(grey)"
  // hole key becomes a hatch key. The figure-style gate checks the units as well, over every Finance and Stats figure.)
  const dropped = valueMarksLost(asDrawn, fitted)
    .filter((m) => m.startsWith("×10"))
    .map((m): LayoutFinding => ({ kind: "DROPPED", line: `DROPPED  "${m}" is not in the fitted figure`, a: m }));
  return [...auditLayout(fitted).filter((f) => !before.has(findingKey(f))), ...truncatedByFit(asDrawn, fitted), ...dropped];
}

/** The text of every <text> in an SVG (tags stripped, entities decoded), in document order. */
export function svgTexts(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => decodeEntities(m[1].replace(/<[^>]*>/g, "")));
}

/**
 * LABELS THE FIT CUT SHORT (2026-10-28, round 3). A label the style fit ended with an ellipsis can drop exactly what
 * makes the figure true: an axis title's unit and its "(×10⁶)" (an axis of 0 to 9,000,000 inserted reading 0 to 9,
 * and the three checks above passed it, because a cut label is short enough to fit). A fitted text with an ellipsis
 * that the figure as drawn does not have is a finding when what the cut removed carries a VALUE: a digit, a bracket
 * (a unit, "(EBIT)", "(EUR)"), a "×" scale, a "%", or a currency sign; or when no as-drawn text it was cut from can be
 * found. A long category name the fit shortened to a distinct prefix ("Dogwood Partners" → "Dogwo…": round 2's
 * distinctLabels) names the same bar and is not a finding; an ellipsis the builder draws as drawn ("Kangaroo te…") is
 * its own (the QC gate records those), and a wrapped line of it is part of it.
 * This check needs the as-drawn figure, so it is not part of auditLayout (which stays the QC script's, byte for byte).
 */
export function truncatedByFit(asDrawn: string, fitted: string): LayoutFinding[] {
  // Super- and subscripts as plain digits: USPTO letters "X₂" full size, as "X2".
  const drawn = svgTexts(asDrawn).map(plainDigits);
  const out: LayoutFinding[] = [];
  const seen = new Set<string>();
  const VALUE = /[\d()[\]×%$€£¥]/;
  for (const raw of svgTexts(fitted)) {
    const t = plainDigits(raw.trim());
    if (!t.includes("…") || seen.has(t)) continue;
    seen.add(t);
    if (drawn.some((d) => d.includes(t))) continue;
    const at = t.indexOf("…");
    const head = t.slice(0, at);
    const tail = t.slice(at + 1).replace(/…/g, "");
    // What the cut removed, from each as-drawn text the label could have been cut from.
    const removed: string[] = [];
    for (const d of drawn) {
      const i = d.indexOf(head);
      if (i < 0) continue;
      const rest = d.slice(i + head.length);
      const j = tail ? rest.lastIndexOf(tail) : rest.length;
      if (j < 0) continue;
      removed.push(rest.slice(0, j));
    }
    if (removed.length && removed.some((r) => !VALUE.test(r))) continue;
    out.push({ kind: "TRUNCATED", line: `TRUNCATED  "${t.slice(0, 26)}" was cut short by the fit`, a: t });
  }
  return out;
}

const SUP_DIGITS: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "−": "-", "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "₋": "-" };

function plainDigits(s: string): string {
  return s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻−₀₁₂₃₄₅₆₇₈₉₋]/g, (c) => SUP_DIGITS[c]);
}

/**
 * The scale factors ("×10⁶") and parenthesised units ("(ng/mL)", "($)") the as-drawn figure prints (its figure title
 * aside: USPTO leaves titles out) that the fitted figure no longer prints anywhere (round 3: a fit must never drop the
 * scale or the unit). Compared with whitespace removed and super- and subscripts as plain digits, so a title wrapped
 * across lines, a USPTO exponent raised on a tspan ("×10" + "6") or a subscript lettered full size ("x₁" → "x1") counts
 * as kept.
 */
export function valueMarksLost(asDrawn: string, fitted: string): string[] {
  const body = (svg: string): string[] => [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].filter((m) => !/data-figure-title=/.test(m[1])).map((m) => decodeEntities(m[2].replace(/<[^>]*>/g, "")));
  const norm = (s: string): string => plainDigits(s.replace(/\s+/g, ""));
  const have = norm(body(fitted).join(""));
  const marks = new Set<string>();
  for (const t of body(asDrawn)) {
    for (const m of t.matchAll(/×10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g)) marks.add(m[0]);
    for (const m of t.matchAll(/\([^()]{1,24}\)/g)) marks.add(m[0]);
  }
  return [...marks].filter((m) => !have.includes(norm(m)));
}
