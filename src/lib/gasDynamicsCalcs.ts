// Pane glue for the compressible-flow calculators beyond the isentropic relations (Release E, gap #11): normal shock,
// oblique shock and Prandtl–Meyer expansion, Fanno flow and Rayleigh flow, in the existing "Fluids" group beside the
// isentropic tool. Every number comes from gasDynamics.ts (whose isentropic ratios come from fluids.ts
// compressibleFlow); this file reads the fields — dimensional ones through the unit layer (units.ts parseMeasured),
// Mach numbers, γ and friction factors as plain numbers with any unit refused — words the result under the display
// contract (U+2212, sub/superscripts, ×10ⁿ, no em dash, NaN or Infinity) and draws.

import type { EngCalcDef } from "./engCalc";
import type { AnalyzeOutput, AnalyzeBlock, EngOutput } from "./analyzeBlocks";
import { engReport, type EngLine } from "./engReport";
import { parseMeasured } from "./units";
import { fmtSig, MINUS } from "./axis";
import { trueMinus } from "./numberList";
import { compressibleFlow } from "./fluids";
import {
  normalShock,
  obliqueShock,
  prandtlMeyer,
  fanno,
  rayleigh,
  checkGamma,
  type FannoState,
  type RayleighState,
} from "./gasDynamics";
import { normalShockSvg, thetaBetaSvg, prandtlMeyerSvg, fannoSvg, rayleighSvg, type GdFigure } from "./gasDynamicsCharts";

// ------------------------------------------------------------------ helpers

const UNIT_NOTE =
  "Units: a bare number is read in the unit its field names; write another (101.325 kPa or 14.7 psi, 15 °C, " +
  "2 in, 0.1 rad) and it is converted, and a unit of the wrong quantity is refused. Mach numbers, γ and friction " +
  "factors are dimensionless.";

const ASSUMPTION = "Calorically perfect gas (constant γ); in air, real-gas effects matter above about Mach 5.";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "–")), ok: false });

/** Significant figures, trailing zeros dropped, ×10ⁿ outside 10⁻³…10⁶, U+2212. */
function num(v: number, sig = 5): string {
  if (!Number.isFinite(v)) return "not finite";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e6) return (v < 0 ? MINUS : "") + String(Number(a.toPrecision(sig)));
  return fmtSig(v, sig);
}
/** An angle in degrees to four decimals. */
const deg = (v: number): string => `${num(v, 6)}°`;

/** Unit-aware field reading: errors collected, conversions reported (the pattern of titrationCalcs.ts). */
function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, si: string, label: string, required: boolean): number | null => {
    const raw = (r(key) ?? "").trim().replace(/−/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const m = parseMeasured(raw, si);
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (!m.assumed && m.inTarget !== m.value) {
      conversions.push(`${label}: ${num(m.value, 7)} ${m.unit} = ${num(m.inTarget, 7)} ${si.replace("*", "·")} (converted).`);
    }
    return m.inTarget;
  };
  /** A dimensionless field: a plain number, any unit refused. */
  const plain = (key: string, label: string, required: boolean): number | null => {
    const raw = (r(key) ?? "").trim().replace(/−/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const v = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isFinite(v)) {
      // "NaN"/"Infinity" are not echoed (the display contract keeps them out of every result).
      const shown = /nan|inf/i.test(raw) ? "this" : `"${raw}"`;
      errors.push(`${label}: ${shown} is not a plain finite number (this quantity is dimensionless; write it without a unit).`);
      return NaN;
    }
    return v;
  };
  return {
    errors,
    conversions,
    req: (key: string, si: string, label: string): number => read(key, si, label, true) as number,
    opt: (key: string, si: string, label: string): number | null => read(key, si, label, false),
    num: (key: string, label: string): number => plain(key, label, true) as number,
    optNum: (key: string, label: string): number | null => plain(key, label, false),
  };
}

/** γ from its field: refused by name outside 1 < γ ≤ 5/3. */
function readGamma(u: ReturnType<typeof unitReader>): number {
  const g = u.num("gamma", "Specific-heat ratio γ");
  if (Number.isFinite(g)) {
    const e = checkGamma(g);
    if (e) u.errors.push(e.error);
  }
  return g;
}

function plot(fig: GdFigure, caption: string, alt: string): AnalyzeBlock {
  return { kind: "plot", svg: fig.svg, caption, alt, w: fig.w, h: fig.h };
}

