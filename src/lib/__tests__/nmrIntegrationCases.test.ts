// Release C, gap #6: MEASURED ¹H integration → the characterization line. FIXED CASE TABLE (cumulative gate: every
// later round keeps every row's outcome). The engine writes a typed ¹H list; the line itself is formatNmr's, so
// every ok row also checks formatNmr(parse(generated)) === formatNmr(parse(hand-typed equivalent)).
//
// Oracle (numpy, statvenv), recorded:
//   raw = np.array([2.00, 3.02, 2.97]) * 37.3; c = raw * 8 / raw.sum()
//   → [2.00250313, 3.02377972, 2.97371715]   (case 2: all within 0.03 of 2, 3, 3)
//   np.array([2.00, 3.02, 2.97]) * 2 / 2.00 → [2, 3.02, 2.97]   (case 1)
//   r = np.array([1, 2, 3, 1, 4.6]); r * 13 / r.sum() → [1.1207, 2.2414, 3.3621, 1.1207, 5.1552]   (fit, flagged rows)
import {
  INTEGRATION_TOLERANCE,
  NmrFormatOptions,
  checkNmr,
  formatNmr,
  headerRole,
  htmlText,
  integrationToNmr,
  parseNmr,
  resolveCompound,
  CharCompound,
  IntegrationOptions,
  IntegrationResult,
  IntegrationRefusal,
  CharMessage,
} from "../characterization";

/**
 * The whole measured path: the table → the typed list → formatNmr's line, with the integration's messages followed
 * by checkNmr's (the total against the formula among them). Exactly what the pane shows after "Write the ¹H list".
 */
function measuredNmr(
  text: string,
  o: IntegrationOptions,
  fmt: NmrFormatOptions,
): { ok: true; nmrText: string; html: string; messages: CharMessage[]; result: IntegrationResult } | IntegrationRefusal {
  const r = integrationToNmr(text, { ...o, solvent: o.solvent ?? fmt.solvent });
  if (!r.ok) return r;
  const parse = parseNmr(r.nmrText, "1H");
  return { ok: true, nmrText: r.nmrText, html: formatNmr(parse, fmt), messages: [...r.messages, ...checkNmr(parse, o.compound ?? null, fmt)], result: r };
}

const compound = (s: string): CharCompound => {
  const r = resolveCompound(s);
  if ("refusal" in r) throw new Error(r.refusal);
  return r;
};
const EA_FORMULA = (): CharCompound => compound("formula:C4H8O2");
const EA_STRUCT = (): CharCompound => compound("CCOC(C)=O");
const COMMON: NmrFormatOptions = { style: "common" };
const JOC: NmrFormatOptions = { style: "joc", solvent: "CDCl3", freq: "400" };

const EA_TABLE = "4.12\t2.00\tq\t7.1\n2.05\t3.02\ts\n1.26\t2.97\tt\t7.1";
const EA_TYPED = "4.12 (q, J = 7.1 Hz, 2H), 2.05 (s, 3H), 1.26 (t, J = 7.1 Hz, 3H)";

/** ok → the generated list parses cleanly and formats exactly as the hand-typed list does, in both styles. */
function expectSameAsTyped(nmrText: string, typed: string): void {
  const g = parseNmr(nmrText, "1H");
  expect(g.unread).toEqual([]);
  expect(g.issues).toEqual([]);
  for (const o of [COMMON, JOC]) expect(formatNmr(g, o)).toBe(formatNmr(parseNmr(typed, "1H"), o));
}
function ok(text: string, o: IntegrationOptions) {
  const r = integrationToNmr(text, o);
  if (!r.ok) throw new Error(`refused: ${r.refusal}`);
  return r;
}
function refusal(text: string, o: IntegrationOptions): string {
  const r = integrationToNmr(text, o);
  if (r.ok) throw new Error(`expected a refusal, got ${r.nmrText}`);
  return r.refusal;
}
const ROW1_2H: IntegrationOptions = { reference: { kind: "row", row: 1, nH: 2 } };

