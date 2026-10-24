// Release D (canvas): the render-level pin table. Recorded on v2.188.0 (1fd68ff) BEFORE any Release D change: each
// row is the SHA-1 (first 16 hex) of the SVG renderCdx draws for a page, and of the CDXML the editor writes for it.
// Uncharged pages and the reaction / equilibrium / retrosynthetic / resonance arrows must stay byte-identical; a row
// that changes is an intended change and is listed in INTENDED below with its reason (never silently re-recorded).
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { readCdxmlTree, CdxDoc } from "../cdxml";
import { readCdx } from "../cdx";
import { renderCdx } from "../cdxmlRender";
import { addBrackets, blankPageCdxml, findById, setAtomLabel, writeCdxml } from "../cdxmlEdit";
import { moleculeToPage } from "../cdxmlMol";
import { addMetalloceneTemplate } from "../organometal";
import { Molecule } from "openchemlib/full";
import { scene, Scene, L, open } from "./mechScenes";
import { chargeGlyph, glyph, labelInk, pageCharges, segBoxDist, textInk, CHARGE_GAP } from "../cdxGlyphs";
import type { Box, CdxNode, Pt } from "../cdxml";

const sha = (s: string): string => createHash("sha1").update(s).digest("hex").slice(0, 16);

const fixture = (f: string): CdxDoc => {
  const r = readCdx(new Uint8Array(readFileSync(join(__dirname, "fixtures", f))));
  if (!r.ok) throw new Error(r.reason);
  const d = readCdxmlTree(r.root);
  if (!d.ok) throw new Error(d.reason);
  return d.doc;
};

const cell = (k: number): [number, number] => [60 + (k % 4) * 70, 60 + Math.floor(k / 4) * 70];

/** Editor-built pages: name → builder. */
const PAGES: Record<string, (m: Scene) => void> = {
  "rings and a chain": (m) => {
    m.ring([100, 100], "benzene");
    m.ring([160, 100], "cyclohexane");
    const s = m.seed([200, 100]);
    const a = m.bond(s.n2, 30);
    m.bond(a.n, 330, null, "2");
  },
  "OH both sides, NH2, Cl, F, I": (m) => {
    const s = m.seed([100, 100]);
    m.bond(s.n1, 210, "O");
    m.bond(s.n2, 30, "OH");
    const t = m.seed([100, 150]);
    m.bond(t.n1, 210, "N");
    m.bond(t.n2, 30, "Cl");
    const u = m.seed([100, 200]);
    m.bond(u.n1, 210, "F");
    m.bond(u.n2, 30, "I");
  },
  "CH3–Br": (m) => {
    const br = m.atom([114.4, 100], "Br");
    m.bond(br, 180, "CH3");
  },
  "Br–Br horizontal": (m) => {
    const a = m.atom([100, 100], "Br");
    m.bond(a, 0, "Br");
  },
  "Br–Br at 12 angles": (m) => {
    for (let k = 0; k < 12; k++) {
      const a = m.atom(cell(k), "Br");
      m.bond(a, k * 30, "Br");
    }
  },
  "H3C on the left, OMe group": (m) => {
    const s = m.seed([100, 100]);
    m.bond(s.n1, 210, "CH3");
    m.bond(s.n2, 30, "OMe");
    const t = m.seed([100, 150]);
    m.bond(t.n1, 210, "OMe");
  },
  "caption and brackets": (m) => {
    m.caption([60, 200], "Scheme 1. NaBH4, MeOH");
    const s = m.seed([100, 100]);
    m.bond(s.n2, 30);
    m.bond(s.n1, 210);
    m.re();
    const e = addBrackets(m.doc, [95, 85, 118, 115], "n");
    if (e) throw new Error(e);
  },
  "reaction, equilibrium, retrosynthetic, resonance arrows": (m) => {
    m.straight([60, 100], [120, 100], "reaction");
    m.straight([60, 130], [120, 130], "equilibrium");
    m.straight([60, 160], [120, 160], "retrosynthetic");
    m.straight([60, 190], [120, 190], "resonance");
  },
  // ---- the defect rows (charged labels): expected to change in Release D ----
  "E⁺, Br⁺, N⁺, OH⁻, NO2⁺ standalone": (m) => {
    m.charge(m.atom([60, 60], "E"), 1);
    m.charge(m.atom([100, 60], "Br"), 1);
    m.charge(m.atom([140, 60], "N"), 1);
    m.charge(m.atom([180, 60], "OH"), -1);
    m.charge(m.atom([220, 60], "NO2"), 1);
  },
  "N⁺ in a chain, C⁺ on a ring": (m) => {
    const s = m.seed([100, 100]);
    const n = m.bond(s.n2, 30, "N");
    m.bond(n.n, 330);
    m.charge(n.n, 1);
    m.ring([100, 160], "cyclohexane");
    m.charge(m.nodeNear([92.8, 147.53]), 1);
  },
  "O⁻ with its bond at 12 directions": (m) => {
    for (let k = 0; k < 12; k++) {
      const o = m.atom(cell(k), "O");
      m.charge(o, -1);
      const c = m.bond(o, k * 30 + 90);
      m.bond(c.n, k * 30 + 90 + 60);
      m.bond(c.n, k * 30 + 90 - 60);
    }
  },
};

