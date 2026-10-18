/**
 * DXF reader (docs/SCOPE-CAD-IMPORT.md, R3a): a Solid Edge draft (or any CAD
 * drawing) saved as DXF, read into flat 2D drawing items in world coordinates.
 *
 * Solid Edge's own files (.par, .psm, .asm, .dft) are readable only by Solid Edge,
 * and DWG is a closed format: both are refused by name with the export route
 * (Save As → DXF). This module reads ASCII DXF, R12 to 2018.
 *
 * WHAT MAKES IMPORTS SUBTLY WRONG, and how each is handled:
 *   - OCS. ARC, CIRCLE, LWPOLYLINE, TEXT, INSERT … sit in an object coordinate
 *     system set by their extrusion (210/220/230). Exports often carry (0, 0, −1),
 *     a mirror. The Arbitrary Axis Algorithm maps them to world coordinates;
 *     an entity whose plane is not the drawing plane is skipped, by count.
 *   - BLOCKS. INSERT explodes recursively (scale, rotation, per-axis mirror,
 *     arrays), depth-capped. A mirror reverses arcs; an uneven scale turns an
 *     arc into an ellipse, flattened (said so). DIMENSION draws its own block.
 *   - SPACES. Model space is read when it has anything drawn, else paper space;
 *     the note says which.
 *   - UNITS. $INSUNITS; absent or 0 is "unknown" — never assumed mm.
 *   - TEXT. %%c → Ø, %%d → °, %%p → ±, %%% → %, \U+XXXX, MTEXT codes (\P, {…},
 *     \f…; …) stripped to the words.
 *   - POLYLINES. Bulge = tan(θ/4), positive counter-clockwise; closed flag 70&1;
 *     polyface meshes and 3D polylines refused by count.
 *   - ELLIPSE, SPLINE flattened to within FLAT_TOL of the curve (said so).
 *   - HATCH, POINT, IMAGE, 3D solids: not drawn, each named with its count.
 *   - BOUNDS. File size, entity count and block depth are capped: a file past
 *     them is refused, never left to freeze Word.
 * Oracle: ezdxf (MIT) — the tests' fixtures are generated with it, with known
 * geometry, and its OCS / bulge conventions are the ones implemented here.
 */

export interface DxfLine {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
/** An arc counter-clockwise from a0 to a1 (radians); a full circle has full = true. */
export interface DxfArc {
  kind: "arc";
  cx: number;
  cy: number;
  r: number;
  a0: number;
  a1: number;
  full: boolean;
}
export interface DxfPoly {
  kind: "poly";
  pts: Array<[number, number]>;
  closed: boolean;
}
export interface DxfText {
  kind: "text";
  x: number;
  y: number;
  /** Capital height, drawing units. */
  h: number;
  /** Degrees, counter-clockwise. */
  rot: number;
  lines: string[];
  anchor: "start" | "middle" | "end";
  /** Where the first line sits relative to (x, y). */
  valign: "baseline" | "bottom" | "middle" | "top";
}
export interface DxfFill {
  kind: "fill";
  pts: Array<[number, number]>;
}
export type DxfShape = DxfLine | DxfArc | DxfPoly | DxfText | DxfFill;
export type DxfItem = DxfShape & {
  layer: string;
  /** Dash pattern in drawing units (+ dash, − gap, 0 dot); empty = continuous. */
  dash: number[];
  /** Line weight in mm, or null (the drawing's default). */
  weightMm: number | null;
};

export interface DxfDrawing {
  version: string;
  /** $INSUNITS: its code, name, and mm per drawing unit (null = the file does not say). */
  units: { code: number; name: string; mmPerUnit: number | null };
  space: "model" | "paper";
  items: DxfItem[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** Plain-language notes: what was skipped or approximated, by count. */
  notes: string[];
}

export const DXF_LIMITS = { bytes: 30 * 1024 * 1024, items: 200_000, depth: 16, array: 10_000 };
/** Curves are flattened to within this fraction of the drawing's size. */
export const FLAT_TOL = 1e-4;

const UNIT_NAMES: Record<number, [string, number | null]> = {
  0: ["unitless", null],
  1: ["inches", 25.4],
  2: ["feet", 304.8],
  3: ["miles", 1609344],
  4: ["millimetres", 1],
  5: ["centimetres", 10],
  6: ["metres", 1000],
  7: ["kilometres", 1e6],
  8: ["microinches", 25.4e-6],
  9: ["mils", 0.0254],
  10: ["yards", 914.4],
  11: ["ångströms", 1e-7],
  12: ["nanometres", 1e-6],
  13: ["micrometres", 1e-3],
  14: ["decimetres", 100],
  15: ["decametres", 10000],
  16: ["hectometres", 100000],
};

/** Why a file cannot be read here, by its name (native Solid Edge, DWG, binary DXF), or null. */
export function importRefusal(fileName: string, head: Uint8Array): string | null {
  const ext = (/\.([a-z0-9_]+)$/i.exec(fileName)?.[1] ?? "").toLowerCase();
  if (["par", "psm", "asm", "pwd"].includes(ext))
    return `a Solid Edge ${ext === "asm" ? "assembly" : ext === "psm" ? "sheet metal part" : "part"} (.${ext}) can only be read by Solid Edge — in Solid Edge, use Save As → STEP (.stp) and import that`;
  if (ext === "dft") return "a Solid Edge draft (.dft) can only be read by Solid Edge — in Solid Edge, use Save As → DXF (.dxf) and import that";
  if (ext === "dwg") return "DWG is a closed format this offline tool cannot read — save the drawing as DXF (.dxf) and import that";
  const sentinel = "AutoCAD Binary DXF";
  if (head.length >= sentinel.length && String.fromCharCode(...head.subarray(0, sentinel.length)) === sentinel)
    return "this is a binary DXF — save it as an ASCII DXF (the default in Solid Edge's and AutoCAD's Save As) and import that";
  return null;
}

/** Bytes → text: UTF-8 from AutoCAD 2007 (AC1021) on, the $DWGCODEPAGE before it. */
export function decodeDxf(bytes: Uint8Array): string {
  const ascii = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)));
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(ascii)?.[1] ?? "";
  if (ver >= "AC1021" || bytes[0] === 0xef) return new TextDecoder("utf-8").decode(bytes);
  const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/.exec(ascii)?.[1]?.toUpperCase() ?? "ANSI_1252";
  const m = /ANSI_(125\d)/.exec(cp);
  try {
    return new TextDecoder(m ? `windows-${m[1]}` : "windows-1252").decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// ---- tokens and entities ----------------------------------------------------------------------

type Pair = [number, string];
interface Ent {
  type: string;
  pairs: Pair[];
}
const num = (e: Ent, code: number, dflt = 0): number => {
  const p = e.pairs.find((q) => q[0] === code);
  const v = p ? Number(p[1]) : dflt;
  return Number.isFinite(v) ? v : dflt;
};
const str = (e: Ent, code: number, dflt = ""): string => e.pairs.find((q) => q[0] === code)?.[1] ?? dflt;
const all = (e: Ent, code: number): string[] => e.pairs.filter((q) => q[0] === code).map((q) => q[1]);

function tokens(text: string): Pair[] | string {
  const lines = text.split(/\r\n|\r|\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) return `line ${i + 1} should hold a group code, not "${lines[i].trim().slice(0, 20)}" — this is not a DXF file, or it is damaged`;
    // Text values keep their inner spaces; others are trimmed.
    const v = lines[i + 1];
    out.push([code, code === 1 || code === 3 ? v.replace(/\s+$/, "") : v.trim()]);
  }
  return out;
}