describe("measured integration — the fixed case table", () => {
  it("1  ethyl acetate in CDCl3, row 1 = 2H → the journal line (common style literal; JOC puts nH before J)", () => {
    const m = measuredNmr(EA_TABLE, ROW1_2H, { style: "common", solvent: "CDCl3" });
    if (!m.ok) throw new Error(m.refusal);
    expect(m.nmrText).toBe(EA_TYPED);
    expect(htmlText(m.html)).toBe("¹H NMR (CDCl3) δ 4.12 (q, J = 7.1 Hz, 2H), 2.05 (s, 3H), 1.26 (t, J = 7.1 Hz, 3H).");
    expectSameAsTyped(m.nmrText, EA_TYPED);
    const joc = measuredNmr(EA_TABLE, ROW1_2H, JOC);
    if (!joc.ok) throw new Error(joc.refusal);
    expect(htmlText(joc.html)).toBe("¹H NMR (CDCl3, 400 MHz): δ 4.12 (q, 2H, J = 7.1 Hz), 2.05 (s, 3H), 1.26 (t, 3H, J = 7.1 Hz).");
    expect(m.messages.some((x) => x.text.includes(`±${INTEGRATION_TOLERANCE}`))).toBe(true);
    expect(m.messages.some((x) => /high δ to low/.test(x.text))).toBe(true);
  });

  it("2  the same integrals ×37.3 (arbitrary units), fit to C4H8O2 → the same line", () => {
    const scaled = "4.12\t74.6\tq\t7.1\n2.05\t112.646\ts\n1.26\t110.781\tt\t7.1";
    const r = ok(scaled, { reference: { kind: "formula" }, compound: EA_FORMULA() });
    expect(r.nmrText).toBe(EA_TYPED);
    expect(r.rows.map((x) => x.count)).toEqual([expect.closeTo(2.0025031, 6), expect.closeTo(3.0237797, 6), expect.closeTo(2.9737172, 6)]);
    expectSameAsTyped(r.nmrText, EA_TYPED);
    const m = measuredNmr(scaled, { reference: { kind: "formula" }, compound: EA_FORMULA() }, COMMON);
    if (!m.ok) throw new Error(m.refusal);
    expect(m.messages.some((x) => /add up to 8H, matching the formula/.test(x.text))).toBe(true);
  });

  it("3  a row at 1.46 after normalization → flagged by name, shown as 1.5H, result still produced", () => {
    const r = ok("4.12\t2.00\tq\t7.1\n3.50\t1.46\ts\n1.26\t3.00\tt\t7.1", ROW1_2H);
    expect(r.nmrText).toBe("4.12 (q, J = 7.1 Hz, 2H), 3.50 (s, 1.5H), 1.26 (t, J = 7.1 Hz, 3H)");
    const flag = r.messages.find((x) => x.level === "warn");
    expect(flag?.text).toBe("δ 3.50: 1.46H is not near a whole number — check the integration or the reference. Shown as 1.5H.");
    expect(r.rows[1].flagged).toBe(true);
    expectSameAsTyped(r.nmrText, "4.12 (q, J = 7.1 Hz, 2H), 3.50 (s, 1.5H), 1.26 (t, J = 7.1 Hz, 3H)");
  });

  it("4  total 7 vs formula 8 → checkNmr's named mismatch, both numbers, a warning not a refusal", () => {
    const m = measuredNmr("4.12\t2.00\tq\t7.1\n2.05\t3.02\ts\n1.26\t1.98\tt\t7.1", { ...ROW1_2H, compound: EA_FORMULA() }, COMMON);
    if (!m.ok) throw new Error(m.refusal);
    const msg = m.messages.find((x) => /add up to/.test(x.text));
    expect(msg).toEqual({ level: "warn", text: "The integrations add up to 7H; the formula has 8 ¹H (1 not listed)." });
    // The same message checkNmr gives the typed list: reused, not duplicated.
    expect(checkNmr(parseNmr(m.nmrText, "1H"), EA_FORMULA(), COMMON)).toContainEqual(msg);
  });

  it("5  a multiplet range 7.36–7.28, integral 5.0 → 7.36–7.28 (m, 5H)", () => {
    const r = ok("7.36–7.28\t5.0\tm", { reference: { kind: "as-written" } });
    expect(r.nmrText).toBe("7.36–7.28 (m, 5H)");
    expectSameAsTyped(r.nmrText, "7.36–7.28 (m, 5H)");
    expect(ok("7.36-7.28\t5.0\tm", { reference: { kind: "as-written" } }).nmrText).toBe("7.36–7.28 (m, 5H)");
  });

  it("6  CDCl3 residual at 7.26: dropped with a note when ticked, kept (and named) when not", () => {
    const t = "7.26\t0.31\ts\n4.12\t2.00\tq\t7.1\n2.05\t3.02\ts\n1.26\t2.97\tt\t7.1";
    const on = ok(t, { reference: { kind: "row", row: 2, nH: 2 }, solvent: "CDCl3", dropSolventPeaks: true });
    expect(on.nmrText).toBe(EA_TYPED);
    expect(on.dropped.map((r) => r.shift)).toEqual(["7.26"]);
    expect(on.messages.some((m) => /δ 7\.26 \(row 1\) left out: it is at the CDCl₃ residual \(7\.26\)/.test(m.text))).toBe(true);
    // Unticked: kept, named as the residual, and its 0.31H flagged (never silently dropped, never rounded to 0).
    const off = ok(t, { reference: { kind: "row", row: 2, nH: 2 }, solvent: "CDCl3" });
    expect(off.nmrText).toBe("7.26 (s, 0.3H), " + EA_TYPED);
    expect(off.messages.some((m) => /δ 7\.26: 0\.31H is not near a whole number/.test(m.text))).toBe(true);
    const off2 = ok("7.26\t1.00\ts\n4.12\t2.00\tq\t7.1", { reference: { kind: "row", row: 2, nH: 2 }, solvent: "CDCl3" });
    expect(off2.nmrText).toBe("7.26 (s, 1H), 4.12 (q, J = 7.1 Hz, 2H)");
    expect(off2.messages.some((m) => /δ 7\.26 \(row 1\) is at the CDCl₃ residual \(7\.26\); kept/.test(m.text))).toBe(true);
  });

  it("7  a zero or negative integral → named refusal for that row", () => {
    expect(refusal("4.12\t2.00\tq\t7.1\n2.05\t0\ts", ROW1_2H)).toMatch(/line 2 \(δ 2\.05\): the integral 0 is not positive/);
    expect(refusal("4.12\t2.00\tq\t7.1\n2.05\t-3.0\ts", ROW1_2H)).toMatch(/line 2 \(δ 2\.05\): the integral −3 is not positive/);
  });

  it("8  reference row out of range, or a reference value of 0 → named refusal", () => {
    expect(refusal(EA_TABLE, { reference: { kind: "row", row: 4, nH: 2 } })).toMatch(/Reference row 4 is not a row of the table: it has 3 rows/);
    expect(refusal(EA_TABLE, { reference: { kind: "row", row: 0, nH: 2 } })).toMatch(/Reference row 0 is not a row/);
    expect(refusal(EA_TABLE, { reference: { kind: "row", row: 1, nH: 0 } })).toMatch(/whole number of protons, 1H or more \(not 0\)/);
    expect(refusal(EA_TABLE, { reference: { kind: "row", row: 1, nH: 1.5 } })).toMatch(/whole number of protons/);
    expect(refusal(EA_TABLE, { reference: { kind: "row", row: 1, nH: NaN } })).toMatch(/whole number of protons/);
  });

  it("9  mixed decimal marks → the dataBlock refusal", () => {
    expect(refusal("4.12\t2,00\tq\t7.1\n2.05\t3.02\ts", ROW1_2H)).toMatch(/Integration table: this block mixes .* and 2,00; use one decimal mark/);
  });

  it("10 more than 200 rows → cap refusal", () => {
    const rows = Array.from({ length: 201 }, (_, i) => `${(9 - i * 0.04).toFixed(2)}\t1.00\ts`).join("\n");
    expect(refusal(rows, { reference: { kind: "as-written" } })).toBe("Integration table: more than 200 rows (201).");
    expect(ok(rows.split("\n").slice(0, 200).join("\n"), { reference: { kind: "as-written" } }).rows).toHaveLength(200);
  });
});

