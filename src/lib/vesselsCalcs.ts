// Pane glue for pressure vessels, thick cylinders, shrink fits, rotating disks, combined loading and Hertz contact
// (Release E, gap #10). Kept OUT of taskpane.ts so the exact objects the pane registers can be tested; the pane
// spreads VESSELS_CALCS into ENG_CALCS.
//
// No number is computed here: vessels.ts, combinedLoad.ts and contact.ts own them, and every stress state's
// principal stresses, von Mises and Tresca come from stress.ts (analyzeStress / factorOfSafety), the same engine as
// the pane's own stress tools, so the app never gives two answers to one question. This file reads the fields (every
// dimensional field through the unit layer, units.ts parseMeasured), words the result under the display contract
// (U+2212 minus, ×10ⁿ, never an em dash, NaN or Infinity) and draws.

import type { EngCalcDef } from "./engCalc";
import { engReport, plainDashes, type EngLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { parseMeasured } from "./units";
import { fmtSig, MINUS, superscript } from "./axis";
import { trueMinus } from "./numberList";
import { buildPlotSvg, type Series } from "./plot";
import { rowLabeller, titleWithMultiplier } from "./flippedAxis";
import { hBarSvg, mohrCircleSvg } from "./mechchart";
import { analyzeStress, factorOfSafety, type PrincipalResult } from "./stress";
import { thinVessel, lame, lameAt, shrinkFit, rotatingDisk, diskAt, THIN_WALL_LIMIT, type ThinShape } from "./vessels";
import { combinedLoad, type Section } from "./combinedLoad";
import { hertzSphere, hertzCylinder, axisShear, type ContactBody, type SubsurfaceShear } from "./contact";

export type VesselsGroup = "Structural & solids" | "Fatigue & machine design";

// ------------------------------------------------------------------ formatting

/** Significant figures, trailing zeros dropped, ×10ⁿ outside 10⁻³…10⁶, U+2212. */
function num(v: number, sig = 4): string {
  if (!Number.isFinite(v)) return "not finite";
  if (v === 0 || Math.abs(v) < 1e-300) return "0";
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e6) return (v < 0 ? MINUS : "") + String(Number(a.toPrecision(sig)));
  return fmtSig(v, sig);
}
/** A unit as typed, typeset: "kg/m^3" → "kg/m³", "N*m" → "N·m". */
function dispUnit(u: string): string {
  return u.replace(/\^\s*(-?\d+)/g, (_s, n: string) => superscript(Number(n))).replace(/\*/g, "·");
}
const MPA = (pa: number, sig = 4): string => `${num(pa / 1e6, sig)} MPa`;
/** A length in mm, or µm when below 1 mm. */
const LEN = (m: number): string => (Math.abs(m) < 1e-3 ? `${num(m * 1e6)} µm` : `${num(m * 1e3)} mm`);

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(plainDashes(text)), ok: false });

function report(lines: EngLine[], blocks: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput {
  const cleanBlocks = blocks.map((b) =>
    b.kind === "table" ? { ...b, rows: b.rows.map((row) => row.map((c) => trueMinus(plainDashes(c)))) } : b,
  );
  const out = engReport(lines.map((l) => (typeof l === "string" ? trueMinus(l) : l)), cleanBlocks);
  return { ...out, outputs };
}

/** The w/h an SVG declares (buildPlotSvg grows the canvas for legends and notes). */
function plotOf(svg: string, caption: string, alt: string): AnalyzeBlock {
  const w = Number(/<svg[^>]*\bwidth="([\d.]+)"/.exec(svg)?.[1] ?? 420);
  const h = Number(/<svg[^>]*\bheight="([\d.]+)"/.exec(svg)?.[1] ?? 280);
  return { kind: "plot", svg, caption, alt, w, h };
}

const UNIT_NOTE =
  "Units: a bare number is read in the unit the field names; write another unit (0.5 m, 2 in, 300 psi, 30 ksi, " +
  "3000 rpm, 7.85 g/cm³) and it is converted for you, and a unit of the wrong quantity is refused.";

const BLUE = "#2563eb";
const RED = "#b91c1c";
const GREEN = "#15803d";
const PURPLE = "#7c3aed";

// ------------------------------------------------------------------ field reading

/** Units of energy typed into a moment or torque field: the same dimension as N·m, but not a moment. */
const ENERGY_UNIT = /^(?:[kMGm]?J|[kM]?cal|eV|[kMG]?Wh|Btu)$/;

/** Unit-aware field reading: errors collected, conversions reported, values returned in SI. */
function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, unit: string, toSI: number, label: string, required: boolean): number | null => {
    const raw = (r(key) ?? "").trim().replace(/−/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const m = parseMeasured(raw, unit);
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (unit === "N*m" && ENERGY_UNIT.test(m.unit.trim())) {
      errors.push(`${label}: "${m.unit}" is a unit of energy; a moment or torque is written in N·m (or kN·m, lbf·ft).`);
      return NaN;
    }
    if (!m.assumed && m.inTarget !== m.value) conversions.push(`${label}: ${num(m.value, 6)} ${dispUnit(m.unit)} = ${num(m.inTarget, 5)} ${dispUnit(unit)}`);
    return m.inTarget * toSI;
  };
  return {
    errors,
    conversions,
    req: (key: string, unit: string, toSI: number, label: string): number => read(key, unit, toSI, label, true) as number,
    opt: (key: string, unit: string, toSI: number, label: string): number | null => read(key, unit, toSI, label, false),
  };
}

/** A plain number field (Poisson's ratio): NaN when blank or unreadable. */
function plain(v: string | undefined): number {
  const t = (v ?? "").trim().replace(/−/g, "-");
  return t !== "" && /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t) ? Number(t) : NaN;
}

/** The refusal for collected field errors, or null. */
function fieldErrors(u: { errors: string[] }): AnalyzeOutput | null {
  return u.errors.length ? refuse(u.errors.join("\n")) : null;
}

/** "Converted: …" lines, when any field was converted. */
function convLines(u: { conversions: string[] }): string[] {
  return u.conversions.length ? [`Converted: ${u.conversions.join("; ")}.`] : [];
}

