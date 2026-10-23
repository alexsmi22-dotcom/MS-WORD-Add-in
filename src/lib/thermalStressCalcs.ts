// Pane glue for the thermal-stress calculators (Release E, gap #3), group "Structural & solids": restrained thermal
// stress, the Timoshenko bimetal / bilayer, Stoney's thin-film relation and thermal-shock resistance. Kept OUT of
// taskpane.ts so the exact objects the pane registers can be tested; the integrator spreads THERMAL_STRESS_CALCS into
// ENG_CALCS.
//
// No number is computed here: thermalStress.ts owns them all, and stress.ts (analyzeStress, factorOfSafety) owns the
// yield check. This file reads the fields through the unit layer (units.ts parseMeasured), words the result under the
// display contract (U+2212 minus, ×10ⁿ, no em dash, NaN or Infinity) and draws.
//
// A TEMPERATURE CHANGE IS A DIFFERENCE. parseMeasured reads "180 °F" as the absolute temperature 355.37 K; a ΔT of
// 180 °F is 100 K. deltaTReader subtracts the unit's own zero (convert(0, unit, "K")), so every temperature unit the
// unit layer knows reads as a difference, without a second table of offsets.

import type { EngCalcDef } from "./engCalc";
import { engReport } from "./engReport";
import type { AnalyzeOutput, AnalyzeBlock, EngOutput } from "./analyzeBlocks";
import { parseMeasured, convert } from "./units";
import { fmtSig, MINUS } from "./axis";
import { trueMinus } from "./numberList";
import { analyzeStress, factorOfSafety } from "./stress";
import {
  restrainedStress,
  restrainedSigmaAt,
  timoshenkoBilayer,
  stoneyFilmStress,
  stoneyCurvature,
  thermalShock,
  BILAYER_MAX_KAPPA_L,
  STONEY_MAX_RATIO,
  type RestraintMode,
  type Restraint,
  type RestrainedInput,
} from "./thermalStress";
import {
  restrainedChartSvg,
  bilayerKappaChartSvg,
  bilayerStressProfileSvg,
  stoneyChartSvg,
  thermalShockChartSvg,
  THERMAL_CHART_WIDTH,
  PROFILE_MIN_FRACTION,
} from "./thermalStressCharts";

type Group = "Structural & solids";
const GROUP: Group = "Structural & solids";

// ------------------------------------------------------------------ helpers

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")).replace(/[“”]/g, '"'), ok: false });

/** Significant figures, trailing zeros dropped, ×10ⁿ outside 10⁻³…10⁶, U+2212; −0 is 0. */
function num(v: number, sig = 4): string {
  if (!Number.isFinite(v)) return "not finite";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e6) return (v < 0 ? MINUS : "") + String(Number(a.toPrecision(sig)));
  // ×10ⁿ form with the mantissa's trailing zeros dropped (1.2×10⁻⁵, not 1.200×10⁻⁵).
  return fmtSig(v, sig).replace(/(\.\d*?)0+×/, "$1×").replace(/\.×/, "×");
}

/** A unit as typeset (the unit layer's ASCII "*" and "^2" written as · and ²). */
const typeset = (u: string): string =>
  u.replace(/\*/g, "·").replace(/\^-1\b/g, "⁻¹").replace(/\^2\b/g, "²").replace(/\^3\b/g, "³");

const UNIT_NOTE =
  "Units: a bare number is read in the unit the field names; write another unit (30 ksi, 0.02 in, 6 µm/(m·K), " +
  "180 °F as a temperature change) and it is converted for you; a unit of the wrong quantity is refused.";

/**
 * Unit-aware field reading: each field read through parseMeasured in the unit its label names (`fieldUnit`), then
 * scaled to SI by `toSI`. Errors are collected; conversions are reported.
 */
