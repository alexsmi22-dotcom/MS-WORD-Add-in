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

  // ---- Fluids ----
  pipe: [eq("Re = rho V D/mu", "Re = ρ·V·D/μ"), eq("h_f = f L V^2/(2 g D)", "hf = f·L·V²/(2g·D)"), eq("Delta p = rho g h_L", "Δp = ρ·g·hL")],
  "pipe:laminar": [eq("f = 64/Re", "f = 64/Re")],
  "pipe:turbulent": [eq("1/sqrt(f) = -2 log(epsilon/(3.7 D) + 2.51/(Re sqrt(f)))", "1/√f = −2·log(ε/(3.7·D) + 2.51/(Re·√f))")],
  "pipe:minor": [eq("h_m = Sigma K V^2/(2 g)", "hm = ΣK·V²/(2g)")],
  "open-channel": [
    eq("V = (1/n) R_h^{2/3} sqrt(S)", "V = (1/n)·Rₕ²ᐟ³·√S"),
    eq("Q = V A", "Q = V·A"),
    eq("Fr = V/sqrt(g A/T)", "Fr = V/√(g·A/T)"),
    eq("E = y + V^2/(2 g)", "E = y + V²/(2g)"),
  ],
  "pump-npsh": [eq("NPSH_a = (p_s - p_v)/(rho g) + h_s - h_L", "NPSHa = (ps − pv)/(ρ·g) + hs − hL")],
  "pump-npsh:power": [eq("P_h = rho g Q H", "Ph = ρ·g·Q·H"), eq("P_shaft = P_h/eta", "Pshaft = Ph/η")],
  compressible: [
    eq("a = sqrt(k R T)", "a = √(k·R·T)"),
    eq("T_0/T = 1 + ((k - 1)/2) M^2", "T₀/T = 1 + ((k − 1)/2)·M²"),
    eq("p_0/p = (T_0/T)^{k/(k - 1)}", "p₀/p = (T₀/T)ᵏᐟ⁽ᵏ⁻¹⁾"),
  ],
  "flow-meter": [eq("Q = C_d epsilon A_t sqrt(2 Delta p/rho)/sqrt(1 - beta^4)", "Q = Cd·ε·At·√(2Δp/ρ)/√(1 − β⁴)"), eq("beta = d/D", "β = d/D")],
  "pump-system": [eq("H_pump = H_0 (1 - (Q/Q_max)^2)", "Hpump = H₀(1 − (Q/Qmax)²)"), eq("H_sys = h_s + K Q^2", "Hsys = hs + K·Q²"), eq("P_h = rho g Q H", "Ph = ρ·g·Q·H")],
  affinity: [
    eq("Q_2/Q_1 = (N_2/N_1) (D_2/D_1)^3", "Q₂/Q₁ = (N₂/N₁)(D₂/D₁)³"),
    eq("H_2/H_1 = (N_2/N_1)^2 (D_2/D_1)^2", "H₂/H₁ = (N₂/N₁)²(D₂/D₁)²"),
    eq("P_2/P_1 = (N_2/N_1)^3 (D_2/D_1)^5", "P₂/P₁ = (N₂/N₁)³(D₂/D₁)⁵"),
  ],
  "body-drag": [eq("F_D = (1/2) rho V^2 C_d A", "FD = ½·ρ·V²·Cd·A"), eq("P = F_D V", "P = FD·V")],
  "body-drag:terminal": [eq("V_t = sqrt(2 m g/(rho C_d A))", "Vt = √(2m·g/(ρ·Cd·A))")],
  "body-drag:reynolds": [eq("Re = rho V L/mu", "Re = ρ·V·L/μ")],
};

/** The governing-equation lines for a tool (or `tool:branch`); empty for a key that has none. */
export function engEq(key: string): EngLine[] {
  return ENG_EQUATIONS[key] ?? [];
}

// Referenced so the helper is not flagged unused while the table is being filled.
void eq;
