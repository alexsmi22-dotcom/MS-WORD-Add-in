// The one-line reaction DSL (reactants + reactants >> products ; over ; under) and the
// typesetting of reagent text. The scheme itself is drawn by scheme.ts (v2.166.0), as one
// ChemDraw page; the side-by-side SVG composer that lived here was retired with it.
//
// Pure string logic — no Office.js, no OpenChemLib — so it is fully unit-testable.

import { atomicNumber } from "./periodic";

/** The arrow drawn between two stages. */
export type ArrowType = "forward" | "reversible" | "retro";

export interface ReactionSpec {
  /** One array of components per arrow-separated stage (≥1; e.g. A + B → C → D). */
  stages: string[][];
  /**
   * Set when the arrow between stages was not recognised and a delimiter was left
   * stranded against a component. Present rather than thrown because the rest of
   * the reaction is still drawable; the caller decides whether to show it.
   */
  arrowWarning?: string;
  /** The arrow type between each pair of stages (length = stages.length − 1). */
  arrows: ArrowType[];
  /** Text above the (first) arrow (reagents/catalyst). */
  over: string;
  /** Text below the (first) arrow (conditions, e.g. temperature/time). */
  under: string;
}

// Arrow tokens, longest first so "<=>"/"<->"/"<-" resolve before "->"/">>".
const ARROW_SPLIT = /(>>|<=>|<->|⇌|⇋|←|<-|→|->)/;

function arrowType(token: string): ArrowType {
  if (token === "⇌" || token === "⇋" || token === "<=>" || token === "<->") return "reversible";
  if (token === "←" || token === "<-") return "retro";
  return "forward";
}

/**
 * Parses the reaction DSL:
 *   "CCO + CC(=O)O >> CC(=O)OCC ; H2SO4 ; reflux"
 * Components within a stage are split on a whitespace-padded "+"; stages are split
 * on an arrow token — ">>", "->", "→" (forward), "<=>", "<->", "⇌" (reversible),
 * or "<-", "←" (retrosynthetic) — so multi-step schemes A → B ⇌ C are supported.
 * The two optional trailing ";"-separated fields are over/under the (first) arrow.
 */
export function parseReaction(input: string): ReactionSpec {
  const [rxn = "", over = "", under = ""] = input.split(";").map((s) => s.trim());
  // Split components on a whitespace-padded "+" only, so SMILES formal charges
  // (e.g. C[N+](C)(C)C, [O-]) are not shattered.
  const split = (s: string): string[] =>
    s
      .split(/\s+\+\s+/)
      .map((p) => p.trim())
      .filter(Boolean);
  const tokens = rxn.split(ARROW_SPLIT);
  const stages: string[][] = [];
  const arrows: ArrowType[] = [];
  for (let k = 0; k < tokens.length; k++) {
    if (k % 2 === 0) {
      const stage = split(tokens[k].trim());
      if (stage.length) stages.push(stage);
    } else if (stages.length) {
      arrows.push(arrowType(tokens[k]));
    }
  }
  // Keep exactly one arrow per gap between stages (pad/trim defensively).
  while (arrows.length < stages.length - 1) arrows.push("forward");
  arrows.length = Math.max(0, stages.length - 1);
  // A MALFORMED ARROW MUST NOT BECOME PART OF A COMPONENT.
  //
  // ARROW_SPLIT matches "->" inside "->>", so `A ->> B` split into
  // ["A ", "->", "> B"] and the second stage became the single component "> B",
  // which was then handed to OpenChemLib as SMILES. A stray delimiter absorbed into
  // a chemical formula is the quiet kind of wrong: it does not error, it draws
  // something. Whatever the user meant by "->>", this code cannot know — so the
  // leftover is stripped and reported rather than guessed at.
  const cleaned: string[][] = [];
  const strays: string[] = [];
  for (const stage of stages) {
    const parts: string[] = [];
    for (const c of stage) {
      const trimmed = c.replace(/^[\s<>=]+|[\s<>=]+$/g, "").trim();
      if (trimmed !== c.trim()) strays.push(c.trim());
      if (trimmed) parts.push(trimmed);
    }
    cleaned.push(parts);
  }
  const arrowWarning = strays.length
    ? `The arrow between stages is not one this tool recognises — "${strays.join('", "')}" was left ` +
      `over after splitting on it, and would otherwise have been read as part of a chemical ` +
      `formula. Use one of -> , <- , <=> , <-> or >> .`
    : undefined;

  return { stages: cleaned, arrows, over, under, arrowWarning };
}

