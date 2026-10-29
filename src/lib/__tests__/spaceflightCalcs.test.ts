// Spaceflight & missions calculators (spaceflightCalcs.ts): the registry, the display contract on every ok result, a
// plain-language reading first, a figure on every result, an honest model note, every field read, every dropdown option
// computing, and named refusals for the adversarial inputs (e = 1, hyperbolic, circular, equatorial, 180° Lambert, a
// flight time too short, negative altitudes, re-entry at γ = 0, a mass ratio near 1, inputs that cannot converge).
// The numbers themselves are pinned against the oracle in spaceflightEngines.test.ts; here a few headline values are
// checked through the fields, so a units or wiring slip in the glue is caught.

import * as fs from "fs";
import * as path from "path";
import { SPACEFLIGHT_CALCS, SPACE_GROUP } from "../spaceflightCalcs";
import type { AnalyzeOutput } from "../analyzeBlocks";
import { mathToOmml } from "../mathOmml";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const O: any = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "spaceflight-oracle.json"), "utf8"));

const calc = (id: string) => {
  const c = SPACEFLIGHT_CALCS.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
function run(id: string, over: Record<string, string> = {}): AnalyzeOutput {
  const c = calc(id);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
const out = (o: AnalyzeOutput, key: string): number => {
  const e = (o.outputs ?? []).find((x) => x.key === key);
  if (!e) throw new Error(`no output ${key}: ${o.text}`);
  return e.value;
};
const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

/** The display contract on every ok result. */
function displayClean(o: AnalyzeOutput): void {
  const t = o.text;
  expect(t).not.toMatch(/\d[eE][-+]?\d/);
  expect(t).not.toMatch(/\^/);
  expect(t).not.toMatch(/NaN|Infinity|undefined/);
  expect(t).not.toMatch(/—/);
  expect(t).not.toMatch(/(^|[\s(,=[/])-\d/m);
  for (const b of o.blocks ?? []) {
    if (b.kind === "plot") {
      expect(b.svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(b.svg).not.toMatch(/>[^<]*\d[eE][-+]?\d[^<]*</);
      expect(b.svg).not.toMatch(/>[^<]*\^[^<]*</);
      expect(b.svg).not.toMatch(/>[^<]*(^|[\s(=])-\d[^<]*</);
      expect(b.caption).not.toMatch(/—/);
    }
  }
}
const ok = (o: AnalyzeOutput): AnalyzeOutput => {
  if (o.ok === false) throw new Error(`refused: ${o.text}`);
  displayClean(o);
  expect((o.blocks ?? []).some((b) => b.kind === "plot")).toBe(true);
  return o;
};
const refused = (o: AnalyzeOutput, re: RegExp): void => {
  expect(o.ok).toBe(false);
  expect(o.text).not.toMatch(/NaN|Infinity|undefined|—/);
  expect(o.text).toMatch(re);
};
/** The first line block: the plain-language reading. */
const reading = (o: AnalyzeOutput): string => {
  const first = (o.blocks ?? [])[0];
  if (!first || first.kind !== "line") throw new Error("the result does not open with a prose line");
  return first.text;
};

describe("registry", () => {
  test("ten calculators, unique ids, one group", () => {
    expect(SPACEFLIGHT_CALCS.map((c) => c.id)).toEqual([
      "space-elements", "space-lambert", "space-interplanetary", "space-lunar", "space-maneuvers", "space-perturbations", "space-three-body", "space-reentry", "space-ground", "space-thermal",
    ]);
    for (const c of SPACEFLIGHT_CALCS) expect(c.group).toBe(SPACE_GROUP);
  });
  test.each(SPACEFLIGHT_CALCS.map((c) => [c.id, c] as const))("%s: defaults compute, draw, read first, state the model", (_id, c) => {
    expect(c.hint.length).toBeGreaterThan(80);
    for (const f of c.fields) if (f.kind === "select") expect(f.options?.some((o) => o.value === f.default)).toBe(true);
    const o = ok(run(c.id));
    const rd = reading(o);
    // A reading built from the numbers: a sentence with at least one figure in it, not a formula.
    expect(rd).toMatch(/\d/);
    expect(rd.length).toBeGreaterThan(60);
    expect(o.text).toMatch(/Model:/);
    for (const b of o.blocks ?? []) if (b.kind === "math") expect(() => mathToOmml(b.math)).not.toThrow();
  });
  test.each(SPACEFLIGHT_CALCS.map((c) => [c.id, c] as const))("%s reads every field it declares", (_id, c) => {
    // Changing a field must change the result or be refused (a field nobody reads would do neither).
    const base = run(c.id).text;
    for (const f of c.fields) {
      let alt: string;
      if (f.kind === "select") {
        const other = f.options?.find((o) => o.value !== f.default);
        if (!other) continue;
        alt = other.value;
      } else if (f.default === "") alt = c.id === "space-three-body" ? "390000 km" : c.id === "space-lambert" ? "1, 2, 3 km/s" : "1";
      else {
        const m = /^(-?[\d.]+)(.*)$/.exec(f.default.trim());
        // A zero default moves by a visible amount: 20 000 km for a length, 0.5 of anything else.
        const zeroStep = /km\s*$/.test(m?.[2] ?? "") ? 20000 : 0.5;
        alt = m ? `${Number(m[1]) * 1.1 + (Number(m[1]) === 0 ? zeroStep : 0)}${m[2]}` : f.default === "sso" ? "97" : f.default + "x";
        if (f.key === "start") alt = "2026-10-01";
        if (/^-?[\d.]+, /.test(f.default)) alt = f.default.replace(/^(-?[\d.]+)/, (s) => String(Number(s) * 1.1));
      }
      const o = run(c.id, { [f.key]: alt });
      if (c.id === "space-three-body" && (f.key === "mu1" || f.key === "mu2")) {
        // Only read for a custom pair.
        const oc = run(c.id, { pair: "custom", d: "384400 km", [f.key]: alt });
        expect(oc.text).not.toBe(run(c.id, { pair: "custom", d: "384400 km" }).text);
        continue;
      }
      if (c.id === "space-elements" && ["r", "v"].includes(f.key)) {
        expect(run(c.id, { mode: "state", [f.key]: alt }).text).not.toBe(run(c.id, { mode: "state" }).text);
        continue;
      }
      expect({ field: f.key, changed: o.ok === false || o.text !== base }).toEqual({ field: f.key, changed: true });
    }
  });
});

describe("every dropdown option computes and draws (one at a time, the rest at defaults)", () => {
  const rows: Array<[string, string, string]> = [];
  for (const c of SPACEFLIGHT_CALCS) for (const f of c.fields) if (f.kind === "select") for (const o of f.options ?? []) rows.push([c.id, f.key, o.value]);
  const special: Record<string, Record<string, string>> = {
    // Bodies other than Earth for the elements tool: a size that fits outside every body offered.
    "space-elements body": { a: "3000000 km", e: "0.3" },
    "space-lambert body": { r1: "800000, 0, 100 km", r2: "0, 900000, 0 km", tof: "20 day" },
    "space-maneuvers body": { h1: "1000000 km", h2: "8000000 km", hb: "90000000 km" },
    "space-three-body pair": { x: "0.3 km" },
    "space-interplanetary dep": { tmin: "60 day", tmax: "1500 day", span: "400 day" },
    "space-interplanetary arr": { tmin: "60 day", tmax: "1500 day", span: "400 day" },
  };
  test.each(rows)("%s %s = %s", (id, key, value) => {
    let over: Record<string, string> = { [key]: value };
    const sp = special[`${id} ${key}`];
    if (sp) over = { ...sp, ...over };
    if (id === "space-interplanetary" && ((key === "dep" && value === "mars") || (key === "arr" && value === "earth"))) {
      // Same planet at both ends is refused by name.
      const o = run(id, over);
      if (o.ok === false) {
        expect(o.text).toMatch(/same/);
        return;
      }
    }
    if (id === "space-three-body" && value === "custom") over = { ...over, d: "384400 km" };
    if (id === "space-three-body" && value !== "custom" && value !== "earth-moon") {
      // A state for the Sun pairs: 0.8 of the separation from the barycentre.
      const o = run(id, { pair: value, x: "1e5 km" });
      ok(o);
      return;
    }
    ok(run(id, over));
  });
});

describe("headline values through the fields", () => {
  test("elements: Curtis 4.3 in state-vector mode", () => {
    const o = ok(run("space-elements", { mode: "state", t: "" }));
    expect(rel(out(o, "e"), O.orbit.curtis_4_3.e)).toBeLessThan(1e-9);
    expect(rel(out(o, "h"), O.orbit.curtis_4_3.h / 1e6)).toBeLessThan(1e-9);
  });
  test("Lambert: Curtis 5.2", () => {
    const o = ok(run("space-lambert"));
    const v1 = O.lambert.curtis_5_2.v1.map((x: number) => x / 1000);
    expect(rel(out(o, "v1"), Math.hypot(...v1))).toBeLessThan(1e-6);
  });
  test("interplanetary: the Hohmann numbers and the porkchop minimum", () => {
    const o = ok(run("space-interplanetary"));
    expect(rel(out(o, "c3"), O.interplanetary.earth_mars.c3 / 1e6)).toBeLessThan(1e-9);
    expect(rel(out(o, "dvDep"), O.interplanetary.earth_mars.dv_dep / 1000)).toBeLessThan(1e-9);
    expect(rel(out(o, "c3min"), O.interplanetary.porkchop_cells[0].c3 / 1e6)).toBeLessThan(1e-6);
    expect(reading(o)).toMatch(/2026-10-31/);
  });
  test("lunar: 3-day TLI and LOI (Apollo-like)", () => {
    const o = ok(run("space-lunar"));
    expect(rel(out(o, "tli"), O.lunar.three_day.tli / 1000)).toBeLessThan(1e-8);
    expect(rel(out(o, "loi"), O.lunar.three_day.loi / 1000)).toBeLessThan(1e-8);
  });
  test("maneuvers: GTO to GEO combined, separate, phasing", () => {
    const o = ok(run("space-maneuvers"));
    expect(rel(out(o, "combined"), O.maneuvers.gto.combined_end / 1000)).toBeLessThan(1e-9);
    expect(rel(out(o, "separate"), O.maneuvers.gto.separate_start / 1000)).toBeLessThan(1e-9);
    expect(rel(out(o, "phasing"), O.maneuvers.gto.phasing_dv / 1000)).toBeLessThan(1e-9);
  });
  test("perturbations: SSO at 800 km", () => {
    const o = ok(run("space-perturbations"));
    expect(Math.abs(out(o, "sso") - O.j2.sso_800_deg)).toBeLessThan(1e-9);
    expect(Math.abs(out(o, "geoDrift") - O.j2.geo_drift_50km_deg_day)).toBeLessThan(1e-12);
  });
  test("three-body: Earth–Moon L1 and the default state's Jacobi constant", () => {
    const o = ok(run("space-three-body"));
    expect(rel(out(o, "L1p"), O.three_body["earth-moon"].L1_from_primary_m / 1000)).toBeLessThan(1e-9);
    expect(rel(out(o, "C"), O.three_body.default_state_C)).toBeLessThan(1e-12);
    expect(rel(out(o, "rocheRigid"), O.three_body.roche_earth_rigid_3340_m / 1000)).toBeLessThan(1e-9);
  });
  test("re-entry: closed form, integration and decay", () => {
    const o = ok(run("space-reentry"));
    expect(rel(out(o, "aMax"), O.entry.a_max_g)).toBeLessThan(1e-9);
    expect(rel(out(o, "aMaxNum"), O.entry.numeric_a_max_g)).toBeLessThan(5e-3);
    expect(rel(out(o, "lifeMod"), O.decay.capsule_250km_days.moderate)).toBeLessThan(2e-3);
  });
  test("ground station and thermal", () => {
    const g = ok(run("space-ground"));
    expect(Math.abs(out(g, "el") - O.ground.el_deg)).toBeLessThan(1e-9);
    expect(rel(out(g, "doppler"), O.ground.doppler_hz / 1000)).toBeLessThan(1e-6);
    const t = ok(run("space-thermal"));
    expect(rel(out(t, "tHot"), O.thermal.t_hot)).toBeLessThan(1e-12);
  });
  test("astronomical units are read (1 au = 149 597 870.7 km exactly)", () => {
    const a = ok(run("space-thermal", { d: "1 au" }));
    const b = ok(run("space-thermal", { d: "149597870.7 km" }));
    expect(out(a, "tHot")).toBe(out(b, "tHot"));
    expect(a.text).toMatch(/1 au = 149597870\.7 km/);
  });
});

describe("adversarial", () => {
  test("e = 1 exactly: a parabola sized by rp; sized by a it is refused by name", () => {
    const o = ok(run("space-elements", { e: "1", size: "rp", a: "7000 km", nu: "20" }));
    expect(reading(o)).toMatch(/exactly parabolic/);
    refused(run("space-elements", { e: "1", size: "a" }), /parabola.*no finite semi-major axis/);
  });
  test("hyperbolic: positive a is read as negative with a note; ν beyond the asymptote refused", () => {
    const o = ok(run("space-elements", { e: "1.5", a: "20000 km", nu: "30" }));
    expect(o.text).toMatch(/negative by convention/);
    expect(reading(o)).toMatch(/escapes Earth/);
    refused(run("space-elements", { e: "1.5", a: "20000 km", nu: "140" }), /asymptotes/);
  });
  test("circular: the argument of latitude; circular equatorial: the true longitude", () => {
    const c = ok(run("space-elements", { e: "0", a: "7000 km", i: "51.6" }));
    expect(c.text).toMatch(/argument of latitude/);
    const ce = ok(run("space-elements", { e: "0", a: "42164 km", i: "0" }));
    expect(ce.text).toMatch(/true longitude/);
  });
  test("equatorial elliptic: Ω reported 0, ω the longitude of periapsis", () => {
    const o = ok(run("space-elements", { i: "0", e: "0.3", a: "12000 km" }));
    expect(o.text).toMatch(/longitude of periapsis/);
  });
  test("negative altitudes and positions inside the body are refused by name", () => {
    refused(run("space-elements", { mode: "state", r: "1000, 0, 0 km" }), /inside Earth/);
    refused(run("space-maneuvers", { h1: "-10 km" }), /below zero/);
    refused(run("space-interplanetary", { park: "-1 km" }), /below zero|inside/);
    refused(run("space-lunar", { park: "-5 km" }), /below zero/);
    refused(run("space-perturbations", { h: "-5 km" }), /inside Earth/);
    refused(run("space-ground", { h: "-5 km" }), /inside Earth/);
    refused(run("space-reentry", { hd: "90 km" }), /above 120 km/);
  });
  test("Lambert 180° transfer and too-short time refused by name", () => {
    refused(run("space-lambert", { r1: "7000, 0, 0 km", r2: "-9000, 0, 0 km" }), /180° transfer/);
    refused(run("space-lambert", { tof: "0.2 s", way: "long" }), /too short/);
    refused(run("space-lambert", { tof: "0 s" }), /greater than zero/);
  });
  test("re-entry at γ = 0 refused by name", () => {
    refused(run("space-reentry", { g: "0" }), /0°.*skips|grazing/);
  });
  test("a custom pair with a mass ratio of exactly 1 and just under 1; the larger listed second is swapped", () => {
    const eq = ok(run("space-three-body", { pair: "custom", mu1: "1000", mu2: "1000", d: "10000 km", x: "3000 km", rhos: "3000 kg/m^3" }));
    expect(out(eq, "mu")).toBe(0.5);
    expect(eq.text).toMatch(/UNSTABLE/);
    const near1 = ok(run("space-three-body", { pair: "custom", mu1: "1000", mu2: "999", d: "10000 km", x: "3000 km" }));
    expect(out(near1, "mu")).toBeCloseTo(999 / 1999, 12);
    const sw = ok(run("space-three-body", { pair: "custom", mu1: "10", mu2: "1000", d: "10000 km", x: "3000 km" }));
    expect(sw.text).toMatch(/swapped/);
  });
  test("non-converging or impossible inputs are refused, not answered", () => {
    refused(run("space-lunar", { tof: "8 day" }), /longer than the minimum-energy/);
    refused(run("space-lunar", { tof: "0.1 day" }), /escape/);
    refused(run("space-perturbations", { h: "8000 km" }), /No inclination is sun-synchronous/);
    refused(run("space-interplanetary", { start: "2049-06-01" }), /1800 to 2050/);
    refused(run("space-interplanetary", { start: "June 2026" }), /YYYY-MM-DD/);
    refused(run("space-interplanetary", { arr: "earth" }), /same/);
    refused(run("space-thermal", { eps: "0" }), /cannot radiate/);
    refused(run("space-elements", { e: "abc" }), /Eccentricity/);
    refused(run("space-lambert", { r1: "1, 2" }), /three numbers/);
    refused(run("space-elements", { t: "5 kg" }), /Propagation time/);
  });
});
