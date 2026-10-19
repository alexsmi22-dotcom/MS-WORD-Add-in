# Scope — Drawing (CAD): section views, perspective views, OBJ import (v2.161.0)

Hit-list #15 (3D patent drawings) asked for "front/top/side, isometric and **perspective** views with hidden-line
removal; 1.84(m) shading lines; exploded and **section** views". Exploded and detail views shipped in v2.155.0;
this release adds section and perspective views, and OBJ files beside STL. (1.84(m) shading lines, dimensions on
views and GD&T are v2.162.0.)

## A. The rule, from the source

37 CFR 1.84, fetched 2026-10-19 from https://www.law.cornell.edu/cfr/text/37/1.84 (verbatim):

> **(h) Views.** The drawing must contain as many views as necessary to show the invention. The views may be plan,
> elevation, section, or perspective views. … Views must not be connected by projection lines and must not contain
> center lines.

> **(h)(3) Sectional views.** The plane upon which a sectional view is taken should be indicated on the view from
> which the section is cut by a broken line. The ends of the broken line should be designated by Arabic or Roman
> numerals corresponding to the view number of the sectional view, and should have arrows to indicate the direction
> of sight. Hatching must be used to indicate section portions of an object, and must be made by regularly spaced
> oblique parallel lines spaced sufficiently apart to enable the lines to be distinguished without difficulty.
> Hatching should not impede the clear reading of the reference characters and lead lines. If it is not possible to
> place reference characters outside the hatched area, the hatching may be broken off wherever reference characters
> are inserted. Hatching must be at a substantial angle to the surrounding axes or principal lines, preferably 45°. A
> cross section must be set out and drawn to show all of the materials as they are shown in the view from which the
> cross section was taken. The parts in cross section must show proper material(s) by hatching with regularly spaced
> parallel oblique strokes, the space between strokes being chosen on the basis of the total area to be hatched. The
> various parts of a cross section of the same item should be hatched in the same manner and should accurately and
> graphically indicate the nature of the material(s) that is illustrated in cross section. The hatching of
> juxtaposed different elements must be angled in a different way. In the case of large areas, hatching may be
> confined to an edging drawn around the entire inside of the outline of the area to be hatched. Different types of
> hatching should have different conventional meanings as regards the nature of a material seen in cross section.

> **(m) Shading.** … Such shading is preferred in the case of parts shown in perspective, but not for cross sections.

What each sentence makes the code do:

| Rule | Behaviour |
|---|---|
| plane "indicated on the view from which the section is cut by a broken line" | the cutting line is drawn on the PARENT view, in the standard's cutting-plane line type (thick chain; USPTO: broken) |
| "ends … designated by … numerals corresponding to the view number" | USPTO: each end labelled with the section's FIG number ("3"); ASME/ISO: a letter ("A") and the view titled "SECTION A–A" / "A–A", following the convention the detail views already use ("DETAIL A" / "A") — to be checked against the standards' text before release |
| "arrows to indicate the direction of sight" | an arrow at each end, pointing the way the section view looks |
| "regularly spaced oblique parallel lines" at "preferably 45°" | hatch lines at 45° in the section view's plane, constant spacing |
| spacing "chosen on the basis of the total area" | spacing from the cut area (clamped to what reads at 2/3 reduction, 1.84(k)) |
| "parts … of the same item … hatched in the same manner" | one angle and spacing per BODY, everywhere it is cut |
| "juxtaposed different elements must be angled in a different way" | adjacent bodies alternate 45° / 135°, then a different spacing |
| "large areas … confined to an edging" | NOT built (refused by name if ever asked); always full hatching |
| "conventional meanings … material" | NOT built: one general-purpose pattern (ANSI31-style); material patterns named as a limit |
| (m) "not for cross sections" | the v2.162.0 shading lines will never be drawn on a cut face |

## B. Section views

**Spec.** `{ kind: "section"; label: string; of: OrthoKind; a: [x, y]; b: [x, y]; flip?: boolean }` — a straight
cutting line from `a` to `b` in the parent view's plane (model units), the plane through it perpendicular to that
view, looking along the plane's normal (`flip` reverses the direction of sight). Offset/aligned/half sections are
out of scope (named limits).

