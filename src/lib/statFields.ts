/**
 * The pure part of the Stats field readers (moved out of taskpane.ts so it can be tested: host-adapter
 * scope §E). The readers that log typed decimal commas (statList and the group / table / two-way readers
 * built on it) stay in the pane with the comma log they write: see the scope doc for why.
 */
import { readNumberList } from "./numberList";

/** The comma's role is decided over the WHOLE field, not per group: a field
 *  with "1,2,3" in one group and "4,5 6" in the next is comma-LISTING, so the
 *  second group is 4, 5, 6 — not 4.5, 6 (v2.134.0 integration review). The
 *  other direction is forced too: in a "cell" field a group or row of ONE value
 *  ("3,5") is a cell, 3.5 — read alone it was a comma list, 3 and 5 (v2.160.0). */
export function statFieldCommasAreSeparators(s: string): boolean {
  return readNumberList(s).commaMode === "separator";
}