const HEAD = '<CDXML CreationProgram="Test" BondLength="14.4" LineWidth="0.6" BoldWidth="2" HashSpacing="2.5" MarginWidth="1.6" LabelFont="3" LabelSize="10" CaptionFont="3" CaptionSize="10"><fonttable><font id="3" name="Arial"/></fonttable><page id="1" BoundingBox="0 0 540 720">';
/** Hand-written files (their own label boxes, as a ChemDraw file carries them). */
const FILES: Record<string, string> = {
  "file: OH⁻ and CH3–Br with their own boxes":
    HEAD +
    '<fragment id="20"><n id="21" p="60 100" Element="8" Charge="-1" NumHydrogens="1"><t p="56.4 103.5" BoundingBox="56.4 95 70.8 105" LabelJustification="Left"><s font="3" size="10" face="96">OH</s></t></n></fragment>' +
    '<fragment id="30"><n id="31" p="100 100"/><n id="32" p="114.4 100" Element="35" NumHydrogens="0"><t p="110.8 103.5" BoundingBox="110.8 95 123.6 105" LabelJustification="Left"><s font="3" size="10" face="96">Br</s></t></n><b id="33" B="31" E="32"/><n id="34" p="87.53 92.8"/><b id="35" B="34" E="31"/></fragment></page></CDXML>',
  "file: Br–Br whose label boxes overlap the bond":
    HEAD +
    '<fragment id="20"><n id="21" p="100 100" Element="35" NumHydrogens="0"><t p="96.4 103.5" BoundingBox="96.4 95 109.2 105" LabelJustification="Left"><s font="3" size="10" face="96">Br</s></t></n>' +
    '<n id="22" p="114.4 100" Element="35" NumHydrogens="0"><t p="110.8 103.5" BoundingBox="110.8 95 123.6 105" LabelJustification="Left"><s font="3" size="10" face="96">Br</s></t></n><b id="23" B="21" E="22"/></fragment></page></CDXML>',
  "file: an uncharged ring and an N label":
    HEAD +
    '<fragment id="80"><n id="81" p="40 100" Element="7" NumHydrogens="0"><t p="36.4 103.5" BoundingBox="36.4 95 42.9 105" LabelJustification="Left"><s font="3" size="10" face="96">N</s></t></n></fragment>' +
    '<fragment id="90"><n id="200" p="87.47 107.20"/><n id="201" p="75.00 114.40"/><n id="202" p="62.53 107.20"/><n id="203" p="62.53 92.80"/><n id="204" p="75.00 85.60"/><n id="205" p="87.47 92.80"/>' +
    '<b id="210" B="200" E="201"/><b id="211" B="201" E="202" Order="2"/><b id="212" B="202" E="203"/><b id="213" B="203" E="204" Order="2"/><b id="214" B="204" E="205"/><b id="215" B="205" E="200" Order="2"/></fragment></page></CDXML>',
};

/** Recorded on 1fd68ff. [svg, cdxml]. */
const PINS: Record<string, [string, string]> = {
  "fixture US08262949-C00020.cdx": ["56fae259724ebbf0", ""],
  "fixture US12128110-C00013.cdx": ["f264c7a5950fe577", ""],
  "rings and a chain": ["9a467b94247ee9a6", "3c4303c9aabdb9c0"],
  "OH both sides, NH2, Cl, F, I": ["83e3931988d0d8f7", "1b131bc96233f5b9"],
  "CH3–Br": ["d046e7dc26e5e42d", "4f299394f120d861"],
  "Br–Br horizontal": ["3710faeb08577960", "b7b650a2a89d7a8e"],
  "Br–Br at 12 angles": ["23c93d91bec922f2", "304e3cd57d104f67"],
  "H3C on the left, OMe group": ["c087f1c7dbdddbfb", "584eb5fbf34b03e8"],
  "caption and brackets": ["9641b39448083a57", "235e305ec94a2c53"],
  "reaction, equilibrium, retrosynthetic, resonance arrows": ["c5c9b0e9ffbb5bec", "c04b51df852d3426"],
  "E⁺, Br⁺, N⁺, OH⁻, NO2⁺ standalone": ["dfc9b488798ce235", "3c186270319de791"],
  "N⁺ in a chain, C⁺ on a ring": ["88645702695c2f79", "006f59abb3d10715"],
  "O⁻ with its bond at 12 directions": ["4333ddba2417eac5", "ed39afd85b8f0e99"],
  "file: OH⁻ and CH3–Br with their own boxes": ["ce73361ad559f670", ""],
  "file: Br–Br whose label boxes overlap the bond": ["070ed481ef31ee6c", ""],
  "file: an uncharged ring and an N label": ["220bb1cc16d51441", ""],
};