/** Yield margin lines and outputs from a stress state and an optional yield strength (Pa). */
function marginOf(st: PrincipalResult, sy: number | null, where: string): { lines: string[]; outputs: EngOutput[] } | string {
  const lines = [`Equivalent stress ${where}: von Mises ${MPA(st.vonMises)}, Tresca ${MPA(st.tresca)}.`];
  const outputs: EngOutput[] = [
    { key: "vonMises", label: "von Mises stress", value: st.vonMises / 1e6, unit: "MPa" },
    { key: "tresca", label: "Tresca stress", value: st.tresca / 1e6, unit: "MPa" },
  ];
  if (sy === null) return { lines, outputs };
  if (!(sy > 0)) return "Yield strength: must be greater than zero (or leave it blank).";
  if (st.vonMises <= 0) {
    lines.push("There is no stress, so the yield margin is unbounded.");
    return { lines, outputs };
  }
  const f = factorOfSafety(st, sy);
  if (!("vonMises" in f)) return f.error;
  lines.push(
    `Factor of safety against first yield (yield strength ${MPA(sy)}): ${num(f.vonMises, 3)} by von Mises, ${num(f.tresca, 3)} by Tresca (the more conservative). ` +
      (f.tresca < 1 ? "Below 1: the material yields at this load." : "This is a ratio to yield, not a design-code allowable."),
  );
  outputs.push({ key: "fosVonMises", label: "Factor of safety (von Mises)", value: f.vonMises, unit: "" });
  outputs.push({ key: "fosTresca", label: "Factor of safety (Tresca)", value: f.tresca, unit: "" });
  return { lines, outputs };
}

/** analyzeStress for a principal-axis state (σ1, σ2, σ3 in Pa, no shear). */
function principalState(a: number, b: number, c: number): PrincipalResult | string {
  const s = analyzeStress({ sx: a, sy: b, sz: c, txy: 0, tyz: 0, tzx: 0 });
  return s.ok ? s : s.error;
}

/** The governing (largest von Mises) of a set of principal-axis states. */
function worstState(states: Array<[number, number, number]>): PrincipalResult | string {
  let best: PrincipalResult | null = null;
  for (const [a, b, c] of states) {
    const s = principalState(a, b, c);
    if (typeof s === "string") return s;
    if (!best || s.vonMises > best.vonMises) best = s;
  }
  return best ?? "No stress state to assess.";
}

/** n + 1 evenly spaced radii from r0 to r1 (n is a fixed small count). */
function radii(r0: number, r1: number, n: number): number[] {
  return Array.from({ length: n + 1 }, (_, i) => (i === n ? r1 : r0 + ((r1 - r0) * i) / n));
}

// ================================================================== 1. thin-walled vessel

function computeThin(r: (k: string) => string): AnalyzeOutput {
  const u = unitReader(r);
  const shape = (r("shape") || "cylinder-closed") as ThinShape;
  if (shape !== "cylinder-closed" && shape !== "cylinder-open" && shape !== "sphere") return refuse("Choose a vessel shape.");
  const p = u.req("p", "MPa", 1e6, "Internal pressure");
  const rad = u.req("r", "mm", 1e-3, "Inner radius");
  const t = u.req("t", "mm", 1e-3, "Wall thickness");
  const sy = u.opt("sy", "MPa", 1e6, "Yield strength");
  const fe = fieldErrors(u);
  if (fe) return fe;
  const res = thinVessel(p, rad, t, shape);
  if (!res.ok) return refuse(res.error);
  const sphere = shape === "sphere";
  // The bore is the more severe surface: the membrane stresses with σr = −p.
  const st = principalState(res.hoop, res.axial, res.radialBore);
  if (typeof st === "string") return refuse(st);
  const m = marginOf(st, sy, "at the bore (σr = −p, the more severe surface)");
  if (typeof m === "string") return refuse(m);
  const lines: EngLine[] = [];
  if (sphere) {
    lines.push({ math: "σ = (p r)/(2 t)", fallback: "σ = p·r/(2t)" });
    lines.push(`Membrane stress (equal in every direction in the wall): σ = ${MPA(res.hoop)}.`);
  } else {
    lines.push({ math: "σ_θ = (p r)/t", fallback: "σθ = p·r/t" });
    lines.push(shape === "cylinder-closed" ? { math: "σ_z = (p r)/(2 t)", fallback: "σz = p·r/(2t)" } : "Open ends: no axial stress from the pressure (σz = 0).");
    lines.push(`Hoop stress σθ = ${MPA(res.hoop)}; axial stress σz = ${MPA(res.axial)}.`);
  }
  lines.push(`Radial stress: ${MPA(res.radialBore)} at the bore, 0 at the outer surface. t/r = ${num(res.ratio, 3)} (the thin-wall limit here is ${THIN_WALL_LIMIT}).`);
  if (res.lameBoreHoop !== null) {
    lines.push(
      `Check: the Lamé (thick-wall) hoop stress at the bore of the same cylinder is ${MPA(res.lameBoreHoop)}; p·r/t with the inner radius is the exact wall average, so the bore peak is ${num((res.lameBoreHoop / res.hoop - 1) * 100, 2)} % higher.`,
    );
  }
  lines.push(...m.lines);
  lines.push("Model: thin-walled membrane (t/r ≤ 0.1), r the inner radius, internal pressure only, away from heads, nozzles and supports; linear elastic.");
  lines.push(...convLines(u), UNIT_NOTE);
  const rows = sphere
    ? [
        { name: "Membrane σ", value: res.hoop / 1e6, colour: BLUE },
        { name: "Radial σr (bore)", value: res.radialBore / 1e6, colour: RED },
        { name: "von Mises", value: st.vonMises / 1e6, colour: PURPLE },
      ]
    : [
        { name: "Hoop σθ", value: res.hoop / 1e6, colour: BLUE },
        { name: "Axial σz", value: res.axial / 1e6, colour: GREEN },
        { name: "Radial σr (bore)", value: res.radialBore / 1e6, colour: RED },
        { name: "von Mises", value: st.vonMises / 1e6, colour: PURPLE },
      ];
  const svg = hBarSvg(rows, { title: sphere ? "Thin spherical vessel stresses" : "Thin cylinder stresses", unit: "MPa" });
  const outputs: EngOutput[] = [
    { key: "hoop", label: sphere ? "Membrane stress" : "Hoop stress", value: res.hoop / 1e6, unit: "MPa" },
    { key: "axial", label: "Axial stress", value: res.axial / 1e6, unit: "MPa" },
    { key: "tOverR", label: "t/r", value: res.ratio, unit: "" },
    ...m.outputs,
  ];
  return report(lines, [plotOf(svg, "Principal stresses of the thin-walled vessel wall, with the von Mises equivalent at the bore", "Horizontal bar chart of hoop, axial and radial stresses and the von Mises stress in MPa")], outputs);
}

// ================================================================== 2. Lamé thick cylinder