function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, fieldUnit: string, toSI: number, label: string, required: boolean): number | null => {
    const raw = (r(key) ?? "").trim().replace(/−/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const m = parseMeasured(raw, fieldUnit);
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (!m.assumed && m.inTarget !== m.value) conversions.push(`${label}: ${num(m.value, 6)} ${typeset(m.unit)} = ${num(m.inTarget, 5)} ${typeset(fieldUnit)}`);
    return m.inTarget * toSI;
  };
  /**
   * A temperature CHANGE in K: the unit layer validates and converts, and the unit's zero is subtracted, so
   * "180 °F" is 100 K and "100 °C" is 100 K (never 373.15 K).
   */
  const deltaT = (key: string, label: string): number => {
    const raw = (r(key) ?? "").trim().replace(/−/g, "-");
    if (!raw) {
      errors.push(`${label}: this field is required.`);
      return NaN;
    }
    const m = parseMeasured(raw, "K");
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (m.assumed) return m.value;
    const zero = convert(0, m.unit, "K");
    if (zero === null) {
      errors.push(`${label}: "${m.unit}" could not be read as a temperature change.`);
      return NaN;
    }
    const d = m.inTarget - zero;
    if (zero !== 0 || m.inTarget !== m.value) conversions.push(`${label}: ${num(m.value, 6)} ${m.unit} as a temperature change = ${num(d, 5)} K`);
    return d;
  };
  return {
    errors,
    conversions,
    req: (key: string, fieldUnit: string, toSI: number, label: string): number => read(key, fieldUnit, toSI, label, true) as number,
    opt: (key: string, fieldUnit: string, toSI: number, label: string): number | null => read(key, fieldUnit, toSI, label, false),
    deltaT,
  };
}

/** A plain number field (no unit): NaN when blank or unreadable; null when blank and optional. */
function plain(v: string | undefined): number {
  const t = (v ?? "").trim().replace(/−/g, "-");
  return t !== "" && Number.isFinite(Number(t)) ? Number(t) : NaN;
}

/** A plain number that refuses a unit typed after it (ν and r are pure numbers). */
function pureNumber(r: (k: string) => string, key: string, label: string, errors: string[], required: boolean): number {
  const raw = (r(key) ?? "").trim();
  if (!raw) {
    if (required) errors.push(`${label}: this field is required.`);
    return NaN;
  }
  const v = plain(raw);
  if (!Number.isFinite(v)) errors.push(`${label}: "${raw}" is not a plain number (this quantity has no unit).`);
  return v;
}

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => ({
  kind: "plot",
  svg,
  caption,
  alt,
  w: THERMAL_CHART_WIDTH,
  h: Math.round(THERMAL_CHART_WIDTH * 0.64),
});

