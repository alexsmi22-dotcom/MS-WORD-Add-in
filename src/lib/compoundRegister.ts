/**
 * The document's compound register (docs/SCOPE-SCHEMES.md, v2.167.0): each compound number used in this document's
 * schemes, with the structure it stands for. A patent's Examples and schemes share their numbers ("to give 3"), so the
 * numbers belong to the document, not to one figure. The pane keeps the register in the document's settings (as the
 * reference numerals are kept) and writes it on insert, never on preview.
 *
 * Checks warn, never block — the numbering is the chemist's:
 *   - a number already registered for a different structure;
 *   - a structure already registered under another number;
 *   - a new number that skips (the document has 1–4; the scheme uses 7).
 *
 * Pure: no Office.js. Identity is OpenChemLib's idcode taken WITH coordinates (stereo kept: (R) and (S) differ).
 */

import { Molecule } from "openchemlib/full";
import { NUMBER_LIKE } from "./scheme";

/** The document setting the register lives in. */
export const REGISTER_SETTING = "jurislab.compounds";

export interface RegisteredCompound {
  /** The compound number as drawn: "3", "2a", "S3", "3′". */
  label: string;
  idcode: string;
  smiles: string;
  /** Molecular formula as printed (scheme.formulaText: "C₉H₈O₄", "C₄H₁₂N⁺"); older entries may hold "C9H8O4". */
  formula: string;
  /** The name or SMILES it was typed as. */
  text: string;
}

export interface CompoundRegister {
  entries: RegisteredCompound[];
  /**
   * Stored entries this version could not read (damaged, a duplicate number, past the limit): written back
   * unchanged, so a merge or a Forget never deletes what it could not read.
   */
  unread?: unknown[];
  /** False when the stored value as a whole could not be read: nothing is written over it. */
  writable?: boolean;
}

/** A compound of a scheme about to be inserted. */
export interface SchemeCompoundRef {
  label: string | null;
  idcode: string;
  smiles: string;
  formula: string;
  text: string;
}

/** Most entries kept (a damaged or hostile settings value must not grow without bound). */
const MAX_ENTRIES = 2000;
const MAX_FIELD = 4000;

const str = (v: unknown, max = MAX_FIELD): string | null => (typeof v === "string" && v.length <= max ? v : null);

/** Primes typed as ' or ’ (Word's smart quote) are the same number as ′ (3' is 3′, 3'' and 3′′ are 3″). */
export const normaliseLabel = (l: string): string =>
  l.trim().replace(/[’']/g, "′").replace(/′′/g, "″");

/**
 * The register from the stored setting (a JSON string, as written by writeRegister). Anything unreadable is dropped
 * and said, never guessed: a duplicate number keeps its first entry.
 */
export function readRegister(raw: unknown): { register: CompoundRegister; notes: string[] } {
  const notes: string[] = [];
  const register: CompoundRegister = { entries: [] };
  if (raw === null || raw === undefined || raw === "") return { register, notes };
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { register: { entries: [], writable: false }, notes: ["The document's compound register could not be read: it is not used, and it is left as it is (nothing is registered until it is cleared)."] };
    }
  }
  const list = data && typeof data === "object" && Array.isArray((data as { entries?: unknown }).entries) ? (data as { entries: unknown[] }).entries : null;
  if (!list) return { register: { entries: [], writable: false }, notes: ["The document's compound register is not in the expected form: it is not used, and it is left as it is."] };
  const seen = new Set<string>();
  const unread: unknown[] = [];
  let dropped = 0;
  list.forEach((e, i) => {
    if (i >= MAX_ENTRIES) {
      unread.push(e);
      return;
    }
    const o = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
    const label = str(o.label, 40), idcode = str(o.idcode), smiles = str(o.smiles), formula = str(o.formula, 200), text = str(o.text) ?? "";
    const l = label ? normaliseLabel(label) : "";
    // A stored number must be one the scheme parser could have written (1, 2a, S3, 3′): anything else is damage, or
    // a value someone put there — not drawn under a structure, inserted, or read by Characterization.
    if (!l || !NUMBER_LIKE.test(l) || !idcode || !smiles || formula === null) {
      dropped++;
      unread.push(e);
      return;
    }
    if (seen.has(l)) {
      notes.push(`The register holds compound ${l} twice; the first entry is used.`);
      unread.push(e);
      return;
    }
    seen.add(l);
    register.entries.push({ label: l, idcode, smiles, formula, text });
  });
  if (list.length > MAX_ENTRIES) notes.push(`The register holds ${list.length} entries; the first ${MAX_ENTRIES} are read (the rest are kept, unread).`);
  if (dropped) notes.push(`${dropped} damaged entr${dropped === 1 ? "y is" : "ies are"} not used (kept in the document as they are).`);
  if (unread.length) register.unread = unread;
  register.entries.sort((a, b) => compareLabels(a.label, b.label));
  return { register, notes };
}

