// Per-mode "Examples & syntax" help content for the task pane's collapsible
// reference panel. Each mode shows only the examples relevant to it, so the help
// tracks the selected mode instead of being a fixed chemical/math/build list.
//
// Pure data (HTML strings) — no Office.js — so a unit test can assert that every
// mode has help content. The task pane swaps the active entry on mode change.

/** The task pane's modes, used to key the examples map. */
export type ExampleMode =
  | "chemical"
  | "math"
  | "build"
  | "code"
  | "sequence"
  | "botanical"
  | "numerals"
  | "dna"
  | "audit"
  | "reaction"
  | "units"
  | "refs"
  | "plot"
  | "ppt"
  | "citations"
  | "finance"
  | "assay";

/** HTML help fragment shown in the "Examples & syntax" panel for each mode. */
export const MODE_EXAMPLES: Record<ExampleMode, string> = {
  chemical: `
    <ul>
      <li><code>H2O</code> &rarr; H<sub>2</sub>O</li>
      <li><code>Ca(OH)2</code> &rarr; Ca(OH)<sub>2</sub></li>
      <li><code>SO4^2-</code> &rarr; SO<sub>4</sub><sup>2&minus;</sup></li>
      <li><code>Na+</code> &rarr; Na<sup>+</sup></li>
    </ul>
    <p class="examples-note">
      <strong>2D structures</strong> work from a common name
      (<code>aspirin</code>, <code>water</code>), a known formula
      (<code>C6H6</code>), or any <code>SMILES</code> string
      (<code>CC(=O)O</code>). For <strong>stereochemistry</strong>, enter an
      isomeric SMILES (<code>C[C@@H](N)C(=O)O</code>) — it's drawn with wedges.
    </p>`,

  math: `
    <ul>
      <li><code>x^2 + y^2</code> &rarr; x<sup>2</sup> + y<sup>2</sup></li>
      <li><code>a_n</code>, <code>x^{n+1}</code>, <code>sqrt(x)</code>, <code>pi</code></li>
      <li><code>(-b +- sqrt(b^2-4 a c))/(2 a)</code> — the quadratic formula</li>
      <li><code>sum</code>, <code>int</code>, <code>prod</code>, <code>lim</code>, <code>|x|</code>, <code>bar(x)</code></li>
      <li><code>matrix(a,b; c,d)</code>, <code>pmatrix(…)</code>, <code>cases(…)</code></li>
      <li><strong>Multi-line</strong>: <code>align(a = b; c = d)</code> (or paste a LaTeX <code>align</code> block)</li>
    </ul>
    <p class="examples-note">
      Tick <strong>native Word equation</strong> for true fractions/radicals, or
      add an optional <strong>number</strong> (I), (II), … The
      <strong>Formula library</strong> dropdown inserts ready-made expressions.
    </p>
    <p class="examples-note">
      <strong>Import / export LaTeX:</strong> paste LaTeX
      (<code>\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}</code>) to turn it into a Word
      equation, or copy the current formula out as LaTeX.
    </p>`,

  build: `
    <p class="examples-note">
      <strong>Build</strong> renders a structure from a typed atom/bond list or a
      pasted MDL molfile. Atom/bond example:
      <br /><code>atoms: C O O</code>
      <br /><code>bonds: 1=2 1=3</code> &rarr; CO<sub>2</sub>.
    </p>
    <p class="examples-note">
      Bonds: <code>-</code> single, <code>=</code> double, <code>#</code> triple,
      <code>~</code> undefined; stereo <code>&gt;</code> wedge / <code>&lt;</code> hash.
      Atoms can carry a charge (<code>N+</code>, <code>O-</code>); hydrogens fill
      automatically. <strong>Markush / generic:</strong> <code>[C,N]</code>
      variable atom, <code>X</code> halogen, <code>A</code> any atom,
      <code>Q</code> heteroatom, <code>R1</code> R-group. <strong>Query</strong>
      in a trailing <code>{…}</code>: <code>{ar}</code>, <code>{ring}</code>,
      <code>{r5}</code>/<code>{r6}</code>, <code>{sub}</code>/<code>{nosub}</code>.
    </p>
    <p class="examples-note">
      Define <strong>R-group legends</strong> (line or table), and use the
      <strong>substituent gallery</strong> to draw alternatives
      (<code>R1a = c1ccccc1</code>).
    </p>`,

  code: `
    <p class="examples-note">
      <strong>Algorithm</strong> style bolds control-flow keywords
      (<code>if</code>, <code>for</code>, <code>while</code>, <code>return</code>,
      …) and can number lines and show a caption
      (e.g. <em>Algorithm 1: KeyGen</em>). <strong>Code listing</strong> is
      verbatim monospace.
    </p>
    <pre class="examples-pre">function KeyGen(λ)
  sample sk ← ZZ_q
  pk ← g^sk mod p
  return (pk, sk)</pre>`,

  sequence: `
    <p class="examples-note">
      Add one or more sequences, set each <strong>molecule type</strong>
      (DNA/RNA/protein) and <strong>organism</strong>, then
      <strong>Generate ST.26 XML</strong> to download or copy.
    </p>
    <ul>
      <li>DNA: <code>ATGCAAAGCTAA</code></li>
      <li>Protein: <code>MKAILVVLLY</code></li>
    </ul>
    <p class="examples-note">
      Residues are cleaned automatically (whitespace/numbering stripped, case
      normalized, invalid characters flagged). <strong>Always validate the
      output in the WIPO Sequence tool before filing.</strong>
    </p>`,

  botanical: `
    <ul>
      <li><code>Rosa × hybrida 'Peace'</code> &rarr; <i>Rosa</i> × <i>hybrida</i> 'Peace'</li>
      <li><code>Quercus robur subsp. robur</code> &rarr; <i>Quercus robur</i> subsp. <i>robur</i></li>
    </ul>
    <p class="examples-note">
      Genus, species, and infraspecific epithets are italicized; rank connectors
      (<code>subsp.</code>/<code>var.</code>/<code>f.</code>), author citations,
      hybrid <code>×</code>, and cultivars (<code>'Peace'</code>) stay roman. The
      <strong>varietal characteristics</strong> table is built from
      <code>Label: value</code> lines.
    </p>`,

  numerals: `
    <p class="examples-note">
      Build a <strong>numeral → element</strong> table (saved in this document).
      <strong>Add numeral</strong> auto-suggests the next number (10, 12, 14 …);
      each row's <strong>Insert</strong> drops a callout at the cursor.
    </p>
    <ul>
      <li><code>housing</code> + <code>12</code> &rarr; housing (12)</li>
      <li>Untick <em>parenthesize</em> for <code>housing 12</code></li>
    </ul>
    <p class="examples-note">
      <strong>Scan document</strong> flags collisions (one numeral, two
      elements), gaps (skipped numbers), orphans (a callout with no entry), and
      unused entries. <strong>Insert List of Reference Numerals</strong> adds the
      sorted table. Detection looks for the parenthesized form, e.g.
      <code>(12)</code> — advisory; verify before filing.
    </p>`,

  dna: `
    <p class="examples-note">
      Paste a DNA/RNA sequence (IUPAC codes and whitespace are fine) for live
      analysis:
    </p>
    <ul>
      <li><strong>Reverse complement</strong> &amp; <strong>mRNA</strong> (transcription, T→U)</li>
      <li><strong>Translation</strong> — pick a reading frame (+1/+2/+3 or reverse −1/−2/−3); stop codons show as <code>*</code></li>
      <li><strong>GC content</strong> &amp; base composition / length</li>
      <li><strong>ORF finder</strong> — six frames, ATG → stop, with a minimum length filter</li>
      <li><strong>Tools</strong> — primer Tm, protein MW/pI/GRAVY (of the translation), restriction sites</li>
    </ul>
    <p class="examples-note">
      Try <code>ATGGCCAAGCTTGATTAA</code>. Degenerate codons resolve when
      unambiguous (e.g. <code>GCN</code> → Ala). Drafting aid — verify downstream.
    </p>`,

  audit: `
    <p class="examples-note">
      <strong>Check this application</strong> reads the whole document and runs every
      consistency check at once:
    </p>
    <ul>
      <li>Reference numerals — collisions, gaps, orphans, unused (uses your Numerals table)</li>
      <li>Sequences — SEQ ID NO references vs. the listing</li>
      <li>Figures — referenced figure-number continuity</li>
    </ul>
    <p class="examples-note">Advisory — every check is heuristic; verify before filing.</p>`,

  reaction: `
    <p class="examples-note">
      Compose a reaction scheme: reactants <code>+</code> reactants <code>&gt;&gt;</code>
      products, with optional conditions over/under the arrow (separated by <code>;</code>).
    </p>
    <ul>
      <li><code>CCO + CC(=O)O &gt;&gt; CC(=O)OCC ; H2SO4 ; reflux</code></li>
      <li>Each component is a name or SMILES (e.g. <code>aspirin</code>, <code>c1ccccc1</code>).</li>
    </ul>
    <p class="examples-note">Inserts as a single image with provenance — verify before filing.</p>`,

  units: `
    <p class="examples-note">
      Typeset physical quantities and convert units:
    </p>
    <ul>
      <li><code>5.0 +- 0.2 kg</code> → 5.0 ± 0.2 kg</li>
      <li><code>9.81 m/s^2</code> → 9.81 m/s²</li>
      <li><code>1.2e-3 mol/L</code> → 1.2 × 10⁻³ mol/L</li>
      <li>Symbols: <code>ohm</code> → Ω, <code>degC</code> → °C, <code>umol</code> → µmol</li>
    </ul>
    <p class="examples-note">
      <strong>Convert</strong> handles length, mass, time, temperature, volume,
      pressure, energy, amount, and angle (e.g. <code>1 km → mi</code>,
      <code>100 °C → °F</code>) — including <strong>compound units</strong>
      (<code>km/h → m/s</code>, <code>g/mol → kg/mol</code>).
    </p>`,

  refs: `
    <p class="examples-note">
      Auto-numbered captions and cross-references; counters are saved in the document.
    </p>
    <ul>
      <li><strong>Insert caption</strong> → "Figure 1. …", "Table 2. …" (number auto-increments).</li>
      <li><strong>Cross-reference</strong> → "Fig. 3", "Table 2", or "Eq. (1)".</li>
      <li><strong>Check captions</strong> flags skipped or duplicated figure/table numbers.</li>
    </ul>
    <p class="examples-note">
      For live auto-renumbering across a long document, Word's own cross-reference
      fields remain the authority; this is the lightweight authoring aid.
    </p>`,

  plot: `
    <p class="examples-note">
      Plot a function or data as a chart (inserted as an image; runs offline).
    </p>
    <ul>
      <li><strong>Function:</strong> <code>sin(x)/x</code>, <code>x^2</code>, <code>exp(-x^2)</code> over an x-range.</li>
      <li><strong>Data:</strong> one point per line — <code>x y</code> or <code>x y err</code> (error bars).</li>
      <li>Functions: sin, cos, tan, exp, log/ln, sqrt, abs, …; constants pi, e.</li>
    </ul>
    <p class="examples-note">Optional title and axis labels. You can plot a function and data together.</p>`,

  ppt: `
    <p class="examples-note">
      Turn a Word <strong>table</strong> into a graphic: insert it into the document as a
      <strong>figure</strong> — including a black-&amp;-white <strong>patent figure</strong>
      style — or export it to <strong>PowerPoint</strong> (.pptx download).
    </p>
    <ul>
      <li>Click anywhere <strong>inside the table</strong> in your document, then <em>Read selected table</em>.</li>
      <li><strong>Charts</strong> (numeric tables): column, bar, line, area, pie, doughnut.
        First column = category labels; first row = series names (if it's text). Numbers may
        include <code>$</code>, <code>%</code>, commas, units (<code>12 kg</code>), and <code>(1,200)</code> negatives.</li>
      <li><strong>Flowchart</strong> (text tables): each row is a step, drawn top-to-bottom with
        arrows. A first column like <code>S101</code> becomes the step's reference numeral; a step
        ending in <code>?</code> is drawn as a decision diamond; Start/End rows get rounded boxes.</li>
      <li><strong>Block diagram</strong>: each row is a path — e.g. <code>System | Subsystem | Component</code> —
        merged into connected boxes. Leave a cell blank to repeat the value above it.</li>
      <li><strong>Table figure</strong>: draws the table <em>itself</em> as a clean figure — for
        characteristics/reference tables where the table is the exhibit. Keeps section grouping
        (a group-header row becomes a band; a blank “section” column merges down), bolds the header.</li>
      <li><strong>Patent style</strong> — pure black-&amp;-white line art: hatched bars/slices, dashed
        lines with distinct markers, and an optional <code>FIG. 1</code> label (37 CFR 1.84-friendly).</li>
      <li><strong>Reference numerals</strong> — number figure elements for callouts, drawn with
        <strong>lead lines</strong> to each element (37 CFR 1.84(q)): block-diagram boxes get
        hierarchical numbers (100, 110, 112…), flowchart steps 102, 104… (alternating sides), and
        table rows/sections get margin numerals with lead lines. Auto-placed as a starting point —
        reposition them as your drawing needs.</li>
    </ul>
    <p class="examples-note">
      When you read a table, the tool <strong>auto-picks</strong> the best view (chart, flowchart,
      block diagram, or table figure) — change it any time in “Show as”. Figures insert as images;
      use <strong>Insert as editable Word table</strong> (or tick <em>Also insert the data…</em>) when
      you need the text to stay editable. The PowerPoint chart is native and fully editable.</p>`,

  citations: `
    <p class="examples-note">
      Format <strong>Bluebook</strong> legal citations from labeled fields — the correct
      italics (case names, article/book titles, signals) are applied on insert.
    </p>
    <ul>
      <li><strong>Cases</strong> — <em>Alice Corp. v. CLS Bank Int'l</em>, 573 U.S. 208, 216 (2014); short form uses <code>at</code> (or <em>“→ Short form of this case”</em>). Type full party names — <em>Tables T6 &amp; T10</em> auto-abbreviate them (Corporation → Corp., International → Int’l, California → Cal.).</li>
      <li><strong>Id. / supra</strong> — <em>Id.</em> at 217 for the immediately preceding cite (or <em>“Insert Id. for the preceding authority”</em>, which scans above the cursor); <em>supra</em> note 15, at 912 for an earlier source (<em>“Detect earlier source”</em> finds a prior law-review article and fills the author).</li>
      <li><strong>Statutes / regs</strong> — 35 U.S.C. § 101; 37 C.F.R. § 1.84 (multiple sections auto-use §§).</li>
      <li><strong>Patents</strong> — U.S. Patent No. 10,123,456; App. Pub. No. 2020/0123456 A1 (numbers auto-grouped).</li>
      <li><strong>Agency &amp; secondary</strong> — Fed. Reg., MPEP §, law-review articles, and treatises.</li>
      <li><strong>Signals</strong> — optional italicized <em>See</em>, <em>Cf.</em>, <em>But see</em>, … prepended.</li>
      <li><strong>Paste &amp; fix</strong> — paste a messy citation (<code>35 usc 101</code>, <code>alice corp v cls bank, 573 us 208 (2014)</code>) and it detects the type and fills the fields to review.</li>
      <li><strong>Table of Authorities</strong> — scan the document and insert a grouped, alphabetized authorities list (cases, statutes, regs, patents, other); add page numbers before filing.</li>
    </ul>
    <p class="examples-note">
      Pick a <strong>Style</strong> — <em>Practitioner</em> (briefs/office actions) or <em>Academic</em>
      (law-review footnotes); they differ in case-name italics and small-caps for authors/journals.
      Reporters and courts auto-correct (<code>f3d</code>→F.3d, <code>fed cir</code>→Fed. Cir.).
      Dates like <code>2014-06-19</code> or <code>3/1/2020</code> become Bluebook month form.
      Drafting aid — <strong>verify against the current Bluebook</strong>; this applies common
      conventions, not the full manual.</p>`,

  finance: `
    <p class="examples-note">
      Financial <strong>calculators</strong> — pick one, fill the inputs, and the result
      computes live; insert it at the cursor.
    </p>
    <ul>
      <li>Time value of money — future/present value, compound interest, loan payment</li>
      <li>Discounted cash flow — <strong>NPV</strong> and <strong>IRR</strong> from a cash-flow list</li>
      <li><strong>Black–Scholes</strong> option price; <strong>bond</strong> pricing</li>
    </ul>
    <p class="examples-note">
      Rates are entered as percentages. For the matching typeset equations, see the
      <strong>Finance</strong> categories in the Math <em>Formula library</em>.
    </p>`,
  assay: `
    <p class="examples-note">
      Quantitative <strong>assay</strong> tools — pick a calculator, paste your data, and the
      fit or result computes live on your machine; insert the result (and the fitted plot).
    </p>
    <ul>
      <li><strong>Enzyme kinetics</strong> — Michaelis–Menten &amp; Hill fits (V<sub>max</sub>, K<sub>m</sub>, n) with standard errors and R²</li>
      <li><strong>Dose–response</strong> — 4-parameter logistic → <strong>IC50 / EC50</strong>, Hill slope, pEC50; Cheng–Prusoff K<sub>i</sub></li>
      <li><strong>Binding</strong> — one-site saturation (B<sub>max</sub>, K<sub>d</sub>)</li>
      <li><strong>Lab math</strong> — Henderson–Hasselbalch, Beer–Lambert, dilutions, A260/A280 quantitation</li>
    </ul>
    <p class="examples-note">
      For fits, enter two equal-length lists (e.g. [S] and v), one value per number, separated
      by commas or spaces. Concentrations are linear (not log). Analysis aid — verify before publishing.
    </p>`,
};
