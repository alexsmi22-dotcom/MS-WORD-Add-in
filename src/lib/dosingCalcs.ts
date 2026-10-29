// Pane glue for the v2.206.0 dosing and body-measurement calculators (research and pharmacology; no bedside decision
// scores): BMI and BSA, dosing weights, Cockcroft–Gault, CKD-EPI 2021 eGFR, weight- and BSA-based dose, infusion rate,
// and lab unit conversions. The integrator spreads DOSING_CALCS into ENG_CALCS (groups "Biomedical" and
// "Pharmacokinetics", which exist). Numbers come from dosing.ts; each result cites its formula's source paper.
//
// Unit contract "domain": every field is read in the unit its select names (kg or lb, cm or in, mg/dL or µmol/L);
// a unit typed after the number is refused with the select to use. Implausible values (creatinine typed in µmol/L
// into a mg/dL field, height in metres in a cm field) are refused by name with the likely intended value.

import type { EngCalcDef } from "./engCalc";
import { engReport, type EngReportLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { fmtSig } from "./axis";
import { trueMinus } from "./numberList";
import { refuseNonFinite } from "./finiteResult";
import { hBarSvg } from "./mechchart";
import { buildPlotSvg, type Series } from "./plot";
import {
  ANALYTES,
  CM_PER_IN,
  KG_PER_LB,
  adjustedBw,
  bmi,
  bsaAll,
  cockcroftGault,
  ckdEpiCr2021,
  ckdEpiCrCys2021,
  ibwDevine,
  kdigoCategory,
  lbwJanmahasatian,
  whoBmiClass,
  type Sex,
} from "./dosing";

type DoseGroup = "Biomedical" | "Pharmacokinetics";
type DoseCalc = EngCalcDef<DoseGroup>;

/** The short, factual note every result carries. */
export const DOSING_ASSUMES = "Assumes: for research and education; not a substitute for clinical judgement or institutional dosing protocols.";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")), ok: false });
/** Significant figures with trailing zeros dropped ("70", not "70.00"; "1.2", not "1.200"). */
const trimZeros = (t: string): string => (t.includes(".") ? t.replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "") : t);
const s3 = (v: number): string => trimZeros(fmtSig(v, 3));
const s4 = (v: number): string => trimZeros(fmtSig(v, 4));
const f1 = (v: number): string => trueMinus(v.toFixed(1));
const f2 = (v: number): string => trueMinus(v.toFixed(2));

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 440);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 300);
  return { kind: "plot", svg, caption, alt, w, h };
};

function finish(lines: EngReportLine[], extra: AnalyzeBlock[], outputs: EngOutput[], source: string): AnalyzeOutput {
  lines.push(`Source: ${source}.`);
  lines.push(DOSING_ASSUMES);
  return refuseNonFinite({ ...engReport(lines, extra), outputs });
}

/** A plain number in the field's own unit; a typed unit is refused, naming the select. */
function num(raw: string, label: string, unitHint: string): number | string {
  const t = (raw ?? "").trim().replace(/[−–]/g, "-");
  if (!t) return `${label}: enter a number.`;
  // No digit at all (a word, "NaN", "Infinity"): not echoed, since a refusal must not print a non-number as a value.
  if (!/\d/.test(t)) return `${label}: enter a number (letters and symbols on their own are not one).`;
  if (/^[-+]?(\d+\.?\d*|\.\d+)[eE][-+]?\d+$/.test(t)) {
    const e = Number(t);
    return Number.isFinite(e) && e !== 0 ? e : `${label}: that value is out of range.`;
  }
  if (/[A-Za-zµ%]/.test(t)) return `${label}: type the number only (“${t}” has a unit); choose the unit ${unitHint}.`;
  const v = Number(t.replace(/,(?=\d{3}(\D|$))/g, ""));
  if (!Number.isFinite(v)) return `${label}: “${t}” is not a number.`;
  return v;
}

const UNIT_KG = [
  { value: "kg", label: "kg" },
  { value: "lb", label: "lb" },
];
const UNIT_CM = [
  { value: "cm", label: "cm" },
  { value: "in", label: "in" },
];
const UNIT_SCR = [
  { value: "mgdl", label: "mg/dL" },
  { value: "umol", label: "µmol/L" },
];
const SEX = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];

/** Weight in kg from the value and its select, with a plausibility check (0.3 to 400 kg). */
function readWeight(r: (k: string) => string, key: string, unitKey: string): number | string {
  const v = num(r(key), "Weight", "in the unit list beside it");
  if (typeof v === "string") return v;
  const lb = r(unitKey) === "lb";
  const kg = lb ? v * KG_PER_LB : v;
  if (!(kg >= 0.3 && kg <= 400)) {
    return `Weight: ${s4(v)} ${lb ? "lb" : "kg"} is outside 0.3 to 400 kg${!lb && v > 400 && v <= 880 ? ` (if it is in pounds, choose lb: ${s4(v)} lb = ${s4(v * KG_PER_LB)} kg)` : ""}.`;
  }
  return kg;
}

/** Height in cm from the value and its select, refusing metres typed into cm and the like. */
function readHeight(r: (k: string) => string, key: string, unitKey: string): number | string {
  const v = num(r(key), "Height", "in the unit list beside it");
  if (typeof v === "string") return v;
  const inch = r(unitKey) === "in";
  const cm = inch ? v * CM_PER_IN : v;
  if (!inch && v > 0.3 && v < 2.6) return `Height: ${s4(v)} cm looks like metres; enter ${s4(v * 100)} (cm).`;
  if (!(cm >= 30 && cm <= 260)) {
    return `Height: ${s4(v)} ${inch ? "in" : "cm"} is outside 30 to 260 cm${inch && v > 100 && v <= 260 ? ` (if it is in centimetres, choose cm)` : ""}${!inch && v >= 12 && v < 30 ? ` (if it is in inches, choose in: ${s4(v)} in = ${s4(v * CM_PER_IN)} cm)` : ""}.`;
  }
  return cm;
}

