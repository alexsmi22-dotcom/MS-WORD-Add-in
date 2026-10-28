/**
 * The Finance calculator contract (v2.202.0, release F1), shared by the pane's own FIN_CALCS entries and every library
 * registry (src/lib/*Calcs.ts) spread into it, as engCalc.ts is for Engineering. A shape change is a type error at its
 * source rather than at integration.
 *
 * FIN_GROUP_ORDER fixes the headings of the grouped Finance dropdown (an <optgroup> each, as Engineering does): a
 * calculator naming a group outside it is a type error rather than a silently ungrouped option.
 */

export const FIN_GROUP_ORDER = [
  "Time value & loans",
  "Capital budgeting & valuation",
  "Fixed income",
  "Derivatives",
  "Portfolio & risk",
  "Accounting & statements",
  "IP valuation & licensing",
  "Litigation damages",
  "Currency",
] as const;
export type FinGroup = (typeof FIN_GROUP_ORDER)[number];

export interface FinField {
  key: string;
  label: string;
  default: string;
  /**
   * "text" is a one-line text field read as typed (a date); "block" is a multi-line table field (rows of a date and
   * a value) with the "Use table at cursor" / "Open CSV…" bar. Neither goes through the number reader.
   */
  kind?: "number" | "select" | "list" | "text" | "block";
  options?: { value: string; label: string }[];
  /** A field that may be left blank (fin-currency's "rates as of" date): it does not hold back the result. */
  optional?: boolean;
}

/** A Word table inserted with the result text and figure as one package; per-column alignment and a note under it. */
export type FinTable = { label: string; rows: string[][]; align?: ("left" | "center" | "right")[]; note?: string };

/**
 * What a Finance calculator returns: a plain string (text only), or text with a figure, Word tables, and `ok: false`
 * for a refusal (shown, never insertable).
 */
export type FinResult =
  | string
  | {
      text: string;
      /**
       * What the result means, in one or two plain sentences, built from the computed numbers (lib/calcReading.ts
       * states the rules). Shown first, in bold, and inserted as the first paragraph. Never on a refusal.
       */
      reading?: string;
      svg?: string;
      ok?: boolean;
      table?: FinTable;
      tables?: FinTable[];
    };

/** A Finance refusal: shown, never insertable. */
export const finRefusal = (text: string): FinResult => ({ text, ok: false });

/** One Finance calculator. */
export interface FinCalcDef {
  id: string;
  /** The dropdown label; it does not repeat the group heading. */
  name: string;
  group: FinGroup;
  fields: FinField[];
  compute: (read: (k: string) => string) => FinResult;
  /**
   * The modelling assumptions the calculator makes that its inputs cannot express — shown under the result and
   * carried into the inserted text.
   */
  assumes?: string;
}
