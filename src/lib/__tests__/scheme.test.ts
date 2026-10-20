import { parseScheme, buildScheme, splitLabel, conditionRuns, wrapConditions, countSchemeCaptions, smallestFontPt, titleWithBoldLabels, SCHEME_WIDTHS } from "../scheme";
import { schemeCaptionOoxml } from "../bibOoxml";
import type { XNode } from "../xmlLite";

const walk = (n: XNode, f: (x: XNode) => void): void => {
  f(n);
  for (const c of n.children) walk(c, f);
};
const pts = (v: string): number[] => v.trim().split(/\s+/).map(Number);

/** Average bond length of each structure on the page. */
function bondLengths(root: XNode): number[] {
  const out: number[] = [];
  walk(root, (x) => {
    if (x.name !== "fragment") return;
    const pos = new Map<string, number[]>();
    for (const n of x.children) if (n.name === "n" && n.attrs.p) pos.set(n.attrs.id, pts(n.attrs.p));
    const ls: number[] = [];
    for (const b of x.children) {
      if (b.name !== "b") continue;
      const p = pos.get(b.attrs.B), q = pos.get(b.attrs.E);
      if (p && q) ls.push(Math.hypot(p[0] - q[0], p[1] - q[1]));
    }
    if (ls.length) out.push(ls.reduce((a, c) => a + c, 0) / ls.length);
  });
  return out;
}

function texts(root: XNode): Array<{ text: string; box: number[]; bold: boolean }> {
  const out: Array<{ text: string; box: number[]; bold: boolean }> = [];
  const page = root.children.find((c) => c.name === "page");
  for (const t of page?.children ?? []) {
    if (t.name !== "t") continue;
    out.push({ text: t.children.map((s) => s.text).join(""), box: pts(t.attrs.BoundingBox), bold: t.children.some((s) => Number(s.attrs.face) & 1) });
  }
  return out;
}

function arrows(root: XNode): Array<{ tail: number[]; head: number[] }> {
  const out: Array<{ tail: number[]; head: number[] }> = [];
  walk(root, (x) => {
    if (x.name === "arrow") out.push({ tail: pts(x.attrs.Tail3D), head: pts(x.attrs.Head3D) });
  });
  return out;
}

describe("compound numbers", () => {
  test.each([
    ["aspirin (1)", "aspirin", "1"],
    ["CCO (2a)", "CCO", "2a"],
    ["benzene (S3)", "benzene", "S3"],
    ["phenol (3')", "phenol", "3′"],
    ["phenol (3'')", "phenol", "3″"],
    ["menthol (ent-5)", "menthol", "ent-5"],
    ["toluene (10b)", "toluene", "10b"],
  ])("%s", (raw, text, label) => {
    expect(splitLabel(raw)).toEqual({ text, label });
  });
  test.each(["(S)-alanine", "copper(II) sulfate", "tert-butyl (2-hydroxyethyl)carbamate", "CC(C)C(=O)O"])("no number in %s", (raw) => {
    expect(splitLabel(raw)).toEqual({ text: raw, label: null });
  });
  test("a bracket that is not a number is refused by name", () => {
    const r = splitLabel("N,N-diisopropylethylamine (DIPEA)");
    expect(r.error).toMatch(/“\(DIPEA\)” .* is not a compound number/);
    expect(splitLabel("copper (II)").error).toMatch(/no space before the bracket/);
  });
  test("a number alone is refused", () => {
    expect(splitLabel("(3)").error).toMatch(/no compound before it/);
  });
});

