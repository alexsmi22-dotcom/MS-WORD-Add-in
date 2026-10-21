// Compound tables from the document's register (gap item 4, docs/SCOPE-COMPOUND-TABLE.md): the table a patent's
// Examples end with — compound number, structure, name, formula, mass and any columns of the chemist's own (IC50,
// yield) — built from the compounds the document's schemes have numbered (lib/compoundRegister.ts). Pure: no Office.js;
// the structures are drawn here as SVG (ACS 1996 style, as the schemes draw them) and the pane rasterises them.

import { Molecule } from "openchemlib/full";
import { readCdxml, readCdxmlTree } from "./cdxml";
import { blankPageCdxml } from "./cdxmlEdit";
import { moleculeToPage } from "./cdxmlMol";
import { renderCdx } from "./cdxmlRender";
import { compareLabels, normaliseLabel, typesetFormula, type CompoundRegister, type RegisteredCompound } from "./compoundRegister";
import { stereoText } from "./cipText";
import { iupacName, nameWithDescriptors } from "./iupacName";
import { ADDUCTS, adductMz, smilesSpec } from "./massspec";
import { ELECTRON_MASS } from "./isotopes";
import { nameForIdcode } from "./structures";

export type CtColumn = "structure" | "name" | "formula" | "mw" | "exact" | "mh" | "smiles";

export const CT_COLUMNS: Array<{ id: CtColumn; head: string }> = [
  { id: "structure", head: "Structure" },
  { id: "name", head: "Name" },
  { id: "formula", head: "Formula" },
  { id: "mw", head: "MW (g/mol)" },
  { id: "exact", head: "Exact mass (Da)" },
  { id: "mh", head: "[M + H]⁺ (m/z)" },
  { id: "smiles", head: "SMILES" },
];

