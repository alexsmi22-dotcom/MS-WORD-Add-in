/**
 * STEP and IGES parts (docs/SCOPE-STEP-IMPORT.md). The file is read by OpenCascade (occt-import-js, WebAssembly, in a
 * worker the pane starts — taskpane/stepEngine.ts), which hands back each solid body as triangles in millimetres, with
 * the body's name and which B-rep face each triangle belongs to. Here that answer becomes, per body, the same facets an
 * STL gives (stl.ts) — so a STEP part is drawn, sectioned and combined like an imported STL — plus what an STL does
 * not have: the model's faces. An edge is drawn where two faces meet as a crease, never across a face (a cylinder has
 * no facet lines), never along a split of one surface; where a rounded face runs on smoothly into a flat one it is a
 * tangent edge, drawn or not as the user chooses (stl.ts tells them apart from the facets).
 */
import { STL_LIMITS, type StlFacets } from "./stl";

/** What occt-import-js returns (its README), read field by field. */
export interface OcctMesh {
  name?: unknown;
  attributes?: { position?: { array?: unknown }; normal?: { array?: unknown } };
  index?: { array?: unknown };
  brep_faces?: unknown;
}
export interface OcctResult {
  success?: unknown;
  meshes?: unknown;
}

export const STEP_LIMITS = {
  /** File size: an assembly of a few hundred parts is a few MB of text; 60 MB is far past any part a drawing holds. */
  bytes: 60 * 1024 * 1024,
  /** Bodies in one file (each becomes a part in the parts list). */
  bodies: 200,
  /** Facets over all its bodies: one drawing's worth (an imported STL part holds as many). */
  facets: STL_LIMITS.facets,
};

/** The engine's format for a file name, or null when it is neither STEP nor IGES. */
export function stepFormat(name: string): "step" | "iges" | null {
  return /\.(stp|step|p21)$/i.test(name) ? "step" : /\.(igs|iges)$/i.test(name) ? "iges" : null;
}

/** One solid body of the file. */
export interface StepBody {
  /** Its name in the file ("" when it has none). */
  name: string;
  facets: StlFacets;
}

const isNumArray = (a: unknown): a is ArrayLike<number> =>
  (Array.isArray(a) || ArrayBuffer.isView(a)) && Array.prototype.every.call(a, (x: unknown) => typeof x === "number" && Number.isFinite(x));

/**
 * The bodies of an engine answer, or a refusal by name (without the file's name: the caller adds it). A body with no
 * triangles (a wireframe, a point, a curve) is left out and counted.
 */
export function stepBodies(r: OcctResult): { ok: true; bodies: StepBody[]; notes: string[] } | { ok: false; reason: string } {
  if (!r || r.success !== true || !Array.isArray(r.meshes)) return { ok: false, reason: "it could not be read as a STEP or IGES file (it may be damaged, or another format with this extension)" };
  const bodies: StepBody[] = [];
  let empty = 0, total = 0;
  for (const m of r.meshes as OcctMesh[]) {
    const P = m?.attributes?.position?.array, I = m?.index?.array;
    if (!isNumArray(P) || !isNumArray(I) || P.length % 3 || I.length % 3) return { ok: false, reason: "the reader's answer for a body is damaged" };
    const nv = P.length / 3, nt = I.length / 3;
    if (!nt) {
      empty++;
      continue;
    }
    for (let i = 0; i < I.length; i++) if (!Number.isInteger(I[i]) || I[i] < 0 || I[i] >= nv) return { ok: false, reason: "the reader's answer for a body is damaged" };
    total += nt;
    if (total > STEP_LIMITS.facets) {
      return { ok: false, reason: `its bodies have more than ${STEP_LIMITS.facets.toLocaleString("en-US")} facets together — more than one drawing holds; export the parts you need on their own` };
    }
    if (bodies.length >= STEP_LIMITS.bodies) {
      return { ok: false, reason: `it has more than ${STEP_LIMITS.bodies} solid bodies — export the parts you need on their own` };
    }
    const corners = new Float64Array(9 * nt);
    for (let k = 0; k < 3 * nt; k++) for (let d = 0; d < 3; d++) corners[3 * k + d] = P[3 * I[k] + d];
    // Which face each triangle belongs to: the faces' ranges, read with care (a damaged range leaves faces out, and
    // the body is drawn with the facet-angle edges an STL gets).
    let faceOf: Int32Array | undefined = new Int32Array(nt).fill(-1);
    const faces = Array.isArray(m.brep_faces) ? (m.brep_faces as { first?: unknown; last?: unknown }[]) : [];
    faces.forEach((f, id) => {
      const a = f?.first, b = f?.last;
      if (faceOf && Number.isInteger(a) && Number.isInteger(b) && (a as number) >= 0 && (a as number) <= (b as number) && (b as number) < nt) {
        for (let t = a as number; t <= (b as number); t++) faceOf[t] = id;
      }
    });
    if (!faces.length || faceOf.some((f) => f < 0)) faceOf = undefined;
    const name = typeof m.name === "string" ? m.name.trim().slice(0, 120) : "";
    // The worker hands the positions over as float32 (half the memory of the engine's doubles): "binary" is the
    // honest noise model.
    bodies.push({ name, facets: { format: "binary", corners, count: nt, unreadable: 0, ...(faceOf ? { faceOf } : {}) } });
  }
  if (!bodies.length) return { ok: false, reason: "it has no solid bodies (only curves, points or drawings) — export the 3D parts" };
  const notes = empty ? [`${empty} item${empty === 1 ? "" : "s"} with no surface (curves or points) ${empty === 1 ? "was" : "were"} left out.`] : [];
  return { ok: true, bodies, notes };
}

/**
 * The parts' names: the body's own, or the file's when it has none; repeats numbered ("nut 1", "nut 2"…), as a parts
 * list can tell them apart.
 */
export function stepPartNames(bodies: StepBody[], file: string): string[] {
  const base = file.replace(/\.[^.]*$/, "") || "part";
  const raw = bodies.map((b) => (b.name && !/^\(?unsaved\)?$/i.test(b.name) ? b.name : base));
  const total = new Map<string, number>();
  for (const n of raw) total.set(n, (total.get(n) ?? 0) + 1);
  const seen = new Map<string, number>();
  // Never two alike (review: "nut", "nut", "nut 1" gave "nut 1" twice): a number already taken is skipped.
  const taken = new Set(raw.filter((n) => total.get(n) === 1));
  return raw.map((n) => {
    if (total.get(n) === 1) return n;
    let k = seen.get(n) ?? 0, name: string;
    do name = `${n} ${++k}`;
    while (taken.has(name));
    seen.set(n, k);
    taken.add(name);
    return name;
  });
}
