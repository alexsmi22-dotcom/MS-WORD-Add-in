/**
 * The Engineering calculator contract, shared by the pane's own registry and every library registry
 * (src/lib/*Calcs.ts) spread into it. Registries written before this module declare the same shape locally
 * (structurally identical); new ones import it, so a shape change is a type error at its source rather than at
 * integration.
 *
 * Release E (2026-10-23) added three things a result may carry, all optional so every existing tool still fits:
 *   - `outputs` on the result (analyzeBlocks.ts EngOutput): its headline numbers by name, with the unit they are
 *     displayed in. A parameter sweep or an uncertainty run reads THESE, never the result text — a number scraped
 *     from prose is a remark, not a measurement.
 *   - a `table` block (analyzeBlocks.ts): rows of text, the first a header, inserted as a real Word table.
 *   - the governing formula as a `math` line (engReport's { math, fallback }), inserted as a real Word equation.
 */
import type { AnalyzeOutput } from "./analyzeBlocks";

/** One input field, exactly as the pane renders it. */
export interface EngField {
  key: string;
  label: string;
  default: string;
  kind: "block" | "text" | "select";
  rows?: number;
  options?: { value: string; label: string }[];
}

/**
 * How a tool reads the numbers typed into it — declared, because a declaration nobody checks enforces nothing
 * (engineeringSpreadContract.test.ts checks it):
 *   - "converts": every dimensional field goes through the unit layer (parseMeasured / units.ts): "3 in" is metres.
 *   - "same-units": dimensionally homogeneous — any consistent unit system, nothing converts.
 *   - "exact": exact rational arithmetic over plain numbers.
 *   - "spice": SPICE value suffixes (1k, 10u, 2meg) as a circuit netlist writes them.
 *   - "domain": the field's own stated unit only (bp, minutes, dB …); a unit typed after a number is refused.
 */
export type EngUnitContract = "converts" | "same-units" | "exact" | "spice" | "domain";

/** One Engineering calculator. `G` narrows the group to the headings a registry uses. */
export interface EngCalcDef<G extends string = string> {
  id: string;
  /** The dropdown label; it does not repeat the group heading. */
  name: string;
  group: G;
  hint: string;
  fields: EngField[];
  /** The unit contract this tool keeps (see EngUnitContract). */
  unitContract: EngUnitContract;
  compute: (read: (k: string) => string) => AnalyzeOutput;
}
