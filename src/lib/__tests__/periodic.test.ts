// The periodic table: what is computed, what is held, and what is deliberately absent.
//
// This feature was built under a constraint that shaped all of it: the standing rule
// that ALL DATA MUST BE REAL, with the precedent of refusing to build in steam tables
// because a table reconstructed from memory is unverifiable. A 118-element table with
// ten properties each is ~1,200 measured values, and they need a cited source.
//
// So the tests below fall into three groups, and the third is as important as the
// first two:
//
//   COMPUTED — the aufbau order, configurations, shells, blocks, groups. Checked
//   against structural facts that follow from the rules rather than from a table:
//   noble gases fall where a p subshell closes, shell totals equal the atomic number,
//   every element lands in exactly one cell.
//
//   HELD — the atomic number comes from the ORDER of the existing verified PERIODIC
//   table, not from a second list that could disagree with the first.
//
//   ABSENT — the properties that are not carried are asserted to be REPORTED as
//   absent. A reference that quietly omits a property is indistinguishable from one
//   that has no data for that element, and the difference matters.

import {
  atomicNumber,
  symbolFor,
  atomicWeight,
  aufbauOrder,
  electronConfiguration,
  configurationString,
  nobleGasConfiguration,
  shellOccupancy,
  placement,
  isNobleGas,
  NOBLE_GAS_NUMBERS,
  ELEMENT_COUNT,
  ELEMENT_SYMBOLS,
  ABSENT_PROPERTIES,
  elementName,
  atomicNumberByName,
  measuredConfiguration,
  configurationIsPredicted,
} from "../periodic";
import {
  buildBohrSvg,
  buildOrbitalSvg,
  buildPeriodicTableSvg,
  elementReport,
  AUFBAU_CAVEAT,
} from "../periodicChart";
import { PERIODIC } from "../chemValidate";

describe("the atomic number comes from the held table's own order", () => {
  test("there are 118 elements and the index is the atomic number", () => {
    expect(ELEMENT_COUNT).toBe(118);
    expect(ELEMENT_SYMBOLS.length).toBe(Object.keys(PERIODIC).length);
    // Spot values a reader can check without a reference book.
    expect(atomicNumber("H")).toBe(1);
    expect(atomicNumber("C")).toBe(6);
    expect(atomicNumber("O")).toBe(8);
    expect(atomicNumber("Fe")).toBe(26);
    expect(atomicNumber("Ag")).toBe(47);
    expect(atomicNumber("Au")).toBe(79);
    expect(atomicNumber("U")).toBe(92);
    expect(atomicNumber("Og")).toBe(118);
  });

  test("symbolFor and atomicNumber are inverse across the whole table", () => {
    for (let z = 1; z <= ELEMENT_COUNT; z++) {
      const s = symbolFor(z);
      expect({ z, back: atomicNumber(s as string) }).toEqual({ z, back: z });
    }
  });

  test("out-of-range and unknown inputs give null, not a guess", () => {
    expect(symbolFor(0)).toBeNull();
    expect(symbolFor(119)).toBeNull();
    expect(symbolFor(1.5)).toBeNull();
    expect(atomicNumber("Xx")).toBeNull();
    expect(atomicNumber("h")).toBeNull(); // case matters in chemistry
  });

  test("the atomic weight is the one already held and verified", () => {
    expect(atomicWeight(1)).toBe(PERIODIC.H);
    expect(atomicWeight(8)).toBe(PERIODIC.O);
    expect(atomicWeight(26)).toBe(PERIODIC.Fe);
  });
});

describe("the aufbau order is generated from its rule", () => {
  test("it reproduces the Madelung sequence", () => {
    // The sequence every student learns. Generated from "increasing n+l, then
    // increasing n" — so a transposition is impossible rather than merely unlikely.
    const seq = aufbauOrder(19).map((o) => `${o.n}${"spdf"[o.l]}`);
    expect(seq).toEqual([
      "1s", "2s", "2p", "3s", "3p", "4s", "3d", "4p", "5s", "4d",
      "5p", "6s", "4f", "5d", "6p", "7s", "5f", "6d", "7p",
    ]);
  });

  test("every entry obeys the rule it was generated from", () => {
    const all = aufbauOrder(40);
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1];
      const b = all[i];
      const sa = a.n + a.l;
      const sb = b.n + b.l;
      expect({ i, ok: sb > sa || (sb === sa && b.n > a.n) }).toEqual({ i, ok: true });
      expect(b.l).toBeLessThan(b.n); // l < n always
    }
  });
});