function computeLame(r: (k: string) => string): AnalyzeOutput {
  const u = unitReader(r);
  const ends = r("ends") === "open" ? "open" : "closed";
  const ri = u.req("ri", "mm", 1e-3, "Inner radius");
  const ro = u.req("ro", "mm", 1e-3, "Outer radius");
  const pi = u.req("pi", "MPa", 1e6, "Internal pressure");
  const po = u.opt("po", "MPa", 1e6, "External pressure") ?? 0;
  const sy = u.opt("sy", "MPa", 1e6, "Yield strength");
  const fe = fieldErrors(u);
  if (fe) return fe;
  const L = lame(ri, ro, pi, po, ends);
  if (!L.ok) return refuse(L.error);
  const rs = radii(ri, ro, 60);
  const states = rs.map((x) => {
    const s = lameAt(L, x);
    return [s.sr, s.st, L.axial] as [number, number, number];
  });
  const worst = worstState(states);
  if (typeof worst === "string") return refuse(worst);
  const m = marginOf(worst, sy, "at the most stressed radius");
  if (typeof m === "string") return refuse(m);
  const atI = lameAt(L, ri);
  const atO = lameAt(L, ro);
  const lines: EngLine[] = [
    { math: "σ_r = A - B/r^2", fallback: "σr = A − B/r²" },
    { math: "σ_θ = A + B/r^2", fallback: "σθ = A + B/r²" },
    { math: "A = (p_i r_i^2 - p_o r_o^2)/(r_o^2 - r_i^2)", fallback: "A = (pᵢrᵢ² − pₒrₒ²)/(rₒ² − rᵢ²)" },
    { math: "B = ((p_i - p_o) r_i^2 r_o^2)/(r_o^2 - r_i^2)", fallback: "B = (pᵢ − pₒ)rᵢ²rₒ²/(rₒ² − rᵢ²)" },
    `At the bore (r = ${LEN(ri)}): σr = ${MPA(atI.sr)}, σθ = ${MPA(atI.st)}.`,
    `At the outside (r = ${LEN(ro)}): σr = ${MPA(atO.sr)}, σθ = ${MPA(atO.st)}.`,
    ends === "closed" ? `Axial stress (closed ends, uniform away from the ends): σz = A = ${MPA(L.axial)}.` : "Open ends: σz = 0.",
    ...m.lines,
    "Model: Lamé, axisymmetric linear-elastic cylinder of uniform wall, away from its ends.",
    ...convLines(u),
    UNIT_NOTE,
  ];
  const tableR = radii(ri, ro, 4);
  const rows = [["r (mm)", "σr (MPa)", "σθ (MPa)", "σz (MPa)"]];
  for (const x of tableR) {
    const s = lameAt(L, x);
    rows.push([num(x * 1e3, 5), num(s.sr / 1e6, 5), num(s.st / 1e6, 5), num(L.axial / 1e6, 5)]);
  }
  const series: Series[] = [
    { type: "line", color: BLUE, label: "σr", points: rs.map((x) => ({ x: x * 1e3, y: lameAt(L, x).sr / 1e6 })) },
    { type: "line", color: RED, label: "σθ", points: rs.map((x) => ({ x: x * 1e3, y: lameAt(L, x).st / 1e6 })) },
  ];
  if (ends === "closed") series.push({ type: "line", color: GREEN, label: "σz", points: [{ x: ri * 1e3, y: L.axial / 1e6 }, { x: ro * 1e3, y: L.axial / 1e6 }] });
  const svg = buildPlotSvg(series, { width: 420, height: 280, title: "Stresses through the wall (Lamé)", xlabel: "Radius r (mm)", ylabel: "Stress (MPa)" });
  const outputs: EngOutput[] = [
    { key: "srInner", label: "σr at the bore", value: atI.sr / 1e6, unit: "MPa" },
    { key: "stInner", label: "σθ at the bore", value: atI.st / 1e6, unit: "MPa" },
    { key: "srOuter", label: "σr at the outside", value: atO.sr / 1e6, unit: "MPa" },
    { key: "stOuter", label: "σθ at the outside", value: atO.st / 1e6, unit: "MPa" },
    { key: "axial", label: "Axial stress", value: L.axial / 1e6, unit: "MPa" },
    ...m.outputs,
  ];
  return report(
    lines,
    [
      { kind: "table", label: "Stresses through the wall", rows },
      plotOf(svg, `Radial, hoop${ends === "closed" ? " and axial" : ""} stress against radius through the cylinder wall`, "Line plot of stress in MPa against radius in mm for the thick-walled cylinder"),
    ],
    outputs,
  );
}

// ================================================================== 3. shrink fit

