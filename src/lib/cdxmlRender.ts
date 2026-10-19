/**
 * Draws a CDXML document (cdxml.ts) as SVG, the way ChemDraw draws it: bonds clipped at their
 * labels, double bonds on the side ChemDraw puts them, wedges and hashes at the document's own
 * widths, labels and captions at their own absolute positions with formula subscripts, brackets,
 * charge symbols and arrows. Coordinates stay in points (CDXML's own units, y down), so the SVG's
 * viewBox is the document's space and a structure inserts at ChemDraw's size.
 *
 * Where the format leaves a rule unstated (the side of a double bond with no DoublePosition, the
 * depth of a bracket), the rule used is named in a comment and was checked against ChemDraw's
 * own output for the same file.
 */
import { Box, CdxArrow, CdxBond, CdxDoc, CdxFragment, CdxGraphic, CdxItem, CdxNode, CdxRun, CdxText, cssColor, Pt } from "./cdxml";
import { atomQueryMarks, bondQueryMarks, stereoGroupMark } from "./cdxQuery";

const f2 = (v: number): string => (Math.round(v * 100) / 100).toString();
/** Hash marks or wave segments on one bond, at most. */
const MAX_STROKES = 200;
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const addp = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const len = (a: Pt): number => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
/** The normal to the right of direction d when y points down (viewing from the begin atom). */
const right = (d: Pt): Pt => [-d[1], d[0]];
const cross = (a: Pt, b: Pt): number => a[0] * b[1] - a[1] * b[0];

export interface RenderOptions {
  /** Only these top-level objects (by id); all when omitted. */
  objects?: ReadonlySet<string>;
  /** Filled with each drawn object's box (document points), by id: one pass for the whole page. */
  boxes?: Map<string, Box>;
  /** Margin around the drawing, points. */
  pad?: number;
}

export interface RenderedCdx {
  svg: string;
  /** The drawing's box in document points (before the margin). */
  box: Box;
  widthPt: number;
  heightPt: number;
}

interface Prim {
  z: number;
  svg: string;
}

