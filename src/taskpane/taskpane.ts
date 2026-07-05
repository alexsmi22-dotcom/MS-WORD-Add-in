/* global Office, Word, document, localStorage, navigator, URL, Blob, HTMLInputElement, HTMLButtonElement, HTMLSelectElement, HTMLTextAreaElement, HTMLElement, Image, TextEncoder, btoa */

import { Segment, segmentsToHtml } from "../lib/segments";
import { parseChemical } from "../lib/chemParser";
import { parseMath } from "../lib/mathFormat";
import { mathToOoxml } from "../lib/mathOmml";
import { mathToHtml } from "../lib/mathHtml";
import { parseMathAst } from "../lib/mathParse";
import { latexToDsl, astToLatex } from "../lib/latex";
import { formatQuantityHtml, convert, formatSig } from "../lib/units";
import { RefKind, formatCaption, formatRef, formatEqRef, checkCaptions } from "../lib/refs";
import { Series, samplePlot, parseData, buildPlotSvg } from "../lib/plot";
import {
  futureValue,
  presentValue,
  compoundInterest,
  loanPayment,
  npv,
  irr,
  blackScholes,
  bondPrice,
  OptionType,
} from "../lib/finance";
import { renderStructure, nameForIdcode, StructureResult } from "../lib/structures";
import { build, BuildFormat, BuildResult } from "../lib/builder";
import { formatCodeBlock, CodeStyle } from "../lib/codeblock";
import { buildSt26Xml, cleanResidues, MolType, SequenceEntry, SequenceListingMeta } from "../lib/sequence";
import { formatBotanicalNameHtml, formatTraitTableHtml } from "../lib/botanical";
import { parseSubstituents } from "../lib/gallery";
import { FORMULA_LIBRARY } from "../lib/formulaLibrary";
import {
  MATH_PALETTE,
  CHEM_PALETTE,
  BUILD_TEMPLATES,
  BUILD_BONDS,
  BUILD_MARKUSH,
  PaletteGroup,
  PaletteItem,
} from "../lib/palettes";
import { NAME_TO_SMILES } from "../lib/compounds";
import {
  HistoryEntry,
  HistoryKind,
  addRecent,
  getRecents,
  getFavorites,
  isFavorite,
  toggleFavorite,
  clearHistory,
} from "../lib/history";
import { toRoman, peekFormulaNumber, nextFormulaNumber, resetFormulaNumbering } from "../lib/numbering";
import { LegendEntry, buildLegendText, buildLegendTableHtml, referencedRGroups } from "../lib/markush";
import {
  NumeralEntry,
  extractNumerals,
  reconcileNumerals,
  suggestNextNumeral,
  formatCallout,
  buildNumeralListHtml,
  NUMERAL_LIST_HEADING,
} from "../lib/numerals";
import { MODE_EXAMPLES, ExampleMode } from "../lib/examples";
import {
  Orf,
  cleanDna,
  reverseComplement,
  transcribe,
  translate,
  baseStats,
  findOrfs,
  buildOrfTableHtml,
  primerTm,
  restrictionSites,
  proteinProperties,
} from "../lib/dna";
import { auditDocument, AuditReport } from "../lib/audit";
import { parseReaction, composeReactionScheme, Rendered } from "../lib/reactions";
import { formatSeqIdRef } from "../lib/seqid";
import { getPrefs, setPref } from "../lib/prefs";
import { parseTableData, cleanTableRows, buildChartPreviewSvg, TableChart, ChartKind, ChartStyle } from "../lib/tablechart";
import { buildDiagramSvg, DiagramKind } from "../lib/tablediagram";
import { buildTableFigureSvg, prepareTableFigure } from "../lib/tablefigure";
import { classifyTable } from "../lib/tableclassify";
import { CITATIONS, SIGNALS, citationById, applySignal, parseCitation, CitationResult } from "../lib/citations";

type Mode =
  | "chemical"
  | "math"
  | "units"
  | "plot"
  | "ppt"
  | "finance"
  | "build"
  | "code"
  | "sequence"
  | "botanical"
  | "numerals"
  | "dna"
  | "reaction"
  | "audit"
  | "refs"
  | "citations";

const STRUCTURE_W = 300;
const STRUCTURE_H = 230;
const GALLERY_W = 170;
const GALLERY_H = 140;

let inputEl: HTMLInputElement;
let previewEl: HTMLElement;
let statusEl: HTMLElement;
let insertBtn: HTMLButtonElement;
let structureSection: HTMLElement;
let structurePreviewEl: HTMLElement;
let insertStructureBtn: HTMLButtonElement;
let structureNameEl: HTMLElement;
let insertNameBtn: HTMLButtonElement;
/** The recognized compound name for the current structure, or "". */
let currentStructureName = "";
let ommlOption: HTMLElement;
let ommlCheckbox: HTMLInputElement;
let numberOption: HTMLElement;
let numberCheckbox: HTMLInputElement;
let numberNext: HTMLElement;
let numberReset: HTMLButtonElement;
let structureInfo: HTMLElement;
let libraryRow: HTMLElement;
let libCategorySelect: HTMLSelectElement;
let libFormulaSelect: HTMLSelectElement;
let latexRow: HTMLElement;
let latexInput: HTMLTextAreaElement;
let latexConvertBtn: HTMLButtonElement;
let latexCopyBtn: HTMLButtonElement;
let paletteEl: HTMLElement;
let searchInput: HTMLInputElement;
let searchResults: HTMLElement;
let historyEl: HTMLElement;
let buildTemplatesEl: HTMLElement;
let buildBondsEl: HTMLElement;
let buildMarkushEl: HTMLElement;
let formatSection: HTMLElement;
let buildSection: HTMLElement;
let buildFormatSelect: HTMLSelectElement;
let buildInput: HTMLTextAreaElement;
let buildFormulaEl: HTMLElement;
let buildSmilesEl: HTMLElement;
let buildPreviewEl: HTMLElement;
let buildRgroupsEl: HTMLElement;
let insertBuildBtn: HTMLButtonElement;
let codeSection: HTMLElement;
let codeStyleSelect: HTMLSelectElement;
let codeTitleInput: HTMLInputElement;
let codeLineNumsCheckbox: HTMLInputElement;
let codeInput: HTMLTextAreaElement;
let codePreviewEl: HTMLElement;
let insertCodeBtn: HTMLButtonElement;
let galleryInput: HTMLTextAreaElement;
let galleryPreviewEl: HTMLElement;
let insertGalleryBtn: HTMLButtonElement;
let sequenceSection: HTMLElement;
let seqListEl: HTMLElement;
let seqOutput: HTMLTextAreaElement;
let seqWarningsEl: HTMLElement;
let seqAddBtn: HTMLButtonElement;
let seqGenerateBtn: HTMLButtonElement;
let seqDownloadBtn: HTMLButtonElement;
let seqCopyBtn: HTMLButtonElement;
/** The most recently generated ST.26 XML, for download/copy. */
let seqXml = "";
let botanicalSection: HTMLElement;
let botNameInput: HTMLInputElement;
let botNamePreview: HTMLElement;
let botNameInsert: HTMLButtonElement;
let botTraitsInput: HTMLTextAreaElement;
let botTraitsPreview: HTMLElement;
let botTraitsInsert: HTMLButtonElement;
let numeralsSection: HTMLElement;
let numListEl: HTMLElement;
let numAddBtn: HTMLButtonElement;
let numParensCheckbox: HTMLInputElement;
let numScanBtn: HTMLButtonElement;
let numInsertListBtn: HTMLButtonElement;
let numFindingsEl: HTMLElement;
let examplesBody: HTMLElement;
let dnaSection: HTMLElement;
let dnaInput: HTMLTextAreaElement;
let dnaReadout: HTMLElement;
let dnaStats: HTMLElement;
let dnaRevcompEl: HTMLElement;
let dnaRevcompInsert: HTMLButtonElement;
let dnaMrnaEl: HTMLElement;
let dnaMrnaInsert: HTMLButtonElement;
let dnaFrameSelect: HTMLSelectElement;
let dnaStopCheckbox: HTMLInputElement;
let dnaProteinEl: HTMLElement;
let dnaProteinInsert: HTMLButtonElement;
let dnaOrfMin: HTMLInputElement;
let dnaOrfBtn: HTMLButtonElement;
let dnaOrfResults: HTMLElement;
let dnaOrfInsert: HTMLButtonElement;
let dnaTm: HTMLElement;
let dnaProteinProps: HTMLElement;
let dnaRestrictBtn: HTMLButtonElement;
let dnaRestrictResults: HTMLElement;
let reactionSection: HTMLElement;
let reactionInput: HTMLTextAreaElement;
let reactionPreviewEl: HTMLElement;
let reactionInsertBtn: HTMLButtonElement;
let auditSection: HTMLElement;
let auditRunBtn: HTMLButtonElement;
let auditResults: HTMLElement;
let unitsSection: HTMLElement;
let unitInput: HTMLInputElement;
let unitPreview: HTMLElement;
let unitInsertBtn: HTMLButtonElement;
let convValue: HTMLInputElement;
let convFrom: HTMLInputElement;
let convTo: HTMLInputElement;
let convBtn: HTMLButtonElement;
let convResult: HTMLElement;
let convInsertBtn: HTMLButtonElement;
/** HTML of the most recent conversion result, for insertion. */
let currentConvHtml = "";
let citationsSection: HTMLElement;
let citeTypeSelect: HTMLSelectElement;
let citeSignalSelect: HTMLSelectElement;
let citeInputs: HTMLElement;
let citePreview: HTMLElement;
let citeInsertBtn: HTMLButtonElement;
let citeCopyBtn: HTMLButtonElement;
let citePasteInput: HTMLTextAreaElement;
let citeParseBtn: HTMLButtonElement;
let citeParseMsg: HTMLElement;
/** The most recently formatted citation, for insert/copy. */
let currentCitation: CitationResult | null = null;
let refsSection: HTMLElement;
let refKind: HTMLSelectElement;
let refNext: HTMLElement;
let refReset: HTMLButtonElement;
let refCaptionText: HTMLInputElement;
let refInsertCaption: HTMLButtonElement;
let refXrefKind: HTMLSelectElement;
let refXrefNum: HTMLInputElement;
let refInsertXref: HTMLButtonElement;
let refCheck: HTMLButtonElement;
let refFindings: HTMLElement;
/** Per-document caption counters (persisted in document settings). */
let refCounters: { figure: number; table: number } = { figure: 1, table: 1 };
let plotSection: HTMLElement;
let plotFn: HTMLInputElement;
let plotXmin: HTMLInputElement;
let plotXmax: HTMLInputElement;
let plotData: HTMLTextAreaElement;
let plotTitle: HTMLInputElement;
let plotXlabel: HTMLInputElement;
let plotYlabel: HTMLInputElement;
let plotPreview: HTMLElement;
let plotInsertBtn: HTMLButtonElement;
/** The plot SVG from the most recent preview, for insertion. */
let currentPlotSvg = "";
let financeSection: HTMLElement;
let finCalcSelect: HTMLSelectElement;
let finInputs: HTMLElement;
let finResult: HTMLElement;
let finInsertBtn: HTMLButtonElement;
let pptSection: HTMLElement;
let pptLoadBtn: HTMLButtonElement;
let pptInfo: HTMLElement;
let pptKindSelect: HTMLSelectElement;
let pptTitleInput: HTMLInputElement;
let pptPatentCheckbox: HTMLInputElement;
let pptNumeralsCheckbox: HTMLInputElement;
let pptFigLabelInput: HTMLInputElement;
let pptIncludeTable: HTMLInputElement;
let pptPreview: HTMLElement;
let pptWarnings: HTMLElement;
let pptInsertFigBtn: HTMLButtonElement;
let pptInsertTableBtn: HTMLButtonElement;
let pptWithTextCheckbox: HTMLInputElement;
let pptDownloadBtn: HTMLButtonElement;
/** Cleaned rows of the most recently read table (charts and diagrams). */
let currentTableRows: string[][] | null = null;
/** Chart-ready parse of those rows, or null when the table isn't numeric. */
let currentTableChart: TableChart | null = null;
/** Why the chart parse failed (shown when a chart kind is selected). */
let currentTableChartError = "";
/** The finance result text from the most recent computation, for insertion. */
let currentFinText = "";
let seqRefNum: HTMLInputElement;
let seqRefInsert: HTMLButtonElement;

/** Reference-numeral table for the active document (persisted in document settings). */
let numeralEntries: NumeralEntry[] = [];
/** ORFs from the most recent Find ORFs run, for table insertion. */
let currentOrfs: Orf[] = [];
/** The reaction-scheme SVG from the most recent preview, for insertion. */
let currentReactionSvg: { svg: string; width: number; height: number } | null = null;

/** R-group label -> user-entered definition (e.g. "R1" -> "methyl, ethyl"). */
const rgroupValues: Record<string, string> = {};
/** How the R-group legend is inserted: an inline line or a structured table. */
let legendFormat: "line" | "table" = "line";
/** R-group labels present in the current structure (main groups, from the build). */
let mainRgroups: string[] = [];
/** Container for dynamically-added sub-generic R-group inputs (e.g. R1a), or null. */
let subGroupWrap: HTMLElement | null = null;

/** The structure currently shown in the Chemical structure preview, or null. */
let currentStructure: StructureResult | null = null;
/** The molecule currently shown in the Build preview, or null. */
let currentBuild: BuildResult | null = null;