/** Rows whose bytes Release D changes on purpose, and why. */
const INTENDED: Record<string, string> = {
  // Label boxes the editor writes now come from Arial's own advances and ink (cdxGlyphs.labelGeometry) instead of
  // 0.72 / 0.56 / 0.42 em a capital / lowercase / digit and ±0.5 em round the atom: every editor-made label's box (and
  // so where its bonds stop, and its p for a right-justified label) changes. The text itself is drawn where it was.
  "OH both sides, NH2, Cl, F, I": "label boxes from the glyph model",
  "CH3–Br": "label boxes from the glyph model (Br was 2.7 pt too wide)",
  "Br–Br horizontal": "label boxes from the glyph model: the bond no longer runs into the second Br",
  "Br–Br at 12 angles": "label boxes from the glyph model; where the two labels nearly touch, a short tick 1.2 pt off the letters (it ran backwards into them)",
  "H3C on the left, OMe group": "label boxes from the glyph model",
  // Charges: set CHARGE_GAP (0.12 label size) from the label's letters, in the first free place of upper right, upper
  // left, lower right, lower left, above, below (a bond within 0.22 bond length of the sign moves it on).
  "E⁺, Br⁺, N⁺, OH⁻, NO2⁺ standalone": "label boxes, and the sign 0.12 em from the letters' ink (it sat 2.6 pt past an over-wide box)",
  "N⁺ in a chain, C⁺ on a ring": "the N's hydrogens stacked below it (its bonds leave both sides, as ChemDraw stacks them); the ring carbon's + 0.3 bond length out on the bisector of its widest opening (outside the ring)",
  "O⁻ with its bond at 12 directions": "label boxes; the minus moves off the bond where the bond leaves up-right or right (it read O=)",
  "file: OH⁻ and CH3–Br with their own boxes": "the minus 0.12 em from the letters' ink (the file's own boxes are kept)",
  "file: Br–Br whose label boxes overlap the bond": "the boxes (with margins) overlap along the bond: it is clipped 1.2 pt off the letters' ink instead of running backwards into the second B",
};

/** The intended rows' bytes as Release D leaves them [svg, cdxml]: the final state, locked. */
const AFTER: Record<string, [string, string]> = {
  "OH both sides, NH2, Cl, F, I": [
    "66d0e3f9e9f97f19",
    "6d90ae172c6d340b"
  ],
  "CH3–Br": [
    "377b25b41cc0759a",
    "0c034d3a05726842"
  ],
  "Br–Br horizontal": [
    "fab4c4c4d911273d",
    "9042f0882bb28760"
  ],
  "Br–Br at 12 angles": [
    "0d1b29e706dace14",
    "e563a81599e49d20"
  ],
  "H3C on the left, OMe group": [
    "4fa238e4ee02a20a",
    "568fe3906af715fd"
  ],
  "E⁺, Br⁺, N⁺, OH⁻, NO2⁺ standalone": [
    "bbab6eff47003d51",
    "1f23e66c7843a345"
  ],
  "N⁺ in a chain, C⁺ on a ring": [
    "8421f81c05ea33fd",
    "d381474eeab76a2e"
  ],
  "O⁻ with its bond at 12 directions": [
    "98c3b114226ccb38",
    "8598964d2a9384fe"
  ],
  "file: OH⁻ and CH3–Br with their own boxes": [
    "bab41ee258ddd583",
    ""
  ],
  "file: Br–Br whose label boxes overlap the bond": [
    "00fb4fd149384d89",
    ""
  ]
};

const computed = (): Record<string, [string, string]> => {
  const out: Record<string, [string, string]> = {};
  for (const f of ["US08262949-C00020.cdx", "US12128110-C00013.cdx"]) out["fixture " + f] = [sha(renderCdx(fixture(f))!.svg), ""];
  for (const [name, src] of Object.entries(FILES)) out[name] = [sha(renderCdx(open(src))!.svg), ""];
  for (const [name, build] of Object.entries(PAGES)) {
    const m = scene();
    build(m);
    const d = m.re();
    out[name] = [sha(renderCdx(d)!.svg), sha(writeCdxml(d.root))];
  }
  return out;
};

