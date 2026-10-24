// R2b must not change a drawing without a sheet format: every sheet v2.148.0 drew
// (fixtures/cadSheet-v2148.json, written by that release's code) is drawn again
// with the same elements. Two differences are deliberate and normalised here:
//   - the elements now sit in named layer groups, so they are compared as a set;
//   - the projection symbol's axis is now a true centre line (ISO 128-20 type 04,
//     24d/3d/0.5d/3d; ASME center) instead of 12/3/1/3, and dashed lines say
//     stroke-linecap="butt" (SVG's default) out loud.
import * as fs from "fs";
import * as path from "path";
import { Assembly, Body, BodySpec, box, IDENTITY_PLACEMENT, Placement, tessellate, Mesh } from "../cadModel";
import { layoutSheet, ViewSpec } from "../cadSheet";
import { StandardId } from "../cadStandards";

let n = 0;
const body = (spec: BodySpec, placement: Placement = IDENTITY_PLACEMENT): Body => ({ id: `b${++n}`, name: `b${n}`, spec, placement });
const meshOf = (...bodies: Body[]): Mesh => {
  const r = tessellate({ version: 1, bodies } as Assembly);
  if (!r.ok) throw new Error(r.reason);
  return r.mesh;
};
const GOLDEN: Record<string, string> = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "cadSheet-v2148.json"), "utf8"));

/** The drawn elements, normalised as described above, sorted. */
function elements(svg: string): string[] {
  const out = [...svg.matchAll(/<(?:path|circle|rect)\b[^>]*\/>|<text\b[^>]*>[^<]*<\/text>/g)].map((m) =>
    m[0]
      .replace(/ stroke-linecap="butt"/g, "")
      // A path with no fill of its own is the symbol's axis (it inherits fill="none" from its group).
      .replace(/^(<path(?![^>]*fill=)[^>]*stroke-dasharray=")[^"]*"/, '$1*"'),
  );
  return out.sort();
}

describe("a drawing without a sheet format is drawn as v2.148.0 drew it", () => {
  const L = meshOf(body(box(4, 2, 1)), body(box(4, 0.5, 3), { translate: [0, 1.5, 0], rotateDeg: [0, 0, 0] }));
  const views: ViewSpec[] = [{ kind: "front" }, { kind: "top" }, { kind: "right" }, { kind: "iso" }];
  // The USPTO sheets changed ON PURPOSE in fix2-cad: 37 CFR 1.84(u)(2) wants view numbers larger than the reference
  // numerals, so FIG. labels are now 1.6 × the numerals and the rows taller to hold them. They are pinned in
  // cad2Fixes.test.ts instead; every other standard must still draw exactly as v2.148.0 did.
  it.each(Object.keys(GOLDEN).filter((k) => k !== "asme|one" && !k.startsWith("uspto|")))("%s", (key) => {
    const [standard, hid, withCallouts] = key.split("|");
    const showHidden = hid === "undefined" ? undefined : hid === "true";
    const sh = layoutSheet(L, {
      standard: standard as StandardId,
      views,
      ...(showHidden === undefined ? {} : { showHidden }),
      callouts: withCallouts === "true" ? [{ anchor: [2, 0, 0.5], label: "10" }, { anchor: [2, 1.75, 3], label: "12" }] : [],
    });
    expect(elements(GOLDEN[key]).length).toBeGreaterThan(4); // the comparison has something to compare (plain: 4 views + the sheet)
    expect(elements(sh.svg)).toEqual(elements(GOLDEN[key]));
    // Same canvas size, to the hundredth of a pixel.
    expect(sh.svg.slice(0, 120)).toBe(GOLDEN[key].slice(0, 120));
  });
  it("one view", () => {
    expect(elements(layoutSheet(L, { standard: "asme", views: [{ kind: "front" }] }).svg)).toEqual(elements(GOLDEN["asme|one"]));
  });
});
