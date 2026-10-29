/**
 * The pure part of the Stats field readers (moved out of taskpane.ts so it can be tested: host-adapter
 * scope §E). The readers that log typed decimal commas (statList and the group / table / two-way readers
 * built on it) stay in the pane with the comma log they write: see the scope doc for why.
 */
import { readNumberList } from "./numberList";
import { nbspSeparators } from "./statsDisplay";

/** The comma's role is decided over the WHOLE field, not per group: a field
 *  with "1,2,3" in one group and "4,5 6" in the next is comma-LISTING, so the
 *  second group is 4, 5, 6 — not 4.5, 6 (v2.134.0 integration review). */
export function statFieldCommasAreSeparators(s: string): boolean {
  return readNumberList(s).commaMode === "separator";
}

/**
 * Whether a field's pieces (its groups or rows) PROVE a decimal comma: some piece holds several values
 * separated by spaces or semicolons, one comma each ("1,5 2,5 3,5"). Then a piece of one value ("4,5") is a
 * cell too, 4.5 — read alone it was a comma list, 4 and 5 (v2.160.0). A field whose every piece is one comma
 * run ("10,20" per row of a table) proves nothing, and each piece stays a comma list: forcing cells there
 * read a 2 × 2 table "10,20 / 30,40" as 10.2 and 30.4, and "100,200" as 100200 (v2.160.0 review).
 */
export function statFieldProvesDecimalCommas(pieces: string[]): boolean {
  return pieces.some((p) => {
    const r = readNumberList(p);
    return r.commaMode === "cell" && r.decimalCommas > 0;
  });
}

/**
 * The question a Stats field must ask before it is read (fix round 3 N1), or "" when it reads one way. A lone grouped
 * run that reads two ways ("100,200,300": three values or one number; "1,500": two values, 1500 or 1.5) carries
 * numberList's `ambiguous` question, but statList returns only the values, so the pane used to take the list reading
 * in silence. `as` follows the pane's own split (statList on the whole list; statGroups at semicolons and blank
 * lines, each group read as a cell when the field proves a decimal comma). Fields of ROWS that need several values
 * (regression rows, subjects, survival, Cox, contingency tables) are not asked: the list is a row's only reading.
 */
export function statFieldAmbiguity(text: string, as: "numbers" | "groups"): string {
  const t = nbspSeparators(text ?? "");
  if (!t.trim()) return "";
  if (as === "numbers") return readNumberList(t).ambiguous ?? "";
  if (statFieldCommasAreSeparators(t)) return "";
  const groups = t.split(/\n\s*\n|;/);
  if (statFieldProvesDecimalCommas(groups)) return "";
  for (const g of groups) {
    const a = readNumberList(g).ambiguous;
    if (a) return a;
  }
  return "";
}
