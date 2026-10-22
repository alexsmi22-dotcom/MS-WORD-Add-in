/* eslint-disable no-undef */
// The STEP / IGES reader's worker (src/taskpane/stepEngine.ts starts it, one per file, and ends it after): OpenCascade
// (occt-import-js 0.0.23, LGPL-2.1 — shipped unmodified beside this file, docs/SCOPE-STEP-IMPORT.md) reads the file
// in millimetres, and the answer goes back as typed arrays (an assembly's plain-array copy would double the memory).
importScripts("occt-import-js.js");

self.onmessage = async (ev) => {
  try {
    const occt = await occtimportjs({ locateFile: (p) => p, print: () => {}, printErr: () => {} });
    const r = occt.ReadFile(ev.data.format, ev.data.bytes, { linearUnit: "millimeter" });
    if (!r || !r.success) {
      self.postMessage({ ok: true, result: { success: false } });
      return;
    }
    const transfer = [];
    const meshes = (r.meshes || []).map((m) => {
      const pos = Float32Array.from((m.attributes && m.attributes.position && m.attributes.position.array) || []);
      const idx = Uint32Array.from((m.index && m.index.array) || []);
      transfer.push(pos.buffer, idx.buffer);
      return {
        name: m.name,
        attributes: { position: { array: pos } },
        index: { array: idx },
        brep_faces: (m.brep_faces || []).map((f) => ({ first: f.first, last: f.last })),
      };
    });
    self.postMessage({ ok: true, result: { success: true, meshes } }, transfer);
  } catch (e) {
    self.postMessage({ ok: false, reason: String((e && e.message) || "an internal error") });
  }
};
