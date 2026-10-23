/**
 * Where small marks beside an atom are drawn — shared by the renderer (cdxmlRender) and the mechanism-arrow planner
 * (cdxArrows), so an arrow is kept off exactly the ink that is drawn.
 */
import type { Box, CdxNode, CdxStyle, Pt } from "./cdxml";

/**
 * Where an atom's charge is set when no symbol on the page draws it (a superscript after the label, or up and right of a
 * bare vertex), and the box its ink takes: shared with the mechanism-arrow planner, which keeps arrows off it.
 */
export function chargeGlyph(st: CdxStyle, nd: Pick<CdxNode, "charge" | "label" | "p">): { at: Pt; txt: string; size: number; box: Box } {
  const q = nd.charge, txt = (Math.abs(q) > 1 ? String(Math.abs(q)) : "") + (q > 0 ? "+" : "−");
  const size = st.labelSize * 0.75;
  const bx = nd.label?.box;
  const at: Pt = bx ? [bx[2] + size * 0.35, bx[1] + size * 0.6] : [nd.p[0] + st.bondLength * 0.25, nd.p[1] - st.bondLength * 0.2];
  // Arial's + and − (0.584 em wide), digits 0.556 em; cap height above the baseline, nothing below it.
  const w = [...txt].reduce((sum, ch) => sum + (/\d/.test(ch) ? 0.556 : 0.584), 0) * size;
  return { at, txt, size, box: [at[0], at[1] - size * 0.72, at[0] + w, at[1] + size * 0.05] };
}

/** The dots of a radical drawn above an atom (its label): their box. */
export function radicalBox(st: CdxStyle, nd: Pick<CdxNode, "label" | "p">, kind: string): Box {
  const bx = nd.label?.box;
  const r = st.labelSize * 0.09;
  const cx = bx ? (bx[0] + bx[2]) / 2 : nd.p[0];
  const cy = (bx ? bx[1] : nd.p[1] - st.labelSize * 0.3) - r * 2.5;
  const half = kind === "Doublet" ? r : r * 2.8;
  return [cx - half, cy - r, cx + half, cy + r];
}