function computeShrink(r: (k: string) => string): AnalyzeOutput {
  const u = unitReader(r);
  const a = u.opt("a", "mm", 1e-3, "Shaft bore radius") ?? 0;
  const b = u.req("b", "mm", 1e-3, "Interface radius");
  const c = u.req("c", "mm", 1e-3, "Hub outer radius");
  const delta = u.req("delta", "mm", 1e-3, "Radial interference");
  const Es = u.req("Es", "GPa", 1e9, "Shaft modulus");
  const Eh = u.req("Eh", "GPa", 1e9, "Hub modulus");
  const nus = plain(r("nus"));
  const nuh = plain(r("nuh"));
  if (!Number.isFinite(nus)) u.errors.push("Shaft Poisson's ratio: enter a plain number such as 0.3.");
  if (!Number.isFinite(nuh)) u.errors.push("Hub Poisson's ratio: enter a plain number such as 0.3.");
  const fe = fieldErrors(u);
  if (fe) return fe;
  const res = shrinkFit(a, b, c, delta, { E: Es, nu: nus }, { E: Eh, nu: nuh });
  if (!res.ok) return refuse(res.error);
  const lines: EngLine[] = [
    { math: "δ = p b ((c^2 + b^2)/(c^2 - b^2) + ν_o)/E_o + p b ((b^2 + a^2)/(b^2 - a^2) - ν_i)/E_i", fallback: "δ = p·b·[((c² + b²)/(c² − b²) + νₒ)/Eₒ + ((b² + a²)/(b² − a²) − νᵢ)/Eᵢ]" },
  ];
  if (res.sameMaterial) lines.push({ math: "p = (E δ (c^2 - b^2)(b^2 - a^2))/(2 b^3 (c^2 - a^2))", fallback: "p = E·δ·(c² − b²)(b² − a²)/(2b³(c² − a²))" });
  lines.push(
    `Radial interference δ = ${LEN(delta)} (diametral ${LEN(2 * delta)}).`,
    `Interface pressure p = ${MPA(res.p)}.`,
    `Hub hoop stress at the interface (its peak): ${MPA(res.hubHoopB)}; shaft hoop stress at the interface: ${MPA(res.shaftHoopB)}` +
      (res.shaftHoopA !== null ? `, at the shaft bore: ${MPA(res.shaftHoopA)}.` : " (a solid shaft is under uniform pressure, σr = σθ = −p)."),
    "Model: both parts as Lamé cylinders in plane stress (no axial stress: an open-ended hub of the same length as the fit), linear elastic, the interference shared by the two radial displacements u = r(σθ − νσr)/E. Edge effects at the hub ends raise the real pressure there.",
    ...convLines(u),
    UNIT_NOTE,
  );
  const shaftR = radii(a, b, 30);
  const hubR = radii(b, c, 40);
  const shaftAt = (x: number) => (a === 0 ? { sr: -res.p, st: -res.p } : lameAt(res.shaft, x));
  const series: Series[] = [
    { type: "line", color: BLUE, label: "σr", points: shaftR.map((x) => ({ x: x * 1e3, y: shaftAt(x).sr / 1e6 })) },
    { type: "line", color: BLUE, points: hubR.map((x) => ({ x: x * 1e3, y: lameAt(res.hub, x).sr / 1e6 })) },
    { type: "line", color: RED, label: "σθ", points: shaftR.map((x) => ({ x: x * 1e3, y: shaftAt(x).st / 1e6 })) },
    { type: "line", color: RED, points: hubR.map((x) => ({ x: x * 1e3, y: lameAt(res.hub, x).st / 1e6 })) },
  ];
  const svg = buildPlotSvg(series, {
    width: 420,
    height: 280,
    title: "Shrink-fit stresses, shaft and hub",
    xlabel: "Radius r (mm)",
    ylabel: "Stress (MPa)",
    notes: [
      `Interface at r = ${num(b * 1e3, 5)} mm: σθ jumps there, σr is continuous (−p).` +
        (a === 0 ? " In the solid shaft σr = σθ = −p, so the two lines coincide." : ""),
    ],
  });
  const outputs: EngOutput[] = [
    { key: "p", label: "Interface pressure", value: res.p / 1e6, unit: "MPa" },
    { key: "hubHoop", label: "Hub hoop stress at the interface", value: res.hubHoopB / 1e6, unit: "MPa" },
    { key: "shaftHoop", label: "Shaft hoop stress at the interface", value: res.shaftHoopB / 1e6, unit: "MPa" },
  ];
  if (res.shaftHoopA !== null) outputs.push({ key: "shaftBoreHoop", label: "Shaft hoop stress at the bore", value: res.shaftHoopA / 1e6, unit: "MPa" });
  return report(lines, [plotOf(svg, "Radial and hoop stress against radius across the shaft and the hub of the shrink fit", "Line plot of radial and hoop stress in MPa against radius in mm, with a jump in hoop stress at the interface")], outputs);
}

// ================================================================== 4. rotating disk

function computeDisk(r: (k: string) => string): AnalyzeOutput {
  const u = unitReader(r);
  const rho = u.req("rho", "kg/m^3", 1, "Density");
  const omega = u.req("omega", "rad/s", 1, "Speed");
  const b = u.req("b", "mm", 1e-3, "Outer radius");
  const a = u.opt("a", "mm", 1e-3, "Bore radius") ?? 0;
  const sy = u.opt("sy", "MPa", 1e6, "Yield strength");
  const nu = plain(r("nu"));
  if (!Number.isFinite(nu)) u.errors.push("Poisson's ratio: enter a plain number such as 0.3.");
  const fe = fieldErrors(u);
  if (fe) return fe;
  const d = rotatingDisk(rho, omega, a, b, nu);
  if (!d.ok) return refuse(d.error);
  const rs = radii(a, b, 60);
  const worst = worstState(rs.map((x) => {
    const s = diskAt(d, x);
    return [s.sr, s.st, 0] as [number, number, number];
  }));
  if (typeof worst === "string") return refuse(worst);
  const m = marginOf(worst, sy, "at the most stressed radius (plane stress)");
  if (typeof m === "string") return refuse(m);
  const solid = a === 0;
  const lines: EngLine[] = solid
    ? [
        { math: "σ_r = (3 + ν)/8 ρ ω^2 (b^2 - r^2)", fallback: "σr = (3 + ν)/8·ρω²(b² − r²)" },
        { math: "σ_θ = (ρ ω^2 ((3 + ν) b^2 - (1 + 3 ν) r^2))/8", fallback: "σθ = ρω²/8·[(3 + ν)b² − (1 + 3ν)r²]" },
        `Peak stress at the centre, σr = σθ = ${MPA(d.hoopMax)}; hoop stress at the rim ${MPA(d.hoopRim)}.`,
      ]
    : [
        { math: "σ_r = (3 + ν)/8 ρ ω^2 (a^2 + b^2 - (a^2 b^2)/r^2 - r^2)", fallback: "σr = (3 + ν)/8·ρω²(a² + b² − a²b²/r² − r²)" },
        { math: "σ_θ = (3 + ν)/8 ρ ω^2 (a^2 + b^2 + (a^2 b^2)/r^2 - (1 + 3 ν)/(3 + ν) r^2)", fallback: "σθ = (3 + ν)/8·ρω²(a² + b² + a²b²/r² − (1 + 3ν)r²/(3 + ν))" },
        `Peak hoop stress at the bore: σθ = ${MPA(d.hoopMax)}; peak radial stress ${MPA(d.radialMax)} at r = √(ab) = ${LEN(d.radialMaxAt)}; hoop stress at the rim ${MPA(d.hoopRim)}.`,
      ];
  lines.push(`Speed ω = ${num(omega, 5)} rad/s (${num((omega * 60) / (2 * Math.PI), 5)} rpm).`);
  lines.push(...m.lines);
  const outputs: EngOutput[] = [
    { key: "hoopMax", label: "Peak hoop stress", value: d.hoopMax / 1e6, unit: "MPa" },
    { key: "radialMax", label: "Peak radial stress", value: d.radialMax / 1e6, unit: "MPa" },
    { key: "hoopRim", label: "Hoop stress at the rim", value: d.hoopRim / 1e6, unit: "MPa" },
    ...m.outputs,
  ];
  if (sy !== null && worst.vonMises > 0) {
    // Every stress scales with ω², so first yield (von Mises) is at ω·√(Sy/σvM).
    const wy = omega * Math.sqrt(sy / worst.vonMises);
    lines.push(
      `Speed at first yield (von Mises, elastic): ${num(wy, 4)} rad/s (${num((wy * 60) / (2 * Math.PI), 4)} rpm). This is where yielding starts, not the burst speed: a ductile disk bursts higher, after plastic flow, which this elastic model does not compute.`,
    );
    outputs.push({ key: "omegaYield", label: "Speed at first yield", value: wy, unit: "rad/s" });
  }
  lines.push(
    `Model: thin disk of uniform thickness, plane stress, linear elastic, ${solid ? "solid" : "free (unloaded) bore"}, free rim, no blades or rim load, isothermal.` +
      (solid ? "" : " Even a small bore doubles the centre stress of a solid disk (σθ at a tiny bore → 2 × the solid-disk peak)."),
  );
  lines.push(...convLines(u), UNIT_NOTE);
  const series: Series[] = [
    { type: "line", color: BLUE, label: "σr", points: rs.map((x) => ({ x: x * 1e3, y: diskAt(d, x).sr / 1e6 })) },
    { type: "line", color: RED, label: "σθ", points: rs.map((x) => ({ x: x * 1e3, y: diskAt(d, x).st / 1e6 })) },
  ];
  const svg = buildPlotSvg(series, { width: 420, height: 280, title: solid ? "Rotating solid disk" : "Rotating disk with a free bore", xlabel: "Radius r (mm)", ylabel: "Stress (MPa)" });
  return report(lines, [plotOf(svg, "Radial and hoop stress against radius in the rotating disk", "Line plot of radial and hoop stress in MPa against radius in mm")], outputs);
}

