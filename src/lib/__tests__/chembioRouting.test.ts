/**
 * Routing and integration, not engines (v2.137.0 — SCOPE-CHEMBIO-BATCH).
 *
 * The engines (balance, stoich, geneticCode, dna, sequence, peptide,
 * peptideMods, structures, massspec) have their own suites. This file pins
 * that the PANE reaches them, in the right order, on the right text:
 *
 *   - Solve: chemistryKindFor runs on the RAW input, before the paste fold
 *     (which turns Fe2O3 into Fe2O³) and before the inequality branch (which
 *     caught every "->"), AFTER abstract algebra and computation theory —
 *     a two-line edge list "S -> B / B -> C" is a graph, not two half-reactions;
 *   - at most one of the three raw-text switches claims any input;
 *   - the §D1 negatives (and the physics equations P1V1 = P2V2, C1V1 = C2V2)
 *     stay in the Equation kind;
 *   - every Solve chemistry palette snippet is routed and answered;
 *   - Reaction mode's Structures | Formulas toggle is explicit, never guessed;
 *   - the stoichiometry calculator's shipped default reproduces §D2 and draws;
 *   - DNA mode / the ORF finder / the ST.26 listing carry the genetic code;
 *   - Structure and Mass Spec read typed input through the formula-vs-SMILES
 *     resolvers, and properties come from the RESOLVED structure;
 *   - Peptide mode reads notation, shows the reader's refusal, takes masses
 *     from the reading, and refuses the DRAWING above a measured cap BEFORE
 *     any layout work (a 200-residue drawing froze Word for 12.5 s).
 *
 * taskpane.ts cannot be imported under jest (Office.js), so its wiring is
 * asserted on the source text, as computationRouting/algebraPaneRouting do.
 */
import * as fs from "fs";
import * as path from "path";
import { chemistryKindFor, balanceText } from "../balance";
import { computationKindFor } from "../ctSwitch";
import { algebraKindFor } from "../algebraSwitch";
import { SOLVE_CHEMISTRY } from "../palettes";
import {
  balanceReport,
  stoichCalc,
  parseStoichAmounts,
  parseStoichLine,
  peptideDrawRefusal,
  peptideHeavyAtoms,
  peptideSummaryLines,
  PEPTIDE_DRAW_MAX_HEAVY_ATOMS,
  GAS_CONDITION_OPTIONS,
} from "../chembioCalcs";
import { readPeptide, PeptideReading } from "../peptide";
import { renderStructure, resolveStructure } from "../structures";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");

/** The body of a top-level function in the pane source. */
function paneFn(name: string): string {
  const start = PANE.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  expect(start).toBeGreaterThan(0);
  const end = PANE.indexOf("\n}\n", start);
  return PANE.slice(start, end);
}

describe("Solve: the chemistry switch is wired on the RAW text, in a pinned order", () => {
  it("imports the shared decision function", () => {
    expect(PANE).toMatch(/import \{ chemistryKindFor, balanceText, balanceReaction \} from "\.\.\/lib\/balance";/);
  });
  it("decides on solveInput.value, gated by algebra and computation theory", () => {
    expect(PANE).toContain(
      'if (kind === "equation" && !algebraKindFor(solveInput.value) && !computationKindFor(solveInput.value)) {\n    const chemOwner = chemistryKindFor(solveInput.value);'
    );
  });
  it("runs BEFORE the paste fold, transformVerb, the other switches' own branches and the inequality path", () => {
    const body = paneFn("updateSolve");
    const at = body.indexOf("const chemOwner = chemistryKindFor(solveInput.value);");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(body.indexOf("const folded ="));
    expect(at).toBeLessThan(body.indexOf("const algebraOwner = algebraKindFor(solveInput.value);"));
    expect(at).toBeLessThan(body.indexOf("const transformVerb ="));
    expect(at).toBeLessThan(body.indexOf("const owner = computationKindFor(solveInput.value);"));
    expect(at).toBeLessThan(body.indexOf("const iq = solveInequality(text);"));
  });
  it("the answer is emitted as TEXT, never as OMML math (which would re-read Fe₂O₃)", () => {
    const body = paneFn("renderSolveChemistry");
    expect(body).toMatch(/balanceReport\(balanceText\(raw\)\)/);
    expect(body).not.toMatch(/sayMath|kind: "math"/);
  });
});

