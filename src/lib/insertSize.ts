/**
 * The size a drawing goes into Word at: the page (6.5 × 9 in of a Word page), the floor below which a drawing
 * is too small to read, and the USPTO lettering rule (37 CFR 1.84(p)(3)) for canvas inserts.
 */

/** Room on a Word page for a picture: 6.5 × 9 in, in points. */
export const PAGE_PT = { w: 468, h: 648 };
/** Below this fraction of ChemDraw's size a structure is too small to read: refused, not shrunk. */
export const MIN_FIT = 0.25;

/**
 * The size a drawing goes into Word at under the USPTO's figure rule (37 CFR 1.84(p)(3): letters at least
 * 0.32 cm high; `requiredPt` is the font size whose capitals clear it with the style's margin): enlarged
 * until its smallest lettering (`smallestPt`, as drawn) reaches it, never reduced; one too large for the
 * page at that size is refused by name, never shrunk below the rule.
 */
export function usptoInsertSize(widthPt: number, heightPt: number, smallestPt: number | null, requiredPt: number): { ok: true; k: number; widthPt: number; heightPt: number; note: string } | { ok: false; reason: string } {
  const lettered = !!smallestPt && smallestPt > 0;
  const need = lettered ? requiredPt / smallestPt! : 0; // the least factor that keeps the letters at the minimum
  const page = Math.min(PAGE_PT.w / widthPt, PAGE_PT.h / heightPt); // the largest factor that fits the page
  const fit = Math.min(1, page); // ChemDraw's size, reduced to the page
  if (need > page * (1 + 1e-9)) {
    const w = widthPt * need, h = heightPt * need;
    return { ok: false, reason: `with its letters at the USPTO's 1/8-inch minimum it would be ${(w / 72).toFixed(1)} × ${(h / 72).toFixed(1)} in, larger than the page — insert fewer structures (Select, then Insert selected), or split it into figures` };
  }
  const k = Math.max(need, fit);
  const pct = Math.round(k * 100);
  // Reduced past a quarter, its lines and spacing are too small to read whatever its letters (chemdrawFit's floor).
  if (k < MIN_FIT)
    return { ok: false, reason: `that is ${(widthPt / 72).toFixed(1)} × ${(heightPt / 72).toFixed(1)} in — on a page it would be drawn at ${k < 0.01 ? "under 1" : Math.floor(k * 100)} %, too small to read. Select fewer structures (click one, Shift+click to add)` };
  const note = !lettered
    ? pct < 100 ? `Reduced to ${pct} % to fit the page.` : ""
    : pct > 100 ? `Enlarged ${pct} % so its letters meet the USPTO's 1/8-inch minimum (37 CFR 1.84(p)(3)).`
    : pct < 100 ? `Reduced to ${pct} % to fit the page; its letters still meet the USPTO's 1/8-inch minimum.`
    : "Its letters already meet the USPTO's 1/8-inch minimum.";
  return { ok: true, k, widthPt: widthPt * k, heightPt: heightPt * k, note };
}

/** The two sizes a canvas drawing can go into Word at (the pane's choice; ChemDraw's is the default). */
export type CanvasInsertMode = "chemdraw" | "uspto";

/**
 * The size a canvas drawing goes into Word at. "chemdraw": as drawn (ChemDraw's size), reduced only to fit
 * the page, and told when its letters fall under the USPTO minimum. "uspto": usptoInsertSize. (A user found
 * USPTO-size inserts of every structure "so big": a drawing for a filing is the exception, not the rule.)
 */
export function canvasInsertFit(mode: CanvasInsertMode, widthPt: number, heightPt: number, smallestPt: number | null, requiredPt: number): { ok: true; k: number; widthPt: number; heightPt: number; note: string } | { ok: false; reason: string } {
  if (mode === "uspto") return usptoInsertSize(widthPt, heightPt, smallestPt, requiredPt);
  const f = chemdrawFit(widthPt, heightPt);
  if (!f.ok) return f;
  const letters = smallestPt && smallestPt > 0 ? smallestPt * f.k : 0;
  const small = letters > 0 && letters < requiredPt * (1 - 1e-9) ? ` Its smallest letters are ${letters.toFixed(1)} pt, under the USPTO's 1/8-inch minimum — for a filing figure choose “USPTO drawing sheet size”.` : "";
  return { ok: true, k: f.k, widthPt: widthPt * f.k, heightPt: heightPt * f.k, note: f.note + small };
}

/** How a set of objects goes into Word: the factor that fits it on the page (1 = ChemDraw's size), or a refusal. */
export function chemdrawFit(widthPt: number, heightPt: number): { ok: true; k: number; note: string } | { ok: false; reason: string } {
  const k = Math.min(1, PAGE_PT.w / widthPt, PAGE_PT.h / heightPt);
  if (k < MIN_FIT) {
    return {
      ok: false,
      reason: `that is ${(widthPt / 72).toFixed(1)} × ${(heightPt / 72).toFixed(1)} in — on a page it would be drawn at ${k < 0.01 ? "under 1" : Math.floor(k * 100)} %, too small to read. Select fewer structures (click one, Shift+click to add)`,
    };
  }
  return { ok: true, k, note: k < 1 ? `It is inserted at ${Math.round(k * 100)} % to fit the page.` : "It is inserted at ChemDraw's size." };
}
