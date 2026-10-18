// Drawing sheet formats (docs/SCOPE-CAD-R2.md R2b; values: docs/DRAFTING-STANDARDS-REFERENCE.md
// "Sheets, borders and zones", read in ISO 5457 / ISO 7200 through IS 10711 / IS 11665).
import {
  buildFrame,
  checkTitleFields,
  Frame,
  FrameText,
  ISO_TITLE_FIELDS,
  SHEET_SIZES,
  SheetSizeId,
  sheetRefusal,
  sheetsFor,
  textWidthMm,
  TitleValues,
} from "../cadFormats";

const ok = (std: "iso" | "asme", size: SheetSizeId, values: TitleValues = {}, o?: "landscape" | "portrait", scale: string | null = null): Frame => {
  const r = buildFrame(std, size, o, values, scale);
  if (!r.ok) throw new Error(r.reason);
  return r.frame;
};
/** A text's box, mm: capitals above the baseline, descenders below. */
const box = (t: FrameText): { x0: number; x1: number; y0: number; y1: number } => {
  const w = textWidthMm(t.text, t.sizeMm);
  const x0 = t.anchor === "start" ? t.x : t.anchor === "middle" ? t.x - w / 2 : t.x - w;
  return { x0, x1: x0 + w, y0: t.y - t.sizeMm * 0.716, y1: t.y + t.sizeMm * 0.21 };
};
const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const FULL: TitleValues = {
  owner: "Caldwell Engineering",
  title: "Mounting bracket",
  subtitle: "Complete with brackets and the two locating pins",
  number: "CE-2026-0417",
  rev: "B",
  date: "2026-10-17",
  sheetNo: "1",
  sheets: "2",
  lang: "en",
  creator: "A. Smith",
  approver: "B. Jones",
  docType: "Detail drawing",
  status: "Released",
  dept: "ENG",
  techRef: "C. Lee",
};

describe("ISO 5457 sheets", () => {
  it.each([
    ["A0", 1189, 841, 1159, 821],
    ["A1", 841, 594, 811, 574],
    ["A2", 594, 420, 564, 400],
    ["A3", 420, 297, 390, 277],
  ] as const)("%s: trimmed %d × %d, drawing space %d × %d (Table 1), landscape", (size, W, H, fw, fh) => {
    const f = ok("iso", size);
    expect([f.W, f.H, f.orientation]).toEqual([W, H, "landscape"]);
    expect([f.frame.w, f.frame.h]).toEqual([fw, fh]);
    expect([f.frame.x, f.frame.y]).toEqual([20, 10]); // 20 mm filing margin, 10 mm elsewhere
  });
  it("A4 is portrait only: 210 × 297 with a 180 × 277 drawing space; landscape is refused by name", () => {
    const f = ok("iso", "A4");
    expect([f.W, f.H, f.frame.w, f.frame.h]).toEqual([210, 297, 180, 277]);
    expect(buildFrame("iso", "A4", "landscape", {}, null)).toEqual({ ok: false, reason: "ISO 5457 permits A4 portrait only" });
    expect(sheetRefusal("iso", "A3", "portrait")).toBe("ISO 5457 permits A3 landscape only");
  });
  it.each([
    ["A0", 24, 16],
    ["A1", 16, 12],
    ["A2", 12, 8],
    ["A3", 8, 6],
  ] as const)("%s grid: %d numerals along each long side, %d letters along each short side (Table 2), no I or O", (size, nLong, nShort) => {
    const f = ok("iso", size);
    const nums = f.texts.filter((t) => t.layer === "frame" && /^\d+$/.test(t.text));
    const lets = f.texts.filter((t) => t.layer === "frame" && /^[A-Z]$/.test(t.text) && t.text !== SHEET_SIZES[size].designation);
    expect(nums).toHaveLength(2 * nLong);
    expect(lets).toHaveLength(2 * nShort);
    expect(lets.some((t) => t.text === "I" || t.text === "O")).toBe(false);
    // Letters top to bottom, numerals left to right.
    const left = lets.filter((t) => t.x < f.W / 2).sort((a, b) => a.y - b.y).map((t) => t.text);
    expect(left).toEqual("ABCDEFGHJKLMNPQRSTUVWXYZ".slice(0, nShort).split(""));
    const top = nums.filter((t) => t.y < f.H / 2).sort((a, b) => a.x - b.x).map((t) => t.text);
    expect(top).toEqual(Array.from({ length: nLong }, (_, i) => String(i + 1)));
  });
  it("A4: the references only at the top and the right side", () => {
    const f = ok("iso", "A4");
    const refs = f.texts.filter((t) => t.layer === "frame" && t.text !== "A4");
    expect(refs.filter((t) => /^\d+$/.test(t.text)).every((t) => t.y < 10)).toBe(true);
    expect(refs.filter((t) => /^[A-Z]$/.test(t.text)).every((t) => t.x > 200)).toBe(true);
    expect(refs).toHaveLength(4 + 6);
  });
  it("fields are 50 mm from the axes of symmetry; the corner fields take the rest", () => {
    const f = ok("iso", "A1");
    // The field boundaries along the top border (not the grid border's own sides).
    const ticks = f.lines.filter((l) => l.type === "grid" && l.x1 === l.x2 && l.y1 < f.frame.y && l.x1 > f.frame.x && l.x1 < f.frame.x + f.frame.w).map((l) => l.x1).sort((a, b) => a - b);
    expect(ticks).toContain(f.W / 2);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1]).toBeCloseTo(50, 9);
  });
  it("four 0.7 mm centring marks on the axes, each from the grid border to 10 mm past the frame", () => {
    const f = ok("iso", "A3");
    const marks = f.lines.filter((l) => l.type === "centring");
    expect(marks).toHaveLength(4);
    expect(marks).toContainEqual({ x1: 210, y1: 5, x2: 210, y2: 20, type: "centring" });
    expect(marks).toContainEqual({ x1: 15, y1: 148.5, x2: 30, y2: 148.5, type: "centring" });
  });
  it("the size designation sits in the bottom border at the right corner", () => {
    const f = ok("iso", "A2");
    const d = f.texts.find((t) => t.text === "A2")!;
    expect(d.y).toBeGreaterThan(f.frame.y + f.frame.h);
    expect(d.anchor).toBe("end");
    expect(d.x).toBeCloseTo(f.frame.x + f.frame.w - 1, 9);
  });
});

