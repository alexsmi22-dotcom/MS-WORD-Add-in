/* global Office, Word, document, localStorage, navigator, URL, Blob, HTMLInputElement, HTMLButtonElement, HTMLSelectElement, HTMLTextAreaElement, HTMLElement, Image, TextEncoder, btoa */

import { Segment, segmentsToHtml } from "../lib/segments";
import { parseChemical } from "../lib/chemParser";
import { validateFormula } from "../lib/chemValidate";
import { parseMath } from "../lib/mathFormat";
import { mathToOoxml } from "../lib/mathOmml";
import { mathToHtml } from "../lib/mathHtml";
import { parseMathAst } from "../lib/mathParse";
import { latexToDsl, astToLatex } from "../lib/latex";
import { formatQuantityHtml, convert, formatSig } from "../lib/units";
import { RefKind, formatCaption, formatRef, formatEqRef, checkCaptions } from "../lib/refs";
import { Series, Point, samplePlot, parseData, buildPlotSvg } from "../lib/plot";
import {
  fitMichaelisMenten,
  fitHill,
  fitDoseResponse,
  fitSaturationBinding,
  chengPrusoff,
  catalyticEfficiency,
  kcat,
  hendersonHasselbalch,
  beerLambert,
  stockVolumeNeeded,
  serialDilution,
  nucleicAcidConc,
  proteinConcFromA280,
  NucleicAcidKind,
} from "../lib/assay";
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
  effectiveAnnualRate,
  growingAnnuityPV,
  amortizationSchedule,
  dcf,
  xirr,
  bondYTM,
  bondAnalytics,
  blackScholesGreeks,
  impliedVolatility,
  decliningBalanceSchedule,
  annualizedReturn,
  annualizedVolatility,
  sharpeRatio,
} from "../lib/finance";
import { renderStructure, nameForIdcode, StructureResult } from "../lib/structures";
import { computeProperties, PhysChemProperties, RuleResult } from "../lib/properties";
import { predictPka, PkaResult } from "../lib/pka";
import { resolveNameOnline, OpsinResult } from "../lib/opsin";
import { computeMassSpec, MassSpecResult } from "../lib/massspec";
import { predictNmr, NmrResult, Nucleus } from "../lib/nmr";
import { predictIr, IrResult } from "../lib/ir";
import { predictUvVis, UvResult } from "../lib/uvvis";
import { predictFragments, FragmentResult } from "../lib/fragment";
import { nmrChartSvg, irChartSvg, msChartSvg, SPECTRUM_CHART_SIZE } from "../lib/spectraChart";
import { buildPeptide } from "../lib/peptide";
import {
  describe as statDescribe,
  twoSampleTTest,
  pairedTTest,
  oneWayAnova,
  linearRegression as statRegression,
  propagateUncertainty,
  reportT,
  reportF,
  formatP,
  evalFormula,
} from "../lib/stats";
import {
  mannWhitneyU,
  wilcoxonSignedRank,
  chiSquareGoodnessOfFit,
  chiSquareIndependence,
  twoWayAnova,
  adjustPValues,
  CorrectionMethod,
} from "../lib/stats2";
import { build, BuildFormat, BuildResult } from "../lib/builder";
import { formatCodeBlock, CodeStyle } from "../lib/codeblock";
import {
  buildSt26Xml,
  cleanResidues,
  featureWarnings,
  MolType,
  MOL_TYPE_OPTIONS,
  St26Feature,
  SequenceEntry,
  SequenceListingMeta,
} from "../lib/sequence";
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
import {
  CITATIONS,
  SIGNALS,
  citationById,
  applySignal,
  parseCitation,
  caseShortForm,
  abbreviateCaseName,
  isKnownReporter,
  CitationResult,
  CitationStyle,
} from "../lib/citations";
import {
  buildTableOfAuthorities,
  toaToHtml,
  toaStaticOoxml,
  findPrecedingAuthority,
  authoritiesForToa,
  taFieldOoxml,
  toaFieldsOoxml,
  tocFieldOoxml,
  citationRegister,
  CitationRegister,
  parseToaPages,
  toaEntryKey,
  isTaFieldCode,
  isTableFieldCode,
  findPrecedingSecondarySource,
} from "../lib/toa";
import {
  parseMatrix,
  multiply,
  transpose,
  trace,
  determinant,
  inverse,
  solve,
  rank,
  eigenSymmetric,
  eigenvaluesGeneral,
  qrDecompose,
  svd,
  formatMatrix,
  formatNum,
  formatComplex,
  rows as matRows,
  cols as matCols,
  Matrix,
} from "../lib/linalg";
import { analyzeData } from "../lib/insights";
import { parseDefinitions, evalMatrixExpression } from "../lib/matrixExpr";
import { nelderMead } from "../lib/optimize";
import { spectrum, dominantFrequencies } from "../lib/fft";
import { solveOde, OdeMethod, OdeEvent } from "../lib/ode";
import { parseOdeSystem, rewriteStateExpression, parseTimeList } from "../lib/odeParse";
import { isNewerVersion } from "../lib/version";

// Injected at build time (webpack DefinePlugin) from package.json.
declare const __APP_VERSION__: string;

type Mode =
  | "home"
  | "chemical"
  | "math"
  | "units"
  | "plot"
  | "ppt"
  | "finance"
  | "assay"
  | "massspec"
  | "spectra"
  | "peptide"
  | "stats"
  | "analyze"
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

let homeSection: HTMLElement;
let homeGroups: HTMLElement;
let searchWrap: HTMLElement | null;
let modeSelectWrap: HTMLElement | null;
let modeSelect: HTMLSelectElement;
let examplesPanel: HTMLElement | null;
let bottomDisclaimer: HTMLElement | null;
let inputEl: HTMLInputElement;
let previewEl: HTMLElement;
let chemValidateEl: HTMLElement;
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
let structurePropsEl: HTMLElement;
let insertPropsBtn: HTMLButtonElement;
/** Physicochemical properties of the most recently resolved structure. */
let currentProperties: PhysChemProperties | null = null;
/** Ionizable-group pKa estimate for the current structure. */
let currentPka: PkaResult | null = null;
let opsinBtn: HTMLButtonElement;
let opsinConfirm: HTMLElement;
let opsinConfirmText: HTMLElement;
let opsinContinueBtn: HTMLButtonElement;
let opsinCancelBtn: HTMLButtonElement;
let opsinStatusEl: HTMLElement;
/** Online-lookup consent is per-session (re-prompted each Word session) and the
 *  name awaiting confirmation, so the network call never fires without a click. */
let opsinConsentedThisSession = false;
let opsinPendingName = "";
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
let citeStyleSelect: HTMLSelectElement;
let citeSignalSelect: HTMLSelectElement;
let citeAbbrevCheckbox: HTMLInputElement;
let citeAbbrevWrap: HTMLElement;
let citeInputs: HTMLElement;
let citePreview: HTMLElement;
let citeInsertBtn: HTMLButtonElement;
let citeCopyBtn: HTMLButtonElement;
let citeShortFormBtn: HTMLButtonElement;
let citePasteInput: HTMLTextAreaElement;
let citeParseBtn: HTMLButtonElement;
let citeParseMsg: HTMLElement;
let toaBuildBtn: HTMLButtonElement;
let toaNativeBtn: HTMLButtonElement;
let toaClearMarksBtn: HTMLButtonElement;
let toaClearTablesBtn: HTMLButtonElement;
let tocBuildBtn: HTMLButtonElement;
let toaFindBtn: HTMLButtonElement;
let toaCopyRegisterBtn: HTMLButtonElement;
let toaRegister: HTMLElement;
let lastRegisterText = "";
let toaMsg: HTMLElement;
/** Tag on the content control that wraps the field-based TOA, so the formatted
 *  list can find it, copy its F9'd page numbers, and replace it in one step. */
const TOA_FIELD_CC_TAG = "jurislab:toafield";
let citeIdDetectBtn: HTMLButtonElement;
let citeIdDetectMsg: HTMLElement;
let citeSupraDetectBtn: HTMLButtonElement;
let citeSupraDetectMsg: HTMLElement;
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
let massspecSection: HTMLElement;
let msInput: HTMLInputElement;
let msResult: HTMLElement;
let msInsertBtn: HTMLButtonElement;
let spectraSection: HTMLElement;
let specInput: HTMLInputElement;
let specKind: HTMLSelectElement;
let specResult: HTMLElement;
let specInsertBtn: HTMLButtonElement;
let specInsertChartBtn: HTMLButtonElement;
/** MS readout for the most recent input, for insertion. */
let currentMassSpec: MassSpecResult | null = null;
let statsSection: HTMLElement;
let statsCalcSelect: HTMLSelectElement;
let statsInputs: HTMLElement;
let statsResult: HTMLElement;
let statsInsertBtn: HTMLButtonElement;
let currentStatsText = "";
let analyzeSection: HTMLElement;
let analyzeCalcSelect: HTMLSelectElement;
let analyzeHint: HTMLElement;
let analyzeInputs: HTMLElement;
let analyzeResult: HTMLElement;
let analyzeInsertBtn: HTMLButtonElement;
let currentAnalyzeText = "";
let currentAnalyzeBlocks: AnalyzeBlock[] | null = null;
let peptideSection: HTMLElement;
let pepInput: HTMLTextAreaElement;
let pepPreview: HTMLElement;
let pepInfo: HTMLElement;
let pepInsertBtn: HTMLButtonElement;
/** Rendered peptide structure for the current sequence, for insertion. */
let currentPeptideStructure: StructureResult | null = null;
let currentPeptideSeq = "";
let assaySection: HTMLElement;
let assayCalcSelect: HTMLSelectElement;
let assayInputs: HTMLElement;
let assayResult: HTMLElement;
let assayPreview: HTMLElement;
let assayInsertBtn: HTMLButtonElement;
let assayInsertPlotBtn: HTMLButtonElement;
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
/** The assay result text and fitted-curve SVG from the most recent computation. */
let currentAssayText = "";
let currentAssayPlotSvg = "";
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

  homeSection = document.getElementById("home-section") as HTMLElement;
  homeGroups = document.getElementById("home-groups") as HTMLElement;
  searchWrap = document.querySelector(".search-wrap");
  modeSelectWrap = document.getElementById("mode-select-wrap");
  modeSelect = document.getElementById("mode-select") as HTMLSelectElement;
  examplesPanel = document.querySelector(".examples");
  bottomDisclaimer = document.querySelector(".container > .disclaimer");
  inputEl = document.getElementById("formula-input") as HTMLInputElement;
  previewEl = document.getElementById("preview") as HTMLElement;
  chemValidateEl = document.getElementById("chem-validate") as HTMLElement;
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
  structurePropsEl = document.getElementById("structure-props") as HTMLElement;
  insertPropsBtn = document.getElementById("insert-props-btn") as HTMLButtonElement;
  opsinBtn = document.getElementById("opsin-btn") as HTMLButtonElement;
  opsinConfirm = document.getElementById("opsin-confirm") as HTMLElement;
  opsinConfirmText = document.getElementById("opsin-confirm-text") as HTMLElement;
  opsinContinueBtn = document.getElementById("opsin-continue") as HTMLButtonElement;
  opsinCancelBtn = document.getElementById("opsin-cancel") as HTMLButtonElement;
  opsinStatusEl = document.getElementById("opsin-status") as HTMLElement;
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
  citeStyleSelect = document.getElementById("cite-style") as HTMLSelectElement;
  citeSignalSelect = document.getElementById("cite-signal") as HTMLSelectElement;
  citeAbbrevCheckbox = document.getElementById("cite-abbrev") as HTMLInputElement;
  citeAbbrevWrap = document.getElementById("cite-abbrev-wrap") as HTMLElement;
  citeInputs = document.getElementById("cite-inputs") as HTMLElement;
  citePreview = document.getElementById("cite-preview") as HTMLElement;
  citeInsertBtn = document.getElementById("cite-insert") as HTMLButtonElement;
  citeCopyBtn = document.getElementById("cite-copy") as HTMLButtonElement;
  citeShortFormBtn = document.getElementById("cite-shortform") as HTMLButtonElement;
  citePasteInput = document.getElementById("cite-paste") as HTMLTextAreaElement;
  citeParseBtn = document.getElementById("cite-parse") as HTMLButtonElement;
  citeParseMsg = document.getElementById("cite-parse-msg") as HTMLElement;
  toaBuildBtn = document.getElementById("toa-build") as HTMLButtonElement;
  toaNativeBtn = document.getElementById("toa-native") as HTMLButtonElement;
  toaClearMarksBtn = document.getElementById("toa-clearmarks") as HTMLButtonElement;
  toaClearTablesBtn = document.getElementById("toa-cleartables") as HTMLButtonElement;
  tocBuildBtn = document.getElementById("toc-build") as HTMLButtonElement;
  toaFindBtn = document.getElementById("toa-find") as HTMLButtonElement;
  toaCopyRegisterBtn = document.getElementById("toa-copy-register") as HTMLButtonElement;
  toaRegister = document.getElementById("toa-register") as HTMLElement;
  toaMsg = document.getElementById("toa-msg") as HTMLElement;
  citeIdDetectBtn = document.getElementById("cite-iddetect") as HTMLButtonElement;
  citeIdDetectMsg = document.getElementById("cite-iddetect-msg") as HTMLElement;
  citeSupraDetectBtn = document.getElementById("cite-supradetect") as HTMLButtonElement;
  citeSupraDetectMsg = document.getElementById("cite-supradetect-msg") as HTMLElement;
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
  massspecSection = document.getElementById("massspec-section") as HTMLElement;
  msInput = document.getElementById("ms-input") as HTMLInputElement;
  msResult = document.getElementById("ms-result") as HTMLElement;
  msInsertBtn = document.getElementById("ms-insert") as HTMLButtonElement;
  spectraSection = document.getElementById("spectra-section") as HTMLElement;
  specInput = document.getElementById("spec-input") as HTMLInputElement;
  specKind = document.getElementById("spec-kind") as HTMLSelectElement;
  specResult = document.getElementById("spec-result") as HTMLElement;
  specInsertBtn = document.getElementById("spec-insert") as HTMLButtonElement;
  specInsertChartBtn = document.getElementById("spec-insert-chart") as HTMLButtonElement;
  statsSection = document.getElementById("stats-section") as HTMLElement;
  statsCalcSelect = document.getElementById("stats-calc") as HTMLSelectElement;
  statsInputs = document.getElementById("stats-inputs") as HTMLElement;
  statsResult = document.getElementById("stats-result") as HTMLElement;
  statsInsertBtn = document.getElementById("stats-insert") as HTMLButtonElement;
  analyzeSection = document.getElementById("analyze-section") as HTMLElement;
  analyzeCalcSelect = document.getElementById("analyze-calc") as HTMLSelectElement;
  analyzeHint = document.getElementById("analyze-hint") as HTMLElement;
  analyzeInputs = document.getElementById("analyze-inputs") as HTMLElement;
  analyzeResult = document.getElementById("analyze-result") as HTMLElement;
  analyzeInsertBtn = document.getElementById("analyze-insert") as HTMLButtonElement;
  peptideSection = document.getElementById("peptide-section") as HTMLElement;
  pepInput = document.getElementById("pep-input") as HTMLTextAreaElement;
  pepPreview = document.getElementById("pep-preview") as HTMLElement;
  pepInfo = document.getElementById("pep-info") as HTMLElement;
  pepInsertBtn = document.getElementById("pep-insert") as HTMLButtonElement;
  assaySection = document.getElementById("assay-section") as HTMLElement;
  assayCalcSelect = document.getElementById("assay-calc") as HTMLSelectElement;
  assayInputs = document.getElementById("assay-inputs") as HTMLElement;
  assayResult = document.getElementById("assay-result") as HTMLElement;
  assayPreview = document.getElementById("assay-preview") as HTMLElement;
  assayInsertBtn = document.getElementById("assay-insert") as HTMLButtonElement;
  assayInsertPlotBtn = document.getElementById("assay-insert-plot") as HTMLButtonElement;
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
  modeSelect.addEventListener("change", () => {
    updatePlaceholder();
    updateExamples();
    renderPalette();
    onInputChanged();
  });
  insertBtn.addEventListener("click", insertFormula);
  insertStructureBtn.addEventListener("click", insertStructure);
  insertNameBtn.addEventListener("click", () => insertDnaText(currentStructureName, "Name"));
  insertPropsBtn.addEventListener("click", () => insertDnaText(propertiesAsText(currentProperties), "Properties"));
  opsinBtn.addEventListener("click", onOpsinClick);
  opsinContinueBtn.addEventListener("click", () => {
    opsinConfirm.hidden = true;
    opsinConsentedThisSession = true;
    void doOpsinLookup(opsinPendingName);
  });
  opsinCancelBtn.addEventListener("click", () => {
    opsinConfirm.hidden = true;
    setOpsinStatus("");
  });
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

  msInput.addEventListener("input", updateMassSpec);
  msInsertBtn.addEventListener("click", () => insertDnaText(massSpecAsText(currentMassSpec), "MS data"));
  specInput.addEventListener("input", updateSpectra);
  specKind.addEventListener("change", updateSpectra);
  specInsertBtn.addEventListener("click", () => insertDnaText(spectrumAsText(), "spectrum data"));
  specInsertChartBtn.addEventListener("click", insertSpectrumChart);

  pepInput.addEventListener("input", updatePeptide);
  pepInsertBtn.addEventListener("click", insertPeptide);

  populateStatsCalcs();
  statsCalcSelect.addEventListener("change", renderStatsInputs);
  statsInsertBtn.addEventListener("click", () => insertDnaText(currentStatsText, "Statistics"));

  populateAnalyzeCalcs();
  analyzeCalcSelect.addEventListener("change", renderAnalyzeInputs);
  analyzeInsertBtn.addEventListener("click", insertAnalysis);

  populateAssayCalcs();
  assayCalcSelect.addEventListener("change", renderAssayInputs);
  assayInsertBtn.addEventListener("click", () => insertDnaText(currentAssayText, "Assay result"));
  assayInsertPlotBtn.addEventListener("click", insertAssayPlot);

  populateCitationTypes();
  citeTypeSelect.addEventListener("change", renderCitationInputs);
  citeStyleSelect.addEventListener("change", updateCitationPreview);
  citeSignalSelect.addEventListener("change", updateCitationPreview);
  citeAbbrevCheckbox.addEventListener("change", updateCitationPreview);
  citeInsertBtn.addEventListener("click", insertCitation);
  citeCopyBtn.addEventListener("click", copyCitation);
  citeParseBtn.addEventListener("click", parseAndFillCitation);
  citeShortFormBtn.addEventListener("click", makeCaseShortForm);
  toaBuildBtn.addEventListener("click", buildToaHandler);
  toaNativeBtn.addEventListener("click", buildNativeToaHandler);
  toaClearMarksBtn.addEventListener("click", clearCitationMarksHandler);
  toaClearTablesBtn.addEventListener("click", clearTablesHandler);
  tocBuildBtn.addEventListener("click", buildTocHandler);
  toaFindBtn.addEventListener("click", findCitationsHandler);
  toaCopyRegisterBtn.addEventListener("click", copyRegister);
  citeIdDetectBtn.addEventListener("click", insertIdForPreceding);
  citeSupraDetectBtn.addEventListener("click", detectSupraSource);

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

  renderHome();
  renderPalette();
  renderHistory();
  updateNumberLabel();
  updatePlaceholder();
  updateExamples();
  onInputChanged();

  void checkForUpdate();
});