export function renderCdx(doc: CdxDoc, o: RenderOptions = {}): RenderedCdx | null {
  const st = doc.style;
  const prims: Prim[] = [];
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  // The box of the object being drawn, for RenderOptions.boxes.
  let cur: Box | null = null;
  const grow = (p: Pt, m = 0): void => {
    l = Math.min(l, p[0] - m);
    r = Math.max(r, p[0] + m);
    t = Math.min(t, p[1] - m);
    b = Math.max(b, p[1] + m);
    if (cur) {
      cur[0] = Math.min(cur[0], p[0] - m);
      cur[1] = Math.min(cur[1], p[1] - m);
      cur[2] = Math.max(cur[2], p[0] + m);
      cur[3] = Math.max(cur[3], p[1] + m);
    }
  };
  const fontName = (id: number): string => {
    const n = doc.fonts.get(id);
    // Text set in the Symbol font arrives as real Greek and signs (cdx.ts maps it): drawn in a text face.
    if (n && /^symbol$/i.test(n.trim())) return "Times New Roman, Times, serif";
    return n ? `${n}, Arial, Helvetica, sans-serif` : "Arial, Helvetica, sans-serif";
  };
  const color = (i: number): string => cssColor(doc, i);

  // ---- text ------------------------------------------------------------------------------
  /** Runs split into lines at CR / LF (a run may span lines). */
  const linesOf = (runs: CdxRun[]): CdxRun[][] => {
    const lines: CdxRun[][] = [[]];
    for (const run of runs) {
      const parts = run.text.split(/\r\n|\r|\n/);
      parts.forEach((p, i) => {
        if (i) lines.push([]);
        if (p) lines[lines.length - 1].push({ ...run, text: p });
      });
    }
    return lines;
  };
  /**
   * One line of runs as tspans. Formula face (0x60) sets digits as subscripts and a trailing charge
   * as a superscript; 0x20 / 0x40 are plain subscript / superscript. Shifts are by dy and undone
   * after each piece, so the next piece sits on the baseline.
   */
  const tspans = (runs: CdxRun[]): string => {
    let out = "";
    for (const run of runs) {
      const pieces: Array<{ text: string; shift: 0 | 1 | -1 }> = [];
      const face = run.face & 0x60;
      if (face === 0x60) {
        // Formula: digits after a letter or bracket are counts (subscript); + / − at the end, charges.
        const re = /(\d+)|([+\-−]+)$|([^\d+\-−]+|[+\-−])/g;
        for (const m of run.text.matchAll(re)) {
          if (m[1]) pieces.push({ text: m[1], shift: 1 });
          else if (m[2]) pieces.push({ text: m[2].replace(/-/g, "−"), shift: -1 });
          else pieces.push({ text: m[0], shift: 0 });
        }
      } else pieces.push({ text: run.text, shift: face === 0x20 ? 1 : face === 0x40 ? -1 : 0 });
      const weight = run.face & 1 ? ' font-weight="bold"' : "";
      const italic = run.face & 2 ? ' font-style="italic"' : "";
      const under = run.face & 4 ? ' text-decoration="underline"' : "";
      for (const p of pieces) {
        if (!p.text) continue;
        const size = p.shift ? run.size * 0.75 : run.size;
        const dy = p.shift === 1 ? run.size * 0.25 : p.shift === -1 ? -run.size * 0.4 : 0;
        const fill = run.color !== 3 ? ` fill="${color(run.color)}"` : "";
        out += `<tspan font-family="${esc(fontName(run.font))}" font-size="${f2(size)}"${weight}${italic}${under}${fill}${dy ? ` dy="${f2(dy)}"` : ""}>${esc(p.text)}</tspan>`;
        if (dy) out += `<tspan dy="${f2(-dy)}"></tspan>`;
      }
    }
    return out;
  };
  /** Draws a text object at its own place: left / centre / right edge of its box, first baseline at p. */
  const drawText = (tx: CdxText, z: number, node?: CdxNode): void => {
    let lines = linesOf(tx.runs);
    if (!lines.some((ln) => ln.length)) return;
    const size = tx.runs.reduce((m, q) => Math.max(m, q.size), 1);
    const pitch = tx.lineHeight ?? size * 1.15;
    // A stacked atom label ("NH" with its H below, "H2C" above): the element symbol's line and the
    // rest, the element's line on the baseline at p (as ChemDraw places it on its atom).
    let elemLine = 0;
    if (node && lines.length === 1 && (tx.align === "Below" || tx.align === "Above")) {
      const all = lines[0].map((q) => q.text).join("");
      const m = /^([A-Z][a-z]?)(.+)$/.exec(all);
      if (m) {
        const base = lines[0][0];
        const elem: CdxRun = { ...base, text: m[1] };
        const rest: CdxRun = { ...base, text: m[2] };
        lines = tx.align === "Below" ? [[elem], [rest]] : [[rest], [elem]];
        elemLine = tx.align === "Below" ? 0 : 1;
      }
    }
    const just = tx.justify.toLowerCase();
    const anchor = just === "right" ? "end" : just === "center" ? "middle" : "start";
    const bx = tx.box;
    const x = bx ? (anchor === "end" ? bx[2] : anchor === "middle" ? (bx[0] + bx[2]) / 2 : bx[0]) : (tx.p?.[0] ?? node?.p[0] ?? 0);
    const y0 = (tx.p?.[1] ?? (bx ? bx[3] - size * 0.25 : (node?.p[1] ?? 0) + size * 0.35)) - elemLine * pitch;
    const body = lines
      .map((ln, i) => `<text x="${f2(x)}" y="${f2(y0 + i * pitch)}" text-anchor="${anchor}"${tx.color !== 3 ? ` fill="${color(tx.color)}"` : ' fill="#000"'}>${tspans(ln)}</text>`)
      .join("");
    prims.push({ z, svg: body });
    if (bx) {
      grow([bx[0], bx[1]]);
      grow([bx[2], bx[3]]);
    } else {
      grow([x, y0 - size]);
      grow([x, y0 + (lines.length - 1) * pitch + size * 0.3]);
    }
  };

  // ---- structures -------------------------------------------------------------------------
  /** Hash marks along a bond: one per HashSpacing (at least 0.1 pt), never more than MAX_STROKES (a damaged spacing must not freeze Word). */
  const hashSteps = (L: number): number => Math.min(MAX_STROKES, Math.max(2, Math.floor(L / Math.max(st.hashSpacing, 0.1))));
  /** Atoms whose charge a symbol on the page already draws (a graphic that represents it). */
  const chargeDrawn = new Set<string>();
  for (const ob of doc.objects)
    for (const it of ob.items)
      if (it.kind === "graphic") for (const c of it.v.el.children) if (c.name === "represent" && c.attrs.attribute === "Charge" && c.attrs.object) chargeDrawn.add(c.attrs.object);
  /** Atoms whose radical a symbol on the page already draws. */
  const radicalDrawn = new Set<string>();
  for (const ob of doc.objects)
    for (const it of ob.items)
      if (it.kind === "graphic") for (const c of it.v.el.children) if (c.name === "represent" && c.attrs.attribute === "Radical" && c.attrs.object) radicalDrawn.add(c.attrs.object);
  // ChemDraw draws query marks and stereo-group labels when the document says to show them (shown unless "no").
  const showAtomQuery = doc.root.attrs.ShowAtomQuery !== "no";
  const showBondQuery = doc.root.attrs.ShowBondQuery !== "no";
  const showStereoGroups = doc.root.attrs.ShowAtomEnhancedStereo !== "no";
  /** A small mark beside an atom or bond (query marks, &1 / or1), at 75 % of the label size. */
  const mark = (at: Pt, txt: string, anchor: "start" | "middle" | "end", z: number, italic = false): void => {
    const size = st.labelSize * 0.75;
    prims.push({ z, svg: `<text x="${f2(at[0])}" y="${f2(at[1])}" text-anchor="${anchor}" font-family="${esc(fontName(st.labelFont))}" font-size="${f2(size)}"${italic ? ' font-style="italic"' : ""} fill="#000">${esc(txt)}</text>` });
    const w = txt.length * size * 0.6;
    const x0 = anchor === "start" ? at[0] : anchor === "end" ? at[0] - w : at[0] - w / 2;
    grow([x0, at[1] - size], 0);
    grow([x0 + w, at[1]], 0);
  };
  const drawFragment = (fr: CdxFragment): void => {
    const byId = new Map(fr.nodes.map((n) => [n.id, n]));
    const nbrs = new Map<string, string[]>();
    for (const bd of fr.bonds) {
      // A bond to an atom that is not in the structure (a damaged file) joins nothing.
      if (!byId.has(bd.b) || !byId.has(bd.e)) continue;
      (nbrs.get(bd.b) ?? nbrs.set(bd.b, []).get(bd.b)!).push(bd.e);
      (nbrs.get(bd.e) ?? nbrs.set(bd.e, []).get(bd.e)!).push(bd.b);
    }
    /** The label's box grown by the margin: where a bond to this atom stops. */
    const clipBox = (n: CdxNode): Box | null => {
      const bx = n.label?.box;
      if (!bx || !n.label!.runs.some((q) => q.text.trim())) return null;
      const m = st.marginWidth;
      return [bx[0] - m, bx[1] - m, bx[2] + m, bx[3] + m];
    };
    /** Where the segment from inside `bx` toward `to` leaves it (Liang–Barsky on the box). */
    const exitBox = (from: Pt, to: Pt, bx: Box): Pt => {
      const d = sub(to, from);
      let tmax = 1;
      const clip = (p: number, q: number): void => {
        if (p > 0) tmax = Math.min(tmax, q / p);
      };
      clip(d[0], bx[2] - from[0]);
      clip(-d[0], from[0] - bx[0]);
      clip(d[1], bx[3] - from[1]);
      clip(-d[1], from[1] - bx[1]);
      if (from[0] < bx[0] || from[0] > bx[2] || from[1] < bx[1] || from[1] > bx[3]) return from; // the atom is outside its own label box
      return addp(from, mul(d, Math.max(0, Math.min(1, tmax))));
    };
    /** Is the bond in a ring (a path back of at most 7 bonds without it), and the ring's centre. */
    const ringSide = (bd: CdxBond): Pt | null => {
      const prev = new Map<string, string>([[bd.b, ""]]);
      let frontier = [bd.b];
      for (let depth = 0; depth < 7 && frontier.length; depth++) {
        const next: string[] = [];
        for (const v of frontier)
          for (const w of nbrs.get(v) ?? []) {
            if ((v === bd.b && w === bd.e) || prev.has(w)) continue;
            prev.set(w, v);
            if (w === bd.e) {
              const ring: Pt[] = [];
              for (let k: string = w; k; k = prev.get(k) ?? "") ring.push(byId.get(k)!.p);
              return mul(ring.reduce((s, p) => addp(s, p), [0, 0] as Pt), 1 / ring.length);
            }
            next.push(w);
          }
        frontier = next;
      }
      return null;
    };
    const gap = st.bondGap;
    const lw = st.lineWidth;
    for (const bd of fr.bonds) {
      const nb = byId.get(bd.b), ne = byId.get(bd.e);
      if (!nb || !ne) continue;
      const cb = clipBox(nb), ce = clipBox(ne);
      let p0 = nb.p, p1 = ne.p;
      if (cb) p0 = exitBox(nb.p, ne.p, cb);
      if (ce) p1 = exitBox(ne.p, nb.p, ce);
      if (len(sub(p1, p0)) < 0.01) continue;
      const d = unit(sub(p1, p0));
      const n = right(d);
      const col = color(bd.color);
      const line = (a: Pt, c: Pt, w = lw, extra = ""): string =>
        `<line x1="${f2(a[0])}" y1="${f2(a[1])}" x2="${f2(c[0])}" y2="${f2(c[1])}" stroke="${col}" stroke-width="${f2(w)}" stroke-linecap="${extra.includes("dash") ? "butt" : "round"}"${extra}/>`;
      const dash = ` stroke-dasharray="${f2(st.hashSpacing)} ${f2(st.hashSpacing)}"`;
      const parts: string[] = [];
      const styled = (a: Pt, c: Pt, disp: string): void => {
        if (disp === "Dash" || disp === "DashDot") parts.push(line(a, c, lw, dash));
        else if (disp === "Bold") parts.push(line(a, c, st.boldWidth));
        else parts.push(line(a, c));
      };
      const order = bd.order.split(/\s+/)[0];
      const disp = bd.display;
      if (/Wedge/.test(disp) && !/Wavy/.test(disp)) {
        // Narrow at the begin atom for *Begin, at the end atom for *End; the wide end 1.5 × BoldWidth.
        const [na, wa] = /End$/.test(disp) ? [p1, p0] : [p0, p1];
        const half = (st.boldWidth * 1.5) / 2;
        const dn = right(unit(sub(wa, na)));
        if (/Hash/.test(disp)) {
          const L = len(sub(wa, na)), steps = hashSteps(L);
          for (let i = 1; i <= steps; i++) {
            const f = i / steps, c = addp(na, mul(sub(wa, na), f));
            parts.push(line(addp(c, mul(dn, half * f)), addp(c, mul(dn, -half * f)), lw, ' stroke-linecap="butt"'));
          }
        } else {
          const fill = /Hollow/.test(disp) ? `fill="none" stroke="${col}" stroke-width="${f2(lw)}"` : `fill="${col}" stroke="${col}" stroke-width="${f2(lw * 0.5)}"`;
          const w1 = addp(wa, mul(dn, half)), w2 = addp(wa, mul(dn, -half));
          parts.push(`<path d="M${f2(na[0])} ${f2(na[1])}L${f2(w1[0])} ${f2(w1[1])}L${f2(w2[0])} ${f2(w2[1])}Z" ${fill} stroke-linejoin="round"/>`);
        }
      } else if (disp === "Hash") {
        const L = len(sub(p1, p0)), steps = hashSteps(L);
        for (let i = 0; i <= steps; i++) {
          const c = addp(p0, mul(sub(p1, p0), i / steps));
          parts.push(line(addp(c, mul(n, st.boldWidth / 2)), addp(c, mul(n, -st.boldWidth / 2)), lw, ' stroke-linecap="butt"'));
        }
      } else if (/Wavy/.test(disp) && order === "1") {
        // Half-waves of HashSpacing × 2, amplitude BoldWidth.
        const L = len(sub(p1, p0)), k = Math.min(MAX_STROKES, Math.max(2, Math.round(L / (Math.max(st.hashSpacing, 0.1) * 2))));
        let path = `M${f2(p0[0])} ${f2(p0[1])}`;
        for (let i = 0; i < k; i++) {
          const a = addp(p0, mul(sub(p1, p0), i / k)), c = addp(p0, mul(sub(p1, p0), (i + 1) / k));
          const mid = addp(mul(addp(a, c), 0.5), mul(n, (i % 2 ? -1 : 1) * st.boldWidth));
          path += `Q${f2(mid[0])} ${f2(mid[1])} ${f2(c[0])} ${f2(c[1])}`;
        }
        parts.push(`<path d="${path}" fill="none" stroke="${col}" stroke-width="${f2(lw)}"/>`);
      } else if (order === "2" && bd.el.attrs.JurisLabEitherGeometry === "yes") {
        // A double bond of unknown geometry (cdxmlMol EITHER): drawn crossed, as the crossed double bond
        // is drawn for an unspecified E/Z configuration.
        parts.push(line(addp(p0, mul(n, gap / 2)), addp(p1, mul(n, -gap / 2))));
        parts.push(line(addp(p0, mul(n, -gap / 2)), addp(p1, mul(n, gap / 2))));
      } else if (order === "2" || order === "1.5" || order === "3") {
        if (order === "3") {
          styled(p0, p1, disp);
          parts.push(line(addp(p0, mul(n, gap)), addp(p1, mul(n, gap))));
          parts.push(line(addp(p0, mul(n, -gap)), addp(p1, mul(n, -gap))));
        } else {
          // The side of the second line: DoublePosition when written; else inside a ring; else
          // toward the side with more neighbours; centred on a bond to a terminal labelled atom
          // (C=O) or with no neighbours on either side.
          let side = 0;
          if (bd.doublePosition === "Right") side = 1;
          else if (bd.doublePosition === "Left") side = -1;
          else if (bd.doublePosition !== "Center") {
            // An atom with more than 12 bonds (a damaged file) is not searched: the line is centred.
            const crowded = (nbrs.get(bd.b)?.length ?? 0) > 12 || (nbrs.get(bd.e)?.length ?? 0) > 12;
            const ring = crowded ? null : ringSide(bd);
            if (ring) side = cross(d, sub(ring, nb.p)) > 0 ? 1 : -1;
            else if (!crowded) {
              const others = (v: CdxNode, w: CdxNode): CdxNode[] => (nbrs.get(v.id) ?? []).filter((k) => k !== w.id).map((k) => byId.get(k)!).filter(Boolean);
              const ob = others(nb, ne), oe = others(ne, nb);
              const terminalLabel = (ob.length === 0 && !!cb) || (oe.length === 0 && !!ce);
              if (!terminalLabel && (ob.length || oe.length)) {
                let s = 0;
                for (const q of ob) s += Math.sign(cross(d, sub(q.p, nb.p)));
                for (const q of oe) s += Math.sign(cross(d, sub(q.p, ne.p)));
                side = s > 0 ? 1 : s < 0 ? -1 : 0;
              }
            }
          }
          const second = order === "1.5" ? "Dash" : bd.display2;
          if (side === 0) {
            styled(addp(p0, mul(n, gap / 2)), addp(p1, mul(n, gap / 2)), disp);
            styled(addp(p0, mul(n, -gap / 2)), addp(p1, mul(n, -gap / 2)), second);
          } else {
            styled(p0, p1, disp);
            // The inner line is shortened where it meets other bonds (not at a clipped label end).
            const trim = gap * 0.6;
            const a = addp(addp(p0, mul(n, side * gap)), cb ? [0, 0] : mul(d, trim));
            const c = addp(addp(p1, mul(n, side * gap)), ce ? [0, 0] : mul(d, -trim));
            if (len(sub(c, a)) > 0.5) styled(a, c, second);
          }
        }
      } else if (order === "dative") {
        parts.push(line(p0, p1));
        const tip = p1, back = addp(p1, mul(d, -st.bondLength * 0.25)), w = st.bondLength * 0.08;
        parts.push(`<path d="M${f2(tip[0])} ${f2(tip[1])}L${f2(back[0] + n[0] * w)} ${f2(back[1] + n[1] * w)}L${f2(back[0] - n[0] * w)} ${f2(back[1] - n[1] * w)}Z" fill="${col}"/>`);
      } else if (order === "hydrogen" || order === "0.5") parts.push(line(p0, p1, lw, dash));
      else styled(p0, p1, disp);
      prims.push({ z: bd.z, svg: parts.join("") });
      if (showBondQuery) {
        const marks = bondQueryMarks(bd.el.attrs);
        if (marks.length) {
          const mid: Pt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
          const off = st.bondLength * 0.3;
          // On the side away from the structure's other atoms where one is clear; else above.
          const at: Pt = [mid[0] - n[0] * off, mid[1] - n[1] * off + st.labelSize * 0.25];
          mark(at, marks.join(" "), "middle", bd.z + 0.4);
        }
      }
      // The line's own half-width beyond its ends (wedges and offset lines lie within a bond length).
      grow(p0, Math.max(lw / 2, /Wedge|Bold|Hash/.test(disp) ? st.boldWidth * 0.75 : 0, order === "1" ? 0 : gap));
      grow(p1, Math.max(lw / 2, /Wedge|Bold|Hash/.test(disp) ? st.boldWidth * 0.75 : 0, order === "1" ? 0 : gap));
    }
    for (const nd of fr.nodes) {
      grow(nd.p);
      if (nd.label) drawText(nd.label, nd.z + 0.5, nd);
      if (nd.charge && !chargeDrawn.has(nd.id)) {
        // ChemDraw draws a charge as a symbol tied to the atom; where the file has none (or after an
        // edit) it is set as a superscript after the label, or up and right of a bare vertex.
        const q = nd.charge, txt = (Math.abs(q) > 1 ? String(Math.abs(q)) : "") + (q > 0 ? "+" : "−");
        const size = st.labelSize * 0.75;
        const bx = nd.label?.box;
        const at: Pt = bx ? [bx[2] + size * 0.1, bx[1] + size * 0.6] : [nd.p[0] + st.bondLength * 0.25, nd.p[1] - st.bondLength * 0.2];
        prims.push({ z: nd.z + 0.6, svg: `<text x="${f2(at[0])}" y="${f2(at[1])}" font-family="${esc(fontName(st.labelFont))}" font-size="${f2(size)}" fill="#000">${txt}</text>` });
        grow(at, size);
      }
      const bx = nd.label?.box;
      const rad = nd.el.attrs.Radical;
      if (rad && !radicalDrawn.has(nd.id)) {
        // A doublet as one dot, a singlet or triplet as two, above the atom (its label).
        const r = st.labelSize * 0.09;
        const cx = bx ? (bx[0] + bx[2]) / 2 : nd.p[0];
        const cy = (bx ? bx[1] : nd.p[1] - st.labelSize * 0.3) - r * 2.5;
        const dots = rad === "Doublet" ? [cx] : [cx - r * 1.8, cx + r * 1.8];
        prims.push({ z: nd.z + 0.6, svg: dots.map((x) => `<circle cx="${f2(x)}" cy="${f2(cy)}" r="${f2(r)}" fill="#000"/>`).join("") });
        grow([cx, cy], r * 3);
      }
      const below = (bx ? bx[3] : nd.p[1]) + st.labelSize * 0.8;
      if (showStereoGroups) {
        const g = stereoGroupMark(nd.el.attrs);
        if (g) mark([(bx ? bx[2] : nd.p[0]) + st.labelSize * 0.15, below], g, "start", nd.z + 0.6, true);
      }
      if (showAtomQuery) {
        const q = atomQueryMarks(nd.el.attrs);
        if (q.length) mark([(bx ? bx[0] : nd.p[0]) - st.labelSize * 0.15, below], q.join(","), "end", nd.z + 0.6);
      }
      else if (nd.nodeType === "ExternalConnectionPoint") {
        // A small diamond where no other mark is given.
        const s = st.boldWidth;
        prims.push({ z: nd.z, svg: `<path d="M${f2(nd.p[0])} ${f2(nd.p[1] - s)}L${f2(nd.p[0] + s)} ${f2(nd.p[1])}L${f2(nd.p[0])} ${f2(nd.p[1] + s)}L${f2(nd.p[0] - s)} ${f2(nd.p[1])}Z" fill="#000"/>` });
      }
    }
  };

  // ---- graphics ----------------------------------------------------------------------------
  /** For a bracket: the inside (the bracketed atoms' side), from the bracketed group that names it. */
  const bracketInside = new Map<string, Pt>();
  const nodePos = new Map<string, Pt>();
  if (doc.brackets.length) for (const ob of doc.objects) for (const it of ob.items) if (it.kind === "fragment") for (const nd of it.v.nodes) nodePos.set(nd.id, nd.p);
  for (const bg of doc.brackets) {
    for (const at of bg.attachments) {
      const p = nodePos.get(at.innerAtomId);
      if (p) bracketInside.set(at.graphicId, p);
    }
  }
  const drawGraphic = (g: CdxGraphic): void => {
    const col = color(g.color);
    const lw = st.lineWidth;
    if (g.kind === "Line") {
      const dash = g.lineType === "Dashed" ? ` stroke-dasharray="${f2(st.hashSpacing)} ${f2(st.hashSpacing)}"` : "";
      prims.push({ z: g.z, svg: `<line x1="${f2(g.p1[0])}" y1="${f2(g.p1[1])}" x2="${f2(g.p2[0])}" y2="${f2(g.p2[1])}" stroke="${col}" stroke-width="${f2(g.lineType === "Bold" ? st.boldWidth : lw)}"${dash}/>` });
      grow(g.p1, lw);
      grow(g.p2, lw);
    } else if (g.kind === "Bracket") {
      // The bracket's two ends; its lips turn toward the bracketed atoms. Depth (a round bracket's
      // bow, a square bracket's lip): 10 % of its length, as ChemDraw draws them.
      const ax = sub(g.p2, g.p1), L = len(ax) || 1, mid = mul(addp(g.p1, g.p2), 0.5);
      let inward = right(unit(ax));
      const inside = bracketInside.get(g.id);
      if (inside && cross(unit(ax), sub(inside, mid)) < 0) inward = mul(inward, -1);
      const depth = L * 0.1;
      const kind = g.bracketType.replace("Pair", "");
      let path: string;
      if (kind === "Square") {
        const a = addp(g.p1, mul(inward, depth)), c = addp(g.p2, mul(inward, depth));
        path = `M${f2(a[0])} ${f2(a[1])}L${f2(g.p1[0])} ${f2(g.p1[1])}L${f2(g.p2[0])} ${f2(g.p2[1])}L${f2(c[0])} ${f2(c[1])}`;
      } else if (kind === "Curly") {
        const q1 = addp(addp(g.p1, mul(ax, 0.25)), mul(inward, -depth)), q2 = addp(addp(g.p1, mul(ax, 0.75)), mul(inward, -depth));
        const tip = addp(mid, mul(inward, -depth * 2));
        path = `M${f2(g.p1[0])} ${f2(g.p1[1])}Q${f2(q1[0])} ${f2(q1[1])} ${f2(tip[0])} ${f2(tip[1])}Q${f2(q2[0])} ${f2(q2[1])} ${f2(g.p2[0])} ${f2(g.p2[1])}`;
      } else {
        const ctl = addp(mid, mul(inward, -depth * 2));
        path = `M${f2(g.p1[0])} ${f2(g.p1[1])}Q${f2(ctl[0])} ${f2(ctl[1])} ${f2(g.p2[0])} ${f2(g.p2[1])}`;
      }
      prims.push({ z: g.z, svg: `<path d="${path}" fill="none" stroke="${col}" stroke-width="${f2(lw)}" stroke-linecap="round" stroke-linejoin="round"/>` });
      grow(g.p1, depth * 2);
      grow(g.p2, depth * 2);
    } else if (g.kind === "Symbol") {
      // Centre and a second point giving its size: a circled charge is drawn with a radius of a
      // third of that distance (measured against ChemDraw's output).
      const c = g.p1, s = len(sub(g.p2, g.p1)) || st.labelSize * 0.75, rr = s / 3;
      const plus = `<line x1="${f2(c[0] - rr * 0.6)}" y1="${f2(c[1])}" x2="${f2(c[0] + rr * 0.6)}" y2="${f2(c[1])}" stroke="${col}" stroke-width="${f2(lw)}"/>`;
      const vert = `<line x1="${f2(c[0])}" y1="${f2(c[1] - rr * 0.6)}" x2="${f2(c[0])}" y2="${f2(c[1] + rr * 0.6)}" stroke="${col}" stroke-width="${f2(lw)}"/>`;
      const ring = `<circle cx="${f2(c[0])}" cy="${f2(c[1])}" r="${f2(rr)}" fill="none" stroke="${col}" stroke-width="${f2(lw)}"/>`;
      const dot = (p: Pt): string => `<circle cx="${f2(p[0])}" cy="${f2(p[1])}" r="${f2(lw * 1.25)}" fill="${col}"/>`;
      const map: Record<string, string> = {
        CirclePlus: ring + plus + vert,
        CircleMinus: ring + plus,
        Plus: plus + vert,
        Minus: plus,
        Electron: dot(c),
        RadicalCation: dot([c[0] - rr, c[1]]) + plus + vert,
        RadicalAnion: dot([c[0] - rr, c[1]]) + plus,
        LonePair: dot([c[0] - rr * 0.5, c[1]]) + dot([c[0] + rr * 0.5, c[1]]),
      };
      prims.push({ z: g.z, svg: Object.prototype.hasOwnProperty.call(map, g.symbolType) ? map[g.symbolType] : "" });
      grow(c, rr + lw);
    } else if (g.kind === "Rectangle") {
      const x = Math.min(g.p1[0], g.p2[0]), y = Math.min(g.p1[1], g.p2[1]), w = Math.abs(g.p2[0] - g.p1[0]), h = Math.abs(g.p2[1] - g.p1[1]);
      const round = /RoundEdge/.test(g.rectType) ? ` rx="${f2(Math.min(w, h) * 0.1)}"` : "";
      const dash = /Dashed/.test(g.rectType) ? ` stroke-dasharray="${f2(st.hashSpacing)} ${f2(st.hashSpacing)}"` : "";
      const fill = /Filled/.test(g.rectType) ? col : /Shaded/.test(g.rectType) ? "#ddd" : "none";
      prims.push({ z: g.z, svg: `<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}"${round} fill="${fill}" stroke="${col}" stroke-width="${f2(/Bold/.test(g.rectType) ? st.boldWidth : lw)}"${dash}/>` });
      grow(g.p1, lw);
      grow(g.p2, lw);
    } else if (g.kind === "Oval") {
      const rr = len(sub(g.p2, g.p1));
      const fill = /Filled/.test(g.ovalType) ? col : /Shaded/.test(g.ovalType) ? "#ddd" : "none";
      prims.push({ z: g.z, svg: `<circle cx="${f2(g.p1[0])}" cy="${f2(g.p1[1])}" r="${f2(rr)}" fill="${fill}" stroke="${col}" stroke-width="${f2(lw)}"/>` });
      grow(g.p1, rr + lw);
    } else if (g.kind === "Arc") {
      const rr = len(sub(g.p2, g.p1)), a0 = Math.atan2(g.p2[1] - g.p1[1], g.p2[0] - g.p1[0]), a1 = a0 + (g.angularSize * Math.PI) / 180;
      const e: Pt = [g.p1[0] + rr * Math.cos(a1), g.p1[1] + rr * Math.sin(a1)];
      const large = Math.abs(g.angularSize) > 180 ? 1 : 0, sweep = g.angularSize > 0 ? 1 : 0;
      prims.push({ z: g.z, svg: `<path d="M${f2(g.p2[0])} ${f2(g.p2[1])}A${f2(rr)} ${f2(rr)} 0 ${large} ${sweep} ${f2(e[0])} ${f2(e[1])}" fill="none" stroke="${col}" stroke-width="${f2(lw)}"/>` });
      grow(g.p1, rr + lw);
    }
  };

  // ---- arrows ------------------------------------------------------------------------------
  /**
   * HeadSize, ArrowheadCenterSize and ArrowheadWidth are hundredths of the line width (head
   * 1000 = 10 × LineWidth long), as ChemDraw's own boxes for its arrows show.
   */
  const drawArrow = (ar: CdxArrow): void => {
    const col = color(ar.color);
    const lw = st.lineWidth;
    const L = (ar.headSize / 100) * lw, C = (ar.centerSize / 100) * lw, W = (ar.headWidth / 100) * lw;
    const head = (tip: Pt, dir: Pt, kind: string): { svg: string; back: Pt } => {
      if (kind === "None" || kind === "Unspecified") return { svg: "", back: tip };
      const u = unit(dir), nn = right(u);
      const base = addp(tip, mul(u, -L)), notch = addp(tip, mul(u, -C));
      const s1 = addp(base, mul(nn, W)), s2 = addp(base, mul(nn, -W));
      const pts = kind === "HalfLeft" ? [tip, s2, notch] : kind === "HalfRight" ? [tip, s1, notch] : [tip, s1, notch, s2];
      const d = "M" + pts.map((p) => `${f2(p[0])} ${f2(p[1])}`).join("L") + "Z";
      const style = ar.headType === "Hollow" ? `fill="#fff" stroke="${col}" stroke-width="${f2(lw)}"` : ar.headType === "Angle" ? `fill="none" stroke="${col}" stroke-width="${f2(lw)}"` : `fill="${col}" stroke="none"`;
      return { svg: `<path d="${d}" ${style} stroke-linejoin="miter"/>`, back: notch };
    };
    const parts: string[] = [];
    if (ar.angularSize && ar.center && ar.major && ar.minor) {
      const rx = len(sub(ar.major, ar.center)), ry = len(sub(ar.minor, ar.center));
      const large = Math.abs(ar.angularSize) > 180 ? 1 : 0, sweep = ar.angularSize > 0 ? 1 : 0;
      parts.push(`<path d="M${f2(ar.tail[0])} ${f2(ar.tail[1])}A${f2(rx)} ${f2(ry)} 0 ${large} ${sweep} ${f2(ar.head[0])} ${f2(ar.head[1])}" fill="none" stroke="${col}" stroke-width="${f2(lw)}"/>`);
      // The head along the tangent at its end.
      const rad = sub(ar.head, ar.center);
      const tan: Pt = sweep ? [-rad[1], rad[0]] : [rad[1], -rad[0]];
      parts.push(head(ar.head, tan, ar.headEnd).svg);
      parts.push(head(ar.tail, mul(sweep ? [rad[1], -rad[0]] : [-rad[1], rad[0]], 1), ar.tailEnd).svg);
      grow(ar.center, Math.max(rx, ry));
    } else {
      const dir = sub(ar.head, ar.tail);
      const h = head(ar.head, dir, ar.headEnd);
      const tl = head(ar.tail, mul(dir, -1), ar.tailEnd);
      const dash = ar.lineType === "Dashed" ? ` stroke-dasharray="${f2(st.hashSpacing)} ${f2(st.hashSpacing)}"` : "";
      const w = ar.lineType === "Bold" ? st.boldWidth : lw;
      const shaft = (a: Pt, c: Pt): string => `<line x1="${f2(a[0])}" y1="${f2(a[1])}" x2="${f2(c[0])}" y2="${f2(c[1])}" stroke="${col}" stroke-width="${f2(w)}"${dash}/>`;
      // A half head's barb side, as a multiple of right(dir): HalfLeft at the head is on −right; at
      // the tail (pointing back) on +right.
      const hs = ar.headEnd === "HalfLeft" ? -1 : ar.headEnd === "HalfRight" ? 1 : 0;
      const ts = ar.tailEnd === "HalfLeft" ? 1 : ar.tailEnd === "HalfRight" ? -1 : 0;
      if (ar.shaftSpacing > 0 && hs && ts && hs !== ts) {
        // Equilibrium (⇌): each shaft carries one half head, its barb on the outside.
        const nn = right(unit(dir)), half = (ar.shaftSpacing / 100) * lw * 0.5 + lw;
        const oh = mul(nn, hs * half), ot = mul(nn, ts * half);
        const h2 = head(addp(ar.head, oh), dir, ar.headEnd), t2 = head(addp(ar.tail, ot), mul(dir, -1), ar.tailEnd);
        parts.push(shaft(addp(ar.tail, oh), h2.back), shaft(t2.back, addp(ar.head, ot)), h2.svg, t2.svg);
      } else {
        if (ar.shaftSpacing > 0) {
          const nn = right(unit(dir)), half = (ar.shaftSpacing / 100) * lw * 0.5 + lw;
          for (const s of [1, -1]) parts.push(shaft(addp(tl.back, mul(nn, s * half)), addp(h.back, mul(nn, s * half))));
        } else parts.push(shaft(tl.back, h.back));
        parts.push(h.svg, tl.svg);
      }
      if (ar.noGo === "Cross") {
        const m = mul(addp(ar.head, ar.tail), 0.5), u = unit(dir), nn = right(u), s = W * 2;
        parts.push(`<path d="M${f2(m[0] - u[0] * s - nn[0] * s)} ${f2(m[1] - u[1] * s - nn[1] * s)}L${f2(m[0] + u[0] * s + nn[0] * s)} ${f2(m[1] + u[1] * s + nn[1] * s)}M${f2(m[0] - u[0] * s + nn[0] * s)} ${f2(m[1] - u[1] * s + nn[1] * s)}L${f2(m[0] + u[0] * s - nn[0] * s)} ${f2(m[1] + u[1] * s - nn[1] * s)}" stroke="${col}" stroke-width="${f2(lw)}"/>`);
      }
      // Room for the heads: an equilibrium's sit a shaft's half spacing off the axis.
      const off = ar.shaftSpacing > 0 ? (ar.shaftSpacing / 100) * lw * 0.5 + lw : 0;
      grow(ar.head, W + lw + off);
      grow(ar.tail, W + lw + off);
    }
    prims.push({ z: ar.z, svg: parts.join("") });
  };

  const drawItem = (it: CdxItem): void => {
    if (it.kind === "fragment") drawFragment(it.v);
    else if (it.kind === "text") drawText(it.v, it.v.z);
    else if (it.kind === "graphic") drawGraphic(it.v);
    else if (it.kind === "arrow") drawArrow(it.v);
    else {
      const pts = it.v.points;
      let d = `M${f2(pts[0][0])} ${f2(pts[0][1])}`;
      for (let i = 1; i + 2 < pts.length; i += 3) d += `C${f2(pts[i][0])} ${f2(pts[i][1])} ${f2(pts[i + 1][0])} ${f2(pts[i + 1][1])} ${f2(pts[i + 2][0])} ${f2(pts[i + 2][1])}`;
      prims.push({ z: it.v.z, svg: `<path d="${d}" fill="none" stroke="${color(it.v.color)}" stroke-width="${f2(st.lineWidth)}"/>` });
      for (const p of pts) grow(p);
    }
  };

  for (const ob of doc.objects) {
    if (o.objects && !o.objects.has(ob.id)) continue;
    cur = o.boxes ? [Infinity, Infinity, -Infinity, -Infinity] : null;
    for (const it of ob.items) drawItem(it);
    if (o.boxes && cur && cur[0] <= cur[2]) o.boxes.set(ob.id, cur);
  }
  cur = null;
  if (!(l <= r)) return null;
  const pad = o.pad ?? 4;
  const bx: Box = [l, t, r, b];
  const W = r - l + 2 * pad, H = b - t + 2 * pad;
  prims.sort((p, q) => p.z - q.z);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f2(W)}pt" height="${f2(H)}pt" viewBox="${f2(l - pad)} ${f2(t - pad)} ${f2(W)} ${f2(H)}">` +
    `<rect x="${f2(l - pad)}" y="${f2(t - pad)}" width="${f2(W)}" height="${f2(H)}" fill="#fff"/>` +
    prims.map((p) => p.svg).join("") +
    `</svg>`;
  return { svg, box: bx, widthPt: W, heightPt: H };
}