describe("ISO 7200 title block", () => {
  it("is 180 mm wide in the bottom-right corner of the frame, on every size", () => {
    for (const s of sheetsFor("iso")) {
      const f = ok("iso", s, FULL);
      expect(f.titleBlock.w).toBe(180);
      expect(f.titleBlock.x + f.titleBlock.w).toBeCloseTo(f.frame.x + f.frame.w, 9);
      expect(f.titleBlock.y + f.titleBlock.h).toBeCloseTo(f.frame.y + f.frame.h, 9);
    }
  });
  it("prints every field it was given, each inside the block, none overlapping another (A4 and A3)", () => {
    for (const s of ["A4", "A3"] as const) {
      const f = ok("iso", s, FULL);
      const tb = f.texts.filter((t) => t.layer === "titleBlock");
      for (const v of ["Caldwell Engineering", "Mounting bracket", "CE-2026-0417", "2026-10-17", "1 / 2", "Detail drawing", s]) expect(tb.some((t) => t.text === v)).toBe(true);
      const boxes = tb.map(box);
      for (const b of boxes) {
        expect(b.x0).toBeGreaterThanOrEqual(f.titleBlock.x);
        expect(b.x1).toBeLessThanOrEqual(f.titleBlock.x + f.titleBlock.w);
        expect(b.y0).toBeGreaterThanOrEqual(f.titleBlock.y);
        expect(b.y1).toBeLessThanOrEqual(f.titleBlock.y + f.titleBlock.h);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect([tb[i].text, tb[j].text, overlaps(boxes[i], boxes[j])]).toEqual([tb[i].text, tb[j].text, false]);
    }
  });
  it("no frame text overlaps another (grid references, size designation)", () => {
    for (const s of sheetsFor("iso")) {
      const fr = ok("iso", s).texts.filter((t) => t.layer === "frame");
      const b = fr.map(box);
      for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) expect(overlaps(b[i], b[j])).toBe(false);
    }
  });
  it("mandatory fields left empty are named, never filled in", () => {
    const r = checkTitleFields("iso", { title: "Bracket" });
    expect(r.missing).toEqual(["Legal owner", "Identification number", "Date of issue", "Sheet", "Created by", "Approved by", "Document type"]);
    expect(ISO_TITLE_FIELDS.filter((f) => f.mandatory)).toHaveLength(8);
    const f = ok("iso", "A3", { title: "Bracket" });
    expect(f.texts.filter((t) => t.layer === "titleBlock" && !ISO_TITLE_FIELDS.some((k) => k.label === t.text) && t.text !== "Paper size").map((t) => t.text)).toEqual(["Bracket", "A3"]);
  });
  it.each([
    [{ number: "X".repeat(17) }, "Identification number is 17 characters — the field holds 16"],
    [{ title: "A mounting bracket with pins" }, "Title is 28 characters — the field holds 25"],
    [{ rev: "IO" }, "ISO 7200: a revision index avoids the letters I and O (they read as 1 and 0)"],
    [{ sheetNo: "0" }, "Sheet must be a whole number from 1"],
    [{ sheetNo: "3", sheets: "2" }, "sheet 3 of 2 is past the last sheet"],
  ] as const)("%j is refused: %s", (values, why) => {
    expect(buildFrame("iso", "A3", undefined, values, null)).toEqual({ ok: false, reason: why });
  });
  it("a title within 25 characters but too wide for its cell (all W) is refused, never drawn over the line", () => {
    const r = buildFrame("iso", "A3", undefined, { title: "W".repeat(25) }, null);
    expect(r).toEqual({ ok: false, reason: "Title does not fit its field" });
  });
});

