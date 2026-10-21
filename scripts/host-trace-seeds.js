/* eslint-disable no-undef */
// Seeds for the host-trace drive (scripts/host-trace.js): known inputs for the
// tools whose Word-facing buttons refuse on an empty field. Keyed
// "mode/buttonId" or "buttonId". Steps (see host-trace-driver.js):
//   [elementId, value]            set a field and fire input + change
//   ["click", elementId]          click a button (e.g. Convert before Insert)
//   ["qclick", cssSelector]       click the first match
//   ["q:" + cssSelector, value]   set the first matching field
//   ["file:" + inputId, name, text]  hand a file to a file input
// Each step settles before the next, so async work finishes in order.
const fs = require("fs");
const path = require("path");

const JDX = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "__tests__", "fixtures", "jcamp", "2Methyl1Propanol.jdx"), "utf8");
const BIB = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "__tests__", "fixtures", "bib", "crossref-kwon2022.bib"), "utf8");
const DNA = "ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCTAA";

module.exports = {
  "chemical/insert-periodic-btn": [["periodic-el", "Fe"], ["periodic-view", "bohr"]],
  "chemical/insert-periodic-btn#2": [["periodic-el", "Fe"], ["periodic-view", "report"]],
  "chemical/insert-btn": [["formula-input", "H2SO4"]],
  "chemical/insert-structure-btn": [["formula-input", "aspirin"]],
  "chemical/insert-name-btn": [["formula-input", "aspirin"]],
  "chemical/insert-props-btn": [["formula-input", "aspirin"]],
  "math/insert-btn": [["formula-input", "x^2 + 2x + 1"]],
  "build/insert-build-btn": [["click", "build-tab-text"], ["build-format", "atombond"], ["build-input", "atoms: C O O\nbonds: 1=2 1=3"]],
  "build/insert-gallery-btn": [["gallery-input", "R1 = CC\nR2 = c1ccccc1"]],
  "reaction/reaction-draw-btn": [],
  "reaction/reaction-insert-btn": [["reaction-read", "formulas"], ["reaction-input", "Fe2O3 + CO -> Fe + CO2"]],
  "reaction/reaction-insert-btn#2": [["reaction-read", "structures"], ["reaction-input", "CH4 + O2 -> CO2 + H2O"]],
  "massspec/ms-insert": [["ms-input", "C6H12O6"]],
  "massspec/ms-insert-chart": [["ms-input", "C6H12O6"]],
  // Characterization: a list, an HRMS line with Found, and the From Build button left alone (Build is empty here).
  "diagram/diagram-insert": [["click", "diagram-example"]],
  "charz/charz-insert": [["charz-compound", "caffeine"], ["charz-h-list", "1H NMR (400 MHz, Chloroform-d) δ 7.51 (s, 1H), 3.99 (s, 3H), 3.57 (s, 3H), 3.40 (s, 3H)."], ["charz-ms-on", true], ["charz-ms-found", "195.0874"]],
  "spectra/spec-insert": [["spec-kind", "ms"], ["spec-input", "CCO"]],
  "spectra/spec-insert-chart": [["spec-input", "CCO"]],
  "spectra/jcamp-insert": [["file:jcamp-file", "2Methyl1Propanol.jdx", JDX]],
  "spectra/jcamp-insert-chart": [["file:jcamp-file", "2Methyl1Propanol.jdx", JDX]],
  "spectra/spec-overlay-insert": [["spec-kind", "1H"], ["spec-input", "CC(C)CO"], ["click", "spec-compare"], ["file:jcamp-file", "2Methyl1Propanol.jdx", JDX]],
  "spectra/spec-overlay-insert-chart": [["spec-kind", "1H"], ["spec-input", "CC(C)CO"], ["click", "spec-compare"], ["file:jcamp-file", "2Methyl1Propanol.jdx", JDX]],
  "solve/solve-insert": [["solve-input", "x^2 - 5x + 6 = 0"]],
  // A point cloud on a ring: Topology draws its persistence barcode, which is
  // the figure half of insertSolveResult.
  "solve/solve-insert#2": [["solve-kind", "topology"], ["solve-input", "1 0\n0.7 0.7\n0 1\n-0.7 0.7\n-1 0\n-0.7 -0.7\n0 -1\n0.7 -0.7"]],
  "solve/solve-insert#3": [["solve-kind", "equation"], ["solve-input", "x^2 - 4 = 0"]],
  "units/unit-insert": [["unit-input", "9.81 m/s^2"]],
  "units/conv-insert": [["conv-value", "100"], ["conv-from", "km/h"], ["conv-to", "m/s"], ["click", "conv-btn"]],
  // Second branches the review found untraced: Table → Chart WITH its editable
  // data table (the tableChart tail), the editable table WITH a label, and an
  // Engineering report that contains equations (the OOXML layout item).
  "ppt/ppt-insert-fig#2": [["ppt-with-text", true]],
  "ppt/ppt-insert-table#2": [["ppt-figlabel", "FIG. 1"]],
  "engineering/engineering-insert#2": [["engineering-calc", "control-tf"]],
  "plot/plot-insert":[["plot-fn", "sin(x)/x"], ["figstyle-vector", true]],
  "dna/dna-revcomp-insert": [["dna-input", DNA]],
  "dna/dna-mrna-insert": [["dna-input", DNA]],
  "dna/dna-protein-insert": [["dna-input", DNA]],
  "dna/dna-orf-insert": [["dna-input", DNA], ["click", "dna-orf-btn"]],
  "dna/digest-insert-btn": [["dna-input", DNA], ["click", "digest-run-btn"]],
  "peptide/pep-insert": [["pep-input", "ACDEFGHIK"]],
  "botanical/bot-name-insert": [["bot-name", "Quercus alba L."]],
  "botanical/bot-traits-insert": [["bot-traits", "Height: 20 m\nLeaf: lobed\nFlower: catkin"]],
  "seqmap/seqmap-insert": [["seqmap-input", DNA]],
  "align/align-insert": [["align-a", "GATTACAGATTACA"], ["align-b", "GATCACAGATTCCA"]],
  "numerals/num-insert-list-btn": [["click", "num-add-btn"], ["q:#num-list .num-row:last-child .rgroup-input:not(.num-numeral)", "housing"], ["qclick", "#num-list .num-callout-btn"]],
  "numerals/para-apply-btn": [["para-renumber", true], ["click", "para-preview-btn"]],
  "code/insert-code-btn": [["code-input", "for i in 1..n:\n    total = total + a[i]\nreturn total"]],
  // A real Crossref BibTeX export into the document's library, the reference
  // selected, then Insert citation: the marker, the renumbering batch, and the
  // settings save (writeBibStore) all run, and Update then has a citation to
  // renumber and a bibliography to write.
  "citations/bib-insert": [["bib-paste", BIB], ["click", "bib-import"], ["bib-library", "Kwon_2022"]],
  "citations/cite-insert": [["cite-paste", "Brown v. Board of Education, 347 U.S. 483 (1954)."], ["click", "cite-parse"]],
};
