// Case conversion and rich-text normalisation (bibCase.ts).
// Inputs are TITLE-CASED on purpose: an oracle title already in a style's casing only
// proves the converter leaves it alone, so conversion itself is proved here.
import {
  sentenceCase, titleCase, looksTitleCased, normalizeRich, richPlain, plainOf, italicize,
  CHICAGO_SMALL_WORDS, tokenize,
} from "../bibCase";

const APA = { capitalizeSubtitle: true };
const NLM = { capitalizeSubtitle: false };
const sc = (s: string, o = APA): string => plainOf(normalizeRich(sentenceCase(s, o)));
const tc = (s: string): string => plainOf(normalizeRich(titleCase(s, { smallWords: CHICAGO_SMALL_WORDS })));

describe("sentence case protects chemistry and biology tokens", () => {
  test("pH, NMR, DNA, RNA, mRNA, CRISPR keep their case", () => {
    expect(sc("The Effect Of pH On NMR Shifts In DNA And mRNA"))
      .toBe("The effect of pH on NMR shifts in DNA and mRNA");
    expect(sc("CRISPR–Cas9 Editing Of RNA Viruses")).toBe("CRISPR–Cas9 editing of RNA viruses");
  });
  test("formulas with subscripts or digits keep their case (CO₂, H₂O, MoS₂, ¹³C)", () => {
    expect(sc("Reduction Of CO₂ To Methanol Over MoS₂")).toBe("Reduction of CO₂ to methanol over MoS₂");
    expect(sc("Solvation Of H₂O Clusters Studied By ¹³C Labelling"))
      .toBe("Solvation of H₂O clusters studied by ¹³C labelling");
    expect(sc("Growth Of GaN On Si Substrates")).toBe("Growth of GaN on Si substrates");
  });
  test("two-letter element symbols stay, English-word symbols do not", () => {
    expect(sc("Catalysis By Pd And Au Nanoparticles In Water"))
      .toBe("Catalysis by Pd and Au nanoparticles in water");
  });
  test("trans-, cis-, p-, tert- and N- locants keep their case", () => {
    expect(sc("Isomerisation Of trans-Stilbene And cis-Stilbene"))
      .toBe("Isomerisation of trans-stilbene and cis-stilbene");
    expect(sc("Oxidation Of p-Xylene With tert-Butyl Hydroperoxide"))
      .toBe("Oxidation of p-xylene with tert-butyl hydroperoxide");
    expect(sc("Selective N-Methylation Of Amines")).toBe("Selective N-methylation of amines");
  });
  test("a locant at the start does not take the capital (ACS *trans*-Stilbene)", () => {
    expect(sentenceCase("<i>trans</i>-Stilbene Photochemistry Revisited", APA))
      .toBe("<i>trans</i>-Stilbene photochemistry revisited");
    expect(sc("N-Methylation Of Amines Revisited")).toBe("N-Methylation of amines revisited");
  });
  test("E/Z and R/S stereodescriptors keep their case", () => {
    expect(sc("Synthesis Of (E)-Stilbenes And (Z)-Alkenes")).toBe("Synthesis of (E)-stilbenes and (Z)-alkenes");
    expect(sc("(R)-Ibuprofen And (S)-Naproxen Binding")).toBe("(R)-Ibuprofen and (S)-naproxen binding");
  });
  test("nocase spans and italics are never re-cased (proper nouns the source marked)", () => {
    expect(sentenceCase('Malaria In <span class="nocase">Kenya</span> And <i>Escherichia Coli</i> Strains', APA))
      .toBe('Malaria in <span class="nocase">Kenya</span> and <i>Escherichia Coli</i> strains');
  });
  test("subtitles: APA keeps the capital after a colon, NLM lowercases it", () => {
    expect(sc("Uveitic Foveal Atrophy: Clinical Features And Associations", APA))
      .toBe("Uveitic foveal atrophy: Clinical features and associations");
    expect(sc("Uveitic Foveal Atrophy: Clinical Features And Associations", NLM))
      .toBe("Uveitic foveal atrophy: clinical features and associations");
    // A question mark ends a sentence in both styles.
    expect(sc("Is The Goal Intrinsic? Examining Exercise Goals", NLM)).toBe("Is the goal intrinsic? Examining exercise goals");
  });
  test("an article A mid-title is lowercased; a single capital letter is not", () => {
    expect(sc("A Model Of C–H Activation Through A Vitamin K Pathway"))
      .toBe("A model of C–H activation through a vitamin K pathway");
  });
  test("bare E- is a word prefix (APA: “e-commerce”); X-ray and T-cell keep the capital", () => {
    expect(sc("Ageing Consumers And E-Commerce Activities")).toBe("Ageing consumers and e-commerce activities");
    expect(sc("X-Ray Imaging Of T-Cell Receptors")).toBe("X-ray imaging of T-cell receptors");
  });
  test("a letter designation keeps its capital; the article A does not (review defect 9)", () => {
    expect(sc("Vitamin A Deficiency In Children")).toBe("Vitamin A deficiency in children");
    expect(sc("Protein Kinase A Signaling In Neurons")).toBe("Protein kinase A signaling in neurons");
    expect(sc("Toward A Model Of Hepatitis A Spread")).toBe("Toward a model of hepatitis A spread");
  });
  test("the period of a genus abbreviation or initial is not a sentence end", () => {
    expect(sc("Growth Of E. Coli In Minimal Media")).toBe("Growth of E. coli in minimal media");
    expect(sc("Water Splitting vs. Hydrogen Storage")).toBe("Water splitting vs. hydrogen storage");
    expect(sc("Why Bother? Some Answers")).toBe("Why bother? Some answers");
  });
  test("hyphenated compounds are lowercased part by part", () => {
    expect(sc("Single-Step Synthesis Of Amino Acids")).toBe("Single-step synthesis of amino acids");
  });
});