// The corpora: copies of the computation-theory and algebra routing cases,
// the chemistry palette, and the brief's negatives.
const CT_INPUTS = [
  "S -> aSb | ε\ntest: aabb ab aab",
  "S -> S S | a\nis it ambiguous",
  "pda for a^n b^n\ntest: aabb",
  "tm binary increment 1011",
  "prenex ∀x P(x) → ∃y Q(y)",
  "unify f(x) with g(x)",
  "horn a, a -> b, b -> c, ~c",
  "P -> Q | R",
  "A->B\nB->C",
  "B -> C\nC -> N",
  "S -> B\nB -> C",
  "S -> CS\nS -> C",
  "H -> O\nO -> H",
  "S -> NO\nNO -> S",
];
const ALGEBRA_INPUTS = ["Z/6", "U(8)", "lagrange: subgroups of order 4 in Z/12", "7 * 9 mod 12", "GF(9)"];
const CHEM_INPUTS = [
  ...SOLVE_CHEMISTRY.flatMap((g) => g.items.map((i) => i.snippet)),
  "Fe + O2 = Fe2O3",
  "2H2 + O2 = 2H2O",
  "balance Fe + O2 -> Fe2O3",
  "Cr2O7^2- + H+ + e- -> Cr^3+ + H2O",
  "Co + O = CoO",
  "N2 + 3H2 ⇌ 2NH3",
];
const NEGATIVES = [
  "x + y = 5",
  "A + B = C",
  "C = 2*pi*r",
  "H = 2",
  "N + O = 7",
  "Co + O2 = 5",
  "2x + 3y = 7",
  "f(x) -> 0",
  "x -> x^2",
  "lim x->0 sin(x)/x",
  "p -> q",
  "A -> B",
  "x^2 - 5x + 6 = 0",
  "maximize 3x + 2y subject to x + y <= 4, x + 3y <= 6, x >= 0, y >= 0",
  // Physics formulas whose symbols are element letters: they stay equations.
  "P1V1 = P2V2",
  "C1V1 = C2V2",
  "C1 V1 = C2 V2",
  "P V = n R T",
];

describe("at most one raw-text switch claims any input", () => {
  const all = [...CT_INPUTS, ...ALGEBRA_INPUTS, ...CHEM_INPUTS, ...NEGATIVES];
  it.each(all.map((s) => [s] as const))("%s", (s) => {
    const owners = [algebraKindFor(s), computationKindFor(s)].filter(Boolean);
    // Chemistry is consulted only when neither claims it (the pane's gate).
    const chem = owners.length ? null : chemistryKindFor(s);
    expect(owners.length + (chem ? 1 : 0)).toBeLessThanOrEqual(1);
  });
});

describe("computation theory keeps its graphs and grammars (it wins the overlap)", () => {
  it.each(CT_INPUTS.map((s) => [s] as const))("%s → discrete, never chemistry in the pane", (s) => {
    expect(computationKindFor(s)).toBe("discrete");
  });
  it("the overlap the order exists for: S -> B / B -> C is a graph", () => {
    // During integration chemistryKindFor ALSO claimed this (two arrow lines
    // of element letters → "needs the medium"); balance.ts now declines it,
    // and the pane's gate keeps computation theory first regardless.
    expect(computationKindFor("S -> B\nB -> C")).toBe("discrete");
  });
});