const finish = (lines: Parameters<typeof engReport>[0], extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput => {
  const out = engReport(
    lines.map((l) => (typeof l === "string" ? trueMinus(l) : { math: l.math, fallback: trueMinus(l.fallback) })),
    extra,
  );
  return { ...out, outputs };
};

const sense = (s: number): string => (s < 0 ? "compression" : s > 0 ? "tension" : "no stress");

// ------------------------------------------------------------------ 1. restrained thermal stress

const MODE_NAME: Record<RestraintMode, string> = {
  uniaxial: "bar restrained along its length (uniaxial)",
  biaxial: "plate restrained in its plane (equal biaxial)",
  triaxial: "body restrained in all three directions (hydrostatic)",
};

function computeRestrained(r: (k: string) => string): AnalyzeOutput {
  const u = unitReader(r);
  const mode = (r("mode") || "uniaxial") as RestraintMode;
  if (!(mode in MODE_NAME)) return refuse(`Unknown restraint mode "${mode}".`);
  const kind = r("restraint") || "full";
  const E = u.req("E", "GPa", 1e9, "E");
  const alpha = u.req("alpha", "µm/(m*K)", 1e-6, "α");
  const dT = u.deltaT("dT", "ΔT");
  const nu = mode === "uniaxial" ? NaN : pureNumber(r, "nu", "ν", u.errors, true);
  let restraint: Restraint;
  if (kind === "fraction") restraint = { kind: "fraction", r: pureNumber(r, "r", "Restraint fraction r", u.errors, true) };
  else if (kind === "gap") restraint = { kind: "gap", gap: u.req("gap", "mm", 1e-3, "Gap"), length: u.req("L", "m", 1, "Bar length L") };
  else if (kind === "full") restraint = { kind: "full" };
  else return refuse(`Unknown restraint "${kind}".`);
  const sy = u.opt("sy", "MPa", 1e6, "Yield strength");
  if (u.errors.length) return refuse(u.errors.join("\n"));
  if (sy !== null && !(sy > 0)) return refuse("Yield strength: must be a positive stress (or leave it blank).");
  const inp: RestrainedInput = { E, alpha, dT, nu, mode, restraint };
  const res = restrainedStress(inp);
  if (!res.ok) return refuse(res.error);
  const sMPa = res.sigma / 1e6;
  const lines: Parameters<typeof engReport>[0] = [];
  const restraintWord =
    restraint.kind === "full" ? "fully restrained" : restraint.kind === "fraction" ? `restrained to a fraction r = ${num(restraint.r)}` : `free until a gap of ${num(restraint.gap * 1e3)} mm closes`;
  lines.push(`Restrained thermal stress, ${MODE_NAME[mode]}, ${restraintWord}: σ = ${num(sMPa, 6)} MPa (${sense(res.sigma)}).`);
  const rPart = restraint.kind === "fraction" ? "r " : "";
  if (restraint.kind === "gap") {
    lines.push({ math: "σ = -E (α ΔT - g/L)", fallback: "σ = −E(αΔT − g/L) once αΔT > g/L, else 0" });
  } else if (mode === "uniaxial") {
    lines.push({ math: `σ = -${rPart}E α ΔT`, fallback: `σ = −${rPart}EαΔT` });
  } else if (mode === "biaxial") {
    lines.push({ math: `σ = -(${rPart}E α ΔT)/(1 - ν)`, fallback: `σ = −${rPart}EαΔT/(1 − ν)` });
  } else {
    lines.push({ math: `σ = -(${rPart}E α ΔT)/(1 - 2 ν)`, fallback: `σ = −${rPart}EαΔT/(1 − 2ν)` });
  }
  lines.push(
    `With E = ${num(E / 1e9)} GPa, α = ${num(alpha)} K⁻¹, ΔT = ${num(dT)} K${mode === "uniaxial" ? "" : `, ν = ${num(nu)}`}: free thermal strain αΔT = ${num(res.freeStrain)}.`,
  );
  const outputs: EngOutput[] = [
    { key: "sigma", label: "Restrained stress σ", value: sMPa, unit: "MPa" },
    { key: "freeStrain", label: "Free thermal strain αΔT", value: res.freeStrain, unit: "" },
  ];
  if (restraint.kind === "gap") {
    if (res.dTClose !== null && res.dTClose >= 0) {
      lines.push(`The gap closes at ΔT = ${num(res.dTClose)} K; below that the bar is free (σ = 0). Contraction pulls the bar away from the stop (σ = 0).`);
      outputs.push({ key: "dTClose", label: "ΔT at which the gap closes", value: res.dTClose, unit: "K" });
    } else {
      lines.push("With this sign of α a temperature rise shortens the bar: the gap never closes on heating. Contraction pulls the bar away from the stop (σ = 0).");
    }
  }
  let yieldLine: number | null = null;
  if (sy !== null) {
    const st = analyzeStress({ sx: res.state.sx, sy: res.state.sy, sz: res.state.sz, txy: 0, tyz: 0, tzx: 0 });
    if (!st.ok) return refuse(st.error);
    if (st.vonMises === 0) {
      lines.push(
        mode === "triaxial" && res.sigma !== 0
          ? `Yield: the stress is hydrostatic (equal in all three directions), so the von Mises and Tresca equivalent stresses are zero and neither criterion predicts yielding at any ΔT; brittle fracture or cavitation governs instead.`
          : `Yield: no stress, so no yield (yield strength ${num(sy / 1e6)} MPa).`,
      );
    } else {
      const fos = factorOfSafety(st, sy);
      if ("ok" in fos) return refuse(fos.error);
      const n = fos.vonMises;
      lines.push(
        `Yield margin: von Mises stress ${num(st.vonMises / 1e6)} MPa against the yield strength ${num(sy / 1e6)} MPa gives a factor of safety ${num(n, 3)} (von Mises; Tresca ${num(fos.tresca, 3)}).` +
          (n < 1 ? " The stress EXCEEDS yield: the part yields and the elastic stress above is an upper bound, not the stress it carries." : ""),
      );
      outputs.push({ key: "factorOfSafety", label: "Factor of safety against yield (von Mises)", value: n, unit: "" });
      yieldLine = sy / 1e6;
    }
  }
  lines.push(
    "Assumes: linear elastic, isotropic, E and α constant over the temperature range, ΔT uniform through the part; restrained means zero total strain in the restrained directions.",
  );
  if (u.conversions.length) lines.push(`Converted: ${u.conversions.join("; ")}.`);
  const svg = restrainedChartSvg((t) => restrainedSigmaAt(inp, t), dT, yieldLine);
  const fig = plot(
    svg,
    `Figure: restrained thermal stress against the temperature change${yieldLine !== null ? ", with the yield strength" : ""}.`,
    `Line plot of restrained stress in MPa against temperature change in K; the stated ΔT of ${num(dT)} K gives ${num(sMPa)} MPa.`,
  );
  return finish(lines, [fig], outputs);
}

// ------------------------------------------------------------------ 2. Timoshenko bilayer

function computeBilayer(r: (k: string) => string): AnalyzeOutput {
  const u = unitReader(r);
  const t1 = u.req("t1", "mm", 1e-3, "Layer 1 thickness t₁");
  const E1 = u.req("E1", "GPa", 1e9, "Layer 1 modulus E₁");
  const t2 = u.req("t2", "mm", 1e-3, "Layer 2 thickness t₂");
  const E2 = u.req("E2", "GPa", 1e9, "Layer 2 modulus E₂");
  const dAlpha = u.req("dAlpha", "µm/(m*K)", 1e-6, "Δα = α₁ − α₂");
  const dT = u.deltaT("dT", "ΔT");
  const L = u.opt("L", "mm", 1e-3, "Cantilever length L");
  if (u.errors.length) return refuse(u.errors.join("\n"));
  const res = timoshenkoBilayer({ t1, t2, E1, E2, dAlpha, dT, length: L });
  if (!res.ok) return refuse(res.error);
  const lines: Parameters<typeof engReport>[0] = [];
  const convex = res.kappa > 0 ? "layer 1 on the convex (outer) side" : res.kappa < 0 ? "layer 2 on the convex (outer) side" : "the strip stays flat";
  lines.push(
    `Bimetal curvature (Timoshenko 1925): κ = ${num(res.kappa, 6)} m⁻¹` +
      (res.kappa !== 0 ? `, radius R = 1/|κ| = ${num(1 / Math.abs(res.kappa), 5)} m` : "") +
      `; ${convex}.`,
  );
  lines.push({
    math: "κ = (6 Δα ΔT (1 + m)^2)/(h (3 (1 + m)^2 + (1 + m n)(m^2 + 1/(m n))))",
    fallback: "κ = 6ΔαΔT(1 + m)² / (h[3(1 + m)² + (1 + mn)(m² + 1/(mn))])",
  });
  lines.push(`m = t₁/t₂ = ${num(res.m)}, n = E₁/E₂ = ${num(res.n)}, h = t₁ + t₂ = ${num(res.h * 1e3)} mm, Δα·ΔT = ${num(dAlpha * dT)}.`);
  const outputs: EngOutput[] = [{ key: "kappa", label: "Curvature κ", value: res.kappa, unit: "m⁻¹" }];
  if (res.kappa !== 0) outputs.push({ key: "R", label: "Radius of curvature R", value: 1 / Math.abs(res.kappa), unit: "m" });
  if (res.tip !== null && L !== null) {
    lines.push({ math: "δ = (κ L^2)/2", fallback: "δ = κL²/2" });
    lines.push(`Tip deflection of a ${num(L * 1e3)} mm cantilever: δ = ${num(res.tip * 1e3, 5)} mm (κL = ${num(res.kappaL as number, 3)} rad, within the ${BILAYER_MAX_KAPPA_L} rad small-deflection limit).`);
    outputs.push({ key: "tip", label: "Tip deflection δ", value: res.tip * 1e3, unit: "mm" });
  }
  lines.push({ math: "P = (κ (E_1 t_1^3 + E_2 t_2^3))/(6 h)", fallback: "P = κ(E₁t₁³ + E₂t₂³)/(6h)" });
  lines.push(
    `Layer stresses from the same model: axial force P = ${num(res.P, 5)} N/m per unit width (compression in layer 1 when positive), each layer carrying ∓P/tᵢ plus its bending ±Eᵢκtᵢ/2.`,
  );
  const M = 1e-6;
  const table: AnalyzeBlock = {
    kind: "table",
    label: "Layer stresses (Timoshenko beam model)",
    rows: [
      ["Location", "Stress (MPa)"],
      ["Layer 1, outer face", num(res.s1Outer * M, 5)],
      ["Layer 1, at the interface", num(res.s1Interface * M, 5)],
      ["Layer 2, at the interface", num(res.s2Interface * M, 5)],
      ["Layer 2, outer face", num(res.s2Outer * M, 5)],
    ],
  };
  outputs.push(
    { key: "s1Outer", label: "Layer 1 stress, outer face", value: res.s1Outer * M, unit: "MPa" },
    { key: "s1Interface", label: "Layer 1 stress at the interface", value: res.s1Interface * M, unit: "MPa" },
    { key: "s2Interface", label: "Layer 2 stress at the interface", value: res.s2Interface * M, unit: "MPa" },
    { key: "s2Outer", label: "Layer 2 stress, outer face", value: res.s2Outer * M, unit: "MPa" },
  );
  lines.push(
    "Assumes: a long, narrow strip in beam theory (E, no Poisson effect; for a wide plate use the biaxial modulus E/(1 − ν) for each layer), perfect bonding, uniform ΔT, stress-free at the reference temperature. The free-edge peel and shear stresses at the ends are not part of this model.",
  );
  if (u.conversions.length) lines.push(`Converted: ${u.conversions.join("; ")}.`);
  const f1 = plot(
    bilayerKappaChartSvg(res.kappaPerK, dT),
    "Figure: bimetal curvature against the temperature change (Timoshenko).",
    `Line plot of curvature in inverse metres against temperature change in K; the stated ΔT gives ${num(res.kappa)} per metre.`,
  );
  // The through-thickness profile only when both layers are tall enough to read on one z scale; a thinner layer
  // would be a sliver under the frame line, so the table carries its stresses instead (and the result says so).
  if (Math.min(t1, t2) / (t1 + t2) < PROFILE_MIN_FRACTION) {
    lines.push(`The through-thickness stress figure is not drawn: one layer is under ${PROFILE_MIN_FRACTION * 100}% of the total thickness and would not show; the table gives its stresses.`);
    return finish(lines, [table, f1], outputs);
  }
  const f2 = plot(
    bilayerStressProfileSvg(res, t1, t2),
    "Figure: stress through the thickness of the bimetal, layer 2 at the bottom.",
    "Line plot of stress in MPa (horizontal) against height through the strip in mm (vertical), linear in each layer with a jump at the interface.",
  );
  return finish(lines, [table, f1, f2], outputs);
}

// ------------------------------------------------------------------ 3. Stoney thin film

function computeStoney(r: (k: string) => string): AnalyzeOutput {
  const u = unitReader(r);
  const dir = r("solve") || "stress";
  if (dir !== "stress" && dir !== "curvature") return refuse(`Unknown choice "${dir}".`);
  const Es = u.req("Es", "GPa", 1e9, "Substrate modulus Eₛ");
  const nus = pureNumber(r, "nus", "Substrate νₛ", u.errors, true);
  const hs = u.req("hs", "µm", 1e-6, "Substrate thickness hₛ");
  const hf = u.req("hf", "µm", 1e-6, "Film thickness");
  const kIn = dir === "stress" ? u.req("kappa", "1/m", 1, "Curvature κ") : NaN;
  const sIn = dir === "curvature" ? u.req("sigmaf", "MPa", 1e6, "Film stress") : NaN;
  if (u.errors.length) return refuse(u.errors.join("\n"));
  const s = { Es, nus, hs, hf };
  const res = dir === "stress" ? stoneyFilmStress(s, kIn) : stoneyCurvature(s, sIn);
  if (!res.ok) return refuse(res.error);
  const kappa = "kappa" in res ? res.kappa : kIn;
  const sigma = "sigma" in res ? res.sigma : sIn;
  const lines: Parameters<typeof engReport>[0] = [];
  const outputs: EngOutput[] = [];
  if (dir === "stress") {
    lines.push(`Film stress (Stoney): ${num(sigma / 1e6, 6)} MPa (${sense(sigma)}).`);
    outputs.push({ key: "sigmaf", label: "Film stress", value: sigma / 1e6, unit: "MPa" });
  } else {
    lines.push(`Substrate curvature (Stoney): κ = ${num(kappa, 6)} m⁻¹` + (kappa !== 0 ? `, radius R = ${num(1 / Math.abs(kappa), 5)} m.` : " (flat)."));
    outputs.push({ key: "kappa", label: "Curvature κ", value: kappa, unit: "m⁻¹" });
    if (kappa !== 0) outputs.push({ key: "R", label: "Radius of curvature R", value: 1 / Math.abs(kappa), unit: "m" });
  }
  lines.push({ math: "σ_f = (E_s h_s^2 κ)/(6 (1 - ν_s) h_f)", fallback: "σ_f = E_s h_s² κ / (6(1 − ν_s) h_f)" });
  lines.push(
    `With Eₛ = ${num(Es / 1e9)} GPa, νₛ = ${num(nus)}, substrate hₛ = ${num(hs * 1e6)} µm, film ${num(hf * 1e6)} µm (film/substrate thickness ratio ${num(hf / hs, 3)}, within the ${STONEY_MAX_RATIO} thin-film limit).`,
  );
  lines.push(
    "Signs: a tensile film (+) bends the substrate concave on the film side, taken as positive κ. Assumes an equal-biaxial film stress uniform through the film thickness, a film much thinner than the substrate, small deflection and an isotropic substrate (for Si(100) wafers use the biaxial modulus of the wafer orientation as Eₛ/(1 − νₛ)).",
  );
  if (u.conversions.length) lines.push(`Converted: ${u.conversions.join("; ")}.`);
  const f = plot(
    stoneyChartSvg(res.factor, kappa),
    "Figure: Stoney film stress against substrate curvature for this film and substrate.",
    `Straight line through the origin of film stress in MPa against curvature in inverse metres; this film is at ${num(kappa)} per metre and ${num(sigma / 1e6)} MPa.`,
  );
  return finish(lines, [f], outputs);
}

// ------------------------------------------------------------------ 4. thermal shock

function computeShock(r: (k: string) => string): AnalyzeOutput {
  const u = unitReader(r);
  const sf = u.req("sf", "MPa", 1e6, "Fracture strength");
  const nu = pureNumber(r, "nu", "ν", u.errors, true);
  const E = u.req("E", "GPa", 1e9, "E");
  const alpha = u.req("alpha", "µm/(m*K)", 1e-6, "α");
  const k = u.opt("k", "W/(m*K)", 1, "Thermal conductivity k");
  if (u.errors.length) return refuse(u.errors.join("\n"));
  const res = thermalShock({ sf, nu, E, alpha, k });
  if (!res.ok) return refuse(res.error);
  const lines: Parameters<typeof engReport>[0] = [];
  lines.push(`Thermal shock resistance: R = ${num(res.R, 5)} K, the largest sudden quench temperature difference before fracture in the severe-quench limit.`);
  lines.push({ math: "R = (σ_f (1 - ν))/(E α)", fallback: "R = σ_f(1 − ν)/(Eα)" });
  const outputs: EngOutput[] = [{ key: "R", label: "Thermal shock resistance R", value: res.R, unit: "K" }];
  if (res.Rp !== null && k !== null) {
    lines.push(`R′ = k·R = ${num(res.Rp, 5)} W/m with k = ${num(k)} W/(m·K) (the resistance under mild, heat-flow-limited cooling).`);
    outputs.push({ key: "Rprime", label: "Second resistance parameter R′ = kR", value: res.Rp, unit: "W/m" });
  }
  lines.push(
    `With fracture strength ${num(sf / 1e6)} MPa, ν = ${num(nu)}, E = ${num(E / 1e9)} GPa, α = ${num(alpha)} K⁻¹. Assumes a brittle, linear elastic, isotropic solid with constant properties; R is the infinite-Biot (instant surface quench) limit. No Biot-number correction is applied: none was checked against a source for this release, so a finite heat-transfer coefficient (which raises the critical ΔT) is not modelled.`,
  );
  if (u.conversions.length) lines.push(`Converted: ${u.conversions.join("; ")}.`);
  const f = plot(
    thermalShockChartSvg(E, alpha, nu, sf, res.R),
    "Figure: quench surface stress against the temperature difference, with the fracture strength; they cross at R.",
    `Line plot of surface stress in MPa against quench temperature difference in K, a horizontal line at the fracture strength, crossing at R = ${num(res.R)} K.`,
  );
  return finish(lines, [f], outputs);
}

// ------------------------------------------------------------------ registry

export const THERMAL_STRESS_CALCS: EngCalcDef<Group>[] = [
  {
    id: "thermal-restrained",
    name: "Thermal stress (restrained)",
    group: GROUP,
    hint:
      "Stress in a part whose thermal expansion is prevented: a bar between rigid walls (σ = −EαΔT), a plate held in its plane, or a body held in all directions; full, partial or gap restraint, with a yield margin. ΔT is a temperature CHANGE (180 °F = 100 K). " +
      UNIT_NOTE,
    unitContract: "converts",
    fields: [
      {
        key: "mode",
        label: "What is restrained",
        default: "uniaxial",
        kind: "select",
        options: [
          { value: "uniaxial", label: "Bar, along its length (uniaxial)" },
          { value: "biaxial", label: "Plate, in its plane (biaxial)" },
          { value: "triaxial", label: "Body, in all directions (triaxial)" },
        ],
      },
      {
        key: "restraint",
        label: "Restraint",
        default: "full",
        kind: "select",
        options: [
          { value: "full", label: "Full" },
          { value: "fraction", label: "Partial (fraction r)" },
          { value: "gap", label: "Gap, then a rigid stop (bar only)" },
        ],
      },
      { key: "E", label: "Young's modulus E (GPa)", default: "200 GPa", kind: "text" },
      { key: "alpha", label: "Expansion coefficient α (µm/(m·K), i.e. 10⁻⁶/K)", default: "12 µm/(m·K)", kind: "text" },
      { key: "dT", label: "Temperature change ΔT (K; a difference)", default: "100 K", kind: "text" },
      { key: "nu", label: "Poisson's ratio ν (plate or body)", default: "0.3", kind: "text" },
      { key: "r", label: "Restraint fraction r, 0–1 (partial)", default: "0.5", kind: "text" },
      { key: "gap", label: "Gap g (mm, gap restraint)", default: "0.5 mm", kind: "text" },
      { key: "L", label: "Bar length L (m, gap restraint)", default: "1 m", kind: "text" },
      { key: "sy", label: "Yield strength (MPa, optional)", default: "250 MPa", kind: "text" },
    ],
    compute: (r) => computeRestrained(r),
  },
  {
    id: "thermal-bilayer",
    name: "Bimetal / bilayer curvature",
    group: GROUP,
    hint:
      "Timoshenko (1925) bimetal: the curvature, radius and cantilever tip deflection of two bonded layers heated by ΔT, with the stress in each layer. Layer 1 is the one whose α is larger when Δα > 0. " +
      UNIT_NOTE,
    unitContract: "converts",
    fields: [
      { key: "t1", label: "Layer 1 thickness t₁ (mm)", default: "0.3 mm", kind: "text" },
      { key: "E1", label: "Layer 1 modulus E₁ (GPa)", default: "70 GPa", kind: "text" },
      { key: "t2", label: "Layer 2 thickness t₂ (mm)", default: "1 mm", kind: "text" },
      { key: "E2", label: "Layer 2 modulus E₂ (GPa)", default: "200 GPa", kind: "text" },
      { key: "dAlpha", label: "Δα = α₁ − α₂ (µm/(m·K), i.e. 10⁻⁶/K)", default: "11 µm/(m·K)", kind: "text" },
      { key: "dT", label: "Temperature change ΔT (K; a difference)", default: "80 K", kind: "text" },
      { key: "L", label: "Cantilever length L (mm, optional)", default: "50 mm", kind: "text" },
    ],
    compute: (r) => computeBilayer(r),
  },
  {
    id: "thermal-stoney",
    name: "Thin-film stress (Stoney)",
    group: GROUP,
    hint:
      "Stoney (1909): the stress in a thin film from the curvature it gives its substrate (wafer bow), or the curvature a stated film stress gives. Refused when the film is not thin (film thicker than a tenth of the substrate). " +
      UNIT_NOTE,
    unitContract: "converts",
    fields: [
      {
        key: "solve",
        label: "Find",
        default: "stress",
        kind: "select",
        options: [
          { value: "stress", label: "Film stress from measured curvature" },
          { value: "curvature", label: "Curvature from film stress" },
        ],
      },
      { key: "Es", label: "Substrate modulus Eₛ (GPa)", default: "130 GPa", kind: "text" },
      { key: "nus", label: "Substrate Poisson's ratio νₛ", default: "0.28", kind: "text" },
      { key: "hs", label: "Substrate thickness hₛ (µm)", default: "525 µm", kind: "text" },
      { key: "hf", label: "Film thickness (µm)", default: "1 µm", kind: "text" },
      { key: "kappa", label: "Curvature κ (1/m; film stress from curvature)", default: "0.05 1/m", kind: "text" },
      { key: "sigmaf", label: "Film stress (MPa; curvature from stress)", default: "400 MPa", kind: "text" },
    ],
    compute: (r) => computeStoney(r),
  },
  {
    id: "thermal-shock",
    name: "Thermal shock resistance",
    group: GROUP,
    hint:
      "The first thermal-shock parameter R = (fracture strength)·(1 − ν)/(Eα): the largest sudden quench ΔT a brittle ceramic survives, and R′ = kR when the conductivity is given. " +
      UNIT_NOTE,
    unitContract: "converts",
    fields: [
      { key: "sf", label: "Fracture strength (MPa)", default: "300 MPa", kind: "text" },
      { key: "nu", label: "Poisson's ratio ν", default: "0.22", kind: "text" },
      { key: "E", label: "Young's modulus E (GPa)", default: "370 GPa", kind: "text" },
      { key: "alpha", label: "Expansion coefficient α (µm/(m·K), i.e. 10⁻⁶/K)", default: "8 µm/(m·K)", kind: "text" },
      { key: "k", label: "Thermal conductivity k (W/(m·K), optional)", default: "30 W/(m·K)", kind: "text" },
    ],
    compute: (r) => computeShock(r),
  },
];
