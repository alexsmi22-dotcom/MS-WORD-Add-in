// Clickable palette definitions for the task pane. Each item inserts `snippet`
// at the cursor in the input; `caret` is the offset within the snippet where the
// cursor should land afterward (defaults to end of snippet). Items are grouped so
// the UI can render labeled rows. Math snippets use the mathParse syntax; chemical
// snippets are plain text that the chemical formatter auto-formats.

export interface PaletteItem {
  label: string;
  snippet: string;
  caret?: number;
  title?: string;
}

export interface PaletteGroup {
  name: string;
  items: PaletteItem[];
}

export const MATH_PALETTE: PaletteGroup[] = [
  {
    name: "Structures",
    items: [
      { label: "a/b", snippet: "()/()", caret: 1, title: "Fraction" },
      { label: "√", snippet: "sqrt()", caret: 5, title: "Square root" },
      { label: "ⁿ√", snippet: "root(3, )", caret: 8, title: "n-th root" },
      // BRACED, WITH THE CARET INSIDE. This was `{ snippet: "^", caret: 1 }`, and
      // "^" alone binds to ONE token: a user who clicked it and typed n-1 got
      // x^n − 1, not x^(n−1). There was no braced-group snippet anywhere in this
      // file, so the palette could not express a multi-token exponent at all —
      // while the formula library and the app's own help both teach the braced form.
      // Braces are grouping only in mathParse, so they leave no bracket in the
      // typeset output (a paren exponent would render x^((n−1))).
      { label: "xⁿ", snippet: "^{}", caret: 2, title: "Superscript / power" },
      // Same one-token defect as the superscript above, same fix: "_" alone
      // binds to a single token, so clicking it and typing i+1 gave x_i + 1.
      { label: "xₙ", snippet: "_{}", caret: 2, title: "Subscript" },
      { label: "( )", snippet: "()", caret: 1, title: "Parentheses" },
      { label: "|x|", snippet: "abs()", caret: 4, title: "Absolute value" },
      { label: "x̄", snippet: "bar()", caret: 4, title: "Overbar (mean)" },
    ],
  },
  {
    name: "Big operators",
    items: [
      { label: "Σ", snippet: "sum(i=1, n, )", caret: 12, title: "Summation" },
      { label: "∫", snippet: "int(a, b, )", caret: 10, title: "Integral" },
      { label: "∏", snippet: "prod(i=1, n, )", caret: 13, title: "Product" },
      { label: "lim", snippet: "lim(x -> 0, )", caret: 12, title: "Limit" },
    ],
  },
  {
    name: "Matrices",
    items: [
      { label: "[matrix]", snippet: "matrix(a, b; c, d)", caret: 7, title: "Matrix (rows ';', columns ',')" },
      { label: "(matrix)", snippet: "pmatrix(a, b; c, d)", caret: 8, title: "Matrix with parentheses" },
      { label: "|det|", snippet: "vmatrix(a, b; c, d)", caret: 8, title: "Determinant (vertical bars)" },
      { label: "{cases", snippet: "cases(x, if x > 0; -x, otherwise)", caret: 6, title: "Piecewise / cases" },
    ],
  },
  {
    name: "Logic & sets",
    items: [
      { label: "∧", snippet: "∧", title: "AND / conjunction" },
      { label: "∨", snippet: "∨", title: "OR / disjunction" },
      { label: "¬", snippet: "¬", title: "NOT / negation" },
      { label: "⊕", snippet: "⊕", title: "XOR / exclusive-or" },
      { label: "⇒", snippet: "⇒", title: "Implies" },
      { label: "⇔", snippet: "⇔", title: "If and only if" },
      { label: "∀", snippet: "∀", title: "For all" },
      { label: "∃", snippet: "∃", title: "There exists" },
      { label: "∈", snippet: "∈", title: "Element of" },
      { label: "∉", snippet: "∉", title: "Not an element of" },
      { label: "⊆", snippet: "⊆", title: "Subset or equal" },
      { label: "∪", snippet: "∪", title: "Union" },
      { label: "∩", snippet: "∩", title: "Intersection" },
      { label: "∅", snippet: "∅", title: "Empty set" },
    ],
  },
  {
    name: "Number sets",
    items: [
      { label: "ℤ", snippet: "ZZ", title: "Integers (e.g. ZZ_n)" },
      { label: "ℝ", snippet: "RR", title: "Real numbers" },
      { label: "ℕ", snippet: "NN", title: "Natural numbers" },
      { label: "ℚ", snippet: "QQ", title: "Rationals" },
      { label: "ℂ", snippet: "CC", title: "Complex numbers" },
      { label: "𝔽", snippet: "FF", title: "Finite field (e.g. FF_q)" },
      { label: "𝔼", snippet: "EE", title: "Expectation" },
    ],
  },
  {
    name: "Advanced",
    items: [
      { label: "∂", snippet: "∂", title: "Partial derivative" },
      { label: "∇", snippet: "∇", title: "Gradient / nabla" },
      { label: "⌊x⌋", snippet: "floor()", caret: 6, title: "Floor" },
      { label: "⌈x⌉", snippet: "ceil()", caret: 5, title: "Ceiling" },
      { label: "‖x‖", snippet: "norm()", caret: 5, title: "Norm / magnitude" },
      { label: "mod", snippet: " mod ", title: "Modulo (upright)" },
      { label: "≡", snippet: "≡", title: "Equivalent / congruent (mod n)" },
      { label: "≅", snippet: "≅", title: "Congruent" },
      { label: "∝", snippet: "∝", title: "Proportional to" },
      { label: "∥", snippet: "∥", title: "Parallel / concatenation" },
      { label: "°", snippet: "°", title: "Degree" },
    ],
  },
  {
    name: "Engineering & physics",
    items: [
      { label: "∠", snippet: "∠", title: "Phasor angle (V∠θ)" },
      { label: "ℏ", snippet: "hbar", title: "Reduced Planck constant ℏ" },
      { label: "Ω", snippet: "ohm", title: "Ohm" },
      { label: "⟨ψ|", snippet: "bra()", caret: 4, title: "Bra ⟨ψ|" },
      { label: "|ψ⟩", snippet: "ket()", caret: 4, title: "Ket |ψ⟩" },
      { label: "⟨φ|ψ⟩", snippet: "braket(, )", caret: 7, title: "Inner product ⟨φ|ψ⟩" },
      { label: "∮", snippet: "oint(, , )", caret: 5, title: "Contour integral" },
      { label: "ℒ", snippet: "laplace ", title: "Laplace transform" },
      { label: "ℱ", snippet: "fourier ", title: "Fourier transform" },
    ],
  },
  {
    name: "Trig functions",
    items: [
      { label: "sin", snippet: "sin()", caret: 4 },
      { label: "cos", snippet: "cos()", caret: 4 },
      { label: "tan", snippet: "tan()", caret: 4 },
      { label: "csc", snippet: "csc()", caret: 4 },
      { label: "sec", snippet: "sec()", caret: 4 },
      { label: "cot", snippet: "cot()", caret: 4 },
      { label: "sin⁻¹", snippet: "arcsin()", caret: 7, title: "Inverse sine" },
      { label: "cos⁻¹", snippet: "arccos()", caret: 7, title: "Inverse cosine" },
      { label: "tan⁻¹", snippet: "arctan()", caret: 7, title: "Inverse tangent" },
    ],
  },
  {
    name: "Hyperbolic",
    items: [
      { label: "sinh", snippet: "sinh()", caret: 5 },
      { label: "cosh", snippet: "cosh()", caret: 5 },
      { label: "tanh", snippet: "tanh()", caret: 5 },
      { label: "sech", snippet: "sech()", caret: 5 },
      { label: "csch", snippet: "csch()", caret: 5 },
      { label: "coth", snippet: "coth()", caret: 5 },
    ],
  },
  {
    name: "Log & exponential",
    items: [
      { label: "ln", snippet: "ln()", caret: 3 },
      { label: "log", snippet: "log()", caret: 4 },
      { label: "log_b", snippet: "log_()", caret: 4, title: "Logarithm, base b" },
      { label: "lg", snippet: "lg()", caret: 3, title: "Binary/decimal log" },
      { label: "eˣ", snippet: "e^()", caret: 3, title: "Exponential" },
      { label: "exp", snippet: "exp()", caret: 4 },
    ],
  },
  {
    name: "Special functions",
    items: [
      { label: "Γ", snippet: "Γ()", caret: 2, title: "Gamma function" },
      { label: "ζ", snippet: "ζ()", caret: 2, title: "Riemann zeta" },
      { label: "erf", snippet: "erf()", caret: 4, title: "Error function" },
      { label: "erfc", snippet: "erfc()", caret: 5, title: "Complementary error function" },
      { label: "sgn", snippet: "sgn()", caret: 4, title: "Sign function" },
      { label: "σ", snippet: "sigmoid()", caret: 8, title: "Sigmoid / logistic" },
    ],
  },
  {
    name: "Discrete & stats",
    items: [
      { label: "C(n,k)", snippet: "C(, )", caret: 2, title: "Combinations (n choose k)" },
      { label: "P(n,k)", snippet: "P(, )", caret: 2, title: "Permutations" },
      { label: "n!", snippet: "!", title: "Factorial" },
      { label: "gcd", snippet: "gcd(, )", caret: 4 },
      { label: "lcm", snippet: "lcm(, )", caret: 4 },
      { label: "Var", snippet: "var()", caret: 4, title: "Variance" },
      { label: "Cov", snippet: "cov(, )", caret: 4, title: "Covariance" },
      { label: "𝔼", snippet: "EE[]", caret: 3, title: "Expectation" },
    ],
  },
  {
    name: "Greek",
    items: [
      { label: "π", snippet: "π" },
      { label: "θ", snippet: "θ" },
      { label: "α", snippet: "α" },
      { label: "β", snippet: "β" },
      { label: "λ", snippet: "λ" },
      { label: "μ", snippet: "μ" },
      { label: "σ", snippet: "σ" },
      { label: "φ", snippet: "φ" },
      { label: "ω", snippet: "ω" },
      { label: "Δ", snippet: "Δ" },
      { label: "Σ", snippet: "Σ" },
      { label: "∞", snippet: "infinity", title: "Infinity" },
    ],
  },
  {
    name: "Operators",
    items: [
      { label: "±", snippet: "±" },
      { label: "×", snippet: "×" },
      { label: "·", snippet: "·" },
      { label: "≤", snippet: "≤" },
      { label: "≥", snippet: "≥" },
      { label: "≠", snippet: "≠" },
      { label: "≈", snippet: "≈" },
      { label: "→", snippet: "→" },
    ],
  },
];