/**
 * Checks whether a newer release is live on the host and, if so, shows a
 * one-click "reload to update" banner. The add-in's web files are served from a
 * static host, so a new deploy reaches users when their browser/WebView2 next
 * fetches taskpane.html — but that cache can be stubborn. Fetching a
 * cache-busted version.json makes a pending update visible and fixable on the
 * spot. Fails silently (offline-first): a failed fetch never nags the user.
 */
async function checkForUpdate(): Promise<void> {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: string };
    if (data && data.version && isNewerVersion(data.version, __APP_VERSION__)) {
      showUpdateBanner(data.version);
    }
  } catch {
    /* offline or host unreachable — no prompt */
  }
}

/** Renders a dismissible update banner at the top of the pane. */
function showUpdateBanner(newVersion: string): void {
  if (document.getElementById("update-banner")) return;
  const bar = document.createElement("div");
  bar.id = "update-banner";
  bar.setAttribute("role", "status");
  bar.style.cssText =
    "position:sticky;top:0;z-index:1000;display:flex;align-items:center;gap:8px;" +
    "padding:8px 12px;background:#e7f7ec;border-bottom:1px solid #b7e4c3;color:#0f5132;font-size:.85rem;";
  const msg = document.createElement("span");
  msg.style.flex = "1";
  msg.textContent = `Update available (v${newVersion}). Reload to get the latest.`;
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload";
  reload.style.cssText =
    "border:1px solid #0f5132;background:#0f5132;color:#fff;border-radius:6px;padding:3px 10px;cursor:pointer;font-weight:600;";
  reload.addEventListener("click", () => window.location.reload());
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "✕";
  dismiss.style.cssText = "border:none;background:transparent;color:#0f5132;cursor:pointer;font-size:1rem;line-height:1;";
  dismiss.addEventListener("click", () => bar.remove());
  bar.append(msg, reload, dismiss);
  document.body.prepend(bar);
}

// ---------------------------------------------------------------------------
// Home / intro page
// ---------------------------------------------------------------------------

interface HomeItem {
  mode: Mode;
  icon: string;
  label: string;
  desc: string;
}
interface HomeGroup {
  title: string;
  items: HomeItem[];
}

const HOME_GROUPS: HomeGroup[] = [
  {
    title: "Chemistry & structures",
    items: [
      { mode: "chemical", icon: "🧪", label: "Chemical", desc: "Formulas & 2D structures" },
      { mode: "build", icon: "🔬", label: "Build", desc: "Structures from atoms/bonds; Markush" },
      { mode: "reaction", icon: "⚗️", label: "Reaction", desc: "Reaction schemes" },
      { mode: "massspec", icon: "⚛️", label: "Mass Spec", desc: "Exact mass, isotope pattern, adducts" },
      { mode: "spectra", icon: "📡", label: "Spectra", desc: "Predicted NMR, IR, UV-Vis, fragmentation" },
    ],
  },
  {
    title: "Math & units",
    items: [
      { mode: "math", icon: "∑", label: "Math", desc: "Native equations, LaTeX" },
      { mode: "units", icon: "📏", label: "Units", desc: "SI typesetting & conversion" },
      { mode: "plot", icon: "📈", label: "Plot", desc: "Function & data charts" },
      { mode: "stats", icon: "📐", label: "Stats", desc: "Descriptive, t-tests, ANOVA, uncertainty" },
      { mode: "analyze", icon: "🧮", label: "Analyze", desc: "Matrix math + data → trends & insights" },
    ],
  },
  {
    title: "Data & figures",
    items: [
      { mode: "ppt", icon: "📊", label: "Table → Chart", desc: "Charts, diagrams, table figures, PPT" },
      { mode: "finance", icon: "💵", label: "Finance", desc: "TVM, DCF, bonds, options + Greeks, amortization" },
    ],
  },
  {
    title: "Biology",
    items: [
      { mode: "sequence", icon: "🧬", label: "Sequence", desc: "WIPO ST.26 listings" },
      { mode: "dna", icon: "🧬", label: "DNA", desc: "Rev-comp, translation, ORFs" },
      { mode: "assay", icon: "🧫", label: "Bio/Assay", desc: "Kinetics, IC50/EC50, binding, lab math" },
      { mode: "peptide", icon: "🔗", label: "Peptide", desc: "Draw a peptide from its sequence" },
      { mode: "botanical", icon: "🌿", label: "Botanical", desc: "Plant nomenclature" },
    ],
  },
  {
    title: "Patent drafting",
    items: [
      { mode: "numerals", icon: "🔢", label: "Numerals", desc: "Reference-numeral management" },
      { mode: "refs", icon: "🔖", label: "Refs", desc: "Captions & cross-references" },
      { mode: "code", icon: "💻", label: "Code", desc: "Algorithm & code listings" },
      { mode: "audit", icon: "✅", label: "Audit", desc: "Whole-document consistency" },
    ],
  },
  {
    title: "Legal citations",
    items: [{ mode: "citations", icon: "⚖️", label: "Citations", desc: "Bluebook — cases, statutes, patents" }],
  },
];

/** Builds the grouped tool cards on the home page. */
function renderHome(): void {
  homeGroups.replaceChildren();
  for (const g of HOME_GROUPS) {
    const group = document.createElement("div");
    group.className = "home-group";
    const title = document.createElement("div");
    title.className = "home-group-title";
    title.textContent = g.title;
    const cards = document.createElement("div");
    cards.className = "home-cards";
    for (const item of g.items) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "home-card";
      card.dataset.mode = item.mode;
      const icon = document.createElement("span");
      icon.className = "home-card-icon";
      icon.textContent = item.icon;
      const body = document.createElement("span");
      body.className = "home-card-body";
      const t = document.createElement("span");
      t.className = "home-card-title";
      t.textContent = item.label;
      const d = document.createElement("span");
      d.className = "home-card-desc";
      d.textContent = item.desc;
      body.append(t, d);
      card.append(icon, body);
      card.addEventListener("click", () => setMode(item.mode));
      cards.appendChild(card);
    }
    group.append(title, cards);
    homeGroups.appendChild(group);
  }
}

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
  modeSelect.value = mode;
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
  // Stay strictly positive so a genuine match late in a long label isn't
  // filtered out (callers keep score > 0).
  return Math.max(1, 50 - idx);
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
  return (modeSelect.value as Mode) ?? "home";
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

  // Home: show only the header + tool cards. Hide the search bar and the tab
  // strip (the cards are the navigation) plus the tools, history, examples, and
  // footer. Search + tabs reappear once a tool is open (Home tab returns here).
  const isHome = mode === "home";
  homeSection.style.display = isHome ? "block" : "none";
  if (searchWrap) searchWrap.style.display = isHome ? "none" : "";
  if (modeSelectWrap) modeSelectWrap.style.display = isHome ? "none" : "";
  historyEl.style.display = isHome ? "none" : "";
  if (examplesPanel) examplesPanel.style.display = isHome ? "none" : "";
  if (bottomDisclaimer) bottomDisclaimer.style.display = isHome ? "none" : "";
  if (isHome) {
    for (const s of [
      formatSection, buildSection, codeSection, sequenceSection, botanicalSection, numeralsSection,
      dnaSection, reactionSection, auditSection, unitsSection, refsSection, citationsSection,
      plotSection, financeSection, assaySection, massspecSection, spectraSection, peptideSection, statsSection, pptSection,
    ]) {
      s.style.display = "none";
    }
    return;
  }

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
  assaySection.style.display = mode === "assay" ? "block" : "none";
  massspecSection.style.display = mode === "massspec" ? "block" : "none";
  spectraSection.style.display = mode === "spectra" ? "block" : "none";
  peptideSection.style.display = mode === "peptide" ? "block" : "none";
  statsSection.style.display = mode === "stats" ? "block" : "none";
  analyzeSection.style.display = mode === "analyze" ? "block" : "none";
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
  if (mode === "assay") {
    if (!assayInputs.children.length) renderAssayInputs();
    return;
  }
  if (mode === "massspec") {
    updateMassSpec();
    return;
  }
  if (mode === "spectra") {
    updateSpectra();
    return;
  }
  if (mode === "peptide") {
    updatePeptide();
    return;
  }
  if (mode === "stats") {
    if (!statsInputs.children.length) renderStatsInputs();
    return;
  }
  if (mode === "analyze") {
    if (!analyzeInputs.children.length) renderAnalyzeInputs();
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
    chemValidateEl.style.display = "none";
  } else {
    // Same HTML used for insertion (see insertFormattedText) so preview == insert.
    previewEl.innerHTML = segmentsToHtml(parseChemical(inputEl.value));
    updateChemValidation();
  }
}

/** Validates the chemical formula against the real periodic table and reports it. */
function updateChemValidation(): void {
  const raw = inputEl.value.trim();
  if (!raw) {
    chemValidateEl.style.display = "none";
    return;
  }
  const v = validateFormula(raw);
  chemValidateEl.style.display = "block";
  if (v.valid) {
    const charge = v.charge ? `, charge ${v.charge > 0 ? "+" + v.charge : v.charge}` : "";
    chemValidateEl.className = "build-readout";
    chemValidateEl.textContent = `✓ Valid — ${v.hill}, M = ${v.mass!.toFixed(3)} g/mol${charge}`;
  } else {
    chemValidateEl.className = "build-readout warn";
    chemValidateEl.textContent = `⚠ ${v.errors.join("; ")}`;
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

  // Source-feature mol_type qualifier (ST.26 controlled vocabulary), whose
  // options depend on the molecule type.
  const sourceMol = document.createElement("select");
  sourceMol.className = "lib-select seq-source-moltype";
  sourceMol.title = "ST.26 mol_type qualifier";
  const fillSourceMol = (): void => {
    sourceMol.replaceChildren();
    for (const v of MOL_TYPE_OPTIONS[moltype.value as MolType]) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      sourceMol.appendChild(opt);
    }
  };
  fillSourceMol();
  moltype.addEventListener("change", fillSourceMol);

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
  head.append(moltype, sourceMol, organism, remove);

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

  // Optional feature annotations (CDS/gene/…). A CDS auto-gets /translation.
  const featuresBox = document.createElement("div");
  featuresBox.className = "seq-features";
  const addFeat = document.createElement("button");
  addFeat.type = "button";
  addFeat.className = "linklike seq-add-feature";
  addFeat.textContent = "+ annotate feature (CDS / gene)";
  addFeat.addEventListener("click", () => featuresBox.appendChild(makeSequenceFeatureRow()));

  card.append(head, residues, readout, featuresBox, addFeat);
  seqListEl.appendChild(card);
}

/** A feature-annotation row: key, location, and the common qualifiers. */
function makeSequenceFeatureRow(): HTMLElement {
  const row = document.createElement("div");
  row.className = "seq-feature-row";
  const key = document.createElement("select");
  key.className = "lib-select seq-feat-key";
  for (const k of ["CDS", "gene", "mRNA", "misc_feature", "sig_peptide", "mat_peptide"]) {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = k;
    key.appendChild(o);
  }
  const mk = (cls: string, ph: string): HTMLInputElement => {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = `formula-input ${cls}`;
    inp.placeholder = ph;
    return inp;
  };
  const rm = document.createElement("button");
  rm.type = "button";
  rm.className = "linklike seq-feat-remove";
  rm.textContent = "×";
  rm.title = "Remove feature";
  rm.addEventListener("click", () => row.remove());
  row.append(
    key,
    mk("seq-feat-loc", "Location (e.g. 1..300)"),
    mk("seq-feat-gene", "/gene"),
    mk("seq-feat-product", "/product"),
    mk("seq-feat-note", "/note"),
    rm
  );
  return row;
}

