// Lighting & rendering through the pane's own registry (LIGHTING_CALCS compute → text, blocks and named outputs):
// every calculator at its defaults keeps the display contract, opens with a reading built from its numbers, states
// what it assumes, and draws; then the adversarial inputs the brief names (polar day and night, the sun below the
// horizon, the occluder at the light, roughness 0, grazing angles, zero and negative distances, fog σ = 0), each
// handled or refused by name. Engine numbers are pinned against the oracles in lightingPhysics.test.ts.
import type { AnalyzeOutput } from "../analyzeBlocks";
import { LIGHTING_CALCS } from "../lightingCalcs";

function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = LIGHTING_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(`no calculator ${id}`);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
const out = (id: string, o: AnalyzeOutput, key: string): number => {
  const v = o.outputs?.find((x) => x.key === key)?.value;
  if (v === undefined) throw new Error(`${id}: no output ${key}`);
  return v;
};
const plots = (o: AnalyzeOutput) => (o.blocks ?? []).filter((b) => b.kind === "plot") as Array<{ kind: "plot"; svg: string; caption: string }>;
const firstLine = (o: AnalyzeOutput): string => {
  const b = (o.blocks ?? [])[0];
  return b && b.kind === "line" ? b.text : "";
};

const IDS = ["rend-sun-shadow", "rend-soft-shadow", "rend-falloff", "rend-brdf", "rend-noise", "rend-tonemap", "rend-atmosphere"];

describe("the registry", () => {
  test("seven calculators, in dropdown order, all in Lighting & rendering, all converting units", () => {
    expect(LIGHTING_CALCS.map((c) => c.id)).toEqual(IDS);
    expect(LIGHTING_CALCS.every((c) => c.group === "Lighting & rendering")).toBe(true);
    expect(LIGHTING_CALCS.every((c) => c.unitContract === "converts")).toBe(true);
  });
});