/** Common-structure starter templates for Build mode. Clicking loads the snippet
 *  into the Build input (replacing its contents). Each is a complete atom/bond
 *  list the user can use as-is or edit. */
export const BUILD_TEMPLATES: PaletteItem[] = [
  { label: "Benzene", snippet: "atoms: C C C C C C\nbonds: 1=2 2-3 3=4 4-5 5=6 6-1" },
  { label: "Cyclohexane", snippet: "atoms: C C C C C C\nbonds: 1-2 2-3 3-4 4-5 5-6 6-1" },
  { label: "Cyclopentane", snippet: "atoms: C C C C C\nbonds: 1-2 2-3 3-4 4-5 5-1" },
  { label: "Water", snippet: "atoms: O" },
  { label: "Ethanol", snippet: "atoms: C C O\nbonds: 1-2 2-3" },
  { label: "Acetic acid", snippet: "atoms: C C O O\nbonds: 1-2 2=3 2-4" },
  { label: "Acetone", snippet: "atoms: C C C O\nbonds: 1-2 2-3 2=4" },
  { label: "Carboxyl (–COOH)", snippet: "atoms: C O O\nbonds: 1=2 1-3" },
  { label: "Methylamine", snippet: "atoms: C N\nbonds: 1-2" },
  {
    label: "Genus [C,N] ring",
    snippet: "atoms: [C,N] C C C C C\nbonds: 1=2 2-3 3=4 4-5 5=6 6-1",
    title: "Generic ring encompassing benzene and pyridine",
  },
];

/** Bond-type buttons for Build mode. They insert the bond operator at the cursor
 *  in the build input; bonds are written as `i<op>j` (e.g. 1-2, 2=3, 1#2, 1~2). */
export const BUILD_BONDS: PaletteItem[] = [
  { label: "– single", snippet: "-", title: "Single bond (i-j)" },
  { label: "= double", snippet: "=", title: "Double bond (i=j)" },
  { label: "≡ triple", snippet: "#", title: "Triple bond (i#j)" },
  { label: "▲ wedge", snippet: ">", title: "Wedge / up stereo bond (i>j)" },
  { label: "⊣ hash", snippet: "<", title: "Hash / down stereo bond (i<j)" },
  { label: "~ undefined", snippet: "~", title: "Undefined / any bond (i~j) — makes a generic structure" },
];

/** Markush / query atom tokens for the Build atoms line (insert at cursor). */
export const BUILD_MARKUSH: PaletteItem[] = [
  { label: "[C,N]", snippet: "[C,N]", title: "Variable atom (any listed element)" },
  { label: "X", snippet: "X", title: "Halogen (F/Cl/Br/I)" },
  { label: "A", snippet: "A", title: "Any atom" },
  { label: "Q", snippet: "Q", title: "Any heteroatom (not carbon)" },
  { label: "R1", snippet: "R1", title: "R-group / substituent attachment point" },
  { label: "{ar}", snippet: "{ar}", title: "Query: aromatic position" },
  { label: "{ring}", snippet: "{ring}", title: "Query: must be in a ring" },
  { label: "{r6}", snippet: "{r6}", title: "Query: ring size 6 (also r3–r7; list several for 5 or 6)" },
  { label: "{nosub}", snippet: "{nosub}", title: "Query: no further substitution (closed position)" },
  { label: "{sub}", snippet: "{sub}", title: "Query: bears a further substituent" },
];

