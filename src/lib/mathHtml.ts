// Renders the shared math AST to HTML/CSS for the live preview. This mirrors the
// OMML emitter (mathOmml.ts) so the preview reflects what gets inserted, but uses
// only plain HTML/CSS (fractions, radicals, summations via styled spans) so it
// renders in any Office webview — no MathML required. Styling lives in
// taskpane.css under the .m-* classes.

import { Node, parseMathAst } from "./mathParse";
import { escapeHtml, segmentsToHtml } from "./segments";
import { parseMath } from "./mathFormat";

const OPERATORS = new Set([
  "+", "-", "=", "<", ">", "×", "·", "±", "→", "≤", "≥", "≠",
  "∈", "∉", "⊂", "⊆", "⊃", "⊇", "∪", "∩", "∧", "∨", "⊕", "⊗",
  "≡", "≈", "≅", "∝", "∥", "⇒", "⇔", "↦", "∠",
]);

function leaf(node: { v: string }): string {
  const html = escapeHtml(node.v);
  return OPERATORS.has(node.v) ? `<span class="m-op">${html}</span>` : html;
}

function astToHtml(node: Node): string {
  switch (node.k) {
    case "text":
      return leaf(node);
    case "row":
      return node.items.map(astToHtml).join("");
    case "frac":
      return (
        `<span class="m-frac"><span class="m-frac-n">${astToHtml(node.num)}</span>` +
        `<span class="m-frac-d">${astToHtml(node.den)}</span></span>`
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
      return (
        `<span class="m-nary"><span class="m-nary-op">${escapeHtml(node.chr)}</span>` +
        `<span class="m-nary-lim"><span class="m-over">${astToHtml(node.sup)}</span>` +
        `<span class="m-under">${astToHtml(node.sub)}</span></span></span>${astToHtml(node.body)}`
      );
    case "func":
      return `<span class="m-fn">${escapeHtml(node.name)}</span>${astToHtml(node.arg)}`;
    case "lim":
      return `<span class="m-fn">lim</span><sub>${astToHtml(node.sub)}</sub> ${astToHtml(node.body)}`;
    case "acc":
      // Combining accent character renders over the preceding base text.
      return `${astToHtml(node.base)}${node.chr}`;
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