interface Parsed {
  header: Map<string, Pair[]>;
  layers: Map<string, { ltype: string; off: boolean; weight: number }>;
  ltypes: Map<string, number[]>;
  blocks: Map<string, { bx: number; by: number; ents: Ent[] }>;
  entities: Ent[];
}

function sections(pairs: Pair[]): Parsed | string {
  const p: Parsed = { header: new Map(), layers: new Map(), ltypes: new Map(), blocks: new Map(), entities: [] };
  let i = 0;
  const next = (): Pair | undefined => pairs[i++];
  /** Entities until ENDSEC / ENDBLK; each starts at a 0 code. */
  const readEnts = (end: string[]): Ent[] => {
    const ents: Ent[] = [];
    let cur: Ent | null = null;
    while (i < pairs.length) {
      const [c, v] = pairs[i];
      if (c === 0) {
        if (end.includes(v)) return ents;
        cur = { type: v, pairs: [] };
        ents.push(cur);
        i++;
        continue;
      }
      cur?.pairs.push(pairs[i]);
      i++;
    }
    return ents;
  };
  while (i < pairs.length) {
    const t = next()!;
    if (t[0] === 0 && t[1] === "EOF") break;
    if (t[0] !== 0 || t[1] !== "SECTION") continue;
    const name = next()?.[1];
    if (name === "HEADER") {
      let cur = "";
      while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === "ENDSEC")) {
        const [c, v] = pairs[i++];
        if (c === 9) {
          cur = v;
          p.header.set(cur, []);
        } else if (cur) p.header.get(cur)!.push([c, v]);
      }
    } else if (name === "TABLES") {
      const ents = readEnts(["ENDSEC"]);
      for (const e of ents) {
        if (e.type === "LAYER") {
          const color = num(e, 62, 7);
          p.layers.set(str(e, 2), { ltype: str(e, 6, "CONTINUOUS"), off: color < 0 || (num(e, 70) & 1) === 1, weight: num(e, 370, -3) });
        } else if (e.type === "LTYPE") {
          p.ltypes.set(str(e, 2).toUpperCase(), all(e, 49).map(Number).filter(Number.isFinite));
        }
      }
    } else if (name === "BLOCKS") {
      while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === "ENDSEC")) {
        if (pairs[i][0] === 0 && pairs[i][1] === "BLOCK") {
          i++;
          const head: Ent = { type: "BLOCK", pairs: [] };
          while (i < pairs.length && pairs[i][0] !== 0) head.pairs.push(pairs[i++]);
          const ents = readEnts(["ENDBLK"]);
          // skip ENDBLK's own pairs
          i++;
          while (i < pairs.length && pairs[i][0] !== 0) i++;
          p.blocks.set(str(head, 2), { bx: num(head, 10), by: num(head, 20), ents });
        } else i++;
      }
    } else if (name === "ENTITIES") {
      p.entities = readEnts(["ENDSEC"]);
    } else {
      while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === "ENDSEC")) i++;
    }
  }
  return p;
}

