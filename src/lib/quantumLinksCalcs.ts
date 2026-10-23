// Pane glue for Release Q part Q5 (group "Quantum optics", existing): space and lunar quantum links — the free-space
// optical link for single photons, entanglement distribution between two receivers, and BB84 over the link. Kept OUT of
// taskpane.ts; the integrator spreads QUANTUM_LINKS_CALCS into ENG_CALCS.
//
// No physics is computed here: quantumLinks.ts owns it (on quantum.ts bb84KeyRate / wernerState and linkBudget.ts's c).
// This file reads the fields — wavelength, apertures, range, rates and times through units.ts parseMeasured; losses as dB
// numbers (the unit layer rightly refuses decibels); efficiencies and probabilities as fractions or % — words the result
// under the display contract (U+2212, ×10ⁿ, no caret, e-notation, em dash, NaN or Infinity in an ok result) and draws.

import type { EngCalcDef } from "./engCalc";
import { engReport, type EngLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { formatUnit, parseMeasured } from "./units";
import { fmtSig } from "./axis";
import { trueMinus } from "./numberList";
import { readBer } from "./linkBudgetCalcs";
import {
  PRESET_GEOMETRY,
  RANGE_PRESETS,
  entanglement,
  fsoLink,
  presetArmEta,
  qkdLink,
  type EntInput,
  type FsoInput,
  type QkdInput,
  type QkdSource,
} from "./quantumLinks";
import { entRatesSvg, fsoLossSvg, qkdKeySvg, rangeText, timeText } from "./quantumLinksCharts";

type QoCalc = EngCalcDef<"Quantum optics">;

const UNIT_NOTE =
  "Units: wavelength, apertures, range, rates and times convert (1550 nm, 30 cm, 384400 km, 100 MHz or 5000 /s, 1 ns), and a unit of the wrong quantity is refused. Losses are decibels (a positive number, optionally with dB); efficiencies are fractions or %.";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, ";")), ok: false });

/** n significant figures, trailing zeros dropped, ×10ⁿ outside 10⁻³…10⁵, U+2212. */
const s = (v: number, n = 6): string => (v === 0 ? "0" : fmtSig(v, n).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, ""));
/** dB to three decimals, U+2212, no "−0.000". */
const db3 = (v: number): string => (Math.abs(v) < 0.0005 ? "0.000" : v.toFixed(3)).replace(/^-/, "−");
/** A percentage to four significant figures. */
const pct = (v: number): string => `${s(100 * v, 4)} %`;

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 460);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 320);
  return { kind: "plot", svg, caption, alt, w, h };
};

const table = (label: string, rows: string[][]): AnalyzeBlock => ({ kind: "table", label, rows: rows.map((r) => r.map((c) => trueMinus(c))) });