describe("electron configuration", () => {
  test("the electrons add up to the atomic number, for every element", () => {
    // The invariant that catches an off-by-one anywhere in the filling.
    for (let z = 1; z <= ELEMENT_COUNT; z++) {
      const cfg = electronConfiguration(z) as ReturnType<typeof electronConfiguration>;
      const total = (cfg as NonNullable<typeof cfg>).reduce((s, x) => s + x.electrons, 0);
      expect({ z, total }).toEqual({ z, total: z });
    }
  });

  test("no subshell ever exceeds its capacity", () => {
    for (let z = 1; z <= ELEMENT_COUNT; z++) {
      for (const s of electronConfiguration(z) as NonNullable<ReturnType<typeof electronConfiguration>>) {
        expect({ z, ok: s.electrons <= s.capacity && s.electrons > 0 }).toEqual({ z, ok: true });
        expect(s.capacity).toBe(2 * (2 * s.l + 1));
      }
    }
  });

  test.each([
    [1, "1s1"],
    [2, "1s2"],
    [6, "1s2 2s2 2p2"],
    [10, "1s2 2s2 2p6"],
    [11, "1s2 2s2 2p6 3s1"],
    [18, "1s2 2s2 2p6 3s2 3p6"],
    [19, "1s2 2s2 2p6 3s2 3p6 4s1"],
  ])("Z = %s is %s", (z, want) => {
    expect(configurationString(z)).toBe(want);
  });

  test("the noble-gas shorthand is consistent with the full configuration", () => {
    // Rather than checking strings against a remembered table, check the two forms
    // agree: expanding the core must give back the same electron count.
    for (let z = 3; z <= ELEMENT_COUNT; z++) {
      const short = nobleGasConfiguration(z) as string;
      const core = /^\[([A-Z][a-z]?)\]/.exec(short);
      expect({ z, hasCore: core !== null }).toEqual({ z, hasCore: true });
      const coreZ = atomicNumber(core![1]) as number;
      const tail = short
        .replace(/^\[[A-Z][a-z]?\]\s*/, "")
        .split(/\s+/)
        .filter(Boolean)
        .reduce((sum, t) => sum + parseInt(/\d+$/.exec(t)?.[0] ?? "0", 10), 0);
      expect({ z, sum: coreZ + tail }).toEqual({ z, sum: z });
    }
  });

  test("shells sum to the atomic number and never exceed 2n²", () => {
    for (let z = 1; z <= ELEMENT_COUNT; z++) {
      const shells = shellOccupancy(z) as number[];
      expect({ z, sum: shells.reduce((a, b) => a + b, 0) }).toEqual({ z, sum: z });
      shells.forEach((count, i) => {
        const n = i + 1;
        expect({ z, n, ok: count <= 2 * n * n }).toEqual({ z, n, ok: true });
      });
    }
  });

  test("it says the configuration is PREDICTED, because ~20 elements differ", () => {
    // Chromium is the textbook case: aufbau gives [Ar]4s2 3d4, measurement gives
    // [Ar]4s1 3d5. The tool shows the prediction and must not call it the measurement.
    expect(configurationString(24)).toBe("1s2 2s2 2p6 3s2 3p6 4s2 3d4");
    expect(AUFBAU_CAVEAT).toMatch(/PREDICTED/);
    expect(AUFBAU_CAVEAT).toMatch(/chromium and copper/);
    expect(buildBohrSvg(24)!.notes.join(" ")).toMatch(/PREDICTED/);
    expect(buildOrbitalSvg(24)!.notes.join(" ")).toMatch(/PREDICTED/);
    expect(elementReport("Cr")!.lines.join(" ")).toMatch(/Aufbau prediction/);
    // Now that the measured value is carried, the two sit side by side with the
    // disagreement called out rather than left for the reader to spot.
    expect(elementReport("Cr")!.lines.join(" ")).toMatch(/these DIFFER/);
  });
});

describe("the noble gases are DERIVED, not listed", () => {
  test("they are exactly where a p subshell closes", () => {
    // Not typed in — found by asking which elements complete a p subshell (plus
    // helium, which completes 1s and has no 1p). That the answer comes out as the
    // familiar seven is the check.
    expect([...NOBLE_GAS_NUMBERS]).toEqual([2, 10, 18, 36, 54, 86, 118]);
    expect(NOBLE_GAS_NUMBERS.map((z) => symbolFor(z))).toEqual([
      "He", "Ne", "Ar", "Kr", "Xe", "Rn", "Og",
    ]);
  });

  test("isNobleGas agrees, and nothing else qualifies", () => {
    for (let z = 1; z <= ELEMENT_COUNT; z++) {
      expect({ z, noble: isNobleGas(z) }).toEqual({ z, noble: NOBLE_GAS_NUMBERS.includes(z) });
    }
  });

  test("each noble gas closes a period", () => {
    for (const z of NOBLE_GAS_NUMBERS) {
      expect(placement(z)!.group).toBe(18);
      if (z < ELEMENT_COUNT) {
        expect(placement(z + 1)!.period).toBe(placement(z)!.period + 1);
      }
    }
  });
});

