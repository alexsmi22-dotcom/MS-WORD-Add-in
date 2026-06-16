// Built-in lookup tables for turning a chemical name or molecular formula into a
// SMILES string, which the structure renderer needs to draw a 2D depiction.
//
// The data lives in compounds.json so it can be validated independently: every
// SMILES is checked against OpenChemLib by
//   node src/lib/__tests__/validate-compounds.mjs
// which guarantees no entry silently fails to render.
//
// Why a curated dictionary: a 2D structure is defined by connectivity, but a
// bare molecular formula (e.g. "C2H6O") does not uniquely determine it — it
// could be ethanol or dimethyl ether. Deriving structure from an arbitrary
// formula offline is ambiguous, so we resolve known names/formulas here and
// otherwise accept SMILES directly. For ambiguous formulas we map to the most
// common compound.
//
// Keys:
//   NAME_TO_SMILES    — lowercased common names (matched case-insensitively)
//   FORMULA_TO_SMILES — formulas as commonly written (matched case-sensitively,
//                       whitespace removed by the caller)

import compounds from "./compounds.json";

export const NAME_TO_SMILES: Record<string, string> = compounds.names;
export const FORMULA_TO_SMILES: Record<string, string> = compounds.formulas;
