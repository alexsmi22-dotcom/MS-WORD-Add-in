/**
 * Numbered reaction schemes (docs/SCOPE-SCHEMES.md, organic-chem arc item 3). A scheme is built as ONE
 * CDXML page in the ACS Document 1996 style the Build canvas uses (bond 14.4 pt), so every compound is
 * drawn at the same bond length by the same renderer (cdxmlRender) and the page opens on the canvas for
 * hand edits. Compound numbers sit bold under their structures on one baseline per row; reagents and
 * conditions sit above and below every arrow (or as letters with a "Reagents and conditions" footnote);
 * a long scheme wraps onto further rows at the chosen width, each new row starting with its arrow.
 *
 * Input, backward compatible with the one-line Reaction DSL (reactions.ts):
 *
 *     CCO (1) + CC(=O)O (2)
 *     >> H2SO4 ; reflux, 3 h
 *     CC(=O)OCC (3)
 *
 * Pure: no Office.js. OpenChemLib only, through the existing page converter.
 */
import { Molecule } from "openchemlib/full";
import { readCdxml, readCdxmlTree, type Box, type CdxDoc } from "./cdxml";
import { addArrow, blankPageCdxml, moveObjects, nextIdFrom } from "./cdxmlEdit";
import { moleculeToPage } from "./cdxmlMol";
import { renderCdx } from "./cdxmlRender";
import { parseReaction, typesetConditions, type ArrowType } from "./reactions";
import { duplicateRingClosure, lookupSmiles, resolveChemInput } from "./structures";
import { textWidthPt } from "./arialMetrics";
import type { XNode } from "./xmlLite";

export interface SchemeCompound {
  /** The name or SMILES as typed, without its number. */
  text: string;
  /** The compound number ("1", "2a", "S3", "3′"), or null. */
  label: string | null;
}

export interface SchemeArrow {
  type: ArrowType;
  above: string;
  below: string;
}

export interface ParsedScheme {
  stages: SchemeCompound[][];
  arrows: SchemeArrow[];
  /** Problems that stop the scheme from being drawn. */
  errors: string[];
  /** Said beside the scheme; it is still drawn. */
  notes: string[];
}

// Arrow tokens at the start of an arrow line, longest first ("<=>" before "<-", "->>" never matches "->" here).
// Not followed by another arrow character ("<-->", "->>", "←→" are not arrows this reads), except a minus that starts a
// number: "->-78 °C" is an arrow with −78 °C on it.
const ARROW_LINE = /^(>>|<=>|<->|⇌|⇋|←|<-|→|->)(?![>=<→←]|-(?![\d.]))\s*(.*)$/;
/** A line that starts like an arrow but is not one this tool reads ("-->", "->>", "=>"). */
const ARROW_LIKE = /^([-=<>~→←]{2,}|[⇒⟶⟹⇢])/;

function arrowTypeOf(token: string): ArrowType {
  if (token === "⇌" || token === "⇋" || token === "<=>" || token === "<->") return "reversible";
  if (token === "←" || token === "<-") return "retro";
  return "forward";
}

/**
 * A compound number: 1, 2a, 10b, S3, SI-4, 3′, 3'', ent-3, rac-5. Letters before the digits are capitals
 * (S for a Supporting-Information compound), after them lowercase (a series), then up to two primes.
 */
