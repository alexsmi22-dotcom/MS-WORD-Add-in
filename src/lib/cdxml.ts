/**
 * ChemDraw CDXML documents (docs/SCOPE-CHEMDRAW.md, C1): read the file into a model the renderer
 * draws faithfully and the editor changes. The XML tree is KEPT (`root`): every object the model
 * reads points back at its element, so an edit changes the element and a saved file still holds
 * everything this release does not understand. Nothing is dropped silently: objects that are not
 * drawn are counted in `notes`, by kind.
 *
 * Format facts (CDX SDK, cdxml.dtd; measured on ChemDraw 23 files):
 *   - coordinates are points, y down (SVG's own axes); a `BoundingBox` is "left top right bottom",
 *     except on a `graphic`, where it is two points whose meaning depends on GraphicType;
 *   - colours are 2-based: 0 black, 1 white, n ≥ 2 the colour table's entry n − 2; absent = 3;
 *   - `s@font` is a font-table id; face bits 1 bold, 2 italic, 4 underline, 0x20 subscript,
 *     0x40 superscript, 0x60 formula;
 *   - a label's `p` and `BoundingBox` are page coordinates, not offsets from its atom;
 *   - an object with `SupersededBy` is an old copy kept for old readers (an arrow drawn as a line):
 *     never drawn;
 *   - `scheme`, `step`, `chemicalproperty`, `bracketedgroup` and `represent` add meaning, not ink.
 */
import { child, parseXml, XNode } from "./xmlLite";

export type Pt = [number, number];
export type Box = [number, number, number, number]; // left top right bottom

export interface CdxStyle {
  bondLength: number;
  lineWidth: number;
  boldWidth: number;
  hashSpacing: number;
  marginWidth: number;
  /** Gap between the lines of a multiple bond, in points (BondSpacingAbs, or BondSpacing % of BondLength). */
  bondGap: number;
  labelFont: number;
  labelSize: number;
  labelFace: number;
  captionFont: number;
  captionSize: number;
  captionFace: number;
}

export interface CdxRun {
  text: string;
  font: number;
  size: number;
  face: number;
  color: number;
}

export interface CdxText {
  el: XNode;
  id: string;
  p: Pt | null;
  box: Box | null;
  runs: CdxRun[];
  /** Left / Center / Right / Auto … as written (LabelJustification, CaptionJustification or Justification). */
  justify: string;
  /** Above / Below / … for a multi-line atom label. */
  align: string;
  /** Line pitch in points, or null for the font's own ("variable", "auto"). */
  lineHeight: number | null;
  z: number;
  color: number;
}

export interface CdxNode {
  el: XNode;
  id: string;
  p: Pt;
  element: number;
  charge: number;
  numH: number | null;
  isotope: number;
  nodeType: string;
  label: CdxText | null;
  /** ExternalConnectionPoint style (Diamond, Star, PolymerBead, Wavy …). */
  extType: string;
  z: number;
}

export interface CdxBond {
  el: XNode;
  id: string;
  b: string;
  e: string;
  order: string;
  display: string;
  display2: string;
  doublePosition: string;
  beginAttach: number | null;
  endAttach: number | null;
  z: number;
  color: number;
}

export interface CdxFragment {
  el: XNode;
  id: string;
  nodes: CdxNode[];
  bonds: CdxBond[];
  z: number;
}

export interface CdxGraphic {
  el: XNode;
  id: string;
  kind: string; // GraphicType
  p1: Pt;
  p2: Pt;
  lineType: string;
  arrowType: string;
  bracketType: string;
  symbolType: string;
  rectType: string;
  ovalType: string;
  angularSize: number;
  z: number;
  color: number;
}

export interface CdxArrow {
  el: XNode;
  id: string;
  head: Pt;
  tail: Pt;
  center: Pt | null;
  major: Pt | null;
  minor: Pt | null;
  angularSize: number;
  headEnd: string; // ArrowheadHead: Full | HalfLeft | HalfRight | None
  tailEnd: string; // ArrowheadTail
  headType: string; // Solid | Hollow | Angle
  headSize: number;
  centerSize: number;
  headWidth: number;
  shaftSpacing: number;
  noGo: string;
  lineType: string;
  z: number;
  color: number;
}

export interface CdxCurve {
  el: XNode;
  id: string;
  points: Pt[];
  curveType: number;
  z: number;
  color: number;
}

