// Renders the shared math AST to HTML/CSS for the live preview. This mirrors the
// OMML emitter (mathOmml.ts) so the preview reflects what gets inserted, but uses
// only plain HTML/CSS (fractions, radicals, summations via styled spans) so it
// renders in any Office webview — no MathML required. Styling lives in
// taskpane.css under the .m-* classes.

import { Node, parseMathAst, isEmptyNode } from "./mathParse";
import { escapeHtml, segmentsToHtml } from "./segments";
import { parseMath } from "./mathFormat";

const OPERATORS = new Set([
  "+", "-", "=", "<", ">", "×", "·", "±", "→", "≤", "≥", "≠",
  "∈", "∉", "⊂", "⊆", "⊃", "⊇", "∪", "∩", "∧", "∨", "⊕", "⊗",
  "≡", "≈", "≅", "∝", "∥", "⇒", "⇔", "↦", "∠", "∣",
]);

function leaf(node: { v: string; label?: boolean }): string {
  // A minus is shown as the true minus sign (U+2212), never the hyphen it was typed as (Word's math zone renders the
  // OMML hyphen-minus as a minus the same way).
  const html = escapeHtml(node.v === "-" ? "−" : node.v);
  // A sign used as a state label (|+⟩, Φ⁺) is not an operator and gets no operator spacing.
  return OPERATORS.has(node.v) && !node.label ? `<span class="m-op">${html}</span>` : html;
}

/** The base of an accent is more than one letter (bar(xy), vec(AB)): a combining mark would sit on the last one only. */
function wideBase(n: Node): boolean {
  if (n.k === "text") return [...n.v].length > 1;
  return true;
}

// Wide accents drawn over the whole base, centred, as Word draws them. Inline styles: the preview needs no new CSS.
const ACC_WIDE_GLYPH: Record<string, string> = { "⃗": "→", "̂": "^", "̃": "~", "̇": "˙", "̈": "¨" };

function accentHtml(chr: string, base: Node): string {
  const inner = astToHtml(base);
  if (!wideBase(base)) return `${inner}${chr}`; // a combining accent renders over the preceding single letter
  if (chr === "̄" || chr === "̅") {
    return `<span class="m-acc-bar" style="border-top:1px solid currentColor;padding-top:1px;display:inline-block;line-height:1.1">${inner}</span>`;
  }
  const glyph = ACC_WIDE_GLYPH[chr] ?? "^";
  const stretch = chr === "⃗" ? "transform:scaleX(1.6);" : "";
  return (
    `<span class="m-acc-wide" style="display:inline-flex;flex-direction:column;align-items:center;vertical-align:bottom;line-height:1">` +
    `<span style="font-size:0.7em;line-height:0.6;font-style:normal;${stretch}">${escapeHtml(glyph)}</span>` +
    `<span>${inner}</span></span>`
  );
}

function astToHtml(node: Node): string {
  switch (node.k) {
    case "text":
      // A unit after a number: thin space, upright (25 °C, 3 m/s); a prose word in a cases condition: upright.
      if (node.unit) return `<span class="m-fn">&#8201;${escapeHtml(node.v)}</span>`;
      if (node.word) return `<span class="m-fn" style="white-space:pre">${escapeHtml(node.v)}</span>`;
      return leaf(node);
    case "row":
      return node.items.map(astToHtml).join("");
    case "frac":
      return (
        `<span class="m-frac"><span class="m-frac-n">${astToHtml(node.num)}</span>` +
        `<span class="m-frac-d">${astToHtml(node.den)}</span></span>`
      );
    case "binom":
      // n over k with no bar, in parentheses.
      return (
        `(<span class="m-frac m-frac-nobar"><span class="m-frac-n">${astToHtml(node.top)}</span>` +
        `<span class="m-frac-d">${astToHtml(node.bottom)}</span></span>)`
      );
    case "sup":
      return `${astToHtml(node.base)}<sup>${astToHtml(node.sup)}</sup>`;
    case "sub":
      return `${astToHtml(node.base)}<sub>${astToHtml(node.sub)}</sub>`;
    case "subsup":
      return `${astToHtml(node.base)}<sub>${astToHtml(node.sub)}</sub><sup>${astToHtml(node.sup)}</sup>`;
    case "rad": {
      const deg = node.degree ? `<sup class="m-deg">${astToHtml(node.degree)}</sup>` : "";
      return `${deg}<span class="m-sqrt">√</span><span class="m-rad">${astToHtml(node.radicand)}</span>`;
    }
    case "delim":
      return `${escapeHtml(node.open)}${astToHtml(node.inner)}${escapeHtml(node.close)}`;
    case "nary":
      // No limits (an indefinite integral or sum): the bare operator, nothing above or below it.
      if (isEmptyNode(node.sub) && isEmptyNode(node.sup)) {
        return `<span class="m-nary"><span class="m-nary-op">${escapeHtml(node.chr)}</span></span>${astToHtml(node.body)}`;
      }
      return (
        `<span class="m-nary"><span class="m-nary-op">${escapeHtml(node.chr)}</span>` +
        `<span class="m-nary-lim"><span class="m-over">${astToHtml(node.sup)}</span>` +
        `<span class="m-under">${astToHtml(node.sub)}</span></span></span>${astToHtml(node.body)}`
      );
    case "func":
      return `<span class="m-fn">${escapeHtml(node.name)}</span>${astToHtml(node.arg)}`;
    case "lim":
      if (isEmptyNode(node.sub)) return `<span class="m-fn">lim</span> ${astToHtml(node.body)}`;
      return `<span class="m-fn">lim</span><sub>${astToHtml(node.sub)}</sub> ${astToHtml(node.body)}`;
    case "acc":
      return accentHtml(node.chr, node.base);
    case "matrix": {
      const cols = node.rows[0].length;
      const cells = node.rows
        .map((row) => row.map((cell) => `<span class="m-mcell">${astToHtml(cell)}</span>`).join(""))
        .join("");
      return (
        `${escapeHtml(node.open)}<span class="m-matrix" style="grid-template-columns:repeat(${cols},auto)">` +
        `${cells}</span>${escapeHtml(node.close)}`
      );
    }
    case "cases": {
      const cells = node.rows
        .map((row) => {
          const value = `<span class="m-mcell m-case-val">${astToHtml(row[0])}</span>`;
          const cond = `<span class="m-mcell m-case-cond">${row[1] ? astToHtml(row[1]) : ""}</span>`;
          return value + cond;
        })
        .join("");
      return `<span class="m-cases-brace">{</span><span class="m-cases">${cells}</span>`;
    }
    case "stack":
      return `<span class="m-stack">${node.rows.map((r) => `<span class="m-stack-row">${astToHtml(r)}</span>`).join("")}</span>`;
  }
}

/**
 * Renders a math expression to preview HTML. Uses the structured renderer when
 * the expression parses; otherwise falls back to inline sub/superscript
 * formatting so the preview never goes blank on partial input.
 */
export function mathToHtml(text: string): string {
  if (!text.trim()) return "";
  try {
    return astToHtml(parseMathAst(text));
  } catch {
    return segmentsToHtml(parseMath(text));
  }
}
