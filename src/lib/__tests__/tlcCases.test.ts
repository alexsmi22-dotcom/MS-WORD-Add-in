// Release C: TLC plate. FIXED CASE TABLE (cumulative gate) + the figure's geometry: no label touches a spot or another
// label, spots sit at their Rf between origin and front, and every lane's spots are drawn.
//
// Oracle: Rf = spot distance / front distance (closed form). 3.2 / 8.0 = 0.40; 5.1 / 8.0 = 0.6375 → 0.64;
// 32 mm / 80 mm = 0.40 (the unit cancels).
import { readTlc, rf2, TlcInput } from "../tlc";
import { tlcLayout, tlcPlateSvg, Box } from "../tlcChart";
import { TLC_CALCS } from "../tlcCalcs";
import { CHEM_ENG_GROUP } from "../titrationCalcs";

const calc = TLC_CALCS[0];
const run = (over: Record<string, string>) => {
  const vals: Record<string, string> = { ...Object.fromEntries(calc.fields.map((f) => [f.key, f.default])), ...over };
  return calc.compute((k) => vals[k] ?? "");
};
const rf = (lanes: string, extra: Partial<TlcInput> = {}) => readTlc({ lanes, mode: "rf", ...extra });
function okPlate(i: TlcInput) {
  const r = readTlc(i);
  if (!r.ok) throw new Error(r.error);
  return r;
}
function refused(i: TlcInput): string {
  const r = readTlc(i);
  if (r.ok) throw new Error("expected a refusal");
  return r.error;
}

describe("TLC — the fixed case table", () => {
  it("distance 3.2 with front 8.0 → Rf 0.40", () => {
    const r = okPlate({ lanes: "SM: 3.2", mode: "distance", front: "8.0" });
    expect(r.plate.lanes[0].spots[0].rf).toBeCloseTo(0.4, 12);
    expect(rf2(r.plate.lanes[0].spots[0].rf)).toBe("0.40");
    const out = run({ lanes: "SM: 3.2", mode: "distance", front: "8.0 cm" });
    expect(out.ok).not.toBe(false);
    expect(out.text).toMatch(/SM: 3\.2 cm → Rf 0\.40/);
  });
  it("Rf 1.2 → refusal", () => {
    expect(refused({ lanes: "rxn: 1.2", mode: "rf" })).toMatch(/Rf 1\.2 is outside \(0, 1\]/);
  });
  it("13 lanes → refusal", () => {
    expect(refused({ lanes: Array.from({ length: 13 }, (_, i) => `L${i + 1}: 0.5`).join("\n"), mode: "rf" })).toMatch(/13 lanes; .* at most 12/);
    expect(okPlate({ lanes: Array.from({ length: 12 }, (_, i) => `L${i + 1}: 0.5`).join("\n"), mode: "rf" }).plate.lanes).toHaveLength(12);
  });
  it("two spots with the same Rf in one lane → MERGED with a note (decision)", () => {
    const r = okPlate({ lanes: "co: 0.45, 0.45", mode: "rf" });
    expect(r.plate.lanes[0].spots).toHaveLength(1);
    expect(r.notes).toContain("Lane co: Rf 0.45 is listed twice; drawn as one spot.");
    // Same at the printed 0.01.
    expect(okPlate({ lanes: "co: 0.452, 0.448", mode: "rf" }).plate.lanes[0].spots).toHaveLength(1);
  });
  it("a co-spot lane renders both spots", () => {
    const r = okPlate({ lanes: "SM: 0.62\nco: 0.62, 0.35\nrxn: 0.35", mode: "rf" });
    const L = tlcLayout(r.plate);
    expect(L.spots.filter((s) => s.lane === 1).map((s) => s.rf)).toEqual([0.62, 0.35]);
    expect((tlcPlateSvg(r.plate).svg.match(/<ellipse/g) ?? []).length).toBe(4);
  });
});