export type CdxItem =
  | { kind: "fragment"; v: CdxFragment }
  | { kind: "text"; v: CdxText }
  | { kind: "graphic"; v: CdxGraphic }
  | { kind: "arrow"; v: CdxArrow }
  | { kind: "curve"; v: CdxCurve };

/** One thing on the page a user picks as a whole: a fragment, a group, a caption, a graphic, an arrow. */
export interface CdxObject {
  el: XNode;
  id: string;
  kind: string;
  items: CdxItem[];
  /** The ChemDraw group it belongs to (the outermost), if any. */
  group?: string;
}

export interface CdxBracketGroup {
  el: XNode;
  id: string;
  usage: string;
  objectIds: string[];
  attachments: Array<{ graphicId: string; bondId: string; innerAtomId: string }>;
}

export interface CdxDoc {
  root: XNode;
  program: string;
  style: CdxStyle;
  /** Colour table (CSS colours), index n − 2 for colour n. */
  colors: string[];
  fonts: Map<number, string>;
  /** The page's own box, and the box of what is drawn on it. */
  pageBox: Box | null;
  drawnBox: Box | null;
  objects: CdxObject[];
  brackets: CdxBracketGroup[];
  /** Chemical-property displays (ChemDraw-computed names): display text id → the objects it was computed from. */
  properties: Array<{ displayId: string; basis: string[]; type: string }>;
  notes: string[];
}

export const CDXML_LIMITS = { bytes: 40 * 1024 * 1024 };

const num = (v: string | undefined, d: number): number => {
  if (v === undefined) return d;
  const x = Number(v.trim());
  return Number.isFinite(x) ? x : d;
};
const pt = (v: string | undefined): Pt | null => {
  if (!v) return null;
  const a = v.trim().split(/\s+/).map(Number);
  return a.length >= 2 && Number.isFinite(a[0]) && Number.isFinite(a[1]) ? [a[0], a[1]] : null;
};
const box = (v: string | undefined): Box | null => {
  if (!v) return null;
  const a = v.trim().split(/\s+/).map(Number);
  return a.length === 4 && a.every(Number.isFinite) ? [a[0], a[1], a[2], a[3]] : null;
};
/** Colour index as written; absent = 3 (the foreground). */
const colorOf = (el: XNode): number => num(el.attrs.color, 3);

/**
 * Reads a CDXML document. Refusals name what is wrong ("it is not well-formed XML (line 12: …)",
 * "it is not a ChemDraw CDXML file"); never a partial drawing presented as the whole.
 */
export function readCdxml(text: string): { ok: true; doc: CdxDoc } | { ok: false; reason: string } {
  if (text.length > CDXML_LIMITS.bytes) return { ok: false, reason: `the file is larger than ${CDXML_LIMITS.bytes / 1048576} MB` };
  const x = parseXml(text);
  if (!x.ok) return x;
  return readCdxmlTree(x.root);
}