function finish(lines: EngLine[], extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput {
  const clean = lines.map((l) => (typeof l === "string" ? trueMinus(l) : { math: l.math, fallback: trueMinus(l.fallback) }));
  return { ...engReport(clean, extra), outputs };
}

const out = (key: string, label: string, value: number, unit = ""): EngOutput => ({ key, label, value, unit });

const GAMMA_FIELD = { key: "gamma", label: "Specific-heat ratio γ (1 < γ ≤ 5/3; air 1.4)", default: "1.4", kind: "text" as const };

// ------------------------------------------------------------------ 1. normal shock

const normalShockCalc: EngCalcDef<"Fluids"> = {
  id: "gd-normal-shock",
  name: "Normal shock",
  group: "Fluids",
  unitContract: "converts",
  hint:
    "The jump across a normal shock in a calorically perfect gas: from the upstream Mach number M₁ (> 1), the " +
    "downstream M₂ and the pressure, temperature, density and total-pressure ratios. Give the upstream static " +
    "pressure and temperature (and the gas constant) for the dimensional states and velocities; leave them blank " +
    "for ratios only. " + UNIT_NOTE,
  fields: [
    { key: "M1", label: "Upstream Mach number M₁", default: "2", kind: "text" },
    GAMMA_FIELD,
    { key: "p1", label: "Upstream static pressure p₁, Pa (blank for ratios only)", default: "101.325 kPa", kind: "text" },
    { key: "T1", label: "Upstream static temperature T₁, K (blank for ratios only)", default: "288.15", kind: "text" },
    { key: "R", label: "Gas constant R, J/(kg·K) (dry air 287.05)", default: "287.05", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const M1 = u.num("M1", "Upstream Mach number M₁");
    const g = readGamma(u);
    const p1 = u.opt("p1", "Pa", "Upstream static pressure");
    const T1 = u.opt("T1", "K", "Upstream static temperature");
    const R = u.opt("R", "J/(kg*K)", "Gas constant");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    if (p1 !== null && !(p1 > 0)) return refuse("Upstream static pressure: an absolute pressure must be greater than 0.");
    if (T1 !== null && !(T1 > 0)) return refuse("Upstream static temperature: an absolute temperature must be greater than 0 K.");
    if (R !== null && !(R > 0)) return refuse("Gas constant: R must be greater than 0.");
    const res = normalShock(M1, g);
    if (!res.ok) return refuse(res.error);

    const lines: EngLine[] = [
      `Normal shock at M₁ = ${num(M1)}, γ = ${num(g)}: M₂ = ${num(res.M2)}.`,
      `p₂/p₁ = ${num(res.p2p1)}, T₂/T₁ = ${num(res.T2T1)}, ρ₂/ρ₁ = ${num(res.rho2rho1)}, p₀₂/p₀₁ = ${num(res.p02p01)} (${num(100 * (1 - res.p02p01), 3)}% of the total pressure lost); pitot p₀₂/p₁ = ${num(res.p02p1)}.`,
      { math: "M_2^2 = (1 + ((γ - 1)/2) M_1^2)/(γ M_1^2 - (γ - 1)/2)", fallback: "M₂² = (1 + ((γ − 1)/2)M₁²)/(γM₁² − (γ − 1)/2)" },
      { math: "p_2/p_1 = 1 + (2γ)/(γ + 1) (M_1^2 - 1)", fallback: "p₂/p₁ = 1 + 2γ/(γ + 1)·(M₁² − 1)" },
      { math: "ρ_2/ρ_1 = ((γ + 1) M_1^2)/((γ - 1) M_1^2 + 2)", fallback: "ρ₂/ρ₁ = (γ + 1)M₁²/((γ − 1)M₁² + 2)" },
      { math: "p_02/p_01 = (p_2 (p_0/p)(M_2))/(p_1 (p_0/p)(M_1))", fallback: "p₀₂/p₀₁ = (p₂/p₁)·(p₀/p)(M₂)/(p₀/p)(M₁), the isentropic ratios from the compressible-flow tool" },
    ];
    const outputs: EngOutput[] = [
      out("M2", "Downstream Mach number M₂", res.M2),
      out("p2p1", "Static pressure ratio p₂/p₁", res.p2p1),
      out("T2T1", "Static temperature ratio T₂/T₁", res.T2T1),
      out("rho2rho1", "Density ratio ρ₂/ρ₁", res.rho2rho1),
      out("p02p01", "Total-pressure ratio p₀₂/p₀₁", res.p02p01),
    ];
    const rows: string[][] = [["Quantity", "Upstream (1)", "Downstream (2)", "Ratio 2/1"]];
    rows.push(["Mach number", num(M1), num(res.M2), num(res.M2 / M1)]);
    const dim = p1 !== null && T1 !== null && R !== null;
    if (dim) {
      const p2 = p1 * res.p2p1, T2 = T1 * res.T2T1;
      const rho1 = p1 / (R * T1), rho2 = rho1 * res.rho2rho1;
      const V1 = M1 * Math.sqrt(g * R * T1), V2 = res.M2 * Math.sqrt(g * R * T2);
      const p01 = p1 * compressibleFlowP0p(M1, g), p02 = p01 * res.p02p01;
      rows.push(["Static pressure (kPa)", num(p1 / 1000), num(p2 / 1000), num(res.p2p1)]);
      rows.push(["Static temperature (K)", num(T1), num(T2), num(res.T2T1)]);
      rows.push(["Density (kg/m³)", num(rho1), num(rho2), num(res.rho2rho1)]);
      rows.push(["Velocity (m/s)", num(V1), num(V2), num(V2 / V1)]);
      rows.push(["Total pressure (kPa)", num(p01 / 1000), num(p02 / 1000), num(res.p02p01)]);
      lines.push(
        `Upstream p₁ = ${num(p1 / 1000, 7)} kPa, T₁ = ${num(T1, 7)} K → downstream p₂ = ${num(p2 / 1000)} kPa, T₂ = ${num(T2)} K; ` +
          `velocity ${num(V1)} → ${num(V2)} m/s (a = √(γRT), R = ${num(R)} J/(kg·K)).`,
      );
      outputs.push(out("p2", "Downstream static pressure p₂", p2 / 1000, "kPa"), out("T2", "Downstream static temperature T₂", T2, "K"));
      outputs.push(out("V1", "Upstream velocity V₁", V1, "m/s"), out("V2", "Downstream velocity V₂", V2, "m/s"));
    } else {
      rows.push(["Static pressure", "", "", num(res.p2p1)]);
      rows.push(["Static temperature", "", "", num(res.T2T1)]);
      rows.push(["Density", "", "", num(res.rho2rho1)]);
      rows.push(["Total pressure", "", "", num(res.p02p01)]);
      if (p1 !== null || T1 !== null) lines.push("Give p₁, T₁ and R together for the dimensional states; ratios only were computed.");
    }
    lines.push(...u.conversions);
    lines.push(`${ASSUMPTION} The shock is adiabatic: T₀ is unchanged and the entropy rises, so p₀ falls.`);
    const fig = normalShockSvg(M1, g);
    return finish(lines, [
      { kind: "table", label: "Normal shock", rows },
      plot(fig, `Normal-shock ratios against M₁ (γ = ${num(g)}), M₁ = ${num(M1)} marked`, "Pressure, density and temperature ratios, downstream Mach number and total-pressure recovery across a normal shock against upstream Mach number"),
    ], outputs);
  },
};

/** p₀/p at M from the isentropic tool (fluids.ts), for the total pressures. */
function compressibleFlowP0p(M: number, g: number): number {
  const r = compressibleFlow(M, g);
  return r.ok ? r.pressureRatio : NaN;
}

// ------------------------------------------------------------------ 2. oblique shock / Prandtl–Meyer

const obliqueCalc: EngCalcDef<"Fluids"> = {
  id: "gd-oblique-pm",
  name: "Oblique shock & Prandtl–Meyer expansion",
  group: "Fluids",
  unitContract: "converts",
  hint:
    "Supersonic flow turned by a wall. COMPRESSION corner: the θ–β–M relation gives the weak (the one usually seen) " +
    "and strong shock angles β, M₂, the ratios and the maximum deflection θmax; beyond θmax the shock detaches. " +
    "EXPANSION corner: the Prandtl–Meyer function ν(M) and the Mach number after turning the flow by θ (isentropic). " +
    UNIT_NOTE,
  fields: [
    {
      key: "mode",
      label: "Corner",
      default: "shock",
      kind: "select",
      options: [
        { value: "shock", label: "Compression corner: oblique shock (θ–β–M)" },
        { value: "expansion", label: "Expansion corner: Prandtl–Meyer fan" },
      ],
    },
    { key: "M1", label: "Upstream Mach number M₁", default: "2", kind: "text" },
    { key: "theta", label: "Turning angle θ, degrees (blank in expansion mode for ν(M₁) only)", default: "10", kind: "text" },
    GAMMA_FIELD,
  ],
  compute: (r) => {
    const u = unitReader(r);
    const mode = r("mode") === "expansion" ? "expansion" : "shock";
    const M1 = u.num("M1", "Upstream Mach number M₁");
    const g = readGamma(u);
    const th = mode === "shock" ? u.req("theta", "°", "Turning angle θ") : u.opt("theta", "°", "Turning angle θ");
    if (u.errors.length) return refuse(u.errors.join("\n"));

    if (mode === "shock") {
      const res = obliqueShock(M1, th as number, g);
      if (!res.ok) return refuse(res.error);
      const pm = prandtlMeyer(M1, null, g);
      const w = res.weak, s = res.strong;
      const single = Math.abs(w.betaDeg - s.betaDeg) < 1e-9;
      const lines: EngLine[] = [
        `Oblique shock at M₁ = ${num(M1)}, θ = ${deg(res.thetaDeg)}, γ = ${num(g)}: weak β = ${deg(w.betaDeg)}, strong β = ${deg(s.betaDeg)}; θmax = ${deg(res.thetaMaxDeg)} (at β = ${deg(res.betaMaxDeg)}).`,
        `Weak shock: M₂ = ${num(w.M2)}${w.M2 < 1 ? " (subsonic behind the weak shock: θ is close to θmax)" : ""}, p₂/p₁ = ${num(w.p2p1)}, T₂/T₁ = ${num(w.T2T1)}, p₀₂/p₀₁ = ${num(w.p02p01)}.`,
        single
          ? "At θmax the weak and strong solutions coincide."
          : `Strong shock: M₂ = ${num(s.M2)}, p₂/p₁ = ${num(s.p2p1)}, p₀₂/p₀₁ = ${num(s.p02p01)}. The weak solution is the one normally observed at a wedge or ramp; the strong one needs a high back pressure.`,
        { math: "tan θ = 2 cot β (M_1^2 sin^2 β - 1)/(M_1^2 (γ + cos 2β) + 2)", fallback: "tan θ = 2 cot β (M₁² sin²β − 1)/(M₁²(γ + cos 2β) + 2)" },
        { math: "M_n1 = M_1 sin β", fallback: "Mₙ₁ = M₁ sin β" },
        { math: "M_2 = M_n2/sin(β - θ)", fallback: "M₂ = Mₙ₂/sin(β − θ), with Mₙ₂ from the normal-shock relations at Mₙ₁" },
      ];
      if (pm.ok) lines.push(`Mach angle μ = ${deg(res.muDeg)}; Prandtl–Meyer ν(M₁) = ${deg(pm.nu1Deg)}.`);
      lines.push(...u.conversions, ASSUMPTION);
      const rows = [
        ["Solution", "β (°)", "Mₙ₁", "M₂", "p₂/p₁", "T₂/T₁", "ρ₂/ρ₁", "p₀₂/p₀₁"],
        ...[["Weak", w], ["Strong", s]].map(([n, x]) => {
          const v = x as typeof w;
          return [n as string, num(v.betaDeg, 6), num(v.Mn1), num(v.M2), num(v.p2p1), num(v.T2T1), num(v.rho2rho1), num(v.p02p01)];
        }),
      ];
      const fig = thetaBetaSvg(M1, g, { thetaDeg: res.thetaDeg, weakDeg: w.betaDeg, strongDeg: s.betaDeg });
      return finish(lines, [
        { kind: "table", label: "Oblique shock", rows },
        plot(fig, `θ–β–M chart (γ = ${num(g)}) with the M₁ = ${num(M1)}, θ = ${deg(res.thetaDeg)} solutions marked`, "Shock angle against flow deflection for several Mach numbers, with the maximum-deflection locus and the weak and strong solutions marked"),
      ], [
        out("betaWeak", "Weak shock angle β", w.betaDeg, "°"),
        out("betaStrong", "Strong shock angle β", s.betaDeg, "°"),
        out("M2", "Downstream Mach number M₂ (weak)", w.M2),
        out("p2p1", "Pressure ratio p₂/p₁ (weak)", w.p2p1),
        out("p02p01", "Total-pressure ratio p₀₂/p₀₁ (weak)", w.p02p01),
        out("M2strong", "Downstream Mach number M₂ (strong)", s.M2),
        out("p2p1strong", "Pressure ratio p₂/p₁ (strong)", s.p2p1),
        out("thetaMax", "Maximum deflection θmax", res.thetaMaxDeg, "°"),
      ]);
    }

    const res = prandtlMeyer(M1, th, g);
    if (!res.ok) return refuse(res.error);
    const lines: EngLine[] = [`Prandtl–Meyer at M₁ = ${num(M1)}, γ = ${num(g)}: ν(M₁) = ${deg(res.nu1Deg)}; νmax = ${deg(res.nuMaxDeg)}.`];
    const outputs: EngOutput[] = [out("nu1", "Prandtl–Meyer angle ν(M₁)", res.nu1Deg, "°"), out("nuMax", "Maximum turning νmax", res.nuMaxDeg, "°")];
    const rows: string[][] = [["State", "M", "ν (°)", "μ (°)", "p/p₁", "T/T₁", "ρ/ρ₁"], ["Upstream (1)", num(M1), num(res.nu1Deg, 6), num(res.mu1Deg, 6), "1", "1", "1"]];
    if (res.M2 !== undefined) {
      lines.push(
        `Turning θ = ${deg(res.turnDeg!)}: ν₂ = ν(M₁) + θ = ${deg(res.nu2Deg!)} → M₂ = ${num(res.M2)}, p₂/p₁ = ${num(res.p2p1!)}, T₂/T₁ = ${num(res.T2T1!)}, ρ₂/ρ₁ = ${num(res.rho2rho1!)}.`,
        `The fan is bounded by Mach lines at μ₁ = ${deg(res.mu1Deg)} and μ₂ = ${deg(res.mu2Deg!)} to the local flow; the expansion is isentropic (p₀ and T₀ unchanged).`,
      );
      rows.push(["Expanded (2)", num(res.M2), num(res.nu2Deg!, 6), num(res.mu2Deg!, 6), num(res.p2p1!), num(res.T2T1!), num(res.rho2rho1!)]);
      outputs.push(out("M2", "Expanded Mach number M₂", res.M2), out("nu2", "ν(M₂)", res.nu2Deg!, "°"), out("p2p1", "Pressure ratio p₂/p₁", res.p2p1!), out("T2T1", "Temperature ratio T₂/T₁", res.T2T1!));
    }
    lines.push(
      { math: "ν(M) = sqrt((γ + 1)/(γ - 1)) atan(sqrt((γ - 1)/(γ + 1) (M^2 - 1))) - atan(sqrt(M^2 - 1))", fallback: "ν(M) = √((γ + 1)/(γ − 1))·atan√((γ − 1)(M² − 1)/(γ + 1)) − atan√(M² − 1)" },
      { math: "ν(M_2) = ν(M_1) + θ", fallback: "ν(M₂) = ν(M₁) + θ" },
    );
    lines.push(...u.conversions, ASSUMPTION);
    const fig = prandtlMeyerSvg(M1, res.M2 ?? null, g);
    return finish(lines, [
      { kind: "table", label: "Prandtl–Meyer expansion", rows },
      plot(fig, `Prandtl–Meyer function ν(M) (γ = ${num(g)}) with the states marked`, "Prandtl–Meyer angle against Mach number with the upstream and expanded states marked"),
    ], outputs);
  },
};

// ------------------------------------------------------------------ 3. Fanno

function fannoRow(name: string, s: FannoState): string[] {
  return [name, num(s.M), num(s.fLD), num(s.TTs), num(s.pps), num(s.p0p0s), num(s.VVs)];
}

const fannoCalc: EngCalcDef<"Fluids"> = {
  id: "gd-fanno",
  name: "Fanno flow (adiabatic duct with friction)",
  group: "Fluids",
  unitContract: "converts",
  hint:
    "Adiabatic flow in a constant-area duct with wall friction. The state at M₁ against the sonic (*) reference, and " +
    "with the friction factor, length and diameter, the exit Mach number on the same branch: friction drives subsonic " +
    "flow UP and supersonic flow DOWN toward Mach 1. A duct longer than L* chokes. The friction factor is the FANNING " +
    "f̄ (4f̄L/D); a Darcy (Moody-chart) factor is converted, Darcy f = 4f̄. " + UNIT_NOTE,
  fields: [
    { key: "M1", label: "Inlet Mach number M₁", default: "0.5", kind: "text" },
    GAMMA_FIELD,
    { key: "f", label: "Mean friction factor (blank for the state only)", default: "0.005", kind: "text" },
    {
      key: "conv",
      label: "Friction-factor convention",
      default: "fanning",
      kind: "select",
      options: [
        { value: "fanning", label: "Fanning f̄ (τw = f̄·½ρV²)" },
        { value: "darcy", label: "Darcy f (Moody chart; Darcy f = 4f̄)" },
      ],
    },
    { key: "L", label: "Duct length L, m (blank for the state only)", default: "2", kind: "text" },
    { key: "D", label: "Hydraulic diameter D, m", default: "0.05", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const M1 = u.num("M1", "Inlet Mach number M₁");
    const g = readGamma(u);
    const darcy = r("conv") === "darcy";
    const f = u.optNum("f", "Friction factor");
    const L = u.opt("L", "m", "Duct length");
    const D = u.opt("D", "m", "Hydraulic diameter");
    if (u.errors.length) return refuse(u.errors.join("\n"));
    if (f !== null && !(f > 0)) return refuse("Friction factor: must be greater than 0.");
    if (f !== null && f > (darcy ? 1 : 0.25)) return refuse(`Friction factor: ${num(f)} is not a plausible ${darcy ? "Darcy" : "Fanning"} factor (a Moody chart tops out near 0.1 Darcy, 0.025 Fanning).`);
    if (L !== null && !(L >= 0)) return refuse("Duct length: must be zero or greater.");
    if (D !== null && !(D > 0)) return refuse("Hydraulic diameter: must be greater than 0.");
    const fF = f === null ? null : darcy ? f / 4 : f;
    const haveDuct = fF !== null && L !== null && D !== null;
    if (L !== null && !haveDuct) return refuse("Give the friction factor, length and diameter together for the exit state (or clear the length for the inlet state only).");
    const fLD = haveDuct ? (4 * fF! * L!) / D! : null;
    const res = fanno(M1, fLD, g);
    if (!res.ok) return refuse(res.error);
    const s1 = res.s1;
    const lines: EngLine[] = [
      `Fanno flow at M₁ = ${num(M1)} (${res.branch}), γ = ${num(g)}: 4f̄L*/D = ${num(s1.fLD)}; T/T* = ${num(s1.TTs)}, p/p* = ${num(s1.pps)}, p₀/p₀* = ${num(s1.p0p0s)}, V/V* = ${num(s1.VVs)}.`,
    ];
    const outputs: EngOutput[] = [
      out("fLDstar", "4f̄L*/D at M₁", s1.fLD),
      out("TTs", "T/T* at M₁", s1.TTs),
      out("pps", "p/p* at M₁", s1.pps),
      out("p0p0s", "p₀/p₀* at M₁", s1.p0p0s),
      out("VVs", "V/V* at M₁", s1.VVs),
    ];
    const rows = [["State", "M", "4f̄L*/D", "T/T*", "p/p*", "p₀/p₀*", "V/V*"], fannoRow("Inlet (1)", s1)];
    const marks = [{ M: M1, label: `inlet M₁ = ${num(M1, 4)}` }];
    if (fF !== null && D !== null) {
      const Lstar = (s1.fLD * D) / (4 * fF);
      lines.push(`Choking length from the inlet state: L* = 4f̄L*/D × D/(4f̄) = ${num(Lstar)} m (Fanning f̄ = ${num(fF)}${darcy ? `, from the Darcy f = ${num(f!)} ÷ 4` : ""}).`);
      outputs.push(out("Lstar", "Choking length L*", Lstar, "m"));
    }
    if (res.s2 && fLD !== null) {
      const s2 = res.s2;
      lines.push(
        `Duct 4f̄L/D = ${num(fLD)} → exit M₂ = ${num(s2.M)}${s2.M === 1 ? " (exactly choked)" : ""}; p₂/p₁ = ${num(s2.pps / s1.pps)}, T₂/T₁ = ${num(s2.TTs / s1.TTs)}, p₀₂/p₀₁ = ${num(s2.p0p0s / s1.p0p0s)}.`,
      );
      rows.push(fannoRow("Exit (2)", s2));
      marks.push({ M: s2.M, label: `exit M₂ = ${num(s2.M, 4)}` });
      outputs.push(out("fLD", "Duct 4f̄L/D", fLD), out("M2", "Exit Mach number M₂", s2.M), out("p2p1", "Static pressure ratio p₂/p₁", s2.pps / s1.pps), out("T2T1", "Static temperature ratio T₂/T₁", s2.TTs / s1.TTs), out("p02p01", "Total-pressure ratio p₀₂/p₀₁", s2.p0p0s / s1.p0p0s));
    }
    lines.push(
      "F(M) = 4f̄L*/D, the friction length that takes the flow from M to Mach 1:",
      { math: "F(M) = (1 - M^2)/(γ M^2) + (γ + 1)/(2γ) ln(((γ + 1) M^2)/(2 + (γ - 1) M^2))", fallback: "F(M) = (1 − M²)/(γM²) + ((γ + 1)/(2γ)) ln[(γ + 1)M²/(2 + (γ − 1)M²)]" },
      { math: "(4 bar(f) L)/D = F(M_1) - F(M_2)", fallback: "4f̄L/D = F(M₁) − F(M₂)" },
      { math: "f_D = 4 bar(f)", fallback: "Darcy f = 4f̄ (four times the Fanning factor)" },
      "T/T* = (γ + 1)/(2 + (γ − 1)M²), p/p* = √(T/T*)/M, V/V* = M√(T/T*), p₀/p₀* = A/A* (the isentropic area ratio).",
    );
    lines.push(...u.conversions, `${ASSUMPTION} Adiabatic, constant area, a constant mean friction factor.`);
    const fig = fannoSvg(g, marks);
    return finish(lines, [
      { kind: "table", label: "Fanno flow (* = the sonic reference state)", rows },
      plot(fig, `Fanno line 4f̄L*/D against M (γ = ${num(g)}) with the states marked`, "Friction length to choking against Mach number on the subsonic and supersonic branches, inlet and exit marked"),
    ], outputs);
  },
};

// ------------------------------------------------------------------ 4. Rayleigh

function rayleighRow(name: string, s: RayleighState): string[] {
  return [name, num(s.M), num(s.T0T0s), num(s.TTs), num(s.pps), num(s.p0p0s), num(s.VVs)];
}

const rayleighCalc: EngCalcDef<"Fluids"> = {
  id: "gd-rayleigh",
  name: "Rayleigh flow (duct with heat addition)",
  group: "Fluids",
  unitContract: "converts",
  hint:
    "Frictionless flow in a constant-area duct with heat added (combustor, heat exchanger). The state at M₁ against " +
    "the sonic (*) reference and, from the heat added (a T₀₂/T₀₁ ratio, or q in J/kg with T₁ and R), the exit Mach " +
    "number on the same branch: heating drives either branch toward Mach 1, and too much heat chokes the duct " +
    "thermally. Negative q (cooling) is accepted. " + UNIT_NOTE,
  fields: [
    { key: "M1", label: "Inlet Mach number M₁", default: "0.5", kind: "text" },
    GAMMA_FIELD,
    {
      key: "heat",
      label: "Heat given as",
      default: "ratio",
      kind: "select",
      options: [
        { value: "ratio", label: "Stagnation-temperature ratio T₀₂/T₀₁" },
        { value: "q", label: "Heat per unit mass q (needs T₁ and R)" },
      ],
    },
    { key: "ratio", label: "T₀₂/T₀₁ (blank for the state only)", default: "1.2", kind: "text" },
    { key: "q", label: "Heat added q, J/kg", default: "100 kJ/kg", kind: "text" },
    { key: "T1", label: "Inlet static temperature T₁, K (for q)", default: "300", kind: "text" },
    { key: "R", label: "Gas constant R, J/(kg·K) (dry air 287.05; for q)", default: "287.05", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const M1 = u.num("M1", "Inlet Mach number M₁");
    const g = readGamma(u);
    const byQ = r("heat") === "q";
    let ratio: number | null = null;
    let qLine = "";
    let qMaxLine = "";
    if (byQ) {
      const q = u.req("q", "J/kg", "Heat added q");
      const T1 = u.req("T1", "K", "Inlet static temperature");
      const R = u.req("R", "J/(kg*K)", "Gas constant");
      if (u.errors.length) return refuse(u.errors.join("\n"));
      if (!(T1 > 0)) return refuse("Inlet static temperature: an absolute temperature must be greater than 0 K.");
      if (!(R > 0)) return refuse("Gas constant: R must be greater than 0.");
      if (!(M1 > 0)) return refuse(`M₁ = ${num(M1)}: the Mach number must be greater than 0.`);
      const iso = compressibleFlow(M1, g);
      if (!iso.ok) return refuse(iso.error);
      const cp = (g * R) / (g - 1);
      const T01 = T1 * iso.temperatureRatio;
      const T02 = T01 + q / cp;
      if (!(T02 > 0)) return refuse(`Heat added q: removing ${num(-q / 1000)} kJ/kg would take T₀ below absolute zero (T₀₁ = ${num(T01)} K, cₚ = ${num(cp)} J/(kg·K)).`);
      ratio = T02 / T01;
      const s1 = rayleigh(M1, null, g);
      if (s1.ok) qMaxLine = ` With this inlet state the most heat the duct can take is q* = cₚT₀₁(T₀*/T₀₁ − 1) = ${num((cp * T01 * (s1.chokeRatio - 1)) / 1000)} kJ/kg.`;
      qLine = `q = ${num(q / 1000)} kJ/kg with cₚ = γR/(γ − 1) = ${num(cp)} J/(kg·K): T₀₁ = T₁(T₀/T)(M₁) = ${num(T01)} K → T₀₂ = T₀₁ + q/cₚ = ${num(T02)} K, T₀₂/T₀₁ = ${num(ratio)}.`;
    } else {
      ratio = u.optNum("ratio", "T₀₂/T₀₁");
      if (u.errors.length) return refuse(u.errors.join("\n"));
    }
    const res = rayleigh(M1, ratio, g);
    if (!res.ok) return refuse(res.error + (/^Thermally choked/.test(res.error) ? qMaxLine : ""));
    const s1 = res.s1;
    const lines: EngLine[] = [
      `Rayleigh flow at M₁ = ${num(M1)} (${res.branch}), γ = ${num(g)}: T₀/T₀* = ${num(s1.T0T0s)}; T/T* = ${num(s1.TTs)}, p/p* = ${num(s1.pps)}, p₀/p₀* = ${num(s1.p0p0s)}, V/V* = ${num(s1.VVs)}.`,
      `Thermal choking: heat raising T₀ by the factor ${num(res.chokeRatio)} brings the exit to Mach 1.`,
    ];
    if (qLine) lines.push(qLine + qMaxLine);
    const outputs: EngOutput[] = [
      out("T0T0s", "T₀/T₀* at M₁", s1.T0T0s),
      out("TTs", "T/T* at M₁", s1.TTs),
      out("pps", "p/p* at M₁", s1.pps),
      out("p0p0s", "p₀/p₀* at M₁", s1.p0p0s),
      out("VVs", "V/V* at M₁", s1.VVs),
      out("chokeRatio", "T₀₂/T₀₁ to thermal choking", res.chokeRatio),
    ];
    const rows = [["State", "M", "T₀/T₀*", "T/T*", "p/p*", "p₀/p₀*", "V/V*"], rayleighRow("Inlet (1)", s1)];
    const marks = [{ M: M1, label: `inlet M₁ = ${num(M1, 4)}` }];
    if (res.s2 && res.T02T01 !== undefined) {
      const s2 = res.s2;
      lines.push(
        `T₀₂/T₀₁ = ${num(res.T02T01)} → exit M₂ = ${num(s2.M)}${s2.M === 1 ? " (exactly choked)" : ""}; p₂/p₁ = ${num(s2.pps / s1.pps)}, T₂/T₁ = ${num(s2.TTs / s1.TTs)}, p₀₂/p₀₁ = ${num(s2.p0p0s / s1.p0p0s)}.`,
      );
      rows.push(rayleighRow("Exit (2)", s2));
      marks.push({ M: s2.M, label: `exit M₂ = ${num(s2.M, 4)}` });
      outputs.push(out("T02T01", "T₀₂/T₀₁", res.T02T01), out("M2", "Exit Mach number M₂", s2.M), out("p2p1", "Static pressure ratio p₂/p₁", s2.pps / s1.pps), out("T2T1", "Static temperature ratio T₂/T₁", s2.TTs / s1.TTs), out("p02p01", "Total-pressure ratio p₀₂/p₀₁", s2.p0p0s / s1.p0p0s));
    }
    lines.push(
      "T₀/T₀* = 2(γ + 1)M²(1 + ((γ − 1)/2)M²)/(1 + γM²)², p/p* = (γ + 1)/(1 + γM²), T/T* = M²(p/p*)², V/V* = (γ + 1)M²/(1 + γM²); T₀/T₀* and p₀/p₀* are the static ratios times the isentropic ratio at M over that at M = 1.",
      { math: "q = c_p (T_02 - T_01)", fallback: "q = cₚ(T₀₂ − T₀₁)" },
      { math: "c_p = (γ R)/(γ - 1)", fallback: "cₚ = γR/(γ − 1)" },
    );
    lines.push(...u.conversions, `${ASSUMPTION} Frictionless, constant area, heat added uniformly (no change of gas or γ).`);
    const fig = rayleighSvg(g, marks);
    return finish(lines, [
      { kind: "table", label: "Rayleigh flow (* = the sonic reference state)", rows },
      plot(fig, `Rayleigh line T₀/T₀* against M (γ = ${num(g)}) with the states marked`, "Stagnation-temperature ratio against Mach number on the subsonic and supersonic branches, inlet and exit marked"),
    ], outputs);
  },
};

export const GAS_DYNAMICS_CALCS: EngCalcDef<"Fluids">[] = [normalShockCalc, obliqueCalc, fannoCalc, rayleighCalc];
