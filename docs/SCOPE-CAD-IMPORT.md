# CAD import — scope (R3)

_User, 2026-10-18: "we use solid edge for most drawings and i want to be able to move from it to jurislab" … "yes, we would want the ability to import solid edge and cad files"._

## What can be read, and what cannot

| File | Read? | Route |
|---|---|---|
| Solid Edge draft `.dft` | **No**: only Solid Edge reads it | In Solid Edge: **Save As → DXF**, then import the `.dxf` |
| Solid Edge part / sheet metal / assembly `.par` `.psm` `.asm` | **No**: Parasolid-based, only Solid Edge reads it | In Solid Edge: **Save As → STEP** (`.stp`), then import |
| DWG | **No**: closed format; the only open reader (LibreDWG) is GPL-3 | Save as **DXF** |
| DXF, ASCII, R12–2018 | **R3a** | Import as a **drawing**, or as an editable **sketch** |
| Binary DXF | No | Save as ASCII DXF, which is the default |
| STEP / IGES | **R3b** (planned) | OpenCascade's importer compiled to WebAssembly (occt-import-js, LGPL-2.1), loaded only when needed. To verify first: its `.wasm` size, licence file and offline precache |
| STL | R3b (planned) | A mesh. Curved silhouettes need feature edges, found by dihedral angle |

Solid Edge's export lists (ST5 help): drafts go to IGES, DGN, DWG, DXF and PDF; parts and assemblies go to IGES, SAT, STEP, STL, Parasolid (x_t/x_b), PLMXML and JT.

Each refusal names the file and gives the route above (`importRefusal` in `src/lib/dxf.ts`).

## R3a — DXF

A Solid Edge draft saved as DXF is a whole sheet: several views, dimensions, notes, a border and often hatching. It is rarely one closed profile, so:

- **As a drawing (the main path).** Drawn at its true size as SVG and inserted into Word, fitted to the page with the scale explained, as engineering sheets are. The figure is not re-editable from the picture, and the status says so. A large draft cannot ride in the alt text, whose limit is unmeasured (TEST-SCRIPT §0cl).
- **As a sketch.** Lines, arcs and circles become editable sketch geometry, for a single profile or a flat pattern (Solid Edge's Save as Flat → DXF). Refused by name for ellipses and splines, and past the sketch's 150 points.

### Reader (`src/lib/dxf.ts`)

- OCS by the Arbitrary Axis Algorithm. Extrusion (0, 0, −1) is a mirror. Entities off the drawing plane are skipped, by count.
- Blocks are exploded recursively, including scale, rotation, per-axis mirror, arrays and attributes, to a depth cap of 16. A mirror reverses arcs. An uneven scale flattens an arc, with a note. DIMENSION draws its own block.
- Model space is read when it draws anything, otherwise paper space; a note says which.
- Units come from `$INSUNITS`. When it is absent or 0 the units are unknown, and the user chooses them; mm is never assumed.
- Text: `%%c` → Ø, `%%d` → °, `%%p` → ±, `\U+XXXX`, and MTEXT codes stripped to the words. Pre-2007 files are decoded by `$DWGCODEPAGE`, later ones as UTF-8.
- Polylines: bulge = tan(θ/4), positive = counter-clockwise, closed flag 70&1. Polyface meshes and 3D polylines are refused by count.
- ELLIPSE and SPLINE are flattened to within 0.01 % of the drawing's size, with a note. Control-point splines use de Boor (rational). Fit-point splines use the cubic CAD programs draw: chord-length parameters, natural ends or the stored end tangents.
- The file's own line-type patterns (LTYPE, `$LTSCALE`, entity scale) and line weights (370) are kept. A line with no weight is drawn at 0.25 mm (PRODUCT).
- Not drawn, each named with its count: HATCH, POINT, images and OLE objects, 3D solids, off or frozen layers, missing blocks.
- Caps: 30 MB, 200 000 items after expansion, depth 16, arrays of 10 000 copies. A file past them is refused rather than freezing Word.

**Oracle.** ezdxf (MIT) writes the fixtures (`src/lib/__tests__/fixtures/dxf`, kept byte-exact with CRLF line endings), and its own reading of each is the expected value:
- extents after expanding every block;
- arcs in world coordinates;
- 200 samples of a spline and 64 of an ellipse, which must lie within 0.02 mm of the drawn curve.

**Still to validate:** real Solid Edge exports. The user has been asked for a typical draft saved as DXF, and a part as STEP and STL.

## R3b — 3D (planned)

STEP / IGES through occt-import-js: tessellated to the mesh the hidden-line engine already draws. STL directly. Decide first: wasm size, licence text shipped, offline behaviour (precache, or refuse by name when offline).