describe("measured integration — conventions pinned", () => {
  it("rounding boundary: within ±0.15 rounds, beyond is flagged (epsilon-safe)", () => {
    const one = (x: string) => ok(`4.00\t${x}\ts`, { reference: { kind: "as-written" } }).rows[0];
    expect(one("2.15")).toMatchObject({ nH: "2", flagged: false });
    expect(one("2.85")).toMatchObject({ nH: "3", flagged: false });
    expect(one("1.85")).toMatchObject({ nH: "2", flagged: false });
    expect(one("2.16")).toMatchObject({ nH: "2.2", flagged: true });
    expect(one("2.84")).toMatchObject({ nH: "2.8", flagged: true });
    expect(one("1.46")).toMatchObject({ nH: "1.5", flagged: true });
    expect(one("0.5")).toMatchObject({ nH: "0.5", flagged: true });
  });

  it("a count that rounds to 0 is refused, never printed as 0H", () => {
    expect(refusal("4.00\t0.04\ts", { reference: { kind: "as-written" } })).toMatch(/comes to 0\.04H, too small/);
    expect(refusal("4.00\t2\ts\n1.00\t0.001\ts", { reference: { kind: "row", row: 1, nH: 2 } })).toMatch(/less than 0\.01H/);
  });

  it("default reference: integrals as written, said in the output", () => {
    const r = ok("4.12\t2.02\tq\t7.1\n2.05\t2.98\ts", { reference: { kind: "as-written" } });
    expect(r.nmrText).toBe("4.12 (q, J = 7.1 Hz, 2H), 2.05 (s, 3H)");
    expect(r.factor).toBe(1);
    expect(r.messages[0].text).toMatch(/Integrals used as written/);
  });

  it("order: descending δ whatever the table order", () => {
    expect(ok("1.26\t3\tt\t7.1\n4.12\t2\tq\t7.1\n2.05\t3\ts", { reference: { kind: "as-written" } }).nmrText).toBe(EA_TYPED);
  });

  it("RANGE RULE: a dash between numbers is a range; a leading dash or U+2212 is a minus sign", () => {
    const as = { reference: { kind: "as-written" } } as const;
    expect(ok("7.30-7.24\t1\tm", as).nmrText).toBe("7.30–7.24 (m, 1H)");
    expect(ok("7.24–7.30\t1\tm", as).nmrText).toBe("7.30–7.24 (m, 1H)");
    expect(ok("7.36 .. 7.28\t5\tm", as).nmrText).toBe("7.36–7.28 (m, 5H)");
    expect(ok("-0.05\t9\ts", as).nmrText).toBe("−0.05 (s, 9H)");
    expect(ok("−0.05\t9\ts", as).nmrText).toBe("−0.05 (s, 9H)");
    expect(ok("0.10–-0.05\t2\tm", as).nmrText).toBe("0.10–−0.05 (m, 2H)");
    expect(refusal("7.30−7.24\t1\tm", as)).toMatch(/“7\.30−7\.24” is not a shift \(δ\) or a range/);
    expect(refusal("7.30–7.30\t1\tm", as)).toMatch(/has equal ends/);
    expectSameAsTyped(ok("0.10–-0.05\t2\tm", as).nmrText, "0.10 – -0.05 (m, 2H)");
  });

  it("typed digits kept: 7.30 stays 7.30, J 7.0 stays 7.0", () => {
    expect(ok("7.30\t1.00\td\t7.0", { reference: { kind: "as-written" } }).nmrText).toBe("7.30 (d, J = 7.0 Hz, 1H)");
  });

  it("fit to the formula: needs the compound; exchangeables need a structure", () => {
    expect(refusal(EA_TABLE, { reference: { kind: "formula" } })).toMatch(/needs the compound/);
    expect(refusal(EA_TABLE, { reference: { kind: "formula" }, compound: EA_FORMULA(), exchangeablesNotObserved: true })).toMatch(/needs a structure/);
    // Ethanol, OH not observed: 5 C–H to fit.
    const r = ok("3.72\t20.1\tq\t7.0\n1.24\t30.3\tt\t7.0", { reference: { kind: "formula" }, compound: compound("CCO"), exchangeablesNotObserved: true });
    expect(r.nmrText).toBe("3.72 (q, J = 7.0 Hz, 2H), 1.24 (t, J = 7.0 Hz, 3H)");
    expect(r.messages.some((m) => /add up to 5H: the formula's 6 ¹H less its 1 OH\/NH\/SH proton \(not observed\)/.test(m.text))).toBe(true);
    // Structure input works for ethyl acetate too (no exchangeables).
    expect(ok(EA_TABLE, { reference: { kind: "formula" }, compound: EA_STRUCT(), exchangeablesNotObserved: true }).nmrText).toBe(EA_TYPED);
  });

  it("fit with flagged rows (oracle: 1.12, 2.24, 3.36, 1.12, 5.16)", () => {
    const r = ok("7.5\t1\ts\n6.5\t2\td\t8\n3.5\t3\ts\n2.5\t1\ts\n1.0\t4.6\tm", { reference: { kind: "formula" }, compound: compound("formula:C10H13NO") });
    expect(r.rows.map((x) => x.nH)).toEqual(["1", "2.2", "3.4", "1", "5.2"]);
    expect(r.messages.filter((m) => m.level === "warn")).toHaveLength(3);
  });

  it("solvent: no solvent chosen / no residual data → said, nothing dropped; a range is never dropped", () => {
    const t = "7.26\t1\ts\n4.12\t2\tq\t7.1";
    expect(ok(t, { reference: { kind: "as-written" }, dropSolventPeaks: true }).messages.some((m) => /needs the solvent/.test(m.text))).toBe(true);
    expect(ok(t, { reference: { kind: "as-written" }, solvent: "pyridine-d5", dropSolventPeaks: true }).messages.some((m) => /No residual or water shifts on file for pyridine-d₅/.test(m.text))).toBe(true);
    const range = ok("7.36–7.24\t6\tm", { reference: { kind: "as-written" }, solvent: "CDCl3", dropSolventPeaks: true });
    expect(range.nmrText).toBe("7.36–7.24 (m, 6H)");
    expect(range.messages.some((m) => /spans the CDCl₃ residual \(7\.26\); kept whole/.test(m.text))).toBe(true);
    // Water in CDCl3 at 1.56, ±0.02.
    expect(ok("1.57\t1\tbr s\n4.12\t2\tq\t7.1", { reference: { kind: "as-written" }, solvent: "CDCl3", dropSolventPeaks: true }).dropped).toHaveLength(1);
    expect(ok("1.59\t1\tbr s\n4.12\t2\tq\t7.1", { reference: { kind: "as-written" }, solvent: "CDCl3", dropSolventPeaks: true }).dropped).toHaveLength(0);
  });

  it("adversarial: ethyl acetate's 2.05 in acetone-d6 — dropping is named, so the chemist sees it", () => {
    const r = ok(EA_TABLE, { reference: { kind: "row", row: 1, nH: 2 }, solvent: "acetone-d6", dropSolventPeaks: true });
    expect(r.nmrText).toBe("4.12 (q, J = 7.1 Hz, 2H), 1.26 (t, J = 7.1 Hz, 3H)");
    expect(r.messages.some((m) => /δ 2\.05 \(row 2\) left out: it is at the acetone-d₆ residual \(2\.05\).*untick/.test(m.text))).toBe(true);
    // The reference row itself dropped → refused.
    expect(refusal(EA_TABLE, { reference: { kind: "row", row: 2, nH: 3 }, solvent: "acetone-d6", dropSolventPeaks: true })).toMatch(/Reference row 2 .* was left out as a solvent peak/);
    expect(refusal("7.26\t1\ts", { reference: { kind: "as-written" }, solvent: "CDCl3", dropSolventPeaks: true })).toMatch(/every row is a solvent or water peak/);
  });
});

describe("measured integration — columns, separators and headers", () => {
  const as = { reference: { kind: "as-written" } } as const;

  it("MestReNova multiplet report by header: Range for m, Shift otherwise; H's and Name/Method ignored and said", () => {
    const t = [
      "Name\tShift\tRange\tH's\tIntegral\tClass\tJ's\tMethod",
      "A (m)\t7.32\t7.36 .. 7.28\t5\t5.02\tm\t\tSum",
      "B (s)\t5.12\t5.14 .. 5.10\t2\t2.01\ts\t\tSum",
      "C (dd)\t3.05\t3.09 .. 3.01\t1\t0.99\tdd\t13.9, 6.1\tSum",
    ].join("\n");
    const r = ok(t, as);
    expect(r.nmrText).toBe("7.36–7.28 (m, 5H), 5.12 (s, 2H), 3.05 (dd, J = 13.9, 6.1 Hz, 1H)");
    const texts = r.messages.map((m) => m.text).join("\n");
    expect(texts).toMatch(/Columns not used: Name, Method/);
    expect(texts).toMatch(/H's column .* is not used/);
    expect(texts).toMatch(/multiplet \(m\) is given as its Range/);
    expectSameAsTyped(r.nmrText, "7.36 – 7.28 (m, 5H), 5.12 (s, 2H), 3.05 (dd, J = 13.9, 6.1 Hz, 1H)");
  });

  it("header names in any order and case; units ignored", () => {
    const r = ok("Integral\tδ (ppm)\tMultiplicity\tJ (Hz)\n2.00\t4.12\tq\t7.1\n3.00\t2.05\ts\t", as);
    expect(r.nmrText).toBe("4.12 (q, J = 7.1 Hz, 2H), 2.05 (s, 3H)");
    expect(headerRole("J's (Hz)")).toBe("j");
    expect(headerRole("H’s")).toBe("nh");
    expect(headerRole("Class")).toBe("mult");
    expect(headerRole("Int.")).toBe("integral");
    expect(headerRole("Atoms")).toBe("ignore");
  });

  it("a header without δ or integral, or a column named twice → refused by name", () => {
    expect(refusal("Name\tIntegral\nA\t2", as)).toMatch(/has no δ column/);
    expect(refusal("Shift\tClass\n4.12\tq", as)).toMatch(/has no Integral column/);
    expect(refusal("Shift\tδ\tIntegral\n4.12\t4.12\t2", as)).toMatch(/more than one shift column/);
    expect(refusal("Shift\tIntegral\n", as)).toMatch(/only a header line/);
  });

  it("plain δ, integral[, mult, J…] in spaces, ', ', semicolons and bare commas", () => {
    expect(ok("4.12 2.00 q 7.1\n2.05 3.02 s\n1.26 2.97 t 7.1", ROW1_2H).nmrText).toBe(EA_TYPED);
    expect(ok("4.12, 2.00, q, 7.1\n2.05, 3.02, s\n1.26, 2.97, t, 7.1", ROW1_2H).nmrText).toBe(EA_TYPED);
    expect(ok("4.12;2.00;q;7.1\n2.05;3.02;s\n1.26;2.97;t;7.1", ROW1_2H).nmrText).toBe(EA_TYPED);
    expect(ok("4.12,2.00,q,7.1\n2.05,3.02,s\n1.26,2.97,t,7.1", ROW1_2H).nmrText).toBe(EA_TYPED);
    // Spaces: "br s" is one multiplicity, "7.36 – 7.28" one range, "J = … Hz" words carry nothing.
    expect(ok("6.10 1.0 br s\n7.36 – 7.28 5.0 m\n6.90 1.0 dd J = 8.0 2.1 Hz", as).nmrText).toBe("7.36–7.28 (m, 5H), 6.90 (dd, J = 8.0, 2.1 Hz, 1H), 6.10 (br s, 1H)");
    // Several J values in one tab cell.
    expect(ok("6.90\t1.0\tdd\t8.0, 2.1", as).nmrText).toBe("6.90 (dd, J = 8.0, 2.1 Hz, 1H)");
    expect(ok("6.90\t1.0\tdd\t8.04,1.95", as).nmrText).toBe("6.90 (dd, J = 8.04, 1.95 Hz, 1H)");
    expect(ok("6.90\t1.0\tdd\tJ = 8.0 Hz\t2.1", as).nmrText).toBe("6.90 (dd, J = 8.0, 2.1 Hz, 1H)");
  });

  it("decimal commas read when the whole block uses them (RULE N3)", () => {
    const r = ok("4,12\t2,00\tq\t7,1\n2,05\t3,02\ts\n1,26\t2,97\tt\t7,1", ROW1_2H);
    expect(r.nmrText).toBe(EA_TYPED);
    expect(r.messages.some((m) => /comma/i.test(m.text))).toBe(true);
    // A J cell "8,2" beside dot decimals is the mixed-marks refusal, never two couplings 8 and 2.
    expect(refusal("6.90\t1.0\tdd\t8,2", as)).toMatch(/mixes 6\.90 and 8,2/);
  });

  it("no header: a number where the multiplicity goes → refused with the default order", () => {
    expect(refusal("4.12\t2.00\t7.1", as)).toMatch(/a number \(7\.1\) where the multiplicity goes.*δ, integral, multiplicity, J values/);
  });

  it("checkNmr's J-count message is reused for a wrong pattern (dd with one J)", () => {
    const m = measuredNmr("6.90\t1.0\tdd\t8.0", as, COMMON);
    if (!m.ok) throw new Error(m.refusal);
    expect(m.messages).toContainEqual({ level: "warn", text: "δ 6.90 is a dd, which needs 2 J values; 1 given." });
  });
});

describe("measured integration — adversarial rows", () => {
  const as = { reference: { kind: "as-written" } } as const;
  it.each([
    ["empty", "", /nothing to read/],
    ["blank lines only", "\n \n\t\n", /nothing to read/],
    ["word integral", "4.12\tabc\tq", /“abc” is not an integral/],
    ["missing integral", "4.12\t-\tq", /has no integral/],
    ["missing integral (tab gap)", "4.12\t\tq", /has no integral/],
    ["missing δ", "\t2.0\ts", /has no δ/],
    ["unknown multiplicity", "4.12\t2.0\tquartettt", /“quartettt” is not a multiplicity/],
    ["word δ", "TMS\t2.0\ts", /“TMS” is not a shift/],
    ["NaN integral", "4.12\tNaN\ts", /has no integral/],
    ["Infinity integral", "4.12\tInfinity\ts", /“Infinity” is not an integral/],
    ["negative J", "4.12\t2\tq\t-7.1", /J = −7\.1 Hz; give \|J\|/],
    ["zero J", "4.12\t2\tq\t0", /J = 0 Hz/],
    ["word J", "4.12\t2\tq\tabout 7", /“about” is not a J value/],
    ["extra field beyond header", "Shift\tIntegral\n4.12\t2\tq", /more fields than the header/],
    ["space header with an unknown word", "Chemical shift Integral\n4.12 2", /header words? “chemical” not recognised/i],
    ["hex integral", "4.12\t0x10\ts", /is not an integral|not a number/],
    ["bond-count J (³J)", "4.12\t2\tq\t³J = 7.1", /“³J = 7\.1” is a labelled coupling/],
    ["bond-count J (3J)", "4.12\t2\tq\t3J = 7.1", /is a labelled coupling/],
    ["heteronuclear J", "4.50\t2\td\tJHF = 47.5", /“JHF = 47\.5” is a labelled coupling/],
    ["heteronuclear J, spaces", "4.50 2 d JHF = 47.5", /“JHF” is a labelled coupling/],
    ["huge reference row", "4.12\t2\ts", /Reference row 1×10²¹ is not a row/, { kind: "row", row: 1e21, nH: 2 }],
    ["huge negative integral", "4.12\t-1e21\ts", /the integral −1×10²¹ is not positive/],
  ] as [string, string, RegExp, IntegrationOptions["reference"]?][])("%s → refused by name", (...row) => {
    // (A rest parameter: a fourth named parameter would make jest wait for a done callback on 3-column rows.)
    const [, text, re, ref] = row;
    expect(refusal(text, ref ? { reference: ref } : as)).toMatch(re);
  });

  it("an indexed J (J1 = 8.0, J₂ = 2.0) is a position only — never read as a coupling of 1 Hz", () => {
    expect(ok("6.90\t1.0\tdd\tJ1 = 8.0, J2 = 2.0", as).nmrText).toBe("6.90 (dd, J = 8.0, 2.0 Hz, 1H)");
    expect(ok("6.90 1.0 d J1 = 8.0", as).nmrText).toBe("6.90 (d, J = 8.0 Hz, 1H)");
    expect(ok("6.90\t1.0\tdd\tJ₁=8.0\tJ₂=2.0", as).nmrText).toBe("6.90 (dd, J = 8.0, 2.0 Hz, 1H)");
    expect(ok("6.90\t1.0\tdd\tJ = 8.0 Hz, 2.0 Hz", as).nmrText).toBe("6.90 (dd, J = 8.0, 2.0 Hz, 1H)");
  });

  it("huge and tiny arbitrary units scale to the same counts (fit to formula)", () => {
    for (const k of [1e-9, 1e12]) {
      const t = `4.12\t${2 * k}\tq\t7.1\n2.05\t${3 * k}\ts\n1.26\t${3 * k}\tt\t7.1`;
      expect(ok(t, { reference: { kind: "formula" }, compound: EA_FORMULA() }).nmrText).toBe(EA_TYPED);
    }
  });

  it("CRLF, blank lines and a trailing tab are ignored; line numbers in messages are the pasted ones", () => {
    expect(ok("4.12\t2.00\tq\t7.1\t\r\n\r\n2.05\t3.02\ts\r\n1.26\t2.97\tt\t7.1\r\n", ROW1_2H).nmrText).toBe(EA_TYPED);
    expect(refusal("4.12\t2.00\tq\n\n\n2.05\t0\ts", ROW1_2H)).toMatch(/line 4/);
  });

  it("output never carries NaN, Infinity, undefined or e-notation", () => {
    const r = ok("4.12\t1e-7\tq\t7.1\n2.05\t1.5e-7\ts", { reference: { kind: "row", row: 1, nH: 2 } });
    const all = [r.nmrText, ...r.messages.map((m) => m.text)].join("\n");
    expect(all).not.toMatch(/NaN|Infinity|undefined|\de[-+]?\d/);
  });
});