describe("TLC — refusals and conventions", () => {
  it.each([
    ["Rf 0 (did not move)", { lanes: "A: 0", mode: "rf" }, /Rf 0 is outside/],
    ["Rf rounding to 0.00", { lanes: "A: 0.004", mode: "rf" }, /Rf 0\.004 rounds to 0\.00: the spot did not move off the origin/],
    ["distance rounding to Rf 0.00", { lanes: "A: 0.03", mode: "distance", front: "8" }, /the spot at 0\.03 cm is Rf 0\.00375, which rounds to 0\.00/],
    ["negative Rf", { lanes: "A: -0.2", mode: "rf" }, /Rf −0\.2 is outside/],
    ["spot beyond the front", { lanes: "A: 9.0", mode: "distance", front: "8.0" }, /beyond the solvent front \(8 cm\)/],
    ["no front in distance mode", { lanes: "A: 3.2", mode: "distance" }, /Solvent front: give the distance/],
    ["front zero", { lanes: "A: 3.2", mode: "distance", front: "0" }, /must be above zero/],
    ["front a word", { lanes: "A: 3.2", mode: "distance", front: "far" }, /is not a length/],
    ["11 spots in a lane", { lanes: `A: ${Array.from({ length: 11 }, (_, i) => (0.05 + i * 0.08).toFixed(2)).join(", ")}`, mode: "rf" }, /has 11 spots; at most 10/],
    ["non-finite", { lanes: "A: NaN", mode: "rf" }, /“NaN” is not a number/],
    ["Infinity", { lanes: "A: Infinity", mode: "rf" }, /not a number/],
    ["a word", { lanes: "A: top", mode: "rf" }, /“top” is not a number/],
    ["empty", { lanes: "", mode: "rf" }, /nothing to read/],
    ["lane with no spots", { lanes: "A: 0.4\nB:", mode: "rf" }, /lane 2 \(“B”\) has no spots/],
    ["empty label", { lanes: ": 0.4", mode: "rf" }, /no label/],
    ["label too long", { lanes: "starting material A: 0.4", mode: "rf" }, /at most 12 fit under a lane/],
    ["mixed decimal marks", { lanes: "A: 0.45, 0.30\nB: 0,62", mode: "rf" }, /mixes 0\.45 and 0,62/],
    ["bare-comma block with a d,dd value", { lanes: "A: 0.45\nB: 0,62", mode: "rf" }, /“0,62” could be one value with a decimal comma or two values/],
    ["lone 0,45", { lanes: "A: 0,45", mode: "rf" }, /could be one value with a decimal comma or two values/],
    ["front beyond the plate", { lanes: "A: 3", mode: "distance", front: "8", plate: "2.5 x 7.5 cm" }, /longer than the plate/],
    ["plate size unreadable", { lanes: "A: 0.4", mode: "rf", plate: "big" }, /not width × height/],
    ["eluent too long", { lanes: "A: 0.4", mode: "rf", eluent: "x".repeat(61) }, /at most 60/],
  ] as [string, TlcInput, RegExp][])("%s → refused by name", (_, input, re) => {
    expect(refused(input)).toMatch(re);
  });

  it("decimal commas across the plate are read (RULE N3), mm units cancel", () => {
    const r = okPlate({ lanes: "A: 0,45; 0,62\nB: 0,30", mode: "rf" });
    expect(r.plate.lanes[0].spots.map((s) => s.rf)).toEqual([0.62, 0.45]);
    expect(okPlate({ lanes: "A: 32", mode: "distance", front: "80 mm" }).plate.lanes[0].spots[0].rf).toBeCloseTo(0.4, 12);
  });

  it("a lane without a label is numbered; spots are listed high Rf first", () => {
    const r = okPlate({ lanes: "0.2, 0.7", mode: "rf" });
    expect(r.plate.lanes[0]).toEqual({ label: "1", spots: [{ rf: 0.7 }, { rf: 0.2 }] });
  });

  it("Rf 1 sits on the front, a tiny Rf just above the origin", () => {
    const L = tlcLayout(okPlate({ lanes: "A: 1\nB: 0.02", mode: "rf" }).plate);
    expect(L.spots[0].cy).toBeCloseTo(L.frontY, 9);
    expect(L.spots[1].cy).toBeLessThan(L.originY);
  });
});