describe("Release D pin table: today's SVG for every row", () => {
  const now = computed();
  if (process.env.PIN_PRINT) console.log(JSON.stringify(now, null, 1));
  test.each(Object.keys(now))("%s", (name) => {
    expect(PINS[name]).toBeDefined();
    if (INTENDED[name]) {
      // An intended change: it must really differ from the recording (else the entry is stale).
      expect(now[name]).not.toEqual(PINS[name]);
      expect(now[name]).toEqual(AFTER[name]);
    } else expect(now[name]).toEqual(PINS[name]);
  });
  test("the bond length the scenes use is the page's", () => expect(L).toBe(14.4));
});
// ---- measured label geometry (the defect rows' AFTER, as numbers) ----------------------------------------------------
// Oracle for the glyph table: Arial's own glyf / hmtx tables, dumped with fontTools (statvenv):
//   f = TTFont(r"C:\Windows\Fonts\arial.ttf"); upm = 2048; for ch: adv, lsb = f["hmtx"][g]; gl = f["glyf"][g]
//   -> round(v * 1000 / upm) for adv, xMin, yMin, xMax, yMax.
// ChemDraw's own label boxes run from the text's start to its advance end and from the cap height to the baseline:
// in the Times fixture US12128110-C00013.cdx the "B" label's box is 4.65 pt wide and 4.65 pt tall at 7 pt (Times B:
// advance 0.667 em = 4.67 pt, cap height 0.662 em = 4.63 pt). The editor writes boxes the same way.
const nodesOf = (d: CdxDoc): CdxNode[] => d.objects.flatMap((o) => o.items).flatMap((it) => (it.kind === "fragment" ? it.v.nodes : []));
const nbrsOf = (d: CdxDoc, id: string): Pt[] => {
  const ns = new Map(nodesOf(d).map((n) => [n.id, n.p]));
  const out: Pt[] = [];
  for (const o of d.objects) for (const it of o.items) if (it.kind === "fragment") for (const b of it.v.bonds) if (b.b === id || b.e === id) out.push(ns.get(b.b === id ? b.e : b.b)!);
  return out;
};
const boxGap = (a: Box, b: Box): number => Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]));
const segDist = (p: Pt, a: Pt, b: Pt): number => {
  const d = [b[0] - a[0], b[1] - a[1]], L2 = d[0] * d[0] + d[1] * d[1];
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L2)) : 0;
  return Math.hypot(p[0] - a[0] - t * d[0], p[1] - a[1] - t * d[1]);
};
const segBox = (a: Pt, b: Pt, bx: Box): number => {
  let m = Infinity;
  for (let i = 0; i <= 40; i++) {
    const q: Pt = [a[0] + ((b[0] - a[0]) * i) / 40, a[1] + ((b[1] - a[1]) * i) / 40];
    m = Math.min(m, Math.hypot(Math.max(0, bx[0] - q[0], q[0] - bx[2]), Math.max(0, bx[1] - q[1], q[1] - bx[3])));
  }
  return m;
};
const svgLines = (svg: string): Array<[Pt, Pt]> => [...svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)].map((m) => [[+m[1], +m[2]], [+m[3], +m[4]]]);