/** Reads the sequence cards into ST.26 entries. */
function readSequenceEntries(): SequenceEntry[] {
  const entries: SequenceEntry[] = [];
  seqListEl.querySelectorAll<HTMLElement>(".seq-card").forEach((card) => {
    const moltype = (card.querySelector(".seq-moltype") as HTMLSelectElement).value as MolType;
    const organism = (card.querySelector(".seq-organism") as HTMLInputElement).value;
    const residues = (card.querySelector(".seq-residues") as HTMLTextAreaElement).value;
    const sourceMolType = (card.querySelector(".seq-source-moltype") as HTMLSelectElement | null)?.value;
    const features: St26Feature[] = [];
    card.querySelectorAll<HTMLElement>(".seq-feature-row").forEach((fr) => {
      const key = (fr.querySelector(".seq-feat-key") as HTMLSelectElement).value;
      const location = (fr.querySelector(".seq-feat-loc") as HTMLInputElement).value.trim();
      const qualifiers: { name: string; value: string }[] = [];
      for (const [cls, name] of [
        [".seq-feat-gene", "gene"],
        [".seq-feat-product", "product"],
        [".seq-feat-note", "note"],
      ] as const) {
        const v = (fr.querySelector(cls) as HTMLInputElement).value.trim();
        if (v) qualifiers.push({ name, value: v });
      }
      if (location || qualifiers.length) features.push({ key, location, qualifiers });
    });
    if (residues.trim()) entries.push({ moltype, residues, organism, sourceMolType, features });
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
    for (const w of featureWarnings(e)) warnings.push(`SEQ ${i + 1}: ${w}`);
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
    // Surface any truncation warning on insert so it isn't missed — a filed
    // figure that silently omits rows/steps/branches would be a drafting error.
    const base = alsoText ? "Figure + editable table inserted." : "Figure inserted.";
    if (rendered.warnings.length) {
      setStatus(`${base} Note: ${rendered.warnings.join(" ")}`, "");
    } else {
      setStatus(base, "success");
    }
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
          mainTable: { grid: prepared.grid, kinds: prepared.kinds, numericCol: prepared.numericCol, bandText: prepared.bandText },
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
  // Editing the name invalidates any prior online lookup / pending consent.
  opsinConfirm.hidden = true;
  setOpsinStatus("");

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
  renderProperties(text);
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
  structurePropsEl.replaceChildren();
  currentStructureName = "";
  currentProperties = null;
  currentPka = null;
  insertNameBtn.disabled = true;
  insertStructureBtn.disabled = true;
  insertPropsBtn.disabled = true;
}

/** One-line druglikeness verdict for a rule screen. */
function ruleVerdict(name: string, r: { pass: boolean; violations: string[] }): string {
  if (r.pass && !r.violations.length) return `${name}: ✓ pass`;
  if (r.pass) return `${name}: ✓ pass (1 violation: ${r.violations.join(", ")})`;
  return `${name}: ✗ fail (${r.violations.join(", ")})`;
}

/**
 * Computes and shows the physicochemical property readout (cLogP, logS, tPSA,
 * H-bond donors/acceptors, rotatable bonds) and the Lipinski/Veber druglikeness
 * screens under the structure. Values are OpenChemLib estimates — advisory.
 */
function renderProperties(input: string): void {
  structurePropsEl.replaceChildren();
  currentProperties = null;
  currentPka = null;
  insertPropsBtn.disabled = true;

  let p: PhysChemProperties | null = null;
  try {
    p = computeProperties(input);
  } catch {
    p = null;
  }
  if (!p) return;

  currentProperties = p;

  const eyebrow = (text: string): void => {
    const e = document.createElement("div");
    e.className = "prop-eyebrow";
    e.textContent = text;
    structurePropsEl.appendChild(e);
  };

  // Metric list: label left, value in a shared right-aligned column.
  eyebrow("Properties");
  const grid = document.createElement("div");
  grid.className = "prop-grid";
  // cLogP and logS are QSAR estimates trained on organic molecules; OpenChemLib
  // returns fallback constants (0 and −0.53) for out-of-domain inputs like bare
  // metals or salts, so show "n/a" there rather than a fake-confident number.
  // Everything else (MW, tPSA, H-bond/rotatable counts) is exact for any input.
  const estimatesInDomain = p.druglikenessApplicable;
  const metrics: [string, string][] = [
    ["MW", `${p.mw}`],
    ["cLogP", estimatesInDomain ? `${p.logP}` : "n/a"],
    ["logS", estimatesInDomain ? `${p.logS}` : "n/a"],
    ["tPSA", `${p.tpsa} Å²`],
    ["H-bond donors", `${p.hbd}`],
    ["H-bond acceptors", `${p.hba}`],
    ["Rotatable bonds", `${p.rotatableBonds}`],
    ["Heavy atoms", `${p.heavyAtoms}`],
  ];
  for (const [k, v] of metrics) {
    const kk = document.createElement("span");
    kk.className = "prop-k";
    kk.textContent = k;
    const vv = document.createElement("span");
    vv.className = "prop-v";
    vv.textContent = v;
    grid.append(kk, vv);
  }
  structurePropsEl.appendChild(grid);

  // Druglikeness: a PASS/FAIL pill per screen, with any criteria on their own line.
  eyebrow("Druglikeness");
  // Lipinski/Veber are upper-bound filters for organic small molecules, so they
  // are vacuously "passed" by bare metals, noble gases, and simple salts. Show a
  // plain "n/a" note for those rather than a misleading green pass.
  if (!p.druglikenessApplicable) {
    const na = document.createElement("div");
    na.className = "prop-na";
    na.textContent = "n/a — applies to organic small molecules";
    structurePropsEl.appendChild(na);
    insertPropsBtn.disabled = false;
    return;
  }
  const rules = document.createElement("div");
  rules.className = "prop-rules";
  const ruleData: [string, RuleResult][] = [
    ["Lipinski Ro5", p.lipinski],
    ["Veber", p.veber],
  ];
  for (const [name, r] of ruleData) {
    const row = document.createElement("div");
    row.className = "prop-rule";
    const pill = document.createElement("span");
    pill.className = `prop-pill ${r.pass ? "pass" : "fail"}`;
    pill.textContent = r.pass ? "Pass" : "Fail";
    const nm = document.createElement("span");
    nm.className = "prop-name";
    nm.textContent = name;
    row.append(pill, nm);
    if (r.violations.length) {
      const why = document.createElement("span");
      why.className = "prop-why";
      why.textContent = r.violations.join(" · ");
      row.appendChild(why);
    }
    rules.appendChild(row);
  }
  structurePropsEl.appendChild(rules);

  renderPka(input);
  insertPropsBtn.disabled = false;
}

/** Detects ionizable groups and appends a pKa block to the properties panel. */
function renderPka(input: string): void {
  currentPka = null;
  let res: PkaResult | null = null;
  try {
    res = predictPka(input);
  } catch {
    return;
  }
  if (!res) return;
  currentPka = res;
  const block = document.createElement("div");
  block.className = "prop-rules";
  const head = document.createElement("div");
  head.className = "prop-name";
  head.textContent = res.sites.length ? "Ionizable groups (typical pKa)" : "No common ionizable groups detected";
  block.appendChild(head);
  for (const s of res.sites) {
    const row = document.createElement("div");
    row.className = "prop-rule";
    row.textContent = `${s.group} — ${s.kind === "acid" ? "acidic" : "basic"}, ${s.kind === "acid" ? "pKa" : "pKaH"} ≈ ${s.pka}`;
    block.appendChild(row);
  }
  if (res.sites.length) {
    const net = document.createElement("div");
    net.className = "prop-why";
    net.textContent = `Est. net charge at pH 7.4: ${res.netChargeAt74 >= 0 ? "+" : ""}${res.netChargeAt74.toFixed(2)}`;
    block.appendChild(net);
  }
  const caveat = document.createElement("div");
  caveat.className = "prop-why";
  caveat.textContent = "Typical literature values for the detected groups — a group estimate, not a compound-specific pKa.";
  block.appendChild(caveat);
  structurePropsEl.appendChild(block);
}

/** Multi-line plain-text pKa summary for insertion (empty when nothing detected). */
function pkaAsText(res: PkaResult | null): string {
  if (!res || !res.sites.length) return "";
  const lines = res.sites.map(
    (s) => `  ${s.group}: ${s.kind === "acid" ? "acidic" : "basic"}, ${s.kind === "acid" ? "pKa" : "pKaH"} ≈ ${s.pka}`,
  );
  return [
    "Ionizable groups (typical literature pKa — group estimate, not a compound-specific value):",
    ...lines,
    `Estimated net charge at pH 7.4: ${res.netChargeAt74 >= 0 ? "+" : ""}${res.netChargeAt74.toFixed(2)}`,
  ].join("\n");
}

/** Multi-line plain-text property summary for insertion into the document. */
function propertiesAsText(p: PhysChemProperties | null): string {
  if (!p) return "";
  const est = p.druglikenessApplicable; // cLogP/logS QSAR estimates apply to organic small molecules only
  return [
    `Physicochemical properties — ${p.formula} (MW ${p.mw} g/mol)`,
    `cLogP: ${est ? p.logP : "n/a (outside model domain)"}`,
    `logS: ${est ? `${p.logS} (log mol/L)` : "n/a (outside model domain)"}`,
    `Topological PSA: ${p.tpsa} Å²`,
    `H-bond donors: ${p.hbd}`,
    `H-bond acceptors: ${p.hba}`,
    `Rotatable bonds: ${p.rotatableBonds}`,
    `Heavy atoms: ${p.heavyAtoms}`,
    ...(p.druglikenessApplicable
      ? [ruleVerdict("Lipinski Rule of Five", p.lipinski), ruleVerdict("Veber rule", p.veber)]
      : ["Druglikeness: n/a (screens apply to organic small molecules)"]),
    "Estimated values (OpenChemLib) — verify before relying on them.",
    ...(pkaAsText(currentPka) ? ["", pkaAsText(currentPka)] : []),
  ].join("\n");
}

function setOpsinStatus(message: string, kind: "" | "error" | "success" = ""): void {
  opsinStatusEl.textContent = message;
  opsinStatusEl.className = kind ? `opsin-status ${kind}` : "opsin-status";
}

/**
 * Handles the "Resolve name online" button. On the first use this session it
 * shows the in-pane consent step (an Office add-in can't rely on window.confirm);
 * once consented, subsequent lookups go straight through.
 */
function onOpsinClick(): void {
  const name = inputEl.value.trim();
  if (!name) {
    setOpsinStatus("Type a name in the box above first.", "error");
    return;
  }
  if (opsinConsentedThisSession) {
    void doOpsinLookup(name);
    return;
  }
  // Consent gate: the name is about to leave the machine — make that explicit.
  opsinPendingName = name;
  opsinConfirmText.textContent =
    `Send “${name}” to the EMBL-EBI OPSIN service over the internet to resolve its structure? ` +
    `Don't do this for confidential compound names.`;
  opsinConfirm.hidden = false;
  setOpsinStatus("");
}

/** Calls OPSIN for `name` and renders the returned structure (offline depiction). */
async function doOpsinLookup(name: string): Promise<void> {
  opsinBtn.disabled = true;
  setOpsinStatus(`Looking up “${name}” online…`);
  try {
    const outcome = await resolveNameOnline(name);
    if (!outcome.ok) {
      setOpsinStatus(outcome.message, "error");
      return;
    }
    renderResolvedSmiles(outcome.result, name);
  } finally {
    opsinBtn.disabled = false;
  }
}

/** Depicts an OPSIN-resolved SMILES in the structure preview (all offline from here). */
function renderResolvedSmiles(result: OpsinResult, name: string): void {
  let structure: ReturnType<typeof renderStructure> = null;
  try {
    structure = renderStructure(result.smiles, STRUCTURE_W, STRUCTURE_H);
  } catch {
    structure = null;
  }
  if (!structure) {
    setOpsinStatus(`OPSIN parsed “${name}” but its structure couldn't be drawn.`, "error");
    return;
  }
  currentStructure = structure;
  structurePreviewEl.innerHTML = structure.svg;
  renderStructureInfo(structure.formula, structure.mw, structure.smiles);
  renderProperties(result.smiles);
  insertStructureBtn.disabled = false;
  // The user typed the name, so offer it for insertion directly.
  currentStructureName = name;
  structureNameEl.textContent = `Name: ${name}`;
  insertNameBtn.disabled = false;
  const key = result.inchikey ? ` · InChIKey ${result.inchikey}` : "";
  setOpsinStatus(`Resolved “${name}” via OPSIN.${key}`, "success");
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

/**
 * True if a WordApi requirement-set version is available on this host. Used to
 * gate the OOXML/OMML inserts that older Word (or some web/Mac hosts) lack, so
 * they degrade gracefully instead of throwing a raw exception. Optimistic if the
 * capability can't be determined.
 */
function wordApiSupported(version: string): boolean {
  try {
    return Office.context.requirements.isSetSupported("WordApi", version);
  } catch {
    return true;
  }
}

/** Inserts the formula at the selection — as a native equation, or as formatted text. */
async function insertFormula(): Promise<void> {
  const text = inputEl.value.trim();
  if (!text) {
    setStatus("Type a formula first.", "error");
    return;
  }

  // Math mode with the equation option checked: try OMML first, then fall back
  // to inline formatting if the expression can't be parsed into an equation, or
  // if this host doesn't support native-equation (OOXML) insertion.
  if (currentMode() === "math" && ommlCheckbox.checked) {
    if (!wordApiSupported("1.3")) {
      setStatus("Native equations aren’t supported in this version of Word — inserted as formatted text.", "");
    } else {
      const inserted = await insertEquation(text);
      if (inserted) return;
      setStatus("Couldn't build an equation from that — inserted as formatted text instead.", "error");
    }
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
      renderNumeralFindings(reconcileNumerals(numeralEntries, docNumerals, body.text), docNumerals.length);
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
// Re-entrancy guard shared by every text-insert button (MS, Stats, Assay, DNA,
// Finance…): a fast double-click would otherwise queue two insertions of the
// same text before the first Word.run resolves.
let insertTextBusy = false;

async function insertDnaText(text: string, label: string): Promise<void> {
  if (!text.trim()) {
    setStatus(`Nothing to insert for ${label.toLowerCase()}.`, "error");
    return;
  }
  if (insertTextBusy) return;
  insertTextBusy = true;
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
  } finally {
    insertTextBusy = false;
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
  const svg = composeReactionScheme(stages, { over: spec.over, under: spec.under, arrows: spec.arrows });
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
function buildPlotSeries(): { series: Series[]; error: string; warning: string } {
  const series: Series[] = [];
  let error = "";
  let warning = "";
  const failed: string[] = [];
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
          failed.push(fn);
        }
      }
    }
  }
  const data = parseData(plotData.value);
  if (data.length) series.push({ points: data, type: "scatter", label: series.length ? "data" : undefined });
  // A failed function only blocks when nothing else can be drawn; otherwise the
  // valid functions/data still render and the bad one is a soft warning.
  if (failed.length) {
    const list = failed.map((f) => `"${f}"`).join(", ");
    if (series.length) warning = `Skipped ${list} — check the expression.`;
    else if (!error) error = `Couldn't evaluate ${list} — check the expression.`;
  }
  return { series, error, warning };
}

/** Live-renders the plot preview. */
function updatePlotPreview(): void {
  currentPlotSvg = "";
  plotInsertBtn.disabled = true;
  const { series, error, warning } = buildPlotSeries();
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
  plotPreview.innerHTML = warning ? `${svg}<div class="hint" style="margin-top:4px">${esc(warning)}</div>` : svg;
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
  {
    id: "ear",
    name: "Effective annual rate",
    fields: [
      { key: "nom", label: "Nominal annual rate %", default: "12" },
      { key: "m", label: "Compounds / year", default: "12" },
    ],
    compute: (r) => `Effective annual rate = ${finPct(effectiveAnnualRate(+r("nom") / 100, +r("m")))}`,
  },
  {
    id: "amort",
    name: "Loan amortization (summary)",
    fields: [
      { key: "p", label: "Loan amount", default: "200000" },
      { key: "rate", label: "Annual rate %", default: "5" },
      { key: "t", label: "Years", default: "30" },
      { key: "m", label: "Payments / year", default: "12" },
    ],
    compute: (r) => {
      const m = +r("m");
      const rows = amortizationSchedule(+r("p"), +r("rate") / 100 / m, +r("t") * m);
      if (!rows.length) return "—";
      const interest = rows.reduce((a, x) => a + x.interest, 0);
      const paid = rows.reduce((a, x) => a + x.payment, 0);
      return [
        `Payment        ${finMoney(rows[0].payment)} / period`,
        `Total interest ${finMoney(interest)}`,
        `Total paid     ${finMoney(paid)}`,
      ].join("\n");
    },
  },
  {
    id: "gann",
    name: "Growing annuity PV",
    fields: [
      { key: "pmt", label: "First payment", default: "1000" },
      { key: "rate", label: "Discount rate % / period", default: "10" },
      { key: "g", label: "Growth rate % / period", default: "5" },
      { key: "n", label: "Number of periods", default: "10" },
    ],
    compute: (r) => `PV = ${finMoney(growingAnnuityPV(+r("pmt"), +r("rate") / 100, +r("g") / 100, +r("n")))}`,
  },
  {
    id: "dcf",
    name: "DCF valuation (Gordon terminal)",
    fields: [
      { key: "rate", label: "Discount rate % / period", default: "10" },
      { key: "cf", label: "Cash flows (t=1 first)", default: "100, 110, 121", kind: "list" },
      { key: "g", label: "Terminal growth % / period", default: "3" },
    ],
    compute: (r) => {
      const v = dcf(+r("rate") / 100, finList(r("cf")), +r("g") / 100);
      return Number.isFinite(v) ? `Value = ${finMoney(v)}` : "Value = — (need rate > terminal growth)";
    },
  },
  {
    id: "xirr",
    name: "XIRR (dated cash flows)",
    fields: [
      { key: "cf", label: "Cash flows", default: "-1000, 300, 400, 500", kind: "list" },
      { key: "days", label: "Days from first flow", default: "0, 180, 300, 450", kind: "list" },
    ],
    compute: (r) => {
      const v = xirr(finList(r("cf")), finList(r("days")));
      return v === null ? "XIRR = no solution" : `XIRR = ${finPct(v)} / year`;
    },
  },
  {
    id: "ytm",
    name: "Bond yield to maturity",
    fields: [
      { key: "price", label: "Price", default: "950" },
      { key: "face", label: "Face value", default: "1000" },
      { key: "coupon", label: "Coupon rate %", default: "5" },
      { key: "years", label: "Years to maturity", default: "10" },
      { key: "freq", label: "Coupons / year", default: "2" },
    ],
    compute: (r) => {
      const y = bondYTM(+r("price"), +r("face"), +r("coupon") / 100, +r("years"), +r("freq"));
      return y === null ? "YTM = no solution" : `YTM = ${finPct(y)}`;
    },
  },
  {
    id: "bondrisk",
    name: "Bond duration & convexity",
    fields: [
      { key: "face", label: "Face value", default: "1000" },
      { key: "coupon", label: "Coupon rate %", default: "5" },
      { key: "ytm", label: "Yield to maturity %", default: "6" },
      { key: "years", label: "Years to maturity", default: "10" },
      { key: "freq", label: "Coupons / year", default: "2" },
    ],
    compute: (r) => {
      const a = bondAnalytics(+r("face"), +r("coupon") / 100, +r("ytm") / 100, +r("years"), +r("freq"));
      return [
        `Price      ${finMoney(a.price)}`,
        `Macaulay   ${a.macaulay.toFixed(3)} yrs`,
        `Modified   ${a.modified.toFixed(3)} yrs`,
        `Convexity  ${a.convexity.toFixed(2)}`,
      ].join("\n");
    },
  },
  {
    id: "greeks",
    name: "Option Greeks (Black–Scholes)",
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
      { key: "s", label: "Spot S", default: "100" },
      { key: "k", label: "Strike K", default: "100" },
      { key: "t", label: "Time to expiry (yrs)", default: "1" },
      { key: "r", label: "Risk-free rate %", default: "5" },
      { key: "sig", label: "Volatility % (annual)", default: "20" },
    ],
    compute: (r) => {
      const g = blackScholesGreeks(r("type") as OptionType, +r("s"), +r("k"), +r("t"), +r("r") / 100, +r("sig") / 100);
      return [
        `Delta  ${g.delta.toFixed(4)}`,
        `Gamma  ${g.gamma.toFixed(5)}`,
        `Vega   ${finMoney(g.vega / 100)} per 1% vol`,
        `Theta  ${finMoney(g.theta / 365)} per day`,
        `Rho    ${finMoney(g.rho / 100)} per 1% rate`,
      ].join("\n");
    },
  },
  {
    id: "iv",
    name: "Implied volatility",
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
      { key: "price", label: "Option price", default: "10.45" },
      { key: "s", label: "Spot S", default: "100" },
      { key: "k", label: "Strike K", default: "100" },
      { key: "t", label: "Time to expiry (yrs)", default: "1" },
      { key: "r", label: "Risk-free rate %", default: "5" },
    ],
    compute: (r) => {
      const v = impliedVolatility(r("type") as OptionType, +r("price"), +r("s"), +r("k"), +r("t"), +r("r") / 100);
      return v === null ? "Implied vol = no solution" : `Implied vol = ${finPct(v)}`;
    },
  },
  {
    id: "depr",
    name: "Depreciation (declining balance)",
    fields: [
      { key: "cost", label: "Cost", default: "10000" },
      { key: "salvage", label: "Salvage value", default: "1000" },
      { key: "life", label: "Useful life (years)", default: "5" },
      { key: "factor", label: "Factor (2 = double)", default: "2" },
    ],
    compute: (r) => {
      const rows = decliningBalanceSchedule(+r("cost"), +r("salvage"), +r("life"), +r("factor"));
      if (!rows.length) return "—";
      return rows.map((x) => `Year ${x.year}:  dep ${finMoney(x.depreciation)}   book ${finMoney(x.bookValue)}`).join("\n");
    },
  },
  {
    id: "returns",
    name: "Return stats (annualized)",
    fields: [
      { key: "rets", label: "Per-period returns %", default: "2, 1, 3, -1, 2, 1.5", kind: "list" },
      { key: "ppy", label: "Periods / year", default: "12" },
      { key: "rf", label: "Risk-free % / period", default: "0.1" },
    ],
    compute: (r) => {
      const rets = finList(r("rets")).map((x) => x / 100);
      const ppy = +r("ppy");
      return [
        `Annualized return  ${finPct(annualizedReturn(rets, ppy))}`,
        `Annualized vol     ${finPct(annualizedVolatility(rets, ppy))}`,
        `Sharpe ratio       ${sharpeRatio(rets, +r("rf") / 100, ppy).toFixed(3)}`,
      ].join("\n");
    },
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
// Statistics & uncertainty
// ---------------------------------------------------------------------------

interface StatField {
  key: string;
  label: string;
  default: string;
  kind: "list" | "groups" | "vars" | "text" | "select";
  options?: { value: string; label: string }[];
}
interface StatOutput {
  text: string;
  /** False for a validation message (blocks insertion). */
  ok?: boolean;
}
interface StatCalc {
  id: string;
  name: string;
  fields: StatField[];
  compute: (read: (k: string) => string) => StatOutput;
}

function statList(s: string): number[] {
  return s
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}
function statGroups(s: string): number[][] {
  return s
    .split(/\n\s*\n|;/)
    .map((g) => statList(g))
    .filter((g) => g.length > 0);
}
/** Parses a numeric table: one row per line, entries space/comma separated. */
function statTable(s: string): number[][] {
  return s
    .split(/\n|;/)
    .map((line) => statList(line))
    .filter((row) => row.length > 0);
}

/**
 * Parses two-way data as "A B value" per line (A, B are factor-level labels) into
 * a balanced cell grid cells[i][j] = replicate values, plus the level labels.
 */
function statTwoWay(s: string): { cells: number[][][]; aLevels: string[]; bLevels: string[] } {
  const rows: { a: string; b: string; v: number }[] = [];
  for (const line of s.split(/\n|;/)) {
    const parts = line.trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) continue;
    const v = Number(parts[parts.length - 1]);
    if (!Number.isFinite(v)) continue;
    rows.push({ a: parts[0], b: parts[1], v });
  }
  const aLevels = Array.from(new Set(rows.map((r) => r.a)));
  const bLevels = Array.from(new Set(rows.map((r) => r.b)));
  const cells: number[][][] = aLevels.map(() => bLevels.map(() => [] as number[]));
  for (const r of rows) cells[aLevels.indexOf(r.a)][bLevels.indexOf(r.b)].push(r.v);
  return { cells, aLevels, bLevels };
}

function statVars(s: string): Record<string, { value: number; uncertainty: number }> {
  const out: Record<string, { value: number; uncertainty: number }> = {};
  for (const line of s.split(/[\n;]+/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?[\d.eE+]+)\s*(?:±|\+\/-|\+-)\s*([\d.eE+]+)\s*$/.exec(line);
    if (m) out[m[1]] = { value: parseFloat(m[2]), uncertainty: parseFloat(m[3]) };
  }
  return out;
}

const STAT_CALCS: StatCalc[] = [
  {
    id: "descriptive",
    name: "Descriptive statistics",
    fields: [{ key: "data", label: "Data (numbers)", default: "2, 4, 4, 4, 5, 5, 7, 9", kind: "list" }],
    compute: (r) => {
      const xs = statList(r("data"));
      if (xs.length < 2) return { text: "Enter at least two numbers.", ok: false };
      const d = statDescribe(xs);
      // CV = SD/mean is only meaningful for ratio-scale data with a positive
      // mean; it blows up to ±∞ as the mean → 0 and is negative for negative
      // means, so report "n/a" there rather than a fake-confident percentage.
      const cvText =
        d.mean > 0 && Number.isFinite(d.cv) ? `${(d.cv * 100).toFixed(1)}%` : "n/a (needs a positive mean)";
      return {
        text:
          `Descriptive statistics (n = ${d.n})\n` +
          `Mean = ${assaySig(d.mean)} ± ${assaySig(d.sem, 3)} (SEM)\n` +
          `SD = ${assaySig(d.sd)} · Variance = ${assaySig(d.variance)}\n` +
          `Median = ${assaySig(d.median)} · Min = ${assaySig(d.min)} · Max = ${assaySig(d.max)}\n` +
          `95% CI = [${assaySig(d.ci95[0])}, ${assaySig(d.ci95[1])}]\n` +
          `CV = ${cvText}`,
      };
    },
  },
  {
    id: "twosample",
    name: "Two-sample t-test",
    fields: [
      { key: "a", label: "Group A", default: "5.1, 4.9, 6.2, 5.7, 5.5", kind: "list" },
      { key: "b", label: "Group B", default: "6.3, 6.8, 7.1, 6.4, 7.0", kind: "list" },
      {
        key: "type",
        label: "Variance assumption",
        default: "welch",
        kind: "select",
        options: [
          { value: "welch", label: "Welch (unequal)" },
          { value: "student", label: "Student (pooled)" },
        ],
      },
    ],
    compute: (r) => {
      const a = statList(r("a"));
      const b = statList(r("b"));
      if (a.length < 2 || b.length < 2) return { text: "Enter at least two numbers per group.", ok: false };
      const res = twoSampleTTest(a, b, r("type") === "student");
      if (!Number.isFinite(res.t) || !Number.isFinite(res.p))
        return { text: "t-test is undefined — a group has zero variance (all its values are identical).", ok: false };
      const label = r("type") === "student" ? "Student's" : "Welch's";
      return { text: `${label} two-sample t-test\n${reportT(res)}\nMean difference = ${assaySig(res.meanDifference)}` };
    },
  },
  {
    id: "paired",
    name: "Paired t-test",
    fields: [
      { key: "a", label: "Condition 1", default: "5, 6, 7, 8", kind: "list" },
      { key: "b", label: "Condition 2 (paired)", default: "4, 4, 6, 5", kind: "list" },
    ],
    compute: (r) => {
      const a = statList(r("a"));
      const b = statList(r("b"));
      if (a.length < 2 || a.length !== b.length) return { text: "Enter two equal-length paired lists (≥ 2).", ok: false };
      const res = pairedTTest(a, b);
      if (!Number.isFinite(res.t) || !Number.isFinite(res.p))
        return { text: "Paired t-test is undefined — the paired differences have zero variance (all identical).", ok: false };
      return { text: `Paired t-test\n${reportT(res)}\nMean difference = ${assaySig(res.meanDifference)}` };
    },
  },
  {
    id: "anova",
    name: "One-way ANOVA",
    fields: [
      {
        key: "groups",
        label: "Groups (blank line or ; between groups)",
        default: "1 2 3\n4 5 6\n7 8 9",
        kind: "groups",
      },
    ],
    compute: (r) => {
      const groups = statGroups(r("groups"));
      if (groups.length < 2) return { text: "Enter at least two groups (separate with a blank line).", ok: false };
      if (groups.some((g) => g.length < 2))
        return { text: "Each ANOVA group needs at least two values.", ok: false };
      const res = oneWayAnova(groups);
      if (!Number.isFinite(res.f) || !Number.isFinite(res.p))
        return { text: "ANOVA is undefined — every group has zero within-group variance (identical values).", ok: false };
      return { text: `One-way ANOVA (${groups.length} groups)\n${reportF(res)}` };
    },
  },
  {
    id: "regression",
    name: "Linear regression",
    fields: [
      { key: "x", label: "x values", default: "1, 2, 3, 4, 5", kind: "list" },
      { key: "y", label: "y values", default: "2.1, 3.9, 6.1, 8.0, 9.9", kind: "list" },
    ],
    compute: (r) => {
      const x = statList(r("x"));
      const y = statList(r("y"));
      if (x.length < 3 || x.length !== y.length) return { text: "Enter equal-length x and y lists (≥ 3 points).", ok: false };
      const res = statRegression(x, y);
      if (!Number.isFinite(res.slope)) return { text: "Regression is undefined — the x values must not all be identical.", ok: false };
      return {
        text:
          `Linear regression (n = ${res.n})\n` +
          `y = ${assaySig(res.slope)}·x + ${assaySig(res.intercept)}\n` +
          `R² = ${assaySig(res.rSquared, 4)} · slope SE = ${assaySig(res.slopeSE, 3)} · slope ${formatP(res.slopeP)}`,
      };
    },
  },
  {
    id: "uncertainty",
    name: "Uncertainty propagation",
    fields: [
      { key: "formula", label: "Formula", default: "a*b/c", kind: "text" },
      { key: "vars", label: "Variables (name = value ± uncertainty)", default: "a = 10 ± 0.1\nb = 20 ± 0.2\nc = 5 ± 0.05", kind: "vars" },
    ],
    compute: (r) => {
      const formula = r("formula").trim();
      const vars = statVars(r("vars"));
      if (!formula || !Object.keys(vars).length) return { text: "Enter a formula and at least one variable.", ok: false };
      try {
        const res = propagateUncertainty(formula, vars);
        const dominant = res.contributions[0];
        return {
          text:
            `Uncertainty propagation\n` +
            `${formula} = ${assaySig(res.value)} ± ${assaySig(res.uncertainty, 3)}\n` +
            `Largest contribution: ${dominant.name}`,
        };
      } catch (e) {
        return { text: `Couldn't evaluate: ${(e as Error).message}`, ok: false };
      }
    },
  },
  {
    id: "mannwhitney",
    name: "Mann–Whitney U (non-parametric)",
    fields: [
      { key: "a", label: "Group A", default: "1, 2, 3, 4, 5", kind: "list" },
      { key: "b", label: "Group B", default: "6, 7, 8, 9, 10", kind: "list" },
    ],
    compute: (r) => {
      const a = statList(r("a"));
      const b = statList(r("b"));
      if (a.length < 2 || b.length < 2) return { text: "Enter at least two values per group.", ok: false };
      const res = mannWhitneyU(a, b);
      return {
        text: `Mann–Whitney U test (two independent samples)\nU = ${assaySig(res.statistic)}, z = ${assaySig(res.z, 3)}, ${formatP(res.p)}\n(normal approximation, tie- and continuity-corrected)`,
      };
    },
  },
  {
    id: "wilcoxon",
    name: "Wilcoxon signed-rank (paired)",
    fields: [
      { key: "a", label: "Condition 1", default: "125, 115, 130, 140, 140, 115, 140, 125", kind: "list" },
      { key: "b", label: "Condition 2 (paired)", default: "110, 122, 125, 120, 140, 124, 123, 137", kind: "list" },
    ],
    compute: (r) => {
      const a = statList(r("a"));
      const b = statList(r("b"));
      if (a.length < 2 || a.length !== b.length) return { text: "Enter two equal-length paired lists (≥ 2).", ok: false };
      const res = wilcoxonSignedRank(a, b);
      if (res.n1 === 0) return { text: "All paired differences are zero — the test is undefined.", ok: false };
      return {
        text: `Wilcoxon signed-rank test (paired)\nW = ${assaySig(res.statistic)}, n = ${res.n1}, z = ${assaySig(res.z, 3)}, ${formatP(res.p)}\n(normal approximation, tie- and continuity-corrected)`,
      };
    },
  },
  {
    id: "chigof",
    name: "Chi-square goodness of fit",
    fields: [
      { key: "obs", label: "Observed counts", default: "18, 22, 20, 25, 15", kind: "list" },
      { key: "exp", label: "Expected counts (blank = uniform)", default: "", kind: "list" },
    ],
    compute: (r) => {
      const obs = statList(r("obs"));
      if (obs.length < 2) return { text: "Enter at least two observed counts.", ok: false };
      let exp = statList(r("exp"));
      if (exp.length === 0) {
        const total = obs.reduce((s, v) => s + v, 0);
        exp = obs.map(() => total / obs.length);
      }
      if (exp.length !== obs.length) return { text: "Observed and expected must have the same length.", ok: false };
      const res = chiSquareGoodnessOfFit(obs, exp);
      return { text: `Chi-square goodness of fit\nχ² = ${assaySig(res.chi2)}, df = ${res.df}, ${formatP(res.p)}` };
    },
  },
  {
    id: "chiind",
    name: "Chi-square test of independence",
    fields: [
      { key: "table", label: "Contingency table (one row per line)", default: "10, 20, 30\n30, 40, 20", kind: "groups" },
    ],
    compute: (r) => {
      const table = statTable(r("table"));
      if (table.length < 2 || table[0].length < 2) return { text: "Enter a table with at least 2 rows and 2 columns.", ok: false };
      if (table.some((row) => row.length !== table[0].length)) return { text: "Every row must have the same number of columns.", ok: false };
      const res = chiSquareIndependence(table);
      return { text: `Chi-square test of independence (${table.length}×${table[0].length})\nχ² = ${assaySig(res.chi2)}, df = ${res.df}, ${formatP(res.p)}` };
    },
  },
  {
    id: "twoway",
    name: "Two-way ANOVA",
    fields: [
      {
        key: "data",
        label: "Data: A B value (one observation per line)",
        default: "lo x 12\nlo x 14\nlo y 20\nlo y 22\nhi x 30\nhi x 33\nhi y 41\nhi y 39",
        kind: "groups",
      },
    ],
    compute: (r) => {
      const { cells, aLevels, bLevels } = statTwoWay(r("data"));
      if (aLevels.length < 2 || bLevels.length < 2)
        return { text: "Need ≥ 2 levels for each factor. Each line: factorA factorB value.", ok: false };
      try {
        const res = twoWayAnova(cells);
        const row = (name: string, e: { F: number; df: number; p: number }) =>
          `${name}: F(${e.df}, ${res.error.df}) = ${assaySig(e.F)}, ${formatP(e.p)}`;
        return {
          text:
            `Two-way ANOVA (A: ${aLevels.join("/")} × B: ${bLevels.join("/")})\n` +
            `${row("Factor A", res.factorA)}\n${row("Factor B", res.factorB)}\n${row("A × B interaction", res.interaction)}`,
        };
      } catch (e) {
        return { text: `${(e as Error).message}`, ok: false };
      }
    },
  },
  {
    id: "multcomp",
    name: "Multiple-comparison correction",
    fields: [
      { key: "p", label: "Raw p-values", default: "0.01, 0.04, 0.03, 0.005, 0.2", kind: "list" },
      {
        key: "method",
        label: "Method",
        default: "bh",
        kind: "select",
        options: [
          { value: "bh", label: "Benjamini–Hochberg (FDR)" },
          { value: "holm", label: "Holm (FWER)" },
          { value: "bonferroni", label: "Bonferroni (FWER)" },
        ],
      },
    ],
    compute: (r) => {
      const p = statList(r("p"));
      if (!p.length) return { text: "Enter at least one p-value.", ok: false };
      if (p.some((v) => v < 0 || v > 1)) return { text: "p-values must be between 0 and 1.", ok: false };
      const method = r("method") as CorrectionMethod;
      const adj = adjustPValues(p, method);
      const names: Record<CorrectionMethod, string> = {
        bh: "Benjamini–Hochberg (FDR)",
        holm: "Holm",
        bonferroni: "Bonferroni",
      };
      const lines = p.map((raw, i) => `  p = ${assaySig(raw, 3)} → ${assaySig(adj[i], 3)}${adj[i] < 0.05 ? " *" : ""}`);
      return { text: `${names[method]} adjusted p-values\n${lines.join("\n")}\n(* significant at 0.05 after correction)` };
    },
  },
];

function populateStatsCalcs(): void {
  statsCalcSelect.replaceChildren();
  for (const c of STAT_CALCS) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    statsCalcSelect.appendChild(opt);
  }
}