/** Serum creatinine in mg/dL, refusing a value that only makes sense in the other unit. */
export function readCreatinine(r: (k: string) => string, key: string, unitKey: string): number | string {
  const v = num(r(key), "Serum creatinine", "mg/dL or µmol/L in the list beside it");
  if (typeof v === "string") return v;
  const umol = r(unitKey) === "umol";
  if (!(v > 0)) return "Serum creatinine: enter a positive value.";
  if (!umol && v > 25) {
    return `Serum creatinine: ${s4(v)} mg/dL is not plausible (above 25 mg/dL); it looks like a value in µmol/L (${s4(v)} µmol/L = ${s3(v / 88.42)} mg/dL). Choose µmol/L.`;
  }
  if (umol && v < 10) {
    return `Serum creatinine: ${s4(v)} µmol/L is not plausible (below 10 µmol/L); it looks like a value in mg/dL (${s4(v)} mg/dL = ${s4(v * 88.42)} µmol/L). Choose mg/dL.`;
  }
  const mg = umol ? v / 88.42 : v;
  if (mg < 0.1) return `Serum creatinine: ${s3(mg)} mg/dL is below 0.1 mg/dL (8.8 µmol/L), outside any measured range.`;
  return mg;
}

function readAge(r: (k: string) => string): number | string {
  const v = num(r("age"), "Age", "in years");
  if (typeof v === "string") return v;
  if (v < 18) return `Age: ${s3(v)} years. These are adult equations (validated from 18 years); children need a paediatric equation such as bedside Schwartz, which is not included here.`;
  if (v > 120) return `Age: ${s3(v)} years is not plausible.`;
  return v;
}

function sexOf(r: (k: string) => string): Sex {
  return r("sex") === "male" ? "male" : "female";
}

// ---------------------------------------------------------------------------------------------------------------

const bsaCalc: DoseCalc = {
  id: "med-bsa",
  name: "BMI and body surface area (Mosteller, Du Bois, Haycock, Gehan–George)",
  group: "Biomedical",
  unitContract: "domain",
  hint:
    "Body-mass index and body surface area from weight and height by the four published formulas side by side, since " +
    "protocols name one and they differ by a few percent. BSA is in m², BMI in kg/m².",
  fields: [
    { key: "w", label: "Weight", default: "70", kind: "text" },
    { key: "wu", label: "Weight unit", default: "kg", kind: "select", options: UNIT_KG },
    { key: "h", label: "Height", default: "175", kind: "text" },
    { key: "hu", label: "Height unit", default: "cm", kind: "select", options: UNIT_CM },
  ],
  compute: (r) => {
    const w = readWeight(r, "w", "wu");
    if (typeof w === "string") return refuse(w);
    const h = readHeight(r, "h", "hu");
    if (typeof h === "string") return refuse(h);
    const b = bmi(w, h);
    const s = bsaAll(w, h);
    const vals = [s.mosteller, s.duBois, s.haycock, s.gehanGeorge];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const lines: EngReportLine[] = [
      `BMI ${f1(b)} kg/m², WHO adult category ${whoBmiClass(b)}; body surface area ${f2(s.mosteller)} m² by Mosteller, with the four formulas spanning ${f2(lo)} to ${f2(hi)} m².`,
      `Weight ${s4(w)} kg, height ${s4(h)} cm.`,
      { math: "BMI = W/H^2", fallback: "BMI = W/H² (W in kg, H in m)" },
      { math: "BSA_Mosteller = sqrt((H W)/3600)", fallback: "BSA(Mosteller) = √(H·W/3600) (H in cm, W in kg)" },
      { math: "BSA_DuBois = 0.007184 W^0.425 H^0.725", fallback: "BSA(Du Bois) = 0.007184·W^0.425·H^0.725" },
      { math: "BSA_Haycock = 0.024265 W^0.5378 H^0.3964", fallback: "BSA(Haycock) = 0.024265·W^0.5378·H^0.3964" },
      { math: "BSA_GehanGeorge = 0.0235 W^0.51456 H^0.42246", fallback: "BSA(Gehan–George) = 0.0235·W^0.51456·H^0.42246" },
      {
        table: [
          ["Formula", "BSA (m²)", "Source"],
          ["Mosteller", f2(s.mosteller), "N Engl J Med 1987;317:1098"],
          ["Du Bois", f2(s.duBois), "Arch Intern Med 1916;17:863"],
          ["Haycock", f2(s.haycock), "J Pediatr 1978;93:62"],
          ["Gehan–George", f2(s.gehanGeorge), "Cancer Chemother Rep 1970;54:225"],
        ],
        label: "Body surface area",
      },
      "BMI is a population descriptor; it does not distinguish fat from lean mass.",
    ];
    const svg = hBarSvg(
      [
        { name: "Mosteller", value: s.mosteller, text: `${f2(s.mosteller)} m²` },
        { name: "Du Bois", value: s.duBois, text: `${f2(s.duBois)} m²` },
        { name: "Haycock", value: s.haycock, text: `${f2(s.haycock)} m²` },
        { name: "Gehan–George", value: s.gehanGeorge, text: `${f2(s.gehanGeorge)} m²` },
      ],
      { title: "Body surface area by formula", unit: "m²" },
    );
    return finish(lines, [plot(svg, "Body surface area by the four formulas", "Horizontal bars of body surface area by the Mosteller, Du Bois, Haycock and Gehan–George formulas")], [
      { key: "bmi", label: "BMI", value: b, unit: "kg/m²" },
      { key: "bsa", label: "BSA (Mosteller)", value: s.mosteller, unit: "m²" },
      { key: "bsaDuBois", label: "BSA (Du Bois)", value: s.duBois, unit: "m²" },
    ], "Mosteller 1987; Du Bois & Du Bois 1916; Haycock et al. 1978; Gehan & George 1970; WHO Technical Report Series 894 (2000) for the BMI bands");
  },
};

