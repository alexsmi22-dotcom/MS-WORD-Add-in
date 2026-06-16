// Resolves a chemical input to a 2D structure (SVG) using OpenChemLib, entirely
// offline. Input is interpreted in this order:
//   1. a known common name      (e.g. "aspirin", "water")
//   2. a known molecular formula (e.g. "H2O", "C6H6")
//   3. a raw SMILES string       (e.g. "CC(=O)O")
//
// SVG is produced here; converting it to a raster image for insertion into Word
// happens in the task pane (it needs the browser canvas API).

import { Molecule } from "openchemlib";
import { NAME_TO_SMILES, FORMULA_TO_SMILES } from "./compounds";

export interface StructureResult {
  svg: string;
  smiles: string;
  /** How the input was interpreted — useful for messaging in the UI. */
  source: "name" | "formula" | "smiles";
  /** Molecular formula, OCL canonical ID code, and relative molecular weight (provenance). */
  formula: string;
  idcode: string;
  mw: number;
}

/** Looks up a SMILES for a known name or formula. Returns null if not in the dictionaries. */
export function lookupSmiles(input: string): { smiles: string; source: "name" | "formula" } | null {
  const raw = input.trim();
  if (!raw) return null;

  const byName = NAME_TO_SMILES[raw.toLowerCase()];
  if (byName) return { smiles: byName, source: "name" };

  const byFormula = FORMULA_TO_SMILES[raw.replace(/\s+/g, "")];
  if (byFormula) return { smiles: byFormula, source: "formula" };

  return null;
}

function safeFromSmiles(smiles: string): Molecule | null {
  try {
    const mol = Molecule.fromSmiles(smiles);
    return mol.getAllAtoms() > 0 ? mol : null;
  } catch {
    return null;
  }
}

/**
 * Renders a 2D structure SVG for the given input, or returns null when the input
 * is neither a known name/formula nor a parseable SMILES string.
 */
export function renderStructure(input: string, width = 280, height = 220): StructureResult | null {
  const looked = lookupSmiles(input);

  let mol: Molecule | null = null;
  let smiles = "";
  let source: StructureResult["source"] = "smiles";

  if (looked) {
    mol = safeFromSmiles(looked.smiles);
    smiles = looked.smiles;
    source = looked.source;
  } else {
    // Fall back to treating the raw input as SMILES.
    const candidate = input.trim();
    mol = safeFromSmiles(candidate);
    smiles = candidate;
    source = "smiles";
  }

  if (!mol) return null;

  try {
    mol.inventCoordinates();
  } catch {
    // Coordinates may already be present; ignore.
  }

  const svg = mol.toSVG(width, height);

  // Provenance: canonical SMILES, OCL ID code, formula, and molecular weight.
  let canonicalSmiles = smiles;
  let idcode = "";
  let formula = "";
  let mw = 0;
  try {
    canonicalSmiles = mol.toIsomericSmiles();
  } catch {
    /* keep input smiles */
  }
  try {
    idcode = mol.getIDCode();
  } catch {
    /* ignore */
  }
  try {
    const mf = mol.getMolecularFormula();
    formula = mf.formula;
    mw = Math.round(mf.relativeWeight * 100) / 100;
  } catch {
    /* ignore */
  }

  return { svg, smiles: canonicalSmiles, source, formula, idcode, mw };
}
