# Drafting standards reference (validated)

_For the CAD canvas (docs/SCOPE-CAD-CANVAS.md). On 2026-10-17 the user supplied two reference notes ("ISO/ASME ENGINEERING DRAWING STANDARDS REFERENCE" and "COMPREHENSIVE TECHNICAL REFERENCE: LINE DRAWING & LETTERING STANDARDS") with the instruction "validate of course". Each value below was checked against published secondary sources the same day. ASME Y14.2, ISO 128 and ISO 3098 themselves are paywalled and were not read._

_Code that uses a value cites this file. A value marked **disputed** or **unverified** must not be presented to the user as the standard's own figure._

## Lines

| Value | Status | Notes |
|---|---|---|
| ASME Y14.2: thick 0.6 mm, thin 0.3 mm (minimums), 2:1 | **Confirmed** | Y14.2-2008 as quoted on Eng-Tips; course deck. Y14.2-1979 used about 0.7 / 0.35 mm (Machinery's Handbook). |
| ASME: thick = visible, cutting-plane, viewing-plane, chain; thin = hidden, center, dimension, extension, leader, section (hatch), phantom | **Consistent** with sources | The FreeCAD TechDraw line table for Y14.2-2008 has the same line types (no widths). |
| ASME hidden line: dash about 3 mm | **Confirmed** | Course deck: 0.125 in (3 mm) dashes. |
| ASME hidden line: gap 1.0 mm (reference) | **Disputed** | The course deck says 0.06 in (1.5 mm). The code uses 1.5 mm until the standard's figure is read. |
| ASME center line: long dash 19–38 mm, gap 1.5, short dash 3, gap 1.5 | **Unverified** | Common teaching proportions. Used only as a product default. |
| ISO 128 width series 0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1.0, 1.4, 2.0 mm (√2 steps) | **Confirmed** | Several sources. |
| ISO line groups: wide:narrow 2:1, e.g. 0.5 / 0.25 and 0.7 / 0.35 | **Confirmed** | Two-weight drawings take the narrow/wide pair from one group. |
| ISO "medium" line (0.35 in group 0.5) | **Corrected** | It is the width for graphical symbols (and lettering), between narrow and wide, not a third general line weight. |
| ISO 128 line type letters A–K (A continuous thick … K double-dotted thin) | **Consistent** | These letters are the ISO 128:1982 scheme. ISO 128-2 (current) numbers types 01–15 instead. |

## Lettering

| Value | Status | Notes |
|---|---|---|
| ASME: general notes and dimensions 3.0 mm (0.12 in) | **Confirmed** | |
| ASME: titles, view letters, section identifiers 6 mm (0.24 in) | **Confirmed** (sources) | The first reference said 4.0–5.0 mm and the second 5.0–6.0 mm; sources give 0.24 in. Some sources make the title size depend on sheet size; the mandatory table in Y14.2 is authoritative. |
| ASME: all capitals, single-stroke sans-serif | **Consistent** | |
| Industry practice: 5/32 in (≈4 mm) notes on D-size so a half-scale B-size print stays legible | **Plausible practice** | Not a rule. It applies only if the canvas ever produces D-size sheets. |
| ISO 3098 heights 1.8, 2.5, 3.5, 5, 7, 10, 14, 20 mm (√2) | **Confirmed** | |
| ISO 3098 lettering "Type V (d = h/10)" and "Type H (d = h/14, thicker strokes)" | **Wrong in the reference** | The types are **A (d = h/14)** and **B (d = h/10)**, and B is preferred. **V / S** is the orientation (vertical, or sloped 75° from horizontal). Designation example: ISO 3098-BVL-5. h/14 is the thinner stroke. |
| ISO 3098 type B spacing: a = 2/10 h, b ≥ 14/10 h, e = 6/10 h | **Consistent** with the type-B ratios | Use it for text layout in R2. |
| ISO note heights by sheet: 1.8 mm (A4), 2.5 mm (A1–A3), 3.5 mm (A0) | **Secondary guidance** | The canvas uses 2.5 mm on A4. ISO allows 1.8; 2.5 is the safer legible choice, marked PRODUCT. |

## Projection symbol

| Value | Status | Notes |
|---|---|---|
| Symbol = a truncated cone seen from the side (a trapezoid) plus its end view (two concentric circles, both solid) | **Confirmed** | ISO 5456-2 / ASME Y14.3; ISO 128-3 points to ISO 5456-2 for the methods. |
| Third angle: the trapezoid's short side points TOWARD the circles; first angle: AWAY from them | **Confirmed** | Wikipedia (Multiview orthographic projection) states it in words. Geometry agrees: the end view showing both circles solid must be the view of the narrow end, and third angle draws the view from the left on the left. |
| The canvas draws the same frustum in both, narrow end LEFT: circles left (third angle), right (first angle) | **Implemented** | One teaching page (RMIT) draws the first-angle symbol with the cone mirrored and the circles on the right. That arrangement would show the inner circle hidden, so it was not followed. Pinned by an orientation test (cadSheet.test.ts). |

## Sheets, borders and zones (R2b — validated 2026-10-17)

ISO values below were read in the standards' own text, through their Indian adoptions published on law.resource.org: **IS 10711:2001 = ISO 5457:1999** ("approved … without deviations") and **IS 11665:2009 = ISO 7200:2004**. ASME Y14.1 itself was not read; DOD-STD-100D (public domain, "sheet size and format shall be in accordance with ANSI Y14.1") was.

| Value | Status | Notes |
|---|---|---|
| ISO-A trimmed sizes A0 841 × 1189 … A4 210 × 297 mm; drawing space A0 821 × 1159, A1 574 × 811, A2 400 × 564, A3 277 × 390, A4 180 × 277 | **Confirmed** (ISO 5457 Table 1) | |
| A0–A3 landscape only, title block bottom right; A4 portrait only, title block in the lower part | **Confirmed** (ISO 5457 4.1) | The ISO standard's unframed drawing area (267 × 180, A4 landscape) is a PRODUCT choice, not ISO 5457; the framed A4 sheet is portrait. |
| Border 20 mm on the left (filing margin, includes the frame), 10 mm on the other edges; frame continuous 0.7 mm | **Confirmed** (ISO 5457 4.2) | ISO 7200 repeats 20 / 10 mm for A4. |
| Centring marks: four, at the ends of the trimmed sheet's axes of symmetry; recommended continuous 0.7 mm, from the grid reference border to 10 mm beyond the frame | **Confirmed** (ISO 5457 4.3) | The grid reference border's distance from the trimmed edge is in a figure that did not survive text extraction: the canvas draws it 5 mm outside the frame (PRODUCT). |
| Grid reference: fields 50 mm long starting at the axes of symmetry, corner fields take the remainder; capital letters top to bottom (no I, no O), numerals left to right, on both sides (A4: top and right only); characters 3.5 mm upright (ISO 3098-1); grid lines continuous 0.35 mm | **Confirmed** (ISO 5457 4.4) | |
| Number of fields, long × short side: A0 24 × 16, A1 16 × 12, A2 12 × 8, A3 8 × 6, A4 6 × 4 | **Confirmed** (ISO 5457 Table 2) | Equals 2 × round(half side / 50) for every size; the code checks the table against that rule. |
| Size designation in the bottom border at the right corner | **Confirmed** (ISO 5457 3.1) | |
| Trimming marks (two overlapping 10 × 5 mm rectangles) | **Confirmed**, not drawn | They are for untrimmed preprinted sheets; the canvas produces the trimmed sheet. |
| ISO 7200 title block 180 mm wide (fits A4 with 20 / 10 mm margins), the same block on every size | **Confirmed** (ISO 7200 6) | The arrangement of its cells is a figure only: the canvas's arrangement is PRODUCT. |
| ISO 7200 fields — mandatory: legal owner, identification number (16 characters), date of issue (10), segment/sheet number (4), title (25), approval person (20), creator (20), document type (30). Optional: revision index (2), number of sheets (4), language code (4), supplementary title (2 × 25), responsible department (10), technical reference (20), document status (20) | **Confirmed** (ISO 7200 Tables 1–3) | Scale and the projection symbol are presented OUTSIDE the title block (ISO 7200 4). Revision index: avoid I and O. |
| ANSI sizes A 8.5 × 11 (horizontal or vertical), B 11 × 17, C 17 × 22, D 22 × 34, E 34 × 44 in | **Confirmed** (SolidWorks/ASME tables, Engineering Toolbox, DOD-STD-100D) | |
| ASME margins (in): B 0.62 / 0.38, C 0.75 / 0.50, D 1.00 / 0.50, E 1.00 / 0.50 (sides / top-bottom); A 0.38 / 0.25 | **Consistent** (DOD-STD-100D Figure A-4 for B–E, OCR'd; A from secondary sources) | Which of each pair is horizontal is not legible in the scan; the larger is taken as the side margin (PRODUCT). |
| ASME zones (rows × columns): A 2 × 2, B 2 × 4, C 4 × 4, D 4 × 8, E 8 × 8; zones equal, 1 to 5 in; required except on A and B | **Secondary** (a third-party table; a quoted Y14.1-2005 sentence) | Drawn on every size; marked as secondary. |
| ASME zone labels: numbers along the top and bottom, letters along the sides, zone A1 at the lower right (numbers increase right to left, letters bottom to top, no I or O) | **Consistent** with secondary sources | Y14.1's own figure not read. |
| ASME title block fields (design activity, drawing title, size, CAGE code, drawing number, revision, scale, sheet, drawn / checked / approved with dates) | **Consistent** (DOD-STD-100D Appendix A, Y14.1 summaries) | Layout and dimensions PRODUCT, not presented as Y14.1's. CAGE codes are five characters. |
| 37 CFR 1.84(g): patent drawing sheets must not contain frames around the sight | **Confirmed** (rule text) | A USPTO drawing gets no frame or title block; asking for one is refused by name. |

## Line types (R2b — ISO 128-20, validated)

Read in **IS 10714 (Part 20):2001 = ISO 128-20:1996** (law.resource.org).

| Value | Status | Notes |
|---|---|---|
| Basic types 01 continuous, 02 dashed, 04 long-dashed dotted, 05 long-dashed double-dotted (15 in all) | **Confirmed** | 01 visible outlines, 02 hidden, 04 centre lines, 05 phantom / adjacent parts. |
| Line elements in multiples of the width d: dot ≤ 0.5d, gap 3d, short dash 6d, dash 12d, long dash 24d, space 18d | **Confirmed** | A dot is a line no longer than half its width, so non-continuous lines are drawn with butt caps (a round cap would add d). |
| Width series 0.13 … 2 mm | **Confirmed** | (as above) |
| ASME Y14.2 centre and phantom element lengths | **Unverified** | Product defaults (centre: long dash 20 mm, gap 1.5, short dash 3, gap 1.5); hidden 3 / 1.5 mm as before. |

## Scale factors (from the reference)

CAD text height = paper height × scale denominator. For example, 2.5 mm at 1:5 is 12.5 mm in model space. This is arithmetic, correct by construction. The canvas lays out text in paper space, so it never needs model-space text heights.

## Sources

- [IS 10711:2001 = ISO 5457:1999, Sizes and layout of drawing sheets](https://law.resource.org/pub/in/bis/S01/is.10711.2001.pdf)
- [IS 11665:2009 = ISO 7200:2004, Data fields in title blocks](https://law.resource.org/pub/in/bis/S01/is.11665.2010.pdf)
- [IS 10714 (Part 20):2001 = ISO 128-20:1996, Basic conventions for lines](https://law.resource.org/pub/in/bis/S01/is.10714.20.2001.pdf)
- [DOD-STD-100D (ANSI Y14.1 formats, Figure A-4 margins)](https://ibiblio.org/apollo/Documents/assist.dla.mil/MIL_STD_100D.pdf)
- [Engineering Toolbox: ANSI/ASME Y14.1 sheet sizes](https://www.engineeringtoolbox.com/paper-drawing-sizes-d_140.html)
- [Wikipedia: Multiview orthographic projection (projection symbols)](https://en.wikipedia.org/wiki/Multiview_orthographic_projection)
- [RMIT Learning Lab: first- and third-angle symbols](https://learninglab.rmit.edu.au/dlsweb/Toolbox/electrotech/toolbox1204/resources/03workshop/02drawings/03views.htm)
- [ISO 128-3:2022 (points to ISO 5456-2)](https://iteh.es/catalog/standards/iso/75d888a5-6e9a-4fac-9120-8f2dffc20899/iso-128-3-2022)
- [Eng-Tips: ASME Y14.2 thread](https://eng-tips.com/threads/asme-y14-2.497711)
- [Chapter 6 course deck (ASME line conventions)](https://www.slideserve.com/renee/chapter-6)
- [Machinery's Handbook Pocket Companion: Standards for Drawings](https://www.globalspec.com/reference/68262/203279/Standards-for-Drawings)
- [FreeCAD TechDraw ASME.Y14.2.2008 line definitions](https://huggingface.co/AbdulElahGwaith/FreeCAD/blob/main/src/Mod/TechDraw/LineGroup/ASME.Y14.2.2008.LineDef.csv)
- [ISBE drafting lettering guide](https://www.isbe.net/CTEDocuments/TEE-600173.pdf)
- [LibreTexts: Lines and Lettering](https://eng.libretexts.org/Courses/Western_Technical_College/Inventor_Parametric_Design%3A_Level_1_(Bahl)/01%3A_Technical_Drawings/1.01%3A_Understanding_Technical_Drawings/1.1.04%3A_Lines_and_Lettering)
- [Wikipedia: Technical lettering](https://en.wikipedia.org/wiki/Technical_lettering)
- [Roymech: Lettering](https://roymech.org/Useful_Tables/Drawing/Lettering.html)
- [CAD Setter Out: Lettering Heights](https://cadsetterout.com/drawing-standards/lettering-heights/)
- [CAD Setter Out: line weights](https://cadsetterout.com/?p=316)
- [Draftsperson: Pen sizes and line types (metric)](https://blog.draftsperson.net/pen-sizes-and-line-types-metric/)