Office.onReady((info) => {
  if (info.host !== Office.HostType.Word) {
    return;
  }

  inputEl = document.getElementById("formula-input") as HTMLInputElement;
  previewEl = document.getElementById("preview") as HTMLElement;
  statusEl = document.getElementById("status") as HTMLElement;
  insertBtn = document.getElementById("insert-btn") as HTMLButtonElement;
  structureSection = document.getElementById("structure-section") as HTMLElement;
  structurePreviewEl = document.getElementById("structure-preview") as HTMLElement;
  insertStructureBtn = document.getElementById("insert-structure-btn") as HTMLButtonElement;
  structureNameEl = document.getElementById("structure-name") as HTMLElement;
  insertNameBtn = document.getElementById("insert-name-btn") as HTMLButtonElement;
  ommlOption = document.getElementById("omml-option") as HTMLElement;
  ommlCheckbox = document.getElementById("omml-checkbox") as HTMLInputElement;
  numberOption = document.getElementById("number-option") as HTMLElement;
  numberCheckbox = document.getElementById("number-checkbox") as HTMLInputElement;
  numberNext = document.getElementById("number-next") as HTMLElement;
  numberReset = document.getElementById("number-reset") as HTMLButtonElement;
  structureInfo = document.getElementById("structure-info") as HTMLElement;
  libraryRow = document.getElementById("library-row") as HTMLElement;
  libCategorySelect = document.getElementById("lib-category") as HTMLSelectElement;
  libFormulaSelect = document.getElementById("lib-formula") as HTMLSelectElement;
  latexRow = document.getElementById("latex-row") as HTMLElement;
  latexInput = document.getElementById("latex-input") as HTMLTextAreaElement;
  latexConvertBtn = document.getElementById("latex-convert") as HTMLButtonElement;
  latexCopyBtn = document.getElementById("latex-copy") as HTMLButtonElement;
  paletteEl = document.getElementById("palette") as HTMLElement;
  searchInput = document.getElementById("search") as HTMLInputElement;
  searchResults = document.getElementById("search-results") as HTMLElement;
  historyEl = document.getElementById("history") as HTMLElement;
  buildTemplatesEl = document.getElementById("build-templates") as HTMLElement;
  buildBondsEl = document.getElementById("build-bonds") as HTMLElement;
  buildMarkushEl = document.getElementById("build-markush") as HTMLElement;
  formatSection = document.getElementById("format-section") as HTMLElement;
  buildSection = document.getElementById("build-section") as HTMLElement;
  buildFormatSelect = document.getElementById("build-format") as HTMLSelectElement;
  buildInput = document.getElementById("build-input") as HTMLTextAreaElement;
  buildFormulaEl = document.getElementById("build-formula") as HTMLElement;
  buildSmilesEl = document.getElementById("build-smiles") as HTMLElement;
  buildPreviewEl = document.getElementById("build-preview") as HTMLElement;
  buildRgroupsEl = document.getElementById("build-rgroups") as HTMLElement;
  insertBuildBtn = document.getElementById("insert-build-btn") as HTMLButtonElement;
  codeSection = document.getElementById("code-section") as HTMLElement;
  codeStyleSelect = document.getElementById("code-style") as HTMLSelectElement;
  codeTitleInput = document.getElementById("code-title") as HTMLInputElement;
  codeLineNumsCheckbox = document.getElementById("code-linenums") as HTMLInputElement;
  codeInput = document.getElementById("code-input") as HTMLTextAreaElement;
  codePreviewEl = document.getElementById("code-preview") as HTMLElement;
  insertCodeBtn = document.getElementById("insert-code-btn") as HTMLButtonElement;
  galleryInput = document.getElementById("gallery-input") as HTMLTextAreaElement;
  galleryPreviewEl = document.getElementById("gallery-preview") as HTMLElement;
  insertGalleryBtn = document.getElementById("insert-gallery-btn") as HTMLButtonElement;
  sequenceSection = document.getElementById("sequence-section") as HTMLElement;
  seqListEl = document.getElementById("seq-list") as HTMLElement;
  seqOutput = document.getElementById("seq-output") as HTMLTextAreaElement;
  seqWarningsEl = document.getElementById("seq-warnings") as HTMLElement;
  seqAddBtn = document.getElementById("seq-add-btn") as HTMLButtonElement;
  seqGenerateBtn = document.getElementById("seq-generate-btn") as HTMLButtonElement;
  seqDownloadBtn = document.getElementById("seq-download-btn") as HTMLButtonElement;
  seqCopyBtn = document.getElementById("seq-copy-btn") as HTMLButtonElement;
  botanicalSection = document.getElementById("botanical-section") as HTMLElement;
  botNameInput = document.getElementById("bot-name") as HTMLInputElement;
  botNamePreview = document.getElementById("bot-name-preview") as HTMLElement;
  botNameInsert = document.getElementById("bot-name-insert") as HTMLButtonElement;
  botTraitsInput = document.getElementById("bot-traits") as HTMLTextAreaElement;
  botTraitsPreview = document.getElementById("bot-traits-preview") as HTMLElement;
  botTraitsInsert = document.getElementById("bot-traits-insert") as HTMLButtonElement;
  numeralsSection = document.getElementById("numerals-section") as HTMLElement;
  numListEl = document.getElementById("num-list") as HTMLElement;
  numAddBtn = document.getElementById("num-add-btn") as HTMLButtonElement;
  numParensCheckbox = document.getElementById("num-parens") as HTMLInputElement;
  numScanBtn = document.getElementById("num-scan-btn") as HTMLButtonElement;
  numInsertListBtn = document.getElementById("num-insert-list-btn") as HTMLButtonElement;
  numFindingsEl = document.getElementById("num-findings") as HTMLElement;
  examplesBody = document.getElementById("examples-body") as HTMLElement;
  dnaSection = document.getElementById("dna-section") as HTMLElement;
  dnaInput = document.getElementById("dna-input") as HTMLTextAreaElement;
  dnaReadout = document.getElementById("dna-readout") as HTMLElement;
  dnaStats = document.getElementById("dna-stats") as HTMLElement;
  dnaRevcompEl = document.getElementById("dna-revcomp") as HTMLElement;
  dnaRevcompInsert = document.getElementById("dna-revcomp-insert") as HTMLButtonElement;
  dnaMrnaEl = document.getElementById("dna-mrna") as HTMLElement;
  dnaMrnaInsert = document.getElementById("dna-mrna-insert") as HTMLButtonElement;
  dnaFrameSelect = document.getElementById("dna-frame") as HTMLSelectElement;
  dnaStopCheckbox = document.getElementById("dna-stopstop") as HTMLInputElement;
  dnaProteinEl = document.getElementById("dna-protein") as HTMLElement;
  dnaProteinInsert = document.getElementById("dna-protein-insert") as HTMLButtonElement;
  dnaOrfMin = document.getElementById("dna-orf-min") as HTMLInputElement;
  dnaOrfBtn = document.getElementById("dna-orf-btn") as HTMLButtonElement;
  dnaOrfResults = document.getElementById("dna-orf-results") as HTMLElement;
  dnaOrfInsert = document.getElementById("dna-orf-insert") as HTMLButtonElement;
  dnaTm = document.getElementById("dna-tm") as HTMLElement;
  dnaProteinProps = document.getElementById("dna-protein-props") as HTMLElement;
  dnaRestrictBtn = document.getElementById("dna-restrict-btn") as HTMLButtonElement;
  dnaRestrictResults = document.getElementById("dna-restrict-results") as HTMLElement;
  reactionSection = document.getElementById("reaction-section") as HTMLElement;
  reactionInput = document.getElementById("reaction-input") as HTMLTextAreaElement;
  reactionPreviewEl = document.getElementById("reaction-preview") as HTMLElement;
  reactionInsertBtn = document.getElementById("reaction-insert-btn") as HTMLButtonElement;
  auditSection = document.getElementById("audit-section") as HTMLElement;
  auditRunBtn = document.getElementById("audit-run-btn") as HTMLButtonElement;
  auditResults = document.getElementById("audit-results") as HTMLElement;
  unitsSection = document.getElementById("units-section") as HTMLElement;
  unitInput = document.getElementById("unit-input") as HTMLInputElement;
  unitPreview = document.getElementById("unit-preview") as HTMLElement;
  unitInsertBtn = document.getElementById("unit-insert") as HTMLButtonElement;
  convValue = document.getElementById("conv-value") as HTMLInputElement;
  convFrom = document.getElementById("conv-from") as HTMLInputElement;
  convTo = document.getElementById("conv-to") as HTMLInputElement;
  convBtn = document.getElementById("conv-btn") as HTMLButtonElement;
  convResult = document.getElementById("conv-result") as HTMLElement;
  convInsertBtn = document.getElementById("conv-insert") as HTMLButtonElement;
  citationsSection = document.getElementById("citations-section") as HTMLElement;
  citeTypeSelect = document.getElementById("cite-type") as HTMLSelectElement;
  citeSignalSelect = document.getElementById("cite-signal") as HTMLSelectElement;
  citeInputs = document.getElementById("cite-inputs") as HTMLElement;
  citePreview = document.getElementById("cite-preview") as HTMLElement;
  citeInsertBtn = document.getElementById("cite-insert") as HTMLButtonElement;
  citeCopyBtn = document.getElementById("cite-copy") as HTMLButtonElement;
  citePasteInput = document.getElementById("cite-paste") as HTMLTextAreaElement;
  citeParseBtn = document.getElementById("cite-parse") as HTMLButtonElement;
  citeParseMsg = document.getElementById("cite-parse-msg") as HTMLElement;
  refsSection = document.getElementById("refs-section") as HTMLElement;
  refKind = document.getElementById("ref-kind") as HTMLSelectElement;
  refNext = document.getElementById("ref-next") as HTMLElement;
  refReset = document.getElementById("ref-reset") as HTMLButtonElement;
  refCaptionText = document.getElementById("ref-caption-text") as HTMLInputElement;
  refInsertCaption = document.getElementById("ref-insert-caption") as HTMLButtonElement;
  refXrefKind = document.getElementById("ref-xref-kind") as HTMLSelectElement;
  refXrefNum = document.getElementById("ref-xref-num") as HTMLInputElement;
  refInsertXref = document.getElementById("ref-insert-xref") as HTMLButtonElement;
  refCheck = document.getElementById("ref-check") as HTMLButtonElement;
  refFindings = document.getElementById("ref-findings") as HTMLElement;
  plotSection = document.getElementById("plot-section") as HTMLElement;
  plotFn = document.getElementById("plot-fn") as HTMLInputElement;
  plotXmin = document.getElementById("plot-xmin") as HTMLInputElement;
  plotXmax = document.getElementById("plot-xmax") as HTMLInputElement;
  plotData = document.getElementById("plot-data") as HTMLTextAreaElement;
  plotTitle = document.getElementById("plot-title") as HTMLInputElement;
  plotXlabel = document.getElementById("plot-xlabel") as HTMLInputElement;
  plotYlabel = document.getElementById("plot-ylabel") as HTMLInputElement;
  plotPreview = document.getElementById("plot-preview") as HTMLElement;
  plotInsertBtn = document.getElementById("plot-insert") as HTMLButtonElement;
  financeSection = document.getElementById("finance-section") as HTMLElement;
  finCalcSelect = document.getElementById("fin-calc") as HTMLSelectElement;
  finInputs = document.getElementById("fin-inputs") as HTMLElement;
  finResult = document.getElementById("fin-result") as HTMLElement;
  finInsertBtn = document.getElementById("fin-insert") as HTMLButtonElement;
  seqRefNum = document.getElementById("seq-ref-num") as HTMLInputElement;
  seqRefInsert = document.getElementById("seq-ref-insert") as HTMLButtonElement;
  pptSection = document.getElementById("ppt-section") as HTMLElement;
  pptLoadBtn = document.getElementById("ppt-load") as HTMLButtonElement;
  pptInfo = document.getElementById("ppt-info") as HTMLElement;
  pptKindSelect = document.getElementById("ppt-kind") as HTMLSelectElement;
  pptTitleInput = document.getElementById("ppt-title") as HTMLInputElement;
  pptPatentCheckbox = document.getElementById("ppt-patent") as HTMLInputElement;
  pptNumeralsCheckbox = document.getElementById("ppt-numerals") as HTMLInputElement;
  pptFigLabelInput = document.getElementById("ppt-figlabel") as HTMLInputElement;
  pptIncludeTable = document.getElementById("ppt-include-table") as HTMLInputElement;
  pptPreview = document.getElementById("ppt-preview") as HTMLElement;
  pptWarnings = document.getElementById("ppt-warnings") as HTMLElement;
  pptInsertFigBtn = document.getElementById("ppt-insert-fig") as HTMLButtonElement;
  pptInsertTableBtn = document.getElementById("ppt-insert-table") as HTMLButtonElement;
  pptWithTextCheckbox = document.getElementById("ppt-with-text") as HTMLInputElement;
  pptDownloadBtn = document.getElementById("ppt-download") as HTMLButtonElement;

  inputEl.addEventListener("input", onInputChanged);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") insertFormula();
  });
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      updatePlaceholder();
      updateExamples();
      renderPalette();
      onInputChanged();
    });
  });
  insertBtn.addEventListener("click", insertFormula);
  insertStructureBtn.addEventListener("click", insertStructure);
  insertNameBtn.addEventListener("click", () => insertDnaText(currentStructureName, "Name"));
  numberCheckbox.addEventListener("change", updateNumberLabel);
  numberReset.addEventListener("click", () => {
    resetFormulaNumbering();
    updateNumberLabel();
  });
  buildInput.addEventListener("input", updateBuildPreview);
  buildFormatSelect.addEventListener("change", updateBuildPreview);
  insertBuildBtn.addEventListener("click", insertBuild);

  codeInput.addEventListener("input", updateCodePreview);
  codeStyleSelect.addEventListener("change", updateCodePreview);
  codeTitleInput.addEventListener("input", updateCodePreview);
  codeLineNumsCheckbox.addEventListener("change", updateCodePreview);
  insertCodeBtn.addEventListener("click", insertCodeBlock);

  galleryInput.addEventListener("input", updateGalleryPreview);
  insertGalleryBtn.addEventListener("click", insertGallery);

  seqAddBtn.addEventListener("click", () => addSequenceCard());
  seqGenerateBtn.addEventListener("click", generateSequenceXml);
  seqDownloadBtn.addEventListener("click", downloadSequenceXml);
  seqCopyBtn.addEventListener("click", copySequenceXml);
  addSequenceCard();

  botNameInput.addEventListener("input", updateBotanicalName);
  botNameInsert.addEventListener("click", insertBotanicalName);
  botTraitsInput.addEventListener("input", updateTraitTable);
  botTraitsInsert.addEventListener("click", insertTraitTable);

  numAddBtn.addEventListener("click", addNumeral);
  numScanBtn.addEventListener("click", scanDocumentNumerals);
  numInsertListBtn.addEventListener("click", insertNumeralList);
  loadNumerals();
  renderNumeralRows();

  dnaInput.addEventListener("input", updateDnaPreview);
  dnaFrameSelect.addEventListener("change", updateDnaPreview);
  dnaStopCheckbox.addEventListener("change", updateDnaPreview);
  dnaRevcompInsert.addEventListener("click", () => insertDnaText(dnaRevcompEl.textContent || "", "Reverse complement"));
  dnaMrnaInsert.addEventListener("click", () => insertDnaText(dnaMrnaEl.textContent || "", "mRNA"));
  dnaProteinInsert.addEventListener("click", () => insertDnaText(dnaProteinEl.textContent || "", "Protein"));
  dnaOrfBtn.addEventListener("click", findOrfsHandler);
  dnaOrfInsert.addEventListener("click", insertOrfTable);
  dnaRestrictBtn.addEventListener("click", findRestrictionSites);

  reactionInput.addEventListener("input", updateReactionPreview);
  reactionInsertBtn.addEventListener("click", insertReaction);

  auditRunBtn.addEventListener("click", runAudit);

  seqRefInsert.addEventListener("click", insertSeqIdRef);

  latexConvertBtn.addEventListener("click", convertLatex);
  latexCopyBtn.addEventListener("click", copyAsLatex);

  unitInput.addEventListener("input", updateUnitPreview);
  unitInsertBtn.addEventListener("click", insertQuantity);
  convBtn.addEventListener("click", doConvert);
  convInsertBtn.addEventListener("click", insertConversion);

  refKind.addEventListener("change", updateRefNext);
  refReset.addEventListener("click", resetRefCounter);
  refInsertCaption.addEventListener("click", insertCaption);
  refInsertXref.addEventListener("click", insertCrossRef);
  refCheck.addEventListener("click", checkCaptionsHandler);
  loadRefCounters();

  for (const el of [plotFn, plotXmin, plotXmax, plotData, plotTitle, plotXlabel, plotYlabel]) {
    el.addEventListener("input", updatePlotPreview);
  }
  plotInsertBtn.addEventListener("click", insertPlot);

  populateFinanceCalcs();
  finCalcSelect.addEventListener("change", renderFinanceInputs);
  finInsertBtn.addEventListener("click", () => insertDnaText(currentFinText, "Result"));

  populateCitationTypes();
  citeTypeSelect.addEventListener("change", renderCitationInputs);
  citeSignalSelect.addEventListener("change", updateCitationPreview);
  citeInsertBtn.addEventListener("click", insertCitation);
  citeCopyBtn.addEventListener("click", copyCitation);
  citeParseBtn.addEventListener("click", parseAndFillCitation);

  pptLoadBtn.addEventListener("click", loadSelectedTable);
  pptKindSelect.addEventListener("change", updatePptPreview);
  pptTitleInput.addEventListener("input", updatePptPreview);
  pptPatentCheckbox.addEventListener("change", updatePptPreview);
  pptNumeralsCheckbox.addEventListener("change", updatePptPreview);
  pptFigLabelInput.addEventListener("input", updatePptPreview);
  pptInsertFigBtn.addEventListener("click", insertTableFigure);
  pptInsertTableBtn.addEventListener("click", insertEditableWordTable);
  pptDownloadBtn.addEventListener("click", downloadPptx);

  // Apply persisted preferences to the relevant controls, and save on change.
  const prefs = getPrefs();
  numParensCheckbox.checked = prefs.calloutParens;
  numParensCheckbox.addEventListener("change", () => setPref("calloutParens", numParensCheckbox.checked));
  dnaFrameSelect.value = String(prefs.dnaFrame);
  dnaFrameSelect.addEventListener("change", () => setPref("dnaFrame", parseInt(dnaFrameSelect.value, 10)));

  populateLibraryCategories();
  libCategorySelect.addEventListener("change", populateLibraryFormulas);
  libFormulaSelect.addEventListener("change", onLibraryFormulaChosen);

  buildSearchIndex();
  searchInput.addEventListener("input", updateSearchResults);
  searchInput.addEventListener("focus", updateSearchResults);
  searchInput.addEventListener("blur", () => window.setTimeout(closeSearch, 150));

  renderBuildTemplates();
  renderBuildButtons(buildBondsEl, BUILD_BONDS);
  renderBuildButtons(buildMarkushEl, BUILD_MARKUSH);

  renderPalette();
  renderHistory();
  updateNumberLabel();
  updatePlaceholder();
  updateExamples();
  onInputChanged();
});

