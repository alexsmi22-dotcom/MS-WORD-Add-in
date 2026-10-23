/**
 * The governing equations of the pane's Engineering tools (Release E, gap #14), as report lines that insert as real
 * Word equations (engReport `{ math, fallback }`).
 *
 * One table rather than literals scattered through taskpane.ts, so every formula can be tested here: each `math`
 * must parse (mathToOmml) AND typeset as its `fallback` reads (engEquations.test.ts compares the letters, digits and
 * Greek of the parsed tree against the fallback, which catches the parser's silent readings: `V_in` as V∈, `Nu` as ν,
 * `DeltaT` as one italic word, `M·c/I` as M · (c/I)).
 *
 * Keys are a tool id, or `tool:branch` where the tool computes different things per mode — the equation shown must be
 * the one the branch actually computed.
 *
 * Writing a `math` string (the pane's math syntax, mathParse.ts): juxtapose with spaces for products (`M c/I`, never
 * `·`, which is a top-level operator), parenthesise every denominator that is not a single symbol (`(2 g h)`),
 * `sqrt(...)` not √, ASCII `-` not U+2212, Greek by name separated from other letters (`Delta T`, `2 pi f`), and avoid
 * identifiers the parser turns into symbols (`in`, `to`, `deg`, `inf`, `Nu`, `Mu`, `Pi`, `and`, `or`, `not`).
 * The fallback is the typeset text form: true minus, Unicode sub/superscripts where they exist, no ^ _ or *.
 */
import type { EngLine } from "./engReport";

export type EngEquation = { math: string; fallback: string };

const eq = (math: string, fallback: string): EngEquation => ({ math, fallback });

export const ENG_EQUATIONS: Record<string, EngEquation[]> = {
  // ---- Structural & solids ----
  "section:sigma": [eq("sigma_max = M c/I", "σₘₐₓ = M·c/I")],
  "section:tau": [eq("tau = V Q/(I t)", "τ = V·Q/(I·t)")],
  stress: [
    eq(
      "sigma_vm = sqrt(((sigma_1 - sigma_2)^2 + (sigma_2 - sigma_3)^2 + (sigma_3 - sigma_1)^2)/2)",
      "σᵥₘ = √(((σ₁ − σ₂)² + (σ₂ − σ₃)² + (σ₃ − σ₁)²)/2)",
    ),
    eq("tau_max = (sigma_1 - sigma_3)/2", "τₘₐₓ = (σ₁ − σ₃)/2"),
  ],
  "stress:plane": [eq("sigma_p = (sigma_x + sigma_y)/2 +- sqrt(((sigma_x - sigma_y)/2)^2 + tau_xy^2)", "σp = (σx + σy)/2 ± √(((σx − σy)/2)² + τxy²)")],
  column: [eq("P_cr = pi^2 E I/(K L)^2", "Pcr = π²·E·I/(K·L)²")],
  "column:johnson": [eq("sigma_cr = F_y - F_y^2/(4 pi^2 E) (K L/r)^2", "σcr = Fy − (Fy²/(4π²·E))·(K·L/r)²")],
  torsion: [eq("tau_max = T d/(2 J)", "τₘₐₓ = T·d/(2·J)"), eq("J = (pi/32) (d^4 - d_i^4)", "J = (π/32)(d⁴ − dᵢ⁴)")],
  "torsion:twist": [eq("theta = T L/(G J)", "θ = T·L/(G·J)")],

  // ---- Electronics ----
  "circuit-ac": [eq("Z_L = j omega L", "ZL = jωL"), eq("Z_C = 1/(j omega C)", "ZC = 1/(jωC)"), eq("omega = 2 pi f", "ω = 2πf")],
  "opamp:inverting": [eq("G = -R_f/R_1", "G = −Rf/R₁")],
  "opamp:non-inverting": [eq("G = 1 + R_f/R_1", "G = 1 + Rf/R₁")],
  "opamp:summing": [eq("V_out = -R_f sum(i=1, n, V_i/R_i)", "Vout = −Rf·∑ᵢ₌₁ⁿ Vᵢ/Rᵢ")],
  "opamp:difference": [eq("V_out = (R_f/R_1) (V_2 - V_1)", "Vout = (Rf/R₁)(V₂ − V₁)")],
  "opamp:integrator": [eq("V_out = -1/(R_1 C) int(0, t, V_i dt)", "Vout = −(1/(R₁·C))·∫₀ᵗ Vᵢ dt"), eq("f_c = 1/(2 pi R_1 C)", "fc = 1/(2π·R₁·C)")],
  "opamp:differentiator": [eq("V_out = -R_f C (d V_i)/(d t)", "Vout = −Rf·C·dVᵢ/dt"), eq("f_c = 1/(2 pi R_f C)", "fc = 1/(2π·Rf·C)")],
  "opamp:bandwidth": [eq("f_BW = GBW/G_n", "fBW = GBW/Gₙ")],
  "opamp:full-power": [eq("f_p = SR/(2 pi V_p)", "fp = SR/(2π·Vp)")],
  "filter-design:butterworth": [eq("n = log((10^{0.1 A_s} - 1)/(10^{0.1 A_p} - 1))/(2 log(Omega))", "n = log((10⁰·¹ᴬˢ − 1)/(10⁰·¹ᴬᵖ − 1))/(2·log Ω)")],
  "filter-design:chebyshev": [eq("n = arccosh(sqrt((10^{0.1 A_s} - 1)/(10^{0.1 A_p} - 1)))/arccosh(Omega)", "n = arccosh(√((10⁰·¹ᴬˢ − 1)/(10⁰·¹ᴬᵖ − 1)))/arccosh Ω")],
  "filter-design:lowpass": [eq("Omega = omega_s/omega_p", "Ω = ωs/ωp")],
  "filter-design:highpass": [eq("Omega = omega_p/omega_s", "Ω = ωp/ωs")],
};

/** The governing-equation lines for a tool (or `tool:branch`); empty for a key that has none. */
export function engEq(key: string): EngLine[] {
  return ENG_EQUATIONS[key] ?? [];
}

// Referenced so the helper is not flagged unused while the table is being filled.
void eq;