describe("DECISION (raised for the balancing builder): a single arrow between element letters is chemistry", () => {
  // Measured in the built pane: `S -> B`, `C -> O`, `B -> C` used to reach the
  // generic inequality refusal (an answer to nothing); they now get a named
  // chemistry refusal. Pinned so a change to that is deliberate.
  it.each(["S -> B", "C -> O", "B -> C"].map((s) => [s] as const))("%s", (s) => {
    expect(computationKindFor(s)).toBeNull();
    expect(chemistryKindFor(s)).toBe("balance");
    expect(balanceReport(balanceText(s)).headline).toMatch(/appears only on the left/);
  });
});

describe("the §D1 negatives route exactly as before (the switch does not fire)", () => {
  it.each(NEGATIVES.map((s) => [s] as const))("%s", (s) => {
    expect(chemistryKindFor(s)).toBeNull();
  });
});

describe("every chemistry input reaches the balancer, and every palette snippet is answered", () => {
  it.each(CHEM_INPUTS.map((s) => [s] as const))("%s", (s) => {
    expect(algebraKindFor(s)).toBeNull();
    expect(computationKindFor(s)).toBeNull();
    expect(chemistryKindFor(s)).not.toBeNull();
    const rep = balanceReport(balanceText(s));
    if (/^C \+ O2 -> CO \+ CO2$/.test(s)) {
      // The not-unique refusal: named, both reactions listed and drawn.
      expect(rep.ok).toBe(false);
      expect(rep.headline).toMatch(/2 independent balancings/);
      expect(rep.lines).toEqual(["1. C + O₂ → CO₂", "2. 2 C + O₂ → 2 CO"]);
      expect(rep.svg).toMatch(/^<svg/);
      return;
    }
    expect(rep.ok).toBe(true);
    expect(rep.headline).toMatch(/→|⇌/);
    expect(rep.svg).toMatch(/^<svg/);
    expect(rep.caveats.join(" ")).toMatch(/Mass and charge conservation only/);
  });
  it("the shipped answers (display contract: subscripts, superscript charges, e⁻)", () => {
    expect(balanceReport(balanceText("Fe + O2 -> Fe2O3")).headline).toBe("4 Fe + 3 O₂ → 2 Fe₂O₃");
    expect(balanceReport(balanceText("half-reaction MnO4- -> Mn2+ in acid")).headline).toBe("MnO₄⁻ + 8 H⁺ + 5 e⁻ → Mn²⁺ + 4 H₂O");
    expect(balanceReport(balanceText("MnO4^- + Fe^2+ + H^+ -> Mn^2+ + Fe^3+ + H2O")).headline).toBe(
      "MnO₄⁻ + 5 Fe²⁺ + 8 H⁺ → Mn²⁺ + 5 Fe³⁺ + 4 H₂O"
    );
  });
  it("the Solve palette offers the chemistry group in the Equation kind", () => {
    expect(PANE).toMatch(/kind === "equation" \? \[\.\.\.SOLVE_EQUATIONS, \.\.\.SOLVE_TRANSFORMS, \.\.\.SOLVE_CHEMISTRY\]/);
  });
});

describe("Reaction mode: Structures | Formulas is an explicit toggle", () => {
  it("the HTML offers both readings, Structures first (the default)", () => {
    const m = /<select id="reaction-read"[^>]*>([\s\S]*?)<\/select>/.exec(HTML);
    expect(m).not.toBeNull();
    const values = [...m![1].matchAll(/value="([a-z]+)"/g)].map((x) => x[1]);
    expect(values).toEqual(["structures", "formulas"]);
  });
  it("Formulas balances; Structures reads names/SMILES only and refuses a coefficient by name", () => {
    const body = paneFn("updateReactionPreview");
    expect(body).toMatch(/reactionReadSelect\.value === "formulas"/);
    expect(body).toMatch(/updateReactionBalance\(text\)/);
    expect(body).toMatch(/resolveStructure\(src, "smiles", REACTION_CW, REACTION_CH\)/);
    expect(body).toMatch(/Coefficients are not drawn/);
    // The coefficient check runs only on components that FAILED to resolve:
    // a name can start with a locant (1-propanol) and must still draw.
    expect(body.indexOf("const withCoefficient = failed.filter(")).toBeGreaterThan(body.indexOf("resolveStructure(src"));
    expect(resolveStructure("1-propanol", "smiles", 130, 110).kind).toBe("ok");
    expect(resolveStructure("3H2", "smiles", 130, 110).kind).toBe("none");
    expect(paneFn("updateReactionBalance")).toMatch(/balanceReport\(balanceReaction\(text\)\)/);
  });
  it("the Formulas insert is text then the figure, and only if the text landed", () => {
    const body = paneFn("insertReactionBalance");
    expect(body).toMatch(/if \(!\(await insertDerivation\(blocks, plain, "Balanced equation"\)\)\) return;/);
  });
});