/** Builds the inputs for the selected statistical test and wires live compute. */
function renderStatsInputs(): void {
  const calc = STAT_CALCS.find((c) => c.id === statsCalcSelect.value) ?? STAT_CALCS[0];
  statsInputs.replaceChildren();
  for (const f of calc.fields) {
    const row = document.createElement("div");
    row.className = "dna-controls";
    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = f.label;
    label.htmlFor = `stats-f-${f.key}`;

    let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
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
    } else if (f.kind === "text") {
      const t = document.createElement("input");
      t.type = "text";
      t.className = "rgroup-input";
      t.value = f.default;
      input = t;
    } else {
      const ta = document.createElement("textarea");
      ta.className = "rgroup-input";
      ta.rows = f.kind === "groups" || f.kind === "vars" ? 3 : 2;
      ta.value = f.default;
      input = ta;
    }
    input.id = `stats-f-${f.key}`;
    input.dataset.key = f.key;
    input.addEventListener("input", updateStatsPreview);
    input.addEventListener("change", updateStatsPreview);
    row.append(label, input);
    statsInputs.appendChild(row);
  }
  updateStatsPreview();
}

/** Computes and shows the result for the current statistical test. */
function updateStatsPreview(): void {
  const calc = STAT_CALCS.find((c) => c.id === statsCalcSelect.value) ?? STAT_CALCS[0];
  const read = (k: string): string => {
    const el = statsInputs.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-key="${k}"]`);
    return el ? el.value : "";
  };
  let out: StatOutput;
  try {
    out = calc.compute(read);
  } catch {
    out = { text: "Could not compute — check the inputs.", ok: false };
  }
  // Exclude the "—" no-value sentinel (from a non-finite computation) so a
  // dash placeholder is never inserted into the document.
  const insertable = out.ok !== false && !!out.text && !out.text.includes("—");
  statsResult.innerHTML = esc(out.text).replace(/\n/g, "<br>");
  currentStatsText = insertable ? out.text : "";
  statsInsertBtn.disabled = !insertable;
}

// ---------------------------------------------------------------------------
// Analyze — no-code numerical workbench (matrix math + data insights)
// ---------------------------------------------------------------------------

interface AnalyzeField {
  key: string;
  label: string;
  default: string;
  kind: "block" | "text" | "select";
  rows?: number;
  options?: { value: string; label: string }[];
}
/** A piece of an Analyze result: a text line, a matrix (→ table), or a plot (→ image). */
type AnalyzeBlock =
  | { kind: "line"; text: string }
  | { kind: "matrix"; label?: string; m: Matrix }
  | { kind: "plot"; svg: string; caption: string; alt: string; w: number; h: number };
interface AnalyzeOutput extends StatOutput {
  /** Structured blocks for rich insertion; when present, matrices go in as Word tables. */
  blocks?: AnalyzeBlock[];
}

/** Parses "x = 1, y = 2" (comma/newline/semicolon separated) into names + values. */
function parseAssignments(s: string): { names: string[]; values: number[] } {
  const names: string[] = [];
  const values: number[] = [];
  for (const part of s.split(/[,\n;]+/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?[\d.]+(?:[eE][+-]?\d+)?)\s*$/.exec(part);
    if (m) {
      names.push(m[1]);
      values.push(parseFloat(m[2]));
    }
  }
  return { names, values };
}
interface AnalyzeCalc {
  id: string;
  name: string;
  hint: string;
  fields: AnalyzeField[];
  compute: (read: (k: string) => string) => AnalyzeOutput;
}

/** Parses a matrix field, throwing the parser's message on bad input. */
function readMatrix(s: string): Matrix {
  const p = parseMatrix(s);
  if (!p.ok) throw new Error(p.error);
  return p.matrix;
}

/** Renders a block's text form (for the pane preview and the plain-text fallback). */
function analyzeBlocksToText(blocks: AnalyzeBlock[]): string {
  return blocks
    .map((b) => {
      if (b.kind === "line") return b.text;
      if (b.kind === "plot") return b.caption;
      return (b.label ? `${b.label}\n` : "") + formatMatrix(b.m);
    })
    .join("\n");
}

/** Rich preview HTML for a block list (matrices monospaced, plots inline). */
function analyzeBlocksToPreviewHtml(blocks: AnalyzeBlock[]): string {
  return blocks
    .map((b) => {
      if (b.kind === "line") return esc(b.text);
      if (b.kind === "plot") return b.svg;
      return (
        (b.label ? `${esc(b.label)}<br>` : "") +
        `<span style="font-family:monospace;white-space:pre">${esc(formatMatrix(b.m))}</span>`
      );
    })
    .join("<br>");
}

/** Wraps blocks into an AnalyzeOutput, deriving the text form once. */
function analyzeResultOf(blocks: AnalyzeBlock[]): AnalyzeOutput {
  return { blocks, text: analyzeBlocksToText(blocks) };
}

const ANALYZE_CALCS: AnalyzeCalc[] = [
  {
    id: "solve",
    name: "Solve linear system A·x = b",
    hint: "Enter the square coefficient matrix A (one row per line) and the right-hand side b.",
    fields: [
      { key: "A", label: "Matrix A", default: "2 1\n1 -1", kind: "block", rows: 4 },
      { key: "b", label: "Right-hand side b", default: "5, 1", kind: "text" },
    ],
    compute: (r) => {
      const A = readMatrix(r("A"));
      const b = readMatrix(r("b"));
      if (matRows(A) !== matCols(A)) return { text: "A must be square.", ok: false };
      const x = solve(A, b);
      if (!x) return { text: "No unique solution — A is singular or b has the wrong length.", ok: false };
      return analyzeResultOf([{ kind: "matrix", label: "Solution x =", m: x }]);
    },
  },
  {
    id: "inverse",
    name: "Inverse of a matrix",
    hint: "Enter a square matrix, one row per line.",
    fields: [{ key: "M", label: "Matrix", default: "4 7\n2 6", kind: "block", rows: 4 }],
    compute: (r) => {
      const M = readMatrix(r("M"));
      if (matRows(M) !== matCols(M)) return { text: "Matrix must be square.", ok: false };
      const inv = inverse(M);
      if (!inv) return { text: "Matrix is singular — no inverse exists (determinant = 0).", ok: false };
      return analyzeResultOf([{ kind: "matrix", label: "Inverse =", m: inv }]);
    },
  },
  {
    id: "determinant",
    name: "Determinant, rank & trace",
    hint: "Enter a matrix, one row per line. Determinant and trace need a square matrix.",
    fields: [{ key: "M", label: "Matrix", default: "6 1 1\n4 -2 5\n2 8 7", kind: "block", rows: 5 }],
    compute: (r) => {
      const M = readMatrix(r("M"));
      const rk = rank(M);
      const square = matRows(M) === matCols(M);
      const det = square ? determinant(M) : null;
      const lines = [`Rank = ${rk}`];
      if (square) {
        lines.unshift(`Determinant = ${formatNum(det ?? 0, 6)}`);
        lines.push(`Trace = ${formatNum(trace(M), 6)}`);
        if (det === 0) lines.push("(singular: determinant is 0, so no inverse exists)");
      } else {
        lines.push("(determinant & trace need a square matrix)");
      }
      return { text: lines.join("\n") };
    },
  },
  {
    id: "eigen",
    name: "Eigenvalues (symmetric matrix)",
    hint: "Enter a symmetric square matrix (e.g. a covariance/correlation matrix). Non-symmetric matrices are out of scope — their eigenvalues can be complex.",
    fields: [{ key: "M", label: "Symmetric matrix", default: "2 1\n1 2", kind: "block", rows: 4 }],
    compute: (r) => {
      const M = readMatrix(r("M"));
      if (matRows(M) !== matCols(M)) return { text: "Matrix must be square.", ok: false };
      const e = eigenSymmetric(M);
      if (!e) return { text: "Matrix is not symmetric — only symmetric matrices are supported (real eigenvalues).", ok: false };
      const vals = e.values.map((v) => formatNum(v, 6)).join(", ");
      return analyzeResultOf([
        { kind: "line", text: `Eigenvalues (descending) = ${vals}` },
        { kind: "matrix", label: "Eigenvectors (columns) =", m: e.vectors },
      ]);
    },
  },
  {
    id: "eigen-general",
    name: "Eigenvalues (any square matrix)",
    hint: "Eigenvalues of a general (non-symmetric) square matrix via the Francis double-shift QR algorithm. Complex-conjugate pairs are shown as a ± bi.",
    fields: [{ key: "M", label: "Square matrix", default: "0 -1\n1 0", kind: "block", rows: 4 }],
    compute: (r) => {
      const M = readMatrix(r("M"));
      if (matRows(M) !== matCols(M)) return { text: "Matrix must be square.", ok: false };
      const vals = eigenvaluesGeneral(M);
      if (!vals) return { text: "Matrix must be square.", ok: false };
      const anyComplex = vals.some((c) => Math.abs(c.im) > 1e-12);
      const listed = vals.map((c) => formatComplex(c, 6)).join(", ");
      return { text: `Eigenvalues = ${listed}` + (anyComplex ? "\n(complex-conjugate pair present)" : "") };
    },
  },
  {
    id: "qr",
    name: "QR decomposition",
    hint: "Factors A = Q·R with Q orthogonal and R upper-triangular (Householder reflections).",
    fields: [{ key: "M", label: "Matrix", default: "12 -51 4\n6 167 -68\n-4 24 -41", kind: "block", rows: 5 }],
    compute: (r) => {
      const M = readMatrix(r("M"));
      const { Q, R } = qrDecompose(M);
      return analyzeResultOf([
        { kind: "matrix", label: "Q =", m: Q },
        { kind: "matrix", label: "R =", m: R },
      ]);
    },
  },
  {
    id: "svd",
    name: "Singular value decomposition (SVD)",
    hint: "Factors A = U·diag(S)·Vᵀ (one-sided Jacobi). Works for any shape; returns the economy form.",
    fields: [{ key: "M", label: "Matrix", default: "3 0\n0 -2", kind: "block", rows: 4 }],
    compute: (r) => {
      const M = readMatrix(r("M"));
      const { U, S, V } = svd(M);
      const sv = S.map((x) => formatNum(x, 6)).join(", ");
      return analyzeResultOf([
        { kind: "line", text: `Singular values = ${sv}` },
        { kind: "matrix", label: "U =", m: U },
        { kind: "matrix", label: "V =", m: V },
      ]);
    },
  },
  {
    id: "expr",
    name: "Matrix expression",
    hint: "Define named matrices (one per line, e.g. A = 1 2; 3 4), then evaluate an expression using + − *, scalars, transpose (') and inv/det/trace/rank, e.g. A*inv(B) + 2*C'.",
    fields: [
      { key: "defs", label: "Definitions (one per line)", default: "A = 1 2; 3 4\nB = 2 0; 1 2", kind: "block", rows: 4 },
      { key: "expr", label: "Expression", default: "A*inv(B) + 2*A'", kind: "text" },
    ],
    compute: (r) => {
      const defs = parseDefinitions(r("defs"));
      if (!defs.ok) return { text: defs.error, ok: false };
      const out = evalMatrixExpression(r("expr"), defs.env);
      if (!out.ok) return { text: out.error, ok: false };
      if (out.value.kind === "scalar") return { text: `Result = ${formatNum(out.value.s, 6)}` };
      return analyzeResultOf([{ kind: "matrix", label: "Result =", m: out.value.m }]);
    },
  },
  {
    id: "multiply",
    name: "Multiply two matrices A·B",
    hint: "Columns of A must equal rows of B.",
    fields: [
      { key: "A", label: "Matrix A", default: "1 2\n3 4", kind: "block", rows: 3 },
      { key: "B", label: "Matrix B", default: "5 6\n7 8", kind: "block", rows: 3 },
    ],
    compute: (r) => {
      const A = readMatrix(r("A"));
      const B = readMatrix(r("B"));
      const p = multiply(A, B);
      if (!p) return { text: `Can't multiply: columns of A (${matCols(A)}) ≠ rows of B (${matRows(B)}).`, ok: false };
      return analyzeResultOf([{ kind: "matrix", label: "A·B =", m: p }]);
    },
  },
  {
    id: "transpose",
    name: "Transpose a matrix",
    hint: "Enter a matrix, one row per line.",
    fields: [{ key: "M", label: "Matrix", default: "1 2 3\n4 5 6", kind: "block", rows: 3 }],
    compute: (r) => {
      const M = readMatrix(r("M"));
      return analyzeResultOf([{ kind: "matrix", label: "Transpose =", m: transpose(M) }]);
    },
  },
  {
    id: "insights",
    name: "Data → trends, correlations & insights",
    hint: "Paste a data table (from a spreadsheet, CSV, or instrument). A header row is auto-detected; columns may be tab-, comma-, or space-separated.",
    fields: [
      {
        key: "data",
        label: "Data table",
        default: "dose,response\n1,12\n2,19\n4,31\n8,52\n16,84\n32,131",
        kind: "block",
        rows: 8,
      },
    ],
    compute: (r) => {
      const report = analyzeData(r("data"));
      if (!report) return { text: "Enter a data table with at least one row of values.", ok: false };
      return { text: report.text };
    },
  },
  {
    id: "optimize",
    name: "Minimize a function",
    hint: "Nelder–Mead minimization. Enter an objective over your variables and a starting guess. To maximize, negate the objective.",
    fields: [
      { key: "obj", label: "Objective f (minimize)", default: "(1-x)^2 + 100*(y - x^2)^2", kind: "text" },
      { key: "start", label: "Start (var = value, comma-separated)", default: "x = -1.2, y = 1", kind: "text" },
    ],
    compute: (r) => {
      const start = parseAssignments(r("start"));
      if (!start.names.length) return { text: "Enter at least one variable, e.g. x = 0.", ok: false };
      const obj = r("obj");
      const f = (vec: number[]): number => {
        const vars: Record<string, number> = {};
        start.names.forEach((n, i) => (vars[n] = vec[i]));
        return evalFormula(obj, vars);
      };
      try {
        const v0 = f(start.values);
        if (!Number.isFinite(v0)) return { text: "Objective is not finite at the start point.", ok: false };
      } catch (e) {
        return { text: `Objective error: ${(e as Error).message}`, ok: false };
      }
      const res = nelderMead(f, start.values);
      const at = start.names.map((n, i) => `${n} = ${formatNum(res.x[i], 6)}`).join(", ");
      const note = res.converged
        ? `converged in ${res.iterations} iterations`
        : `stopped after ${res.iterations} iterations — may not be a true minimum`;
      return { text: `Minimum f = ${formatNum(res.fx, 6)}\nat ${at}\n(${note})` };
    },
  },
  {
    id: "fft",
    name: "FFT / frequency spectrum",
    hint: "Paste a uniformly sampled signal (one value per line, or comma/space separated) and its sample rate. Non-power-of-two lengths are zero-padded.",
    fields: [
      {
        key: "signal",
        label: "Signal samples",
        default: "0\n0.707\n1\n0.707\n0\n-0.707\n-1\n-0.707",
        kind: "block",
        rows: 6,
      },
      { key: "fs", label: "Sample rate (e.g. Hz)", default: "8", kind: "text" },
    ],
    compute: (r) => {
      const signal = statList(r("signal"));
      const fs = Number(r("fs"));
      if (signal.length < 2) return { text: "Enter at least two samples.", ok: false };
      if (!Number.isFinite(fs) || fs <= 0) return { text: "Enter a positive sample rate.", ok: false };
      const bins = spectrum(signal, fs);
      const dom = dominantFrequencies(signal, fs, 3);
      const pts: Point[] = bins.map((b) => ({ x: b.freq, y: b.magnitude }));
      const svg = buildPlotSvg([{ points: pts, type: "line", color: "#2563eb", label: "|X(f)|" }], {
        title: "Amplitude spectrum",
        xlabel: "Frequency",
        ylabel: "Amplitude",
      });
      const domText = dom.length
        ? dom.map((d) => `${formatNum(d.freq, 4)} (amp ${formatNum(d.magnitude, 3)})`).join(", ")
        : "none";
      return analyzeResultOf([
        { kind: "line", text: `Dominant frequencies: ${domText}` },
        { kind: "plot", svg, caption: "Amplitude spectrum", alt: "FFT amplitude spectrum", w: 380, h: 270 },
      ]);
    },
  },
  {
    id: "ode",
    name: "Solve an ODE / system",
    hint: "Type the equation you actually have — higher order is reduced for you (y'' = -y works directly; give y and y' as initial values). One equation per line for a system. Report-at times accept a list (0, 1, 2) or a range (0:0.5:10) and are computed exactly, not interpolated. Stop-when takes an expression that ends the solve where it crosses zero — e.g. y for 'when it hits zero', or y - 100 for a threshold. Auto switches to the implicit (stiff) solver when needed, e.g. kinetics with widely separated rate constants. RHS may use t, the state names, and functions like exp, sin, tanh, sqrt, min/max, mod, and if(cond, a, b).",
    fields: [
      { key: "eqs", label: "Equations (one per line)", default: "y'' = -y", kind: "block", rows: 3 },
      { key: "y0", label: "Initial values", default: "y = 1, y' = 0", kind: "text" },
      { key: "trange", label: "t range (t0, t1)", default: "0, 6.2832", kind: "text" },
      {
        key: "tout",
        label: "Report at times (optional — blank = solver's own steps)",
        default: "",
        kind: "text",
      },
      {
        key: "stopwhen",
        label: "Stop when this hits zero (optional)",
        default: "",
        kind: "text",
      },
      {
        key: "method",
        label: "Solver",
        default: "auto",
        kind: "select",
        options: [
          { value: "auto", label: "Auto (detect stiffness)" },
          { value: "rk45", label: "Explicit RK45 (non-stiff; most accurate)" },
          { value: "stiff", label: "Implicit RODAS4 (stiff, 4th order)" },
        ],
      },
    ],
    compute: (r) => {
      // Higher-order equations are reduced to a first-order system here, so the
      // user can type y'' = -y rather than hand-reducing it themselves.
      const parsed = parseOdeSystem(r("eqs"), r("y0"));
      if (!parsed.ok) return { text: parsed.error, ok: false };
      const { states, rhs, y0, reduced } = parsed.system;
      const names = states.map((s) => s.label);
      const tr = statList(r("trange"));
      if (tr.length < 2) return { text: "Enter t0 and t1, e.g. 0, 6.2832.", ok: false };
      const f = (t: number, y: number[]): number[] =>
        rhs.map((expr) => {
          const vars: Record<string, number> = { t };
          states.forEach((s, i) => (vars[s.varName] = y[i]));
          return evalFormula(expr, vars);
        });
      try {
        const d0 = f(tr[0], y0);
        if (d0.some((v) => !Number.isFinite(v))) return { text: "The equations are not finite at t0.", ok: false };
      } catch (e) {
        return { text: `Equation error: ${(e as Error).message}`, ok: false };
      }
      const method = (r("method") || "auto") as OdeMethod;

      // Optional: report at times the user chose, rather than the solver's steps.
      const outParse = parseTimeList(r("tout"));
      if (!outParse.ok) return { text: outParse.error, ok: false };
      const tEval = outParse.times.length ? outParse.times : undefined;
      if (tEval && tEval.some((x) => (tr[1] >= tr[0] ? x < tr[0] || x > tr[1] : x > tr[0] || x < tr[1]))) {
        return { text: `Report-at times must lie within t ∈ [${formatNum(tr[0], 4)}, ${formatNum(tr[1], 4)}].`, ok: false };
      }

      // Optional: stop at the first zero crossing of a user expression.
      const stopSrc = r("stopwhen").trim();
      let events: OdeEvent[] | undefined;
      if (stopSrc) {
        const gExpr = rewriteStateExpression(stopSrc, parsed.system);
        const gFn = (t: number, y: number[]): number => {
          const vars: Record<string, number> = { t };
          states.forEach((s, i) => (vars[s.varName] = y[i]));
          return evalFormula(gExpr, vars);
        };
        try {
          const probe = gFn(tr[0], y0);
          if (!Number.isFinite(probe)) return { text: `"${stopSrc}" is not finite at t0.`, ok: false };
        } catch (e) {
          return { text: `Stop condition: ${(e as Error).message}`, ok: false };
        }
        events = [{ g: gFn, terminal: true, name: stopSrc }];
      }

      const sol = solveOde(f, y0, tr[0], tr[1], { method, tEval, events });
      // A terminal event returns completed:false by design — the solution ends at
      // the event. That is a successful answer, not a failure.
      const stoppedByEvent = sol.stopReason === "event";
      if (!sol.completed && !stoppedByEvent) {
        // Say what actually went wrong. "Stiff" is no longer a dead end — the
        // implicit solver exists — so the remaining honest causes are a genuine
        // singularity or a problem too hard for the step budget.
        const stalledAt = sol.t.length ? formatNum(sol.t[sol.t.length - 1], 6) : formatNum(tr[0], 6);
        const why =
          method === "rk45"
            ? "The explicit solver stalled — this system looks stiff. Switch the solver to Auto or Implicit (stiff)."
            : "The solution appears to blow up (a finite-time singularity) or the system is too hard for the step budget.";
        return { text: `Stopped at t = ${stalledAt} without reaching t1. ${why}`, ok: false };
      }
      if (stopSrc && !stoppedByEvent) {
        // The condition never triggered — say so rather than silently returning
        // a full-range solve that looks like it stopped somewhere meaningful.
        return {
          text: `"${stopSrc}" never reached zero over t ∈ [${formatNum(tr[0], 4)}, ${formatNum(tr[1], 4)}] — the solution ran to t1. Widen the range or check the condition.`,
          ok: false,
        };
      }
      // The table shows the times the user asked for when they asked for any;
      // otherwise it samples the solver's own steps.
      const sampled: Matrix = [];
      if (sol.evalT && sol.evalY && sol.evalT.length) {
        for (let i = 0; i < sol.evalT.length; i++) sampled.push([sol.evalT[i], ...sol.evalY[i]]);
      } else {
        const maxRows = 12;
        const stride = Math.max(1, Math.floor(sol.t.length / maxRows));
        for (let i = 0; i < sol.t.length; i += stride) sampled.push([sol.t[i], ...sol.y[i]]);
        if (sampled[sampled.length - 1][0] !== sol.t[sol.t.length - 1])
          sampled.push([sol.t[sol.t.length - 1], ...sol.y[sol.y.length - 1]]);
      }
      const colors = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed"];
      // A stiff run can accept thousands of steps; drawing every one bloats the
      // SVG (and the PNG it becomes) for no visible gain. Thin to a cap, always
      // keeping the endpoints so the curve still spans the full range.
      const MAX_PLOT_PTS = 800;
      const pStride = Math.max(1, Math.ceil(sol.t.length / MAX_PLOT_PTS));
      const idx: number[] = [];
      for (let k = 0; k < sol.t.length; k += pStride) idx.push(k);
      if (idx[idx.length - 1] !== sol.t.length - 1) idx.push(sol.t.length - 1);
      const series: Series[] = names.map((n, i) => ({
        points: idx.map((k) => ({ x: sol.t[k], y: sol.y[k][i] })),
        type: "line",
        color: colors[i % colors.length],
        label: n,
      }));
      const svg = buildPlotSvg(series, { title: "Solution", xlabel: "t", ylabel: "y" });
      const finalVals = names.map((n, i) => `${n}(${formatNum(tr[1], 4)}) = ${formatNum(sol.y[sol.y.length - 1][i], 6)}`).join(", ");
      const methodLabel: Record<string, string> = {
        rk45: "explicit RK45",
        stiff: "implicit RODAS4 (stiff)",
        "rk45→stiff": "RK45, auto-switched to the implicit stiff solver",
      };
      const hit = sol.events && sol.events.length ? sol.events[sol.events.length - 1] : null;
      const endT = sol.t[sol.t.length - 1];
      const blocks: AnalyzeBlock[] = [
        {
          kind: "line",
          text:
            `Solved over t ∈ [${formatNum(tr[0], 4)}, ${formatNum(hit ? endT : tr[1], 4)}] in ${sol.steps} steps using ${methodLabel[sol.method ?? "rk45"]}.` +
            (reduced
              ? ` Auto-reduced to a first-order system of ${states.length} states: ${names.join(", ")}.`
              : ""),
        },
      ];
      if (hit) {
        const at = names.map((n, i) => `${n} = ${formatNum(hit.y[i], 6)}`).join(", ");
        blocks.push({
          kind: "line",
          text: `Stopped: "${stopSrc}" reached zero at t = ${formatNum(hit.t, 6)} (${at}).`,
        });
      } else {
        blocks.push({ kind: "line", text: `Final: ${finalVals}` });
      }
      blocks.push({
        kind: "matrix",
        label: sol.evalT && sol.evalT.length ? `[t, ${names.join(", ")}] at your times:` : `Sampled [t, ${names.join(", ")}]:`,
        m: sampled,
      });
      blocks.push({ kind: "plot", svg, caption: "Solution trajectory", alt: "ODE solution trajectory", w: 380, h: 270 });
      return analyzeResultOf(blocks);
    },
  },
];

