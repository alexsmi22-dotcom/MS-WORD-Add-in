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
import { lambert, norm, propagate, type V3 } from "../spaceOrbit";
import { GM_SI, R_EQ_SI } from "../spaceConstants";
import { phasing } from "../spaceMissions";

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
    "space-three-body pair": { x: "300000 km" },
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
      const o = run(id, { pair: value, x: "1e8 km" });
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

// ---------------------------------------------------------------------------------------------------------------
// Independent review of v2.206.0 (scratchpad RSP/findings-space.md): each finding's exact repro, pinned.
// ---------------------------------------------------------------------------------------------------------------

/** Every "M x,y L x,y …" path in an SVG as point lists. */
const svgPaths = (svg: string): Array<Array<[number, number]>> =>
  [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => [...m[1].matchAll(/([\d.]+),([\d.]+)/g)].map((p) => [Number(p[1]), Number(p[2])] as [number, number]));
/** Distance from a point to a polyline, px. */
function distToPath(x: number, y: number, pts: Array<[number, number]>): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}

describe("review findings", () => {
  test("B1: a descending transfer names the cheapest plane-change option (combined with the first burn, 4.2215 km/s)", () => {
    const o = ok(run("space-maneuvers", { h1: "35786 km", h2: "400 km", revs: "3" }));
    expect(out(o, "bestPlane")).toBeCloseTo(out(o, "combinedStart"), 12);
    expect(out(o, "combinedStart")).toBeCloseTo(4.2215, 4);
    expect(reading(o)).toMatch(/cheapest combined with the burn at the higher orbit \(4\.222 km\/s/);
    expect(reading(o)).toMatch(/slowest, at the 35786 km end/);
    expect(reading(o)).not.toMatch(/5\.368/);
  });
  test("B2: a long-way arc that wraps past 360° through periapsis inside Earth is flagged (repro and 300 random cases against sampling)", () => {
    expect(reading(ok(run("space-lambert", { r1: "9318, 0, 0 km", r2: "8138, 164, 119 km", tof: "6576 s", way: "long" })))).toMatch(/dips to −6252\.\d+ km altitude, inside Earth: it cannot be flown/);
    const mu = GM_SI.earth;
    const R = R_EQ_SI.earth;
    let seed = 12345;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let checked = 0;
    for (let k = 0; k < 300; k++) {
      const r1: V3 = [7000 + 6000 * rnd(), 0, 0];
      const ang = 2 * Math.PI * rnd();
      const rad = 7000 + 6000 * rnd();
      const r2: V3 = [Number((rad * Math.cos(ang)).toFixed(3)), Number((rad * Math.sin(ang)).toFixed(3)), Number((300 * (rnd() - 0.5)).toFixed(3))];
      const tof = Math.round(600 + 9000 * rnd());
      const way = rnd() < 0.5 ? "short" : "long";
      const o = run("space-lambert", { r1: `${r1.join(", ")} km`, r2: `${r2.join(", ")} km`, tof: `${tof} s`, way });
      if (o.ok === false) continue;
      const r1m = r1.map((x) => x * 1000) as V3;
      const L = lambert(mu, r1m, r2.map((x) => x * 1000) as V3, tof, way);
      if (!L.ok) continue;
      let minR = Infinity;
      for (let j = 0; j <= 400; j++) {
        const p = propagate(mu, r1m, L.v1, (tof * j) / 400);
        if (p.ok) minR = Math.min(minR, norm(p.r));
      }
      // Sampling can only miss a dip, never invent one: a sampled dip of more than 1 km must be flagged.
      if (minR < R - 1000) expect({ k, flagged: /cannot be flown/.test(reading(o)) }).toEqual({ k, flagged: true });
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });
  test("M1: ordinary low transfers (400→500 km, 200→400 km) compute; phasing takes the fewest revolutions that clear Earth", () => {
    for (const [h1, h2] of [["400 km", "500 km"], ["200 km", "400 km"]]) {
      const o = ok(run("space-maneuvers", { h1, h2 }));
      expect(reading(o)).toMatch(/1 revolution would dip inside Earth, so 2 are used/);
      expect(out(o, "phRevs")).toBe(2);
    }
  });
  test("M2: a skipping entry is not quoted as a peak (v = 11, γ = 1); an interface at 999 km is refused", () => {
    const o = ok(run("space-reentry", { v: "11 km/s", g: "1" }));
    expect(reading(o)).toMatch(/skips back out of the atmosphere/);
    expect(reading(o)).not.toMatch(/when integrated with gravity on the 1976/);
    expect(o.outputs?.some((x) => x.key === "aMaxNum")).toBe(false);
    refused(run("space-reentry", { he: "999 km", v: "7.36 km/s", g: "0.001" }), /at most 300 km/);
    expect(reading(ok(run("space-reentry", { he: "250 km", v: "7.36 km/s", g: "0.001" })))).toMatch(/closed form does not apply/);
  });
  test("M3: Mars-like inputs do not get an Earth integration beside them", () => {
    const o = ok(run("space-reentry", { rho0: "0.02 kg/m^3", H: "11.1 km", k: "1.9027e-4", v: "5.5 km/s", g: "12" }));
    expect(o.text).toMatch(/numerical check is not run/);
    expect(o.text).not.toMatch(/when integrated with gravity/);
    expect(o.outputs?.some((x) => x.key === "aMaxNum")).toBe(false);
  });
  test("M4: on a hyperbola (e 1.6, rp 7000 km, ν −60°, t 3 h) both markers sit on the drawn path in every view", () => {
    const o = ok(run("space-elements", { e: "1.6", a: "7000 km", size: "rp", nu: "-60", t: "3 h" }));
    const plots = (o.blocks ?? []).filter((b) => b.kind === "plot") as Array<{ svg: string }>;
    expect(plots.length).toBe(3);
    for (const p of plots) {
      const orbit = svgPaths(p.svg).sort((a, b) => b.length - a.length)[0];
      const marks = [...p.svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="[\d.]+" fill="#(2e7d32|c00000)"\/>/g)].slice(0, 2);
      expect(marks.length).toBe(2);
      for (const m of marks) expect(distToPath(Number(m[1]), Number(m[2]), orbit)).toBeLessThan(2);
    }
  });
  test("M5: the thermal figure draws for α = 0 and for no sunlit area", () => {
    for (const over of [{ alpha: "0" }, { as: "0 m^2" }] as Array<Record<string, string>>) {
      const o = ok(run("space-thermal", over));
      const svg = (o.blocks ?? []).find((b) => b.kind === "plot") as { svg: string };
      expect(svg.svg.length).toBeGreaterThan(1000);
    }
  });
  test("M6: an Earth→Jupiter porkchop (tmin 500, tmax 1200, span 400) blanks at most 15 % of the grid and contours the rest", () => {
    const o = ok(run("space-interplanetary", { arr: "jupiter", tmin: "500 day", tmax: "1200 day", span: "400 day" }));
    const svg = ((o.blocks ?? []).find((b) => b.kind === "plot") as { svg: string }).svg;
    const blank = Number(/(\d+) cells above C3/.exec(svg)?.[1] ?? 0);
    expect(blank).toBeLessThanOrEqual(0.15 * 41 * 41);
    expect((svg.match(/<(path|polyline) /g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
  test("M7: a geostationary track moves a fraction of a degree, with its direction, not 359.97° west (and minor 4: 1 orbit)", () => {
    const o = ok(run("space-perturbations", { h: "35786 km", i: "0" }));
    expect(reading(o)).toMatch(/moves 0\.027° \(3\.0\d+ km at the equator\) east each orbit/);
    expect(reading(o)).not.toMatch(/359/);
    expect(reading(o)).toMatch(/1 orbit in 1 day/);
  });
  test("minor 1, 2, 5, 6, 7: wording", () => {
    expect(reading(ok(run("space-elements", { t: "-2 h" })))).toMatch(/ 2\.000 h before the epoch/);
    expect(reading(ok(run("space-maneuvers", { lead: "-30" })))).toMatch(/a target 30° behind/);
    expect(reading(ok(run("space-maneuvers", { hb: "35786 km" })))).toMatch(/is the Hohmann transfer/);
    const d = reading(ok(run("space-reentry", { hd: "900 km", m: "50000 kg", A: "1 m^2" })));
    expect(d).toMatch(/stay up more than 200 years at any solar activity/);
    expect(d).not.toMatch(/about over|about more/);
    const h = ok(run("space-elements", { e: "1.6", a: "7000 km", size: "rp", nu: "-60", t: "3 h" }));
    expect(h.text).toMatch(/True anomaly ν\s+−60\.0000°/);
  });
  test("minor 3: the phasing refusal names the revolutions asked for", () => {
    const p = phasing(GM_SI.earth, R_EQ_SI.earth + 400e3, Math.PI / 6, 1, R_EQ_SI.earth);
    expect(!p.ok && /^One phasing revolution/.test(p.error)).toBe(true);
    const q = phasing(GM_SI.earth, R_EQ_SI.earth + 200e3, (300 * Math.PI) / 180, 2, R_EQ_SI.earth);
    expect(!q.ok && /^2 phasing revolutions/.test(q.error)).toBe(true);
  });
  test("minor 8: out-of-range inputs are refused by name, never printed in e-notation", () => {
    refused(run("space-lunar", { llo: "70000 km" }), /lunar orbit altitude must be at most 20 000 km/);
    refused(run("space-lunar", { llo: "1e300 km" }), /lunar orbit altitude/);
    refused(run("space-perturbations", { da: "1e300 km" }), /GEO offset/);
    refused(run("space-maneuvers", { revs: "1e300" }), /Phasing revolutions/);
    refused(run("space-thermal", { ir: "1e300 W/m^2" }), /Planet infrared flux/);
    refused(run("space-reentry", { k: "1e300" }), /Sutton–Graves constant/);
    refused(run("space-ground", { f: "1e300 GHz" }), /Frequency/);
    refused(run("space-thermal", { eps: "1e-300" }), /emittance/);
  });
  test("minor 9: the product's own ×10ⁿ format reads back (k = 1.7415×10⁻⁴)", () => {
    expect(out(ok(run("space-reentry", { k: "1.7415×10⁻⁴" })), "qMax")).toBe(out(ok(run("space-reentry")), "qMax"));
  });
  test("minor 10: tiny flight times and huge separations are refused naming the field", () => {
    refused(run("space-interplanetary", { tmin: "1e-7 day" }), /Shortest flight time/);
    refused(run("space-three-body", { d: "1e300 km" }), /Separation/);
  });
  test("minor 11: a three-body state inside Earth (x = −4670.7 km) is refused", () => {
    refused(run("space-three-body", { x: "-4670.7 km" }), /centre of Earth, inside it/);
  });
  test("minor 12: straight overhead the azimuth is reported as not defined", () => {
    const o = ok(run("space-ground", { plat: "40.0", plon: "-105.0" }));
    expect(reading(o)).toMatch(/straight overhead \(azimuth not defined\)/);
    expect(o.outputs?.some((x) => x.key === "az")).toBe(false);
  });
});
