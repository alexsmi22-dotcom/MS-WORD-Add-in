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
      { label: "xⁿ", snippet: "^", caret: 1, title: "Superscript / power" },
      { label: "xₙ", snippet: "_", caret: 1, title: "Subscript" },
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
