# Scope: the CAD drawing canvas (hit-list item 15, widened)

_Written 2026-10-17 against `main` at f293329 (v2.146.0). The user queued this ahead of #14 and set the bar the same day:_
- _"i think the drawing canvas has more value"_
- _"the way the 3d and 2d chimical builder is a good foundation to build it. i like the canvas"_
- _"siemans solidedge 2d is something i would like to compete with and giving it the 3d ability and to beable to rotate like the chem does"_
- _"i want this to be able to work with more than just USPTO drawings as Juris Lab is way beyond that now"_

## 0. The product, in one paragraph

A technical-drawing canvas inside Word. It aims to match **Siemens Solid Edge 2D Drafting** on 2D drafting, and to go beyond it with a **3D side you can build and orbit**, the way the chemical builder works. Drawings come out in the standard the document needs:
- **USPTO 1.84** patent sheets;
- **engineering drawings** (ISO 128 / ISO 5456 projection, ASME Y14.2/Y14.3/Y14.5 lines, views and dimensions, title block);
- **journal and technical figures**;
- **plain line art**.

One engine makes every view; the standards differ in line weights, dimensions, labels and sheets, not in what is visible.

### What Solid Edge 2D Drafting is (the bar), and where JurisLab stands

| Solid Edge 2D capability | Plan here |
|---|---|
| Sketch geometry: lines, arcs, circles, rectangles, polygons, fillets, chamfers, offset, trim/extend, mirror, pattern | 2D drafting release (R2) |
| Geometric relationships (coincident, horizontal/vertical, parallel, perpendicular, tangent, equal, concentric, fix) and **driving dimensions**: change a number and the drawing updates | R2. A 2D constraint solver in `src/lib`, with every solve verified and every over- or under-constrained sketch reported by name |
| Dimensions and annotation: linear/angular/radial/diameter, tolerances, text, leaders, balloons, symbols (surface finish, GD&T frames), hatching and fills | R2, then R3 for GD&T |
| Drawing standards: ISO / ANSI line types, layers, dimension styles, sheet sizes and borders, title blocks | R2. The standard is a style object, like the v2.143 figure presets |
| DXF / DWG exchange | DXF read/write in R3 (an open text format). DWG is a closed binary format and stays out; we say so |
| **No 3D** (that is Solid Edge's paid product) | **The difference.** Build solids from sketches (extrude, revolve), orbit them, and generate projected, isometric and section views with hidden lines from the same model (R1) |

## What the user asked for, and what that means

The original request (2026-10-15) was "it would be great to be able to create patent drawings, like a line drawing on a 3d object". It grew out of an earlier request for "a mechanical structure builder like the chemical one / AutoCAD built in". Today the user said where to start: **the canvas, built the way the 2D and 3D chemical builders are built.**

So the first release is a **build-in-the-pane mechanical canvas** that produces USPTO 37 CFR 1.84 line drawings. Importing a CAD part (STL/OBJ) comes later, as a second way to get a solid into the same drawing engine.

**It is NOT** CAD. There is no constraint solver, no history tree, no fillets on arbitrary edges, and no free-form surfaces. It IS enough to draw the parts patent figures are usually made of: plates, brackets, housings, shafts, flanges, pins, simple assemblies.

## A. The foundation: how the chemical builders work (and what carries over)

| Chemical builder (shipped v2.93–2.119) | Patent-drawing canvas |
|---|---|
| A 2D canvas in Build mode (OCL `CanvasEditor`), resizable | A 2D **sketch** canvas we write ourselves. OCL's editor is chemistry-only. |
| **Open large canvas**: an ~85 % Office dialog (`src/drawdialog`, its own webpack entry), seeded by URL, returns through `messageParent` | The same dialog pattern, with the model encoded compactly. Opened through `docHost.openDialog` (v2.146.0). |
| **3D Model** tab: drag-rotate (3×3 matrix + Gram–Schmidt, `rotateView`), wheel zoom, spin | The same controls. `rotateView` is reused as is. |
| **One shared draw list.** `projectScene()` feeds BOTH the live canvas painter (`paintOps`) and the insert (`opsToSvg`), so the preview IS the inserted figure | The same principle, with two draw lists: a **shaded orbit preview** for building, and the **line drawing** (hidden lines removed), which is what is inserted |
| Click-vs-drag picking and an edit bar (`mol3dEdit.ts`); every edit verified | Pick a body or face; the edit bar changes dimensions and position, and assigns a reference numeral |
| Everything decided in pure `src/lib` modules with tests; the pane only wires | The same. The geometry engine, line-drawing engine and sheet layout are all `src/lib` and jest-tested |
| Insert through the figure path, with captions as an honesty line | Insert through `insertFigure` under the **USPTO** figure style (v2.143.0): black only, the 3.2 mm text minimum, the 1.84(g) sight |

## B. The model (parametric, not a mesh)

A drawing is an **assembly** of **bodies**. Each body is a solid made by one of:
- **Extrude.** A 2D profile (outer loop plus any number of hole loops, built from lines and arcs) swept a distance along its normal. This alone gives plates with holes, brackets, L/U/T sections, slots and keyed shafts seen end-on.
- **Revolve.** A 2D profile turned about an axis (360° or a stated angle). This gives shafts, flanges, pins, bushings, knobs and nozzles.
- **Primitives** as shortcuts that build profiles: box, cylinder, tube, cone, sphere.

Each body is placed in the assembly by a translation and a rotation. Bodies may touch or overlap visually; there are **no boolean operations in R1**. A hole is a hole loop in a profile, which covers through-holes. Blind holes and drilled cross-holes need booleans, so they are R2.

**Why parametric.** We generate every face ourselves, so the engine KNOWS which surfaces are smooth (the side of a cylinder, a revolved curve) and which edges are real creases. Line drawings from faceted meshes fail at exactly that point: jagged outlines and stray facet lines. Here, outlines are computed from smooth-surface normals, and only real edges are drawn.

**Encoding.** The model is compact JSON with a version field. It is stored on the inserted picture's alt text (provenance, as the structures do) and passed to and from the large-canvas dialog. Over the URL limit (about 1800 characters, measured for the chemical dialog), it is passed by `messageChild` after the dialog opens.

## C. The line-drawing engine (the technical core; spike FIRST)

This is a pure `src/lib` module, Float64 throughout. `geometry3d`'s exact `Rat` arithmetic is far too slow at this scale.
1. **Tessellate** each body with **per-face smoothing**: planar faces flat, and curved faces carrying analytic normals at their vertices. Each edge is classified as a *crease* (a real edge between faces), *smooth* (inside a curved face), or *boundary*.
2. **Feature lines** for the view:
   - every crease and boundary edge;
   - **silhouettes** of smooth surfaces, taken as the zero crossing of n·v interpolated across each smooth triangle (v toward the eye, per vertex in perspective). This is the standard fix for jagged outlines.
   - smooth-interior edges are never drawn.
3. **Visibility**:
   - project all feature segments;
   - split each one where it crosses any projected silhouette or crease (a screen-space grid finds the candidates);
   - classify each piece by casting a ray from its midpoint toward the eye against all triangles (grid/BVH accelerated), excluding the piece's own faces with an epsilon;
   - visible pieces are drawn solid, hidden pieces are dropped (or dashed, as an option, off by default).
4. **Chain and merge** collinear runs into polylines. Emit black SVG strokes with stroke widths that survive the USPTO reproduction rule.

**Acceptance criteria for the spike, all in jest, on synthetic models, before any UI:**

| Model | Must give |
|---|---|
| Cube, isometric view | exactly 9 visible edges and 3 hidden, confirmed by an independent oracle (for a convex solid, an edge is visible iff one of its two faces faces the viewer) |
| Cube, front orthographic | 4 visible edges forming the square; nothing else |
| Cylinder at 16, 64 and 256 segments, isometric | 2 straight silhouettes + the visible cap ellipse(s); **no facet lines**; silhouettes within 0.5 % of the true tangent lines at every resolution |
| Sphere | one closed contour, radius within 0.5 %, no zig-zag (direction reversals along the loop = 0) |
| Plate with a through-hole, isometric | outer outline, hole rim on the top face, the visible part of the hole's far wall; exact visible/hidden segment counts |
| Two boxes, one partly in front of the other | the rear box's edges split exactly at the front box's outline |
| Revolved stepped shaft, side view | each step's outline and shoulder line, and no facet lines |
| Work bound | a model over the triangle cap is refused BY NAME; a model at the cap finishes inside a stated budget (10× headroom in tests) |

## D. Views, numerals, the sheet

_Sections D–E were written for the USPTO standard first. Every other standard (ISO/ASME engineering, journal, plain) uses the same views and insert path with its own style object: line weights, balloons in place of lead-line numerals, dimension style, sheet and title block. See §0._

**Views:**
- Front, top, right, and isometric are standard; a perspective view is optional.
- Each view is a FIG; several views can go on one sheet ("FIG. 1", "FIG. 2", or "FIG. 1A/1B" under the USPTO panel rule already in `figureStyle.ts`).

**Reference numerals:**
- Click a visible point on a body or face (a ray-cast pick that rejects occluded points). A numeral is placed outside the outline with a **lead line** that ends ON the part, as 1.84(q) asks.
- Numbers come from the document's **Numerals table** (`numerals.ts`): next free number, element name.
- **Audit** then checks numerals against the specification text.
- Placement is manual in R1; automatic de-collision of labels is R2.

**Sheet:**
- The USPTO preset gives black only, text ≥ 3.2 mm with its safety margin, and the sight 170 × 244 mm (the minimum of the A4 and Letter sights, 1.84(g), already in `figureStyle.ts`).
- Line weights and hatching rules (1.84(h)(3) for sections) are taken from the rule text at build time, not recalled.

## E. Insert, and the gates this trips

- **Insert** goes through `docHost` via `insertFigure`. The v2.146.0 wall forbids Word code in the pane, and the USPTO refusals then apply. Alt text carries the model (provenance) and "Patent drawing: FIG. n, <view>".
- **New `src/lib` SVG builders** join the figure-layout corpus, and the label audit covers them.
- **The new mode** changes the host trace deliberately:
  - add a seed that builds a known model;
  - keep coverage N/N;
  - run `--write` with a CHANGELOG line.
- **Render-check's mode count (27), id-wiring and the pane layout gate** move with the new mode.
- **[preview-is-not-insert]:** the inserted SVG is rasterised and checked, and the in-Word pass is the user's (a new TEST-SCRIPT section).
- **[unbounded-loops-freeze-word]:** every loop is bounded by WORK, not steps. Heavy work is chunked asynchronously on the main thread. There is no Web Worker in R1: the offline-precache gate and Mac WKWebView would both need re-proving.

## F. Releases

| Release | Content |
|---|---|
| **R1a: the engine (spike) — DONE 2026-10-17** | `src/lib/cadModel.ts` (model, validation by name, tolerance-driven tessellation, ear clipping with hole bridges) and `src/lib/cadLines.ts` (views, feature lines, visibility, drafting precedence, chaining, SVG). All 17 acceptance tests pass. See "Spike results" below. |
| **R1b: the 3D canvas** | A Drawing mode built like the chemical builder: shapes (box, cylinder, tube, cone, sphere) and simple sketched profiles (rectangle, circle, line, arc, holes) extruded or revolved; placement; **drag-to-orbit like the 3D molecule view**; standard and orbit views; the **output standard picker** (USPTO / ISO engineering / ASME engineering / journal / plain); numerals with lead lines (USPTO) or balloons (engineering); FIG labels; insert through `docHost`; the large-canvas dialog. |
| **R2: 2D drafting (the Solid Edge 2D core)** | Full sketch tools, the geometric relationships and driving dimensions with a solver, dimension and annotation objects under ISO/ASME styles, line types and layers, hatching, sheet sizes, borders and title blocks. A 3D body can be made from any closed R2 sketch. |
| **R3** | Dimensioned projected views from 3D (first and third angle), section and detail views, GD&T frames, DXF read/write, STL/OBJ import (weld, orient, refuse non-manifold by name), booleans, exploded views, surface shading lines. |

### Spike results (R1a, measured 2026-10-17)

All 17 tests in `src/lib/__tests__/cadLines.test.ts` pass:

| Model | Result |
|---|---|
| **Cube** | Isometric: 9 visible edges and 3 hidden, each √(2/3) long. The hidden ones lie exactly on cap triangulation edges, the degenerate case. An off-axis view agrees edge for edge with the convexity oracle. The front view is the square only. |
| **Cylinder** | At three tessellation tolerances (2e-2, 2e-3, 2e-4): two outlines plus the end lines, no facet lines, outlines on the true tangents. Isometric: exactly 2 straight outlines. |
| **Sphere** | One outline, every point within 0.5 % of the radius, no hidden lines. |
| **Plate with hole, two occluding boxes, stepped revolved shaft** | All lengths exact. |
| **Refusals** | Open outline, wrong winding and the triangle cap are each refused by name. |

**A demo assembly** (L-bracket, mounting holes, shaft and flange; 992 triangles) drew six views (isometric, front, top, right, an orbit, and dashed hidden lines) in 65 ms. The rendered sheet was inspected by eye.

**Engine defects the tests found and fixed during the spike:**
1. **Outline self-hiding.** An outline from interpolated normals sits inside the faceted edge, so it now excludes its facet's two-ring neighbourhood.
2. **Exact-vertex outlines.** These are handled by symbolic perturbation.
3. **Over-broad edge exclusion.** It hid nothing on an isometric box's own diagonal; it now excludes only triangles that contain the whole edge.
4. **Hidden-over-visible.** ISO 128 / ASME precedence applies: visible wins.
5. **Split edges re-joined** by collinear chaining.
6. **A sign error in arc tangents.**

**Known R1 limits:**
- Bodies that overlap or touch keep their own edges, so a seam shows where two bodies are meant to be one part. Booleans in R3 fix this.
- Orthographic views only. A perspective view is optional and still to come.

Each release gets the full QC, an independent adversarial pass and a live check.

## G. Open questions for the user

- **A real part.** What would you draw first? A described part, or a photo of a sketch, is enough for R1. An STL from your CAD matters for R3.
- **Dashed hidden lines.** These depend on the standard. They are ON in orthographic engineering views (ISO 128 / ASME Y14.2 line types) and OFF by default in USPTO and pictorial views, with a switch either way.
- **Which engineering standard to default to:** ISO (first-angle projection) or ASME (third-angle). Both will be offered; the default should match how your clients draw.