/** Swaps the "Examples & syntax" panel to the help for the current mode. */
function updateExamples(): void {
  examplesBody.innerHTML = MODE_EXAMPLES[currentMode() as ExampleMode] ?? "";
}

/** Shows the next equation number "(I)" next to the numbering checkbox. */
function updateNumberLabel(): void {
  numberNext.textContent = numberCheckbox.checked ? `(${toRoman(peekFormulaNumber())})` : "";
}

/** Switches mode programmatically (e.g. from search or history) and refreshes UI. */
function setMode(mode: Mode): void {
  const radio = document.querySelector<HTMLInputElement>(`input[name="mode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  updatePlaceholder();
  updateExamples();
  renderPalette();
  onInputChanged();
}

// ---------------------------------------------------------------------------
// Search (formulas + compounds)
// ---------------------------------------------------------------------------

interface SearchEntry {
  type: "formula" | "compound";
  label: string;
  sub: string;
  value: string;
  mode: Mode;
}

let searchIndex: SearchEntry[] = [];

function buildSearchIndex(): void {
  const entries: SearchEntry[] = [];
  for (const cat of FORMULA_LIBRARY) {
    for (const f of cat.formulas) {
      entries.push({ type: "formula", label: f.label, sub: cat.name, value: f.expr, mode: "math" });
    }
  }
  for (const name of Object.keys(NAME_TO_SMILES)) {
    entries.push({ type: "compound", label: name, sub: "compound", value: name, mode: "chemical" });
  }
  searchIndex = entries;
}

function updateSearchResults(): void {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    closeSearch();
    return;
  }
  const scored = searchIndex
    .map((e) => ({ e, score: matchScore(e.label.toLowerCase(), q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  searchResults.replaceChildren();
  if (scored.length === 0) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = "No matches.";
    searchResults.appendChild(empty);
  } else {
    for (const { e } of scored) {
      const item = document.createElement("div");
      item.className = "search-item";
      item.setAttribute("role", "option");
      const text = document.createElement("span");
      text.textContent = e.label;
      const badge = document.createElement("span");
      badge.className = `search-item-type ${e.type === "compound" ? "compound" : ""}`.trim();
      badge.textContent = e.type === "compound" ? "compound" : e.sub;
      item.append(text, badge);
      item.addEventListener("mousedown", (ev) => {
        ev.preventDefault(); // keep blur from firing before click
        applySearchEntry(e);
      });
      searchResults.appendChild(item);
    }
  }
  searchResults.classList.add("open");
}

/** Substring match scoring: prefix matches rank highest, then earlier matches. */
function matchScore(haystack: string, needle: string): number {
  const idx = haystack.indexOf(needle);
  if (idx < 0) return 0;
  if (idx === 0) return 100 - haystack.length * 0.01;
  return 50 - idx;
}

function applySearchEntry(entry: SearchEntry): void {
  setMode(entry.mode);
  inputEl.value = entry.value;
  onInputChanged();
  searchInput.value = "";
  closeSearch();
  inputEl.focus();
}

function closeSearch(): void {
  searchResults.classList.remove("open");
  searchResults.replaceChildren();
}

// ---------------------------------------------------------------------------
// Build templates (common structures)
// ---------------------------------------------------------------------------

function renderBuildTemplates(): void {
  buildTemplatesEl.replaceChildren();
  for (const tpl of BUILD_TEMPLATES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "palette-btn";
    btn.textContent = tpl.label;
    if (tpl.title) btn.title = tpl.title;
    btn.addEventListener("click", () => {
      buildInput.value = tpl.snippet;
      updateBuildPreview();
      buildInput.focus();
    });
    buildTemplatesEl.appendChild(btn);
  }
}

/** Renders a row of Build buttons; clicking inserts its snippet at the cursor. */
function renderBuildButtons(el: HTMLElement, items: PaletteItem[]): void {
  el.replaceChildren();
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "palette-btn";
    btn.textContent = item.label;
    if (item.title) btn.title = item.title;
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => insertBuildSnippet(item.snippet));
    el.appendChild(btn);
  }
}

/** Inserts a snippet at the cursor in the Build input. */
function insertBuildSnippet(snippet: string): void {
  const start = buildInput.selectionStart ?? buildInput.value.length;
  const end = buildInput.selectionEnd ?? buildInput.value.length;
  buildInput.value = buildInput.value.slice(0, start) + snippet + buildInput.value.slice(end);
  const pos = start + snippet.length;
  buildInput.focus();
  buildInput.setSelectionRange(pos, pos);
  updateBuildPreview();
}

// ---------------------------------------------------------------------------
// Recents & favorites
// ---------------------------------------------------------------------------

function renderHistory(): void {
  historyEl.replaceChildren();
  const favorites = getFavorites();
  const recents = getRecents();
  if (favorites.length) historyEl.appendChild(historyGroup("★ Saved", favorites, true));
  if (recents.length) historyEl.appendChild(historyGroup("Recent", recents, false));
  if (favorites.length || recents.length) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "linklike";
    clear.style.marginLeft = "0";
    clear.textContent = "Clear recents & favorites";
    clear.title = "Remove all stored history from this machine";
    clear.addEventListener("click", () => {
      clearHistory();
      renderHistory();
    });
    historyEl.appendChild(clear);
  }
}

function historyGroup(title: string, entries: HistoryEntry[], favorited: boolean): HTMLElement {
  const wrap = document.createElement("div");
  const label = document.createElement("div");
  label.className = "history-group-label";
  label.textContent = title;
  wrap.appendChild(label);

  const row = document.createElement("div");
  row.className = "history-row";
  for (const entry of entries) {
    const chip = document.createElement("span");
    chip.className = "chip";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "chip-load";
    loadBtn.textContent = entry.label;
    loadBtn.title = `Load: ${entry.value}`;
    loadBtn.addEventListener("click", () => loadHistoryEntry(entry));

    const star = document.createElement("button");
    star.type = "button";
    star.className = "chip-star";
    star.textContent = favorited || isFavorite(entry) ? "★" : "☆";
    star.title = "Toggle favorite";
    star.addEventListener("click", () => {
      toggleFavorite(entry);
      renderHistory();
    });

    chip.append(loadBtn, star);
    row.appendChild(chip);
  }
  wrap.appendChild(row);
  return wrap;
}

function loadHistoryEntry(entry: HistoryEntry): void {
  setMode(entry.kind);
  if (entry.kind === "build") {
    buildInput.value = entry.value;
    updateBuildPreview();
    buildInput.focus();
  } else {
    inputEl.value = entry.value;
    onInputChanged();
    inputEl.focus();
  }
}

/** Records an insert in recents and refreshes the history UI. */
function recordInsert(kind: HistoryKind, value: string, label: string): void {
  addRecent({ kind, value, label });
  renderHistory();
}

/** Renders the palette buttons for the current mode (math vs chemical). */
/** Whether a palette group is expanded — remembered per mode/group; the first two
 *  groups default to open so common symbols are visible without a click. */
function paletteGroupOpen(mode: string, name: string, index: number): boolean {
  try {
    const v = localStorage.getItem(`formula-inserter.palette.${mode}.${name}`);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* localStorage best-effort */
  }
  return index < 2;
}

function setPaletteGroupOpen(mode: string, name: string, open: boolean): void {
  try {
    localStorage.setItem(`formula-inserter.palette.${mode}.${name}`, open ? "1" : "0");
  } catch {
    /* localStorage best-effort */
  }
}

function renderPalette(): void {
  const mode = currentMode();
  const groups: PaletteGroup[] = mode === "math" ? MATH_PALETTE : mode === "chemical" ? CHEM_PALETTE : [];
  paletteEl.replaceChildren();
  groups.forEach((group, index) => {
    // Collapsible group so the palette stays clean as the symbol set grows.
    const details = document.createElement("details");
    details.className = "palette-acc";
    details.open = paletteGroupOpen(mode, group.name, index);
    details.addEventListener("toggle", () => setPaletteGroupOpen(mode, group.name, details.open));

    const summary = document.createElement("summary");
    summary.className = "palette-group-label";
    summary.textContent = group.name;
    details.appendChild(summary);

    const items = document.createElement("div");
    items.className = "palette-group";
    for (const item of group.items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "palette-btn";
      btn.textContent = item.label;
      if (item.title) btn.title = item.title;
      // Keep focus/selection in the input so the snippet lands at the caret.
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => insertAtCursor(item.snippet, item.caret));
      items.appendChild(btn);
    }
    details.appendChild(items);
    paletteEl.appendChild(details);
  });
}

/** Inserts a snippet at the input's caret and positions the cursor within it. */
function insertAtCursor(snippet: string, caret?: number): void {
  const start = inputEl.selectionStart ?? inputEl.value.length;
  const end = inputEl.selectionEnd ?? inputEl.value.length;
  inputEl.value = inputEl.value.slice(0, start) + snippet + inputEl.value.slice(end);
  const pos = start + (caret ?? snippet.length);
  inputEl.focus();
  inputEl.setSelectionRange(pos, pos);
  onInputChanged();
}

/** Groups the library categories under optgroups for a scannable dropdown. */
const LIBRARY_GROUPS: Array<{ label: string; categories: string[] }> = [
  { label: "Mathematics", categories: ["Statistics", "Geometry", "Algebra", "Trigonometry", "Calculus"] },
  {
    label: "Functions",
    categories: [
      "Trig functions",
      "Hyperbolic functions",
      "Log & exponential",
      "Special functions",
      "Discrete & combinatorics",
    ],
  },
  {
    label: "Science & engineering",
    categories: [
      "Cryptography",
      "Computer science / ML",
      "Mechanical engineering",
      "Electrical engineering",
      "Physics",
      "Biology / assays",
    ],
  },
];

/** Fills the category dropdown (grouped) and the formulas for the first category. */
function populateLibraryCategories(): void {
  libCategorySelect.replaceChildren();
  const indexByName: Record<string, number> = {};
  FORMULA_LIBRARY.forEach((cat, i) => (indexByName[cat.name] = i));
  const placed: Record<string, true> = {};

  for (const grp of LIBRARY_GROUPS) {
    const og = document.createElement("optgroup");
    og.label = grp.label;
    for (const name of grp.categories) {
      const i = indexByName[name];
      if (i === undefined) continue;
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = name;
      og.appendChild(opt);
      placed[name] = true;
    }
    if (og.children.length) libCategorySelect.appendChild(og);
  }
  // Safety net: any category not assigned to a group is appended ungrouped.
  FORMULA_LIBRARY.forEach((cat, i) => {
    if (placed[cat.name]) return;
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = cat.name;
    libCategorySelect.appendChild(opt);
  });

  populateLibraryFormulas();
}

/** Fills the formula dropdown for the currently selected category. */
function populateLibraryFormulas(): void {
  const cat = FORMULA_LIBRARY[Number(libCategorySelect.value)];
  libFormulaSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose a formula…";
  libFormulaSelect.appendChild(placeholder);
  cat?.formulas.forEach((f, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = f.label;
    libFormulaSelect.appendChild(opt);
  });
}

/** When a library formula is picked, load its expression into the input. */
function onLibraryFormulaChosen(): void {
  const cat = FORMULA_LIBRARY[Number(libCategorySelect.value)];
  const idx = libFormulaSelect.value;
  if (!cat || idx === "") return;
  inputEl.value = cat.formulas[Number(idx)].expr;
  onInputChanged();
  inputEl.focus();
}

function currentMode(): Mode {
  const checked = document.querySelector<HTMLInputElement>('input[name="mode"]:checked');
  return (checked?.value as Mode) ?? "chemical";
}

function parse(text: string, mode: Mode): Segment[] {
  return mode === "chemical" ? parseChemical(text) : parseMath(text);
}

function updatePlaceholder(): void {
  if (currentMode() === "math") {
    inputEl.placeholder = "e.g. x^2 + y^2, a_n, sqrt(x)";
  } else {
    inputEl.placeholder = "e.g. H2O, Ca(OH)2, aspirin";
  }
}

/** Converts pasted LaTeX into the editor (Math mode) and refreshes the preview. */
function convertLatex(): void {
  const src = latexInput.value.trim();
  if (!src) {
    setStatus("Paste some LaTeX first.", "error");
    return;
  }
  const dsl = latexToDsl(src);
  if (!dsl) {
    setStatus("Couldn't read that LaTeX.", "error");
    return;
  }
  setMode("math");
  inputEl.value = dsl;
  ommlCheckbox.checked = true;
  onInputChanged();
  inputEl.focus();
  setStatus("LaTeX converted — review the preview, then Insert.", "success");
}

/** Copies the current equation as LaTeX to the clipboard. */
async function copyAsLatex(): Promise<void> {
  const src = inputEl.value.trim();
  if (!src) {
    setStatus("Enter a formula first.", "error");
    return;
  }
  let latex: string;
  try {
    latex = astToLatex(parseMathAst(src));
  } catch {
    setStatus("Couldn't convert this expression to LaTeX.", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(latex);
    setStatus("Copied as LaTeX.", "success");
  } catch {
    latexInput.value = latex;
    setStatus("LaTeX placed in the import box (clipboard unavailable) — copy from there.", "");
  }
}

/** Refreshes everything that depends on the input: section visibility and previews. */
function onInputChanged(): void {
  const mode = currentMode();
  const formatting = mode === "chemical" || mode === "math";

  formatSection.style.display = formatting ? "block" : "none";
  buildSection.style.display = mode === "build" ? "block" : "none";
  codeSection.style.display = mode === "code" ? "block" : "none";
  sequenceSection.style.display = mode === "sequence" ? "block" : "none";
  botanicalSection.style.display = mode === "botanical" ? "block" : "none";
  numeralsSection.style.display = mode === "numerals" ? "block" : "none";
  dnaSection.style.display = mode === "dna" ? "block" : "none";
  reactionSection.style.display = mode === "reaction" ? "block" : "none";
  auditSection.style.display = mode === "audit" ? "block" : "none";
  unitsSection.style.display = mode === "units" ? "block" : "none";
  refsSection.style.display = mode === "refs" ? "block" : "none";
  citationsSection.style.display = mode === "citations" ? "block" : "none";
  plotSection.style.display = mode === "plot" ? "block" : "none";
  financeSection.style.display = mode === "finance" ? "block" : "none";
  pptSection.style.display = mode === "ppt" ? "block" : "none";

  if (mode === "units") {
    updateUnitPreview();
    return;
  }
  if (mode === "refs") {
    updateRefNext();
    return;
  }
  if (mode === "citations") {
    if (!citeInputs.children.length) renderCitationInputs();
    else updateCitationPreview();
    return;
  }
  if (mode === "plot") {
    updatePlotPreview();
    return;
  }
  if (mode === "ppt") {
    updatePptPreview();
    return;
  }
  if (mode === "finance") {
    if (!finInputs.children.length) renderFinanceInputs();
    return;
  }
  if (mode === "numerals") {
    return; // numeral UI is self-contained (table + scan + insert)
  }
  if (mode === "dna") {
    updateDnaPreview();
    return;
  }
  if (mode === "reaction") {
    updateReactionPreview();
    return;
  }
  if (mode === "audit") {
    return; // audit runs on demand via the button
  }
  if (mode === "build") {
    updateBuildPreview();
    updateGalleryPreview();
    return;
  }
  if (mode === "code") {
    updateCodePreview();
    return;
  }
  if (mode === "sequence") {
    return; // sequence UI is self-contained (no input-driven preview)
  }
  if (mode === "botanical") {
    updateBotanicalName();
    updateTraitTable();
    return;
  }

  updateTextPreview();
  const chemical = mode === "chemical";
  structureSection.style.display = chemical ? "block" : "none";
  ommlOption.style.display = chemical ? "none" : "block";
  numberOption.style.display = mode === "math" ? "block" : "none";
  libraryRow.style.display = mode === "math" ? "block" : "none";
  latexRow.style.display = mode === "math" ? "block" : "none";
  if (chemical) {
    updateStructurePreview();
  } else {
    currentStructure = null;
  }
}

/** Renders the live HTML preview for the current input and mode. */
function updateTextPreview(): void {
  if (currentMode() === "math") {
    // Structured math renderer (fractions, roots, Σ, ∫ …) mirrors the OMML
    // that gets inserted; falls back to inline formatting on partial input.
    previewEl.innerHTML = mathToHtml(inputEl.value);
  } else {
    // Same HTML used for insertion (see insertFormattedText) so preview == insert.
    previewEl.innerHTML = segmentsToHtml(parseChemical(inputEl.value));
  }
}

// ---------------------------------------------------------------------------
// Code / algorithm blocks
// ---------------------------------------------------------------------------

function codeOptions(): { style: CodeStyle; title: string; lineNumbers: boolean } {
  return {
    style: codeStyleSelect.value as CodeStyle,
    title: codeTitleInput.value,
    lineNumbers: codeLineNumsCheckbox.checked,
  };
}

/** Live preview of the formatted code/algorithm block (mirrors what gets inserted). */
function updateCodePreview(): void {
  if (!codeInput.value.trim()) {
    codePreviewEl.innerHTML = '<span class="hint">Type pseudocode or paste code to format it as a block.</span>';
    insertCodeBtn.disabled = true;
    return;
  }
  codePreviewEl.innerHTML = formatCodeBlock(codeInput.value, codeOptions());
  insertCodeBtn.disabled = false;
}

/** Inserts the formatted code/algorithm block at the selection. */
async function insertCodeBlock(): Promise<void> {
  if (!codeInput.value.trim()) {
    setStatus("Type some code or pseudocode first.", "error");
    return;
  }
  const html = formatCodeBlock(codeInput.value, codeOptions());
  insertCodeBtn.disabled = true;
  setStatus("Inserting block…");
  try {
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const inserted = range.insertHtml(html, Word.InsertLocation.replace);
      inserted.select(Word.SelectionMode.end);
      await context.sync();
    });
    setStatus("Block inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert: ${(error as Error).message}`, "error");
  } finally {
    insertCodeBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Substituent gallery — drawn R-group alternatives for a Markush genus
// ---------------------------------------------------------------------------

/** Live preview of each drawn substituent (label + 2D structure). */
function updateGalleryPreview(): void {
  const items = parseSubstituents(galleryInput.value);
  galleryPreviewEl.replaceChildren();
  if (!items.length) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "List drawn alternatives (label = SMILES/name) to depict them.";
    galleryPreviewEl.appendChild(hint);
    insertGalleryBtn.disabled = true;
    return;
  }
  let any = false;
  for (const it of items) {
    const card = document.createElement("div");
    card.className = "gallery-card";
    if (it.label) {
      const lab = document.createElement("div");
      lab.className = "gallery-label";
      lab.textContent = `${it.label} =`;
      card.appendChild(lab);
    }
    const r = renderStructure(it.input, GALLERY_W, GALLERY_H);
    if (r) {
      const fig = document.createElement("div");
      fig.innerHTML = r.svg;
      card.appendChild(fig);
      any = true;
    } else {
      const bad = document.createElement("span");
      bad.className = "hint";
      bad.textContent = `couldn't render "${it.input}"`;
      card.appendChild(bad);
    }
    galleryPreviewEl.appendChild(card);
  }
  insertGalleryBtn.disabled = !any;
}