/** A compound's name: the curated dictionary first, then the offline systematic namer with its CIP descriptors. */
export function structureName(idcode: string, fromText = true): { name: string | null; kind: "dictionary" | "systematic" | "none"; note: string | null } {
  const dict = nameForIdcode(idcode);
  const sys = systematicName(idcode, fromText);
  // A dictionary name without a stereodescriptor ("alanine") for a structure that has one would name the two
  // enantiomers inconsistently (the other one gets "(2R)-…" from the namer): the descriptor-bearing name wins.
  // Only an R/S descriptor counts: a substituent bracket ("(propan-2-yl)benzene") is not one, and an E/Z-only name
  // leaves a well-known common name (cinnamaldehyde) in place.
  const rs = !!sys.name && /^\((?:\d*[EZ],)*\d*[RS](?:,\d*[RSEZ])*\)-/.test(sys.name);
  if (dict && !(rs && !/^\(|^[LDRS][-,]/i.test(dict))) return { name: tableCase(dict), kind: "dictionary", note: null };
  return sys;
}

/** Acronyms and abbreviations the dictionary stores in lower case. */
const ACRONYMS: Record<string, string> = {
  atp: "ATP", adp: "ADP", amp: "AMP", gtp: "GTP", gdp: "GDP", gmp: "GMP", ctp: "CTP", utp: "UTP", camp: "cAMP", cgmp: "cGMP",
  nad: "NAD", nadh: "NADH", nadp: "NADP", nadph: "NADPH", fad: "FAD", fadh2: "FADH₂", fmn: "FMN", coa: "CoA",
  edta: "EDTA", egta: "EGTA", gaba: "GABA", dmso: "DMSO", dmf: "DMF", thf: "THF", dtt: "DTT", hepes: "HEPES", mops: "MOPS",
  tris: "Tris", dcm: "DCM", tfa: "TFA", dipea: "DIPEA", dbu: "DBU", dmap: "DMAP", dcc: "DCC", edc: "EDC", hobt: "HOBt",
  hatu: "HATU", nbs: "NBS", ncs: "NCS", lda: "LDA", mcpba: "mCPBA", ddq: "DDQ", pcc: "PCC", tbaf: "TBAF", lsd: "LSD",
  mdma: "MDMA", ddt: "DDT", tnt: "TNT", paba: "PABA", dha: "DHA", epa: "EPA",
};

/**
 * A dictionary name as a table cell writes it. The dictionary keeps its names in lower case (nameForIdcode adds a
 * display capital): the cell takes the stored spelling (o-xylene), with the acronyms it knows in capitals (ATP, EDTA).
 */
function tableCase(display: string): string {
  const raw = display.charAt(0).toLowerCase() + display.slice(1);
  if (ACRONYMS[raw]) return ACRONYMS[raw];
  // The stored spelling cannot tell n-butanol (normal, lower case) from N-methyl…, so no locant is re-capitalised.
  return raw;
}

const UNREADABLE = "the structure could not be read";

function systematicName(idcode: string, fromText: boolean): { name: string | null; kind: "systematic" | "none"; note: string | null } {
  let mol: Molecule;
  try {
    mol = Molecule.fromIDCode(idcode);
  } catch {
    return { name: null, kind: "none", note: UNREADABLE };
  }
  if (!mol.getAllAtoms()) return { name: null, kind: "none", note: UNREADABLE };
  const sys = iupacName(mol);
  if (!sys.name) return { name: null, kind: "none", note: sys.refusal ?? null };
  let st: ReturnType<typeof stereoText> = { prefix: null, line: null };
  try {
    st = stereoText(mol, sys.locants, { reversible: sys.reversible, fromText });
  } catch {
    /* the name stands without descriptors */
  }
  const name = st.prefix ? nameWithDescriptors(sys.name, st.prefix, sys.descriptorAt) : sys.name;
  const note =
    !st.prefix && sys.caveats.some((c) => /stereodescriptors/i.test(c))
      ? `stereodescriptors not in the name — ${st.line ?? "not given"}`
      : st.prefix && st.line?.includes("lone-pair centre")
        ? "a lone-pair centre read from text — confirm its descriptor against the drawing"
        : null;
  return { name, kind: "systematic", note };
}

/** The structure drawn as the schemes draw it (ACS 1996 document settings), as SVG sized in points. */
export function structureSvg(smiles: string): { svg: string; widthPt: number; heightPt: number } | null {
  let mol: Molecule;
  try {
    mol = Molecule.fromSmiles(smiles);
    mol.inventCoordinates();
  } catch {
    return null;
  }
  const start = readCdxml(blankPageCdxml());
  if (!start.ok) return null;
  const placed = moleculeToPage(start.doc, mol, [0, 0]);
  if (!placed.ok) return null;
  // The page as edited, measured again (as the schemes do) before it is drawn.
  const measured = readCdxmlTree(start.doc.root);
  if (!measured.ok) return null;
  const r = renderCdx(measured.doc, { pad: 4 });
  return r ? { svg: r.svg, widthPt: r.widthPt, heightPt: r.heightPt } : null;
}

/** "1–5, 7, 2a" → the labels in the register it names, in register order; null = all. */
export function selectLabels(reg: CompoundRegister, spec: string): { labels: string[]; errors: string[] } {
  const all = [...reg.entries].map((e) => e.label).sort(compareLabels);
  const t = spec.trim();
  if (!t || /^all$/i.test(t)) return { labels: all, errors: [] };
  const errors: string[] = [];
  const pick = new Set<string>();
  const parts = t.split(/\s*[,;]\s*/).filter(Boolean);
  if (!parts.length) return { labels: [], errors: ["No compounds chosen — leave the box empty for all, or type numbers (1–5, 7, 2a)."] };
  for (const part of parts) {
    const m = /^(\d+)\s*[-–—−]\s*(\d+)$/.exec(part);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y);
      if (b - a > 2000) {
        errors.push(`“${part}” is too wide a range.`);
        continue;
      }
      // A numeric range takes the plain numbers in it (2–4 is 2, 3, 4 — and not 2a; name 2a on its own).
      const hit = all.filter((l) => /^\d+$/.test(l) && Number(l) >= a && Number(l) <= b);
      if (!hit.length) errors.push(`No compound numbered ${a}–${b} in this document's register.`);
      hit.forEach((l) => pick.add(l));
    } else {
      const l = normaliseLabel(part);
      // "s1" finds S1: labels differ by more than case only by mistake.
      const found = all.includes(l) ? l : all.find((x) => x.toLowerCase() === l.toLowerCase());
      if (found) pick.add(found);
      else errors.push(`There is no compound ${l} in this document's register.`);
    }
  }
  return { labels: all.filter((l) => pick.has(l)), errors };
}

export interface CtRow {
  label: string;
  /** Text per column, in the table's column order (the structure column holds ""). */
  cells: string[];
  structure: { svg: string; widthPt: number; heightPt: number } | null;
}

export interface CompoundTable {
  header: string[];
  rows: CtRow[];
  /** Index of the structure column in `header`, or -1. */
  structureCol: number;
  notes: string[];
  errors: string[];
}

export const MAX_TABLE_ROWS = 200;

/**
 * The table for the chosen compounds: the number first, then the chosen columns in the order CT_COLUMNS lists them,
 * then the chemist's own (left blank to fill in). A name the namer cannot give is "—" and the note says why; a mass for
 * an element with no stable isotope is "—" too.
 */