describe("label geometry, measured", () => {
  test("glyph table spot rows equal the fontTools dump of arial.ttf", () => {
    expect(glyph("B")).toEqual({ adv: 0.667, ink: [0.073, 0, 0.614, 0.716] });
    expect(glyph("r")).toEqual({ adv: 0.333, ink: [0.065, 0, 0.347, 0.53] });
    expect(glyph("O")).toEqual({ adv: 0.778, ink: [0.048, -0.012, 0.733, 0.729] });
    expect(glyph("+")).toEqual({ adv: 0.584, ink: [0.056, 0.116, 0.528, 0.589] });
    expect(glyph("−")).toEqual({ adv: 0.584, ink: [0.056, 0.312, 0.528, 0.394] });
    expect(glyph(" ").ink).toBeNull();
  });
  test.each(["Br", "E", "N", "O", "Cl"])("the editor writes %s's box (on a chain end) from its letters' advances and ink height, the first letter centred on the atom", (lab) => {
    const m = scene();
    const s0 = m.seed([100, 100]);
    const at = m.bond(s0.n2, 30, lab).n;
    const d = m.re();
    const n = nodesOf(d).find((q) => q.id === at)!;
    const text = n.label!.runs.map((r) => r.text).join("");
    const bx = n.label!.box!;
    // Digits (hydrogen counts) are set at 0.75 size.
    const adv = [...text].reduce((w, ch) => w + glyph(ch).adv * (/[0-9]/.test(ch) ? 7.5 : 10), 0);
    expect(bx[2] - bx[0]).toBeCloseTo(adv, 1);
    const top = Math.max(...[...text].filter((ch) => !/[0-9]/.test(ch)).map((ch) => glyph(ch).ink![3])) * 10;
    expect(n.label!.p![1] - bx[1]).toBeCloseTo(top, 1);
    expect(bx[0]).toBeCloseTo(n.p[0] - (glyph(text[0]).adv * 10) / 2, 1);
  });
  test.each([
    ["E", 1],
    ["Br", 1],
    ["N", 1],
    ["OH", -1],
    ["NO2", 1],
  ] as const)("%s (charge %i, no bonds): the sign upper right, %f label size from the letters' ink", (lab, q) => {
    const m = scene();
    const id = m.atom([100, 100], lab);
    m.charge(id, q);
    const d = m.re();
    const n = nodesOf(d).find((z) => z.id === id)!;
    const ink = labelInk(d.fonts, n)!;
    const g = chargeGlyph(d.style, n, { nbrs: [], fonts: d.fonts });
    expect(g.box[0] - ink[2]).toBeCloseTo(CHARGE_GAP * 10, 2);
    // A superscript: the sign's middle above the letters' middle.
    expect((g.box[1] + g.box[3]) / 2).toBeLessThan((ink[1] + ink[3]) / 2 - 2);
    // The renderer sets it there.
    expect(renderCdx(d)!.svg).toContain(`<text x="${Math.round(g.at[0] * 100) / 100}" y="${Math.round(g.at[1] * 100) / 100}"`);
  });
  test.each(Array.from({ length: 12 }, (_, k) => k))("O⁻ with its bond leaving at %i × 30° + 90°: the minus 0.22 bond length off every bond, in the bond-free sector", (k) => {
    const m = scene();
    const o = m.atom([100, 100], "O");
    m.charge(o, -1);
    const c = m.bond(o, k * 30 + 90);
    m.bond(c.n, k * 30 + 90 + 60);
    m.bond(c.n, k * 30 + 90 - 60);
    const d = m.re();
    const n = nodesOf(d).find((z) => z.id === o)!;
    const g = chargeGlyph(d.style, n, { nbrs: nbrsOf(d, o), fonts: d.fonts, doc: d });
    for (const q of nbrsOf(d, o)) expect(segBox(n.p, q, g.box)).toBeGreaterThanOrEqual(0.22 * L - 1e-9);
    // Beside the letters, CHARGE_GAP from their ink (never on the far side of the bond).
    expect(boxGap(g.box, labelInk(d.fonts, n)!)).toBeCloseTo(1.2, 1);
  });
  test.each(Array.from({ length: 12 }, (_, k) => k))("Br–Br at %i × 30°: a bond is drawn, and it stops ≥ 0.9 pt (ink to ink) short of both labels' letters", (k) => {
    const m = scene();
    const a = m.atom([100, 100], "Br");
    const b = m.bond(a, k * 30, "Br");
    const d = m.re();
    const lines = svgLines(renderCdx(d)!.svg);
    expect(lines).toHaveLength(1);
    const inks = [a, b.n].map((id) => labelInk(d.fonts, nodesOf(d).find((z) => z.id === id)!)!);
    // The line's round cap reaches half a line width past its end.
    for (const ink of inks) expect(segBox(lines[0][0], lines[0][1], ink) - 0.3).toBeGreaterThanOrEqual(0.9 - 0.006); // coordinates are written to 0.01 pt
  });
  test("CH3–Br: both ends stop the page margin (1.6 pt) from the labels' boxes, and ≥ 1.5 pt from their ink", () => {
    const m = scene();
    const br = m.atom([114.4, 100], "Br");
    const c = m.bond(br, 180, "CH3");
    const d = m.re();
    const [ln] = svgLines(renderCdx(d)!.svg);
    for (const id of [br, c.n]) {
      const n = nodesOf(d).find((z) => z.id === id)!;
      expect(segBox(ln[0], ln[1], n.label!.box!)).toBeCloseTo(1.6, 1);
      expect(segBox(ln[0], ln[1], textInk(d.fonts, n.label!, n)!)).toBeGreaterThanOrEqual(1.5);
    }
  });
  test("a file's Br–Br whose boxes overlap along the bond: one forward segment, ≥ 0.9 pt off both B's and r's ink", () => {
    const d = open(FILES["file: Br–Br whose label boxes overlap the bond"]);
    const lines = svgLines(renderCdx(d)!.svg);
    expect(lines).toHaveLength(1);
    expect(lines[0][1][0]).toBeGreaterThan(lines[0][0][0]);
    for (const n of nodesOf(d)) expect(segBox(lines[0][0], lines[0][1], textInk(d.fonts, n.label!, n)!) - 0.3).toBeGreaterThanOrEqual(0.9 - 0.006); // coordinates are written to 0.01 pt
  });
  test("a label in a face the model does not describe (Times, the fixture) falls back to its file box", () => {
    const d = fixture("US12128110-C00013.cdx");
    const n = nodesOf(d).find((z) => z.label && z.label.runs.map((r) => r.text).join("") === "B")!;
    expect(textInk(d.fonts, n.label!, n)).toBeNull();
    expect(labelInk(d.fonts, n)).toEqual(n.label!.box);
    void segDist;
  });
});

