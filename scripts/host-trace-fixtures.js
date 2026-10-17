/* eslint-disable no-undef */
// The document the host-trace drive pretends to be inserting into
// (scripts/host-trace.js). Keys are regexes over "<object path>.<property>" as
// the recorder names them (R3.document.body.text, #12.items); values are
// returned when the pane reads that property. {__items: [...]} becomes recorded
// objects carrying those properties, so what the pane does to them is traced.
//
// WHY A POPULATED DOCUMENT. The empty-document drive reaches the citation, TOA,
// numeral and paragraph sites only as far as their "nothing found" message,
// which proves nothing about the code that edits the document. This text has
// authorities (a case, Id., a statute, a law-review article), figure and table
// captions, reference numerals, and numbered-looking paragraphs.
const BRIEF = [
  "ARGUMENT",
  "The claimed housing 10 couples to the lid 12, as FIG. 1 shows.",
  "Figure 1: Exploded view of the housing",
  "Table 1: Measured torque",
  "See Brown v. Board of Education, 347 U.S. 483, 495 (1954).",
  "Id. at 496.",
  "The statute is clear. 35 U.S.C. § 103 (2018).",
  "John Smith, Obviousness Revisited, 100 Harv. L. Rev. 1, 15 (1990).",
  "Graham v. John Deere Co., 383 U.S. 1, 17 (1966).",
  "[0001] The invention relates to housings.",
  "[0002] The lid 12 is hinged.",
].join("\r");

// Keys and field codes are written with String.raw so no backslash can be lost
// to a string escape: "\.text$" as a plain literal is the regex ".text$", and
// a field code " TA \l ..." would silently become " TA l ...".
module.exports = {
  [String.raw`\.text$`]: BRIEF,
  [String.raw`\.paragraphs\.items$`]: { __items: BRIEF.split("\r").map((t) => ({ text: t })) },
  [String.raw`\.fields\.items$`]: {
    __items: [
      { code: String.raw` TA \l "Brown v. Board of Education, 347 U.S. 483 (1954)" \s "Brown" \c 1 ` },
      { code: String.raw` TOA \h \c "1" \p ` },
      { code: String.raw` TOC \o "1-3" \h ` },
    ],
  },
  [String.raw`\.tables\.items$`]: { __items: [{ values: [["x", "y"], ["1", "2.1"], ["2", "3.9"], ["3", "6.2"]], rowCount: 4 }] },
  [String.raw`\.footnotes\.items$`]: { __items: [{}] },
  // An existing citation marker and a bibliography block in the main text, so
  // the renumbering pass has a marker to REWRITE and a block to REPLACE (the
  // v2.146.0 review found both untraced). Only the body's own controls match:
  // getByTag results and footnote bodies are named differently.
  [String.raw`document\.body\.contentControls\.items$`]: {
    __items: [
      { tag: "formula-inserter:cite:1", text: "[9]" },
      { tag: "formula-inserter:bibliography", text: "References (stale)" },
    ],
  },
  // What each Office dialog sends back, by page. The large canvas returns a 3D
  // model of ethanol (OCL idcode), which inserts through insertDraw3d.
  __dialogs: {
    "drawdialog.html": JSON.stringify({
      mol3d: { idcode: "eMHAIh@", style: "ballstick", showH: true, showLabels: true, rot: [1, 0, 0, 0, 1, 0, 0, 0, 1], zoom: 1 },
    }),
    // The large Drawing (CAD) canvas hands back a model with "Insert": the pane
    // loads it and inserts the sheet (a dialog has no document access).
    "caddialog.html": JSON.stringify({
      doc: JSON.stringify({
        v: 1,
        parts: [{ id: "p1", name: "Block", shape: "box", params: { w: 40, d: 30, h: 20 }, placement: { translate: [0, 0, 0], rotateDeg: [0, 0, 0] } }],
        callouts: [],
        standard: "asme",
        views: [{ kind: "front" }, { kind: "top" }],
      }),
      insert: true,
    }),
  },
};