// ---- geometry ---------------------------------------------------------------------------------

/** A 2D affine map: x' = a x + c y + e, y' = b x + d y + f. */
type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const ap = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * The OCS of an extrusion, as the 2D map into world XY — or null when the entity's plane is
 * not the drawing plane (its normal is not ±Z). Arbitrary Axis Algorithm (DXF reference).
 */
function ocs(e: Ent): M | null {
  const nx = num(e, 210, 0), ny = num(e, 220, 0), nz = num(e, 230, 1);
  const len = Math.hypot(nx, ny, nz) || 1;
  const N = [nx / len, ny / len, nz / len];
  if (Math.abs(N[0]) > 1e-9 || Math.abs(N[1]) > 1e-9) return null;
  if (N[2] > 0) return ID;
  // N = (0, 0, −1): |Nx|, |Ny| < 1/64 → Ax = Wy × N = (−1, 0, 0); Ay = N × Ax = (0, 1, 0).
  return [-1, 0, 0, 1, 0, 0];
}

/** A map is a similarity (rotation, uniform scale, maybe a mirror): its uniform scale, else null. */
function similarity(m: M): number | null {
  const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
  const dot = m[0] * m[2] + m[1] * m[3];
  return Math.abs(sx - sy) <= 1e-9 * Math.max(sx, sy) && Math.abs(dot) <= 1e-9 * sx * sy ? sx : null;
}
const det = (m: M): number => m[0] * m[3] - m[1] * m[2];

// ---- text -------------------------------------------------------------------------------------

/** DXF text codes to the characters they mean (the display rule: Ø, °, ± — never %%c). */
export function dxfText(raw: string, mtext: boolean): string[] {
  let t = raw.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  t = t.replace(/%%([cCdDpP%])/g, (_, k: string) => ({ c: "Ø", d: "°", p: "±", "%": "%" })[k.toLowerCase() as "c"] ?? "");
  t = t.replace(/%%\d{3}/g, (m) => String.fromCharCode(Number(m.slice(2))));
  if (!mtext) return [t];
  const BS = "\\";
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "{" || ch === "}") continue;
    if (ch !== BS) {
      out += ch;
      continue;
    }
    const k = t[i + 1];
    if (k === undefined) break;
    if (k === "P") {
      out += "\n";
      i++;
    } else if (k === "~") {
      out += " ";
      i++;
    } else if (k === BS || k === "{" || k === "}") {
      out += k;
      i++;
    } else if ("LlOoKk".includes(k)) i++;
    else if (k === "S") {
      // Stacked text a^b, a/b, a#b: shown as a/b.
      const end = t.indexOf(";", i);
      out += t.slice(i + 2, end < 0 ? t.length : end).replace(/[\^#]/g, "/");
      i = end < 0 ? t.length : end;
    } else {
      // \f…; \H…; \C…; \A…; \W…; \Q…; \T… — formatting to the next ';'.
      const end = t.indexOf(";", i);
      i = end < 0 ? i + 1 : end;
    }
  }
  return out.split("\n");
}

// ---- the reader -------------------------------------------------------------------------------

export type ReadResult = { ok: true; drawing: DxfDrawing } | { ok: false; reason: string };

