// Physicochemical property & druglikeness prediction for a compound, from a
// name, molecular formula, or SMILES. Extends the Chemical mode's existing
// molecular-weight/charge readout with the numbers a medicinal-chemistry or
// life-science audience expects (cLogP, logS, tPSA, H-bond donors/acceptors,
// rotatable bonds) plus the Lipinski Rule-of-Five and Veber oral-bioavailability
// screens — capabilities ChemDraw gates behind a license tier.
//
// The underlying estimators are OpenChemLib's validated models (already bundled
// for structure rendering), so nothing new ships and no network call is made.
// Pure functions — no Office.js — fully unit-testable.

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
  /** Lipinski Rule of Five (oral druglikeness). */
  lipinski: RuleResult;
  /** Veber rule (oral bioavailability): rotatable bonds ≤ 10 and tPSA ≤ 140. */
  veber: RuleResult;
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

  return { smiles, formula: mf.formula, mw, heavyAtoms, logP, logS, tpsa, hbd, hba, rotatableBonds, lipinski, veber };
}