describe("every calculator at its defaults", () => {
  test.each(IDS.map((id) => [id]))("%s: ok, a plain-language reading first, assumes stated, draws, display contract kept", (id) => {
    const t0 = Date.now();
    const o = run(id);
    const ms = Date.now() - t0;
    expect(o.ok).not.toBe(false);
    // A live pane recomputes on every keystroke.
    expect(ms).toBeLessThan(800);
    const lead = firstLine(o);
    expect(lead.length).toBeGreaterThan(60);
    expect(lead).toMatch(/\d/);
    expect(lead).not.toMatch(/^(Assumes|Units|Model)/);
    expect(o.text).toMatch(/Assumes:/);
    expect(o.text).not.toMatch(/NaN|Infinity|undefined|—|\de[+-]?\d/);
    // A numeric minus is U+2212, never a hyphen.
    expect(o.text).not.toMatch(/(^|[\s(=])-\d/m);
    const p = plots(o);
    expect(p.length).toBeGreaterThan(0);
    for (const fig of p) {
      expect(fig.svg.startsWith("<svg")).toBe(true);
      expect(fig.svg).not.toMatch(/NaN|Infinity|undefined/);
    }
    for (const x of o.outputs ?? []) expect(Number.isFinite(x.value)).toBe(true);
  });
});

describe("sun position and shadows", () => {
  test("defaults: London on the June solstice at 15:00 BST, sun about 54° in the south-west, shadow north-east", () => {
    const o = run("rend-sun-shadow");
    expect(out("sun", o, "elevation")).toBeCloseTo(53.988, 2);
    expect(out("sun", o, "azimuth")).toBeCloseTo(230.0, 1);
    expect(out("sun", o, "shadow")).toBeCloseTo(1.8 / Math.tan((53.988 * Math.PI) / 180), 2);
    expect(firstLine(o)).toMatch(/south-west.*north-east/);
    expect(firstLine(o)).toMatch(/21 June 2026/);
  });
  test("polar night at Longyearbyen in December: said so, no sunrise output, no shadow, still draws", () => {
    const o = run("rend-sun-shadow", { lat: "78.2232", lon: "15.6267", date: "2026-12-21", time: "12:00", tz: "+1" });
    expect(o.ok).not.toBe(false);
    expect(firstLine(o)).toMatch(/polar night/);
    expect(firstLine(o)).toMatch(/no shadow/);
    expect(o.outputs?.some((x) => x.key === "sunrise")).toBe(false);
    expect(out("sun", o, "dayLength")).toBe(0);
    expect(plots(o).length).toBe(2);
  });
  test("polar day at Tromsø in June: the sun never sets, the day is 24 h", () => {
    const o = run("rend-sun-shadow", { lat: "69.6492", lon: "18.9553", date: "2026-06-21", time: "00:30", tz: "+2" });
    expect(o.ok).not.toBe(false);
    expect(firstLine(o)).toMatch(/polar day/);
    expect(out("sun", o, "dayLength")).toBe(24);
  });
  test("the sun below the horizon: no shadow, said so", () => {
    const o = run("rend-sun-shadow", { time: "23:30" });
    expect(o.ok).not.toBe(false);
    expect(firstLine(o)).toMatch(/below the horizon.*no shadow/);
    expect(o.outputs?.some((x) => x.key === "shadow")).toBe(false);
  });
  test("Sydney (southern hemisphere): the sun culminates in the north and the shadow points south", () => {
    const o = run("rend-sun-shadow", { lat: "-33.8688", lon: "151.2093", date: "2026-06-21", time: "12:00", tz: "+10" });
    expect(o.ok).not.toBe(false);
    const az = out("sun", o, "azimuth");
    expect(az < 30 || az > 330).toBe(true);
    expect(firstLine(o)).toMatch(/pointing south/);
  });
  test("bad input refused by name", () => {
    expect(run("rend-sun-shadow", { date: "06/07/2026" }).text).toMatch(/YYYY-MM-DD/);
    expect(run("rend-sun-shadow", { date: "2026-02-30" }).text).toMatch(/day 30 does not exist/);
    expect(run("rend-sun-shadow", { time: "25:00" }).text).toMatch(/not a time of day/);
    expect(run("rend-sun-shadow", { lat: "95" }).text).toMatch(/Latitude/);
    expect(run("rend-sun-shadow", { tz: "abc" }).text).toMatch(/UTC offset/);
    expect(run("rend-sun-shadow", { h: "0 m" }).text).toMatch(/Object height/);
    expect(run("rend-sun-shadow", { h: "5 kg" }).text).toMatch(/Object height/);
    expect(run("rend-sun-shadow", { h: "6 ft" }).ok).not.toBe(false);
    expect(run("rend-sun-shadow", { tz: "+05:30", lat: "28.6", lon: "77.2" }).ok).not.toBe(false);
  });
});

describe("soft shadows", () => {
  test("defaults: antumbra 0.05 m, penumbra 0.5 m each side", () => {
    const o = run("rend-soft-shadow");
    expect(out("soft", o, "penumbra")).toBeCloseTo(0.5, 12);
    expect(out("soft", o, "umbra")).toBeCloseTo(-0.05, 12);
    expect(firstLine(o)).toMatch(/antumbra/);
  });
  test("contact (d = 0): a hard shadow the occluder's own size", () => {
    const o = run("rend-soft-shadow", { d: "0" });
    expect(out("soft", o, "penumbra")).toBe(0);
    expect(firstLine(o)).toMatch(/perfectly hard/);
  });
  test("occluder at the light, negative and zero distances are refused by name", () => {
    expect(run("rend-soft-shadow", { L: "0" }).text).toMatch(/occluder sits at the light/);
    expect(run("rend-soft-shadow", { d: "-1 m" }).text).toMatch(/receiver/);
    expect(run("rend-soft-shadow", { D: "0" }).text).toMatch(/Light size/);
    expect(run("rend-soft-shadow", { w: "" }).text).toMatch(/Occluder size w: this field is required/);
  });
  test("an umbra when the receiver is close: 0.3 m occluder, receiver 0.2 m behind", () => {
    const o = run("rend-soft-shadow", { d: "0.2 m" });
    expect(out("soft", o, "umbra")).toBeCloseTo(0.3 - 0.7 * 0.1, 12);
    expect(firstLine(o)).toMatch(/umbra/);
  });
});

describe("falloff and light units", () => {
  test("defaults: 2 stops to the background, 1.414 m for +1 stop, 6.25 % point error", () => {
    const o = run("rend-falloff");
    expect(out("f", o, "stops")).toBeCloseTo(2, 12);
    expect(out("f", o, "dNew")).toBeCloseTo(Math.SQRT2, 12);
    expect(out("f", o, "pointError")).toBeCloseTo(6.25, 10);
  });
  test("refusals: efficacy above 683, a ratio below 1, a zero distance, a wrong unit", () => {
    expect(run("rend-falloff", { eff: "700" }).text).toMatch(/683/);
    expect(run("rend-falloff", { ratio: "0.5" }).text).toMatch(/Key:fill ratio/);
    expect(run("rend-falloff", { d1: "0 m" }).text).toMatch(/subject distance/);
    expect(run("rend-falloff", { flux: "10 W" }).text).toMatch(/Luminous flux/);
  });
  test("watts blank skips the efficacy", () => {
    const o = run("rend-falloff", { watts: "", eff: "" });
    expect(o.ok).not.toBe(false);
    expect(o.outputs?.some((x) => x.key === "lumens")).toBe(false);
  });
  test("a background nearer than the subject is brighter, worded so", () => {
    expect(firstLine(run("rend-falloff", { d2: "1 m" }))).toMatch(/stops more light/);
  });
});

describe("microfacet BRDF", () => {
  test("roughness 0 is floored to 0.045 and the floor is said", () => {
    const o = run("rend-brdf", { r: "0" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/raised to it/);
    expect(o.text).toMatch(/delta function/);
  });
  test("grazing 89° stays finite; 90° is refused by name", () => {
    expect(run("rend-brdf", { tv: "89", tl: "89" }).ok).not.toBe(false);
    expect(run("rend-brdf", { tv: "90" }).text).toMatch(/View angle/);
    expect(run("rend-brdf", { tl: "120" }).text).toMatch(/Light angle/);
  });
  test("a metal takes F0 from its base colour", () => {
    const o = run("rend-brdf", { metal: "1", base: "0.95" });
    expect(out("b", o, "F0")).toBeCloseTo(0.95, 12);
    expect(firstLine(o)).toMatch(/metal/);
  });
  test("bad numbers refused by name", () => {
    expect(run("rend-brdf", { r: "1.5" }).text).toMatch(/Roughness/);
    expect(run("rend-brdf", { ior: "x" }).text).toMatch(/Index of refraction/);
    expect(run("rend-brdf", { base: "2" }).text).toMatch(/Base colour/);
  });
  test("the separable form adds its own equations", () => {
    expect(run("rend-brdf", { g: "separable" }).text).toMatch(/G = Gl·Gv/);
  });
});

describe("render noise", () => {
  test("defaults: 16× samples, 1024 spp, 2 h 33 min", () => {
    const o = run("rend-noise");
    expect(out("n", o, "samples")).toBeCloseTo(1024, 9);
    expect(firstLine(o)).toMatch(/2 h 33 min/);
  });
  test("β = 90°: cosine sampling is exact and the figure says why its line is missing", () => {
    const o = run("rend-noise", { beta: "90" });
    expect(o.ok).not.toBe(false);
    expect(firstLine(o)).toMatch(/no noise at all/);
    expect(plots(o)[0].svg).toMatch(/zero variance/);
  });
  test("refusals: zero target noise, overhead at least the render time, a cone of 0°", () => {
    expect(run("rend-noise", { st: "0" }).text).toMatch(/Target noise/);
    expect(run("rend-noise", { tf: "10 min" }).text).toMatch(/Fixed overhead/);
    expect(run("rend-noise", { beta: "0" }).text).toMatch(/half-angle/);
    expect(run("rend-noise", { n0: "lots" }).text).toMatch(/samples per pixel/);
  });
});

describe("tone mapping", () => {
  test("defaults: dynamic range 19.93 stops, ACES puts middle grey at 0.267", () => {
    const o = run("rend-tonemap");
    expect(out("t", o, "dr")).toBeCloseTo(Math.log2(1e6), 9);
    expect(out("t", o, "grey_aces")).toBeCloseTo(0.2669, 4);
  });
  test("exposure moves every value by 2^EV", () => {
    const o = run("rend-tonemap", { ev: "1" });
    expect(out("t", o, "grey_reinhard")).toBeCloseTo(0.36 / 1.36, 12);
  });
  test("refusals: a negative scene value, thirteen values, max below min, an exposure of 25 stops", () => {
    expect(run("rend-tonemap", { x: "0.18 -1" }).text).toMatch(/cannot be negative/);
    expect(run("rend-tonemap", { x: "1 2 3 4 5 6 7 8 9 10 11 12 13" }).text).toMatch(/twelve at most/);
    expect(run("rend-tonemap", { lmin: "100 cd/m^2", lmax: "1 cd/m^2" }).text).toMatch(/must exceed/);
    expect(run("rend-tonemap", { ev: "25" }).text).toMatch(/Exposure/);
    expect(run("rend-tonemap", { lw: "0" }).text).toMatch(/White point/);
  });
});

describe("atmosphere and fog", () => {
  test("fog σ = 0: all the light through, visibility unlimited, no Infinity anywhere", () => {
    const o = run("rend-atmosphere", { sigma: "0" });
    expect(o.ok).not.toBe(false);
    expect(out("a", o, "T")).toBe(1);
    expect(o.text).toMatch(/unlimited/);
    expect(o.outputs?.some((x) => x.key === "visibility")).toBe(false);
  });
  test("σ typed per km with a spaced slash", () => {
    const o = run("rend-atmosphere", { sigma: "2 /km", d: "500 m" });
    expect(out("a", o, "T")).toBeCloseTo(Math.exp(-1), 12);
  });
  test("refusals: the sun below the horizon, g = 1, a 100 nm wavelength, negative σ", () => {
    expect(run("rend-atmosphere", { elev: "-2" }).text).toMatch(/below the horizon/);
    expect(run("rend-atmosphere", { g: "1" }).text).toMatch(/Asymmetry g/);
    expect(run("rend-atmosphere", { lams: "100" }).text).toMatch(/200 to 4000 nm/);
    expect(run("rend-atmosphere", { sigma: "-1" }).text).toMatch(/Extinction coefficient/);
    expect(run("rend-atmosphere", { sigma: "", vis: "0 km" }).text).toMatch(/Visibility/);
  });
  test("one wavelength still reads sensibly", () => {
    const o = run("rend-atmosphere", { lams: "550" });
    expect(o.ok).not.toBe(false);
    expect(firstLine(o)).toMatch(/550 nm/);
  });
});

// Review 2026-10-29: each finding's repro, as the reviewer ran it through the registry.
describe("review findings (B1, B2, M1–M4, N1–N3, N6)", () => {
  const sun = (over: Record<string, string>) => run("rend-sun-shadow", over);
  const row = (o: AnalyzeOutput, name: string): string => {
    for (const b of o.blocks ?? []) if (b.kind === "table") for (const r of b.rows) if (r[0].startsWith(name)) return r[1];
    throw new Error(`no row ${name}`);
  };
  test("B1: Tromsø 18 May rises at 00:52 and does not set; never '00:00' for a missing crossing", () => {
    const o = sun({ lat: "69.65", lon: "18.96", date: "2026-05-18", time: "12:00", tz: "2" });
    expect(firstLine(o)).toMatch(/rises at 00:5\d and does not set/);
    expect(row(o, "Sunset")).toMatch(/stays up through the night/);
    expect(o.text).not.toMatch(/sunset 00:00|Sunrise 00:00/);
    expect(out("sun", o, "dayLength")).toBeGreaterThan(23);
  });
  test("B1: Tromsø 25 July does not rise and sets at 00:37 the next day", () => {
    const o = sun({ lat: "69.65", lon: "18.96", date: "2026-07-25", time: "12:00", tz: "2" });
    expect(firstLine(o)).toMatch(/already up .* sets at 00:3\d \(the next day\)/);
    expect(row(o, "Sunrise")).toMatch(/already up/);
    expect(row(o, "Sunrise")).not.toMatch(/polar/);
  });
  test("B1/B2: 89° S at the March equinox sets at about 21:13, does not rise, and is in golden light all day", () => {
    const o = sun({ lat: "-89", lon: "0", date: "2026-03-20", time: "12:00", tz: "0" });
    expect(firstLine(o)).toMatch(/sets at 21:1\d/);
    expect(out("sun", o, "dayLength")).toBeGreaterThan(20);
    expect(row(o, "Golden hour")).toMatch(/^all day/);
  });
  test("B2: Tromsø midwinter golden hour is one stretch 10:30 to 12:55; midsummer evening runs past midnight", () => {
    const dec = sun({ lat: "69.65", lon: "18.96", date: "2026-12-21", time: "12:00", tz: "1" });
    expect(row(dec, "Golden hour")).toMatch(/^10:3\d to 12:5\d$/);
    const jun = sun({ lat: "69.65", lon: "18.96", date: "2026-06-21", time: "12:00", tz: "2" });
    expect(row(jun, "Golden hour")).toMatch(/until 0\d:\d\d \(from the night before\); from 22:3\d, lasting past midnight/);
  });
  test("M1: hemisphere letters and degrees-minutes-seconds are read; a wrong-axis letter is refused by name", () => {
    const a = sun({ lat: "33.8688 S", lon: "151.2093 E", date: "2026-06-21", time: "12:00", tz: "+10" });
    const b = sun({ lat: "-33.8688", lon: "151.2093", date: "2026-06-21", time: "12:00", tz: "+10" });
    expect(out("sun", a, "elevation")).toBeCloseTo(out("sun", b, "elevation"), 9);
    const c = sun({ lat: "51.5 N", lon: "0.1278 W" });
    const d = sun({ lat: "51.5", lon: "-0.1278" });
    expect(out("sun", c, "azimuth")).toBeCloseTo(out("sun", d, "azimuth"), 9);
    const e = sun({ lat: "33°52' S", lon: "151°12′33″ E", date: "2026-06-21", time: "12:00", tz: "+10" });
    const f = sun({ lat: String(-(33 + 52 / 60)), lon: String(151 + 12 / 60 + 33 / 3600), date: "2026-06-21", time: "12:00", tz: "+10" });
    expect(out("sun", e, "elevation")).toBeCloseTo(out("sun", f, "elevation"), 9);
    expect(sun({ lat: "33.87 E" }).text).toMatch(/belongs to a longitude/);
    expect(sun({ lat: "-33.87 S" }).text).toMatch(/both a sign and a hemisphere letter/);
    expect(sun({ lat: "33°75' S" }).text).toMatch(/minutes of 60 or more/);
  });
  test("M2: a temperature with its unit is read (12 °C, 54 °F)", () => {
    const c = sun({ temp: "12 °C" });
    const f = sun({ temp: "53.6 °F" });
    expect(c.ok).not.toBe(false);
    expect(out("sun", f, "elevation")).toBeCloseTo(out("sun", c, "elevation"), 9);
  });
  test("M3: an efficacy written 100 lm/W is read", () => {
    const o = run("rend-falloff", { eff: "100 lm/W" });
    expect(out("f", o, "lumens")).toBe(10000);
  });
  test("M4: spaced and mixed wavelength units are read (0.55 µm 700)", () => {
    const o = run("rend-atmosphere", { lams: "0.55 µm 700" });
    expect(o.ok).not.toBe(false);
    expect(o.outputs?.map((x) => x.key)).toEqual(expect.arrayContaining(["T550", "T700"]));
  });
  test("N1: one wavelength typed twice makes no blue-sky comparison of it with itself", () => {
    const o = run("rend-atmosphere", { lams: "550 550" });
    expect(o.ok).not.toBe(false);
    expect(o.text).not.toMatch(/more 550 nm than 550 nm/);
    expect(o.outputs?.filter((x) => x.key === "T550").length).toBe(1);
  });
  test("N2: a UTC offset typed as GMT or UTC is zero", () => {
    expect(out("sun", sun({ tz: "GMT" }), "elevation")).toBeCloseTo(out("sun", sun({ tz: "0" }), "elevation"), 12);
    expect(out("sun", sun({ tz: "UTC" }), "elevation")).toBeCloseTo(out("sun", sun({ tz: "0" }), "elevation"), 12);
  });
  test("N3: a view of 89.99° is printed as typed, not rounded to 90°", () => {
    expect(firstLine(run("rend-brdf", { tv: "89.99" }))).toMatch(/view 89\.99°/);
  });
  test("N6: no 'brightest input' for an exposed value; zero stops does not say 'brighter'", () => {
    expect(firstLine(run("rend-tonemap"))).toMatch(/brightest value after exposure/);
    expect(firstLine(run("rend-falloff", { stops: "0" }))).toMatch(/0 stops leaves the light where it is/);
  });
});