describe("parsing", () => {
  test("one compound line, arrow line, compound line", () => {
    const p = parseScheme("CCO (1) + CC(=O)O (2)\n>> H2SO4 ; reflux, 3 h\nCC(=O)OCC (3)");
    expect(p.errors).toEqual([]);
    expect(p.stages).toEqual([
      [{ text: "CCO", label: "1" }, { text: "CC(=O)O", label: "2" }],
      [{ text: "CC(=O)OCC", label: "3" }],
    ]);
    expect(p.arrows).toEqual([{ type: "forward", above: "H2SO4", below: "reflux, 3 h" }]);
  });
  test("every arrow carries its own conditions", () => {
    const p = parseScheme("A\n-> x ; y\nB\n-> u ; v\nC");
    expect(p.arrows.map((a) => [a.above, a.below])).toEqual([["x", "y"], ["u", "v"]]);
  });
  test("arrow-line text is never split again on arrow tokens", () => {
    const p = parseScheme("A\n-> n-BuLi, THF ; -78 °C <- warm -> rt\nB");
    expect(p.errors).toEqual([]);
    expect(p.arrows[0]).toEqual({ type: "forward", above: "n-BuLi, THF", below: "-78 °C <- warm -> rt" });
  });
  test("arrow kinds on arrow lines", () => {
    expect(parseScheme("A\n<=> K\nB").arrows[0].type).toBe("reversible");
    expect(parseScheme("A\n⇌\nB").arrows[0].type).toBe("reversible");
    expect(parseScheme("A\n<- \nB").arrows[0].type).toBe("retro");
    expect(parseScheme("A\n→ heat\nB").arrows[0]).toEqual({ type: "forward", above: "heat", below: "" });
  });
  test("the one-line form keeps its meaning: conditions on the first arrow", () => {
    const p = parseScheme("CCO + CC(=O)O >> CC(=O)OCC ; H2SO4 ; reflux");
    expect(p.errors).toEqual([]);
    expect(p.stages.map((s) => s.map((c) => c.text))).toEqual([["CCO", "CC(=O)O"], ["CC(=O)OCC"]]);
    expect(p.arrows).toEqual([{ type: "forward", above: "H2SO4", below: "reflux" }]);
  });
  test("a malformed one-line arrow is still named", () => {
    expect(parseScheme("CCO ->> CC").notes.join(" ")).toMatch(/not one this tool recognises/);
  });
  test.each([
    ["-> x\nA", /starts with an arrow/],
    ["A\nB", /two compound lines in a row/],
    ["A\n-> x\n-> y\nB", /two arrows in a row/],
    ["A\n-> x", /last arrow has no product/],
    ["A\n-> x ; y ; z\nB", /at most two fields/],
    ["A ; heat", /conditions belong on an arrow/],
    ["A (crude)\n-> x\nB", /not a compound number/],
  ])("%j is an error", (input, re) => {
    expect(parseScheme(input).errors.join(" ")).toMatch(re);
  });
});

describe("conditions text", () => {
  test("formula digits are subscript runs, charges superscript", () => {
    expect(conditionRuns("H2SO4")).toEqual([
      { text: "H", face: 0 }, { text: "2", face: 0x20 }, { text: "SO", face: 0 }, { text: "4", face: 0x20 },
    ]);
    expect(conditionRuns("Mg2+")).toEqual([{ text: "Mg", face: 0 }, { text: "2+", face: 0x40 }]);
    expect(conditionRuns("0 °C, 2 h")).toEqual([{ text: "0 °C, 2 h", face: 0 }]);
  });
  test("long conditions wrap at commas", () => {
    const lines = wrapConditions("Pd(PPh3)4, K2CO3, 1,4-dioxane/H2O, 90 °C, 16 h, then HCl");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe("Pd(PPh3)4, K2CO3, 1,4-dioxane/H2O, 90 °C, 16 h, then HCl");
    // "1,4-dioxane" is not split at its own comma (no space after it).
    expect(lines.some((l) => l.includes("1,4-dioxane"))).toBe(true);
  });
});

