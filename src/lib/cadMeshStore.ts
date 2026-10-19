/**
 * Imported STL parts (R3b). A drawing names an imported part's file — its name, a fingerprint of
 * its bytes, its units and edge angle — and never carries the triangles themselves: the model goes
 * into the picture's alt text, to the large canvas and onto the undo stack as JSON, and a part of
 * 100 000 facets would be megabytes in each. The facets are kept here, for this session, by the
 * fingerprint. A drawing re-opened in a later session names the file to import again, and only
 * the same bytes put it back.
 */
import type { SolidMesh, Vec3 } from "./cadModel";
import { STL_LIMITS, StlFacets, stlBody } from "./stl";

/** An imported part's file, as the drawing records it. */
export interface MeshRef {
  /** The file's name, as picked. */
  file: string;
  /** stlHash of its bytes. */
  hash: string;
  /** Facets read from it. */
  facets: number;
  /** Millimetres per file unit (STL files carry no units: the user chose them). */
  mmPerUnit: number;
  /** Facets meeting at more than this are drawn as an edge. */
  creaseDeg: number;
  /** Size along X, Y, Z in mm, when imported (for the parts list while the file is not open). */
  size: Vec3;
}

const files = new Map<string, StlFacets>();
/** Bodies built for a units / edge-angle pair; the last few only (each is several MB). */
const bodies = new Map<string, SolidMesh>();
const BODY_CACHE = 4;

export function rememberStl(hash: string, stl: StlFacets): void {
  files.set(hash, stl);
}

export function hasStl(hash: string): boolean {
  return files.has(hash);
}

/** The body for an imported part, or why it cannot be drawn (no file name: the caller adds the part's). */
export function meshFor(ref: MeshRef): { ok: true; mesh: SolidMesh } | { ok: false; reason: string } {
  const stl = files.get(ref.hash);
  if (!stl) return { ok: false, reason: `its file ${ref.file} is not open — import ${ref.file} again (Import DXF / STL…) to put it back` };
  const key = `${ref.hash}|${ref.mmPerUnit}|${ref.creaseDeg}`;
  const had = bodies.get(key);
  if (had) {
    bodies.delete(key); // most recently used last
    bodies.set(key, had);
    return { ok: true, mesh: had };
  }
  const r = stlBody(stl, ref.mmPerUnit, ref.creaseDeg);
  if (!r.ok) return r;
  bodies.set(key, r.body.mesh);
  while (bodies.size > BODY_CACHE) bodies.delete(bodies.keys().next().value as string);
  return { ok: true, mesh: r.body.mesh };
}

/** Is this a well-formed reference (read field by field from a saved drawing)? */
export function isMeshRef(v: unknown): v is MeshRef {
  const r = v as MeshRef;
  const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  return (
    !!r && typeof r === "object" &&
    typeof r.file === "string" && r.file.length > 0 && r.file.length <= 260 &&
    typeof r.hash === "string" && /^[0-9a-f]{16}-\d{1,12}$/.test(r.hash) &&
    num(r.facets) && Number.isInteger(r.facets) && r.facets > 0 && r.facets <= STL_LIMITS.facets &&
    num(r.mmPerUnit) && r.mmPerUnit > 0 && r.mmPerUnit <= 1e6 &&
    num(r.creaseDeg) && r.creaseDeg > 0 && r.creaseDeg < 180 &&
    Array.isArray(r.size) && r.size.length === 3 && r.size.every((x) => num(x) && x >= 0 && x <= 2e6)
  );
}

/** For tests: forget every file. */
export function clearMeshStore(): void {
  files.clear();
  bodies.clear();
}