describe("Bio/Assay: Reaction stoichiometry & yield", () => {
  const block = PANE.slice(PANE.indexOf('id: "stoich"'), PANE.indexOf("compute: (r) => stoichCalc("));
  const def = (key: string): string => {
    const m = new RegExp(`key: "${key}",[^]*?default: "([^"]*)"`).exec(block);
    expect(m).not.toBeNull();
    return JSON.parse(`"${m![1]}"`);
  };
  it("is registered and its fields are read by the shared calculator", () => {
    expect(block.length).toBeGreaterThan(0);
    expect(PANE).toMatch(/compute: \(r\) => stoichCalc\(r\("rxn"\), r\("amounts"\), r\("actual"\), r\("gas"\)\)/);
  });
  it("the gas dropdown names BOTH STP definitions", () => {
    expect(block).toMatch(/options: GAS_CONDITION_OPTIONS/);
    expect(GAS_CONDITION_OPTIONS.map((o) => o.label).join(" | ")).toMatch(/22\.711.*22\.414/);
  });
  it("the SHIPPED default reproduces §D2 row 1 and draws (O₂ limiting, 11.3 g H₂O, 8.74 g H₂ left)", () => {
    const out = stoichCalc(def("rxn"), def("amounts"), "", def("gas"));
    expect(out.ok).toBe(true);
    expect(out.text).toMatch(/Limiting reagent: O₂ \(ξ = 0\.313 mol\)/);
    expect(out.text).toMatch(/Theoretical H₂O .*= 11\.3 g/);
    expect(out.text).toMatch(/H₂ left over: 4\.34 mol = 8\.74 g/);
    expect(out.svg).toMatch(/limiting: O₂ ★/);
    expect(out.svg).toMatch(/>O₂ ★</);
  });
  it("gas volumes use the condition passed; the two STPs give §D2's two answers", () => {
    const iupac = stoichCalc("4 Fe + 3 O2 -> 2 Fe2O3", "O2: 10.0 L, gas", "", "IUPAC-STP");
    const atm = stoichCalc("4 Fe + 3 O2 -> 2 Fe2O3", "O2: 10.0 L, gas", "", "STP-1atm");
    expect(iupac.text).toMatch(/Fe₂O₃ .*= 46\.9 g/);
    expect(atm.text).toMatch(/Fe₂O₃ .*= 47\.5 g/);
  });
  it("amount lines: density, molarity, gas; bad lines refused by name", () => {
    expect(parseStoichLine("C4H6O3: 5.0 mL, density 1.082 g/mL")).toEqual({ species: "C4H6O3", amount: "5.0 mL", density: "1.082 g/mL" });
    expect(parseStoichLine("HCl: 25.0 mL, molarity 0.100 M")).toEqual({ species: "HCl", amount: "25.0 mL", molarity: "0.100 M" });
    expect(parseStoichLine("O2: 10.0 L, gas")).toEqual({ species: "O2", amount: "10.0 L", phase: "gas" });
    expect("error" in parseStoichLine("O2 10 g")).toBe(true);
    expect("error" in parseStoichLine("O2: 10 g, hot")).toBe(true);
    expect(parseStoichAmounts("H2: 1 g; O2: 2 g")).toHaveLength(2);
    const liquid = stoichCalc("2 H2 + O2 -> 2 H2O", "H2: 10.0 mL", "", "IUPAC-STP");
    expect(liquid.ok).toBe(false);
    expect(liquid.text).toMatch(/never assumed to be 1 g\/mL/);
  });
});