// ---- hydrogens away from the bonds; bare-carbon charges near their atom (coordinator pass) ---------------------------
/** The side a label's hydrogens are drawn on, as an angle from the atom (null: no hydrogens drawn apart). */
const hAngle = (n: CdxNode): number | null => {
  const t = n.label!;
  const text = t.runs.map((r) => r.text).join("");
  if (!/H/.test(text) || /^H\d*$/.test(text)) return null;
  if (t.el.attrs.LabelAlignment === "Below") return Math.PI / 2;
  if (t.el.attrs.LabelAlignment === "Above") return -Math.PI / 2;
  return t.justify === "Right" ? Math.PI : 0;
};
const angleOff = (a: number, d: number): number => Math.abs(Math.atan2(Math.sin(a - d), Math.cos(a - d)));
/** Every rendered bond line ≥ 0.9 pt (ink to ink, round caps counted) from every label's letters and every charge sign. */
const glyphsClear = (d: CdxDoc): string[] => {
  const out: string[] = [];
  const lines = svgLines(renderCdx(d)!.svg);
  for (const n of nodesOf(d)) {
    const boxes: Box[] = [];
    const ink = n.label ? labelInk(d.fonts, n) : null;
    if (ink) boxes.push(ink);
    if (n.charge) boxes.push(chargeGlyph(d.style, n, { nbrs: nbrsOf(d, n.id), fonts: d.fonts, doc: d }).box);
    for (const bx of boxes) for (const [a, b] of lines) if (segBox(a, b, bx) - 0.3 < 0.9 - 0.006) out.push(`${n.id} ${(segBox(a, b, bx) - 0.3).toFixed(2)}`);
  }
  return out;
};

describe("hydrogens on the side away from the bonds; every bond clear of every glyph", () => {
  const ends: Array<[string, string, number]> = [["NH2", "N", 0], ["NH3⁺", "N", 1], ["OH", "O", 0], ["SH", "S", 0], ["CO2H", "CO2H", 0]];
  for (const [name, lab, q] of ends)
    test.each(Array.from({ length: 12 }, (_, k) => k))(`${name} on a chain end, its bond leaving at %i × 30°`, (k) => {
      const m = scene();
      const a = m.atom([100, 100], "C");
      const at = m.bond(a, k * 30 + 180, lab).n;
      if (q) m.charge(at, q);
      const d = m.re();
      expect(glyphsClear(d)).toEqual([]);
      const n = nodesOf(d).find((z) => z.id === at)!;
      const h = hAngle(n);
      // The hydrogens never on the bond's side: at least 60° from it (a vertical bond: either side, 90°).
      if (h !== null && lab !== "CO2H") for (const p of nbrsOf(d, at)) expect(angleOff(h, Math.atan2(p[1] - n.p[1], p[0] - n.p[0]))).toBeGreaterThanOrEqual(Math.PI / 3 - 1e-6);
    });
  test.each(Array.from({ length: 24 }, (_, i): [number, number] => [i % 12, i < 12 ? 0 : 1]))(
    "N in a chain (its bonds 120° apart, turned %i × 30°; charge %i): its H's at least 60° from both bonds, stacked where neither side is free",
    (k, q) => {
      const m = scene();
      const nId = m.atom([100, 100], "N");
      m.bond(nId, k * 30);
      m.bond(nId, k * 30 + 120);
      if (q) m.charge(nId, q);
      const d = m.re();
      const n = nodesOf(d).find((z) => z.id === nId)!;
      const h = hAngle(n)!;
      expect(h).not.toBeNull();
      for (const p of nbrsOf(d, nId)) expect(angleOff(h, Math.atan2(p[1] - n.p[1], p[0] - n.p[0]))).toBeGreaterThanOrEqual(Math.PI / 3 - 1e-6);
      expect(glyphsClear(d)).toEqual([]);
      // A stacked label is written as ChemDraw writes one: centre-justified, LabelAlignment Below / Above.
      if (Math.abs(Math.sin(h)) > 0.5) expect(n.label!.justify).toBe("Center");
    },
  );
  test.each([
    ["chain-end CH2⁺", (m: Scene) => {
      const s = m.seed([100, 100]);
      m.charge(m.bond(s.n2, 30).n, 1);
    }],
    ["isopropyl cation", (m: Scene) => {
      const s = m.seed([100, 100]);
      m.bond(s.n2, 30);
      m.charge(s.n2, 1);
    }],
    ["ring C⁺", (m: Scene) => {
      m.ring([100, 100], "cyclohexane");
      m.charge(m.nodeNear([92.8, 87.53]), 1);
    }],
  ] as const)("a bare carbon's charge (%s): 0.28–0.32 bond length out (centre), in the widest opening, ≥ 1 pt from every bond line", (_n, build) => {
    const m = scene();
    build(m);
    const d = m.re();
    const n = nodesOf(d).find((z) => z.charge)!;
    const g = chargeGlyph(d.style, n, { nbrs: nbrsOf(d, n.id), fonts: d.fonts, doc: d });
    const c: Pt = [(g.box[0] + g.box[2]) / 2, (g.box[1] + g.box[3]) / 2];
    const r = Math.hypot(c[0] - n.p[0], c[1] - n.p[1]);
    expect(r).toBeGreaterThanOrEqual(0.28 * L);
    expect(r).toBeLessThanOrEqual(0.32 * L);
    for (const p of nbrsOf(d, n.id)) expect(segBox(n.p, p, g.box) - 0.3).toBeGreaterThanOrEqual(1 - 1e-6);
    // In the widest opening: no bond nearer its direction than half that opening.
    const dirs = nbrsOf(d, n.id).map((p) => Math.atan2(p[1] - n.p[1], p[0] - n.p[0]));
    const a = Math.atan2(c[1] - n.p[1], c[0] - n.p[0]);
    expect(Math.min(...dirs.map((x) => angleOff(a, x)))).toBeGreaterThanOrEqual(Math.PI / 3 - 0.05);
  });
});