const NUMBER_LIKE = /^(?:(?:ent|rac|rel)-)?(?:[A-Z]{1,2}-?)?\d{1,4}[a-z]{0,2}(?:['′″]{1,2})?$/;

/** A trailing " (label)" after a space: SMILES never hold a space, names keep their brackets unspaced. */
const TRAILING_LABEL = /^(.*\S)\s+\(([^()]*)\)$/;

/** Splits "aspirin (3)" into the compound and its number; a bracket that is not a number is an error by name. */
export function splitLabel(raw: string): { text: string; label: string | null; error?: string } {
  const s = raw.trim();
  const m = TRAILING_LABEL.exec(s);
  if (!m) {
    if (/^\(([^()]*)\)$/.test(s)) return { text: "", label: null, error: `“${s}” is a compound number with no compound before it.` };
    return { text: s, label: null };
  }
  const label = m[2].trim().replace(/''/g, "″").replace(/'/g, "′");
  if (!NUMBER_LIKE.test(label)) {
    return {
      text: m[1],
      label: null,
      error:
        `“(${m[2]})” after “${m[1]}” is not a compound number — numbers look like (1), (2a), (S3) or (3′). ` +
        `If it is part of the name, write it with no space before the bracket (copper(II)); an abbreviation such as (DIPEA) is left out.`,
    };
  }
  return { text: m[1], label };
}

/** Splits arrow-line text into above ; below (a third field is an error). */
function arrowFields(rest: string, line: number): { above: string; below: string; error?: string } {
  const parts = rest.split(";").map((p) => p.trim());
  if (parts.length > 2) return { above: parts[0], below: parts[1], error: `Line ${line}: an arrow takes at most two fields, “above ; below” — this one has ${parts.length}.` };
  return { above: parts[0] ?? "", below: parts[1] ?? "" };
}

/** Parses the scheme text: the one-line Reaction DSL, or one compound line / arrow line per line. */
export function parseScheme(input: string): ParsedScheme {
  const out: ParsedScheme = { stages: [], arrows: [], errors: [], notes: [] };
  const lines = input.split(/\r\n|\r|\n/).map((l, i) => ({ text: l.trim(), n: i + 1 })).filter((l) => l.text);
  type Tok = { kind: "stage"; parts: string[]; line: number } | { kind: "arrow"; arrow: SchemeArrow; line: number };
  const toks: Tok[] = [];
  for (const { text, n } of lines) {
    const am = ARROW_LINE.exec(text);
    if (am) {
      // The text after the arrow is conditions only: never split again on arrow tokens ("<-78 °C").
      const f = arrowFields(am[2], n);
      if (f.error) out.errors.push(f.error);
      toks.push({ kind: "arrow", arrow: { type: arrowTypeOf(am[1]), above: f.above, below: f.below }, line: n });
      continue;
    }
    const like = ARROW_LIKE.exec(text);
    if (like) {
      out.errors.push(`Line ${n}: “${like[1]}” is not an arrow this tool reads — start an arrow line with -> (or >>, <=>, <-).`);
      continue;
    }
    // A compound line, which may itself be the whole one-line DSL: A + B >> C ; over ; under.
    const spec = parseReaction(text);
    if (spec.arrowWarning) out.notes.push(lines.length > 1 ? `Line ${n}: ${spec.arrowWarning}` : spec.arrowWarning);
    if (!spec.stages.length) {
      out.errors.push(`Line ${n}: “${text}” has no compound in it.`);
      continue;
    }
    spec.stages.forEach((stage, i) => {
      if (i) toks.push({ kind: "arrow", arrow: { type: spec.arrows[i - 1], above: i === 1 ? spec.over : "", below: i === 1 ? spec.under : "" }, line: n });
      toks.push({ kind: "stage", parts: stage, line: n });
    });
    if ((spec.over || spec.under) && spec.stages.length < 2) out.errors.push(`Line ${n}: “; …” conditions belong on an arrow — put them on an arrow line (-> ${spec.over}${spec.under ? ` ; ${spec.under}` : ""}).`);
  }
  let expect: "stage" | "arrow" = "stage";
  for (const t of toks) {
    if (t.kind === "stage") {
      if (expect === "arrow") {
        out.errors.push(`Line ${t.line}: two compound lines in a row — put an arrow line (-> reagents ; conditions) between them, or join them with “ + ”.`);
        continue;
      }
      const stage: SchemeCompound[] = [];
      for (const p of t.parts) {
        const sl = splitLabel(p);
        if (sl.error) out.errors.push(`Line ${t.line}: ${sl.error}`);
        if (sl.text) stage.push({ text: sl.text, label: sl.label });
      }
      if (stage.length) out.stages.push(stage);
      expect = "arrow";
    } else {
      if (expect === "stage") {
        out.errors.push(out.stages.length ? `Line ${t.line}: two arrows in a row — a compound goes between them.` : `Line ${t.line}: the scheme starts with an arrow — the starting material goes first.`);
        continue;
      }
      out.arrows.push(t.arrow);
      expect = "stage";
    }
  }
  if (out.arrows.length >= out.stages.length && out.arrows.length) {
    out.errors.push("The last arrow has no product after it.");
    out.arrows.length = Math.max(0, out.stages.length - 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export type SchemeWidth = "page" | "acs1" | "acs2";

/** The widths a scheme wraps at, in points: a 6.5 in text column, and ACS's 3.25 in / 7 in columns. */
export const SCHEME_WIDTHS: Record<SchemeWidth, { pt: number; name: string }> = {
  page: { pt: 468, name: "page width (6.5 in)" },
  acs1: { pt: 234, name: "ACS single column (3.25 in)" },
  acs2: { pt: 504, name: "ACS double column (7 in)" },
};

export interface SchemeOptions {
  width?: SchemeWidth;
  /** Letters (a), (b) on the arrows and a "Reagents and conditions" footnote, instead of text on the arrows. */
  lettered?: boolean;
}

export interface SchemeCompoundOut {
  label: string | null;
  text: string;
  smiles: string;
  idcode: string;
  formula: string;
}

export type SchemeBuild =
  | {
      ok: true;
      /** The page, ready for the Build canvas. */
      doc: CdxDoc;
      svg: string;
      widthPt: number;
      heightPt: number;
      /** The lettered footnote: plain and as html (<sub>/<sup>) for the Word insert; null when not lettered. */
      footnote: { text: string; html: string } | null;
      compounds: SchemeCompoundOut[];
      notes: string[];
    }
  | { ok: false; errors: string[]; notes: string[] };

const L = 14.4; // the page's bond length (blankPageCdxml)
const TEXT_PT = 10; // caption size (blankPageCdxml)
const PITCH = 11.5; // condition text line pitch
const GAP = 7; // compound ↔ "+" / arrow
const ARROW_MIN = 3 * L;
const ARROW_PAD = 5; // condition text overhang allowance either side of the arrow
const COND_LINE_MAX = 7 * L; // condition text wraps at commas beyond this
const LABEL_GAP = 5; // structure bottom → label cap height
const ROW_GAP = 16;

/** Subscript and superscript digits/signs as typeset by typesetConditions → CDXML runs (0x20 sub, 0x40 sup). */
type Run = { text: string; face: number };
const SUBS = "₀₁₂₃₄₅₆₇₈₉";
const SUPS: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "−" };

export function conditionRuns(text: string): Run[] {
  const runs: Run[] = [];
  const push = (t: string, face: number): void => {
    const last = runs[runs.length - 1];
    if (last && last.face === face) last.text += t;
    else runs.push({ text: t, face });
  };
  for (const ch of typesetConditions(text)) {
    const si = SUBS.indexOf(ch);
    if (si >= 0) push(String(si), 0x20);
    else if (SUPS[ch]) push(SUPS[ch], 0x40);
    else push(ch, 0);
  }
  return runs;
}

const runsWidth = (runs: Run[], size: number, bold = false): number => runs.reduce((w, r) => w + textWidthPt(r.text, r.face ? size * 0.75 : size, bold), 0);

const runsHtml = (runs: Run[]): string =>
  runs.map((r) => {
    const t = r.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return r.face === 0x20 ? `<sub>${t}</sub>` : r.face === 0x40 ? `<sup>${t}</sup>` : t;
  }).join("");

/** Condition text broken at ", " into lines no wider than COND_LINE_MAX (an item longer than that keeps its own line). */
export function wrapConditions(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  if (runsWidth(conditionRuns(t), TEXT_PT) <= COND_LINE_MAX) return [t];
  const items = t.split(/,\s+/);
  const lines: string[] = [];
  let cur = "";
  items.forEach((it, i) => {
    const piece = i < items.length - 1 ? `${it},` : it;
    const cand = cur ? `${cur} ${piece}` : piece;
    if (cur && runsWidth(conditionRuns(cand), TEXT_PT) > COND_LINE_MAX) {
      lines.push(cur);
      cur = piece;
    } else cur = cand;
  });
  if (cur) lines.push(cur);
  return lines;
}

const fmt = (v: number): string => String(Math.round(v * 100) / 100);

/** A one-line centred caption at (cx, baseline): Arial 10 pt runs, box from the AFM widths. */
function addText(root: XNode, id: string, cx: number, baseline: number, runs: Run[], bold = false): void {
  const page = root.children.find((c) => c.name === "page");
  if (!page) return;
  const w = runsWidth(runs, TEXT_PT, bold);
  page.children.push({
    name: "t",
    attrs: { id, p: `${fmt(cx)} ${fmt(baseline)}`, BoundingBox: `${fmt(cx - w / 2)} ${fmt(baseline - TEXT_PT * 0.75)} ${fmt(cx + w / 2)} ${fmt(baseline + TEXT_PT * 0.22)}`, CaptionJustification: "Center", Justification: "Center" },
    children: runs.map((r) => ({ name: "s", attrs: { font: "3", size: fmt(TEXT_PT), face: String(r.face | (bold ? 1 : 0)) }, children: [], text: r.text, line: 0 })),
    text: "",
    line: 0,
  });
}

/** Atoms in one compound of a scheme, at most (a work bound: laying out thousands of atoms freezes Word). */
export const MAX_ATOMS = 150;
/**
 * Atoms in the whole scheme, at most. Each compound is laid out by OpenChemLib in the pane, between keystrokes, and
 * that layout is nearly all of the time (about 0.6 s for a taxol-sized compound): 500 atoms is a few seconds at worst.
 */
export const MAX_SCHEME_ATOMS = 500;
/** Compounds in one scheme, at most. */
export const MAX_COMPOUNDS = 60;
/** Lettered arrows, at most: (a) … (z). */
const MAX_LETTERS = 26;
/** How far an equilibrium arrow's upper shaft and half-head rise above the arrow line, in points. */
const EQ_RISE = 3;

const short = (t: string): string => (t.length > 40 ? `${t.slice(0, 40)}…` : t);

/**
 * The structure a component names, PARSED ONLY: no 2D layout yet, so the whole scheme's size is known before any
 * compound is laid out (buildScheme). Its idcode carries no stereo until it has coordinates.
 */
function resolveComponent(text: string): { ok: true; mol: Molecule; smiles: string } | { ok: false; reason: string } {
  // Atoms counted from the text first, before anything parses it: a 100,000-character SMILES must be refused at once.
  if (!lookupSmiles(text)) {
    const atoms = text.match(/\[[^\]]*\]|Br|Cl|[BCNOPSFI]|[bcnops]/g)?.length ?? 0;
    if (atoms > MAX_ATOMS * 2) return { ok: false, reason: `“${short(text)}” has about ${atoms} atoms — a scheme draws compounds of up to ${MAX_ATOMS}; insert a larger one from Build` };
  }
  // Mode "smiles" (the Reaction tool's Structures reading): dictionary name, then SMILES.
  const r = resolveChemInput(text, "smiles", "structure");
  if (r.kind !== "dictionary" && r.kind !== "smiles") {
    if (/^\d+\s*[A-Z([]/.test(text)) return { ok: false, reason: `“${text}”: coefficients are not drawn — switch the reading to Formulas to balance the equation` };
    // The resolver's own words (a duplicated ring closure, a formula with no single structure) say more than "could not".
    const why = r.kind === "formula" ? `“${text}” is a formula, and a formula has no single structure to draw — type a name or a SMILES string` : r.message;
    return { ok: false, reason: why && !/^Type a name/.test(why) ? why.replace(/[.\s]+$/, "") : `“${text}” could not be drawn — use a name or SMILES` };
  }
  const smiles = r.smiles;
  if (duplicateRingClosure(smiles)) return { ok: false, reason: `“${text}” has a ring closure that duplicates a bond` };
  let mol: Molecule;
  try {
    mol = Molecule.fromSmiles(smiles, { noCoordinates: true });
  } catch {
    return { ok: false, reason: `“${text}” could not be drawn — use a name or SMILES` };
  }
  if (!mol.getAllAtoms()) return { ok: false, reason: `“${text}” has no atoms` };
  if (mol.getAllAtoms() > MAX_ATOMS) return { ok: false, reason: `“${short(text)}” has ${mol.getAllAtoms()} atoms — a scheme draws compounds of up to ${MAX_ATOMS}; insert a larger one from Build` };
  return { ok: true, mol, smiles };
}

type Item =
  | { kind: "compound"; id: string; box: Box; label: string | null }
  | { kind: "plus" }
  | { kind: "arrow"; arrow: SchemeArrow; above: Run[][]; below: Run[][]; length: number };

const itemWidth = (it: Item): number => (it.kind === "compound" ? it.box[2] - it.box[0] : it.kind === "plus" ? textWidthPt("+", TEXT_PT * 1.2) : it.length);

/** Builds and draws the scheme. Errors from parsing, resolving or numbering stop it; notes do not. */
export function buildScheme(parsed: ParsedScheme, opts: SchemeOptions = {}): SchemeBuild {
  const notes = [...parsed.notes];
  if (parsed.errors.length) return { ok: false, errors: parsed.errors, notes };
  if (!parsed.stages.length) return { ok: false, errors: ["Add at least one compound."], notes };
  const count = parsed.stages.reduce((n, st) => n + st.length, 0);
  if (count > MAX_COMPOUNDS) return { ok: false, errors: [`This scheme has ${count} compounds — one figure holds up to ${MAX_COMPOUNDS}; split it into two schemes.`], notes };
  if (opts.lettered) {
    const lettered = parsed.arrows.filter((a) => a.above || a.below).length;
    if (lettered > MAX_LETTERS) return { ok: false, errors: [`${lettered} arrows carry conditions — lettering runs (a) to (z), so 26 at most; put the conditions on the arrows, or split the scheme.`], notes };
  }
  const width = SCHEME_WIDTHS[opts.width ?? "page"];
  const start = readCdxml(blankPageCdxml());
  if (!start.ok) return { ok: false, errors: [start.reason], notes };
  const doc0 = start.doc;
  const root = doc0.root;
  // A wide page: the scheme's own rows decide the size; the page box is never what is drawn.
  const page = root.children.find((c) => c.name === "page");
  if (page) page.attrs.BoundingBox = "0 0 4000 4000";

  // 1. Every structure on the page, at the house bond length.
  const errors: string[] = [];
  const compounds: SchemeCompoundOut[] = [];
  const placed: Array<Array<{ id: string; label: string | null }>> = [];
  const byLabel = new Map<string, { idcode: string; text: string }>();
  // Every compound parsed first, and the scheme's size checked, before any is laid out.
  const resolved = parsed.stages.map((stage) => stage.map((c) => ({ c, r: resolveComponent(c.text) })));
  let atoms = 0;
  for (const { r } of resolved.flat()) {
    if (!r.ok) errors.push(r.reason + ".");
    else atoms += r.mol.getAllAtoms();
  }
  if (atoms > MAX_SCHEME_ATOMS) errors.push(`This scheme has ${atoms} atoms in all — one figure draws up to ${MAX_SCHEME_ATOMS}, so the pane stays quick; split it into two schemes.`);
  if (errors.length) return { ok: false, errors, notes };
  for (const stage of resolved) {
    const row: Array<{ id: string; label: string | null }> = [];
    for (const { c, r } of stage) {
      if (!r.ok) continue;
      try {
        r.mol.inventCoordinates();
      } catch {
        /* coordinates from the parser */
      }
      // After the layout: an idcode without coordinates carries no stereo ((R) and (S) would compare equal).
      const idcode = r.mol.getIDCode();
      if (c.label) {
        const prev = byLabel.get(c.label);
        if (prev && prev.idcode !== idcode) errors.push(`Compound ${c.label} is used twice in this scheme for different structures (“${prev.text}” and “${c.text}”).`);
        else byLabel.set(c.label, { idcode, text: c.text });
      }
      const pageMol = moleculeToPage(doc0, r.mol, [0, 0]);
      if (!pageMol.ok) {
        errors.push(`“${c.text}” cannot be drawn on a scheme page: ${pageMol.reason}.`);
        continue;
      }
      let formula = "";
      try {
        formula = r.mol.getMolecularFormula().formula;
      } catch {
        /* none */
      }
      let smiles = r.smiles;
      try {
        smiles = r.mol.toIsomericSmiles();
      } catch {
        /* as typed */
      }
      compounds.push({ label: c.label, text: c.text, smiles, idcode, formula });
      row.push({ id: pageMol.fragmentId, label: c.label });
    }
    placed.push(row);
  }
  // The same structure under two different numbers in one scheme.
  const labelsOf = new Map<string, Set<string>>();
  for (const c of compounds) if (c.label) (labelsOf.get(c.idcode) ?? labelsOf.set(c.idcode, new Set()).get(c.idcode)!).add(c.label);
  for (const set of labelsOf.values()) if (set.size > 1) notes.push(`One structure carries ${set.size} numbers here: ${[...set].join(", ")}.`);
  if (errors.length) return { ok: false, errors, notes };

  const measured = readCdxmlTree(root);
  if (!measured.ok) return { ok: false, errors: [measured.reason], notes };
  const boxes = new Map<string, Box>();
  renderCdx(measured.doc, { boxes, pad: 0 });

  // 2. The item sequence, split into segments: stage 0, then [arrow, stage] pairs (a row breaks only before an arrow).
  let letter = 0;
  const footnoteParts: Array<{ text: string; html: string }> = [];
  const segments: Item[][] = [];
  placed.forEach((row, si) => {
    const seg: Item[] = [];
    if (si > 0) {
      const a = parsed.arrows[si - 1];
      let above: Run[][];
      let below: Run[][];
      if (opts.lettered && (a.above || a.below)) {
        const tag = `(${String.fromCharCode(97 + letter)})`;
        letter++;
        above = [conditionRuns(tag)];
        below = [];
        const both = [a.above, a.below].filter(Boolean).join(", ");
        footnoteParts.push({ text: `${tag} ${typesetConditions(both)}`, html: `${tag} ${runsHtml(conditionRuns(both))}` });
      } else {
        above = wrapConditions(a.above).map(conditionRuns);
        below = wrapConditions(a.below).map(conditionRuns);
      }
      const textW = Math.max(0, ...[...above, ...below].map((rr) => runsWidth(rr, TEXT_PT)));
      seg.push({ kind: "arrow", arrow: a, above, below, length: Math.max(ARROW_MIN, textW + 2 * ARROW_PAD) });
    }
    row.forEach((c, ci) => {
      if (ci) seg.push({ kind: "plus" });
      seg.push({ kind: "compound", id: c.id, box: boxes.get(c.id) ?? [0, 0, L, L], label: c.label });
    });
    segments.push(seg);
  });
  const segWidth = (seg: Item[]): number => seg.reduce((w, it) => w + itemWidth(it), 0) + GAP * Math.max(0, seg.length - 1);

  // 3. Rows: greedy, at the chosen width.
  const rows: Item[][] = [];
  let cur: Item[] = [];
  for (const seg of segments) {
    const join = cur.length ? GAP : 0;
    if (cur.length && segWidth(cur) + join + segWidth(seg) > width.pt) {
      rows.push(cur);
      cur = [];
    }
    cur.push(...seg);
  }
  if (cur.length) rows.push(cur);
  const rowW = rows.map(segWidth);
  const overWide = rowW.filter((w) => w > width.pt + 0.5).length;
  if (overWide) notes.push(`${overWide === 1 ? "One row is" : `${overWide} rows are`} wider than the ${width.name}: a structure is never drawn below the house bond length — choose a wider setting, or split the step.`);
  const maxW = Math.max(...rowW);

  // 4. Place each row: structures centred on the arrow line, labels on one baseline under the row.
  let top = 0;
  // One id counter for the texts (scanning the whole page for each one is quadratic).
  let nid = nextIdFrom(root);
  rows.forEach((row, ri) => {
    const hs = row.filter((it): it is Extract<Item, { kind: "compound" }> => it.kind === "compound").map((c) => c.box[3] - c.box[1]);
    const half = Math.max(L * 0.6, ...hs.map((h) => h / 2));
    const arrows = row.filter((it): it is Extract<Item, { kind: "arrow" }> => it.kind === "arrow");
    const aboveH = Math.max(0, ...arrows.map((a) => (a.above.length ? 4 + (a.arrow.type === "reversible" ? EQ_RISE : 0) + TEXT_PT * 1.0 + (a.above.length - 1) * PITCH : 0)));
    const belowH = Math.max(0, ...arrows.map((a) => (a.below.length ? 4 + (a.arrow.type === "reversible" ? EQ_RISE : 0) + TEXT_PT * 0.95 + (a.below.length - 1) * PITCH : 0)));
    const hasLabels = row.some((it) => it.kind === "compound" && it.label);
    const cy = top + Math.max(half, aboveH);
    const labelBase = cy + half + LABEL_GAP + TEXT_PT * 0.72;
    let x = (maxW - rowW[ri]) / 2;
    row.forEach((it, k) => {
      if (k) x += GAP;
      if (it.kind === "compound") {
        const w = it.box[2] - it.box[0], h = it.box[3] - it.box[1];
        moveObjects({ ...doc0, root }, [it.id], x - it.box[0], cy - h / 2 - it.box[1]);
        if (it.label) addText(root, nid(), x + w / 2, labelBase, [{ text: it.label, face: 0 }], true);
        x += w;
      } else if (it.kind === "plus") {
        const w = itemWidth(it);
        addText(root, nid(), x + w / 2, cy + TEXT_PT * 0.36, [{ text: "+", face: 0 }]);
        x += w;
      } else {
        const x0 = x, x1 = x + it.length;
        const tail: [number, number] = it.arrow.type === "retro" ? [x1, cy] : [x0, cy];
        const head: [number, number] = it.arrow.type === "retro" ? [x0, cy] : [x1, cy];
        addArrow({ ...doc0, root }, tail, head, it.arrow.type === "reversible" ? "equilibrium" : "reaction");
        nid = nextIdFrom(root); // the arrow took the next free id: count on from it
        const cx = (x0 + x1) / 2;
        // The line nearest the arrow clears it by 4 pt, or by 4 pt below its subscripts (H₂SO₄ must not touch the shaft).
        // An equilibrium's upper shaft and its half-head sit above the line: the text clears those too.
        const lift = 4 + (it.arrow.type === "reversible" ? EQ_RISE : 0) + (it.above.length && it.above[it.above.length - 1].some((r) => r.face === 0x20) ? TEXT_PT * 0.25 : 0);
        it.above.forEach((rr, i) => addText(root, nid(), cx, cy - lift - (it.above.length - 1 - i) * PITCH, rr));
        const drop = 4 + (it.arrow.type === "reversible" ? EQ_RISE : 0);
        it.below.forEach((rr, i) => addText(root, nid(), cx, cy + drop + TEXT_PT * 0.75 + i * PITCH, rr));
        x = x1;
      }
    });
    const bottom = Math.max(cy + half + (hasLabels ? LABEL_GAP + TEXT_PT : 0), cy + belowH);
    top = bottom + ROW_GAP;
  });

  // The page box back to a page that holds the drawing (it was made wide for the layout only): a .cdxml saved from
  // the canvas must not carry a 55-inch page.
  if (page) page.attrs.BoundingBox = `0 0 ${Math.max(540, Math.ceil(maxW + 60))} ${Math.max(720, Math.ceil(top + 60))}`;
  const done = readCdxmlTree(root);
  if (!done.ok) return { ok: false, errors: [done.reason], notes };
  const r = renderCdx(done.doc, { pad: done.doc.style.lineWidth * 2 });
  if (!r) return { ok: false, errors: ["The scheme could not be drawn."], notes };
  const footnote = footnoteParts.length
    ? { text: `Reagents and conditions: ${footnoteParts.map((f) => f.text).join("; ")}.`, html: `Reagents and conditions: ${footnoteParts.map((f) => f.html).join("; ")}.` }
    : null;
  return { ok: true, doc: done.doc, svg: r.svg, widthPt: r.widthPt, heightPt: r.heightPt, footnote, compounds, notes };
}

/** The smallest font-size in an SVG, in its own units (points for a scheme), or null when it sets none. */
export function smallestFontPt(svg: string): number | null {
  let min = Infinity;
  for (const m of svg.matchAll(/font-size="([\d.]+)"/g)) {
    const v = Number(m[1]);
    if (Number.isFinite(v) && v > 0) min = Math.min(min, v);
  }
  return Number.isFinite(min) ? min : null;
}

/** Words after which a number is a quantity, not a compound ("1 h", "2 equiv", "10 mol%"). */
const UNIT_AFTER = /^(?:h|hr|hrs|min|s|d|days?|weeks?|equiv|eq|mol|mol%|mmol|mg|g|kg|mL|L|µL|μL|M|mM|N|°C|K|%|atm|bar|psi|ppm)\b/;

/**
 * The title as html with this scheme's compound numbers bold ("Synthesis of 5" → of <b>5</b>): a whole word equal to a
 * label, primes typed as ' read as ′, and never a number followed by a unit ("1 h reflux").
 */
export function titleWithBoldLabels(title: string, labels: readonly string[], escape: (t: string) => string): string {
  const set = new Set(labels);
  // Split at spaces and punctuation ("of 5.", "1–3", "(2a)"); a sentence's full stop is not part of a number.
  const parts = title.split(/(\s+|[,;:()–—]+|\.(?=\s|$))/);
  return parts
    .map((w, i) => {
      // Primes typed as ' count only on a word that is then a label ("3'" for 3′): an apostrophe stays an apostrophe.
      const primed = w.replace(/''/g, "″").replace(/'/g, "′");
      const next = parts.slice(i + 1).find((x) => x.trim() && !/^[,;:()–—.]+$/.test(x)) ?? "";
      const nextIsSpace = /^\s+$/.test(parts[i + 1] ?? "");
      if (!set.has(primed) || (nextIsSpace && UNIT_AFTER.test(next))) return escape(w);
      return `<b>${escape(primed)}</b>`;
    })
    .join("");
}

/** "Scheme N." captions already in the document (paragraph texts), for the caption's displayed number. */
export function countSchemeCaptions(paragraphs: readonly string[]): number {
  return paragraphs.filter((p) => /^\s*Scheme\s+\d+\s*[.:]/.test(p)).length;
}