const weightsCalc: DoseCalc = {
  id: "med-weights",
  name: "Ideal, adjusted and lean body weight",
  group: "Pharmacokinetics",
  unitContract: "domain",
  hint:
    "The dosing weights pharmacokinetic papers use: ideal body weight (Devine), adjusted body weight (IBW + 0.4 of the " +
    "excess) and lean body weight (Janmahasatian 2005), against the total body weight.",
  fields: [
    { key: "w", label: "Total body weight", default: "110", kind: "text" },
    { key: "wu", label: "Weight unit", default: "kg", kind: "select", options: UNIT_KG },
    { key: "h", label: "Height", default: "170", kind: "text" },
    { key: "hu", label: "Height unit", default: "cm", kind: "select", options: UNIT_CM },
    { key: "sex", label: "Sex (the formulas differ)", default: "male", kind: "select", options: SEX },
  ],
  compute: (r) => {
    const w = readWeight(r, "w", "wu");
    if (typeof w === "string") return refuse(w);
    const h = readHeight(r, "h", "hu");
    if (typeof h === "string") return refuse(h);
    const sex = sexOf(r);
    const ibw = ibwDevine(h, sex);
    if (!(ibw > 0)) return refuse(`Height: at ${s4(h)} cm the Devine formula gives no positive ideal body weight (it is for adults over about 4 ft 3 in).`);
    const adj = adjustedBw(w, ibw);
    const lbw = lbwJanmahasatian(w, h, sex);
    const pctIbw = (100 * w) / ibw;
    const lines: EngReportLine[] = [
      `Ideal body weight ${f1(ibw)} kg, adjusted ${f1(adj)} kg and lean ${f1(lbw)} kg, against a total body weight of ${f1(w)} kg (${f1(pctIbw)}% of ideal).`,
      `${sex === "male" ? "Male" : "Female"}, height ${s4(h)} cm (${s4(h / CM_PER_IN)} in).`,
      { math: "IBW = " + (sex === "male" ? "50" : "45.5") + " + 2.3 (H_in - 60)", fallback: `IBW = ${sex === "male" ? "50" : "45.5"} + 2.3·(height in inches − 60) kg (Devine)` },
      { math: "AdjBW = IBW + 0.4 (TBW - IBW)", fallback: "AdjBW = IBW + 0.4·(TBW − IBW)" },
      {
        math: sex === "male" ? "LBW = (9270 W)/(6680 + 216 BMI)" : "LBW = (9270 W)/(8780 + 244 BMI)",
        fallback: sex === "male" ? "LBW = 9270·W/(6680 + 216·BMI) (Janmahasatian)" : "LBW = 9270·W/(8780 + 244·BMI) (Janmahasatian)",
      },
      {
        table: [
          ["Weight", "kg", "Source"],
          ["Total body weight", f1(w), "as entered"],
          ["Ideal (Devine)", f1(ibw), "Drug Intell Clin Pharm 1974;8:650"],
          ["Adjusted (factor 0.4)", f1(adj), "aminoglycoside dosing literature"],
          ["Lean (Janmahasatian)", f1(lbw), "Clin Pharmacokinet 2005;44:1051"],
        ],
        label: "Dosing weights",
      },
    ];
    if (h < 152.4) lines.push("Below 5 ft (152.4 cm) the Devine formula is extrapolated below its base weight.");
    if (w < ibw) lines.push("The total body weight is below the ideal body weight, so the adjusted weight is below the ideal too; papers usually dose on the total weight then.");
    const svg = hBarSvg(
      [
        { name: "Total", value: w, text: `${f1(w)} kg` },
        { name: "Ideal (Devine)", value: ibw, text: `${f1(ibw)} kg` },
        { name: "Adjusted (0.4)", value: adj, text: `${f1(adj)} kg` },
        { name: "Lean (Janmahasatian)", value: lbw, text: `${f1(lbw)} kg` },
      ],
      { title: "Dosing weights", unit: "kg" },
    );
    return finish(lines, [plot(svg, "Total, ideal, adjusted and lean body weight", "Horizontal bars of the four dosing weights in kilograms")], [
      { key: "ibw", label: "Ideal body weight", value: ibw, unit: "kg" },
      { key: "adjbw", label: "Adjusted body weight", value: adj, unit: "kg" },
      { key: "lbw", label: "Lean body weight", value: lbw, unit: "kg" },
    ], "Devine 1974; Janmahasatian et al. 2005");
  },
};

