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
  "opamp:differentiator": [eq("V_out = -R_f C {d V_i}/{d t}", "Vout = −Rf·C·dVᵢ/dt"), eq("f_c = 1/(2 pi R_f C)", "fc = 1/(2π·Rf·C)")],
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

  // ---- Thermal ----
  // A symbol directly before "(" parses as a function name, so a product with a bracket is written {A} (…).
  wall: [eq("Q = (T_i - T_o)/R_total", "Q = (Tᵢ − Tₒ)/Rtotal"), eq("U = 1/(R_total A_o)", "U = 1/(Rtotal·Aₒ)")],
  "wall:plane": [eq("R = L/(k A)", "R = L/(k·A)"), eq("R_conv = 1/(h A)", "Rconv = 1/(h·A)")],
  "wall:cylinder": [eq("R = ln(r_2/r_1)/(2 pi k L)", "R = ln(r₂/r₁)/(2π·k·L)"), eq("R_conv = 1/(h A)", "Rconv = 1/(h·A)")],
  hx: [eq("Q = U A Delta T_lm", "Q = U·A·ΔTlm"), eq("Delta T_lm = (Delta T_1 - Delta T_2)/ln(Delta T_1/Delta T_2)", "ΔTlm = (ΔT₁ − ΔT₂)/ln(ΔT₁/ΔT₂)")],
  "hx-ntu": [eq("NTU = U A/C_min", "NTU = U·A/Cmin"), eq("C_r = C_min/C_max", "Cr = Cmin/Cmax"), eq("Q = epsilon C_{min} (T_hi - T_ci)", "Q = ε·Cmin·(Thi − Tci)")],
  "hx-ntu:counter": [eq("epsilon = (1 - exp(-(1 - C_r) NTU))/(1 - C_r exp(-(1 - C_r) NTU))", "ε = (1 − exp(−(1 − Cr)·NTU))/(1 − Cr·exp(−(1 − Cr)·NTU))")],
  "hx-ntu:counter-balanced": [eq("epsilon = NTU/(1 + NTU)", "ε = NTU/(1 + NTU)")],
  "hx-ntu:parallel": [eq("epsilon = (1 - exp(-(1 + C_r) NTU))/(1 + C_r)", "ε = (1 − exp(−(1 + Cr)·NTU))/(1 + Cr)")],
  "hx-ntu:phase-change": [eq("epsilon = 1 - exp(-NTU)", "ε = 1 − exp(−NTU)")],
  fin: [
    eq("m = sqrt(h P/(k A_c))", "m = √(h·P/(k·Ac))"),
    eq("L_c = L + t/2", "Lc = L + t/2"),
    eq("eta_f = tanh(m L_c)/(m L_c)", "ηf = tanh(m·Lc)/(m·Lc)"),
    eq("epsilon_f = eta_f A_f/A_c", "εf = ηf·Af/Ac"),
  ],
  lumped: [
    eq("Bi = h L_c/k", "Bi = h·Lc/k"),
    eq("L_c = V/A_s", "Lc = V/As"),
    eq("tau = rho V c_p/(h A_s)", "τ = ρ·V·cp/(h·As)"),
    eq("(T - T_a)/(T_i - T_a) = exp(-t/tau)", "(T − Tₐ)/(Tᵢ − Tₐ) = exp(−t/τ)"),
  ],
  radiation: [eq("Q = F sigma {A} (T_1^4 - T_2^4)", "Q = F·σ·A·(T₁⁴ − T₂⁴)")],
  "radiation:large": [eq("F = epsilon_1", "F = ε₁")],
  "radiation:parallel": [eq("F = 1/(1/epsilon_1 + 1/epsilon_2 - 1)", "F = 1/(1/ε₁ + 1/ε₂ − 1)")],
  "thermo-process": [eq("Q = Delta U + W", "Q = ΔU + W"), eq("Delta U = m c_{v} (T_2 - T_1)", "ΔU = m·cv·(T₂ − T₁)")],
  "thermo-process:polytropic": [eq("p V^n = const", "p·Vⁿ = const"), eq("W = (p_2 V_2 - p_1 V_1)/(1 - n)", "W = (p₂V₂ − p₁V₁)/(1 − n)")],
  "thermo-process:isothermal": [eq("p V = const", "p·V = const"), eq("W = p_1 V_1 ln(V_2/V_1)", "W = p₁V₁·ln(V₂/V₁)")],
  "thermo-process:isobaric": [eq("W = {p} (V_2 - V_1)", "W = p·(V₂ − V₁)")],
  "thermo-process:isochoric": [eq("W = 0", "W = 0")],
  "thermo-cycle:otto": [eq("eta = 1 - 1/r^{k - 1}", "η = 1 − 1/rᵏ⁻¹")],
  "thermo-cycle:diesel": [eq("eta = 1 - (1/r^{k - 1}) (r_c^k - 1)/((r_c - 1) k)", "η = 1 − (1/rᵏ⁻¹)·(rcᵏ − 1)/((rc − 1)·k)")],
  "thermo-cycle:brayton": [eq("eta = 1 - 1/r_p^{(k - 1)/k}", "η = 1 − 1/rₚ⁽ᵏ⁻¹⁾ᐟᵏ")],
  "thermo-cycle:carnot": [eq("eta_C = 1 - T_min/T_max", "ηC = 1 − Tmin/Tmax")],
  "thermo-vapour:rankine": [eq("eta = w_net/q_H", "η = wnet/qH"), eq("w_net = (h_3 - h_4) - (h_2 - h_1)", "wnet = (h₃ − h₄) − (h₂ − h₁)"), eq("q_H = h_3 - h_2", "qH = h₃ − h₂")],
  "thermo-vapour:fridge": [eq("COP_R = (h_1 - h_3)/(h_2 - h_1)", "COPR = (h₁ − h₃)/(h₂ − h₁)"), eq("COP_HP = (h_2 - h_3)/(h_2 - h_1)", "COPHP = (h₂ − h₃)/(h₂ − h₁)")],
  "thermo-vapour:carnot-efficiency": [eq("eta_max = 1 - T_C/T_H", "ηmax = 1 − TC/TH")],
  "thermo-vapour:carnot-refrigerator": [eq("COP_{R max} = T_C/(T_H - T_C)", "COPR max = TC/(TH − TC)")],
  "thermo-vapour:carnot-heat-pump": [eq("COP_{HP max} = T_H/(T_H - T_C)", "COPHP max = TH/(TH − TC)")],
  "radiation:shields": [eq("F = 1/(1/epsilon_1 + 1/epsilon_2 - 1 + (2/epsilon_s - 1) N)", "F = 1/(1/ε₁ + 1/ε₂ − 1 + (2/εs − 1)·N)")],
};

/** The governing-equation lines for a tool (or `tool:branch`); empty for a key that has none. */
export function engEq(key: string): EngLine[] {
  return ENG_EQUATIONS[key] ?? [];
}

// Referenced so the helper is not flagged unused while the table is being filled.
void eq;
