// Test helper (meshBoolean.test.ts): the REAL geometry engine, run as a child process because manifold-3d is ESM-only
// and jest runs CommonJS. Reads { op, a, b } (EngineMesh: positions, triangles) as JSON on stdin and prints what the
// pane's engine (src/taskpane/manifoldEngine.ts) returns, with the same refusals.
import Module from "manifold-3d";

const input = JSON.parse(await new Promise((res) => {
  let s = "";
  process.stdin.on("data", (c) => (s += c)).on("end", () => res(s));
}));
const wasm = await Module();
wasm.setup();
const { Manifold, Mesh } = wasm;
const read = (m) => new Manifold(new Mesh({ numProp: 3, vertProperties: Float32Array.from(m.positions), triVerts: Uint32Array.from(m.triangles) }));
let out;
try {
  let A, B;
  try {
    A = read(input.a);
    B = read(input.b);
  } catch {
    out = { ok: false, reason: "a part is not a closed solid the engine can read (its surface has gaps or overlaps)" };
  }
  if (!out) {
    const R = input.op === "union" ? A.add(B) : input.op === "subtract" ? A.subtract(B) : A.intersect(B);
    if (R.isEmpty()) out = { ok: false, reason: "nothing is left (the parts do not overlap, or the cut removes all of it)" };
    else {
      const pieces = R.decompose().length;
      const m = R.getMesh();
      const positions = [];
      for (let v = 0; v < m.vertProperties.length; v += m.numProp) positions.push(m.vertProperties[v], m.vertProperties[v + 1], m.vertProperties[v + 2]);
      out = { ok: true, result: { positions, triangles: Array.from(m.triVerts) }, pieces };
    }
  }
} catch (e) {
  out = { ok: false, reason: String(e && e.message) };
}
process.stdout.write(JSON.stringify(out));
