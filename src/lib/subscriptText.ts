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

function tidyBlock(b: AnalyzeBlock): AnalyzeBlock {
  switch (b.kind) {
    case "line":
      return { ...b, text: tidySubscripts(b.text) };
    case "math":
      return { ...b, fallback: tidySubscripts(b.fallback) };
    case "table":
      return { ...b, label: b.label === undefined ? undefined : tidySubscripts(b.label), rows: b.rows.map((r) => r.map(tidySubscripts)) };
    case "plot":
      return { ...b, caption: tidySubscripts(b.caption ?? ""), alt: tidySubscripts(b.alt ?? "") };
    default:
      return b;
  }
}

/** A result with its prose, tables, captions, fallbacks and output names typeset; the math sources untouched. */
export function tidyResultSubscripts(out: AnalyzeOutput): AnalyzeOutput {
  return {
    ...out,
    text: tidySubscripts(out.text),
    blocks: out.blocks?.map(tidyBlock),
    outputs: out.outputs?.map((o) => ({ ...o, label: tidySubscripts(o.label) })),
  };
}