/** Reads a parsed CDXML tree (after an edit, the same tree is read again: the model always follows it). */
export function readCdxmlTree(root: XNode): { ok: true; doc: CdxDoc } | { ok: false; reason: string } {
  if (root.name !== "CDXML") return { ok: false, reason: `it is not a ChemDraw CDXML file (its root element is <${root.name}>, not <CDXML>)` };
  const pages = root.children.filter((c) => c.name === "page");
  if (!pages.length) return { ok: false, reason: "it has no page" };

  const a = root.attrs;
  const bondLength = num(a.BondLength, 30);
  const style: CdxStyle = {
    bondLength,
    lineWidth: num(a.LineWidth, 1),
    boldWidth: num(a.BoldWidth, 4),
    hashSpacing: num(a.HashSpacing, 2.7),
    marginWidth: num(a.MarginWidth, 2),
    bondGap: a.BondSpacingAbs !== undefined ? num(a.BondSpacingAbs, 3.6) : (num(a.BondSpacing, 12) / 100) * bondLength,
    labelFont: num(a.LabelFont, -1),
    labelSize: num(a.LabelSize, 10),
    labelFace: num(a.LabelFace, 0x60),
    captionFont: num(a.CaptionFont, -1),
    captionSize: num(a.CaptionSize, 12),
    captionFace: num(a.CaptionFace, 0),
  };
  const colors: string[] = [];
  const ct = child(root, "colortable");
  for (const c of ct?.children ?? []) {
    if (c.name !== "color") continue;
    const v = (k: string): number => Math.round(Math.max(0, Math.min(1, num(c.attrs[k], 0))) * 255);
    colors.push(`rgb(${v("r")},${v("g")},${v("b")})`);
  }
  const fonts = new Map<number, string>();
  for (const f of child(root, "fonttable")?.children ?? []) if (f.name === "font" && f.attrs.id !== undefined) fonts.set(num(f.attrs.id, -1), f.attrs.name ?? "Arial");

  const notes = new Map<string, number>();
  const note = (k: string): void => void notes.set(k, (notes.get(k) ?? 0) + 1);
  // Superseded objects: their replacement is drawn instead.
  const ids = new Set<string>();
  const walk = (n: XNode): void => {
    if (n.attrs.id) ids.add(n.attrs.id);
    n.children.forEach(walk);
  };
  walk(root);
  const skip = (el: XNode): boolean => el.attrs.Visible === "no" || (el.attrs.SupersededBy !== undefined && ids.has(el.attrs.SupersededBy));

  const readText = (el: XNode, label: boolean): CdxText => {
    const runs: CdxRun[] = [];
    for (const s of el.children) {
      if (s.name !== "s") continue;
      runs.push({
        text: s.text,
        font: num(s.attrs.font, label ? style.labelFont : style.captionFont),
        size: num(s.attrs.size, label ? style.labelSize : style.captionSize),
        face: num(s.attrs.face, label ? style.labelFace : style.captionFace),
        color: num(s.attrs.color, 3),
      });
    }
    const lh = el.attrs.CaptionLineHeight ?? el.attrs.LabelLineHeight ?? el.attrs.LineHeight;
    return {
      el,
      id: el.attrs.id ?? "",
      p: pt(el.attrs.p),
      box: box(el.attrs.BoundingBox),
      runs,
      justify: el.attrs.LabelJustification ?? el.attrs.CaptionJustification ?? el.attrs.Justification ?? (label ? "Auto" : "Left"),
      align: el.attrs.LabelAlignment ?? "Auto",
      lineHeight: lh === undefined || lh === "variable" || lh === "auto" || lh === "0" || lh === "1" ? null : num(lh, 0) || null,
      z: num(el.attrs.Z, 0),
      color: colorOf(el),
    };
  };

  const readFragment = (el: XNode): CdxFragment => {
    const nodes: CdxNode[] = [];
    const bonds: CdxBond[] = [];
    for (const c of el.children) {
      if (c.name === "n") {
        const p = pt(c.attrs.p);
        if (!p) {
          note("atoms with no position (ChemDraw would clean them up) were not drawn");
          continue;
        }
        const t = child(c, "t");
        nodes.push({
          el: c,
          id: c.attrs.id ?? "",
          p,
          element: num(c.attrs.Element, 6),
          charge: num(c.attrs.Charge, 0),
          numH: c.attrs.NumHydrogens !== undefined ? num(c.attrs.NumHydrogens, 0) : null,
          isotope: num(c.attrs.Isotope, 0),
          nodeType: c.attrs.NodeType ?? "Element",
          label: t ? readText(t, true) : null,
          extType: c.attrs.ExternalConnectionType ?? "",
          z: num(c.attrs.Z, 0),
        });
      } else if (c.name === "b") {
        if (!c.attrs.B || !c.attrs.E) {
          note("bonds missing an end were not drawn");
          continue;
        }
        const ord = (c.attrs.Order ?? "1").trim();
        if (!["1", "2", "3", "1.5", "dative", "hydrogen", "0.5", "ionic"].includes(ord)) note(`bonds of order "${ord.length > 12 ? ord.slice(0, 12) + "…" : ord}" are drawn as single lines`);
        bonds.push({
          el: c,
          id: c.attrs.id ?? "",
          b: c.attrs.B,
          e: c.attrs.E,
          order: c.attrs.Order ?? "1",
          display: c.attrs.Display ?? "Solid",
          display2: c.attrs.Display2 ?? c.attrs.Display ?? "Solid",
          doublePosition: c.attrs.DoublePosition ?? "",
          beginAttach: c.attrs.BeginAttach !== undefined ? num(c.attrs.BeginAttach, 0) : null,
          endAttach: c.attrs.EndAttach !== undefined ? num(c.attrs.EndAttach, 0) : null,
          z: num(c.attrs.Z, 0),
          color: colorOf(c),
        });
      } else if (c.name === "t" || c.name === "graphic" || c.name === "curve") {
        // Rare inside a fragment; drawn by the caller's item walk below.
      } else if (c.name !== "objecttag") note(`<${c.name}> inside a structure`);
    }
    return { el, id: el.attrs.id ?? "", nodes, bonds, z: num(el.attrs.Z, 0) };
  };

  const readGraphic = (el: XNode): CdxGraphic | null => {
    const v = (el.attrs.BoundingBox ?? "").trim().split(/\s+/).map(Number);
    if (v.length !== 4 || !v.every(Number.isFinite)) {
      note("graphics with no position were not drawn");
      return null;
    }
    return {
      el,
      id: el.attrs.id ?? "",
      kind: el.attrs.GraphicType ?? "Undefined",
      p1: [v[0], v[1]],
      p2: [v[2], v[3]],
      lineType: el.attrs.LineType ?? "Solid",
      arrowType: el.attrs.ArrowType ?? "",
      bracketType: el.attrs.BracketType ?? "RoundPair",
      symbolType: el.attrs.SymbolType ?? "LonePair",
      rectType: el.attrs.RectangleType ?? "",
      ovalType: el.attrs.OvalType ?? "",
      angularSize: num(el.attrs.AngularSize, 0),
      z: num(el.attrs.Z, 0),
      color: colorOf(el),
    };
  };

  const readArrow = (el: XNode): CdxArrow | null => {
    const r = arrowFromElement(el);
    if (!r) note("arrows with no ends were not drawn");
    return r;
  };

  const readCurve = (el: XNode): CdxCurve | null => {
    const v = (el.attrs.CurvePoints ?? "").trim().split(/\s+/).map(Number);
    if (v.length < 4 || v.length % 2 || !v.every(Number.isFinite)) {
      note("curves with no points were not drawn");
      return null;
    }
    const points: Pt[] = [];
    for (let i = 0; i < v.length; i += 2) points.push([v[i], v[i + 1]]);
    return { el, id: el.attrs.id ?? "", points, curveType: num(el.attrs.CurveType, 0), z: num(el.attrs.Z, 0), color: colorOf(el) };
  };

  /** Every drawable item under `el` (a group's members, a fragment's own captions …). */
  const itemsOf = (el: XNode, out: CdxItem[], depth: number): void => {
    if (skip(el) || depth > 32) return;
    switch (el.name) {
      case "fragment":
        out.push({ kind: "fragment", v: readFragment(el) });
        for (const c of el.children) if (c.name === "t" || c.name === "graphic" || c.name === "curve") itemsOf(c, out, depth + 1);
        return;
      case "t":
        out.push({ kind: "text", v: readText(el, false) });
        return;
      case "graphic": {
        const g = readGraphic(el);
        // A line or arc with an ArrowType is an arrow in ChemDraw's older form (files before ChemDraw 8 have only that).
        const old = g ? legacyArrow(g) : null;
        if (old) out.push({ kind: "arrow", v: old });
        else if (g) out.push({ kind: "graphic", v: g });
        // A bracket's label ("n", "m", a count) is text inside its object tag, drawn by ChemDraw.
        for (const tag of el.children) if (tag.name === "objecttag") for (const t of tag.children) if (t.name === "t" && !skip(t)) out.push({ kind: "text", v: readText(t, false) });
        return;
      }
      case "arrow": {
        const r = readArrow(el);
        if (r) out.push({ kind: "arrow", v: r });
        return;
      }
      case "curve": {
        const c = readCurve(el);
        if (c) out.push({ kind: "curve", v: c });
        return;
      }
      case "group":
      case "altgroup":
        for (const c of el.children) itemsOf(c, out, depth + 1);
        return;
      case "scheme":
      case "step":
      case "chemicalproperty":
      case "bracketedgroup":
      case "bracketattachment":
      case "crossingbond":
      case "represent":
      case "objecttag":
      case "regnum":
      case "templategrid":
      case "splitter":
      case "sequence":
      case "crossreference":
        return; // meaning, not ink
      default:
        note(`<${el.name}> objects`);
    }
  };

  const objects: CdxObject[] = [];
  const brackets: CdxBracketGroup[] = [];
  const properties: CdxDoc["properties"] = [];
  const page = pages[0];
  if (pages.length > 1) notes.set(`pages after the first (${pages.length - 1}) were not read`, 1);
  // A group's members are objects of their own (a whole page drawn as one group is common: picking
  // the group would pick everything); each remembers its group.
  const pageItems: Array<{ el: XNode; group: string }> = [];
  const flatten = (n: XNode, group: string, depth: number): void => {
    for (const c of n.children) {
      if ((c.name === "group" || c.name === "altgroup") && depth < 16 && !skip(c)) flatten(c, group || (c.attrs.id ?? ""), depth + 1);
      else pageItems.push({ el: c, group });
    }
  };
  flatten(page, "", 0);
  for (const { el: c, group } of pageItems) {
    if (c.name === "bracketedgroup") {
      const atts = c.children.filter((k) => k.name === "bracketattachment").map((k) => {
        const cb = child(k, "crossingbond");
        return { graphicId: k.attrs.GraphicID ?? "", bondId: cb?.attrs.BondID ?? "", innerAtomId: cb?.attrs.InnerAtomID ?? "" };
      });
      brackets.push({ el: c, id: c.attrs.id ?? "", usage: c.attrs.BracketUsage ?? "", objectIds: (c.attrs.BracketedObjectIDs ?? "").split(/\s+/).filter(Boolean), attachments: atts });
      continue;
    }
    if (c.name === "chemicalproperty") {
      properties.push({ displayId: c.attrs.ChemicalPropertyDisplayID ?? "", basis: (c.attrs.BasisObjects ?? "").split(/\s+/).filter(Boolean), type: c.attrs.ChemicalPropertyType ?? "" });
      continue;
    }
    const items: CdxItem[] = [];
    itemsOf(c, items, 0);
    if (items.length) objects.push({ el: c, id: c.attrs.id ?? "", kind: c.name, items, ...(group ? { group } : {}) });
  }

  // The box of what is drawn: every node, text box, graphic point and arrow end.
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  const add = (p: Pt | null): void => {
    if (!p) return;
    l = Math.min(l, p[0]);
    r = Math.max(r, p[0]);
    t = Math.min(t, p[1]);
    b = Math.max(b, p[1]);
  };
  const addBox = (q: Box | null): void => {
    if (!q) return;
    add([q[0], q[1]]);
    add([q[2], q[3]]);
  };
  for (const o of objects)
    for (const it of o.items) {
      if (it.kind === "fragment") for (const n of it.v.nodes) add(n.p), addBox(n.label?.box ?? null);
      else if (it.kind === "text") addBox(it.v.box), add(it.v.p);
      else if (it.kind === "graphic") add(it.v.p1), add(it.v.p2);
      else if (it.kind === "arrow") add(it.v.head), add(it.v.tail);
      else for (const p of it.v.points) add(p);
    }
  const drawnBox: Box | null = l <= r ? [l, t, r, b] : null;

  return {
    ok: true,
    doc: {
      root,
      program: a.CreationProgram ?? "",
      style,
      colors,
      fonts,
      pageBox: box(page.attrs.BoundingBox),
      drawnBox,
      objects,
      brackets,
      properties,
      notes: [...notes].map(([k, n]) => (n > 1 && !/^pages after/.test(k) ? `${n} ${k}` : k)),
    },
  };
}

