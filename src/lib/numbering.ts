// Patent-style equation/formula numbering: a persistent counter (in localStorage)
// and Roman-numeral formatting, so inserted equations can be labelled (I), (II), …

/* global localStorage */

const COUNTER_KEY = "formula-inserter.formulaCounter";

const ROMAN: Array<[number, string]> = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

/** Converts a positive integer to an uppercase Roman numeral. */
export function toRoman(n: number): string {
  let value = Math.max(1, Math.floor(n));
  let out = "";
  for (const [num, sym] of ROMAN) {
    while (value >= num) {
      out += sym;
      value -= num;
    }
  }
  return out;
}

/** Returns the next formula number without consuming it. */
export function peekFormulaNumber(): number {
  try {
    const raw = localStorage.getItem(COUNTER_KEY);
    const n = raw ? parseInt(raw, 10) : 1;
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    return 1;
  }
}

/** Returns the current formula number and advances the counter. */
export function nextFormulaNumber(): number {
  const n = peekFormulaNumber();
  try {
    localStorage.setItem(COUNTER_KEY, String(n + 1));
  } catch {
    // best-effort
  }
  return n;
}

/** Resets formula numbering back to (I). */
export function resetFormulaNumbering(): void {
  try {
    localStorage.setItem(COUNTER_KEY, "1");
  } catch {
    // best-effort
  }
}