const crclCalc: DoseCalc = {
  id: "med-crcl",
  name: "Creatinine clearance (Cockcroft–Gault)",
  group: "Pharmacokinetics",
  unitContract: "domain",
  hint:
    "Cockcroft–Gault creatinine clearance in mL/min (not indexed to body surface area), the estimate most drug labels " +
    "were written against. The weight in the formula changes the answer most; the result is shown on all three and " +
    "names the one you chose.",
  fields: [
    { key: "age", label: "Age (years)", default: "65", kind: "text" },
    { key: "sex", label: "Sex", default: "female", kind: "select", options: SEX },
    { key: "w", label: "Total body weight", default: "80", kind: "text" },
    { key: "wu", label: "Weight unit", default: "kg", kind: "select", options: UNIT_KG },
    { key: "h", label: "Height (for ideal and adjusted weight)", default: "165", kind: "text" },
    { key: "hu", label: "Height unit", default: "cm", kind: "select", options: UNIT_CM },
    { key: "scr", label: "Serum creatinine", default: "1.1", kind: "text" },
    { key: "su", label: "Creatinine unit", default: "mgdl", kind: "select", options: UNIT_SCR },
    {
      key: "basis",
      label: "Weight used in the formula",
      default: "total",
      kind: "select",
      options: [
        { value: "total", label: "Total body weight (as Cockcroft & Gault 1976)" },
        { value: "ideal", label: "Ideal body weight (Devine)" },
        { value: "adjusted", label: "Adjusted body weight (IBW + 0.4 excess)" },
      ],
    },
  ],
  compute: (r) => {
    const age = readAge(r);
    if (typeof age === "string") return refuse(age);
    const w = readWeight(r, "w", "wu");
    if (typeof w === "string") return refuse(w);
    const h = readHeight(r, "h", "hu");
    if (typeof h === "string") return refuse(h);
    const scr = readCreatinine(r, "scr", "su");
    if (typeof scr === "string") return refuse(scr);
    const sex = sexOf(r);
    const ibw = ibwDevine(h, sex);
    if (!(ibw > 0)) return refuse(`Height: at ${s4(h)} cm the Devine formula gives no positive ideal body weight.`);
    const adj = adjustedBw(w, ibw);
    const basis = r("basis") === "ideal" ? "ideal" : r("basis") === "adjusted" ? "adjusted" : "total";
    const wt = basis === "ideal" ? ibw : basis === "adjusted" ? adj : w;
    const all = { total: cockcroftGault(age, w, scr, sex), ideal: cockcroftGault(age, ibw, scr, sex), adjusted: cockcroftGault(age, adj, scr, sex) };
    const crcl = all[basis];
    const basisName = { total: "total body weight", ideal: "ideal body weight", adjusted: "adjusted body weight" }[basis];
    const lines: EngReportLine[] = [
      `Creatinine clearance ${f1(crcl)} mL/min by Cockcroft–Gault on the ${basisName} of ${f1(wt)} kg; on the other weights it is ${basis === "total" ? `${f1(all.ideal)} (ideal) and ${f1(all.adjusted)} (adjusted)` : basis === "ideal" ? `${f1(all.total)} (total) and ${f1(all.adjusted)} (adjusted)` : `${f1(all.total)} (total) and ${f1(all.ideal)} (ideal)`} mL/min.`,
      `Age ${s3(age)} years, ${sex}, serum creatinine ${s3(scr)} mg/dL (${s4(scr * 88.42)} µmol/L).`,
      { math: "CrCl = ((140 - age) W)/(72 S_Cr)" + (sex === "female" ? " × 0.85" : ""), fallback: `CrCl = (140 − age)·W/(72·SCr) mL/min${sex === "female" ? " × 0.85 for women" : ""} (W in kg, SCr in mg/dL)` },
      {
        table: [
          ["Weight basis", "Weight (kg)", "CrCl (mL/min)"],
          ["Total body weight", f1(w), f1(all.total)],
          ["Ideal (Devine)", f1(ibw), f1(all.ideal)],
          ["Adjusted (0.4)", f1(adj), f1(all.adjusted)],
        ],
        label: "Cockcroft–Gault by weight basis",
      },
      "The formula predates standardised (IDMS-traceable) creatinine assays, which read lower than the 1976 method; it is not indexed to 1.73 m².",
    ];
    if (scr < 0.6) lines.push("A creatinine below about 0.6 mg/dL (low muscle mass) makes Cockcroft–Gault overestimate clearance; some protocols round it up, which is a protocol choice, not part of the formula.");
    if (scr > 10) lines.push("A creatinine above 10 mg/dL is far outside the steady state the formula assumes.");
    const svg = hBarSvg(
      (["total", "ideal", "adjusted"] as const).map((k) => ({
        name: `${k === "total" ? "Total" : k === "ideal" ? "Ideal" : "Adjusted"} weight${k === basis ? " (chosen)" : ""}`,
        value: all[k],
        text: `${f1(all[k])} mL/min`,
        colour: k === basis ? "#1d4ed8" : "#94a3b8",
      })),
      { title: "Cockcroft–Gault clearance by weight basis", unit: "mL/min" },
    );
    return finish(lines, [plot(svg, "Creatinine clearance on total, ideal and adjusted weight", "Horizontal bars of Cockcroft–Gault creatinine clearance in mL/min for three weight bases, the chosen one highlighted")], [
      { key: "crcl", label: "Creatinine clearance", value: crcl, unit: "mL/min" },
      { key: "weightUsed", label: "Weight used", value: wt, unit: "kg" },
    ], "Cockcroft & Gault 1976, Nephron 16:31; Devine 1974 for the ideal weight");
  },
};