export function readDxf(text: string): ReadResult {
  if (text.length > DXF_LIMITS.bytes) return { ok: false, reason: `the file is over ${DXF_LIMITS.bytes / 1024 / 1024} MB — this importer reads drawings up to that size` };
  const pairs = tokens(text);
  if (typeof pairs === "string") return { ok: false, reason: pairs };
  if (!pairs.some((q) => q[0] === 0 && q[1] === "SECTION")) return { ok: false, reason: "this is not a DXF file (it has no sections)" };
  const p = sections(pairs);
  if (typeof p === "string") return { ok: false, reason: p };
  const hv = (name: string, code: number): string | undefined => p.header.get(name)?.find((q) => q[0] === code)?.[1];
  const version = hv("$ACADVER", 1) ?? "AC1009";
  const ucode = Number(hv("$INSUNITS", 70) ?? 0);
  const [uname, mmPerUnit] = UNIT_NAMES[ucode] ?? [`unit code ${ucode}`, null];
  const ltscale = Number(hv("$LTSCALE", 40) ?? 1) || 1;

  const items: DxfItem[] = [];
  const counts = new Map<string, number>();
  const bump = (k: string, n = 1): void => {
    counts.set(k, (counts.get(k) ?? 0) + n);
  };
  let tooMany = false;

  // Model space when it draws anything, else paper space (code 67 = 1).
  const model = p.entities.filter((e) => num(e, 67) !== 1);
  const paper = p.entities.filter((e) => num(e, 67) === 1);
  const drawable = (es: Ent[]): boolean => es.some((e) => !["VIEWPORT"].includes(e.type));
  const space: "model" | "paper" = drawable(model) || !drawable(paper) ? "model" : "paper";
  const top = space === "model" ? model : paper;

  // Extent of everything, for the flattening tolerance (curves to within FLAT_TOL of the drawing).
  let span = 0;
  for (const e of p.entities) for (const c of [10, 11]) span = Math.max(span, Math.abs(num(e, c)), Math.abs(num(e, c + 10)));
  const tol = Math.max(span, 1) * FLAT_TOL;

  const dashFor = (e: Ent, layer: string, inherited: { ltype: string }): number[] => {
    let lt = str(e, 6, "BYLAYER").toUpperCase();
    if (lt === "BYBLOCK") lt = inherited.ltype;
    if (lt === "BYLAYER") lt = (p.layers.get(layer)?.ltype ?? "CONTINUOUS").toUpperCase();
    const pat = p.ltypes.get(lt) ?? [];
    const s = ltscale * num(e, 48, 1);
    return pat.length ? pat.map((v) => v * s) : [];
  };
  const weightFor = (e: Ent, layer: string): number | null => {
    let w = num(e, 370, -1);
    if (w === -1) w = p.layers.get(layer)?.weight ?? -3;
    return w > 0 ? w / 100 : null;
  };

  const push = (shape: DxfShape, e: Ent, layer: string, inh: { ltype: string }): void => {
    if (items.length >= DXF_LIMITS.items) {
      tooMany = true;
      return;
    }
    items.push({ ...shape, layer, dash: shape.kind === "text" || shape.kind === "fill" ? [] : dashFor(e, layer, inh), weightMm: weightFor(e, layer) } as DxfItem);
  };

  /** A curve given by a point function t ∈ [t0, t1], flattened to within tol, through m. */
  const flatten = (f: (t: number) => [number, number], t0: number, t1: number, m: M, size: number): Array<[number, number]> => {
    const n = Math.max(8, Math.min(4096, Math.ceil(Math.abs(t1 - t0) / (2 * Math.acos(Math.max(-1, 1 - tol / Math.max(size, tol)))))));
    const pts: Array<[number, number]> = [];
    for (let k = 0; k <= n; k++) {
      const [x, y] = f(t0 + ((t1 - t0) * k) / n);
      pts.push(ap(m, x, y));
    }
    return pts;
  };

  /** An arc (OCS centre, radius, degrees) through map m. */
  const arcThrough = (cx: number, cy: number, r: number, d0: number, d1: number, full: boolean, m: M): DxfShape => {
    const s = similarity(m);
    if (s === null) {
      bump("unevenArc");
      let a0 = (d0 * Math.PI) / 180, a1 = (d1 * Math.PI) / 180;
      if (full) [a0, a1] = [0, 2 * Math.PI];
      else while (a1 <= a0) a1 += 2 * Math.PI;
      return { kind: "poly", pts: flatten((t) => [cx + r * Math.cos(t), cy + r * Math.sin(t)], a0, a1, m, r), closed: full };
    }
    const [X, Y] = ap(m, cx, cy);
    const dir = (deg: number): number => {
      const a = (deg * Math.PI) / 180;
      return Math.atan2(m[1] * Math.cos(a) + m[3] * Math.sin(a), m[0] * Math.cos(a) + m[2] * Math.sin(a));
    };
    if (full) return { kind: "arc", cx: X, cy: Y, r: r * s, a0: 0, a1: 2 * Math.PI, full: true };
    // A mirror turns counter-clockwise into clockwise: the arc then runs from the old end to the old start.
    const [b0, b1] = det(m) < 0 ? [dir(d1), dir(d0)] : [dir(d0), dir(d1)];
    let a1 = b1;
    while (a1 <= b0) a1 += 2 * Math.PI;
    return { kind: "arc", cx: X, cy: Y, r: r * s, a0: b0, a1, full: false };
  };

  /** A bulged segment from (x1, y1) to (x2, y2) in OCS, through m. */
  const bulgeSeg = (x1: number, y1: number, x2: number, y2: number, bulge: number, m: M): DxfShape => {
    if (Math.abs(bulge) < 1e-12) {
      const [a, b] = ap(m, x1, y1), [c, d] = ap(m, x2, y2);
      return { kind: "line", x1: a, y1: b, x2: c, y2: d };
    }
    const theta = 4 * Math.atan(bulge); // included angle, signed (+ counter-clockwise)
    const chord = Math.hypot(x2 - x1, y2 - y1);
    const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    // Centre: from the chord's midpoint along its normal, on the side the arc turns about.
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const h = r * Math.cos(theta / 2) * Math.sign(theta);
    const nx = -(y2 - y1) / chord, ny = (x2 - x1) / chord;
    const cx = mx + nx * h, cy = my + ny * h;
    const s0 = (Math.atan2(y1 - cy, x1 - cx) * 180) / Math.PI, s1 = (Math.atan2(y2 - cy, x2 - cx) * 180) / Math.PI;
    return theta > 0 ? arcThrough(cx, cy, r, s0, s1, false, m) : arcThrough(cx, cy, r, s1, s0, false, m);
  };

  const draw = (e: Ent, m0: M, depth: number, inh: { ltype: string; layer: string }): void => {
    if (tooMany) return;
    let layer = str(e, 8, "0");
    if (layer === "0" && inh.layer) layer = inh.layer;
    const lay = p.layers.get(layer);
    if (lay?.off) return bump("offLayer");
    // World-coordinate entities; everything else is in its OCS (INSERT included).
    const needsOcs = !["LINE", "POINT", "DIMENSION", "SPLINE", "ELLIPSE", "MTEXT", "LEADER", "3DFACE"].includes(e.type);
    let m = m0;
    if (needsOcs) {
      const o = ocs(e);
      if (!o) return bump("offPlane");
      m = mul(m0, o);
    }
    switch (e.type) {
      case "LINE": {
        // World coordinates: a 2D draft's lines lie in its plane; any Z is dropped.
        const [a, b] = ap(m, num(e, 10), num(e, 20)), [c, d] = ap(m, num(e, 11), num(e, 21));
        return push({ kind: "line", x1: a, y1: b, x2: c, y2: d }, e, layer, inh);
      }
      case "CIRCLE":
        return push(arcThrough(num(e, 10), num(e, 20), num(e, 40), 0, 360, true, m), e, layer, inh);
      case "ARC":
        return push(arcThrough(num(e, 10), num(e, 20), num(e, 40), num(e, 50), num(e, 51), false, m), e, layer, inh);
      case "LWPOLYLINE": {
        const xs = all(e, 10).map(Number), ys = all(e, 20).map(Number);
        // Bulges belong to the vertex before them: walk the pairs in order.
        const bulges: number[] = [];
        let v = -1;
        for (const [c, val] of e.pairs) {
          if (c === 10) {
            v++;
            bulges[v] = 0;
          } else if (c === 42 && v >= 0) bulges[v] = Number(val) || 0;
        }
        const closed = (num(e, 70) & 1) === 1;
        const n = xs.length;
        for (let k = 0; k < (closed ? n : n - 1); k++) {
          const k2 = (k + 1) % n;
          push(bulgeSeg(xs[k], ys[k], xs[k2], ys[k2], bulges[k] ?? 0, m), e, layer, inh);
        }
        return;
      }
      case "POLYLINE": {
        const flags = num(e, 70);
        if (flags & (8 | 16 | 64)) return bump("polyMesh");
        const verts = (e as Ent & { verts?: Ent[] }).verts ?? [];
        const closed = (flags & 1) === 1;
        const n = verts.length;
        for (let k = 0; k < (closed ? n : n - 1); k++) {
          const a = verts[k], b = verts[(k + 1) % n];
          push(bulgeSeg(num(a, 10), num(a, 20), num(b, 10), num(b, 20), num(a, 42), m), e, layer, inh);
        }
        return;
      }
      case "ELLIPSE": {
        const cx = num(e, 10), cy = num(e, 20), mx = num(e, 11), my = num(e, 21), ratio = num(e, 40, 1);
        if (num(e, 210) !== 0 || num(e, 220) !== 0) return bump("offPlane");
        const flip = num(e, 230, 1) < 0 ? -1 : 1; // an ellipse's own plane: (0,0,−1) runs its parameter clockwise
        const ax = Math.hypot(mx, my), ux = mx / ax, uy = my / ax;
        let t0 = num(e, 41, 0), t1 = num(e, 42, 2 * Math.PI);
        while (t1 <= t0) t1 += 2 * Math.PI;
        const f = (t: number): [number, number] => [cx + ax * Math.cos(t) * ux - flip * ratio * ax * Math.sin(t) * uy, cy + ax * Math.cos(t) * uy + flip * ratio * ax * Math.sin(t) * ux];
        bump("ellipse");
        return push({ kind: "poly", pts: flatten(f, t0, t1, m, ax), closed: Math.abs(t1 - t0 - 2 * Math.PI) < 1e-9 }, e, layer, inh);
      }
      case "SPLINE": {
        const pts = splinePoints(e, tol);
        if (!pts) return bump("badSpline");
        bump("spline");
        return push({ kind: "poly", pts: pts.map(([x, y]) => ap(m, x, y)), closed: (num(e, 70) & 1) === 1 }, e, layer, inh);
      }
      case "TEXT":
      case "ATTRIB": {
        if (e.type === "ATTRIB" && (num(e, 70) & 1)) return; // an invisible attribute
        const h72 = num(e, 72), v73 = num(e, e.type === "ATTRIB" ? 74 : 73);
        const aligned = h72 !== 0 || v73 !== 0;
        const [x, y] = ap(m, num(e, aligned ? 11 : 10), num(e, aligned ? 21 : 20));
        const s = similarity(m) ?? Math.sqrt(Math.abs(det(m)));
        const rot = (Math.atan2(m[1] * Math.cos((num(e, 50) * Math.PI) / 180) + m[3] * Math.sin((num(e, 50) * Math.PI) / 180), m[0] * Math.cos((num(e, 50) * Math.PI) / 180) + m[2] * Math.sin((num(e, 50) * Math.PI) / 180)) * 180) / Math.PI;
        const anchor = h72 === 1 || h72 === 4 ? "middle" : h72 === 2 ? "end" : "start";
        const valign = h72 === 4 ? "middle" : v73 === 1 ? "bottom" : v73 === 2 ? "middle" : v73 === 3 ? "top" : "baseline";
        return push({ kind: "text", x, y, h: num(e, 40, 2.5) * s, rot, lines: dxfText(str(e, 1), false), anchor, valign }, e, layer, inh);
      }
      case "MTEXT": {
        if (num(e, 210) !== 0 || num(e, 220) !== 0) return bump("offPlane");
        const raw = [...all(e, 3), str(e, 1)].join("");
        const att = num(e, 71, 1);
        const [x, y] = ap(m, num(e, 10), num(e, 20));
        const dx = e.pairs.some((q) => q[0] === 11) ? num(e, 11) : Math.cos(num(e, 50)), dy = e.pairs.some((q) => q[0] === 21) ? num(e, 21) : Math.sin(num(e, 50));
        const [wx, wy] = [m[0] * dx + m[2] * dy, m[1] * dx + m[3] * dy];
        const s = similarity(m) ?? Math.sqrt(Math.abs(det(m)));
        const anchor = att % 3 === 2 ? "middle" : att % 3 === 0 ? "end" : "start";
        const valign = att <= 3 ? "top" : att <= 6 ? "middle" : "bottom";
        return push({ kind: "text", x, y, h: num(e, 40, 2.5) * s, rot: (Math.atan2(wy, wx) * 180) / Math.PI, lines: dxfText(raw, true), anchor, valign }, e, layer, inh);
      }
      case "SOLID":
      case "TRACE": {
        const c = [[10, 20], [11, 21], [13, 23], [12, 22]].map(([a, b]) => ap(m, num(e, a), num(e, b)));
        return push({ kind: "fill", pts: c }, e, layer, inh);
      }
      case "LEADER": {
        const xs = all(e, 10).map(Number), ys = all(e, 20).map(Number);
        for (let k = 0; k + 1 < xs.length; k++) {
          const [a, b] = ap(m, xs[k], ys[k]), [c, d] = ap(m, xs[k + 1], ys[k + 1]);
          push({ kind: "line", x1: a, y1: b, x2: c, y2: d }, e, layer, inh);
        }
        return;
      }
      case "INSERT":
      case "DIMENSION": {
        const name = str(e, 2);
        const blk = p.blocks.get(name);
        if (!blk) return bump(e.type === "DIMENSION" ? "dimNoBlock" : "missingBlock");
        if (depth >= DXF_LIMITS.depth) return bump("deepBlock");
        if (e.type === "DIMENSION") {
          // A dimension's block is drawn where it is (in world coordinates).
          for (const be of blk.ents) draw(be, m0, depth + 1, { ltype: dashLtype(e, p), layer });
          return;
        }
        const sx = num(e, 41, 1), sy = num(e, 42, 1), rot = (num(e, 50) * Math.PI) / 180;
        const cols = Math.max(1, num(e, 70, 1)), rows = Math.max(1, num(e, 71, 1));
        if (cols * rows > DXF_LIMITS.array) return bump("hugeArray");
        const cs = Math.cos(rot), sn = Math.sin(rot);
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            // Insertion point (+ array offset along the rotated axes), rotation, scale, then − base point.
            const ox = num(e, 10) + c * num(e, 44) * cs - r * num(e, 45) * sn;
            const oy = num(e, 20) + c * num(e, 44) * sn + r * num(e, 45) * cs;
            const local: M = [cs * sx, sn * sx, -sn * sy, cs * sy, ox, oy];
            const toBase: M = [1, 0, 0, 1, -blk.bx, -blk.by];
            const mm = mul(m, mul(local, toBase));
            const childLt = str(e, 6, "BYLAYER").toUpperCase();
            for (const be of blk.ents) draw(be, mm, depth + 1, { ltype: childLt === "BYLAYER" ? (lay?.ltype ?? "CONTINUOUS").toUpperCase() : childLt, layer });
          }
        for (const a of (e as Ent & { attribs?: Ent[] }).attribs ?? []) draw(a, m0, depth + 1, inh);
        return;
      }
      case "ATTDEF":
      case "VIEWPORT":
      case "SEQEND":
      case "VERTEX":
        return;
      case "HATCH":
        return bump("hatch");
      case "POINT":
        return bump("point");
      case "IMAGE":
      case "OLE2FRAME":
      case "WIPEOUT":
        return bump("image");
      case "3DFACE":
      case "3DSOLID":
      case "REGION":
      case "BODY":
      case "MESH":
      case "SURFACE":
        return bump("solid3d");
      default:
        return bump(`other:${e.type}`);
    }
  };

  for (const e of groupPolylines(top)) draw(e, ID, 0, { ltype: "CONTINUOUS", layer: "" });
  if (tooMany) return { ok: false, reason: `the drawing has more than ${DXF_LIMITS.items.toLocaleString("en-US")} items once its blocks are expanded — this importer stops there` };

  // Notes, by count, for what was not drawn exactly as the file has it.
  const notes: string[] = [];
  const c = (k: string): number => counts.get(k) ?? 0;
  const say = (n: number, one: string, many: string): void => {
    if (n) notes.push(n === 1 ? one : many.replace("#", String(n)));
  };
  if (space === "paper") notes.push("The drawing is in paper space (the model space is empty); paper space was read.");
  else if (paper.some((e) => e.type !== "VIEWPORT")) notes.push("The model space was read; the paper space layout was not.");
  if (mmPerUnit === null) {
    const why = hv("$INSUNITS", 70) === undefined ? "it has no $INSUNITS" : ucode === 0 ? "$INSUNITS is 0, unitless" : `$INSUNITS ${ucode} is not a unit this importer knows`;
    notes.push(`The file does not say its units (${why}) — choose them before it is sized.`);
  }
  say(c("hatch"), "1 hatch pattern (section hatching) is not drawn yet.", "# hatch patterns (section hatching) are not drawn yet.");
  say(c("spline"), "1 spline was drawn as a line within 0.01 % of the curve.", "# splines were drawn as lines within 0.01 % of the curve.");
  say(c("ellipse"), "1 ellipse was drawn as a line within 0.01 % of the curve.", "# ellipses were drawn as lines within 0.01 % of the curve.");
  say(c("unevenArc"), "1 arc scaled unevenly by its block was drawn as a line within 0.01 % of the curve.", "# arcs scaled unevenly by their blocks were drawn as lines within 0.01 % of the curve.");
  say(c("offPlane"), "1 item outside the drawing plane was skipped.", "# items outside the drawing plane were skipped.");
  say(c("polyMesh"), "1 3D polyline or mesh was skipped.", "# 3D polylines or meshes were skipped.");
  say(c("solid3d"), "1 3D solid or face was skipped (import 3D parts as STEP).", "# 3D solids or faces were skipped (import 3D parts as STEP).");
  say(c("point"), "1 point marker was not drawn.", "# point markers were not drawn.");
  say(c("image"), "1 image or OLE object was not drawn.", "# images or OLE objects were not drawn.");
  say(c("offLayer"), "1 item on a layer that is off or frozen was not drawn.", "# items on layers that are off or frozen were not drawn.");
  say(c("dimNoBlock") + c("missingBlock"), "1 block or dimension had no definition in the file and was not drawn.", "# blocks or dimensions had no definition in the file and were not drawn.");
  say(c("deepBlock"), "1 block nested deeper than 16 levels was not drawn.", "# blocks nested deeper than 16 levels were not drawn.");
  say(c("hugeArray"), "1 block array of more than 10 000 copies was not drawn.", "# block arrays of more than 10 000 copies were not drawn.");
  say(c("badSpline"), "1 spline could not be read and was skipped.", "# splines could not be read and were skipped.");
  const others = [...counts.keys()].filter((k) => k.startsWith("other:")).map((k) => `${k.slice(6)} (${counts.get(k)})`);
  if (others.length) notes.push(`Not drawn (not supported yet): ${others.join(", ")}.`);

  return { ok: true, drawing: { version, units: { code: ucode, name: uname, mmPerUnit }, space, items, bounds: boundsOf(items), notes } };
}