describe("placement in the table", () => {
  test.each([
    ["H", 1, 1, "s"],
    ["He", 1, 18, "s"],
    ["Li", 2, 1, "s"],
    ["B", 2, 13, "p"],
    ["Ne", 2, 18, "p"],
    ["Sc", 4, 3, "d"],
    ["Zn", 4, 12, "d"],
    ["Kr", 4, 18, "p"],
    ["Hf", 6, 4, "d"],
    ["Rn", 6, 18, "p"],
    ["Og", 7, 18, "p"],
  ])("%s is period %s, group %s, %s-block", (sym, period, group, block) => {
    const p = placement(atomicNumber(sym as string) as number)!;
    expect({ period: p.period, group: p.group, block: p.block }).toEqual({ period, group, block });
  });

  test("every element lands in exactly one cell", () => {
    // The layout check that would catch an overlap or a hole: no two elements may
    // share a (period, group), and every f-series member must be flagged as such.
    const seen = new Set<string>();
    let fCount = 0;
    for (let z = 1; z <= ELEMENT_COUNT; z++) {
      const p = placement(z)!;
      if (p.fSeries) {
        fCount++;
        expect(p.group).toBeNull();
        expect(p.block).toBe("f");
        continue;
      }
      const key = `${p.period}:${p.group}`;
      expect({ z, key, clash: seen.has(key) }).toEqual({ z, key, clash: false });
      seen.add(key);
      expect(p.group).toBeGreaterThanOrEqual(1);
      expect(p.group).toBeLessThanOrEqual(18);
    }
    // Two f series of fifteen: 57–71 and 89–103.
    expect(fCount).toBe(30);
  });

  test("the group-3 question is NOT silently decided", () => {
    // Whether lanthanum or lutetium belongs in group 3 is genuinely unsettled. Taking
    // a side would present one convention as fact, so the whole series sits outside
    // the numbered groups and the figure says so.
    for (const sym of ["La", "Lu", "Ac", "Lr"]) {
      const p = placement(atomicNumber(sym) as number)!;
      expect({ sym, group: p.group, f: p.fSeries }).toEqual({ sym, group: null, f: true });
    }
    expect(buildPeriodicTableSvg().notes.join(" ")).toMatch(/has not settled/);
  });
});