/** The setting's value. */
export function writeRegister(reg: CompoundRegister): string {
  return JSON.stringify({ v: 1, entries: [...reg.entries.map(({ label, idcode, smiles, formula, text }) => ({ label, idcode, smiles, formula, text })), ...(reg.unread ?? [])] });
}

/** Compound numbers in reading order: 1, 2, 2a, 2b, 10, S1, S2 (capital prefixes after plain numbers). */
export function compareLabels(a: string, b: string): number {
  const key = (l: string): [string, number, string] => {
    const m = /^((?:ent|rac|rel)-)?([A-Z]{0,2}-?)(\d+)(.*)$/.exec(l);
    return m ? [m[2], Number(m[3]), (m[1] ?? "") + m[4]] : ["~", Infinity, l];
  };
  const [pa, na, sa] = key(a), [pb, nb, sb] = key(b);
  if (pa !== pb) return pa < pb ? -1 : 1;
  if (na !== nb) return na - nb;
  if (sa !== sb) return sa < sb ? -1 : 1;
  // A total order: "01" and "1" are different labels.
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The plain integer a label is numbered from ("7" and "7a" → 7; "S3", "ent-3" → null: their own series). */
const baseNumber = (l: string): number | null => {
  const m = /^(?:(?:ent|rac|rel)-)?(\d+)[a-z]{0,2}[′″]?$/.exec(l);
  return m ? Number(m[1]) : null;
};

/** A Hill formula as it is printed: counts lowered (C9H8O4 → C₉H₈O₄), never plain digits (the display contract). */
export function typesetFormula(f: string): string {
  const SUB = "₀₁₂₃₄₅₆₇₈₉";
  return f.replace(/([A-Za-z)\]])(\d+)/g, (_m, a: string, d: string) => a + [...d].map((c) => SUB[Number(c)]).join(""));
}

const shortText = (t: string): string => (t.length > 40 ? `${t.slice(0, 40)}…` : t);

const describe = (e: { formula: string; text: string }): string => `${typesetFormula(e.formula) || "a structure"}${e.text && e.text !== e.formula ? ` (${e.text.length > 40 ? `${e.text.slice(0, 40)}…` : e.text})` : ""}`;