/** Inserts each drawn substituent (label + structure image) as its own paragraph. */
async function insertGallery(): Promise<void> {
  const items = parseSubstituents(galleryInput.value);
  const rendered: { label: string; base64: string; alt: string }[] = [];
  for (const it of items) {
    const r = renderStructure(it.input, GALLERY_W, GALLERY_H);
    if (!r) continue;
    const d = readSvgDims(r.svg, GALLERY_W, GALLERY_H);
    const base64 = await svgToPngBase64(r.svg, d.w, d.h);
    const label = it.label ? `substituent ${it.label}` : "substituent";
    rendered.push({ label: it.label, base64, alt: provenanceAltText(label, r.formula, r.mw, r.smiles, r.idcode) });
  }
  if (!rendered.length) {
    setStatus("No drawable substituents — check the SMILES/names.", "error");
    return;
  }
  insertGalleryBtn.disabled = true;
  setStatus("Inserting substituent gallery…");
  try {
    await Word.run(async (context) => {
      let anchor: Word.Range = context.document.getSelection();
      for (const item of rendered) {
        const para = anchor.insertParagraph(item.label ? `${item.label} = ` : "", Word.InsertLocation.after);
        const pic = para.insertInlinePictureFromBase64(item.base64, Word.InsertLocation.end);
        pic.altTextDescription = item.alt;
        anchor = para.getRange(Word.RangeLocation.end);
      }
      anchor.select(Word.SelectionMode.end);
      await context.sync();
    });
    setStatus(`Inserted ${rendered.length} substituent(s).`, "success");
  } catch (error) {
    setStatus(`Could not insert: ${(error as Error).message}`, "error");
  } finally {
    insertGalleryBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// ST.26 sequence listings
// ---------------------------------------------------------------------------

/** Appends an editable sequence card (molecule type, organism, residues + readout). */
function addSequenceCard(): void {
  const card = document.createElement("div");
  card.className = "seq-card";

  const head = document.createElement("div");
  head.className = "seq-card-head";

  const moltype = document.createElement("select");
  moltype.className = "lib-select seq-moltype";
  for (const [val, text] of [
    ["DNA", "DNA"],
    ["RNA", "RNA"],
    ["AA", "Protein (AA)"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = text;
    moltype.appendChild(opt);
  }

  const organism = document.createElement("input");
  organism.type = "text";
  organism.className = "formula-input seq-organism";
  organism.placeholder = "Organism (e.g. Homo sapiens; blank = synthetic construct)";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "linklike seq-remove";
  remove.textContent = "remove";
  remove.addEventListener("click", () => {
    if (seqListEl.querySelectorAll(".seq-card").length > 1) card.remove();
  });
  head.append(moltype, organism, remove);

  const residues = document.createElement("textarea");
  residues.className = "build-input seq-residues";
  residues.rows = 3;
  residues.spellcheck = false;
  residues.placeholder = "Paste residues (whitespace and numbering are ignored)";

  const readout = document.createElement("div");
  readout.className = "seq-readout hint";
  const refresh = () => {
    const { length, invalid } = cleanResidues(moltype.value as MolType, residues.value);
    readout.textContent = length
      ? `${length} residues${invalid.length ? ` · ignored invalid: ${invalid.join(" ")}` : ""}`
      : "";
  };
  residues.addEventListener("input", refresh);
  moltype.addEventListener("change", refresh);

  card.append(head, residues, readout);
  seqListEl.appendChild(card);
}

/** Reads the sequence cards into ST.26 entries. */
function readSequenceEntries(): SequenceEntry[] {
  const entries: SequenceEntry[] = [];
  seqListEl.querySelectorAll<HTMLElement>(".seq-card").forEach((card) => {
    const moltype = (card.querySelector(".seq-moltype") as HTMLSelectElement).value as MolType;
    const organism = (card.querySelector(".seq-organism") as HTMLInputElement).value;
    const residues = (card.querySelector(".seq-residues") as HTMLTextAreaElement).value;
    if (residues.trim()) entries.push({ moltype, residues, organism });
  });
  return entries;
}

function val(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value.trim();
}

/** Today's date as YYYY-MM-DD (lib stays Date-free; the UI supplies it). */
function todayIso(): string {
  // eslint-disable-next-line no-restricted-globals
  return new Date().toISOString().slice(0, 10);
}

/** Validates inputs, builds the ST.26 XML, and shows it with any warnings. */
function generateSequenceXml(): void {
  const applicantName = val("seq-applicant");
  const inventionTitle = val("seq-title");
  const entries = readSequenceEntries();

  const errors: string[] = [];
  if (!applicantName) errors.push("Applicant name is required.");
  if (!inventionTitle) errors.push("Invention title is required.");
  if (!entries.length) errors.push("Add at least one sequence with residues.");

  if (errors.length) {
    seqWarningsEl.className = "seq-warnings error";
    seqWarningsEl.textContent = errors.join(" ");
    return;
  }

  // Soft warnings: ST.26 excludes short sequences and flags invalid residues.
  const warnings: string[] = [];
  entries.forEach((e, i) => {
    const { length, invalid } = cleanResidues(e.moltype, e.residues);
    const min = e.moltype === "AA" ? 4 : 10;
    if (length < min) warnings.push(`SEQ ${i + 1}: only ${length} residues (ST.26 lists ≥ ${min}).`);
    if (invalid.length) warnings.push(`SEQ ${i + 1}: ignored invalid residues (${invalid.join(" ")}).`);
  });

  const meta: SequenceListingMeta = {
    applicantName,
    inventionTitle,
    applicantFileReference: val("seq-fileref") || undefined,
    ipOfficeCode: val("seq-office") || undefined,
    applicationNumber: val("seq-appnum") || undefined,
    filingDate: val("seq-filing") || undefined,
    productionDate: todayIso(),
  };

  seqXml = buildSt26Xml(meta, entries);
  seqOutput.value = seqXml;
  seqDownloadBtn.disabled = false;
  seqCopyBtn.disabled = false;
  seqWarningsEl.className = warnings.length ? "seq-warnings warn" : "seq-warnings";
  seqWarningsEl.textContent = warnings.length
    ? "Generated with warnings — " + warnings.join(" ")
    : `Generated ST.26 XML for ${entries.length} sequence(s). Validate in WIPO Sequence before filing.`;
}

/** Downloads the generated XML as a file. */
function downloadSequenceXml(): void {
  if (!seqXml) return;
  const blob = new Blob([seqXml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sequence-listing.xml";
  a.click();
  URL.revokeObjectURL(url);
  setStatus("Sequence listing downloaded.", "success");
}

/** Copies the generated XML to the clipboard. */
async function copySequenceXml(): Promise<void> {
  if (!seqXml) return;
  try {
    await navigator.clipboard.writeText(seqXml);
    setStatus("ST.26 XML copied to clipboard.", "success");
  } catch {
    seqOutput.select();
    setStatus("Press Ctrl+C to copy the selected XML.", "");
  }
}

// ---------------------------------------------------------------------------
// Table → PPT (export a Word table as a PowerPoint chart)
// ---------------------------------------------------------------------------

/** Everything selectable in the "Show as" list: charts, diagrams, table figure. */
type RenderKind = ChartKind | DiagramKind | "tablefigure";

/** Kinds that render straight from the raw rows (no numeric parse needed). */
function isRowKind(kind: RenderKind): kind is DiagramKind | "tablefigure" {
  return kind === "flowchart" || kind === "hierarchy" || kind === "tablefigure";
}

/** Kinds exported to PowerPoint as a picture rather than a native chart. */
function isPictureKind(kind: RenderKind): boolean {
  return isRowKind(kind);
}

/** Reads the table the cursor / selection sits in and parses it. */
async function loadSelectedTable(): Promise<void> {
  pptLoadBtn.disabled = true;
  try {
    await Word.run(async (context) => {
      const selection = context.document.getSelection();
      const tables = selection.tables;
      tables.load("items");
      const parent = selection.parentTableOrNullObject;
      parent.load("isNullObject");
      await context.sync();

      // A collapsed cursor inside a table reports no tables in the range but
      // does have a parent table; a dragged selection reports the former.
      let table: Word.Table | null = tables.items.length ? tables.items[0] : null;
      if (!table && !parent.isNullObject) table = parent;
      if (!table) {
        currentTableRows = null;
        currentTableChart = null;
        updatePptPreview();
        setStatus("Click anywhere inside a table in your document first, then press “Read selected table”.", "error");
        return;
      }

      table.load("values");
      await context.sync();
      const rows = cleanTableRows(table.values);
      if (!rows.length || !rows[0].length) {
        currentTableRows = null;
        currentTableChart = null;
        updatePptPreview();
        setStatus("The selected table is empty.", "error");
        return;
      }
      currentTableRows = rows;
      currentTableChart = null;
      currentTableChartError = "";
      try {
        currentTableChart = parseTableData(rows);
      } catch (parseError) {
        currentTableChartError = parseError instanceof Error ? parseError.message : "This table can't be charted.";
      }

      // Auto-pick the representation that best fits the table's shape; the user
      // can still override via the "Show as" dropdown.
      const rec = classifyTable(rows);
      pptKindSelect.value = rec.kind;
      setStatus(rec.reason, "success");
      updatePptPreview();
    });
  } catch (e) {
    currentTableRows = null;
    currentTableChart = null;
    updatePptPreview();
    setStatus(e instanceof Error ? e.message : "Couldn't read the selected table.", "error");
  } finally {
    pptLoadBtn.disabled = false;
  }
}

/** The chart style currently selected in the pane. */
function currentChartStyle(): ChartStyle {
  return {
    patent: pptPatentCheckbox.checked,
    numerals: pptNumeralsCheckbox.checked,
    figLabel: pptFigLabelInput.value.trim(),
  };
}

/**
 * Renders the currently selected representation (chart or diagram) as SVG.
 * Returns null — with a reason in `error` — when it can't be drawn.
 */
function renderTableGraphic(): { svg: string; warnings: string[] } | { svg: null; error: string } {
  const kind = pptKindSelect.value as RenderKind;
  const title = pptTitleInput.value.trim();
  const style = currentChartStyle();
  if (kind === "tablefigure") {
    if (!currentTableRows) return { svg: null, error: "" };
    return buildTableFigureSvg(currentTableRows, title, style);
  }
  if (isRowKind(kind)) {
    if (!currentTableRows) return { svg: null, error: "" };
    return buildDiagramSvg(kind, currentTableRows, title, style);
  }
  if (!currentTableChart) {
    return { svg: null, error: currentTableChartError || "" };
  }
  return { svg: buildChartPreviewSvg(currentTableChart, kind, title, style), warnings: currentTableChart.warnings };
}

/** Refreshes the preview, info line, and warnings for the loaded table. */
function updatePptPreview(): void {
  if (!currentTableRows) {
    pptInfo.textContent = "";
    pptPreview.innerHTML = "";
    pptWarnings.textContent = "";
    pptWarnings.className = "seq-warnings";
    pptInsertFigBtn.disabled = true;
    pptInsertTableBtn.disabled = true;
    pptDownloadBtn.disabled = true;
    return;
  }
  // A Word table can always be inserted once a table has been read.
  pptInsertTableBtn.disabled = false;
  const chart = currentTableChart;
  pptInfo.textContent = chart
    ? `${chart.series.length} series (${chart.series.map((s) => s.name).join(", ")}) × ${chart.categories.length} categories`
    : `${currentTableRows.length} row(s) × ${currentTableRows[0].length} column(s)`;

  const rendered = renderTableGraphic();
  if (rendered.svg === null) {
    pptPreview.innerHTML = "";
    pptWarnings.className = "seq-warnings warn";
    pptWarnings.textContent = `${rendered.error} Switch “Show as” to Flowchart or Block diagram for text tables.`.trim();
    pptInsertFigBtn.disabled = true;
    pptDownloadBtn.disabled = true;
    return;
  }
  pptPreview.innerHTML = rendered.svg;
  pptWarnings.className = rendered.warnings.length ? "seq-warnings warn" : "seq-warnings";
  pptWarnings.textContent = rendered.warnings.join(" ");
  pptInsertFigBtn.disabled = false;
  pptDownloadBtn.disabled = false;
}

/** Inserts the previewed graphic into the document as a figure at the cursor. */
async function insertTableFigure(): Promise<void> {
  const rendered = renderTableGraphic();
  if (rendered.svg === null) return;
  pptInsertFigBtn.disabled = true;
  setStatus("Inserting figure…");
  try {
    const style = currentChartStyle();
    const kind = pptKindSelect.value as RenderKind;
    const d = readSvgDims(rendered.svg, 380, 260);
    // Rasterize at 2× and set the picture back to natural size (points =
    // px × 0.75) so the figure prints crisply.
    const base64 = await svgToPngBase64(rendered.svg, d.w * 2, d.h * 2);
    const kindLabel = kind === "tablefigure" ? "table figure" : kind;
    const alt = `${style.figLabel ? style.figLabel + " — " : ""}${kindLabel} of table (${currentTableRows?.length ?? 0} rows)${style.patent ? ", patent line-art style" : ""}`;
    const alsoText = pptWithTextCheckbox.checked && !!currentTableRows;
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      picture.altTextDescription = alt;
      picture.width = d.w * 0.75;
      picture.height = d.h * 0.75;
      // Optionally follow the image with an editable Word table of the data,
      // so the text is editable even though the figure itself is an image.
      let tail = picture.getRange(Word.RangeLocation.end);
      let dataTable: Word.Table | null = null;
      if (alsoText) {
        const para = tail.insertParagraph("", Word.InsertLocation.after);
        dataTable = insertFormattedWordTable(para.getRange(Word.RangeLocation.after), currentTableRows as string[][]);
        tail = dataTable.getRange(Word.RangeLocation.after);
      }
      tail.select(Word.SelectionMode.end);
      await context.sync();
      if (dataTable) await clearTableListFormatting(context, dataTable);
      await tagInserted(context, picture.getRange(), "formula-inserter:tablechart");
    });
    setStatus(alsoText ? "Figure + editable table inserted." : "Figure inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert the figure: ${(error as Error).message}`, "error");
  } finally {
    pptInsertFigBtn.disabled = false;
  }
}

/**
 * Inserts a formatted, editable Word table after `anchor` and returns it —
 * header row and section-band rows bolded and shaded, numeric columns
 * right-aligned. Only queues operations; the caller syncs.
 */
function insertFormattedWordTable(anchor: Word.Range, rows: string[][]): Word.Table {
  const prepared = prepareTableFigure(rows);
  const grid = prepared.grid;
  const nRows = grid.length;
  const nCols = nRows ? grid[0].length : 0;
  if (!nRows || !nCols) throw new Error("The table is empty.");
  // Band rows are all-empty in the prepared grid (the section text lives in
  // bandText) — put the section text back into the first cell for insertion.
  const insertGrid = grid.map((r, i) => (prepared.kinds[i] === "band" ? [prepared.bandText[i], ...r.slice(1)] : r));
  const table = anchor.insertTable(nRows, nCols, Word.InsertLocation.after, insertGrid);
  for (let i = 0; i < nRows; i++) {
    const kind = prepared.kinds[i];
    for (let j = 0; j < nCols; j++) {
      const cell = table.getCell(i, j);
      if (kind === "header") {
        cell.body.font.bold = true;
        cell.shadingColor = "#E7EEF6";
      } else if (kind === "band") {
        cell.body.font.bold = true;
        cell.shadingColor = "#DBE6F2";
      } else if (prepared.numericCol[j]) {
        cell.body.paragraphs.getFirst().alignment = Word.Alignment.right;
      }
    }
  }
  return table;
}

/**
 * Removes any list/auto-numbering the inserted table cells inherited from the
 * surrounding paragraph (e.g. when the cursor sat in a numbered list), which
 * otherwise shows a "1." etc. in every cell. Sets each cell paragraph to
 * Normal and detaches it from any list.
 */
async function clearTableListFormatting(context: Word.RequestContext, table: Word.Table): Promise<void> {
  const paras = table.getRange().paragraphs;
  paras.load("items");
  await context.sync();
  for (const p of paras.items) p.styleBuiltIn = Word.BuiltInStyleName.normal;
  await context.sync();
  const listFlags = paras.items.map((p) => {
    const li = p.listItemOrNullObject;
    li.load("isNullObject");
    return li;
  });
  await context.sync();
  let detached = false;
  paras.items.forEach((p, i) => {
    if (!listFlags[i].isNullObject) {
      p.detachFromList();
      detached = true;
    }
  });
  if (detached) await context.sync();
}

/** Inserts the read table as a native, fully-editable Word table at the cursor. */
async function insertEditableWordTable(): Promise<void> {
  if (!currentTableRows) return;
  pptInsertTableBtn.disabled = true;
  setStatus("Inserting editable table…");
  try {
    const figLabel = pptFigLabelInput.value.trim();
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const table = insertFormattedWordTable(range, currentTableRows as string[][]);
      let tail = table.getRange(Word.RangeLocation.after);
      if (figLabel) {
        const cap = tail.insertParagraph(figLabel, Word.InsertLocation.after);
        cap.alignment = Word.Alignment.centered;
        cap.styleBuiltIn = Word.BuiltInStyleName.normal;
        tail = cap.getRange(Word.RangeLocation.after);
      }
      tail.select(Word.SelectionMode.end);
      await context.sync();
      await clearTableListFormatting(context, table);
    });
    setStatus("Editable Word table inserted — the text can be edited normally.", "success");
  } catch (error) {
    setStatus(`Could not insert the table: ${(error as Error).message}`, "error");
  } finally {
    pptInsertTableBtn.disabled = false;
  }
}

/** Builds the .pptx (native chart or graphic + optional table slide) and downloads it. */
async function downloadPptx(): Promise<void> {
  const rendered = renderTableGraphic();
  if (rendered.svg === null || !currentTableRows) return;
  pptDownloadBtn.disabled = true;
  setStatus("Building the PowerPoint file…", "");
  try {
    // Lazy-loaded so PptxGenJS stays out of the main task-pane bundle.
    const { buildTablePptx } = await import(/* webpackChunkName: "ppt" */ "../lib/ppt");
    const style = currentChartStyle();
    const kind = pptKindSelect.value as RenderKind;

    // Flowcharts and block diagrams export as NATIVE, editable PowerPoint
    // shapes (boxes + connectors) so the labels stay editable.
    if (kind === "flowchart" || kind === "hierarchy") {
      const blob = await buildTablePptx(
        { categories: [], series: [], categoryLabel: "", hasHeader: false, rows: currentTableRows, warnings: [] },
        "column",
        {
          title: pptTitleInput.value,
          includeTable: false,
          diagramShapes: { kind, rows: currentTableRows, numerals: style.numerals ?? false, patent: style.patent ?? false },
        }
      );
      triggerDownload(blob, suggestPptFileName(pptTitleInput.value));
      setStatus("PowerPoint downloaded — the diagram is editable shapes.", "success");
      return;
    }

    // The table figure exports as a NATIVE, editable PowerPoint table (not a
    // picture), so the text stays editable.
    if (kind === "tablefigure") {
      const prepared = prepareTableFigure(currentTableRows);
      const blob = await buildTablePptx(
        { categories: [], series: [], categoryLabel: "", hasHeader: prepared.hasHeader, rows: currentTableRows, warnings: [] },
        "column",
        {
          title: pptTitleInput.value,
          includeTable: false,
          mainTable: { grid: prepared.grid, kinds: prepared.kinds, numericCol: prepared.numericCol },
        }
      );
      triggerDownload(blob, suggestPptFileName(pptTitleInput.value));
      setStatus("PowerPoint downloaded — the table is native and editable.", "success");
      return;
    }

    const picture = isPictureKind(kind);
    // Diagrams and the patent style ship as a picture of the same rendering
    // shown in the preview (PowerPoint has no native flowchart object, and its
    // charts can't draw hatching).
    let chartImage: { dataUrl: string; wPx: number; hPx: number } | undefined;
    if (picture || style.patent) {
      const d = readSvgDims(rendered.svg, 380, 260);
      const base64 = await svgToPngBase64(rendered.svg, d.w * 3, d.h * 3);
      chartImage = { dataUrl: `data:image/png;base64,${base64}`, wPx: d.w, hPx: d.h };
    }
    // For picture kinds the chart parse may not exist — the slide only needs
    // the picture plus the raw rows for the optional table slide.
    const chart: TableChart = currentTableChart ?? {
      categories: [],
      series: [],
      categoryLabel: "",
      hasHeader: false,
      rows: currentTableRows,
      warnings: [],
    };
    const blob = await buildTablePptx(chart, picture ? "column" : (kind as ChartKind), {
      title: pptTitleInput.value,
      includeTable: pptIncludeTable.checked,
      chartImage,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestPptFileName(pptTitleInput.value);
    a.click();
    URL.revokeObjectURL(url);
    setStatus("PowerPoint downloaded — check your Downloads folder.", "success");
  } catch (e) {
    setStatus(e instanceof Error ? e.message : "Couldn't build the PowerPoint file.", "error");
  } finally {
    pptDownloadBtn.disabled = false;
  }
}

/** Downloads a Blob under the given filename via a temporary link. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** "Q3 Sales!" → "q3-sales.pptx"; falls back to a generic name. */
function suggestPptFileName(title: string): string {
  const base = title
    .trim()
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return (base || "table-chart") + ".pptx";
}

// ---------------------------------------------------------------------------
// Botanical / plant
// ---------------------------------------------------------------------------

/** Live preview of the typeset scientific name. */
function updateBotanicalName(): void {
  const html = formatBotanicalNameHtml(botNameInput.value);
  botNamePreview.innerHTML = html || '<span class="hint">Type a scientific name to typeset its italics.</span>';
  botNameInsert.disabled = !html;
}

/** Inserts the typeset scientific name (with italics) at the selection. */
async function insertBotanicalName(): Promise<void> {
  const html = formatBotanicalNameHtml(botNameInput.value);
  if (!html) return;
  botNameInsert.disabled = true;
  setStatus("Inserting name…");
  try {
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      range.insertHtml(html, Word.InsertLocation.replace).select(Word.SelectionMode.end);
      await context.sync();
    });
    setStatus("Name inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert: ${(error as Error).message}`, "error");
  } finally {
    botNameInsert.disabled = false;
  }
}

/** Live preview of the varietal characteristics table. */
function updateTraitTable(): void {
  const html = formatTraitTableHtml(botTraitsInput.value);
  botTraitsPreview.innerHTML = html || '<span class="hint">One "Label: value" per line builds a table.</span>';
  botTraitsInsert.disabled = !html;
}

/** Inserts the varietal characteristics table at the selection. */
async function insertTraitTable(): Promise<void> {
  const html = formatTraitTableHtml(botTraitsInput.value);
  if (!html) return;
  botTraitsInsert.disabled = true;
  setStatus("Inserting table…");
  try {
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      range.insertHtml(html, Word.InsertLocation.replace).select(Word.SelectionMode.end);
      await context.sync();
    });
    setStatus("Characteristics table inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert: ${(error as Error).message}`, "error");
  } finally {
    botTraitsInsert.disabled = false;
  }
}

/** Attempts to render a 2D structure for the current input and shows it (or a hint). */
function updateStructurePreview(): void {
  const text = inputEl.value.trim();
  currentStructure = null;

  if (!text) {
    showStructureHint("Type a name, formula, or SMILES to see its structure.");
    return;
  }

  let result: ReturnType<typeof renderStructure> = null;
  try {
    result = renderStructure(text, STRUCTURE_W, STRUCTURE_H);
  } catch {
    result = null;
  }

  if (!result) {
    showStructureHint("No structure found. Try a common name (aspirin), a known formula (C6H6), or a SMILES string.");
    return;
  }

  currentStructure = result;
  structurePreviewEl.innerHTML = result.svg;
  renderStructureInfo(result.formula, result.mw, result.smiles);
  insertStructureBtn.disabled = false;

  // Dictionary name lookup (recognized compounds only).
  currentStructureName = nameForIdcode(result.idcode) ?? "";
  structureNameEl.textContent = currentStructureName ? `Name: ${currentStructureName}` : "";
  insertNameBtn.disabled = !currentStructureName;
}

/** Shows formula / MW / SMILES under the structure preview (provenance at a glance). */
function renderStructureInfo(formula: string, mw: number, smiles: string): void {
  structureInfo.replaceChildren();
  const bits: string[] = [];
  if (formula) bits.push(`Formula: ${formula}`);
  if (mw) bits.push(`MW: ${mw}`);
  if (smiles) bits.push(`SMILES: ${smiles}`);
  for (const b of bits) {
    const span = document.createElement("span");
    span.textContent = b;
    structureInfo.appendChild(span);
  }
}

function showStructureHint(message: string): void {
  structurePreviewEl.replaceChildren();
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = message;
  structurePreviewEl.appendChild(hint);
  structureInfo.replaceChildren();
  structureNameEl.textContent = "";
  currentStructureName = "";
  insertNameBtn.disabled = true;
  insertStructureBtn.disabled = true;
}

function setStatus(message: string, kind: "" | "error" | "success" = ""): void {
  statusEl.textContent = message;
  statusEl.className = kind ? `status ${kind}` : "status";
}

/** Builds machine-readable provenance for a structure's image alt-text. */
function provenanceAltText(label: string, formula: string, mw: number, smiles: string, idcode: string): string {
  const meta: string[] = [];
  if (formula) meta.push(formula);
  if (mw) meta.push(`MW ${mw}`);
  if (smiles) meta.push(`SMILES ${smiles}`);
  if (idcode) meta.push(`OCL-ID ${idcode}`);
  return meta.length ? `${label} — ${meta.join("; ")}` : label;
}

/** Inserts the formula at the selection — as a native equation, or as formatted text. */
async function insertFormula(): Promise<void> {
  const text = inputEl.value.trim();
  if (!text) {
    setStatus("Type a formula first.", "error");
    return;
  }

  // Math mode with the equation option checked: try OMML first, then fall back
  // to inline formatting if the expression can't be parsed into an equation.
  if (currentMode() === "math" && ommlCheckbox.checked) {
    const inserted = await insertEquation(text);
    if (inserted) return;
    setStatus("Couldn't build an equation from that — inserted as formatted text instead.", "error");
  }

  await insertFormattedText(text);
}

/**
 * Inserts the formula as formatted text by inserting the exact same <sub>/<sup>
 * HTML shown in the preview. Using insertHtml (rather than building runs
 * imperatively) keeps run boundaries and formatting deterministic, so the
 * inserted result always matches the preview.
 */
async function insertFormattedText(text: string): Promise<void> {
  const html = segmentsToHtml(parse(text, currentMode()));
  insertBtn.disabled = true;

  try {
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const inserted = range.insertHtml(html, Word.InsertLocation.replace);
      inserted.select(Word.SelectionMode.end);
      await context.sync();
    });
    setStatus("Inserted.", "success");
    recordInsert(currentMode() as HistoryKind, text, text);
  } catch (error) {
    setStatus(`Could not insert: ${(error as Error).message}`, "error");
  } finally {
    insertBtn.disabled = false;
  }
}

/**
 * Builds OMML from the input and inserts it as a native Word equation.
 * Returns true on success, false if the expression couldn't be parsed (so the
 * caller can fall back to formatted text).
 */
async function insertEquation(text: string): Promise<boolean> {
  // Reserve a number only if this expression actually parses (avoid gaps on failure).
  const numbered = numberCheckbox.checked;
  let ooxml: string;
  try {
    const label = numbered ? `(${toRoman(peekFormulaNumber())})` : undefined;
    ooxml = mathToOoxml(text, { number: label });
  } catch {
    return false; // parse error — caller falls back
  }

  insertBtn.disabled = true;
  setStatus("Inserting equation…");
  try {
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const inserted = range.insertOoxml(ooxml, Word.InsertLocation.replace);
      await context.sync();
      await tagInserted(context, inserted, "formula-inserter:equation");
    });
    if (numbered) {
      nextFormulaNumber(); // consume the number now that it's placed
      updateNumberLabel();
    }
    setStatus("Equation inserted.", "success");
    recordInsert("math", text, text);
    return true;
  } catch (error) {
    setStatus(`Could not insert equation: ${(error as Error).message}`, "error");
    return true; // a Word/runtime error is not a parse failure; don't double-insert
  } finally {
    insertBtn.disabled = false;
  }
}

