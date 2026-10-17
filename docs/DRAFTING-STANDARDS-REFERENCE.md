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

## Scale factors (from the reference)

CAD text height = paper height × scale denominator. For example, 2.5 mm at 1:5 is 12.5 mm in model space. This is arithmetic, correct by construction. The canvas lays out text in paper space, so it never needs model-space text heights.

## Sources

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