export const CHEM_PALETTE: PaletteGroup[] = [
  {
    name: "Charges & groups",
    items: [
      { label: "( )", snippet: "()", caret: 1, title: "Parentheses" },
      { label: "^ charge", snippet: "^", caret: 1, title: "Charge (superscript)" },
      { label: "⁺", snippet: "^+", caret: 2, title: "Positive charge" },
      { label: "⁻", snippet: "^-", caret: 2, title: "Negative charge" },
      { label: "²⁻", snippet: "^2-", caret: 3, title: "2− charge" },
      { label: "³⁺", snippet: "^3+", caret: 3, title: "3+ charge" },
      { label: ":", snippet: ":", title: "Lone pair" },
    ],
  },
  {
    name: "Common groups & ions",
    items: [
      { label: "OH", snippet: "OH" },
      { label: "H₂O", snippet: "H2O" },
      { label: "NH₄", snippet: "NH4" },
      { label: "SO₄", snippet: "SO4" },
      { label: "NO₃", snippet: "NO3" },
      { label: "CO₃", snippet: "CO3" },
      { label: "PO₄", snippet: "PO4" },
      { label: "CH₃", snippet: "CH3" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Solve mode. Two kinds of button, matching how Build's palette splits:
// SNIPPETS insert at the caret (structures, functions, operators, shape
// fragments); TEMPLATES load a complete, working input the user then edits
// (a whole equation, a whole composite figure). Snippets are written in the
// SOLVE grammar (solve.ts parseExpr / geometryParse) — NOT the Math-mode DSL:
// `^()` not `^{}`, `pi` via the π character (normalizeUnicodeMath folds it
// with its own spaces, so it can never glue onto a neighbouring identifier),
// ASCII `<=`/`>=` for inequalities.

/** Caret-insert snippets, shown for the expression-like kinds (equation,
 *  derivative, integral). */
export const SOLVE_SYMBOLS: PaletteGroup[] = [
  {
    name: "Structures",
    items: [
      // Real glyphs, not plain-english spellings: the parser reads √, ², ³
      // and friends natively (normalizeUnicodeMath), so the input can LOOK
      // like the mathematics it is.
      { label: "a/b", snippet: "()/()", caret: 1, title: "Fraction" },
      { label: "√", snippet: "√()", caret: 2, title: "Square root — the sign itself; √(x+1), √4 and √sin(x) all read" },
      { label: "x²", snippet: "²", title: "Squared (type the base first)" },
      { label: "x³", snippet: "³", title: "Cubed (type the base first)" },
      { label: "xⁿ", snippet: "^()", caret: 2, title: "Any power" },
      { label: "|x|", snippet: "abs()", caret: 4, title: "Absolute value" },
      { label: "( )", snippet: "()", caret: 1, title: "Parentheses" },
      { label: "π", snippet: "π", title: "Pi" },
      { label: "e", snippet: "e", title: "Euler's number" },
      { label: "∞", snippet: "∞", title: "Infinity (integral bounds, limits)" },
    ],
  },
  {
    name: "Functions",
    items: [
      { label: "sin", snippet: "sin()", caret: 4 },
      { label: "cos", snippet: "cos()", caret: 4 },
      { label: "tan", snippet: "tan()", caret: 4 },
      { label: "ln", snippet: "ln()", caret: 3, title: "Natural log" },
      { label: "log", snippet: "log()", caret: 4, title: "Log base 10" },
      { label: "exp", snippet: "exp()", caret: 4, title: "eˣ" },
    ],
  },
  {
    name: "Relations",
    items: [
      { label: "=", snippet: " = " },
      { label: "≤", snippet: " ≤ ", title: "Less than or equal (inequality solving)" },
      { label: "≥", snippet: " ≥ ", title: "Greater than or equal" },
      { label: "<", snippet: " < " },
      { label: ">", snippet: " > " },
      { label: "≠", snippet: " ≠ ", title: "Not equal" },
    ],
  },
  {
    name: "Greek",
    items: [
      // Real Greek characters — the paste-folding layer reads them as
      // variables the engines solve for symbolically, and the typesetter
      // draws them back as Greek.
      { label: "θ", snippet: "θ", title: "theta — a solvable variable" },
      { label: "α", snippet: "α", title: "alpha" },
      { label: "β", snippet: "β", title: "beta" },
      { label: "γ", snippet: "γ", title: "gamma" },
      { label: "λ", snippet: "λ", title: "lambda (wavelength)" },
      { label: "μ", snippet: "μ", title: "mu (coefficient of friction, mean)" },
      { label: "ρ", snippet: "ρ", title: "rho (density)" },
      { label: "σ", snippet: "σ", title: "sigma (stress, s.d.)" },
      { label: "τ", snippet: "τ", title: "tau (torque, time constant)" },
      { label: "φ", snippet: "φ", title: "phi (phase)" },
      { label: "ω", snippet: "ω", title: "omega (angular frequency)" },
      { label: "Δ", snippet: "Δ", title: "Delta — a solvable variable (e.g. ΔT)" },
      { label: "Ω", snippet: "Ω", title: "Omega" },
    ],
  },
];

/** Whole-input ODE templates: one per family Release 1 solves. */
export const SOLVE_ODES: PaletteGroup[] = [
  {
    name: "Differential equations",
    items: [
      { label: "Growth y′ = ky", snippet: "y' = 2y", title: "Separable → y = C·e^(2x)" },
      { label: "Direct y′ = f(x)", snippet: "y' = cos(x)", title: "Integrate both sides" },
      { label: "Separable", snippet: "y' = x/y", title: "Implicit solution shown honestly" },
      { label: "Linear 1st order", snippet: "y' = x - y", title: "Integrating-factor method, worked" },
      { label: "2nd order, real roots", snippet: "y'' + 3y' + 2y = 0", title: "Characteristic equation" },
      { label: "initial-value problem", snippet: "y'' + 4y = sin(t), y(0) = 0, y'(0) = 0", title: "Solved by Laplace transform; the single solution, verified and drawn" },
      { label: "step forcing", snippet: "y'' + y = u(t-1), y(0) = 0, y'(0) = 0", title: "A unit-step forcing through the transform" },
      { label: "Oscillator", snippet: "y'' + 4y = 0", title: "Complex roots → cos and sin" },
      { label: "Damped", snippet: "y'' + 2y' + 5y = 0", title: "Envelope × oscillation" },
      { label: "Critical damping", snippet: "y'' - 2y' + y = 0", title: "Repeated root — the x factor" },
    ],
  },
];

/** Whole-input calculus templates for the Differentiate kind — the prose the
 *  engine reads for limits and series, loaded ready to edit. */
export const SOLVE_CALCULUS: PaletteGroup[] = [
  {
    name: "Limits & series",
    items: [
      { label: "limit → 0", snippet: "limit sin(x)/x as x -> 0", title: "Two-sided limit" },
      { label: "limit → ∞", snippet: "limit 1/x as x -> inf", title: "Limit at infinity" },
      { label: "one-sided", snippet: "limit 1/x as x -> 0+", title: "From above (also 0-)" },
      { label: "Taylor", snippet: "taylor exp(x) order 5", title: "Taylor series, exact coefficients" },
      { label: "Maclaurin", snippet: "maclaurin sin(x)", title: "Series about 0" },
      { label: "series about a", snippet: "series sqrt(x) about 1 order 4", title: "Expansion about a point" },
    ],
  },
];

/** Transform verbs: they run in the EQUATION kind (the verb slot), so they sit
 *  beside the equation library there, not under limits and series. */
export const SOLVE_TRANSFORMS: PaletteGroup[] = [
  {
    name: "Transforms & Fourier ",
    items: [
      { label: "ℒ{f}", snippet: "laplace t^2 exp(3t)", title: "Laplace transform, table rule per term, checked against the defining integral" },
      { label: "ℒ⁻¹{F}", snippet: "inverse laplace 1/(s*(s+1))", title: "Inverse by partial fractions; write s*(s+1), not s(s+1)" },
      { label: "step", snippet: "laplace u(t-2)", title: "Unit step: second shift theorem" },
      { label: "impulse", snippet: "laplace delta(t-3)", title: "Dirac impulse: sifting" },
      { label: "Fourier series", snippet: "fourier series t^2 on (-pi, pi)", title: "Exact coefficients in n; S₅ drawn" },
      { label: "square wave", snippet: "fourier series -1 on (-pi, 0); 1 on (0, pi)", title: "Pieces separated by ;" },
    ],
  },
  {
    name: "Probability",
    items: [
      { label: "binomial", snippet: "binomial n=10 p=0.4 P(X <= 3)", title: "Exact fraction, the formula, the pmf with the event shaded" },
      { label: "Poisson", snippet: "poisson lambda = 2.5 P(X >= 3)", title: "Also P(X = k), mean, variance, pmf" },
      { label: "normal", snippet: "normal mean 100 sd 15 P(X > 120)", title: "z shown, Φ named, the tail shaded; P(85 < X < 115) too" },
      { label: "z / quantile", snippet: "quantile normal 0.975", title: "invNorm; also quantile t 12 0.975, critical value chi-square 3 df alpha 0.05" },
      { label: "t / χ² / F", snippet: "t 12 df P(T > 2.1)", title: "chi-square 3 df P(X > 7.81); critical value F 3 20 alpha 0.05" },
      { label: "exp / gamma", snippet: "exponential rate 0.5 P(X > 3)", title: "gamma shape 2 rate 3 mean; uniform(0, 10) variance; beta(2, 5) mode" },
      { label: "hypergeom.", snippet: "hypergeometric N=50 K=5 n=10 P(X=1)", title: "Draws without replacement; geometric p=0.2 P(X=3) (trials convention, said)" },
      { label: "Bayes", snippet: "bayes P(A)=0.01, P(B|A)=0.9, P(B|not A)=0.05, P(A|B)", title: "Exact; the tree drawn; independence never assumed" },
      { label: "E[X]", snippet: "E[X] for X = 1, 2, 3 with p = 0.2, 0.3, 0.5", title: "Population mean/variance of listed outcomes; 'expected value of a fair die'" },
      { label: "dice / coins", snippet: "probability of at least one six in four rolls", title: "Also: two dice sum 7; flip a fair coin 10 times, exactly 7 heads; a bag has 3 red and 5 blue …; birthday problem 23 people" },
      { label: "CLT / CI", snippet: "confidence interval 95% mean 50 sd 10 n 30", title: "z- and t-intervals, the choice stated; clt n = 30 mean 50 sd 10 P(xbar > 52)" },
      { label: "Markov", snippet: "markov [[0.9, 0.1], [0.5, 0.5]] stationary", title: "Exact π, classification, limit; 'after 3 steps from (1,0)'; absorbing chains" },
    ],
  },
  {
    name: "Multivariable",
    items: [
      { label: "∇f", snippet: "gradient x^2 y + y^3 at (1,2)", title: "Gradient, each partial checked by central differences; |∇f| exact" },
      { label: "D_u f", snippet: "directional derivative x^2 y at (1,2) in direction (3,4)", title: "Direction normalised for you" },
      { label: "Hessian", snippet: "hessian x^3 + x y^2", title: "Second partials and det H" },
      { label: "Jacobian", snippet: "jacobian (r cos(theta), r sin(theta))", title: "Matrix and determinant — the polar factor r" },
      { label: "critical pts", snippet: "critical points x^3 - 3x + y^2", title: "∇f = 0 by exact elimination, second-derivative test, saddles named" },
      { label: "Lagrange", snippet: "lagrange x y subject to x^2 + y^2 = 1", title: "∇f = λ∇g; max/min declared only on a bounded constraint" },
      { label: "∬", snippet: "double integral x^2 + y^2 over y from 0 to x, x from 0 to 1", title: "Inner integral first, exact where the integrator can; bounds may use outer variables" },
      { label: "∭", snippet: "triple integral x y z over x from 0 to 1, y from 0 to 1, z from 0 to 1", title: "Three nested integrals" },
      { label: "div / curl", snippet: "curl (y z, x z, x y)", title: "Also: divergence (P, Q, R)" },
      { label: "potential", snippet: "potential (2 x + y, x + 2 y)", title: "φ with ∇φ = F, or refused with the curl shown" },
      { label: "∫ F·dr", snippet: "line integral (2 x y, x^2) from (0,0) to (1,2)", title: "Conservative fields only — path-dependent ones refused by name" },
    ],
  },
  {
    name: "Optimisation & interpolation",
    items: [
      { label: "maximize", snippet: "maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x >= 0, y >= 0", title: "Exact simplex: optimum, slacks, shadow prices, reduced costs, ranges; the region drawn" },
      { label: "minimize", snippet: "minimize 2x + 3y subject to x + y >= 4, x + 3y >= 6, x >= 0, y >= 0", title: "Two-phase (artificial variables named); duals (3/2, 1/2)" },
      { label: "3 variables", snippet: "maximize 3x1 + 2x2 + 5x3 subject to x1 + 2x2 + x3 <= 430, 3x1 + 2x3 <= 460, x1 + 4x2 <= 420, x1, x2, x3 >= 0", title: "(0, 100, 230), z = 1350; x1 and x_1 both spell the same variable" },
      { label: "dual", snippet: "dual of maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x, y >= 0", title: "The dual LP written and solved; z* = w* shown" },
      { label: "standard form", snippet: "standard form of maximize 3x + 2y subject to x + y <= 4, x - y >= -2", title: "Slacks/surplus, free variables split, min → −max; stops there" },
      { label: "integer", snippet: "maximize 5x + 4y subject to 6x + 4y <= 24, x + 2y <= 6, -x + y <= 1, y <= 2, x, y >= 0, x and y integer", title: "LP relaxation labelled, then branch-and-bound (≤ 4 variables)" },
      { label: "word problem", snippet: "A company makes chairs and tables. Each chair needs 2 hours of labor and 1 unit of wood and earns $30; each table needs 3 hours and 2 units and earns $50. There are 120 hours and 70 units available. How many of each maximize profit?", title: "Products × resources only; the LP it built is printed first" },
      { label: "interpolate", snippet: "interpolate (1, 2), (2, 3), (4, 7)", title: "The exact polynomial through every point; Lagrange and Newton cross-checked; 'at x = 3' evaluates" },
      { label: "Lagrange poly", snippet: "lagrange polynomial through (0, 1), (1, 3), (2, 2)", title: "Basis polynomials shown on request ('using lagrange')" },
      { label: "Newton", snippet: "newton divided differences (1, 1), (2, 8), (3, 27), (4, 64)", title: "The divided-difference table and the nested form" },
      { label: "Neville", snippet: "neville's method (0, 1), (1, 3), (2, 2) at x = 1.5", title: "The tableau at the query point" },
      { label: "linear", snippet: "linear interpolation between (1, 10) and (3, 20) at x = 2", title: "The proportion line; also 'estimate f(2.5) given f(2) = 4, f(3) = 9'" },
      { label: "error bound", snippet: "error bound for interpolating sin(x) at x = 0, 0.5, 1 with a quadratic", title: "|f − p| ≤ M/(n+1)! · max|Π(x − xᵢ)|, M stated" },
      { label: "natural spline", snippet: "natural cubic spline through (0, 0), (1, 1), (2, 0)", title: "M vector, one piece per interval, continuity verified exactly; 'at x = 0.5'" },
      { label: "clamped", snippet: "clamped cubic spline through (0, 0), (1, 1), (2, 0) with S'(0) = 1, S'(2) = -1", title: "End slopes verified; also 'with end slopes 0 and 0'" },
      { label: "not-a-knot", snippet: "not-a-knot spline through (0,1), (1,3), (2,2), (3,4)", title: "With 4 points this IS the interpolating cubic — said" },
      { label: "pchip", snippet: "pchip (0, 0), (1, 1), (2, 1), (3, 2)", title: "Monotone cubic (Fritsch–Carlson), the end formula stated" },
    ],
  },
];

/** Whole-input equation templates: click → the input becomes this equation,
 *  and the "Solve for" chips offer every symbol in it. The full suite. */
export const SOLVE_EQUATIONS: PaletteGroup[] = [
  {
    name: "Algebra",
    items: [
      { label: "Quadratic", snippet: "x^2 - 5x + 6 = 0", title: "Both roots, exactly" },
      { label: "Cubic", snippet: "x^3 - 6x^2 + 11x - 6 = 0", title: "Every real and complex root" },
      { label: "System 2×2", snippet: "2x + y = 7\nx - y = 2", title: "Two equations, one per line" },
      { label: "System 3×3", snippet: "x + y + z = 6\n2x - y + z = 3\nx + 2y - z = 2", title: "Three equations, one per line" },
      { label: "Inequality", snippet: "x^2 - 4 >= 0", title: "Solution intervals" },
      { label: "Rational", snippet: "1/x + 1/(x+1) = 1", title: "Excluded values stated" },
      {
        label: "With units",
        snippet: "F = m a\nm = 3 kg\na = 2 m/s^2",
        title: "Formula + knowns with units — the answer's unit is derived (6 N); mismatches refused by name",
      },
    ],
  },
  {
    name: "Geometry formulas",
    items: [
      { label: "Circle area", snippet: "A = π r^2", title: "Solve for A or r" },
      { label: "Sphere volume", snippet: "V = (4/3) π r^3", title: "Solve for V or r" },
      { label: "Cylinder volume", snippet: "V = π r^2 h", title: "Solve for V, r or h" },
      { label: "Pythagoras", snippet: "c^2 = a^2 + b^2", title: "Solve for any side" },
      { label: "Triangle area", snippet: "A = (1/2) b h", title: "Solve for A, b or h" },
    ],
  },
  {
    name: "Mechanics",
    items: [
      { label: "F = ma", snippet: "F = m a", title: "Newton's second law — solve for F, m or a" },
      { label: "v = u + at", snippet: "v = u + a t", title: "Kinematics — solve for any symbol" },
      { label: "s = ut + ½at²", snippet: "s = u t + (1/2) a t^2", title: "Kinematics displacement" },
      { label: "v² = u² + 2as", snippet: "v^2 = u^2 + 2 a s", title: "Kinematics, no time" },
      { label: "p = mv", snippet: "p = m v", title: "Momentum" },
      { label: "W = Fd", snippet: "W = F d", title: "Work" },
      { label: "P = W/t", snippet: "P = W/t", title: "Power" },
      { label: "K = ½mv²", snippet: "K = (1/2) m v^2", title: "Kinetic energy" },
      { label: "U = mgh", snippet: "U = m g h", title: "Gravitational potential energy" },
      { label: "F = kx", snippet: "F = k x", title: "Hooke's law" },
      { label: "Gravitation", snippet: "F = G m M / r^2", title: "Newton's law of gravitation" },
      { label: "τ = Fr", snippet: "τ = F r", title: "Torque (τ is a solvable variable)" },
      { label: "E = mc²", snippet: "E = m c^2", title: "Mass–energy" },
    ],
  },
  {
    name: "Electricity & waves",
    items: [
      { label: "V = IR", snippet: "V = I R", title: "Ohm's law" },
      { label: "P = IV", snippet: "P = I V", title: "Electrical power" },
      { label: "P = I²R", snippet: "P = I^2 R", title: "Power dissipated in a resistance" },
      { label: "Q = CV", snippet: "Q = C V", title: "Capacitor charge" },
      { label: "E = ½CV²", snippet: "E = (1/2) C V^2", title: "Capacitor energy" },
      { label: "Coulomb", snippet: "F = k q1 q2 / r^2", title: "Coulomb's law" },
      { label: "v = fλ", snippet: "v = f λ", title: "Wave speed — λ is a solvable variable" },
      { label: "T = 1/f", snippet: "T = 1/f", title: "Period and frequency" },
      { label: "E = hf", snippet: "E = h f", title: "Photon energy" },
      { label: "ω = 2πf", snippet: "ω = 2 π f", title: "Angular frequency" },
    ],
  },
  {
    name: "Thermo & chemistry",
    items: [
      { label: "PV = nRT", snippet: "P V = n R T", title: "Ideal gas — solve for any symbol" },
      { label: "Q = mcΔT", snippet: "Q = m c (T2 - T1)", title: "Sensible heat — ΔT written out so both temperatures solve" },
      { label: "Dilution", snippet: "C1 V1 = C2 V2", title: "Dilution — solve for any of the four" },
      { label: "Beer's law", snippet: "A = ε l c", title: "Absorbance — ε is a solvable variable" },
      { label: "n = m/M", snippet: "n = m/M", title: "Moles from mass and molar mass" },
      { label: "ρ = m/V", snippet: "ρ = m/V", title: "Density — ρ is a solvable variable" },
    ],
  },
  {
    name: "Growth & finance",
    items: [
      { label: "Simple interest", snippet: "I = P r t", title: "Solve for any symbol" },
      { label: "Compound growth", snippet: "A = P (1 + r)^t", title: "Solve for A or P (r and t need logs — stated honestly)" },
      { label: "Compound, n/yr", snippet: "A = P (1 + r/n)^(n t)", title: "Compounded n times per year" },
    ],
  },
];

/** Whole-input geometry templates (kind = geometry): single shapes in the
 *  solveGeometry grammar, composite figures in the compositeGeometry grammar. */
export const SOLVE_SHAPES: PaletteGroup[] = [
  {
    name: "Composite figures",
    items: [
      {
        label: "Rect − triangle",
        snippet: "rectangle 10in x 5in minus triangle b=4in h=3in",
        title: "Area with and without the cutout, exact, with a drawn figure",
      },
      { label: "Rect − circle", snippet: "rectangle 8 x 6 minus circle r=2", title: "Exact: 48 − 4π" },
      { label: "Washer", snippet: "circle r=5 minus circle r=3", title: "Annulus between two circles" },
      { label: "Two cutouts", snippet: "rectangle 12 x 8 minus square s=2 minus circle d=3", title: "Several holes at once" },
      { label: "L-shape (add)", snippet: "rectangle 8 x 3 plus rectangle 3 x 5", title: "Shapes joined together" },
    ],
  },
  {
    name: "Single shapes",
    items: [
      { label: "Circle", snippet: "circle r=3" },
      { label: "Rectangle", snippet: "rectangle a=10 b=5" },
      { label: "Triangle (sides)", snippet: "triangle 3 4 5" },
      { label: "Triangle (vertices)", snippet: "triangle (0,0) (4,0) (0,3)", title: "From its corner points — also gives the centres" },
      { label: "Polygon", snippet: "polygon n=6 a=2", title: "Regular polygon, n sides of length a" },
      { label: "Conic", snippet: "x^2/9 + y^2/4 = 1", title: "Classified with axes, foci, eccentricity, directrices — and drawn" },
    ],
  },
  {
    name: "Circle toolkit",
    items: [
      { label: "Sector", snippet: "sector r=5 angle=60", title: "Area, arc length, chord, perimeter — exact where π carries; drawn" },
      { label: "Segment", snippet: "segment r=4 angle=90", title: "Area between chord and arc, sagitta height" },
      { label: "Arc", snippet: "arc r=6 angle=120", title: "Arc length (exact ·π) and chord" },
      { label: "Tangent", snippet: "tangent r=3 d=5", title: "Tangent length from an external point d from the centre" },
      { label: "Inscribed angle", snippet: "inscribed angle=80", title: "Half the central angle (Thales at 180°)" },
    ],
  },
  {
    name: "Solids",
    items: [
      { label: "Hemisphere", snippet: "hemisphere r=3" },
      { label: "Pyramid", snippet: "pyramid a=6 h=4", title: "Right square pyramid: volume, slant, surface" },
      { label: "Cone frustum", snippet: "frustum r1=2 r2=5 h=4", title: "Volume, slant, lateral and total surface" },
      { label: "Spherical cap", snippet: "cap r=5 h=2", title: "Sphere radius r, cap height h" },
      { label: "Torus", snippet: "torus R=5 r=2", title: "Ring torus — exact ·π² volume and surface" },
      { label: "Ellipsoid", snippet: "ellipsoid a=1 b=2 c=3", title: "Exact volume; surface honestly approximate" },
      { label: "Tetrahedron", snippet: "tetrahedron a=2", title: "Regular: volume, surface, height as exact surds" },
      { label: "Prism", snippet: "prism b=4 h=3 l=10", title: "Triangular cross-section b×h, length l" },
    ],
  },
  {
    name: "Transforms & point tests",
    items: [
      { label: "Rotate", snippet: "rotate 90 (2,3)", title: "Quarter turns are EXACT; chain with then" },
      { label: "Rotate about", snippet: "rotate 45 about (1,1) (2,3)", title: "Rotation about a point, via homogeneous matrices" },
      { label: "Reflect", snippet: "reflect y=x (2,3)", title: "Mirror lines: x, y, y=x, y=-x" },
      { label: "Translate", snippet: "translate 3 -2 (2,3)", title: "Translation as a matrix — homogeneous coordinates" },
      { label: "Shear", snippet: "shear x 1/2 (2,3)", title: "Determinant 1: area preserved, angles not" },
      { label: "Chained", snippet: "rotate 90 then translate 1 0 then reflect y (2,3)", title: "Composed left to right; order matters and is stated" },
      { label: "Point in polygon", snippet: "inside (1,1) polygon (0,0) (4,0) (4,4) (0,4)", title: "inside / outside / boundary, by exact winding number" },
    ],
  },
];

/** The λ itself, for the λ-calculus kind — the one glyph a keyboard lacks. */
export const SOLVE_LAMBDA_SYMBOLS: PaletteGroup[] = [
  {
    name: "Symbols",
    items: [
      { label: "λ", snippet: "λ", title: "Abstraction — λx.x (a backslash works too)" },
      { label: "λx.", snippet: "λx.", title: "Bind x" },
      { label: "( )", snippet: "()", caret: 1, title: "Group — application is left-associative" },
    ],
  },
];

/** Whole-input λ-calculus templates: the textbook examples, loaded ready to reduce. */
export const SOLVE_LAMBDA: PaletteGroup[] = [
  {
    name: "Reduction",
    items: [
      { label: "Identity", snippet: "(λx.x) y", title: "One β-step" },
      { label: "Capture", snippet: "(λx.λy.x) y", title: "The binder must be renamed — watch the α-step" },
      { label: "K I Ω", snippet: "K I OMEGA", title: "Normal order answers I; try applicative" },
      { label: "Applicative", snippet: "applicative K I OMEGA", title: "Call-by-value diverges here — a proven cycle" },
      { label: "Ω", snippet: "OMEGA", title: "(λx.x x)(λx.x x): the cycle of length 1" },
      { label: "S K K", snippet: "S K K a", title: "S K K is the identity" },
    ],
  },
  {
    name: "Church encodings",
    items: [
      { label: "PLUS 2 3", snippet: "PLUS 2 3", title: "Church numerals: integers are literals" },
      { label: "MULT 3 4", snippet: "MULT 3 4", title: "Decoded and independently verified" },
      { label: "POW 2 3", snippet: "POW 2 3", title: "Exponentiation is application" },
      { label: "PRED 5", snippet: "PRED 5", title: "Kleene's predecessor" },
      { label: "AND TRUE FALSE", snippet: "AND TRUE FALSE", title: "Church booleans" },
      { label: "ISZERO 0", snippet: "ISZERO 0", title: "Decoded as TRUE" },
      { label: "Pairs", snippet: "FST (PAIR 3 4)", title: "PAIR / FST / SND" },
      { label: "let", snippet: "let TWICE = λf.λx.f (f x)\nTWICE SUCC 0", title: "Definitions on the lines above the term" },
    ],
  },
  {
    name: "Questions",
    items: [
      { label: "type", snippet: "type λf.λx.f (f x)", title: "Principal simple type" },
      { label: "untypable", snippet: "type λx.x x", title: "The occurs check — no simple type" },
      { label: "free", snippet: "free λx.x y z", title: "Free variables" },
      { label: "alpha", snippet: "alpha λx.λy.x = λa.λb.a", title: "α-equivalence by de Bruijn indices" },
      { label: "Y", snippet: "Y f", title: "The fixed-point combinator unfolds forever — capped, and says so" },
    ],
  },
  {
    name: "Hindley–Milner",
    items: [
      { label: "let-poly", snippet: "hm let id = λx.x in (id 1, id true)", title: "int × bool — id generalised to ∀α. α → α, instantiated twice" },
      { label: "id id", snippet: "hm let id = λx.x in id id", title: "The two instantiations shown" },
      { label: "scheme", snippet: "hm let compose = λf.λg.λx.f (g x) in compose", title: "Algorithm W step by step, the derivation tree drawn" },
      { label: "λ-bound", snippet: "hm (λid. id id) (λx.x)", title: "Refused by name: a λ-bound name is monomorphic — the let fix named" },
      { label: "let rec", snippet: "hm let rec f = λx.f x in f", title: "Monomorphic recursion: ∀α β. α → β" },
    ],
  },
];

/** Whole-input templates for the Discrete-math kind — one per engine form,
 *  each pinned (discretePalette test) to produce an answer. */
export const SOLVE_DISCRETE: PaletteGroup[] = [
  {
    name: "Number theory",
    items: [
      { label: "gcd", snippet: "gcd 84 36", title: "Euclid's algorithm, Bézout coefficients" },
      { label: "aᵉ mod m", snippet: "7^100 mod 13", title: "Square-and-multiply, Fermat shortcut" },
      { label: "inverse", snippet: "inverse 3 mod 7", title: "Extended Euclid" },
      { label: "ax ≡ b", snippet: "3x ≡ 2 mod 7", title: "Linear congruence — every solution" },
      { label: "CRT", snippet: "x ≡ 2 mod 3, x ≡ 3 mod 5, x ≡ 2 mod 7", title: "Chinese remainder theorem (Sunzi)" },
      { label: "factor", snippet: "factor 360", title: "Prime factorisation, τ σ φ" },
      { label: "prime?", snippet: "is 561 prime", title: "Miller–Rabin — a Carmichael number" },
      { label: "primes to", snippet: "primes to 100", title: "Sieve of Eratosthenes" },
      { label: "primitive root", snippet: "primitive roots mod 7", title: "Generators of (ℤ/7)*" },
      { label: "binary", snippet: "255 in binary", title: "Base conversion, shown by repeated division" },
    ],
  },
  {
    name: "Abstract algebra",
    items: [
      { label: "ℤ/n", snippet: "Z/6", title: "Elements, orders, generators, centre, Cayley table drawn" },
      { label: "U(n) cyclic?", snippet: "is U(8) cyclic", title: "No element of order 4 — U(8) ≅ ℤ/2ℤ × ℤ/2ℤ" },
      { label: "Cayley table", snippet: "cayley table of S3", title: "Axioms checked by brute force; drawn" },
      { label: "lattice", snippet: "subgroup lattice of Z/12", title: "Every subgroup, Hasse diagram drawn" },
      { label: "cosets", snippet: "cosets of <3> in Z/12", title: "|G| = |H| · [G : H]" },
      { label: "≅ (CRT)", snippet: "Z/6 ≅ Z/2 × Z/3", title: "Isomorphic — the explicit map" },
      { label: "compose", snippet: "(1 2 3)(1 2)", title: "Right to left, the other order said; cycle diagram" },
      { label: "a·b mod n", snippet: "7 * 9 mod 12", title: "Arithmetic in ℤ/nℤ" },
      { label: "factor over 𝔽ₚ", snippet: "factor x^4 + x^2 + 1 over F_2", title: "(x² + x + 1)², multiplied back" },
      { label: "GF(q)", snippet: "GF(9)", title: "𝔽₃[x]/(x² + 1): orders, primitive elements, × table" },
    ],
  },
  {
    name: "Combinatorics",
    items: [
      { label: "n choose k", snippet: "10 choose 3", title: "Combinations, verified two ways" },
      { label: "P(n,k)", snippet: "P(10,3)", title: "Permutations" },
      { label: "n!", snippet: "20!", title: "Exact" },
      { label: "anagrams", snippet: "arrangements of MISSISSIPPI", title: "Multiset permutations" },
      { label: "derangements", snippet: "derangements 5", title: "!5 = 44" },
      { label: "Catalan", snippet: "catalan 5", title: "C₅ = 42" },
      { label: "word problem", snippet: "how many ways to choose 3 of 10 people", title: "The model is named" },
      { label: "stars and bars", snippet: "distribute 10 identical balls into 3 boxes", title: "C(n+k−1, k−1)" },
    ],
  },
  {
    name: "Recurrences",
    items: [
      { label: "Fibonacci", snippet: "a(n) = a(n-1) + a(n-2), a(0)=0, a(1)=1", title: "Binet, exact in ℚ(√5)" },
      { label: "first order", snippet: "a(n) = 2a(n-1) + 3, a(0)=1", title: "Particular + homogeneous" },
      { label: "resonance", snippet: "T(n) = T(n-1) + n, T(0) = 0", title: "Root 1 meets a polynomial forcing" },
      { label: "repeated root", snippet: "a(n) = 2a(n-1) - a(n-2), a(0)=1, a(1)=3", title: "The n·rⁿ term" },
      { label: "merge sort", snippet: "T(n) = 2T(n/2) + n", title: "Master theorem, case 2" },
      { label: "Strassen", snippet: "T(n) = 7T(n/2) + n^2", title: "Master theorem, case 1" },
    ],
  },
  {
    name: "Logic",
    items: [
      { label: "modus tollens", snippet: "(p -> q) & ~q -> ~p", title: "A tautology" },
      { label: "De Morgan", snippet: "~(p & q) == ~p | ~q", title: "Equivalence question" },
      { label: "argument", snippet: "p -> q, p |= q", title: "Entailment with counterexample search" },
      { label: "fallacy", snippet: "p -> q, q |= p", title: "Affirming the consequent — INVALID" },
      { label: "simplify", snippet: "simplify a & b | a & ~b", title: "Quine–McCluskey minimal DNF" },
      { label: "dnf / cnf", snippet: "dnf (p -> q) & r", title: "Normal forms from the table" },
    ],
  },
  {
    name: "Automata",
    items: [
      { label: "DFA", snippet: "dfa\nstates: q0 q1 q2\nalphabet: 0 1\nstart: q0\naccept: q2\nq0 0 q0\nq0 1 q1\nq1 0 q0\nq1 1 q2\nq2 0 q2\nq2 1 q2\ntest: 011 0101 11", title: "Run strings, draw the diagram" },
      { label: "regex", snippet: "regex (a|b)*abb\ntest: abb aabb ab abba", title: "Thompson → subset → minimal DFA" },
      { label: "NFA → DFA", snippet: "to dfa\nnfa\nstates: p q r\nalphabet: a b\nstart: p\naccept: r\np a p\np b p\np a q\nq b r", title: "Subset construction" },
      { label: "minimize", snippet: "minimize\ndfa\nstates: A B C D E F\nalphabet: 0 1\nstart: A\naccept: C D E\nA 0 B\nA 1 C\nB 0 A\nB 1 D\nC 0 E\nC 1 F\nD 0 E\nD 1 F\nE 0 E\nE 1 F\nF 0 F\nF 1 F", title: "Partition refinement, cross-checked" },
      { label: "equivalent?", snippet: "equivalent\nregex a*\n---\nregex (aa)*", title: "NO, with the distinguishing string" },
    ],
  },
  {
    name: "Grammars",
    items: [
      { label: "membership", snippet: "S -> aSb | ε\ntest: aabb ab aab", title: "CNF, the CYK table, a leftmost derivation and the parse tree; brute force cross-checks" },
      { label: "ambiguous?", snippet: "S -> S S | a\nis it ambiguous", title: "Two parse trees for aaa, both drawn; 'not found' is evidence, never proof" },
      { label: "FIRST/FOLLOW", snippet: "first and follow\nE -> T E'\nE' -> + T E' | ε\nT -> F T'\nT' -> * F T' | ε\nF -> ( E ) | id", title: "Nullable, FIRST and FOLLOW by fixpoint" },
      { label: "left recursion", snippet: "remove left recursion\nE -> E + T | T\nT -> T * F | F\nF -> ( E ) | id", title: "Immediate and indirect, new names said" },
      { label: "useless", snippet: "useless symbols\nS -> A B | a\nA -> a\nB -> B b\nC -> c", title: "Unreachable and non-generating, the reduced grammar" },
    ],
  },
  {
    name: "Machines",
    items: [
      { label: "PDA", snippet: "pda\nstates: q0 q1 q2\nalphabet: a b\nstack: Z A\nstart: q0\naccept: q2\nq0 a Z -> q0 AZ\nq0 a A -> q0 AA\nq0 b A -> q1 ε\nq1 b A -> q1 ε\nq1 ε Z -> q2 Z\ntest: aabb ab aab", title: "aⁿbⁿ; the configurations and the stack drawn; acceptance mode said" },
      { label: "CFG → PDA", snippet: "cfg to pda S -> aSb | ε\ntest: aabb ab aab \"\"", title: "One-state construction, checked against the grammar's CYK" },
      { label: "TM", snippet: "tm\nstates: q0 q1 halt\nstart: q0\naccept: halt\nblank: _\nq0 0 -> q0 0 R\nq0 1 -> q0 1 R\nq0 _ -> q1 _ L\nq1 1 -> q1 0 L\nq1 0 -> halt 1 R\nq1 _ -> halt 1 R\ntape: 1011", title: "Binary increment; the tape drawn step by step" },
      { label: "increment", snippet: "tm binary increment 1011", title: "Template, verified as n + 1" },
      { label: "unary add", snippet: "tm unary add 111+11", title: "Template, verified by counting 1s" },
    ],
  },
  {
    name: "First-order logic",
    items: [
      { label: "prenex", snippet: "prenex ∀x P(x) → ∃y Q(y)", title: "Rectified, quantifiers pulled out, each flip shown" },
      { label: "Skolem", snippet: "skolemize ∀x ∃y P(x, y)", title: "Skolem functions of the governing ∀-variables" },
      { label: "unify", snippet: "unify f(x, x) and f(y, g(y))", title: "Robinson with the occurs check, the substitution shown" },
      { label: "resolution", snippet: "resolve ∀x (P(x) → Q(x)), P(a) ⊢ Q(a)", title: "Refutation, each resolvent verified, the DAG drawn" },
      { label: "invalid", snippet: "resolve ∀x ∃y P(x, y) ⊢ ∃y ∀x P(x, y)", title: "Saturates without □ — INVALID, said by name" },
    ],
  },
  {
    name: "SAT",
    items: [
      { label: "DPLL", snippet: "dpll (p ∨ q) ∧ (¬p ∨ q) ∧ (p ∨ ¬q) ∧ (¬p ∨ ¬q)", title: "The search tree drawn; UNSAT with a resolution proof and core" },
      { label: "2-SAT", snippet: "2sat (x1 ∨ x2) ∧ (¬x1 ∨ x2) ∧ (¬x2 ∨ x1)", title: "Implication graph and SCCs — exact, polynomial" },
      { label: "Horn", snippet: "horn a, a -> b, b -> c, ~c", title: "Unit propagation; the violated clause named" },
      { label: "DIMACS", snippet: "p cnf 3 2\n1 -2 0\n2 3 0", title: "DIMACS input; the model checked clause by clause" },
    ],
  },
  {
    name: "Graphs",
    items: [
      { label: "shortest path", snippet: "shortest path A to F\nA-B 7\nA-C 9\nA-F 14\nB-C 10\nB-D 15\nC-D 11\nC-F 2\nD-E 6\nE-F 9", title: "Dijkstra, path highlighted" },
      { label: "MST", snippet: "mst\nA-B 4\nA-H 8\nB-C 8\nB-H 11\nC-D 7\nC-F 4\nC-I 2\nD-E 9\nD-F 14\nE-F 10\nF-G 2\nG-H 1\nG-I 6\nH-I 7", title: "Kruskal (CLRS Fig. 23.4) = 37" },
      { label: "Eulerian", snippet: "eulerian\nA-B\nA-B\nA-C\nA-D\nB-C\nB-D\nC-D", title: "Königsberg: none" },
      { label: "bipartite", snippet: "bipartite\nA-B\nB-C\nC-D\nD-E\nE-F\nF-A", title: "A 6-cycle: yes" },
      { label: "toposort", snippet: "topological order\nshirt->tie\ntie->jacket\ntrousers->shoes\ntrousers->belt\nbelt->jacket\nshirt->belt", title: "Kahn on a DAG" },
      { label: "Hamiltonian", snippet: "hamiltonian\nA-B\nB-C\nC-D\nD-E\nE-A\nA-C", title: "Exhaustive to 16 vertices; certificates above" },
    ],
  },
];