/** An INSERT's or DIMENSION's line type for BYBLOCK children. */
function dashLtype(e: Ent, p: Parsed): string {
  const lt = str(e, 6, "BYLAYER").toUpperCase();
  return lt === "BYLAYER" ? (p.layers.get(str(e, 8, "0"))?.ltype ?? "CONTINUOUS").toUpperCase() : lt;
}

/** POLYLINE + VERTEX… + SEQEND become one entity; INSERT + ATTRIB… + SEQEND carry their attributes. */
function groupPolylines(es: Ent[]): Ent[] {
  const out: Ent[] = [];
  for (let k = 0; k < es.length; k++) {
    const e = es[k];
    if (e.type === "POLYLINE") {
      const verts: Ent[] = [];
      while (k + 1 < es.length && es[k + 1].type === "VERTEX") verts.push(es[++k]);
      if (k + 1 < es.length && es[k + 1].type === "SEQEND") k++;
      out.push(Object.assign({}, e, { verts }));
    } else if (e.type === "INSERT" && num(e, 66) === 1) {
      const attribs: Ent[] = [];
      while (k + 1 < es.length && es[k + 1].type === "ATTRIB") attribs.push(es[++k]);
      if (k + 1 < es.length && es[k + 1].type === "SEQEND") k++;
      out.push(Object.assign({}, e, { attribs }));
    } else out.push(e);
  }
  return out;
}