describe("drawing", () => {
  test("every structure is drawn at the house bond length (14.4 pt)", () => {
    const b = buildScheme(parseScheme("C=C (1)\n-> x\nCC(C)(C)c1ccc(cc1)C(=O)OCC2CCCCC2 (2)"));
    if (!b.ok) throw new Error(b.errors.join());
    const ls = bondLengths(b.doc.root);
    expect(ls).toHaveLength(2);
    for (const l of ls) expect(l).toBeCloseTo(14.4, 0);
  });
  test("numbers are bold, centred under their structures, on one baseline per row", () => {
    const b = buildScheme(parseScheme("CCO (1) + CC(=O)O (2)\n-> H2SO4\nCC(=O)OCC (3)"));
    if (!b.ok) throw new Error(b.errors.join());
    const labels = texts(b.doc.root).filter((t) => t.bold);
    expect(labels.map((t) => t.text)).toEqual(["1", "2", "3"]);
    expect(new Set(labels.map((t) => t.box[3])).size).toBe(1);
    expect(b.svg).toMatch(/font-weight="bold"[^>]*>1</);
  });
  test("an arrow is at least as long as its text", () => {
    const b = buildScheme(parseScheme("CCO\n-> tetrabutylammonium fluoride ; tetrahydrofuran\nCC"));
    if (!b.ok) throw new Error(b.errors.join());
    const [a] = arrows(b.doc.root);
    const len = Math.abs(a.head[0] - a.tail[0]);
    for (const t of texts(b.doc.root)) expect(t.box[2] - t.box[0]).toBeLessThanOrEqual(len);
    expect(len).toBeGreaterThanOrEqual(3 * 14.4);
  });
  test("the text above an arrow is above it and the text below is below it", () => {
    const b = buildScheme(parseScheme("CCO\n-> H2SO4 ; reflux\nCC"));
    if (!b.ok) throw new Error(b.errors.join());
    const [a] = arrows(b.doc.root);
    const [above, below] = texts(b.doc.root);
    expect(above.box[3]).toBeLessThan(a.tail[1]);
    expect(below.box[1]).toBeGreaterThan(a.tail[1]);
  });
  test("a retro arrow points back to the target", () => {
    const b = buildScheme(parseScheme("CCO\n<-\nCC"));
    if (!b.ok) throw new Error(b.errors.join());
    const [a] = arrows(b.doc.root);
    expect(a.head[0]).toBeLessThan(a.tail[0]);
  });
  test("a long scheme wraps at the column width, each new row starting with its arrow", () => {
    const input = "c1ccccc1Br (1)\n-> Mg, THF ; reflux\nc1ccccc1C(C)(C)O (2)\n-> TsOH, toluene ; 110 °C\nC=C(C)c1ccccc1 (3)\n-> H2, Pd/C ; MeOH\nCC(C)c1ccccc1 (4)";
    const one = buildScheme(parseScheme(input), { width: "acs2" });
    const narrow = buildScheme(parseScheme(input), { width: "acs1" });
    if (!one.ok || !narrow.ok) throw new Error("not drawn");
    expect(narrow.heightPt).toBeGreaterThan(one.heightPt * 1.5);
    expect(narrow.notes).toEqual([]);
    expect(narrow.widthPt).toBeLessThanOrEqual(SCHEME_WIDTHS.acs1.pt + 4);
    // Rows break before arrows: the first thing drawn on the left of a lower row is an arrow.
    const as = arrows(narrow.doc.root);
    const minTail = Math.min(...as.map((a) => Math.min(a.tail[0], a.head[0])));
    const rowsStartingWithArrow = as.filter((a) => Math.min(a.tail[0], a.head[0]) < minTail + 40 && a.tail[1] > as[0].tail[1] + 1);
    expect(rowsStartingWithArrow.length).toBeGreaterThan(0);
  });
  test("a structure wider than the column is drawn at full size, and said", () => {
    const b = buildScheme(parseScheme("CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC (1)"), { width: "acs1" });
    if (!b.ok) throw new Error(b.errors.join());
    expect(b.notes.join(" ")).toMatch(/wider than the ACS single column/);
    expect(bondLengths(b.doc.root)[0]).toBeCloseTo(14.4, 0);
  });
  test("lettered conditions: letters on the arrows and one footnote", () => {
    const b = buildScheme(parseScheme("CCO\n-> H2SO4 ; reflux\nCC\n->\nC\n-> NaOH\nO"), { lettered: true });
    if (!b.ok) throw new Error(b.errors.join());
    expect(texts(b.doc.root).map((t) => t.text)).toEqual(["(a)", "(b)"]);
    expect(b.footnote?.text).toBe("Reagents and conditions: (a) H₂SO₄, reflux; (b) NaOH.");
    expect(b.footnote?.html).toBe("Reagents and conditions: (a) H<sub>2</sub>SO<sub>4</sub>, reflux; (b) NaOH.");
  });
  test("no footnote when conditions are on the arrows", () => {
    const b = buildScheme(parseScheme("CCO\n-> H2SO4\nCC"));
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.footnote).toBe(null);
  });
  test("one number for two different structures is an error; two numbers for one structure a note", () => {
    const bad = buildScheme(parseScheme("CCO (1)\n-> x\nCCC (1)"));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toMatch(/Compound 1 is used twice .*different structures/);
    const twice = buildScheme(parseScheme("CCO (1)\n-> x\nOCC (4)"));
    expect(twice.ok).toBe(true);
    if (twice.ok) expect(twice.notes.join(" ")).toMatch(/One structure carries 2 numbers here: 1, 4/);
  });
  test("a component that is not a structure is named", () => {
    const b = buildScheme(parseScheme("CCO\n-> x\nnot-a-compound-xyz"));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.join(" ")).toMatch(/“not-a-compound-xyz” is not a known name or a SMILES string/);
    const c = buildScheme(parseScheme("2 CCO >> CC"));
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.errors.join(" ")).toMatch(/coefficients are not drawn/);
  });
  test("compounds are reported with their numbers and SMILES", () => {
    const b = buildScheme(parseScheme("aspirin (1)\n-> NaOH\nsalicylic acid (2)"));
    if (!b.ok) throw new Error(b.errors.join());
    expect(b.compounds.map((c) => [c.label, c.formula])).toEqual([["1", "C9H8O4"], ["2", "C7H6O3"]]);
  });
  test("the drawing has no empty tspan undoing a shift (rasterisers skip it)", () => {
    const b = buildScheme(parseScheme("CCO\n-> LiAlH4, THF\nCC"));
    if (!b.ok) throw new Error(b.errors.join());
    expect(b.svg).not.toMatch(/<tspan dy="[^"]*"><\/tspan>/);
    expect(b.svg).toMatch(/dy="2\.5">4<\/tspan><tspan[^>]*dy="-2\.5">, THF</);
  });
});