function populateAnalyzeCalcs(): void {
  analyzeCalcSelect.replaceChildren();
  for (const c of ANALYZE_CALCS) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    analyzeCalcSelect.appendChild(opt);
  }
}

/** Builds the inputs for the selected Analyze tool and wires live compute. */
function renderAnalyzeInputs(): void {
  const calc = ANALYZE_CALCS.find((c) => c.id === analyzeCalcSelect.value) ?? ANALYZE_CALCS[0];
  analyzeHint.textContent = calc.hint;
  analyzeInputs.replaceChildren();
  for (const f of calc.fields) {
    const row = document.createElement("div");
    row.className = "dna-controls";
    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = f.label;
    label.htmlFor = `analyze-f-${f.key}`;

    let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (f.kind === "text") {
      const t = document.createElement("input");
      t.type = "text";
      t.className = "rgroup-input";
      t.value = f.default;
      input = t;
    } else if (f.kind === "select") {
      const sel = document.createElement("select");
      sel.className = "mode-select";
      for (const o of f.options ?? []) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        sel.appendChild(opt);
      }
      sel.value = f.default;
      input = sel;
    } else {
      const ta = document.createElement("textarea");
      ta.className = "rgroup-input";
      ta.rows = f.rows ?? 4;
      ta.value = f.default;
      ta.spellcheck = false;
      input = ta;
    }
    input.id = `analyze-f-${f.key}`;
    input.dataset.key = f.key;
    input.addEventListener("input", updateAnalyzePreview);
    input.addEventListener("change", updateAnalyzePreview);
    row.append(label, input);
    analyzeInputs.appendChild(row);
  }
  updateAnalyzePreview();
}

/** Computes and shows the result for the current Analyze tool. */
function updateAnalyzePreview(): void {
  const calc = ANALYZE_CALCS.find((c) => c.id === analyzeCalcSelect.value) ?? ANALYZE_CALCS[0];
  const read = (k: string): string => {
    const el = analyzeInputs.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[data-key="${k}"]`
    );
    return el ? el.value : "";
  };
  let out: AnalyzeOutput;
  try {
    out = calc.compute(read);
  } catch (e) {
    out = { text: `Couldn't compute: ${(e as Error).message}`, ok: false };
  }
  // Block insertion of a non-finite result: formatNum renders Infinity/NaN as the
  // "—" sentinel (e.g. a matrix expression that divides by zero), and a dash must
  // never land in the document — matches the Stats-mode guard.
  const insertable = out.ok !== false && !!out.text && !out.text.includes("—");
  analyzeResult.innerHTML =
    out.blocks && insertable ? analyzeBlocksToPreviewHtml(out.blocks) : esc(out.text).replace(/\n/g, "<br>");
  currentAnalyzeText = insertable ? out.text : "";
  currentAnalyzeBlocks = insertable ? out.blocks ?? null : null;
  analyzeInsertBtn.disabled = !insertable;
}