describe("the title-case gate: a title already in sentence case is left alone", () => {
  test("oracle titles survive untouched", () => {
    // APA, apastyle.apa.org, fetched 2026-10-14 (book example, Hygum & Pedersen).
    const t = "Early childhood education: Values and practices in Denmark";
    expect(looksTitleCased(t)).toBe(false);
    expect(sentenceCase(t, APA)).toBe(t);
    // ACS quick guide (Tan et al.): Greek and parentheses intact.
    const acs = "Photochemical single-step synthesis of β-amino acid derivatives from alkenes and (hetero)arenes";
    expect(sentenceCase(acs, APA)).toBe(acs);
  });
  test("all-caps titles are not guessed at", () => {
    expect(looksTitleCased("DNA REPAIR IN BACTERIA")).toBe(false);
    expect(sentenceCase("DNA REPAIR IN BACTERIA", APA)).toBe("DNA REPAIR IN BACTERIA");
  });
  test("a lowercase unit after a number does not open the gate", () => {
    expect(looksTitleCased("Growth Of 5 nm Gold Particles")).toBe(true);
    expect(sc("Growth Of 5 nm Gold Particles")).toBe("Growth of 5 nm gold particles");
  });
});

describe("title (headline) case: Chicago small words", () => {
  test("raises content words, keeps small words lowercase", () => {
    expect(tc("temporal variation in selection influences microgeographic local adaptation"))
      .toBe("Temporal Variation in Selection Influences Microgeographic Local Adaptation");
  });
  test("hyphenated compounds and the first/last word", () => {
    expect(tc("the art of text-to-speech")).toBe("The Art of Text-to-Speech");
    expect(tc("what are we looking at")).toBe("What Are We Looking At");
  });
  test("name particles stay lowercase before the name (van der Waals, de Broglie)", () => {
    expect(tc("tuning van der Waals interactions")).toBe("Tuning van der Waals Interactions");
    expect(tc("the de Broglie wavelength")).toBe("The de Broglie Wavelength");
    expect(tc("a van for the road")).toBe("A Van for the Road"); // not before a name: an ordinary word
  });
  test("after a colon the first word is capitalised", () => {
    expect(tc("inclusion work: children of immigrants")).toBe("Inclusion Work: Children of Immigrants");
  });
  test("never lowers anything, so oracle titles are fixed points", () => {
    const t = "The Channels of Student Activism: How the Left and Right Are Winning (and Losing) in Campus Politics Today";
    expect(tc(t)).toBe(t);
    expect(tc("Moby-Dick; or, The Whale")).toBe("Moby-Dick; or, The Whale");
  });
  test("protects pH, mRNA, locants, units, formulas", () => {
    expect(tc("effect of pH on mRNA stability")).toBe("Effect of pH on mRNA Stability");
    // The locant stays lowercase; the chemical name after it is a main word.
    expect(tc("oxidation of p-xylene and trans-stilbene")).toBe("Oxidation of p-Xylene and trans-Stilbene");
    expect(tc("growth of 5 nm particles of CO₂ ice")).toBe("Growth of 5 nm Particles of CO₂ Ice");
    expect(tc("tert-butyl esters")).toBe("tert-Butyl Esters");
  });
});