/** Rasterizes the current structure SVG to a PNG and inserts it as an inline picture. */
async function insertStructure(): Promise<void> {
  const structure = currentStructure;
  if (!structure) {
    setStatus("No structure to insert.", "error");
    return;
  }

  insertStructureBtn.disabled = true;
  setStatus("Inserting structure…");

  try {
    const d = readSvgDims(structure.svg, STRUCTURE_W, STRUCTURE_H);
    const base64 = await svgToPngBase64(structure.svg, d.w, d.h);
    const label = inputEl.value.trim();
    const alt = provenanceAltText(
      `2D structure of ${label}`,
      structure.formula,
      structure.mw,
      structure.smiles,
      structure.idcode,
    );
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      picture.altTextDescription = alt;
      range.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, picture.getRange(), "formula-inserter:structure");
    });
    setStatus("Structure inserted.", "success");
    if (label) recordInsert("chemical", label, label);
  } catch (error) {
    setStatus(`Could not insert structure: ${(error as Error).message}`, "error");
  } finally {
    insertStructureBtn.disabled = false;
  }
}

/** Builds a molecule from the Build textarea and shows its structure, formula, and SMILES. */
function updateBuildPreview(): void {
  const text = buildInput.value;
  currentBuild = null;
  insertBuildBtn.disabled = true;

  if (!text.trim()) {
    buildPreviewEl.replaceChildren();
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "Enter an atom/bond list or paste a molfile to build a structure.";
    buildPreviewEl.appendChild(hint);
    buildFormulaEl.textContent = "—";
    buildSmilesEl.textContent = "—";
    renderRgroupInputs([]);
    setStatus("");
    return;
  }

  try {
    const format = buildFormatSelect.value as BuildFormat;
    const result = build(text, format, STRUCTURE_W, STRUCTURE_H);
    currentBuild = result;
    buildPreviewEl.innerHTML = result.svg;
    buildFormulaEl.textContent = result.formula + (result.mw ? ` (MW ${result.mw})` : "");
    buildSmilesEl.textContent = result.smiles || "—";
    renderRgroupInputs(result.rgroups);
    insertBuildBtn.disabled = false;
    setStatus("");
  } catch (error) {
    buildPreviewEl.replaceChildren();
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = (error as Error).message;
    buildPreviewEl.appendChild(hint);
    buildFormulaEl.textContent = "—";
    buildSmilesEl.textContent = "—";
    renderRgroupInputs([]);
  }
}