function finish(lines: EngLine[], conversions: string[], extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput {
  if (conversions.length) lines.push("Units read: " + conversions.join("; ") + ".");
  lines.push(UNIT_NOTE);
  const clean = lines.map((l) => (typeof l === "string" ? trueMinus(l.replace(/—/g, ";")) : { math: l.math, fallback: trueMinus(l.fallback) }));
  return { ...engReport(clean, extra), outputs };
}

/**
 * Field reading: dimensional fields through the unit layer; dB losses; fractions (0.6, 60 %, 1e-3, 1×10⁻³); a
 * transmission as a fraction or as a dB value ≤ 0. Errors are collected, conversions reported.
 */
function reader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const raw = (key: string): string => (r(key) ?? "").trim().replace(/[−–]/g, "-");
  const unit = (key: string, si: string, label: string, required: boolean): number | null => {
    const t = raw(key);
    if (!t) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const m = parseMeasured(t, si);
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (!Number.isFinite(m.inTarget)) {
      errors.push(`${label}: "${t}" is not a finite number.`);
      return NaN;
    }
    if (!m.assumed && m.unit.replace(/\s+/g, "") !== si && Math.abs(m.inTarget / m.value - 1) > 1e-12)
      conversions.push(`${label}: ${s(m.value)} ${formatUnit(m.unit)} = ${s(m.inTarget)} ${si}`);
    return m.inTarget;
  };
  /** A loss in dB: a number, optionally followed by "dB". */
  const db = (key: string, label: string): number => {
    const t = raw(key);
    if (!t) {
      errors.push(`${label}: this field is required (0 for none).`);
      return NaN;
    }
    const m = /^(.*?)\s*(dB)?$/i.exec(t) as RegExpExecArray;
    const v = readBer(m[1]);
    if (!Number.isFinite(v)) {
      errors.push(`${label}: "${t}" is not a number of dB.`);
      return NaN;
    }
    return v;
  };
  /** A fraction 0…1: 0.6, 60 %, 1e-6, 1×10⁻⁶. With allowDb, a transmission written in dB (≤ 0). */
  const frac = (key: string, label: string, allowDb = false, required = true): number | null => {
    const t = raw(key);
    if (!t) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const dbm = /^(.*?)\s*dB$/i.exec(t);
    if (dbm) {
      const v = readBer(dbm[1]);
      if (!allowDb || !Number.isFinite(v)) {
        errors.push(allowDb ? `${label}: "${t}" is not a number of dB.` : `${label}: a fraction is expected here (0.6 or 60 %), not dB.`);
        return NaN;
      }
      if (v > 0) {
        errors.push(`${label}: a transmission in dB is zero or negative (write −${s(v)} dB for a ${s(v)} dB loss).`);
        return NaN;
      }
      const lin = Math.pow(10, v / 10);
      conversions.push(`${label}: ${s(v)} dB = ${s(lin)}`);
      return lin;
    }
    const pc = /^(.*?)\s*%$/.exec(t);
    const x = readBer(pc ? pc[1] : t);
    if (!Number.isFinite(x)) {
      errors.push(`${label}: "${t}" is not a number (write a fraction such as 0.6, or 60 %${allowDb ? ", or a transmission in dB such as −30 dB" : ""}).`);
      return NaN;
    }
    const y = pc ? x / 100 : x;
    if (y < 0) {
      errors.push(`${label}: ${s(y)} is negative; it is a fraction from 0 to 1.`);
      return NaN;
    }
    if (y > 1) {
      errors.push(`${label}: ${s(x)} is above 1. It is a fraction from 0 to 1: write ${s(x / 100)} or ${s(x)} % if a percentage was meant.`);
      return NaN;
    }
    return y;
  };
  return {
    errors,
    conversions,
    req: (key: string, si: string, label: string): number => unit(key, si, label, true) as number,
    opt: (key: string, si: string, label: string): number | null => unit(key, si, label, false),
    db,
    frac: (key: string, label: string, allowDb = false): number => frac(key, label, allowDb, true) as number,
    fracOpt: (key: string, label: string): number | null => frac(key, label, false, false),
  };
}

const PRESET_OPTIONS = [
  { value: "custom", label: "Custom (use the range below)" },
  ...RANGE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
];

const PRESET_CAVEAT =
  "Preset ranges are the zenith altitude (LEO, GEO) or the centre-to-centre semimajor axis (Moon); a real slant range is longer (Micius: 507 km to 1 035 km at the daily closest pass).";

// ---------------------------------------------------------------------------------------------------------------
// 1. Free-space optical link for single photons
// ---------------------------------------------------------------------------------------------------------------

