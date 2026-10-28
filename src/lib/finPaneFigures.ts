/**
 * New figures for the Finance calculators written inside taskpane.ts (FIN_CALCS), "fully inclusive" (2026-10-28).
 *
 * fin-currency: the converted amounts as bars, all in the target currency (the typed amounts are in mixed
 * currencies and cannot share an axis; their conversions can, and that comparison is what the table makes the reader
 * do by eye). Every bar is the Converted cell of the result's own conversions table, so the figure cannot disagree
 * with the table. Drawn through hBarSvg at the Finance figure width and black-and-white setting (currentFinFig), as
 * the effective-rate figure is, so it re-renders under withFinFig. hBarSvg shows at most 24 rows and says how many
 * more there are.
 *
 * Declined: the Georgia-Pacific and Panduit worksheets. They have no inputs (fields: []) and their evidence cells are
 * filled in Word after insertion, so the pane never holds an entered or computed value to plot.
 */
import { hBarSvg } from "./mechchart";
import { currentFinFig } from "./financeFigures";
import { cellAmount, currencyConversions, finCurrencyReading, withReading } from "./finPaneReadings";

/** The bars of a currency conversion, or undefined when no amounts were typed (or a cell does not read). */
export function finCurrencyFigure(out: { ok?: boolean; tables?: { label: string; rows: string[][] }[] }): string | undefined {
  if (out.ok === false) return undefined;
  const conv = currencyConversions(out);
  if (!conv) return undefined;
  // Each bar printed with the table's own Converted cell ("€1,258.60"), never "1259 EUR" or money in ×10ⁿ.
  const rows = conv.rows.map((r) => ({ name: r[0].split(String.fromCharCode(0xa0)).join(" "), value: cellAmount(r[2]), text: r[2] }));
  if (!rows.every((r) => Number.isFinite(r.value))) return undefined;
  const fig = currentFinFig();
  return hBarSvg(rows, { title: `Amounts converted to ${conv.target}`, unit: conv.target, w: fig?.width ?? 360, bw: fig?.bw });
}

/** The currency result with its figure and reading (the pane entry's one call); a refusal passes through untouched. */
export function finCurrencyWithFigure<T extends { text: string; ok?: boolean; tables?: { label: string; rows: string[][] }[] }>(
  out: T,
): T & { reading?: string; svg?: string } {
  if (out.ok === false) return out;
  const svg = finCurrencyFigure(out);
  const drawn: T & { svg?: string } = svg ? { ...out, svg } : out;
  return withReading(drawn, finCurrencyReading(out));
}
