// Physicochemical property & druglikeness prediction for a compound, from a
// name, molecular formula, or SMILES. Extends the Chemical mode's existing
// molecular-weight/charge readout with the numbers a medicinal-chemistry or
// life-science audience expects (cLogP, logS, tPSA, H-bond donors/acceptors,
// rotatable bonds) plus the Lipinski Rule-of-Five and Veber oral-bioavailability
// screens — capabilities ChemDraw gates behind a license tier.
//
// The estimators are OpenChemLib's (already bundled for structure rendering), so
// nothing new ships and no network call is made. Pure functions — no Office.js.
//
// HONESTY — this file used to describe these as "OpenChemLib's validated models"
// and return every number bare. A reader hears "validated" as "these are right".
// cLogP and logS are PREDICTIONS with real error; MW and the topological counts
// are not. Presenting them side by side in one undifferentiated list invites a
// med-chemist to trust the prediction as much as the arithmetic.
//
// The error figures quoted in `caveats` are MEASURED, not folklore: see
// propertiesAccuracy.test.ts, which pins OpenChemLib's output against tabulated
// experimental values and fails if the model drifts. That is also why the numbers
// are lower than the "+-0.5-1.0 log unit" rule of thumb usually cited — for this
// reference set OCL does better than the folklore, and the caveat says what was
// actually observed rather than what is usually repeated.

import { Molecule, MoleculeProperties } from "openchemlib";
import { lookupSmiles } from "./structures";

export interface RuleResult {
  /** True when the compound satisfies the rule (Lipinski allows one violation). */
  pass: boolean;
  /** Human-readable criteria that were violated (empty when fully compliant). */
  violations: string[];
}

export interface PhysChemProperties {
  /** Isomeric SMILES the properties were computed from. */
  smiles: string;
  formula: string;
  /** Relative molecular weight (g/mol). */
  mw: number;
  /** Non-hydrogen atom count. */
  heavyAtoms: number;
  /** Calculated octanol–water partition coefficient (cLogP). */
  logP: number;
  /** Calculated aqueous solubility, log(mol/L). */
  logS: number;
  /** Topological polar surface area (Å²). */
  tpsa: number;
  /** Hydrogen-bond donors. */
  hbd: number;
  /** Hydrogen-bond acceptors. */
  hba: number;
  rotatableBonds: number;
  /**
   * True when the Lipinski/Veber screens actually apply: an organic
   * (carbon-containing) molecule with ≥ 2 heavy atoms. Both rules are
   * upper-bound filters derived from organic drug-candidate libraries, so a
   * bare metal atom, a noble gas, or a simple inorganic salt trivially "passes"
   * every ceiling. Callers should show "n/a" rather than a green pass for those.
   */
  druglikenessApplicable: boolean;
  /** Lipinski Rule of Five (oral druglikeness). */
  lipinski: RuleResult;
  /** Veber rule (oral bioavailability): rotatable bonds ≤ 10 and tPSA ≤ 140. */
  veber: RuleResult;
  /**
   * Plain-language limits on everything above. The UI must render these — they
   * are what separates "cLogP 3.00" (a prediction that can be a full log unit
   * out) from "MW 206.29" (arithmetic). Never omit them to save space.
   */
  caveats: string[];
}

/**
 * Which of these numbers are predictions, how wrong they can be, and where they
 * stop applying. Tailored to the actual molecule so the warnings are relevant
 * rather than a wall of boilerplate the reader learns to skip.
 */