/** Builds one R-group definition row (main or nested sub-generic). */
function makeRgroupRow(label: string, isSub: boolean): HTMLElement {
  const row = document.createElement("div");
  row.className = isSub ? "rgroup-row rgroup-sub" : "rgroup-row";
  row.dataset.label = label;
  const lab = document.createElement("span");
  lab.className = "rgroup-label";
  lab.textContent = `${label} =`;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rgroup-input";
  input.placeholder = isSub
    ? "sub-group definition, e.g. halogen, hydroxy"
    : "e.g. H, C1-6 alkyl, opt sub phenyl, substituted with R1a, …";
  input.value = rgroupValues[label] || "";
  input.addEventListener("input", () => {
    rgroupValues[label] = input.value;
    syncSubGroups();
  });
  row.append(lab, input);
  return row;
}

/** Sub-generic R-group labels referenced (transitively) from the main definitions. */
function collectSubGroups(): string[] {
  const known: Record<string, true> = {};
  for (const l of mainRgroups) known[l] = true;
  const subs: string[] = [];
  let frontier = mainRgroups.slice();
  // Bounded depth guards against a definition that references itself in a cycle.
  for (let depth = 0; depth < 5 && frontier.length; depth++) {
    const next: string[] = [];
    for (const label of frontier) {
      for (const ref of referencedRGroups(rgroupValues[label] || "")) {
        if (!known[ref]) {
          known[ref] = true;
          subs.push(ref);
          next.push(ref);
        }
      }
    }
    frontier = next;
  }
  return subs;
}

/** Reconciles the sub-group input rows with the labels currently referenced,
 *  adding/removing rows in place so focus and caret are preserved while typing. */
function syncSubGroups(): void {
  if (!subGroupWrap) return;
  const subs = collectSubGroups();
  // Prune stored values that are neither a current main group nor a live sub-group.
  const valid: Record<string, true> = {};
  for (const l of mainRgroups) valid[l] = true;
  for (const l of subs) valid[l] = true;
  for (const key of Object.keys(rgroupValues)) {
    if (!valid[key]) delete rgroupValues[key];
  }
  const existing: Record<string, HTMLElement> = {};
  for (const child of Array.from(subGroupWrap.children)) {
    const el = child as HTMLElement;
    if (el.dataset.label) existing[el.dataset.label] = el;
  }
  for (const label of Object.keys(existing)) {
    if (subs.indexOf(label) < 0) {
      subGroupWrap.removeChild(existing[label]);
      delete existing[label];
    }
  }
  for (const label of subs) {
    if (!existing[label]) subGroupWrap.appendChild(makeRgroupRow(label, true));
  }
}

/** Renders one definition input per R-group present in the built structure. */
function renderRgroupInputs(rgroups: string[]): void {
  buildRgroupsEl.replaceChildren();
  mainRgroups = rgroups.slice();
  subGroupWrap = null;
  if (!rgroups.length) {
    // No R-groups: drop every stored definition (sub-groups exist only via mains).
    for (const key of Object.keys(rgroupValues)) delete rgroupValues[key];
    return;
  }
  // Drop values for main R-groups no longer present (keep referenced sub-groups).
  for (const label of rgroups) {
    buildRgroupsEl.appendChild(makeRgroupRow(label, false));
  }

  subGroupWrap = document.createElement("div");
  subGroupWrap.className = "rgroup-subs";
  buildRgroupsEl.appendChild(subGroupWrap);
  syncSubGroups();

  // Legend insertion format: an inline "where R1 = …" line or a structured table.
  const fmtRow = document.createElement("div");
  fmtRow.className = "legend-format";
  const fmtLab = document.createElement("span");
  fmtLab.className = "rgroup-label";
  fmtLab.textContent = "Insert as";
  fmtRow.appendChild(fmtLab);
  for (const [value, text] of [
    ["line", "Line"],
    ["table", "Table"],
  ] as const) {
    const id = `legend-fmt-${value}`;
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "legend-format";
    radio.id = id;
    radio.checked = legendFormat === value;
    radio.addEventListener("change", () => {
      if (radio.checked) legendFormat = value;
    });
    const radioLab = document.createElement("label");
    radioLab.className = "legend-format-label";
    radioLab.htmlFor = id;
    radioLab.textContent = text;
    fmtRow.append(radio, radioLab);
  }
  buildRgroupsEl.appendChild(fmtRow);
}

/** Collects the current R-group definitions (main groups first, then nested
 *  sub-groups in reference order) as raw legend entries. */
function currentLegendEntries(): LegendEntry[] {
  const labels = [...mainRgroups, ...collectSubGroups()];
  return labels.map((label) => ({ label, definition: rgroupValues[label] || "" }));
}

/** Inserts the built molecule's structure as an inline picture, plus an R-group legend if defined. */
async function insertBuild(): Promise<void> {
  const molecule = currentBuild;
  if (!molecule) {
    setStatus("Nothing built to insert.", "error");
    return;
  }

  insertBuildBtn.disabled = true;
  setStatus("Inserting structure…");

  try {
    const d = readSvgDims(molecule.svg, STRUCTURE_W, STRUCTURE_H);
    const base64 = await svgToPngBase64(molecule.svg, d.w, d.h);
    const label = molecule.formula || "molecule";
    const alt = provenanceAltText(`2D structure (${label})`, molecule.formula, molecule.mw, molecule.smiles, molecule.idcode);
    const entries = currentLegendEntries();
    const legendLine = buildLegendText(entries);
    const legendTable = legendFormat === "table" ? buildLegendTableHtml(entries) : "";
    const hasLegend = legendFormat === "table" ? !!legendTable : !!legendLine;
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      picture.altTextDescription = alt;
      const tail = picture.getRange(Word.RangeLocation.end);
      if (legendFormat === "table" && legendTable) {
        const para = tail.insertParagraph("", Word.InsertLocation.after);
        para.getRange().insertHtml(legendTable, Word.InsertLocation.replace);
      } else if (legendLine) {
        tail.insertParagraph(legendLine, Word.InsertLocation.after).getRange().select(Word.SelectionMode.end);
      } else {
        tail.select(Word.SelectionMode.end);
      }
      await context.sync();
      await tagInserted(context, picture.getRange(), "formula-inserter:structure");
    });
    setStatus(hasLegend ? "Structure + R-group legend inserted." : "Structure inserted.", "success");
    recordInsert("build", buildInput.value, label);
  } catch (error) {
    setStatus(`Could not insert structure: ${(error as Error).message}`, "error");
  } finally {
    insertBuildBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Reference-numeral management
// ---------------------------------------------------------------------------

const NUMERALS_SETTING = "formula-inserter.numerals";

/** Loads the numeral table from this document's settings (best-effort). */
function loadNumerals(): void {
  try {
    const raw = Office.context.document.settings.get(NUMERALS_SETTING) as string | null;
    const parsed = raw ? JSON.parse(raw) : [];
    numeralEntries = Array.isArray(parsed)
      ? parsed
          .filter((e) => e && Number.isFinite(e.numeral) && typeof e.element === "string")
          .map((e) => ({ numeral: Math.floor(e.numeral), element: e.element }))
      : [];
  } catch {
    numeralEntries = [];
  }
}

/** Persists the numeral table into this document's settings (best-effort). */
function saveNumerals(): void {
  try {
    Office.context.document.settings.set(NUMERALS_SETTING, JSON.stringify(numeralEntries));
    Office.context.document.settings.saveAsync();
  } catch {
    // Settings unavailable (e.g. unsupported host) — table stays in memory only.
  }
}

/** Builds one editable numeral row: numeral input, element input, insert + remove. */
function makeNumeralRow(entry: NumeralEntry, idx: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "num-row";

  const numInput = document.createElement("input");
  numInput.type = "number";
  numInput.min = "1";
  numInput.className = "rgroup-input num-numeral";
  numInput.value = String(entry.numeral);
  numInput.setAttribute("aria-label", "Reference numeral");
  numInput.addEventListener("input", () => {
    const n = parseInt(numInput.value, 10);
    numeralEntries[idx].numeral = Number.isFinite(n) ? n : 0;
    saveNumerals();
  });

  const eltInput = document.createElement("input");
  eltInput.type = "text";
  eltInput.className = "rgroup-input";
  eltInput.placeholder = "element name, e.g. housing";
  eltInput.value = entry.element;
  eltInput.setAttribute("aria-label", "Element name");
  eltInput.addEventListener("input", () => {
    numeralEntries[idx].element = eltInput.value;
    saveNumerals();
  });

  const insertBtn = document.createElement("button");
  insertBtn.type = "button";
  insertBtn.className = "num-callout-btn";
  insertBtn.textContent = "Insert";
  insertBtn.title = "Insert this callout at the cursor";
  insertBtn.addEventListener("click", () => insertCallout(idx));

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "num-remove-btn";
  removeBtn.textContent = "×";
  removeBtn.title = "Remove this numeral";
  removeBtn.setAttribute("aria-label", "Remove numeral");
  removeBtn.addEventListener("click", () => {
    numeralEntries.splice(idx, 1);
    renderNumeralRows();
    saveNumerals();
  });

  row.append(numInput, eltInput, insertBtn, removeBtn);
  return row;
}

/** Re-renders all numeral rows from the in-memory table. */
function renderNumeralRows(): void {
  numListEl.replaceChildren();
  if (!numeralEntries.length) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "No reference numerals yet. Add one to start the table.";
    numListEl.appendChild(hint);
    return;
  }
  numeralEntries.forEach((entry, idx) => numListEl.appendChild(makeNumeralRow(entry, idx)));
}

/** Appends a new numeral row with a suggested next number and focuses it. */
function addNumeral(): void {
  numeralEntries.push({ numeral: suggestNextNumeral(numeralEntries), element: "" });
  renderNumeralRows();
  saveNumerals();
  const last = numListEl.querySelector<HTMLInputElement>(".num-row:last-child .rgroup-input:not(.num-numeral)");
  last?.focus();
}

/** Inserts a single "element (numeral)" callout at the selection. */
async function insertCallout(idx: number): Promise<void> {
  const entry = numeralEntries[idx];
  if (!entry || !entry.numeral) {
    setStatus("Give this row a numeral first.", "error");
    return;
  }
  const text = formatCallout(entry.element, entry.numeral, numParensCheckbox.checked);
  try {
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const inserted = range.insertText(text, Word.InsertLocation.replace);
      inserted.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, inserted, `formula-inserter:callout:${entry.numeral}`);
    });
    setStatus(`Inserted “${text}”.`, "success");
  } catch (error) {
    setStatus(`Could not insert callout: ${(error as Error).message}`, "error");
  }
}

/** Reads the document body, reconciles it with the table, and shows findings. */
async function scanDocumentNumerals(): Promise<void> {
  numScanBtn.disabled = true;
  setStatus("Scanning document…");
  try {
    await Word.run(async (context) => {
      const body = context.document.body;
      body.load("text");
      await context.sync();
      const docNumerals = extractNumerals(body.text);
      renderNumeralFindings(reconcileNumerals(numeralEntries, docNumerals), docNumerals.length);
    });
    setStatus("Scan complete.", "success");
  } catch (error) {
    setStatus(`Could not scan the document: ${(error as Error).message}`, "error");
  } finally {
    numScanBtn.disabled = false;
  }
}

/** Renders the reconciliation report into the findings panel. */
function renderNumeralFindings(
  findings: ReturnType<typeof reconcileNumerals>,
  calloutCount: number,
): void {
  numFindingsEl.classList.remove("ok", "error");
  if (findings.ok) {
    numFindingsEl.classList.add("ok");
    numFindingsEl.textContent = `✓ No issues. ${calloutCount} parenthesized callout${
      calloutCount === 1 ? "" : "s"
    } found, all consistent with the table.`;
    return;
  }
  const items: string[] = [];
  for (const c of findings.collisions) {
    items.push(`Numeral (${c.numeral}) is reused for: ${c.elements.map(esc).join(", ")}`);
  }
  if (findings.gaps.length) {
    items.push(`Skipped numeral${findings.gaps.length === 1 ? "" : "s"}: ${findings.gaps.join(", ")}`);
  }
  if (findings.orphans.length) {
    items.push(
      `Called out but not defined: ${findings.orphans.map((n) => `(${n})`).join(", ")}`,
    );
  }
  if (findings.unused.length) {
    items.push(
      `Defined but never called out: ${findings.unused
        .map((e) => `(${e.numeral})${e.element ? " " + esc(e.element) : ""}`)
        .join(", ")}`,
    );
  }
  numFindingsEl.classList.add("error");
  numFindingsEl.innerHTML =
    `<strong>${items.length} issue${items.length === 1 ? "" : "s"} found</strong>` +
    `<ul>${items.map((t) => `<li>${t}</li>`).join("")}</ul>`;
}

