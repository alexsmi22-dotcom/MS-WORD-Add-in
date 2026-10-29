/**
 * The v2.206.0 dosing and body-measurement calculators (dosing.ts, dosingCalcs.ts). Oracle: the independent Python
 * re-implementation in scripts/clinical-oracle.py ("dosing" in fixtures/clinical-oracle.json), with the CKD-EPI 2021
 * coefficients of Inker et al. (2021, N Engl J Med 385:1737) typed there separately. Adversarial: unit mix-ups
 * (creatinine in µmol/L typed into mg/dL, height in metres, a unit typed after a number), extreme creatinine, children.
 */
import * as fs from "fs";
import * as path from "path";
import { bsaAll, ckdEpiCr2021, ckdEpiCrCys2021, cockcroftGault, ibwDevine, adjustedBw, lbwJanmahasatian, bmi, ANALYTES, type Sex } from "../dosing";
import { DOSING_CALCS, DOSING_ASSUMES } from "../dosingCalcs";
import { insertableResultText } from "../insertGate";
import type { AnalyzeOutput } from "../analyzeBlocks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const O: any = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "clinical-oracle.json"), "utf8"));

const run = (id: string, over: Record<string, string> = {}): AnalyzeOutput => {
  const c = DOSING_CALCS.find((x) => x.id === id)!;
  return c.compute((k) => over[k] ?? c.fields.find((f) => f.key === k)?.default ?? "");
};
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

describe("formulas against the independent re-implementation", () => {
  for (const o of O.dosing) {
    const [age, sex, scr, cys, w, h] = o.input as [number, Sex, number, number, number, number];
    test(`${age} y ${sex}, SCr ${scr}, cys ${cys}, ${w} kg, ${h} cm`, () => {
      expect(rel(ckdEpiCr2021(scr, age, sex), o.egfrCr)).toBeLessThan(1e-13);
      expect(rel(ckdEpiCrCys2021(scr, cys, age, sex), o.egfrCrCys)).toBeLessThan(1e-13);
      expect(rel(cockcroftGault(age, w, scr, sex), o.cg)).toBeLessThan(1e-13);
      const b = bsaAll(w, h);
      [b.mosteller, b.duBois, b.haycock, b.gehanGeorge].forEach((v, i) => expect(rel(v, o.bsa[i])).toBeLessThan(1e-13));
      const ibw = ibwDevine(h, sex);
      expect(rel(ibw, o.ibw)).toBeLessThan(1e-13);
      expect(rel(adjustedBw(w, ibw), o.adj)).toBeLessThan(1e-13);
      expect(rel(lbwJanmahasatian(w, h, sex), o.lbw)).toBeLessThan(1e-13);
      expect(rel(bmi(w, h), o.bmi)).toBeLessThan(1e-13);
    });
  }

  test("CKD-EPI 2021 hand check (Inker et al. 2021): woman 60 y, SCr 1.0 mg/dL → 64.5", () => {
    // 142 × (1.0/0.7)^−1.200 × 0.9938^60 × 1.012
    expect(ckdEpiCr2021(1.0, 60, "female")).toBeCloseTo(142 * Math.pow(1 / 0.7, -1.2) * Math.pow(0.9938, 60) * 1.012, 12);
    expect(ckdEpiCr2021(1.0, 60, "female").toFixed(1)).toBe("64.5");
    // At SCr = κ both branches are 1: 142 × 0.9938^age (× 1.012 for women).
    expect(ckdEpiCr2021(0.9, 50, "male")).toBeCloseTo(142 * Math.pow(0.9938, 50), 12);
    expect(ckdEpiCrCys2021(0.9, 0.8, 50, "male")).toBeCloseTo(135 * Math.pow(0.9961, 50), 12);
  });

  test("Cockcroft–Gault hand check: (140 − 65) × 80/(72 × 1.1) × 0.85 = 64.39 mL/min", () => {
    expect(cockcroftGault(65, 80, 1.1, "female")).toBeCloseTo((75 * 80) / 79.2 * 0.85, 12);
  });

  test("Devine: 5 ft is exactly the base weight", () => {
    expect(ibwDevine(152.4, "male")).toBeCloseTo(50, 12);
    expect(ibwDevine(152.4, "female")).toBeCloseTo(45.5, 12);
  });

  test("conversion factors follow from the molar masses", () => {
    const f = Object.fromEntries(ANALYTES.map((a) => [a.id, a.factorValue]));
    expect(f.creatinine).toBeCloseTo(10000 / 113.12, 1);
    expect(f.glucose).toBeCloseTo(10 / 180.16, 5);
    expect(f.cholesterol).toBeCloseTo(10 / 386.65, 5);
    expect(f.triglycerides).toBeCloseTo(10 / 885.4, 5);
    expect(f.urea).toBeCloseTo(10 / 28.014, 3);
  });
});