const fsoCalc: QoCalc = {
  id: "qlink-fso",
  name: "Free-space optical link for single photons (LEO, GEO, Earth–Moon)",
  group: "Quantum optics",
  unitContract: "converts",
  hint:
    "Diffraction-limited geometric coupling between a transmit and a receive telescope, η_geo = (π D_t D_r /(4 λ L))² " +
    "(Fraunhofer, on axis, uniform circular apertures), times the pointing, atmospheric and optics losses and the detector " +
    "efficiency: total transmission and loss in dB, photons received per second and the one-way light time. Presets: LEO " +
    "500 km, GEO 35 786 km, Earth–Moon 3.844×10⁸ m (sources in the result).",
  fields: [
    { key: "preset", label: "Range", default: "moon", kind: "select", options: PRESET_OPTIONS },
    { key: "range", label: "Custom range (m; 1000 km)", default: "1000 km", kind: "text" },
    { key: "lambda", label: "Wavelength (m; 1550 nm)", default: "1550 nm", kind: "text" },
    { key: "dt", label: "Transmit aperture diameter D_t (m)", default: "0.3 m", kind: "text" },
    { key: "dr", label: "Receive aperture diameter D_r (m)", default: "1.0 m", kind: "text" },
    { key: "point", label: "Pointing loss (dB)", default: "0", kind: "text" },
    { key: "atm", label: "Atmospheric loss (dB)", default: "0", kind: "text" },
    { key: "opt", label: "Optics loss, both terminals (dB)", default: "0", kind: "text" },
    { key: "det", label: "Detector efficiency (fraction or %)", default: "1", kind: "text" },
    { key: "emit", label: "Emitted photons per second (blank for none)", default: "1e9 /s", kind: "text" },
  ],
  compute: (r) => {
    const u = reader(r);
    const presetId = r("preset");
    const preset = RANGE_PRESETS.find((p) => p.id === presetId) ?? null;
    if (presetId && presetId !== "custom" && !preset) return refuse("Choose a range preset or Custom.");
    const rangeM = preset ? preset.m : u.req("range", "m", "Range");
    const lambda = u.req("lambda", "m", "Wavelength");
    const dt = u.req("dt", "m", "Transmit aperture");
    const dr = u.req("dr", "m", "Receive aperture");
    const pointingDb = u.db("point", "Pointing loss");
    const atmosDb = u.db("atm", "Atmospheric loss");
    const opticsDb = u.db("opt", "Optics loss");
    const detEff = u.frac("det", "Detector efficiency");
    const emitRate = u.opt("emit", "Hz", "Emitted rate");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const inp: FsoInput = { lambda, dt, dr, rangeM, pointingDb, atmosDb, opticsDb, detEff, emitRate };
    const res = fsoLink(inp);
    if (!res.ok) return refuse(res.error);

    const lines: EngLine[] = [];
    const where = preset ? preset.short : rangeText(rangeM);
    lines.push(
      `Geometric coupling at ${where} (${s(rangeM, 6)} m), λ = ${s(lambda * 1e9, 6)} nm, D_t = ${s(dt)} m, D_r = ${s(dr)} m: η_geo = ${s(res.etaGeo)} (${db3(-res.geoDb)} dB).`,
    );
    if (res.capped)
      lines.push(
        `Aperture-limited, near field: the far-field formula gives ${s(res.etaFormula, 4)}, above 1, so the receiver is larger than the diffraction-limited beam and η_geo is capped at 1. The formula does not hold here; the full Airy encircled energy is ${s(res.etaAiry, 4)}, and a real beam spreads more than the diffraction limit.`,
      );
    else if (Math.abs(res.etaFormula / res.etaAiry - 1) > 0.01)
      lines.push(
        `The small-angle form is exact only for η_geo ≪ 1: the full Airy encircled energy, 1 − J₀²(x) − J₁²(x) with x = πD_tD_r/(2λL) = ${s(res.x, 4)}, gives ${s(res.etaAiry, 4)} (${db3(10 * Math.log10(res.etaAiry))} dB), so the value above overestimates by ${pct(res.etaFormula / res.etaAiry - 1)}.`,
      );
    if (res.insideFraunhofer)
      lines.push(`The range is inside the transmitter's Fraunhofer distance 2D_t²/λ = ${rangeText(res.fraunhoferM)}: the far-field form is only approximate here.`);
    lines.push(
      `Total transmission η = ${s(res.etaTotal)} (${db3(-res.lossDb)} dB): geometric ${db3(-res.geoDb)} dB, pointing, atmosphere and optics ${db3(-res.extraDb)} dB, detector efficiency ${s(detEff)}.`,
    );
    if (res.photonsRx !== null) lines.push(`Photons detected: ${s(res.photonsRx)} per second from ${s(emitRate as number)} emitted per second.`);
    lines.push(`One-way light time L/c = ${s(res.lightTimeS)} s (round trip ${s(2 * res.lightTimeS)} s).`);
    lines.push({ math: "η_geo = ((π D_t D_r)/(4 λ L))^2", fallback: "η_geo = (π D_t D_r /(4 λ L))²" });
    lines.push({ math: "η = η_geo 10^{-(L_p + L_a + L_o)/10} η_d", fallback: "10 log₁₀ η = 10 log₁₀ η_geo − L_p − L_a − L_o + 10 log₁₀ η_d (losses in dB)" });
    lines.push({ math: "t = L/c", fallback: "t = L/c, c = 299 792 458 m/s (exact)" });
    lines.push(
      "Assumes a diffraction-limited transmitter with uniform circular aperture, Fraunhofer (far-field) propagation on axis, no central obstruction, and every other loss entered in dB; η_geo is capped at 1 when the receiver collects the whole beam.",
    );
    if (preset) lines.push(`Range preset: ${preset.source}. ${PRESET_CAVEAT}`);
    else lines.push(PRESET_CAVEAT);

    const rows: string[][] = [["Quantity", "Value", "dB"]];
    rows.push(["Geometric coupling η_geo", s(res.etaGeo), db3(-res.geoDb)]);
    rows.push(["Airy encircled energy (check)", s(res.etaAiry), db3(10 * Math.log10(res.etaAiry))]);
    rows.push(["Pointing loss", s(Math.pow(10, -pointingDb / 10)), db3(-pointingDb)]);
    rows.push(["Atmospheric loss", s(Math.pow(10, -atmosDb / 10)), db3(-atmosDb)]);
    rows.push(["Optics loss", s(Math.pow(10, -opticsDb / 10)), db3(-opticsDb)]);
    rows.push(["Detector efficiency", s(detEff), db3(10 * Math.log10(detEff))]);
    rows.push(["Total transmission η", s(res.etaTotal), db3(-res.lossDb)]);
    const outputs: EngOutput[] = [
      { key: "etaGeo", label: "Geometric coupling", value: res.etaGeo, unit: "" },
      { key: "geoDb", label: "Geometric loss", value: res.geoDb, unit: "dB" },
      { key: "etaAiry", label: "Airy encircled energy", value: res.etaAiry, unit: "" },
      { key: "eta", label: "Total transmission", value: res.etaTotal, unit: "" },
      { key: "lossDb", label: "Total loss", value: res.lossDb, unit: "dB" },
      { key: "lightTime", label: "One-way light time", value: res.lightTimeS, unit: "s" },
      { key: "range", label: "Range", value: rangeM, unit: "m" },
    ];
    if (res.photonsRx !== null) outputs.push({ key: "photonsRx", label: "Photons detected", value: res.photonsRx, unit: "1/s" });
    const extra: AnalyzeBlock[] = [
      table("Link budget for single photons", rows),
      plot(
        fsoLossSvg(inp, rangeM, res.lossDb, preset ? preset.id : null),
        "Total link loss against range, presets marked",
        "Total link loss in dB against range on a logarithmic axis, rising 20 dB per decade in the far field, with the LEO, GEO and Earth–Moon ranges and this link marked",
      ),
    ];
    return finish(lines, u.conversions, extra, outputs);
  },
};