/** A (rational) B-spline's points, flattened; fit points when it has no control points; null if damaged. */
function splinePoints(e: Ent, tol: number): Array<[number, number]> | null {
  const deg = num(e, 71, 3);
  const knots = all(e, 40).map(Number);
  const cx = all(e, 10).map(Number), cy = all(e, 20).map(Number);
  const w = all(e, 41).map(Number);
  if (!cx.length) {
    // Fit points only: the curve CAD programs draw through them — a cubic over chord-length
    // parameters, natural ends (zero second derivative) or the stored end tangents (12 / 13)
    // as unit derivatives (ezdxf's fit_points_to_cad_cv, after AutoCAD / BricsCAD).
    const fx = all(e, 11).map(Number), fy = all(e, 21).map(Number);
    if (fx.length < 2 || fx.length !== fy.length || [...fx, ...fy].some((v) => !Number.isFinite(v))) return null;
    const tan = (c: number): [number, number] | null => (e.pairs.some((q) => q[0] === c) ? unit(num(e, c), num(e, c + 10)) : null);
    return fitSpline(fx.map((x, i) => [x, fy[i]] as [number, number]), tan(12), tan(13), tol);
  }
  const n = cx.length;
  if (knots.length !== n + deg + 1 || deg < 1 || deg > 11 || [...knots, ...cx, ...cy].some((v) => !Number.isFinite(v))) return null;
  const wt = (i: number): number => (w.length === n ? w[i] : 1);
  const at = (t: number): [number, number] => {
    // de Boor, homogeneous coordinates.
    let k = deg;
    while (k < n - 1 && t >= knots[k + 1]) k++;
    const d = Array.from({ length: deg + 1 }, (_, j) => {
      const i = k - deg + j;
      return [cx[i] * wt(i), cy[i] * wt(i), wt(i)];
    });
    for (let r = 1; r <= deg; r++)
      for (let j = deg; j >= r; j--) {
        const i = k - deg + j;
        const den = knots[i + deg + 1 - r] - knots[i];
        const a = den === 0 ? 0 : (t - knots[i]) / den;
        for (let q = 0; q < 3; q++) d[j][q] = (1 - a) * d[j - 1][q] + a * d[j][q];
      }
    return [d[deg][0] / d[deg][2], d[deg][1] / d[deg][2]];
  };
  const t0 = knots[deg], t1 = knots[n];
  // Enough samples that a chord stays within tol of the curve: grow until the control polygon's
  // length / tol bound is met (a conservative, simple rule), capped.
  let polyLen = 0;
  for (let i = 1; i < n; i++) polyLen += Math.hypot(cx[i] - cx[i - 1], cy[i] - cy[i - 1]);
  const samples = Math.max(16, Math.min(4096, Math.ceil(Math.sqrt(polyLen / tol) * 4)));
  const pts: Array<[number, number]> = [];
  for (let s = 0; s <= samples; s++) pts.push(at(t0 + ((t1 - t0) * s) / samples));
  return pts;
}