/** An `<arrow>` element as drawn (null without both ends). */
export function arrowFromElement(el: XNode): CdxArrow | null {
  const head = pt(el.attrs.Head3D), tail = pt(el.attrs.Tail3D);
  if (!head || !tail) return null;
  const at = (k1: string, k2: string): string | undefined => el.attrs[k1] ?? el.attrs[k2];
  return {
    el,
    id: el.attrs.id ?? "",
    head,
    tail,
    center: pt(el.attrs.Center3D),
    major: pt(el.attrs.MajorAxisEnd3D),
    minor: pt(el.attrs.MinorAxisEnd3D),
    angularSize: num(el.attrs.AngularSize, 0),
    headEnd: at("ArrowheadHead", "ArrowHeadHead") ?? "None",
    tailEnd: at("ArrowheadTail", "ArrowHeadTail") ?? "None",
    headType: at("ArrowheadType", "ArrowHeadType") ?? "Solid",
    headSize: num(el.attrs.HeadSize, 1000),
    centerSize: num(at("ArrowheadCenterSize", "HeadCenterSize"), 875),
    headWidth: num(at("ArrowheadWidth", "HeadWidth"), 250),
    shaftSpacing: num(el.attrs.ArrowShaftSpacing, 0),
    noGo: el.attrs.NoGo ?? "",
    lineType: el.attrs.LineType ?? "Solid",
    z: num(el.attrs.Z, 0),
    color: colorOf(el),
  };
}