// ================================================================== 5. combined loading

function computeCombined(r: (k: string) => string): AnalyzeOutput {
  const u = unitReader(r);
  const kind = r("section") === "rect" ? "rect" : "circle";
  let section: Section;
  if (kind === "circle") {
    const d = u.req("d", "mm", 1e-3, "Outer diameter");
    const di = u.opt("di", "mm", 1e-3, "Inner diameter") ?? 0;
    section = { kind: "circle", d, di };
  } else {
    const bw = u.req("bw", "mm", 1e-3, "Width b");
    const h = u.req("h", "mm", 1e-3, "Depth h");
    section = { kind: "rect", b: bw, h };
  }
  const P = u.opt("P", "N", 1, "Axial force") ?? 0;
  const M = u.opt("M", "N*m", 1, "Bending moment") ?? 0;
  const T = u.opt("T", "N*m", 1, "Torque") ?? 0;
  const V = u.opt("V", "N", 1, "Transverse shear") ?? 0;
  const L = u.opt("L", "m", 1, "Beam-column length");
  const E = L === null ? null : u.req("E", "GPa", 1e9, "Young's modulus");
  const sy = u.opt("sy", "MPa", 1e6, "Yield strength");
  const fe = fieldErrors(u);
  if (fe) return fe;
  const res = combinedLoad({ section, P, M, T, V, beamColumn: L === null || E === null ? null : { L, E } });
  if (!res.ok) return refuse(res.error);
  const gov = res.governing === "neutral" && res.neutral ? res.neutral : res.outer;
  const m = marginOf(gov.stress, sy, `at the governing point (${res.governing === "neutral" ? "neutral axis" : "outer fibre"})`);
  if (typeof m === "string") return refuse(m);
  const circle = section.kind === "circle";
  const amp = res.amplification !== 1;
  const lines: EngLine[] = [
    { math: amp ? "σ = P/A + (M c)/I · 1/(1 - P/P_cr)" : "σ = P/A + (M c)/I", fallback: amp ? "σ = P/A + (Mc/I)·1/(1 − P/P_cr)" : "σ = P/A + Mc/I" },
  ];
  if (circle) lines.push({ math: "τ = (T c)/J", fallback: "τ = Tc/J" });
  lines.push({ math: "σ_1 = σ/2 + sqrt((σ/2)^2 + τ^2)", fallback: "σ₁ = σ/2 + √((σ/2)² + τ²)" });
  lines.push({ math: "σ_2 = σ/2 - sqrt((σ/2)^2 + τ^2)", fallback: "σ₂ = σ/2 − √((σ/2)² + τ²)" });
  lines.push({ math: "σ_vM = sqrt(σ^2 + 3 τ^2)", fallback: "σvM = √(σ² + 3τ²)" });
  lines.push(
    `Axial stress P/A = ${MPA(res.sigmaAxial)}; bending stress at the outer fibre ${MPA(res.sigmaBend)}${amp ? " (amplified)" : ""}${circle ? `; torsional shear ${MPA(res.tauTorsion)}` : ""}.`,
  );
  const o = res.outer;
  lines.push(
    `Outer fibre (axial and bending add): σ = ${MPA(o.sigma)}, τ = ${MPA(o.tau)}; σ₁ = ${MPA(o.stress.principal[0])}, σ₂ = ${MPA(o.stress.inPlane ? o.stress.inPlane[1] : o.stress.principal[2])}, τmax = ${MPA(o.stress.tauAbsMax)}, von Mises ${MPA(o.stress.vonMises)}.`,
  );
  if (res.neutral) {
    const n = res.neutral;
    lines.push(
      `Neutral axis (transverse shear ${MPA(res.tauShear)}, ${section.kind === "circle" ? (section.di > 0 ? "VQ/(It) mean across the wall" : "4V/3A") : "3V/2A"}${circle ? ", added to the torsional shear on one side" : ""}): σ = ${MPA(n.sigma)}, τ = ${MPA(n.tau)}, von Mises ${MPA(n.stress.vonMises)}.`,
    );
    lines.push(`Governing point: the ${res.governing === "neutral" ? "neutral axis" : "outer fibre"} (larger von Mises stress).`);
  }
  if (res.pcr !== null) {
    lines.push(
      `Beam-column, pinned-pinned L = ${num((L as number), 5)} m: perfect-column P_cr = π²EI/L² = ${num(res.pcr / 1e3, 5)} kN` +
        (res.pcrMin !== null && res.pcrMin < res.pcr ? ` about the bending axis (${num(res.pcrMin / 1e3, 5)} kN about the weak axis, which sets the buckling limit)` : "") +
        (amp ? `; moment amplification 1/(1 − P/P_cr) = ${num(res.amplification, 6)} (the standard approximation; exact for a half-sine moment, slightly low for uniform end moments).` : "."),
    );
    if (res.ampNote) lines.push(res.ampNote);
  }
  lines.push(...m.lines);
  lines.push(
    circle
      ? "Model: straight prismatic round shaft, linear elastic, plane sections; P positive in tension; stress concentrations (shoulders, keyways) not included."
      : "Model: straight prismatic solid rectangle bent about the axis parallel to b (h is the depth), linear elastic; P positive in tension; no torsion (circular sections only).",
  );
  lines.push(...convLines(u), UNIT_NOTE);
  const header = ["Point", "σ (MPa)", "τ (MPa)", "σ₁ (MPa)", "σ₂ (MPa)", "τmax (MPa)", "von Mises (MPa)"];
  const rowOf = (name: string, p: typeof o): string[] => [
    name,
    num(p.sigma / 1e6, 5),
    num(p.tau / 1e6, 5),
    num(p.stress.principal[0] / 1e6, 5),
    num((p.stress.inPlane ? p.stress.inPlane[1] : p.stress.principal[2]) / 1e6, 5),
    num(p.stress.tauAbsMax / 1e6, 5),
    num(p.stress.vonMises / 1e6, 5),
  ];
  const rows = [header, rowOf("Outer fibre", o)];
  if (res.neutral) rows.push(rowOf("Neutral axis", res.neutral));
  const g = gov.stress;
  const svg = mohrCircleSvg({
    sigmaX: gov.sigma / 1e6,
    sigmaY: 0,
    tauXY: gov.tau / 1e6,
    sigma1: (g.inPlane ? g.inPlane[0] : g.principal[0]) / 1e6,
    sigma2: (g.inPlane ? g.inPlane[1] : g.principal[2]) / 1e6,
    centre: (g.mohrCentre ?? 0) / 1e6,
    radius: (g.mohrRadius ?? 0) / 1e6,
    unit: "MPa",
  });
  const s2 = o.stress.inPlane ? o.stress.inPlane[1] : o.stress.principal[2];
  const outputs: EngOutput[] = [
    { key: "sigmaAxial", label: "Axial stress P/A", value: res.sigmaAxial / 1e6, unit: "MPa" },
    { key: "sigmaBend", label: "Bending stress", value: res.sigmaBend / 1e6, unit: "MPa" },
    { key: "sigma", label: "Normal stress at the outer fibre", value: o.sigma / 1e6, unit: "MPa" },
    { key: "tau", label: "Shear stress at the outer fibre", value: o.tau / 1e6, unit: "MPa" },
    { key: "sigma1", label: "σ₁ at the outer fibre", value: o.stress.principal[0] / 1e6, unit: "MPa" },
    { key: "sigma2", label: "σ₂ at the outer fibre", value: s2 / 1e6, unit: "MPa" },
    { key: "tauMax", label: "Maximum shear at the outer fibre", value: o.stress.tauAbsMax / 1e6, unit: "MPa" },
    ...m.outputs.map((x) => (x.key === "vonMises" ? { ...x, key: "vonMisesGoverning", label: "von Mises stress (governing point)" } : x.key === "tresca" ? { ...x, key: "trescaGoverning", label: "Tresca stress (governing point)" } : x)),
    { key: "vonMises", label: "von Mises stress at the outer fibre", value: o.stress.vonMises / 1e6, unit: "MPa" },
  ];
  if (res.neutral) outputs.push({ key: "vonMisesNeutral", label: "von Mises stress at the neutral axis", value: res.neutral.stress.vonMises / 1e6, unit: "MPa" });
  if (res.pcr !== null) {
    outputs.push({ key: "pcr", label: "Critical load P_cr (bending axis)", value: res.pcr / 1e3, unit: "kN" });
    outputs.push({ key: "amplification", label: "Moment amplification", value: res.amplification, unit: "" });
  }
  return report(
    lines,
    [
      { kind: "table", label: "Stress state at the critical points", rows },
      plotOf(svg, `Mohr's circle at the governing point (${res.governing === "neutral" ? "neutral axis" : "outer fibre"})`, "Mohr's circle of the plane stress state with the principal stresses and the maximum shear marked"),
    ],
    outputs,
  );
}