describe("TLC — the figure", () => {
  const overlaps = (a: Box, b: Box, pad = 1): boolean => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
  const layouts: [string, TlcInput][] = [
    ["defaults", { lanes: "SM: 0.62\nco: 0.62, 0.35\nrxn: 0.35", mode: "rf", eluent: "hexanes/EtOAc 4:1" }],
    ["12 long labels", { lanes: Array.from({ length: 12 }, (_, i) => `fraction ${i + 10}: ${(0.1 + i * 0.07).toFixed(2)}`).join("\n"), mode: "rf" }],
    ["10 spots", { lanes: "crude: 0.05, 0.14, 0.22, 0.31, 0.40, 0.52, 0.61, 0.72, 0.85, 0.97\nP: 0.40", mode: "rf", style: "stain" }],
    ["crowded spots", { lanes: "A: 0.50, 0.51, 0.53", mode: "rf" }],
    ["edges", { lanes: "A: 0.02\nB: 1\nC: 0.02, 1", mode: "rf" }],
    ["sized, distances", { lanes: "SM: 3.2\nco: 3.2, 5.1\nrxn: 5.1", mode: "distance", front: "8.0", plate: "2.5 x 10 cm" }],
    ["wide short plate", { lanes: "A: 0.5\nB: 0.3", mode: "rf", plate: "10 x 3 cm" }],
    ["long eluent", { lanes: "P: 0.4", mode: "rf", eluent: "CH2Cl2/MeOH/NH4OH (aq) 90:9:1, two developments" }],
  ];
  it.each(layouts)("%s: no text touches a spot, another text or the plate's lines; spots inside the plate", (_, input) => {
    const p = okPlate(input).plate;
    const L = tlcLayout(p);
    for (let i = 0; i < L.texts.length; i++) {
      for (let j = i + 1; j < L.texts.length; j++) expect(overlaps(L.texts[i].box, L.texts[j].box)).toBe(false);
      for (const s of L.spots) expect(overlaps(L.texts[i].box, { x: s.cx - s.rx, y: s.cy - s.ry, w: 2 * s.rx, h: 2 * s.ry })).toBe(false);
      // Inside the canvas.
      expect(L.texts[i].box.x).toBeGreaterThanOrEqual(0);
      expect(L.texts[i].box.x + L.texts[i].box.w).toBeLessThanOrEqual(L.width);
      // Never on the plate (labels live in the margins).
      expect(overlaps(L.texts[i].box, L.plate, -1)).toBe(false);
    }
    for (const s of L.spots) {
      expect(s.cx - s.rx).toBeGreaterThan(L.plate.x);
      expect(s.cx + s.rx).toBeLessThan(L.plate.x + L.plate.w);
      expect(s.cy - s.ry).toBeGreaterThan(L.plate.y);
      expect(s.cy + s.ry).toBeLessThan(L.plate.y + L.plate.h);
    }
    // One spot size for the plate; spots in one lane never overlap.
    expect(new Set(L.spots.filter((s) => s.rfs.length === 1).map((s) => `${s.rx}x${s.ry}`)).size).toBeLessThanOrEqual(1);
    const svg = tlcPlateSvg(p).svg;
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    expect(svg).toMatch(/font-family="Arial, Helvetica, sans-serif"/);
    expect(svg).not.toMatch(/var\(|currentColor/);
  });

  it("the plate keeps a given size's proportions; the sized front is the measured distance", () => {
    const L = tlcLayout(okPlate({ lanes: "SM: 3.2\nrxn: 5.1", mode: "distance", front: "8.0", plate: "2.5 x 10 cm" }).plate);
    expect(L.plate.h / L.plate.w).toBeCloseTo(4, 6);
    const pxPerCm = L.plate.h / 10;
    expect((L.originY - L.frontY) / pxPerCm).toBeCloseTo(8, 6);
    expect((L.plate.y + L.plate.h - L.originY) / pxPerCm).toBeCloseTo(1, 6);
  });

  it("crowded spots never overlap: the plate stretches (bounded) or the pair is one elongated spot, named", () => {
    const L = tlcLayout(okPlate({ lanes: "A: 0.50, 0.51", mode: "rf" }).plate);
    expect(L.spots).toHaveLength(1);
    expect(L.spots[0].rfs).toEqual([0.5, 0.51].reverse());
    expect(L.notes.join(" ")).toMatch(/Lane A: the spots at Rf 0\.51 and 0\.50 are too close to draw apart; drawn as one merged spot/);
  });
});

describe("TLC — close spots (review round 1: the SM 0.62 / product 0.59 co-spot)", () => {
  const ellipsesIntersect = (a: { cy: number; ry: number }, b: { cy: number; ry: number }): boolean => Math.abs(a.cy - b.cy) < a.ry + b.ry;
  it.each([0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1])("ΔRf %s: no two spot ellipses in a lane intersect; every single spot is the normal size", (d) => {
    const low = Number((0.62 - d).toFixed(2));
    const p = okPlate({ lanes: `SM: 0.62\nco: 0.62, ${low}\nrxn: ${low}`, mode: "rf" }).plate;
    const L = tlcLayout(p);
    for (let lane = 0; lane < 3; lane++) {
      const s = L.spots.filter((x) => x.lane === lane);
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) expect(ellipsesIntersect(s[i], s[j])).toBe(false);
    }
    // Spot size never depends on another lane: SM and rxn are the normal size whatever the co lane holds.
    for (const s of L.spots.filter((x) => x.rfs.length === 1)) expect(s.ry).toBe(5.5);
    const co = L.spots.filter((x) => x.lane === 1);
    if (co.length === 1) {
      // Merged: spans both Rf values, said by name.
      expect(co[0].rfs).toEqual([0.62, low]);
      expect(L.notes.join(" ")).toContain(`Lane co: the spots at Rf 0.62 and ${low.toFixed(2)} are too close to draw apart; drawn as one merged spot.`);
    } else expect(co).toHaveLength(2);
    expect(L.plate.h).toBeLessThanOrEqual(460);
  });

  it("ΔRf 0.04–0.07 resolves by a taller plate (bounded at 460 px); ΔRf 0.03 and below merge", () => {
    const at = (d: number) => tlcLayout(okPlate({ lanes: `co: 0.62, ${(0.62 - d).toFixed(2)}`, mode: "rf" }).plate);
    expect(at(0.04).spots).toHaveLength(2);
    expect(at(0.04).plate.h).toBeGreaterThan(230);
    expect(at(0.1).plate.h).toBe(230);
    expect(at(0.03).spots).toHaveLength(1);
  });

  it("one tight lane does not shrink the spots of the others (spot size independent of other lanes)", () => {
    const alone = tlcLayout(okPlate({ lanes: "SM: 0.62", mode: "rf" }).plate).spots[0];
    const crowded = tlcLayout(okPlate({ lanes: "SM: 0.62\nco: 0.62, 0.61", mode: "rf" }).plate).spots[0];
    expect([crowded.rx, crowded.ry]).toEqual([alone.rx, alone.ry]);
  });

  it("a sized plate never stretches: close spots merge instead", () => {
    const L = tlcLayout(okPlate({ lanes: "co: 0.62, 0.58", mode: "rf", plate: "2.5 x 7.5 cm" }).plate);
    expect(L.plate.h / L.plate.w).toBeCloseTo(3, 6);
    const s = L.spots;
    for (let i = 1; i < s.length; i++) expect(ellipsesIntersect(s[i - 1], s[i])).toBe(false);
  });
});