function propertyCaveats(mol: Molecule, p: PhysChemProperties, hasCarbon: boolean): string[] {
  const out: string[] = [];

  out.push(
    "cLogP and logS are PREDICTIONS from increment models — not measurements. " +
      "Against tabulated experimental values, this cLogP lands within ~0.4 log units " +
      "typically (RMSE 0.42, n=20) but was out by 0.97 at worst. Treat ±0.5 as normal " +
      "and ±1 as possible."
  );
  out.push(
    "logS is the weaker of the two: RMSE 0.72 (n=10), worst case 1.5 log units. " +
      "Fused polycyclic aromatics are the known failure mode — anthracene reads ~1.5 " +
      "log units too soluble."
  );

  // Aromatic hydrocarbons are where the measured bias actually bites.
  let aromatic = 0;
  for (let a = 0; a < mol.getAllAtoms(); a++) if (mol.isAromaticAtom(a)) aromatic++;
  if (aromatic >= 10) {
    out.push(
      "This molecule is strongly aromatic. The reference set shows a consistent " +
        "negative bias there (benzene −0.47, toluene −0.73), so the true cLogP is " +
        "likely HIGHER than shown."
    );
  }

  if (!hasCarbon) {
    out.push(
      "No carbon: this is outside the training space of every model here. cLogP and " +
        "logS for inorganics, salts and bare elements are not meaningful."
    );
  }

  out.push(
    "tPSA, H-bond donors/acceptors and rotatable bonds are deterministic counts, not " +
      "predictions. But their DEFINITIONS differ between tools, so these may not match " +
      "ChemDraw or PubChem exactly even though none is wrong."
  );

  if (p.druglikenessApplicable) {
    out.push(
      "Lipinski and Veber are heuristics from oral small-molecule datasets, not laws. " +
        "Many approved drugs violate them — most injectables, most natural products, " +
        "most antibiotics. A fail is a prompt to think, not a verdict."
    );
  } else {
    out.push(
      "Lipinski/Veber are not applicable to this input: they are upper-bound filters " +
        "built from organic drug candidates, so a non-organic trivially clears every " +
        "ceiling. That is not a pass."
    );
  }

  return out;
}

function round(x: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(x * f) / f;
}

/**
 * Computes physicochemical properties and druglikeness screens for `input`
 * (a dictionary name, a molecular formula, or a SMILES). Returns null if the
 * input can't be resolved to a valid structure.
 */
export function computeProperties(input: string): PhysChemProperties | null {
  const looked = lookupSmiles(input);
  const raw = looked ? looked.smiles : input.trim();
  if (!raw) return null;

  let mol: Molecule;
  try {
    mol = Molecule.fromSmiles(raw);
  } catch {
    return null;
  }
  if (mol.getAllAtoms() === 0) return null;

  const mf = mol.getMolecularFormula();
  const mw = round(mf.relativeWeight, 2);
  const heavyAtoms = mol.getAllAtoms();

  // Druglikeness applies only to organic small molecules. Require at least one
  // carbon and more than one heavy atom — this suppresses the meaningless
  // "pass" that bare metals ([Au]), noble gases ([He]), and simple salts
  // (NaCl) would otherwise report, without excluding carbon-bearing
  // metallodrugs such as auranofin.
  let hasCarbon = false;
  for (let i = 0; i < heavyAtoms; i++) {
    if (mol.getAtomicNo(i) === 6) {
      hasCarbon = true;
      break;
    }
  }
  const druglikenessApplicable = hasCarbon && heavyAtoms >= 2;

  const mp = new MoleculeProperties(mol);
  const logP = round(mp.logP, 2);
  const logS = round(mp.logS, 2);
  const tpsa = round(mp.polarSurfaceArea, 1);
  const hbd = mp.donorCount;
  const hba = mp.acceptorCount;
  const rotatableBonds = mp.rotatableBondCount;

  let smiles = raw;
  try {
    smiles = mol.toIsomericSmiles();
  } catch {
    /* keep the resolved SMILES */
  }

  // Rule thresholds compare the UNrounded values so a true tPSA of 140.03 or
  // cLogP of 5.004 isn't rounded down to a pass.
  // Lipinski Rule of Five — poor oral absorption is likely when ≥ 2 fail.
  const lipViolations: string[] = [];
  if (mf.relativeWeight > 500) lipViolations.push("MW > 500");
  if (mp.logP > 5) lipViolations.push("cLogP > 5");
  if (hbd > 5) lipViolations.push("H-bond donors > 5");
  if (hba > 10) lipViolations.push("H-bond acceptors > 10");
  const lipinski: RuleResult = { pass: lipViolations.length <= 1, violations: lipViolations };

  // Veber — both must hold for good oral bioavailability.
  const veberViolations: string[] = [];
  if (rotatableBonds > 10) veberViolations.push("rotatable bonds > 10");
  if (mp.polarSurfaceArea > 140) veberViolations.push("tPSA > 140 Å²");
  const veber: RuleResult = { pass: veberViolations.length === 0, violations: veberViolations };

  const result: PhysChemProperties = {
    smiles, formula: mf.formula, mw, heavyAtoms, logP, logS, tpsa, hbd, hba,
    rotatableBonds, druglikenessApplicable, lipinski, veber, caveats: [],
  };
  result.caveats = propertyCaveats(mol, result, hasCarbon);
  return result;
}
