/**
 * Body measurements, renal function estimates and dose arithmetic for research and pharmacology (v2.206.0). Pure
 * functions in SI-adjacent clinical units (kg, cm, mg/dL, mL/min); the Engineering glue is dosingCalcs.ts. These are
 * the published formulas, each with its source; none is a bedside decision tool.
 *
 * Sources:
 *  - BMI: Quetelet; kg/m². WHO (2000) adult ranges, Technical Report Series 894.
 *  - BSA: Mosteller (1987) N Engl J Med 317:1098, √(H·W/3600); Du Bois & Du Bois (1916) Arch Intern Med 17:863,
 *    0.007184·W^0.425·H^0.725; Haycock et al. (1978) J Pediatr 93:62, 0.024265·W^0.5378·H^0.3964; Gehan & George
 *    (1970) Cancer Chemother Rep 54:225, 0.0235·W^0.51456·H^0.42246 (W in kg, H in cm, BSA in m²).
 *  - Ideal body weight: Devine (1974) Drug Intell Clin Pharm 8:650, 50 kg (men) or 45.5 kg (women) + 2.3 kg per inch
 *    over 5 feet.
 *  - Adjusted body weight: IBW + 0.4·(TBW − IBW) (the factor 0.4 of the aminoglycoside literature, e.g. Bauer,
 *    Applied Clinical Pharmacokinetics).
 *  - Lean body weight: Janmahasatian et al. (2005) Clin Pharmacokinet 44:1051, 9270·W/(6680 + 216·BMI) for men and
 *    9270·W/(8780 + 244·BMI) for women.
 *  - Creatinine clearance: Cockcroft & Gault (1976) Nephron 16:31, (140 − age)·W/(72·SCr) mL/min, × 0.85 for women.
 *  - eGFR: CKD-EPI 2021 race-free equations, Inker et al. (2021) N Engl J Med 385:1737. Creatinine:
 *    142·min(SCr/κ, 1)^α·max(SCr/κ, 1)^−1.200·0.9938^age·(1.012 if female), κ 0.7 (F) / 0.9 (M), α −0.241 (F) / −0.302 (M).
 *    Creatinine–cystatin C: 135·min(SCr/κ, 1)^α·max(SCr/κ, 1)^−0.544·min(SCys/0.8, 1)^−0.323·max(SCys/0.8, 1)^−0.778·
 *    0.9961^age·(0.963 if female), α −0.219 (F) / −0.144 (M). mL/min/1.73 m².
 *  - SI conversion factors: Young (1987) Ann Intern Med 106:114 and the AMA Manual of Style SI table, from the molar
 *    masses (creatinine 113.12 g/mol, glucose 180.16, cholesterol 386.65, triolein 885.4 for triglycerides, urea
 *    nitrogen 28.014 g per mol of urea).
 */

export type Sex = "male" | "female";

export const CM_PER_IN = 2.54;
export const KG_PER_LB = 0.45359237;

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

export function whoBmiClass(b: number): string {
  if (b < 18.5) return "underweight (below 18.5)";
  if (b < 25) return "normal range (18.5 to 24.9)";
  if (b < 30) return "pre-obese (25.0 to 29.9)";
  if (b < 35) return "obese class I (30.0 to 34.9)";
  if (b < 40) return "obese class II (35.0 to 39.9)";
  return "obese class III (40 or more)";
}

export interface Bsa {
  mosteller: number;
  duBois: number;
  haycock: number;
  gehanGeorge: number;
}

export function bsaAll(weightKg: number, heightCm: number): Bsa {
  return {
    mosteller: Math.sqrt((heightCm * weightKg) / 3600),
    duBois: 0.007184 * Math.pow(weightKg, 0.425) * Math.pow(heightCm, 0.725),
    haycock: 0.024265 * Math.pow(weightKg, 0.5378) * Math.pow(heightCm, 0.3964),
    gehanGeorge: 0.0235 * Math.pow(weightKg, 0.51456) * Math.pow(heightCm, 0.42246),
  };
}

/** Devine ideal body weight (kg). Below 5 feet the formula is extrapolated and gives less than the base weight. */
export function ibwDevine(heightCm: number, sex: Sex): number {
  return (sex === "male" ? 50 : 45.5) + 2.3 * (heightCm / CM_PER_IN - 60);
}

export function adjustedBw(tbw: number, ibw: number, factor = 0.4): number {
  return ibw + factor * (tbw - ibw);
}