/** Inserts a "List of Reference Numerals" heading + table at the selection. */
async function insertNumeralList(): Promise<void> {
  const html = buildNumeralListHtml(numeralEntries);
  if (!html) {
    setStatus("Define at least one numeral (with an element name) first.", "error");
    return;
  }
  numInsertListBtn.disabled = true;
  setStatus("Inserting list…");
  try {
    await Word.run(async (context) => {
      const sel = context.document.getSelection();
      const heading = sel.insertParagraph(NUMERAL_LIST_HEADING, Word.InsertLocation.before);
      try {
        heading.styleBuiltIn = Word.BuiltInStyleName.heading2;
      } catch {
        // Style not available on this build — leave default paragraph styling.
      }
      const tablePara = sel.insertParagraph("", Word.InsertLocation.before);
      const tableRange = tablePara.getRange().insertHtml(html, Word.InsertLocation.replace);
      await context.sync();
      await tagInserted(context, tableRange, "formula-inserter:numeral-list");
    });
    setStatus("List of Reference Numerals inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert the list: ${(error as Error).message}`, "error");
  } finally {
    numInsertListBtn.disabled = false;
  }
}

/** Minimal HTML escape for findings text. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// DNA / RNA analysis
// ---------------------------------------------------------------------------

/** Recomputes the live DNA readouts (stats, strands, translation) from the input. */
function updateDnaPreview(): void {
  const { seq, invalid } = cleanDna(dnaInput.value);

  if (!seq) {
    dnaReadout.textContent = invalid.length ? `Ignored invalid: ${invalid.join(" ")}` : "";
    dnaStats.replaceChildren();
    dnaRevcompEl.textContent = "";
    dnaMrnaEl.textContent = "";
    dnaProteinEl.textContent = "";
    dnaTm.textContent = "";
    dnaProteinProps.textContent = "";
    dnaRevcompInsert.disabled = true;
    dnaMrnaInsert.disabled = true;
    dnaProteinInsert.disabled = true;
    return;
  }

  const stats = baseStats(seq);
  dnaReadout.textContent = `${stats.length} nt${invalid.length ? ` · ignored invalid: ${invalid.join(" ")}` : ""}`;
  dnaStats.innerHTML =
    `<span><strong>GC:</strong> ${stats.gcPercent.toFixed(1)}%</span>` +
    `<span><strong>A</strong> ${stats.a} · <strong>C</strong> ${stats.c} · <strong>G</strong> ${stats.g} · <strong>T/U</strong> ${stats.t}` +
    `${stats.other ? ` · <strong>other</strong> ${stats.other}` : ""}</span>`;

  dnaRevcompEl.textContent = reverseComplement(seq);
  dnaMrnaEl.textContent = transcribe(seq);

  // Translation honors the chosen frame; negative frames use the reverse strand.
  const raw = parseInt(dnaFrameSelect.value, 10);
  const reverse = raw < 0;
  const frame = (Math.abs(raw) as 1 | 2 | 3) || 1;
  const source = reverse ? reverseComplement(seq) : seq;
  const protein = translate(source, { frame, stopAtStop: dnaStopCheckbox.checked });
  dnaProteinEl.textContent = protein || "(no residues in this frame)";

  // Tools readouts: primer Tm of the input, and properties of the translated protein.
  const tm = primerTm(seq);
  dnaTm.textContent = `Primer Tm ≈ ${tm.tm.toFixed(1)} °C · ${tm.gcPercent.toFixed(0)}% GC · ${tm.length} nt`;
  const props = proteinProperties(protein);
  dnaProteinProps.textContent = props.length
    ? `Protein (this frame): ${props.length} aa · MW ${props.mw.toLocaleString("en-US")} Da · pI ${props.pI} · GRAVY ${props.gravy.toFixed(2)}`
    : "";

  dnaRevcompInsert.disabled = false;
  dnaMrnaInsert.disabled = false;
  dnaProteinInsert.disabled = !protein;
}

/** Scans the sequence for common restriction sites and renders them. */
function findRestrictionSites(): void {
  const { seq } = cleanDna(dnaInput.value);
  if (!seq) {
    setStatus("Enter a DNA sequence first.", "error");
    return;
  }
  const hits = restrictionSites(seq);
  if (!hits.length) {
    dnaRestrictResults.innerHTML = '<span class="hint">No common restriction sites found.</span>';
    return;
  }
  const cell = 'style="border:1px solid #000;padding:2px 8px;"';
  const rows = hits
    .map((h) => `<tr><td ${cell}>${esc(h.enzyme)}</td><td ${cell}>${h.site}</td><td ${cell}>${h.positions.join(", ")}</td></tr>`)
    .join("");
  dnaRestrictResults.innerHTML =
    '<table style="border-collapse:collapse;"><tr>' +
    `<td ${cell}><strong>Enzyme</strong></td><td ${cell}><strong>Site</strong></td><td ${cell}><strong>Positions</strong></td></tr>` +
    rows +
    "</table>";
  setStatus(`Found ${hits.length} enzyme${hits.length === 1 ? "" : "s"} with sites.`, "success");
}

/** Inserts a plain-text DNA result (reverse complement, mRNA, or protein). */
async function insertDnaText(text: string, label: string): Promise<void> {
  if (!text.trim()) {
    setStatus(`Nothing to insert for ${label.toLowerCase()}.`, "error");
    return;
  }
  try {
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      range.insertText(text, Word.InsertLocation.replace);
      range.select(Word.SelectionMode.end);
      await context.sync();
    });
    setStatus(`${label} inserted.`, "success");
  } catch (error) {
    setStatus(`Could not insert ${label.toLowerCase()}: ${(error as Error).message}`, "error");
  }
}

/** Runs the six-frame ORF finder and renders the results table. */
function findOrfsHandler(): void {
  const { seq } = cleanDna(dnaInput.value);
  if (!seq) {
    setStatus("Enter a DNA/RNA sequence first.", "error");
    return;
  }
  const minAa = Math.max(1, parseInt(dnaOrfMin.value, 10) || 1);
  currentOrfs = findOrfs(seq, { minAa });
  if (!currentOrfs.length) {
    dnaOrfResults.innerHTML = `<span class="hint">No ORFs ≥ ${minAa} aa found in any of the six frames.</span>`;
    dnaOrfInsert.disabled = true;
    return;
  }
  dnaOrfResults.innerHTML = buildOrfTableHtml(currentOrfs);
  dnaOrfInsert.disabled = false;
  setStatus(`Found ${currentOrfs.length} ORF${currentOrfs.length === 1 ? "" : "s"}.`, "success");
}

/** Inserts the most recent ORF results as a Word table. */
async function insertOrfTable(): Promise<void> {
  const html = buildOrfTableHtml(currentOrfs);
  if (!html) {
    setStatus("Run Find ORFs first.", "error");
    return;
  }
  dnaOrfInsert.disabled = true;
  setStatus("Inserting ORF table…");
  try {
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const inserted = range.insertHtml(html, Word.InsertLocation.replace);
      inserted.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, inserted, "formula-inserter:orf-table");
    });
    setStatus("ORF table inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert the ORF table: ${(error as Error).message}`, "error");
  } finally {
    dnaOrfInsert.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Reaction schemes
// ---------------------------------------------------------------------------

const REACTION_CW = 130;
const REACTION_CH = 110;

/** Renders each component and composes the live reaction-scheme preview. */
function updateReactionPreview(): void {
  currentReactionSvg = null;
  reactionInsertBtn.disabled = true;
  const text = reactionInput.value.trim();
  if (!text) {
    reactionPreviewEl.replaceChildren();
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "Enter a reaction, e.g. CCO + CC(=O)O >> CC(=O)OCC ; H2SO4 ; reflux";
    reactionPreviewEl.appendChild(hint);
    return;
  }
  const spec = parseReaction(text);
  if (!spec.stages.length) {
    reactionPreviewEl.innerHTML = '<span class="hint">Add at least one component.</span>';
    return;
  }
  const failed: string[] = [];
  const render = (src: string): Rendered | null => {
    const r = renderStructure(src, REACTION_CW, REACTION_CH);
    if (!r) {
      failed.push(src);
      return null;
    }
    const d = readSvgDims(r.svg, REACTION_CW, REACTION_CH);
    return { svg: r.svg, width: d.w, height: d.h };
  };
  const stages: Rendered[][] = spec.stages.map((stage) =>
    stage.map(render).filter((x): x is Rendered => x !== null),
  );
  if (failed.length) {
    reactionPreviewEl.innerHTML = `<span class="hint">Couldn't draw: ${esc(failed.join(", "))}. Use a name or SMILES.</span>`;
    return;
  }
  const svg = composeReactionScheme(stages, { over: spec.over, under: spec.under });
  const dims = svg.match(/width="(\d+)" height="(\d+)"/);
  reactionPreviewEl.innerHTML = svg;
  currentReactionSvg = {
    svg,
    width: dims ? parseInt(dims[1], 10) : 400,
    height: dims ? parseInt(dims[2], 10) : 120,
  };
  reactionInsertBtn.disabled = false;
}

/** Rasterizes the reaction scheme and inserts it as an inline picture. */
async function insertReaction(): Promise<void> {
  if (!currentReactionSvg) {
    setStatus("Nothing to insert.", "error");
    return;
  }
  reactionInsertBtn.disabled = true;
  setStatus("Inserting reaction scheme…");
  try {
    const { svg, width, height } = currentReactionSvg;
    const base64 = await svgToPngBase64(svg, width, height);
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      picture.altTextDescription = `Reaction scheme: ${reactionInput.value.trim()}`;
      range.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, picture.getRange(), "formula-inserter:reaction");
    });
    setStatus("Reaction scheme inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert reaction scheme: ${(error as Error).message}`, "error");
  } finally {
    reactionInsertBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Document audit + SEQ ID references
// ---------------------------------------------------------------------------

/** Reads the document and runs the full consistency audit. */
async function runAudit(): Promise<void> {
  auditRunBtn.disabled = true;
  setStatus("Checking the application…");
  try {
    await Word.run(async (context) => {
      const body = context.document.body;
      body.load("text");
      await context.sync();
      const report = auditDocument({
        documentText: body.text,
        numerals: numeralEntries,
        listingCount: readSequenceEntries().length,
      });
      renderAuditReport(report);
    });
    setStatus("Audit complete.", "success");
  } catch (error) {
    setStatus(`Could not run the audit: ${(error as Error).message}`, "error");
  } finally {
    auditRunBtn.disabled = false;
  }
}

/** Renders the audit report grouped by section. */
function renderAuditReport(report: AuditReport): void {
  const blocks = report.sections.map((s) => {
    if (!s.issues.length) {
      return `<div class="audit-block ok"><strong>✓ ${esc(s.title)}</strong></div>`;
    }
    return (
      `<div class="audit-block error"><strong>${esc(s.title)} — ${s.issues.length} issue${
        s.issues.length === 1 ? "" : "s"
      }</strong><ul>${s.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`
    );
  });
  const header = report.ok
    ? '<div class="audit-summary ok">✓ No issues found.</div>'
    : `<div class="audit-summary error">${report.issueCount} issue${report.issueCount === 1 ? "" : "s"} across ${report.sections.filter((s) => s.issues.length).length} area(s).</div>`;
  auditResults.innerHTML = header + blocks.join("");
}

/** Inserts a canonical "SEQ ID NO: N" reference at the selection. */
async function insertSeqIdRef(): Promise<void> {
  const n = parseInt(seqRefNum.value, 10);
  if (!Number.isFinite(n) || n < 1) {
    setStatus("Enter a SEQ ID number ≥ 1.", "error");
    return;
  }
  await insertDnaText(formatSeqIdRef(n), "SEQ ID reference");
}

// ---------------------------------------------------------------------------
// Units & quantities
// ---------------------------------------------------------------------------

/** Live-typesets the quantity input. */
function updateUnitPreview(): void {
  const html = formatQuantityHtml(unitInput.value);
  if (!html) {
    unitPreview.innerHTML = '<span class="hint">Type a quantity, e.g. 9.81 m/s^2 or 5.0 +- 0.2 kg.</span>';
    unitInsertBtn.disabled = true;
    return;
  }
  unitPreview.innerHTML = html;
  unitInsertBtn.disabled = false;
}

/** Inserts the typeset quantity at the selection. */
async function insertQuantity(): Promise<void> {
  const html = formatQuantityHtml(unitInput.value);
  if (!html) {
    setStatus("Enter a quantity first.", "error");
    return;
  }
  unitInsertBtn.disabled = true;
  setStatus("Inserting quantity…");
  try {
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const inserted = range.insertHtml(html, Word.InsertLocation.replace);
      inserted.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, inserted, "formula-inserter:quantity");
    });
    setStatus("Quantity inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert quantity: ${(error as Error).message}`, "error");
  } finally {
    unitInsertBtn.disabled = false;
  }
}

/** Converts the value between the two units and shows the result. */
function doConvert(): void {
  currentConvHtml = "";
  convInsertBtn.disabled = true;
  const value = parseFloat(convValue.value);
  if (!Number.isFinite(value)) {
    convResult.textContent = "Enter a numeric value.";
    return;
  }
  const from = convFrom.value.trim();
  const to = convTo.value.trim();
  if (!from || !to) {
    convResult.textContent = "Enter both units.";
    return;
  }
  const r = convert(value, from, to);
  if (r === null) {
    convResult.textContent = `Can't convert ${from} → ${to} (unknown or incompatible units).`;
    return;
  }
  currentConvHtml = formatQuantityHtml(`${formatSig(r)} ${to}`);
  convResult.innerHTML = `${formatQuantityHtml(`${value} ${from}`)} = <strong>${currentConvHtml}</strong>`;
  convInsertBtn.disabled = false;
}

/** Inserts the conversion result at the selection. */
async function insertConversion(): Promise<void> {
  if (!currentConvHtml) {
    setStatus("Run a conversion first.", "error");
    return;
  }
  convInsertBtn.disabled = true;
  setStatus("Inserting result…");
  try {
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const inserted = range.insertHtml(currentConvHtml, Word.InsertLocation.replace);
      inserted.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, inserted, "formula-inserter:quantity");
    });
    setStatus("Result inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert result: ${(error as Error).message}`, "error");
  } finally {
    convInsertBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Captions & cross-references
// ---------------------------------------------------------------------------

const REFS_SETTING = "formula-inserter.refs";

/** Loads per-document caption counters (best-effort). */
function loadRefCounters(): void {
  try {
    const raw = Office.context.document.settings.get(REFS_SETTING) as string | null;
    const p = raw ? JSON.parse(raw) : {};
    refCounters = {
      figure: Number.isFinite(p?.figure) && p.figure > 0 ? Math.floor(p.figure) : 1,
      table: Number.isFinite(p?.table) && p.table > 0 ? Math.floor(p.table) : 1,
    };
  } catch {
    refCounters = { figure: 1, table: 1 };
  }
}

/** Persists caption counters into document settings (best-effort). */
function saveRefCounters(): void {
  try {
    Office.context.document.settings.set(REFS_SETTING, JSON.stringify(refCounters));
    Office.context.document.settings.saveAsync();
  } catch {
    // best-effort
  }
}

/** Shows the next caption number for the selected kind. */
function updateRefNext(): void {
  const kind = refKind.value as RefKind;
  refNext.textContent = `next: ${formatCaption(kind, refCounters[kind])}`;
}

/** Resets the selected caption counter to 1. */
function resetRefCounter(): void {
  refCounters[refKind.value as RefKind] = 1;
  saveRefCounters();
  updateRefNext();
}

/** Inserts an auto-numbered caption paragraph and advances the counter. */
async function insertCaption(): Promise<void> {
  const kind = refKind.value as RefKind;
  const n = refCounters[kind];
  const text = formatCaption(kind, n, refCaptionText.value);
  refInsertCaption.disabled = true;
  setStatus("Inserting caption…");
  try {
    await Word.run(async (context) => {
      const sel = context.document.getSelection();
      const para = sel.insertParagraph(text, Word.InsertLocation.after);
      try {
        para.styleBuiltIn = Word.BuiltInStyleName.caption;
      } catch {
        // Caption style unavailable on this build — leave default styling.
      }
      para.getRange().select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, para.getRange(), `formula-inserter:caption:${kind}`);
    });
    refCounters[kind] = n + 1;
    saveRefCounters();
    updateRefNext();
    refCaptionText.value = "";
    setStatus(`Inserted "${formatCaption(kind, n)}".`, "success");
  } catch (error) {
    setStatus(`Could not insert caption: ${(error as Error).message}`, "error");
  } finally {
    refInsertCaption.disabled = false;
  }
}

/** Inserts an in-text cross-reference (Fig. / Table / Eq.). */
async function insertCrossRef(): Promise<void> {
  const kind = refXrefKind.value;
  const n = parseInt(refXrefNum.value, 10);
  if (!Number.isFinite(n) || n < 1) {
    setStatus("Enter a reference number ≥ 1.", "error");
    return;
  }
  const text = kind === "equation" ? formatEqRef(n) : formatRef(kind as RefKind, n);
  await insertDnaText(text, "Cross-reference");
}

/** Scans the document and reports caption-numbering issues. */
async function checkCaptionsHandler(): Promise<void> {
  refCheck.disabled = true;
  setStatus("Checking captions…");
  try {
    await Word.run(async (context) => {
      const body = context.document.body;
      body.load("text");
      await context.sync();
      renderRefFindings(checkCaptions(body.text, "figure"), checkCaptions(body.text, "table"));
    });
    setStatus("Check complete.", "success");
  } catch (error) {
    setStatus(`Could not check captions: ${(error as Error).message}`, "error");
  } finally {
    refCheck.disabled = false;
  }
}

