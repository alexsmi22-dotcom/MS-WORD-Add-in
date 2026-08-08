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
      { label: "Conic", snippet: "x^2/9 + y^2/4 = 1", title: "Classified with axes, foci, eccentricity" },
    ],
  },
];
