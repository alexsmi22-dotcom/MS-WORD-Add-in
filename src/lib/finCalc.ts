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
  /**
   * A select's per-option defaults for OTHER fields (R3 MINOR 12): { optionValue: { fieldKey: default } }. A mode
   * whose inputs differ in shape (prices instead of returns, a lognormal's two numbers instead of a triangle's three)
   * otherwise refused its own defaults. A field not named under an option keeps its own `default` for that option.
   * Applied by modeDefaultSwaps when the select changes.
   */
  modeDefaults?: Record<string, Record<string, string>>;
}

/**
 * The fields to change when select `sel` goes from option `prev` to option `next` (R3 MINOR 12). A field named in any
 * of the select's modeDefaults takes the default of the CURRENT combination of selects, when it still holds a default
 * (its own, or any option's of any select: so nothing the user typed is overwritten). The combination's default is
 * that of the first select, in field order, whose current option names the field; else the field's own. Fix round 3
 * F3: it used to compare only against the previous option of the select being changed, so dmg-sec-ribbon with units
 * = decimal and then mode = dollar kept the decimal abnormal returns and refused its own defaults; the order of the
 * two changes decided the result. `current` reads a field's present value (a select's too). Pure, so it is tested;
 * the pane makes one call and writes the result into its inputs.
 */
export function modeDefaultSwaps(fields: FinField[], sel: FinField, prev: string, next: string, current: (key: string) => string): Record<string, string> {
  const md = sel.modeDefaults;
  if (!md || prev === next) return {};
  const selects = fields.filter((f) => f.kind === "select" && f.modeDefaults);
  const optionOf = (s: FinField): string => (s.key === sel.key ? next : current(s.key) || s.default);
  // Line endings and outer spaces aside (a textarea may hand back \n for \r\n).
  const norm = (s: string): string => s.replace(/\r\n?/g, "\n").trim();
  const keys = new Set<string>();
  for (const opt of Object.keys(md)) for (const k of Object.keys(md[opt])) keys.add(k);
  const out: Record<string, string> = {};
  for (const k of keys) {
    const f = fields.find((x) => x.key === k);
    if (!f) continue;
    const owner = selects.find((s) => s.modeDefaults![optionOf(s)]?.[k] !== undefined);
    const will = owner ? owner.modeDefaults![optionOf(owner)][k] : f.default;
    const defaults = new Set([f.default, ...selects.flatMap((s) => Object.values(s.modeDefaults!).map((o) => o[k]).filter((v): v is string => v !== undefined))].map(norm));
    const now = norm(current(k));
    if (now !== norm(will) && defaults.has(now)) out[k] = will;
  }
  return out;
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