const unit = (x: number, y: number): [number, number] | null => {
  const l = Math.hypot(x, y);
  return l > 0 ? [x / l, y / l] : null;
};

/**
 * The C² cubic through points p over cumulative chord-length parameters: natural ends, or
 * clamped to unit derivatives where an end tangent is given. Sampled to within tol.
 */
export function fitSpline(p: Array<[number, number]>, t0: [number, number] | null, t1: [number, number] | null, tol: number): Array<[number, number]> {
  const n = p.length - 1;
  const t: number[] = [0];
  for (let i = 1; i <= n; i++) t.push(t[i - 1] + (Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) || 1e-12));
  const h = (i: number): number => t[i + 1] - t[i];
  // Second derivatives M per axis, from the tridiagonal system (Thomas algorithm).
  const solve = (k: 0 | 1): number[] => {
    const y = p.map((q) => q[k]);
    const A: number[] = [], B: number[] = [], C: number[] = [], D: number[] = [];
    for (let i = 0; i <= n; i++) {
      if (i === 0) {
        if (t0) {
          A.push(0); B.push(2 * h(0)); C.push(h(0)); D.push(6 * ((y[1] - y[0]) / h(0) - t0[k]));
        } else {
          A.push(0); B.push(1); C.push(0); D.push(0);
        }
      } else if (i === n) {
        if (t1) {
          A.push(h(n - 1)); B.push(2 * h(n - 1)); C.push(0); D.push(6 * (t1[k] - (y[n] - y[n - 1]) / h(n - 1)));
        } else {
          A.push(0); B.push(1); C.push(0); D.push(0);
        }
      } else {
        A.push(h(i - 1)); B.push(2 * (h(i - 1) + h(i))); C.push(h(i)); D.push(6 * ((y[i + 1] - y[i]) / h(i) - (y[i] - y[i - 1]) / h(i - 1)));
      }
    }
    for (let i = 1; i <= n; i++) {
      const w = A[i] / B[i - 1];
      B[i] -= w * C[i - 1];
      D[i] -= w * D[i - 1];
    }
    const M = new Array(n + 1).fill(0);
    M[n] = D[n] / B[n];
    for (let i = n - 1; i >= 0; i--) M[i] = (D[i] - C[i] * M[i + 1]) / B[i];
    return M;
  };
  const Mx = solve(0), My = solve(1);
  const at = (i: number, u: number, k: 0 | 1, M: number[]): number => {
    const hi = h(i), a = (t[i + 1] - u) / hi, b = (u - t[i]) / hi;
    return a * p[i][k] + b * p[i + 1][k] + ((a * a * a - a) * M[i] + (b * b * b - b) * M[i + 1]) * (hi * hi) / 6;
  };
  const out: Array<[number, number]> = [p[0]];
  for (let i = 0; i < n; i++) {
    const steps = Math.max(8, Math.min(512, Math.ceil(Math.sqrt(h(i) / tol))));
    for (let s = 1; s <= steps; s++) {
      const u = t[i] + (h(i) * s) / steps;
      out.push([at(i, u, 0, Mx), at(i, u, 1, My)]);
    }
  }
  return out;
}

function boundsOf(items: DxfItem[]): DxfDrawing["bounds"] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const it of items) {
    if (it.kind === "line") {
      add(it.x1, it.y1);
      add(it.x2, it.y2);
    } else if (it.kind === "arc") {
      // The arc's ends, and each axis extreme it passes through.
      add(it.cx + it.r * Math.cos(it.a0), it.cy + it.r * Math.sin(it.a0));
      add(it.cx + it.r * Math.cos(it.a1), it.cy + it.r * Math.sin(it.a1));
      for (let q = Math.ceil(it.a0 / (Math.PI / 2)); q * (Math.PI / 2) <= it.a1; q++) add(it.cx + it.r * Math.cos((q * Math.PI) / 2), it.cy + it.r * Math.sin((q * Math.PI) / 2));
    } else if (it.kind === "poly" || it.kind === "fill") for (const [x, y] of it.pts) add(x, y);
    else add(it.x, it.y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}