const egfrCalc: DoseCalc = {
  id: "med-egfr",
  name: "eGFR (CKD-EPI 2021, creatinine and cystatin C)",
  group: "Pharmacokinetics",
  unitContract: "domain",
  hint:
    "The race-free CKD-EPI 2021 equations (Inker et al., NEJM 2021): creatinine alone, and creatinine with cystatin C " +
    "when given. Indexed to 1.73 m²; with weight and height it also gives the non-indexed mL/min that drug dosing " +
    "papers sometimes use.",
  fields: [
    { key: "age", label: "Age (years)", default: "60", kind: "text" },
    { key: "sex", label: "Sex", default: "female", kind: "select", options: SEX },
    { key: "scr", label: "Serum creatinine", default: "1.0", kind: "text" },
    { key: "su", label: "Creatinine unit", default: "mgdl", kind: "select", options: UNIT_SCR },
    { key: "cys", label: "Serum cystatin C, mg/L (blank = creatinine equation only)", default: "1.1", kind: "text" },
    { key: "w", label: "Weight, for non-indexed GFR (blank = skip)", default: "", kind: "text" },
    { key: "wu", label: "Weight unit", default: "kg", kind: "select", options: UNIT_KG },
    { key: "h", label: "Height, for non-indexed GFR (blank = skip)", default: "", kind: "text" },
    { key: "hu", label: "Height unit", default: "cm", kind: "select", options: UNIT_CM },
  ],
  compute: (r) => {
    const age = readAge(r);
    if (typeof age === "string") return refuse(age);
    const scr = readCreatinine(r, "scr", "su");
    if (typeof scr === "string") return refuse(scr);
    const sex = sexOf(r);
    let cys: number | null = null;
    if ((r("cys") ?? "").trim()) {
      const c = num(r("cys"), "Cystatin C", "in mg/L");
      if (typeof c === "string") return refuse(c);
      if (!(c >= 0.2 && c <= 10)) return refuse(`Cystatin C: ${s3(c)} mg/L is outside 0.2 to 10 mg/L${c > 10 && c < 1000 ? " (a value in nmol/L? 1 mg/L = 74.9 nmol/L)" : ""}.`);
      cys = c;
    }
    const eCr = ckdEpiCr2021(scr, age, sex);
    const eCys = cys !== null ? ckdEpiCrCys2021(scr, cys, age, sex) : null;
    const head = eCys ?? eCr;
    const lines: EngReportLine[] = [
      eCys !== null
        ? `eGFR ${Math.round(eCys)} mL/min/1.73 m² by CKD-EPI 2021 creatinine–cystatin C (${Math.round(eCr)} by creatinine alone), in the KDIGO ${kdigoCategory(eCys)} range.`
        : `eGFR ${Math.round(eCr)} mL/min/1.73 m² by the CKD-EPI 2021 creatinine equation, in the KDIGO ${kdigoCategory(eCr)} range.`,
      `Age ${s3(age)} years, ${sex}, serum creatinine ${s3(scr)} mg/dL (${s4(scr * 88.42)} µmol/L)${cys !== null ? `, cystatin C ${s3(cys)} mg/L` : ""}.`,
      {
        math: `eGFR_cr = 142 min(S_Cr/${sex === "female" ? "0.7" : "0.9"}, 1)^(${sex === "female" ? "-0.241" : "-0.302"}) max(S_Cr/${sex === "female" ? "0.7" : "0.9"}, 1)^(-1.200) 0.9938^age${sex === "female" ? " × 1.012" : ""}`,
        fallback: `eGFRcr = 142·min(SCr/κ, 1)^α·max(SCr/κ, 1)^−1.200·0.9938^age${sex === "female" ? "·1.012" : ""}, κ = ${sex === "female" ? "0.7" : "0.9"}, α = ${sex === "female" ? "−0.241" : "−0.302"}`,
      },
    ];
    if (eCys !== null) {
      lines.push({
        math: `eGFR_cr-cys = 135 min(S_Cr/κ, 1)^(${sex === "female" ? "-0.219" : "-0.144"}) max(S_Cr/κ, 1)^(-0.544) min(S_Cys/0.8, 1)^(-0.323) max(S_Cys/0.8, 1)^(-0.778) 0.9961^age${sex === "female" ? " × 0.963" : ""}`,
        fallback: `eGFRcr-cys = 135·min(SCr/κ, 1)^α·max(SCr/κ, 1)^−0.544·min(SCys/0.8, 1)^−0.323·max(SCys/0.8, 1)^−0.778·0.9961^age${sex === "female" ? "·0.963" : ""}, α = ${sex === "female" ? "−0.219" : "−0.144"}`,
      });
    }
    const rows: string[][] = [["Equation", "eGFR (mL/min/1.73 m²)"], ["CKD-EPI 2021 creatinine", f1(eCr)]];
    if (eCys !== null) rows.push(["CKD-EPI 2021 creatinine–cystatin C", f1(eCys)]);
    const outputs: EngOutput[] = [{ key: "egfrCr", label: "eGFR (creatinine)", value: eCr, unit: "mL/min/1.73 m²" }];
    if (eCys !== null) outputs.push({ key: "egfrCrCys", label: "eGFR (creatinine–cystatin C)", value: eCys, unit: "mL/min/1.73 m²" });
    const wRaw = (r("w") ?? "").trim();
    const hRaw = (r("h") ?? "").trim();
    if (wRaw && hRaw) {
      const w = readWeight(r, "w", "wu");
      if (typeof w === "string") return refuse(w);
      const h = readHeight(r, "h", "hu");
      if (typeof h === "string") return refuse(h);
      const bsa = bsaAll(w, h).duBois;
      const abs = (head * bsa) / 1.73;
      rows.push([`Non-indexed (× BSA ${f2(bsa)} m²/1.73)`, `${f1(abs)} mL/min`]);
      lines.push(`Non-indexed GFR ${f1(abs)} mL/min (eGFR × BSA/1.73, BSA ${f2(bsa)} m² by Du Bois, as the CKD-EPI cohorts were indexed).`);
      outputs.push({ key: "gfrAbs", label: "Non-indexed GFR", value: abs, unit: "mL/min" });
    } else if (wRaw || hRaw) return refuse("Non-indexed GFR needs both weight and height (or leave both blank).");
    lines.push({ table: rows, label: "CKD-EPI 2021" });
    lines.push("The equations were developed in adults with stable creatinine; they do not apply in acute kidney injury, pregnancy or extremes of muscle mass. Creatinine must be IDMS-traceable.");
    // The figure: eGFR against creatinine for this age and sex, the patient's point marked.
    const xs = Array.from({ length: 120 }, (_, i) => 0.3 + (i * (Math.max(6, scr * 1.3) - 0.3)) / 119);
    const series: Series[] = [
      { type: "line", points: xs.map((x) => ({ x, y: ckdEpiCr2021(x, age, sex) })), color: "#1d4ed8", label: `Creatinine equation, ${s3(age)} y ${sex}` },
      { type: "scatter", points: [{ x: scr, y: eCr }], color: "#b91c1c", label: `This value: ${Math.round(eCr)}` },
    ];
    if (eCys !== null) series.push({ type: "scatter", points: [{ x: scr, y: eCys }], color: "#047857", label: `With cystatin C: ${Math.round(eCys)}` });
    const svg = buildPlotSvg(series, {
      width: 440,
      height: 300,
      title: "CKD-EPI 2021 eGFR against serum creatinine",
      xlabel: "Serum creatinine (mg/dL)",
      ylabel: "eGFR (mL/min/1.73 m²)",
      yLimits: { min: 0, max: Math.max(150, head * 1.1) },
    });
    return finish(lines, [plot(svg, "eGFR against creatinine for this age and sex", "The CKD-EPI 2021 creatinine curve of eGFR against serum creatinine with this patient's value marked")], outputs, "Inker et al. 2021, N Engl J Med 385:1737 (CKD-EPI 2021); KDIGO 2012 GFR categories");
  },
};

