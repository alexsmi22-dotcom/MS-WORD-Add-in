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

/**
 * The files read this session and the bodies built from them, the most recently used last. What
 * the drawing (or its Undo) names is kept, with the two others used last (retainMeshes); the rest
 * goes, so a session that opens many files does not hold them all (each up to ~7 MB, and a body
 * several more).
 */
const files = new Map<string, StlFacets>();
const bodies = new Map<string, SolidMesh>();
/** A units / edge-angle pair that cannot be drawn, and why (built once, not on every rebuild). */
const refused = new Map<string, string>();
const SPARE = 2;

const touch = <V>(m: Map<string, V>, k: string, v: V): void => {
  m.delete(k);
  m.set(k, v);
};
const keyOf = (r: MeshRef): string => `${r.hash}|${r.mmPerUnit}|${r.creaseDeg}`;

export function rememberStl(hash: string, stl: StlFacets): void {
  touch(files, hash, stl);
}

export function hasStl(hash: string): boolean {
  return files.has(hash);
}

/**
 * Keeps the files and bodies these references name (the drawing's, and its Undo's), and the two
 * others used last of each; forgets the rest. A part never loses its file to a file merely looked at.
 */
export function retainMeshes(refs: MeshRef[]): void {
  const hashes = new Set(refs.map((r) => r.hash)), keys = new Set(refs.map(keyOf));
  const prune = <V>(m: Map<string, V>, keep: (k: string) => boolean): void => {
    const spare = [...m.keys()].filter((k) => !keep(k));
    for (const k of spare.slice(0, Math.max(0, spare.length - SPARE))) m.delete(k);
  };
  prune(files, (k) => hashes.has(k));
  prune(bodies, (k) => keys.has(k));
  for (const k of [...bodies.keys()]) if (!files.has(k.slice(0, k.indexOf("|")))) bodies.delete(k);
  for (const k of [...refused.keys()]) if (!files.has(k.slice(0, k.indexOf("|")))) refused.delete(k);
}

/** The body for an imported part, or why it cannot be drawn (no file name: the caller adds the part's). */
export function meshFor(ref: MeshRef): { ok: true; mesh: SolidMesh } | { ok: false; reason: string } {
  const stl = files.get(ref.hash);
  if (!stl) return { ok: false, reason: `its file ${ref.file} is not open — import ${ref.file} again (Import DXF / STL…) to put it back` };
  touch(files, ref.hash, stl);
  const key = keyOf(ref);
  const why = refused.get(key);
  if (why) return { ok: false, reason: why };
  const had = bodies.get(key);
  if (had) {
    touch(bodies, key, had);
    return { ok: true, mesh: had };
  }
  const r = stlBody(stl, ref.mmPerUnit, ref.creaseDeg);
  if (!r.ok) {
    refused.set(key, r.reason);
    return r;
  }
  bodies.set(key, r.body.mesh);
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

