// Electrical schematics (docs/SCOPE-DIAGRAMS.md): components placed on a grid exactly where the text puts them
// (x to the right, y up), wires as polylines, junction dots where three or more ends meet, reference designators and
// values beside each part, optional reference numerals with lead lines (#210). Symbols follow IEEE 315 / ANSI Y32.2
// line conventions: zigzag resistor, parallel-plate capacitor, looped inductor, triangle-and-bar diode.

import { DiagramOptions, DiagramResult, FONT_PT, LINE_PT, NUMERAL, arrowhead, f, finishFigure, leadLine, line, polyline, text, textW } from "./diagramCore";

const U = 40; // one grid unit, points
const MAX_PARTS = 120;

type P = [number, number];
const TWO = ["resistor", "capacitor", "inductor", "diode", "led", "battery", "vsource", "isource", "switch", "fuse"] as const;
const AT = ["ground", "supply", "npn", "pnp", "nmos", "pmos", "opamp"] as const;
type Kind = (typeof TWO)[number] | (typeof AT)[number] | "wire" | "label";

interface Part {
  ref: string;
  kind: Kind;
  pts: P[];
  value: string;
  numeral: string | null;
  line: number;
}

/** The pins of a part, in grid units (x right, y up). */
function pins(p: Part): P[] {
  const [x, y] = p.pts[0];
  switch (p.kind) {
    case "npn":
    case "pnp":
    case "nmos":
    case "pmos":
      return [[x - 1, y], [x, y + 1], [x, y - 1]];
    case "opamp":
      return [[x - 1.5, y + 0.5], [x - 1.5, y - 0.5], [x + 1.5, y]];
    case "ground":
    case "supply":
    case "label":
      return [[x, y]];
    case "wire":
      return [p.pts[0], p.pts[p.pts.length - 1]];
    default:
      return [p.pts[0], p.pts[1]];
  }
}

/** Grid points run from −GRID_MAX to GRID_MAX: far past a sheet, never an unbounded (or infinite) figure. */
const GRID_MAX = 100;