// ---- salts and zwitterions: no charge sign on anyone else's ink (final review, round 2) ------------------------------
// The reviewer's 30 inputs (review-d2/ovl.ts), drawn as the canvas draws an OCL structure (moleculeToPage).
const SALTS = [
  "CC(=O)[O-].[Na+]", "[O-]C(=O)c1ccccc1.[Na+]", "Cc1ccc(cc1)S(=O)(=O)[O-].[Na+]", "[O-]c1ccccc1.[Na+]", "CC(C)(C)[O-].[K+]",
  "[O-]C([O-])=O.[K+].[K+]", "CC(=O)[O-].[NH4+]", "[F-].[Cs+]", "CCCC[N+](CCCC)(CCCC)CCCC.[Br-]", "c1cc[nH+]cc1.[Cl-]",
  "C[N+](C)(C)CC(=O)[O-]", "C[N+](C)(C)CCO.[Cl-]", "[Na+].[Cl-]", "[Li+].[OH-]", "CC[O-].[Na+]", "OC(=O)CC(O)(CC(=O)[O-])C(=O)[O-].[Na+].[Na+]",
  "[NH3+]CC(=O)[O-]", "[NH3+][C@@H](Cc1ccccc1)C(=O)[O-]", "[NH3+][C@@H](CCC(=O)[O-])C(=O)[O-]", "[O-][N+](=O)c1ccc(cc1)[N+](=O)[O-]",
  "C[S+](C)C.[I-]", "c1ccc(cc1)[P+](c1ccccc1)(c1ccccc1)C.[Br-]", "[O-][n+]1ccccc1", "C[N+]([O-])(C)C", "[O-]S(=O)(=O)[O-].[Na+].[Na+]",
  "OP(=O)([O-])[O-].[Na+].[Na+]", "N#[N+]c1ccccc1.F[B-](F)(F)F", "C1=CC=C[CH-]1.[Na+]", "CC(C)[N-]C(C)C.[Li+]", "[O-]Cl(=O)(=O)=O.[Na+]",
];
const saltPage = (smi: string): CdxDoc => {
  const d0 = open(blankPageCdxml());
  const r = moleculeToPage(d0, Molecule.fromSmiles(smi), [40, 40]);
  if (!r.ok) throw new Error(r.reason);
  const re = readCdxmlTree(d0.root);
  if (!re.ok) throw new Error(re.reason);
  return re.doc;
};
const gapOf = (a: Box, b: Box): number => Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]));