describe("rich text and the display contract", () => {
  test("Unicode subscripts survive every transform", () => {
    for (const f of [(s: string) => sc(s), (s: string) => tc(s), (s: string) => richPlain(s)]) {
      const out = f("Splitting Of H₂O And CO₂");
      expect(out).toContain("H₂O");
      expect(out).toContain("CO₂");
      expect(out).not.toMatch(/H2O|CO2|\^/);
    }
  });
  test("<sub>/<sup> digits become Unicode in html AND plain", () => {
    expect(normalizeRich("H<sub>2</sub>O and <sup>13</sup>C")).toBe("H₂O and ¹³C");
    expect(richPlain("CO<sub>2</sub>")).toBe("CO₂");
    expect(richPlain("Fe<sup>3+</sup>")).toBe("Fe³⁺");
  });
  test("a subscript with no Unicode form stays a tag, never _ or ^", () => {
    expect(normalizeRich("x<sub>β</sub>")).toBe("x<sub>β</sub>");
    expect(richPlain("x<sub>β</sub>")).toBe("xβ");
  });
  test("nocase spans are dropped from display html; em/strong map to i/b", () => {
    expect(normalizeRich('<span class="nocase">pH</span> in <em>E. coli</em>')).toBe("pH in <i>E. coli</i>");
  });
  test("ampersands: escaped once in html, literal in plain", () => {
    expect(normalizeRich("R&D and A &amp; B")).toBe("R&amp;D and A &amp; B");
    expect(richPlain("R&D and A &amp; B")).toBe("R&D and A & B");
  });
  test("a literal < in a title is text, not a tag (importers keep < and & literal)", () => {
    expect(richPlain("Bounds for 0 < b and c > 0")).toBe("Bounds for 0 < b and c > 0");
    expect(normalizeRich("Bounds for 0 < b and c > 0")).toBe("Bounds for 0 &lt; b and c &gt; 0");
    expect(richPlain("Signals < Sub-threshold > noise")).toBe("Signals < Sub-threshold > noise");
    expect(richPlain("x <span of control>")).toBe("x <span of control>");
    expect(richPlain("<i class=\"x\">a</i>")).toBe("<i class=\"x\">a");
  });
  test("unbalanced tags are closed, stray closes dropped", () => {
    expect(normalizeRich("a <b>bold")).toBe("a <b>bold</b>");
    expect(normalizeRich("a</i> b")).toBe("a b");
    expect(normalizeRich("<i>x <b>y</i> z")).toBe("<i>x <b>y</b></i> z");
  });
  test("an unknown tag is text, not markup", () => {
    expect(normalizeRich("a <script>x</script> b")).toBe("a &lt;script&gt;x&lt;/script&gt; b");
    expect(tokenize("<b>x</b>")).toEqual([{ kind: "open", tag: "b" }, { kind: "text", text: "x" }, { kind: "close", tag: "b" }]);
  });
  test("italic inside an italic field is set roman", () => {
    expect(italicize("Studies of <i>E. coli</i>")).toBe('<i>Studies of <span style="font-style:normal">E. coli</span></i>');
  });
});
