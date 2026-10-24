/**
 * Underscore subscripts in result prose, typeset (v2.191.0 QC: "η_geo", "D_t", "S_a", "P_succ" reached inserted text
 * in the quantum tools, and "C_b" in the chemistry ones). A math line's own source keeps its underscores — Word
 * typesets those — but text, tables, captions and output names are read as written.
 *
 * Rule: a subscript whose every character has a Unicode subscript form becomes those characters (S_a → Sₐ,
 * D_t → Dₜ, S_max → Sₘₐₓ, x_12 → x₁₂); any other subscript is written in brackets, the convention the Engineering
 * reports already use for ε(eff) (η_geo → η(geo), P_succ → P(succ), ρ_A → ρ(A), η_{d,a} → η(d,a)).
 */
import type { AnalyzeBlock, AnalyzeOutput } from "./analyzeBlocks";

const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ",
  u: "ᵤ", v: "ᵥ", x: "ₓ", "+": "₊", "-": "₋", "=": "₌",
  β: "ᵦ", γ: "ᵧ", ρ: "ᵨ", φ: "ᵩ", χ: "ᵪ",
};

// A subscript right after a letter, a closing bracket or a ket: _{…} or a run of letters and digits.
const SCRIPT = /([A-Za-zα-ωΑ-Ω)\]⟩|])_(\{([^{}]+)\}|[A-Za-z0-9α-ω]+)/g;

/** One text with its underscore subscripts typeset. */
export function tidySubscripts(text: string): string {
  if (!text.includes("_")) return text;
  return text.replace(SCRIPT, (_m, base: string, raw: string, braced: string | undefined) => {
    const body = braced ?? raw;
    const chars = [...body];
    return chars.every((c) => c in SUB) ? base + chars.map((c) => SUB[c]).join("") : `${base}(${body})`;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The display pass (fix round 2.193): numbers in legacy result prose typeset as the display contract writes them.
// ---------------------------------------------------------------------------------------------------------------

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "-": "⁻", "−": "⁻", "+": "⁺",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ",
  o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
};
const sup = (s: string): string => [...s].map((c) => SUP[c] ?? c).join("");

/** "1.2e-5", "3.3e+7", "-4e3" → "1.2×10⁻⁵", "3.3×10⁷", "-4×10³" (an exponent of 0 drops). Not inside identifiers. */
export function typesetENotation(s: string): string {
  return s.replace(/(^|[^\w.])([-−]?\d+(?:\.\d+)?)[eE]([+-]?)(\d+)(?!\d|\.\d)/g, (_m, pre: string, mant: string, sg: string, ex: string) => {
    const n = Number(ex);
    return n === 0 ? `${pre}${mant}` : `${pre}${mant}×10${sup((sg === "-" ? "-" : "") + String(n))}`;
  });
}

/**
 * Integer and single-letter exponents written with a caret → superscripts: "mm^4" → "mm⁴", "m^-1" → "m⁻¹",
 * "s^(−2)" → "s⁻²", "n^k" → "nᵏ". A decimal exponent ("N^-0.085") has no superscript form and is left for its
 * source to write differently.
 */
export function typesetCarets(s: string): string {
  if (!s.includes("^")) return s;
  return s
    .replace(/([A-Za-z0-9)\]µΩ°²³}])\^(?:\(([+\-−]?\d+)\)|\{([+\-−]?\d+)\}|([+\-−]?\d+))(?!\d|\.\d)/g, (_m, base: string, a?: string, b?: string, c?: string) => base + sup(a ?? b ?? c ?? ""))
    .replace(/([A-Za-z0-9)\]])\^([a-pr-z])(?![A-Za-z0-9.(])/g, (_m, base: string, l: string) => base + sup(l));
}

/**
 * The true minus (U+2212) for a hyphen-minus used as a numeric SIGN ("Max shear: -42.5", "(-3", "≈ -7") or as the
 * binary minus between two numbers ("0.6624 - 0.5623j"). Hyphens inside words and digit-hyphen-digit ranges and
 * references ("0-100", "Eq. 6-27", "2019-2020") are left alone. A SPACED hyphen between two plain numbers is a
 * subtraction ("10 - 20" → "10 − 20") except in a range context — right after "range (of)", "ranging", "from",
 * "between" or "within" — where it is an en-dash range ("a range of 10 - 20" → "a range of 10–20").
 */
