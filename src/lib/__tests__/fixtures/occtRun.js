// The real STEP reader for the tests, in a child process (it takes ~190 MB and 7.6 MB of WebAssembly; QC memory):
// stdin { format, base64 } → stdout the engine's answer, reduced as src/taskpane/stepWorker.js reduces it (plain
// arrays here — JSON).
const occtimportjs = require("occt-import-js");

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", async () => {
  const { format, base64 } = JSON.parse(input);
  const occt = await occtimportjs({ print: () => {}, printErr: () => {} }); // its diagnostics would land in the JSON
  const r = occt.ReadFile(format, new Uint8Array(Buffer.from(base64, "base64")), { linearUnit: "millimeter" });
  if (!r || !r.success) {
    process.stdout.write(JSON.stringify({ success: false }));
    return;
  }
  const meshes = r.meshes.map((m) => ({
    name: m.name,
    // Float32, as the worker sends them.
    attributes: { position: { array: Array.from(Float32Array.from(m.attributes.position.array)) } },
    index: { array: Array.from(m.index.array) },
    brep_faces: m.brep_faces.map((f) => ({ first: f.first, last: f.last })),
  }));
  process.stdout.write(JSON.stringify({ success: true, meshes }));
});
