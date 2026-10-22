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

/** Bodies a STEP file may hold (step.ts STEP_LIMITS.bodies; not imported, as step.ts imports stl.ts too). */
const STEP_BODIES = 200;

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
  /** A STEP or IGES file (step.ts): which of its solid bodies this part is (the file holds several). */
  body?: number;
  /** A STEP or IGES body: draw its tangent edges (where a fillet meets a flat)? */
  tangent?: boolean;
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
/** Where a part's facets are kept: its file, and for a STEP file its body. */
const fileKey = (r: MeshRef): string => (r.body === undefined ? r.hash : `${r.hash}#${r.body}`);
const keyOf = (r: MeshRef): string => `${fileKey(r)}|${r.mmPerUnit}|${r.creaseDeg}${r.body === undefined ? "" : r.tangent ? "|t" : "|n"}`;

export function rememberStl(hash: string, stl: StlFacets): void {
  touch(files, hash, stl);
}

export function hasStl(hash: string): boolean {
  return files.has(hash);
}

/** Keeps a STEP or IGES file's bodies, in its order (MeshRef.body), by the file's fingerprint. */
export function rememberStep(hash: string, bodies: StlFacets[]): void {
  bodies.forEach((b, k) => touch(files, `${hash}#${k}`, b));
}

/** Is this part's file open (for a STEP part: its body)? */
export function hasMeshFile(ref: MeshRef): boolean {
  return files.has(fileKey(ref));
}

/**
 * Keeps the files and bodies these references name (the drawing's, and its Undo's), and the two
 * others used last of each; forgets the rest. A part never loses its file to a file merely looked at.
 */
export function retainMeshes(refs: MeshRef[]): void {
  const hashes = new Set(refs.map(fileKey)), keys = new Set(refs.map(keyOf));
  // Spares are counted by FILE: a STEP file's bodies (hash#k) go or stay together (an 18-body assembly is one file,
  // not 16 spares too many — review: its third body was dropped before it could be added).
  const fileOf = (k: string): string => k.replace(/[#|].*$/, "");
  const prune = <V>(m: Map<string, V>, keep: (k: string) => boolean): void => {
    const spare = [...m.keys()].filter((k) => !keep(k));
    const files2 = [...new Set(spare.map(fileOf).reverse())].reverse(); // by last use, oldest first
    const kept = new Set(files2.slice(Math.max(0, files2.length - SPARE)));
    // Of a kept file, one body per part (its latest units and edge angle — each angle typed builds one).
    const latest = new Set<string>();
    for (const k of [...spare].reverse()) {
      const part = k.replace(/\|.*$/, "");
      if (!kept.has(fileOf(k)) || latest.has(part)) m.delete(k);
      else latest.add(part);
    }
  };
  prune(files, (k) => hashes.has(k));
  prune(bodies, (k) => keys.has(k));
  for (const k of [...bodies.keys()]) if (!files.has(k.slice(0, k.indexOf("|")))) bodies.delete(k);
  for (const k of [...refused.keys()]) if (!files.has(k.slice(0, k.indexOf("|")))) refused.delete(k);
}

/** The body for an imported part, or why it cannot be drawn (no file name: the caller adds the part's). */
export function meshFor(ref: MeshRef): { ok: true; mesh: SolidMesh } | { ok: false; reason: string } {
  const fk = fileKey(ref);
  const stl = files.get(fk);
  if (!stl) return { ok: false, reason: `its file ${ref.file} is not open — import ${ref.file} again (Import DXF / STL / OBJ / STEP…) to put it back` };
  touch(files, fk, stl);
  const key = keyOf(ref);
  const why = refused.get(key);
  if (why) return { ok: false, reason: why };
  const had = bodies.get(key);
  if (had) {
    touch(bodies, key, had);
    return { ok: true, mesh: had };
  }
  const r = stlBody(stl, ref.mmPerUnit, ref.creaseDeg, { tangentEdges: ref.tangent });
  if (!r.ok) {
    refused.set(key, r.reason);
    return r;
  }
  bodies.set(key, r.body.mesh);
  return { ok: true, mesh: r.body.mesh };
}

/** An imported part's body key: its file, units and edge angle (what a combined part's key is built from). */
export function meshKey(ref: MeshRef): string {
  return keyOf(ref);
}

/**
 * Combined parts' results (docs/SCOPE-MESH-BOOLEANS.md), by combineKey: computed once by the pane's engine, read
 * synchronously when the drawing is rebuilt. Kept like bodies — the drawing's and its Undo's, and two spare.
 */
const combined = new Map<string, { mesh: SolidMesh; notes: string[] }>();

export function rememberCombined(key: string, value: { mesh: SolidMesh; notes: string[] }): void {
  touch(combined, key, value);
}

export function combinedFor(key: string): { mesh: SolidMesh; notes: string[] } | undefined {
  const v = combined.get(key);
  if (v) touch(combined, key, v);
  return v;
}

/** Keeps the combined results these keys name, and two others used last. */
export function retainCombined(keys: string[]): void {
  const keep = new Set(keys);
  const spare = [...combined.keys()].filter((k) => !keep.has(k));
  for (const k of spare.slice(0, Math.max(0, spare.length - SPARE))) combined.delete(k);
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
    Array.isArray(r.size) && r.size.length === 3 && r.size.every((x) => num(x) && x >= 0 && x <= 2e6) &&
    (r.body === undefined || (Number.isInteger(r.body) && r.body >= 0 && r.body < STEP_BODIES)) &&
    (r.tangent === undefined || (r.body !== undefined && typeof r.tangent === "boolean"))
  );
}

