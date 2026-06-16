// Standalone sanity check for the parsing logic — no Office or build step needed.
//
// These mirror the TypeScript parsers so you can verify the core logic from a
// plain terminal once Node is installed:
//
//   node src/lib/__tests__/parsers.sanity.mjs
//
// (The real app imports the .ts versions; this file is a lightweight copy used
//  only to eyeball parser output. Keep it in sync with chemParser.ts.)

const isDigit = (ch) => ch >= "0" && ch <= "9";

function pushSegment(segments, text, type) {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.type === type) last.text += text;
  else segments.push({ text, type });
}

function parseChemical(input) {
  const segments = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "^") {
      i++;
      let charge = "";
      while (i < input.length && isDigit(input[i])) charge += input[i++];
      if (i < input.length && (input[i] === "+" || input[i] === "-")) charge += input[i++];
      pushSegment(segments, charge, "sup");
      continue;
    }
    if (isDigit(ch)) {
      let num = "";
      while (i < input.length && isDigit(input[i])) num += input[i++];
      const prev = segments[segments.length - 1];
      pushSegment(segments, num, !prev || prev.text.endsWith(" ") ? "normal" : "sub");
      continue;
    }
    if (ch === "+" || ch === "-") {
      pushSegment(segments, ch, "sup");
      i++;
      continue;
    }
    pushSegment(segments, ch, "normal");
    i++;
  }
  return segments;
}

const render = (segs) =>
  segs.map((s) => (s.type === "sub" ? `[${s.text}]` : s.type === "sup" ? `^(${s.text})` : s.text)).join("");

for (const f of ["H2O", "Ca(OH)2", "H2SO4", "2H2O", "SO4^2-", "Fe^3+", "Na+", "Cl-"]) {
  console.log(f.padEnd(10), "=>", render(parseChemical(f)));
}