/** The warnings for a scheme about to go into a document with this register. */
export function checkAgainstRegister(reg: CompoundRegister, compounds: readonly SchemeCompoundRef[]): string[] {
  const out: string[] = [];
  const byLabel = new Map(reg.entries.map((e) => [e.label, e]));
  const byId = new Map<string, RegisteredCompound[]>();
  for (const e of reg.entries) (byId.get(e.idcode) ?? byId.set(e.idcode, []).get(e.idcode)!).push(e);
  const said = new Set<string>();
  for (const c of compounds) {
    const label = c.label ? normaliseLabel(c.label) : null;
    if (label) {
      const prev = byLabel.get(label);
      if (prev && prev.idcode !== c.idcode) {
        const k = `l:${label}`;
        if (!said.has(k)) out.push(`Compound ${label} is already in this document as ${describe(prev)} — here it is ${describe(c)}.`);
        said.add(k);
        continue;
      }
    }
    const others = (byId.get(c.idcode) ?? []).filter((e) => e.label !== label);
    if (others.length && !(label && byLabel.get(label)?.idcode === c.idcode)) {
      const k = `i:${c.idcode}:${label ?? ""}`;
      if (said.has(k)) continue;
      said.add(k);
      const nums = others.map((e) => e.label).join(", ");
      out.push(label ? `“${shortText(c.text)}” is compound ${nums} in this document — here it is numbered ${label}.` : `“${shortText(c.text)}” is compound ${nums} in this document; number it (${others[0].label}) to match.`);
    }
  }
  // A new plain number that skips past the document's numbering.
  const known = new Set<number>();
  for (const e of reg.entries) {
    const n = baseNumber(e.label);
    if (n !== null) known.add(n);
  }
  for (const c of compounds) {
    const n = c.label ? baseNumber(normaliseLabel(c.label)) : null;
    if (n !== null) known.add(n);
  }
  const newNums = [...new Set(compounds.map((c) => (c.label ? baseNumber(normaliseLabel(c.label)) : null)).filter((n): n is number => n !== null))]
    .filter((n) => !reg.entries.some((e) => baseNumber(e.label) === n))
    .sort((a, b) => a - b);
  for (const n of newNums) {
    if (n <= 1) continue;
    if (!known.has(n - 1)) {
      let lo = n - 1;
      while (lo > 1 && !known.has(lo - 1)) lo--;
      const max = Math.max(0, ...reg.entries.map((e) => baseNumber(e.label) ?? 0));
      out.push(`Compound ${n} skips ${lo === n - 1 ? lo : `${lo}–${n - 1}`}${max ? ` (this document numbers up to ${max} so far)` : ""}.`);
      if (out.length > 40) break;
    }
  }
  return out;
}

/**
 * The register after a scheme went into the document: every numbered compound added. A number already registered for
 * a different structure is NOT overwritten (the warning said so); it is named in `kept`.
 */
export function mergeIntoRegister(reg: CompoundRegister, compounds: readonly SchemeCompoundRef[]): { register: CompoundRegister; added: string[]; kept: string[] } {
  const entries = reg.entries.map((e) => ({ ...e }));
  const byLabel = new Map(entries.map((e) => [e.label, e]));
  const added: string[] = [];
  const kept: string[] = [];
  for (const c of compounds) {
    if (!c.label) continue;
    const label = normaliseLabel(c.label);
    const prev = byLabel.get(label);
    if (prev) {
      if (prev.idcode !== c.idcode && !kept.includes(label)) kept.push(label);
      continue;
    }
    if (entries.length >= MAX_ENTRIES) break;
    const e = { label, idcode: c.idcode, smiles: c.smiles, formula: c.formula, text: c.text };
    entries.push(e);
    byLabel.set(label, e);
    added.push(label);
  }
  entries.sort((a, b) => compareLabels(a.label, b.label));
  return { register: { entries, unread: reg.unread, writable: reg.writable }, added, kept };
}

/** The register without one number. */
export function forgetCompound(reg: CompoundRegister, label: string): CompoundRegister {
  const l = normaliseLabel(label);
  // A stored duplicate of the same number goes too: Forget must not bring another structure back under it.
  const sameLabel = (e: unknown): boolean => {
    const v = e && typeof e === "object" ? (e as { label?: unknown }).label : undefined;
    return typeof v === "string" && normaliseLabel(v) === l;
  };
  const unread = reg.unread?.filter((e) => !sameLabel(e));
  return { entries: reg.entries.filter((e) => e.label !== l), unread: unread && unread.length ? unread : undefined, writable: reg.writable };
}

