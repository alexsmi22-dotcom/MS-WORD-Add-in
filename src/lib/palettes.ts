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
    name: "Functions",
    items: [
      { label: "sin", snippet: "sin()", caret: 4 },
      { label: "cos", snippet: "cos()", caret: 4 },
      { label: "tan", snippet: "tan()", caret: 4 },
      { label: "log", snippet: "log()", caret: 4 },
      { label: "ln", snippet: "ln()", caret: 3 },
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
      { label: "·", snippet: "·", title: "Hydrate dot" },
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
