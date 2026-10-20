import {
  autoNumberer,
  typesetFormula,
  checkAgainstRegister,
  compareLabels,
  compoundFieldInput,
  forgetCompound,
  lookupLabel,
  mergeIntoRegister,
  readRegister,
  writeRegister,
  type CompoundRegister,
  type SchemeCompoundRef,
} from "../compoundRegister";
import { buildScheme, parseScheme } from "../scheme";
import { resolveCompound } from "../characterization";

/** Compounds as a drawn scheme reports them (real idcodes, with stereo). */
function schemeCompounds(input: string, numberFor?: (id: string) => string): SchemeCompoundRef[] {
  const b = buildScheme(parseScheme(input), numberFor ? { numberFor } : {});
  if (!b.ok) throw new Error(b.errors.join(" "));
  return b.compounds;
}

const reg = (cs: SchemeCompoundRef[]): CompoundRegister => mergeIntoRegister({ entries: [] }, cs).register;

describe("stored form", () => {
  test("round trip", () => {
    const r = reg(schemeCompounds("aspirin (1)\n-> NaOH\nsalicylic acid (2)"));
    const back = readRegister(writeRegister(r));
    expect(back.notes).toEqual([]);
    expect(back.register).toEqual(r);
    expect(r.entries.map((e) => [e.label, e.formula])).toEqual([["1", "C₉H₈O₄"], ["2", "C₇H₆O₃"]]);
  });
  test.each([null, undefined, ""])("nothing stored (%p) is an empty register, said nothing", (raw) => {
    expect(readRegister(raw)).toEqual({ register: { entries: [] }, notes: [] });
  });
  test("damage is dropped and said, never guessed", () => {
    expect(readRegister("{not json").notes.join(" ")).toMatch(/could not be read/);
    expect(readRegister('{"x":1}').notes.join(" ")).toMatch(/not in the expected form/);
    const r = readRegister(JSON.stringify({ entries: [{ label: "1", idcode: "a", smiles: "C", formula: "CH4", text: "methane" }, { label: "1", idcode: "b", smiles: "CC", formula: "C2H6", text: "" }, { label: 5 }, null] }));
    expect(r.register.entries.map((e) => e.idcode)).toEqual(["a"]);
    expect(r.notes.join(" ")).toMatch(/holds compound 1 twice; the first entry is used/);
    expect(r.notes.join(" ")).toMatch(/2 damaged entries are not used \(kept in the document as they are\)/);
  });
  test("primes are one number however typed", () => {
    const r = readRegister(JSON.stringify({ entries: [{ label: "3'", idcode: "a", smiles: "C", formula: "CH4", text: "" }] }));
    expect(r.register.entries[0].label).toBe("3′");
    expect(lookupLabel(r.register, "3'")?.entry.idcode).toBe("a");
  });
  test("a huge stored value is bounded", () => {
    const entries = Array.from({ length: 2500 }, (_, i) => ({ label: String(i + 1), idcode: `i${i}`, smiles: "C", formula: "CH4", text: "" }));
    const r = readRegister(JSON.stringify({ entries }));
    expect(r.register.entries).toHaveLength(2000);
    expect(r.notes.join(" ")).toMatch(/first 2000 are read/);
  });
  test("reading order", () => {
    expect(["10", "2b", "S1", "2", "1", "2a", "S10", "S2"].sort(compareLabels)).toEqual(["1", "2", "2a", "2b", "10", "S1", "S2", "S10"]);
  });
});

describe("checks against the document", () => {
  const doc = reg(schemeCompounds("aspirin (1)\n-> NaOH\nsalicylic acid (2)\n-> x\nCCO (3)\n-> y\nCCC (4)"));
  test("a number already used for another structure", () => {
    const w = checkAgainstRegister(doc, schemeCompounds("phenol (2)"));
    expect(w.join(" ")).toMatch(/Compound 2 is already in this document as C₇H₆O₃ \(salicylic acid\) — here it is C₆H₆O \(phenol\)/);
  });
  test("a structure already numbered otherwise", () => {
    expect(checkAgainstRegister(doc, schemeCompounds("aspirin (5)")).join(" ")).toMatch(/“aspirin” is compound 1 in this document — here it is numbered 5/);
    expect(checkAgainstRegister(doc, schemeCompounds("aspirin")).join(" ")).toMatch(/“aspirin” is compound 1 in this document; number it \(1\) to match/);
  });
  test("the same number for the same structure is fine", () => {
    expect(checkAgainstRegister(doc, schemeCompounds("aspirin (1)\n-> z\nCCO (3)"))).toEqual([]);
  });
  test("a new number that skips", () => {
    expect(checkAgainstRegister(doc, schemeCompounds("phenol (7)")).join(" ")).toMatch(/Compound 7 skips 5–6 \(this document numbers up to 4 so far\)/);
    expect(checkAgainstRegister(doc, schemeCompounds("phenol (6)")).join(" ")).toMatch(/Compound 6 skips 5 /);
    expect(checkAgainstRegister(doc, schemeCompounds("phenol (5)\n-> x\nbenzene (6)"))).toEqual([]);
    // A series and its own prefixes do not count as skips.
    expect(checkAgainstRegister(doc, schemeCompounds("phenol (4a)\n-> x\nbenzene (S1)"))).toEqual([]);
  });
  test("stereo is identity: (R) and (S) are different compounds", () => {
    const d = reg(schemeCompounds("C[C@H](N)C(=O)O (1)"));
    expect(checkAgainstRegister(d, schemeCompounds("C[C@@H](N)C(=O)O (1)")).join(" ")).toMatch(/Compound 1 is already in this document/);
  });
});

