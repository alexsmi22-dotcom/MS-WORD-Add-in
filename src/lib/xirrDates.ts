/**
 * XIRR's dates (F1 D3): the "Dates" field read as calendar dates, as Excel's XIRR takes them, through the product's one
 * date reader (damagesInterest.ts readDateToken: YYYY-MM-DD, M/D/YYYY, "January 5, 2024"). The result is days from the
 * first date, which finance.ts xirr() discounts over a 365-day year.
 *
 * Accepted: one date per line (a Word or Excel column through "Use table at cursor"), or dates separated by
 * semicolons, or — when every piece is a date — by commas. A first line that is not a date and not a number is a
 * column title and is skipped. A field of plain numbers is read as day counts from the first flow, as before v2.202.0.
 */
import { readDateToken, longDate } from "./damagesInterest";
import { readFinanceField } from "./finance";

export interface XirrDates {
  /** Days from the first date (or the day counts as typed). */
  days: number[];
  /** "dates" when calendar dates were read; "days" for plain day counts. */
  kind: "dates" | "days";
  /** The first and last dates, written out, when calendar dates were read. */
  span?: string;
  note?: string;
}

/**
 * Past this many dates the field is refused by name (XIRR is a root search over every flow). Was 10,000, where a
 * rate with no root took 4.1 s and froze Word (fix-fin R1 #2); at 500 a no-root search still took up to 390 ms under
 * jest, so 250 (about half that). Fix round 2 M4: 250 refused a 30-year monthly schedule (361 dates with the first
 * flow), so 400; measured under jest on the cold first call with no root: 361 dates 264 ms, 500 dates 372 ms (a root
 * is found in about 10 ms).
 */
export const XIRR_MAX_FLOWS = 400;

function wholeDate(s: string): number | { error: string } | null {
  const t = readDateToken(s, false);
  if (!t) return null;
  if ("error" in t) return t;
  return t.len === s.length ? t.from : null;
}

export function readXirrDates(raw: string): XirrDates | { error: string } {
  let pieces = (raw ?? "")
    .split(/\r?\n|;/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (pieces.length === 1 && pieces[0].includes(",")) {
    const parts = pieces[0].split(",").map((p) => p.trim()).filter((p) => p !== "");
    // Commas separate dates only when every piece is one ("January 5, 2024" holds a comma of its own).
    if (parts.length > 1 && parts.every((p) => typeof wholeDate(p) === "number" || Number.isFinite(readFinanceField(p)))) pieces = parts;
  }
  if (!pieces.length) return { error: "Enter one date per cash flow (YYYY-MM-DD, M/D/YYYY or January 5, 2024)." };
  if (pieces.length > XIRR_MAX_FLOWS) {
    return { error: `The dates field holds more than ${XIRR_MAX_FLOWS.toLocaleString("en-US")} dates: XIRR searches over every flow, so this calculator takes at most ${XIRR_MAX_FLOWS.toLocaleString("en-US")}.` };
  }
  let note: string | undefined;
  const first = pieces[0];
  if (wholeDate(first) === null && !Number.isFinite(readFinanceField(first))) {
    note = `The first line (“${first.length > 40 ? first.slice(0, 40) + "…" : first}”) was read as a column title and skipped.`;
    pieces = pieces.slice(1);
    if (!pieces.length) return { error: "Enter one date per cash flow under the column title." };
  }
  // Plain day counts, as before.
  const nums = pieces.map(readFinanceField);
  if (nums.every(Number.isFinite)) return { days: nums, kind: "days", note };
  const days: number[] = [];
  for (const p of pieces) {
    const d = wholeDate(p);
    if (d === null) return { error: `Dates: “${p}” is not a date. Use YYYY-MM-DD, M/D/YYYY or January 5, 2024, one per cash flow.` };
    if (typeof d !== "number") return { error: `Dates: ${d.error}` };
    days.push(d);
  }
  const d0 = days[0];
  for (let i = 1; i < days.length; i++) {
    if (days[i] < d0) return { error: `Dates: ${longDate(days[i])} is before the first date (${longDate(d0)}); put the first cash flow's date first.` };
  }
  return { days: days.map((d) => d - d0), kind: "dates", span: `${longDate(d0)} to ${longDate(Math.max(...days))}`, note };
}