describe("ASME sheets", () => {
  it.each([
    ["ANSI-A", 279.4, 215.9],
    ["ANSI-B", 431.8, 279.4],
    ["ANSI-C", 558.8, 431.8],
    ["ANSI-D", 863.6, 558.8],
    ["ANSI-E", 1117.6, 863.6],
  ] as const)("%s is %d × %d mm landscape", (s, W, H) => {
    const f = ok("asme", s);
    expect(f.W).toBeCloseTo(W, 9);
    expect(f.H).toBeCloseTo(H, 9);
  });
  it("A may be vertical; B is landscape only", () => {
    expect(ok("asme", "ANSI-A", {}, "portrait").W).toBeCloseTo(215.9, 9);
    expect(sheetRefusal("asme", "ANSI-B", "portrait")).toBe("B (17 × 11 in) is used landscape only");
  });
  it("zones: numbers along the top and bottom, letters along the sides, A1 at the lower right", () => {
    const f = ok("asme", "ANSI-D");
    const nums = f.texts.filter((t) => t.layer === "frame" && /^\d+$/.test(t.text));
    const lets = f.texts.filter((t) => t.layer === "frame" && /^[A-Z]$/.test(t.text));
    expect(nums).toHaveLength(16);
    expect(lets).toHaveLength(8);
    const one = nums.filter((t) => t.text === "1"), a = lets.filter((t) => t.text === "A");
    expect(Math.min(...one.map((t) => t.x))).toBeGreaterThan(f.W - 120);
    expect(Math.min(...a.map((t) => t.y))).toBeGreaterThan(f.H - 150);
  });
  it("the title block carries the scale it is given, and every field fits without overlap", () => {
    const f = ok("asme", "ANSI-B", { owner: "Caldwell Engineering", title: "Mounting bracket", number: "CE-0417", rev: "A", cage: "1ABC2", creator: "A. Smith", creatorDate: "2026-10-17", sheetNo: "1", sheets: "1" }, undefined, "1:2");
    const tb = f.texts.filter((t) => t.layer === "titleBlock");
    expect(tb.some((t) => t.text === "1:2")).toBe(true);
    const b = tb.map(box);
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) expect([tb[i].text, tb[j].text, overlaps(b[i], b[j])]).toEqual([tb[i].text, tb[j].text, false]);
  });
  it("a CAGE code is five letters or digits", () => {
    expect(buildFrame("asme", "ANSI-A", undefined, { cage: "12-4" }, null)).toEqual({ ok: false, reason: "a CAGE code is five letters or digits" });
  });
});

describe("what the views may use", () => {
  it("the view area stays inside the frame, clear of the title block and of the scale / symbol room, on every size", () => {
    const inter = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const std of ["iso", "asme"] as const)
      for (const s of sheetsFor(std))
        for (const o of SHEET_SIZES[s].orientations) {
          const f = ok(std, s, {}, o);
          const v = f.viewArea;
          expect(v.w).toBeGreaterThan(50);
          expect(v.h).toBeGreaterThan(50);
          expect(v.x).toBeGreaterThanOrEqual(f.frame.x);
          expect(v.y + v.h).toBeLessThanOrEqual(f.frame.y + f.frame.h);
          expect(inter(v, f.titleBlock)).toBe(false);
          const info = { x: f.infoAt.x - f.infoAt.w, y: f.infoAt.y - f.infoAt.h, w: f.infoAt.w, h: f.infoAt.h };
          expect(inter(v, info)).toBe(false);
          expect(inter(info, f.titleBlock)).toBe(false);
        }
  });
  it("patent, journal and plain drawings have no sheet format — each refused by name", () => {
    expect(sheetRefusal("uspto", "A4")).toBe("37 CFR 1.84(g): a patent drawing sheet must not have a frame around the sight, so it has no sheet format");
    expect(sheetsFor("uspto")).toEqual([]);
    expect(sheetRefusal("journal", "A4")).toBe("this drawing style has no sheet format — choose ISO or ASME for a framed sheet");
    expect(sheetRefusal("iso", "ANSI-B")).toBe("B (17 × 11 in) is not an ISO 5457 sheet — choose A4 to A0");
  });
});
