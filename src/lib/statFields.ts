/**
 * The pure part of the Stats field readers (moved out of taskpane.ts so it can be tested: host-adapter
 * scope §E). The readers that log typed decimal commas (statList and the group / table / two-way readers
 * built on it) stay in the pane with the comma log they write: see the scope doc for why.
 */
import { readNumberList } from "./numberList";

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
