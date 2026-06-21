// A categorized library of common formulas. Each entry's `expr` is written in the
// linear math syntax understood by mathParse.ts, so selecting one populates the
// Math input and inserts as a native Word equation (and previews via mathHtml).
//
// Syntax reminders: a/b fraction · x^2 / a_n super/subscript · sqrt(x), root(n,x)
// · sum(lo,hi,body) Σ · int(lo,hi,body) ∫ · prod, lim(x->0,body) · abs(x)/|x|
// · bar(x) hat(x) vec(x) accents · sin(x)…log/ln functions · n! factorial · +- → ±.

export interface Formula {
  label: string;
  expr: string;
}

export interface FormulaCategory {
  name: string;
  formulas: Formula[];
}

export const FORMULA_LIBRARY: FormulaCategory[] = [
  {
    name: "Statistics",
    formulas: [
      { label: "Sample mean", expr: "bar(x) = (1/n) sum(i=1, n, x_i)" },
      { label: "Sample variance", expr: "s^2 = (1/(n-1)) sum(i=1, n, (x_i - bar(x))^2)" },
      { label: "Sample standard deviation", expr: "s = sqrt((1/(n-1)) sum(i=1, n, (x_i - bar(x))^2))" },
      { label: "Population standard deviation", expr: "sigma = sqrt((1/N) sum(i=1, N, (x_i - mu)^2))" },
      { label: "Z-score", expr: "z = (x - mu)/sigma" },
      { label: "Standard error of the mean", expr: "SE = sigma/sqrt(n)" },
      {
        label: "Pearson correlation",
        expr:
          "r = sum(i=1, n, (x_i - bar(x))(y_i - bar(y))) / sqrt(sum(i=1, n, (x_i - bar(x))^2) sum(i=1, n, (y_i - bar(y))^2))",
      },
      { label: "Normal distribution (PDF)", expr: "f(x) = (1/(sigma sqrt(2 pi))) e^(-(x - mu)^2/(2 sigma^2))" },
      { label: "Combinations (n choose k)", expr: "C(n, k) = n!/(k!(n - k)!)" },
    ],
  },
  {
    name: "Geometry",
    formulas: [
      { label: "Area of a circle", expr: "A = pi r^2" },
      { label: "Circumference of a circle", expr: "C = 2 pi r" },
      { label: "Area of a triangle", expr: "A = (1/2) b h" },
      { label: "Heron's formula", expr: "A = sqrt(s(s - a)(s - b)(s - c))" },
      { label: "Pythagorean theorem", expr: "c = sqrt(a^2 + b^2)" },
      { label: "Distance between two points", expr: "d = sqrt((x_2 - x_1)^2 + (y_2 - y_1)^2)" },
      { label: "Slope of a line", expr: "m = (y_2 - y_1)/(x_2 - x_1)" },
      { label: "Volume of a sphere", expr: "V = (4/3) pi r^3" },
      { label: "Volume of a cylinder", expr: "V = pi r^2 h" },
      { label: "Volume of a cone", expr: "V = (1/3) pi r^2 h" },
    ],
  },
  {
    name: "Algebra",
    formulas: [
      { label: "Quadratic formula", expr: "x = (-b +- sqrt(b^2 - 4 a c))/(2 a)" },
      { label: "Slope-intercept line", expr: "y = m x + b" },
      { label: "Difference of squares", expr: "a^2 - b^2 = (a - b)(a + b)" },
      { label: "Square of a binomial", expr: "(a + b)^2 = a^2 + 2 a b + b^2" },
      { label: "Product of powers", expr: "a^m a^n = a^(m + n)" },
      { label: "Logarithm of a product", expr: "log(x y) = log(x) + log(y)" },
      { label: "Change of base", expr: "log_b(x) = ln(x)/ln(b)" },
    ],
  },
  {
    name: "Trigonometry",
    formulas: [
      { label: "Pythagorean identity", expr: "sin(x)^2 + cos(x)^2 = 1" },
      { label: "Tangent definition", expr: "tan(x) = sin(x)/cos(x)" },
      { label: "Sine double angle", expr: "sin(2 x) = 2 sin(x) cos(x)" },
      { label: "Cosine double angle", expr: "cos(2 x) = cos(x)^2 - sin(x)^2" },
      { label: "Sine angle addition", expr: "sin(a + b) = sin(a) cos(b) + cos(a) sin(b)" },
      { label: "Law of cosines", expr: "c^2 = a^2 + b^2 - 2 a b cos(C)" },
      { label: "Law of sines", expr: "a/sin(A) = b/sin(B) = c/sin(C)" },
    ],
  },
  {
    name: "Calculus",
    formulas: [
      { label: "Derivative (limit definition)", expr: "(df)/(dx) = lim(h -> 0, (f(x + h) - f(x))/h)" },
      { label: "Power rule", expr: "(d/dx) x^n = n x^(n - 1)" },
      { label: "Fundamental theorem", expr: "int(a, b, f(x)) = F(b) - F(a)" },
      { label: "Sum of first n integers", expr: "sum(i=1, n, i) = n(n + 1)/2" },
      { label: "Geometric series", expr: "sum(n=0, infinity, r^n) = 1/(1 - r)" },
      { label: "Definition of e", expr: "e = lim(n -> infinity, (1 + 1/n)^n)" },
    ],
  },
  {
    name: "Cryptography",
    formulas: [
      { label: "RSA encryption", expr: "c = m^e mod n" },
      { label: "RSA decryption", expr: "m = c^d mod n" },
      { label: "Euler's totient (RSA modulus)", expr: "φ(n) = (p - 1)(q - 1)" },
      { label: "Modular exponentiation", expr: "y = g^x mod p" },
      { label: "Diffie–Hellman shared secret", expr: "K = B^a mod p" },
      { label: "Congruence (mod n)", expr: "a ≡ b (mod n)" },
      { label: "Birthday bound", expr: "p ≈ 1 - e^(-(k^2)/(2 N))" },
    ],
  },
  {
    name: "Computer science / ML",
    formulas: [
      { label: "Shannon entropy", expr: "H(X) = -sum(i=1, n, p_i log(p_i))" },
      { label: "Cross-entropy", expr: "H(p, q) = -sum(i=1, n, p_i log(q_i))" },
      { label: "Sigmoid", expr: "σ(x) = 1/(1 + e^(-x))" },
      { label: "Softmax", expr: "softmax(x_i) = e^(x_i)/sum(j=1, n, e^(x_j))" },
      { label: "Gradient-descent update", expr: "θ = θ - α ∇J(θ)" },
      { label: "Mean squared error", expr: "MSE = (1/n) sum(i=1, n, (y_i - hat(y)_i)^2)" },
      { label: "Asymptotic bound", expr: "T(n) = O(n log(n))" },
    ],
  },
  {
    name: "Mechanical engineering",
    formulas: [
      { label: "Normal stress", expr: "σ = F/A" },
      { label: "Strain", expr: "ε = (Δ L)/L" },
      { label: "Hooke's law", expr: "σ = E ε" },
      { label: "Newton's second law", expr: "F = m a" },
      { label: "Torque", expr: "τ = r × F" },
      { label: "Kinetic energy", expr: "E_k = (1/2) m v^2" },
      { label: "Beam bending stress", expr: "σ = (M c)/I" },
      { label: "Reynolds number", expr: "Re = (ρ v L)/μ" },
    ],
  },
  {
    name: "Biology / assays",
    formulas: [
      { label: "Michaelis–Menten", expr: "v = (V_max [S])/(K_m + [S])" },
      { label: "Hill equation", expr: "θ = [L]^n/(K_d^n + [L]^n)" },
      { label: "Hardy–Weinberg", expr: "p^2 + 2 p q + q^2 = 1" },
      { label: "PCR amplification", expr: "N = N_0 2^n" },
      { label: "Beer–Lambert law", expr: "A = ε l c" },
      { label: "Gibbs free energy", expr: "Δ G = Δ H - T Δ S" },
    ],
  },
  {
    name: "Electrical engineering",
    formulas: [
      { label: "Ohm's law", expr: "V = I R" },
      { label: "Resistors in series", expr: "R = R_1 + R_2 + R_3" },
      { label: "Resistors in parallel", expr: "1/R = 1/R_1 + 1/R_2" },
      { label: "Impedance", expr: "Z = R + j X" },
      { label: "Capacitive reactance", expr: "X_C = 1/(2 π f C)" },
      { label: "RC time constant", expr: "τ = R C" },
      { label: "Resonant frequency", expr: "f_0 = 1/(2 π sqrt(L C))" },
      { label: "Power (dissipated)", expr: "P = I^2 R" },
      { label: "RMS voltage", expr: "V_rms = V_0/sqrt(2)" },
      { label: "Gain in decibels", expr: "G_dB = 20 log(V_o/V_i)" },
      { label: "Sinusoidal voltage", expr: "v(t) = V_m cos(ω t + φ)" },
    ],
  },
  {
    name: "Trig functions",
    formulas: [
      { label: "Sine", expr: "sin(x)" },
      { label: "Cosine", expr: "cos(x)" },
      { label: "Tangent", expr: "tan(x) = sin(x)/cos(x)" },
      { label: "Cotangent", expr: "cot(x) = cos(x)/sin(x)" },
      { label: "Secant", expr: "sec(x) = 1/cos(x)" },
      { label: "Cosecant", expr: "csc(x) = 1/sin(x)" },
      { label: "Inverse sine", expr: "arcsin(x)" },
      { label: "Inverse tangent", expr: "arctan(x)" },
    ],
  },
  {
    name: "Hyperbolic functions",
    formulas: [
      { label: "Sinh", expr: "sinh(x) = (e^x - e^(-x))/2" },
      { label: "Cosh", expr: "cosh(x) = (e^x + e^(-x))/2" },
      { label: "Tanh", expr: "tanh(x) = sinh(x)/cosh(x)" },
      { label: "Sech", expr: "sech(x) = 1/cosh(x)" },
      { label: "Inverse sinh", expr: "arsinh(x) = ln(x + sqrt(x^2 + 1))" },
    ],
  },
  {
    name: "Log & exponential",
    formulas: [
      { label: "Natural log", expr: "ln(x)" },
      { label: "Common log", expr: "log(x)" },
      { label: "Exponential", expr: "exp(x) = e^x" },
      { label: "Change of base", expr: "log_b(x) = ln(x)/ln(b)" },
      { label: "Log of a power", expr: "log(x^n) = n log(x)" },
      { label: "Logistic / sigmoid", expr: "σ(x) = 1/(1 + e^(-x))" },
    ],
  },
  {
    name: "Special functions",
    formulas: [
      { label: "Gamma function", expr: "Γ(n) = (n - 1)!" },
      { label: "Error function", expr: "erf(x) = (2/sqrt(π)) int(0, x, e^(-t^2))" },
      { label: "Riemann zeta", expr: "ζ(s) = sum(n=1, infinity, 1/n^s)" },
      { label: "Sign function", expr: "sgn(x)" },
      { label: "Factorial", expr: "n! = prod(k=1, n, k)" },
    ],
  },
  {
    name: "Discrete & combinatorics",
    formulas: [
      { label: "Combinations (n choose k)", expr: "C(n, k) = n!/(k!(n - k)!)" },
      { label: "Permutations", expr: "P(n, k) = n!/(n - k)!" },
      { label: "Binomial theorem", expr: "(x + y)^n = sum(k=0, n, C(n, k) x^(n - k) y^k)" },
      { label: "GCD / LCM relation", expr: "gcd(a, b) lcm(a, b) = a b" },
      { label: "Modulo", expr: "a mod n" },
      { label: "Floor & ceiling", expr: "floor(x) <= x <= ceil(x)" },
    ],
  },
  {
    name: "Physics",
    formulas: [
      { label: "Mass–energy equivalence", expr: "E = m c^2" },
      { label: "Relativistic energy", expr: "E = sqrt((p c)^2 + (m c^2)^2)" },
      { label: "Lorentz factor", expr: "γ = 1/sqrt(1 - v^2/c^2)" },
      { label: "Planck relation", expr: "E = hbar ω" },
      { label: "de Broglie wavelength", expr: "lambda = h/p" },
      { label: "Heisenberg uncertainty", expr: "Delta x Delta p >= hbar/2" },
      { label: "Schrödinger (time-independent)", expr: "hat(H) ψ = E ψ" },
      { label: "Expectation value", expr: "expval(A) = braket(ψ, A ψ)" },
      { label: "Ideal gas law", expr: "P V = n R T" },
      { label: "Coulomb's law", expr: "F = k (q_1 q_2)/r^2" },
      { label: "Newtonian gravitation", expr: "F = G (m_1 m_2)/r^2" },
      { label: "Wave speed", expr: "v = f lambda" },
    ],
  },
  {
    name: "Finance — time value",
    formulas: [
      { label: "Future value", expr: "FV = PV(1 + r)^n" },
      { label: "Present value", expr: "PV = FV/(1 + r)^n" },
      { label: "Compound interest", expr: "A = P(1 + r/n)^{n t}" },
      { label: "Continuous compounding", expr: "A = P e^{r t}" },
      { label: "Present value of annuity", expr: "PV = PMT (1 - (1 + r)^{-n})/r" },
      { label: "Future value of annuity", expr: "FV = PMT ((1 + r)^n - 1)/r" },
      { label: "Perpetuity", expr: "PV = C/r" },
      { label: "Loan payment", expr: "PMT = (P r)/(1 - (1 + r)^{-n})" },
      { label: "CAGR", expr: "CAGR = (V_f/V_i)^{1/n} - 1" },
    ],
  },
  {
    name: "Finance — valuation & options",
    formulas: [
      { label: "Net present value", expr: "NPV = sum(t=0, n, C_t/(1 + r)^t)" },
      { label: "Gordon growth (DDM)", expr: "P_0 = D_1/(r - g)" },
      { label: "WACC", expr: "WACC = (E/V) r_e + (D/V) r_d (1 - T)" },
      { label: "Black–Scholes call", expr: "C = S_0 N(d_1) - K e^{-r t} N(d_2)" },
      { label: "Black–Scholes d₁", expr: "d_1 = (ln(S_0/K) + (r + sigma^2/2) t)/(sigma sqrt(t))" },
      { label: "Black–Scholes d₂", expr: "d_2 = d_1 - sigma sqrt(t)" },
      { label: "Put–call parity", expr: "C - P = S_0 - K e^{-r t}" },
    ],
  },
  {
    name: "Finance — portfolio & bonds",
    formulas: [
      { label: "CAPM", expr: "E(R_i) = R_f + beta_i (E(R_m) - R_f)" },
      { label: "Sharpe ratio", expr: "S = (R_p - R_f)/sigma_p" },
      { label: "Portfolio variance (2-asset)", expr: "sigma_p^2 = w_1^2 sigma_1^2 + w_2^2 sigma_2^2 + 2 w_1 w_2 rho sigma_1 sigma_2" },
      { label: "Beta", expr: "beta = Cov(R_i, R_m)/Var(R_m)" },
      { label: "Bond price", expr: "P = sum(t=1, n, C/(1 + y)^t) + F/(1 + y)^n" },
      { label: "Current yield", expr: "Y = C/P_0" },
      { label: "Macaulay duration", expr: "D = (1/P) sum(t=1, n, (t C_t)/(1 + y)^t)" },
    ],
  },
];
