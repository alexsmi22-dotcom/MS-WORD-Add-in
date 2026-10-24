// Em dashes out of prose that goes into an OK result (v2.193.0). Pure: no Office.js.
//
// An em dash in result text is the pane's NON-FINITE sentinel (formatNum prints "—" for a value it cannot show) and
// the insert gate refuses text carrying one. Caveats, assumptions and notes are written as prose with em dashes, and
// several were appended AFTER the gate (Bio/Assay "Note:" lines, Finance assumptions), so an em dash reached the
// document. engReport.plainDashes turns them into a spaced hyphen; this writes the punctuation a sentence wants
// instead, changing no word:
//   a PAIR of dashes in one sentence (a parenthetical)  → commas:    "that plateau, and the EC50, is extrapolation"
//   a single dash                                         → semicolon: "not a best fit; do not report them"
// En dashes (ranges, "Black–Scholes") are untouched.

const EM = "—";

function sentence(s: string): string {
  if (!s.includes(EM)) return s;
  const parts = s.split(/\s*—\s*/);
  let out = parts[0];
  const n = parts.length - 1; // dashes in this sentence
  for (let i = 1; i < parts.length; i++) {
    // Dashes pair up left to right; an odd one out (the last) is a break, not a parenthesis.
    const lone = n % 2 === 1 && i === n;
    const p = parts[i];
    if (!out) out = p;
    else if (!p) out += lone ? ";" : ",";
    else out += (lone ? "; " : ", ") + p;
  }
  return out;
}

/** The text with every em dash replaced by the comma(s) or semicolon its sentence wants. */
export function proseDashes(text: string): string {
  if (!text.includes(EM)) return text;
  return text
    .split("\n")
    .map((line) => line.split(/(?<=[.!?])(\s+)/).map(sentence).join(""))
    .join("\n");
}