export function buildCompoundTable(reg: CompoundRegister, o: { columns: CtColumn[]; select?: string; extra?: string[] }): CompoundTable {
  const notes: string[] = [];
  const sel = selectLabels(reg, o.select ?? "");
  if (!reg.entries.length) return { header: [], rows: [], structureCol: -1, notes, errors: ["This document's register has no compounds yet — it fills when a Reaction scheme with numbered compounds is inserted."] };
  if (sel.errors.length && !sel.labels.length) return { header: [], rows: [], structureCol: -1, notes, errors: sel.errors };
  notes.push(...sel.errors);
  if (sel.labels.length > MAX_TABLE_ROWS) return { header: [], rows: [], structureCol: -1, notes, errors: [`${sel.labels.length} compounds — one table holds up to ${MAX_TABLE_ROWS}; choose a range (1–50).`] };
  const cols = CT_COLUMNS.filter((c) => o.columns.includes(c.id));
  const given = (o.extra ?? []).map((x) => x.trim()).filter(Boolean);
  const extra = given.slice(0, 8);
  if (given.length > 8) notes.push(`Up to 8 columns of your own: ${given.slice(8).map((x) => `“${x}”`).join(", ")} left out.`);
  const header = ["Compound", ...cols.map((c) => c.head), ...extra];
  const byLabel = new Map<string, RegisteredCompound>(reg.entries.map((e) => [e.label, e]));
  const nameless: string[] = [];
  const rows: CtRow[] = [];
  for (const label of sel.labels) {
    const e = byLabel.get(label)!;
    let structure: CtRow["structure"] = null;
    const cells: string[] = [label];
    // Masses from the stored structure itself, never by looking its SMILES up as text ("CO" is methanol, not CO).
    const wantMs = cols.some((c) => c.id === "exact" || c.id === "mh");
    const spec = wantMs && e.smiles ? smilesSpec(e.smiles) : null;
    const ms = spec && typeof spec !== "string" ? spec : null;
    // A salt or mixture (more than one component): its masses are not one species' — the cells say "—".
    const multi = e.smiles.includes(".");
    if (wantMs && multi) notes.push(`Compound ${label} has more than one component (a salt?): exact mass and [M + H]⁺ are left out — give the free base's by hand.`);
    for (const c of cols) {
      switch (c.id) {
        case "structure":
          structure = structureSvg(e.smiles);
          if (!structure) notes.push(`Compound ${label}: the structure could not be drawn.`);
          cells.push("");
          break;
        case "name": {
          // The name is of the stored structure; if it and the SMILES the other columns use disagree, neither is trusted.
          let agree = false;
          try {
            agree = !!e.smiles && Molecule.fromSmiles(e.smiles).getIDCode() === e.idcode;
          } catch {
            /* disagree */
          }
          const n = agree ? structureName(e.idcode) : { name: null, kind: "none" as const, note: UNREADABLE };
          if (!n.name && n.note === UNREADABLE) notes.push(`Compound ${label}: the stored structure could not be read (or does not match its SMILES), so it has no name.`);
          else if (!n.name) nameless.push(label);
          else if (n.note) notes.push(`Compound ${label}: ${n.note}.`);
          cells.push(n.name ?? "—");
          break;
        }
        case "formula":
          cells.push(typesetFormula(e.formula));
          break;
        case "mw": {
          let mw = NaN;
          try {
            const m = Molecule.fromSmiles(e.smiles);
            if (m.getAllAtoms()) mw = m.getMolecularFormula().relativeWeight;
          } catch {
            /* "—" */
          }
          cells.push(Number.isFinite(mw) ? mw.toFixed(2) : "—");
          break;
        }
        case "exact":
          // An ion's exact mass is its m/z: the electrons it lacks (or carries) are counted.
          cells.push(ms && !multi ? (ms.monoisotopicMass - ms.netCharge * ELECTRON_MASS).toFixed(4) : "—");
          if (ms && !multi && ms.netCharge !== 0) notes.push(`Compound ${label} is an ion: its exact mass is the ion's (electron mass counted).`);
          break;
        case "mh": {
          const mh = ADDUCTS.find((a) => a.name === "[M+H]+")!;
          if (multi) cells.push("—");
          else if (ms && ms.netCharge === 0) cells.push(adductMz(ms.monoisotopicMass, mh).toFixed(4));
          else {
            cells.push("—");
            if (ms && ms.netCharge !== 0) notes.push(`Compound ${label} carries a charge, so [M + H]⁺ is left out.`);
          }
          break;
        }
        case "smiles":
          cells.push(e.smiles);
          break;
      }
    }
    for (let i = 0; i < extra.length; i++) cells.push("");
    rows.push({ label, cells, structure });
  }
  if (nameless.length) notes.push(`No systematic name for compound${nameless.length === 1 ? "" : "s"} ${nameless.join(", ")} (outside what the offline namer covers): “—” — write the name in by hand.`);
  if (cols.some((c) => c.id === "name")) notes.push("Names come from the offline namer and dictionary: verify them before filing.");
  return { header, rows, structureCol: cols.findIndex((c) => c.id === "structure") >= 0 ? 1 + cols.findIndex((c) => c.id === "structure") : -1, notes, errors: [] };
}