describe("DNA / ORFs / ST.26 carry the genetic code", () => {
  it("the table dropdowns are built from the gc.prt data, not a typed list", () => {
    expect(PANE).toMatch(/for \(const c of GENETIC_CODES\)/);
    expect(HTML).toMatch(/<select id="dna-table"[^>]*><\/select>/);
    expect(HTML).toMatch(/<select id="dna-orf-table"[^>]*><\/select>/);
  });
  it("the translation readout uses translateReport with the table, and shows its notes beside the protein", () => {
    const body = paneFn("updateDnaPreview");
    expect(body).toMatch(/translateReport\(source, \{ frame, stopAtStop: dnaStopCheckbox\.checked, table \}\)/);
    expect(body).toMatch(/\.\.\.report\.notes/);
    expect(body).not.toMatch(/= translate\(/);
  });
  it("the ORF finder passes table + starts, catches GeneticCodeError, and inserts with the settings it FOUND with", () => {
    const find = paneFn("findOrfsHandler");
    expect(find).toMatch(/findOrfs\(seq, \{ minAa, table: info\.table, starts: info\.starts \}\)/);
    expect(find).toMatch(/e instanceof GeneticCodeError \? e\.message/);
    expect(find).toMatch(/buildOrfTableHtml\(currentOrfs, info\)/);
    expect(paneFn("insertOrfTable")).toMatch(/buildOrfTableHtml\(currentOrfs, currentOrfInfo\)/);
  });
  it("the ST.26 listing shows featureNotes as notes, not warnings", () => {
    expect(PANE).toMatch(/for \(const n of featureNotes\(e\)\) notes\.push/);
  });
  it("a feature row can carry /transl_table (the engine support is reachable from the pane)", () => {
    expect(paneFn("makeSequenceFeatureRow")).toMatch(/mk\("seq-feat-transl", /);
    expect(paneFn("readSequenceEntries")).toMatch(/\[".seq-feat-transl", "transl_table"\]/);
  });
});

describe("Structure and Mass Spec read typed input through the resolvers", () => {
  it("Structure mode: resolveStructure(…, \"auto\"), properties from the RESOLVED structure", () => {
    const body = paneFn("updateStructurePreview");
    expect(body).toMatch(/resolveStructure\(text, "auto", STRUCTURE_W, STRUCTURE_H\)/);
    expect(body).toMatch(/renderPropertiesFor\(result\)/);
    expect(body).not.toMatch(/renderProperties\(text\)/);
    expect(paneFn("renderPropertiesFor")).toMatch(/propertiesWouldMisread\(r\)/);
  });
  it("Mass Spec: resolveMassSpec(…, \"auto\"), never computeMassSpec on typed text", () => {
    const body = paneFn("updateMassSpec");
    expect(body).toMatch(/resolveMassSpec\(text, "auto"\)/);
    expect(PANE).not.toMatch(/computeMassSpec\(/);
  });
  it("Chemical mode points a reaction at Reaction / Solve instead of 'Unexpected character'", () => {
    expect(paneFn("updateChemValidation")).toMatch(/This is a reaction — balance it in Reaction mode/);
  });
});

describe("Peptide mode: notation reading, masses from the reading, a drawing cap before any layout", () => {
  it("reads with readPeptide and shows its refusal message", () => {
    const body = paneFn("updatePeptide");
    expect(body).toMatch(/const reading = readPeptide\(seq\);/);
    expect(body).toMatch(/hint\(reading\.message\)/);
    expect(body).not.toMatch(/No valid amino acids found/);
    expect(body).toMatch(/peptideSummaryLines\(rd\)/);
  });
  it("the cap is checked BEFORE renderStructure", () => {
    const body = paneFn("updatePeptide");
    const cap = body.indexOf("peptideDrawRefusal(rd)");
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThan(body.indexOf("renderStructure("));
  });
  it("the insert's alt text takes the reading's formula and average mass", () => {
    expect(paneFn("insertPeptide")).toMatch(/rd \? rd\.formulaTypeset : structure\.formula/);
  });

  const ok = (s: string): PeptideReading => {
    const r = readPeptide(s);
    if (!r.ok) throw new Error(r.message);
    return r;
  };
  it("masses and modifications from the reading (§D4)", () => {
    const lines = peptideSummaryLines(ok("CYIQNCPLG-NH2; disulfide 1-6")).join("\n");
    expect(lines).toMatch(/C₄₃H₆₆N₁₂O₁₂S₂/);
    expect(lines).toMatch(/Monoisotopic mass 1006\.4365 Da/);
    expect(lines).toMatch(/Amidated \(C-terminal amidation\) \(UNIMOD:2\) at C-term: \+HN −O, −0\.984016 mono \/ −0\.9848 avg/);
    expect(lines).toMatch(/Disulfides: C1–C6/);
    // ε₂₈₀ with the cystine count AS WRITTEN: 1 Tyr + 1 cystine = 1490 + 125.
    expect(lines).toMatch(/ε₂₈₀ = 1,615 M⁻¹cm⁻¹ \(1 cystine as written\)/);
  });
  it("an unpaired 'disulfide all' with 4 Cys keeps the mass and refuses the drawing by name", () => {
    const r = ok("CAACGGCAAC; disulfide all");
    expect(peptideSummaryLines(r).join("\n")).toMatch(/824\.2074/);
    expect(peptideDrawRefusal(r)).toMatch(/3 pairings/);
  });
  it("above the cap: refused by name, masses kept", () => {
    const big = ok("WR".repeat(20)); // 40 residues, 501 heavy atoms
    expect(peptideHeavyAtoms(big)).toBeGreaterThan(PEPTIDE_DRAW_MAX_HEAVY_ATOMS);
    expect(peptideDrawRefusal(big)).toMatch(/above the 250-atom drawing limit/);
    expect(peptideSummaryLines(big)[1]).toMatch(/Monoisotopic mass/);
  });
  it("AT the cap the drawing finishes quickly (measured here, generous for a slower WebView)", () => {
    // 251 heavy atoms is just over; cyclo-(WR)₁₀ minus nothing is 250 —
    // the worst shape measured (Trp/Arg side chains, a macrocycle).
    const r = ok("cyclo(" + "WR".repeat(10) + ")");
    const heavy = peptideHeavyAtoms(r);
    expect(heavy).toBeLessThanOrEqual(PEPTIDE_DRAW_MAX_HEAVY_ATOMS);
    expect(heavy).toBeGreaterThan(PEPTIDE_DRAW_MAX_HEAVY_ATOMS - 10);
    expect(peptideDrawRefusal(r)).toBeNull();
    expect(peptideDrawRefusal(ok("WR".repeat(10)))).toMatch(/251 heavy atoms/);
    // Warm the layout code (the first draw of a session costs ~3 s in jest).
    renderStructure(`smiles:${ok("WR".repeat(6)).smiles}`, 280, 220);
    const t0 = Date.now();
    const s = renderStructure(`smiles:${r.smiles}`, 280, 220);
    const ms = Date.now() - t0;
    expect(s).not.toBeNull();
    // Measured ≈ 520 ms alone and 3.2 s inside the full parallel suite. The
    // bound catches the failure class (a 200-residue drawing took 12.5 s),
    // not machine load.
    expect(ms).toBeLessThan(8000);
  });
});
