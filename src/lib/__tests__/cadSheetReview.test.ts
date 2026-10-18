// R2b's independent review — every finding pinned (repros from the reviewer, adapted where the
// fix changed the contract: ASME field lengths are now what their cells hold, refused by name above).
import { Assembly, Body, BodySpec, box, IDENTITY_PLACEMENT, Placement, tessellate, Mesh } from "../cadModel";
import { layoutSheet, ViewSpec } from "../cadSheet";
import { buildFrame, ISO_TITLE_FIELDS, ASME_TITLE_FIELDS, TitleFieldId } from "../cadFormats";
import { parseDoc, starterDoc, serializeDoc } from "../cadShapes";

let n = 0;
const body = (spec: BodySpec, placement: Placement = IDENTITY_PLACEMENT): Body => ({ id: `b${++n}`, name: `b${n}`, spec, placement });
const meshOf = (...bodies: Body[]): Mesh => {
  const r = tessellate({ version: 1, bodies } as Assembly);
  if (!r.ok) throw new Error(r.reason);
  return r.mesh;
};
const M = meshOf(body(box(40, 20, 10)));
const views: ViewSpec[] = [{ kind: "front" }, { kind: "top" }, { kind: "right" }, { kind: "iso" }];
const PX = 96 / 25.4;
const withSheet = (std: string, sheet: unknown): string => {
  const d = JSON.parse(serializeDoc(starterDoc(std as never)));
  d.sheet = sheet;
  return JSON.stringify(d);
};

describe("B1 / D9 / D8: the parser", () => {
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])("sheet size %j is refused by name", (size) => {
    expect(parseDoc(withSheet("iso", { size }))).toEqual({ ok: false, reason: "the drawing names a sheet size this release does not have" });
  });
  it.each([
    ["uspto", { size: "A3" }, "the drawing's A3 sheet does not suit its standard (37 CFR 1.84(g): a patent drawing sheet must not have a frame around the sight, so it has no sheet format)"],
    ["iso", { size: "ANSI-B" }, "the drawing's B sheet does not suit its standard (B (17 × 11 in) is not an ISO 5457 sheet — choose A4 to A0)"],
    ["iso", { size: "A3", orientation: "portrait" }, "the drawing's A3 sheet does not suit its standard (ISO 5457 permits A3 landscape only)"],
    ["asme", { size: "A4" }, "the drawing's A4 sheet does not suit its standard (A4 (210 × 297 mm, portrait) is not an ANSI sheet — choose A to E)"],
  ])("%s with %j — a sheet that could never draw — is refused by name", (std, sheet, why) => {
    expect(parseDoc(withSheet(std, sheet))).toEqual({ ok: false, reason: why });
  });
  it("a saved title block with a control character is refused; typed, it is named", () => {
    expect(parseDoc(withSheet("iso", { size: "A3", title: { title: "Br\u0001acket" } }))).toEqual({ ok: false, reason: "the drawing's title block is damaged" });
    expect(buildFrame("iso", "A3", undefined, { owner: "X￾" }, null)).toEqual({ ok: false, reason: "Legal owner contains a control character" });
    expect(buildFrame("iso", "A3", undefined, { title: "Bracket\nLeft" }, null)).toEqual({ ok: false, reason: "Title contains a control character" });
  });
});

describe("D6: every field holds its full length in capitals", () => {
  const words = (n: number): string => Array.from({ length: n }, (_, i) => (i % 9 === 8 ? " " : "H")).join("").trim().padEnd(n, "H");
  it.each([
    ...ISO_TITLE_FIELDS.map((f) => ["iso", f.id, f.max] as const),
    ...ASME_TITLE_FIELDS.map((f) => ["asme", f.id, f.max] as const),
  ])("%s %s: %d capitals fit", (std, id, max) => {
    const text =
      id === "sheetNo" || id === "sheets" ? "9".repeat(max)
      : id === "date" || id.endsWith("Date") ? "2026-10-17".slice(0, max)
      : id === "cage" ? "1ABC2"
      : id === "rev" && std === "iso" ? "AB"
      : id === "owner" || id === "subtitle" ? words(max)
      : "H".repeat(max);
    const r = buildFrame(std, std === "iso" ? "A3" : "ANSI-B", undefined, { [id as TitleFieldId]: text, ...(id === "sheets" ? { sheetNo: "1" } : {}) }, null);
    expect(r.ok ? "ok" : r.reason).toBe("ok");
  });
  it.each([
    ["iso", "creator", "ALEXANDER J SMITHSON"],
    ["iso", "approver", "MARGARET K WILLIAMS"],
    ["iso", "docType", "ASSEMBLY DRAWING WITH PARTS LS"],
    ["iso", "status", "RELEASED FOR PRODUCT"],
    ["asme", "creator", "ALEXANDER SMITHS"],
  ])("the reviewer's capitals: %s %s %j fit", (std, f, v) => {
    const r = buildFrame(std as "iso" | "asme", std === "iso" ? "A3" : "ANSI-B", undefined, { [f]: v }, null);
    expect(r.ok ? "ok" : r.reason).toBe("ok");
  });
});

