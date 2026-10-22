# STEP and IGES import — scope

_User, 2026-10-21: "go for step import" — after the measurement (occt-import-js 0.0.23: 7.6 MB wasm, 3.1 MB
gzip, LGPL-2.1, ~0.3 s an assembly, ~190 MB while reading)._ Solid Edge parts and assemblies reach JurisLab by
**Save As → STEP**; native `.par` `.psm` `.asm` stay unreadable outside Solid Edge (docs/SCOPE-CAD-IMPORT.md).

## What it does

- **Import DXF / STL / OBJ / STEP…** reads `.stp` `.step` `.igs` `.iges`. Each solid body becomes a part, named from
  the file (repeats numbered: nut 1, nut 2…; a body with no name, or "(Unsaved)", takes the file's name).
- **Units are the file's**: the reader is asked for millimetres and converts from what the file declares (inch,
  metre and millimetre fixtures give the same part). No units chooser.
- **An assembly keeps its shape**: every body where the file puts it, the whole set moved as one beside the drawing's
  parts.
- **Edges are the model's own**: an edge where two B-rep faces meet as a crease, never inside a face, never along a
  split of one surface (Parasolid — Solid Edge's kernel — writes a cylinder as two half-faces) — a cylinder has its
  two circles and no facet lines or seam. A **tangent** boundary (a rounded face running on into a flat one) is drawn
  or not as the user chooses (Draw tangent edges, on by default; per part in its editor).
- How two faces meet is judged **from the facets** (`stl.ts`), not from the engine's corner normals — those are
  averaged over each face's facets, several degrees off the surface at a boundary (first review: a fixed 3° limit drew
  every split cylinder and hid no fillet). Per connected CHAIN of shared sides (second review: decided side by side, a
  circle came out dashed; third review: one verdict per face pair mixed a tangent boundary with a crease): d = the
  median turn across the chain (a tie toward the crease); each face's bend = its median turn to same-face facets
  sharing a corner, counting only rotation ABOUT the side's direction (a cylinder turns about its axis — none across
  its rim; never through a pole of the face). d ≤ 1.25·max bend + 1° is smooth: a SPLIT when the bends are alike
  (both curved, min ≥ ½·max, or both flat) — never drawn — else a TANGENT edge; otherwise a crease.
- The drawing stores only the file's record (name, fingerprint, body index, facets, size, tangent choice), never
  triangles — a re-opened drawing asks for the file, and importing the same bytes puts every part back (inside
  combined parts too). STEP parts combine, section and draw like STL parts.

## How

- `src/taskpane/stepEngine.ts` starts a **Web Worker** per file (`dist/engines/occt-0.0.23/step-worker.js`, ours),
  which loads OpenCascade's published `occt-import-js.js` + `.wasm` **unmodified** (copied with `minimized` so the
  minifier leaves them alone) and returns typed arrays; the worker is ended after each file (its memory goes with
  it); 2 minutes and it is stopped, by name.
- `src/lib/step.ts` reads the answer field by field into StlFacets per body, plus `faceOf` (each triangle's face). Limits: 60 MB file, 200 bodies, 100,000 facets over all bodies.
- `src/lib/stl.ts` `stlBody`: with `faceOf`, edges are creases between faces (tangent ones only when asked); smoothing
  stays inside a face and across splits and hidden tangent boundaries, so hidden lines and silhouettes follow the true
  surfaces.
- One reader at a time (a pick while one reads is refused by name); an answer that arrives after a newer pick or
  Close is dropped; one that arrives mid-insert is refused.
- `src/lib/cadMeshStore.ts`: `MeshRef.body` / `MeshRef.tangent`; a body's facets are kept as `hash#k`; spare
  files are counted per FILE (an 18-body assembly is one file).

## Delivery (offline)

Not precached: the precache is fetched again in full by every release, and 7.6 MB each time would be a cost on every
update. Instead the service worker answers `engines/…` files **cache-first from their own cache**
(`jurislab-engines`, outside the release sweep): fetched the first time a STEP file is opened, kept across releases
(the folder carries the engine's version, so a new engine is a new URL and the old one is swept). Offline before the
first STEP file, the import says so by name.

## Licence

LGPL-2.1 (OCCT: LGPL-2.1 + Open CASCADE exception). Used unmodified, shipped as separate replaceable files with both
licence texts beside them; THIRD_PARTY_LICENSES.md names the source. JurisLab stays MIT.

## Tests

- `src/lib/__tests__/stepImport.test.ts` — the REAL reader in a child process (`fixtures/occtRun.js`) on STEP files
  written by `fixtures/stepFixture.ts` (boxes and a cylinder as AP214 B-rep solids; no third-party samples in the
  repo): bodies, names, positions, units, the cylinder's edges, refusals, tangent edges, the store, saved records.
- `src/lib/__tests__/stepImportPane.dom.test.ts` — the pane over its real markup with the real reader behind the
  worker loader: panel, Add N parts, placements, re-open + put back, the part editor.
- Hands-on: the CAx-IF `as1-oc-214` assembly (18 bodies) in the built pane over the real worker — 0.9 s, every part
  in place, no facet lines on bolts, nuts or rod.

**Still to validate:** a real Solid Edge STEP export (asked of the user).