describe("merge and forget", () => {
  test("new numbers added; a clash is kept, not overwritten", () => {
    const d = reg(schemeCompounds("aspirin (1)"));
    const m = mergeIntoRegister(d, schemeCompounds("phenol (1)\n-> x\nbenzene (2)"));
    expect(m.added).toEqual(["2"]);
    expect(m.kept).toEqual(["1"]);
    expect(m.register.entries.find((e) => e.label === "1")?.formula).toBe("C₉H₈O₄");
  });
  test("unnumbered compounds are not registered", () => {
    expect(mergeIntoRegister({ entries: [] }, schemeCompounds("aspirin\n-> x\nphenol")).added).toEqual([]);
  });
  test("forget", () => {
    const d = reg(schemeCompounds("aspirin (1)\n-> x\nphenol (2)"));
    expect(forgetCompound(d, "1").entries.map((e) => e.label)).toEqual(["2"]);
  });
});

describe("Number new compounds", () => {
  test("next free numbers after the document and the scheme, a registered structure keeps its number", () => {
    const d = reg(schemeCompounds("aspirin (1)\n-> x\nphenol (2)"));
    const parsed = parseScheme("aspirin\n-> a\nbenzene\n-> b\nCCO (7)\n-> c\ntoluene");
    const typed = parsed.stages.flat().map((c) => c.label).filter((l): l is string => !!l);
    const b = buildScheme(parsed, { numberFor: autoNumberer(d, typed) });
    if (!b.ok) throw new Error(b.errors.join());
    expect(b.compounds.map((c) => c.label)).toEqual(["1", "8", "7", "9"]);
  });
  test("the same structure twice in one scheme gets one number", () => {
    const parsed = parseScheme("CCO\n-> a\nCC=O\n-> b\nCCO");
    const b = buildScheme(parsed, { numberFor: autoNumberer({ entries: [] }, []) });
    if (!b.ok) throw new Error(b.errors.join());
    expect(b.compounds.map((c) => c.label)).toEqual(["1", "2", "1"]);
  });
  test("off: unlabelled compounds stay unnumbered", () => {
    const b = buildScheme(parseScheme("CCO\n-> a\nCC=O"));
    expect(b.ok && b.compounds.map((c) => c.label)).toEqual([null, null]);
  });
});

