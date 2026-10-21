# Combining imported parts (mesh booleans) — scope

Directive 2026-10-21: "mesh booleans — build". Drawing (CAD): join two imported STL/OBJ parts into one, cut one out of
another, or keep only where they overlap.

## Engine

manifold-3d 3.5.4 (Apache-2.0), exact version, a runtime dependency: `manifold.js` (82 KB) + `manifold.wasm` (541 KB,
204 KB gzipped), loaded on first use (a separate chunk; the wasm copied into `dist` and precached for offline use).
Robust on flush and coplanar contact (measured: two boxes sharing a face union to 12 faces, no internal face; a rod as
tall as the cube cuts a clean through-hole). Measured time: 26 000 triangles 52 ms, 102 000 (the facet limit) 187 ms —
on the main thread, beside the ~2 s the same part already takes from file to sheet.

## Model

A combined part is a RECIPE, never baked triangles: `{ shape: "combine", combine: { op, operands: [A, B] } }`, its
operands nested inside it (imported parts, or earlier combined parts; depth ≤ 4). The drawing travels as JSON in the
alt text, on the undo stack and to the large canvas and must never carry triangles; a recipe over two MeshRefs re-opens
exactly as imported parts do — import the same files again and the same result comes back.

The result is computed when the user clicks Combine and cached in cadMeshStore by a key of both operands (their file
keys, placements, op; not the engine version — the cache lives only as long as the pane, which loads one engine);
docToAssembly reads the cache synchronously. A cache miss (a new
session, the store evicted it) is computed again before the sheet is drawn, or refused by name when an operand's file
is not open — the operands are never drawn as if combined.

The result goes through stlBody at 1 mm per unit (the same welding, crease edges and `closed` flag as an imported
part), its `noise` and `sag` at least the operands'. Placed where the operands were: the combined part's placement is
the result's lowest corner.

Combining moves the operands' callouts and exploded-view offsets to the combined part, and says so; Undo restores them.
The large canvas already refuses drawings with imported parts, so a combined part is refused there by the same rule.

## Refused by name

An open operand ("Not manifold"); a catalogue or sketched part (not yet — their tessellation tolerance is the question);
an empty result (an intersection of parts that do not touch, a cut that removes everything); a union of parts that do
not touch (two pieces, not one part); a result over the facet limit.

## Tests

Volumes against closed forms (cube − 64-gon rod), genus, `closed` on every result; flush/coplanar cases; the recipe
through the alt-text JSON and a fresh session; references moved. Small meshes only (QC memory).