// ---------------------------------------------------------------------------------------------------------------
// 2. Entanglement distribution
// ---------------------------------------------------------------------------------------------------------------

const ENT_PRESETS = [
  { value: "custom", label: "Custom (use the arm transmissions below)" },
  { value: "moon", label: "Earth–Moon: source on the Moon, two Earth stations (810 nm, 0.3 m → 1.0 m, geometric only)" },
  { value: "leo", label: "Satellite down-link: LEO 500 km zenith to two stations (810 nm, 0.3 m → 1.0 m, geometric only)" },
];

const entCalc: QoCalc = {
  id: "qlink-entanglement",
  name: "Entanglement distribution: coincidences, accidentals, Bell visibility",
  group: "Quantum optics",
  unitContract: "converts",
  hint:
    "A pair source of rate R sends one photon down each arm. Singles S = R·η·η_d (+ dark counts), true coincidences " +
    "R·η_a·η_d,a·η_b·η_d,b, accidental coincidences S_a·S_b·τ for a window of full width τ, the coincidence-to-accidental " +
    "ratio and the visibility and CHSH value the accidentals leave. Arm transmissions are typed (a fraction, or dB ≤ 0) or " +
    "come from a preset link geometry.",
  fields: [
    { key: "preset", label: "Arms", default: "custom", kind: "select", options: ENT_PRESETS },
    { key: "rate", label: "Pair rate at the source (per second; 1e8 /s)", default: "1e8 /s", kind: "text" },
    { key: "etaA", label: "Arm A transmission η_a (fraction or dB)", default: "1e-3", kind: "text" },
    { key: "etaB", label: "Arm B transmission η_b (fraction or dB)", default: "1e-4", kind: "text" },
    { key: "extra", label: "Extra loss per arm with a preset (dB)", default: "0", kind: "text" },
    { key: "detA", label: "Detector A efficiency (fraction or %)", default: "0.6", kind: "text" },
    { key: "detB", label: "Detector B efficiency (fraction or %)", default: "0.6", kind: "text" },
    { key: "darkA", label: "Detector A dark counts (per second)", default: "0", kind: "text" },
    { key: "darkB", label: "Detector B dark counts (per second)", default: "0", kind: "text" },
    { key: "tau", label: "Coincidence window τ, full width (s; 1 ns)", default: "1 ns", kind: "text" },
    { key: "jitter", label: "Timing jitter of t_a − t_b, rms (s; blank for none)", default: "", kind: "text" },
  ],
  compute: (r) => {
    const u = reader(r);
    const preset = r("preset") || "custom";
    if (!ENT_PRESETS.some((p) => p.value === preset)) return refuse("Choose Custom or a preset for the arms.");
    const pairRate = u.req("rate", "Hz", "Pair rate");
    let etaA: number;
    let etaB: number;
    let extra = 0;
    let presetM = 0;
    if (preset === "custom") {
      etaA = u.frac("etaA", "Arm A transmission", true);
      etaB = u.frac("etaB", "Arm B transmission", true);
    } else {
      extra = u.db("extra", "Extra loss per arm");
      presetM = (RANGE_PRESETS.find((p) => p.id === preset) as (typeof RANGE_PRESETS)[number]).m;
      if (Number.isFinite(extra) && extra < 0) u.errors.push("Extra loss per arm: a loss in dB is entered as a positive number.");
      if (Number.isFinite(extra) && extra > 300) u.errors.push("Extra loss per arm: above 300 dB; check the entry.");
      etaA = etaB = presetArmEta(presetM, Number.isFinite(extra) ? extra : 0);
    }
    const detA = u.frac("detA", "Detector A efficiency");
    const detB = u.frac("detB", "Detector B efficiency");
    const darkA = u.req("darkA", "Hz", "Detector A dark counts");
    const darkB = u.req("darkB", "Hz", "Detector B dark counts");
    const tau = u.req("tau", "s", "Coincidence window");
    const jitter = u.opt("jitter", "s", "Timing jitter");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const inp: EntInput = { pairRate, etaA, etaB, detA, detB, darkA, darkB, tau, jitter };
    const res = entanglement(inp);
    if (!res.ok) return refuse(res.error);

    const lines: EngLine[] = [];
    if (preset !== "custom") {
      const p = RANGE_PRESETS.find((x) => x.id === preset) as (typeof RANGE_PRESETS)[number];
      lines.push(
        `Arm transmission from the link geometry: ${p.short} (${s(p.m)} m) per arm, λ = ${s(PRESET_GEOMETRY.lambda * 1e9)} nm, D_t = ${s(PRESET_GEOMETRY.dt)} m, D_r = ${s(PRESET_GEOMETRY.dr)} m, geometric coupling only${extra ? ` with ${s(extra)} dB extra loss` : ""}: η_a = η_b = ${s(etaA)} (${db3(10 * Math.log10(etaA))} dB). Pointing, atmosphere and optics are NOT included unless entered as extra loss.`,
      );
    }
    lines.push(`Singles: S_a = ${s(res.singlesA)} /s, S_b = ${s(res.singlesB)} /s.`);
    lines.push(
      `True coincidences: ${s(res.coinc)} /s${res.captured < 1 ? ` (${pct(res.captured)} of the ${s(res.coincTotal)} /s detected pairs fall inside the window)` : ""}; accidental coincidences: ${s(res.acc)} /s in τ = ${timeText(tau)}.`,
    );
    lines.push(`Coincidence-to-accidental ratio CAR = C/A = ${s(res.car, 4)} (measured coincidences over accidentals, (C + A)/A = ${s(res.car + 1, 4)}).`);
    lines.push(
      `Visibility the accidentals leave: V = C/(C + A) = ${s(res.visibility, 4)}; CHSH at best S = 2√2·V = ${s(res.chshMax, 4)}, ${res.violatesChsh ? "above the local bound 2, so a Bell test can succeed" : "NOT above the local bound 2: no CHSH violation is possible at this ratio (it needs CAR > 1 + √2 ≈ 2.414)"}${res.entangled ? "" : "; the state is not even entangled (V ≤ 1/3)"}.`,
    );
    if (darkA === 0 && darkB === 0)
      lines.push(`With no dark counts CAR = 1/(R·τ) = ${s(1 / res.pairsPerWindow, 4)} whatever the arm losses${res.captured < 1 ? " (times the fraction inside the window)" : ""}; over long, lossy links dark and background counts usually dominate the accidentals, so enter them.`);
    if (res.pairsPerWindow > 0.01)
      lines.push(`The source emits ${s(res.pairsPerWindow, 3)} pairs per window: multi-pair emission is significant; its accidentals are in S_a·S_b·τ, but the visibility bound assumes an otherwise perfect state.`);
    lines.push({ math: "S_a = R η_a η_{d,a} + D_a", fallback: "S_a = R·η_a·η_d,a + D_a (and likewise S_b)" });
    lines.push({ math: "C = R η_a η_{d,a} η_b η_{d,b}", fallback: "C = R·η_a·η_d,a·η_b·η_d,b" });
    lines.push({ math: "A = S_a S_b τ", fallback: "A = S_a·S_b·τ" });
    lines.push({ math: "V = C/(C + A), S_max = 2 sqrt(2) V", fallback: "V = C/(C + A), S_max = 2√2·V" });
    if (jitter !== null && jitter > 0) lines.push({ math: "C(τ) = C erf(τ/(2 sqrt(2) σ))", fallback: "C(τ) = C·erf(τ/(2√2·σ)), σ the rms jitter of t_a − t_b" });
    lines.push(
      "Assumes an ideal maximally entangled source, uncorrelated accidentals spread evenly over the four outcome pairs (white noise: a Werner state of weight p = V, so the CHSH bound is 2√2·V), τ the FULL window width, and at most one count in ten windows at each detector. Arm transmissions exclude the detectors.",
    );
    if (preset !== "custom") lines.push(`Range preset: ${(RANGE_PRESETS.find((x) => x.id === preset) as (typeof RANGE_PRESETS)[number]).source}. ${PRESET_CAVEAT}`);

    const rows: string[][] = [
      ["Quantity", "Value", "Unit"],
      ["Singles S_a", s(res.singlesA), "1/s"],
      ["Singles S_b", s(res.singlesB), "1/s"],
      ["True coincidences C", s(res.coinc), "1/s"],
      ["Accidental coincidences A", s(res.acc), "1/s"],
      ["CAR = C/A", s(res.car, 4), ""],
      ["Visibility V", s(res.visibility, 4), ""],
      ["CHSH S_max", s(res.chshMax, 4), ""],
    ];
    const outputs: EngOutput[] = [
      { key: "singlesA", label: "Singles A", value: res.singlesA, unit: "1/s" },
      { key: "singlesB", label: "Singles B", value: res.singlesB, unit: "1/s" },
      { key: "coinc", label: "True coincidences", value: res.coinc, unit: "1/s" },
      { key: "acc", label: "Accidental coincidences", value: res.acc, unit: "1/s" },
      { key: "car", label: "Coincidence-to-accidental ratio", value: res.car, unit: "" },
      { key: "visibility", label: "Visibility", value: res.visibility, unit: "" },
      { key: "chsh", label: "CHSH S_max", value: res.chshMax, unit: "" },
      { key: "etaA", label: "Arm A transmission", value: etaA, unit: "" },
      { key: "etaB", label: "Arm B transmission", value: etaB, unit: "" },
    ];
    const extraBlocks: AnalyzeBlock[] = [
      table("Entanglement distribution", rows),
      plot(
        entRatesSvg(inp, res),
        "Coincidence and accidental rates against the coincidence window",
        "True and accidental coincidence rates per second against the window width on logarithmic axes, accidentals rising in proportion to the window, with the chosen window marked",
      ),
    ];
    return finish(lines, u.conversions, extraBlocks, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. BB84 over the link
// ---------------------------------------------------------------------------------------------------------------

const SOURCE_OPTIONS = [
  { value: "single", label: "Single-photon source (Shor–Preskill)" },
  { value: "decoy", label: "Weak coherent pulses with decoy states (asymptotic, Ma et al. 2005)" },
];

const qkdCalc: QoCalc = {
  id: "qlink-qkd",
  name: "BB84 key rate over a quantum link (single photon or decoy state)",
  group: "Quantum optics",
  unitContract: "converts",
  hint:
    "Secret key rate of BB84 over a channel of given loss: detection probability per pulse from the loss, detector efficiency " +
    "and background counts, QBER from the background and the intrinsic (misalignment) error, the asymptotic secret " +
    "fraction, and the loss at which the key reaches zero. The default detector efficiency (0.045), Y₀ (1.7×10⁻⁶), " +
    "intrinsic error (3.3 %) and f (1.22) are the GYS values used by Ma et al. (2005), and μ = 0.48 is that paper's optimum for " +
    "them; the rate and loss are examples. To hold a measured QBER fixed, set Y₀ = 0 and the intrinsic error to that QBER.",
  fields: [
    { key: "source", label: "Source", default: "single", kind: "select", options: SOURCE_OPTIONS },
    { key: "rate", label: "Pulse repetition rate (per second; 10 MHz)", default: "10 MHz", kind: "text" },
    { key: "loss", label: "Channel loss, detector excluded (dB)", default: "20", kind: "text" },
    { key: "det", label: "Detector efficiency (fraction or %)", default: "0.045", kind: "text" },
    { key: "y0", label: "Background count probability per pulse Y₀", default: "1.7e-6", kind: "text" },
    { key: "ed", label: "Intrinsic error e_det (fraction or %)", default: "3.3 %", kind: "text" },
    { key: "mu", label: "Decoy: signal mean photon number μ (blank = optimise)", default: "0.48", kind: "text" },
    { key: "f", label: "Decoy: error-correction efficiency f (1 = Shannon limit)", default: "1.22", kind: "text" },
  ],
  compute: (r) => {
    const u = reader(r);
    const source = (r("source") === "decoy" ? "decoy" : "single") as QkdSource;
    if (r("source") && r("source") !== "decoy" && r("source") !== "single") return refuse("Choose a source.");
    const rate = u.req("rate", "Hz", "Repetition rate");
    const lossDb = u.db("loss", "Channel loss");
    const detEff = u.frac("det", "Detector efficiency");
    const y0 = u.frac("y0", "Background count probability Y₀");
    const ed = u.frac("ed", "Intrinsic error");
    let mu: number | null = null;
    if (source === "decoy") {
      const mt = (r("mu") ?? "").trim();
      if (mt) {
        mu = readBer(mt.replace(/[−–]/g, "-"));
        if (!Number.isFinite(mu)) u.errors.push(`Mean photon number μ: "${mt}" is not a number.`);
      }
    }
    // f is read in both modes: with a single-photon source it sets the grey decoy reference in the figure.
    const f = readBer((r("f") ?? "").trim().replace(/[−–]/g, "-"));
    if (!Number.isFinite(f)) u.errors.push(`Error-correction efficiency f: "${r("f") ?? ""}" is not a number.`);
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const inp: QkdInput = { rate, lossDb, detEff, y0, ed, source, mu, f };
    const res = qkdLink(inp);
    if (!res.ok) return refuse(res.error);
    if (res.cutoffDb === -1 && ed >= res.thresholdQber)
      return refuse(
        `The intrinsic error ${pct(ed)} is at or above the BB84 threshold ${pct(res.thresholdQber)}: no secret key can be distilled at any loss.`,
      );

    const lines: EngLine[] = [];
    const srcText = source === "single" ? "single-photon source" : `decoy states on weak coherent pulses (μ = ${s(res.mu as number, 4)}${res.muOptimised ? ", optimised at this loss" : ""}; f = ${s(f)})`;
    lines.push(`BB84 with ${source === "single" ? "a " : ""}${srcText} over ${s(lossDb)} dB of channel loss: overall transmission η = ${s(res.eta)} (detector efficiency ${s(detEff)} included).`);
    lines.push(
      `Detection probability per pulse ${source === "single" ? "Y₁" : "Q_μ"} = ${s(res.gain)}; sifted rate ${s(res.siftedRate)} bit/s at ${s(rate)} pulses/s (q = ½); QBER ${pct(res.qber)}.`,
    );
    if (source === "decoy") lines.push(`Single-photon part: Q₁ = ${s(res.q1 as number)}, e₁ = ${pct(res.e1 as number)}.`);
    lines.push(
      res.keyRate > 0
        ? `Secret key rate: ${s(res.keyRate)} bit/s (${s(res.perPulse)} bit per pulse; ${pct(res.fraction)} of each sifted bit survives).`
        : `Secret key rate: 0 bit/s. ${source === "single" ? `The QBER ${pct(res.qber)} is at or above the ${pct(res.thresholdQber)} threshold` : "The single-photon contribution no longer pays for the error correction"}: no key at this loss.`,
    );
    const cut = res.cutoffDb;
    if (cut === null) lines.push("No zero-key cutoff: with no background counts the QBER is e_det at every loss, so the rate falls with loss but never reaches zero.");
    else if (cut === -1) lines.push("No secret key at any channel loss: even at 0 dB the error rate is too high.");
    else if (cut >= 400) lines.push("The zero-key cutoff lies beyond 400 dB of channel loss.");
    else lines.push(`Zero-key cutoff at ${s(cut, 5)} dB of channel loss${source === "decoy" && res.muOptimised ? " (μ held at its optimum for this loss)" : ""}.`);
    if (source === "single") {
      lines.push({ math: "Y_1 = Y_0 + η - Y_0 η", fallback: "Y₁ = Y₀ + η − Y₀η" });
      lines.push({ math: "e_1 = (e_0 Y_0 + e_det η)/Y_1", fallback: "e₁ = (e₀Y₀ + e_det·η)/Y₁, e₀ = ½" });
      lines.push({ math: "R = q Y_1 [1 - 2 H_2(e_1)]", fallback: "R = q·Y₁·[1 − 2H₂(e₁)] per pulse (Shor–Preskill), q = ½" });
    } else {
      lines.push({ math: "Q_μ = Y_0 + 1 - e^{-η μ}", fallback: "Q_μ = Y₀ + 1 − exp(−ημ)" });
      lines.push({ math: "E_μ Q_μ = e_0 Y_0 + e_det (1 - e^{-η μ})", fallback: "E_μQ_μ = e₀Y₀ + e_det(1 − exp(−ημ)), e₀ = ½" });
      lines.push({ math: "Q_1 = (Y_0 + η - Y_0 η) μ e^{-μ}", fallback: "Q₁ = Y₁·μ·exp(−μ), Y₁ = Y₀ + η − Y₀η" });
      lines.push({ math: "R = q {Q_1 [1 - H_2(e_1)] - Q_μ f H_2(E_μ)}", fallback: "R = q{Q₁[1 − H₂(e₁)] − Q_μ·f·H₂(E_μ)} per pulse, q = ½" });
    }
    lines.push({ math: "η = 10^{-L/10} η_d", fallback: "10 log₁₀ η = −L + 10 log₁₀ η_d (L the channel loss in dB)" });
    lines.push(
      source === "single"
        ? "Asymptotic (infinite key), one photon per pulse, background errors random (e₀ = ½), error correction at the Shannon limit; the secret fraction is the Shor–Preskill bound 1 − 2H₂(QBER) (the same engine as the BB84 key-rate tool), zero above about 11 %. Model and notation: Ma, Qi, Zhao, Lo, Phys. Rev. A 72, 012326 (2005)."
        : "Asymptotic decoy-state bound with infinitely many decoys (Q₁ and e₁ known exactly), Poissonian source of mean μ, e₀ = ½: Ma, Qi, Zhao, Lo, “Practical decoy state for quantum key distribution”, Phys. Rev. A 72, 012326 (2005), Eqs. 1, 7–11. Reproduces that paper's GYS cutoff (142.05 km) to 0.03 km. Finite-key and finite-decoy effects lower the rate.",
    );
    const rows: string[][] = [
      ["Quantity", "Value", "Unit"],
      ["Overall transmission η", s(res.eta), ""],
      [source === "single" ? "Detection probability Y₁" : "Gain Q_μ", s(res.gain), "per pulse"],
      ["QBER", pct(res.qber), ""],
      ["Sifted rate", s(res.siftedRate), "bit/s"],
      ["Secret fraction", s(res.fraction, 4), "per sifted bit"],
      ["Secret key rate", s(res.keyRate), "bit/s"],
      ["Zero-key cutoff", cut === null ? "none" : cut === -1 ? "no key" : cut >= 400 ? "beyond 400" : s(cut, 5), "dB"],
    ];
    const outputs: EngOutput[] = [
      { key: "eta", label: "Overall transmission", value: res.eta, unit: "" },
      { key: "gain", label: "Detection probability per pulse", value: res.gain, unit: "" },
      { key: "qber", label: "QBER", value: res.qber, unit: "" },
      { key: "sifted", label: "Sifted rate", value: res.siftedRate, unit: "bit/s" },
      { key: "fraction", label: "Secret fraction", value: res.fraction, unit: "" },
      { key: "keyRate", label: "Secret key rate", value: res.keyRate, unit: "bit/s" },
    ];
    if (cut !== null && cut > 0 && cut < 400) outputs.push({ key: "cutoff", label: "Zero-key cutoff", value: cut, unit: "dB" });
    if (res.mu !== null) outputs.push({ key: "mu", label: "Mean photon number", value: res.mu, unit: "" });
    const extra: AnalyzeBlock[] = [
      table("BB84 over the link", rows),
      plot(
        qkdKeySvg(inp, res),
        "Secret key rate against channel loss with the zero-key cutoff",
        "Secret key rate in bit per second on a logarithmic axis against channel loss in dB, falling to zero at the cutoff marked by a vertical line, with the operating point and the other source type as a grey reference",
      ),
    ];
    return finish(lines, u.conversions, extra, outputs);
  },
};

/** The space and lunar quantum-link calculators, for the integrator to spread into ENG_CALCS (group "Quantum optics"). */
export const QUANTUM_LINKS_CALCS: QoCalc[] = [fsoCalc, entCalc, qkdCalc];