/**
 * ChemDraw's older form of an arrow — a line or arc `<graphic>` with an ArrowType — read as the arrow it draws. ChemDraw
 * still writes it, superseded by the `<arrow>` (never drawn then); a file from before ChemDraw 8 has only this.
 * Measured on a ChemDraw 23.1 file's superseded copies of every arrow kind (arrows.cdx, github.com/epam/Indigo): a
 * line's BoundingBox is the HEAD, then the tail; a HalfHead's barb is HalfLeft for a positive HeadSize and HalfRight
 * for a negative one; Resonance is a head at both ends. An arc's BoundingBox is its centre and the end of the arc (CDX
 * Format Specification, Graphic_Type: https://chemapps.stolaf.edu/iupac/cdx/sdk/properties/Graphic_Type.htm); read
 * here as the tail, turned through AngularSize the way a plain Arc graphic is drawn here, to the head: one geometry, one
 * arc, with or without an ArrowType (review). No ChemDraw file with an old-form curved arrow was available to confirm
 * the turn or which end carries the head.
 */
function legacyArrow(g: CdxGraphic): CdxArrow | null {
  const type = g.arrowType.trim();
  if ((g.kind !== "Line" && g.kind !== "Arc") || !type || type === "NoHead") return null;
  const hs = num(g.el.attrs.HeadSize, 1000);
  const size = Math.abs(hs) || 1000;
  const base: CdxArrow = {
    el: g.el,
    id: g.id,
    head: g.p1,
    tail: g.p2,
    center: null,
    major: null,
    minor: null,
    angularSize: 0,
    headEnd: "Full",
    tailEnd: "None",
    headType: "Solid",
    headSize: size,
    centerSize: size * 0.875,
    headWidth: size * 0.25,
    shaftSpacing: 0,
    noGo: "",
    lineType: g.lineType,
    z: g.z,
    color: g.color,
  };
  if (/HalfHead/.test(type)) base.headEnd = hs < 0 ? "HalfRight" : "HalfLeft";
  if (/Resonance/.test(type)) base.tailEnd = "Full";
  if (/Equilibrium/.test(type)) Object.assign(base, { headEnd: "HalfLeft", tailEnd: "HalfLeft", shaftSpacing: 300 });
  if (/Hollow/.test(type)) base.headType = "Hollow";
  if (/RetroSynthetic/.test(type)) Object.assign(base, { headType: "Angle", headSize: 500, centerSize: 500, headWidth: 500, shaftSpacing: 200 });
  if (/NoGo/.test(type)) base.noGo = "Cross";
  if (g.kind === "Arc") {
    const c = g.p1, r = Math.hypot(g.p2[0] - c[0], g.p2[1] - c[1]);
    if (!(r > 0)) return null;
    // Absent, an arc's angle is taken as zero and rounded up to 90° (the specification's own default).
    const deg = g.angularSize || 90;
    // The same arc a plain Arc graphic draws (cdxmlRender: from the end point by +AngularSize, the page's angle
    // increasing): the head where that arc ends, and the arrow's AngularSize written so its sign alone runs the same way
    // (a half turn, where the head cannot say which way round, included).
    const a0 = Math.atan2(g.p2[1] - c[1], g.p2[0] - c[0]), a1 = a0 + (deg * Math.PI) / 180;
    Object.assign(base, { tail: g.p2, head: [c[0] + r * Math.cos(a1), c[1] + r * Math.sin(a1)] as Pt, center: c, major: [c[0] + r, c[1]] as Pt, minor: [c[0], c[1] + r] as Pt, angularSize: -deg });
  }
  return base;
}

/** A colour index as CSS: 0 black, 1 white, n ≥ 2 the table's entry n − 2 (default foreground black). */
export function cssColor(doc: CdxDoc, index: number): string {
  if (index === 0) return "#000";
  if (index === 1) return "#fff";
  return doc.colors[index - 2] ?? (index === 2 ? "#fff" : "#000");
}