// ================================================================== 6. Hertz contact

function computeHertz(r: (k: string) => string): AnalyzeOutput {
  const u = unitReader(r);
  const geom = r("geom") || "sphere-flat";
  if (!["sphere-sphere", "sphere-flat", "cyl-cyl", "cyl-flat"].includes(geom)) return refuse("Choose a contact geometry.");
  const sphere = geom.startsWith("sphere");
  const flat = geom.endsWith("flat");
  const F = u.req("F", "N", 1, "Normal load");
  const R1 = u.req("R1", "mm", 1e-3, "Radius of body 1");
  const R2 = flat ? null : u.req("R2", "mm", 1e-3, "Radius of body 2");
  const L = sphere ? null : u.req("L", "mm", 1e-3, "Contact length");
  const E1 = u.req("E1", "GPa", 1e9, "Modulus of body 1");
  const E2 = u.req("E2", "GPa", 1e9, "Modulus of body 2");
  const nu1 = plain(r("nu1"));
  const nu2 = plain(r("nu2"));
  if (!Number.isFinite(nu1)) u.errors.push("Poisson's ratio of body 1: enter a plain number such as 0.3.");
  if (!Number.isFinite(nu2)) u.errors.push("Poisson's ratio of body 2: enter a plain number such as 0.3.");
  const fe = fieldErrors(u);
  if (fe) return fe;
  const b1: ContactBody = { E: E1, nu: nu1 };
  const b2: ContactBody = { E: E2, nu: nu2 };
  const res = sphere ? hertzSphere(F, R1, R2, b1, b2) : hertzCylinder(F, L as number, R1, R2, b1, b2);
  if (!res.ok) return refuse(res.error);
  const half = "a" in res ? res.a : res.b;
  const sym = sphere ? "a" : "b";
  const shearLine = (s: SubsurfaceShear, which: string, nu: number): string =>
    s.depthOverA === 0
      ? `Maximum shear in ${which} (ν = ${num(nu, 3)}): ${MPA(s.tauOverP0 * res.p0)} = ${fmtSig(s.tauOverP0, 3)} p₀, at the surface.`
      : `Maximum shear in ${which} (ν = ${num(nu, 3)}): ${MPA(s.tauOverP0 * res.p0)} = ${fmtSig(s.tauOverP0, 3)} p₀, below the surface at z = ${fmtSig(s.depthOverA, 3)} ${sym} = ${LEN(s.depthOverA * half)}.`;
  const lines: EngLine[] = [
    { math: "1/E_eff = (1 - ν_1^2)/E_1 + (1 - ν_2^2)/E_2", fallback: "1/E* = (1 − ν₁²)/E₁ + (1 − ν₂²)/E₂" },
    { math: "1/R = 1/R_1 + 1/R_2", fallback: "1/R = 1/R₁ + 1/R₂" },
  ];
  if ("a" in res) {
    lines.push({ math: "a = root(3, (3 F R)/(4 E_eff))", fallback: "a = ∛(3FR/(4E*))" });
    lines.push({ math: "p_0 = (3 F)/(2 π a^2)", fallback: "p₀ = 3F/(2πa²)" });
    lines.push({ math: "δ = a^2/R", fallback: "δ = a²/R" });
  } else {
    lines.push({ math: "b = sqrt((4 F R)/(π L E_eff))", fallback: "b = √(4FR/(πLE*))" });
    lines.push({ math: "p_0 = (2 F)/(π b L)", fallback: "p₀ = 2F/(πbL)" });
  }
  lines.push(`Effective modulus E* = ${num(res.Estar / 1e9, 6)} GPa; R = ${LEN(res.R)}${flat ? " (second body flat)" : ""}.`);
  if ("a" in res) {
    lines.push(`Contact radius a = ${LEN(res.a)}; peak pressure p₀ = ${MPA(res.p0, 6)}; mean pressure ${MPA(res.pMean)}; mutual approach δ = ${LEN(res.delta)}.`);
  } else {
    lines.push(`Load per length F/L = ${num(res.Fl / 1e3, 5)} N/mm; half-width b = ${LEN(res.b)} (contact strip 2b = ${LEN(2 * res.b)} wide); peak pressure p₀ = ${MPA(res.p0, 6)}; mean pressure ${MPA(res.pMean)}.`);
    lines.push("The approach of two cylinders is not given: in line contact it depends on the bodies' overall size, which Hertz theory does not fix.");
  }
  const sameNu = nu1 === nu2;
  lines.push(shearLine(res.shear1, sameNu ? "both bodies" : "body 1", nu1));
  if (!sameNu) lines.push(shearLine(res.shear2, "body 2", nu2));
  lines.push(
    `Model: Hertz, smooth frictionless linear-elastic bodies, contact ${sphere ? "radius" : "half-width"} small against the radii, ${sphere ? "point contact" : "line contact (plane strain, uniform along L, no end effects)"}; subsurface shear on the load axis from the exact Hertz field for each body's ν.`,
  );
  lines.push(...convLines(u), UNIT_NOTE);
  // Figure 1: the pressure distribution, normalised.
  // Cosine-spaced inside the contact, so the vertical tangent at the edges is drawn smoothly.
  const inside = Array.from({ length: 121 }, (_, i) => -Math.cos((Math.PI * i) / 120));
  const pPoints = [{ x: -1.4, y: 0 }, ...inside.map((x) => ({ x, y: Math.sqrt(Math.max(0, 1 - x * x)) })), { x: 1.4, y: 0 }];
  const pSeries: Series[] = [{ type: "line", color: BLUE, points: pPoints }];
  const pSvg = buildPlotSvg(pSeries, {
    width: 420,
    height: 260,
    title: "Hertz contact pressure",
    xlabel: sphere ? "Position across a diameter, x/a" : "Position across the strip, x/b",
    ylabel: "p/p₀",
    notes: [`p₀ = ${MPA(res.p0)}, ${sym} = ${LEN(half)}`],
  });
  // Figure 2: the shear on the axis against depth (depth drawn downward).
  const zs = Array.from({ length: 121 }, (_, i) => (2.5 * i) / 120);
  const tSeries: Series[] = [
    { type: "line", color: RED, label: sameNu ? `ν = ${num(nu1, 3)}` : `body 1, ν = ${num(nu1, 3)}`, points: zs.map((z) => ({ x: axisShear(sphere ? "sphere" : "cylinder", nu1, z), y: -z })) },
  ];
  if (!sameNu) tSeries.push({ type: "line", color: GREEN, label: `body 2, ν = ${num(nu2, 3)}`, points: zs.map((z) => ({ x: axisShear(sphere ? "sphere" : "cylinder", nu2, z), y: -z })) });
  tSeries.push({ type: "scatter", color: RED, points: [{ x: res.shear1.tauOverP0, y: -res.shear1.depthOverA }] });
  if (!sameNu) tSeries.push({ type: "scatter", color: GREEN, points: [{ x: res.shear2.tauOverP0, y: -res.shear2.depthOverA }] });
  const yl = rowLabeller(tSeries, "y", true);
  // The peak is the point of the figure: the axis runs from 0 to a round value past it, never ending on it.
  const tauTop = Math.max(res.shear1.tauOverP0, res.shear2.tauOverP0);
  const xTop = Math.ceil((tauTop * 1.08) / 0.05) * 0.05;
  const tSvg = buildPlotSvg(tSeries, {
    width: 420,
    height: 280,
    title: "Shear stress below the contact (on the axis)",
    xlabel: "Maximum shear τ/p₀",
    ylabel: titleWithMultiplier(`Depth z/${sym}`, yl?.multiplier ?? ""),
    yTickLabel: yl?.label,
    xLimits: { min: 0, max: xTop },
  });
  const outputs: EngOutput[] = [
    { key: "Estar", label: "Effective modulus E*", value: res.Estar / 1e9, unit: "GPa" },
    { key: sphere ? "a" : "b", label: sphere ? "Contact radius a" : "Contact half-width b", value: half * 1e3, unit: "mm" },
    { key: "p0", label: "Peak contact pressure p₀", value: res.p0 / 1e6, unit: "MPa" },
    { key: "pMean", label: "Mean contact pressure", value: res.pMean / 1e6, unit: "MPa" },
    { key: "tauMax", label: "Maximum subsurface shear (body 1)", value: (res.shear1.tauOverP0 * res.p0) / 1e6, unit: "MPa" },
    { key: "tauDepth", label: "Depth of the maximum shear (body 1)", value: res.shear1.depthOverA * half * 1e3, unit: "mm" },
  ];
  if ("a" in res) outputs.push({ key: "delta", label: "Mutual approach δ", value: res.delta * 1e6, unit: "µm" });
  return report(
    lines,
    [
      plotOf(pSvg, `Hertz pressure distribution p/p₀ = √(1 − (${sphere ? "x/a" : "x/b"})²) across the contact`, "Semi-elliptical contact pressure, normalised by the peak pressure, against normalised position"),
      plotOf(tSvg, "Maximum shear stress on the load axis against depth below the surface, with its peak marked", "Line plot of normalised shear stress against normalised depth, depth increasing downward"),
    ],
    outputs,
  );
}