/**
 * "Number new compounds": a numberer for a scheme's unlabelled compounds. A structure already in the register (or
 * already numbered in this scheme) keeps its number; a new one takes the next free plain number after everything the
 * document and the scheme use. `taken` = the labels the scheme itself carries.
 */
export function autoNumberer(reg: CompoundRegister, taken: readonly string[]): (idcode: string) => string {
  const byId = new Map<string, string>();
  for (const e of reg.entries) if (!byId.has(e.idcode)) byId.set(e.idcode, e.label);
  const typed = new Set(taken.map(normaliseLabel));
  const used = new Set([...reg.entries.map((e) => e.label), ...typed]);
  let next = Math.max(0, ...[...used].map((l) => baseNumber(l) ?? 0)) + 1;
  return (idcode) => {
    // The document's number, unless this scheme types that number on another structure (then a fresh one).
    const have = byId.get(idcode);
    if (have && !typed.has(have)) return have;
    // Stored labels are at most four digits (NUMBER_LIKE), so this loop is bounded; the guard is belt and braces.
    while (used.has(String(next)) && next < 1e6) next++;
    const l = String(next++);
    used.add(l);
    byId.set(idcode, l);
    return l;
  };
}

/** The entry's SMILES draws the entry's structure (its idcode, stereo included). */
function entryIsSound(e: RegisteredCompound): boolean {
  try {
    const mol = Molecule.fromSmiles(e.smiles);
    return mol.getIDCode() === e.idcode;
  } catch {
    return false;
  }
}

/** "3", "compound 3", "cpd 2a", "compound S3" → the entry, and whether "compound" was written. */
export function lookupLabel(reg: CompoundRegister, text: string): { entry: RegisteredCompound; explicit: boolean } | null {
  // "compound 3." at the end of a sentence is compound 3.
  const t = text.trim().replace(/[.,;:]+$/, "");
  const m = /^(?:compound|cpd\.?|cmpd\.?)\s+(\S+)$/i.exec(t);
  const label = normaliseLabel(m ? m[1] : t);
  const entry = reg.entries.find((e) => e.label === label);
  return entry ? { entry, explicit: !!m } : null;
}

/**
 * Characterization's Compound field with the register: "compound 3" is always the registered compound; a bare "3" is
 * too unless it reads as something else ("S3" is also the formula S₃, "C2" dicarbon) — then the other reading stands
 * and the note says how to choose the register's. `readsOtherwise` = the field resolves without the register.
 */
export function compoundFieldInput(
  reg: CompoundRegister,
  text: string,
  readsOtherwise: boolean,
): { input: string; note: string | null; label: string | null } {
  const hit = lookupLabel(reg, text);
  if (!hit) {
    const m = /^(?:compound|cpd\.?|cmpd\.?)\s+(\S+)$/i.exec(text.trim().replace(/[.,;:]+$/, ""));
    return m ? { input: text, note: `There is no compound ${normaliseLabel(m[1])} in this document's register yet (it is filled when a scheme is inserted).`, label: null } : { input: text, note: null, label: null };
  }
  const { entry, explicit } = hit;
  // The stored SMILES must still be the stored structure: a damaged entry is never computed from.
  if (!entryIsSound(entry)) {
    return { input: text, note: `Compound ${entry.label}'s entry in this document's register is damaged (its SMILES is not its structure), so it is not used — Forget it in Reaction's list and insert its scheme again.`, label: null };
  }
  if (!explicit && readsOtherwise) {
    return { input: text, note: `“${text.trim()}” is read as typed; it is also compound ${entry.label} in this document (${typesetFormula(entry.formula)}) — write “compound ${entry.label}” for that.`, label: null };
  }
  return { input: `smiles:${entry.smiles}`, note: `Compound ${entry.label} of this document: ${describe(entry)}.`, label: entry.label };
}