export function lbwJanmahasatian(weightKg: number, heightCm: number, sex: Sex): number {
  const b = bmi(weightKg, heightCm);
  return sex === "male" ? (9270 * weightKg) / (6680 + 216 * b) : (9270 * weightKg) / (8780 + 244 * b);
}

/** Cockcroft–Gault creatinine clearance (mL/min), creatinine in mg/dL. */
export function cockcroftGault(age: number, weightKg: number, scrMgDl: number, sex: Sex): number {
  return (((140 - age) * weightKg) / (72 * scrMgDl)) * (sex === "female" ? 0.85 : 1);
}

/** CKD-EPI 2021 creatinine eGFR (mL/min/1.73 m²). */
export function ckdEpiCr2021(scrMgDl: number, age: number, sex: Sex): number {
  const k = sex === "female" ? 0.7 : 0.9;
  const a = sex === "female" ? -0.241 : -0.302;
  const r = scrMgDl / k;
  return 142 * Math.pow(Math.min(r, 1), a) * Math.pow(Math.max(r, 1), -1.2) * Math.pow(0.9938, age) * (sex === "female" ? 1.012 : 1);
}

/** CKD-EPI 2021 creatinine–cystatin C eGFR (mL/min/1.73 m²), cystatin C in mg/L. */
export function ckdEpiCrCys2021(scrMgDl: number, cysMgL: number, age: number, sex: Sex): number {
  const k = sex === "female" ? 0.7 : 0.9;
  const a = sex === "female" ? -0.219 : -0.144;
  const r = scrMgDl / k;
  const c = cysMgL / 0.8;
  return (
    135 *
    Math.pow(Math.min(r, 1), a) *
    Math.pow(Math.max(r, 1), -0.544) *
    Math.pow(Math.min(c, 1), -0.323) *
    Math.pow(Math.max(c, 1), -0.778) *
    Math.pow(0.9961, age) *
    (sex === "female" ? 0.963 : 1)
  );
}

/** KDIGO (2012) GFR categories, by eGFR in mL/min/1.73 m² (a description of the number, not a diagnosis). */
export function kdigoCategory(egfr: number): string {
  if (egfr >= 90) return "G1 (90 or more)";
  if (egfr >= 60) return "G2 (60 to 89)";
  if (egfr >= 45) return "G3a (45 to 59)";
  if (egfr >= 30) return "G3b (30 to 44)";
  if (egfr >= 15) return "G4 (15 to 29)";
  return "G5 (below 15)";
}

export interface Analyte {
  id: string;
  name: string;
  conventional: string;
  si: string;
  /** SI value = conventional × factor. */
  factor: string;
  factorValue: number;
  basis: string;
  /** Plausible range in conventional units (wider than any reference interval: values outside are likely unit mix-ups). */
  plausible: [number, number];
  /** A typical adult reference interval in conventional units, for the figure only. */
  reference: [number, number];
}

export const ANALYTES: Analyte[] = [
  { id: "creatinine", name: "Creatinine", conventional: "mg/dL", si: "µmol/L", factor: "88.42", factorValue: 88.42, basis: "10 dL/L ÷ 113.12 g/mol × 1000 mg/g", plausible: [0.1, 25], reference: [0.6, 1.2] },
  { id: "glucose", name: "Glucose", conventional: "mg/dL", si: "mmol/L", factor: "0.05551", factorValue: 0.05551, basis: "10 dL/L ÷ 180.16 g/mol", plausible: [10, 2000], reference: [70, 99] },
  { id: "cholesterol", name: "Cholesterol (total, LDL or HDL)", conventional: "mg/dL", si: "mmol/L", factor: "0.02586", factorValue: 0.02586, basis: "10 dL/L ÷ 386.65 g/mol", plausible: [10, 1500], reference: [125, 200] },
  { id: "triglycerides", name: "Triglycerides", conventional: "mg/dL", si: "mmol/L", factor: "0.01129", factorValue: 0.01129, basis: "10 dL/L ÷ 885.4 g/mol (as triolein)", plausible: [10, 10000], reference: [50, 150] },
  { id: "urea", name: "Urea nitrogen (BUN) to urea", conventional: "mg/dL BUN", si: "mmol/L urea", factor: "0.357", factorValue: 0.357, basis: "10 dL/L ÷ 28.014 g of nitrogen per mol of urea", plausible: [1, 300], reference: [7, 20] },
];