describe("every dosing calculator, end to end", () => {
  test.each(DOSING_CALCS.map((c) => [c.id]))("%s: defaults give an insertable result, a figure, the source and the research note", (id) => {
    const o = run(id);
    expect(o.ok).not.toBe(false);
    expect(insertableResultText(o.text)).toBe(true);
    expect(o.text).not.toMatch(/NaN|Infinity|—|\de[+-]?\d/);
    expect((o.blocks ?? []).some((b) => b.kind === "plot")).toBe(true);
    expect(o.text).toContain(DOSING_ASSUMES);
    expect(o.text).toMatch(/Source: /);
    // A plain first line: the headline number, no formula.
    expect(o.text.split("\n")[0]).toMatch(/\d/);
    expect(o.text.split("\n")[0]).not.toMatch(/[\^·√]/);
  });

  test("Cockcroft–Gault states the weight used, and all three", () => {
    const o = run("med-crcl", { basis: "ideal" });
    expect(o.text.split("\n")[0]).toMatch(/on the ideal body weight of 56\.9 kg/);
    expect(o.outputs!.find((x) => x.key === "weightUsed")!.value).toBeCloseTo(ibwDevine(165, "female"), 10);
  });

  test("eGFR gives the non-indexed GFR only with both weight and height", () => {
    expect(run("med-egfr", { w: "70", h: "175" }).text).toMatch(/Non-indexed GFR/);
    expect(run("med-egfr", { w: "70" }).ok).toBe(false);
  });

  test("units: lb and inches are converted", () => {
    const kg = run("med-bsa").outputs!.find((x) => x.key === "bsa")!.value;
    const lb = run("med-bsa", { w: String(70 / 0.45359237), wu: "lb", h: String(175 / 2.54), hu: "in" }).outputs!.find((x) => x.key === "bsa")!.value;
    expect(lb).toBeCloseTo(kg, 10);
  });

  test("infusion: there and back", () => {
    const a = run("med-infusion");
    const mlh = a.outputs!.find((x) => x.key === "mlh")!.value;
    // 5 µg/kg/min × 70 kg × 60/1000 = 21 mg/h; ÷ 1.6 mg/mL = 13.125 mL/h
    expect(mlh).toBeCloseTo(13.125, 12);
    const b = run("med-infusion", { dir: "torate", mlh: String(mlh) });
    expect(b.outputs!.find((x) => x.key === "doseRate")!.value).toBeCloseTo(5, 12);
  });

  test("dose: the cap is applied and said", () => {
    const o = run("med-dose", { cap: "1000" });
    expect(o.outputs!.find((x) => x.key === "dose")!.value).toBe(1000);
    expect(o.text).toMatch(/capped: 15 mg\/kg would give 1050 mg/);
    const b = run("med-dose", { basis: "bsa", per: "100" });
    expect(b.outputs!.find((x) => x.key === "dose")!.value).toBeCloseTo(100 * Math.sqrt((175 * 70) / 3600), 10);
  });
});

describe("adversarial: unit mistakes and implausible values", () => {
  test("creatinine in µmol/L typed into a mg/dL field is refused with the likely meaning", () => {
    for (const id of ["med-crcl", "med-egfr"]) {
      const o = run(id, { scr: "97" });
      expect(o.ok).toBe(false);
      expect(o.text).toMatch(/looks like a value in µmol\/L \(97 µmol\/L = 1\.1 mg\/dL\)\. Choose µmol\/L/);
    }
  });
  test("creatinine in mg/dL typed into a µmol/L field is refused", () => {
    const o = run("med-egfr", { scr: "1.1", su: "umol" });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/looks like a value in mg\/dL/);
  });
  test("µmol/L read correctly gives the same eGFR", () => {
    const a = run("med-egfr", { cys: "" }).outputs![0].value;
    const b = run("med-egfr", { cys: "", scr: "88.42", su: "umol" }).outputs![0].value;
    expect(b).toBeCloseTo(a, 10);
  });
  test("extreme creatinine: 20 mg/dL computes with a warning; 0.05 mg/dL is refused", () => {
    const hi = run("med-crcl", { scr: "20" });
    expect(hi.ok).not.toBe(false);
    expect(hi.text).toMatch(/far outside the steady state/);
    expect(run("med-crcl", { scr: "0.05" }).ok).toBe(false);
    expect(run("med-egfr", { scr: "0" }).ok).toBe(false);
  });
  test("height in metres typed into cm, a unit typed after the number, and children are refused", () => {
    expect(run("med-bsa", { h: "1.75" }).text).toMatch(/looks like metres; enter 175/);
    expect(run("med-bsa", { w: "70 kg" }).text).toMatch(/type the number only/);
    expect(run("med-egfr", { age: "12" }).text).toMatch(/adult equations/);
    expect(run("med-bsa", { w: "700" }).text).toMatch(/if it is in pounds, choose lb/);
  });
  test("a word typed as a number is refused without echoing it (engineering-audit BADNUMBER)", () => {
    for (const c of DOSING_CALCS) {
      const k = c.fields.find((f) => f.kind === "text")!.key;
      const o = run(c.id, { [k]: "NaN" });
      expect(o.ok).toBe(false);
      expect(o.text).not.toMatch(/NaN|Infinity/);
    }
    expect(run("med-bsa", { w: "1e999" }).text).toMatch(/out of range/);
  });
  test("cystatin C in nmol/L is refused", () => {
    expect(run("med-egfr", { cys: "80" }).text).toMatch(/nmol\/L/);
  });
  test("lab units: an SI value typed as conventional is caught, and the right direction works", () => {
    const g = run("med-labunits", { analyte: "glucose", v: "5.5" });
    expect(g.ok).toBe(false);
    expect(g.text).toMatch(/looks like a value already in mmol\/L/);
    const ok = run("med-labunits", { analyte: "glucose", v: "5.5", dir: "toconv" });
    expect(ok.outputs!.find((x) => x.key === "conv")!.value).toBeCloseTo(5.5 / 0.05551, 10);
    const cr = run("med-labunits", { v: "97" });
    expect(cr.ok).toBe(false);
    expect(cr.text).toMatch(/Switch the Convert direction/);
  });
});