/** Group abbreviations a reagent formula may carry (Et₃N, Boc₂O, Pd(PPh₃)₄, n-Bu₃SnH …). */
const REAGENT_GROUPS = new Set(["Me", "Et", "Pr", "Bu", "Ph", "Bn", "Ac", "Bz", "Ts", "Ms", "Tf", "Boc", "Cbz", "Fmoc", "Tr", "Cy", "Ar", "Py", "Tol", "Mes"]);
const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/** Mechanism names, not formulas (SN2 is never S N₂). */
const MECHANISMS = new Set(["SN1", "SN2", "E1", "E2", "SNAr", "SRN1", "SE2", "SE1"]);
/** The elements written alone with a count in conditions (H₂, O₂ …); any other "letter + digits" (B2, C3) is a label. */
const LONE_FORMULAS = new Set(["H2", "N2", "O2", "O3", "F2", "Cl2", "Br2", "I2", "S8", "P4"]);

const SUPER: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "−": "⁻", "-": "⁻" };

/**
 * Reaction conditions as chemists write them: the digits of a reagent's formula lowered — "H2SO4" → H₂SO₄, "CH2Cl2"
 * → CH₂Cl₂, "Et3N" → Et₃N, "Pd(PPh3)4" → Pd(PPh₃)₄ (the display contract; the scheme showed H2SO4: demo walkthrough
 * 2026-10-19). Only a token made wholly of element symbols, group abbreviations, digits and brackets, starting with a
 * capital, is touched; "0 °C", "2 h", "rt", "1,4-dioxane", "10 mol%" are left as typed.
 */
export function typesetConditions(text: string): string {
  // A charge right after a formula is + or − (a hyphen only at the end of a word: "CH2Cl2-MeOH" is a solvent mixture,
  // not a charge — review): Mg2+ → Mg²⁺, NH4+ → NH₄⁺, H2SO4− → H₂SO₄⁻.
  return text.replace(/([A-Z][A-Za-z0-9()]*)([+−]|-(?![A-Za-z0-9]))?/g, (whole, tok: string, charge: string | undefined) => {
    if (charge) {
      const ion = /^([A-Z][a-z]?)([0-9]+)$/.exec(tok);
      if (ion && atomicNumber(ion[1]) !== null) return ion[1] + [...ion[2], charge].map((c) => SUPER[c]).join("");
      const counted = typesetConditions(tok);
      return counted === tok && !/^[A-Z][a-z]?$/.test(tok) && !counted.match(/[₀-₉]/) ? whole : counted + SUPER[charge];
    }
    if (!/[0-9]/.test(tok)) return whole;
    if (MECHANISMS.has(tok)) return tok;
    // One element and a count only: a formula when it is one of the usual lone ones, else a label ("Step B2").
    if (/^[A-Z][a-z]?[0-9]+$/.test(tok) && !LONE_FORMULAS.has(tok)) return tok;
    const words = tok.match(/[A-Z][a-z]*/g) ?? [];
    const bare = tok.replace(/[A-Z][a-z]*/g, "").replace(/[0-9()]/g, "");
    if (bare || !words.every((w) => atomicNumber(w) !== null || REAGENT_GROUPS.has(w))) return tok;
    return tok.replace(/([A-Za-z)])([0-9]+)/g, (_m, before: string, n: string) => before + [...n].map((d) => SUBSCRIPT[Number(d)]).join(""));
  });
}