const parsePt = (s: string): P | null => {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

export function drawSchematic(input: string, opts: DiagramOptions = {}): DiagramResult {
  const errors: string[] = [];
  const notes: string[] = [];
  const parts: Part[] = [];
  const refs = new Set<string>();
  input.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith("#")) return;
    if (parts.length >= MAX_PARTS) {
      if (!errors.some((e) => e.startsWith("More than"))) errors.push(`More than ${MAX_PARTS} parts — split the figure.`);
      return;
    }
    const toks = t.split(/\s+/);
    let numeral: string | null = null;
    const hash = toks.findIndex((x) => /^#/.test(x));
    if (hash >= 0) {
      numeral = toks[hash].slice(1);
      toks.splice(hash, 1);
      if (!NUMERAL.test(numeral)) errors.push(`Line ${i + 1}: “#${numeral}” is not a reference numeral (#210).`);
    }
    const far = toks.find((tk) => {
      const pt = parsePt(tk);
      return pt !== null && (Math.abs(pt[0]) > GRID_MAX || Math.abs(pt[1]) > GRID_MAX);
    });
    if (far) {
      errors.push(`Line ${i + 1}: ${far} is off the grid — points run from −${GRID_MAX} to ${GRID_MAX}.`);
      return;
    }
    if (toks[0].toLowerCase() === "wire") {
      const pts = toks.slice(1).map(parsePt);
      if (pts.length < 2 || pts.some((p) => !p)) {
        errors.push(`Line ${i + 1}: a wire needs two or more points (“wire 0,0 2,0 2,-1”).`);
        return;
      }
      parts.push({ ref: "", kind: "wire", pts: pts as P[], value: "", numeral, line: i + 1 });
      return;
    }
    if (toks[0].toLowerCase() === "label") {
      const pt = toks[2] ? parsePt(toks[2]) : null;
      if (!toks[1] || !pt) {
        errors.push(`Line ${i + 1}: a net label is “label VOUT 4,0”.`);
        return;
      }
      parts.push({ ref: toks[1], kind: "label", pts: [pt], value: "", numeral, line: i + 1 });
      return;
    }
    const [ref, kindRaw, ...rest] = toks;
    const kind = (kindRaw ?? "").toLowerCase() as Kind;
    if (!(TWO as readonly string[]).includes(kind) && !(AT as readonly string[]).includes(kind)) {
      errors.push(`Line ${i + 1}: “${kindRaw ?? ""}” is not a symbol — use ${[...TWO, ...AT].join(", ")}, wire or label.`);
      return;
    }
    // Grounds and supplies repeat by nature (GND at several places); every other designator is unique.
    if (refs.has(ref) && kind !== "ground" && kind !== "supply") errors.push(`Line ${i + 1}: “${ref}” is used twice.`);
    refs.add(ref);
    const need = (TWO as readonly string[]).includes(kind) ? 2 : 1;
    const pts = rest.slice(0, need).map(parsePt);
    if (pts.length < need || pts.some((p) => !p)) {
      errors.push(`Line ${i + 1}: ${kind} “${ref}” needs ${need === 2 ? "two points (from and to: “R1 resistor 0,0 2,0 10k”)" : "a point (“GND ground 2,-2”)"}.`);
      return;
    }
    if (need === 2 && pts[0]![0] === pts[1]![0] && pts[0]![1] === pts[1]![1]) {
      errors.push(`Line ${i + 1}: ${ref}'s two ends are the same point.`);
      return;
    }
    parts.push({ ref, kind, pts: pts as P[], value: rest.slice(need).join(" "), numeral, line: i + 1 });
  });
  if (!errors.length && !parts.length) errors.push("Nothing to draw yet.");
  if (errors.length) return { ok: false, errors, notes };

  // Connectivity: every pin should meet a wire end or another pin (said, never refused: a test point may float).
  const key = (p: P): string => `${p[0]},${p[1]}`;
  const ends = new Map<string, number>();
  for (const p of parts) {
    if (p.kind === "wire") {
      // A wire's ends count once; each bend joins two of its own segments, so it counts twice (a tee at a bend is three).
      p.pts.forEach((q, k) => ends.set(key(q), (ends.get(key(q)) ?? 0) + (k === 0 || k === p.pts.length - 1 ? 1 : 2)));
    } else for (const q of pins(p)) ends.set(key(q), (ends.get(key(q)) ?? 0) + 1);
  }
  // A wire's interior bends count as joins too.
  const onWire = (q: P): boolean =>
    parts.some((w) => w.kind === "wire" && w.pts.slice(0, -1).some((a, k) => {
      const b = w.pts[k + 1];
      return (a[0] === b[0] && q[0] === a[0] && q[1] >= Math.min(a[1], b[1]) && q[1] <= Math.max(a[1], b[1])) || (a[1] === b[1] && q[1] === a[1] && q[0] >= Math.min(a[0], b[0]) && q[0] <= Math.max(a[0], b[0]));
    }));
  for (const p of parts) {
    if (p.kind === "wire" || p.kind === "label") continue;
    for (const q of pins(p)) if ((ends.get(key(q)) ?? 0) < 2 && !onWire(q)) notes.push(`${p.ref}'s terminal at ${key(q)} is connected to nothing.`);
  }

  // Grid → points (y up becomes y down).
  const allPts = parts.flatMap((p) => [...p.pts, ...pins(p)]);
  const minX = Math.min(...allPts.map((p) => p[0])) - 1, maxX = Math.max(...allPts.map((p) => p[0])) + 1.6;
  const minY = Math.min(...allPts.map((p) => p[1])) - 1, maxY = Math.max(...allPts.map((p) => p[1])) + 1;
  const X = (x: number): number => (x - minX) * U;
  const Y = (y: number): number => (maxY - y) * U;
  const out: string[] = [];
  const at = (p: P): P => [X(p[0]), Y(p[1])];

  for (const p of parts) {
    if (p.kind === "wire") {
      out.push(polyline(p.pts.map(at)));
      continue;
    }
    if (p.kind === "label") {
      const [x, y] = at(p.pts[0]);
      out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="2.2" fill="#000"/>`, text(x + 6, y - 6, p.ref, { anchor: "start" }));
      continue;
    }
    if ((TWO as readonly string[]).includes(p.kind)) out.push(twoTerminal(p, at(p.pts[0]), at(p.pts[1])));
    else out.push(atSymbol(p, at(p.pts[0])));
    if (p.numeral) {
      const [x, y] = at(pins(p)[0]);
      out.push(leadLine(x - 30, y - 34, x + 4, y - 8, p.numeral));
    }
  }
  // Junction dots: three or more ends at one point, or a pin or wire end landing on another wire's interior (a tee).
  for (const p of parts) {
    for (const q of p.kind === "wire" ? [p.pts[0], p.pts[p.pts.length - 1]] : p.kind === "label" ? [] : pins(p)) {
      const interior = parts.some((w) => w !== p && w.kind === "wire" && w.pts.slice(0, -1).some((a, k) => {
        const b = w.pts[k + 1];
        const onH = a[1] === b[1] && q[1] === a[1] && q[0] > Math.min(a[0], b[0]) && q[0] < Math.max(a[0], b[0]);
        const onV = a[0] === b[0] && q[0] === a[0] && q[1] > Math.min(a[1], b[1]) && q[1] < Math.max(a[1], b[1]);
        return onH || onV;
      }));
      if (interior) ends.set(key(q), Math.max(3, ends.get(key(q)) ?? 0));
    }
  }
  for (const [k, n] of ends) {
    if (n >= 3) {
      const [gx, gy] = k.split(",").map(Number);
      out.push(`<circle cx="${f(X(gx))}" cy="${f(Y(gy))}" r="3" fill="#000"/>`);
    }
  }
  // Designator labels that collide (parts too close together) are said: lettering is never shrunk to make room.
  const boxes: Array<{ ref: string; b: [number, number, number, number] }> = [];
  for (const p of parts) {
    if (p.kind === "wire" || p.kind === "ground" || p.kind === "label") continue;
    const lab = p.value ? `${p.ref} ${p.value}` : p.ref;
    const w = textW(lab);
    if ((TWO as readonly string[]).includes(p.kind)) {
      const [a, b] = [at(p.pts[0]), at(p.pts[1])];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const half = p.kind === "vsource" || p.kind === "isource" ? Math.min(Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.6, 0.9 * U) / 2 : p.kind === "led" ? 28 : 14;
      boxes.push({ ref: p.ref, b: Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]) ? [mx + half + 8, my - FONT_PT * 0.7, w, FONT_PT] : [mx - w / 2, my - half - 8 - FONT_PT * 0.75, w, FONT_PT] });
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].b, b = boxes[j].b;
      if (a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]) notes.push(`The labels of ${boxes[i].ref} and ${boxes[j].ref} overlap — place the parts further apart.`);
    }
  }
  // Labels to the right of a part may reach past the grid: the figure is as wide as what is drawn.
  let reach = (maxX - minX) * U;
  for (const p of parts) {
    if (p.kind === "wire") continue;
    const lab = p.kind === "label" ? p.ref : p.value ? `${p.ref} ${p.value}` : p.ref;
    if ((TWO as readonly string[]).includes(p.kind)) {
      const [a, b] = [at(p.pts[0]), at(p.pts[1])];
      if (Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0])) reach = Math.max(reach, (a[0] + b[0]) / 2 + 30 + 8 + textW(lab));
      else reach = Math.max(reach, (a[0] + b[0]) / 2 + textW(lab) / 2);
    } else if (p.kind === "label") reach = Math.max(reach, at(p.pts[0])[0] + 6 + textW(lab));
    else if (p.kind !== "ground") reach = Math.max(reach, at(p.pts[0])[0] + U * 0.6 + 6 + textW(lab));
  }
  const fin = finishFigure(out.join(""), reach + 4, (maxY - minY) * U, opts, notes);
  return { ok: true, svg: fin.svg, widthPt: fin.widthPt, heightPt: fin.heightPt, notes, numerals: parts.map((p) => p.numeral).filter((x): x is string => !!x) };
}

/** A two-terminal symbol between a and b: leads to a body of fixed length at the middle, labels beside it. */
function twoTerminal(p: Part, a: P, b: P): string {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux; // left normal (screen)
  const body = Math.min(len * 0.6, 0.9 * U);
  const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const s: P = [m[0] - (ux * body) / 2, m[1] - (uy * body) / 2];
  const e: P = [m[0] + (ux * body) / 2, m[1] + (uy * body) / 2];
  const pt = (t: number, o: number): P => [s[0] + ux * body * t + nx * o, s[1] + uy * body * t + ny * o];
  const out: string[] = [line(a[0], a[1], s[0], s[1]), line(e[0], e[1], b[0], b[1])];
  const h = 7;
  const poly = (ps: P[], close = false, fill = "none"): string =>
    close ? `<polygon points="${ps.map((q) => `${f(q[0])},${f(q[1])}`).join(" ")}" fill="${fill}" stroke="#000" stroke-width="${LINE_PT}"/>` : polyline(ps);
  switch (p.kind) {
    case "resistor": {
      const zz: P[] = [pt(0, 0)];
      for (let k = 0; k < 6; k++) zz.push(pt((k + 0.5) / 6, k % 2 ? -h : h));
      zz.push(pt(1, 0));
      out.push(poly(zz));
      break;
    }
    case "fuse":
      out.push(poly([pt(0, -h * 0.7), pt(1, -h * 0.7), pt(1, h * 0.7), pt(0, h * 0.7)], true, "#fff"), line(...pt(0, 0), ...pt(1, 0)));
      break;
    case "capacitor":
      out.push(line(...pt(0, 0), ...pt(0.42, 0)), line(...pt(0.58, 0), ...pt(1, 0)), line(...pt(0.42, -12), ...pt(0.42, 12)), line(...pt(0.58, -12), ...pt(0.58, 12)));
      break;
    case "battery":
      out.push(line(...pt(0, 0), ...pt(0.42, 0)), line(...pt(0.58, 0), ...pt(1, 0)), line(...pt(0.42, -13), ...pt(0.42, 13)), line(...pt(0.58, -6), ...pt(0.58, 6)), text(...pt(0.3, 20), "+", { size: FONT_PT }));
      break;
    case "inductor": {
      let d = `M${f(pt(0, 0)[0])} ${f(pt(0, 0)[1])}`;
      for (let k = 0; k < 4; k++) {
        const c = pt((k + 0.5) / 4, 0), q = pt((k + 1) / 4, 0), top = pt((k + 0.5) / 4, -h * 1.6);
        void c;
        d += ` Q${f(top[0])} ${f(top[1])} ${f(q[0])} ${f(q[1])}`;
      }
      out.push(`<path d="${d}" fill="none" stroke="#000" stroke-width="${LINE_PT}"/>`);
      break;
    }
    case "diode":
    case "led":
      out.push(line(...pt(0, 0), ...pt(0.25, 0)), line(...pt(0.75, 0), ...pt(1, 0)), poly([pt(0.25, -10), pt(0.25, 10), pt(0.75, 0)], true, "#000"), line(...pt(0.75, -10), ...pt(0.75, 10)));
      if (p.kind === "led") {
        for (const t of [0.4, 0.62]) {
          const a0 = pt(t, -14), a1 = pt(t + 0.18, -26);
          out.push(line(a0[0], a0[1], a1[0], a1[1]), arrowhead(a1[0], a1[1], a1[0] - a0[0], a1[1] - a0[1], 5));
        }
      }
      break;
    case "vsource":
    case "isource": {
      const c = pt(0.5, 0), r = body / 2;
      out.push(line(...pt(0, 0), c[0] - ux * r, c[1] - uy * r), line(c[0] + ux * r, c[1] + uy * r, ...pt(1, 0)), `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="${f(r)}" fill="#fff" stroke="#000" stroke-width="${LINE_PT}"/>`);
      if (p.kind === "vsource") out.push(text(c[0] - ux * r * 0.45, c[1] - uy * r * 0.45 + FONT_PT * 0.3, "+", { size: FONT_PT }), text(c[0] + ux * r * 0.45, c[1] + uy * r * 0.45 + FONT_PT * 0.3, "−", { size: FONT_PT }));
      else {
        const a0: P = [c[0] - ux * r * 0.6, c[1] - uy * r * 0.6], a1: P = [c[0] + ux * r * 0.6, c[1] + uy * r * 0.6];
        out.push(line(a0[0], a0[1], a1[0], a1[1]), arrowhead(a1[0], a1[1], ux, uy, 6));
      }
      break;
    }
    case "switch":
      out.push(line(...pt(0, 0), ...pt(0.15, 0)), line(...pt(0.85, 0), ...pt(1, 0)), `<circle cx="${f(pt(0.15, 0)[0])}" cy="${f(pt(0.15, 0)[1])}" r="2.5" fill="#fff" stroke="#000"/>`, `<circle cx="${f(pt(0.85, 0)[0])}" cy="${f(pt(0.85, 0)[1])}" r="2.5" fill="#fff" stroke="#000"/>`, line(...pt(0.15, 0), ...pt(0.8, -14)));
      break;
  }
  // Designator and value beside the body, clear of it: above a horizontal part, right of a vertical one.
  const half = p.kind === "vsource" || p.kind === "isource" ? body / 2 : p.kind === "led" ? 28 : 14;
  const label = p.value ? `${p.ref} ${p.value}` : p.ref;
  if (Math.abs(uy) > Math.abs(ux)) out.push(text(m[0] + half + 8, m[1] + FONT_PT * 0.35, label, { anchor: "start" }));
  else out.push(text(m[0], m[1] - half - 8, label));
  return out.join("");
}

/** A symbol at one point: ground, supply, transistors, an op-amp (pins as in pins()). */
function atSymbol(p: Part, c: P): string {
  const [x, y] = c;
  const out: string[] = [];
  switch (p.kind) {
    case "ground":
      out.push(line(x, y, x, y + 10), line(x - 12, y + 10, x + 12, y + 10), line(x - 8, y + 15, x + 8, y + 15), line(x - 4, y + 20, x + 4, y + 20));
      break;
    case "supply":
      out.push(line(x, y, x, y - 12), line(x - 10, y - 12, x + 10, y - 12), text(x, y - 18, p.value || p.ref));
      return out.join("");
    case "npn":
    case "pnp": {
      // Base from the left pin to the bar; collector up and emitter down from the bar to their pins.
      out.push(`<circle cx="${f(x - 4)}" cy="${f(y)}" r="${f(U * 0.62)}" fill="none" stroke="#000" stroke-width="${LINE_PT}"/>`);
      out.push(line(x - U, y, x - 14, y), line(x - 14, y - 14, x - 14, y + 14));
      out.push(line(x - 14, y - 6, x, y - 16), line(x, y - 16, x, y - U));
      out.push(line(x - 14, y + 6, x, y + 16), line(x, y + 16, x, y + U));
      if (p.kind === "npn") out.push(arrowhead(x, y + 16, 14, 10, 7));
      else out.push(arrowhead(x - 14, y + 6, -14, -10, 7));
      break;
    }
    case "nmos":
    case "pmos":
      // Enhancement mode: the channel drawn broken (three segments), the gate apart from it.
      out.push(line(x - U, y, x - 16, y), line(x - 16, y - 14, x - 16, y + 14), line(x - 10, y - 16, x - 10, y - 8), line(x - 10, y - 4, x - 10, y + 4), line(x - 10, y + 8, x - 10, y + 16));
      out.push(line(x - 10, y - 12, x, y - 12), line(x, y - 12, x, y - U), line(x - 10, y + 12, x, y + 12), line(x, y + 12, x, y + U));
      // NMOS: the source arrow points out of the channel (as an NPN emitter does); PMOS: a bubble on the gate.
      if (p.kind === "pmos") out.push(`<circle cx="${f(x - 20)}" cy="${f(y)}" r="3.5" fill="#fff" stroke="#000"/>`);
      else out.push(arrowhead(x - 1, y + 12, 1, 0, 6));
      break;
    case "opamp": {
      const l = x - U * 0.9, r = x + U * 0.9;
      out.push(`<polygon points="${f(l)},${f(y - U)} ${f(l)},${f(y + U)} ${f(r)},${f(y)}" fill="#fff" stroke="#000" stroke-width="${LINE_PT}"/>`);
      out.push(line(x - U * 1.5, y - U * 0.5, l, y - U * 0.5), line(x - U * 1.5, y + U * 0.5, l, y + U * 0.5), line(r, y, x + U * 1.5, y));
      out.push(text(l + 9, y - U * 0.5 + 5, "−", { size: FONT_PT }), text(l + 9, y + U * 0.5 + 5, "+", { size: FONT_PT }));
      break;
    }
  }
  // Ground needs no designator; transistors and op-amps carry theirs beside the body.
  if (p.kind !== "ground") out.push(text(x + U * 0.6 + 6, y - U * 0.5, p.value ? `${p.ref} ${p.value}` : p.ref, { anchor: "start" }));
  void textW;
  return out.join("");
}
