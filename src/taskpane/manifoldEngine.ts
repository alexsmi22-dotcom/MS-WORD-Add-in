/**
 * The geometry engine for combining parts (docs/SCOPE-MESH-BOOLEANS.md): Manifold 3.5.4 (Apache-2.0), WebAssembly,
 * loaded on first use — nobody who never combines parts downloads it. Copied into dist unbundled (see below) and
 * precached with every other file, so it works offline.
 */
import type { BoolEngine, BoolOp, EngineMesh } from "../lib/meshBoolean";

export const MANIFOLD_VERSION = "3.5.4";

interface ManifoldLike {
  add(o: ManifoldLike): ManifoldLike;
  subtract(o: ManifoldLike): ManifoldLike;
  intersect(o: ManifoldLike): ManifoldLike;
  isEmpty(): boolean;
  decompose(): ManifoldLike[];
  getMesh(): { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array };
  delete(): void;
}

let loading: Promise<BoolEngine> | null = null;

/** The engine, loaded once (a failed load is tried again next time). */
export function loadManifoldEngine(): Promise<BoolEngine> {
  if (loading) return loading;
  loading = (async (): Promise<BoolEngine> => {
    // NOT bundled: the published Emscripten file is shipped as it is (webpack would rewrite it, and emit its wasm a second
    // time under a hashed name). Copied into dist (webpack.config.js; the build minifies it like every script, nothing
    // else) and loaded from there; manifold.js finds
    // its wasm beside itself. Both are precached.
    const url = new URL("manifold.js", document.baseURI).href;
    const mod = (await import(/* webpackIgnore: true */ url)) as { default: (o?: object) => Promise<unknown> };
    const wasm = (await mod.default()) as { setup(): void };
    wasm.setup();
    const { Manifold, Mesh } = wasm as unknown as {
      Manifold: new (m: unknown) => ManifoldLike;
      Mesh: new (o: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array }) => unknown;
    };
    const read = (m: EngineMesh): ManifoldLike =>
      new Manifold(new Mesh({ numProp: 3, vertProperties: Float32Array.from(m.positions), triVerts: Uint32Array.from(m.triangles) }));
    return {
      version: MANIFOLD_VERSION,
      run(op: BoolOp, a: EngineMesh, b: EngineMesh) {
        const made: ManifoldLike[] = [];
        try {
          let A: ManifoldLike, B: ManifoldLike;
          try {
            A = read(a);
            made.push(A);
            B = read(b);
            made.push(B);
          } catch (e) {
            // The engine's own word for it ("Not manifold" for a surface with gaps) is kept: it names the problem.
            const why = e instanceof Error ? e.message : String(e);
            return { ok: false as const, reason: `a part is not a closed solid the engine can read (${why})` };
          }
          const R = op === "union" ? A.add(B) : op === "subtract" ? A.subtract(B) : A.intersect(B);
          made.push(R);
          if (R.isEmpty()) return { ok: false as const, reason: "nothing is left (the parts do not overlap, or the cut removes all of it)" };
          const parts = R.decompose();
          made.push(...parts);
          const out = R.getMesh();
          const np = out.numProp;
          const positions = new Float64Array((out.vertProperties.length / np) * 3);
          for (let v = 0, w = 0; v < out.vertProperties.length; v += np, w += 3) {
            positions[w] = out.vertProperties[v];
            positions[w + 1] = out.vertProperties[v + 1];
            positions[w + 2] = out.vertProperties[v + 2];
          }
          return { ok: true as const, result: { positions, triangles: out.triVerts }, pieces: parts.length };
        } finally {
          // Emscripten objects are freed by hand, or each combination leaks its meshes into the wasm heap.
          for (const m of made) m.delete();
        }
      },
    };
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
