/**
 * A combined part's result, computed by the engine and cached (docs/SCOPE-MESH-BOOLEANS.md). Kept apart from
 * cadShapes (the recipe) and meshBoolean (the geometry) so neither imports the other.
 */
import { combinedFor, meshFor, rememberCombined } from "./cadMeshStore";
import { apply3, mul3, rotationMatrix, type Placement, type SolidMesh } from "./cadModel";
import { combineHeight, combineKey, MAX_COMBINE_DEPTH, type CadPart } from "./cadShapes";
import { combineMeshes, rotationDeg, type BoolEngine, type BoolOp } from "./meshBoolean";

/** An operand's drawable body where the recipe puts it (an imported file's, or an earlier combination's). */
function operandBody(engine: BoolEngine, q: CadPart): { ok: true; mesh: SolidMesh; creaseDeg: number } | { ok: false; reason: string } {
  if (q.shape === "mesh" && q.mesh) {
    const r = meshFor(q.mesh);
    return r.ok ? { ok: true, mesh: r.mesh, creaseDeg: q.mesh.creaseDeg } : { ok: false, reason: `${q.name}: ${r.reason}` };
  }
  if (q.shape === "combine" && q.combine) {
    const r = ensureCombined(engine, q);
    return r.ok ? { ok: true, mesh: r.mesh, creaseDeg: r.creaseDeg } : r;
  }
  return { ok: false, reason: `${q.name} is not an imported or combined part (only those can be combined yet)` };
}

/**
 * The result of a combined part, from the cache or computed now (its operands first, recursively) and cached under
 * combineKey. The engine is synchronous once loaded; loading it is the pane's (asynchronous) business.
 */
export function ensureCombined(
  engine: BoolEngine,
  part: CadPart,
): { ok: true; mesh: SolidMesh; creaseDeg: number; notes: string[] } | { ok: false; reason: string } {
  const [a, b] = part.combine!.operands;
  const A = operandBody(engine, a);
  if (!A.ok) return A;
  const B = operandBody(engine, b);
  if (!B.ok) return B;
  // The finer of the two edge angles: an edge either part drew is drawn on the result too.
  const creaseDeg = Math.min(A.creaseDeg, B.creaseDeg);
  const key = combineKey(part);
  const had = combinedFor(key);
  if (had) return { ok: true, mesh: had.mesh, creaseDeg, notes: had.notes };
  const r = combineMeshes(engine, part.combine!.op, { mesh: A.mesh, placement: a.placement }, { mesh: B.mesh, placement: b.placement }, creaseDeg);
  if (!r.ok) return { ok: false, reason: `${part.name}: ${r.reason}` };
  rememberCombined(key, { mesh: r.mesh, notes: r.notes });
  return { ok: true, mesh: r.mesh, creaseDeg, notes: r.notes };
}

/**
 * A new combined part from two parts of the drawing: the recipe, with the result computed and placed where the
 * operands were (the result's lowest corner). The caller moves the operands' callouts and exploded offsets to it.
 */
export function combineTwo(
  engine: BoolEngine,
  op: BoolOp,
  a: CadPart,
  b: CadPart,
  id: string,
  name: string,
): { ok: true; part: CadPart; notes: string[] } | { ok: false; reason: string } {
  // A drawing nested deeper than it can be read back would never reopen (review: five joins in a row did that).
  if (1 + Math.max(combineHeight(a), combineHeight(b)) > MAX_COMBINE_DEPTH) {
    return { ok: false, reason: `a combined part can hold at most ${MAX_COMBINE_DEPTH} combinations one inside another (Separate one first)` };
  }
  const part: CadPart = { id, name, shape: "combine", params: {}, placement: { translate: [0, 0, 0], rotateDeg: [0, 0, 0] }, combine: { op, operands: [a, b], at: [0, 0, 0] } };
  const A = operandBody(engine, a);
  if (!A.ok) return A;
  const B = operandBody(engine, b);
  if (!B.ok) return B;
  const creaseDeg = Math.min(A.creaseDeg, B.creaseDeg);
  const r = combineMeshes(engine, op, { mesh: A.mesh, placement: a.placement }, { mesh: B.mesh, placement: b.placement }, creaseDeg);
  if (!r.ok) return r;
  rememberCombined(combineKey(part), { mesh: r.mesh, notes: r.notes });
  const placed: Placement = r.placement;
  // Where the result was when it was made: Separate carries any later move or turn of it onto the operands.
  return { ok: true, part: { ...part, placement: placed, combine: { op, operands: [a, b], at: [...placed.translate] } }, notes: r.notes };
}

/**
 * A combined part's operands as Separate puts them back: moved and turned as the combined part has been since it was
 * made (world = R·(w₀ − at) + T), so they stay where the combined part is drawn — review: they jumped back to where
 * they were combined, and the callouts moved onto them pointed at nothing. Copies; the recipe is left as it is.
 */
export function separatedOperands(p: CadPart): [CadPart, CadPart] {
  const [a, b] = p.combine!.operands;
  const at = p.combine!.at;
  const R = rotationMatrix(p.placement.rotateDeg), T = p.placement.translate;
  const turned = p.placement.rotateDeg.some((d) => d !== 0);
  const carry = (q: CadPart): CadPart => {
    const d = apply3(R, [q.placement.translate[0] - at[0], q.placement.translate[1] - at[1], q.placement.translate[2] - at[2]]);
    const translate: [number, number, number] = [d[0] + T[0], d[1] + T[1], d[2] + T[2]];
    const rotateDeg = turned ? rotationDeg(mul3(R, rotationMatrix(q.placement.rotateDeg))) : q.placement.rotateDeg;
    return { ...q, placement: { translate, rotateDeg: [rotateDeg[0], rotateDeg[1], rotateDeg[2]] } };
  };
  return [carry(a), carry(b)];
}
