# CAD canvas R2 — 2D drafting (the Solid Edge 2D core)

Follows `docs/SCOPE-CAD-CANVAS.md` (R1a engine, R1b 3D canvas, shipped v2.147.0). R2 is the part of Siemens
Solid Edge 2D Drafting that matters for figures: **sketch with geometric relationships and driving dimensions**,
then draw it to a standard. R2 ships in four releases; each one is useful alone and each gets the full suite and
an independent adversarial review before it ships.

| Release | Content |
|---|---|
| **R2a — sketcher + solver** | 2D sketch canvas (lines, arcs, circles, rectangles, points), geometric relationships, driving dimensions, a verified solver with degrees-of-freedom reporting; **any closed sketch becomes a 3D part** (extrude / revolve) in the R1b drawing. |
| R2b — sheets | Sheet sizes (ISO A4–A0, ANSI A–E), borders and zones, title blocks (ISO 7200 fields / ASME Y14.1), line types and layers as style objects. |
| R2c — dimensions on drawings | Linear, aligned, angular, radial and diameter dimensions and leaders on the drawing views, under ISO 129 / ASME Y14.5 styles, with tolerances; hatching of closed regions. |
| R2d — sketch editing | **Brought into R2a at the user's request** ("I want to be able to actually draw with a full suite of tools"): fillet, chamfer, offset, trim, mirror, linear and circular pattern, plus polygon, slot, centre rectangle and 3-point arc. Still to come: extend, trimming circles and arcs, offsetting outlines that contain arcs. |

Order: R2a first — every later release sits on the sketch model and the solver. Also added to R2a at the user's request: **New drawing** (clear with confirm and undo) and **Export to PowerPoint**.

## R2a design

### Model (`src/lib/sketch.ts`)
- **Entities**: point (x, y); line (two point ids); circle (centre point, radius r); arc (centre, start, end
  points, plus an explicit equal-radius relation start–centre = end–centre carried as a constraint, so DOF counts
  are right); every entity can be **construction** (drawn thin, not part of a profile).
- **Variables**: point coordinates and circle radii. Nothing else moves.
- **Relationships**: coincident, horizontal, vertical, parallel, perpendicular, tangent (line–circle/arc,
  circle–circle, with the side fixed when created), equal (length / radius), concentric, point-on-line,
  point-on-circle, midpoint, symmetric (about a line), fix.
- **Dimensions** (driving): distance point–point, point–line, horizontal / vertical distance, length, angle
  between lines, radius, diameter. A dimension can be **driven** (reference: shown, never solved for) — what Solid
  Edge offers when a dimension would over-constrain.

### Residuals — differentiable by construction
Coincident is two equations (dx, dy), never `dist = 0`; parallel / perpendicular are cross / dot of direction
vectors, never `acos`; angle is `atan2(cross, dot) − θ` wrapped to (−π, π]; tangency is the signed distance from
centre to line minus r with the sign stored at creation; distances use squared forms where the value is zero.
Analytic Jacobian for every residual, checked against finite differences in the tests.

### Solver
- Gauss–Newton with Levenberg–Marquardt damping, **minimum-norm steps** from the current positions (a drag or a
  new value moves the least geometry), all lengths normalised by the sketch size, iteration-capped (never freeze
  Word), and large value changes approached in increments so the sketch stays on its solution branch.
- **Every solve is verified**: all original residuals recomputed unscaled below tolerance, no line of zero
  length, no zero radius — otherwise refused by name and the previous sketch kept.
- **Flips are failures**: after a solve, each closed loop's signed area, each arc's sweep direction and each
  tangent's side must be unchanged; if one flipped the solve is refused by name ("this value would turn the
  triangle inside out") and the old sketch kept.

### Degrees of freedom — by definition
- DOF = variables − rank(J) at the solution, by a column-pivoted Householder QR of Jᵀ (cross-checked against linalg.svd in the tests; much faster than Jacobi SVD at sketch sizes). Free
  entities are named from the null space (variables with a component there).
- **Position policy**: an unanchored sketch is reported "fully defined apart from position" at 3 DOF; fixing a
  point or dimensioning to the origin removes those.
- **One new constraint at a time**: if adding it does not raise the rank it is **redundant**; if the residual
  cannot reach zero it **conflicts**. Either way it is refused by name, or (for a dimension) offered as a driven
  dimension. Whole-sketch diagnosis is not attempted.

### Sketch → part
Closed loops are found from the non-construction geometry; open or branching geometry is refused by name
("the outline is open at (12, 4)"). Nesting decides holes; loops are oriented (outer counter-clockwise, holes
clockwise) and arcs mapped onto `LoopSeg.cw`. Revolve needs an axis line, and the profile must not cross it.
The part is a new catalogue kind in the R1b document: `shape: "sketch"` carrying the sketch.

### Canvas (pane + large canvas)
Built like the R1b canvas, DOM-only controller over tested `src/lib` decisions. Tools: select, line, rectangle,
circle, arc, point, construction toggle; relationships by selecting entities then a relation button; dimension
tool: click an entity (or two) and type the value — **display is a contract**: `Ø20`, `R5`, `45°`, and both
`Ø20` and `20` are accepted when editing. Auto-relations while drawing (horizontal / vertical, coincident
endpoints), shown and removable. Colour shows state: under-defined, fully defined, and the entities still free.
Drag a free point: the solver keeps every relation.

### Size and storage
The model travels in the picture's alt text (as in R1b). Word documents no limit for `altTextDescription`; the
in-Word test (TEST-SCRIPT) probes a large sketch's round trip, and until that answers, a model over a
conservative size is refused by name rather than truncated.

### Work bounds
Sketch capped by entity count (refused by name above it); solver iterations capped; SVD timed at the cap in the
tests.

## Oracles (tests written against these, not against the solver's own output)
Triangle from three sides (law of cosines); tangent chains (analytic tangency points); driven values; DOF of
known sketches (a free line 4; a rectangle with H/V relations 4; fully dimensioned 0, or 3 unanchored); flips
provoked on purpose; finite-difference Jacobians; every new test confirmed to fail on a deliberately broken solver.