**Geometry (pure, src/lib/cadSection.ts).**
1. World plane from the parent view's rotation and the line.
2. Clip the mesh to the half-space beyond the plane: triangles wholly behind kept, wholly in front dropped,
   straddling ones cut (one or two triangles out). A vertex within `tol = 1e-9 · diag` of the plane counts as ON
   the plane (no slivers, no gaps).
3. The cut: each straddling triangle gives one segment on the plane; segments are chained into closed loops PER
   BODY. Only a closed solid has a closed cut — the import checks (closedness) already know which bodies are
   closed; a body that is not closed is refused by name ("part 3 is not a closed solid, so it has no cut face").
4. Loops → regions with holes (containment by signed area and point-in-polygon), triangulated with the existing
   `triangulateWithHoles` (cadModel, the D6 cap triangulation) and added to the clipped mesh as cap faces, so they
   hide what lies behind them in the hidden-line pass.
5. The section view's lines: `drawLines` on the clipped + capped mesh, looking along the normal. Cap boundaries
   are drawn as visible edges.
6. Hatching: in the section view's 2D plane, parallel lines clipped to each body's cap regions (even-odd scanline
   against the loop polylines).

**On the parent view:** the cutting line (beyond the part's outline by a margin), end labels, arrows.

**Caching and time.** The plane's parameters are in the ViewSpec, so the refusal key and the per-mesh lines key
both include them (the round-5/6 lessons). The clip, cut and hatch spend the sheet's work budget
(`spendBudget`); tests never use a wall clock.

**UI.** A "Section" button beside "Detail": click two points on a front, top or side figure; the section is
added as the next FIG (USPTO) or next letter (ASME/ISO); "Flip" reverses it; it can be removed like a detail.

## C. Perspective views

1.84(h) allows them and (m) prefers shading on them. A perspective view is a pictorial view (like iso) with a
centre of projection at distance `d` (default 3 × the model's diagonal, adjustable: "Strength").

**Method.** Apply the projective map (x, y, z) → (x·d/(d − z), y·d/(d − z), z·d/(d − z)) in view space to the
mesh's vertices, then run the existing orthographic hidden-line removal on the mapped mesh. A projective map keeps
straight lines straight and preserves depth order in front of the eye, so the orthographic HLR on the mapped mesh is
the perspective HLR. A model reaching behind the eye (d − z ≤ 0 anywhere) is refused by name.

**Scope.** Callouts on a perspective view map through the same transform. Dimensions on a perspective view are
refused (v2.162.0: foreshortened).

## D. OBJ import

Wavefront .obj (text): `v x y z` and `f` faces (any polygon, triangulated as a fan; `v/vt/vn` index forms; negative
indices). Everything else (`vt`, `vn`, `o`, `g`, `s`, `usemtl`, `mtllib`) is ignored; materials are never fetched.
OBJ carries no units — asked, as for STL. The facets go into the STL pipeline (`stlBody`): the same closedness
checks, edge angle and caching by content fingerprint. Limits as STL (facet budget); malformed lines are refused
with their line number.

## E. Not in this release (named limits)

Offset, aligned, half, broken-out and revolved sections; material-specific hatch patterns; hatch confined to an
edging; section of an exploded view; perspective with three-point vanishing control; STEP (needs a CAD kernel —
the user decides after measurements); mesh booleans.

## F. Tests (no wall clocks)

- Section of a box through its middle: one rectangular cap, area exact; hatch lines all inside it, at 45°, evenly
  spaced; the parent shows a chain line, two labels, two arrows.
- A tube (hole): the cap is an annulus — no hatching in the hole.
- Two touching blocks: two caps, different hatch angles.
- A plane through a vertex / along a face: no slivers, no gaps (tolerance).
- An open STL body cut: refused by name.
- Flip: the view looks the other way (mirror of the unflipped).
- Perspective of a cube: parallel edges converge; hidden edges match an independent ray test at sample points;
  eye inside the model refused.
- OBJ: a cube as quads and as triangles gives the same body as the STL cube; negative indices; `f 1/1/1 …` forms;
  a bad index refused with its line.
- Refusal and lines caches keyed on the plane (changing the plane redraws; same plane reuses).