/**
 * Inserts the current Analyze result at the cursor. Matrices go in as real,
 * right-aligned Word tables (so columns line up in any font); text lines and
 * labels become paragraphs. Falls back to plain text when there is no matrix.
 */
async function insertAnalysis(): Promise<void> {
  if (!currentAnalyzeText.trim()) {
    setStatus("Nothing to insert.", "error");
    return;
  }
  const blocks = currentAnalyzeBlocks;
  // No matrix/plot to lay out → the existing plain-text path is exactly right.
  if (!blocks || !blocks.some((b) => b.kind === "matrix" || b.kind === "plot")) {
    await insertDnaText(currentAnalyzeText, "Analysis");
    return;
  }
  if (insertTextBusy) return;
  insertTextBusy = true;
  try {
    // Render any plot SVGs to PNG before entering Word.run (the conversion is async).
    const images: Record<number, string> = {};
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.kind === "plot") images[i] = await svgToPngBase64(b.svg, b.w, b.h);
    }
    await Word.run(async (context) => {
      let anchor = context.document.getSelection().getRange(Word.RangeLocation.end);
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (block.kind === "line") {
          const para = anchor.insertParagraph(block.text, Word.InsertLocation.after);
          anchor = para.getRange(Word.RangeLocation.after);
          continue;
        }
        if (block.kind === "plot") {
          const para = anchor.insertParagraph(block.caption, Word.InsertLocation.after);
          const pic = para.insertInlinePictureFromBase64(images[i], Word.InsertLocation.end);
          pic.altTextDescription = block.alt;
          anchor = para.getRange(Word.RangeLocation.after);
          continue;
        }
        if (block.label) {
          const labelPara = anchor.insertParagraph(block.label, Word.InsertLocation.after);
          anchor = labelPara.getRange(Word.RangeLocation.after);
        }
        const values = block.m.map((row) => row.map((v) => formatNum(v, 6)));
        const table = anchor.insertTable(block.m.length, block.m[0].length, Word.InsertLocation.after, values);
        for (let i2 = 0; i2 < block.m.length; i2++)
          for (let j = 0; j < block.m[0].length; j++)
            table.getCell(i2, j).body.paragraphs.getFirst().alignment = Word.Alignment.right;
        anchor = table.getRange(Word.RangeLocation.after);
      }
      anchor.select(Word.SelectionMode.end);
      await context.sync();
    });
    setStatus("Analysis inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert analysis: ${(error as Error).message}`, "error");
  } finally {
    insertTextBusy = false;
  }
}

// ---------------------------------------------------------------------------
// Peptide — 2D structure from a sequence
// ---------------------------------------------------------------------------

/** Builds and previews the peptide structure for the current sequence input. */
function updatePeptide(): void {
  const seq = pepInput.value.trim();
  pepPreview.replaceChildren();
  pepInfo.replaceChildren();
  currentPeptideStructure = null;
  currentPeptideSeq = "";
  pepInsertBtn.disabled = true;

  const hint = (msg: string): void => {
    const h = document.createElement("span");
    h.className = "hint";
    h.textContent = msg;
    pepPreview.appendChild(h);
  };
  if (!seq) {
    hint("Type a peptide sequence (e.g. ACDEFG or Ala-Gly-Ser).");
    return;
  }

  const built = buildPeptide(seq);
  if (!built || !built.length) {
    hint("No valid amino acids found. Use one-letter (ACDEFG) or three-letter (Ala-Gly) codes.");
    return;
  }

  let structure: ReturnType<typeof renderStructure> = null;
  try {
    structure = renderStructure(built.smiles, STRUCTURE_W, STRUCTURE_H);
  } catch {
    structure = null;
  }
  if (!structure) {
    hint("Couldn't draw this peptide.");
    return;
  }
  currentPeptideStructure = structure;
  currentPeptideSeq = built.sequence;
  pepPreview.innerHTML = structure.svg;

  const bits = [`${built.length} residue${built.length === 1 ? "" : "s"}`, structure.formula, `MW ${structure.mw}`];
  const line = document.createElement("span");
  line.textContent = bits.join(" · ");
  pepInfo.appendChild(line);
  if (built.invalid.length) {
    const warn = document.createElement("span");
    warn.textContent = `Ignored unrecognized: ${built.invalid.join(", ")}`;
    pepInfo.appendChild(warn);
  }
  if (built.length > 20) {
    const dense = document.createElement("span");
    dense.textContent = "Long peptide — the 2D depiction will be dense.";
    pepInfo.appendChild(dense);
  }
  pepInsertBtn.disabled = false;
}