const doseCalc: DoseCalc = {
  id: "med-dose",
  name: "Weight- or BSA-based dose",
  group: "Pharmacokinetics",
  unitContract: "domain",
  hint:
    "A dose from a per-kilogram or per-square-metre amount, with an optional cap and the volume to draw from a stock " +
    "concentration. BSA by Mosteller.",
  fields: [
    {
      key: "basis",
      label: "Dose basis",
      default: "weight",
      kind: "select",
      options: [
        { value: "weight", label: "Per kilogram (mg/kg)" },
        { value: "bsa", label: "Per square metre of BSA (mg/m²)" },
      ],
    },
    { key: "per", label: "Dose per kg or per m² (mg)", default: "15", kind: "text" },
    { key: "w", label: "Weight", default: "70", kind: "text" },
    { key: "wu", label: "Weight unit", default: "kg", kind: "select", options: UNIT_KG },
    { key: "h", label: "Height (BSA basis)", default: "175", kind: "text" },
    { key: "hu", label: "Height unit", default: "cm", kind: "select", options: UNIT_CM },
    { key: "cap", label: "Maximum single dose, mg (blank = none)", default: "", kind: "text" },
    { key: "conc", label: "Stock concentration, mg/mL (blank = no volume)", default: "50", kind: "text" },
  ],
  compute: (r) => {
    const per = num(r("per"), "Dose per kg or m²", "in mg");
    if (typeof per === "string") return refuse(per);
    if (!(per > 0)) return refuse("Dose per kg or m²: enter a positive amount.");
    const w = readWeight(r, "w", "wu");
    if (typeof w === "string") return refuse(w);
    const bsaBasis = r("basis") === "bsa";
    let size = w;
    let sizeText = `${s4(w)} kg`;
    if (bsaBasis) {
      const h = readHeight(r, "h", "hu");
      if (typeof h === "string") return refuse(h);
      size = bsaAll(w, h).mosteller;
      sizeText = `BSA ${f2(size)} m² (Mosteller, ${s4(w)} kg, ${s4(h)} cm)`;
    }
    const raw = per * size;
    let dose = raw;
    let capped = false;
    let capVal: number | null = null;
    if ((r("cap") ?? "").trim()) {
      const cap = num(r("cap"), "Maximum dose", "in mg");
      if (typeof cap === "string") return refuse(cap);
      if (!(cap > 0)) return refuse("Maximum dose: enter a positive amount, or leave it blank.");
      capVal = cap;
      if (raw > cap) {
        dose = cap;
        capped = true;
      }
    }
    const unitPer = bsaBasis ? "mg/m²" : "mg/kg";
    const lines: EngReportLine[] = [];
    let vol: number | null = null;
    if ((r("conc") ?? "").trim()) {
      const c = num(r("conc"), "Stock concentration", "in mg/mL");
      if (typeof c === "string") return refuse(c);
      if (!(c > 0)) return refuse("Stock concentration: enter a positive value, or leave it blank.");
      vol = dose / c;
    }
    lines.push(`Dose ${s4(dose)} mg${capped ? ` (capped: ${s4(per)} ${unitPer} would give ${s4(raw)} mg)` : ` (${s4(per)} ${unitPer} × ${bsaBasis ? `${f2(size)} m²` : `${s4(w)} kg`})`}${vol !== null ? `, which is ${s3(vol)} mL of the stock` : ""}.`);
    lines.push(`Body size: ${sizeText}.`);
    lines.push({ math: bsaBasis ? "D = d_BSA × BSA" : "D = d_W × W", fallback: bsaBasis ? "D = dose per m² × BSA" : "D = dose per kg × weight" });
    if (vol !== null) lines.push({ math: "V = D/C", fallback: "V = D/C (volume = dose ÷ concentration)" });
    lines.push({
      table: [
        ["Quantity", "Value", "Unit"],
        [`Dose per ${bsaBasis ? "m²" : "kg"}`, s4(per), unitPer],
        [bsaBasis ? "BSA" : "Weight", bsaBasis ? f2(size) : s4(w), bsaBasis ? "m²" : "kg"],
        ["Calculated dose", s4(raw), "mg"],
        ...(capped ? [["Dose after the cap", s4(dose), "mg"]] : []),
        ...(vol !== null ? [["Volume of stock", s3(vol), "mL"]] : []),
      ],
      label: "Dose",
    });
    // Dose against body size, the cap drawn when there is one.
    const xMax = Math.max(size * 1.6, bsaBasis ? 2.5 : 120);
    const xs = Array.from({ length: 50 }, (_, i) => (xMax * (i + 1)) / 50);
    const capV = capVal ?? NaN;
    const series: Series[] = [
      { type: "line", points: xs.map((x) => ({ x, y: Number.isFinite(capV) ? Math.min(per * x, capV) : per * x })), color: "#1d4ed8", label: Number.isFinite(capV) ? `${s4(per)} ${unitPer}, capped at ${s4(capV)} mg` : `${s4(per)} ${unitPer}` },
      { type: "scatter", points: [{ x: size, y: dose }], color: "#b91c1c", label: `This patient: ${s4(dose)} mg` },
    ];
    const svg = buildPlotSvg(series, { width: 440, height: 300, title: "Dose against body size", xlabel: bsaBasis ? "Body surface area (m²)" : "Weight (kg)", ylabel: "Dose (mg)", xLimits: { min: 0, max: xMax }, yLimits: { min: 0 } });
    const outputs: EngOutput[] = [{ key: "dose", label: "Dose", value: dose, unit: "mg" }];
    if (vol !== null) outputs.push({ key: "volume", label: "Volume of stock", value: vol, unit: "mL" });
    return finish(lines, [plot(svg, "Dose against body size", "Dose in mg against body weight or surface area, this patient's dose marked")], outputs, bsaBasis ? "Mosteller 1987, N Engl J Med 317:1098 (BSA)" : "dose = amount per kg × weight (arithmetic)");
  },
};