export function typesetMinus(s: string): string {
  return s
    .replace(/(^|[\s(=,;:[/×≈~<>≤≥±→^])-(?=\.?\d)/g, "$1−")
    .replace(/\b(ranges?|ranging|from|between|within)(\s+(?:of\s+)?)(\d+(?:\.\d+)?) - (\d+(?:\.\d+)?)(?![\d.])/gi, "$1$2$3–$4")
    .replace(/([\dj)]) - (?=\.?\d)/g, "$1 − ");
}

/**
 * One prose string under the display contract: e-notation as ×10ⁿ, caret exponents as superscripts, a true minus.
 * Text inside double quotes is left exactly as written: it is syntax the user is told to type ("k=5e4").
 */
export function tidyDisplay(text: string): string {
  if (!/[eE^-]/.test(text)) return text;
  return text
    .split(/("[^"\n]*"|“[^”\n]*”)/)
    .map((seg, i) => (i % 2 === 1 ? seg : typesetMinus(typesetCarets(typesetENotation(seg)))))
    .join("");
}

/** The text nodes of an SVG figure (labels, legends, notes) through tidyDisplay; markup and attributes untouched. */
export function tidySvgText(svg: string): string {
  // A text node follows an opening <text>/<tspan> OR a closing </tspan> (mixed content: "<text>a<tspan>b</tspan>c</text>"
  // — the "c" was skipped). A </tspan> only ever occurs inside a <text>, so no node outside text is touched.
  return svg.replace(/(<(?:text|tspan)\b[^>]*>|<\/tspan>)([^<]+)/g, (_m, tag: string, body: string) => tag + tidyDisplay(body));
}

/**
 * ROUNDING NOISE SNAPPED TO ZERO, against the scale of the result it belongs to: a value smaller than rel × scale is
 * floating-point residue of a cancellation (pure shear's σ₂ = 3.5×10⁻¹⁵, an isentropic Q of −2.9×10⁻¹¹ J, a plate
 * reaction of −1.1×10⁻¹⁰ N beside 100 N) and is printed as the 0 it is. The scale must be the tool's own (the largest
 * magnitude among the quantities printed together), so the snap is per tool; an all-small result is never zeroed.
 */
export function snapNoise(x: number, scale: number, rel = 1e-10): number {
  if (!Number.isFinite(x) || !Number.isFinite(scale) || scale <= 0) return x;
  return Math.abs(x) < rel * scale ? 0 : x;
}

/** Every value of a group snapped against the group's own largest magnitude. */
export function snapGroup(values: number[], rel = 1e-10): number[] {
  const scale = Math.max(0, ...values.filter(Number.isFinite).map(Math.abs));
  return values.map((v) => snapNoise(v, scale, rel));
}

function tidyBlock(b: AnalyzeBlock, display: boolean): AnalyzeBlock {
  const t = (s: string): string => (display ? tidyDisplay(tidySubscripts(s)) : tidySubscripts(s));
  switch (b.kind) {
    case "line":
      return { ...b, text: t(b.text) };
    case "math":
      return { ...b, fallback: t(b.fallback) };
    case "table":
      return { ...b, label: b.label === undefined ? undefined : t(b.label), rows: b.rows.map((r) => r.map(t)) };
    case "plot":
      return { ...b, caption: t(b.caption ?? ""), alt: t(b.alt ?? ""), ...(display && b.svg ? { svg: tidySvgText(b.svg) } : {}) };
    default:
      return b;
  }
}

/**
 * A result with its prose, tables, captions, fallbacks and output names typeset; the math sources untouched. An ok
 * result also gets the display pass (tidyDisplay) on every text, and on its figures' text nodes; a refusal keeps its
 * wording exactly, since it often quotes what to type.
 */
export function tidyResultSubscripts(out: AnalyzeOutput): AnalyzeOutput {
  const display = out.ok !== false;
  return {
    ...out,
    text: display ? tidyDisplay(tidySubscripts(out.text)) : tidySubscripts(out.text),
    blocks: out.blocks?.map((b) => tidyBlock(b, display)),
    outputs: out.outputs?.map((o) => ({ ...o, label: tidySubscripts(o.label) })),
  };
}