describe("TLC — the calculator", () => {
  it("is shaped for the pane: id, name, group, fields; every result draws", () => {
    expect(calc.id).toBe("chem-tlc");
    expect(calc.name).toBe("TLC plate");
    expect(calc.group).toBe(CHEM_ENG_GROUP);
    const out = run({});
    expect(out.ok).not.toBe(false);
    expect(out.blocks?.some((b) => b.kind === "plot")).toBe(true);
    expect(out.text).toMatch(/SM: Rf 0\.62/);
    expect(out.text).toMatch(/co: Rf 0\.62; Rf 0\.35/);
  });
  it("display contract: eluent typeset, no em dash, caret, e-notation or NaN in the text", () => {
    const out = run({ eluent: "CH2Cl2/MeOH 95:5", lanes: "A: 0.45" });
    expect(out.text).toMatch(/CH₂Cl₂\/MeOH 95:5/);
    expect(out.text).not.toMatch(/—|\^|NaN|Infinity|undefined|\de[-+]?\d/);
    // Extreme magnitudes print as ×10ⁿ, never e-notation (1e-7 cm spot on a 2e-7 cm run).
    const tiny = run({ mode: "distance", lanes: "A: 0.0000001", front: "0.0000002" });
    expect(tiny.text).toMatch(/A: 1×10⁻⁷ cm → Rf 0\.50/);
    expect(tiny.text).not.toMatch(/\de[-+]?\d/);
    expect(run({ lanes: "A: 1e21" }).text).toMatch(/Rf 1×10²¹ is outside/);
    const bad = run({ lanes: "A: -0.5" });
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/Rf −0\.5/);
  });
  it("a refusal never draws", () => {
    const out = run({ lanes: "A: 2" });
    expect(out.ok).toBe(false);
    expect(out.blocks).toBeUndefined();
  });
});

describe("tlc review round 3", () => {
  it("R3-01: the merge note quotes the same rounded Rf values as the table", () => {
    const r = run({ lanes: "A: 0.62, 0.585" });
    // Assert on the merge note itself (the table line alone also holds 0.59).
    expect(r.text).toMatch(/the spots at Rf 0\.62 and 0\.59 are too close/);
    expect(r.text).not.toMatch(/0\.58\b/);
  });
});