/** Renders the caption-check findings. */
function renderRefFindings(
  fig: ReturnType<typeof checkCaptions>,
  tab: ReturnType<typeof checkCaptions>,
): void {
  const items: string[] = [];
  const add = (label: string, f: ReturnType<typeof checkCaptions>): void => {
    if (f.gaps.length) items.push(`${label}: missing ${f.gaps.join(", ")}`);
    if (f.duplicates.length) items.push(`${label}: duplicated ${f.duplicates.join(", ")}`);
  };
  add("Figures", fig);
  add("Tables", tab);
  refFindings.classList.remove("ok", "error");
  if (!items.length) {
    refFindings.classList.add("ok");
    refFindings.textContent = "✓ Caption numbering is consistent.";
    return;
  }
  refFindings.classList.add("error");
  refFindings.innerHTML =
    `<strong>${items.length} issue${items.length === 1 ? "" : "s"}</strong>` +
    `<ul>${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
}

// ---------------------------------------------------------------------------
// Plotting
// ---------------------------------------------------------------------------

/** Builds plot series from the function and/or data inputs. */
function buildPlotSeries(): { series: Series[]; error: string } {
  const series: Series[] = [];
  let error = "";
  const fnText = plotFn.value.trim();
  if (fnText) {
    const xmin = parseFloat(plotXmin.value);
    const xmax = parseFloat(plotXmax.value);
    if (!Number.isFinite(xmin) || !Number.isFinite(xmax) || xmax <= xmin) {
      error = "Set a valid x-range (from < to).";
    } else {
      // Multiple functions, separated by ";", each become a labeled line series.
      const fns = fnText.split(";").map((s) => s.trim()).filter(Boolean);
      for (const fn of fns) {
        try {
          series.push({ points: samplePlot(fn, xmin, xmax, 240), type: "line", label: fns.length > 1 ? fn : undefined });
        } catch {
          error = `Couldn't evaluate "${fn}" — check the expression.`;
        }
      }
    }
  }
  const data = parseData(plotData.value);
  if (data.length) series.push({ points: data, type: "scatter", label: series.length ? "data" : undefined });
  return { series, error };
}

/** Live-renders the plot preview. */
function updatePlotPreview(): void {
  currentPlotSvg = "";
  plotInsertBtn.disabled = true;
  const { series, error } = buildPlotSeries();
  if (error) {
    plotPreview.innerHTML = `<span class="hint">${esc(error)}</span>`;
    return;
  }
  if (!series.length) {
    plotPreview.innerHTML = '<span class="hint">Enter a function (e.g. sin(x)/x) or data points to plot.</span>';
    return;
  }
  const svg = buildPlotSvg(series, {
    title: plotTitle.value.trim(),
    xlabel: plotXlabel.value.trim(),
    ylabel: plotYlabel.value.trim(),
  });
  plotPreview.innerHTML = svg;
  currentPlotSvg = svg;
  plotInsertBtn.disabled = false;
}

/** Rasterizes the plot and inserts it as an inline picture. */
async function insertPlot(): Promise<void> {
  if (!currentPlotSvg) {
    setStatus("Nothing to plot yet.", "error");
    return;
  }
  plotInsertBtn.disabled = true;
  setStatus("Inserting plot…");
  try {
    const base64 = await svgToPngBase64(currentPlotSvg, 380, 270);
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      picture.altTextDescription = `Plot: ${plotFn.value.trim() || "data"}`;
      range.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, picture.getRange(), "formula-inserter:plot");
    });
    setStatus("Plot inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert plot: ${(error as Error).message}`, "error");
  } finally {
    plotInsertBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Finance calculators
// ---------------------------------------------------------------------------

interface FinField {
  key: string;
  label: string;
  default: string;
  kind?: "number" | "select" | "list";
  options?: { value: string; label: string }[];
}
interface FinCalc {
  id: string;
  name: string;
  fields: FinField[];
  compute: (read: (k: string) => string) => string;
}

function finMoney(x: number): string {
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function finPct(x: number): string {
  return (x * 100).toFixed(2) + "%";
}
function finList(s: string): number[] {
  return s
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

const FIN_CALCS: FinCalc[] = [
  {
    id: "fv",
    name: "Future value (TVM)",
    fields: [
      { key: "pv", label: "Present value", default: "1000" },
      { key: "rate", label: "Rate % per period", default: "5" },
      { key: "n", label: "Number of periods", default: "10" },
    ],
    compute: (r) => `FV = ${finMoney(futureValue(+r("pv"), +r("rate") / 100, +r("n")))}`,
  },
  {
    id: "pv",
    name: "Present value (TVM)",
    fields: [
      { key: "fv", label: "Future value", default: "1000" },
      { key: "rate", label: "Rate % per period", default: "5" },
      { key: "n", label: "Number of periods", default: "10" },
    ],
    compute: (r) => `PV = ${finMoney(presentValue(+r("fv"), +r("rate") / 100, +r("n")))}`,
  },
  {
    id: "compound",
    name: "Compound interest",
    fields: [
      { key: "p", label: "Principal", default: "1000" },
      { key: "rate", label: "Annual rate %", default: "5" },
      { key: "m", label: "Compounds / year", default: "12" },
      { key: "t", label: "Years", default: "10" },
    ],
    compute: (r) => `Amount = ${finMoney(compoundInterest(+r("p"), +r("rate") / 100, +r("m"), +r("t")))}`,
  },
  {
    id: "loan",
    name: "Loan payment",
    fields: [
      { key: "p", label: "Loan amount", default: "200000" },
      { key: "rate", label: "Annual rate %", default: "5" },
      { key: "t", label: "Years", default: "30" },
      { key: "m", label: "Payments / year", default: "12" },
    ],
    compute: (r) => {
      const m = +r("m");
      return `Payment = ${finMoney(loanPayment(+r("p"), +r("rate") / 100 / m, +r("t") * m))} per period`;
    },
  },
  {
    id: "npv",
    name: "Net present value",
    fields: [
      { key: "rate", label: "Discount rate % per period", default: "10" },
      { key: "cf", label: "Cash flows (t=0 first)", default: "-1000, 500, 500, 500", kind: "list" },
    ],
    compute: (r) => `NPV = ${finMoney(npv(+r("rate") / 100, finList(r("cf"))))}`,
  },
  {
    id: "irr",
    name: "Internal rate of return",
    fields: [{ key: "cf", label: "Cash flows (t=0 first)", default: "-1000, 500, 500, 500", kind: "list" }],
    compute: (r) => {
      const v = irr(finList(r("cf")));
      return v === null ? "IRR = no solution" : `IRR = ${finPct(v)}`;
    },
  },
  {
    id: "bs",
    name: "Black–Scholes option",
    fields: [
      {
        key: "type",
        label: "Type",
        default: "call",
        kind: "select",
        options: [
          { value: "call", label: "Call" },
          { value: "put", label: "Put" },
        ],
      },
      { key: "s", label: "Spot price S", default: "100" },
      { key: "k", label: "Strike K", default: "100" },
      { key: "t", label: "Time to expiry (years)", default: "1" },
      { key: "r", label: "Risk-free rate %", default: "5" },
      { key: "sig", label: "Volatility % (annual)", default: "20" },
    ],
    compute: (r) =>
      `Price = ${finMoney(blackScholes(r("type") as OptionType, +r("s"), +r("k"), +r("t"), +r("r") / 100, +r("sig") / 100))}`,
  },
  {
    id: "bond",
    name: "Bond price",
    fields: [
      { key: "face", label: "Face value", default: "1000" },
      { key: "coupon", label: "Coupon rate % (annual)", default: "5" },
      { key: "ytm", label: "Yield to maturity %", default: "6" },
      { key: "years", label: "Years to maturity", default: "10" },
      { key: "freq", label: "Coupons / year", default: "2" },
    ],
    compute: (r) =>
      `Price = ${finMoney(bondPrice(+r("face"), +r("coupon") / 100, +r("ytm") / 100, +r("years"), +r("freq")))}`,
  },
];

/** Fills the calculator dropdown. */
function populateFinanceCalcs(): void {
  finCalcSelect.replaceChildren();
  for (const c of FIN_CALCS) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    finCalcSelect.appendChild(opt);
  }
}

/** Builds the inputs for the selected calculator and wires live computation. */
function renderFinanceInputs(): void {
  const calc = FIN_CALCS.find((c) => c.id === finCalcSelect.value) ?? FIN_CALCS[0];
  finInputs.replaceChildren();
  for (const f of calc.fields) {
    const row = document.createElement("div");
    row.className = "dna-controls";
    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = f.label;
    label.htmlFor = `fin-f-${f.key}`;

    let input: HTMLInputElement | HTMLSelectElement;
    if (f.kind === "select") {
      const sel = document.createElement("select");
      sel.className = "lib-select";
      for (const o of f.options ?? []) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        sel.appendChild(opt);
      }
      sel.value = f.default;
      input = sel;
    } else {
      const text = document.createElement("input");
      text.type = "text";
      text.className = f.kind === "list" ? "rgroup-input" : "rgroup-input num-numeral";
      text.value = f.default;
      input = text;
    }
    input.id = `fin-f-${f.key}`;
    input.dataset.key = f.key;
    input.addEventListener("input", updateFinancePreview);
    input.addEventListener("change", updateFinancePreview);
    row.append(label, input);
    finInputs.appendChild(row);
  }
  updateFinancePreview();
}

/** Computes and shows the result for the current calculator inputs. */
function updateFinancePreview(): void {
  const calc = FIN_CALCS.find((c) => c.id === finCalcSelect.value) ?? FIN_CALCS[0];
  const read = (k: string): string => {
    const el = finInputs.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-key="${k}"]`);
    return el ? el.value : "";
  };
  // A blank number/list field would coerce to 0 and produce a misleading result —
  // require all non-select inputs to be filled before computing.
  if (calc.fields.some((f) => f.kind !== "select" && read(f.key).trim() === "")) {
    finResult.innerHTML = '<span class="hint">Enter all values to compute.</span>';
    finInsertBtn.disabled = true;
    currentFinText = "";
    return;
  }
  let text = "";
  try {
    text = calc.compute(read);
  } catch {
    text = "";
  }
  const insertable = !!text && !text.includes("—") && !text.includes("no solution");
  if (!text) {
    finResult.innerHTML = '<span class="hint">Enter values to compute.</span>';
  } else {
    finResult.textContent = text;
  }
  currentFinText = insertable ? text : "";
  finInsertBtn.disabled = !insertable;
}

// ---------------------------------------------------------------------------
// Legal citations (Bluebook)
// ---------------------------------------------------------------------------

/** Fills the citation-type and signal dropdowns. */
function populateCitationTypes(): void {
  citeTypeSelect.replaceChildren();
  for (const c of CITATIONS) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    citeTypeSelect.appendChild(opt);
  }
  citeSignalSelect.replaceChildren();
  for (const s of SIGNALS) {
    const opt = document.createElement("option");
    opt.value = s.value;
    opt.textContent = s.label;
    citeSignalSelect.appendChild(opt);
  }
}

/** Builds the input fields for the selected citation type. */
function renderCitationInputs(): void {
  const type = citationById(citeTypeSelect.value) ?? CITATIONS[0];
  citeInputs.replaceChildren();
  for (const f of type.fields) {
    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = f.optional ? `${f.label} (optional)` : f.label;
    label.htmlFor = `cite-f-${f.key}`;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "formula-input";
    input.id = `cite-f-${f.key}`;
    input.dataset.key = f.key;
    if (f.placeholder) input.placeholder = f.placeholder;
    input.autocomplete = "off";
    input.addEventListener("input", updateCitationPreview);

    citeInputs.append(label, input);
  }
  updateCitationPreview();
}

/** Parses a pasted messy citation and fills the form fields for review. */
function parseAndFillCitation(): void {
  const raw = citePasteInput.value.trim();
  if (!raw) {
    citeParseMsg.textContent = "Paste a citation first.";
    return;
  }
  const parsed = parseCitation(raw);
  if (!parsed) {
    citeParseMsg.className = "build-readout warn";
    citeParseMsg.textContent = "Couldn’t recognize that citation — pick a type below and fill it in manually.";
    return;
  }
  const type = citationById(parsed.typeId);
  citeTypeSelect.value = parsed.typeId;
  citeSignalSelect.value = parsed.signal;
  renderCitationInputs(); // rebuild fields for the detected type
  for (const [key, value] of Object.entries(parsed.fields)) {
    const el = citeInputs.querySelector<HTMLInputElement>(`[data-key="${key}"]`);
    if (el) el.value = value;
  }
  updateCitationPreview();
  citeParseMsg.className = "build-readout";
  citeParseMsg.textContent = `Detected: ${type?.name ?? parsed.typeId}. Review the fields, then insert.`;
}

/** Formats and previews the citation for the current inputs. */
function updateCitationPreview(): void {
  const type = citationById(citeTypeSelect.value) ?? CITATIONS[0];
  const read = (k: string): string => {
    const el = citeInputs.querySelector<HTMLInputElement>(`[data-key="${k}"]`);
    return el ? el.value.trim() : "";
  };
  currentCitation = null;
  citeInsertBtn.disabled = true;
  citeCopyBtn.disabled = true;

  const missing = type.fields.filter((f) => !f.optional && !read(f.key));
  if (missing.length) {
    citePreview.innerHTML = `<span class="hint">Fill in: ${missing.map((f) => esc(f.label)).join(", ")}.</span>`;
    return;
  }
  try {
    currentCitation = applySignal(citeSignalSelect.value, type.format(read));
  } catch {
    citePreview.innerHTML = '<span class="hint">Couldn’t format this citation — check the fields.</span>';
    return;
  }
  citePreview.innerHTML = currentCitation.html;
  citeInsertBtn.disabled = false;
  citeCopyBtn.disabled = false;
}

/** Inserts the formatted citation (with italics) at the selection. */
async function insertCitation(): Promise<void> {
  if (!currentCitation) return;
  const html = currentCitation.html;
  citeInsertBtn.disabled = true;
  setStatus("Inserting citation…");
  try {
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const inserted = range.insertHtml(html, Word.InsertLocation.replace);
      inserted.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, inserted, "formula-inserter:citation");
    });
    setStatus("Citation inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert citation: ${(error as Error).message}`, "error");
  } finally {
    citeInsertBtn.disabled = false;
  }
}

/** Copies the plain-text citation to the clipboard. */
async function copyCitation(): Promise<void> {
  if (!currentCitation) return;
  try {
    await navigator.clipboard.writeText(currentCitation.plain);
    setStatus("Citation copied to clipboard.", "success");
  } catch {
    setStatus("Clipboard unavailable — select the preview text to copy.", "");
  }
}

/**
 * Wraps an already-inserted, already-synced range in a hidden, tagged content
 * control so the artifact can be re-found and updated later (e.g. renumbering
 * callouts, refreshing a list). Best-effort and isolated in its own sync: if
 * content controls aren't supported on this build, the inserted content is left
 * exactly as-is. The "hidden" appearance keeps the document visually unchanged.
 */
async function tagInserted(context: Word.RequestContext, range: Word.Range, tag: string): Promise<void> {
  try {
    const cc = range.insertContentControl();
    cc.tag = tag;
    cc.title = "Formula Inserter";
    cc.appearance = Word.ContentControlAppearance.hidden;
    await context.sync();
  } catch {
    // Content controls unsupported here — the inserted content remains in place.
  }
}

/** Reads an SVG's intrinsic width/height (px), falling back to the given box. */
function readSvgDims(svg: string, fallbackW: number, fallbackH: number): { w: number; h: number } {
  const wm = svg.match(/\bwidth="([\d.]+)/);
  const hm = svg.match(/\bheight="([\d.]+)/);
  const w = wm ? parseFloat(wm[1]) : NaN;
  const h = hm ? parseFloat(hm[1]) : NaN;
  return { w: w > 0 ? w : fallbackW, h: h > 0 ? h : fallbackH };
}

/**
 * Converts an SVG string to a base64-encoded PNG (no data-URL prefix), which is
 * the format Word's insertInlinePictureFromBase64 expects. Uses an offscreen
 * canvas with a white background so transparent SVG areas don't render black.
 */
function svgToPngBase64(svg: string, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const svgBase64 = btoa(String.fromCharCode(...new TextEncoder().encode(svg)));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not supported.");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png").split(",")[1]);
      } catch (e) {
        reject(e as Error);
      }
    };
    img.onerror = () => reject(new Error("Could not rasterize the structure image."));
    img.src = `data:image/svg+xml;base64,${svgBase64}`;
  });
}
