// Formats a pseudocode/algorithm block or a verbatim code listing into HTML for
// Word.Range.insertHtml(). Both render as a monospace, whitespace-preserving block
// with an optional caption and optional line numbers; "algorithm" style also
// bolds common control-flow keywords (the convention in algorithm environments).
//
// Pure string logic — no Office.js — so it is fully unit-testable.

export type CodeStyle = "algorithm" | "code";

export interface CodeBlockOptions {
  style: CodeStyle;
  /** Caption shown bold above the block, e.g. "Algorithm 1: KeyGen" (optional). */
  title?: string;
  /** Prefix each line with its number. */
  lineNumbers: boolean;
}

// Control-flow / structural keywords bolded in "algorithm" style.
const KEYWORDS = [
  "function", "procedure", "algorithm", "return", "if", "then", "else", "elif",
  "for", "foreach", "while", "do", "repeat", "until", "break", "continue",
  "begin", "end", "endif", "endfor", "endwhile", "and", "or", "not", "xor",
  "mod", "to", "downto", "require", "ensure", "input", "output",
];

const KEYWORD_RE = new RegExp(`\\b(${KEYWORDS.join("|")})\\b`, "gi");

const MONO = "font-family:Consolas,'Courier New',monospace;font-size:10pt;";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Bolds whole-word keywords in already-escaped text (preserving the typed case). */
function boldKeywords(escaped: string): string {
  return escaped.replace(KEYWORD_RE, "<b>$1</b>");
}

/** Splits into lines, tabs→spaces, and trims leading/trailing blank lines. */
function toLines(input: string): string[] {
  const lines = input.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.length ? lines : [""];
}

/** Renders a code/algorithm block as an HTML table for Word.Range.insertHtml(). */
export function formatCodeBlock(input: string, opts: CodeBlockOptions): string {
  const lines = toLines(input);
  const rows: string[] = [];

  const title = (opts.title ?? "").trim();
  if (title) {
    const span = opts.lineNumbers ? ' colspan="2"' : "";
    rows.push(
      `<tr><td${span} style="${MONO}font-weight:bold;padding:2px 6px;border-bottom:1px solid #cccccc;">` +
        `${escapeHtml(title)}</td></tr>`,
    );
  }

  lines.forEach((line, i) => {
    let content = escapeHtml(line);
    if (opts.style === "algorithm") content = boldKeywords(content);
    if (content === "") content = "&#160;"; // keep blank lines from collapsing
    const codeCell = `<td style="${MONO}white-space:pre;padding:0 6px;">${content}</td>`;
    if (opts.lineNumbers) {
      const numCell =
        `<td style="${MONO}color:#888888;text-align:right;padding:0 8px 0 4px;vertical-align:top;">${i + 1}</td>`;
      rows.push(`<tr>${numCell}${codeCell}</tr>`);
    } else {
      rows.push(`<tr>${codeCell}</tr>`);
    }
  });

  return `<table style="border-collapse:collapse;border:1px solid #cccccc;${MONO}">${rows.join("")}</table>`;
}