// ================================================================== registry

const SHAPES = [
  { value: "cylinder-closed", label: "Cylinder, closed ends" },
  { value: "cylinder-open", label: "Cylinder, open ends" },
  { value: "sphere", label: "Sphere" },
];

export const VESSELS_CALCS: EngCalcDef<VesselsGroup>[] = [
  {
    id: "vessel-thin-wall",
    name: "Thin-walled pressure vessel",
    group: "Structural & solids",
    hint: "Hoop and axial membrane stress of a thin cylinder or sphere under internal pressure (r = inner radius, t/r ≤ 0.1), with an optional yield margin.",
    unitContract: "converts",
    fields: [
      { key: "shape", label: "Vessel", default: "cylinder-closed", kind: "select", options: SHAPES },
      { key: "p", label: "Internal pressure (MPa)", default: "2", kind: "text" },
      { key: "r", label: "Inner radius (mm)", default: "500", kind: "text" },
      { key: "t", label: "Wall thickness (mm)", default: "10", kind: "text" },
      { key: "sy", label: "Yield strength (MPa, optional)", default: "250", kind: "text" },
    ],
    compute: (r) => computeThin(r),
  },
  {
    id: "vessel-lame",
    name: "Thick-walled cylinder (Lamé)",
    group: "Structural & solids",
    hint: "Radial, hoop and axial stress through the wall of a thick cylinder under internal and external pressure.",
    unitContract: "converts",
    fields: [
      { key: "ri", label: "Inner radius (mm)", default: "50", kind: "text" },
      { key: "ro", label: "Outer radius (mm)", default: "100", kind: "text" },
      { key: "pi", label: "Internal pressure (MPa)", default: "100", kind: "text" },
      { key: "po", label: "External pressure (MPa)", default: "0", kind: "text" },
      { key: "ends", label: "Ends", default: "closed", kind: "select", options: [{ value: "closed", label: "Closed (axial stress from the end caps)" }, { value: "open", label: "Open (no axial stress)" }] },
      { key: "sy", label: "Yield strength (MPa, optional)", default: "", kind: "text" },
    ],
    compute: (r) => computeLame(r),
  },
  {
    id: "vessel-shrink-fit",
    name: "Shrink / press fit",
    group: "Structural & solids",
    hint: "Interface pressure and hub/shaft stresses from a RADIAL interference, solid or hollow shaft, same or different materials.",
    unitContract: "converts",
    fields: [
      { key: "b", label: "Interface radius b (mm)", default: "50", kind: "text" },
      { key: "c", label: "Hub outer radius c (mm)", default: "100", kind: "text" },
      { key: "a", label: "Shaft bore radius a (mm, 0 = solid)", default: "0", kind: "text" },
      { key: "delta", label: "Radial interference δ (mm, half the diametral)", default: "0.02", kind: "text" },
      { key: "Es", label: "Shaft modulus (GPa)", default: "200", kind: "text" },
      { key: "nus", label: "Shaft Poisson's ratio", default: "0.3", kind: "text" },
      { key: "Eh", label: "Hub modulus (GPa)", default: "200", kind: "text" },
      { key: "nuh", label: "Hub Poisson's ratio", default: "0.3", kind: "text" },
    ],
    compute: (r) => computeShrink(r),
  },
  {
    id: "vessel-rotating-disk",
    name: "Rotating disk",
    group: "Structural & solids",
    hint: "Radial and hoop stress of a spinning disk of uniform thickness, solid or with a free bore; speed in rad/s or rpm; optional yield margin and first-yield speed.",
    unitContract: "converts",
    fields: [
      { key: "rho", label: "Density (kg/m³)", default: "7850", kind: "text" },
      { key: "omega", label: "Speed (rad/s, or write rpm)", default: "1000", kind: "text" },
      { key: "b", label: "Outer radius (mm)", default: "200", kind: "text" },
      { key: "a", label: "Bore radius (mm, 0 = solid)", default: "0", kind: "text" },
      { key: "nu", label: "Poisson's ratio", default: "0.3", kind: "text" },
      { key: "sy", label: "Yield strength (MPa, optional)", default: "", kind: "text" },
    ],
    compute: (r) => computeDisk(r),
  },
  {
    id: "combined-loading",
    name: "Combined loading (shaft, beam-column)",
    group: "Structural & solids",
    hint: "Axial force, bending, torque and transverse shear on a round shaft (or axial + bending + shear on a rectangle): principal stresses, max shear, von Mises, Tresca, Mohr's circle; optional pinned beam-column amplification.",
    unitContract: "converts",
    fields: [
      { key: "section", label: "Section", default: "circle", kind: "select", options: [{ value: "circle", label: "Round (solid or hollow)" }, { value: "rect", label: "Solid rectangle (no torque)" }] },
      { key: "d", label: "Outer diameter (mm)", default: "50", kind: "text" },
      { key: "di", label: "Inner diameter (mm, 0 = solid)", default: "0", kind: "text" },
      { key: "bw", label: "Rectangle width b (mm)", default: "20", kind: "text" },
      { key: "h", label: "Rectangle depth h (mm, in the bending plane)", default: "40", kind: "text" },
      { key: "P", label: "Axial force (N, tension +, compression −)", default: "10 kN", kind: "text" },
      { key: "M", label: "Bending moment (N·m)", default: "500", kind: "text" },
      { key: "T", label: "Torque (N·m)", default: "400", kind: "text" },
      { key: "V", label: "Transverse shear (N, optional)", default: "", kind: "text" },
      { key: "L", label: "Beam-column length, pinned ends (m, optional)", default: "", kind: "text" },
      { key: "E", label: "Young's modulus (GPa, for the beam-column)", default: "200", kind: "text" },
      { key: "sy", label: "Yield strength (MPa, optional)", default: "", kind: "text" },
    ],
    compute: (r) => computeCombined(r),
  },
  {
    id: "hertz-contact",
    name: "Hertz contact stress",
    group: "Fatigue & machine design",
    hint: "Sphere or cylinder on a sphere, cylinder or flat: contact radius or half-width, peak pressure, approach, and the subsurface maximum shear for each body's ν.",
    unitContract: "converts",
    fields: [
      { key: "geom", label: "Geometry", default: "sphere-flat", kind: "select", options: [{ value: "sphere-flat", label: "Sphere on a flat" }, { value: "sphere-sphere", label: "Sphere on a sphere" }, { value: "cyl-flat", label: "Cylinder on a flat (line contact)" }, { value: "cyl-cyl", label: "Parallel cylinders (line contact)" }] },
      { key: "F", label: "Normal load (N)", default: "100", kind: "text" },
      { key: "R1", label: "Radius of body 1 (mm)", default: "10", kind: "text" },
      { key: "R2", label: "Radius of body 2 (mm, not used for a flat)", default: "10", kind: "text" },
      { key: "L", label: "Contact length (mm, cylinders)", default: "10", kind: "text" },
      { key: "E1", label: "Modulus of body 1 (GPa)", default: "210", kind: "text" },
      { key: "nu1", label: "Poisson's ratio of body 1", default: "0.3", kind: "text" },
      { key: "E2", label: "Modulus of body 2 (GPa)", default: "210", kind: "text" },
      { key: "nu2", label: "Poisson's ratio of body 2", default: "0.3", kind: "text" },
    ],
    compute: (r) => computeHertz(r),
  },
];
