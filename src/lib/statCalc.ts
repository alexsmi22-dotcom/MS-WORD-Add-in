/**
 * The Stats calculator contract, shared by the pane's inline STAT_CALCS entries and the library registries spread into
 * it (F2, v2.203.0) — the Stats counterpart of finCalc.ts. Moved out of taskpane.ts so a registry in src/lib can be
 * typed and tested without importing the pane (which needs Office.js).
 */
import type { StatOutput } from "./analyzeBlocks";
import type { TableShape } from "./tableFeed";

export interface StatFieldDef {
  key: string;
  label: string;
  default: string;
  /**
   * `block` (E2): a data table with a header row of names, filled from a Word table or CSV as tab-separated cells
   * (lib/regData.ts reads it); `line`: several lines of syntax, one model per line.
   */
  kind: "list" | "groups" | "vars" | "text" | "select" | "block" | "line";
  options?: { value: string; label: string }[];
  /**
   * How a Word table maps onto this field's syntax (src/lib/tableFeed.ts).
   * Present on every `groups` field, so "Use table at cursor" reaches all 21
   * statistics calculators rather than the ten whose field is a plain list.
   */
  table?: TableShape;
}

export interface StatCalcDef {
  id: string;
  name: string;
  fields: StatFieldDef[];
  compute: (read: (k: string) => string) => StatOutput;
}