const DOSE_RATE_UNITS = [
  { value: "ugkgmin", label: "µg/kg/min" },
  { value: "mgkgmin", label: "mg/kg/min" },
  { value: "mgkgh", label: "mg/kg/h" },
  { value: "mgh", label: "mg/h (not weight-based)" },
];

/** mg/h for one unit of the dose-rate select, given the weight. */
function mgPerHourOf(unit: string, w: number): { f: number; name: string; weightBased: boolean } {
  if (unit === "mgkgmin") return { f: 60 * w, name: "mg/kg/min", weightBased: true };
  if (unit === "mgkgh") return { f: w, name: "mg/kg/h", weightBased: true };
  if (unit === "mgh") return { f: 1, name: "mg/h", weightBased: false };
  return { f: (60 * w) / 1000, name: "µg/kg/min", weightBased: true };
}

const infusionCalc: DoseCalc = {
  id: "med-infusion",
  name: "Infusion rate (dose rate ↔ mL/h)",
  group: "Pharmacokinetics",
  unitContract: "domain",
  hint:
    "Converts a dose rate (µg/kg/min, mg/kg/min, mg/kg/h or mg/h) to a pump rate in mL/h from the bag's concentration, " +
    "or a pump rate back to the dose rate it delivers. Concentration = amount in the bag ÷ its volume.",
  fields: [
    {
      key: "dir",
      label: "Convert",
      default: "tomlh",
      kind: "select",
      options: [
        { value: "tomlh", label: "Dose rate → pump rate (mL/h)" },
        { value: "torate", label: "Pump rate (mL/h) → dose rate" },
      ],
    },
    { key: "rate", label: "Dose rate (dose rate → mL/h)", default: "5", kind: "text" },
    { key: "ru", label: "Dose-rate unit", default: "ugkgmin", kind: "select", options: DOSE_RATE_UNITS },
    { key: "mlh", label: "Pump rate, mL/h (mL/h → dose rate)", default: "10", kind: "text" },
    { key: "w", label: "Weight", default: "70", kind: "text" },
    { key: "wu", label: "Weight unit", default: "kg", kind: "select", options: UNIT_KG },
    { key: "amt", label: "Drug in the bag, mg", default: "400", kind: "text" },
    { key: "vol", label: "Bag volume, mL", default: "250", kind: "text" },
  ],
  compute: (r) => {
    const w = readWeight(r, "w", "wu");
    if (typeof w === "string") return refuse(w);
    const amt = num(r("amt"), "Drug in the bag", "in mg");
    if (typeof amt === "string") return refuse(amt);
    const vol = num(r("vol"), "Bag volume", "in mL");
    if (typeof vol === "string") return refuse(vol);
    if (!(amt > 0) || !(vol > 0)) return refuse("The drug amount and the bag volume must both be positive.");
    const conc = amt / vol;
    const u = mgPerHourOf(r("ru"), w);
    const toMlh = r("dir") !== "torate";
    let doseRate: number;
    let mlh: number;
    if (toMlh) {
      const v = num(r("rate"), "Dose rate", "in the unit list beside it");
      if (typeof v === "string") return refuse(v);
      if (!(v > 0)) return refuse("Dose rate: enter a positive value.");
      doseRate = v;
      mlh = (v * u.f) / conc;
    } else {
      const v = num(r("mlh"), "Pump rate", "in mL/h");
      if (typeof v === "string") return refuse(v);
      if (!(v > 0)) return refuse("Pump rate: enter a positive value.");
      mlh = v;
      doseRate = (v * conc) / u.f;
    }
    const mgh = mlh * conc;
    const lines: EngReportLine[] = [
      toMlh
        ? `Run the pump at ${s3(mlh)} mL/h to give ${s3(doseRate)} ${u.name}${u.weightBased ? ` to ${s4(w)} kg` : ""} from a ${s4(conc)} mg/mL bag (${s3(mgh)} mg/h).`
        : `A pump rate of ${s3(mlh)} mL/h from a ${s4(conc)} mg/mL bag delivers ${s3(doseRate)} ${u.name}${u.weightBased ? ` for ${s4(w)} kg` : ""} (${s3(mgh)} mg/h).`,
      `Concentration ${s4(amt)} mg in ${s4(vol)} mL = ${s4(conc)} mg/mL (${s4(conc * 1000)} µg/mL).`,
      { math: "Q = (R × W × k)/C", fallback: "pump rate (mL/h) = dose rate × weight × (unit factor to mg/h) ÷ concentration (mg/mL)" },
      {
        table: [
          ["Quantity", "Value", "Unit"],
          ["Dose rate", s3(doseRate), u.name],
          ["Drug delivered", s3(mgh), "mg/h"],
          ["Concentration", s4(conc), "mg/mL"],
          ["Pump rate", s3(mlh), "mL/h"],
          ["Bag lasts", s3(vol / mlh), "h"],
        ],
        label: "Infusion",
      },
    ];
    if (mlh > 999) lines.push("A pump rate above 999 mL/h is beyond most infusion pumps: the bag is probably too dilute for this dose rate.");
    if (mlh < 0.1) lines.push("A pump rate below 0.1 mL/h is below most pumps' resolution: a more dilute bag would deliver it more accurately.");
    // Pump rate against dose rate for this bag and weight: the conversion line, the point marked.
    const dMax = doseRate * 2;
    const xs = Array.from({ length: 21 }, (_, i) => (dMax * i) / 20);
    const svg = buildPlotSvg(
      [
        { type: "line", points: xs.map((x) => ({ x, y: (x * u.f) / conc })), color: "#1d4ed8", label: `${s4(conc)} mg/mL${u.weightBased ? `, ${s4(w)} kg` : ""}` },
        { type: "scatter", points: [{ x: doseRate, y: mlh }], color: "#b91c1c", label: `${s3(doseRate)} ${u.name} = ${s3(mlh)} mL/h` },
      ],
      { width: 440, height: 300, title: "Pump rate against dose rate", xlabel: `Dose rate (${u.name})`, ylabel: "Pump rate (mL/h)", xLimits: { min: 0, max: dMax }, yLimits: { min: 0 } },
    );
    return finish(lines, [plot(svg, "Pump rate against dose rate for this bag", "A straight line of pump rate in mL/h against dose rate, the chosen rate marked")], [
      { key: "mlh", label: "Pump rate", value: mlh, unit: "mL/h" },
      { key: "doseRate", label: "Dose rate", value: doseRate, unit: u.name },
      { key: "mgh", label: "Drug delivered", value: mgh, unit: "mg/h" },
    ], "dimensional arithmetic: µg/kg/min × kg × 60 min/h ÷ 1000 µg/mg = mg/h; mg/h ÷ mg/mL = mL/h");
  },
};