describe("charge signs on salts and zwitterions keep 1 pt off every other atom's letters, every other sign and every bond not their own", () => {
  test.each(SALTS)("%s", (smi) => {
    const d = saltPage(smi);
    const signs = pageCharges(d);
    const all = nodesOf(d);
    const bonds = d.objects.flatMap((o) => o.items).flatMap((it) => (it.kind === "fragment" ? it.v.bonds : []));
    const pos = new Map(all.map((n) => [n.id, n.p]));
    const problems: string[] = [];
    for (const [id, g] of signs) {
      for (const n of all) {
        if (n.id === id) continue;
        const ink = labelInk(d.fonts, n);
        if (ink && gapOf(g.box, ink) < 1 - 1e-6) problems.push(`${g.txt}@${id} on ${n.id}'s letters (${gapOf(g.box, ink).toFixed(2)})`);
      }
      for (const [id2, g2] of signs) if (id2 !== id && gapOf(g.box, g2.box) < 1 - 1e-6) problems.push(`${g.txt}@${id} on the sign of ${id2}`);
      for (const b of bonds) {
        if (b.b === id || b.e === id) continue;
        const dd = segBoxDist(pos.get(b.b)!, pos.get(b.e)!, g.box) - d.style.lineWidth / 2;
        if (dd < 1 - 1e-6) problems.push(`${g.txt}@${id} on bond ${b.id} (${dd.toFixed(2)})`);
      }
      // The renderer draws it there.
      expect(renderCdx(d)!.svg).toContain(`<text x="${Math.round(g.at[0] * 100) / 100}" y="${Math.round(g.at[1] * 100) / 100}"`);
      // The arrow planner and the canvas ask for the same place.
      expect(chargeGlyph(d.style, all.find((n) => n.id === id)!, { nbrs: nbrsOf(d, id), fonts: d.fonts, doc: d }).box).toEqual(g.box);
    }
    expect(problems).toEqual([]);
  });
});

// ---- the metallocene templates (Zr, and switched in place to Fe, Ti, Hf): locked ------------------------------------
// Intended change, accepted by the final review: the metal's label is set from the glyph model (it moved 0.55 pt) and the
// metal–ligand bonds, clipped at its now exact box, run a little closer to it. Hashes recorded after Release D.
const METALLOCENE: Record<string, string> = {
  "metallocene-dichloride Zr": "e4e9c1abd33e80d0",
  "metallocene-dichloride Fe": "02f90b18d4e1b0c8",
  "metallocene-dichloride Ti": "119b08678740729a",
  "metallocene-dichloride Hf": "45f8e5bb7fa0d37f",
  "ansa-metallocene Zr": "71f0d82876fb1172",
  "ansa-metallocene Fe": "9b1a05117502b1b5",
  "ansa-metallocene Ti": "44f279565c5c9770",
  "ansa-metallocene Hf": "3bf89d2df7e4ab55",
  "half-sandwich Zr": "c162f74ac3c1cd70",
  "half-sandwich Fe": "32b2b5b88d01b2b9",
  "half-sandwich Ti": "1e2771e4e99928c2",
  "half-sandwich Hf": "f60d945686e8c615",
  "metallocene-borohydride Zr": "fdda6499a67e5a06",
  "metallocene-borohydride Fe": "2dc64ec545c4e9bd",
  "metallocene-borohydride Ti": "20579c23e76ee43a",
  "metallocene-borohydride Hf": "4209d03008a47cad",
  "polymer-metallocene Zr": "f1c9dfc1402895ea",
  "polymer-metallocene Fe": "8f30a9fa2e4283ea",
  "polymer-metallocene Ti": "f83f05715e3c8159",
  "polymer-metallocene Hf": "6eefbb8c4c62ce83",
};
describe("metallocene templates: their drawing is locked (Release D state)", () => {
  for (const t of ["metallocene-dichloride", "ansa-metallocene", "half-sandwich", "metallocene-borohydride", "polymer-metallocene"])
    for (const metal of ["Zr", "Fe", "Ti", "Hf"])
      test(`${t} with ${metal}`, () => {
        const d = open(blankPageCdxml());
        expect(addMetalloceneTemplate(d, [120, 120], t as never)).toBeNull();
        if (metal !== "Zr") {
          let id = "";
          const walk = (x: { name: string; attrs: Record<string, string>; children: unknown[] }): void => {
            if (x.name === "n" && x.attrs.Element === "40") id = x.attrs.id;
            (x.children as Array<typeof x>).forEach(walk);
          };
          walk(d.root as never);
          expect(findById(d.root, id)).not.toBeNull();
          const r = setAtomLabel(d, id, metal);
          expect(r.ok).toBe(true);
        }
        const re = readCdxmlTree(d.root);
        if (!re.ok) throw new Error(re.reason);
        const h = sha(renderCdx(re.doc)!.svg);
        if (process.env.PIN_PRINT) console.log(`METAL "${t} ${metal}": "${h}",`);
        expect(h).toBe(METALLOCENE[`${t} ${metal}`]);
      });
});

export { PAGES, FILES };