describe("Characterization's Compound field", () => {
  const d = reg(schemeCompounds("aspirin (3)\n-> x\nbenzene (S3)\n-> y\nphenol (2a)"));
  const pick = (t: string) => compoundFieldInput(d, t, !("refusal" in resolveCompound(t)));
  test("compound 3 and a bare 3 are the document's compound 3", () => {
    for (const t of ["compound 3", "Compound 3", "cpd 3", "3"]) {
      const p = pick(t);
      expect(p.label).toBe("3");
      expect(p.note).toMatch(/Compound 3 of this document: C₉H₈O₄ \(aspirin\)/);
      const r = resolveCompound(p.input);
      expect("refusal" in r).toBe(false);
    }
    expect(pick("2a").label).toBe("2a");
  });
  test("a bare S3 is the formula S₃ (it reads as one); compound S3 is the register's", () => {
    const bare = pick("S3");
    expect(bare.label).toBe(null);
    expect(bare.input).toBe("S3");
    expect(bare.note).toMatch(/“S3” is read as typed; it is also compound S3 in this document \(C₆H₆\) — write “compound S3” for that/);
    expect(pick("compound S3").label).toBe("S3");
  });
  test("an unknown compound number is said", () => {
    expect(pick("compound 9").note).toMatch(/no compound 9 in this document's register yet/);
    expect(pick("aspirin")).toEqual({ input: "aspirin", note: null, label: null });
  });
});

test("formulas are printed with lowered counts", () => {
  expect(typesetFormula("C9H8O4")).toBe("C₉H₈O₄");
  expect(typesetFormula("C12H22O11")).toBe("C₁₂H₂₂O₁₁");
  expect(typesetFormula("")).toBe("");
});

describe("review round 1", () => {
  const entry = (label: string, extra: Record<string, unknown> = {}) => ({ label, idcode: "x", smiles: "C", formula: "CH4", text: "", ...extra });
  test("a stored label that is not a compound number is not used, and kept as it was", () => {
    const raw = JSON.stringify({ entries: [entry("9007199254740992"), entry("<img src=x onerror=alert(1)>"), entry("asprin"), entry("2")] });
    const r = readRegister(raw);
    expect(r.register.entries.map((e) => e.label)).toEqual(["2"]);
    expect(r.notes.join(" ")).toMatch(/3 damaged entries are not used/);
    // Written back: the unread entries survive a merge and a forget.
    const merged = mergeIntoRegister(r.register, []).register;
    expect(JSON.parse(writeRegister(merged)).entries).toHaveLength(4);
    expect(JSON.parse(writeRegister(forgetCompound(r.register, "2"))).entries).toHaveLength(3);
  });
  test("Number new compounds never loops on a stored huge number (it is not read)", () => {
    const r = readRegister(JSON.stringify({ entries: [entry("99999999999999999999")] })).register;
    const next = autoNumberer(r, []);
    expect([next("a"), next("b")]).toEqual(["1", "2"]);
  });
  test("a register that cannot be read is never written over", () => {
    expect(readRegister("{not json").register.writable).toBe(false);
    expect(readRegister('{"x":1}').register.writable).toBe(false);
    expect(readRegister(writeRegister({ entries: [] })).register.writable).toBe(undefined);
  });
  test("a typed number on a later copy is the number of the earlier unlabelled copy", () => {
    const parsed = parseScheme("aspirin\n-> x\naspirin (5)");
    const b = buildScheme(parsed, { numberFor: autoNumberer({ entries: [] }, ["5"]) });
    if (!b.ok) throw new Error(b.errors.join());
    expect(b.compounds.map((c) => c.label)).toEqual(["5", "5"]);
    expect(b.notes).toEqual([]);
  });
  test("the document's number is not handed to a structure when the scheme types it on another", () => {
    const d = reg(schemeCompounds("phenol (2)"));
    const parsed = parseScheme("benzene (2)\n-> x\nphenol");
    const b = buildScheme(parsed, { numberFor: autoNumberer(d, ["2"]) });
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.compounds.map((c) => c.label)).toEqual(["2", "3"]);
  });
  test("formulas in Hill order with the charge (the display contract)", () => {
    const f = (smiles: string) => schemeCompounds(smiles)[0].formula;
    expect(f("C[N+](C)(C)C")).toBe("C₄H₁₂N⁺");
    expect(f("CC(=O)[O-]")).toBe("C₂H₃O₂⁻");
    expect(f("CC(=O)[O-].[Na+]")).toBe("C₂H₃NaO₂");
    expect(f("[2H]C([2H])([2H])O")).toBe("CHD₃O");
  });
  test("a damaged entry (SMILES not its structure) is never computed from", () => {
    const good = reg(schemeCompounds("aspirin (3)"));
    const bad = { entries: good.entries.map((e) => ({ ...e, smiles: "CCO" })) };
    const p = compoundFieldInput(bad, "compound 3", false);
    expect(p.label).toBe(null);
    expect(p.input).toBe("compound 3");
    expect(p.note).toMatch(/entry in this document's register is damaged/);
  });
  test("labels: smart-quote primes, a trailing full stop, ent- numbering, a total order", () => {
    const d = reg(schemeCompounds("aspirin (3′)\n-> x\nphenol (ent-3)"));
    expect(lookupLabel(d, "3’")?.entry.label).toBe("3′");
    expect(lookupLabel(d, "compound 3′.")?.entry.label).toBe("3′");
    expect(checkAgainstRegister(d, schemeCompounds("benzene (4)"))).toEqual([]);
    expect(compareLabels("01", "1")).not.toBe(0);
  });
});

describe("review round 2", () => {
  test("Forget takes a stored duplicate of the number too", () => {
    const e = (idcode: string) => ({ label: "3", idcode, smiles: "C", formula: "CH4", text: "" });
    const r = readRegister(JSON.stringify({ entries: [e("x"), e("y")] })).register;
    const after = readRegister(writeRegister(forgetCompound(r, "3")));
    expect(after.register.entries).toEqual([]);
    expect(after.notes).toEqual([]);
  });
  test("heavy water is D₂O", () => {
    expect(schemeCompounds("[2H]O[2H]")[0].formula).toBe("D₂O");
    expect(schemeCompounds("[2H]C([2H])([2H])[2H]")[0].formula).toBe("CD₄");
  });
  test("primes pasted from Word (’) and doubled primes are numbers in a scheme, and one number", () => {
    expect(parseScheme("CCO (3’)").stages[0][0].label).toBe("3′");
    const b = buildScheme(parseScheme("CCO (3″)\n-> x\nCCC (3′′)"));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.join(" ")).toMatch(/Compound 3″ is used twice/);
  });
});