const labCalc: DoseCalc = {
  id: "med-labunits",
  name: "Lab unit conversions (creatinine, glucose, cholesterol, urea)",
  group: "Biomedical",
  unitContract: "domain",
  hint:
    "Conventional (mg/dL) ↔ SI (µmol/L or mmol/L) for creatinine, glucose, cholesterol, triglycerides and urea " +
    "nitrogen, by the molar-mass factors of the SI conversion tables. A value that only makes sense in the other unit is " +
    "refused with the conversion it probably meant.",
  fields: [
    {
      key: "analyte",
      label: "Analyte",
      default: "creatinine",
      kind: "select",
      options: ANALYTES.map((a) => ({ value: a.id, label: a.name })),
    },
    {
      key: "dir",
      label: "Convert",
      default: "tosi",
      kind: "select",
      options: [
        { value: "tosi", label: "Conventional (mg/dL) → SI" },
        { value: "toconv", label: "SI → conventional (mg/dL)" },
      ],
    },
    { key: "v", label: "Value", default: "1.2", kind: "text" },
  ],
  compute: (r) => {
    const a = ANALYTES.find((x) => x.id === r("analyte")) ?? ANALYTES[0];
    const v = num(r("v"), "Value", `in ${a.conventional} or ${a.si} (the Convert list)`);
    if (typeof v === "string") return refuse(v);
    if (!(v > 0)) return refuse("Value: enter a positive concentration.");
    const toSi = r("dir") !== "toconv";
    const conv = toSi ? v : v / a.factorValue;
    const si = toSi ? v * a.factorValue : v;
    const [pLo, pHi] = a.plausible;
    if (conv > pHi || conv < pLo) {
      // Read in the other unit, is it plausible? Then the unit was probably mixed up.
      const convIfOther = toSi ? v / a.factorValue : v;
      const looksOther = convIfOther >= pLo && convIfOther <= pHi;
      const other = toSi ? v / a.factorValue : v * a.factorValue;
      return refuse(
        `${a.name}: ${s4(v)} ${toSi ? a.conventional : a.si} is outside the plausible range (${s3(pLo)} to ${s3(pHi)} ${a.conventional}, ${s3(pLo * a.factorValue)} to ${s3(pHi * a.factorValue)} ${a.si})` +
          (looksOther ? `; it looks like a value already in ${toSi ? a.si : a.conventional} (${s4(v)} ${toSi ? a.si : a.conventional} = ${s4(other)} ${toSi ? a.conventional : a.si}). Switch the Convert direction.` : "."),
      );
    }
    const lines: EngReportLine[] = [
      toSi ? `${a.name} ${s4(v)} ${a.conventional} = ${s4(si)} ${a.si}.` : `${a.name} ${s4(v)} ${a.si} = ${s4(conv)} ${a.conventional}.`,
      { math: `c_SI = c_conv × ${a.factor}`, fallback: `SI (${a.si}) = conventional (${a.conventional}) × ${a.factor}` },
      `Factor ${a.factor} = ${a.basis}.`,
      {
        table: [
          ["Quantity", "Value", "Unit"],
          ["Conventional", s4(conv), a.conventional],
          ["SI", s4(si), a.si],
          ["Factor (SI per conventional)", a.factor, ""],
        ],
        label: a.name,
      },
    ];
    if (a.id === "urea") lines.push("BUN counts the nitrogen only (2 N per urea); mg/dL of urea itself is BUN × 2.14.");
    const xMax = Math.max(conv * 1.5, a.reference[1] * 1.5);
    const svg = buildPlotSvg(
      [
        { type: "line", points: [{ x: 0, y: 0 }, { x: xMax, y: xMax * a.factorValue }], color: "#1d4ed8", label: `× ${a.factor}` },
        { type: "scatter", points: [{ x: conv, y: si }], color: "#b91c1c", label: `${s4(conv)} ${a.conventional} = ${s4(si)} ${a.si}` },
      ],
      { width: 440, height: 300, title: `${a.name}: ${a.conventional} to ${a.si}`, xlabel: `Conventional (${a.conventional})`, ylabel: `SI (${a.si})`, xLimits: { min: 0, max: xMax }, yLimits: { min: 0, max: xMax * a.factorValue } },
    );
    return finish(lines, [plot(svg, `${a.name} conversion line`, `A straight line from conventional to SI units for ${a.name.toLowerCase()}, the value marked`)], [
      { key: "si", label: `${a.name} (SI)`, value: si, unit: a.si },
      { key: "conv", label: `${a.name} (conventional)`, value: conv, unit: a.conventional },
    ], "Young 1987, Ann Intern Med 106:114 (SI units for clinical laboratory data), factors from the molar masses");
  },
};

export const DOSING_CALCS: DoseCalc[] = [bsaCalc, weightsCalc, crclCalc, egfrCalc, doseCalc, infusionCalc, labCalc];
