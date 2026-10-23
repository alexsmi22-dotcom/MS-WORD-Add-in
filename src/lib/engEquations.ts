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
  "radiation:shields": [eq("F = 1/(1/epsilon_1 + 1/epsilon_2 - 1 + (2/epsilon_s - 1) N)", "F = 1/(1/ε₁ + 1/ε₂ − 1 + (2/εs − 1)·N)")],
};

/** The governing-equation lines for a tool (or `tool:branch`); empty for a key that has none. */
export function engEq(key: string): EngLine[] {
  return ENG_EQUATIONS[key] ?? [];
}

// Referenced so the helper is not flagged unused while the table is being filled.
void eq;