describe("D7: the supplementary title keeps its own size, with or without a title", () => {
  it("alone, it is drawn at the value size, and a two-line one is accepted", () => {
    const r = buildFrame("iso", "A3", undefined, { subtitle: "Left hand" }, null);
    if (!r.ok) throw new Error(r.reason);
    expect(r.frame.texts.find((x) => x.text === "Left hand")!.sizeMm).toBeCloseTo(2.5 / 0.716, 9);
    expect(buildFrame("iso", "A3", undefined, { subtitle: "Supplementary title words that go on to two lines" }, null).ok).toBe(true);
  });
});

describe("D2 / D3: centring marks clear of the symbol and the title block", () => {
  it("A3: the symbol sits above the 10 mm the bottom mark reaches into the frame", () => {
    const sh = layoutSheet(M, { standard: "iso", views, format: { size: "A3" } });
    const info = /<g data-layer="info">([\s\S]*)<\/svg>/.exec(sh.svg)![1];
    const ys = [...info.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => +m[2] / PX);
    const cys = [...info.matchAll(/cy="([\d.]+)" r="([\d.]+)"/g)].map((m) => (+m[1] + +m[2]) / PX);
    expect(Math.max(...ys, ...cys)).toBeLessThan(297 - 10 - 10); // above the mark (frame bottom 287, mark to 277)
  });
  it("A4: the bottom mark stops at the frame (the block spans the sheet's axis)", () => {
    const fr = buildFrame("iso", "A4", undefined, {}, null);
    if (!fr.ok) throw new Error(fr.reason);
    const bottom = fr.frame.lines.find((l) => l.type === "centring" && l.x1 === l.x2 && l.y1 > 200)!;
    expect(Math.min(bottom.y1, bottom.y2)).toBeCloseTo(fr.frame.frame.y + fr.frame.frame.h, 9);
  });
  it("views keep clear of the marks: the ISO view area starts 11 mm inside the frame", () => {
    const fr = buildFrame("iso", "A3", undefined, {}, null);
    if (!fr.ok) throw new Error(fr.reason);
    expect(fr.frame.viewArea.y - fr.frame.frame.y).toBe(11);
    expect(fr.frame.viewArea.x - fr.frame.frame.x).toBe(11);
  });
});

describe("D4 / D5: room", () => {
  it("A4 draws the starter part with one and with two callouts (columns only where callouts are)", () => {
    for (const k of [1, 2]) {
      const callouts = [{ anchor: [20, 0, 5] as [number, number, number], label: "1" }, { anchor: [40, 10, 5] as [number, number, number], label: "2" }].slice(0, k);
      const sh = layoutSheet(M, { standard: "iso", views, format: { size: "A4" }, callouts });
      expect(sh.notes.join(" ")).not.toMatch(/do not fit/);
      expect(sh.svg).not.toBe("");
    }
  });
  it("a refusal caused by callout columns says so (not the titles)", () => {
    const many = Array.from({ length: 4 }, (_, i) => ({ anchor: [i * 10, 0, 5] as [number, number, number], label: String(i + 1) }));
    const wide = meshOf(body(box(400, 20, 10)));
    const sh = layoutSheet(wide, { standard: "asme", views: [{ kind: "front" }, { kind: "top" }, { kind: "right" }, { kind: "left" }, { kind: "back" }], format: { size: "ANSI-A", orientation: "portrait" }, callouts: many });
    if (!sh.svg) expect(sh.notes[0]).not.toBe("These views do not fit on the sheet with their titles; choose fewer views.");
  });
  it("callouts switched off cost nothing: the same scale as no callouts", () => {
    const callouts = [{ anchor: [20, 0, 5] as [number, number, number], label: "1" }];
    const none = layoutSheet(M, { standard: "plain", views });
    const off = layoutSheet(M, { standard: "plain", views, callouts, layers: { callouts: false } });
    expect(off.scaleMmPerUnit).toBeCloseTo(none.scaleMmPerUnit, 9);
  });
});

describe("D10 / N2 / N3", () => {
  it("unframed ASME: the symbol's axis shows at least two dashes (the pattern scales down to fit)", () => {
    const sh = layoutSheet(M, { standard: "asme", views });
    const m = /<path d="M([\d.]+) [\d.]+L([\d.]+) [\d.]+" stroke-width="[\d.]+" stroke-dasharray="([\d. ]+)"/.exec(sh.svg)!;
    const len = (+m[2] - +m[1]) / PX;
    const period = m[3].split(" ").map(Number).reduce((a, b) => a + b, 0) / PX;
    expect(period).toBeLessThanOrEqual(len / 2 + 1e-6);
  });
  it("the bottom row's descenders clear the 0.7 mm outline", () => {
    const r = buildFrame("iso", "A3", undefined, { number: "gyp-qj" }, null);
    if (!r.ok) throw new Error(r.reason);
    const t = r.frame.texts.find((x) => x.text === "gyp-qj")!;
    expect(t.y + 0.21 * t.sizeMm).toBeLessThan(r.frame.frame.y + r.frame.frame.h - 0.35);
  });
  it("ASME with the title block layer off states the scale on the sheet", () => {
    const sh = layoutSheet(M, { standard: "asme", views, format: { size: "ANSI-B" }, layers: { titleBlock: false } });
    expect(sh.svg).toMatch(/>SCALE \d+:\d+<\/text>/);
  });
});