describe("caption", () => {
  test("Scheme N. is bold with a SEQ Scheme field, the title after it", () => {
    const x = schemeCaptionOoxml(3, "Synthesis of <b>5</b> &amp; <i>rac</i>-6");
    expect(x).toContain('w:instr=" SEQ Scheme \\* ARABIC "');
    expect(x).toMatch(/<w:b\/>.*Scheme /);
    expect(x).toMatch(/<w:t>3<\/w:t><\/w:r><\/w:fldSimple>/);
    expect(x).toContain("Synthesis of ");
    expect(x).toContain("&amp;");
    expect(x).toContain('<w:pStyle w:val="Caption"/><w:keepNext/>');
  });
  test("no title: Scheme N. alone", () => {
    expect(schemeCaptionOoxml(1, "  ")).not.toMatch(/xml:space="preserve"> <\/w:t>/);
  });
  test("counting the Scheme captions already in the document", () => {
    expect(countSchemeCaptions(["Scheme 1. Synthesis of 3", "As shown in Scheme 1, …", "Scheme 2: Route B", "Schemes"])).toBe(2);
  });
});

describe("review round 1", () => {
  test("lettering stops at (z): 27 lettered arrows are refused, never (a) again", () => {
    const lines = ["C"];
    for (let i = 0; i < 27; i++) lines.push(`-> r${i}`, i % 2 ? "C" : "CC");
    const b = buildScheme(parseScheme(lines.join("\n")), { lettered: true });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.join(" ")).toMatch(/27 arrows carry conditions — lettering runs \(a\) to \(z\)/);
    const ok26 = buildScheme(parseScheme(lines.slice(0, 53).join("\n")), { lettered: true });
    expect(ok26.ok && ok26.footnote?.text).toMatch(/\(z\) r25\.$/);
  });
  test("the resolver's own refusal is kept (duplicated ring closure, a formula)", () => {
    const ring = buildScheme(parseScheme("C1C1 (1)"));
    expect(ring.ok).toBe(false);
    if (!ring.ok) expect(ring.errors.join(" ")).toMatch(/ring closure 1/);
    const f = buildScheme(parseScheme("formula:C2H6O"));
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.errors.join(" ")).toMatch(/is a formula, and a formula has no single structure/);
  });
  test("text above an equilibrium arrow clears its upper half-head (from the rendered SVG)", () => {
    const b = buildScheme(parseScheme("CCO\n<=> pyridine, gypsy ; yyy\nCC"));
    if (!b.ok) throw new Error(b.errors.join());
    // The upper shaft's y, from the drawn arrow lines, and the above-text baseline.
    const ys = [...b.svg.matchAll(/<line [^>]*y1="([\d.]+)"[^>]*y2="([\d.]+)"/g)].filter((m) => m[1] === m[2]).map((m) => Number(m[1]));
    const upper = Math.min(...ys);
    const base = Number(/<text x="[\d.]+" y="([\d.]+)"[^>]*>(?:<tspan[^>]*>)?pyridine/.exec(b.svg)?.[1]);
    expect(Number.isFinite(base)).toBe(true);
    // Descenders reach about 0.21 em below the baseline; the half-head rises about 1.5 pt above its shaft.
    expect(base + 0.21 * 10).toBeLessThan(upper - 1.5 - 0.5);
  });
  test("an arrow line with no space before a negative temperature", () => {
    const p = parseScheme("A\n->-78 °C\nB");
    expect(p.errors).toEqual([]);
    expect(p.arrows[0].above).toBe("-78 °C");
  });
  test.each(["-->", "->>", "=>"])("%s is named as an arrow this tool does not read", (tok) => {
    expect(parseScheme(`A\n${tok} heat\nB`).errors.join(" ")).toMatch(new RegExp(`“${tok.replace(/[>]/g, "\>")}” is not an arrow this tool reads`));
  });
  test("work bounds: a huge compound and too many compounds are refused by name, quickly", () => {
    const t0 = Date.now();
    const big = buildScheme(parseScheme("C".repeat(5000)));
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.errors.join(" ")).toMatch(/has (about )?5000 atoms — a scheme draws compounds of up to 150/);
    expect(Date.now() - t0).toBeLessThan(5000);
    const many = buildScheme(parseScheme(Array.from({ length: 61 }, () => "C").join(" + ")));
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.errors.join(" ")).toMatch(/61 compounds — one figure holds up to 60/);
  });
  test("the page box is a page again after layout", () => {
    const b = buildScheme(parseScheme("CCO\n-> x\nCC"));
    if (!b.ok) throw new Error(b.errors.join());
    const page = b.doc.root.children.find((c) => c.name === "page");
    expect(page?.attrs.BoundingBox).toBe("0 0 540 720");
  });
  test("ids on the page are unique", () => {
    const b = buildScheme(parseScheme("CCO (1)\n-> H2SO4 ; reflux\nCC (2)\n<=> K ; L\nC (3)"), { lettered: false });
    if (!b.ok) throw new Error(b.errors.join());
    const ids: string[] = [];
    walk(b.doc.root, (x) => x.attrs.id && ids.push(x.attrs.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  test("smallest font size is read off the drawing", () => {
    expect(smallestFontPt('<text font-size="10"/><tspan font-size="7.5"/><tspan font-size="9"/>')).toBe(7.5);
    expect(smallestFontPt("<svg/>")).toBe(null);
  });
  test("title numbers are bold only as whole words, not before a unit, primes normalised", () => {
    const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    expect(titleWithBoldLabels("Synthesis of 5 from 1 (1 h reflux)", ["1", "5"], esc)).toBe("Synthesis of <b>5</b> from <b>1</b> (1 h reflux)");
    expect(titleWithBoldLabels("Route to 3'", ["3′"], esc)).toBe("Route to <b>3′</b>");
    expect(titleWithBoldLabels("A < B & 12", ["2"], esc)).toBe("A &lt; B &amp; 12");
  });
});

describe("review round 2", () => {
  test.each(["<-->", "<--", "←→", "->>", "-->"])("%s is not read as an arrow it is not", (tok) => {
    const p = parseScheme(`CCO\n${tok}\nCC=O`);
    expect(p.arrows).toEqual([]);
    expect(p.errors.join(" ")).toMatch(/is not an arrow this tool reads/);
  });
  test("a minus that starts a number still follows an arrow", () => {
    expect(parseScheme("A\n->-78 °C\nB").arrows[0].above).toBe("-78 °C");
    expect(parseScheme("A\n->-.5 h\nB").arrows[0].above).toBe("-.5 h");
    expect(parseScheme("A\n<->\nB").arrows[0].type).toBe("reversible");
  });
  test("apostrophes in a title stay apostrophes; a prime is read only on a label", () => {
    const esc = (t: string): string => t;
    expect(titleWithBoldLabels("Corey's synthesis of 5", ["5"], esc)).toBe("Corey's synthesis of <b>5</b>");
    expect(titleWithBoldLabels("Evans' aldol to 3'", ["3′"], esc)).toBe("Evans' aldol to <b>3′</b>");
    expect(titleWithBoldLabels("Synthesis of 5.", ["5"], esc)).toBe("Synthesis of <b>5</b>.");
    expect(titleWithBoldLabels("Compounds 1–3", ["1", "3"], esc)).toBe("Compounds <b>1</b>–<b>3</b>");
  });
  test("the resolver does not lay out what it only reads: a 5000-atom SMILES is refused in seconds", () => {
    const t0 = Date.now();
    const b = buildScheme(parseScheme("C".repeat(5000)));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.join(" ")).toMatch(/has (about )?5000 atoms — a scheme draws compounds of up to 150/);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  test("a scheme-wide atom budget", () => {
    const big = "CC(C)(C)".repeat(30); // 120 atoms
    const b = buildScheme(parseScheme(Array.from({ length: 8 }, () => big).join(" + ")));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.join(" ")).toMatch(/This scheme has 960 atoms in all — one figure draws up to 500/);
  });
  test("the text under an equilibrium arrow clears its lower half-head", () => {
    const b = buildScheme(parseScheme("CCO\n<=> AAA ; HHH\nCC"));
    if (!b.ok) throw new Error(b.errors.join());
    const ys = [...b.svg.matchAll(/<line [^>]*y1="([\d.]+)"[^>]*y2="([\d.]+)"/g)].filter((m) => m[1] === m[2]).map((m) => Number(m[1]));
    const lower = Math.max(...ys);
    const base = Number(/<text x="[\d.]+" y="([\d.]+)"[^>]*>(?:<tspan[^>]*>)?HHH/.exec(b.svg)?.[1]);
    // Cap height about 0.72 em above the baseline; the half-head reaches about 1.5 pt under its shaft.
    expect(base - 0.72 * 10).toBeGreaterThan(lower + 1.5 + 0.5);
  });
});

describe("review round 3", () => {
  test("a 100,000-character SMILES is refused at once, before any parse", () => {
    const t0 = Date.now();
    const b = buildScheme(parseScheme("C".repeat(100000)));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.join(" ")).toMatch(/has about 100000 atoms/);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  test("an over-budget scheme is refused before any compound is laid out", () => {
    const taxol = "CC1=C2[C@@]([C@]([C@H]([C@@H]3[C@]4([C@H](OC4)C[C@@H]([C@]3(C(=O)[C@@H]2OC(=O)C)C)O)OC(=O)C)OC(=O)c5ccccc5)(C[C@@H]1OC(=O)[C@H](O)[C@@H](NC(=O)c6ccccc6)c7ccccc7)O)(C)C";
    const t0 = Date.now();
    const b = buildScheme(parseScheme(Array.from({ length: 15 }, () => taxol).join("\n-> x\n")));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.join(" ")).toMatch(/atoms in all — one figure draws up to 500/);
    // Fifteen layouts would take seconds; a parse each is a fraction of that.
    expect(Date.now() - t0).toBeLessThan(2500);
  });
  test("enantiomers under one number are still two structures (identity taken after the layout)", () => {
    const b = buildScheme(parseScheme("C[C@H](N)C(=O)O (1)\n-> x\nC[C@@H](N)C(=O)O (1)"));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.errors.join(" ")).toMatch(/Compound 1 is used twice .*different structures/);
    const ez = buildScheme(parseScheme("F/C=C/F (2)\n-> x\nF/C=C\\F (2)"));
    expect(ez.ok).toBe(false);
  });
});

test("a compound just over the limit is counted exactly by the parse (151 atoms)", () => {
  const b = buildScheme(parseScheme("C".repeat(151)));
  expect(b.ok).toBe(false);
  if (!b.ok) expect(b.errors.join(" ")).toMatch(/has 151 atoms — a scheme draws compounds of up to 150/);
});