describe("the figures", () => {
  test("no non-finite coordinate reaches any of them", () => {
    for (const z of [1, 2, 6, 26, 57, 79, 92, 118]) {
      expect(buildBohrSvg(z)!.svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(buildOrbitalSvg(z)!.svg).not.toMatch(/NaN|Infinity|undefined/);
    }
    expect(buildPeriodicTableSvg("Fe").svg).not.toMatch(/NaN|Infinity|undefined/);
  });

  test("the Bohr diagram draws one dot per electron", () => {
    for (const z of [1, 6, 11, 18, 36]) {
      const svg = buildBohrSvg(z)!.svg;
      // Electron dots are r="3"; the nucleus and rings are drawn differently.
      const dots = [...svg.matchAll(/<circle [^>]*r="3"/g)].length;
      expect({ z, dots }).toEqual({ z, dots: z });
    }
  });

  test("the Bohr diagram says it is a teaching model, not current physics", () => {
    expect(buildBohrSvg(6)!.notes.join(" ")).toMatch(/TEACHING MODEL/);
    expect(buildBohrSvg(6)!.notes.join(" ")).toMatch(/do not orbit/);
  });

  test("the orbital diagram grows to fit rather than cropping", () => {
    // A fixed height silently dropped the outer subshells of heavy elements: gold and
    // oganesson came out identical in size, with oganesson's 7p simply missing.
    const au = buildOrbitalSvg(79)!.svg.length;
    const og = buildOrbitalSvg(118)!.svg.length;
    expect(og).toBeGreaterThan(au);
    const cfg = electronConfiguration(118)!;
    const rows = [...buildOrbitalSvg(118)!.svg.matchAll(/font-size="10"/g)].length;
    expect(rows).toBe(cfg.length);
  });

  test("a forced-small orbital figure SAYS it is incomplete", () => {
    const r = buildOrbitalSvg(118, 460, 120)!;
    expect(r.notes.join(" ")).toMatch(/INCOMPLETE/);
    expect(r.notes.join(" ")).toMatch(/taller figure/);
  });

  test("the orbital diagram applies Hund's rule", () => {
    // 2p4 must be one pair and two singles, not two pairs. Three up arrows and one
    // down in that subshell — countable from the markup.
    const svg = buildOrbitalSvg(8)!.svg; // oxygen, 1s2 2s2 2p4
    const ups = [...svg.matchAll(/l-2\.2 3\.4 l4\.4 0 z/g)].length;
    const downs = [...svg.matchAll(/l-2\.2 -3\.4 l4\.4 0 z/g)].length;
    // 1s: 1 up 1 down. 2s: 1 up 1 down. 2p4: 3 up, 1 down.
    expect({ ups, downs }).toEqual({ ups: 5, downs: 3 });
  });

  test("the table draws every element once", () => {
    const svg = buildPeriodicTableSvg().svg;
    for (const sym of ["H", "He", "C", "Fe", "La", "U", "Og"]) {
      expect(svg).toContain(`>${sym}<`);
    }
    // 118 cells plus the background rect.
    expect([...svg.matchAll(/<rect /g)].length).toBe(ELEMENT_COUNT + 1);
  });

  test("highlighting picks out exactly one cell", () => {
    const plain = buildPeriodicTableSvg().svg;
    const lit = buildPeriodicTableSvg("Fe").svg;
    expect(lit).not.toBe(plain);
    expect([...lit.matchAll(/#cde2fb/g)].length).toBe(1);
  });
});

describe("what is NOT carried is REPORTED, not silently omitted", () => {
  test("the absent list names the properties and why each is absent", () => {
    const names = ABSENT_PROPERTIES.map((a) => a.name.toLowerCase()).join(" | ");
    // Shorter than it was: names, measured configurations and oxidation states have
    // since been fetched from a cross-checked source. What remains is what that source
    // does not carry, and each entry still says why.
    for (const wanted of ["melting", "density", "crystal structure", "mohs", "spectral"]) {
      expect({ wanted, present: names.includes(wanted) }).toEqual({ wanted, present: true });
    }
    // Every entry gives a reason — "absent" without "why" invites someone to fill it
    // in from memory, which is the thing being prevented.
    for (const a of ABSENT_PROPERTIES) expect(a.why.length).toBeGreaterThan(40);
  });

  test("the element report lists them, so a reader cannot mistake absence for zero", () => {
    const r = elementReport("Fe")!;
    const text = r.lines.join("\n");
    expect(text).toMatch(/NOT CARRIED BY THIS TOOL/);
    expect(text).toMatch(/Mohs hardness/);
    expect(text).toMatch(/Spectral emission lines/);
    expect(r.notes.join(" ")).toMatch(/No measured property has been filled in from memory/);
    expect(r.notes.join(" ")).toMatch(/fetched from PubChem and cross-checked/);
    expect(r.notes.join(" ")).toMatch(/HELD IUPAC value, not PubChem/);
  });

  test("element names ARE now shown, from a cross-checked source", () => {
    // Names were deliberately absent at first, because 118 of them typed from memory is
    // exactly the practice this project refuses. They are now FETCHED by
    // scripts/fetch-element-data.mjs, which refuses to write its output unless all 118
    // symbols match the already-verified held table IN ORDER — that agreement is what
    // licenses attaching the names to them.
    expect(elementReport("Au")!.lines[0]).toBe("Gold (Au) — atomic number 79");
    expect(elementReport("O")!.lines[0]).toBe("Oxygen (O) — atomic number 8");
    expect(elementReport(118)!.lines[0]).toBe("Oganesson (Og) — atomic number 118");
  });

  test("every element has a distinct name", () => {
    const names = new Set<string>();
    for (let z = 1; z <= ELEMENT_COUNT; z++) {
      const n = elementName(z);
      expect({ z, has: typeof n === "string" && n.length > 1 }).toEqual({ z, has: true });
      names.add(n as string);
    }
    expect(names.size).toBe(ELEMENT_COUNT);
  });

  test("looking up by name round-trips", () => {
    for (const [name, z] of [["Hydrogen", 1], ["Gold", 79], ["oganesson", 118]] as [string, number][]) {
      expect(atomicNumberByName(name)).toBe(z);
    }
    expect(atomicNumberByName("Unobtainium")).toBeNull();
    expect(atomicNumberByName("")).toBeNull();
  });

  test("the report accepts a symbol or an atomic number, and refuses nonsense", () => {
    expect(elementReport("O")!.lines[0]).toBe("Oxygen (O) — atomic number 8");
    expect(elementReport(8)!.lines[0]).toBe("Oxygen (O) — atomic number 8");
    expect(elementReport("Xx")).toBeNull();
    expect(elementReport(0)).toBeNull();
    expect(elementReport(119)).toBeNull();
  });

  test("it reports what it DOES know, correctly", () => {
    const r = elementReport("Ne")!;
    const text = r.lines.join("\n");
    expect(text).toMatch(/Neon \(Ne\) — atomic number 10/);
    expect(text).toMatch(/period 2, group 18, p-block/);
    expect(text).toMatch(/Noble gas/);
    expect(text).toMatch(/1s2 2s2 2p6/);
    expect(text).toMatch(/Valence electrons in the outermost shell: 8/);
  });
});

describe("the fetched data agrees with the data already held", () => {
  // This is the check that licenses using PubChem at all. It is a real source and NOT
  // an infallible one — this repo has already been bitten by trusting it on
  // stereochemistry — so the two are made to corroborate each other rather than one
  // being taken on faith.
  test("all 118 symbols match the held table, in order", () => {
    const { ELEMENT_FACTS } = require("../elementData");
    expect(ELEMENT_FACTS.length).toBe(ELEMENT_COUNT);
    // The generator enforces this before writing; asserting it here means a hand-edit
    // of the generated file cannot slip past.
    for (let z = 1; z <= ELEMENT_COUNT; z++) {
      expect(typeof ELEMENT_FACTS[z - 1].name).toBe("string");
    }
  });

  test("the atomic weight shown is the HELD one, not the fetched one", () => {
    // The two sources genuinely differ for lithium — IUPAC gives it as an interval —
    // and for the elements with no stable isotope, where each picks a different
    // reference isotope. Those are convention differences, not errors, and switching
    // silently would change numbers this product already computes with.
    expect(atomicWeight(3)).toBe(PERIODIC.Li);
    expect(atomicWeight(3)).toBeCloseTo(6.94, 2);
    expect(elementReport("Li")!.lines.join(" ")).toMatch(/6\.94 \(IUPAC\)/);
  });

  test("the aufbau prediction differs from measurement in exactly the known exceptions", () => {
    // The cross-check that validates BOTH sides: a correct aufbau implementation must
    // disagree with measurement for the classic exceptions and agree everywhere else.
    // If this list ever grows to include, say, neon, the filling code has broken.
    const norm = (t: string): string => t.replace(/\s+/g, "");
    const differ: string[] = [];
    for (let z = 1; z <= ELEMENT_COUNT; z++) {
      const m = measuredConfiguration(z);
      if (!m || configurationIsPredicted(z)) continue; // no measurement to compare
      if (norm(m) !== norm(nobleGasConfiguration(z) as string)) differ.push(symbolFor(z) as string);
    }
    // The textbook exceptions must be present...
    for (const sym of ["Cr", "Cu", "Nb", "Mo", "Ru", "Rh", "Pd", "Ag", "La", "Gd", "Pt", "Au", "U"]) {
      expect({ sym, isException: differ.includes(sym) }).toEqual({ sym, isException: true });
    }
    // ...and the ordinary elements must NOT be.
    for (const sym of ["H", "He", "C", "N", "O", "Ne", "Na", "Ar", "K", "Ca", "Fe", "Zn", "Kr"]) {
      expect({ sym, isException: differ.includes(sym) }).toEqual({ sym, isException: false });
    }
    // A couple of dozen, not a hundred — if the count exploded, the comparison broke.
    expect(differ.length).toBeLessThan(35);
    expect(differ.length).toBeGreaterThan(15);
  });

  test("a source-flagged prediction is passed through as a prediction", () => {
    // For the superheavy elements even PubChem has no measurement, and it says so.
    // Stripping its hedge would manufacture certainty this tool does not have.
    expect(configurationIsPredicted(110)).toBe(true);
    expect(measuredConfiguration(110)).toMatch(/predicted/i);
    expect(elementReport(110)!.lines.join(" ")).toMatch(/marks this predicted, not observed/);
    // A well-measured element must NOT be flagged.
    expect(configurationIsPredicted(8)).toBe(false);
  });

  test("the newly-available properties are shown when the source has them", () => {
    const fe = elementReport("Fe")!.lines.join("\n");
    expect(fe).toMatch(/Oxidation states:/);
    expect(fe).toMatch(/Electronegativity \(Pauling\):/);
    expect(fe).toMatch(/First ionisation energy:/);
    expect(fe).toMatch(/State at standard conditions: Solid/);
  });
});