/** Inserts the current peptide's 2D structure as an inline picture. */
async function insertPeptide(): Promise<void> {
  const structure = currentPeptideStructure;
  if (!structure) {
    setStatus("No peptide structure to insert.", "error");
    return;
  }
  pepInsertBtn.disabled = true;
  setStatus("Inserting peptide structure…");
  try {
    const d = readSvgDims(structure.svg, STRUCTURE_W, STRUCTURE_H);
    const base64 = await svgToPngBase64(structure.svg, d.w, d.h);
    const alt = provenanceAltText(
      `Peptide ${currentPeptideSeq}`,
      structure.formula,
      structure.mw,
      structure.smiles,
      structure.idcode
    );
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      picture.altTextDescription = alt;
      range.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, picture.getRange(), "formula-inserter:peptide");
    });
    setStatus("Peptide structure inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert peptide: ${(error as Error).message}`, "error");
  } finally {
    pepInsertBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Mass spectrometry (exact mass, isotope pattern, adducts)
// ---------------------------------------------------------------------------

function msEyebrow(text: string): HTMLElement {
  const e = document.createElement("div");
  e.className = "prop-eyebrow";
  e.textContent = text;
  return e;
}

/** Computes and renders the MS readout for the current Mass Spec input. */
function updateMassSpec(): void {
  const text = msInput.value.trim();
  msResult.replaceChildren();
  currentMassSpec = null;
  msInsertBtn.disabled = true;
  if (!text) {
    const hint = document.createElement("div");
    hint.className = "ms-hint";
    hint.textContent = "Type a name, formula, or SMILES to see its mass spectrum.";
    msResult.appendChild(hint);
    return;
  }

  let spec: MassSpecResult | null = null;
  try {
    spec = computeMassSpec(text);
  } catch {
    spec = null;
  }
  if (!spec) {
    const hint = document.createElement("div");
    hint.className = "ms-hint";
    hint.textContent = "No structure found. Try a name (caffeine), a formula (C8H10N4O2), or a SMILES.";
    msResult.appendChild(hint);
    return;
  }
  currentMassSpec = spec;

  // Exact masses.
  const masses = document.createElement("div");
  masses.className = "ms-masses";
  for (const [k, v] of [
    ["Monoisotopic mass", spec.monoisotopicMass.toFixed(4)],
    ["Average mass", spec.averageMass.toFixed(2)],
    ["Formula", spec.formula],
  ] as [string, string][]) {
    const kk = document.createElement("span");
    kk.className = "ms-mass-k";
    kk.textContent = k;
    const vv = document.createElement("span");
    vv.className = "ms-mass-v";
    vv.textContent = v;
    masses.append(kk, vv);
  }
  msResult.append(msEyebrow("Exact mass"), masses);

  // Isotope pattern as horizontal bars (intensity relative to the base peak).
  msResult.appendChild(msEyebrow("Isotope pattern"));
  const peaks = document.createElement("div");
  peaks.className = "ms-peaks";
  for (const pk of spec.pattern) {
    const row = document.createElement("div");
    row.className = "ms-peak";
    const label = document.createElement("span");
    label.className = "ms-peak-label";
    label.textContent = pk.offset === 0 ? "M" : `M+${pk.offset}`;
    const track = document.createElement("div");
    track.className = "ms-bar-track";
    const bar = document.createElement("div");
    bar.className = "ms-bar";
    bar.style.width = `${Math.max(2, pk.intensity)}%`;
    track.appendChild(bar);
    const int = document.createElement("span");
    int.className = "ms-peak-int";
    int.textContent = `${pk.intensity.toFixed(1)}`;
    row.append(label, track, int);
    peaks.appendChild(row);
  }
  msResult.appendChild(peaks);
  if (spec.unsupportedInPattern.length) {
    const note = document.createElement("div");
    note.className = "ms-note";
    note.textContent = `Pattern excludes ${spec.unsupportedInPattern.join(", ")} (not in the isotope table); masses and adducts are still exact.`;
    msResult.appendChild(note);
  }

  // Adduct m/z. These assume a neutral precursor; if the structure already
  // carries a net charge, protonation/cationization adducts don't apply.
  msResult.appendChild(msEyebrow("Adducts (m/z)"));
  if (spec.netCharge !== 0) {
    const note = document.createElement("div");
    note.className = "ms-note";
    const sign = spec.netCharge > 0 ? `${spec.netCharge}+` : `${-spec.netCharge}−`;
    note.textContent = `Input carries a net charge (${sign}); ESI adducts assume a neutral molecule, so none are shown. The exact mass above is still valid.`;
    msResult.appendChild(note);
  } else {
    const adducts = document.createElement("div");
    adducts.className = "ms-adducts";
    for (const a of spec.adducts) {
      const name = document.createElement("span");
      name.className = "ms-adduct-name";
      name.textContent = a.name;
      const mz = document.createElement("span");
      mz.className = "ms-adduct-mz";
      mz.textContent = a.mz.toFixed(4);
      adducts.append(name, mz);
    }
    msResult.appendChild(adducts);
  }

  msInsertBtn.disabled = false;
}

/** Multi-line plain-text MS summary for insertion. */
function massSpecAsText(spec: MassSpecResult | null): string {
  if (!spec) return "";
  const lines = [
    `Mass spectrometry — ${spec.formula}`,
    `Monoisotopic mass: ${spec.monoisotopicMass.toFixed(4)}`,
    `Average mass: ${spec.averageMass.toFixed(2)}`,
    "Isotope pattern (relative intensity):",
    ...spec.pattern.map((p) => `  ${p.offset === 0 ? "M" : "M+" + p.offset}  ${p.mass.toFixed(4)}  ${p.intensity.toFixed(1)}%`),
    ...(spec.netCharge !== 0
      ? [`Adducts: n/a (input carries a net charge of ${spec.netCharge > 0 ? "+" : "−"}${Math.abs(spec.netCharge)}; ESI adducts assume a neutral molecule)`]
      : ["Adducts (m/z):", ...spec.adducts.map((a) => `  ${a.name}  ${a.mz.toFixed(4)}`)]),
    "Computed offline — verify before relying.",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Spectra — predicted 1H/13C NMR, IR, UV-Vis and EI fragmentation
//
// Every branch here renders values produced by the lib/ predictors and carries
// their caveats through to the UI verbatim. These are estimates from published
// additivity rules; the disclaimer is part of the feature, not decoration.
// ---------------------------------------------------------------------------

type SpectrumKind = "1H" | "13C" | "ir" | "uvvis" | "ms";

/** The currently displayed prediction, kept for the insert buttons. */
let currentSpectrum:
  | { kind: "1H" | "13C"; nmr: NmrResult }
  | { kind: "ir"; ir: IrResult }
  | { kind: "uvvis"; uv: UvResult }
  | { kind: "ms"; ms: FragmentResult }
  | null = null;
let currentSpectrumSvg: string | null = null;

function specRow(cells: string[], className = "spec-row"): HTMLElement {
  const row = document.createElement("div");
  row.className = className;
  for (const c of cells) {
    const s = document.createElement("span");
    s.textContent = c;
    row.appendChild(s);
  }
  return row;
}

/** Renders the caveats block. Never omitted — it is what keeps this honest. */
function specCaveats(caveats: string[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ms-note";
  for (const c of caveats) {
    const d = document.createElement("div");
    d.textContent = `• ${c}`;
    wrap.appendChild(d);
  }
  return wrap;
}

/** Builds the SVG chart for the current prediction, or null if not chartable. */
function buildSpectrumSvg(): string | null {
  const cur = currentSpectrum;
  if (!cur) return null;
  if (cur.kind === "ir") return irChartSvg(cur.ir.bands);
  if (cur.kind === "ms") return msChartSvg(cur.ms);
  if (cur.kind === "uvvis") return null; // a single λmax is a number, not a spectrum
  return nmrChartSvg(cur.nmr);
}

/** Computes and renders the selected prediction for the current input. */
function updateSpectra(): void {
  const text = specInput.value.trim();
  const kind = specKind.value as SpectrumKind;
  specResult.replaceChildren();
  currentSpectrum = null;
  currentSpectrumSvg = null;
  specInsertBtn.disabled = true;
  specInsertChartBtn.disabled = true;

  if (!text) {
    const hint = document.createElement("div");
    hint.className = "ms-hint";
    hint.textContent = "Type a name, formula, or SMILES to predict a spectrum.";
    specResult.appendChild(hint);
    return;
  }

  const fail = (msg: string) => {
    const hint = document.createElement("div");
    hint.className = "ms-hint";
    hint.textContent = msg;
    specResult.appendChild(hint);
  };

  try {
    if (kind === "1H" || kind === "13C") {
      const r = predictNmr(text, kind as Nucleus);
      if (!r) return fail("No structure found. Try a name (toluene), a formula, or a SMILES.");
      if (!r.signals.length) return fail("No signals predicted for this structure.");
      currentSpectrum = { kind, nmr: r };
      specResult.appendChild(msEyebrow(`Predicted ${kind} NMR — ${r.signals.length} signals`));
      const head = specRow(["δ (ppm)", kind === "1H" ? "H" : "C", kind === "1H" ? "mult." : "", "assignment"], "spec-row spec-head");
      specResult.appendChild(head);
      for (const s of r.signals) {
        specResult.appendChild(
          specRow([
            s.shift.toFixed(kind === "1H" ? 2 : 1),
            String(s.count),
            kind === "1H" ? s.multiplicity : "",
            s.assignment,
          ])
        );
      }
    } else if (kind === "ir") {
      const r = predictIr(text);
      if (!r) return fail("No structure found. Try a name (acetone), a formula, or a SMILES.");
      if (!r.bands.length) return fail("No characteristic IR bands predicted for this structure.");
      currentSpectrum = { kind, ir: r };
      specResult.appendChild(msEyebrow(`Predicted IR — ${r.bands.length} characteristic bands`));
      specResult.appendChild(specRow(["cm⁻¹", "range", "int.", "assignment"], "spec-row spec-head"));
      for (const b of r.bands) {
        specResult.appendChild(
          specRow([
            String(Math.round(b.wavenumber)),
            `${b.range[0]}-${b.range[1]}`,
            b.intensity.slice(0, 1) + (b.broad ? ",br" : ""),
            b.assignment,
          ])
        );
      }
    } else if (kind === "uvvis") {
      const r = predictUvVis(text);
      if (!r) return fail("No structure found. Try a name (mesityl oxide), a formula, or a SMILES.");
      currentSpectrum = { kind, uv: r };
      specResult.appendChild(msEyebrow("Predicted UV-Vis λmax"));
      const val = document.createElement("div");
      val.className = "ms-masses";
      const kk = document.createElement("span");
      kk.className = "ms-mass-k";
      kk.textContent = r.transparent ? "λmax" : "λmax (π→π*)";
      const vv = document.createElement("span");
      vv.className = "ms-mass-v";
      vv.textContent = r.lambdaMax === null ? "none above 200 nm" : `${r.lambdaMax} nm`;
      val.append(kk, vv);
      const ck = document.createElement("span");
      ck.className = "ms-mass-k";
      ck.textContent = "Chromophore";
      const cv = document.createElement("span");
      cv.className = "ms-mass-v";
      cv.textContent = r.chromophore;
      val.append(ck, cv);
      specResult.appendChild(val);
      if (r.contributions.length) {
        specResult.appendChild(msEyebrow("How this was built up"));
        for (const c of r.contributions) {
          specResult.appendChild(specRow([`${c.nm > 0 ? "+" : ""}${c.nm} nm`, c.label]));
        }
      }
    } else {
      const r = predictFragments(text);
      if (!r) return fail("No structure found. Try a name (toluene), a formula, or a SMILES.");
      currentSpectrum = { kind, ms: r };
      specResult.appendChild(msEyebrow(`Predicted EI fragments — ${r.formula}`));
      specResult.appendChild(specRow(["m/z", "formula", "rank", "pathway"], "spec-row spec-head"));
      specResult.appendChild(specRow([r.molecularIon.toFixed(4), r.formula, "M⁺•", "molecular ion"]));
      for (const f of r.fragments) {
        specResult.appendChild(specRow([f.mz.toFixed(4), f.formula, f.likelihood, `${f.pathway} (−${f.neutralLoss})`]));
      }
    }
  } catch (error) {
    return fail(`Could not predict: ${(error as Error).message}`);
  }

  const cur = currentSpectrum;
  if (!cur) return;
  const caveats =
    cur.kind === "ir"
      ? cur.ir.caveats
      : cur.kind === "uvvis"
        ? cur.uv.caveats
        : cur.kind === "ms"
          ? cur.ms.caveats
          : cur.nmr.caveats;
  specResult.appendChild(specCaveats([...caveats, "Predicted from structure — verify against an acquired spectrum."]));

  specInsertBtn.disabled = false;
  currentSpectrumSvg = buildSpectrumSvg();
  specInsertChartBtn.disabled = !currentSpectrumSvg;
}

/** Plain-text rendering of the current prediction, for insertion into Word. */
function spectrumAsText(): string {
  const cur = currentSpectrum;
  if (!cur) return "";
  const tail = "Predicted from structure (additivity rules), computed offline — verify against an acquired spectrum.";

  if (cur.kind === "1H" || cur.kind === "13C") {
    const r = cur.nmr;
    const lines = [
      `Predicted ${r.nucleus} NMR — ${r.smiles}`,
      ...r.signals.map((s) =>
        r.nucleus === "1H"
          ? `  δ ${s.shift.toFixed(2)}  (${s.count}H, ${s.multiplicity})  ${s.assignment}`
          : `  δ ${s.shift.toFixed(1)}  ${s.assignment}${s.count > 1 ? `  (${s.count} equivalent C)` : ""}`
      ),
      ...r.caveats.map((c) => `Note: ${c}`),
      tail,
    ];
    return lines.join("\n");
  }

  if (cur.kind === "ir") {
    const r = cur.ir;
    return [
      `Predicted IR — ${r.smiles}`,
      ...r.bands.map(
        (b) =>
          `  ${String(Math.round(b.wavenumber)).padStart(4)} cm-1  (${b.range[0]}-${b.range[1]}, ${b.intensity}${b.broad ? ", broad" : ""})  ${b.assignment}`
      ),
      ...r.caveats.map((c) => `Note: ${c}`),
      tail,
    ].join("\n");
  }

  if (cur.kind === "uvvis") {
    const r = cur.uv;
    return [
      `Predicted UV-Vis — ${r.smiles}`,
      `  Chromophore: ${r.chromophore}`,
      r.lambdaMax === null
        ? "  λmax: none above 200 nm (transparent in the usual UV-Vis window)"
        : `  λmax: ${r.lambdaMax} nm`,
      ...(r.contributions.length ? ["  Build-up:", ...r.contributions.map((c) => `    ${c.nm > 0 ? "+" : ""}${c.nm} nm  ${c.label}`)] : []),
      ...r.caveats.map((c) => `Note: ${c}`),
      tail,
    ].join("\n");
  }

  if (cur.kind === "ms") {
    const r = cur.ms;
    return [
      `Predicted EI fragmentation — ${r.formula}`,
      `  M+•  ${r.molecularIon.toFixed(4)}`,
      ...r.fragments.map(
        (f) => `  ${f.mz.toFixed(4)}  ${f.formula.padEnd(8)} [${f.likelihood}]  ${f.pathway} (−${f.neutralLoss})`
      ),
      ...r.caveats.map((c) => `Note: ${c}`),
      tail,
    ].join("\n");
  }
  return "";
}

/** Inserts the current spectrum chart as a picture. */
async function insertSpectrumChart(): Promise<void> {
  if (!currentSpectrumSvg) {
    setStatus("No chart available for this spectrum.", "error");
    return;
  }
  specInsertChartBtn.disabled = true;
  setStatus("Inserting spectrum…");
  try {
    const base64 = await svgToPngBase64(
      currentSpectrumSvg,
      SPECTRUM_CHART_SIZE.width * 2,
      SPECTRUM_CHART_SIZE.height * 2
    );
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      picture.altTextDescription = `Predicted spectrum (${specKind.value}) for ${specInput.value.trim()} — estimate from additivity rules`;
      range.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, picture.getRange(), "formula-inserter:spectrum");
    });
    setStatus("Spectrum inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert spectrum: ${(error as Error).message}`, "error");
  } finally {
    specInsertChartBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Bio / Assay calculators (enzyme kinetics, dose-response, binding, lab math)
// ---------------------------------------------------------------------------

interface AssayField {
  key: string;
  label: string;
  default: string;
  kind?: "number" | "list" | "select";
  options?: { value: string; label: string }[];
}
/** A fitted curve to overlay on the Plot engine: the data plus a predictor. */
interface AssayPlot {
  data: Point[];
  predict: (x: number) => number;
  xlabel: string;
  ylabel: string;
}
interface AssayOutput {
  text: string;
  plot?: AssayPlot;
  /** False for a validation message (blocks insertion). Defaults to true. */
  ok?: boolean;
}
interface AssayCalc {
  id: string;
  name: string;
  fields: AssayField[];
  compute: (read: (k: string) => string) => AssayOutput;
}

/** Parses a whitespace/comma/semicolon-separated list of numbers. */
function assayList(s: string): number[] {
  return s
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}
/** Formats to `sig` significant figures without trailing-zero noise. */
function assaySig(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return "—";
  if (x === 0) return "0";
  return Number(x.toPrecision(sig)).toString();
}
/** "value ± se", dropping the ± part when the standard error is unavailable. */
function assayValSE(val: number, se: number): string {
  return Number.isFinite(se) ? `${assaySig(val)} ± ${assaySig(se, 2)}` : assaySig(val);
}
/** Pairs two equal-length lists into plot points, or null if they can't fit. */
function assayPairXY(xs: number[], ys: number[], minPts: number): Point[] | null {
  if (xs.length < minPts || xs.length !== ys.length) return null;
  return xs.map((x, i) => ({ x, y: ys[i] }));
}

const ASSAY_CALCS: AssayCalc[] = [
  {
    id: "mm",
    name: "Michaelis–Menten (enzyme kinetics)",
    fields: [
      { key: "s", label: "[S] substrate (one per value)", default: "1, 2, 5, 10, 20, 50", kind: "list" },
      { key: "v", label: "v velocity (matching [S])", default: "1.333, 2.4, 4.615, 6.667, 8.571, 10.345", kind: "list" },
    ],
    compute: (r) => {
      const s = assayList(r("s"));
      const v = assayList(r("v"));
      const pts = assayPairXY(s, v, 3);
      if (!pts) return { text: "Enter equal-length [S] and v lists (≥ 3 points).", ok: false };
      const fit = fitMichaelisMenten(s, v);
      if (!fit.converged || !(fit.vmax > 0) || !(fit.km > 0))
        return { text: "Fit did not converge — check that the data follow saturation kinetics.", ok: false };
      const text =
        `Michaelis–Menten fit\n` +
        `Vmax = ${assayValSE(fit.vmax, fit.vmaxSE)}\n` +
        `Km = ${assayValSE(fit.km, fit.kmSE)}\n` +
        `R² = ${assaySig(fit.rsquared, 4)}`;
      return { text, plot: { data: pts, predict: fit.predict, xlabel: "[S]", ylabel: "v" } };
    },
  },
  {
    id: "hill",
    name: "Hill equation (cooperativity)",
    fields: [
      { key: "s", label: "[S] or [ligand]", default: "1, 2, 5, 10, 20, 50", kind: "list" },
      { key: "v", label: "response (matching [S])", default: "0.27, 1.0, 4.098, 7.353, 9.174, 9.858", kind: "list" },
    ],
    compute: (r) => {
      const s = assayList(r("s"));
      const v = assayList(r("v"));
      const pts = assayPairXY(s, v, 4);
      if (!pts) return { text: "Enter equal-length lists (≥ 4 points).", ok: false };
      const fit = fitHill(s, v);
      if (!fit.converged || !(fit.vmax > 0) || !(fit.k > 0))
        return { text: "Fit did not converge — check the data.", ok: false };
      const text =
        `Hill fit\n` +
        `Vmax = ${assaySig(fit.vmax)}\n` +
        `K (half-saturation) = ${assaySig(fit.k)}\n` +
        `Hill coefficient n = ${assaySig(fit.hill, 3)}\n` +
        `R² = ${assaySig(fit.rsquared, 4)}`;
      return { text, plot: { data: pts, predict: fit.predict, xlabel: "[S]", ylabel: "response" } };
    },
  },
  {
    id: "dose",
    name: "Dose–response 4PL (IC50 / EC50)",
    fields: [
      { key: "c", label: "Concentration (linear, not log)", default: "0.01, 0.1, 0.3, 1, 3, 10, 100", kind: "list" },
      { key: "y", label: "Response (matching concentration)", default: "0.5, 4.76, 13.04, 33.33, 60, 83.33, 98.04", kind: "list" },
    ],
    compute: (r) => {
      const c = assayList(r("c"));
      const y = assayList(r("y"));
      const pts = assayPairXY(c, y, 4);
      if (!pts) return { text: "Enter equal-length concentration and response lists (≥ 4 points).", ok: false };
      const fit = fitDoseResponse(c, y);
      if (!fit.converged || !(fit.ec50 > 0))
        return { text: "Fit did not converge — check the data span both plateaus.", ok: false };
      const label = fit.top >= fit.bottom ? "EC50" : "IC50";
      const text =
        `Dose–response (4-parameter logistic)\n` +
        `${label} = ${assaySig(fit.ec50)}\n` +
        `pEC50 = ${assaySig(fit.pEC50, 3)}\n` +
        `Hill slope = ${assaySig(fit.hill, 3)}\n` +
        `Bottom = ${assaySig(fit.bottom, 3)}, Top = ${assaySig(fit.top, 3)}\n` +
        `R² = ${assaySig(fit.rsquared, 4)}`;
      return { text, plot: { data: pts, predict: fit.predict, xlabel: "concentration", ylabel: "response" } };
    },
  },
  {
    id: "binding",
    name: "Saturation binding (one-site, Bmax/Kd)",
    fields: [
      { key: "l", label: "[Ligand] (one per value)", default: "1, 2, 5, 10, 25, 50, 100", kind: "list" },
      { key: "b", label: "Bound (matching [Ligand])", default: "38.46, 71.43, 147.06, 227.27, 337.84, 403.23, 446.43", kind: "list" },
    ],
    compute: (r) => {
      const l = assayList(r("l"));
      const b = assayList(r("b"));
      const pts = assayPairXY(l, b, 3);
      if (!pts) return { text: "Enter equal-length [Ligand] and Bound lists (≥ 3 points).", ok: false };
      const fit = fitSaturationBinding(l, b);
      if (!fit.converged || !(fit.bmax > 0) || !(fit.kd > 0))
        return { text: "Fit did not converge — check the data.", ok: false };
      const text =
        `One-site saturation binding\n` +
        `Bmax = ${assayValSE(fit.bmax, fit.bmaxSE)}\n` +
        `Kd = ${assayValSE(fit.kd, fit.kdSE)}\n` +
        `R² = ${assaySig(fit.rsquared, 4)}`;
      return { text, plot: { data: pts, predict: fit.predict, xlabel: "[Ligand]", ylabel: "Bound" } };
    },
  },
  {
    id: "chengprusoff",
    name: "Cheng–Prusoff (Ki from IC50)",
    fields: [
      { key: "ic50", label: "IC50", default: "100" },
      { key: "s", label: "[Substrate] (or [ligand])", default: "8" },
      { key: "km", label: "Km (or Kd)", default: "8" },
    ],
    compute: (r) => ({ text: `Ki = ${assaySig(chengPrusoff(+r("ic50"), +r("s"), +r("km")))}` }),
  },
  {
    id: "efficiency",
    name: "Catalytic efficiency (kcat, kcat/Km)",
    fields: [
      { key: "vmax", label: "Vmax", default: "12" },
      { key: "e", label: "[Enzyme] total", default: "0.001" },
      { key: "km", label: "Km", default: "8" },
    ],
    compute: (r) => {
      const kc = kcat(+r("vmax"), +r("e"));
      return { text: `kcat = ${assaySig(kc)}\nkcat/Km = ${assaySig(catalyticEfficiency(kc, +r("km")))}` };
    },
  },
  {
    id: "hh",
    name: "Henderson–Hasselbalch (buffer pH)",
    fields: [
      { key: "pka", label: "pKa", default: "4.76" },
      { key: "base", label: "[A⁻] conjugate base", default: "0.1" },
      { key: "acid", label: "[HA] acid", default: "0.1" },
    ],
    compute: (r) => ({ text: `pH = ${assaySig(hendersonHasselbalch(+r("pka"), +r("base"), +r("acid")), 4)}` }),
  },
  {
    id: "beer",
    name: "Beer–Lambert (concentration from A)",
    fields: [
      { key: "a", label: "Absorbance A", default: "0.65" },
      { key: "eps", label: "ε (M⁻¹cm⁻¹)", default: "6500" },
      { key: "l", label: "Path length l (cm)", default: "1" },
    ],
    compute: (r) => ({ text: `c = ${assaySig(beerLambert({ a: +r("a"), epsilon: +r("eps"), l: +r("l") }))} M` }),
  },
  {
    id: "dilution",
    name: "Dilution (C1·V1 = C2·V2)",
    fields: [
      { key: "c1", label: "Stock concentration C1", default: "1" },
      { key: "c2", label: "Final concentration C2", default: "0.1" },
      { key: "v2", label: "Final volume V2", default: "10" },
    ],
    compute: (r) => {
      const v1 = stockVolumeNeeded(+r("c1"), +r("c2"), +r("v2"));
      return { text: `V1 (stock) = ${assaySig(v1)}\nDiluent to add = ${assaySig(+r("v2") - v1)}` };
    },
  },
  {
    id: "serial",
    name: "Serial dilution plan",
    fields: [
      { key: "start", label: "Starting concentration", default: "100" },
      { key: "fold", label: "Fold per step", default: "10" },
      { key: "n", label: "Number of steps", default: "6" },
    ],
    compute: (r) => {
      const start = +r("start");
      const fold = +r("fold");
      const n = Math.floor(+r("n"));
      if (!Number.isFinite(start) || !Number.isFinite(fold) || !Number.isFinite(n) || n < 1) {
        return { text: "Enter a numeric starting concentration, fold, and step count.", ok: false };
      }
      const steps = serialDilution(start, fold, Math.min(n, 50)); // cap to keep the readout sane
      const note = n > 50 ? `\n(showing first 50 of ${n} steps)` : "";
      return { text: "Serial dilution\n" + steps.map((s) => `Step ${s.step}: ${assaySig(s.concentration)}`).join("\n") + note };
    },
  },
  {
    id: "na260",
    name: "Nucleic-acid conc. (A260)",
    fields: [
      { key: "a260", label: "A260", default: "1" },
      {
        key: "kind",
        label: "Type",
        default: "dsDNA",
        kind: "select",
        options: [
          { value: "dsDNA", label: "dsDNA (×50)" },
          { value: "ssDNA", label: "ssDNA (×33)" },
          { value: "RNA", label: "RNA (×40)" },
        ],
      },
      { key: "dil", label: "Dilution factor", default: "1" },
    ],
    compute: (r) => ({
      text: `Concentration = ${assaySig(nucleicAcidConc(+r("a260"), r("kind") as NucleicAcidKind, +r("dil")))} µg/mL`,
    }),
  },
  {
    id: "protein280",
    name: "Protein conc. (A280)",
    fields: [
      { key: "a280", label: "A280", default: "1" },
      { key: "eps", label: "ε molar (M⁻¹cm⁻¹)", default: "43824" },
      { key: "l", label: "Path length l (cm)", default: "1" },
    ],
    compute: (r) => ({ text: `Concentration = ${assaySig(proteinConcFromA280(+r("a280"), +r("eps"), +r("l")))} M` }),
  },
];

function populateAssayCalcs(): void {
  assayCalcSelect.replaceChildren();
  for (const c of ASSAY_CALCS) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    assayCalcSelect.appendChild(opt);
  }
}

/** Builds the inputs for the selected assay calculator and wires live compute. */
function renderAssayInputs(): void {
  const calc = ASSAY_CALCS.find((c) => c.id === assayCalcSelect.value) ?? ASSAY_CALCS[0];
  assayInputs.replaceChildren();
  for (const f of calc.fields) {
    const row = document.createElement("div");
    row.className = "dna-controls";
    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = f.label;
    label.htmlFor = `assay-f-${f.key}`;

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
    input.id = `assay-f-${f.key}`;
    input.dataset.key = f.key;
    input.addEventListener("input", updateAssayPreview);
    input.addEventListener("change", updateAssayPreview);
    row.append(label, input);
    assayInputs.appendChild(row);
  }
  updateAssayPreview();
}

/** Computes and shows the result (and any fitted-curve plot) for the current inputs. */
function updateAssayPreview(): void {
  const calc = ASSAY_CALCS.find((c) => c.id === assayCalcSelect.value) ?? ASSAY_CALCS[0];
  const read = (k: string): string => {
    const el = assayInputs.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-key="${k}"]`);
    return el ? el.value : "";
  };
  if (calc.fields.some((f) => f.kind !== "select" && read(f.key).trim() === "")) {
    assayResult.innerHTML = '<span class="hint">Enter all values to compute.</span>';
    assayPreview.innerHTML = "";
    currentAssayText = "";
    currentAssayPlotSvg = "";
    assayInsertBtn.disabled = true;
    assayInsertPlotBtn.disabled = true;
    return;
  }

  let out: AssayOutput;
  try {
    out = calc.compute(read);
  } catch {
    out = { text: "Could not compute — check the inputs.", ok: false };
  }
  // Exclude the "—" no-value sentinel (from a non-finite computation) so a
  // dash placeholder is never inserted into the document.
  const insertable = out.ok !== false && !!out.text && !out.text.includes("—");
  assayResult.innerHTML = esc(out.text).replace(/\n/g, "<br>");

  // Draw the fitted curve over the raw data when the calculator produced one.
  if (out.plot && insertable) {
    const { data, predict, xlabel, ylabel } = out.plot;
    const xs = data.map((p) => p.x);
    const xmin = Math.min(...xs);
    const xmax = Math.max(...xs);
    const fitPts: Point[] = [];
    const N = 120;
    for (let i = 0; i <= N; i++) {
      const x = xmin + ((xmax - xmin) * i) / N;
      fitPts.push({ x, y: predict(x) });
    }
    const series: Series[] = [
      { points: data, type: "scatter", label: "data" },
      { points: fitPts, type: "line", label: "fit" },
    ];
    const svg = buildPlotSvg(series, { xlabel, ylabel });
    assayPreview.innerHTML = svg;
    currentAssayPlotSvg = svg;
    assayInsertPlotBtn.disabled = false;
  } else {
    assayPreview.innerHTML = "";
    currentAssayPlotSvg = "";
    assayInsertPlotBtn.disabled = true;
  }

  currentAssayText = insertable ? out.text : "";
  assayInsertBtn.disabled = !insertable;
}

/** Rasterizes the fitted-curve plot and inserts it as an inline picture. */
async function insertAssayPlot(): Promise<void> {
  if (!currentAssayPlotSvg) {
    setStatus("No fitted plot to insert.", "error");
    return;
  }
  assayInsertPlotBtn.disabled = true;
  setStatus("Inserting fit plot…");
  try {
    const base64 = await svgToPngBase64(currentAssayPlotSvg, 380, 270);
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      const calc = ASSAY_CALCS.find((c) => c.id === assayCalcSelect.value);
      picture.altTextDescription = `Assay fit: ${calc?.name ?? "curve"}`;
      range.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, picture.getRange(), "formula-inserter:assay");
    });
    setStatus("Fit plot inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert fit plot: ${(error as Error).message}`, "error");
  } finally {
    assayInsertPlotBtn.disabled = false;
  }
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
  // The "→ Short form" helper only applies to a full case citation.
  citeShortFormBtn.style.display = type.id === "case" ? "block" : "none";
  // The T6 abbreviation toggle applies to case citations.
  citeAbbrevWrap.style.display = type.id === "case" || type.id === "case-short" ? "flex" : "none";
  // The "Id." preceding-authority helper only applies to the Id. type.
  citeIdDetectBtn.style.display = type.id === "id" ? "block" : "none";
  if (type.id !== "id") citeIdDetectMsg.textContent = "";
  // The supra source-detection helper only applies to the supra type.
  citeSupraDetectBtn.style.display = type.id === "supra" ? "block" : "none";
  if (type.id !== "supra") citeSupraDetectMsg.textContent = "";
  updateCitationPreview();
}

/** Turns the current full-case fields into a case short-form citation. */
function makeCaseShortForm(): void {
  const read = (k: string): string => {
    const el = citeInputs.querySelector<HTMLInputElement>(`[data-key="${k}"]`);
    return el ? el.value.trim() : "";
  };
  const short = caseShortForm({ name: read("name"), vol: read("vol"), reporter: read("reporter"), pin: read("pin") });
  citeTypeSelect.value = "case-short";
  renderCitationInputs(); // rebuild fields for the short form
  for (const [key, value] of Object.entries(short)) {
    const el = citeInputs.querySelector<HTMLInputElement>(`[data-key="${key}"]`);
    if (el) el.value = value;
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
  const isCase = type.id === "case" || type.id === "case-short";
  const abbreviate = isCase && citeAbbrevCheckbox.checked;
  const read = (k: string): string => {
    const el = citeInputs.querySelector<HTMLInputElement>(`[data-key="${k}"]`);
    const value = el ? el.value.trim() : "";
    // Apply Table T6 to the case name when the toggle is on.
    return k === "name" && abbreviate ? abbreviateCaseName(value) : value;
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
    currentCitation = applySignal(citeSignalSelect.value, type.format(read, citeStyleSelect.value as CitationStyle));
  } catch {
    citePreview.innerHTML = '<span class="hint">Couldn’t format this citation — check the fields.</span>';
    return;
  }
  citePreview.innerHTML = currentCitation.html;
  // Advisory: flag a reporter we don't recognize so a typo'd/wrong-form reporter
  // isn't inserted unnoticed.
  const rep = read("reporter");
  if (isCase && rep && !isKnownReporter(rep)) {
    citePreview.innerHTML += `<div class="hint" style="margin-top:4px">⚠ “${esc(rep)}” isn’t a recognized reporter — check the Bluebook abbreviation (Table T1).</div>`;
  }
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

/** Finds the authority preceding the cursor and inserts an "Id." referring to it. */
async function insertIdForPreceding(): Promise<void> {
  citeIdDetectBtn.disabled = true;
  citeIdDetectMsg.className = "build-readout";
  setStatus("Finding the preceding authority…");
  try {
    await Word.run(async (context) => {
      const selection = context.document.getSelection();
      const before = context.document.body.getRange(Word.RangeLocation.start).expandTo(selection);
      before.load("text");
      await context.sync();
      const authority = findPrecedingAuthority(before.text);
      if (!authority) {
        citeIdDetectMsg.className = "build-readout warn";
        citeIdDetectMsg.textContent = "No preceding authority found above the cursor — “Id.” needs one.";
        setStatus("No preceding authority found.", "");
        return;
      }
      const pin = (citeInputs.querySelector<HTMLInputElement>('[data-key="pin"]')?.value ?? "").trim();
      const html = pin ? `<i>Id.</i> at ${esc(pin)}` : "<i>Id.</i>";
      const inserted = selection.insertHtml(html, Word.InsertLocation.replace);
      inserted.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, inserted, "formula-inserter:citation");
      citeIdDetectMsg.className = "build-readout";
      citeIdDetectMsg.textContent = `Inserted “Id.” — refers to ${authority.plain}.`;
      setStatus("Id. inserted.", "success");
    });
  } catch (error) {
    setStatus(`Could not insert Id.: ${(error as Error).message}`, "error");
  } finally {
    citeIdDetectBtn.disabled = false;
  }
}

/** Scans above the cursor for an earlier law-review article and fills the supra author. */
async function detectSupraSource(): Promise<void> {
  citeSupraDetectBtn.disabled = true;
  citeSupraDetectMsg.className = "build-readout";
  setStatus("Looking for an earlier source above the cursor…");
  try {
    await Word.run(async (context) => {
      const selection = context.document.getSelection();
      const before = context.document.body.getRange(Word.RangeLocation.start).expandTo(selection);
      before.load("text");
      await context.sync();
      const source = findPrecedingSecondarySource(before.text);
      if (!source) {
        citeSupraDetectMsg.className = "build-readout warn";
        citeSupraDetectMsg.textContent = "No earlier law-review article found above the cursor — enter the author manually.";
        setStatus("No earlier source found.", "");
        return;
      }
      const nameEl = citeInputs.querySelector<HTMLInputElement>('[data-key="name"]');
      if (nameEl) nameEl.value = source.short;
      updateCitationPreview();
      citeSupraDetectMsg.className = "build-readout";
      citeSupraDetectMsg.textContent = `Found ${source.plain} — filled “${source.short}”. Add the footnote no. / pincite.`;
      setStatus("Earlier source detected.", "success");
    });
  } catch (error) {
    setStatus(`Could not detect an earlier source: ${(error as Error).message}`, "error");
  } finally {
    citeSupraDetectBtn.disabled = false;
  }
}

/**
 * Builds a native Word Table of Authorities: marks each citation with a hidden
 * TA field, then inserts TOA fields at the cursor. The user presses F9 to
 * populate page numbers.
 */
async function buildNativeToaHandler(): Promise<void> {
  toaNativeBtn.disabled = true;
  // Field marking uses OOXML insertion (WordApi 1.3); fall back gracefully.
  if (!wordApiSupported("1.3")) {
    toaMsg.className = "build-readout warn";
    toaMsg.textContent =
      "This version of Word doesn’t support the field-based table — use “Insert static list” instead (no auto page numbers).";
    toaNativeBtn.disabled = false;
    return;
  }
  toaMsg.className = "build-readout";
  setStatus("Marking citations for Word’s Table of Authorities…");
  try {
    await Word.run(async (context) => {
      const body = context.document.body;
      body.load("text");
      await context.sync();
      const marks = authoritiesForToa(body.text);
      if (!marks.length) {
        toaMsg.textContent = "No citations found to build a Table of Authorities.";
        setStatus("No citations found.", "");
        return;
      }
      // Clear any existing TA marks first, so stale/malformed marks (e.g. a
      // corrupted "CONCLUSION…" entry) can't survive into the rebuilt table.
      if (wordApiSupported("1.4")) {
        const existing = body.fields;
        existing.load("items/code");
        await context.sync();
        const stale = existing.items.filter((f) => isTaFieldCode(f.code));
        for (const f of stale) f.delete();
        if (stale.length) await context.sync();
      }
      // Mark every occurrence of each authority with a hidden TA field, so the
      // table shows the full page range (Word aggregates pages by the \l text).
      let authoritiesMarked = 0;
      let occurrences = 0;
      const categoryNums = new Set<number>();
      for (const mark of marks) {
        const results = body.search(mark.locator, { matchCase: false });
        results.load("items");
        await context.sync();
        if (!results.items.length) continue;
        const ooxml = taFieldOoxml(mark.name, mark.rest, mark.categoryNum);
        for (const hit of results.items) hit.insertOoxml(ooxml, Word.InsertLocation.before);
        categoryNums.add(mark.categoryNum);
        authoritiesMarked++;
        occurrences += results.items.length;
      }
      await context.sync();
      // Insert the TOA fields (one per marked category) at the cursor, wrapped in
      // a tagged content control so the "formatted list" button can find this
      // exact block, copy its F9'd page numbers, and replace it cleanly.
      const selection = context.document.getSelection();
      const toaRange = selection.insertOoxml(toaFieldsOoxml([...categoryNums]), Word.InsertLocation.replace);
      await context.sync();
      try {
        const cc = toaRange.insertContentControl();
        cc.tag = TOA_FIELD_CC_TAG;
        cc.title = "JurisLab TOA (field — will be replaced)";
        await context.sync();
      } catch {
        // Content controls unsupported here — the field table is still usable.
      }
      // Make Word's generated entries Times New Roman 12 (court-brief template).
      await setTableStylesToTimesNewRoman(context, ["Table of Authorities"]);
      toaMsg.textContent =
        `Marked ${authoritiesMarked} of ${marks.length} authorit${marks.length === 1 ? "y" : "ies"} ` +
        `(${occurrences} citation${occurrences === 1 ? "" : "s"}). ` +
        "Now: select all (Ctrl/⌘+A), press F9 to fill page numbers, then click “Insert formatted list”.";
      setStatus("Field table inserted — press F9, then click “Insert formatted list”.", "success");
    });
  } catch (error) {
    setStatus(`Could not build the field-based Table of Authorities: ${(error as Error).message}`, "error");
  } finally {
    toaNativeBtn.disabled = false;
  }
}

/**
 * Inserts a native Word Table of Contents field (built from heading styles) at
 * the cursor. Real page numbers appear when the user presses F9 (FRAP 28(a)(2)).
 */
async function buildTocHandler(): Promise<void> {
  tocBuildBtn.disabled = true;
  toaMsg.className = "build-readout";
  if (!wordApiSupported("1.3")) {
    toaMsg.className = "build-readout warn";
    toaMsg.textContent =
      "This version of Word doesn’t support field insertion — use Word’s References ▸ Table of Contents instead.";
    tocBuildBtn.disabled = false;
    return;
  }
  setStatus("Inserting a Table of Contents field…");
  try {
    await Word.run(async (context) => {
      const selection = context.document.getSelection();
      selection.insertOoxml(tocFieldOoxml(3), Word.InsertLocation.replace);
      await context.sync();
      // Make Word's generated TOC entries Times New Roman 12 (court-brief template).
      await setTableStylesToTimesNewRoman(context, ["TOC 1", "TOC 2", "TOC 3"]);
      toaMsg.textContent =
        "Table of Contents inserted from your heading styles (Heading 1–3). " +
        "Select all (Ctrl/⌘+A) and press F9 to fill in the page numbers. " +
        "Make sure your section titles use Word’s Heading styles so they appear.";
      setStatus("Table of Contents (field) inserted — press F9 to update.", "success");
    });
  } catch (error) {
    setStatus(`Could not insert the Table of Contents: ${(error as Error).message}`, "error");
  } finally {
    tocBuildBtn.disabled = false;
  }
}

/** Plain-text rendering of a citation register (for display and copying). */
function registerToText(reg: CitationRegister, pages: Map<string, string>): string {
  const pg = (plain: string): string => {
    const p = pages.get(toaEntryKey(plain));
    return p ? `  — p. ${p}` : "";
  };
  const head = `Found ${reg.authorities} authorit${reg.authorities === 1 ? "y" : "ies"} in ${reg.citations} citation${reg.citations === 1 ? "" : "s"}.`;
  const lines = [pages.size ? head : head + " (build the field-based TOA and press F9, then Find again to see pages)"];
  if (reg.repeated.length) {
    lines.push("", `Cited more than once (${reg.repeated.length}):`);
    for (const e of reg.repeated) lines.push(`  ${e.plain}  ×${e.count}${pg(e.plain)}`);
  }
  let lastHeading = "";
  lines.push("", "All authorities:");
  for (const e of reg.entries) {
    if (e.heading !== lastHeading) {
      lines.push(`— ${e.heading} —`);
      lastHeading = e.heading;
    }
    lines.push(`  ${e.plain}  ×${e.count}${pg(e.plain)}`);
  }
  return lines.join("\n");
}

/**
 * Scans the whole document and shows a citation register in the task pane:
 * every distinct authority with a usage count, repeated authorities flagged.
 * Nothing is written to the document; it always reflects the current text.
 */
async function findCitationsHandler(): Promise<void> {
  toaFindBtn.disabled = true;
  setStatus("Scanning document for citations…");
  try {
    await Word.run(async (context) => {
      const body = context.document.body;
      body.load("text");
      await context.sync();
      const reg = citationRegister(body.text);
      if (!reg.authorities) {
        toaRegister.textContent = "No citations found in the document.";
        toaCopyRegisterBtn.style.display = "none";
        setStatus("No citations found.", "");
        return;
      }
      // Page numbers, if a native TOA has already been built and updated (F9).
      const pages = parseToaPages(body.text);
      lastRegisterText = registerToText(reg, pages);
      toaRegister.textContent = lastRegisterText;
      toaCopyRegisterBtn.style.display = "";
      const rep = reg.repeated.length;
      setStatus(
        `Found ${reg.authorities} authorities in ${reg.citations} citations` +
          (rep ? `; ${rep} cited more than once.` : "."),
        "success"
      );
    });
  } catch (error) {
    setStatus(`Could not scan for citations: ${(error as Error).message}`, "error");
  } finally {
    toaFindBtn.disabled = false;
  }
}

/** Copies the current citation register to the clipboard. */
async function copyRegister(): Promise<void> {
  if (!lastRegisterText) return;
  try {
    await navigator.clipboard.writeText(lastRegisterText);
    setStatus("Citation register copied to clipboard.", "success");
  } catch {
    setStatus("Clipboard unavailable — select the register text to copy.", "");
  }
}

/**
 * Removes every hidden TA (citation) field from the document body, so a
 * malformed or duplicated Table of Authorities can be rebuilt from a clean
 * slate. Leaves the TOA field, DATE fields, and all other fields untouched.
 * Undoable with Word's Undo (Ctrl/⌘+Z).
 */
async function clearCitationMarksHandler(): Promise<void> {
  if (!wordApiSupported("1.4")) {
    toaMsg.className = "build-readout warn";
    toaMsg.textContent =
      "This version of Word can’t remove fields automatically — turn on ¶ (Show/Hide) and delete the TA fields by hand.";
    return;
  }
  toaClearMarksBtn.disabled = true;
  toaMsg.className = "build-readout";
  setStatus("Removing citation (TA) marks…");
  try {
    await Word.run(async (context) => {
      const fields = context.document.body.fields;
      fields.load("items/code");
      await context.sync();
      const taFields = fields.items.filter((f) => isTaFieldCode(f.code));
      if (!taFields.length) {
        toaMsg.textContent = "No citation (TA) marks found in the document.";
        setStatus("No citation marks found.", "");
        return;
      }
      for (const f of taFields) f.delete();
      await context.sync();
      toaMsg.textContent =
        `Removed ${taFields.length} citation mark${taFields.length === 1 ? "" : "s"}. ` +
        "Rebuild with “Insert with page numbers”, then select all (Ctrl/⌘+A) and press F9. " +
        "(Ctrl/⌘+Z undoes this.)";
      setStatus(`Removed ${taFields.length} citation marks.`, "success");
    });
  } catch (error) {
    setStatus(`Could not remove citation marks: ${(error as Error).message}`, "error");
  } finally {
    toaClearMarksBtn.disabled = false;
  }
}

/**
 * Removes generated table fields — the Table of Contents (TOC) and Table of
 * Authorities (TOA) — from the document body. Paired with "Remove all citation
 * marks", this fully resets the tables so they can be rebuilt. Leaves the TA
 * marks and other fields untouched. Undoable with Word's Undo (Ctrl/⌘+Z).
 */
async function clearTablesHandler(): Promise<void> {
  if (!wordApiSupported("1.4")) {
    toaMsg.className = "build-readout warn";
    toaMsg.textContent =
      "This version of Word can’t remove fields automatically — select the table and delete it by hand.";
    return;
  }
  toaClearTablesBtn.disabled = true;
  toaMsg.className = "build-readout";
  setStatus("Removing Table of Contents / Authorities fields…");
  try {
    await Word.run(async (context) => {
      const fields = context.document.body.fields;
      fields.load("items/code");
      await context.sync();
      const tables = fields.items.filter((f) => isTableFieldCode(f.code));
      if (!tables.length) {
        toaMsg.textContent = "No Table of Contents or Table of Authorities fields found.";
        setStatus("No table fields found.", "");
        return;
      }
      for (const f of tables) f.delete();
      await context.sync();
      toaMsg.textContent =
        `Removed ${tables.length} table field${tables.length === 1 ? "" : "s"} (TOC/TOA). ` +
        "Re-insert with the buttons above. (Ctrl/⌘+Z undoes this.)";
      setStatus(`Removed ${tables.length} table fields.`, "success");
    });
  } catch (error) {
    setStatus(`Could not remove the table fields: ${(error as Error).message}`, "error");
  } finally {
    toaClearTablesBtn.disabled = false;
  }
}

/** Scans the document for citations and inserts a grouped Table of Authorities. */
async function buildToaHandler(): Promise<void> {
  toaBuildBtn.disabled = true;
  toaMsg.className = "build-readout";
  setStatus("Scanning document for citations…");
  try {
    await Word.run(async (context) => {
      const body = context.document.body;
      body.load("text");
      await context.sync();
      const toa = buildTableOfAuthorities(body.text);
      if (!toa.total) {
        toaMsg.textContent = "No citations found to build a Table of Authorities.";
        setStatus("No citations found.", "");
        return;
      }
      // Pull page numbers from an existing built field-TOA, if present.
      const pages = parseToaPages(body.text);
      const ooxml = wordApiSupported("1.3") ? toaStaticOoxml(toa, pages) : null;

      // If a field table from "Insert with live page numbers" is present, replace
      // that exact block (its title, headings, and fields) with the formatted
      // list — so nothing is left behind to clean up.
      let replacedField = false;
      const ccs = context.document.contentControls.getByTag(TOA_FIELD_CC_TAG);
      ccs.load("items");
      await context.sync();
      const fieldCc = ccs.items[0];

      let inserted: Word.Range;
      if (fieldCc && ooxml) {
        inserted = fieldCc.insertOoxml(ooxml, Word.InsertLocation.replace);
        await context.sync();
        try {
          fieldCc.delete(true); // remove the wrapper, keep the new formatted content
          await context.sync();
        } catch {
          /* wrapper removal best-effort */
        }
        replacedField = true;
      } else {
        const range = context.document.getSelection();
        inserted = ooxml
          ? range.insertOoxml(ooxml, Word.InsertLocation.replace)
          : range.insertHtml(toaToHtml(toa), Word.InsertLocation.replace);
        inserted.select(Word.SelectionMode.end);
        await context.sync();
        await tagInserted(context, inserted, "formula-inserter:toa");
      }

      const summary = toa.groups.map((g) => `${g.entries.length} ${g.heading.toLowerCase()}`).join(", ");
      let pageNote: string;
      if (pages.size) pageNote = `Page numbers filled in (${pages.size}).` + (replacedField ? " The field table was replaced." : "");
      else
        pageNote =
          "Page slots are blank — Word can only compute pages through a field. To fill them: click " +
          "“Insert with live page numbers”, select all (Ctrl/⌘+A) and press F9, then click “Insert formatted list”.";
      toaMsg.textContent = `Inserted ${toa.total} authorit${toa.total === 1 ? "y" : "ies"} (${summary}), Times New Roman, italic names. ${pageNote}`;
      setStatus("Formatted Table of Authorities inserted.", pages.size ? "success" : "");
    });
  } catch (error) {
    setStatus(`Could not build the Table of Authorities: ${(error as Error).message}`, "error");
  } finally {
    toaBuildBtn.disabled = false;
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
    cc.title = "JurisLab";
    cc.appearance = Word.ContentControlAppearance.hidden;
    await context.sync();
  } catch {
    // Content controls unsupported here — the inserted content remains in place.
  }
}

/**
 * Best-effort: set the given built-in style names to Times New Roman 12 pt so
 * Word's generated TOC/TOA entries match the court-brief template. Word builds
 * field entries with these styles, so direct formatting on the field alone
 * won't reach them — the style font must be set. Isolated + guarded: if styles
 * aren't accessible on this build, the tables are left in the default font.
 */
async function setTableStylesToTimesNewRoman(context: Word.RequestContext, styleNames: string[]): Promise<void> {
  if (!wordApiSupported("1.5")) return;
  try {
    const styles = context.document.getStyles();
    styles.load("items/nameLocal");
    await context.sync();
    let changed = false;
    for (const name of styleNames) {
      const style = styles.items.find((s) => s.nameLocal === name);
      if (!style) continue;
      style.font.name = "Times New Roman";
      style.font.size = 12;
      changed = true;
    }
    if (changed) await context.sync();
  } catch {
    // Styles not accessible here — leave the tables in the default font.
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
    // Encode in chunks: spreading a large byte array into String.fromCharCode(...)
    // overflows the argument/stack limit for big figures (flowcharts, dense plots).
    const bytes = new TextEncoder().encode(svg);
    let binary = "";
    for (let k = 0; k < bytes.length; k += 8192) {
      binary += String.fromCharCode(...bytes.subarray(k, k + 8192));
    }
    const svgBase64 = btoa(binary);
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
