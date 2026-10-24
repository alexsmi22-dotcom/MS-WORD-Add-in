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
  // Impeller trimmed in the same casing (Karassik, Pump Handbook; Hydraulic Institute): Q ∝ D, H ∝ D², P ∝ D³.
  "affinity:trim": [
    eq("Q_2/Q_1 = (N_2/N_1) (D_2/D_1)", "Q₂/Q₁ = (N₂/N₁)(D₂/D₁)"),
    eq("H_2/H_1 = (N_2/N_1)^2 (D_2/D_1)^2", "H₂/H₁ = (N₂/N₁)²(D₂/D₁)²"),
    eq("P_2/P_1 = (N_2/N_1)^3 (D_2/D_1)^3", "P₂/P₁ = (N₂/N₁)³(D₂/D₁)³"),
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
  // ---- Control systems (the transfer functions themselves are already typeset by the tools) ----
  "control-step:underdamped": [
    eq("omega_d = omega_n sqrt(1 - zeta^2)", "ωd = ωn·√(1 − ζ²)"),
    eq("M_p = exp(-pi zeta/sqrt(1 - zeta^2))", "Mp = exp(−πζ/√(1 − ζ²))"),
    eq("t_p = pi/omega_d", "tp = π/ωd"),
    eq("t_s approx 4/(zeta omega_n)", "ts ≈ 4/(ζ·ωn)"),
  ],
  "control-bode": [eq("GM = -20 log(abs(L(j omega_pc)))", "GM = −20·log|L(jωpc)|"), eq("PM = 180 degree + angle L(j omega_gc)", "PM = 180° + ∠L(jωgc)")],
  "control-pid": [eq("C(s) = K_p + K_i/s + K_d s", "C(s) = Kp + Ki/s + Kd·s"), eq("T(s) = L(s)/(1 + L(s))", "T(s) = L(s)/(1 + L(s))")],
  // ---- Pharmacokinetics ----
  "pk-dose": [eq("k = CL/V_d", "k = CL/Vd"), eq("t_{1/2} = ln(2)/k", "t½ = ln 2/k")],
  "pk-dose:iv-bolus": [eq("C(t) = (Dose/V_d) e^{-k t}", "C(t) = (Dose/Vd)·e⁻ᵏᵗ"), eq("AUC = Dose/CL", "AUC = Dose/CL")],
  "pk-dose:infusion": [eq("C(t) = (R_0/CL) (1 - e^{-k t})", "C(t) = (R₀/CL)·(1 − e⁻ᵏᵗ)"), eq("R_0 = Dose/T", "R₀ = Dose/T"), eq("AUC = Dose/CL", "AUC = Dose/CL")],
  "pk-dose:oral": [
    eq("C(t) = F Dose k_a/((k_a - k) V_d) (e^{-k t} - e^{-k_a t})", "C(t) = F·Dose·kₐ/((kₐ − k)·Vd)·(e⁻ᵏᵗ − e⁻ᵏᵃᵗ)"),
    eq("AUC = F Dose/CL", "AUC = F·Dose/CL"),
  ],
  "pk-dose:oral-auc": [eq("AUC = F Dose/CL", "AUC = F·Dose/CL")],
  "pk-steady": [
    eq("R_ac = 1/(1 - exp(-k tau))", "Rac = 1/(1 − exp(−k·τ))"),
    eq("bar(C)_ss = F Dose/(CL tau)", "C̄ss = F·Dose/(CL·τ)"),
    eq("D_L = Dose R_ac", "DL = Dose·Rac"),
    eq("t_95 = 4.32 t_{1/2}", "t₉₅ = 4.32·t½"),
  ],
  "pk-nca": [eq("t_{1/2} = ln(2)/lambda_z", "t½ = ln 2/λz"), eq("AUC_inf = AUC_last + C_last/lambda_z", "AUC∞ = AUClast + Clast/λz")],
  "pk-nca:iv": [eq("CL = Dose/AUC_inf", "CL = Dose/AUC∞"), eq("V_z = Dose/(lambda_z AUC_inf)", "Vz = Dose/(λz·AUC∞)")],
  "pk-nca:oral": [eq("CL/F = Dose/AUC_inf", "CL/F = Dose/AUC∞"), eq("V_z/F = Dose/(lambda_z AUC_inf)", "Vz/F = Dose/(λz·AUC∞)")],
  "shelf-life": [eq("k = A exp(-E_a/(R T))", "k = A·exp(−Ea/(R·T))")],
  "shelf-life:first": [eq("t_90 = ln(10/9)/k", "t₉₀ = ln(10/9)/k")],
  "shelf-life:zero": [eq("t_90 = 0.1 C_0/k_0", "t₉₀ = 0.1·C₀/k₀")],
  // ---- Vibration ----
  "vib-free": [eq("omega_n = sqrt(k/m)", "ωn = √(k/m)"), eq("c_c = 2 sqrt(k m)", "cc = 2√(k·m)"), eq("zeta = c/c_c", "ζ = c/cc")],
  "vib-free:damped": [eq("omega_d = omega_n sqrt(1 - zeta^2)", "ωd = ωn·√(1 − ζ²)")],
  "vib-free:decrement": [eq("delta = (1/N) ln(x_1/x_2)", "δ = (1/N)·ln(x₁/x₂)"), eq("zeta = delta/sqrt(4 pi^2 + delta^2)", "ζ = δ/√(4π² + δ²)")],
  "vib-forced": [
    eq("r = omega/omega_n", "r = ω/ωn"),
    eq("X/(F_0/k) = 1/sqrt((1 - r^2)^2 + (2 zeta r)^2)", "X/(F₀/k) = 1/√((1 − r²)² + (2ζr)²)"),
    eq("T_r = sqrt((1 + (2 zeta r)^2)/((1 - r^2)^2 + (2 zeta r)^2))", "Tr = √((1 + (2ζr)²)/((1 − r²)² + (2ζr)²))"),
    eq("phi = arctan(2 zeta r/(1 - r^2))", "φ = arctan(2ζr/(1 − r²))"),
  ],
  "vib-forced:peak": [eq("r_peak = sqrt(1 - 2 zeta^2)", "rpeak = √(1 − 2ζ²)")],
  "vib-modal": [eq("det(K - omega^2 M) = 0", "det(K − ω²M) = 0")],
  "vib-mdof-forced": [eq("(K - omega^2 M + j omega C) X = F", "(K − ω²M + jωC)·X = F")],
  "vib-mdof-forced:rayleigh": [eq("C = alpha M + beta K", "C = αM + βK")],
  // ---- Fatigue & machine design ----
  // The uncorrected limit is written Se0 (the math syntax has no prime).
  "fatigue-endurance": [eq("S_e = k_a k_b k_c k_d k_e S_{e0}", "Se = ka·kb·kc·kd·ke·Se0")],
  "fatigue-endurance:notch": [eq("K_f = 1 + (K_t - 1) q", "Kf = 1 + (Kt − 1)·q")],
  "fatigue-safety": [eq("sigma_a + abs(sigma_m) = S_y/n_y", "σa + |σm| = Sy/ny"), eq("n = min(n_f, n_y)", "n = min(nf, ny)")],
  "fatigue-safety:goodman": [eq("sigma_a/S_e + sigma_m/S_ut = 1/n_f", "σa/Se + σm/Sut = 1/nf")],
  "fatigue-safety:soderberg": [eq("sigma_a/S_e + sigma_m/S_y = 1/n_f", "σa/Se + σm/Sy = 1/nf")],
  "fatigue-safety:gerber": [eq("n_f sigma_a/S_e + (n_f sigma_m/S_ut)^2 = 1", "nf·σa/Se + (nf·σm/Sut)² = 1")],
  "fatigue-safety:asme-elliptic": [eq("(n_f sigma_a/S_e)^2 + (n_f sigma_m/S_y)^2 = 1", "(nf·σa/Se)² + (nf·σm/Sy)² = 1")],
  "fatigue-life": [eq("S = a N^b", "S = a·Nᵇ"), eq("a = (0.9 S_ut)^2/S_e", "a = (0.9·Sut)²/Se"), eq("b = -(1/3) log(0.9 S_ut/S_e)", "b = −(1/3)·log(0.9·Sut/Se)")],
  "fatigue-life:miner": [eq("D = sum(i=1, k, n_i/N_i)", "D = ∑ᵢ₌₁ᵏ nᵢ/Nᵢ")],
  "fracture-k": [
    eq("K = Y sigma sqrt(pi a)", "K = Y·σ·√(πa)"),
    eq("a_c = (1/pi) (K_IC/(Y sigma))^2", "ac = (1/π)·(KIC/(Y·σ))²"),
    eq("sigma_c = K_IC/(Y sqrt(pi a))", "σc = KIC/(Y·√(πa))"),
  ],
  "fracture-k:plastic-zone": [eq("r_p = (1/(6 pi)) (K/sigma_y)^2", "rp = (1/(6π))·(K/σy)²")],
  "fracture-k:plane-strain": [eq("B >= 2.5 (K_IC/sigma_y)^2", "B ≥ 2.5·(KIC/σy)²")],
  "fracture-paris": [
    eq("da/dN = {C} (Delta K)^m", "da/dN = C·(ΔK)ᵐ"),
    eq("Delta K = Y Delta sigma sqrt(pi a)", "ΔK = Y·Δσ·√(πa)"),
    eq("a_c = (1/pi) (K_IC/(Y Delta sigma))^2", "ac = (1/π)·(KIC/(Y·Δσ))²"),
    eq("N_f = int(a_0, a_c, da/({C} (Delta K)^m))", "Nf = ∫ₐ₀ᵃᶜ da/(C·(ΔK)ᵐ)"),
  ],
  "fracture-transition": [eq("a_t = (1/pi) (K_IC/(Y sigma_y))^2", "aₜ = (1/π)·(KIC/(Y·σy))²")],
  "fracture-transition:stress": [eq("sigma_f = K_IC/(Y sqrt(pi a))", "σf = KIC/(Y·√(πa))")],
  // ---- Reliability ----
  "rel-weibull": [
    eq("R(t) = exp(-(t/eta)^beta)", "R(t) = exp(−(t/η)ᵝ)"),
    eq("B_10 = {eta} (-ln(0.9))^{1/beta}", "B₁₀ = η·(−ln 0.9)¹ᐟᵝ"),
  ],
  "rel-weibull:mttf": [eq("MTTF = {eta} {Gamma} (1 + 1/beta)", "MTTF = η·Γ(1 + 1/β)")],
  "rel-rbd:series": [
    eq("R_s = prod(i=1, n, R_i)", "Rs = ∏ᵢ₌₁ⁿ Rᵢ"),
    eq("lambda_s = sum(i=1, n, lambda_i)", "λs = ∑ᵢ₌₁ⁿ λᵢ"),
    eq("MTTF = 1/lambda_s", "MTTF = 1/λs"),
  ],
  "rel-rbd:parallel": [eq("R_p = 1 - prod(i=1, n, (1 - R_i))", "Rp = 1 − ∏ᵢ₌₁ⁿ (1 − Rᵢ)")],
  "rel-koon": [
    eq("R_sys = sum(i=k, n, C(n, i) (1 - R)^{n - i} R^i)", "Rsys = ∑ᵢ₌ₖⁿ C(n, i)·(1 − R)ⁿ⁻ⁱ·Rⁱ"),
    eq("MTTF = (1/lambda) sum(i=k, n, 1/i)", "MTTF = (1/λ)·∑ᵢ₌ₖⁿ 1/i"),
  ],
  "rel-koon:derived": [eq("R = exp(-lambda t)", "R = exp(−λt)")],
  "rel-redundancy": [
    eq("R_active = 1 - (1 - exp(-lambda t))^n", "Ractive = 1 − (1 − exp(−λt))ⁿ"),
    eq("R_standby = exp(-lambda t) sum(i=0, n - 1, (lambda t)^i/i!)", "Rstandby = exp(−λt)·∑ᵢ₌₀ⁿ⁻¹ (λt)ⁱ/i!"),
    eq("MTTF_active = (1/lambda) sum(i=1, n, 1/i)", "MTTFactive = (1/λ)·∑ᵢ₌₁ⁿ 1/i"),
    eq("MTTF_standby = n/lambda", "MTTFstandby = n/λ"),
  ],
  "rel-availability": [eq("A = MTBF/(MTBF + MTTR)", "A = MTBF/(MTBF + MTTR)")],
  "rel-availability:series": [eq("A_sys = A^n", "Asys = Aⁿ")],
  // ---- Biomedical ----
  "haemodynamics:vessel": [
    eq("R = 8 mu L/(pi r^4)", "R = 8μ·L/(π·r⁴)"),
    eq("Delta p = Q R", "Δp = Q·R"),
    eq("V = Q/(pi r^2)", "V = Q/(π·r²)"),
    eq("Re = 2 rho V r/mu", "Re = 2ρ·V·r/μ"),
    eq("tau_w = 4 mu Q/(pi r^3)", "τw = 4μ·Q/(π·r³)"),
  ],
  "haemodynamics:circulation": [eq("SVR = 80 (MAP - CVP)/CO", "SVR = 80·(MAP − CVP)/CO")],
  "haemodynamics:stroke-volume": [eq("SV = 1000 CO/HR", "SV = 1000·CO/HR")],
  "haemodynamics:cardiac-index": [eq("CI = CO/BSA", "CI = CO/BSA")],
  biomechanics: [
    eq("M = W d_W + W_s d_s", "M = W·dW + Ws·ds"),
    eq("F_m = M/(d_m sin(theta))", "Fm = M/(dm·sin θ)"),
    eq("MA = d_m/d_W", "MA = dm/dW"),
  ],
  biosignal: [eq("f_N = f_s/2", "fN = fs/2")],
  "biosignal:record": [eq("N = f_s T", "N = fs·T"), eq("Delta f = 1/T", "Δf = 1/T")],
  // ---- Chips & semiconductors ----
  "chips-power": [eq("P_dyn = alpha C V^2 f", "Pdyn = α·C·V²·f"), eq("P_leak = V I_leak", "Pleak = V·Ileak"), eq("E = C V^2", "E = C·V²")],
  "chips-thermal": [eq("T_j = T_a + {P} (theta_jc + theta_cs + theta_sa)", "Tj = Ta + P·(θjc + θcs + θsa)")],
  "chips-thermal:limit": [eq("P_max = (T_jmax - T_a)/theta_total", "Pmax = (Tjmax − Ta)/θtotal")],
  "chips-delay": [
    eq("t_50 = ln(2) (C_w + C_l) R_d + 0.38 R_w C_w + ln(2) R_w C_l", "t₅₀ = ln 2·(Cw + Cl)·Rd + 0.38·Rw·Cw + ln 2·Rw·Cl"),
    eq("t_Elmore = R_w C_w/2", "tElmore = Rw·Cw/2"),
    eq("t_r = 2.2 ((C_w + C_l) R_d + (C_w/2 + C_l) R_w)", "tr = 2.2·((Cw + Cl)·Rd + (Cw/2 + Cl)·Rw)"),
  ],
  "chips-timing": [
    eq("slack_setup = T - (t_cq + t_max + t_su) + t_skew", "slack (setup) = T − (tcq + tmax + tsu) + tskew"),
    eq("slack_hold = t_cq + t_min - t_h - t_skew", "slack (hold) = tcq + tmin − th − tskew"),
    eq("f_max = 1/T_min", "fmax = 1/Tmin"),
  ],
  // ---- Computation & information ----
  "comp-speedup": [
    eq("S_A = 1/((1 - p) + p/N)", "SA = 1/((1 − p) + p/N)"),
    eq("S_G = (1 - p) + p N", "SG = (1 − p) + p·N"),
    eq("E = S_A/N", "E = SA/N"),
  ],
  "comp-speedup:karp-flatt": [eq("e = (1/psi - 1/N)/(1 - 1/N)", "e = (1/ψ − 1/N)/(1 − 1/N)")],
  "comp-entropy": [
    eq("H = -sum(i=1, n, p_i log_2 p_i)", "H = −∑ᵢ₌₁ⁿ pᵢ·log₂ pᵢ"),
    eq("H_max = log_2 n", "Hmax = log₂ n"),
    eq("R = 1 - H/H_max", "R = 1 − H/Hmax"),
  ],
  "comp-entropy:ideal": [eq("L = H N", "L = H·N")],
  "comp-channel": [
    eq("C = B log_2(1 + S/N)", "C = B·log₂(1 + S/N)"),
    eq("SNR = 10 log_10(S/N)", "SNR = 10·log₁₀(S/N)"),
    eq("eta = log_2(1 + S/N)", "η = log₂(1 + S/N)"),
    eq("E_b/N_0 = (exp(eta ln(2)) - 1)/eta", "Eb/N₀ = (exp(η·ln 2) − 1)/η"),
  ],
  "comp-channel:bsc": [eq("C_BSC = 1 + p log_2 p + (1 - p) log_2(1 - p)", "CBSC = 1 + p·log₂ p + (1 − p)·log₂(1 − p)")],
  "comp-collision:exact": [eq("P = 1 - prod(i=1, n - 1, (1 - i/d))", "P = 1 − ∏ᵢ₌₁ⁿ⁻¹ (1 − i/d)")],
  "comp-collision:approximation": [eq("P approx 1 - exp(-{n} (n - 1)/(2 d))", "P ≈ 1 − exp(−n(n − 1)/(2d))")],
  "comp-collision": [eq("E = {n} (n - 1)/(2 d)", "E = n(n − 1)/(2d)"), eq("n_50 approx sqrt(2 ln(2) d)", "n₅₀ ≈ √(2·ln 2·d)")],
  "comp-float": [eq("epsilon = 2^{-52}", "ε = 2⁻⁵²")],
  "comp-float:cancellation": [eq("kappa = max(abs(a), abs(b))/abs(a - b)", "κ = max(|a|, |b|)/|a − b|"), eq("n_lost = log_10 kappa", "nlost = log₁₀ κ")],
  "comp-scaling": [eq("k = ln(t_2/t_1)/ln(n_2/n_1)", "k = ln(t₂/t₁)/ln(n₂/n₁)")],
  "comp-scaling:predict": [eq("t = t_2 (n/n_2)^k", "t = t₂·(n/n₂)ᵏ")],
  // ---- Robotics & kinematics ----
  "robotics-fk": [
    eq("x = sum(i=1, n, L_i cos(phi_i))", "x = ∑ᵢ₌₁ⁿ Lᵢ·cos φᵢ"),
    eq("y = sum(i=1, n, L_i sin(phi_i))", "y = ∑ᵢ₌₁ⁿ Lᵢ·sin φᵢ"),
    eq("phi_i = sum(j=1, i, theta_j)", "φᵢ = ∑ⱼ₌₁ⁱ θⱼ"),
  ],
  "robotics-ik": [
    eq("cos(theta_2) = (x^2 + y^2 - L_1^2 - L_2^2)/(2 L_1 L_2)", "cos θ₂ = (x² + y² − L₁² − L₂²)/(2L₁L₂)"),
    eq("theta_1 = arg(x + j y) - arg(L_1 + L_2 cos(theta_2) + j L_2 sin(theta_2))", "θ₁ = arg(x + jy) − arg(L₁ + L₂·cos θ₂ + jL₂·sin θ₂)"),
  ],
  "robotics-jacobian": [
    eq(
      "J = matrix(-L_1 sin(theta_1) - L_2 sin(theta_1 + theta_2), -L_2 sin(theta_1 + theta_2); L_1 cos(theta_1) + L_2 cos(theta_1 + theta_2), L_2 cos(theta_1 + theta_2))",
      "J = [−L₁·sin θ₁ − L₂·sin(θ₁ + θ₂), −L₂·sin(θ₁ + θ₂); L₁·cos θ₁ + L₂·cos(θ₁ + θ₂), L₂·cos(θ₁ + θ₂)]",
    ),
    eq("det(J) = L_1 L_2 sin(theta_2)", "det J = L₁·L₂·sin θ₂"),
    eq("kappa = sigma_max/sigma_min", "κ = σmax/σmin"),
  ],
  "robotics-jacobian:torque": [eq("tau = J^T F", "τ = Jᵀ·F")],
  "robotics-dh": [
    eq("T = prod(i=1, n, A_i)", "T = ∏ᵢ₌₁ⁿ Aᵢ"),
    eq("A_i = Rot_{z} (theta_i) Trans_{z} (d_i) Trans_{x} (a_i) Rot_{x} (alpha_i)", "Aᵢ = Rotz(θᵢ)·Transz(dᵢ)·Transx(aᵢ)·Rotx(αᵢ)"),
  ],
  "robotics-profile:trapezoidal": [eq("t = d/v_max + v_max/a", "t = d/vmax + vmax/a")],
  "robotics-profile:triangular": [eq("v_peak = sqrt(a d)", "vpeak = √(a·d)"), eq("t = 2 sqrt(d/a)", "t = 2√(d/a)")],
  "robotics-diffdrive:wheels": [
    eq("v = (v_R + v_L)/2", "v = (vR + vL)/2"),
    eq("omega = (v_R - v_L)/W", "ω = (vR − vL)/W"),
    eq("R = v/omega", "R = v/ω"),
  ],
  "robotics-diffdrive:body": [eq("v_L = v - omega W/2", "vL = v − ω·W/2"), eq("v_R = v + omega W/2", "vR = v + ω·W/2")],
  "robotics-diffdrive:rates": [eq("omega_w = v/r", "ωw = v/r")],
  // ---- Aviation & avionics ----
  "aero-isa": [
    eq("H = r_0 z/(r_0 + z)", "H = r₀·z/(r₀ + z)"),
    eq("T = T_b + {L} (H - H_b)", "T = Tb + L·(H − Hb)"),
    eq("rho = p/(R T)", "ρ = p/(R·T)"),
    eq("a = sqrt(gamma R T)", "a = √(γ·R·T)"),
  ],
  "aero-isa:sloped": [eq("p = p_b {(T_b/T)}^{g_0/(R L)}", "p = pb·(Tb/T)ᵍ⁰ᐟ⁽ᴿᴸ⁾")],
  "aero-isa:isothermal": [eq("p = p_b exp(-g_0 {(H - H_b)}/(R T_b))", "p = pb·exp(−g₀·(H − Hb)/(R·Tb))")],
  "aero-airspeed": [
    eq("EAS = TAS sqrt(rho/rho_0)", "EAS = TAS·√(ρ/ρ₀)"),
    eq("M = TAS/a", "M = TAS/a"),
    eq("q_c = {p} ((1 + 0.2 M^2)^{3.5} - 1)", "qc = p·((1 + 0.2M²)³·⁵ − 1)"),
    eq("CAS = a_0 sqrt(5 ((q_c/p_0 + 1)^{2/7} - 1))", "CAS = a₀·√(5((qc/p₀ + 1)²ᐟ⁷ − 1))"),
  ],
  "aero-polar": [
    eq("C_L = 2 W/(rho V^2 S)", "CL = 2W/(ρ·V²·S)"),
    eq("C_D = C_{D0} + k C_L^2", "CD = CD0 + k·CL²"),
    eq("k = 1/(pi AR e)", "k = 1/(π·AR·e)"),
    eq("(L/D)_max = 1/(2 sqrt(k C_{D0}))", "(L/D)max = 1/(2√(k·CD0))"),
  ],
  "aero-polar:stall": [eq("V_s = sqrt(2 W/(rho S C_Lmax))", "Vs = √(2W/(ρ·S·CLmax))")],
  "aero-turn": [
    eq("n = 1/cos(phi)", "n = 1/cos φ"),
    eq("R = V^2/(g tan(phi))", "R = V²/(g·tan φ)"),
    eq("omega = g tan(phi)/V", "ω = g·tan φ/V"),
  ],
  "aero-turn:stall": [eq("V_{s turn} = V_s sqrt(n)", "Vs turn = Vs·√n")],
  "aero-climb": [eq("sin(gamma) = (T - D)/W", "sin γ = (T − D)/W"), eq("ROC = V sin(gamma)", "ROC = V·sin γ")],
  "aero-climb:glide": [eq("L/D = abs(cot(gamma))", "L/D = |cot γ|"), eq("R_glide = (L/D) h", "Rglide = (L/D)·h")],
  // ---- Optics & photonics ----
  "optics-photon": [eq("E = h c/lambda", "E = h·c/λ"), eq("nu = c/lambda", "ν = c/λ"), eq("k = 1/lambda", "k = 1/λ")],
  "optics-gaussian": [
    eq("z_R = pi w_0^2/(M^2 lambda)", "zR = π·w₀²/(M²·λ)"),
    eq("theta = M^2 lambda/(pi w_0)", "θ = M²·λ/(π·w₀)"),
    eq("w(z) = w_0 sqrt(1 + (z/z_R)^2)", "w(z) = w₀·√(1 + (z/zR)²)"),
    eq("R(z) = {z} (1 + (z_R/z)^2)", "R(z) = z·(1 + (zR/z)²)"),
  ],
  "optics-abcd": [eq("M = prod(i=1, n, M_{n + 1 - i})", "M = ∏ᵢ₌₁ⁿ Mₙ₊₁₋ᵢ")],
  "optics-abcd:beam": [eq("q_2 = (A q_1 + B)/(C q_1 + D)", "q₂ = (A·q₁ + B)/(C·q₁ + D)"), eq("1/q = 1/R - j lambda/(pi w^2)", "1/q = 1/R − jλ/(π·w²)")],
  "optics-resonator": [eq("g_i = 1 - L/R_i", "gᵢ = 1 − L/Rᵢ"), eq("0 <= g_1 g_2 <= 1", "0 ≤ g₁g₂ ≤ 1")],
  "optics-resonator:mode": [eq("w_0^4 = (lambda L/pi)^2 g_1 g_2 (1 - g_1 g_2)/(g_1 + g_2 - 2 g_1 g_2)^2", "w₀⁴ = (λL/π)²·g₁g₂(1 − g₁g₂)/(g₁ + g₂ − 2g₁g₂)²")],
  "optics-pulse": [eq("bar(P) = E f", "P̄ = E·f"), eq("D = tau f", "D = τ·f")],
  "optics-pulse:gaussian": [eq("P_peak = 2 sqrt(ln(2)/pi) E/tau", "Ppeak = 2√(ln 2/π)·E/τ")],
  "optics-pulse:sech2": [eq("P_peak = ln(1 + sqrt(2)) E/tau", "Ppeak = ln(1 + √2)·E/τ")],
  "optics-pulse:rectangular": [eq("P_peak = E/tau", "Ppeak = E/τ")],
  "optics-pulse:fluence": [eq("F_peak = 2 E/(pi w^2)", "Fpeak = 2E/(π·w²)"), eq("I_peak = 2 P_peak/(pi w^2)", "Ipeak = 2Ppeak/(π·w²)")],
  "optics-refraction": [
    eq("n_1 sin(theta_1) = n_2 sin(theta_2)", "n₁·sin θ₁ = n₂·sin θ₂"),
    eq("theta_B = arctan(n_2/n_1)", "θB = arctan(n₂/n₁)"),
    eq("R_0 = ((n_1 - n_2)/(n_1 + n_2))^2", "R₀ = ((n₁ − n₂)/(n₁ + n₂))²"),
  ],
  "optics-refraction:critical": [eq("theta_c = arcsin(n_2/n_1)", "θc = arcsin(n₂/n₁)")],
  "optics-diffraction": [eq("theta = 1.22 lambda/D", "θ = 1.22·λ/D")],
  "optics-diffraction:spot": [eq("d = 2.44 lambda f/D", "d = 2.44·λ·f/D")],
  "optics-diffraction:grating": [eq("sin(theta_m) = sin(theta_i) + m lambda/d", "sin θm = sin θᵢ + m·λ/d")],
  "optics-fibre": [
    eq("NA = sqrt(n_core^2 - n_clad^2)", "NA = √(ncore² − nclad²)"),
    eq("V = 2 pi a NA/lambda", "V = 2π·a·NA/λ"),
    eq("lambda_c = 2 pi a NA/2.405", "λc = 2π·a·NA/2.405"),
  ],
  // ---- Quantum optics ----
  "quantum-entanglement": [
    eq("C = 2 abs(a d - b c)", "C = 2·|ad − bc|"),
    eq("E = -lambda_1 log_2 lambda_1 - lambda_2 log_2 lambda_2", "E = −λ₁·log₂ λ₁ − λ₂·log₂ λ₂"),
    eq("S_max = 2 sqrt(1 + C^2)", "Smax = 2√(1 + C²)"),
  ],
  "quantum-chsh": [eq("S = E_1 - E_2 + E_3 + E_4", "S = E₁ − E₂ + E₃ + E₄"), eq("S_Q = 2 sqrt(2)", "SQ = 2√2")],
  "quantum-chsh:significance": [eq("n_sigma = (abs(S) - 2)/sigma_S", "nσ = (|S| − 2)/σS")],
  "quantum-werner": [
    eq("rho_W = p ket(Phi) bra(Phi) + (1 - p) I/4", "ρW = p·|Φ⟩⟨Φ| + (1 − p)·I/4"),
    eq("C = max(0, (3 p - 1)/2)", "C = max(0, (3p − 1)/2)"),
    eq("S_max = 2 sqrt(2) p", "Smax = 2√2·p"),
  ],
  "quantum-qkd": [eq("r = 1 - 2 H_2(Q)", "r = 1 − 2H₂(Q)"), eq("H_2(Q) = -Q log_2 Q - (1 - Q) log_2(1 - Q)", "H₂(Q) = −Q·log₂ Q − (1 − Q)·log₂(1 − Q)")],
  // ---- Energy & power ----
  "energy-wind": [eq("P = (1/2) rho A v^3", "P = ½·ρ·A·v³"), eq("P_Betz = (16/27) P", "PBetz = (16/27)·P")],
  "energy-wind:cp": [eq("P_out = C_p P", "Pout = Cp·P")],
  "energy-wind:tsr": [eq("lambda = omega R/v", "λ = ω·R/v")],
  "energy-wind:annual": [eq("E = 8760 CF P_out", "E = 8760·CF·Pout")],
  "energy-solar": [eq("P = G A eta", "P = G·A·η")],
  "energy-solar:derate": [eq("T_c = T_a + (NOCT - 20) G/800", "Tc = Ta + (NOCT − 20)·G/800"), eq("P_T = (1 + {gamma} (T_c - 25)) P", "PT = (1 + γ·(Tc − 25))·P")],
  "energy-solar:daily": [eq("E_day = P_1000 PSH PR", "Eday = P₁₀₀₀·PSH·PR")],
  "energy-fill-factor": [eq("F F = V_mp I_mp/(V_oc I_sc)", "FF = Vmp·Imp/(Voc·Isc)")],
  "energy-hydro": [eq("P = eta rho g Q H_net", "P = η·ρ·g·Q·Hnet"), eq("H_net = H - h_L", "Hnet = H − hL")],
  "energy-hydro:annual": [eq("E = 8760 CF P", "E = 8760·CF·P")],
  "energy-battery": [eq("V = s V_cell", "V = s·Vcell"), eq("Q = p Q_cell", "Q = p·Qcell"), eq("E = V Q", "E = V·Q")],
  "energy-battery:runtime": [eq("t = DoD Q/I", "t = DoD·Q/I"), eq("C_rate = I/Q", "Crate = I/Q")],
  "energy-battery:peukert": [eq("t_P = H (DoD Q/(I H))^k", "tP = H·(DoD·Q/(I·H))ᵏ")],
  "energy-combustion": [
    eq("n_{O2} = x + y/4 + w - z/2", "nO₂ = x + y/4 + w − z/2"),
    eq("AFR = n_{O2} (M_{O2} + 3.76 M_{N2})/M_fuel", "AFR = nO₂·(MO₂ + 3.76·MN₂)/Mfuel"),
    eq("m_{CO2} = x M_{CO2}/M_fuel", "mCO₂ = x·MCO₂/Mfuel"),
  ],
  "energy-combustion:excess": [eq("AFR_run = (1 + e) AFR", "AFRrun = (1 + e)·AFR")],
  "energy-combustion:lhv": [eq("LHV = HHV - h_fg m_{H2O}", "LHV = HHV − hfg·mH₂O")],
  "energy-lcoe": [
    eq("LCOE = (C_0 + sum(t=1, N, O/(1 + r)^t))/sum(t=1, N, E_1 (1 - d)^{t - 1}/(1 + r)^t)", "LCOE = (C₀ + ∑ₜ₌₁ᴺ O/(1 + r)ᵗ)/∑ₜ₌₁ᴺ E₁·(1 − d)ᵗ⁻¹/(1 + r)ᵗ"),
  ],
  "energy-capacity-factor": [eq("CF = E/(P T)", "CF = E/(P·T)"), eq("h_FL = E/P", "hFL = E/P")],
  "energy-three-phase": [
    eq("P = sqrt(3) V_L I_L pf", "P = √3·VL·IL·pf"),
    eq("S = sqrt(3) V_L I_L", "S = √3·VL·IL"),
    eq("Q = sqrt(S^2 - P^2)", "Q = √(S² − P²)"),
  ],
  "energy-pf-correction": [eq("Q_c = {P} (tan(phi_1) - tan(phi_2))", "Qc = P·(tan φ₁ − tan φ₂)"), eq("I_2/I_1 = pf_1/pf_2", "I₂/I₁ = pf₁/pf₂")],
  "energy-pf-correction:capacitance": [eq("C_Delta = Q_c/(3 omega V_L^2)", "CΔ = Qc/(3ω·VL²)"), eq("C_Y = 3 C_Delta", "CY = 3·CΔ")],
  "energy-voltage-drop": [eq("R = rho L/A", "R = ρ·L/A")],
  "energy-voltage-drop:two-wire": [eq("Delta V = 2 I rho L/A", "ΔV = 2I·ρ·L/A")],
  "energy-voltage-drop:three-phase": [eq("Delta V = sqrt(3) I rho L/A", "ΔV = √3·I·ρ·L/A")],
  "energy-voltage-drop:sizing": [eq("A_min = {A} (Delta V/V_s)/f_max", "Amin = A·(ΔV/Vs)/fmax")],
  "energy-wind-shear:power": [eq("v_2 = v_1 (h_2/h_1)^alpha", "v₂ = v₁·(h₂/h₁)ᵅ")],
  "energy-wind-shear:log": [eq("v_2 = v_1 ln(h_2/z_0)/ln(h_1/z_0)", "v₂ = v₁·ln(h₂/z₀)/ln(h₁/z₀)")],
  "energy-wind-shear": [eq("P_2/P_1 = (v_2/v_1)^3", "P₂/P₁ = (v₂/v₁)³")],
  "energy-weibull": [
    eq("f(v) = (k/c) (v/c)^{k - 1} exp(-(v/c)^k)", "f(v) = (k/c)·(v/c)ᵏ⁻¹·exp(−(v/c)ᵏ)"),
    eq("bar(v) = c {Gamma} (1 + 1/k)", "v̄ = c·Γ(1 + 1/k)"),
    eq("P/A = (1/2) rho c^3 {Gamma} (1 + 3/k)", "P/A = ½·ρ·c³·Γ(1 + 3/k)"),
  ],
  "energy-weibull:mode": [eq("v_mode = {c} ((k - 1)/k)^{1/k}", "vmode = c·((k − 1)/k)¹ᐟᵏ")],
  "energy-weibull:cf": [
    eq(
      "CF = int(v_ci, v_r, (v^3 - v_ci^3)/(v_r^3 - v_ci^3) f(v) dv) + F(v_co) - F(v_r)",
      "CF = ∫[vci, vr] (v³ − vci³)/(vr³ − vci³)·f(v) dv + F(vco) − F(vr)",
    ),
  ],
  "energy-flue-gas": [eq("e = f D/((1 - 4.76 f) n_{O2})", "e = f·D/((1 − 4.76f)·nO₂)"), eq("D = x + w + 3.76 n_{O2} + n_N/2", "D = x + w + 3.76·nO₂ + nN/2")],
  "energy-storage": [
    eq("E_bank = L t_a/(eta_inv sqrt(eta_rt) DoD)", "Ebank = L·ta/(ηinv·√ηrt·DoD)"),
    eq("E_charge = L/(eta_inv eta_rt)", "Echarge = L/(ηinv·ηrt)"),
  ],
  "energy-storage:lcos": [eq("LCOS = (C_0 + sum(t=1, N, O/(1 + r)^t))/sum(t=1, N, E_t/(1 + r)^t)", "LCOS = (C₀ + ∑ₜ₌₁ᴺ O/(1 + r)ᵗ)/∑ₜ₌₁ᴺ Eₜ/(1 + r)ᵗ")],
  "energy-solar-geometry": [
    eq("delta = 23.45 sin(360 (284 + n)/365)", "δ = 23.45·sin(360·(284 + n)/365)"),
    eq("omega_s = arccos(-tan(phi) tan(delta))", "ωs = arccos(−tan φ·tan δ)"),
    eq("alpha_noon = 90 - abs(phi - delta)", "αnoon = 90 − |φ − δ|"),
    eq("H_0 = (24/pi) G_sc E_0 (cos(phi) cos(delta) sin(omega_s) + omega_s sin(phi) sin(delta))", "H₀ = (24/π)·Gsc·E₀·(cos φ·cos δ·sin ωs + ωs·sin φ·sin δ)"),
  ],
  "energy-solar-geometry:hour": [eq("sin(alpha) = sin(phi) sin(delta) + cos(phi) cos(delta) cos(omega)", "sin α = sin φ·sin δ + cos φ·cos δ·cos ω")],
  "energy-flame-temp": [eq("LHV + q_pre = sum(i=1, N, {n_i} ({h_i} (T_ad) - {h_i} (T_0)))", "LHV + qpre = ∑ᵢ₌₁ᴺ nᵢ·(hᵢ(Tad) − hᵢ(T₀))")],
  // ---- Chemistry & electrochemistry ----
  nernst: [eq("E = E^degree - (R T/(n F)) ln(Q)", "E = E° − (R·T/(n·F))·ln Q")],
  "butler-volmer": [
    eq("j = j_0 (exp(alpha_a F eta/(R T)) - exp(-alpha_c F eta/(R T)))", "j = j₀·(exp(αa·F·η/(R·T)) − exp(−αc·F·η/(R·T)))"),
    eq("b = ln(10) R T/(alpha F)", "b = ln 10·R·T/(α·F)"),
  ],
  tafel: [eq("eta = a + b log_10 abs(j)", "η = a + b·log₁₀|j|"), eq("alpha = ln(10) R T/(abs(b) F)", "α = ln 10·R·T/(|b|·F)"), eq("j_0 = 10^{-a/b}", "j₀ = 10⁻ᵃᐟᵇ")],
  // ---- Audio & acoustics ----
  "audio-sampling": [eq("f_N = f_s/2", "fN = fs/2")],
  "audio-sampling:record": [eq("N = f_s T", "N = fs·T"), eq("Delta f = 1/T", "Δf = 1/T")],
  "audio-quantisation": [eq("SNR = 20 log_10(2) n + 10 log_10(3/2)", "SNR = 20·log₁₀(2)·n + 10·log₁₀(3/2)")],
  "audio-quantisation:lsb": [eq("LSB = V_FS/2^n", "LSB = VFS/2ⁿ")],
  "audio-quantisation:rate": [eq("R = n f_s N_ch", "R = n·fs·Nch")],
  "audio-decibel:power": [eq("L = 10 log_10(P_2/P_1)", "L = 10·log₁₀(P₂/P₁)")],
  "audio-decibel:field": [eq("L = 20 log_10(V_2/V_1)", "L = 20·log₁₀(V₂/V₁)")],
  "audio-spl": [eq("L_2 = L_1 - 20 log_10(d_2/d_1)", "L₂ = L₁ − 20·log₁₀(d₂/d₁)"), eq("p = p_0 10^{L/20}", "p = p₀·10ᴸᐟ²⁰")],
  "audio-spl:sum": [eq("L_tot = 10 log_10(sum(i=1, n, 10^{L_i/10}))", "Ltot = 10·log₁₀(∑ᵢ₌₁ⁿ 10ᴸⁱᐟ¹⁰)")],
  "audio-reverb": [
    eq("T_Sabine = 0.161 V/(S bar(alpha))", "TSabine = 0.161·V/(S·ᾱ)"),
    eq("T_Eyring = 0.161 V/(-S ln(1 - bar(alpha)))", "TEyring = 0.161·V/(−S·ln(1 − ᾱ))"),
    eq("f_S = 2000 sqrt(T/V)", "fS = 2000·√(T/V)"),
    eq("r_c = 0.057 sqrt(Q V/T)", "rc = 0.057·√(Q·V/T)"),
  ],
  "audio-roommodes": [eq("f = (c/2) sqrt((n_x/L)^2 + (n_y/W)^2 + (n_z/H)^2)", "f = (c/2)·√((nx/L)² + (ny/W)² + (nz/H)²)")],
  "audio-comb": [eq("t = Delta d/c", "t = Δd/c"), eq("f_notch = (2 k + 1)/(2 t)", "fnotch = (2k + 1)/(2t)"), eq("f_peak = k/t", "fpeak = k/t")],
  "audio-levels": [eq("L_dBu = 20 log_10(V_rms/0.7746)", "LdBu = 20·log₁₀(Vrms/0.7746)"), eq("L_dBV = 20 log_10(V_rms/1)", "LdBV = 20·log₁₀(Vrms/1)")],
  "audio-levelmath:sum": [eq("L = 10 log_10(sum(i=1, n, 10^{L_i/10}))", "L = 10·log₁₀(∑ᵢ₌₁ⁿ 10ᴸⁱᐟ¹⁰)")],
  "audio-levelmath:subtract": [eq("L_s = 10 log_10(10^{L_m/10} - 10^{L_b/10})", "Ls = 10·log₁₀(10ᴸᵐᐟ¹⁰ − 10ᴸᵇᐟ¹⁰)")],
  "audio-levelmath:average": [eq("L_eq = 10 log_10(sum(i=1, n, t_i 10^{L_i/10})/sum(i=1, n, t_i))", "Leq = 10·log₁₀(∑ᵢ₌₁ⁿ tᵢ·10ᴸⁱᐟ¹⁰/∑ᵢ₌₁ⁿ tᵢ)")],
  "audio-levelmath:coherent": [eq("L = 20 log_10 abs(sum(i=1, n, 10^{L_i/20} e^{j phi_i}))", "L = 20·log₁₀|∑ᵢ₌₁ⁿ 10ᴸⁱᐟ²⁰·eʲᵠⁱ|")],
  "audio-levelmath:weight": [eq("L_W = 10 log_10(sum(i=1, n, 10^{(L_i + W_i)/10}))", "LW = 10·log₁₀(∑ᵢ₌₁ⁿ 10⁽ᴸⁱ⁺ᵂⁱ⁾ᐟ¹⁰)")],
  "audio-levelmath:point": [eq("L_2 = L_1 - 20 log_10(d_2/d_1)", "L₂ = L₁ − 20·log₁₀(d₂/d₁)")],
  "audio-levelmath:line": [eq("L_2 = L_1 - 10 log_10(d_2/d_1)", "L₂ = L₁ − 10·log₁₀(d₂/d₁)")],
  "audio-dither": [
    eq("SNR = 20 log_10(2) n + 10 log_10(3/2)", "SNR = 20·log₁₀(2)·n + 10·log₁₀(3/2)"),
    eq("SNR_band = SNR - D + 10 log_10(OSR) + L_s", "SNRband = SNR − D + 10·log₁₀(OSR) + Ls"),
  ],
  "audio-filesize:pcm": [eq("R = f_s n N_ch", "R = fs·n·Nch")],
  "audio-filesize": [eq("size = R t/8", "size = R·t/8")],
  "audio-loudness:normalise": [eq("G = L_target - L_meas", "G = Ltarget − Lmeas"), eq("TP_after = TP + G", "TPafter = TP + G")],
  "audio-loudness:gated": [eq("L_I = 10 log_10((1/N) sum(j=1, N, 10^{L_j/10}))", "LI = 10·log₁₀((1/N)·∑ⱼ₌₁ᴺ 10ᴸʲᐟ¹⁰)")],
  "audio-loudness:sine": [eq("L_K = -0.691 + 10 log_10(sum(i=1, n, G_i z_i))", "LK = −0.691 + 10·log₁₀(∑ᵢ₌₁ⁿ Gᵢ·zᵢ)")],
  "audio-speaker": [eq("SPL = S_{1W} + 10 log_10(P) - 20 log_10(d)", "SPL = S1W + 10·log₁₀ P − 20·log₁₀ d"), eq("P_{2.83V} = 2.83^2/Z", "P2.83V = 2.83²/Z")],
  "audio-speaker:incoherent": [eq("G_box = 10 log_10(n)", "Gbox = 10·log₁₀ n")],
  "audio-speaker:coherent": [eq("G_box = 20 log_10(n)", "Gbox = 20·log₁₀ n")],
  "audio-absorption": [
    eq("A = sum(i=1, n, S_i alpha_i) + 4 m V", "A = ∑ᵢ₌₁ⁿ Sᵢ·αᵢ + 4m·V"),
    eq("T_Sabine = 0.161 V/A", "TSabine = 0.161·V/A"),
    eq("T_MS = 0.161 V/(-sum(i=1, n, S_i ln(1 - alpha_i)) + 4 m V)", "TMS = 0.161·V/(−∑ᵢ₌₁ⁿ Sᵢ·ln(1 − αᵢ) + 4m·V)"),
  ],
  "audio-crossover:1st": [eq("L = Z/(2 pi f_c)", "L = Z/(2π·fc)"), eq("C = 1/(2 pi f_c Z)", "C = 1/(2π·fc·Z)")],
  "audio-crossover:bw2": [eq("L = sqrt(2) Z/(2 pi f_c)", "L = √2·Z/(2π·fc)"), eq("C = 1/(2 sqrt(2) pi f_c Z)", "C = 1/(2√2·π·fc·Z)")],
  "audio-crossover:lr2": [eq("L = 2 Z/(2 pi f_c)", "L = 2Z/(2π·fc)"), eq("C = 1/(4 pi f_c Z)", "C = 1/(4π·fc·Z)")],
  "audio-damping": [
    eq("R_c = 2 rho L/A", "Rc = 2ρ·L/A"),
    eq("DF = Z_L/(Z_out + R_c)", "DF = ZL/(Zout + Rc)"),
    eq("Delta L = 20 log_10(Z_L/(Z_L + Z_out + R_c))", "ΔL = 20·log₁₀(ZL/(ZL + Zout + Rc))"),
  ],
  // ---- Video & display ----
  "video-bitrate": [eq("R = w h f b_px/CR", "R = w·h·f·bpx/CR"), eq("b_px = b k_chroma", "bpx = b·kchroma")],
  "video-bitrate:size": [eq("S = R t/8", "S = R·t/8")],
  "video-resolution": [eq("PPI = sqrt(w^2 + h^2)/d", "PPI = √(w² + h²)/d"), eq("d_r = (0.0254/PPI)/tan((1/60) degree)", "dr = (0.0254/PPI)/tan((1/60)°)")],
  "video-hdr": [
    eq("CR = L_peak/L_black", "CR = Lpeak/Lblack"),
    eq("stops = log_2(CR)", "stops = log₂(CR)"),
    eq("E = ((c_1 + c_2 Y^{m_1})/(1 + c_3 Y^{m_1}))^{m_2}", "E = ((c₁ + c₂·Yᵐ¹)/(1 + c₃·Yᵐ¹))ᵐ²"),
    eq("Y = L/10000", "Y = L/10000"),
  ],
  "video-psnr": [eq("PSNR = 10 log_10(MAX^2/MSE)", "PSNR = 10·log₁₀(MAX²/MSE)"), eq("MAX = 2^b - 1", "MAX = 2ᵇ − 1")],
  "video-stream": [eq("t_buf = 8 B/R", "tbuf = 8B/R"), eq("t_start = 8 B/(BW - R)", "tstart = 8B/(BW − R)")],
  "video-latency": [eq("t = sum(i=1, n, t_i)", "t = ∑ᵢ₌₁ⁿ tᵢ"), eq("t_shown = ceil(t f_r)/f_r", "tshown = ⌈t·fr⌉/fr")],
  "video-timecode": [eq("t = N/f", "t = N/f")],
  "video-framerate": [eq("T = 1/f", "T = 1/f"), eq("n_a = f_a/f", "na = fa/f")],
  "video-framerate:shutter": [eq("t_s = (theta/360)/f", "ts = (θ/360)/f")],
  "video-aspect": [eq("DAR = SAR PAR", "DAR = SAR·PAR")],
  "video-interface": [eq("R_link = W_t H_t f b_px", "Rlink = Wt·Ht·f·bpx"), eq("R_active = W_a H_a f b_px", "Ractive = Wa·Ha·f·bpx"), eq("t_rec = 8 C/R", "trec = 8C/R")],
  // ---- Light & camera ----
  "light-photometry": [
    eq("E = I cos(theta)/d^2", "E = I·cos θ/d²"),
    eq("Omega = 4 pi sin(beta/4)^2", "Ω = 4π·sin(β/4)²"),
    eq("Phi = I Omega", "Φ = I·Ω"),
    eq("L = (Phi/A) g/pi", "L = (Φ/A)·g/π"),
  ],
  "light-exposure": [
    eq("EV = log_2(N^2/t)", "EV = log₂(N²/t)"),
    eq("EV_100 = EV - log_2(S/100)", "EV₁₀₀ = EV − log₂(S/100)"),
    eq("H = f^2/(N c) + f", "H = f²/(N·c) + f"),
    eq("D_near = {s} (H - f)/(H + s - 2 f)", "Dnear = s·(H − f)/(H + s − 2f)"),
    eq("D_far = {s} (H - f)/(H - s)", "Dfar = s·(H − f)/(H − s)"),
    eq("AOV = 2 arctan(d/(2 f))", "AOV = 2·arctan(d/(2f))"),
  ],
  "light-colourtemp": [eq("M = 10^6/T", "M = 10⁶/T"), eq("Delta M = M_2 - M_1", "ΔM = M₂ − M₁")],
  "light-colourtemp:mccamy": [
    eq("CCT = -449 n^3 + 3525 n^2 - 6823.3 n + 5520.33", "CCT = −449n³ + 3525n² − 6823.3n + 5520.33"),
    eq("n = (x - 0.3320)/(y - 0.1858)", "n = (x − 0.3320)/(y − 0.1858)"),
  ],
  // ---- Trajectory & orbits ----
  "traj-vacuum": [
    eq("y = h + v t sin(theta) - (1/2) g t^2", "y = h + v·t·sin θ − ½·g·t²"),
    eq("R = (v cos(theta)/g) (v sin(theta) + sqrt(v^2 sin(theta)^2 + 2 g h))", "R = (v·cos θ/g)·(v·sin θ + √(v²·sin(θ)² + 2g·h))"),
    eq("theta_opt = arctan(v/sqrt(v^2 + 2 g h))", "θopt = arctan(v/√(v² + 2g·h))"),
  ],
  "traj-drag": [eq("{m} {d vec(v)}/{d t} = {m} vec(g) - (1/2) rho C_d A abs(vec(v)) vec(v)", "m·dv⃗/dt = m·g⃗ − ½·ρ·Cd·A·|v⃗|·v⃗")],
  "traj-aim": [eq("sin(2 theta) = g d/v^2", "sin 2θ = g·d/v²"), eq("R_max = v^2/g", "Rmax = v²/g")],
  "traj-impact": [
    eq("v_t = sqrt(2 m g/(rho C_d A))", "vt = √(2m·g/(ρ·Cd·A))"),
    eq("v(h) = v_t sqrt(1 - exp(-2 g h/v_t^2))", "v(h) = vt·√(1 − exp(−2g·h/vt²))"),
    eq("E = (1/2) m v^2", "E = ½·m·v²"),
    eq("p = m v", "p = m·v"),
  ],
  "orbit-circular": [eq("v = sqrt(mu/r)", "v = √(μ/r)"), eq("T = 2 pi sqrt(r^3/mu)", "T = 2π·√(r³/μ)"), eq("v_esc = sqrt(2 mu/r)", "vesc = √(2μ/r)")],
  "orbit-elliptical": [
    eq("a = (r_p + r_a)/2", "a = (rₚ + rₐ)/2"),
    eq("e = (r_a - r_p)/(r_a + r_p)", "e = (rₐ − rₚ)/(rₐ + rₚ)"),
    eq("v^2 = {mu} (2/r - 1/a)", "v² = μ·(2/r − 1/a)"),
    eq("T = 2 pi sqrt(a^3/mu)", "T = 2π·√(a³/μ)"),
  ],
  "orbit-hohmann": [
    eq("a_T = (r_1 + r_2)/2", "aT = (r₁ + r₂)/2"),
    eq("Delta v_1 = sqrt({mu} (2/r_1 - 1/a_T)) - sqrt(mu/r_1)", "Δv₁ = √(μ·(2/r₁ − 1/aT)) − √(μ/r₁)"),
    eq("Delta v_2 = sqrt(mu/r_2) - sqrt({mu} (2/r_2 - 1/a_T))", "Δv₂ = √(μ/r₂) − √(μ·(2/r₂ − 1/aT))"),
    eq("t_T = pi sqrt(a_T^3/mu)", "tT = π·√(aT³/μ)"),
    eq("phi = pi - n_2 t_T", "φ = π − n₂·tT"),
  ],
  "orbit-rocket": [eq("Delta v = v_e ln(m_0/m_f)", "Δv = vₑ·ln(m₀/mf)"), eq("v_e = I_sp g_0", "vₑ = Isp·g₀")],
  "orbit-escape": [eq("v_esc = sqrt(2 mu/r)", "vesc = √(2μ/r)"), eq("v_esc = sqrt(2) v_circ", "vesc = √2·vcirc")],
  "nav-greatcircle": [
    eq("d = 2 R arcsin(sqrt(sin(Delta phi/2)^2 + cos(phi_1) cos(phi_2) sin(Delta lambda/2)^2))", "d = 2R·arcsin(√(sin(Δφ/2)² + cos φ₁·cos φ₂·sin(Δλ/2)²))"),
    eq("theta_0 = arg(cos(phi_1) sin(phi_2) - sin(phi_1) cos(phi_2) cos(Delta lambda) + j sin(Delta lambda) cos(phi_2))", "θ₀ = arg(cos φ₁·sin φ₂ − sin φ₁·cos φ₂·cos Δλ + j·sin Δλ·cos φ₂)"),
  ],
  "nav-windtriangle": [
    eq("sin(WCA) = W sin(theta_w - theta_tr)/V", "sin WCA = W·sin(θw − θtr)/V"),
    eq("GS = V cos(WCA) - W cos(theta_w - theta_tr)", "GS = V·cos WCA − W·cos(θw − θtr)"),
  ],
  "radiation:shields": [eq("F = 1/(1/epsilon_1 + 1/epsilon_2 - 1 + (2/epsilon_s - 1) N)", "F = 1/(1/ε₁ + 1/ε₂ − 1 + (2/εs − 1)·N)")],
};

/** The governing-equation lines for a tool (or `tool:branch`); empty for a key that has none. */
export function engEq(key: string): EngLine[] {
  return ENG_EQUATIONS[key] ?? [];
}

