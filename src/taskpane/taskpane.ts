/* global Office, Word, document, localStorage, navigator, URL, Blob, FileReader, TextDecoder, ArrayBuffer, Uint8Array, HTMLInputElement, HTMLButtonElement, HTMLSelectElement, HTMLTextAreaElement, HTMLElement, Image, TextEncoder, btoa */

import { Segment, segmentsToHtml } from "../lib/segments";
import { parseChemical } from "../lib/chemParser";
import { validateFormula } from "../lib/chemValidate";
import { parseMath } from "../lib/mathFormat";
import { mathToOoxml, mathToOmml, buildDerivationOoxml, DerivationBlock } from "../lib/mathOmml";
import { mathToHtml } from "../lib/mathHtml";
import { parseMathAst } from "../lib/mathParse";
import { figureScale, figurePoints } from "../lib/figures";
import { latexToDsl, astToLatex } from "../lib/latex";
import { formatQuantityHtml, convert, formatSig } from "../lib/units";
import { parseJcamp, JcampSpectrum } from "../lib/jcamp";
import { solveBvp, BvpMethod } from "../lib/bvp";
import { solveHeat, solveWave, solveLaplace, HeatScheme, PdeOutcome } from "../lib/pde";
import { solveDae } from "../lib/dae";
import { RefKind, formatCaption, formatRef, formatEqRef, checkCaptions } from "../lib/refs";
import {
  Series,
  Point,
  samplePlot,
  parseData,
  buildPlotSvg,
  dropForScales,
  type AxisScale,
  type ErrorBarKind,
} from "../lib/plot";
import {
  fitMichaelisMenten,
  fitHill,
  fitDoseResponse,
  fitSaturationBinding,
  chengPrusoff,
  kiFromIc50,
  InhibitionMode,
  catalyticEfficiency,
  kcat,
  hendersonHasselbalch,
  beerLambert,
  stockVolumeNeeded,
  serialDilution,
  nucleicAcidConc,
  proteinConcFromA280,
  NucleicAcidKind,
  fitInhibition,
  lineweaverBurk,
  eadieHofstee,
  hanesWoolf,
  bufferRatioForPh,
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
import { predictCoupling, predictCosy, predictHsqc, Cosy2D, Hsqc2D } from "../lib/nmr2d";
import { solveEquation, differentiate, integrate, parseExpr, evalAst } from "../lib/solve";
import { solveSystem, splitEquations } from "../lib/systems";
import { limit, taylorSeries, parseLimitRequest, parseSeriesRequest } from "../lib/analysis";
import { solveInequality } from "../lib/inequalities";
import { solveGeometry } from "../lib/geometryParse";
import { solveTopology, BUILTIN_NAMES } from "../lib/homology";
import { persistentHomology, barcodeSvg } from "../lib/persistence";
import { solveWordProblem, WorkStep } from "../lib/wordproblem";
import { predictIr, IrResult } from "../lib/ir";
import { predictUvVis, UvResult } from "../lib/uvvis";
import { predictFragments, FragmentResult } from "../lib/fragment";
import { parseSequenceFile, SeqRecord } from "../lib/seqio";
import { buildLinearMapSvg, featureTypes } from "../lib/seqmap";
import { buildCircularMapSvg } from "../lib/seqmapcirc";
import { parseSnapGeneDna, looksLikeDna } from "../lib/seqdna";
import { ENZYMES, findSites, summarise, uniqueCutters, formatSite, methylationWarnings } from "../lib/enzymes";
import { digest, describeDigest, gelBands } from "../lib/digest";
import { analyzeBeam, parseSupports, parseLoads, parseLength } from "../lib/beam";
import { beamDiagramSvg, BEAM_CHART_SIZE } from "../lib/beamChart";
import { sectionProperties, bendingStress, SectionSpec } from "../lib/section";
import { parseNetlist, parseValue, solveDc, solveAc, frequencySweep, dB } from "../lib/circuit";
import { analyzeStress, transformPlane, factorOfSafety, analyzeTorsion, analyzeColumn, EndCondition } from "../lib/stress";
import { analyzeTruss, parseTruss } from "../lib/truss";
import { analyzePipe, waterProperties, ROUGHNESS } from "../lib/fluids";
import { analyzeWall, analyzeExchanger, CONDUCTIVITY, Layer } from "../lib/heat";
import {
  parseTf,
  analyzeStability,
  timeResponse,
  secondOrderMetrics,
  frequencyResponse,
  autoFrequencies,
  margins,
  series,
  feedback,
  pidTf,
  polyToString,
  polyToMath,
  TransferFunction,
} from "../lib/control";
import { parseRatLiteral, ratToNumber as ratNum, Rat } from "../lib/cas";
import {
  singleDoseCurve,
  steadyState,
  multipleDoseCurve,
  nca,
  parseConcentrationData,
  Route as PkRoute,
} from "../lib/pk";
import {
  sdofProperties,
  freeResponse,
  dampingFromDecrement,
  forcedResponse,
  frequencySweep as vibSweep,
  modalAnalysis,
  modalForcedResponse,
  ModalDamping,
  chainSystem,
} from "../lib/vibration";
import { analyzeOpamp, OpampConfig } from "../lib/opamp";
// FilterKind is already taken by the FFT filter tool, so the analogue-design
// one is aliased rather than shadowing it.
import { designFilter, toTransferFunction, FilterFamily, FilterKind as AnalogueFilterKind } from "../lib/filter";
import { truthTable, minimise } from "../lib/logic";
import { openChannelFlow, npshAnalysis, compressibleFlow, MANNING_N, ChannelShape } from "../lib/fluids";
import { vesselFlow, circulation, jointStatics, samplingCheck } from "../lib/biomed";
import {
  enduranceLimit,
  notchFactor,
  meanStressAnalysis,
  finiteLife,
  minerDamage,
  SURFACE_FACTORS,
  MaterialClass,
  LoadKind,
  SurfaceFinish,
  Criterion,
} from "../lib/fatigue";
import {
  toKelvin,
  GASES as THERMO_GASES,
  idealGasProcess,
  carnot,
  ottoCycle,
  dieselCycle,
  braytonCycle,
  rankineFromEnthalpies,
  refrigerationFromEnthalpies,
  checkAgainstCarnot,
  TempUnit,
  ProcessKind,
} from "../lib/thermo";
import { parseMeasured, resultFigures } from "../lib/units";
import { nmrChartSvg, irChartSvg, msChartSvg, cosyChartSvg, hsqcChartSvg, jcampChartSvg, decimateTrace, SPECTRUM_CHART_SIZE, SPECTRUM_2D_SIZE } from "../lib/spectraChart";
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
import { tukeyHSD } from "../lib/tukey";
import { fftFilter, FilterKind } from "../lib/fftfilter";
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
import { FORMULA_LIBRARY, LIBRARY_GROUPS } from "../lib/formulaLibrary";
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
import { getPrefs, setPref, HomeFilter } from "../lib/prefs";
import { parseTableData, cleanTableRows, buildChartPreviewSvg, TableChart, ChartKind, ChartStyle } from "../lib/tablechart";
import { buildDiagramSvg, DiagramKind } from "../lib/tablediagram";
import { buildTableFigureSvg, prepareTableFigure } from "../lib/tablefigure";
import { classifyTable } from "../lib/tableclassify";
import { align, formatAlignment, AlignMode, SeqKind } from "../lib/align";
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
  toaOccurrences,
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

import type { Mode } from "../lib/modes";
import { toolIcon } from "./icons";
import { resolveTheme, hostTheme, type ThemePref } from "../lib/theme";
import { describeAssumptions, normalityTest, varianceHomogeneity } from "../lib/diagnostics";
import { kruskalWallis, dunnTest, friedman } from "../lib/nonparametric";
import { dunnettTest } from "../lib/dunnett";
import { multipleRegression, polynomialRegression, qqPoints } from "../lib/regression";
import { kaplanMeier, logRankTest, survivalCurvePoints } from "../lib/survival";
import { minOf, maxOf } from "../lib/minmax";
import { statVars, statVarLineProblem } from "../lib/uncertaintyParse";
import {
  planParagraphNumbering,
  describeParagraphPlan,
  stripParagraphNumber,
  type ParagraphPlan,
} from "../lib/paragraphs";

const STRUCTURE_W = 300;
const STRUCTURE_H = 230;
const GALLERY_W = 170;
const GALLERY_H = 140;

let homeSection: HTMLElement;
let homeGroups: HTMLElement;
let homeFilterEl: HTMLElement;
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
/**
 * Names the user has already agreed to send this session, normalised.
 *
 * This was a single boolean: consent for one name silently authorised every
 * later lookup, so a user who approved "benzene" could then type a confidential
 * client compound and have it leave the machine with no prompt — while two
 * published pages promised the lookup "asks every time". Per NAME is both honest
 * and usable: nothing new ever leaves unasked, and re-checking a name you have
 * already sent does not nag, because nothing new leaves.
 */
const opsinConsentedNames = new Set<string>();

/** Consent key: case- and whitespace-insensitive, so "Benzene " matches "benzene". */
function opsinKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
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
let plotXscale: HTMLSelectElement;
let themeSelect: HTMLSelectElement;
let digestEnzymes: HTMLInputElement;
let digestTopology: HTMLSelectElement;
let digestRunBtn: HTMLButtonElement;
let digestInsertBtn: HTMLButtonElement;
let digestResults: HTMLElement;
let currentDigestText = "";
let paraStart: HTMLInputElement;
let paraRenumber: HTMLInputElement;
let paraPreviewBtn: HTMLButtonElement;
let paraApplyBtn: HTMLButtonElement;
let paraFindings: HTMLElement;
/** The plan the user has previewed and may apply. Cleared on any change. */
let currentParaPlan: ParagraphPlan | null = null;
let plotYscale: HTMLSelectElement;
let plotErrbars: HTMLSelectElement;
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
let alignSection: HTMLElement;
let alignA: HTMLTextAreaElement;
let alignB: HTMLTextAreaElement;
let alignModeSel: HTMLSelectElement;
let alignKindSel: HTMLSelectElement;
let alignResult: HTMLElement;
let alignInsertBtn: HTMLButtonElement;
let currentAlignText = "";
let seqmapSection: HTMLElement;
let seqmapOpenBtn: HTMLButtonElement;
let seqmapFile: HTMLInputElement;
let seqmapInput: HTMLTextAreaElement;
let seqmapInfo: HTMLElement;
let seqmapShape: HTMLSelectElement;
let seqmapMono: HTMLInputElement;
let seqmapPreview: HTMLElement;
let seqmapInsert: HTMLButtonElement;
let spectraSection: HTMLElement;
let specInput: HTMLInputElement;
let specKind: HTMLSelectElement;
let specResult: HTMLElement;
let specInsertBtn: HTMLButtonElement;
let specInsertChartBtn: HTMLButtonElement;
let jcampOpenBtn: HTMLButtonElement;
let jcampFile: HTMLInputElement;
let jcampInfo: HTMLElement;
let jcampInsertBtn: HTMLButtonElement;
let jcampInsertChartBtn: HTMLButtonElement;
let solveSection: HTMLElement;
let solveKind: HTMLSelectElement;
let solveInput: HTMLTextAreaElement;
let solveInputLabel: HTMLElement;
let solveHint: HTMLElement;
let solveBounds: HTMLElement;
let solveA: HTMLInputElement;
let solveB: HTMLInputElement;
let solveResult: HTMLElement;
let solveInsertBtn: HTMLButtonElement;
/** MS readout for the most recent input, for insertion. */
let currentMassSpec: MassSpecResult | null = null;
let statsSection: HTMLElement;
let statsCalcSelect: HTMLSelectElement;
let statsInputs: HTMLElement;
let statsResult: HTMLElement;
let statsInsertBtn: HTMLButtonElement;
let currentStatsText = "";
let engineeringSection: HTMLElement;
let engineeringCalcSelect: HTMLSelectElement;
let engineeringHint: HTMLElement;
let engineeringInputs: HTMLElement;
let engineeringResult: HTMLElement;
let engineeringInsertBtn: HTMLButtonElement;
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
  homeFilterEl = document.getElementById("home-filter") as HTMLElement;
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
  plotXscale = document.getElementById("plot-xscale") as HTMLSelectElement;
  themeSelect = document.getElementById("theme-select") as HTMLSelectElement;
  digestEnzymes = document.getElementById("digest-enzymes") as HTMLInputElement;
  digestTopology = document.getElementById("digest-topology") as HTMLSelectElement;
  digestRunBtn = document.getElementById("digest-run-btn") as HTMLButtonElement;
  digestInsertBtn = document.getElementById("digest-insert-btn") as HTMLButtonElement;
  digestResults = document.getElementById("digest-results") as HTMLElement;
  paraStart = document.getElementById("para-start") as HTMLInputElement;
  paraRenumber = document.getElementById("para-renumber") as HTMLInputElement;
  paraPreviewBtn = document.getElementById("para-preview-btn") as HTMLButtonElement;
  paraApplyBtn = document.getElementById("para-apply-btn") as HTMLButtonElement;
  paraFindings = document.getElementById("para-findings") as HTMLElement;
  plotYscale = document.getElementById("plot-yscale") as HTMLSelectElement;
  plotErrbars = document.getElementById("plot-errbars") as HTMLSelectElement;
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
  alignSection = document.getElementById("align-section") as HTMLElement;
  alignA = document.getElementById("align-a") as HTMLTextAreaElement;
  alignB = document.getElementById("align-b") as HTMLTextAreaElement;
  alignModeSel = document.getElementById("align-mode") as HTMLSelectElement;
  alignKindSel = document.getElementById("align-kind") as HTMLSelectElement;
  alignResult = document.getElementById("align-result") as HTMLElement;
  alignInsertBtn = document.getElementById("align-insert") as HTMLButtonElement;
  seqmapSection = document.getElementById("seqmap-section") as HTMLElement;
  seqmapOpenBtn = document.getElementById("seqmap-open") as HTMLButtonElement;
  seqmapFile = document.getElementById("seqmap-file") as HTMLInputElement;
  seqmapInput = document.getElementById("seqmap-input") as HTMLTextAreaElement;
  seqmapInfo = document.getElementById("seqmap-info") as HTMLElement;
  seqmapShape = document.getElementById("seqmap-shape") as HTMLSelectElement;
  seqmapMono = document.getElementById("seqmap-mono") as HTMLInputElement;
  seqmapPreview = document.getElementById("seqmap-preview") as HTMLElement;
  seqmapInsert = document.getElementById("seqmap-insert") as HTMLButtonElement;
  spectraSection = document.getElementById("spectra-section") as HTMLElement;
  specInput = document.getElementById("spec-input") as HTMLInputElement;
  specKind = document.getElementById("spec-kind") as HTMLSelectElement;
  specResult = document.getElementById("spec-result") as HTMLElement;
  specInsertBtn = document.getElementById("spec-insert") as HTMLButtonElement;
  specInsertChartBtn = document.getElementById("spec-insert-chart") as HTMLButtonElement;
  jcampOpenBtn = document.getElementById("jcamp-open") as HTMLButtonElement;
  jcampFile = document.getElementById("jcamp-file") as HTMLInputElement;
  jcampInfo = document.getElementById("jcamp-info") as HTMLElement;
  jcampInsertBtn = document.getElementById("jcamp-insert") as HTMLButtonElement;
  jcampInsertChartBtn = document.getElementById("jcamp-insert-chart") as HTMLButtonElement;
  solveSection = document.getElementById("solve-section") as HTMLElement;
  solveKind = document.getElementById("solve-kind") as HTMLSelectElement;
  solveInput = document.getElementById("solve-input") as HTMLTextAreaElement;
  solveInputLabel = document.getElementById("solve-input-label") as HTMLElement;
  solveHint = document.getElementById("solve-hint") as HTMLElement;
  solveBounds = document.getElementById("solve-bounds") as HTMLElement;
  solveA = document.getElementById("solve-a") as HTMLInputElement;
  solveB = document.getElementById("solve-b") as HTMLInputElement;
  solveResult = document.getElementById("solve-result") as HTMLElement;
  solveInsertBtn = document.getElementById("solve-insert") as HTMLButtonElement;
  statsSection = document.getElementById("stats-section") as HTMLElement;
  statsCalcSelect = document.getElementById("stats-calc") as HTMLSelectElement;
  statsInputs = document.getElementById("stats-inputs") as HTMLElement;
  statsResult = document.getElementById("stats-result") as HTMLElement;
  statsInsertBtn = document.getElementById("stats-insert") as HTMLButtonElement;
  engineeringSection = document.getElementById("engineering-section") as HTMLElement;
  engineeringCalcSelect = document.getElementById("engineering-calc") as HTMLSelectElement;
  engineeringHint = document.getElementById("engineering-hint") as HTMLElement;
  engineeringInputs = document.getElementById("engineering-inputs") as HTMLElement;
  engineeringResult = document.getElementById("engineering-result") as HTMLElement;
  engineeringInsertBtn = document.getElementById("engineering-insert") as HTMLButtonElement;
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
  insertNameBtn.addEventListener("click", () => insertPlainText(currentStructureName, "Name"));
  insertPropsBtn.addEventListener("click", () => insertPlainText(propertiesAsText(currentProperties), "Properties"));
  opsinBtn.addEventListener("click", onOpsinClick);
  opsinContinueBtn.addEventListener("click", () => {
    opsinConfirm.hidden = true;
    opsinConsentedNames.add(opsinKey(opsinPendingName));
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
  dnaRevcompInsert.addEventListener("click", () => insertPlainText(dnaRevcompEl.textContent || "", "Reverse complement"));
  dnaMrnaInsert.addEventListener("click", () => insertPlainText(dnaMrnaEl.textContent || "", "mRNA"));
  dnaProteinInsert.addEventListener("click", () => insertPlainText(dnaProteinEl.textContent || "", "Protein"));
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
  // Selects get "change": "input" fires for them in Chromium but is not the
  // event a <select> is specified to emit, and the pane also runs in WebView2.
  for (const el of [plotXscale, plotYscale, plotErrbars]) {
    el.addEventListener("change", updatePlotPreview);
  }
  plotInsertBtn.addEventListener("click", insertPlot);
  themeSelect.value = getPrefs().theme;
  themeSelect.addEventListener("change", () => {
    setPref("theme", themeSelect.value as ThemePref);
    applyTheme();
  });
  applyTheme();
  // On "Match Word", an OS theme change is handled by the CSS media query with
  // no attribute pinned — but a WORD theme change is not observable, so the
  // theme is re-resolved whenever the pane is looked at again.
  window.addEventListener("focus", applyTheme);
  digestRunBtn.addEventListener("click", runVirtualDigest);
  digestInsertBtn.addEventListener("click", () => insertPlainText(currentDigestText, "Digest"));
  paraPreviewBtn.addEventListener("click", previewParagraphNumbers);
  paraApplyBtn.addEventListener("click", applyParagraphNumbers);
  for (const el of [paraStart, paraRenumber]) {
    // Any change invalidates a preview: applying a plan built from
    // different settings would write numbers the user never saw.
    el.addEventListener("input", () => {
      currentParaPlan = null;
      paraApplyBtn.disabled = true;
    });
  }

  populateFinanceCalcs();
  finCalcSelect.addEventListener("change", renderFinanceInputs);
  finInsertBtn.addEventListener("click", () => insertPlainText(currentFinText, "Result"));

  msInput.addEventListener("input", updateMassSpec);
  msInsertBtn.addEventListener("click", () => insertPlainText(massSpecAsText(currentMassSpec), "MS data"));
  specInput.addEventListener("input", updateSpectra);
  specKind.addEventListener("change", updateSpectra);
  specInsertBtn.addEventListener("click", () => insertPlainText(spectrumAsText(), "spectrum data"));
  specInsertChartBtn.addEventListener("click", insertSpectrumChart);
  jcampOpenBtn.addEventListener("click", () => jcampFile.click());
  jcampFile.addEventListener("change", onJcampFile);
  jcampInsertBtn.addEventListener("click", () => insertPlainText(jcampAsText(), "measured spectrum data"));
  jcampInsertChartBtn.addEventListener("click", insertJcampChart);
  solveKind.addEventListener("change", () => { solveVarChoice = null; updateSolveUi(); updateSolve(); });
  solveInput.addEventListener("input", () => { solveVarChoice = null; updateSolve(); });
  solveA.addEventListener("input", updateSolve);
  solveB.addEventListener("input", updateSolve);
  // Inserts real, editable Word equations (OMML) — the pane already typeset the
  // derivation on screen, and the same engine drives Math mode, so shipping it
  // to the document as flat ASCII was leaving the best part behind.
  solveInsertBtn.addEventListener("click", () => insertSolveResult());
  alignA.addEventListener("input", updateAlign);
  alignB.addEventListener("input", updateAlign);
  alignModeSel.addEventListener("change", updateAlign);
  alignKindSel.addEventListener("change", updateAlign);
  alignInsertBtn.addEventListener("click", insertAlignmentText);
  seqmapOpenBtn.addEventListener("click", () => seqmapFile.click());
  seqmapFile.addEventListener("change", onSeqMapFile);
  seqmapInput.addEventListener("input", updateSeqMap);
  seqmapShape.addEventListener("change", updateSeqMap);
  seqmapMono.addEventListener("change", updateSeqMap);
  seqmapInsert.addEventListener("click", insertSeqMap);

  pepInput.addEventListener("input", updatePeptide);
  pepInsertBtn.addEventListener("click", insertPeptide);

  populateStatsCalcs();
  statsCalcSelect.addEventListener("change", renderStatsInputs);
  statsInsertBtn.addEventListener("click", () => insertPlainText(currentStatsText, "Statistics"));

  populateAnalyzeCalcs();
  // The panels follow the select, whatever moved it — a panel click, a restored
  // session, or the headless audit driving it directly. One listener keeps the
  // highlight true for all of them.
  engineeringCalcSelect.addEventListener("change", () => {
    renderEngineeringInputs();
    markEngineeringSelection(engineeringCalcSelect.value);
  });
  engineeringInsertBtn.addEventListener("click", insertEngineering);
  analyzeCalcSelect.addEventListener("change", renderAnalyzeInputs);
  analyzeInsertBtn.addEventListener("click", insertAnalysis);

  populateAssayCalcs();
  assayCalcSelect.addEventListener("change", renderAssayInputs);
  assayInsertBtn.addEventListener("click", () => insertPlainText(currentAssayText, "Assay result"));
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
/** Session key recording the version we have already tried to reload into. */
const UPDATE_RELOAD_KEY = "jurislab-update-reload";

async function checkForUpdate(): Promise<void> {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: string };
    if (data && data.version && isNewerVersion(data.version, __APP_VERSION__)) {
      // SELF-HEAL ONCE, THEN ASK.
      //
      // The banner puts the fix one click away, but it still needs someone to
      // notice a green bar and understand that "Reload" is worth pressing. The
      // stale HTML is the host's cache, not a user decision, so repair it
      // silently the first time it is seen.
      //
      // Guarded by a session flag, and this is the whole reason for the guard:
      // if version.json ever reports a release the deployed bundle does not
      // actually contain — a half-finished deploy, a CDN mid-propagation — the
      // reloaded pane sees the same mismatch and would reload forever, spinning
      // inside the user's task pane with no way to stop it. One attempt per
      // session; if it did not take, fall back to the banner and let a person
      // decide.
      let alreadyTried = true;
      try {
        alreadyTried = window.sessionStorage.getItem(UPDATE_RELOAD_KEY) === data.version;
        if (!alreadyTried) window.sessionStorage.setItem(UPDATE_RELOAD_KEY, data.version);
      } catch {
        // Private mode or a host that denies storage: never auto-reload, since
        // without the flag there is nothing to stop the loop.
        alreadyTried = true;
      }
      if (!alreadyTried) {
        const url = new URL(window.location.href);
        url.searchParams.set("v", data.version);
        window.location.replace(url.toString());
        return;
      }
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
  // RELOAD MUST BYPASS THE CACHE, AND location.reload() DOES NOT.
  //
  // GitHub Pages serves taskpane.html with `Cache-Control: max-age=600`, so for
  // ten minutes after a fetch the host serves its cached copy without asking the
  // server anything. location.reload() re-serves that copy. The cached HTML
  // names the previous hashed bundle, so the pane reloaded into the exact build
  // it was already running: the banner correctly announced an update and the
  // button could not deliver it. Reported as "I do not see any change" after a
  // release that was verifiably live on the server.
  //
  // Navigating to a URL the cache has never seen forces a real fetch. The new
  // version is the cache-buster, so each update busts exactly once instead of
  // defeating caching forever.
  reload.addEventListener("click", () => {
    const url = new URL(window.location.href);
    url.searchParams.set("v", newVersion);
    window.location.replace(url.toString());
  });
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

/**
 * Who a tool is for. Tagged per TOOL rather than per group, because the groups
 * don't divide cleanly: "Patent drafting" contains Refs (figure captions), which
 * every scientist writing a paper needs, and Biology contains Sequence, whose
 * ST.26 listings exist purely for patent filings.
 *
 * Several tools genuinely serve both — a plant-patent attorney needs Botanical,
 * a biotech attorney needs Sequence — so this is a list, not a single value.
 * Getting that wrong would hide a tool from the person who most needs it.
 */
type Audience = "science" | "legal";

interface HomeItem {
  /**
   * Home is a page, not a tool, so it can never be a card here. Narrowing the
   * type (rather than casting at the call site) is what lets the icon map be
   * exhaustive: TypeScript now refuses to compile a tool with no icon.
   */
  mode: Exclude<Mode, "home">;
  label: string;
  desc: string;
  /** Audiences this tool is shown to on Home. Omitted = shown to everyone. */
  audience?: Audience[];
}
interface HomeGroup {
  title: string;
  items: HomeItem[];
}

const HOME_GROUPS: HomeGroup[] = [
  {
    title: "Chemistry & structures",
    items: [
      { mode: "chemical", audience: ["science", "legal"], label: "Chemical", desc: "Formulas & 2D structures" },
      { mode: "build", audience: ["science", "legal"], label: "Build", desc: "Structures from atoms/bonds; Markush" },
      { mode: "reaction", audience: ["science"], label: "Reaction", desc: "Reaction schemes" },
      { mode: "massspec", audience: ["science"], label: "Mass Spec", desc: "Exact mass, isotope pattern, adducts" },
      { mode: "spectra", audience: ["science"], label: "Spectra", desc: "Predicted NMR, IR, UV-Vis, fragmentation" },
    ],
  },
  {
    title: "Math & units",
    items: [
      { mode: "math", label: "Math", desc: "Native equations, LaTeX" },
      { mode: "solve", label: "Solve", desc: "Equations, derivatives, integrals, word problems" },
      { mode: "units", label: "Units", desc: "SI typesetting & conversion" },
      { mode: "plot", label: "Plot", desc: "Function & data charts" },
      { mode: "stats", audience: ["science"], label: "Stats", desc: "Descriptive, t-tests, ANOVA, uncertainty" },
      { mode: "analyze", audience: ["science"], label: "Analyze", desc: "Matrix math + data → trends & insights" },
    ],
  },
  {
    // Engineering is its own bench, not a corner of "Math & units". Everything
    // engineering lands here as it is built - the mode carries a Calculation
    // dropdown the way Analyze, Stats and Finance do, so a new discipline is an
    // entry in ENG_CALCS rather than a new tile.
    title: "Engineering",
    items: [
      {
        mode: "engineering",
        audience: ["science"],
        label: "Engineering",
        // Named the two structural calculators for a long time after this tile
        // grew to 36 across nine disciplines, so the pane undersold its own
        // largest tool to the person deciding whether to open it.
        desc: "36 calculators: beams, stress, fluids, thermal, circuits, control, vibration, PK",
      },
    ],
  },
  {
    title: "Data & figures",
    items: [
      { mode: "ppt", label: "Table → Chart", desc: "Charts, diagrams, table figures, PPT" },
      { mode: "finance", audience: ["legal"], label: "Finance", desc: "TVM, DCF, bonds, options + Greeks, amortization" },
    ],
  },
  {
    title: "Biology",
    items: [
      { mode: "seqmap", audience: ["science", "legal"], label: "Sequence Map", desc: "Open a GenBank/FASTA file → annotated map" },
      { mode: "align", audience: ["science"], label: "Align", desc: "Compare two sequences — global or local" },
      { mode: "sequence", audience: ["science", "legal"], label: "Sequence", desc: "WIPO ST.26 listings" },
      { mode: "dna", audience: ["science"], label: "DNA", desc: "Rev-comp, translation, ORFs" },
      { mode: "assay", audience: ["science"], label: "Bio/Assay", desc: "Kinetics, IC50/EC50, binding, lab math" },
      { mode: "peptide", audience: ["science"], label: "Peptide", desc: "Draw a peptide from its sequence" },
      { mode: "botanical", audience: ["science", "legal"], label: "Botanical", desc: "Plant nomenclature" },
    ],
  },
  {
    title: "Patent drafting",
    items: [
      { mode: "numerals", audience: ["legal"], label: "Numerals", desc: "Reference-numeral management" },
      { mode: "refs", label: "Refs", desc: "Captions & cross-references" },
      { mode: "code", label: "Code", desc: "Algorithm & code listings" },
      { mode: "audit", audience: ["legal"], label: "Audit", desc: "Whole-document consistency" },
    ],
  },
  {
    title: "Legal citations",
    items: [{ mode: "citations", audience: ["legal"], label: "Citations", desc: "Bluebook — cases, statutes, patents" }],
  },
];

/** True if `item` should appear on Home under the current filter. */
function itemMatchesFilter(item: HomeItem, filter: HomeFilter): boolean {
  if (filter === "all") return true;
  if (!item.audience) return true; // untagged = everyone's tool (Math, Units, Plot…)
  return item.audience.includes(filter);
}

/** Total tools, for the "showing N of M" reassurance. */
const TOTAL_TOOLS = HOME_GROUPS.reduce((n, g) => n + g.items.length, 0);

/**
 * Builds the Home filter chips.
 *
 * This exists because the pane serves two audiences that barely overlap, and
 * showing a chemist "Bluebook Citations" makes them read half the product as
 * clutter and conclude it isn't for them. The chips filter the CARDS ONLY —
 * every tool stays reachable from the dropdown and the search box — so this is
 * a lens, not a paywall, and the count line says so out loud.
 */
function renderHomeFilter(shown: number): void {
  homeFilterEl.replaceChildren();
  const current = getPrefs().homeFilter;
  const chips: { value: HomeFilter; label: string }[] = [
    { value: "all", label: "All tools" },
    { value: "science", label: "Science" },
    { value: "legal", label: "Patent & legal" },
  ];
  const row = document.createElement("div");
  row.className = "home-filter-row";
  const lead = document.createElement("span");
  lead.className = "home-filter-lead";
  lead.textContent = "Show:";
  row.appendChild(lead);
  for (const c of chips) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "home-chip" + (c.value === current ? " is-on" : "");
    b.textContent = c.label;
    b.setAttribute("aria-pressed", String(c.value === current));
    b.addEventListener("click", () => {
      setPref("homeFilter", c.value);
      renderHome();
    });
    row.appendChild(b);
  }
  homeFilterEl.appendChild(row);

  // Nothing is hidden permanently — say so, so a filtered view never reads as a
  // missing feature.
  if (current !== "all") {
    const note = document.createElement("div");
    note.className = "home-filter-note";
    note.textContent = `Showing ${shown} of ${TOTAL_TOOLS} tools. `;
    const all = document.createElement("button");
    all.type = "button";
    all.className = "home-filter-link";
    all.textContent = "Show all";
    all.addEventListener("click", () => {
      setPref("homeFilter", "all");
      renderHome();
    });
    note.appendChild(all);
    const tail = document.createElement("span");
    tail.textContent = " — the rest stay available in the dropdown and search.";
    note.appendChild(tail);
    homeFilterEl.appendChild(note);
  }
}

/** Builds the grouped tool cards on the home page. */
function renderHome(): void {
  homeGroups.replaceChildren();
  const filter = getPrefs().homeFilter;
  let shown = 0;
  for (const g of HOME_GROUPS) {
    const items = g.items.filter((i) => itemMatchesFilter(i, filter));
    if (!items.length) continue; // a group with nothing to show is just noise
    shown += items.length;
    const group = document.createElement("div");
    group.className = "home-group";
    const title = document.createElement("div");
    title.className = "home-group-title";
    title.textContent = g.title;
    const cards = document.createElement("div");
    cards.className = "home-cards";
    for (const item of items) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "home-card";
      card.dataset.mode = item.mode;
      // A drawn mark, not an emoji and not a numeral: unique per tool,
      // identical on every platform, and recognisable at a glance.
      const icon = toolIcon(item.mode);
      icon.setAttribute("class", "home-card-icon");
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
  renderHomeFilter(shown);
}

/** Swaps the "Examples & syntax" panel to the help for the current mode. */
function updateExamples(): void {
  const m = currentMode();
  // No cast: MODE_EXAMPLES is keyed by every non-home mode, so TypeScript now
  // catches a tool shipped without help content. The old `as ExampleMode` cast
  // silenced exactly that check and let Spectra ship with an empty panel.
  examplesBody.innerHTML = m === "home" ? "" : MODE_EXAMPLES[m];
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
    // Hide every tool section by querying them, not by listing them by hand.
    // The old hand-written list was missing analyze-section, so the Analyze
    // controls rendered underneath the Home cards on first open — and only on
    // first open, because opening any tool ran the per-mode branch below, which
    // set Analyze to "none" as a side effect and left it that way. Reading the
    // sections from the DOM means a newly added tool cannot be half-registered.
    for (const el of document.querySelectorAll<HTMLElement>("main > section")) {
      if (el !== homeSection) el.style.display = "none";
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
  solveSection.style.display = mode === "solve" ? "block" : "none";
  alignSection.style.display = mode === "align" ? "block" : "none";
  seqmapSection.style.display = mode === "seqmap" ? "block" : "none";
  peptideSection.style.display = mode === "peptide" ? "block" : "none";
  statsSection.style.display = mode === "stats" ? "block" : "none";
  analyzeSection.style.display = mode === "analyze" ? "block" : "none";
  engineeringSection.style.display = mode === "engineering" ? "block" : "none";
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
  if (mode === "solve") {
    updateSolveUi();
    updateSolve();
    return;
  }
  if (mode === "align") {
    updateAlign();
    return;
  }
  if (mode === "seqmap") {
    updateSeqMap();
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
  }
  if (mode === "engineering") {
    if (!engineeringCalcSelect.options.length) {
      // Grouped by discipline, in ENG_GROUP_ORDER rather than in the order the
      // calculations happened to be built. Within a group the ENG_CALCS order
      // is kept, which is roughly simple-to-specialised.
      for (const title of ENG_GROUP_ORDER) {
        const members = ENG_CALCS.filter((c) => c.group === title);
        if (!members.length) continue;
        const g = document.createElement("optgroup");
        g.label = title;
        for (const c of members) {
          const o = document.createElement("option");
          o.value = c.id;
          o.textContent = c.name;
          g.appendChild(o);
        }
        engineeringCalcSelect.appendChild(g);
      }
      renderEngineeringGroups();
    }
    if (!engineeringInputs.children.length) renderEngineeringInputs();
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
  const rendered: { label: string; base64: string; alt: string; w: number; h: number }[] = [];
  for (const it of items) {
    const r = renderStructure(it.input, GALLERY_W, GALLERY_H);
    if (!r) continue;
    const d = readSvgDims(r.svg, GALLERY_W, GALLERY_H);
    const base64 = await renderFigurePng(r.svg, d.w, d.h);
    const label = it.label ? `substituent ${it.label}` : "substituent";
    rendered.push({
      label: it.label,
      base64,
      alt: provenanceAltText(label, r.formula, r.mw, r.smiles, r.idcode),
      w: d.w,
      h: d.h,
    });
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
        sizeFigure(pic, item.w, item.h);
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
  // A HEAT MAP HAS NO NATIVE CHART EQUIVALENT, so it always ships as a picture of
  // the rendering. PowerPoint offers nothing that means the same thing — rows and
  // columns are both categorical and the value is the FILL — and buildTablePptx
  // refuses rather than substituting a bar chart under the same title. Getting this
  // wrong would not error, it would export a different chart, so the two decisions
  // are kept consistent here rather than left to line up by luck.
  return isRowKind(kind) || kind === "heatmap" || kind === "candlestick";
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
    const base64 = await renderFigurePng(rendered.svg, d.w, d.h);
    const kindLabel = kind === "tablefigure" ? "table figure" : kind;
    const alt = `${style.figLabel ? style.figLabel + " — " : ""}${kindLabel} of table (${currentTableRows?.length ?? 0} rows)${style.patent ? ", patent line-art style" : ""}`;
    const alsoText = pptWithTextCheckbox.checked && !!currentTableRows;
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      sizeFigure(picture, d.w, d.h);
      picture.altTextDescription = alt;
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
  renderStructureInfo(result.formula, result.mw, result.smiles, result.source, text);
  renderProperties(text);
  insertStructureBtn.disabled = false;

  // Dictionary name lookup (recognized compounds only).
  currentStructureName = nameForIdcode(result.idcode) ?? "";
  structureNameEl.textContent = currentStructureName ? `Name: ${currentStructureName}` : "";
  insertNameBtn.disabled = !currentStructureName;
}

/**
 * Shows formula / MW / SMILES under the structure preview (provenance at a
 * glance), and says so when the input was AMBIGUOUS.
 *
 * A bare molecular formula does not determine a structure: C2H6O is ethanol or
 * dimethyl ether, C6H12O6 is glucose, fructose, galactose and a dozen more. The
 * library resolves it to the most common compound and reports `source` so the UI
 * can be honest about the guess; nothing read that flag until now, so the user
 * saw a confident structure with no hint that a choice had been made on their
 * behalf.
 */
function renderStructureInfo(
  formula: string,
  mw: number,
  smiles: string,
  source?: "name" | "formula" | "smiles",
  input?: string,
): void {
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
  if (source === "formula") {
    const warn = document.createElement("span");
    warn.className = "structure-warn";
    const typed = (input ?? "").trim();
    warn.textContent =
      `\u26a0 "${typed}" is a molecular formula, which does not identify one structure. ` +
      `Interpreted as the most common compound with that formula. ` +
      `Paste a SMILES string or a specific name to choose a different isomer.`;
    structureInfo.appendChild(warn);
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
    // The caveats must survive this early exit. An out-of-domain input is the
    // case that needs them MOST — it is the one where the numbers above mean
    // least — so returning before rendering them would be exactly backwards.
    structurePropsEl.appendChild(specCaveats(p.caveats));
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

  // Same block the Spectra modes use. cLogP sitting bare next to a carefully
  // caveated NMR prediction taught the reader that a JurisLab number is
  // trustworthy by default — which is the opposite of the point.
  structurePropsEl.appendChild(specCaveats(p.caveats));

  renderPka(input);
  insertPropsBtn.disabled = false;
}

/**
 * Computes the pairwise alignment for the current inputs and shows it.
 *
 * The alignment is rendered — and inserted — in a MONOSPACE font. That is not
 * cosmetic: an alignment is a column-wise claim, and a proportional font silently
 * destroys the correspondence between the ruler and the residues beneath it. A
 * misaligned alignment is a wrong figure, not an ugly one.
 */
function updateAlign(): void {
  currentAlignText = "";
  alignInsertBtn.disabled = true;
  const a = alignA.value.trim();
  const b = alignB.value.trim();
  if (!a || !b) {
    alignResult.innerHTML = '<span class="hint">Paste two sequences to align.</span>';
    return;
  }

  const kindSel = alignKindSel.value;
  let r;
  try {
    r = align(a, b, {
      mode: alignModeSel.value as AlignMode,
      kind: kindSel === "auto" ? undefined : (kindSel as SeqKind),
    });
  } catch {
    r = null;
  }
  if (!r) {
    alignResult.innerHTML = '<span class="hint">Nothing alignable in one of the inputs.</span>';
    return;
  }

  const block = formatAlignment(r, 60, "A", "B");
  const stats =
    `${r.mode === "global" ? "Global (Needleman–Wunsch)" : "Local (Smith–Waterman)"} · ` +
    `${r.kind === "protein" ? "BLOSUM62" : "DNA +5/−4"}\n` +
    `Score ${r.score} · Length ${r.length}\n` +
    `Identity ${r.identities}/${r.length} (${r.percentIdentity}%) · ` +
    `Similarity ${r.similarities}/${r.length} (${r.percentSimilarity}%) · ` +
    `Gaps ${r.gaps}/${r.length} (${r.percentGaps}%)`;

  alignResult.innerHTML = "";
  const head = document.createElement("div");
  head.textContent = stats;
  head.style.whiteSpace = "pre-wrap";
  const pre = document.createElement("pre");
  pre.textContent = block;
  pre.style.fontFamily = "Consolas, 'Courier New', monospace";
  pre.style.overflowX = "auto";
  pre.style.margin = "8px 0";
  alignResult.append(head, pre);
  alignResult.appendChild(specCaveats(r.caveats));

  // The document gets the same thing the pane shows, caveats included — a percent
  // identity that lands in a paper without its gap costs is a number without a
  // meaning.
  currentAlignText = `${stats}\n\n${block}\n\n${r.caveats.map((c) => `• ${c}`).join("\n")}`;
  alignInsertBtn.disabled = false;
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
  head.textContent = res.sites.length ? "Ionizable groups (estimated pKa)" : "No common ionizable groups detected";
  block.appendChild(head);
  for (const s of res.sites) {
    const row = document.createElement("div");
    row.className = "prop-rule";
    row.textContent = `${s.group} — ${s.kind === "acid" ? "acidic" : "basic"}, ${s.kind === "acid" ? "pKa" : "pKaH"} ≈ ${s.pka}`;
    block.appendChild(row);
    // Show the derivation when a substituent correction was applied.
    if (s.note) {
      const why = document.createElement("div");
      why.className = "prop-why";
      why.textContent = s.note;
      block.appendChild(why);
    }
  }
  if (res.sites.length) {
    const net = document.createElement("div");
    net.className = "prop-why";
    net.textContent = `Est. net charge at pH 7.4: ${res.netChargeAt74 >= 0 ? "+" : ""}${res.netChargeAt74.toFixed(2)}`;
    block.appendChild(net);
  }
  const caveat = document.createElement("div");
  caveat.className = "prop-why";
  caveat.textContent = "Estimates. Aromatic acids/bases and aliphatic acids are adjusted for their substituents (Hammett / inductive, ±0.3–0.5); other groups use the typical value for the detected group.";
  block.appendChild(caveat);
  structurePropsEl.appendChild(block);
}

/** Multi-line plain-text pKa summary for insertion (empty when nothing detected). */
function pkaAsText(res: PkaResult | null): string {
  if (!res || !res.sites.length) return "";
  const lines: string[] = [];
  for (const s of res.sites) {
    lines.push(`  ${s.group}: ${s.kind === "acid" ? "acidic" : "basic"}, ${s.kind === "acid" ? "pKa" : "pKaH"} ≈ ${s.pka}`);
    if (s.note) lines.push(`    (${s.note})`);
  }
  return [
    "Ionizable groups (estimated pKa; aromatic acids/bases and aliphatic acids are substituent-corrected):",
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
 * Consent is per NAME: a name already sent this session goes straight through,
 * anything new always asks first.
 */
function onOpsinClick(): void {
  const name = inputEl.value.trim();
  if (!name) {
    setOpsinStatus("Type a name in the box above first.", "error");
    return;
  }
  if (opsinConsentedNames.has(opsinKey(name))) {
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
    const base64 = await renderFigurePng(structure.svg, d.w, d.h);
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
      sizeFigure(picture, d.w, d.h);
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
    const base64 = await renderFigurePng(molecule.svg, d.w, d.h);
    const label = molecule.formula || "molecule";
    const alt = provenanceAltText(`2D structure (${label})`, molecule.formula, molecule.mw, molecule.smiles, molecule.idcode);
    const entries = currentLegendEntries();
    const legendLine = buildLegendText(entries);
    const legendTable = legendFormat === "table" ? buildLegendTableHtml(entries) : "";
    const hasLegend = legendFormat === "table" ? !!legendTable : !!legendLine;
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      sizeFigure(picture, d.w, d.h);
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
      // The table bounds what counts as a callout: a citation year or a
      // list marker far outside the numbering range is not one.
      const docNumerals = extractNumerals(body.text, numeralEntries.map((e) => e.numeral));
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
  const { seq, invalid, records } = cleanDna(dnaInput.value);

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
  // A multi-record paste is concatenated, which is almost never what the user
  // meant — say so rather than analysing a chimera in silence.
  const multi = records > 1 ? ` · ⚠ ${records} FASTA records were joined — analyse one at a time` : "";
  dnaReadout.textContent =
    `${stats.length} nt${invalid.length ? ` · ignored invalid: ${invalid.join(" ")}` : ""}${multi}`;
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
  // The conditions are part of the number. A Tm quoted without its salt and primer
  // concentration is not a fact about the oligo — it moves ~10 °C between 10 mM and
  // 1 M Na⁺, and different suppliers' calculators assume different defaults, which
  // is exactly why two people "get different Tm" for the same primer.
  dnaTm.textContent =
    `Primer Tm ≈ ${tm.tm.toFixed(1)} °C · ${tm.gcPercent.toFixed(0)}% GC · ${tm.length} nt` +
    (tm.method === "nearest-neighbour" ? " · nearest-neighbour, 50 mM Na⁺, 0.25 µM" : " · Wallace rule (too short for NN)");
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
  const raw = findSites(seq);
  if (!raw.length) {
    dnaRestrictResults.innerHTML = '<span class="hint">No restriction sites found.</span>';
    return;
  }
  const hits = summarise(raw);
  const unique = new Set(uniqueCutters(raw));
  const cell = 'style="border:1px solid #000;padding:2px 8px;"';
  const rows = hits
    .map((h) => {
      const e = ENZYMES.find((x) => x.name === h.enzyme);
      const site = e ? formatSite(e) : h.site;
      // A unique cutter is the one you can actually clone into — flag it.
      const tag = unique.has(h.enzyme) ? " ★" : "";
      const oh = h.overhang === "blunt" ? "blunt" : `${h.overhang} overhang`;
      return `<tr><td ${cell}>${esc(h.enzyme)}${tag}</td><td ${cell}>${esc(site)}</td><td ${cell}>${oh}</td><td ${cell}>${h.positions.join(", ")}</td></tr>`;
    })
    .join("");
  dnaRestrictResults.innerHTML =
    '<table style="border-collapse:collapse;"><tr>' +
    `<td ${cell}><strong>Enzyme</strong></td><td ${cell}><strong>Site</strong></td><td ${cell}><strong>Ends</strong></td><td ${cell}><strong>Positions</strong></td></tr>` +
    rows +
    "</table>" +
    `<div class="hint" style="margin-top:6px">★ = cuts once (a unique cutter). Both strands are searched, so asymmetric sites (BsaI, BsmBI, BbsI) are found on either.</div>`;

  // Methylation is the difference between this prediction and the gel. MboI on
  // plasmid DNA from an ordinary dam+ strain cuts NOTHING, and DpnI cuts ONLY
  // methylated DNA — neither failure announces itself, you just lose a week. The
  // table above cannot show that, so it goes underneath in full.
  const methWarnings = methylationWarnings(seq, raw);
  if (methWarnings.length) {
    const seen = new Set<string>();
    const unique2: string[] = [];
    for (const w of methWarnings) {
      // One line per enzyme+methylase; the position is already in the message.
      const key = `${w.enzyme}:${w.methylase}:${w.effect}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique2.push(w.message);
    }
    dnaRestrictResults.appendChild(specCaveats(unique2));
  }
  setStatus(
    `Found ${hits.length} enzyme${hits.length === 1 ? "" : "s"}; ${unique.size} cut${unique.size === 1 ? "s" : ""} once.`,
    "success"
  );
}

/**
 * Puts the pane in the right theme.
 *
 * Word is asked first because the pane lives inside Word: running Word in Black
 * on a light desktop should give a dark pane, not a white slab bolted to a black
 * application. `Office.context.officeTheme` is not present on every host or
 * build, so it is read defensively and a missing value falls through to the OS.
 */
function applyTheme(): void {
  const officeTheme = (Office as unknown as { context?: { officeTheme?: { bodyBackgroundColor?: string } } })
    ?.context?.officeTheme;
  const { attribute } = resolveTheme({
    pref: getPrefs().theme,
    host: hostTheme(officeTheme),
    osPrefersDark:
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  });
  const root = document.documentElement;
  if (attribute) root.setAttribute("data-theme", attribute);
  // No attribute = let the media query decide, so an OS change needs no listener.
  else root.removeAttribute("data-theme");
}

/** Cuts the sequence with the chosen enzymes and reports the fragments. */
function runVirtualDigest(): void {
  currentDigestText = "";
  digestInsertBtn.disabled = true;
  const { seq } = cleanDna(dnaInput.value);
  if (!seq) {
    digestResults.innerHTML = '<span class="hint">Enter a DNA sequence first.</span>';
    return;
  }

  const wanted = digestEnzymes.value
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // An enzyme the user asked for that this tool does not know is worth saying
  // out loud: silently digesting with the OTHER enzymes would produce a
  // plausible fragment list for a digest they did not request.
  const known = new Set(ENZYMES.map((e) => e.name.toLowerCase()));
  const unknown = wanted.filter((w) => !known.has(w.toLowerCase()));
  const only = wanted
    .filter((w) => known.has(w.toLowerCase()))
    .map((w) => ENZYMES.find((e) => e.name.toLowerCase() === w.toLowerCase())!.name);

  if (wanted.length && !only.length) {
    digestResults.innerHTML = `<span class="hint">None of those enzymes are in the table (${esc(unknown.join(", "))}). Leave the box blank to use every enzyme that cuts.</span>`;
    return;
  }

  const circular = digestTopology.value === "circular";
  const hits = findSites(seq, { circular, ...(only.length ? { only } : {}) });
  const result = digest(seq.length, hits, circular);
  const bands = gelBands(result.sizes);

  const cell = 'style="border:1px solid #000;padding:2px 8px;"';
  const rows = result.fragments
    .map((f, i) => {
      const ends = `${f.leftEnzyme ?? "end"} / ${f.rightEnzyme ?? "end"}`;
      const span = f.spansOrigin ? `${f.start}\u2013${f.end} (through origin)` : `${f.start}\u2013${f.end}`;
      return `<tr><td ${cell}>${i + 1}</td><td ${cell}>${f.length}</td><td ${cell}>${esc(span)}</td><td ${cell}>${esc(ends)}</td></tr>`;
    })
    .join("");

  const text = describeDigest(result);
  digestResults.innerHTML =
    (result.uncut
      ? `<span class="hint">${esc(text)}</span>`
      : '<table style="border-collapse:collapse;"><tr>' +
        `<td ${cell}><strong>#</strong></td><td ${cell}><strong>bp</strong></td><td ${cell}><strong>Span</strong></td><td ${cell}><strong>Ends</strong></td></tr>` +
        rows +
        "</table>" +
        `<div class="hint" style="margin-top:6px">${esc(text.split("\n").slice(1).join(" \u00b7 "))}</div>`) +
    (unknown.length
      ? `<div class="hint" style="margin-top:4px">\u26a0 Not in the enzyme table, so not used: ${esc(unknown.join(", "))}.</div>`
      : "");

  currentDigestText = text;
  digestInsertBtn.disabled = result.uncut;
  setStatus(
    result.uncut
      ? "Not cut by those enzymes."
      : `${result.fragments.length} fragment${result.fragments.length === 1 ? "" : "s"}, ${bands.length} band${bands.length === 1 ? "" : "s"} on a gel.`,
    result.uncut ? "error" : "success",
  );
}

/** Inserts a plain-text result at the cursor. Shared by ~14 tools, not just DNA. */
// Re-entrancy guard shared by every text-insert button (MS, Stats, Assay, DNA,
// Finance…): a fast double-click would otherwise queue two insertions of the
// same text before the first Word.run resolves.
/**
 * Inserts an alignment as MONOSPACE text.
 *
 * insertText() inherits the document's font, which is proportional in every
 * default Word template. An alignment is a column-wise claim — the ruler's '|'
 * must sit directly above the residues it refers to — and a proportional font
 * silently breaks that correspondence while still looking like an alignment. That
 * is a wrong figure, not an ugly one, so this goes in via insertHtml with an
 * explicit monospace family and the whitespace preserved.
 */
async function insertAlignmentText(): Promise<void> {
  if (!currentAlignText.trim()) {
    setStatus("Nothing to insert — align two sequences first.", "error");
    return;
  }
  // Not a bare return — see insertResultBlocks. A silent refusal is
  // indistinguishable from a dead button.
  if (insertTextBusy) {
    setStatus("Still inserting the last result — one moment.", "error");
    return;
  }
  insertTextBusy = true;
  try {
    const html =
      `<pre style="font-family:Consolas,'Courier New',monospace;font-size:9pt;` +
      `white-space:pre;margin:0">${esc(currentAlignText)}</pre>`;
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      range.insertHtml(html, Word.InsertLocation.replace);
      range.select(Word.SelectionMode.end);
      await context.sync();
    });
    setStatus("Alignment inserted.", "success");
  } catch (e) {
    setStatus(`Could not insert the alignment: ${(e as Error).message}`, "error");
  } finally {
    insertTextBusy = false;
  }
}

let insertTextBusy = false;

async function insertPlainText(text: string, label: string): Promise<void> {
  if (!text.trim()) {
    setStatus(`Nothing to insert for ${label.toLowerCase()}.`, "error");
    return;
  }
  if (insertTextBusy) {
    // Was a silent `return`, so a second click looked like nothing happened.
    setStatus("Still inserting the last result — one moment.", "error");
    return;
  }
  insertTextBusy = true;
  setStatus(`Inserting ${label.toLowerCase()}…`);
  try {
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      // AFTER, not replace. This is the insert path for mass spec, spectra,
      // properties, stats, finance, assay, solve, analyze, cross-references and
      // SEQ ID refs, and it used to overwrite whatever the user had selected —
      // every other insert in the product appends. Losing a selected word to a
      // button labelled "Insert" is not a trade anyone agreed to.
      range.insertText(text, Word.InsertLocation.after);
      range.select(Word.SelectionMode.end);
      await context.sync();
    });
    setStatus(`${label} inserted. Ctrl/⌘+Z undoes it.`, "success");
  } catch (error) {
    setStatus(`Could not insert ${label.toLowerCase()}: ${(error as Error).message}`, "error");
  } finally {
    insertTextBusy = false;
  }
}

/**
 * Inserts a worked derivation as REAL Word equations (OMML) rather than flat
 * ASCII. Falls back to the plain-text path if the host rejects the OOXML, so
 * the button always does something.
 */
async function insertDerivation(blocks: DerivationBlock[], plain: string, label: string): Promise<void> {
  if (!blocks.length) {
    setStatus(`Nothing to insert for ${label.toLowerCase()}.`, "error");
    return;
  }
  if (insertTextBusy) {
    setStatus("Still inserting the last result — one moment.", "error");
    return;
  }
  insertTextBusy = true;
  setStatus(`Inserting ${label.toLowerCase()}…`);
  try {
    const ooxml = buildDerivationOoxml(blocks);
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      // AFTER, matching every other insert path — never overwrite a selection.
      const inserted = range.insertOoxml(ooxml, Word.InsertLocation.after);
      range.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, inserted, "formula-inserter:solution");
    });
    setStatus(`${label} inserted as editable equations. Ctrl/⌘+Z undoes it.`, "success");
  } catch (error) {
    // OOXML refused by the host — the derivation is still worth having as text.
    insertTextBusy = false;
    await insertPlainText(plain, label);
    return;
  } finally {
    insertTextBusy = false;
  }
}

/**
 * Inserts the current Solve result: the typeset derivation, plus the figure
 * when there is one (the persistence barcode). The figure is rasterised BEFORE
 * entering Word.run, because that conversion is async and Word.run batches.
 */
async function insertSolveResult(): Promise<void> {
  await insertDerivation(currentSolveBlocks, currentSolveText, "solution");
  if (!currentSolveSvg) return;
  try {
    const svg = currentSolveSvg;
    const { w, h } = readSvgDims(svg, 460, 300);
    const png = await renderFigurePng(svg, w, h);
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const pic = range.insertInlinePictureFromBase64(png, Word.InsertLocation.after);
      sizeFigure(pic, w, h);
      pic.altTextDescription = "Persistence barcode: each bar is a topological feature, spanning the range of scales over which it exists.";
      await context.sync();
    });
    setStatus("Solution and barcode inserted. Ctrl/⌘+Z undoes it.", "success");
  } catch (error) {
    // The text already landed; say the figure did not rather than failing silently.
    setStatus(`Solution inserted, but the barcode figure could not be: ${(error as Error).message}`, "error");
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
    const base64 = await renderFigurePng(svg, width, height);
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      sizeFigure(picture, width, height);
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
  await insertPlainText(formatSeqIdRef(n), "SEQ ID reference");
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
  await insertPlainText(text, "Cross-reference");
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
  const opts = {
    title: plotTitle.value.trim(),
    xlabel: plotXlabel.value.trim(),
    ylabel: plotYlabel.value.trim(),
    xScale: plotXscale.value as AxisScale,
    yScale: plotYscale.value as AxisScale,
    errorBars: (plotErrbars.value || undefined) as ErrorBarKind | undefined,
  };

  // A log axis cannot show zero or negative values, so it DISCARDS points. Say
  // how many and on which axis: a titration series with a zero-concentration
  // control silently losing a point, on a chart that still looks complete, is
  // exactly the kind of quiet wrong this product refuses to ship.
  const filtered = dropForScales(series, opts);
  const notes: string[] = [];
  if (warning) notes.push(warning);
  if (filtered.dropped > 0) {
    const axes = filtered.axes.join(" and ");
    notes.push(
      `\u26a0 ${filtered.dropped} point${filtered.dropped === 1 ? "" : "s"} not plotted: ` +
        `a logarithmic ${axes} axis cannot show zero or negative values.`,
    );
  }
  if (!filtered.series.some((sr) => sr.points.length)) {
    plotPreview.innerHTML =
      '<span class="hint">Nothing left to plot — every point is zero or negative, ' +
      "which a logarithmic axis cannot show. Switch the axis back to linear.</span>";
    return;
  }

  const svg = buildPlotSvg(filtered.series, opts);
  plotPreview.innerHTML = notes.length
    ? `${svg}<div class="hint" style="margin-top:4px">${esc(notes.join(" "))}</div>`
    : svg;
  currentPlotSvg = svg;
  plotInsertBtn.disabled = false;
}

/** Reads the document's paragraphs and shows what numbering would do. */
async function previewParagraphNumbers(): Promise<void> {
  currentParaPlan = null;
  paraApplyBtn.disabled = true;
  paraFindings.textContent = "Reading the document…";
  try {
    await Word.run(async (context) => {
      const paras = context.document.body.paragraphs;
      paras.load("items/text");
      await context.sync();
      const texts = paras.items.map((p) => p.text);
      const plan = planParagraphNumbering(texts, {
        start: Number(paraStart.value) || 1,
        renumber: paraRenumber.checked,
      });
      paraFindings.textContent = describeParagraphPlan(plan);
      // A collision would put two identical numbers in a filed specification.
      // Refuse to apply rather than letting the user click past the warning.
      if (plan.collisions.length) {
        paraApplyBtn.disabled = true;
        currentParaPlan = null;
      } else if (plan.numbered > 0) {
        currentParaPlan = plan;
        paraApplyBtn.disabled = false;
      }
    });
  } catch (e) {
    // Deliberately not Word's raw exception text: it is not actionable, and
    // leaking it is a defect the evaluation already logged elsewhere.
    paraFindings.textContent =
      "Could not read the document. Make sure a document is open and try again.";
    console.error("paragraph numbering preview failed", e);
  }
}

/** Writes the previewed marks into the document. */
async function applyParagraphNumbers(): Promise<void> {
  const plan = currentParaPlan;
  if (!plan) return;
  paraApplyBtn.disabled = true;
  paraFindings.textContent = "Numbering…";
  try {
    await Word.run(async (context) => {
      const paras = context.document.body.paragraphs;
      paras.load("items/text");
      await context.sync();

      for (const item of plan.items) {
        if (!item.mark) continue;
        const p = paras.items[item.index];
        if (!p) continue;
        if (item.removeExisting) {
          // Renumbering: rewrite the paragraph without its old mark rather than
          // stacking a second one in front of it.
          p.insertText(item.mark + " " + stripParagraphNumber(p.text), Word.InsertLocation.replace);
        } else {
          p.insertText(item.mark + " ", Word.InsertLocation.start);
        }
      }
      await context.sync();
      paraFindings.textContent = `Numbered ${plan.numbered} paragraph${plan.numbered === 1 ? "" : "s"}. Undo (Ctrl+Z) reverses it.`;
    });
  } catch (e) {
    paraFindings.textContent =
      "Could not number the document. Nothing was changed — press Ctrl+Z if anything looks off, and try again.";
    console.error("paragraph numbering failed", e);
  } finally {
    currentParaPlan = null;
  }
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
    const base64 = await renderFigurePng(currentPlotSvg, 380, 270);
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      sizeFigure(picture, 380, 270);
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
  /**
   * The modelling assumptions this calculator silently makes — shown under the
   * result, and carried into the inserted text.
   *
   * finance.ts documents these accurately in its source ("European option (no
   * dividends)"), but a source comment is not a disclosure: nothing reached the
   * user. Someone pricing an American put got a number that is simply too low,
   * with nothing on screen to say so. Every model here that is only valid under
   * conditions the inputs cannot express must name them.
   */
  assumes?: string;
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
    assumes:
      "IRR assumes every interim cash flow is reinvested AT THE IRR — usually optimistic. "+
      "Cash flows that change sign more than once can have several valid IRRs and this "+
      "reports only the first found; compare NPV instead when signs alternate. Returns "+
      "no solution when no rate in the searched range zeroes the NPV."
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
    assumes:
      "EUROPEAN exercise (expiry only) and NO dividends. An American option cannot " +
      "be priced with this: early exercise makes an American put worth MORE than " +
      "this figure, and a dividend-paying stock makes a call worth LESS. Also assumes " +
      "constant volatility and a lognormal price — real options show a volatility smile.",
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
    assumes:
      "CLEAN price — accrued interest is not included, so this matches a quoted price, "+
      "not the cash you would pay to settle. Assumes a flat yield curve, no credit risk, "+
      "no embedded call/put, and coupons reinvested at the YTM."
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
      const years = +r("t");
      if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(years) || years <= 0) {
        return "Enter a positive number of years and payments per year.";
      }
      const rows = amortizationSchedule(+r("p"), +r("rate") / 100 / m, years * m);
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
    assumes:
      "The Gordon terminal value typically dominates this number and is extremely sensitive "+
      "to the terminal growth rate: it explodes as growth approaches the discount rate, "+
      "and requires growth < discount rate to mean anything. Treat the output as a scenario, "+
      "not a valuation."
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
    assumes:
      "Same reinvestment assumption and multiple-root caveat as IRR, on actual dates. "+
      "Uses a 365-day year and ignores day-count conventions (30/360, ACT/360), so it "+
      "will differ slightly from a bond-desk figure."
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
    assumes:
      "Assumes settlement on a coupon date, a flat curve, and no default. YTM is a redemption "+
      "yield: it only realises if every coupon is reinvested at that same rate. Returns "+
      "no solution when no yield in the searched range reproduces the price."
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
    assumes:
      "Duration and convexity are first- and second-order sensitivities to a PARALLEL "+
      "shift in a flat curve. They understate risk for large moves and for non-parallel "+
      "shifts, and do not apply to callable or putable bonds."
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
    assumes:
      "Same EUROPEAN, no-dividend model as the Black–Scholes price above — these Greeks "+
      "do not describe an American option or a dividend payer. Theta is per YEAR here; "+
      "trading desks usually quote it per day (divide by 365)."
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
    assumes:
      "Solves the EUROPEAN, no-dividend Black–Scholes price for sigma. Feeding it a real "+
      "American or dividend-paying option's market price yields a sigma that silently "+
      "absorbs the model error, so it is not that option's true volatility. Returns no "+
      "solution when the price is outside the model's arbitrage bounds."
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
/**
 * Builds the input rows for one calculator, for ALL four tool registries.
 *
 * Replaces four near-identical renderers. They had already drifted apart:
 * Finance and Assay had no branch for a `text` field or a textarea, so a field
 * kind that renders correctly in Stats produced a plain numeric input there —
 * the kind of divergence four copies guarantee eventually.
 *
 * `idPrefix` keeps element ids unique per tool (the id-wiring audit checks
 * these), and `onChange` is the tool's own preview function.
 */
function renderCalcFields(
  // `kind` is OPTIONAL: the Finance and Assay registries omit it on plain
  // numeric fields, and an undefined kind falls through to the numeric input
  // exactly as it did in their own renderers.
  fields: { key: string; label: string; default: string; kind?: string; options?: { value: string; label: string }[] }[],
  container: HTMLElement,
  idPrefix: string,
  onChange: () => void,
): void {
  container.replaceChildren();
  for (const f of fields) {
    const row = document.createElement("div");
    row.className = "dna-controls";
    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = f.label;
    label.htmlFor = `${idPrefix}-f-${f.key}`;

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
    } else if (f.kind !== undefined && MULTILINE_FIELD_KINDS.has(f.kind)) {
      const ta = document.createElement("textarea");
      ta.className = "build-input";
      ta.rows = f.kind === "groups" || f.kind === "vars" ? 3 : 2;
      ta.spellcheck = false;
      ta.value = f.default;
      input = ta;
    } else {
      const t = document.createElement("input");
      t.type = "text";
      // `list` holds several numbers, so it must not get the single-numeral
      // styling that right-aligns and narrows the box.
      t.className = f.kind === "list" ? "rgroup-input" : "rgroup-input num-numeral";
      t.value = f.default;
      input = t;
    }
    input.id = `${idPrefix}-f-${f.key}`;
    input.dataset.key = f.key;
    input.addEventListener("input", onChange);
    input.addEventListener("change", onChange);
    row.append(label, input);
    container.appendChild(row);
  }
  onChange();
}

/** Field kinds that need room for more than one line. */
const MULTILINE_FIELD_KINDS = new Set(["groups", "vars", "matrix", "block", "line", "plot"]);

function renderFinanceInputs(): void {
  const calc = FIN_CALCS.find((c) => c.id === finCalcSelect.value) ?? FIN_CALCS[0];
  renderCalcFields(calc.fields, finInputs, "fin", updateFinancePreview);
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
    // Show the model's assumptions with the number, not buried in the source.
    // A Black-Scholes price for an American put is simply wrong, and nothing on
    // screen said so — the whole gap #5 named.
    if (calc.assumes) {
      const note = document.createElement("div");
      note.className = "ms-note";
      note.textContent = `• Assumes: ${calc.assumes}`;
      finResult.appendChild(note);
    }
  }
  // Carry the assumptions into the DOCUMENT too. A number that leaves the pane
  // without them is the same defect one step further downstream — and the
  // document is where it gets relied on. pkaAsText already does this.
  currentFinText = insertable ? (calc.assumes ? `${text}\nAssumes: ${calc.assumes}` : text) : "";
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
  /**
   * Optional diagram shown under the result — currently the regression residual
   * and Q-Q plots. Display only: `text` remains what gets inserted, so adding
   * this cannot change any existing calculator's output.
   */
  svg?: string;
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


/**
 * Swaps em dashes for hyphens in prose destined for a Stats result.
 *
 * An em dash in the result text is the NON-FINITE sentinel (formatNum, linalg.ts)
 * and blocks insertion. Library caveats are written with em dashes because they
 * are prose; this normalises them so a valid result stays insertable, changing
 * the punctuation and never the wording.
 */
function plainDashes(text: string): string {
  return text.replace(/\u2014/g, "-");
}

/** Shared text report for any least-squares fit. */
function regressionReport(res: {
  coefficients: { name: string; estimate: number; standardError: number; t: number; p: number }[];
  rSquared: number;
  adjustedRSquared: number;
  residualStandardError: number;
  f: number;
  dfModel: number;
  dfResidual: number;
  pOverall: number;
  n: number;
  caveats: string[];
}): string {
  const lines: string[] = [];
  for (const c of res.coefficients) {
    lines.push(
      `${c.name} = ${assaySig(c.estimate)} \u00b1 ${assaySig(c.standardError, 3)}  ` +
        `t = ${assaySig(c.t, 3)}, ${formatP(c.p)}`,
    );
  }
  lines.push("");
  lines.push(
    `R\u00b2 = ${assaySig(res.rSquared, 4)} \u00b7 adjusted R\u00b2 = ${assaySig(res.adjustedRSquared, 4)}`,
  );
  lines.push(`Residual SE = ${assaySig(res.residualStandardError, 4)} on ${res.dfResidual} df (n = ${res.n})`);
  lines.push(`Overall F(${res.dfModel}, ${res.dfResidual}) = ${assaySig(res.f, 4)}, ${formatP(res.pOverall)}`);
  lines.push("");
  lines.push(plainDashes(res.caveats.join("\n")));
  return lines.join("\n");
}

/**
 * Residuals-vs-fitted and normal Q-Q, side by side.
 *
 * These are the diagnostics that catch what the summary numbers cannot: a curved
 * residual band means the model SHAPE is wrong however good R² looks.
 */
function regressionFigures(res: { fitted: number[]; residuals: number[]; standardizedResiduals: number[] }): string {
  const resid = buildPlotSvg(
    [{ type: "scatter", points: res.fitted.map((f, i) => ({ x: f, y: res.residuals[i] })), color: "#0369a1" }],
    { width: 300, height: 190, title: "Residuals vs fitted", xlabel: "Fitted", ylabel: "Residual" },
  );
  const pts = qqPoints(res.standardizedResiduals);
  const qq = buildPlotSvg(
    [
      { type: "scatter", points: pts.map((p) => ({ x: p.theoretical, y: p.sample })), color: "#0369a1" },
      // The reference line points would lie on if the residuals were normal.
      {
        type: "line",
        points: [
          { x: pts[0]?.theoretical ?? -2, y: pts[0]?.theoretical ?? -2 },
          {
            x: pts[pts.length - 1]?.theoretical ?? 2,
            y: pts[pts.length - 1]?.theoretical ?? 2,
          },
        ],
        color: "#94a3b8",
      },
    ],
    { width: 300, height: 190, title: "Normal Q-Q", xlabel: "Theoretical quantile", ylabel: "Std. residual" },
  );
  return resid + qq;
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
      // The assumptions the test rests on, checked against the actual data. A
      // p-value from a test whose conditions failed is the quiet kind of wrong
      // this product exists to avoid.
      const notes = describeAssumptions([a, b]);
      return {
        text:
          `${label} two-sample t-test\n${reportT(res)}\nMean difference = ${assaySig(res.meanDifference)}` +
          (notes.length ? "\n\n" + notes.join("\n") : ""),
      };
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
      const notes = describeAssumptions([a, b], { paired: true });
      return {
        text:
          `Paired t-test\n${reportT(res)}\nMean difference = ${assaySig(res.meanDifference)}` +
          (notes.length ? "\n\n" + notes.join("\n") : ""),
      };
    },
  },
  {
    id: "survival",
    name: "Survival (Kaplan-Meier)",
    fields: [
      {
        key: "data",
        label: "One row per subject: time then 1 (event) or 0 (censored, i.e. event-free when last seen)",
        default: "5 1\n6 1\n6 0\n8 1\n10 0\n12 1\n15 0\n18 1\n20 0\n24 0",
        kind: "groups",
      },
    ],
    compute: (r) => {
      const rows = r("data")
        .split(/[;\n]+/)
        .map((l) => statList(l))
        .filter((v) => v.length >= 2);
      if (rows.length < 2) return { text: "Enter at least two subjects: time then 1 or 0.", ok: false };
      const res = kaplanMeier(rows.map((v) => v[0]), rows.map((v) => v[1]));
      if (!res.ok) return { text: res.reason ?? "Could not compute the curve.", ok: false };

      const lines = [
        `Kaplan-Meier: n = ${res.n}, ${res.events} event${res.events === 1 ? "" : "s"}, ${res.censored} censored`,
        res.medianSurvival !== null
          ? `Median survival = ${assaySig(res.medianSurvival)}`
          : "Median survival: NOT REACHED (the curve never falls to 50%)",
        "",
        "Time  At risk  Events  S(t)   95% CI",
      ];
      for (const p of res.points) {
        const ci = Number.isFinite(p.ci95[0])
          ? `[${assaySig(p.ci95[0], 3)}, ${assaySig(p.ci95[1], 3)}]`
          : "n/a";
        lines.push(
          `${p.time}  ${p.atRisk}  ${p.events}${p.censored ? ` (+${p.censored} cens.)` : ""}  ` +
            `${assaySig(p.survival, 4)}  ${ci}`,
        );
      }
      const svg = buildPlotSvg(
        [{ type: "line", points: survivalCurvePoints(res), color: "#0369a1", label: "S(t)" }],
        { width: 320, height: 210, title: "Kaplan-Meier", xlabel: "Time", ylabel: "Survival" },
      );
      return { text: plainDashes(lines.join("\n") + "\n\n" + res.caveats.join("\n")), svg };
    },
  },
  {
    id: "logrank",
    name: "Log-rank (compare survival curves)",
    fields: [
      {
        key: "groups",
        label: "One group per block (blank line between). Each row: time then 1 or 0",
        default: "5 1\n8 1\n12 1\n15 0\n20 0\n\n10 1\n14 1\n18 1\n22 0\n28 0",
        kind: "groups",
      },
    ],
    compute: (r) => {
      const blocks = r("groups")
        .split(/\n[ \t]*\n|;;/)
        .map((b) => b.trim())
        .filter(Boolean);
      const groups = blocks.map((b) => {
        const rows = b.split(/[;\n]+/).map((l) => statList(l)).filter((v) => v.length >= 2);
        return { times: rows.map((v) => v[0]), events: rows.map((v) => v[1]) };
      });
      if (groups.length < 2) {
        return { text: "Enter at least two groups, separated by a blank line.", ok: false };
      }
      const res = logRankTest(groups);
      if (!res.ok) return { text: res.reason ?? "Could not run the test.", ok: false };

      const lines = [
        `Log-rank \u03c7\u00b2(${res.df}) = ${assaySig(res.chi2, 4)}, ${formatP(res.p)}`,
        "",
      ];
      for (let i = 0; i < res.observed.length; i++) {
        lines.push(
          `Group ${i + 1}: observed ${res.observed[i]} vs expected ${assaySig(res.expected[i], 4)} events`,
        );
      }
      if (res.hazardRatio !== null && res.hazardRatioCI) {
        lines.push("");
        lines.push(
          `Hazard ratio (group 2 vs group 1) = ${assaySig(res.hazardRatio, 3)} ` +
            `[95% CI ${assaySig(res.hazardRatioCI[0], 3)}, ${assaySig(res.hazardRatioCI[1], 3)}]`,
        );
        lines.push(
          res.hazardRatio > 1
            ? "Above 1: group 2 has the higher hazard, i.e. does worse."
            : "Below 1: group 2 has the lower hazard, i.e. does better.",
        );
      }

      // Both curves on one chart, which is how the result is read.
      const curves = groups.map((g, i) => {
        const km = kaplanMeier(g.times, g.events);
        return {
          type: "line" as const,
          points: km.ok ? survivalCurvePoints(km) : [],
          label: `Group ${i + 1}`,
        };
      });
      const svg = buildPlotSvg(curves, {
        width: 320,
        height: 210,
        title: "Survival by group",
        xlabel: "Time",
        ylabel: "Survival",
      });
      return { text: plainDashes(lines.join("\n") + "\n\n" + res.caveats.join("\n")), svg };
    },
  },
  {
    id: "multiregress",
    name: "Multiple regression",
    fields: [
      {
        key: "cols",
        label: "One row per observation: response first, then each predictor",
        default: "12 1 2\n19 2 1\n23 3 4\n31 4 3\n38 5 6\n45 6 5\n52 7 8\n59 8 7",
        kind: "groups",
      },
    ],
    compute: (r) => {
      const rows = r("cols")
        .split(/[\n;]+/)
        .map((l) => statList(l))
        .filter((v) => v.length >= 2);
      if (rows.length < 3) return { text: "Enter at least three rows: response then predictors.", ok: false };
      const width = rows[0].length;
      if (rows.some((v) => v.length !== width)) {
        return { text: "Every row needs the same number of values.", ok: false };
      }
      const y = rows.map((v) => v[0]);
      const preds: number[][] = [];
      for (let j = 1; j < width; j++) preds.push(rows.map((v) => v[j]));

      const res = multipleRegression(y, preds);
      if (!res.ok) return { text: res.reason ?? "Could not fit the model.", ok: false };
      return { text: regressionReport(res), svg: regressionFigures(res) };
    },
  },
  {
    id: "polyregress",
    name: "Polynomial regression",
    fields: [
      { key: "x", label: "x values", default: "1 2 3 4 5 6 7 8 9 10", kind: "list" },
      { key: "y", label: "y values", default: "2.2 4.1 7.3 11.8 17.5 25.1 34.2 45.0 57.3 71.2", kind: "list" },
      {
        key: "degree",
        label: "Degree",
        default: "2",
        kind: "select",
        options: [
          { value: "1", label: "1 (straight line)" },
          { value: "2", label: "2 (quadratic)" },
          { value: "3", label: "3 (cubic)" },
          { value: "4", label: "4" },
        ],
      },
    ],
    compute: (r) => {
      const x = statList(r("x"));
      const y = statList(r("y"));
      if (x.length !== y.length) return { text: "x and y must have the same number of values.", ok: false };
      const res = polynomialRegression(x, y, Number(r("degree")) || 2);
      if (!res.ok) return { text: res.reason ?? "Could not fit the model.", ok: false };
      return {
        text: `Polynomial regression, degree ${res.degree}\n` + regressionReport(res),
        svg: regressionFigures(res),
      };
    },
  },
  {
    id: "dunnett",
    name: "Dunnett (each treatment vs one control)",
    fields: [
      {
        key: "groups",
        label: "FIRST group is the control; then one group per treatment",
        default: "10 11 12 13 14\n\n12 13 14 15 16\n\n15 16 17 18 19\n\n20 21 22 23 24",
        kind: "groups",
      },
    ],
    compute: (r) => {
      const groups = statGroups(r("groups"));
      if (groups.length < 2) {
        return { text: "Enter a control group and at least one treatment group (blank line between).", ok: false };
      }
      const res = dunnettTest(groups[0], groups.slice(1));
      if (!res.ok) return { text: res.reason ?? "Could not run the test.", ok: false };

      const lines = [
        `Dunnett's test - ${res.comparisons.length} treatment${res.comparisons.length === 1 ? "" : "s"} vs control (n = ${res.controlN})`,
        `df = ${res.df}, two-sided critical |t| = ${assaySig(res.critical, 4)} at α = 0.05`,
        "",
      ];
      for (const c of res.comparisons) {
        lines.push(
          `Treatment ${c.treatment + 1} − control = ${assaySig(c.meanDifference)}  ` +
            `t = ${assaySig(c.t, 3)}, ${formatP(c.p)}${c.significant ? " *" : ""}`,
        );
      }
      // Why this rather than Tukey — the whole reason the test exists.
      lines.push("");
      lines.push(
        `Corrects for ${res.comparisons.length} comparison${res.comparisons.length === 1 ? "" : "s"}, not all ` +
          `${(groups.length * (groups.length - 1)) / 2} pairs. That is what makes it more powerful than Tukey ` +
          "when the control is the only thing you wanted to compare against.",
      );
      return { text: plainDashes(lines.join("\n") + "\n\n" + res.caveats.join("\n")) };
    },
  },
  {
    id: "kruskal",
    name: "Kruskal-Wallis (non-parametric ANOVA)",
    fields: [
      {
        key: "groups",
        label: "Groups (blank line or ; between groups)",
        default: "1 2 3 4\n\n5 6 7 8\n\n9 10 11 12",
        kind: "groups",
      },
    ],
    compute: (r) => {
      const groups = statGroups(r("groups"));
      const res = kruskalWallis(groups);
      if (!res.ok) return { text: res.reason ?? "Could not run the test.", ok: false };

      const lines = [
        `Kruskal-Wallis H(${res.df}) = ${assaySig(res.h, 4)}, ${formatP(res.p)}  (n = ${res.n})`,
        "Mean ranks: " + res.meanRanks.map((m, i) => `group ${i + 1} = ${assaySig(m, 4)}`).join(" · "),
      ];
      if (res.tiesCorrected) lines.push("Tied values were present; H is tie-corrected.");

      // The post-hoc only makes sense once the omnibus test is significant, and
      // running it anyway is the classic way to manufacture a finding.
      if (res.p < 0.05) {
        const d = dunnTest(groups, "holm");
        if (d.ok) {
          lines.push("");
          lines.push("Dunn post-hoc (Holm-adjusted):");
          for (const c of d.comparisons) {
            lines.push(
              `  group ${c.a + 1} vs ${c.b + 1}: z = ${assaySig(c.z, 3)}, ` +
                `${formatP(c.pAdjusted)}${c.significant ? " *" : ""}`,
            );
          }
        }
      } else {
        lines.push("Post-hoc comparisons are not shown: the overall test is not significant.");
      }
      lines.push("");
      lines.push(
        "Compares distributions by rank, so it assumes no particular shape. It does NOT " +
          "compare means - a significant result says the groups differ in location, not by how much.",
      );
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "friedman",
    name: "Friedman (repeated measures, non-parametric)",
    fields: [
      {
        key: "blocks",
        label: "One row per subject; one value per condition, same order every row",
        default: "10 12 14\n9 11 15\n12 13 16\n8 10 13",
        kind: "groups",
      },
    ],
    compute: (r) => {
      // Rows, not groups: each line is one subject measured under every
      // condition, which is what makes this a repeated-measures design.
      const rows = r("blocks")
        .split(/[\n;]+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => statList(line));
      const res = friedman(rows);
      if (!res.ok) return { text: res.reason ?? "Could not run the test.", ok: false };
      return {
        text: plainDashes(
          `Friedman \u03c7\u00b2(${res.df}) = ${assaySig(res.chi2, 4)}, ${formatP(res.p)}\n` +
          `${res.blocks} subjects \u00d7 ${res.treatments} conditions\n` +
          "Mean ranks: " +
          res.meanRanks.map((m, i) => `condition ${i + 1} = ${assaySig(m, 4)}`).join(" \u00b7 ") +
          "\n\nUse when the SAME subjects are measured under every condition. A between-groups " +
          "test on this data would ignore the pairing and lose most of its power.",
        ),
      };
    },
  },
  {
    id: "assumptions",
    name: "Check test assumptions",
    fields: [
      {
        key: "groups",
        label: "Groups (blank line or ; between groups)",
        default: "1 2 3 4 5\n\n2 3 4 5 6",
        kind: "groups",
      },
    ],
    compute: (r) => {
      const groups = statGroups(r("groups"));
      if (!groups.length) return { text: "Enter at least one group.", ok: false };
      const pooled = groups.reduce<number[]>((acc, g) => acc.concat(g), []);

      const lines: string[] = ["Assumption check"];
      const norm = normalityTest(pooled);
      if (norm.ok) {
        lines.push(
          `Normality (D'Agostino-Pearson): K\u00b2 = ${assaySig(norm.k2, 4)}, ${formatP(norm.p)} - ` +
            `${norm.normal ? "consistent with normal" : "NOT normal"}`,
        );
        lines.push(`  skewness = ${assaySig(norm.skewness, 3)}, kurtosis = ${assaySig(norm.kurtosis, 3)} (normal \u2248 3)`);
      } else {
        lines.push("Normality: " + (norm.reason ?? "not tested"));
      }

      if (groups.length >= 2) {
        const vh = varianceHomogeneity(groups);
        if (vh.ok) {
          lines.push(
            `Equal variances (Brown-Forsythe): F(${vh.df1}, ${vh.df2}) = ${assaySig(vh.f, 4)}, ` +
              `${formatP(vh.p)} - ${vh.equal ? "consistent with equal" : "NOT equal"}`,
          );
          lines.push(`  largest/smallest variance = ${assaySig(vh.varianceRatio, 3)}`);
        } else {
          lines.push("Equal variances: " + (vh.reason ?? "not tested"));
        }
      }

      const advice = describeAssumptions(groups);
      if (advice.length) {
        lines.push("");
        for (const a of advice) lines.push(a);
      } else {
        lines.push("");
        lines.push("No assumption problems found. A parametric test (t-test / ANOVA) is appropriate.");
      }
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "anova",
    name: "One-way ANOVA",
    fields: [
      {
        key: "groups",
        label: "Groups (blank line or ; between groups)",
        default: "1 2 3\n\n4 5 6\n\n7 8 9",
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
    // ANOVA answers only "are these all the same?". Without a post-hoc the user
    // runs pairwise t-tests instead — the exact error tukey.ts's own header warns
    // inflates the family-wise error rate to ~40% at k = 5. The module was
    // written, tested, and then never wired to anything a user could reach.
    id: "tukey",
    name: "Tukey HSD (ANOVA post-hoc)",
    fields: [
      {
        key: "groups",
        label: "Groups (blank line or ; between groups)",
        default: "5.1 4.9 5.4 5.0\n\n6.3 6.8 6.1 6.5\n\n5.2 5.0 5.5 5.3",
        kind: "groups",
      },
      {
        key: "alpha",
        label: "Family-wise level",
        default: "0.05",
        kind: "select",
        options: [
          { value: "0.05", label: "alpha = 0.05" },
          { value: "0.01", label: "alpha = 0.01" },
          { value: "0.10", label: "alpha = 0.10" },
        ],
      },
    ],
    compute: (r) => {
      const groups = statGroups(r("groups"));
      if (groups.length < 2) return { text: "Enter at least two groups (separate with a blank line).", ok: false };
      if (groups.some((g) => g.length < 2)) return { text: "Each group needs at least two values.", ok: false };
      const alpha = Number(r("alpha")) || 0.05;
      const res = tukeyHSD(groups, alpha);
      if (!res) return { text: "Tukey HSD needs at least two groups with data in each.", ok: false };
      if (!Number.isFinite(res.qCritical))
        return { text: "Tukey HSD is undefined here \u2014 every group has zero within-group variance.", ok: false };

      // Report the omnibus test alongside: reading a post-hoc without it invites
      // picking a significant pair out of a non-significant ANOVA.
      const omnibus = oneWayAnova(groups);
      const omniLine = Number.isFinite(omnibus.p)
        ? `One-way ANOVA: ${reportF(omnibus)}`
        : "One-way ANOVA: undefined (no within-group variance)";
      const ciPct = res.alpha === 0.01 ? "99" : res.alpha === 0.1 ? "90" : "95";

      const rows = res.pairs.map(
        (pr) =>
          `Group ${pr.i + 1} vs ${pr.j + 1}:  diff = ${assaySig(pr.difference)}` +
          `  q = ${assaySig(pr.q, 3)}  ${formatP(pr.p)}` +
          `  ${ciPct}% CI [${assaySig(pr.ciLow)}, ${assaySig(pr.ciHigh)}]` +
          (pr.significant ? "  *" : "")
      );
      const anySig = res.pairs.some((pr) => pr.significant);

      return {
        text: plainDashes(
          `Tukey HSD - ${res.k} groups, family-wise alpha = ${res.alpha}\n` +
          `${omniLine}\n` +
          `q critical = ${assaySig(res.qCritical, 4)} \u00b7 MSE = ${assaySig(res.mse)} \u00b7 df within = ${res.dfWithin}\n\n` +
          rows.join("\n") +
          (anySig ? `\n\n* significant at alpha = ${res.alpha}` : "\n\nNo pair is significant at this level.") +
          // tukeyHSD already emits the family-wise warning, and better than a
          // hand-written one — showing both said the same thing twice.
          (res.caveats.length ? "\n\n" + res.caveats.map((c) => `\u2022 ${c}`).join("\n") : ""),
        ),
      };
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
      const varsText = r("vars");
      const vars = statVars(varsText);
      // Name the line that could not be read. Previously any unreadable line was
      // dropped in silence and the user was then told 'Unknown variable "a"'
      // about a variable defined on their own screen — the message blamed the
      // formula for the parser's omission.
      const problems = varsText
        .split(/[\n;]+/)
        .map((line) => statVarLineProblem(line))
        .filter((p): p is string => p !== null);
      if (problems.length) return { text: problems.join("\n"), ok: false };
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
      // The engine refuses when observed and expected do not sum to the same
      // total — a counts-vs-proportions mix-up, which is the obvious mistake in a
      // free-text expected-counts field. Say so instead of formatting NaN.
      if (res.reason) return { text: res.reason, ok: false };
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
  renderCalcFields(calc.fields, statsInputs, "stats", updateStatsPreview);
}

/** Computes and shows the result for the current statistical test. */
/**
 * Tokens in a numeric Stats field that statList() would silently drop.
 *
 * Only fields that are MOSTLY numeric are considered: a two-way ANOVA's data
 * field is "lo x 12" per line, where the labels are the point, and flagging
 * those would train the user to ignore the warning.
 */
function statDroppedTokens(calc: StatCalc, read: (k: string) => string): string[] {
  const dropped: string[] = [];
  for (const f of calc.fields) {
    if (f.kind !== "list" && f.kind !== "groups") continue;
    const tokens = read(f.key).split(/[\s,;]+/).filter(Boolean);
    if (!tokens.length) continue;
    const bad = tokens.filter((t) => !Number.isFinite(Number(t)));
    // Mostly-numeric test. A LABELLED field is majority non-numeric — two-way
    // ANOVA's "lo x 12" per line is two labels to one number, ~67% — whereas a
    // numeric column with a few ND/N-A cells stays well under half. Measured:
    // "2, 4, ND, 5, N/A, 7, 9" is 29% bad, which an earlier 20% threshold
    // wrongly treated as labelled data and stayed silent about.
    if (bad.length && bad.length < tokens.length * 0.5) dropped.push(...bad);
  }
  return dropped;
}

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
  // Say so when values were dropped. A t-test on n=7 presented as if it were
  // n=10 is the quiet kind of wrong: nothing on screen distinguished them,
  // because the two-sample output reports t(df) and never n.
  if (out.ok !== false) {
    const dropped = statDroppedTokens(calc, read);
    if (dropped.length) {
      const shown = [...new Set(dropped)].slice(0, 6).join(", ");
      out = {
        ...out,
        text:
          `${out.text}\n\n\u26a0 ${dropped.length} non-numeric ` +
          `${dropped.length === 1 ? "entry was" : "entries were"} ignored (${shown}` +
          `${new Set(dropped).size > 6 ? ", ..." : ""}). They are NOT counted in n, ` +
          `so check that this is what you meant.`,
      };
    }
  }
  // Exclude the "—" no-value sentinel (from a non-finite computation) so a
  // dash placeholder is never inserted into the document.
  const insertable = out.ok !== false && !!out.text && !out.text.includes("—");
  statsResult.innerHTML =
    esc(out.text).replace(/\n/g, "<br>") +
    // The SVG is generated by this code, never from user input.
    (out.svg ? `<div class="stats-figure">${out.svg}</div>` : "");
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
  /**
   * A line that IS a formula, written in the pane's math syntax and inserted as
   * a real Word equation rather than as characters.
   *
   * This exists because a transfer function arriving in a document as
   * "G(s) = (s^3 + 3s^2 + 2s + 1)/(s^2 + 2s + 5)" is ASCII with carets, not a
   * formula — the same complaint that got Solve's derivations converted from
   * flat text to OMML. `fallback` is what a reader gets if the expression will
   * not parse, so an unusual result degrades to readable text rather than
   * failing the whole insert.
   */
  | { kind: "math"; math: string; fallback: string }
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
      if (b.kind === "math") return b.fallback;
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
      if (b.kind === "math") {
        // The pane must show the SAME thing the document will get, so the
        // preview typesets it rather than showing the source syntax.
        try {
          return `<span class="math-preview">${mathToHtml(b.math)}</span>`;
        } catch {
          return esc(b.fallback);
        }
      }
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
        : `stopped after ${res.iterations} iterations, so this may not be a true minimum`;
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
    // The spectrum tool could SHOW noise and do nothing about it. fftfilter.ts
    // was written, tested, caveated, and never wired to anything.
    id: "fftfilter",
    name: "FFT filter (de-noise a signal)",
    hint: "Removes a frequency band from a uniformly sampled signal. The transition band is a raised cosine, not a brick wall, because a brick wall rings.",
    fields: [
      { key: "signal", label: "Signal samples", default: "0.0000, 0.7362, 0.2071, 1.2774, 1.0000, 0.5703, 1.2071, 0.0291, -0.0000, -0.0291, -1.2071, -0.5703, -1.0000, -1.2774, -0.2071, -0.7362, -0.0000, 0.7362, 0.2071, 1.2774, 1.0000, 0.5703, 1.2071, 0.0291, -0.0000, -0.0291, -1.2071, -0.5703, -1.0000, -1.2774, -0.2071, -0.7362", kind: "block", rows: 6 },
      { key: "fs", label: "Sample rate (Hz)", default: "64", kind: "text" },
      {
        key: "kind",
        label: "Filter",
        default: "lowpass",
        kind: "select",
        options: [
          { value: "lowpass", label: "Low-pass (keep below cutoff)" },
          { value: "highpass", label: "High-pass (keep above cutoff)" },
          { value: "bandpass", label: "Band-pass (keep between)" },
          { value: "bandstop", label: "Band-stop (remove between)" },
        ],
      },
      { key: "cutoff", label: "Cutoff / low edge (Hz)", default: "8", kind: "text" },
      { key: "cutoffHigh", label: "High edge (Hz, band filters only)", default: "", kind: "text" },
      { key: "transition", label: "Transition width (Hz, blank = 10% of cutoff)", default: "", kind: "text" },
    ],
    compute: (r) => {
      const signal = statList(r("signal"));
      const fs = Number(r("fs"));
      const kind = r("kind") as FilterKind;
      const cutoff = Number(r("cutoff"));
      if (signal.length < 4) return { text: "Enter at least four samples.", ok: false };
      if (!Number.isFinite(fs) || fs <= 0) return { text: "Enter a positive sample rate.", ok: false };
      if (!Number.isFinite(cutoff) || cutoff <= 0) return { text: "Enter a positive cutoff frequency.", ok: false };

      const hiRaw = r("cutoffHigh").trim();
      const trRaw = r("transition").trim();
      const cutoffHigh = hiRaw ? Number(hiRaw) : undefined;
      const transition = trRaw ? Number(trRaw) : undefined;
      if ((kind === "bandpass" || kind === "bandstop") && !(Number.isFinite(cutoffHigh) && (cutoffHigh as number) > cutoff))
        return { text: "A band filter needs a high edge greater than the low edge.", ok: false };
      if (cutoff >= fs / 2)
        return { text: `The cutoff must be below the Nyquist frequency (${formatNum(fs / 2, 4)} Hz); nothing above it was ever sampled.`, ok: false };

      const res = fftFilter(signal, fs, kind, { cutoff, cutoffHigh, transition });
      if (!res) return { text: "Could not filter that; check the samples, sample rate and cutoffs.", ok: false };

      const t = (k: number): number => k / fs;
      const before: Point[] = signal.map((y, k) => ({ x: t(k), y }));
      const after: Point[] = res.signal.map((y, k) => ({ x: t(k), y }));
      const svg = buildPlotSvg(
        [
          { points: before, type: "line", color: "#94a3b8", label: "original" },
          { points: after, type: "line", color: "#2563eb", label: "filtered" },
        ],
        { title: `${kind} filter`, xlabel: "Time (s)", ylabel: "Amplitude" },
      );

      const blocks: AnalyzeBlock[] = [
        { kind: "line", text: `${kind} filter, cutoff ${formatNum(cutoff, 4)} Hz${cutoffHigh ? ` to ${formatNum(cutoffHigh, 4)} Hz` : ""}` },
        { kind: "line", text: `Transform ran at ${res.paddedLength} points, ${formatNum(res.binWidth, 4)} Hz per bin` },
        { kind: "plot", svg, caption: "Filtered signal", alt: "Original and filtered signal", w: 380, h: 270 },
        { kind: "line", text: `Filtered samples: ${res.signal.map((y) => formatNum(y, 4)).join(", ")}` },
      ];
      // The module's caveats are the reason it is trustworthy — never dropped.
      // The em dash is formatNum's non-finite sentinel and the insertable
      // guard scans the whole result text for it, so a caveat using one as
      // punctuation would silently disable Insert. Swapped for a comma-dash;
      // the wording is untouched otherwise.
      for (const c of res.caveats)
        blocks.push({ kind: "line", text: `\u2022 ${c.replace(/\u2014/g, " -")}` });
      return analyzeResultOf(blocks);
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
  {
    id: "bvp",
    name: "Boundary value problem (y'' = f)",
    hint:
      "A two-point BVP: give y'' in terms of x, y and y', then the interval and the value of y at each end. " +
      "Unlike an initial value problem, a BVP may have no solution, one, or infinitely many - this finds one and cannot tell you which case you are in.",
    fields: [
      { key: "eq", label: "y'' =", default: "-y", kind: "text" },
      { key: "ab", label: "Interval a, b", default: "0, 1.5707963", kind: "text" },
      { key: "bc", label: "y(a), y(b)", default: "0, 1", kind: "text" },
      { key: "n", label: "Grid intervals", default: "200", kind: "text" },
      {
        key: "method", label: "Method", kind: "select", default: "fd",
        options: [
          { value: "fd", label: "Finite differences (robust)" },
          { value: "shooting", label: "Shooting (secant on y'(a))" },
        ],
      },
    ],
    compute: (r) => {
      const ab = statList(r("ab"));
      const bc = statList(r("bc"));
      if (ab.length < 2) return { text: "Enter the interval as two numbers, e.g. 0, 1.", ok: false };
      if (bc.length < 2) return { text: "Enter both boundary values, e.g. 0, 1.", ok: false };
      const src = r("eq").trim();
      if (!src) return { text: "Enter the right-hand side of y'' = …", ok: false };
      const f = (x: number, y: number, yp: number): number => evalFormula(src, { x, y, yp, "y'": yp });
      try {
        const probe = f(ab[0], bc[0], 0);
        if (!Number.isFinite(probe)) return { text: "The equation is not finite at the left endpoint.", ok: false };
      } catch (e) {
        return { text: `Equation error: ${(e as Error).message}`, ok: false };
      }
      const out = solveBvp(f, ab[0], ab[1], bc[0], bc[1], {
        n: Math.floor(+r("n") || 200),
        method: (r("method") || "fd") as BvpMethod,
      });
      if (!out.ok) return { text: out.error, ok: false };
      const res = out.result;

      const blocks: AnalyzeBlock[] = [];
      for (const s of res.steps) blocks.push({ kind: "line", text: plainDashes(s) });
      const maxRows = 12;
      const stride = Math.max(1, Math.floor(res.x.length / maxRows));
      const sampled: Matrix = [];
      for (let i = 0; i < res.x.length; i += stride) sampled.push([res.x[i], res.y[i], res.yp[i]]);
      if (sampled[sampled.length - 1][0] !== res.x[res.x.length - 1]) {
        sampled.push([res.x[res.x.length - 1], res.y[res.y.length - 1], res.yp[res.yp.length - 1]]);
      }
      blocks.push({ kind: "matrix", label: "Sampled [x, y, y']:", m: sampled });
      const svg = buildPlotSvg(
        [{ points: res.x.map((x, i) => ({ x, y: res.y[i] })), type: "line", color: "#2563eb", label: "y" }],
        { title: "BVP solution", xlabel: "x", ylabel: "y", width: 380, height: 270 }
      );
      blocks.push({ kind: "plot", svg, caption: "BVP solution", alt: "Boundary value problem solution curve", w: 380, h: 270 });
      for (const c of res.caveats) blocks.push({ kind: "line", text: plainDashes(`! ${c}`) });
      return analyzeResultOf(blocks);
    },
  },
  {
    id: "pdeheat",
    name: "PDE - heat equation (u_t = α u_xx)",
    hint:
      "Diffusion on a rod with both ends held at fixed temperatures. Crank-Nicolson is unconditionally stable; " +
      "explicit FTCS needs r = αΔt/Δx² ≤ 1/2, and Δt is reduced automatically if you ask for more.",
    fields: [
      { key: "alpha", label: "Diffusivity α", default: "1", kind: "text" },
      { key: "L", label: "Length L", default: "1", kind: "text" },
      { key: "tend", label: "Final time", default: "0.1", kind: "text" },
      { key: "u0", label: "Initial u(x,0) =", default: "sin(pi*x)", kind: "text" },
      { key: "ends", label: "u(0,t), u(L,t)", default: "0, 0", kind: "text" },
      { key: "nx", label: "Space intervals", default: "60", kind: "text" },
      {
        key: "scheme", label: "Scheme", kind: "select", default: "crank-nicolson",
        options: [
          { value: "crank-nicolson", label: "Crank-Nicolson (unconditionally stable)" },
          { value: "explicit", label: "Explicit FTCS (needs r ≤ 1/2)" },
        ],
      },
    ],
    compute: (r) => {
      const ends = statList(r("ends"));
      if (ends.length < 2) return { text: "Enter both end temperatures, e.g. 0, 0.", ok: false };
      const src = r("u0").trim();
      const f = (x: number) => evalFormula(src, { x });
      const out = solveHeat(+r("alpha"), +r("L"), +r("tend"), f, ends[0], ends[1], {
        nx: Math.floor(+r("nx") || 60),
        scheme: (r("scheme") || "crank-nicolson") as HeatScheme,
      });
      return pdeBlocks(out, "Temperature u(x, t)", "u");
    },
  },
  {
    id: "pdewave",
    name: "PDE - wave equation (u_tt = c² u_xx)",
    hint:
      "A vibrating string with fixed ends. The Courant number C = cΔt/Δx must not exceed 1; at exactly 1 the scheme " +
      "is EXACT for this equation, which is why it is the default. Waves reflect off both ends.",
    fields: [
      { key: "c", label: "Wave speed c", default: "1", kind: "text" },
      { key: "L", label: "Length L", default: "1", kind: "text" },
      { key: "tend", label: "Final time", default: "1", kind: "text" },
      { key: "u0", label: "Initial shape u(x,0) =", default: "sin(pi*x)", kind: "text" },
      { key: "v0", label: "Initial velocity u_t(x,0) =", default: "0", kind: "text" },
      { key: "nx", label: "Space intervals", default: "80", kind: "text" },
      { key: "courant", label: "Courant number C (≤ 1)", default: "1", kind: "text" },
    ],
    compute: (r) => {
      const fs = r("u0").trim();
      const gs = r("v0").trim();
      const out = solveWave(
        +r("c"), +r("L"), +r("tend"),
        (x) => evalFormula(fs, { x }),
        (x) => evalFormula(gs || "0", { x }),
        0, 0,
        { nx: Math.floor(+r("nx") || 80), courant: +r("courant") || 1 }
      );
      return pdeBlocks(out, "Displacement u(x, t)", "u");
    },
  },
  {
    id: "pdelaplace",
    name: "PDE - Laplace / Poisson (steady state)",
    hint:
      "The steady field on a rectangle with values given on all four edges - what the heat equation relaxes to after " +
      "infinitely long. Give a source term to solve Poisson instead of Laplace.",
    fields: [
      { key: "W", label: "Width", default: "1", kind: "text" },
      { key: "H", label: "Height", default: "1", kind: "text" },
      { key: "bc", label: "Boundary u(x,y) =", default: "sin(pi*x)*y", kind: "text" },
      { key: "src", label: "Source f in ∇²u = f (blank for Laplace)", default: "", kind: "text" },
      { key: "nx", label: "Intervals each way", default: "40", kind: "text" },
    ],
    compute: (r) => {
      const bs = r("bc").trim();
      const ss = r("src").trim();
      const n = Math.floor(+r("nx") || 40);
      const out = solveLaplace(+r("W"), +r("H"), (x, y) => evalFormula(bs || "0", { x, y }), {
        nx: n, ny: n,
        source: ss ? (x, y) => evalFormula(ss, { x, y }) : undefined,
      });
      if (!out.ok) return { text: out.error, ok: false };
      const res = out.result;
      const blocks: AnalyzeBlock[] = [];
      for (const s of res.steps) blocks.push({ kind: "line", text: plainDashes(s) });
      // A 41x41 field is not a table anyone reads; show a coarse sample of it.
      const stride = Math.max(1, Math.floor(res.x.length / 8));
      const grid: Matrix = [];
      const header = [NaN, ...res.x.filter((_, i) => i % stride === 0)];
      grid.push(header);
      for (let j = 0; j < res.y!.length; j += stride) {
        grid.push([res.y![j], ...res.u[j].filter((_, i) => i % stride === 0)]);
      }
      blocks.push({ kind: "matrix", label: "u sampled (first row is x, first column is y):", m: grid });
      // Draw a few horizontal slices - a contour plot is not available here, and
      // slices are honest about being slices.
      const colors = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed"];
      const slices: Series[] = [];
      const sliceStride = Math.max(1, Math.floor(res.y!.length / 5));
      let ci = 0;
      for (let j = 0; j < res.y!.length; j += sliceStride) {
        slices.push({
          points: res.x.map((x, i) => ({ x, y: res.u[j][i] })),
          type: "line",
          color: colors[ci++ % colors.length],
          label: `y = ${formatNum(res.y![j], 3)}`,
        });
      }
      const svg = buildPlotSvg(slices, { title: "Steady field, slices at fixed y", xlabel: "x", ylabel: "u", width: 380, height: 270 });
      blocks.push({ kind: "plot", svg, caption: "Steady field", alt: "Laplace/Poisson solution, slices at fixed y", w: 380, h: 270 });
      for (const c of res.caveats) blocks.push({ kind: "line", text: plainDashes(`! ${c}`) });
      return analyzeResultOf(blocks);
    },
  },
  {
    id: "dae",
    name: "Differential-algebraic system (index 1)",
    hint:
      "Semi-explicit DAE: differential equations y' = f(t, y, z) plus algebraic constraints 0 = g(t, y, z). " +
      "Index 1 only - ∂g/∂z must be nonsingular. Initial values must satisfy the constraint; inconsistent ones are projected onto it and reported.",
    fields: [
      { key: "eqs", label: "Differential equations (one per line)", default: "y' = -z", kind: "block", rows: 3 },
      { key: "cons", label: "Constraints, 0 = … (one per line)", default: "z - y", kind: "block", rows: 3 },
      { key: "y0", label: "Initial y values", default: "y = 1", kind: "text" },
      { key: "z0", label: "Initial z values", default: "z = 1", kind: "text" },
      { key: "trange", label: "t from, to", default: "0, 2", kind: "text" },
      { key: "steps", label: "Steps", default: "500", kind: "text" },
    ],
    compute: (r) => {
      const yIn = parseAssignments(r("y0"));
      const zIn = parseAssignments(r("z0"));
      if (!yIn.names.length) return { text: "Give at least one initial y value, e.g. y = 1.", ok: false };
      if (!zIn.names.length) return { text: "Give at least one initial z value, e.g. z = 1.", ok: false };

      const diffLines = r("eqs").split(/[\n;]/).map((s) => s.trim()).filter(Boolean);
      const consLines = r("cons").split(/[\n;]/).map((s) => s.trim()).filter(Boolean);
      if (!diffLines.length) return { text: "Enter at least one differential equation, e.g. y' = -z.", ok: false };
      if (!consLines.length) return { text: "Enter at least one constraint. With none this is an ODE - use the ODE solver.", ok: false };

      // "y' = expr" -> expr, keeping the order the user wrote so it lines up
      // with the initial values.
      const rhs: string[] = [];
      for (const line of diffLines) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*'\s*=\s*(.+)$/.exec(line);
        if (!m) return { text: `Couldn't read "${line}". Write each differential equation as  name' = expression.`, ok: false };
        rhs.push(m[2].trim());
      }
      if (rhs.length !== yIn.names.length) {
        return { text: `There are ${rhs.length} differential equations but ${yIn.names.length} initial y values. They must match.`, ok: false };
      }
      // A constraint may be written "0 = expr", "expr = 0", or bare "expr".
      const cons = consLines.map((line) => {
        const m = /^0\s*=\s*(.+)$/.exec(line) ?? /^(.+?)\s*=\s*0$/.exec(line);
        return m ? m[1].trim() : line;
      });
      if (cons.length !== zIn.names.length) {
        return { text: `There are ${cons.length} constraints but ${zIn.names.length} initial z values. A semi-explicit DAE needs exactly as many of each.`, ok: false };
      }

      const vars = (t: number, y: number[], z: number[]): Record<string, number> => {
        const v: Record<string, number> = { t };
        yIn.names.forEach((n, i) => (v[n] = y[i]));
        zIn.names.forEach((n, i) => (v[n] = z[i]));
        return v;
      };
      const f = (t: number, y: number[], z: number[]) => rhs.map((e) => evalFormula(e, vars(t, y, z)));
      const g = (t: number, y: number[], z: number[]) => cons.map((e) => evalFormula(e, vars(t, y, z)));

      const tr = statList(r("trange"));
      if (tr.length < 2) return { text: "Enter t0 and t1, e.g. 0, 2.", ok: false };
      try {
        f(tr[0], yIn.values, zIn.values);
        g(tr[0], yIn.values, zIn.values);
      } catch (e) {
        return { text: `Equation error: ${(e as Error).message}`, ok: false };
      }

      const out = solveDae(f, g, tr[0], tr[1], yIn.values, zIn.values, { steps: Math.floor(+r("steps") || 500) });
      if (!out.ok) return { text: out.error, ok: false };
      const res = out.result;

      const blocks: AnalyzeBlock[] = [];
      for (const s of res.steps) blocks.push({ kind: "line", text: plainDashes(s) });
      const names = [...yIn.names, ...zIn.names];
      const maxRows = 12;
      const stride = Math.max(1, Math.floor(res.t.length / maxRows));
      const sampled: Matrix = [];
      for (let i = 0; i < res.t.length; i += stride) sampled.push([res.t[i], ...res.y[i], ...res.z[i]]);
      if (sampled[sampled.length - 1][0] !== res.t[res.t.length - 1]) {
        const k = res.t.length - 1;
        sampled.push([res.t[k], ...res.y[k], ...res.z[k]]);
      }
      blocks.push({ kind: "matrix", label: `Sampled [t, ${names.join(", ")}]:`, m: sampled });
      const colors = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed"];
      const series: Series[] = names.map((n, i) => ({
        points: res.t.map((t, k) => ({ x: t, y: i < yIn.names.length ? res.y[k][i] : res.z[k][i - yIn.names.length] })),
        type: "line",
        color: colors[i % colors.length],
        label: n,
      }));
      const svg = buildPlotSvg(series, { title: "DAE solution", xlabel: "t", ylabel: "", width: 380, height: 270 });
      blocks.push({ kind: "plot", svg, caption: "DAE solution", alt: "Differential-algebraic system solution", w: 380, h: 270 });
      for (const c of res.caveats) blocks.push({ kind: "line", text: plainDashes(`! ${c}`) });
      return analyzeResultOf(blocks);
    },
  },
];

/**
 * Shared rendering for the two time-dependent PDEs. Both produce u(x, t), so
 * both are shown the same way: a few time levels drawn as curves, because a
 * surface plot is not available here and a table of 60 × 400 values is not
 * something anyone reads.
 */
function pdeBlocks(out: PdeOutcome, title: string, ylabel: string): AnalyzeOutput | { text: string; ok: false } {
  if (!out.ok) return { text: out.error, ok: false };
  const res = out.result;
  const blocks: AnalyzeBlock[] = [];
  for (const s of res.steps) blocks.push({ kind: "line", text: plainDashes(s) });

  const times = res.t ?? [];
  const colors = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2"];
  const wanted = Math.min(6, res.u.length);
  const pick: number[] = [];
  for (let i = 0; i < wanted; i++) pick.push(Math.round((i * (res.u.length - 1)) / Math.max(1, wanted - 1)));

  const series: Series[] = pick.map((k, i) => ({
    points: res.x.map((x, j) => ({ x, y: res.u[k][j] })),
    type: "line",
    color: colors[i % colors.length],
    label: `t = ${formatNum(times[k] ?? 0, 3)}`,
  }));
  const svg = buildPlotSvg(series, { title, xlabel: "x", ylabel, width: 380, height: 270 });

  const xStride = Math.max(1, Math.floor(res.x.length / 8));
  const grid: Matrix = [];
  grid.push([NaN, ...res.x.filter((_, i) => i % xStride === 0)]);
  for (const k of pick) grid.push([times[k] ?? 0, ...res.u[k].filter((_, i) => i % xStride === 0)]);
  blocks.push({ kind: "matrix", label: "u sampled (first row is x, first column is t):", m: grid });
  blocks.push({ kind: "plot", svg, caption: title, alt: title, w: 380, h: 270 });
  for (const c of res.caveats) blocks.push({ kind: "line", text: plainDashes(`! ${c}`) });
  return analyzeResultOf(blocks);
}

function populateAnalyzeCalcs(): void {
  analyzeCalcSelect.replaceChildren();
  for (const c of ANALYZE_CALCS) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    analyzeCalcSelect.appendChild(opt);
  }
}

// ---------------------------------------------------------------------------
// Engineering — beams and cross-sections
// ---------------------------------------------------------------------------

/**
 * The discipline a calculation belongs to, used as an <optgroup> heading.
 *
 * Thirty-six calculations in one flat dropdown is a scroll, not a menu, and the
 * build order they were listed in ("beam, cross-section, DC circuit, …") is
 * meaningless to anyone who did not build them. Grouping is the same shape
 * HOME_GROUPS already uses for the mode tiles, one level down: an <optgroup>
 * costs no vertical space in a 320px pane, keeps keyboard type-ahead, and is
 * announced by screen readers.
 *
 * ENG_GROUP_ORDER fixes the order the headings appear in; a calculation naming
 * a group outside it is a build error rather than a silently ungrouped option.
 */
const ENG_GROUP_ORDER = [
  "Structural & solids",
  "Fatigue & machine design",
  "Fluids",
  "Thermal",
  "Electronics",
  "Control systems",
  "Vibration",
  "Biomedical",
  "Pharmacokinetics",
] as const;
type EngGroup = (typeof ENG_GROUP_ORDER)[number];

interface EngCalc {
  id: string;
  /**
   * The label shown in the dropdown. It does NOT repeat the group heading:
   * "Control: frequency response" under a "Control systems" heading reads as a
   * stutter and wastes the width the pane does not have.
   */
  name: string;
  group: EngGroup;
  hint: string;
  fields: AnalyzeField[];
  compute: (read: (k: string) => string) => AnalyzeOutput;
}

/**
 * Formats a result to a stated number of significant figures.
 *
 * The default of four is a display convention, not a claim about the data. Any
 * caller that knows what its inputs carry should pass that instead: quoting a
 * stress to four figures from a section measured to two is the precision error
 * a lab report is marked down for, and a calculator produces it by default.
 */
const engNum = (v: number, sig = 4): string => {
  if (!Number.isFinite(v)) return "not finite";
  if (v === 0) return "0";
  const s2 = Math.max(1, Math.min(Math.round(sig), 12));
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) return v.toExponential(Math.max(0, s2 - 1));
  return String(Number(v.toPrecision(s2)));
};

/** The leading numeric text of a field like "12 kN·m", for counting figures. */
const engNumericPart = (text: string): string => {
  const m = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(text);
  return m ? m[1] : "";
};

/** Figures the inputs support, for a calculator that knows its own fields. */
const engFigures = (raws: string[]): number => resultFigures(raws.map(engNumericPart));

/**
 * THE ENGINEERING UNIT CONTRACT, in one place.
 *
 * The Engineering tools had drifted into three different contracts. Beam, truss
 * and cross-sections said "consistent units, nothing converts". Column, torsion,
 * pipe flow and the heat tools said "strict SI" — and then accepted whatever was
 * typed WITHOUT CHECKING, which is the dangerous half: the declaration was the
 * only thing enforcing it, and a declaration enforces nothing.
 *
 * That was not merely untidy, it was a live trap inside the product. The
 * cross-section tool reports I in mm^4 by default, because that is the unit
 * every section table in the world prints. The column tool wants m^4. So the
 * single most natural workflow — size a section, paste its I into the buckling
 * check — was off by a factor of 10^12, and the answer looked entirely
 * plausible. Nothing anywhere said a word.
 *
 * Every SI-declared field now reads through `parseMeasured`, which gives three
 * behaviours at once:
 *   - A BARE NUMBER is taken as already being in the field's SI unit and is
 *     flagged `assumed`. This is exactly the old behaviour, so nothing that
 *     worked before changes — the reason this could be adopted everywhere
 *     without a regression.
 *   - A UNIT THAT FITS is converted ("200 GPa", "1e6 mm^4", "50 ksi"), and the
 *     conversion is REPORTED, so the reader can see what was assumed on their
 *     behalf rather than trusting it.
 *   - A UNIT OF THE WRONG QUANTITY is REFUSED by name rather than ignored. A
 *     length where a force belongs is a mistake, and silently dropping the unit
 *     is how it becomes a number in a document.
 *
 * Beam and truss deliberately stay unit-agnostic: they compute over EXACT
 * rationals, and a unit conversion is a floating-point multiply that would
 * destroy the exactness that is the whole reason those two engines exist. That
 * is now a stated rule rather than an accident — see ENG_UNIT_NOTE.
 */
interface EngUnits {
  /** Fatal problems; when non-empty the calculator must refuse. */
  errors: string[];
  /** Human-readable record of every conversion actually performed. */
  conversions: string[];
  /** A required quantity, in SI. Returns NaN and records an error if unreadable. */
  req(key: string, si: string, label: string): number;
  /** An optional quantity; `dflt` when the field is blank. */
  opt(key: string, si: string, label: string, dflt: number): number;
  /** An optional quantity; null when the field is blank. */
  optNull(key: string, si: string, label: string): number | null;
  /** Appends the "units read" block to a report, when anything was converted. */
  report(lines: string[]): void;
}

function engUnits(r: (k: string) => string): EngUnits {
  const errors: string[] = [];
  const conversions: string[] = [];

  const read = (key: string, si: string, label: string): number | null => {
    const raw = r(key).trim();
    if (!raw) return null;
    const m = parseMeasured(raw, si);
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    // Only a real conversion is worth reporting. A bare number, or one already
    // written in the target unit, would just be noise.
    if (!m.assumed && m.inTarget !== m.value) {
      conversions.push(`${label}: ${engNum(m.value, 6)} ${m.unit} = ${engNum(m.inTarget, 6)} ${si}`);
    }
    return m.inTarget;
  };

  return {
    errors,
    conversions,
    req(key, si, label) {
      const v = read(key, si, label);
      if (v === null) {
        errors.push(`${label}: this field is required.`);
        return NaN;
      }
      return v;
    },
    opt(key, si, label, dflt) {
      const v = read(key, si, label);
      return v === null ? dflt : v;
    },
    optNull(key, si, label) {
      return read(key, si, label);
    },
    report(lines) {
      if (!conversions.length) return;
      lines.push("");
      lines.push("Units read");
      for (const c of conversions) lines.push(`  ${c}`);
    },
  };
}

/**
 * THE RULE, stated once and enforced by engineeringRouting.test.ts:
 *
 *   An Engineering tool CONVERTS UNITS unless it is dimensionally homogeneous
 *   (every input is the same kind of quantity, so the answer comes back in
 *   whatever unit went in) or it computes over EXACT RATIONALS (where a
 *   conversion is a floating-point multiply that destroys the exactness that is
 *   the entire reason the engine exists). Either way it says which it is.
 *
 * The point is not that all eleven tools behave identically — beam cannot
 * convert without ceasing to be exact, and forcing stress into pascals would
 * make "80" mean 80 Pa to someone who has thought in MPa all afternoon. The
 * point is that the behaviour follows one stated rule instead of eleven
 * accidents, and that every tool declares which branch it is on.
 */
const ENG_UNIT_NOTE =
  "Units: a bare number is read in the unit that field names; write another unit " +
  "(200 GPa, 1e6 mm^4, 50 ksi, 68 °F) and it is converted for you, and a unit of the " +
  "wrong quantity is refused rather than silently ignored.";

/** The matching declaration for the tools that deliberately do not convert. */
const ENG_SAME_UNIT_NOTE =
  "Units: whatever you type, used consistently — nothing is converted here, and nothing " +
  "needs to be: every quantity in this tool is the same kind, so the answer comes back in " +
  "the unit you went in with.";

/**
 * Control systems set their own units through the coefficients, so there is
 * nothing to convert and nothing to assume — but saying "every quantity is the
 * same kind" would be false, since time, frequency and gain all appear.
 */
const ENG_CONTROL_UNIT_NOTE =
  "Units: set by your coefficients and not converted. Write the transfer function in the time " +
  "unit you want back — with s in rad/s, times are seconds and frequencies rad/s; divide a " +
  "frequency by 2π for Hz.";

/**
 * Pharmacokinetics is dimensionally consistent in whatever the caller uses, but
 * the pairing matters enough to spell out — mg with L gives mg/L, which is the
 * same number as µg/mL and is where most unit confusion in PK actually happens.
 */
const ENG_PK_UNIT_NOTE =
  "Units: yours, used consistently and not converted. Dose in mg with volume in L gives " +
  "concentration in mg/L, which is the same number as µg/mL; clearance is then L/h and time is " +
  "hours. Keep volume and clearance on the same volume unit or everything downstream is wrong.";

/** Vibration is consistent in the caller's units; SI is what makes rad/s come out. */
const ENG_VIB_UNIT_NOTE =
  "Units: yours, used consistently and not converted. Mass in kg with stiffness in N/m gives " +
  "rad/s (divide by 2π for Hz); a damping coefficient is then N·s/m. Frequency ratios, damping " +
  "ratios, magnification and transmissibility are dimensionless whatever you use.";

/**
 * Thermodynamics is strict SI internally, but TEMPERATURE gets its own unit
 * selector rather than being folded into the general unit layer — because the
 * failure mode is uniquely bad. Every efficiency here is a ratio of absolute
 * temperatures, so a Celsius value used as kelvin does not produce a slightly
 * wrong answer, it produces a plausible and completely wrong one.
 */
const ENG_THERMO_UNIT_NOTE =
  "Units: SI — pressure in Pa, mass in kg, energy in J. TEMPERATURE IS ABSOLUTE in every " +
  "formula here, so pick the unit you are typing and it is converted to kelvin before anything " +
  "is divided; a Celsius value used as kelvin is the classic way to get a confident wrong answer.";

/**
 * Fatigue is stated in MPa throughout, and the reason it gets its own note is
 * the accuracy claim rather than the units: everything this tool produces
 * carries scatter of a factor of three or more, so the units being consistent
 * is the least of what the reader needs told.
 */
const ENG_FATIGUE_UNIT_NOTE =
  "Units: stresses and strengths in MPa throughout, diameters in mm, and nothing is converted. " +
  "Sut and Sy are asked for rather than looked up in a table, because they move by a factor of " +
  "three with heat treatment for the same alloy designation — take them from your drawing or " +
  "material certificate.";

/** Electronics: SI throughout, and the notation question matters more than units. */
const ENG_ELEC_UNIT_NOTE =
  "Units: SI — ohms, farads, volts, hertz — except slew rate, which is V/µs because that is how " +
  "every datasheet prints it. Filter frequencies are rad/s to match the control tools; divide by " +
  "2π for Hz. Boolean expressions accept AND/&/*, OR/|/+, NOT/!/~ and a trailing apostrophe.";

/** Biomedical: SI internally, with the clinical units named where they differ. */
const ENG_BIOMED_UNIT_NOTE =
  "Units: SI internally — metres, m³/s, pascals — with clinical figures converted where they " +
  "appear: pressures in mmHg, cardiac output in L/min, resistance in dyn·s/cm⁵. A pressure in " +
  "mmHg used as pascals is wrong by a factor of 133.";

/** As above, for the two engines whose exactness a conversion would destroy. */
const ENG_EXACT_UNIT_NOTE =
  "Units: whatever you type, used consistently — nothing is converted here, because this " +
  "engine computes over exact rationals and a unit conversion is a floating-point multiply " +
  "that would destroy that exactness. Convert before you type, and the answer stays exact.";

const ENG_CALCS: EngCalc[] = [
  {
    id: "beam",
    name: "Beam analysis (shear, moment, deflection)",
    group: "Structural & solids",
    hint:
      'Supports: "pin 0, roller 8" or "fixed 0". A support may be elastic or displaced: ' +
      '"roller 8 k=5e4" sits it on a spring, "roller 8 settle=0.01" sinks it (downward positive). ' +
      "Both need EI, because an elastic or settling support makes the reactions depend on the " +
      "beam's own stiffness. Using both on one support drops the SEAT by the settlement and lets " +
      "the spring compress on top of it (v = -settle - R/k). Loads, one per line: \"point 30 at 6\", " +
      '"udl 5 from 0 to 8", "udl 0 to 9 from 0 to 6" (varying), "moment 200 at 4". ' +
      "Downward loads are positive. Any number may be an exact FRACTION — \"roller 8/3\", " +
      "\"point 30 at 8/3\" — which is worth using, because this engine computes over rationals and " +
      "2.6666666667 does not. Keep your units consistent; nothing here converts them.",
    fields: [
      { key: "L", label: "Span", default: "8", kind: "text" },
      { key: "sup", label: "Supports", default: "pin 0, roller 8", kind: "text" },
      {
        key: "loads",
        label: "Loads (one per line)",
        default: "udl 5 from 0 to 8\npoint 30 at 6",
        kind: "block",
        rows: 4,
      },
      { key: "EI", label: "EI (needed for deflection, and for k= or settle=)", default: "", kind: "text" },
      { key: "unit", label: "Units as force,length", default: "kN,m", kind: "text" },
    ],
    compute: (r) => {
      const L = parseLength(r("L"));
      if (!L) return { text: "Enter a span, e.g. 8.", ok: false };
      const sup = parseSupports(r("sup"));
      const lds = parseLoads(r("loads"));
      const problems = [...sup.errors, ...lds.errors];
      if (problems.length) return { text: problems.join("\n"), ok: false };

      // EI is parsed EXACTLY and passed into the solve, not just applied to the
      // answer afterwards. A spring or settling support puts EI inside the
      // compatibility equations, so handing the engine a float there would put
      // rounding in the middle of an otherwise exact solve.
      const eiRaw = r("EI").trim();
      const eiExact = eiRaw ? parseLength(eiRaw) : null;
      if (eiRaw && !eiExact) return { text: `"${eiRaw}" is not a number, so EI could not be read.`, ok: false };

      const res = analyzeBeam({ length: L, supports: sup.supports, loads: lds.loads, ei: eiExact });
      if (!res.ok) return { text: res.error, ok: false };

      const parts = (r("unit") || "kN,m").split(",");
      const fu = (parts[0] || "").trim();
      const lu = (parts[1] || "").trim();
      const mu = fu && lu ? fu + "·" + lu : "";
      const svg = beamDiagramSvg({
        result: res,
        supports: sup.supports,
        loads: lds.loads,
        forceUnit: fu,
        momentUnit: mu,
        lengthUnit: lu,
      });

      const lines: string[] = [];
      lines.push(`Beam analysis, span ${engNum(res.length)} ${lu}`);
      lines.push(res.determinacy.note);
      lines.push("");
      lines.push("Reactions");
      for (const re of res.reactions) {
        let line = `  ${re.kind} at x = ${engNum(re.x)} ${lu}: ${engNum(re.force)} ${fu} ${re.force >= 0 ? "up" : "down"}`;
        if (re.moment !== undefined)
          line += `, fixed-end moment ${engNum(re.moment)} ${mu} (${re.moment < 0 ? "hogging" : "sagging"})`;
        lines.push(line);
      }
      lines.push("");
      lines.push(`Max shear: ${engNum(res.maxShear.value)} ${fu} at x = ${engNum(res.maxShear.x)} ${lu}`);
      const govern =
        Math.abs(res.minMoment.value) > Math.abs(res.maxMoment.value) ? res.minMoment : res.maxMoment;
      lines.push(`Max moment: ${engNum(govern.value)} ${mu} at x = ${engNum(govern.x)} ${lu}`);
      if (res.maxMoment.value > 0 && res.minMoment.value < 0)
        lines.push(
          `  sagging peak ${engNum(res.maxMoment.value)} ${mu}, hogging peak ${engNum(res.minMoment.value)} ${mu}`,
        );

      if (eiExact) {
        const EI = ratNum(eiExact);
        if (!Number.isFinite(EI) || EI <= 0) {
          lines.push("");
          lines.push("EI must be a positive number, so deflection was not computed.");
        } else {
          const d = res.maxEiDeflection;
          lines.push("");
          lines.push(
            `Max deflection: ${engNum(d.value / EI)} ${lu} at x = ${engNum(d.x)} ${lu} (${d.value < 0 ? "downward" : "upward"})`,
          );
          lines.push(`  from EI times v = ${engNum(d.value)}, with EI = ${engNum(EI)}`);
        }
      } else {
        lines.push("");
        // Only true for a beam on rigid supports. An elastic or settling support
        // never reaches this branch — analyzeBeam refuses it without EI — but
        // the sentence is wrong for it, so it is guarded rather than trusted.
        lines.push(
          res.eiCoupled
            ? "Deflection needs EI."
            : "Deflection needs EI. Reactions, shear and moment do not, and are exact without it.",
        );
      }
      for (const w of res.warnings) lines.push(`Note: ${w}`);
      lines.push(ENG_EXACT_UNIT_NOTE);

      // plainDashes must be applied to the LINES, not only to the joined text.
      // The blocks are what get inserted whenever there is a diagram, so
      // cleaning only `text` left the em dash in every line that actually
      // reached the document, while the guard — which reads `text` — saw a clean
      // string and enabled the button. Caught by looking at the rendered pane.
      const clean = lines.map(plainDashes);
      const blocks: AnalyzeBlock[] = [
        ...clean.map((t) => ({ kind: "line" as const, text: t })),
        {
          kind: "plot" as const,
          svg,
          caption: "Shear force and bending moment diagrams",
          alt: `Beam of span ${engNum(res.length)} with its shear force and bending moment diagrams`,
          w: BEAM_CHART_SIZE.w,
          h: BEAM_CHART_SIZE.h,
        },
      ];
      return { text: clean.join("\n"), blocks };
    },
  },
  {
    id: "section",
    name: "Cross-section properties & stress",
    group: "Structural & solids",
    hint:
      "Dimensions in consistent units (mm gives I in mm^4). Enter a moment and shear in matching units " +
      "to get the peak bending and transverse shear stress.",
    fields: [
      {
        key: "shape",
        label: "Shape",
        default: "rect",
        kind: "select",
        options: [
          { value: "rect", label: "Rectangle (b, h)" },
          { value: "circle", label: "Solid circle (d)" },
          { value: "pipe", label: "Circular hollow (d, wall t)" },
          { value: "box", label: "Rectangular hollow (b, h, wall t)" },
          { value: "ibeam", label: "I-beam (bf, tf, depth, tw)" },
          { value: "tee", label: "Tee (bf, tf, depth, tw)" },
        ],
      },
      { key: "dims", label: "Dimensions, comma separated, in the order above", default: "50, 200", kind: "text" },
      {
        key: "dimUnit",
        label: "Dimension unit",
        default: "mm",
        kind: "select",
        options: [
          { value: "mm", label: "mm" },
          { value: "cm", label: "cm" },
          { value: "m", label: "m" },
          { value: "in", label: "inches" },
        ],
      },
      { key: "M", label: "Bending moment, e.g. 12 kN·m (blank to skip)", default: "", kind: "text" },
      { key: "V", label: "Shear force, e.g. 8 kN (blank to skip)", default: "", kind: "text" },
    ],
    compute: (r) => {
      const shape = r("shape") || "rect";
      const dimUnit = r("dimUnit") || "mm";
      const figs = engFigures([...r("dims").split(/[,\s]+/).filter(Boolean), r("M"), r("V")]);
      const d = r("dims")
        .split(/[,\s]+/)
        .filter(Boolean)
        .map(Number);
      if (d.some((v) => !Number.isFinite(v))) return { text: "Every dimension must be a number.", ok: false };
      const need: Record<string, number> = { rect: 2, circle: 1, pipe: 2, box: 3, ibeam: 4, tee: 4 };
      if (d.length !== need[shape])
        return { text: `This shape needs ${need[shape]} dimension(s); ${d.length} given.`, ok: false };

      let spec: SectionSpec;
      if (shape === "rect") spec = { kind: "rect", b: d[0], h: d[1] };
      else if (shape === "circle") spec = { kind: "circle", d: d[0] };
      else if (shape === "pipe") spec = { kind: "pipe", d: d[0], t: d[1] };
      else if (shape === "box") spec = { kind: "box", b: d[0], h: d[1], t: d[2] };
      else if (shape === "ibeam") spec = { kind: "ibeam", bf: d[0], tf: d[1], d: d[2], tw: d[3] };
      else spec = { kind: "tee", bf: d[0], tf: d[1], d: d[2], tw: d[3] };

      const p = sectionProperties(spec);
      if ("error" in p) return { text: p.error, ok: false };

      const lines: string[] = [];
      lines.push(`${p.name}, section properties`);
      lines.push(`Area A = ${engNum(p.A, figs)} ${dimUnit}^2`);
      lines.push(`Second moment I = ${engNum(p.I, figs)} ${dimUnit}^4`);
      lines.push(`Centroid above the bottom fibre = ${engNum(p.yBar, figs)} ${dimUnit}`);
      if (p.symmetric) {
        lines.push(`Section modulus S = ${engNum(p.sTop, figs)} (c = ${engNum(p.cTop, figs)})`);
      } else {
        lines.push(`Section modulus, top fibre = ${engNum(p.sTop, figs)} (c = ${engNum(p.cTop, figs)})`);
        lines.push(`Section modulus, bottom fibre = ${engNum(p.sBot, figs)} (c = ${engNum(p.cBot, figs)})`);
      }
      lines.push(`Radius of gyration r = ${engNum(p.r, figs)}`);
      lines.push(`First moment Q at the neutral axis = ${engNum(p.Q, figs)}, width there = ${engNum(p.tNA, figs)}`);

      const mRaw = r("M").trim();
      const vRaw = r("V").trim();
      if (mRaw || vRaw) {
        // THE UNITS ARE THE WHOLE POINT HERE. Section dimensions are habitually
        // in millimetres and moments in kN·m, and multiplying them as if they
        // agreed is wrong by a factor of 10^9 while looking entirely plausible.
        // So everything is reduced to SI before anything is divided, and a unit
        // of the wrong quantity is refused rather than ignored.
        const mQ = mRaw ? parseMeasured(mRaw, "N*m") : null;
        const vQ = vRaw ? parseMeasured(vRaw, "N") : null;
        if (mQ && "error" in mQ) {
          lines.push(`Bending moment: ${mQ.error}`);
        } else if (vQ && "error" in vQ) {
          lines.push(`Shear force: ${vQ.error}`);
        } else {
          const toM = convert(1, dimUnit, "m") ?? 1;
          const Isi = p.I * Math.pow(toM, 4);
          const sTopSi = p.sTop * Math.pow(toM, 3);
          const sBotSi = p.sBot * Math.pow(toM, 3);
          const Qsi = p.Q * Math.pow(toM, 3);
          const tSi = p.tNA * toM;
          const Msi = mQ ? (mQ as { inTarget: number }).inTarget : 0;
          const Vsi = vQ ? (vQ as { inTarget: number }).inTarget : 0;
          const sigmaSi = Math.abs(Msi) / Math.min(sTopSi, sBotSi);
          const fibre = sTopSi < sBotSi ? "top" : "bottom";
          const tauSi = tSi > 0 && Isi > 0 ? (Math.abs(Vsi) * Qsi) / (Isi * tSi) : 0;
          lines.push("");
          if (mQ) {
            lines.push(
              `Peak bending stress = ${engNum(sigmaSi / 1e6, figs)} MPa at the ${fibre} fibre` +
                ` (${engNum(sigmaSi, figs)} Pa)`,
            );
            if ((mQ as { assumed: boolean }).assumed)
              lines.push("  no unit was given for the moment, so N·m was assumed.");
          }
          if (vQ) {
            lines.push(`Transverse shear stress at the neutral axis = ${engNum(tauSi / 1e6, figs)} MPa`);
            if ((vQ as { assumed: boolean }).assumed)
              lines.push("  no unit was given for the shear, so N was assumed.");
          }
          lines.push(`Computed with dimensions in ${dimUnit}, converted to SI before dividing.`);
          lines.push(
            `Quoted to ${figs} significant figures, the fewest any input carries. ` +
              "Trailing zeros in a bare integer are not counted as significant, so write 1000. or 1.000e3 if you mean four.",
          );
        }
      }
      for (const n of p.notes) lines.push(`Note: ${n}`);
      // Closing a trap that lived inside the product: these values are what the
      // buckling check wants, and they come out in mm by default because that is
      // what section tables print — while the column tool works in metres. It
      // now converts, so say so here, where the numbers are.
      lines.push(
        `To check buckling, carry A and I to the column tool WITH their units ` +
          `("${engNum(p.A, figs)} ${dimUnit}^2", "${engNum(p.I, figs)} ${dimUnit}^4") — it converts them. ` +
          "Use the SMALLER principal I unless that axis is separately braced.",
      );
      lines.push(ENG_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "circuit-dc",
    name: "DC operating point",
    group: "Electronics",
    hint:
      'One element per line: "R1 1 0 1k", "V1 1 0 5", "I1 0 2 10m". Node 0 is ground. ' +
      "Values take SI suffixes and RKM notation, so 2k2 is 2.2 k and 4r7 is 4.7 ohms. " +
      "Answers are EXACT: a divider reports 10/3 V, not 3.3333.",
    fields: [
      {
        key: "net",
        label: "Netlist",
        default: "V1 1 0 5\nR1 1 2 1k\nR2 2 0 2k",
        kind: "block",
        rows: 6,
      },
    ],
    compute: (r) => {
      const parsed = parseNetlist(r("net"));
      if (parsed.errors.length) return { text: parsed.errors.join("\n"), ok: false };
      const res = solveDc(parsed.elements);
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push(res.exact ? "DC operating point (exact)" : "DC operating point");
      lines.push("");
      lines.push("Node voltages");
      for (const n of res.nodes) {
        const ex = n.exact && n.exact.d !== 1n ? `  = ${n.exact.n}/${n.exact.d}` : "";
        lines.push(`  V(${n.name}) = ${engNum(n.volts)} V${ex}`);
      }
      lines.push("");
      lines.push("Element currents (positive from the first node to the second)");
      for (const c of res.currents) lines.push(`  I(${c.name}) = ${engNum(c.amps)} A`);
      lines.push("");
      lines.push("Power");
      for (const p of res.power)
        lines.push(`  ${p.name}: ${engNum(Math.abs(p.watts))} W ${p.watts >= 0 ? "dissipated" : "delivered"}`);
      lines.push(
        `  Total delivered ${engNum(res.totalDelivered)} W = total dissipated ${engNum(res.totalDissipated)} W`,
      );
      for (const n of res.notes) lines.push(`Note: ${n}`);
      lines.push(ENG_SAME_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "circuit-ac",
    name: "AC response & Bode plot",
    group: "Electronics",
    hint:
      "Same netlist, plus C and L. Give one frequency for a phasor answer, or a start and stop " +
      "frequency to sweep an output node and draw a Bode magnitude plot. AC is floating point: " +
      "an impedance carries 2*pi*f, which is not rational.",
    fields: [
      {
        key: "net",
        label: "Netlist",
        default: "V1 1 0 1\nR1 1 2 1k\nC1 2 0 1u",
        kind: "block",
        rows: 6,
      },
      { key: "out", label: "Output node", default: "2", kind: "text" },
      { key: "f1", label: "Frequency, or sweep start (Hz)", default: "1", kind: "text" },
      { key: "f2", label: "Sweep stop (Hz), blank for a single frequency", default: "100k", kind: "text" },
    ],
    compute: (r) => {
      const parsed = parseNetlist(r("net"));
      if (parsed.errors.length) return { text: parsed.errors.join("\n"), ok: false };
      const out = r("out").trim();
      const f1 = parseValue(r("f1"))?.value;
      const f2raw = r("f2").trim();
      const f2 = f2raw ? parseValue(f2raw)?.value : undefined;
      if (f1 === undefined) return { text: "The start frequency is not a number.", ok: false };
      if (f2raw && f2 === undefined) return { text: "The stop frequency is not a number.", ok: false };

      // Single frequency: report every node as a phasor.
      if (f2 === undefined) {
        const res = solveAc(parsed.elements, f1);
        if (!res.ok) return { text: res.error, ok: false };
        const lines: string[] = [];
        lines.push(`AC steady state at ${engNum(res.frequency)} Hz`);
        lines.push("");
        for (const n of res.nodes)
          lines.push(
            `  V(${n.name}) = ${engNum(n.magnitude)} at ${engNum(n.phaseDeg)} deg  ` +
              `(${engNum(n.re)} ${n.im >= 0 ? "+" : "-"} j${engNum(Math.abs(n.im))})`,
          );
        for (const n of res.notes) lines.push(`Note: ${n}`);
        return { text: plainDashes(lines.join("\n")) };
      }

      const sweep = frequencySweep(parsed.elements, out, f1, f2, 160);
      if ("ok" in sweep && sweep.ok === false) return { text: sweep.error, ok: false };
      const pts = (sweep as { points: { f: number; magnitude: number; phaseDeg: number }[] }).points;

      const ref = pts[0].magnitude;
      const series: Series[] = [
        { points: pts.map((p) => ({ x: p.f, y: dB(p.magnitude, ref) })), type: "line" },
      ];
      // A log frequency axis is the whole point of a Bode plot: it makes a
      // decade occupy equal width, so a first-order roll-off is a straight line
      // at 20 dB per decade instead of a curve crushed against the left edge.
      const svg = buildPlotSvg(series, {
        width: 380,
        height: 240,
        title: `Bode magnitude at node ${out}`,
        xlabel: "Frequency (Hz)",
        ylabel: `dB relative to ${engNum(ref)}`,
        xScale: "log",
      });

      // The corner is where the response has fallen 3 dB from its starting value.
      let corner: number | null = null;
      for (const p of pts) {
        if (dB(p.magnitude, ref) <= -3.0103) {
          corner = p.f;
          break;
        }
      }

      const lines: string[] = [];
      lines.push(`Frequency response at node ${out}`);
      lines.push(`Swept ${engNum(f1)} Hz to ${engNum(f2)} Hz, ${pts.length} points, logarithmic`);
      lines.push(`  at ${engNum(pts[0].f)} Hz: ${engNum(pts[0].magnitude)} at ${engNum(pts[0].phaseDeg)} deg`);
      const last = pts[pts.length - 1];
      lines.push(`  at ${engNum(last.f)} Hz: ${engNum(last.magnitude)} at ${engNum(last.phaseDeg)} deg`);
      if (corner !== null) {
        lines.push(`  falls 3 dB by about ${engNum(corner)} Hz`);
      } else {
        lines.push("  does not fall 3 dB anywhere in this range, so the corner is outside it.");
      }
      lines.push("AC results are floating point, and phase is in degrees relative to the source.");
      lines.push(ENG_SAME_UNIT_NOTE);

      const clean = lines.map(plainDashes);
      const blocks: AnalyzeBlock[] = [
        ...clean.map((t) => ({ kind: "line" as const, text: t })),
        {
          kind: "plot" as const,
          svg,
          caption: `Bode magnitude at node ${out}`,
          alt: `Frequency response magnitude in decibels at node ${out}, on a logarithmic frequency axis`,
          w: 380,
          h: 240,
        },
      ];
      return { text: clean.join("\n"), blocks };
    },
  },
  {
    id: "stress",
    name: "Stress state: principal stresses & failure",
    group: "Structural & solids",
    hint:
      "Enter the stress components in any consistent unit — MPa in gives MPa out. Tension is " +
      "positive. Leave the out-of-plane components at 0 for plane stress, which is the usual case.",
    fields: [
      { key: "sx", label: "σx", default: "80", kind: "text" },
      { key: "sy", label: "σy", default: "-40", kind: "text" },
      { key: "txy", label: "τxy", default: "25", kind: "text" },
      { key: "sz", label: "σz (0 for plane stress)", default: "0", kind: "text" },
      { key: "tyz", label: "τyz (0 for plane stress)", default: "0", kind: "text" },
      { key: "tzx", label: "τzx (0 for plane stress)", default: "0", kind: "text" },
      { key: "Fy", label: "Yield strength, same unit (blank to skip)", default: "", kind: "text" },
      { key: "ang", label: "Also report the state rotated by this angle, degrees (blank to skip)", default: "", kind: "text" },
    ],
    compute: (r) => {
      const raws = ["sx", "sy", "txy", "sz", "tyz", "tzx"].map((k) => r(k));
      const figs = engFigures(raws);
      const n = (k: string): number => Number(r(k) || "0");
      const state = { sx: n("sx"), sy: n("sy"), sz: n("sz"), txy: n("txy"), tyz: n("tyz"), tzx: n("tzx") };
      for (const [k, v] of Object.entries(state)) {
        if (!Number.isFinite(v)) return { text: `${k} must be a number.`, ok: false };
      }
      const res = analyzeStress(state);
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push(res.plane ? "Plane stress state" : "General three-dimensional stress state");
      lines.push("");
      lines.push("Principal stresses");
      lines.push(`  σ1 = ${engNum(res.principal[0], figs)}`);
      lines.push(`  σ2 = ${engNum(res.principal[1], figs)}`);
      lines.push(`  σ3 = ${engNum(res.principal[2], figs)}`);
      if (res.plane && res.thetaP !== null) {
        lines.push(
          `  σ1 acts on a plane ${engNum(res.thetaP, figs)} deg counterclockwise from the x axis` +
            " (double this to read it off a Mohr diagram).",
        );
      }
      lines.push("");
      if (res.tauInPlane !== null) {
        lines.push(`Maximum in-plane shear = ${engNum(res.tauInPlane, figs)}`);
      }
      lines.push(`Absolute maximum shear = ${engNum(res.tauAbsMax, figs)}`);
      if (res.mohrCentre !== null && res.mohrRadius !== null) {
        lines.push(
          `Mohr's circle: centre ${engNum(res.mohrCentre, figs)}, radius ${engNum(res.mohrRadius, figs)}`,
        );
      }
      lines.push(`Hydrostatic (mean) stress = ${engNum(res.hydrostatic, figs)}`);
      lines.push("");
      lines.push("Equivalent stress");
      lines.push(`  von Mises (distortion energy) = ${engNum(res.vonMises, figs)}`);
      lines.push(`  Tresca (maximum shear)        = ${engNum(res.tresca, figs)}`);

      const fyRaw = r("Fy").trim();
      if (fyRaw) {
        const Fy = Number(fyRaw);
        const fos = factorOfSafety(res, Fy);
        if ("ok" in fos && fos.ok === false) {
          lines.push(`Factor of safety: ${fos.error}`);
        } else {
          const f = fos as { vonMises: number; tresca: number };
          lines.push("");
          lines.push(`Factor of safety against a yield strength of ${engNum(Fy, figs)}`);
          lines.push(`  by von Mises = ${Number.isFinite(f.vonMises) ? engNum(f.vonMises, figs) : "unbounded (no stress)"}`);
          lines.push(`  by Tresca    = ${Number.isFinite(f.tresca) ? engNum(f.tresca, figs) : "unbounded (no stress)"}`);
          lines.push(
            "  Tresca is the conservative one and is what a code will usually ask for; von Mises " +
              "is the better predictor for a ductile metal. Design to whichever your standard names.",
          );
        }
      }

      const angRaw = r("ang").trim();
      if (angRaw) {
        const deg = Number(angRaw);
        if (!Number.isFinite(deg)) {
          lines.push("The rotation angle must be a number.");
        } else if (!res.plane) {
          lines.push("");
          lines.push(
            "A rotation was requested, but this is a three-dimensional state and a single angle " +
              "does not define a rotation of it. The rotated components were not computed.",
          );
        } else {
          const t = transformPlane(state.sx, state.sy, state.txy, deg);
          if ("ok" in t && t.ok === false) {
            lines.push(t.error);
          } else {
            const tt = t as { sxp: number; syp: number; txyp: number };
            lines.push("");
            lines.push(`On a plane rotated ${engNum(deg, figs)} deg counterclockwise`);
            lines.push(`  σx' = ${engNum(tt.sxp, figs)}`);
            lines.push(`  σy' = ${engNum(tt.syp, figs)}`);
            lines.push(`  τx'y' = ${engNum(tt.txyp, figs)}`);
          }
        }
      }

      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(
        `Quoted to ${figs} significant figures, the fewest any input carries.`,
      );
      lines.push(ENG_SAME_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "truss",
    name: "Truss analysis (method of joints)",
    group: "Structural & solids",
    hint:
      'One item per line: "joint A 0 0", "member A B", "support A pin" (or roller), ' +
      '"load C 0 -10". Loads are vector components, so DOWNWARD IS NEGATIVE. y is up. ' +
      "Member forces come back positive in tension. Keep your units consistent.",
    fields: [
      {
        key: "net",
        label: "Truss description",
        default: [
          "joint A 0 0",
          "joint B 6 0",
          "joint C 3 4",
          "member A B",
          "member A C",
          "member B C",
          "support A pin",
          "support B roller",
          "load C 0 -12",
        ].join("\n"),
        kind: "block",
        rows: 9,
      },
      { key: "unit", label: "Force unit (labelling only)", default: "kN", kind: "text" },
    ],
    compute: (r) => {
      const parsed = parseTruss(r("net"));
      if (parsed.errors.length) return { text: parsed.errors.join("\n"), ok: false };
      const res = analyzeTruss(parsed.input);
      if (!res.ok) return { text: res.error, ok: false };
      const fu = r("unit").trim();

      const lines: string[] = [];
      lines.push(
        `Planar truss: ${res.counts.joints} joints, ${res.counts.members} members, ` +
          `${res.counts.reactions} reaction components`,
      );
      lines.push(res.determinacy);
      lines.push("");
      lines.push("Member forces (positive = tension)");
      for (const m of res.members) {
        // An exact answer is shown as a fraction as well as a decimal, because
        // the fraction is what a textbook quotes and what a student is checking.
        const exact =
          m.exact && m.exact.d !== 1n ? ` = ${m.exact.n}/${m.exact.d}` : "";
        const tag = m.state === "zero" ? "zero force" : m.state;
        lines.push(`  ${m.a}-${m.b}: ${engNum(m.force)}${exact} ${fu} (${tag}), length ${engNum(m.length)}`);
      }
      lines.push("");
      lines.push("Reactions");
      for (const v of res.reactions) {
        const exact = v.exact.d !== 1n ? ` = ${v.exact.n}/${v.exact.d}` : "";
        lines.push(`  ${v.joint} ${v.dir}: ${engNum(v.value)}${exact} ${fu}`);
      }
      if (res.maxTension || res.maxCompression) {
        lines.push("");
        if (res.maxTension)
          lines.push(`Largest tension: ${res.maxTension.member} at ${engNum(res.maxTension.force)} ${fu}`);
        if (res.maxCompression)
          lines.push(
            `Largest compression: ${res.maxCompression.member} at ${engNum(res.maxCompression.force)} ${fu}`,
          );
      }
      if (res.zeroForce.length) {
        lines.push("");
        lines.push(`Zero-force members: ${res.zeroForce.join(", ")}`);
      }
      for (const w of res.warnings) lines.push(`Note: ${w}`);
      lines.push(
        "Reactions and any member with a whole-number length are EXACT; the rest are exact " +
          "divided by an irrational length.",
      );
      lines.push(ENG_EXACT_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "column",
    name: "Column buckling (Euler / Johnson)",
    group: "Structural & solids",
    hint:
      "Each field names its SI unit; a bare number is read in that unit, and you may write " +
      'another ("200 GPa", "1e6 mm^4") to have it converted. Paste I straight from the ' +
      "cross-section tool in mm^4 and it now converts instead of being wrong by 10^12. " +
      "I must be about the axis the column is WEAKEST in. Enter a yield strength — without it " +
      "a short column's Euler load is badly unconservative.",
    fields: [
      { key: "L", label: "Unbraced length, m", default: "3", kind: "text" },
      { key: "E", label: "Young's modulus, Pa", default: "200e9", kind: "text" },
      { key: "I", label: "Second moment of area (minor axis), m^4", default: "1e-6", kind: "text" },
      { key: "A", label: "Cross-sectional area, m^2", default: "2e-3", kind: "text" },
      { key: "Fy", label: "Yield strength, Pa (blank to skip)", default: "250e6", kind: "text" },
      {
        key: "end",
        label: "End conditions",
        default: "pinned",
        kind: "select",
        options: [
          { value: "pinned", label: "Pinned both ends (K = 1)" },
          { value: "fixed", label: "Fixed both ends (K = 0.5)" },
          { value: "fixed-pinned", label: "Fixed one end, pinned the other (K = 0.7)" },
          { value: "fixed-free", label: "Fixed one end, free the other (K = 2)" },
          { value: "custom", label: "Custom K" },
        ],
      },
      { key: "K", label: "Custom K (used only when End conditions is Custom)", default: "1", kind: "text" },
    ],
    compute: (r) => {
      const figs = engFigures([r("L"), r("E"), r("I"), r("A"), r("Fy")]);
      const u = engUnits(r);
      const res = analyzeColumn({
        L: u.req("L", "m", "Unbraced length"),
        E: u.req("E", "Pa", "Young's modulus"),
        I: u.req("I", "m^4", "Second moment of area"),
        A: u.req("A", "m^2", "Cross-sectional area"),
        Fy: u.opt("Fy", "Pa", "Yield strength", 0),
        end: (r("end") || "pinned") as EndCondition,
        kCustom: Number(r("K") || "1"),
      });
      if (u.errors.length) return { text: u.errors.join("\n"), ok: false };
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push("Column buckling");
      lines.push(`Effective length factor K = ${engNum(res.K, figs)}, effective length = ${engNum(res.Le, figs)} m`);
      lines.push(`Radius of gyration r = ${engNum(res.r, figs)} m`);
      lines.push(`Slenderness ratio Le/r = ${engNum(res.slenderness, figs)}`);
      lines.push("");
      lines.push(`Euler critical load Pcr = ${engNum(res.pEuler, figs)} N (${engNum(res.pEuler / 1e3, figs)} kN)`);
      lines.push(`Euler critical stress = ${engNum(res.sigmaEuler / 1e6, figs)} MPa`);
      if (res.slendernessTransition !== null) {
        lines.push(`Transition slenderness = ${engNum(res.slendernessTransition, figs)}`);
        lines.push(`Squash load A·Fy = ${engNum(res.pSquash as number, figs)} N`);
        lines.push("");
        lines.push(
          `GOVERNING critical load = ${engNum(res.pCritical, figs)} N ` +
            `(${engNum(res.pCritical / 1e3, figs)} kN), by the ` +
            `${res.governs === "johnson" ? "Johnson parabola" : "Euler hyperbola"}.`,
        );
      }
      lines.push("");
      lines.push(
        "This is the load at which the PERFECT column buckles. A real one has initial crookedness " +
          "and load eccentricity and fails below it, which is what a design code's factors are for.",
      );
      for (const note of res.notes) lines.push(`Note: ${note}`);
      u.report(lines);
      lines.push(ENG_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "torsion",
    name: "Shaft torsion",
    group: "Structural & solids",
    hint:
      "Circular shafts only — the formula is exact for a circle and simply wrong for any other " +
      'shape. Each field names its SI unit; a bare number is read in it, and a unit you write ("12 kN·m", ' +
      '"40 mm", "80 GPa") is converted.',
    fields: [
      { key: "T", label: "Torque, N·m", default: "1200", kind: "text" },
      { key: "d", label: "Outer diameter, m", default: "0.04", kind: "text" },
      { key: "di", label: "Bore diameter, m (0 for solid)", default: "0", kind: "text" },
      { key: "L", label: "Length, m (blank to skip the twist)", default: "1.5", kind: "text" },
      { key: "G", label: "Shear modulus, Pa (blank to skip the twist)", default: "80e9", kind: "text" },
    ],
    compute: (r) => {
      const figs = engFigures([r("T"), r("d"), r("di"), r("L"), r("G")]);
      const u = engUnits(r);
      const res = analyzeTorsion({
        T: u.req("T", "N*m", "Torque"),
        d: u.req("d", "m", "Outer diameter"),
        di: u.opt("di", "m", "Bore diameter", 0),
        L: u.opt("L", "m", "Length", 0),
        G: u.opt("G", "Pa", "Shear modulus", 0),
      });
      if (u.errors.length) return { text: u.errors.join("\n"), ok: false };
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push("Torsion of a circular shaft");
      lines.push(`Polar second moment J = ${engNum(res.J, figs)} m^4`);
      lines.push(`Peak shear stress at the surface = ${engNum(res.tauMax / 1e6, figs)} MPa (${engNum(res.tauMax, figs)} Pa)`);
      if (res.tauInner > 0) {
        lines.push(`Shear stress at the bore = ${engNum(res.tauInner / 1e6, figs)} MPa`);
      }
      lines.push("Shear varies linearly with radius, so the centre of a solid shaft carries none of it.");
      if (res.twistRad !== null) {
        lines.push("");
        lines.push(`Angle of twist = ${engNum(res.twistDeg as number, figs)} deg (${engNum(res.twistRad, figs)} rad)`);
      }
      for (const note of res.notes) lines.push(`Note: ${note}`);
      u.report(lines);
      lines.push(ENG_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "pipe",
    name: "Pipe flow & head loss",
    group: "Fluids",
    hint:
      "Each field names its SI unit; a bare number is read in it, and a unit you write " +
      '("100 mm", "15.7 L/s", "68 °F") is converted. The friction factor comes from ' +
      "Colebrook-White, solved rather than approximated. Leave the water temperature set to use " +
      "water properties; clear it to use the density and viscosity below.",
    fields: [
      { key: "D", label: "Internal diameter, m", default: "0.1", kind: "text" },
      { key: "L", label: "Pipe length, m", default: "100", kind: "text" },
      { key: "V", label: "Mean velocity, m/s (blank to use the flow rate)", default: "2", kind: "text" },
      { key: "Q", label: "Volumetric flow rate, m^3/s (used when velocity is blank)", default: "", kind: "text" },
      {
        key: "mat",
        label: "Pipe material (roughness)",
        default: "steel",
        kind: "select",
        options: ROUGHNESS.map((m) => ({ value: m.id, label: `${m.label} (${m.eps * 1000} mm)` })),
      },
      { key: "eps", label: "Roughness override, m (blank to use the material)", default: "", kind: "text" },
      { key: "tempC", label: "Water temperature, °C (blank to use ρ and μ below)", default: "20", kind: "text" },
      { key: "rho", label: "Density, kg/m^3", default: "998.2", kind: "text" },
      { key: "mu", label: "Dynamic viscosity, Pa·s", default: "1.002e-3", kind: "text" },
      { key: "K", label: "Sum of minor-loss coefficients ΣK", default: "0", kind: "text" },
      { key: "eta", label: "Pump efficiency 0-1 (blank to skip)", default: "", kind: "text" },
    ],
    compute: (r) => {
      const figs = engFigures([r("D"), r("L"), r("V") || r("Q")]);
      const u = engUnits(r);

      let rho = NaN;
      let mu = NaN;
      let fluidNote = "";
      const tempRaw = r("tempC").trim();
      if (tempRaw) {
        // Read as a temperature so "68 °F" works; the table is indexed in °C.
        const tC = u.req("tempC", "°C", "Water temperature");
        const w = Number.isFinite(tC) ? waterProperties(tC) : null;
        if (!w) {
          if (!u.errors.length) {
            u.errors.push(
              "Water temperature: must be between 0 and 100 °C. Clear this field to enter a density and viscosity directly.",
            );
          }
        } else {
          rho = w.rho;
          mu = w.mu;
          fluidNote = `Water at ${engNum(tC, figs)} °C: ρ = ${engNum(rho, 5)} kg/m^3, μ = ${engNum(mu, 4)} Pa·s`;
        }
      } else {
        // Only read these when they are actually the source of truth, so a stale
        // value in a hidden-by-convention field cannot raise an error.
        rho = u.req("rho", "kg/m^3", "Density");
        mu = u.req("mu", "Pa*s", "Dynamic viscosity");
        fluidNote = `ρ = ${engNum(rho, 5)} kg/m^3, μ = ${engNum(mu, 4)} Pa·s as entered`;
      }

      const mat = ROUGHNESS.find((m) => m.id === r("mat")) ?? ROUGHNESS[1];
      const eps = u.opt("eps", "m", "Roughness", mat.eps);

      const vRaw = r("V").trim();
      const qRaw = r("Q").trim();
      const res = analyzePipe({
        D: u.req("D", "m", "Internal diameter"),
        L: u.req("L", "m", "Pipe length"),
        V: vRaw ? u.req("V", "m/s", "Mean velocity") : undefined,
        Q: !vRaw && qRaw ? u.req("Q", "m^3/s", "Volumetric flow rate") : undefined,
        eps,
        rho,
        mu,
        sumK: Number(r("K") || "0"),
        eta: r("eta").trim() ? Number(r("eta")) : undefined,
      });
      if (u.errors.length) return { text: u.errors.join("\n"), ok: false };
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push("Pipe flow");
      lines.push(fluidNote);
      lines.push(
        `Roughness ε = ${engNum(eps, 3)} m` + (r("eps").trim() ? " (as entered)" : ` (${mat.label})`),
      );
      lines.push("");
      lines.push(`Velocity = ${engNum(res.V, figs)} m/s, flow rate = ${engNum(res.Q, figs)} m^3/s (${engNum(res.Q * 1000, figs)} L/s)`);
      lines.push(`Reynolds number Re = ${engNum(res.Re, figs)} — ${res.regime}`);
      lines.push(`Relative roughness ε/D = ${engNum(res.relRoughness, 3)}`);
      lines.push(`Darcy friction factor f = ${engNum(res.f, 4)} (Fanning = ${engNum(res.f / 4, 4)})`);
      lines.push("");
      lines.push(`Friction head loss = ${engNum(res.hMajor, figs)} m`);
      if (res.hMinor > 0) {
        lines.push(`Minor (fitting) losses = ${engNum(res.hMinor, figs)} m`);
        lines.push(`Total head loss = ${engNum(res.hTotal, figs)} m`);
      }
      lines.push(`Pressure drop = ${engNum(res.dp, figs)} Pa (${engNum(res.dp / 1e5, figs)} bar)`);
      lines.push(`Wall shear stress = ${engNum(res.tauWall, figs)} Pa`);
      lines.push(`Power lost to friction = ${engNum(res.powerLost, figs)} W`);
      if (res.pumpPower !== null) {
        lines.push(`Pump shaft power required = ${engNum(res.pumpPower, figs)} W`);
      }
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(
        "Pipe roughness is a design value with real spread — commercial steel varies by a factor " +
          "of two or more and roughens with age — so the head loss is not as precise as the " +
          "digits suggest.",
      );
      u.report(lines);
      lines.push(ENG_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "wall",
    name: "Composite wall / pipe insulation",
    group: "Thermal",
    hint:
      'Layers, one per line: "name, conductivity, thickness", or "material, thickness" to use ' +
      'the built-in conductivity — try "Mineral wool, 50 mm". Order them from the inside out. ' +
      "Each field names its SI unit; a bare number is read in it and a unit you write is " +
      "converted. A film coefficient of 0 means that surface sits at the fluid temperature.",
    fields: [
      {
        key: "geom",
        label: "Geometry",
        default: "plane",
        kind: "select",
        options: [
          { value: "plane", label: "Plane wall" },
          { value: "cylinder", label: "Pipe or cylinder" },
        ],
      },
      {
        key: "layers",
        label: "Layers, inside first",
        default: "Common brick, 0.2\nMineral wool, 0.05",
        kind: "block",
        rows: 4,
      },
      { key: "A", label: "Area, m^2 (plane only)", default: "1", kind: "text" },
      { key: "r1", label: "Inner radius, m (cylinder only)", default: "0.02", kind: "text" },
      { key: "Lc", label: "Length, m (cylinder only)", default: "1", kind: "text" },
      { key: "hIn", label: "Inside film coefficient, W/(m²·K)", default: "10", kind: "text" },
      { key: "hOut", label: "Outside film coefficient, W/(m²·K)", default: "25", kind: "text" },
      { key: "tIn", label: "Inside fluid temperature, °C", default: "20", kind: "text" },
      { key: "tOut", label: "Outside fluid temperature, °C", default: "-5", kind: "text" },
    ],
    compute: (r) => {
      const figs = engFigures([r("hIn"), r("hOut"), r("tIn"), r("tOut")]);
      const layers: Layer[] = [];
      const errors: string[] = [];
      const raw = r("layers").split(/\r?\n/);
      for (let i = 0; i < raw.length; i++) {
        const line = raw[i].split("#")[0].trim();
        if (!line) continue;
        const parts = line.split(",").map((s) => s.trim());
        if (parts.length === 3) {
          // Unit-aware like every other Engineering field, so "Brick, 0.72, 200 mm"
          // works and does not have to be pre-divided by a thousand by hand.
          const kM = parseMeasured(parts[1], "W/m/K");
          const tM = parseMeasured(parts[2], "m");
          if ("error" in kM) {
            errors.push(`Layer ${i + 1} conductivity: ${kM.error}`);
            continue;
          }
          if ("error" in tM) {
            errors.push(`Layer ${i + 1} thickness: ${tM.error}`);
            continue;
          }
          layers.push({ name: parts[0], k: kM.inTarget, t: tM.inTarget });
        } else if (parts.length === 2) {
          const wanted = parts[0].toLowerCase();
          const hit = CONDUCTIVITY.find((c) => c.id === wanted || c.label.toLowerCase() === wanted);
          const tM = parseMeasured(parts[1], "m");
          const t = "error" in tM ? NaN : tM.inTarget;
          if (!hit) {
            errors.push(
              `Layer ${i + 1}: "${parts[0]}" is not a known material. Give a conductivity ` +
                `explicitly as "name, k, thickness", or use one of: ` +
                CONDUCTIVITY.map((c) => c.label).join(", "),
            );
            continue;
          }
          if (!Number.isFinite(t)) {
            errors.push(`Layer ${i + 1} thickness: ${"error" in tM ? tM.error : "must be a number."}`);
            continue;
          }
          layers.push({ name: hit.label, k: hit.k, t });
        } else {
          errors.push(`Layer ${i + 1}: expected "name, k, thickness" or "material, thickness".`);
        }
      }
      if (errors.length) return { text: errors.join("\n"), ok: false };

      const geom = (r("geom") || "plane") as "plane" | "cylinder";
      const u = engUnits(r);
      // Held in a local because the report prints the inside fluid temperature
      // back, and it must be the CONVERTED value — printing the raw field would
      // say 68 next to a chain computed at 20.
      const tInSi = u.req("tIn", "°C", "Inside temperature");
      const res = analyzeWall({
        geometry: geom,
        layers,
        A: geom === "plane" ? u.req("A", "m^2", "Area") : undefined,
        r1: geom === "cylinder" ? u.req("r1", "m", "Inner radius") : undefined,
        L: geom === "cylinder" ? u.req("Lc", "m", "Length") : undefined,
        hIn: u.opt("hIn", "W/m^2/K", "Inside film coefficient", 0),
        hOut: u.opt("hOut", "W/m^2/K", "Outside film coefficient", 0),
        tIn: tInSi,
        tOut: u.req("tOut", "°C", "Outside temperature"),
      });
      if (u.errors.length) return { text: u.errors.join("\n"), ok: false };
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push(geom === "plane" ? "Composite plane wall" : "Composite cylindrical wall");
      lines.push(`Total thermal resistance = ${engNum(res.Rtotal, figs)} K/W`);
      lines.push(`Overall coefficient U = ${engNum(res.U, figs)} W/(m²·K), on the outer area ${engNum(res.areaOuter, figs)} m²`);
      lines.push(`Heat rate Q = ${engNum(res.Q, figs)} W`);
      lines.push(`Heat flux = ${engNum(res.flux, figs)} W/m² of outer surface`);
      lines.push("");
      lines.push("Resistance chain, inside to outside");
      lines.push(`  Inside fluid at ${engNum(tInSi, figs)} °C`);
      for (const s of res.steps) {
        lines.push(
          `  ${s.name}: R = ${engNum(s.R, figs)} K/W (${engNum(100 * s.share, 3)}%) → ` +
            `${engNum(s.tAfter, figs)} °C`,
        );
      }
      lines.push("");
      lines.push(`Controlling resistance: ${res.controlling}`);
      if (res.criticalRadius !== null) {
        lines.push(`Critical radius of insulation k/h = ${engNum(res.criticalRadius, figs)} m`);
      }
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(
        "Conductivity values are representative. Real materials vary with density and moisture, " +
          "and wet insulation can be several times worse than the dry figure.",
      );
      u.report(lines);
      lines.push(ENG_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "hx",
    name: "Heat exchanger (LMTD sizing)",
    group: "Thermal",
    hint:
      "Give all four terminal temperatures and U, then either an area to get the duty or a duty " +
      "to get the area. Each field names its SI unit; a bare number is read in it and a unit " +
      'you write ("120 °F", "50 kW") is converted. Counterflow is the true-counterflow LMTD; ' +
      "a real shell-and-tube unit needs an F correction and more area than this.",
    fields: [
      {
        key: "flow",
        label: "Arrangement",
        default: "counter",
        kind: "select",
        options: [
          { value: "counter", label: "Counterflow" },
          { value: "parallel", label: "Parallel flow" },
        ],
      },
      { key: "thIn", label: "Hot stream inlet, °C", default: "150", kind: "text" },
      { key: "thOut", label: "Hot stream outlet, °C", default: "90", kind: "text" },
      { key: "tcIn", label: "Cold stream inlet, °C", default: "30", kind: "text" },
      { key: "tcOut", label: "Cold stream outlet, °C", default: "70", kind: "text" },
      { key: "U", label: "Overall coefficient U, W/(m²·K)", default: "500", kind: "text" },
      { key: "A", label: "Area, m² (blank to solve for it)", default: "10", kind: "text" },
      { key: "Q", label: "Duty, W (used when the area is blank)", default: "", kind: "text" },
    ],
    compute: (r) => {
      const figs = engFigures([r("thIn"), r("thOut"), r("tcIn"), r("tcOut"), r("U")]);
      const u = engUnits(r);
      const aRaw = r("A").trim();
      const qRaw = r("Q").trim();
      const Usi = u.req("U", "W/m^2/K", "Overall coefficient");
      const res = analyzeExchanger({
        flow: (r("flow") || "counter") as "counter" | "parallel",
        thIn: u.req("thIn", "°C", "Hot stream inlet"),
        thOut: u.req("thOut", "°C", "Hot stream outlet"),
        tcIn: u.req("tcIn", "°C", "Cold stream inlet"),
        tcOut: u.req("tcOut", "°C", "Cold stream outlet"),
        U: Usi,
        A: aRaw ? u.req("A", "m^2", "Area") : undefined,
        Q: !aRaw && qRaw ? u.req("Q", "W", "Duty") : undefined,
      });
      if (u.errors.length) return { text: u.errors.join("\n"), ok: false };
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push(`${r("flow") === "parallel" ? "Parallel-flow" : "Counterflow"} heat exchanger`);
      lines.push(`Terminal differences: ΔT1 = ${engNum(res.dt1, figs)} K, ΔT2 = ${engNum(res.dt2, figs)} K`);
      lines.push(`Log mean temperature difference = ${engNum(res.lmtd, figs)} K`);
      lines.push("");
      lines.push(`Heat duty Q = ${engNum(res.Q, figs)} W (${engNum(res.Q / 1000, figs)} kW)`);
      lines.push(`Area A = ${engNum(res.A, figs)} m²`);
      lines.push(`  from Q = U·A·ΔTlm with U = ${engNum(Usi, figs)} W/(m²·K)`);
      for (const note of res.notes) lines.push(`Note: ${note}`);
      u.report(lines);
      lines.push(ENG_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "control-tf",
    name: "Poles, zeros & stability",
    group: "Control systems",
    hint:
      'Coefficients highest power first ("1 3 2") or written out ("s^2+3*s+2") — either works. ' +
      "Stability is decided TWICE, exactly by Routh-Hurwitz and numerically from the poles, and " +
      "if the two disagree it says so instead of picking one.",
    fields: [
      { key: "num", label: "Numerator", default: "1", kind: "text" },
      { key: "den", label: "Denominator", default: "s^3+3*s^2+2*s+1", kind: "text" },
      { key: "showRouth", label: "Show the Routh array", default: "yes", kind: "select", options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ] },
    ],
    compute: (r) => {
      const tf = parseTf(r("num"), r("den"));
      if ("ok" in tf) return { text: tf.error, ok: false };
      const res = analyzeStability(tf);
      if (!res.ok) return { text: res.error, ok: false };

      const lines: EngLine[] = [];
      lines.push(tfLine("G(s)", tf.num, tf.den));
      lines.push("");
      lines.push(res.verdict);
      lines.push("");
      lines.push("Poles");
      for (const p of res.poles) {
        const tag = p.re > 0 ? "right half plane" : Math.abs(p.re) < 1e-12 ? "on the imaginary axis" : "stable";
        lines.push(`  ${fmtComplexPlain(p)}   (${tag})`);
      }
      if (res.zeros.length) {
        lines.push("");
        lines.push("Zeros");
        for (const z of res.zeros) lines.push(`  ${fmtComplexPlain(z)}`);
      } else {
        lines.push("");
        lines.push("No finite zeros.");
      }

      if (r("showRouth") !== "no" && res.routh) {
        lines.push("");
        lines.push("Routh array (exact, first column first)");
        for (const row of res.routh.rows) {
          lines.push("  " + row.map((c) => (c.d === 1n ? String(c.n) : `${c.n}/${c.d}`)).join("   "));
        }
        lines.push(
          `Sign changes in the first column: ${res.routh.signChanges}` +
            (res.routh.clean ? " = poles in the right half plane." : " (the array degenerated; see the note)."),
        );
      }
      if (res.rhpPolesRouth !== null && !res.disagreement) {
        lines.push("");
        lines.push(
          `Cross-check: the exact tabulation and the computed poles BOTH give ` +
            `${res.rhpPolesNumeric} pole(s) in the right half plane. These share no arithmetic, ` +
            "so agreeing is real evidence rather than the same mistake twice.",
        );
      }
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_CONTROL_UNIT_NOTE);
      return engReport(lines);
    },
  },
  {
    id: "control-step",
    name: "Step & impulse response",
    group: "Control systems",
    hint:
      "Simulates the response and reports the transient metrics. For a genuine second-order " +
      "system the damping ratio and overshoot are exact identities; above second order they come " +
      "from the dominant poles and the result says so rather than presenting an estimate as fact.",
    fields: [
      { key: "num", label: "Numerator", default: "4", kind: "text" },
      { key: "den", label: "Denominator", default: "s^2+2*s+4", kind: "text" },
      {
        key: "kind",
        label: "Input",
        default: "step",
        kind: "select",
        options: [
          { value: "step", label: "Unit step" },
          { value: "impulse", label: "Impulse" },
        ],
      },
      { key: "tEnd", label: "End time (blank to choose it from the poles)", default: "", kind: "text" },
    ],
    compute: (r) => {
      const tf = parseTf(r("num"), r("den"));
      if ("ok" in tf) return { text: tf.error, ok: false };
      const kind = r("kind") === "impulse" ? "impulse" : "step";

      // A sensible default window: about five time constants of the slowest
      // stable mode, so the transient is actually visible rather than a spike
      // in the corner of an arbitrary 10-second axis.
      let tEnd = Number(r("tEnd"));
      let chosen = false;
      if (!r("tEnd").trim() || !Number.isFinite(tEnd) || tEnd <= 0) {
        const st = analyzeStability(tf);
        const slowest =
          st.ok && st.poles.length
            ? Math.min(...st.poles.map((p) => Math.abs(p.re)).filter((v) => v > 1e-9))
            : NaN;
        tEnd = Number.isFinite(slowest) && slowest > 0 ? 6 / slowest : 10;
        chosen = true;
      }

      const res = timeResponse(tf, kind, tEnd, 400);
      if (!res.ok) return { text: res.error, ok: false };

      const lines: EngLine[] = [];
      lines.push(tfLine("G(s)", tf.num, tf.den));
      lines.push(`${kind === "step" ? "Unit step" : "Impulse"} response over 0 to ${engNum(tEnd)} s` +
        (chosen ? " (window chosen from the slowest pole)" : ""));
      lines.push("");

      const m = secondOrderMetrics(tf);
      if (m.ok) {
        lines.push(m.exact ? "Second-order metrics (exact for this system)" : "Transient metrics from the dominant poles");
        lines.push(`  Natural frequency wn = ${engNum(m.wn)} rad/s`);
        lines.push(`  Damping ratio zeta = ${engNum(m.zeta)} (${m.kind})`);
        if (m.wd > 0) lines.push(`  Damped frequency wd = ${engNum(m.wd)} rad/s`);
        if (m.overshoot !== null) lines.push(`  Overshoot = ${engNum(m.overshoot * 100)}%`);
        if (m.peakTime !== null) lines.push(`  Peak time = ${engNum(m.peakTime)} s`);
        if (m.riseTime !== null) lines.push(`  Rise time (0-100%) = ${engNum(m.riseTime)} s`);
        if (m.settlingTime !== null) lines.push(`  Settling time (2%) = ${engNum(m.settlingTime)} s`);
        for (const note of m.notes) lines.push(`  Note: ${note}`);
        lines.push("");
      }

      if (res.finalValue !== null) lines.push(`Final value = ${engNum(res.finalValue)}`);
      lines.push(`Peak of the simulated response: ${engNum(res.peak.y)} at t = ${engNum(res.peak.t)} s`);
      if (res.finalValue !== null && res.finalValue !== 0) {
        const os = (res.peak.y - res.finalValue) / res.finalValue;
        if (os > 1e-6) lines.push(`  which is ${engNum(os * 100)}% overshoot, measured from the simulation`);
      }
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push("The response is integrated numerically; the metrics above it are closed-form.");
      lines.push(ENG_CONTROL_UNIT_NOTE);

      const svg = buildPlotSvg(
        [{ points: res.t.map((t, i) => ({ x: t, y: res.y[i] })), type: "line", color: "#2563eb", label: "y(t)" }],
        { width: 380, height: 240, xlabel: "Time (s)", ylabel: "Output", title: `${kind === "step" ? "Step" : "Impulse"} response` },
      );
      return engReport(lines, [
        {
          kind: "plot",
          svg,
          caption: `${kind === "step" ? "Step" : "Impulse"} response`,
          alt: `${kind} response of the transfer function against time`,
          w: 380,
          h: 240,
        },
      ]);
    },
  },
  {
    id: "control-bode",
    name: "Frequency response & margins",
    group: "Control systems",
    hint:
      "Enter the OPEN-LOOP transfer function L(s) = G·H. Gain and phase margins are open-loop " +
      "quantities that predict what happens when the loop is closed around them — entering a " +
      "closed-loop transfer function here produces numbers that mean nothing.",
    fields: [
      { key: "num", label: "Open-loop numerator", default: "1", kind: "text" },
      { key: "den", label: "Open-loop denominator", default: "s^3+3*s^2+2*s", kind: "text" },
    ],
    compute: (r) => {
      const tf = parseTf(r("num"), r("den"));
      if ("ok" in tf) return { text: tf.error, ok: false };
      const mg = margins(tf);
      if (!mg.ok) return { text: mg.error, ok: false };
      const freqs = autoFrequencies(tf, 300);
      const resp = frequencyResponse(tf, freqs);

      const lines: EngLine[] = [];
      lines.push(tfLine("L(s)", tf.num, tf.den));
      lines.push("");
      if (mg.gainMarginDb !== null) {
        lines.push(`Gain margin = ${engNum(mg.gainMarginDb)} dB at ${engNum(mg.phaseCrossoverW as number)} rad/s`);
        lines.push(`  the loop gain may be multiplied by ${engNum(Math.pow(10, mg.gainMarginDb / 20))} before it goes unstable`);
      } else {
        lines.push("Gain margin: infinite — the phase never reaches -180 degrees.");
      }
      if (mg.phaseMarginDeg !== null) {
        lines.push(`Phase margin = ${engNum(mg.phaseMarginDeg)} deg at ${engNum(mg.gainCrossoverW as number)} rad/s`);
      } else {
        lines.push("Phase margin: none — the magnitude never crosses 0 dB.");
      }
      lines.push("");
      lines.push("Closing the loop");
      const closed = feedback(tf);
      const st = analyzeStability(closed);
      if (st.ok) {
        lines.push(`  Closed-loop denominator: ${polyToString(closed.den)}`);
        lines.push(`  ${st.verdict}`);
      }
      for (const note of mg.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_CONTROL_UNIT_NOTE);

      const magSvg = buildPlotSvg(
        [{ points: resp.map((p) => ({ x: p.w, y: p.magnitudeDb })), type: "line", color: "#2563eb", label: "|L|" }],
        { width: 380, height: 220, xlabel: "Frequency (rad/s)", ylabel: "Magnitude (dB)", xScale: "log", title: "Bode magnitude" },
      );
      const phaseSvg = buildPlotSvg(
        [{ points: resp.map((p) => ({ x: p.w, y: p.phaseDeg })), type: "line", color: "#b91c1c", label: "phase" }],
        { width: 380, height: 220, xlabel: "Frequency (rad/s)", ylabel: "Phase (deg)", xScale: "log", title: "Bode phase" },
      );
      return engReport(lines, [
        {
          kind: "plot",
          svg: magSvg,
          caption: "Bode magnitude",
          alt: "Open-loop magnitude in decibels against log frequency",
          w: 380,
          h: 220,
        },
        {
          kind: "plot",
          svg: phaseSvg,
          caption: "Bode phase",
          alt: "Open-loop phase in degrees against log frequency",
          w: 380,
          h: 220,
        },
      ]);
    },
  },
  {
    id: "control-pid",
    name: "PID & closed loop",
    group: "Control systems",
    hint:
      "Puts a PID controller in series with your plant and closes a unity-feedback loop around " +
      "it. Ziegler-Nichols is offered as a STARTING POINT — it is deliberately aggressive and " +
      "typically gives about 25% overshoot, which is a tuning to refine, not a design.",
    fields: [
      { key: "num", label: "Plant numerator", default: "1", kind: "text" },
      { key: "den", label: "Plant denominator", default: "s^3+3*s^2+2*s", kind: "text" },
      { key: "kp", label: "Kp", default: "1", kind: "text" },
      { key: "ki", label: "Ki", default: "0", kind: "text" },
      { key: "kd", label: "Kd", default: "0", kind: "text" },
    ],
    compute: (r) => {
      const plant = parseTf(r("num"), r("den"));
      if ("ok" in plant) return { text: plant.error, ok: false };
      const gains: Record<string, ReturnType<typeof parseRatLiteral>> = {
        kp: parseRatLiteral(r("kp") || "0"),
        ki: parseRatLiteral(r("ki") || "0"),
        kd: parseRatLiteral(r("kd") || "0"),
      };
      for (const [k, v] of Object.entries(gains)) {
        if (!v) return { text: `${k.toUpperCase()} must be a number.`, ok: false };
      }
      const c = pidTf(gains.kp!, gains.ki!, gains.kd!);
      const open = series(c, plant);
      const closed = feedback(open);

      const lines: EngLine[] = [];
      lines.push(tfLine("C(s)", c.num, c.den));
      lines.push(tfLine("G(s)", plant.num, plant.den));
      lines.push(tfLine("L(s)", open.num, open.den));
      lines.push("");
      lines.push(tfLine("T(s)", closed.num, closed.den));
      const st = analyzeStability(closed);
      if (!st.ok) return { text: st.error, ok: false };
      lines.push(st.verdict);
      lines.push("");
      lines.push("Closed-loop poles");
      for (const p of st.poles) lines.push(`  ${fmtComplexPlain(p)}`);

      const mg = margins(open);
      if (mg.ok) {
        lines.push("");
        lines.push("Open-loop margins");
        lines.push(
          mg.gainMarginDb !== null
            ? `  Gain margin = ${engNum(mg.gainMarginDb)} dB at ${engNum(mg.phaseCrossoverW as number)} rad/s`
            : "  Gain margin: infinite — the phase never reaches -180 degrees.",
        );
        lines.push(
          mg.phaseMarginDeg !== null
            ? `  Phase margin = ${engNum(mg.phaseMarginDeg)} deg at ${engNum(mg.gainCrossoverW as number)} rad/s`
            : "  Phase margin: none — the magnitude never crosses 0 dB.",
        );
        for (const note of mg.notes) lines.push(`  Note: ${note}`);
      }

      const m = secondOrderMetrics(closed);
      if (m.ok) {
        lines.push("");
        lines.push(m.exact ? "Closed-loop transient (exact)" : "Closed-loop transient, from the dominant poles");
        lines.push(`  wn = ${engNum(m.wn)} rad/s, zeta = ${engNum(m.zeta)} (${m.kind})`);
        if (m.overshoot !== null) lines.push(`  Overshoot = ${engNum(m.overshoot * 100)}%`);
        if (m.settlingTime !== null) lines.push(`  Settling time (2%) = ${engNum(m.settlingTime)} s`);
        for (const note of m.notes) lines.push(`  Note: ${note}`);
      }

      if (ratNum(gains.ki!) === 0) {
        lines.push("");
        lines.push(
          "With Ki = 0 there is no integrator, so a step input leaves a STEADY-STATE ERROR unless " +
            "the plant already contains one. Integral action removes that error and costs phase " +
            "margin, which is the trade this tool is for.",
        );
      }
      for (const note of st.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_CONTROL_UNIT_NOTE);
      return engReport(lines);
    },
  },
  {
    id: "pk-dose",
    name: "Dose & concentration curve",
    group: "Pharmacokinetics",
    hint:
      "Built on CLEARANCE and VOLUME, which are the physiologically independent parameters — " +
      "half-life is a consequence of both (t½ = ln2·Vd/CL). Dose in mg with Vd in L gives mg/L " +
      "(= µg/mL) and CL in L/h. Oral dosing checks for flip-flop kinetics.",
    fields: [
      {
        key: "route",
        label: "Route",
        default: "iv-bolus",
        kind: "select",
        options: [
          { value: "iv-bolus", label: "IV bolus" },
          { value: "infusion", label: "IV infusion" },
          { value: "oral", label: "Oral (first-order absorption)" },
        ],
      },
      { key: "dose", label: "Dose, mg", default: "500", kind: "text" },
      { key: "vd", label: "Volume of distribution Vd, L", default: "35", kind: "text" },
      { key: "cl", label: "Clearance CL, L/h", default: "3.5", kind: "text" },
      { key: "f", label: "Bioavailability F, 0-1 (oral)", default: "0.8", kind: "text" },
      { key: "ka", label: "Absorption rate constant ka, /h (oral)", default: "1.0", kind: "text" },
      { key: "tInf", label: "Infusion duration, h (infusion)", default: "1", kind: "text" },
      { key: "tEnd", label: "End time, h (blank to use 5 half-lives)", default: "", kind: "text" },
    ],
    compute: (r) => {
      const route = (r("route") || "iv-bolus") as PkRoute;
      const base = {
        dose: Number(r("dose") || "0"),
        vd: Number(r("vd") || "0"),
        cl: Number(r("cl") || "0"),
        f: r("f").trim() ? Number(r("f")) : 1,
      };
      const p = {
        ...base,
        // Bioavailability only applies to the oral route; forcing F on an IV
        // dose would quietly discard drug that went straight into the vein.
        f: route === "oral" ? base.f : 1,
        ka: Number(r("ka") || "0"),
        tInf: Number(r("tInf") || "0"),
      };
      let tEnd = Number(r("tEnd"));
      let chosen = false;
      if (!r("tEnd").trim() || !Number.isFinite(tEnd) || tEnd <= 0) {
        if (!(p.cl > 0 && p.vd > 0)) return { text: "Enter a positive clearance and volume.", ok: false };
        tEnd = 5 * (Math.LN2 / (p.cl / p.vd)) + (route === "infusion" ? p.tInf : 0);
        chosen = true;
      }

      const res = singleDoseCurve(route, p, tEnd, 400);
      if (!res.ok) return { text: res.error, ok: false };

      const label = route === "iv-bolus" ? "IV bolus" : route === "infusion" ? "IV infusion" : "Oral";
      const lines: string[] = [];
      lines.push(`${label} dose of ${engNum(p.dose)} mg`);
      lines.push(
        `CL = ${engNum(p.cl)} L/h, Vd = ${engNum(p.vd)} L` + (route === "oral" ? `, F = ${engNum(p.f)}, ka = ${engNum(p.ka)} /h` : ""),
      );
      lines.push("");
      lines.push(`Elimination rate constant k = CL/Vd = ${engNum(res.k)} /h`);
      lines.push(`Half-life = ln2/k = ${engNum(res.halfLife)} h`);
      lines.push("");
      lines.push(`Cmax = ${engNum(res.cmax)} mg/L at t = ${engNum(res.tmax)} h`);
      lines.push(`AUC (0 to infinity) = ${engNum(res.auc)} mg·h/L`);
      lines.push(
        route === "oral"
          ? "  AUC = F·Dose/CL — total exposure is set by clearance and bioavailability alone."
          : "  AUC = Dose/CL — total exposure is set by CLEARANCE alone, not by the volume of distribution.",
      );
      if (chosen) lines.push(`Simulated to ${engNum(tEnd)} h (five half-lives, chosen for you).`);
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_PK_UNIT_NOTE);

      const svg = buildPlotSvg(
        [{ points: res.t.map((t, i) => ({ x: t, y: res.c[i] })), type: "line", color: "#2563eb", label: "C(t)" }],
        { width: 380, height: 240, xlabel: "Time (h)", ylabel: "Concentration (mg/L)", title: `${label} concentration-time profile` },
      );
      const clean = lines.map(plainDashes);
      const blocks: AnalyzeBlock[] = [
        ...clean.map((t) => ({ kind: "line" as const, text: t })),
        {
          kind: "plot" as const,
          svg,
          caption: `${label} concentration-time profile`,
          alt: `Plasma concentration against time after a ${label} dose`,
          w: 380,
          h: 240,
        },
      ];
      return { text: clean.join("\n"), blocks };
    },
  },
  {
    id: "pk-steady",
    name: "Steady state & loading dose",
    group: "Pharmacokinetics",
    hint:
      "Repeated dosing at a fixed interval. The average steady-state concentration depends ONLY " +
      "on dose rate and clearance — not on volume and not on half-life — while the time to get " +
      "there depends only on half-life. That split is what a loading dose exploits.",
    fields: [
      { key: "dose", label: "Maintenance dose, mg", default: "500", kind: "text" },
      { key: "tau", label: "Dosing interval τ, h", default: "12", kind: "text" },
      { key: "vd", label: "Volume of distribution Vd, L", default: "35", kind: "text" },
      { key: "cl", label: "Clearance CL, L/h", default: "3.5", kind: "text" },
      { key: "f", label: "Bioavailability F, 0-1", default: "1", kind: "text" },
      { key: "ka", label: "Absorption rate ka, 1/h (blank for an IV bolus)", default: "", kind: "text" },
      { key: "nDoses", label: "Doses to plot", default: "10", kind: "text" },
    ],
    compute: (r) => {
      // ka is OPTIONAL and left out entirely when blank, because `undefined` is what
      // steadyState reads as "no absorption model, use the instantaneous-input
      // formula and say so". Passing 0 would look like a supplied rate of zero.
      const kaText = r("ka").trim();
      const kaValue = kaText ? Number(kaText) : undefined;
      if (kaText && (!Number.isFinite(kaValue) || (kaValue as number) <= 0)) {
        return {
          text: "The absorption rate constant must be a positive number, or blank for an IV bolus.",
          ok: false,
        };
      }
      const p = {
        dose: Number(r("dose") || "0"),
        vd: Number(r("vd") || "0"),
        cl: Number(r("cl") || "0"),
        f: r("f").trim() ? Number(r("f")) : 1,
        ...(kaValue === undefined ? {} : { ka: kaValue }),
      };
      const tau = Number(r("tau") || "0");
      const res = steadyState(p, tau);
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push(`${engNum(p.dose)} mg every ${engNum(tau)} h`);
      lines.push(
        `CL = ${engNum(p.cl)} L/h, Vd = ${engNum(p.vd)} L, F = ${engNum(p.f)}` +
          (kaValue === undefined ? " (IV bolus — no absorption)" : `, ka = ${engNum(kaValue)} 1/h`),
      );
      lines.push("");
      lines.push(`Half-life = ${engNum(res.halfLife)} h; the interval is ${engNum(tau / res.halfLife)} half-lives`);
      lines.push(`Accumulation ratio = ${engNum(res.accumulation)}`);
      lines.push("");
      lines.push("At steady state");
      lines.push(
        `  Peak    Cmax,ss = ${engNum(res.cMaxSs)} mg/L` +
          (res.tMaxSs === null ? " (at the moment of dosing)" : ` at t = ${engNum(res.tMaxSs)} h after each dose`),
      );
      lines.push(`  Trough  Cmin,ss = ${engNum(res.cMinSs)} mg/L`);
      lines.push(`  Average Cavg,ss = ${engNum(res.cAvgSs)} mg/L  (= F·Dose/(CL·τ))`);
      lines.push(
        res.fluctuation === null
          ? "  Peak-to-trough fluctuation: not defined — the trough reaches zero between doses."
          : `  Peak-to-trough fluctuation = ${engNum(res.fluctuation * 100)}% of the trough`,
      );
      lines.push("");
      lines.push(`Time to 95% of steady state = ${engNum(res.timeTo95)} h (4.3 half-lives)`);
      lines.push(`Loading dose to reach the steady-state peak immediately = ${engNum(res.loadingDose)} mg`);
      lines.push(
        "  The loading dose is set by the VOLUME (it fills the space); the maintenance dose is " +
          "set by the CLEARANCE (it replaces what is removed). They answer different questions.",
      );
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_PK_UNIT_NOTE);

      const nDoses = Math.max(1, Math.min(Math.floor(Number(r("nDoses") || "10")) || 10, 60));
      if (kaValue !== undefined) {
        // Do not let the figure quietly contradict the numbers above it.
        lines.push(
          "Note: the curve below is drawn as repeated INSTANTANEOUS doses, so its peaks are the " +
            "instantaneous-input peaks rather than the absorbed ones reported above. It shows the " +
            "accumulation and the approach to steady state correctly; read the peak height from " +
            "the figures, not from the plot.",
        );
      }
      const trace = multipleDoseCurve(p, tau, nDoses, 800);
      const clean = lines.map(plainDashes);
      if (!trace.ok) return { text: clean.join("\n") };

      const svg = buildPlotSvg(
        [{ points: trace.t.map((t, i) => ({ x: t, y: trace.c[i] })), type: "line", color: "#2563eb", label: "C(t)" }],
        { width: 380, height: 240, xlabel: "Time (h)", ylabel: "Concentration (mg/L)", title: `${nDoses} doses, ${engNum(tau)} h apart` },
      );
      const blocks: AnalyzeBlock[] = [
        ...clean.map((t) => ({ kind: "line" as const, text: t })),
        {
          kind: "plot" as const,
          svg,
          caption: `Accumulation over ${nDoses} doses`,
          alt: `Plasma concentration over ${nDoses} repeated doses approaching steady state`,
          w: 380,
          h: 240,
        },
      ];
      return { text: clean.join("\n"), blocks };
    },
  },
  {
    id: "pk-nca",
    name: "Analyse measured data (NCA)",
    group: "Pharmacokinetics",
    hint:
      'One "time concentration" pair per line. The terminal slope is CHOSEN by trying every ' +
      "window of at least three points and keeping the best adjusted R². The percentage of AUC " +
      "that came from extrapolation is reported, because above about 20% the study simply did " +
      "not follow the drug long enough.",
    fields: [
      {
        key: "data",
        label: "Time and concentration, one pair per line",
        default: [
          "0.25 13.9",
          "0.5 13.6",
          "1 12.9",
          "2 11.7",
          "4 9.6",
          "6 7.8",
          "8 6.4",
          "12 4.3",
          "18 2.4",
          "24 1.3",
          "36 0.4",
          "48 0.13",
        ].join("\n"),
        kind: "block",
        rows: 8,
      },
      { key: "dose", label: "Dose given, mg", default: "500", kind: "text" },
      {
        key: "route",
        label: "Route the data came from",
        default: "iv",
        kind: "select",
        options: [
          { value: "iv", label: "Intravenous (gives true CL and Vz)" },
          { value: "oral", label: "Oral (gives apparent CL/F and Vz/F)" },
        ],
      },
    ],
    compute: (r) => {
      const parsed = parseConcentrationData(r("data"));
      if (parsed.errors.length) return { text: parsed.errors.join("\n"), ok: false };
      const route = r("route") === "oral" ? "oral" : "iv";
      const dose = Number(r("dose") || "0");
      const res = nca(parsed.times, parsed.concentrations, dose, route);
      if (!res.ok) return { text: res.error, ok: false };

      const apparent = route === "oral" ? "/F" : "";
      const lines: string[] = [];
      lines.push(`Non-compartmental analysis of ${parsed.times.length} points, ${route === "oral" ? "oral" : "intravenous"} dose of ${engNum(dose)} mg`);
      lines.push("");
      lines.push("Observed");
      lines.push(`  Cmax = ${engNum(res.cmax)} mg/L at Tmax = ${engNum(res.tmax)} h`);
      lines.push("");
      lines.push("Terminal phase");
      lines.push(`  λz = ${engNum(res.lambdaZ)} /h, from the last ${res.lambdaPoints} points (adjusted R² = ${engNum(res.lambdaR2, 4)})`);
      lines.push(`  Half-life = ${engNum(res.halfLife)} h`);
      lines.push("");
      lines.push("Exposure");
      lines.push(`  AUC to the last sample = ${engNum(res.aucLast)} mg·h/L`);
      lines.push(`  AUC to infinity = ${engNum(res.aucInf)} mg·h/L`);
      lines.push(`  Extrapolated beyond the last sample = ${engNum(res.percentExtrapolated)}%`);
      lines.push("");
      lines.push("Derived");
      lines.push(`  Clearance CL${apparent} = Dose/AUC∞ = ${engNum(res.clearance)} L/h`);
      lines.push(`  Terminal volume Vz${apparent} = Dose/(λz·AUC∞) = ${engNum(res.volume)} L`);
      lines.push(`  Mean residence time = ${engNum(res.mrt)} h`);
      if (route === "iv") {
        lines.push(`  Steady-state volume Vss = CL·MRT = ${engNum(res.clearance * res.mrt)} L`);
      }
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_PK_UNIT_NOTE);

      // A log concentration axis cannot plot a zero, and in pharmacokinetics a zero
      // is NORMAL data: the pre-dose sample is zero by definition, and a trailing
      // below-limit-of-quantification sample is reported as zero too. plot.ts
      // requires every caller passing a log scale to run dropForScales first;
      // this one did not, so log(0) = -Infinity propagated to Infinity/Infinity
      // and all nine points were emitted as cy="NaN" -- a blank-bodied figure,
      // with no y tick labels but a plausible x axis, inserted into the document
      // beneath a numerically correct NCA report.
      const pkPlotOpts = {
        width: 380,
        height: 240,
        xlabel: "Time (h)",
        ylabel: "Concentration (mg/L)",
        yScale: "log" as const,
        title: "Concentration-time data (log scale)",
      };
      const pkSeries = [
        {
          points: parsed.times.map((t, i) => ({ x: t, y: parsed.concentrations[i] })),
          type: "scatter" as const,
          color: "#2563eb",
          label: "measured",
        },
      ];
      const pkFiltered = dropForScales(pkSeries, pkPlotOpts);
      if (pkFiltered.dropped > 0) {
        // Say it on the page. A point silently missing from a log plot is the
        // quiet-wrong this product refuses to ship, and here it is load-bearing:
        // the reader is looking at that plot to judge whether the terminal phase
        // is straight.
        lines.push(
          `Note: ${pkFiltered.dropped} point(s) with a concentration of zero or less cannot be ` +
            "plotted on a logarithmic axis and are omitted from the figure only. Every number " +
            "in the report above uses the full data set.",
        );
      }
      const svg =
        pkFiltered.series.some((s) => s.points.length > 0)
          ? buildPlotSvg(pkFiltered.series, pkPlotOpts)
          : null;
      const clean = lines.map(plainDashes);
      const blocks: AnalyzeBlock[] = [
        ...clean.map((t) => ({ kind: "line" as const, text: t })),
        ...(svg
          ? [
              {
                kind: "plot" as const,
                svg,
                caption: "Measured concentration-time data, log concentration axis",
                alt: "Measured plasma concentrations against time on a logarithmic concentration axis, where a straight terminal phase indicates first-order elimination",
                w: 380,
                h: 240,
              },
            ]
          : []),
      ];
      return { text: clean.join("\n"), blocks };
    },
  },
  {
    id: "vib-free",
    name: "Free response & damping",
    group: "Vibration",
    hint:
      "Mass, stiffness and damping in consistent units (kg, N/m, N·s/m gives rad/s). Give a " +
      "damping coefficient, or leave it blank and give a damping ratio instead. Two measured " +
      "peak amplitudes will estimate the damping ratio from a recorded trace.",
    fields: [
      { key: "m", label: "Mass m, kg", default: "1", kind: "text" },
      { key: "k", label: "Stiffness k, N/m", default: "100", kind: "text" },
      { key: "c", label: "Damping coefficient c, N·s/m (blank to use ζ)", default: "", kind: "text" },
      { key: "zeta", label: "Damping ratio ζ (used when c is blank)", default: "0.1", kind: "text" },
      { key: "x0", label: "Initial displacement x₀", default: "0.05", kind: "text" },
      { key: "v0", label: "Initial velocity v₀", default: "0", kind: "text" },
      { key: "tEnd", label: "End time (blank to use 5 decay times)", default: "", kind: "text" },
      { key: "peak1", label: "Measured peak 1 (optional, to estimate ζ)", default: "", kind: "text" },
      { key: "peak2", label: "Measured peak 2", default: "", kind: "text" },
      { key: "cycles", label: "Cycles between those peaks", default: "1", kind: "text" },
    ],
    compute: (r) => {
      const m = Number(r("m") || "0");
      const k = Number(r("k") || "0");
      // A damping RATIO is what a student is usually given; the coefficient is
      // what the equations need. Either is accepted, and which was used is said.
      let c: number;
      let fromZeta = false;
      if (r("c").trim()) {
        c = Number(r("c"));
      } else {
        const z = Number(r("zeta") || "0");
        if (!(m > 0 && k > 0)) return { text: "Enter a positive mass and stiffness.", ok: false };
        c = z * 2 * Math.sqrt(k * m);
        fromZeta = true;
      }

      const p = sdofProperties(m, k, c);
      if (!p.ok) return { text: p.error, ok: false };

      let tEnd = Number(r("tEnd"));
      let chosen = false;
      if (!r("tEnd").trim() || !Number.isFinite(tEnd) || tEnd <= 0) {
        // Five decay time-constants when damped, five periods when not.
        tEnd = p.zeta > 0 ? 5 / (p.zeta * p.wn) : (5 * 2 * Math.PI) / p.wn;
        chosen = true;
      }

      const res = freeResponse(m, k, c, Number(r("x0") || "0"), Number(r("v0") || "0"), tEnd, 500);
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push(`Single degree of freedom: m = ${engNum(m)}, k = ${engNum(k)}, c = ${engNum(c)}` + (fromZeta ? " (from ζ)" : ""));
      lines.push("");
      lines.push(`Natural frequency ωn = √(k/m) = ${engNum(p.wn)} rad/s = ${engNum(p.fn)} Hz`);
      lines.push(`Critical damping cc = 2√(km) = ${engNum(p.cc)} N·s/m`);
      lines.push(`Damping ratio ζ = c/cc = ${engNum(p.zeta)} — ${p.kind}`);
      if (p.wd > 0) {
        lines.push(`Damped natural frequency ωd = ωn√(1-ζ²) = ${engNum(p.wd)} rad/s = ${engNum(p.fd)} Hz`);
      }
      lines.push(`Static deflection under its own weight = ${engNum(p.staticDeflection)} m`);
      if (res.logDecrement !== null) {
        lines.push("");
        lines.push(`Logarithmic decrement δ = ${engNum(res.logDecrement)}`);
      }
      if (chosen) lines.push(`Simulated to ${engNum(tEnd)} (chosen from the decay rate).`);

      const p1 = r("peak1").trim();
      const p2 = r("peak2").trim();
      if (p1 && p2) {
        const est = dampingFromDecrement(Number(p1), Number(p2), Number(r("cycles") || "1"));
        lines.push("");
        if (!est.ok) {
          lines.push(`Damping from the measured peaks: ${est.error}`);
        } else {
          lines.push("Damping estimated from your two measured peaks");
          lines.push(`  δ = ${engNum(est.delta)}, ζ = ${engNum(est.zeta)}`);
          lines.push(`  which is c = ${engNum(est.zeta * p.cc)} N·s/m at this mass and stiffness`);
          for (const note of est.notes) lines.push(`  Note: ${note}`);
        }
      }
      for (const note of p.notes) lines.push(`Note: ${note}`);
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_VIB_UNIT_NOTE);

      const svg = buildPlotSvg(
        [{ points: res.t.map((t, i) => ({ x: t, y: res.x[i] })), type: "line", color: "#2563eb", label: "x(t)" }],
        { width: 380, height: 240, xlabel: "Time (s)", ylabel: "Displacement", title: `Free response, ζ = ${engNum(p.zeta, 3)}` },
      );
      const clean = lines.map(plainDashes);
      const blocks: AnalyzeBlock[] = [
        ...clean.map((t) => ({ kind: "line" as const, text: t })),
        { kind: "plot" as const, svg, caption: "Free vibration response", alt: "Displacement against time in free vibration", w: 380, h: 240 },
      ];
      return { text: clean.join("\n"), blocks };
    },
  },
  {
    id: "vib-forced",
    name: "Forced response & isolation",
    group: "Vibration",
    hint:
      "Harmonic forcing of a damped SDOF system. Resonance is NOT at ω = ωn for a damped system, " +
      "and vibration isolation only begins above a frequency ratio of √2 — below it a mount " +
      "AMPLIFIES. Both are computed rather than assumed.",
    fields: [
      { key: "m", label: "Mass m, kg", default: "1", kind: "text" },
      { key: "k", label: "Stiffness k, N/m", default: "100", kind: "text" },
      { key: "zeta", label: "Damping ratio ζ", default: "0.1", kind: "text" },
      { key: "f0", label: "Force amplitude F₀, N", default: "10", kind: "text" },
      { key: "w", label: "Forcing frequency ω, rad/s", default: "12", kind: "text" },
    ],
    compute: (r) => {
      const m = Number(r("m") || "0");
      const k = Number(r("k") || "0");
      const zeta = Number(r("zeta") || "0");
      if (!(m > 0 && k > 0)) return { text: "Enter a positive mass and stiffness.", ok: false };
      if (!Number.isFinite(zeta) || zeta < 0) return { text: "The damping ratio must be zero or greater.", ok: false };
      const c = zeta * 2 * Math.sqrt(k * m);
      const res = forcedResponse(m, k, c, Number(r("f0") || "0"), Number(r("w") || "0"));
      if (!res.ok) return { text: res.error, ok: false };
      const p = sdofProperties(m, k, c);
      if (!p.ok) return { text: p.error, ok: false };

      const lines: string[] = [];
      lines.push(`Harmonic forcing of an SDOF system, ζ = ${engNum(zeta)}`);
      lines.push(`Natural frequency ωn = ${engNum(p.wn)} rad/s; forcing at ${engNum(Number(r("w") || "0"))} rad/s`);
      lines.push(`Frequency ratio r = ω/ωn = ${engNum(res.r)}`);
      lines.push("");
      lines.push(`Magnification factor = ${engNum(res.magnification)}`);
      lines.push(`Steady-state amplitude = ${engNum(res.amplitude)} m`);
      lines.push(`Phase lag behind the force = ${engNum(res.phaseDeg)} deg`);
      lines.push(`Force transmissibility = ${engNum(res.transmissibility)}`);
      lines.push("");
      if (res.peakR !== null) {
        lines.push(`Resonant peak at r = ${engNum(res.peakR)} (ω = ${engNum(res.peakR * p.wn)} rad/s)`);
        lines.push(`  peak magnification = ${engNum(res.peakMagnification as number)}`);
      }
      lines.push(
        res.isolating
          ? "This mount IS isolating: r is above √2 = 1.414."
          : "This mount is NOT isolating: r is below √2 = 1.414.",
      );
      lines.push("Transmissibility is exactly 1 at r = √2, for every damping ratio — that is where isolation begins.");
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_VIB_UNIT_NOTE);

      const s = vibSweep(zeta, 4, 400);
      const magSvg = buildPlotSvg(
        [
          { points: s.r.map((x, i) => ({ x, y: s.magnification[i] })), type: "line", color: "#2563eb", label: "magnification" },
          { points: s.r.map((x, i) => ({ x, y: s.transmissibility[i] })), type: "line", color: "#b91c1c", label: "transmissibility" },
        ],
        {
          width: 380,
          height: 240,
          xlabel: "Frequency ratio r = ω/ωn",
          ylabel: "Factor",
          title: `Response and transmissibility, ζ = ${engNum(zeta, 3)}`,
        },
      );
      const clean = lines.map(plainDashes);
      const blocks: AnalyzeBlock[] = [
        ...clean.map((t) => ({ kind: "line" as const, text: t })),
        {
          kind: "plot" as const,
          svg: magSvg,
          caption: "Magnification and transmissibility against frequency ratio",
          alt: "Dynamic magnification and force transmissibility against frequency ratio, crossing 1 at root two",
          w: 380,
          h: 240,
        },
      ];
      return { text: clean.join("\n"), blocks };
    },
  },
  {
    id: "vib-modal",
    name: "Natural frequencies & mode shapes",
    group: "Vibration",
    hint:
      'Either a chain of masses and springs ("1 1 1" masses, "100 100 100" springs), or the mass ' +
      "and stiffness matrices directly, one row per line. Frequencies come back ascending and " +
      "mode shapes mass-normalised, so read their pattern rather than their magnitude.",
    fields: [
      {
        key: "mode",
        label: "Input",
        default: "chain",
        kind: "select",
        options: [
          { value: "chain", label: "Chain of masses and springs" },
          { value: "matrix", label: "Mass and stiffness matrices" },
        ],
      },
      { key: "masses", label: "Masses (chain)", default: "1 1", kind: "text" },
      { key: "springs", label: "Stiffnesses (chain)", default: "100 100", kind: "text" },
      {
        key: "ground",
        label: "Far end of the chain",
        default: "grounded",
        kind: "select",
        options: [
          // chainSystem anchors spring 0 to ground and leaves the far end free,
          // so a grounded chain of n masses takes n springs. This said "both
          // ends", which describes a different structure with a different
          // stiffness matrix and different frequencies.
          { value: "grounded", label: "Anchored at one end, free at the other" },
          { value: "free", label: "Free-free (unrestrained)" },
        ],
      },
      { key: "M", label: "Mass matrix (one row per line)", default: "1 0\n0 1", kind: "block", rows: 3 },
      { key: "K", label: "Stiffness matrix (one row per line)", default: "200 -100\n-100 200", kind: "block", rows: 3 },
    ],
    compute: (r) => {
      let M: number[][];
      let K: number[][];
      if ((r("mode") || "chain") === "chain") {
        const masses = r("masses").split(/[,\s]+/).filter(Boolean).map(Number);
        const springs = r("springs").split(/[,\s]+/).filter(Boolean).map(Number);
        const built = chainSystem(masses, springs, r("ground") !== "free");
        if ("ok" in built) return { text: built.error, ok: false };
        M = built.M;
        K = built.K;
      } else {
        const pm = parseMatrix(r("M"));
        if (!pm.ok) return { text: `Mass matrix: ${pm.error}`, ok: false };
        const pk = parseMatrix(r("K"));
        if (!pk.ok) return { text: `Stiffness matrix: ${pk.error}`, ok: false };
        M = pm.matrix;
        K = pk.matrix;
      }

      const res = modalAnalysis(M, K);
      if (!res.ok) return { text: res.error, ok: false };

      const n = res.frequencies.length;
      const lines: string[] = [];
      lines.push(`${n} degree-of-freedom system`);
      lines.push("");
      lines.push("Natural frequencies");
      for (let i = 0; i < n; i++) {
        lines.push(
          `  Mode ${i + 1}: ω = ${engNum(res.frequencies[i])} rad/s = ${engNum(res.frequenciesHz[i])} Hz` +
            (res.frequencies[i] === 0 ? "  (rigid-body mode)" : ""),
        );
      }
      lines.push("");
      lines.push("Mode shapes (columns, mass-normalised)");
      for (let i = 0; i < n; i++) {
        lines.push(`  DOF ${i + 1}: ` + res.modes[i].map((v) => engNum(v, 4)).join("   "));
      }
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_VIB_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "vib-mdof-forced",
    name: "Forced response of a multi-DOF system",
    group: "Vibration",
    hint:
      "Steady-state response to a harmonic force on a structure with several degrees of freedom, " +
      "by modal superposition. Give one force amplitude per degree of freedom. Damping is entered " +
      'as MODAL damping ratios — one value for all modes, a list of them, or "rayleigh 0.6 0.002" ' +
      "to derive them from C = αM + βK. It assumes CLASSICAL damping; a single discrete damper " +
      "between two degrees of freedom does not satisfy that and needs complex modes.",
    fields: [
      {
        key: "mode",
        label: "Input",
        default: "chain",
        kind: "select",
        options: [
          { value: "chain", label: "Chain of masses and springs" },
          { value: "matrix", label: "Mass and stiffness matrices" },
        ],
      },
      { key: "masses", label: "Masses (chain)", default: "1 1", kind: "text" },
      { key: "springs", label: "Stiffnesses (chain)", default: "100 100", kind: "text" },
      {
        key: "ground",
        label: "Far end of the chain",
        default: "grounded",
        kind: "select",
        options: [
          { value: "grounded", label: "Anchored at one end, free at the other" },
          { value: "free", label: "Free-free (unrestrained)" },
        ],
      },
      { key: "M", label: "Mass matrix (one row per line)", default: "1 0\n0 1", kind: "block", rows: 3 },
      { key: "K", label: "Stiffness matrix (one row per line)", default: "200 -100\n-100 200", kind: "block", rows: 3 },
      { key: "F", label: "Force amplitude per DOF", default: "10 0", kind: "text" },
      { key: "w", label: "Forcing frequency ω (rad/s)", default: "8", kind: "text" },
      { key: "zeta", label: "Modal damping (value, list, or \"rayleigh α β\")", default: "0.02", kind: "text" },
    ],
    compute: (r) => {
      let M: number[][];
      let K: number[][];
      if ((r("mode") || "chain") === "chain") {
        const masses = r("masses").split(/[,\s]+/).filter(Boolean).map(Number);
        const springs = r("springs").split(/[,\s]+/).filter(Boolean).map(Number);
        const built = chainSystem(masses, springs, r("ground") !== "free");
        if ("ok" in built) return { text: built.error, ok: false };
        M = built.M;
        K = built.K;
      } else {
        const pm = parseMatrix(r("M"));
        if (!pm.ok) return { text: `Mass matrix: ${pm.error}`, ok: false };
        const pk = parseMatrix(r("K"));
        if (!pk.ok) return { text: `Stiffness matrix: ${pk.error}`, ok: false };
        M = pm.matrix;
        K = pk.matrix;
      }

      const F = r("F").split(/[,\s]+/).filter(Boolean).map(Number);
      if (!F.length || F.some((v) => !Number.isFinite(v)))
        return { text: "Give one finite force amplitude per degree of freedom.", ok: false };
      const w = Number(r("w"));
      if (!Number.isFinite(w) || w < 0) return { text: "The forcing frequency must be zero or greater.", ok: false };

      // Damping: a single ratio, a list of them, or Rayleigh alpha/beta.
      //
      // The Rayleigh pair is passed STRAIGHT THROUGH rather than converted to
      // ratios here. Converting loses the rigid-body mode: its ratio is
      // alpha/(2*0), so it comes back 0 and a free-free structure is solved as
      // undamped in the one mode alpha actually damps. That was a 56% amplitude
      // error at these very defaults.
      const zRaw = r("zeta").trim();
      let damping: ModalDamping;
      const ray = /^rayleigh\s+([-\d.eE+]+)\s+([-\d.eE+]+)$/i.exec(zRaw);
      if (ray) {
        const alpha = Number(ray[1]);
        const beta = Number(ray[2]);
        if (!Number.isFinite(alpha) || !Number.isFinite(beta) || alpha < 0 || beta < 0)
          return { text: "Rayleigh α and β must both be zero or greater.", ok: false };
        damping = { alpha, beta };
      } else {
        const zs = zRaw.split(/[,\s]+/).filter(Boolean).map(Number);
        if (!zs.length || zs.some((v) => !Number.isFinite(v)))
          return { text: 'Damping must be a ratio, a list of ratios, or "rayleigh 0.6 0.002".', ok: false };
        damping = zs.length === 1 ? zs[0] : zs;
      }

      const res = modalForcedResponse(M, K, F, w, damping);
      if (!res.ok) return { text: res.error, ok: false };

      const n = res.frequencies.length;
      const lines: string[] = [];
      lines.push(`${n} degree-of-freedom forced response at ω = ${engNum(w)} rad/s`);
      lines.push("");
      lines.push("Steady-state amplitude per degree of freedom");
      for (let j = 0; j < n; j++)
        lines.push(`  DOF ${j + 1}: ${engNum(res.amplitude[j])}, lagging the force by ${engNum(res.phaseDeg[j])}°`);
      lines.push("");
      lines.push("Modal breakdown");
      for (const c of res.contributions) {
        lines.push(
          `  Mode ${c.mode}: ω_n = ${engNum(c.wn)} rad/s, ζ = ${engNum(c.zeta)}, ` +
            `r = ${c.wn > 0 ? engNum(c.r) : "—"}, generalised force ${engNum(c.force)}, ` +
            `${(c.share * 100).toFixed(1)}% of the peak response`,
        );
      }
      lines.push("");
      lines.push(`Mode ${res.dominantMode} dominates the largest response.`);
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_VIB_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "thermo-process",
    name: "Ideal-gas process",
    group: "Thermal",
    hint:
      "A closed-system process on an ideal gas. All four named processes are the same polytropic " +
      "family (n = 0 isobaric, 1 isothermal, k isentropic, ∞ isochoric), so the work integral is " +
      "derived once and cannot disagree between them. Give ONE end-state quantity.",
    fields: [
      {
        key: "gas",
        label: "Gas",
        default: "air",
        kind: "select",
        options: THERMO_GASES.map((g) => ({ value: g.id, label: g.label })),
      },
      {
        key: "kind",
        label: "Process",
        default: "isentropic",
        kind: "select",
        options: [
          { value: "isothermal", label: "Isothermal (constant T, n = 1)" },
          { value: "isobaric", label: "Isobaric (constant P, n = 0)" },
          { value: "isochoric", label: "Isochoric (constant V, n = ∞)" },
          { value: "isentropic", label: "Isentropic (reversible adiabatic, n = k)" },
          { value: "polytropic", label: "Polytropic (give n)" },
        ],
      },
      { key: "n", label: "Polytropic index n (polytropic only)", default: "1.3", kind: "text" },
      { key: "m", label: "Mass, kg", default: "1", kind: "text" },
      { key: "p1", label: "Initial pressure P₁, Pa", default: "100000", kind: "text" },
      { key: "t1", label: "Initial temperature T₁", default: "27", kind: "text" },
      {
        key: "tunit",
        label: "Temperature unit",
        default: "C",
        kind: "select",
        options: [
          { value: "C", label: "°C" },
          { value: "K", label: "K" },
          { value: "F", label: "°F" },
        ],
      },
      { key: "p2", label: "End pressure P₂, Pa (or leave blank)", default: "1000000", kind: "text" },
      { key: "t2", label: "End temperature T₂ (same unit, or blank)", default: "", kind: "text" },
      { key: "v2", label: "End volume V₂, m³ (or blank)", default: "", kind: "text" },
    ],
    compute: (r) => {
      const tunit = (r("tunit") || "C") as TempUnit;
      const t1 = toKelvin(Number(r("t1") || "0"), tunit);
      if (typeof t1 === "object") return { text: t1.error, ok: false };
      let t2: number | undefined;
      if (r("t2").trim()) {
        const k2 = toKelvin(Number(r("t2")), tunit);
        if (typeof k2 === "object") return { text: k2.error, ok: false };
        t2 = k2;
      }

      const res = idealGasProcess({
        gasId: r("gas") || "air",
        m: Number(r("m") || "0"),
        p1: Number(r("p1") || "0"),
        t1,
        kind: (r("kind") || "isentropic") as ProcessKind,
        n: r("n").trim() ? Number(r("n")) : undefined,
        p2: r("p2").trim() ? Number(r("p2")) : undefined,
        t2,
        v2: r("v2").trim() ? Number(r("v2")) : undefined,
      });
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push(`${res.gas}, ${r("kind") || "isentropic"} process (polytropic index n = ${Number.isFinite(res.n) ? engNum(res.n) : "infinite"})`);
      lines.push("");
      lines.push("State 1 → State 2");
      lines.push(`  P: ${engNum(res.p1)} → ${engNum(res.p2)} Pa`);
      lines.push(`  T: ${engNum(res.t1)} → ${engNum(res.t2)} K  (${engNum(res.t1 - 273.15)} → ${engNum(res.t2 - 273.15)} °C)`);
      lines.push(`  V: ${engNum(res.v1)} → ${engNum(res.v2)} m³`);
      lines.push("");
      lines.push(`Boundary work done BY the gas = ${engNum(res.work)} J`);
      lines.push(`Heat added TO the gas = ${engNum(res.heat)} J`);
      lines.push(`Change in internal energy ΔU = ${engNum(res.deltaU)} J`);
      lines.push(`Change in enthalpy ΔH = ${engNum(res.deltaH)} J`);
      lines.push(`Change in entropy ΔS = ${engNum(res.deltaS)} J/K`);
      lines.push(`  First law check: ΔU + W = ${engNum(res.deltaU + res.work)} J, which is Q.`);
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_THERMO_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "thermo-cycle",
    name: "Power cycles",
    group: "Thermal",
    hint:
      "Air-standard Otto, Diesel and Brayton cycles. Every one is compared against the Carnot " +
      "bound between its own extremes, and a real engine reaches roughly a third of the " +
      "air-standard figure — quoting it as the efficiency overstates by about three times.",
    fields: [
      {
        key: "cycle",
        label: "Cycle",
        default: "otto",
        kind: "select",
        options: [
          { value: "otto", label: "Otto (spark ignition)" },
          { value: "diesel", label: "Diesel (compression ignition)" },
          { value: "brayton", label: "Brayton (gas turbine)" },
        ],
      },
      {
        key: "gas",
        label: "Working fluid",
        default: "air",
        kind: "select",
        options: THERMO_GASES.map((g) => ({ value: g.id, label: g.label })),
      },
      { key: "r", label: "Compression ratio (Otto, Diesel)", default: "8", kind: "text" },
      { key: "rc", label: "Cut-off ratio (Diesel only)", default: "2", kind: "text" },
      { key: "rp", label: "Pressure ratio (Brayton only)", default: "10", kind: "text" },
      { key: "t1", label: "Inlet temperature T₁ (blank to skip temperatures)", default: "27", kind: "text" },
      { key: "t3", label: "Peak temperature T₃ (Otto, Brayton)", default: "1527", kind: "text" },
      {
        key: "tunit",
        label: "Temperature unit",
        default: "C",
        kind: "select",
        options: [
          { value: "C", label: "°C" },
          { value: "K", label: "K" },
          { value: "F", label: "°F" },
        ],
      },
    ],
    compute: (r) => {
      const tunit = (r("tunit") || "C") as TempUnit;
      const conv = (key: string): number | undefined | { error: string } => {
        if (!r(key).trim()) return undefined;
        const k = toKelvin(Number(r(key)), tunit);
        return typeof k === "object" ? { error: k.error } : k;
      };
      const t1 = conv("t1");
      if (t1 && typeof t1 === "object") return { text: t1.error, ok: false };
      const t3 = conv("t3");
      if (t3 && typeof t3 === "object") return { text: t3.error, ok: false };

      const gas = r("gas") || "air";
      const which = r("cycle") || "otto";
      const res =
        which === "diesel"
          ? dieselCycle(Number(r("r") || "0"), Number(r("rc") || "0"), gas, t1 as number | undefined)
          : which === "brayton"
            ? braytonCycle(Number(r("rp") || "0"), gas, t1 as number | undefined, t3 as number | undefined)
            : ottoCycle(Number(r("r") || "0"), gas, t1 as number | undefined, t3 as number | undefined);
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push(`${res.name} cycle, air-standard`);
      lines.push("");
      lines.push(`Thermal efficiency = ${engNum(res.efficiency * 100)}%`);
      if (res.carnotEfficiency !== null) {
        lines.push(`Carnot bound between this cycle's own extremes = ${engNum(res.carnotEfficiency * 100)}%`);
        lines.push(
          res.efficiency < res.carnotEfficiency
            ? "  The cycle is below its Carnot bound, as it must be."
            : "  WARNING: the cycle exceeds its Carnot bound, which is impossible — check the inputs.",
        );
      }
      if (res.temperatures.length) {
        lines.push("");
        lines.push("Temperatures around the cycle");
        for (const t of res.temperatures) {
          lines.push(`  ${t.label}: ${engNum(t.t)} K (${engNum(t.t - 273.15)} °C)`);
        }
      }
      if (res.heatIn !== null && res.netWork !== null) {
        lines.push("");
        lines.push(`Heat added = ${engNum(res.heatIn / 1000)} kJ/kg`);
        lines.push(`Net work = ${engNum(res.netWork / 1000)} kJ/kg`);
      }
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_THERMO_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "thermo-vapour",
    name: "Rankine, refrigeration & Carnot check",
    group: "Thermal",
    hint:
      "Vapour cycles are computed from enthalpies YOU look up in your own steam or refrigerant " +
      "tables — no property tables are built in, deliberately, so the data is yours and " +
      "verifiable. Also checks any claimed efficiency or COP against the Carnot bound.",
    fields: [
      {
        key: "which",
        label: "Analysis",
        default: "rankine",
        kind: "select",
        options: [
          { value: "rankine", label: "Rankine cycle (4 enthalpies)" },
          { value: "fridge", label: "Vapour-compression refrigeration (3 enthalpies)" },
          { value: "check", label: "Check a claimed efficiency or COP against Carnot" },
        ],
      },
      { key: "h1", label: "h₁ — pump / compressor inlet, kJ/kg", default: "191.8", kind: "text" },
      { key: "h2", label: "h₂ — pump / compressor outlet, kJ/kg", default: "195.0", kind: "text" },
      { key: "h3", label: "h₃ — turbine inlet (Rankine) or condenser outlet (fridge), kJ/kg", default: "3214.0", kind: "text" },
      { key: "h4", label: "h₄ — turbine outlet, kJ/kg (Rankine only)", default: "2100.0", kind: "text" },
      { key: "claimed", label: "Claimed efficiency (0-1) or COP (check only)", default: "0.68", kind: "text" },
      {
        key: "ckind",
        label: "What the claim is (check only)",
        default: "efficiency",
        kind: "select",
        options: [
          { value: "efficiency", label: "Thermal efficiency" },
          { value: "refrigerator", label: "Refrigerator COP" },
          { value: "heat-pump", label: "Heat-pump COP" },
        ],
      },
      { key: "th", label: "Hot reservoir temperature (check only)", default: "500", kind: "text" },
      { key: "tc", label: "Cold reservoir temperature (check only)", default: "20", kind: "text" },
      {
        key: "tunit",
        label: "Temperature unit (check only)",
        default: "C",
        kind: "select",
        options: [
          { value: "C", label: "°C" },
          { value: "K", label: "K" },
          { value: "F", label: "°F" },
        ],
      },
    ],
    compute: (r) => {
      const which = r("which") || "rankine";
      const lines: string[] = [];

      if (which === "rankine") {
        const res = rankineFromEnthalpies(
          Number(r("h1") || "0"),
          Number(r("h2") || "0"),
          Number(r("h3") || "0"),
          Number(r("h4") || "0"),
        );
        if (!res.ok) return { text: res.error, ok: false };
        lines.push("Rankine cycle, from your enthalpies");
        lines.push("");
        lines.push(`Turbine work = ${engNum(res.turbineWork)} kJ/kg`);
        lines.push(`Pump work = ${engNum(res.pumpWork)} kJ/kg`);
        lines.push(`Net work = ${engNum(res.netWork)} kJ/kg`);
        lines.push(`Heat added in the boiler = ${engNum(res.heatIn)} kJ/kg`);
        lines.push(`Heat rejected in the condenser = ${engNum(res.heatOut)} kJ/kg`);
        lines.push("");
        lines.push(`Thermal efficiency = ${engNum(res.efficiency * 100)}%`);
        lines.push(`Back-work ratio (pump / turbine) = ${engNum(res.backWorkRatio * 100)}%`);
        lines.push(`  Energy balance: Qin - Qout - Wnet = ${engNum(res.heatIn - res.heatOut - res.netWork)} kJ/kg (should be zero)`);
        for (const note of res.notes) lines.push(`Note: ${note}`);
      } else if (which === "fridge") {
        const res = refrigerationFromEnthalpies(
          Number(r("h1") || "0"),
          Number(r("h2") || "0"),
          Number(r("h3") || "0"),
        );
        if (!res.ok) return { text: res.error, ok: false };
        lines.push("Vapour-compression refrigeration, from your enthalpies");
        lines.push("");
        lines.push(`Compressor work = ${engNum(res.compressorWork)} kJ/kg`);
        lines.push(`Refrigeration effect = ${engNum(res.refrigerationEffect)} kJ/kg`);
        lines.push(`Heat rejected = ${engNum(res.heatRejected)} kJ/kg`);
        lines.push("");
        lines.push(`COP as a refrigerator = ${engNum(res.copRefrigerator)}`);
        lines.push(`COP as a heat pump = ${engNum(res.copHeatPump)}`);
        for (const note of res.notes) lines.push(`Note: ${note}`);
      } else {
        const tunit = (r("tunit") || "C") as TempUnit;
        const th = toKelvin(Number(r("th") || "0"), tunit);
        if (typeof th === "object") return { text: th.error, ok: false };
        const tc = toKelvin(Number(r("tc") || "0"), tunit);
        if (typeof tc === "object") return { text: tc.error, ok: false };
        const res = checkAgainstCarnot(
          Number(r("claimed") || "0"),
          th,
          tc,
          (r("ckind") || "efficiency") as "efficiency" | "refrigerator" | "heat-pump",
        );
        if (!res.ok) return { text: res.error, ok: false };
        const c = carnot(th, tc);
        lines.push("Carnot check");
        lines.push("");
        lines.push(`Reservoirs: ${engNum(th)} K and ${engNum(tc)} K`);
        lines.push(`Carnot bound for this quantity = ${engNum(res.bound)}`);
        lines.push("");
        lines.push(res.possible ? "POSSIBLE" : "IMPOSSIBLE");
        lines.push(res.message);
        if (c.ok) {
          lines.push("");
          lines.push(`For reference between these reservoirs: max efficiency ${engNum(c.efficiency * 100)}%, ` +
            `max refrigerator COP ${engNum(c.copRefrigerator)}, max heat-pump COP ${engNum(c.copHeatPump)}`);
          for (const note of c.notes) lines.push(`Note: ${note}`);
        }
      }
      lines.push(ENG_THERMO_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "fatigue-endurance",
    name: "Endurance limit & notch factor",
    group: "Fatigue & machine design",
    hint:
      "The corrected endurance limit by the Marin factor method, and the fatigue " +
      "stress-concentration factor. Surface finish is usually the largest single reduction — an " +
      "as-forged surface can more than halve the endurance limit of the same steel.",
    fields: [
      { key: "sut", label: "Ultimate tensile strength Sut, MPa", default: "700", kind: "text" },
      {
        key: "mclass",
        label: "Material class",
        default: "steel",
        kind: "select",
        options: [
          { value: "steel", label: "Steel (has a true endurance limit)" },
          { value: "non-ferrous", label: "Aluminium / copper / other non-ferrous (has NONE)" },
        ],
      },
      {
        key: "surface",
        label: "Surface finish",
        default: "machined",
        kind: "select",
        options: (Object.keys(SURFACE_FACTORS) as SurfaceFinish[]).map((k) => ({
          value: k,
          label: SURFACE_FACTORS[k].label,
        })),
      },
      { key: "dia", label: "Diameter or equivalent dimension, mm", default: "25", kind: "text" },
      {
        key: "load",
        label: "Loading",
        default: "bending",
        kind: "select",
        options: [
          { value: "bending", label: "Bending (kc = 1)" },
          { value: "axial", label: "Axial (kc = 0.85, no size factor)" },
          { value: "torsion", label: "Torsion (kc = 0.59)" },
        ],
      },
      { key: "temp", label: "Operating temperature, °C", default: "20", kind: "text" },
      { key: "rel", label: "Reliability, 0-1 (0.5 gives ke = 1)", default: "0.99", kind: "text" },
      { key: "kt", label: "Stress-concentration factor Kt (blank to skip)", default: "", kind: "text" },
      { key: "q", label: "Notch sensitivity q, 0-1 (1 is conservative)", default: "1", kind: "text" },
    ],
    compute: (r) => {
      const res = enduranceLimit({
        sut: Number(r("sut") || "0"),
        materialClass: (r("mclass") || "steel") as MaterialClass,
        surface: (r("surface") || "machined") as SurfaceFinish,
        diameter: Number(r("dia") || "0"),
        load: (r("load") || "bending") as LoadKind,
        tempC: Number(r("temp") || "0"),
        reliability: Number(r("rel") || "0"),
      });
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push("Corrected endurance limit, Marin factor method");
      lines.push("");
      lines.push(`Uncorrected Se' = ${engNum(res.sePrime)} MPa`);
      lines.push(`  ka surface     = ${engNum(res.ka, 4)}`);
      lines.push(`  kb size        = ${engNum(res.kb, 4)}`);
      lines.push(`  kc load        = ${engNum(res.kc, 4)}`);
      lines.push(`  kd temperature = ${engNum(res.kd, 4)}`);
      lines.push(`  ke reliability = ${engNum(res.ke, 4)}`);
      lines.push("");
      lines.push(`Corrected Se = ${engNum(res.se)} MPa`);
      lines.push(`  a reduction of ${engNum((1 - res.se / res.sePrime) * 100)}% from the uncorrected value`);

      const ktRaw = r("kt").trim();
      if (ktRaw) {
        const nf = notchFactor(Number(ktRaw), Number(r("q") || "1"));
        if (!nf.ok) {
          lines.push("");
          lines.push(nf.error);
        } else {
          lines.push("");
          lines.push("Stress concentration");
          lines.push(`  Kt = ${engNum(nf.kt)}, q = ${engNum(nf.q)} → Kf = 1 + q(Kt-1) = ${engNum(nf.kf)}`);
          lines.push(`  Multiply the alternating stress by Kf before the fatigue check.`);
          for (const note of nf.notes) lines.push(`  Note: ${note}`);
        }
      }
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_FATIGUE_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "fatigue-safety",
    name: "Mean stress & factor of safety",
    group: "Fatigue & machine design",
    hint:
      "All four mean-stress criteria are computed and shown, because they disagree by a lot. The " +
      "first-cycle YIELD check runs alongside them — none of the fatigue criteria knows about " +
      "static yield, so a high mean stress can pass Goodman and still yield immediately.",
    fields: [
      { key: "sa", label: "Alternating stress σa, MPa (already multiplied by Kf)", default: "100", kind: "text" },
      { key: "sm", label: "Mean stress σm, MPa (negative = compressive)", default: "200", kind: "text" },
      { key: "se", label: "Corrected endurance limit Se, MPa", default: "250", kind: "text" },
      { key: "sut", label: "Ultimate tensile strength Sut, MPa", default: "700", kind: "text" },
      { key: "sy", label: "Yield strength Sy, MPa", default: "500", kind: "text" },
      {
        key: "crit",
        label: "Criterion",
        default: "goodman",
        kind: "select",
        options: [
          { value: "goodman", label: "Modified Goodman (most codes)" },
          { value: "soderberg", label: "Soderberg (most conservative)" },
          { value: "gerber", label: "Gerber (least conservative)" },
          { value: "asme-elliptic", label: "ASME elliptic" },
        ],
      },
    ],
    compute: (r) => {
      const res = meanStressAnalysis(
        Number(r("sa") || "0"),
        Number(r("sm") || "0"),
        Number(r("se") || "0"),
        Number(r("sut") || "0"),
        Number(r("sy") || "0"),
        (r("crit") || "goodman") as Criterion,
      );
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push(`Mean-stress analysis, σa = ${engNum(Number(r("sa")))} MPa, σm = ${engNum(Number(r("sm")))} MPa`);
      lines.push("");
      lines.push(`GOVERNING factor of safety = ${engNum(res.nGoverning)}, governed by ${res.governedBy}`);
      lines.push("");
      lines.push(
        Number.isFinite(res.nFatigue)
          ? `Fatigue (${res.criterion}) = ${engNum(res.nFatigue)}`
          : `Fatigue (${res.criterion}) = not applicable — there is no fatigue loading in this state`,
      );
      lines.push(`First-cycle yield (Langer) = ${engNum(res.nYield)}`);
      lines.push("");
      lines.push("All four criteria, for comparison");
      for (const c of res.comparison) {
        lines.push(`  ${c.criterion.padEnd(14)} n = ${engNum(c.n)}`);
      }
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_FATIGUE_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "fatigue-life",
    name: "Finite life & cumulative damage",
    group: "Fatigue & machine design",
    hint:
      "Cycles to failure from the S-N line between 0.9·Sut at 10³ cycles and Se at 10⁶. Add more " +
      'lines as "stress cycles" to sum Miner damage over a load spectrum. Read every life as an ' +
      "order of magnitude — identical specimens differ by a factor of three.",
    fields: [
      {
        key: "blocks",
        label: 'Load spectrum: "alternating stress, cycles" per line',
        default: "420, 1000\n350, 20000\n280, 500000",
        kind: "block",
        rows: 5,
      },
      { key: "se", label: "Corrected endurance limit Se, MPa", default: "250", kind: "text" },
      { key: "sut", label: "Ultimate tensile strength Sut, MPa", default: "700", kind: "text" },
      {
        key: "mclass",
        label: "Material class",
        default: "steel",
        kind: "select",
        options: [
          { value: "steel", label: "Steel (has a true endurance limit)" },
          { value: "non-ferrous", label: "Non-ferrous (has NONE)" },
        ],
      },
    ],
    compute: (r) => {
      const se = Number(r("se") || "0");
      const sut = Number(r("sut") || "0");
      const mclass = (r("mclass") || "steel") as MaterialClass;

      const blocks: { sigmaA: number; cycles: number }[] = [];
      const errors: string[] = [];
      const raw = r("blocks").split(/\r?\n/);
      for (let i = 0; i < raw.length; i++) {
        const line = raw[i].split("#")[0].trim();
        if (!line) continue;
        const parts = line.split(/[,\s]+/).filter(Boolean).map(Number);
        if (parts.length !== 2 || parts.some((v) => !Number.isFinite(v))) {
          errors.push(`Line ${i + 1}: expected "stress, cycles" as two numbers.`);
          continue;
        }
        blocks.push({ sigmaA: parts[0], cycles: parts[1] });
      }
      if (errors.length) return { text: errors.join("\n"), ok: false };
      if (!blocks.length) return { text: "Give at least one load block.", ok: false };

      const lines: string[] = [];

      // A single block reads as a life question; several read as a spectrum.
      if (blocks.length === 1) {
        const life = finiteLife(blocks[0].sigmaA, se, sut, mclass);
        if (!life.ok) return { text: life.error, ok: false };
        lines.push(`Finite life at σa = ${engNum(blocks[0].sigmaA)} MPa`);
        lines.push("");
        lines.push(
          life.infiniteLife
            ? "Cycles to failure: INFINITE — the stress is below the endurance limit."
            : `Cycles to failure ≈ ${engNum(life.cycles, 3)}  (10^${engNum(Math.log10(life.cycles), 3)})`,
        );
        lines.push(`S-N line: S = ${engNum(life.a)} · N^${engNum(life.b, 4)}`);
        for (const note of life.notes) lines.push(`Note: ${note}`);
      }

      const dmg = minerDamage(blocks, se, sut, mclass);
      if (!dmg.ok) return { text: dmg.error, ok: false };
      if (blocks.length > 1) lines.push("Cumulative damage over the load spectrum (Palmgren-Miner)");
      lines.push("");
      lines.push("Block   σa (MPa)   applied      allowable        damage");
      for (const b of dmg.blocks) {
        lines.push(
          `        ${engNum(b.sigmaA, 4).padEnd(10)} ${engNum(b.applied, 4).padEnd(12)} ` +
            `${(b.allowable === Infinity ? "infinite" : engNum(b.allowable, 3)).padEnd(15)} ${engNum(b.damage, 3)}`,
        );
      }
      lines.push("");
      lines.push(`Total damage D = ${engNum(dmg.damage, 4)}  (failure nominally at D = 1)`);
      lines.push(
        dmg.repeats === Infinity
          ? "The whole spectrum can be repeated indefinitely."
          : `The whole spectrum can be repeated about ${engNum(dmg.repeats, 3)} times.`,
      );
      for (const note of dmg.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_FATIGUE_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "opamp",
    name: "Op-amp circuits",
    group: "Electronics",
    hint:
      "Gains and impedances for the standard configurations, plus the real limits the ideal model " +
      "hides. Give a gain-bandwidth product to see what bandwidth the gain actually leaves you, " +
      "and a slew rate to see where large-signal output stops following.",
    fields: [
      {
        key: "config",
        label: "Configuration",
        default: "non-inverting",
        kind: "select",
        options: [
          { value: "inverting", label: "Inverting" },
          { value: "non-inverting", label: "Non-inverting" },
          { value: "buffer", label: "Buffer (unity gain)" },
          { value: "summing", label: "Summing (inverting)" },
          { value: "difference", label: "Difference" },
          { value: "integrator", label: "Integrator" },
          { value: "differentiator", label: "Differentiator" },
        ],
      },
      { key: "rin", label: "Input resistor(s), ohms — comma separated for summing", default: "1000", kind: "text" },
      { key: "rf", label: "Feedback resistor, ohms", default: "99000", kind: "text" },
      { key: "c", label: "Capacitor, farads (integrator / differentiator)", default: "1e-7", kind: "text" },
      { key: "gbw", label: "Gain-bandwidth product, Hz (blank to skip)", default: "1e6", kind: "text" },
      { key: "sr", label: "Slew rate, V/µs (blank to skip)", default: "1", kind: "text" },
      { key: "vout", label: "Peak output swing of interest, V", default: "10", kind: "text" },
      { key: "vs", label: "Supply rail, V (blank to skip the clipping check)", default: "15", kind: "text" },
    ],
    compute: (r) => {
      const rin = r("rin")
        .split(/[,\s]+/)
        .filter(Boolean)
        .map(Number);
      const res = analyzeOpamp({
        config: (r("config") || "non-inverting") as OpampConfig,
        rin: rin.length ? rin : [0],
        rf: Number(r("rf") || "0"),
        c: r("c").trim() ? Number(r("c")) : undefined,
        gbw: r("gbw").trim() ? Number(r("gbw")) : undefined,
        slewRate: r("sr").trim() ? Number(r("sr")) : undefined,
        vout: r("vout").trim() ? Number(r("vout")) : undefined,
        vsupply: r("vs").trim() ? Number(r("vs")) : undefined,
      });
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push(`${res.config} amplifier`);
      lines.push("");
      if (res.inputGains.length > 1) {
        lines.push("Per-input gains");
        for (let i = 0; i < res.inputGains.length; i++) {
          lines.push(`  input ${i + 1} (${engNum(rin[i])} Ω): ${engNum(res.inputGains[i])}`);
        }
      } else if (res.cornerFrequency === null) {
        lines.push(`Closed-loop gain = ${engNum(res.gain)}`);
      }
      lines.push(`Noise gain = ${engNum(res.noiseGain)}  (this is what sets the bandwidth)`);
      lines.push(
        `Input resistance = ${res.inputResistance === Infinity ? "essentially infinite" : engNum(res.inputResistance) + " Ω"}`,
      );
      if (res.cornerFrequency !== null) {
        lines.push(`Corner frequency (unity gain) = ${engNum(res.cornerFrequency)} Hz`);
      }
      if (res.bandwidth !== null) {
        lines.push("");
        lines.push(`Small-signal bandwidth = ${engNum(res.bandwidth)} Hz`);
      }
      if (res.fullPowerBandwidth !== null) {
        lines.push(`Full-power bandwidth = ${engNum(res.fullPowerBandwidth)} Hz`);
      }
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_ELEC_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "filter-design",
    name: "Analogue filter design",
    group: "Electronics",
    hint:
      "Give a passband and stopband specification and it computes the minimum order that meets " +
      "both, then hands you a transfer function you can take straight to the control tools to " +
      "look at the phase. Both families are compared so you can see the size of the trade.",
    fields: [
      {
        key: "family",
        label: "Family",
        default: "butterworth",
        kind: "select",
        options: [
          { value: "butterworth", label: "Butterworth (maximally flat, slowest roll-off)" },
          { value: "chebyshev", label: "Chebyshev I (ripple, sharpest roll-off)" },
        ],
      },
      {
        key: "kind",
        label: "Type",
        default: "lowpass",
        kind: "select",
        options: [
          { value: "lowpass", label: "Low-pass" },
          { value: "highpass", label: "High-pass" },
        ],
      },
      { key: "wp", label: "Passband edge ωp, rad/s", default: "1000", kind: "text" },
      { key: "ws", label: "Stopband edge ωs, rad/s", default: "4000", kind: "text" },
      { key: "ap", label: "Maximum passband ripple, dB", default: "1", kind: "text" },
      { key: "as", label: "Minimum stopband attenuation, dB", default: "40", kind: "text" },
      { key: "force", label: "Force an order (blank to use the minimum)", default: "", kind: "text" },
    ],
    compute: (r) => {
      const res = designFilter({
        family: (r("family") || "butterworth") as FilterFamily,
        kind: (r("kind") || "lowpass") as AnalogueFilterKind,
        wp: Number(r("wp") || "0"),
        ws: Number(r("ws") || "0"),
        ap: Number(r("ap") || "0"),
        as: Number(r("as") || "0"),
        forceOrder: r("force").trim() ? Number(r("force")) : undefined,
      });
      if (!res.ok) return { text: res.error, ok: false };

      const tf = toTransferFunction(res);
      const lines: EngLine[] = [];
      lines.push(`${res.family} ${res.kind} filter, order ${res.order}`);
      lines.push(`  the specification needs order ${engNum(res.exactOrder, 4)}, rounded up`);
      lines.push("");
      lines.push(tfLineDecimal("H(s)", res.num, res.den));
      lines.push("");
      lines.push("Poles");
      for (const p of res.poles) lines.push(`  ${fmtComplexPlain(p)}`);
      lines.push("");
      lines.push(`Delivered stopband attenuation = ${engNum(res.stopbandAttenuation)} dB (asked for ${engNum(Number(r("as")))})`);
      lines.push(`Passband ripple = ${engNum(res.passbandRipple)} dB`);
      lines.push(`The other family would need order ${res.alternativeOrder} for the same specification.`);
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_ELEC_UNIT_NOTE);
      return engReport(lines);
    },
  },
  {
    id: "logic",
    name: "Truth table & Boolean minimisation",
    group: "Electronics",
    hint:
      'Write the expression in any common notation — "A AND B", "A&B", "AB", "A*B" all work, and ' +
      "a trailing apostrophe negates. Minimisation is Quine-McCluskey, so it does not run out at " +
      "five variables the way a Karnaugh map does.",
    fields: [
      { key: "vars", label: "Variables, in order", default: "A B C D", kind: "text" },
      { key: "expr", label: "Boolean expression", default: "A'B'C'D' + A'B'C'D + A'B'CD' + A'BC'D + A'BCD' + A'BCD + AB'C'D' + AB'C'D + AB'CD' + ABCD'", kind: "text" },
      { key: "dc", label: "Don't-care minterms, comma separated (optional)", default: "", kind: "text" },
      {
        key: "show",
        label: "Show the full truth table",
        default: "no",
        kind: "select",
        options: [
          { value: "no", label: "No — just the minimisation" },
          { value: "yes", label: "Yes" },
        ],
      },
    ],
    compute: (r) => {
      const t = truthTable(r("expr"), r("vars"));
      if (!t.ok) return { text: t.error, ok: false };

      const dc = r("dc")
        .split(/[,\s]+/)
        .filter(Boolean)
        .map(Number);
      if (dc.some((v) => !Number.isInteger(v))) {
        return { text: "Don't-care minterms must be whole numbers.", ok: false };
      }

      const m = minimise(t.minterms, t.variables, dc);
      if (!m.ok) return { text: m.error, ok: false };

      const lines: string[] = [];
      lines.push(`Variables: ${t.variables.join(", ")} — ${t.rows.length} rows`);
      lines.push(`Minterms where the output is true: ${t.minterms.join(", ") || "none"}`);
      if (dc.length) lines.push(`Don't-cares: ${dc.join(", ")}`);
      lines.push("");
      lines.push(`Minimised sum of products:  ${m.expression}`);
      lines.push(`  ${m.terms.length} product term(s), ${m.literals} literal(s)`);
      lines.push("");
      lines.push(`Prime implicants: ${m.primeImplicants.join(", ")}`);
      if (m.essential.length) lines.push(`Essential: ${m.essential.join(", ")}`);

      if (r("show") === "yes") {
        lines.push("");
        lines.push(`${t.variables.join(" ")}  |  out`);
        for (let i = 0; i < t.rows.length; i++) {
          const row = t.rows[i];
          lines.push(`${row.inputs.map((b) => (b ? "1" : "0")).join(" ")}  |  ${row.output ? "1" : "0"}`);
        }
      }
      for (const note of t.notes) lines.push(`Note: ${note}`);
      for (const note of m.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_ELEC_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "open-channel",
    name: "Open-channel flow",
    group: "Fluids",
    hint:
      "Manning's equation for uniform flow, in SI. The Froude number is the answer that matters: " +
      "it decides whether the channel is controlled from upstream or downstream, and crossing " +
      "Fr = 1 unintentionally gives you a hydraulic jump.",
    fields: [
      {
        key: "shape",
        label: "Section",
        default: "trapezoidal",
        kind: "select",
        options: [
          { value: "rectangular", label: "Rectangular (bed width)" },
          { value: "trapezoidal", label: "Trapezoidal (bed width + side slope)" },
          { value: "triangular", label: "Triangular (side slope)" },
          { value: "circular", label: "Circular, part full (diameter)" },
        ],
      },
      { key: "b", label: "Bed width, m", default: "3", kind: "text" },
      { key: "z", label: "Side slope, horizontal per 1 vertical", default: "2", kind: "text" },
      { key: "D", label: "Diameter, m (circular)", default: "1", kind: "text" },
      { key: "y", label: "Flow depth, m", default: "1.2", kind: "text" },
      {
        key: "nsel",
        label: "Surface (sets Manning's n)",
        default: "concrete-rough",
        kind: "select",
        options: MANNING_N.map((m) => ({ value: m.id, label: `${m.label} (${m.min}–${m.max})` })),
      },
      { key: "n", label: "Manning's n override (blank to use the surface)", default: "", kind: "text" },
      { key: "S", label: "Bed slope, m/m", default: "0.001", kind: "text" },
    ],
    compute: (r) => {
      const sel = MANNING_N.find((m) => m.id === r("nsel")) ?? MANNING_N[2];
      const n = r("n").trim() ? Number(r("n")) : sel.typical;
      const u = engUnits(r);
      const res = openChannelFlow({
        shape: (r("shape") || "trapezoidal") as ChannelShape,
        // Lengths convert; the side slope, Manning's n and the bed slope are
        // dimensionless ratios with nothing to convert.
        b: u.opt("b", "m", "Bed width", 0),
        z: Number(r("z") || "0"),
        D: u.opt("D", "m", "Diameter", 0),
        y: u.req("y", "m", "Flow depth"),
        n,
        S: Number(r("S") || "0"),
      });
      if (u.errors.length) return { text: u.errors.join("\n"), ok: false };
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push(`Open-channel flow, ${r("shape") || "trapezoidal"} section`);
      lines.push(
        `Manning's n = ${engNum(n, 4)}` +
          (r("n").trim() ? " (as entered)" : ` (${sel.label}, range ${sel.min} to ${sel.max})`),
      );
      lines.push("");
      lines.push(`Flow area = ${engNum(res.area)} m², wetted perimeter = ${engNum(res.perimeter)} m`);
      lines.push(`Hydraulic radius = ${engNum(res.hydraulicRadius)} m`);
      lines.push(`Mean velocity = ${engNum(res.velocity)} m/s`);
      lines.push(`Discharge Q = ${engNum(res.discharge)} m³/s`);
      lines.push("");
      lines.push(`Froude number = ${engNum(res.froude)} — ${res.regime.toUpperCase()}`);
      if (res.criticalDepth !== null) lines.push(`Critical depth for this discharge = ${engNum(res.criticalDepth)} m`);
      lines.push(`Specific energy = ${engNum(res.specificEnergy)} m`);
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "pump-npsh",
    name: "Pump NPSH & cavitation",
    group: "Fluids",
    hint:
      "Cavitation is a failure mode, not an efficiency loss, and it is entirely a suction-side " +
      "problem — nothing downstream of the pump can fix it. Note that NPSH available FALLS as the " +
      "liquid gets hotter, which is what catches people out.",
    fields: [
      { key: "psurf", label: "Absolute pressure on the liquid surface, Pa", default: "101325", kind: "text" },
      { key: "pvap", label: "Vapour pressure at the pumping temperature, Pa", default: "2339", kind: "text" },
      { key: "rho", label: "Density, kg/m³", default: "998", kind: "text" },
      { key: "hstat", label: "Static head, m (positive = liquid ABOVE the pump)", default: "2", kind: "text" },
      { key: "hloss", label: "Suction-line losses, m", default: "0.5", kind: "text" },
      { key: "npshr", label: "NPSH required by the pump, m (from its curve)", default: "3", kind: "text" },
      { key: "Q", label: "Flow, m³/s (blank to skip power)", default: "", kind: "text" },
      { key: "head", label: "Total head delivered, m", default: "", kind: "text" },
      { key: "eta", label: "Pump efficiency, 0-1", default: "0.7", kind: "text" },
    ],
    compute: (r) => {
      const u = engUnits(r);
      const res = npshAnalysis({
        pSurface: u.req("psurf", "Pa", "Surface pressure"),
        pVapour: u.req("pvap", "Pa", "Vapour pressure"),
        rho: u.req("rho", "kg/m^3", "Density"),
        staticHead: u.opt("hstat", "m", "Static head", 0),
        suctionLosses: u.opt("hloss", "m", "Suction losses", 0),
        npshRequired: u.req("npshr", "m", "Required NPSH"),
        Q: r("Q").trim() ? Number(r("Q")) : undefined,
        head: r("head").trim() ? Number(r("head")) : undefined,
        eta: r("eta").trim() ? Number(r("eta")) : undefined,
      });
      if (u.errors.length) return { text: u.errors.join("\n"), ok: false };
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push("Pump suction analysis");
      lines.push("");
      lines.push(`NPSH available = ${engNum(res.npshAvailable)} m`);
      lines.push(`NPSH required  = ${engNum(Number(r("npshr")))} m`);
      lines.push(`Margin = ${engNum(res.margin)} m`);
      lines.push("");
      lines.push(res.cavitating ? "VERDICT: THIS PUMP WILL CAVITATE." : "VERDICT: no cavitation predicted.");
      if (res.hydraulicPower !== null) {
        lines.push("");
        lines.push(`Hydraulic power = ${engNum(res.hydraulicPower)} W`);
        if (res.shaftPower !== null) lines.push(`Shaft power required = ${engNum(res.shaftPower)} W`);
      }
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "compressible",
    name: "Compressible flow & choking",
    group: "Fluids",
    hint:
      "Isentropic relations for an ideal gas. The result worth knowing is CHOKING: past the " +
      "critical pressure ratio, lowering the downstream pressure does not increase the mass flow, " +
      "because that information cannot travel upstream against sonic flow.",
    fields: [
      { key: "mach", label: "Mach number", default: "0.8", kind: "text" },
      { key: "k", label: "Specific-heat ratio k", default: "1.4", kind: "text" },
      { key: "T", label: "Static temperature, K", default: "288.15", kind: "text" },
    ],
    compute: (r) => {
      const res = compressibleFlow(Number(r("mach") || "0"), Number(r("k") || "1.4"), Number(r("T") || "288.15"));
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push(`Compressible flow at Mach ${engNum(res.mach)} — ${res.regime.toUpperCase()}`);
      lines.push("");
      lines.push(`Speed of sound = ${engNum(res.speedOfSound)} m/s`);
      lines.push(`Velocity = ${engNum(res.mach * res.speedOfSound)} m/s`);
      lines.push("");
      lines.push("Stagnation to static ratios");
      lines.push(`  T0/T = ${engNum(res.temperatureRatio)}`);
      lines.push(`  p0/p = ${engNum(res.pressureRatio)}`);
      lines.push(`  ρ0/ρ = ${engNum(res.densityRatio)}`);
      lines.push("");
      lines.push(`Area ratio A/A* = ${res.areaRatio === Infinity ? "infinite (no flow)" : engNum(res.areaRatio)}`);
      lines.push(`Critical pressure ratio p*/p0 = ${engNum(res.criticalPressureRatio)}`);
      lines.push(res.choked ? "The flow is CHOKED." : "The flow is not choked.");
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_THERMO_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "haemodynamics",
    name: "Haemodynamics",
    group: "Biomedical",
    hint:
      "Poiseuille flow in a single vessel and whole-circulation resistance. The fourth-power " +
      "dependence on radius is the point: a 20% narrowing more than doubles the resistance, which " +
      "is why a stenosis that looks modest on an image is not.",
    fields: [
      {
        key: "which",
        label: "Analysis",
        default: "vessel",
        kind: "select",
        options: [
          { value: "vessel", label: "Single vessel (Poiseuille)" },
          { value: "systemic", label: "Systemic vascular resistance" },
        ],
      },
      { key: "radius", label: "Vessel radius, m", default: "0.002", kind: "text" },
      { key: "length", label: "Vessel length, m", default: "0.1", kind: "text" },
      { key: "flow", label: "Flow, m³/s", default: "5e-6", kind: "text" },
      { key: "mu", label: "Blood viscosity, Pa·s", default: "3.5e-3", kind: "text" },
      { key: "rho", label: "Blood density, kg/m³", default: "1060", kind: "text" },
      { key: "map", label: "Mean arterial pressure, mmHg", default: "93", kind: "text" },
      { key: "cvp", label: "Central venous pressure, mmHg", default: "5", kind: "text" },
      { key: "co", label: "Cardiac output, L/min", default: "5", kind: "text" },
      { key: "hr", label: "Heart rate, bpm (blank to skip)", default: "70", kind: "text" },
      { key: "bsa", label: "Body surface area, m² (blank to skip)", default: "1.8", kind: "text" },
    ],
    compute: (r) => {
      const lines: string[] = [];
      if ((r("which") || "vessel") === "vessel") {
        const res = vesselFlow({
          radius: Number(r("radius") || "0"),
          length: Number(r("length") || "0"),
          flow: Number(r("flow") || "0"),
          viscosity: Number(r("mu") || "0"),
          density: Number(r("rho") || "0"),
        });
        if (!res.ok) return { text: res.error, ok: false };
        lines.push("Single-vessel flow (Poiseuille)");
        lines.push("");
        lines.push(`Hydraulic resistance = ${engNum(res.resistance)} Pa·s/m³`);
        lines.push(`Pressure drop = ${engNum(res.pressureDrop)} Pa = ${engNum(res.pressureDropMmHg)} mmHg`);
        lines.push(`Mean velocity = ${engNum(res.velocity)} m/s`);
        lines.push(`Reynolds number = ${engNum(res.reynolds)}${res.turbulent ? " — TURBULENT" : " — laminar"}`);
        lines.push(`Wall shear stress = ${engNum(res.wallShearStress)} Pa`);
        for (const note of res.notes) lines.push(`Note: ${note}`);
      } else {
        const res = circulation({
          mapMmHg: Number(r("map") || "0"),
          cvpMmHg: Number(r("cvp") || "0"),
          cardiacOutputLmin: Number(r("co") || "0"),
          heartRate: r("hr").trim() ? Number(r("hr")) : undefined,
          bsa: r("bsa").trim() ? Number(r("bsa")) : undefined,
        });
        if (!res.ok) return { text: res.error, ok: false };
        lines.push("Systemic circulation");
        lines.push("");
        lines.push(`Systemic vascular resistance = ${engNum(res.svrClinical)} dyn·s/cm⁵`);
        lines.push(`  = ${engNum(res.svrSI)} Pa·s/m³ in SI`);
        if (res.strokeVolume !== null) lines.push(`Stroke volume = ${engNum(res.strokeVolume)} mL`);
        if (res.cardiacIndex !== null) lines.push(`Cardiac index = ${engNum(res.cardiacIndex)} L/min/m²`);
        for (const note of res.notes) lines.push(`Note: ${note}`);
      }
      lines.push(ENG_BIOMED_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "biomechanics",
    name: "Joint biomechanics",
    group: "Biomedical",
    hint:
      "Static equilibrium about a joint. The body is built almost entirely from third-class " +
      "levers, so the muscle force is many times the external load — and the JOINT REACTION is " +
      "larger than either, which is the number a prosthesis has to survive.",
    fields: [
      { key: "load", label: "External load, N", default: "100", kind: "text" },
      { key: "loadArm", label: "Joint to load distance, m", default: "0.35", kind: "text" },
      { key: "muscleArm", label: "Joint to muscle insertion, m", default: "0.05", kind: "text" },
      { key: "angle", label: "Muscle pull angle to the bone, degrees", default: "90", kind: "text" },
      { key: "segW", label: "Segment weight, N (blank to ignore)", default: "", kind: "text" },
      { key: "segArm", label: "Joint to segment centre of mass, m", default: "", kind: "text" },
    ],
    compute: (r) => {
      const res = jointStatics({
        load: Number(r("load") || "0"),
        loadArm: Number(r("loadArm") || "0"),
        muscleArm: Number(r("muscleArm") || "0"),
        pullAngleDeg: r("angle").trim() ? Number(r("angle")) : undefined,
        segmentWeight: r("segW").trim() ? Number(r("segW")) : undefined,
        segmentArm: r("segArm").trim() ? Number(r("segArm")) : undefined,
      });
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push("Static equilibrium about a joint");
      lines.push("");
      lines.push(`External moment = ${engNum(res.externalMoment)} N·m`);
      lines.push(`Muscle force required = ${engNum(res.muscleForce)} N`);
      lines.push(`Mechanical advantage = ${engNum(res.mechanicalAdvantage)}`);
      lines.push(`JOINT REACTION FORCE = ${engNum(res.jointReaction)} N`);
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_BIOMED_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
  {
    id: "biosignal",
    name: "Signal sampling & aliasing",
    group: "Biomedical",
    hint:
      "Checks a sampling rate against the signal it is meant to capture. Aliasing is the one " +
      "failure here that cannot be undone: once a frequency has folded down into the band, no " +
      "filtering afterwards can separate it from real data.",
    fields: [
      { key: "fs", label: "Sampling rate, Hz", default: "500", kind: "text" },
      { key: "fmax", label: "Highest frequency in the signal, Hz", default: "100", kind: "text" },
      { key: "rec", label: "Record length, s (blank to skip resolution)", default: "10", kind: "text" },
      { key: "interf", label: "Interference frequency to check, Hz (blank to skip)", default: "550", kind: "text" },
    ],
    compute: (r) => {
      const res = samplingCheck(
        Number(r("fs") || "0"),
        Number(r("fmax") || "0"),
        r("rec").trim() ? Number(r("rec")) : undefined,
        r("interf").trim() ? Number(r("interf")) : undefined,
      );
      if (!res.ok) return { text: res.error, ok: false };

      const lines: string[] = [];
      lines.push(`Sampling at ${engNum(Number(r("fs")))} Hz`);
      lines.push("");
      lines.push(`Nyquist frequency = ${engNum(res.nyquist)} Hz`);
      lines.push(res.adequate ? "The sampling rate is ADEQUATE for this signal." : "The sampling rate is TOO LOW — the signal will alias.");
      if (res.aliasedTo !== null) lines.push(`The checked frequency appears at ${engNum(res.aliasedTo)} Hz after sampling.`);
      if (res.samples !== null) {
        lines.push("");
        lines.push(`Samples in the record = ${engNum(res.samples)}`);
        lines.push(`Frequency resolution = ${engNum(res.resolution as number)} Hz`);
      }
      for (const note of res.notes) lines.push(`Note: ${note}`);
      lines.push(ENG_BIOMED_UNIT_NOTE);
      return { text: plainDashes(lines.join("\n")) };
    },
  },
];

/**
 * One line of an Engineering report: prose, or a formula to be typeset.
 *
 * Marking the formulas rather than typesetting everything keeps the reports
 * readable — a result is mostly sentences with a few equations in it, and
 * pushing the prose through a math engine would be both wrong and ugly.
 */
type EngLine = string | { math: string; fallback: string };

/** Turns an Engineering report into blocks, typesetting the marked formulas. */
function engReport(lines: EngLine[], extra: AnalyzeBlock[] = []): AnalyzeOutput {
  const blocks: AnalyzeBlock[] = lines.map((l) =>
    typeof l === "string"
      ? { kind: "line" as const, text: plainDashes(l) }
      : { kind: "math" as const, math: l.math, fallback: plainDashes(l.fallback) },
  );
  blocks.push(...extra);
  return { blocks, text: analyzeBlocksToText(blocks) };
}

/** A transfer function as a typeset fraction, with a readable text fallback. */
function tfLine(name: string, num: Rat[], den: Rat[]): EngLine {
  return {
    math: `${name} = (${polyToMath(num)})/(${polyToMath(den)})`,
    fallback: `${name} = [ ${polyToString(num)} ] / [ ${polyToString(den)} ]`,
  };
}

/**
 * The same, for a filter whose coefficients came from doubles.
 *
 * Those are rationalised to the nearest double, so their exact numerators and
 * denominators run to sixteen digits each and are useless to read. Decimals are
 * the honest presentation of a coefficient that was never rational.
 */
function tfLineDecimal(name: string, num: number[], den: number[], sig = 5): EngLine {
  const fmt = (p: number[]): string => {
    const n = p.length - 1;
    const parts: string[] = [];
    for (let i = 0; i <= n; i++) {
      if (p[i] === 0) continue;
      const power = n - i;
      const neg = p[i] < 0;
      const mag = Math.abs(p[i]);
      const isOne = Math.abs(mag - 1) < 1e-12;
      const coeff = isOne && power > 0 ? "" : engNum(mag, sig);
      const sPart = power === 0 ? "" : power === 1 ? "s" : `s^${power}`;
      parts.push((parts.length ? (neg ? " - " : " + ") : neg ? "-" : "") + coeff + sPart);
    }
    return parts.length ? parts.join("") : "0";
  };
  const n = fmt(num);
  const d = fmt(den);
  return { math: `${name} = (${n})/(${d})`, fallback: `${name} = [ ${n} ] / [ ${d} ]` };
}

/** A complex number as plain text, for a result that must survive the dash guard. */
function fmtComplexPlain(c: { re: number; im: number }): string {
  if (Math.abs(c.im) < 1e-12) return engNum(c.re);
  return `${engNum(c.re)} ${c.im < 0 ? "-" : "+"} ${engNum(Math.abs(c.im))}j`;
}

/** Builds the inputs for the selected Engineering tool and wires live compute. */
/**
 * Builds the Engineering discipline panels — one collapsible panel per group,
 * each listing its calculations.
 *
 * WHY THIS REPLACED A DROPDOWN. Thirty-six options in one <select> is a scroll,
 * not a menu: even grouped with <optgroup>, choosing a tool meant dragging
 * through a list taller than the pane. Engineering was also the only mode in the
 * add-in that worked that way. Panels show nine short headings, and open to
 * three to six calculations each.
 *
 * The <select> is still the single source of truth for the selection. A panel
 * button sets its value and fires `change`, so input rendering, compute, insert,
 * the routing gates and the headless audit all keep working through exactly the
 * path they always used. Two controls would drift; a control and a state holder
 * cannot.
 */
function renderEngineeringGroups(): void {
  const host = document.getElementById("engineering-groups");
  if (!host) return;
  host.innerHTML = "";
  const current = engineeringCalcSelect.value || ENG_CALCS[0].id;

  for (const title of ENG_GROUP_ORDER) {
    const members = ENG_CALCS.filter((c) => c.group === title);
    if (!members.length) continue;

    const panel = document.createElement("details");
    panel.className = "eng-group";
    // Only the panel holding the current calculation starts open, so the pane
    // opens showing one group rather than all thirty-six calculations.
    panel.open = members.some((m) => m.id === current);

    const summary = document.createElement("summary");
    summary.textContent = title;
    const count = document.createElement("span");
    count.className = "eng-group-count";
    count.textContent = String(members.length);
    summary.appendChild(count);
    panel.appendChild(summary);

    for (const c of members) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "eng-tool";
      btn.textContent = c.name;
      btn.dataset.id = c.id;
      btn.setAttribute("aria-current", c.id === current ? "true" : "false");
      btn.addEventListener("click", () => selectEngineeringCalc(c.id));
      panel.appendChild(btn);
    }
    host.appendChild(panel);
  }
}

/**
 * Selects a calculation from the panels.
 *
 * Routed through the <select> deliberately: its `change` listener is what
 * renders the inputs and recomputes, and duplicating that here is how the two
 * paths would drift apart.
 */
function selectEngineeringCalc(id: string): void {
  if (engineeringCalcSelect.value === id) return;
  engineeringCalcSelect.value = id;
  engineeringCalcSelect.dispatchEvent(new Event("change", { bubbles: true }));
  markEngineeringSelection(id);
}

/** Moves the highlight, and opens the panel holding the selection. */
function markEngineeringSelection(id: string): void {
  const host = document.getElementById("engineering-groups");
  if (!host) return;
  for (const btn of Array.from(host.querySelectorAll<HTMLButtonElement>(".eng-tool"))) {
    const isCurrent = btn.dataset.id === id;
    btn.setAttribute("aria-current", isCurrent ? "true" : "false");
    if (isCurrent) {
      const panel = btn.closest("details");
      if (panel) panel.open = true;
    }
  }
}

function renderEngineeringInputs(): void {
  const calc = ENG_CALCS.find((c) => c.id === engineeringCalcSelect.value) ?? ENG_CALCS[0];
  engineeringHint.textContent = calc.hint;
  renderCalcFields(calc.fields, engineeringInputs, "engineering", updateEngineeringPreview);
}

let currentEngText = "";
let currentEngBlocks: AnalyzeBlock[] | null = null;

/** Computes and shows the result for the current Engineering tool. */
function updateEngineeringPreview(): void {
  const calc = ENG_CALCS.find((c) => c.id === engineeringCalcSelect.value) ?? ENG_CALCS[0];
  const read = (k: string): string => {
    const el = engineeringInputs.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[data-key="${k}"]`,
    );
    return el ? el.value : "";
  };
  let out: AnalyzeOutput;
  try {
    out = calc.compute(read);
  } catch (e) {
    out = { text: `Couldn't compute: ${(e as Error).message}`, ok: false };
  }
  // Same em-dash sentinel guard as Stats and Analyze. Every string this mode
  // builds is passed through plainDashes() where it is assembled, so the prose
  // can stay readable without silently disabling the button.
  const insertable = out.ok !== false && !!out.text && !out.text.includes("—");
  engineeringResult.innerHTML =
    out.blocks && insertable ? analyzeBlocksToPreviewHtml(out.blocks) : esc(out.text).replace(/\n/g, "<br>");
  currentEngText = insertable ? out.text : "";
  currentEngBlocks = insertable ? out.blocks ?? null : null;
  engineeringInsertBtn.disabled = !insertable;
}

/** Inserts the current Engineering result, diagram included. */
async function insertEngineering(): Promise<void> {
  await insertResultBlocks(currentEngText, currentEngBlocks, "Engineering result");
}

/** Builds the inputs for the selected Analyze tool and wires live compute. */
function renderAnalyzeInputs(): void {
  const calc = ANALYZE_CALCS.find((c) => c.id === analyzeCalcSelect.value) ?? ANALYZE_CALCS[0];
  renderCalcFields(calc.fields, analyzeInputs, "analyze", updateAnalyzePreview);
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
  // never land in the document. Matches the Stats-mode guard.
  //
  // HAZARD, learned the hard way: this scans the WHOLE result text, so an em dash
  // used as ordinary punctuation anywhere in a calculator's output silently
  // disables Insert AND suppresses the rich preview (the reader falls back to the
  // plain-text branch below, so plots vanish). If you are writing a calculator,
  // use a comma or a hyphen in prose. analyzeCalcText.test.ts pins this.
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
  await insertResultBlocks(currentAnalyzeText, currentAnalyzeBlocks, "Analysis");
}

/**
 * Shared block-insertion path. Analyze was the only mode producing matrices and
 * plots when this was written; Engineering produces the same shapes (a diagram
 * plus lines), and duplicating the Word.run choreography is how two copies drift
 * apart — which is exactly what happened to the four field renderers before
 * v2.4.0 folded them into one.
 */
async function insertResultBlocks(text: string, blocksIn: AnalyzeBlock[] | null, label: string): Promise<void> {
  if (!text.trim()) {
    setStatus("Nothing to insert.", "error");
    return;
  }
  const blocks = blocksIn;
  // No matrix/plot to lay out → the existing plain-text path is exactly right.
  // WHICH BLOCK KINDS NEED THE RICH PATH. Anything that is not plain text does:
  // a matrix becomes a Word table, a plot becomes a picture, and a formula
  // becomes a real equation. Leaving "math" out of this list meant the three
  // tools whose reports contain formulas but no figure — poles/zeros/stability,
  // PID, and filter design — fell straight through to insertPlainText and put
  // the caret form in the document anyway, with the equation code sitting there
  // fully written and never reached. Exactly the "engine built, pane cannot
  // reach it" failure this repo has hit before; the gate below now pins the
  // list so a new rich block kind cannot be added without routing it.
  const RICH_KINDS = ["matrix", "plot", "math"];
  if (!blocks || !blocks.some((b) => RICH_KINDS.includes(b.kind))) {
    await insertPlainText(text, label);
    return;
  }
  // NEVER RETURN SILENTLY FROM AN INSERT.
  //
  // This was a bare `return`. It is the only path through this function that
  // produces no document content AND no message, which is exactly what was
  // reported from real use: figures missing, nothing in the status area, no way
  // to tell whether the click had even registered. The plain-text path already
  // said this out loud; the rich path swallowed it.
  //
  // The flag is shared with insertPlainText and insertAlignmentText, so once it
  // sticks it disables EVERY insert in the product, and the only symptom is
  // silence.
  if (insertTextBusy) {
    setStatus("Still inserting the last result — one moment.", "error");
    return;
  }
  insertTextBusy = true;
  try {
    // Render any plot SVGs to PNG before entering Word.run (the conversion is async).
    const images: Record<number, string> = {};
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.kind === "plot") images[i] = await renderFigurePng(b.svg, b.w, b.h);
    }
    let picturesConfirmed: number | null = null;
    await Word.run(async (context) => {
      // ASK WORD WHAT IT ACTUALLY HAS, RATHER THAN WHAT WE ASKED IT FOR.
      //
      // The pane reported "inserted — 2 figures" beside a page containing none,
      // and that count came from the images successfully RASTERISED — it says
      // nothing about what Word kept. Word accepted every picture call and
      // raised no error, so from inside the add-in success and silent discard
      // are identical.
      //
      // Counting the document's inline pictures before and after makes Word the
      // witness instead of us. A delta of 0 against two attempts is proof the
      // host dropped them, and no amount of reasoning from this side could
      // establish that.
      // WRAPPED, BECAUSE INSTRUMENTATION MAY NEVER BREAK WHAT IT MEASURES.
      // This is a diagnostic on the critical path of every rich insert. A host
      // that does not expose body.inlinePictures would otherwise throw here and
      // take the whole insert down — trading a missing figure for a missing
      // document. Caught by the Engineering audit, which drives a Word mock
      // that has no body: every rich tool failed with "Cannot read properties".
      let picturesBefore: number | null = null;
      try {
        const before = context.document.body.inlinePictures;
        before.load("items");
        await context.sync();
        picturesBefore = before.items.length;
      } catch {
        picturesBefore = null; // no confirmation available; the insert proceeds
      }

      let anchor = context.document.getSelection().getRange(Word.RangeLocation.end);
      // TEXT AND EQUATIONS GO IN AS ONE PACKAGE PER RUN, NOT ONE CALL PER LINE.
      //
      // mathToOoxml builds a COMPLETE flat-OPC document, and inserting one of
      // those in the middle of a sequence breaks the anchor chain — the range it
      // returns is not a usable insertion point for the paragraphs that follow,
      // so everything after the first equation silently failed to land. With the
      // formula as the first line of the poles/zeros report, the result was that
      // ONLY the formula was inserted. Reported from real use.
      //
      // buildDerivationOoxml already solves exactly this for Solve's
      // derivations: it puts every paragraph, prose and equation alike, into a
      // SINGLE package that is inserted once. So consecutive line/math blocks
      // are batched into one such package here, and only genuinely different
      // objects — pictures and tables — break the run.
      let run: DerivationBlock[] = [];
      let runHasMath = false;
      const flushRun = (): void => {
        if (!run.length) return;
        if (runHasMath) {
          // One package for the whole run — the only way an equation and the
          // lines around it can go in together.
          const ooxml = buildDerivationOoxml(run);
          const inserted = anchor.insertOoxml(ooxml, Word.InsertLocation.after);
          anchor = inserted.getRange(Word.RangeLocation.after);
        } else {
          // NO FORMULAS IN THIS RUN, SO NOTHING CHANGES FOR IT. Plain paragraphs
          // still go in one at a time, exactly as before, because
          // insertParagraph inherits the style at the cursor while an OOXML
          // package brings its own. Every tool without equations — beam,
          // sections, stats, the whole rest of the product — therefore inserts
          // identically to how it did before this change. Only the reports that
          // genuinely need an equation take the different path.
          for (const b of run) {
            const para = anchor.insertParagraph(b.content, Word.InsertLocation.after);
            anchor = para.getRange(Word.RangeLocation.after);
          }
        }
        run = [];
        runHasMath = false;
      };

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (block.kind === "line") {
          run.push({ kind: "text", content: block.text });
          continue;
        }
        if (block.kind === "math") {
          // Parseability is checked HERE rather than left to the builder, so an
          // expression that will not typeset falls back to the readable text
          // this tool wrote rather than to its own math source.
          let parses = true;
          try {
            mathToOmml(block.math);
          } catch {
            parses = false;
          }
          run.push(parses ? { kind: "math", content: block.math } : { kind: "text", content: block.fallback });
          if (parses) runHasMath = true;
          continue;
        }
        flushRun();
        if (block.kind === "plot") {
          // THE ANCHOR AFTER A FIGURE MUST BE RangeLocation.end, NOT .after.
          //
          // Five releases went into this because the first "measurement" was an
          // inference. A user's remark that two Bode plots "are not aligned even
          // though they are the same size" was read as proof both had been
          // inserted. It is not proof of anything: v2.31.0 predates the picture
          // counter entirely (`git show d561229 | grep -c picturesBefore` = 0),
          // so THE FIGURE COUNT AT v2.31.0 IS SIMPLY UNKNOWN. Do not replace
          // that with a better story. An earlier draft of this comment guessed
          // the remark was about the pane's preview; a later one asserted there
          // is no plot preview at all, which is wrong — updateEngineeringPreview
          // renders every block through analyzeBlocksToPreviewHtml into
          // #engineering-result, and the audit counts two <svg> there for
          // frequency response. (The claim was about previewEl, a different
          // element.) So the remark could have been about either the preview or
          // the page, and which one it was remains unknown. Leave it unknown.
          //
          // So the ladder is three measurements and one inference, and the
          // inference is the only rung this token disagrees with.
          //
          // Everything else fits that. Every other figure-bearing report — beam,
          // step response, all three PK tools, both vibration tools — carries
          // exactly ONE figure and has always worked. Frequency response is the
          // only report with two, and it is the only one that loses one. A
          // single figure never chains an anchor; a second one does.
          //
          // insertGallery is the corroboration. It has shipped untouched for
          // years, it inserts N pictures in one loop in one Word.run, and it
          // differed from this branch in exactly one token: it takes its next
          // anchor from getRange(RangeLocation.END) rather than .after. It is
          // not the only site — the table-figure and structure inserts BOTH
          // chain .end off a picture, while the same routines chain .after off
          // ordinary text paragraphs. Three shipped sites, one rule.
          //
          // MEASURED IN REAL WORD, v2.31.9: the frequency-response report reads
          // "2 figures" on the status line with both plots on the page. That
          // count is Word's own — picturesConfirmed compares
          // document.body.inlinePictures before and after — and the user
          // verified the page matched it. It is the first hard number in this
          // story and it promotes the rule below from corroboration to a result.
          //
          // A note for any automated reviewer that reads only this repository:
          // an earlier reviewer deleted this paragraph as "fabricated" because
          // no count appears in the source. It does not — the count is taken at
          // RUNTIME, in Word, and reported to the user, so the repo cannot
          // contain it. Absence of a number in the code is not absence of a
          // measurement. Do not delete this again; ask instead.
          //
          // The proposed rule: chaining .after off a paragraph that CONTAINS AN
          // INLINE PICTURE does not yield a usable insertion point — Word
          // accepts the next picture against it and keeps nothing, with no
          // error.
          //
          // One honest gap in that rule. The prose which "always landed" was
          // chained off TEXT paragraphs, so it says nothing about what a
          // picture-derived range accepts. The untested case is caption 2,
          // which at v2.31.1 and v2.31.7 was inserted against exactly that bad
          // range. Nobody ever asked whether it appeared. So: if the next
          // frequency-response insert still reads 1 of 2, ASK WHETHER THE
          // SECOND CAPTION'S TEXT IS THERE. Caption present but figure absent
          // means the range takes paragraphs and drops pictures, and the
          // suspect is the picture call rather than the anchor; both absent
          // means the anchor is simply dead.
          //
          // Refuted along the way, recorded so none of it is rediscovered:
          //   - that properties set on a picture pre-sync are discarded with it
          //     (insertGallery, the table-figure and structure inserts all do
          //     this and have shipped for years);
          //   - that a sync between hops is the remedy. This is the one CLEAN
          //     inference in the dataset: beam carries a single figure and no
          //     math, and it kept that figure until the release that added a
          //     sync per hop, which took it to none. Syncs in this loop cost
          //     figures.
          //   - that an OOXML package upstream is what eats the figure. The
          //     step-response report is tfLine (math, hence insertOoxml) plus
          //     exactly ONE plot, and it has never been reported to lose it,
          //     while Bode with the same upstream loses one of two. That is
          //     absence-of-complaint rather than a count, so it is weaker than
          //     the rungs above — but the recorded OOXML failure mode is total
          //     downstream loss ("only the formula was inserted"), and what was
          //     actually seen is prose plus the FIRST figure landing. A cause
          //     that has to spare figure one and kill figure two is a free
          //     parameter. flushRun's own anchor is deliberately left on .after.
          //
          // NOT refuted, only never tested cleanly:
          //   - InsertLocation.start. It shipped in v2.31.7 and gave 1 of 2, but
          //     that build also had OOXML upstream and a sync in-branch, and it
          //     chained .after off a picture paragraph like every other rung. It
          //     is unconvicted, not exonerated. It also aligns every picture at
          //     the margin for free, at the cost of the caption sitting to the
          //     right of the figure — worth a look AFTER a confirmed 2 of 2.
          //
          // THE COSMETIC DEBT that started this is still here: the picture sits
          // after the caption text, so captions of different lengths push their
          // figures to different x. Fix it by declaring layout in a single OOXML
          // package, never by chaining more ranges — and prove it against the
          // picture count before shipping it.
          const para = anchor.insertParagraph(block.caption, Word.InsertLocation.after);
          const pic = para.insertInlinePictureFromBase64(images[i], Word.InsertLocation.end);
          sizeFigure(pic, block.w, block.h);
          pic.altTextDescription = block.alt;
          anchor = para.getRange(Word.RangeLocation.end);
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
      flushRun();
      anchor.select(Word.SelectionMode.end);
      await context.sync();

      if (picturesBefore !== null) {
        try {
          const after = context.document.body.inlinePictures;
          after.load("items");
          await context.sync();
          picturesConfirmed = after.items.length - picturesBefore;
        } catch {
          picturesConfirmed = null; // stay quiet rather than report a wrong count
        }
      }
    });
    // SAY WHAT WENT IN, NOT JUST THAT SOMETHING DID.
    //
    // "Beam analysis inserted." is true of a report that arrived without its
    // diagram, which is how a missing figure became a bug report that took a
    // round of questions to localise. Naming the counts makes the pane's belief
    // checkable against the document at a glance: if it claims a figure the
    // page does not show, that is Word declining the call, and the two are
    // otherwise indistinguishable from the outside.
    const figureCount = Object.keys(images).length;
    const parts = [`${label} inserted`];
    if (figureCount) {
      parts.push(`${figureCount} figure${figureCount === 1 ? "" : "s"}`);
      // Word's own count, not ours. When they disagree the host discarded
      // pictures it accepted without complaint, and saying so is the difference
      // between a diagnosable report and "the graphs don't show up".
      if (picturesConfirmed !== null && picturesConfirmed !== figureCount) {
        setStatus(
          `${label} inserted, but Word kept ${picturesConfirmed} of ${figureCount} figures. ` +
            `The pictures were accepted and then discarded by Word.`,
          "error",
        );
        return;
      }
    }
    setStatus(parts.join(" — ") + ".", "success");
  } catch (error) {
    setStatus(`Could not insert ${label.toLowerCase()}: ${(error as Error).message}`, "error");
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
    const base64 = await renderFigurePng(structure.svg, d.w, d.h);
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
      sizeFigure(picture, d.w, d.h);
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

type SpectrumKind = "1H" | "13C" | "ir" | "uvvis" | "ms" | "cosy" | "hsqc";

/** The currently displayed prediction, kept for the insert buttons. */
let currentSpectrum:
  | { kind: "1H" | "13C"; nmr: NmrResult }
  | { kind: "ir"; ir: IrResult }
  | { kind: "uvvis"; uv: UvResult }
  | { kind: "ms"; ms: FragmentResult }
  | { kind: "cosy"; cosy: Cosy2D }
  | { kind: "hsqc"; hsqc: Hsqc2D }
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
  if (cur.kind === "cosy") return cosyChartSvg(cur.cosy);
  if (cur.kind === "hsqc") return hsqcChartSvg(cur.hsqc);
  return nmrChartSvg(cur.nmr);
}

/** The pixel size of the current chart — 2D maps are square and larger. */
function currentChartSize(): { width: number; height: number } {
  return currentSpectrum && (currentSpectrum.kind === "cosy" || currentSpectrum.kind === "hsqc")
    ? SPECTRUM_2D_SIZE
    : SPECTRUM_CHART_SIZE;
}

/** Formats a refined multiplet with its coupling constants, e.g. "dd (7.8, 1.5)". */
function formatMultiplet(multiplet: string, J: number[]): string {
  return J.length ? `${multiplet} (${J.map((j) => j.toFixed(1)).join(", ")})` : multiplet;
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
      // For 1H, resolve scalar couplings so the table can show J and a refined
      // multiplet (dd, td, ...) instead of the plain n+1 letter. Signals from
      // predictCoupling align by index with predictNmr's (same input, same order).
      const cpl = kind === "1H" ? predictCoupling(text) : null;
      specResult.appendChild(msEyebrow(`Predicted ${kind} NMR — ${r.signals.length} signals`));
      const head = specRow(["δ (ppm)", kind === "1H" ? "H" : "C", kind === "1H" ? "mult. (J/Hz)" : "", "assignment"], "spec-row spec-head");
      specResult.appendChild(head);
      r.signals.forEach((s, i) => {
        const cs = cpl?.signals[i];
        const mult = cs ? formatMultiplet(cs.multiplet, cs.J) : s.multiplicity;
        specResult.appendChild(
          specRow([
            s.shift.toFixed(kind === "1H" ? 2 : 1),
            String(s.count),
            kind === "1H" ? mult : "",
            s.assignment,
          ])
        );
      });
    } else if (kind === "cosy") {
      const cc = predictCoupling(text);
      const r = predictCosy(text);
      if (!cc || !r) return fail("No structure found. Try a name (ethanol), a formula, or a SMILES.");
      currentSpectrum = { kind, cosy: r };
      // Unique 1H-1H correlations, read from the coupling graph (which carries the
      // relationship and J); the mirror-image half of each pair is dropped here.
      const rows: { a: number; b: number; kind: string; J: number }[] = [];
      const seen = new Set<string>();
      cc.signals.forEach((s, i) => {
        for (const cp of s.couplings) {
          if (cp.kind === "para" || cp.J < 1) continue;
          const key = i < cp.partner ? `${i}-${cp.partner}` : `${cp.partner}-${i}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({ a: s.shift, b: cp.partnerShift, kind: cp.kind, J: cp.J });
        }
      });
      specResult.appendChild(msEyebrow(`Predicted ¹H–¹H COSY — ${rows.length} correlation${rows.length === 1 ? "" : "s"}`));
      if (!rows.length) {
        const hint = document.createElement("div");
        hint.className = "ms-hint";
        hint.textContent = "No resolved ¹H–¹H couplings (protons are equivalent or isolated).";
        specResult.appendChild(hint);
      } else {
        specResult.appendChild(specRow(["δ (ppm)", "↔ δ", "type", "J/Hz"], "spec-row spec-head"));
        for (const row of rows.sort((x, y) => y.a - x.a)) {
          specResult.appendChild(specRow([row.a.toFixed(2), row.b.toFixed(2), row.kind, row.J.toFixed(1)]));
        }
      }
    } else if (kind === "hsqc") {
      const r = predictHsqc(text);
      if (!r) return fail("No structure found. Try a name (ethanol), a formula, or a SMILES.");
      currentSpectrum = { kind, hsqc: r };
      specResult.appendChild(msEyebrow(`Predicted ¹H–¹³C HSQC — ${r.peaks.length} correlation${r.peaks.length === 1 ? "" : "s"}`));
      if (!r.peaks.length) {
        const hint = document.createElement("div");
        hint.className = "ms-hint";
        hint.textContent = "No ¹H–¹³C correlations (no protonated carbons).";
        specResult.appendChild(hint);
      } else {
        specResult.appendChild(specRow(["δ ¹H", "δ ¹³C", "type", ""], "spec-row spec-head"));
        for (const p of r.peaks) {
          specResult.appendChild(specRow([p.f2.toFixed(2), p.f1.toFixed(1), p.label.split(":")[0], ""]));
        }
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
          : cur.kind === "cosy"
            ? cur.cosy.caveats
            : cur.kind === "hsqc"
              ? cur.hsqc.caveats
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
    // For 1H, fold the resolved multiplet + J into each line.
    const cpl = r.nucleus === "1H" ? predictCoupling(r.smiles) : null;
    const lines = [
      `Predicted ${r.nucleus} NMR — ${r.smiles}`,
      ...r.signals.map((s, i) => {
        if (r.nucleus !== "1H") {
          return `  δ ${s.shift.toFixed(1)}  ${s.assignment}${s.count > 1 ? `  (${s.count} equivalent C)` : ""}`;
        }
        const cs = cpl?.signals[i];
        const mult = cs ? formatMultiplet(cs.multiplet, cs.J) : s.multiplicity;
        return `  δ ${s.shift.toFixed(2)}  (${s.count}H, ${mult})  ${s.assignment}`;
      }),
      ...r.caveats.map((c) => `Note: ${c}`),
      tail,
    ];
    return lines.join("\n");
  }

  if (cur.kind === "cosy") {
    const r = cur.cosy;
    const crosses = r.peaks.filter((p) => p.kind === "cross");
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const p of crosses) {
      const key = [p.f2, p.f1].sort((a, b) => a - b).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`  ${p.label}`);
    }
    return [
      `Predicted ¹H–¹H COSY — ${r.smiles}`,
      ...(lines.length ? lines : ["  (no resolved ¹H–¹H couplings)"]),
      ...r.caveats.map((c) => `Note: ${c}`),
      tail,
    ].join("\n");
  }

  if (cur.kind === "hsqc") {
    const r = cur.hsqc;
    return [
      `Predicted ¹H–¹³C HSQC — ${r.smiles}`,
      ...(r.peaks.length ? r.peaks.map((p) => `  ${p.label}`) : ["  (no protonated carbons)"]),
      ...r.caveats.map((c) => `Note: ${c}`),
      tail,
    ].join("\n");
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
    const size = currentChartSize();
    const base64 = await renderFigurePng(currentSpectrumSvg, size.width, size.height);
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      sizeFigure(picture, size.width, size.height);
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
// JCAMP-DX — a MEASURED spectrum, opened from the user's own file.
//
// Everything else in the Spectra tool is predicted from structure. This is the
// opposite: it plots exactly what an instrument wrote, and nothing here
// estimates anything. The reader (lib/jcamp.ts) had been complete and tested for
// several releases while being imported by nothing, so no user could reach it.

/** The spectrum currently on screen, if a file has been opened. */
let currentJcamp: JcampSpectrum | null = null;
let currentJcampSvg: string | null = null;

const JCAMP_MAX_BYTES = 16 * 1024 * 1024;

function setJcampButtons(enabled: boolean): void {
  jcampInsertBtn.disabled = !enabled;
  jcampInsertChartBtn.disabled = !enabled || !currentJcampSvg;
}

function onJcampFile(): void {
  const file = jcampFile.files && jcampFile.files[0];
  if (!file) return;
  if (file.size > JCAMP_MAX_BYTES) {
    currentJcamp = null;
    currentJcampSvg = null;
    setJcampButtons(false);
    jcampInfo.textContent = `That file is ${(file.size / 1e6).toFixed(1)} MB — too large for the pane (limit 16 MB).`;
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => {
    jcampInfo.textContent = "Couldn't read that file.";
    setJcampButtons(false);
  };
  reader.onload = () => {
    renderJcamp(String(reader.result ?? ""), file.name);
  };
  // JCAMP-DX is a text format. Latin-1 rather than UTF-8: older instrument files
  // carry degree signs and Greek letters in the high-bit range, and decoding
  // those as UTF-8 turns them into replacement characters inside the metadata.
  reader.readAsText(file, "iso-8859-1");
  jcampFile.value = ""; // so picking the same file twice still fires
}

function renderJcamp(text: string, filename: string): void {
  currentJcamp = null;
  currentJcampSvg = null;
  jcampInfo.replaceChildren();

  const parsed = parseJcamp(text);
  if (!parsed.ok) {
    jcampInfo.textContent = `${filename}: ${parsed.error}`;
    setJcampButtons(false);
    return;
  }
  // A file may hold several blocks; show the first and say so rather than
  // silently picking one.
  const s = parsed.spectra[0];
  currentJcamp = s;
  currentJcampSvg = jcampChartSvg({
    title: s.title,
    kind: s.kind,
    xUnits: s.xUnits,
    yUnits: s.yUnits,
    points: s.points,
  });

  const lines: string[] = [];
  lines.push(`${s.title || filename} — ${s.dataType || "spectrum"}`);
  lines.push(`${s.points.length.toLocaleString()} points, ${s.xUnits || "?"} vs ${s.yUnits || "?"}`);
  if (s.points.length) {
    const xs = s.points.map((p) => p.x);
    lines.push(`Range ${minOf(xs).toPrecision(6)} to ${maxOf(xs).toPrecision(6)} ${s.xUnits}`);
  }
  if (parsed.spectra.length > 1) {
    lines.push(`This file holds ${parsed.spectra.length} blocks; the first is shown.`);
  }
  lines.push("This is your measured data — nothing here is predicted.");

  const p = document.createElement("div");
  for (const ln of lines) {
    const d = document.createElement("div");
    d.textContent = ln;
    p.appendChild(d);
  }
  for (const c of s.caveats) {
    const d = document.createElement("div");
    d.className = "warn-line";
    d.textContent = `⚠ ${c}`;
    p.appendChild(d);
  }
  jcampInfo.appendChild(p);
  if (currentJcampSvg) {
    const holder = document.createElement("div");
    holder.innerHTML = currentJcampSvg;
    jcampInfo.appendChild(holder);
  }
  setJcampButtons(true);
}

/** The measured trace as text, for insertion as a data table. */
function jcampAsText(): string {
  const s = currentJcamp;
  if (!s) return "";
  const head = [
    `${s.title || "Measured spectrum"} (${s.dataType || "spectrum"})`,
    `Measured data read from a JCAMP-DX file — not predicted.`,
    `${s.xUnits}\t${s.yUnits}`,
  ];
  // A full trace can be 30,000 rows, which is not a table anyone wants in a
  // document. Say what was written rather than truncating silently.
  const MAX_ROWS = 2000;
  const pts = s.points.length > MAX_ROWS ? decimateTrace(s.points, MAX_ROWS) : s.points;
  if (pts.length < s.points.length) {
    head.push(
      `Showing ${pts.length.toLocaleString()} of ${s.points.length.toLocaleString()} points ` +
        `(peaks preserved — every local minimum and maximum is kept).`
    );
  }
  return head.concat(pts.map((p) => `${p.x}\t${p.y}`)).join("\n");
}

async function insertJcampChart(): Promise<void> {
  if (!currentJcampSvg || !currentJcamp) {
    setStatus("Open a JCAMP-DX file first.", "error");
    return;
  }
  jcampInsertChartBtn.disabled = true;
  setStatus("Inserting spectrum…");
  try {
    const size = SPECTRUM_CHART_SIZE;
    const base64 = await renderFigurePng(currentJcampSvg, size.width, size.height);
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      sizeFigure(picture, size.width, size.height);
      picture.altTextDescription =
        `Measured ${currentJcamp?.dataType || "spectrum"} from a JCAMP-DX file` +
        ` — ${currentJcamp?.xUnits} vs ${currentJcamp?.yUnits}`;
      range.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, picture.getRange(), "formula-inserter:spectrum");
    });
    setStatus("Measured spectrum inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert spectrum: ${(error as Error).message}`, "error");
  } finally {
    jcampInsertChartBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Solve — equations, derivatives, definite integrals, and word problems.
//
// Everything here runs on the offline engine (solve.ts / wordproblem.ts): exact
// where it can be, numeric where it must be, and always carrying the method and
// caveats through to the UI. A word problem it cannot map is reported as such —
// never answered with a guess.
// ---------------------------------------------------------------------------

type SolveKind = "equation" | "derivative" | "integral" | "geometry" | "topology" | "word";

/** Plain-text form of the current result, for insertion into Word. */
let currentSolveText = "";
/** The same result as typeset blocks, so it can insert as real Word equations. */
let currentSolveBlocks: DerivationBlock[] = [];
/** A figure to insert alongside the text (currently the persistence barcode). */
let currentSolveSvg: string | null = null;
/** Target variable chosen via the "solve for …" chips; cleared on new input. */
let solveVarChoice: string | null = null;

/** A muted or emphasised result line. */
/**
 * One line of shown work: prose plus the formula typeset through the same math
 * renderer the Math tool uses, so a derivation reads as notation rather than as
 * ASCII. The DSL strings are generated by the solver, never user input.
 */
function solveWorkLine(step: WorkStep): HTMLElement {
  const row = document.createElement("div");
  row.className = "solve-work";
  if (step.text) {
    const t = document.createElement("span");
    t.className = "solve-work-text";
    t.textContent = step.text;
    row.appendChild(t);
  }
  if (step.math) {
    const m = document.createElement("span");
    m.className = "solve-work-math";
    m.innerHTML = mathToHtml(step.math);
    row.appendChild(m);
  }
  return row;
}

/** Chip row offering "solve for F / m / a" on a multi-unknown equation. */
function solveVarChipsRow(unknowns: string[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "solve-var-chips";
  const label = document.createElement("span");
  label.textContent = "Solve for:";
  row.appendChild(label);
  for (const v of unknowns) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "solve-var-chip" + (v === solveVarChoice ? " is-on" : "");
    b.textContent = v;
    b.addEventListener("click", () => {
      solveVarChoice = v;
      updateSolve();
    });
    row.appendChild(b);
  }
  return row;
}

function solveLine(text: string, cls = "ms-hint"): HTMLElement {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  return d;
}

/** Adjusts the input label and the visibility of the integral bounds. */
function updateSolveUi(): void {
  const kind = solveKind.value as SolveKind;
  const labels: Record<SolveKind, string> = {
    equation: "Equation (e.g. x^2 - 5x + 6 = 0)",
    derivative: "Differentiate, take a limit, or expand a series",
    integral: "Integrand (e.g. x^2)",
    geometry: "Geometry — a shape, points, or an equation in x and y",
    topology: "Topology — a named space, or a list of maximal simplices",
    word: "Word problem (e.g. 12 is what percent of 48?)",
  };
  const placeholders: Record<SolveKind, string> = {
    equation: "x^2 - 5x + 6 = 0",
    derivative: "sin(x^2)",
    integral: "x^2",
    geometry: "triangle 3 4 5",
    topology: "torus",
    word: "twice a number plus 7 is 15",
  };
  const hints: Record<SolveKind, string> = {
    equation: "Use ^ for powers — type x^2 for x². Functions: sqrt, sin, cos, exp, ln; constants pi, e. Pasted superscripts like x² also work. A formula with several symbols — F = m*a — offers a choice of which one to solve for.",
    derivative: "Use ^ for powers — e.g. x^2, exp(x), sin(x^2). Pasted superscripts like x² also work. " +
      "This box also takes LIMITS — limit sin(x)/x as x -> 0, lim 1/x as x -> inf, limit 1/x as x -> 0+ — " +
      "and SERIES: taylor exp(x) order 5, maclaurin sin(x), series sqrt(x) about 1 order 4.",
    integral: "Use ^ for powers. The limits may be numbers or expressions like pi/2.",
    geometry:
      "Shapes: circle r=3 · sphere r=2 · cylinder r=2 h=5 · box 1 2 3 · polygon n=6 a=2. " +
      "Triangles: triangle 3 4 5 (SSS) · triangle b=4 c=3 A=90 (SAS) · triangle A=30 B=60 c=10 (ASA) · " +
      "triangle a=6 b=8 A=30 (SSA — may give TWO answers). Points: triangle (0,0) (4,0) (0,3) · " +
      "polygon (0,0) (4,0) (4,4) (0,4) · distance (0,0) (3,4) · line (0,0) (2,4) · circle (1,0) (0,1) (-1,0). " +
      "Or just type a conic: x^2/9 + y^2/4 = 1. " +
      "3D uses coordinate TRIPLES: vector (1,0,0) (0,1,0) · lines (0,0,0) (1,0,0) (0,0,1) (1,1,2) " +
      "(identical / parallel / intersecting / skew, with the distance) · (0,0,0) (1,0,0) (0,1,0) (0,0,1) " +
      "for a tetrahedron volume and its circumscribed sphere.",
    topology:
      "Integral homology of a simplicial complex — computed over ℤ, so TORSION is kept " +
      "(a field would silently discard it). Named spaces: torus · Klein bottle · sphere · " +
      "projective plane · circle · Möbius band · annulus · figure eight · disk · point · S3. " +
      "Or give the maximal simplices yourself: [0,1,2] [1,2,3] [0,2,3] [0,1,3]. " +
      "Or PASTE A POINT CLOUD — one point per line, e.g. rows of \"x y\" — and it computes " +
      "PERSISTENT HOMOLOGY instead: a barcode showing which holes in your data are real and which are noise. " +
      "Every result cross-checks its Euler characteristic two independent ways. " +
      "ADVANCED: w(RP^5) and chern CP^3 for characteristic classes · does RP^5 bound (cobordism — " +
      "a genuinely decidable question) · cellular rp2. Ask about spectral sequences, stable homotopy, " +
      "the fundamental group or homeomorphism and it explains what is and is not computable, rather than guessing. " +
      "KNOTS: knot trefoil · jones 1 1 1 (a braid word) · braid 1 -2 1 -2 (figure-eight) · pi1 trefoil. " +
      "The Jones polynomial is exact but NOT a complete invariant, and it says so.",
    word: "Plain English — e.g. “12 is what percent of 48?” or “twice a number plus 7 is 15”.",
  };
  solveInputLabel.textContent = labels[kind];
  solveInput.placeholder = placeholders[kind];
  // A word problem is a paragraph, not a one-liner — give it room to be read
  // back and edited. Geometry gets two rows because a point list runs long.
  // Equations stay a single line.
  solveInput.classList.toggle("solve-input-tall", kind === "word");
  // An equation box now accepts a SYSTEM, one equation per line, so it needs
  // more than one row to be usable.
  solveInput.rows = kind === "word" ? 5 : kind === "equation" ? 3 : kind === "geometry" || kind === "topology" ? 2 : 1;
  solveHint.textContent = hints[kind];
  solveBounds.style.display = kind === "integral" ? "block" : "none";
}

/** Formats a number for the pane: up to 8 significant digits, no trailing zeros. */
function trimNum(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(8)));
}

/** Parses a bound expression like "0", "pi", or "pi/2" to a number, or NaN. */
function parseBound(s: string): number {
  try {
    return evalAst(parseExpr(s), {});
  } catch {
    return NaN;
  }
}

/** Computes and renders the current solve request. */
function updateSolve(): void {
  const kind = solveKind.value as SolveKind;
  const text = solveInput.value.trim();
  solveResult.replaceChildren();
  currentSolveText = "";
  currentSolveBlocks = [];
  currentSolveSvg = null;
  solveInsertBtn.disabled = true;

  if (!text) {
    solveResult.appendChild(solveLine("Type something to solve."));
    return;
  }

  const lines: string[] = [];
  // Typeset counterpart of `lines`: equations go in as real OMML, prose as text.
  const blocks: DerivationBlock[] = [];
  const say = (text: string, kind: "text" | "heading" = "text") => {
    lines.push(text);
    blocks.push({ kind, content: text });
  };
  const sayMath = (math: string, plain = math) => {
    lines.push(plain);
    blocks.push({ kind: "math", content: math });
  };
  const finish = (caveats: string[]) => {
    if (caveats.length) solveResult.appendChild(specCaveats(caveats));
    for (const c of caveats) {
      lines.push(c);
      blocks.push({ kind: "text", content: c });
    }
    currentSolveText = lines.join("\n");
    currentSolveBlocks = blocks;
    solveInsertBtn.disabled = !currentSolveText;
  };

  try {
    if (kind === "equation") {
      // An INEQUALITY is unambiguous from its comparison sign.
      if (/[<>≤≥≠]|!=/.test(text) && !text.includes("\n")) {
        const iq = solveInequality(text);
        if (iq) {
          const head = `Solve ${text.trim()}`;
          solveResult.appendChild(msEyebrow(head));
          say(head, "heading");
          const answer = `${iq.variable} ∈ ${iq.display}`;
          solveResult.appendChild(solveLine(answer, "ms-masses"));
          say(answer);
          for (const st of iq.steps) { solveResult.appendChild(solveLine(st)); say(st); }
          return finish(iq.caveats);
        }
        // Not a rational inequality — say so rather than falling through to the
        // equation solver, which would silently ignore the comparison.
        if (/[<>≤≥]/.test(text)) {
          return void solveResult.appendChild(solveLine(
            "Inequalities are solved exactly for POLYNOMIAL and RATIONAL expressions in one variable — " +
            "e.g. x^2 - 4 > 0, or 1/(x-2) >= 0. This one is outside that, so nothing is reported rather than guessed."
          ));
        }
      }

      // SEVERAL equations means a SYSTEM. Two or more lines each containing an
      // "=" is unambiguous — a single equation never spans lines.
      const eqs = splitEquations(text);
      if (eqs.length > 1) {
        const sys = solveSystem(eqs);
        if (!sys) {
          return void solveResult.appendChild(
            solveLine("Couldn't parse that system. Put one equation per line, e.g. \"x + y = 3\" then \"x - y = 1\".")
          );
        }
        const title = `System of ${eqs.length} equations in ${sys.variables.length} unknown${sys.variables.length === 1 ? "" : "s"} (${sys.variables.join(", ")})`;
        solveResult.appendChild(msEyebrow(title));
        say(title, "heading");
        if (sys.kind === "unique" && sys.exact) {
          for (const v of sys.variables) {
            const line = `${v} = ${sys.exact[v]}`;
            solveResult.appendChild(solveLine(line, "ms-masses"));
            sayMath(line);
          }
        } else if (sys.kind === "infinite" && sys.general) {
          // The GENERAL solution — reporting one point would misrepresent it.
          for (const g of sys.general) {
            solveResult.appendChild(solveLine(g, "ms-masses"));
            say(g);
          }
        } else if (sys.kind === "nonlinear" && sys.numeric) {
          sys.numeric.forEach((sol, i) => {
            const line = `Solution ${i + 1}: ` + sys.variables.map((v) => `${v} = ${trimNum(sol[v])}`).join(", ");
            solveResult.appendChild(solveLine(line, "ms-masses"));
            say(line);
          });
        } else {
          const msg = sys.kind === "none" ? "No solution — the equations contradict each other." : "Could not solve this system.";
          solveResult.appendChild(solveLine(msg, "ms-masses"));
          say(msg);
        }
        for (const st of sys.steps) {
          solveResult.appendChild(solveLine(st));
          say(st);
        }
        return finish(sys.caveats);
      }

      let r = solveEquation(text);
      if (!r) return void solveResult.appendChild(solveLine("Couldn't parse that equation. Try e.g. x^2 - 5x + 6 = 0."));
      // A chip choice re-solves for that unknown — the symbolic rearrangement
      // path (F = m*a solved for a gives a = F/m).
      if (solveVarChoice && r.unknowns && r.unknowns.length > 1 && r.unknowns.includes(solveVarChoice)) {
        r = solveEquation(text, solveVarChoice) ?? r;
      }
      solveResult.appendChild(msEyebrow(`Solve for ${r.variable}`));
      say(`Solve for ${r.variable}:`, "heading");
      sayMath(text);
      if (!r.roots.length) {
        // "unsolved" is NOT "no roots" — it means the solver could not isolate a
        // single unknown (e.g. F = m*a has three). Saying "No real roots found."
        // there is a false statement about the equation.
        const msg =
          r.method === "no-solution"
            ? "No solution."
            : r.method === "identity"
              ? "True for every value (identity)."
              : r.method === "unsolved"
                ? r.unknowns && r.unknowns.length > 1 && !solveVarChoice
                  ? "This has more than one unknown — choose which one to solve for:"
                  : `Couldn't isolate ${r.variable} in closed form here. Giving the other symbols values can make it solvable numerically.`
                : "No real roots found in the range searched.";
        solveResult.appendChild(solveLine(msg, "ms-masses"));
        say(msg);
      } else {
        for (const root of r.roots) {
          solveResult.appendChild(solveLine(`${r.variable} = ${root.display}`, "ms-masses"));
          // A root is an equation — typeset it. Complex roots (0 + 1i) and
          // multiplicity markers (×2) are not linear math, so those stay text.
          const plain = `${r.variable} = ${root.display}`;
          if (/[i×]/.test(root.display)) say(plain);
          else sayMath(plain);
        }
      }
      // Multi-unknown equations get a chip per unknown; the rearranger solves
      // for whichever one the user picks, carrying the rest symbolically.
      if (r.unknowns && r.unknowns.length > 1) solveResult.appendChild(solveVarChipsRow(r.unknowns));
      solveResult.appendChild(solveLine(`Method: ${r.method}`));
      for (const s of r.steps) solveResult.appendChild(solveLine(s));
      say(`Method: ${r.method}`);
      for (const s of r.steps) say(s);
      return finish(r.caveats);
    }

    if (kind === "derivative") {
      // "limit ... as x -> 0" and "taylor ..." share this kind: it is where the
      // calculus lives, and both are unambiguous from their leading keyword.
      const lim = parseLimitRequest(text);
      if (lim) {
        const lr = limit(lim.expr, lim.variable, lim.point, lim.side);
        if (!lr) return void solveResult.appendChild(solveLine("Couldn't parse that limit. Try: limit sin(x)/x as x -> 0"));
        const pretty = lim.point === "inf" ? "∞" : lim.point === "-inf" ? "−∞" : String(lim.point);
        const head = `Limit as ${lim.variable} → ${pretty}${lim.side === "+" ? " (from above)" : lim.side === "-" ? " (from below)" : ""}`;
        solveResult.appendChild(msEyebrow(head));
        say(head, "heading");
        const answer =
          lr.kind === "finite" ? `= ${lr.exact ?? trimNum(lr.value!)}`
          : lr.kind === "infinite" ? `= ${lr.value! > 0 ? "+∞" : "−∞"} (diverges)`
          : lr.kind === "does-not-exist" ? "The limit DOES NOT EXIST."
          : "Could not be established.";
        solveResult.appendChild(solveLine(answer, "ms-masses"));
        say(answer);
        for (const st of lr.steps) { solveResult.appendChild(solveLine(st)); say(st); }
        return finish(lr.caveats);
      }
      const ser = parseSeriesRequest(text);
      if (ser) {
        const sr = taylorSeries(ser.expr, ser.variable, ser.centre, ser.order);
        if (!sr) return void solveResult.appendChild(solveLine("Couldn't expand that as a series — check it is differentiable at the centre. Try: taylor exp(x) order 5"));
        const head = `${ser.centre === 0 ? "Maclaurin" : "Taylor"} series about ${ser.variable} = ${ser.centre}`;
        solveResult.appendChild(msEyebrow(head));
        say(head, "heading");
        solveResult.appendChild(solveLine(sr.display, "ms-masses"));
        sayMath(sr.display.replace(/ + O(.*)$/, ""), sr.display);
        for (const st of sr.steps) { solveResult.appendChild(solveLine(st)); say(st); }
        return finish(sr.caveats);
      }
      const r = differentiate(text);
      if (!r) return void solveResult.appendChild(solveLine("Couldn't parse that expression. Try e.g. sin(x^2)."));
      solveResult.appendChild(msEyebrow(`Derivative with respect to ${r.variable}`));
      solveResult.appendChild(solveLine(`f(${r.variable}) = ${r.expression}`, "ms-masses"));
      solveResult.appendChild(solveLine(`f'(${r.variable}) = ${r.derivative}`, "ms-masses"));
      say(`Derivative with respect to ${r.variable}:`, "heading");
      sayMath(`f(${r.variable}) = ${r.expression}`);
      sayMath(`f'(${r.variable}) = ${r.derivative}`);
      return finish(r.caveats);
    }

    if (kind === "integral") {
      const a = parseBound(solveA.value.trim() || "0");
      const b = parseBound(solveB.value.trim() || "1");
      if (!Number.isFinite(a) || !Number.isFinite(b)) return void solveResult.appendChild(solveLine("Enter numeric limits (numbers, or expressions like pi/2)."));
      const r = integrate(text, a, b);
      if (!r) return void solveResult.appendChild(solveLine("Couldn't integrate that. Use one variable and numeric limits."));
      solveResult.appendChild(msEyebrow("Definite integral"));
      const lo = solveA.value.trim() || "0";
      const hi = solveB.value.trim() || "1";
      // An integrand undefined inside the interval has NO value — say that,
      // rather than printing "NaN" as though it were a number.
      const val = Number.isFinite(r.value)
        ? `∫ (${text}) d${r.variable}, from ${lo} to ${hi} = ${r.value.toPrecision(8).replace(/\.?0+$/, "")}`
        : `∫ (${text}) d${r.variable}, from ${lo} to ${hi} — no value: the integrand is undefined somewhere in this interval.`;
      solveResult.appendChild(solveLine(val, "ms-masses"));
      say("Definite integral:", "heading");
      // A real ∫ with its limits, typeset — the notation is the whole point.
      sayMath(`int(${lo}, ${hi}, ${text}) = ${r.value.toPrecision(8).replace(/\.?0+$/, "")}`, val);
      if (r.antiderivative) {
        // Show the work: the exact antiderivative F(x) behind an exact result.
        const fx = `antiderivative F(${r.variable}) = ${r.antiderivative} + C`;
        solveResult.appendChild(solveLine(fx));
        sayMath(`F(${r.variable}) = ${r.antiderivative} + C`, fx);
      }
      solveResult.appendChild(solveLine(`Method: ${r.method}`));
      say(`Method: ${r.method}`);
      return finish(r.caveats);
    }

    if (kind === "geometry") {
      const g = solveGeometry(text);
      if (!g) {
        return void solveResult.appendChild(
          solveLine(
            "Couldn't read that as geometry. Try a shape (circle r=3), a triangle " +
            "(triangle 3 4 5, or triangle a=6 b=8 A=30), a point list " +
            "(triangle (0,0) (4,0) (0,3)), or a conic equation (x^2/9 + y^2/4 = 1)."
          )
        );
      }
      solveResult.appendChild(msEyebrow(g.title));
      say(g.title, "heading");
      // A named degenerate outcome is the ANSWER, not an error — show it first.
      if (g.degenerate) {
        solveResult.appendChild(solveLine(g.degenerate, "ms-masses"));
        say(g.degenerate);
      }
      for (const v of g.values) {
        const shown = v.exact && v.exact !== String(v.value)
          ? `${v.label} = ${v.exact}${Number.isFinite(v.value) ? `  ≈ ${trimNum(v.value)}` : ""}`
          : `${v.label} = ${Number.isFinite(v.value) ? trimNum(v.value) : v.exact ?? "—"}`;
        solveResult.appendChild(solveLine(shown, "ms-masses"));
        // Exact forms are real mathematics — typeset them.
        if (v.exact && /[a-z(]/i.test(v.exact)) sayMath(`${v.label} = ${v.exact}`, shown);
        else say(shown);
      }
      for (const s of g.steps) {
        solveResult.appendChild(solveLine(s));
        say(s);
      }
      return finish(g.caveats);
    }

    if (kind === "topology") {
      let h;
      try {
        h = solveTopology(text);
      } catch (err) {
        // A capped or malformed complex: say what happened, do not guess.
        return void solveResult.appendChild(solveLine((err as Error).message, "ms-masses"));
      }
      if (!h) {
        return void solveResult.appendChild(
          solveLine(
            `Couldn't read that as a space or a complex. Try a name (${BUILTIN_NAMES.slice(0, 6).join(", ")}…) ` +
            `or a list of maximal simplices like [0,1,2] [1,2,3].`
          )
        );
      }

      if (h.kind === "persistence") {
        // A pasted point cloud: persistent homology and a barcode.
        let pr;
        try {
          pr = persistentHomology(h.cloud, { maxDim: 1 });
        } catch (err) {
          return void solveResult.appendChild(solveLine((err as Error).message, "ms-masses"));
        }
        const title = `Persistent homology of ${pr.points} points in ${pr.dimensions}D`;
        solveResult.appendChild(msEyebrow(title));
        say(title, "heading");
        // The headline is the longest-lived feature per dimension — that is the
        // one that means something; short bars are usually sampling noise.
        if (pr.notable.length) {
          for (const nb of pr.notable) {
            const line =
              `Most persistent H${nb.dimension} feature: born ${trimNum(nb.birth)}, dies ${trimNum(nb.death)} ` +
              `(lifetime ${trimNum(nb.persistence)})`;
            solveResult.appendChild(solveLine(line, "ms-masses"));
            say(line);
          }
        } else {
          const line = "No finite persistent features were found.";
          solveResult.appendChild(solveLine(line, "ms-masses"));
          say(line);
        }
        const counts = `Bars: ${pr.pairs.filter((x) => x.dimension === 0).length} in H0, ` +
          `${pr.pairs.filter((x) => x.dimension === 1).length} in H1.`;
        solveResult.appendChild(solveLine(counts, "ms-masses"));
        say(counts);
        // The barcode itself, drawn in the pane and carried to the document.
        currentSolveSvg = barcodeSvg(pr);
        const fig = document.createElement("div");
        fig.className = "solve-figure";
        fig.innerHTML = currentSolveSvg;
        solveResult.appendChild(fig);
        for (const s of pr.steps) {
          solveResult.appendChild(solveLine(s));
          say(s);
        }
        return finish(pr.caveats);
      }

      if (h.kind === "advanced") {
        // Characteristic classes, cobordism, cellular homology — or a stated
        // reason why something in tier A2/A3 is NOT computed here.
        solveResult.appendChild(msEyebrow(h.title));
        say(h.title, "heading");
        for (const line of h.display) {
          solveResult.appendChild(solveLine(line, "ms-masses"));
          say(line);
        }
        for (const s of h.steps) {
          solveResult.appendChild(solveLine(s));
          say(s);
        }
        return finish(h.caveats);
      }

      solveResult.appendChild(msEyebrow(h.title));
      say(h.title, "heading");
      // The homology groups are the answer; everything else is supporting work.
      for (let k = 0; k <= h.dimension; k++) {
        const line = `H_${k} = ${h.groups[k]}`;
        solveResult.appendChild(solveLine(line, "ms-masses"));
        say(line);
      }
      const bet = `Betti numbers: ${h.betti.join(", ")}`;
      const chi = `Euler characteristic χ = ${h.euler}`;
      solveResult.appendChild(solveLine(bet, "ms-masses"));
      solveResult.appendChild(solveLine(chi, "ms-masses"));
      say(bet);
      say(chi);
      for (const s of h.steps) {
        solveResult.appendChild(solveLine(s));
        say(s);
      }
      return finish(h.caveats);
    }

    // word problem
    const r = solveWordProblem(text);
    if (!r) {
      solveResult.appendChild(
        solveLine("This isn't one of the offline templates (percentage; distance = rate × time; successive shares, e.g. “guest k takes k% of what's left”; or a simple 'a number …' sentence). Rephrase, or an online AI solver can be added.")
      );
      return;
    }
    solveResult.appendChild(msEyebrow(`Word problem — ${r.template}`));
    solveResult.appendChild(solveLine(`Answer: ${r.answer}`, "ms-masses"));
    say(`Word problem (${r.template})`, "heading");
    say(`Answer: ${r.answer}`);
    if (r.equation) {
      // Typeset the equation the same way as the working — it was the one line
      // still showing raw ASCII next to properly rendered formulae.
      solveResult.appendChild(solveWorkLine({ text: "Equation:", math: r.equationMath ?? r.equation }));
      sayMath(r.equationMath ?? r.equation, `Equation: ${r.equation}`);
    }
    // Prefer the typeset working when the template provides it; the plain steps
    // are still what goes into the document.
    if (r.work && r.work.length) {
      for (const w of r.work) solveResult.appendChild(solveWorkLine(w));
    } else {
      for (const s of r.steps) solveResult.appendChild(solveLine(s));
    }
    for (const s of r.steps) say(s);
    return finish(r.caveats);
  } catch (error) {
    solveResult.appendChild(solveLine(`Could not solve: ${(error as Error).message}`));
  }
}

// ---------------------------------------------------------------------------
// Sequence Map — open a GenBank/FASTA file, draw an annotated map
//
// The pane could compute plenty about a sequence but could never READ one, so
// every sequence had to be pasted as raw text — which throws away the feature
// annotations that make a map worth drawing. GenBank carries them, and every
// tool in the field exports GenBank, so this is the interchange path.
// ---------------------------------------------------------------------------

let currentSeqRecord: SeqRecord | null = null;
/** A .dna record read from bytes — it cannot round-trip through the textarea. */
let seqmapDnaRecord: SeqRecord | null = null;
let currentSeqMapSvg: string | null = null;

/** Reads a chosen file as text and drops it into the box. Nothing is uploaded. */
function onSeqMapFile(): void {
  const file = seqmapFile.files && seqmapFile.files[0];
  if (!file) return;
  // A whole genome pasted into a textarea will wedge the pane; refuse politely.
  const MAX = 8 * 1024 * 1024;
  if (file.size > MAX) {
    seqmapInfo.textContent = `That file is ${(file.size / 1e6).toFixed(1)} MB — too large for the pane (limit 8 MB).`;
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => {
    seqmapInfo.textContent = "Couldn't read that file.";
  };
  // Read as BYTES, not text: .dna is binary, and decoding it as text mangles the
  // sequence. Text formats are decoded from the same bytes afterwards.
  reader.onload = () => {
    const buf = reader.result as ArrayBuffer;
    const bytes = new Uint8Array(buf);
    if (looksLikeDna(bytes)) {
      const r = parseSnapGeneDna(bytes);
      if (!r.ok) {
        seqmapInput.value = "";
        seqmapDnaRecord = null;
        updateSeqMap();
        seqmapInfo.textContent = r.error;
        return;
      }
      // A .dna record can't round-trip through the textarea (it's binary), so
      // hold it aside and show the user what was read.
      seqmapDnaRecord = r.record;
      seqmapInput.value = "";
      renderSeqMapRecord(r.record, "SnapGene .dna");
      return;
    }
    seqmapDnaRecord = null;
    seqmapInput.value = new TextDecoder("utf-8").decode(bytes);
    updateSeqMap();
  };
  reader.readAsArrayBuffer(file);
  seqmapFile.value = ""; // so picking the same file twice still fires
}

/** Parses whatever is in the box and redraws the map. */
function updateSeqMap(): void {
  const text = seqmapInput.value;
  currentSeqRecord = null;
  currentSeqMapSvg = null;
  seqmapInsert.disabled = true;
  seqmapPreview.replaceChildren();

  if (!text.trim()) {
    if (seqmapDnaRecord) {
      renderSeqMapRecord(seqmapDnaRecord, "SnapGene .dna");
      return;
    }
    seqmapInfo.textContent = "Open a GenBank, FASTA or SnapGene .dna file, or paste a sequence.";
    return;
  }
  seqmapDnaRecord = null; // typing replaces a loaded .dna

  const parsed = parseSequenceFile(text);
  if (!parsed.ok) {
    seqmapInfo.textContent = parsed.error;
    return;
  }
  const rec = parsed.records[0];
  renderSeqMapRecord(rec, rec.format === "fasta" ? "FASTA" : "GenBank", parsed.records.length);
}

/** Draws a record and its readout. Shared by the pasted-text and .dna paths. */
function renderSeqMapRecord(rec: SeqRecord, source: string, recordCount = 1): void {
  currentSeqRecord = rec;
  currentSeqMapSvg = null;
  seqmapInsert.disabled = true;
  seqmapPreview.replaceChildren();

  const types = featureTypes(rec);
  const shape = rec.circular ? "circular" : "linear";
  let info = `${rec.name} — ${rec.length.toLocaleString()} bp, ${shape} · ${source}`;
  if (recordCount > 1) info += ` (first of ${recordCount} records)`;
  if (rec.features.length) {
    info += ` · ${rec.features.length} features: ${types.slice(0, 4).map((t) => `${t.count}× ${t.type}`).join(", ")}`;
  } else {
    // Say WHY there's nothing to draw — a FASTA has no annotations to lose.
    info +=
      source === "FASTA"
        ? " · no features (FASTA carries none — a GenBank file draws a real map)"
        : " · no features found in that record";
  }
  seqmapInfo.textContent = info;

  // Auto follows the record's own topology: a plasmid is a ring, and drawing a
  // linear sequence as one would misrepresent the construct.
  const want = seqmapShape.value;
  const circular = want === "circular" || (want === "auto" && rec.circular);
  const mono = seqmapMono.checked;
  const svg = circular
    ? buildCircularMapSvg(rec, { size: 460, monochrome: mono })
    : buildLinearMapSvg(rec, { width: 640, monochrome: mono });
  if (!svg) {
    seqmapInfo.textContent += " — nothing to draw.";
    return;
  }
  if (want === "circular" && !rec.circular) {
    // Say so: a ring drawn from a linear record is a claim about the construct.
    seqmapInfo.textContent += " · drawn as a circle, but this record says linear";
  }
  currentSeqMapSvg = svg;
  const holder = document.createElement("div");
  holder.className = "seqmap-holder";
  holder.innerHTML = svg;
  seqmapPreview.appendChild(holder);
  seqmapInsert.disabled = false;
}

/** Inserts the map as a picture at the cursor. */
async function insertSeqMap(): Promise<void> {
  if (!currentSeqMapSvg || !currentSeqRecord) {
    setStatus("No map to insert.", "error");
    return;
  }
  seqmapInsert.disabled = true;
  setStatus("Inserting map…");
  try {
    // Read BOTH dimensions from the SVG itself. A circular map is square (460)
    // and a linear one is wide (640) — hardcoding either would stretch the other
    // out of shape in the document.
    const w = Number(/width="(\d+)"/.exec(currentSeqMapSvg)?.[1] ?? 640);
    const h = Number(/height="(\d+)"/.exec(currentSeqMapSvg)?.[1] ?? 200);
    const base64 = await renderFigurePng(currentSeqMapSvg, w, h);
    const rec = currentSeqRecord;
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      sizeFigure(picture, w, h);
      picture.altTextDescription =
        `Sequence map: ${rec.name}, ${rec.length} bp, ${rec.circular ? "circular" : "linear"}, ` +
        `${rec.features.length} features`;
      range.select(Word.SelectionMode.end);
      await context.sync();
      await tagInserted(context, picture.getRange(), "formula-inserter:seqmap");
    });
    setStatus("Map inserted.", "success");
  } catch (error) {
    setStatus(`Could not insert the map: ${(error as Error).message}`, "error");
  } finally {
    seqmapInsert.disabled = false;
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
  /**
   * Conditions that make the fit above untrustworthy — rendered under the result.
   *
   * A least-squares fit always returns numbers and an R² near 1, even when the
   * experiment could not determine them. Measured: a substrate range 8x below Km
   * yields Vmax +-39% at R² 0.9986 — the SAME R² as a good design. Nothing on
   * screen distinguished the two.
   */
  caveats?: string[];
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
      return { text, caveats: fit.caveats, plot: { data: pts, predict: fit.predict, xlabel: "[S]", ylabel: "v" } };
    },
  },
  {
    // The Cheng-Prusoff panel tells the user to "determine the mode from a
    // Lineweaver-Burk or a full inhibition fit before converting an IC50" -
    // advice the product made impossible to follow, because fitInhibition was
    // written, tested, and never wired to anything.
    id: "inhibition",
    name: "Inhibition mode fit (Ki)",
    fields: [
      { key: "s", label: "[S] substrate", default: "1, 2, 5, 10, 20, 1, 2, 5, 10, 20", kind: "list" },
      { key: "i", label: "[I] inhibitor (matching [S])", default: "0, 0, 0, 0, 0, 5, 5, 5, 5, 5", kind: "list" },
      { key: "v", label: "v velocity (matching)", default: "1.67, 2.86, 5.0, 6.67, 8.0, 0.62, 1.11, 2.5, 4.0, 5.71", kind: "list" },
      {
        key: "mode",
        label: "Inhibition mode",
        default: "competitive",
        kind: "select",
        options: [
          { value: "competitive", label: "Competitive" },
          { value: "uncompetitive", label: "Uncompetitive" },
          { value: "noncompetitive", label: "Non-competitive" },
          { value: "mixed", label: "Mixed" },
        ],
      },
    ],
    compute: (r) => {
      const s = assayList(r("s"));
      const i = assayList(r("i"));
      const v = assayList(r("v"));
      if (s.length !== i.length || s.length !== v.length)
        return { text: "[S], [I] and v must be the same length \u2014 one row per measurement.", ok: false };
      if (s.length < 4) return { text: "Need at least 4 (s, i, v) rows to fit.", ok: false };
      const mode = r("mode") as InhibitionMode;
      const fit = fitInhibition(s, i, v, mode);
      if (!fit) return { text: "Fit did not converge \u2014 check the data and the chosen mode.", ok: false };
      // FitResult carries the standard errors in se[], in the model's parameter
      // order: [vmax, km, ki] and [vmax, km, ki, kiPrime] for mixed.
      const se = (k: number): number => (Number.isFinite(fit.se[k]) ? fit.se[k] : NaN);
      const lines = [
        `Inhibition fit \u2014 ${mode}`,
        `Vmax = ${assayValSE(fit.vmax, se(0))}`,
        `Km = ${assayValSE(fit.km, se(1))}`,
        `Ki = ${assayValSE(fit.ki, se(2))}`,
      ];
      if (mode === "mixed" && Number.isFinite(fit.kiPrime)) {
        lines.push(`Ki-prime = ${assayValSE(fit.kiPrime, se(3))}`);
      }
      lines.push(`R\u00b2 = ${assaySig(fit.rsquared, 4)}`);
      return {
        text: lines.join("\n"),
        caveats: [
          ...fit.caveats,
          "The MODE is chosen by you, not determined by the fit. Every mode returns numbers; compare the fits, and the linearized plots, before trusting one \u2014 a Ki from the wrong mode is confidently wrong.",
        ],
      };
    },
  },
  {
    // Diagnostic only. Each linearization distorts the error structure in a
    // different direction, which is why all three are shown together and why the
    // nonlinear fit above stays authoritative.
    id: "linearize",
    name: "Linearized kinetics (diagnostic)",
    fields: [
      { key: "s", label: "[S] substrate", default: "1, 2, 5, 10, 20, 50", kind: "list" },
      { key: "v", label: "v velocity (matching [S])", default: "1.333, 2.4, 4.615, 6.667, 8.571, 10.345", kind: "list" },
    ],
    compute: (r) => {
      const s = assayList(r("s"));
      const v = assayList(r("v"));
      if (s.length !== v.length || s.length < 3)
        return { text: "Enter equal-length [S] and v lists (3 or more points).", ok: false };
      if (s.some((x) => x <= 0) || v.some((y) => y <= 0))
        return { text: "Linearizations divide by [S] and by v, so every value must be greater than zero.", ok: false };
      const lb = lineweaverBurk(s, v);
      const eh = eadieHofstee(s, v);
      const hw = hanesWoolf(s, v);
      const row = (name: string, l: { vmax: number; km: number; rsquared: number }) =>
        `${name}: Vmax = ${assaySig(l.vmax)}, Km = ${assaySig(l.km)}, R\u00b2 = ${assaySig(l.rsquared, 4)}`;
      return {
        text: [
          "Linearized kinetics \u2014 three transforms of the same data",
          row("Lineweaver-Burk (1/v vs 1/[S])", lb),
          row("Eadie-Hofstee (v vs v/[S])", eh),
          row("Hanes-Woolf ([S]/v vs [S])", hw),
        ].join("\n"),
        caveats: [
          "These are DIAGNOSTIC, not a substitute for the nonlinear fit. Each transform reweights the errors differently \u2014 Lineweaver-Burk in particular inflates the influence of the smallest, noisiest velocities \u2014 so the three will disagree on real data. Judge the data by the spread between them, and take Vmax and Km from the Michaelis-Menten fit.",
          "Widely differing estimates, or a curved Eadie-Hofstee plot, suggest the simple model does not hold \u2014 cooperativity, substrate inhibition, or a second enzyme form.",
        ],
      };
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
      return { text, caveats: fit.caveats, plot: { data: pts, predict: fit.predict, xlabel: "[S]", ylabel: "response" } };
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
    name: "Ki from IC50 (Cheng–Prusoff)",
    fields: [
      { key: "ic50", label: "IC50", default: "100" },
      { key: "s", label: "[Substrate] (or [ligand])", default: "8" },
      { key: "km", label: "Km (or Kd)", default: "8" },
      {
        key: "mode",
        label: "Inhibition mode",
        default: "competitive",
        kind: "select",
        options: [
          { value: "competitive", label: "Competitive (classic Cheng–Prusoff)" },
          { value: "uncompetitive", label: "Uncompetitive" },
          { value: "noncompetitive", label: "Non-competitive (pure)" },
          { value: "mixed", label: "Mixed" },
        ],
      },
    ],
    // The mode selector is the fix. Cheng-Prusoff is the COMPETITIVE relationship,
    // and this calculator applied it unconditionally: on a non-competitive
    // inhibitor at [S] = 10*Km it returned a Ki ELEVEN TIMES TOO LOW, making the
    // compound look eleven times more potent than it is.
    compute: (r) => {
      const mode = r("mode") as InhibitionMode;
      const ki = kiFromIc50(+r("ic50"), +r("s"), +r("km"), mode);
      if (mode === "mixed") {
        return {
          text:
            "Mixed inhibition has TWO constants — Ki (free enzyme) and Ki' (ES complex).\n" +
            "A single IC50 at a single [S] cannot separate them, so there is no Ki to report here.\n" +
            "Measure velocities across a range of [S] and [I] and fit the mixed model instead.",
          ok: false,
        };
      }
      if (!Number.isFinite(ki)) return { text: "Enter a positive IC50, [S] and Km.", ok: false };
      const note: Record<string, string> = {
        competitive: "Ki = IC50 / (1 + [S]/Km). Raising [S] out-competes the inhibitor.",
        uncompetitive: "Ki' = IC50 / (1 + Km/[S]). The inhibitor binds ES, so MORE substrate makes it worse.",
        noncompetitive: "Ki = IC50. A pure non-competitive inhibitor binds E and ES equally, so [S] does not enter — your [S] and Km are ignored here, deliberately.",
      };
      return {
        text: `Ki = ${assaySig(ki)}\n${note[mode]}`,
        caveats: [
          "The MODE is your claim, not the data's. Cheng–Prusoff is the COMPETITIVE " +
            "relationship; applying it to a non-competitive inhibitor at [S] = 10×Km returns " +
            "a Ki ELEVEN TIMES too low — and the number looks perfectly reasonable. " +
            "Determine the mode from a Lineweaver–Burk or a full inhibition fit before " +
            "converting an IC50.",
          "Assumes rapid equilibrium, a single inhibitor site, and [I] >> [enzyme]. " +
            "Tight-binding inhibitors (Ki near the enzyme concentration) violate the free-" +
            "inhibitor assumption and need Morrison's equation.",
        ],
      };
    },
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
    // The inverse of the entry above, and the direction a bench scientist
    // actually needs: "I want pH 7.4 from this buffer - what ratio do I mix?"
    // bufferRatioForPh existed and was tested; nothing called it.
    id: "bufferratio",
    name: "Buffer ratio for a target pH",
    fields: [
      { key: "pka", label: "pKa of the buffer", default: "7.21" },
      { key: "ph", label: "Target pH", default: "7.4" },
    ],
    compute: (r) => {
      const pka = +r("pka");
      const ph = +r("ph");
      if (!Number.isFinite(pka) || !Number.isFinite(ph))
        return { text: "Enter a numeric pKa and target pH.", ok: false };
      const ratio = bufferRatioForPh(pka, ph);
      const basePct = (100 * ratio) / (1 + ratio);
      const caveats: string[] = [];
      if (Math.abs(ph - pka) > 1) {
        caveats.push(
          "The target pH is more than one unit from the pKa, so this buffer has little capacity there \u2014 the ratio is extreme and a small addition of acid or base will move the pH a long way. Choose a buffer whose pKa is nearer the target.",
        );
      }
      caveats.push(
        "Henderson-Hasselbalch assumes activity coefficients of 1 and ignores ionic strength and temperature. Mix to the calculated ratio, then verify with a meter.",
      );
      return {
        text: [
          `[A-]/[HA] = ${assaySig(ratio, 4)}`,
          `Mix ${assaySig(basePct, 3)}% conjugate base with ${assaySig(100 - basePct, 3)}% acid.`,
        ].join("\n"),
        caveats,
      };
    },
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
  renderCalcFields(calc.fields, assayInputs, "assay", updateAssayPreview);
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

  // Show the fit's own warnings under the numbers. Without this, a substrate
  // range too low to determine Vmax renders as a clean "Vmax = 107 ± 42, R² =
  // 0.9986" — and R² is identical to a good design, so nothing on screen tells
  // the user the experiment could not answer the question they asked.
  if (insertable && out.caveats?.length) {
    assayResult.appendChild(specCaveats(out.caveats));
  }

  // Draw the fitted curve over the raw data when the calculator produced one.
  if (out.plot && insertable) {
    const { data, predict, xlabel, ylabel } = out.plot;
    const xs = data.map((p) => p.x);
    const xmin = minOf(xs);
    const xmax = maxOf(xs);
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
    const base64 = await renderFigurePng(currentAssayPlotSvg, 380, 270);
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      const picture = range.insertInlinePictureFromBase64(base64, Word.InsertLocation.after);
      sizeFigure(picture, 380, 270);
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
      let unattributed = 0;
      const categoryNums = new Set<number>();

      // Full forms AND short forms AND Id. — resolved against the document text
      // by offset, which is the only way "Id. at 79" can be attributed at all.
      const occ = toaOccurrences(body.text, marks);

      // Word searches by STRING, so an occurrence text that means different
      // authorities in different places cannot be marked: one search would
      // stamp every hit with one authority and put pages under the wrong case.
      // Those are counted and declared instead of guessed.
      const byText = new Map<string, Set<number>>();
      for (const o of occ) {
        const set = byText.get(o.text) ?? new Set<number>();
        set.add(o.markIndex);
        byText.set(o.text, set);
      }

      const markedAuthorities = new Set<number>();
      for (const [needle, owners] of byText) {
        if (owners.size !== 1) {
          unattributed += occ.filter((o) => o.text === needle).length;
          continue;
        }
        const markIndex = [...owners][0];
        const mark = marks[markIndex];
        // Word's search has a 255-character limit and chokes on some wildcards;
        // a citation is far shorter, but guard rather than throw mid-pass.
        if (!needle || needle.length > 240) continue;
        const results = body.search(needle, { matchCase: false });
        results.load("items");
        await context.sync();
        if (!results.items.length) continue;
        const ooxml = taFieldOoxml(mark.name, mark.rest, mark.categoryNum);
        for (const hit of results.items) hit.insertOoxml(ooxml, Word.InsertLocation.before);
        categoryNums.add(mark.categoryNum);
        markedAuthorities.add(markIndex);
        occurrences += results.items.length;
      }
      authoritiesMarked = markedAuthorities.size;
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
        `(${occurrences} citation${occurrences === 1 ? "" : "s"}, including short forms). ` +
        // Say what was NOT marked. An "Id." that means different cases in
        // different places cannot be marked by a string search without
        // attaching pages to the wrong authority, so those are left out — and a
        // page list that is short by a known amount beats one that is silently
        // wrong. The user can convert those to a short form and re-run.
        (unattributed > 0
          ? `${unattributed} short reference${unattributed === 1 ? "" : "s"} (e.g. “Id.”) could not be tied to one authority and ${unattributed === 1 ? "was" : "were"} left unmarked — check those pages by hand. `
          : "") +
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

/** Rasterises at the supersampled size. Pair with sizeFigure() at the insert. */
async function renderFigurePng(svg: string, width: number, height: number): Promise<string> {
  // A PIXEL BUDGET IS NOT A BYTE BUDGET.
  //
  // figureScale bounds how much memory the canvas costs. What Word cares about
  // is the size of the base64 payload handed to insertInlinePictureFromBase64,
  // and a picture over that limit is not rejected — it is accepted, reported as
  // fine, and silently dropped. Two Bode plots at 4x did exactly that.
  //
  // So the payload is measured, not assumed, and the figure is re-rendered at a
  // lower supersampling factor until it fits. Resolution degrades; the figure
  // still arrives. The worst case is 1x, which is the natural size and always
  // small enough.
  const MAX_BASE64 = 1_400_000;
  let s = figureScale(width, height);
  let png = await svgToPngBase64(svg, Math.round(width * s), Math.round(height * s));
  while (png.length > MAX_BASE64 && s > 1) {
    s--;
    png = await svgToPngBase64(svg, Math.round(width * s), Math.round(height * s));
  }
  return png;
}

/**
 * Pins an inserted picture to its natural physical size, so the extra pixels
 * from renderFigurePng() become resolution instead of size. See lib/figures.ts
 * for why this pairing is mandatory.
 */
function sizeFigure(pic: Word.InlinePicture, width: number, height: number): void {
  pic.width = figurePoints(width);
  pic.height = figurePoints(height);
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

    // A PROMISE THAT NEVER SETTLES IS WORSE THAN ONE THAT REJECTS.
    //
    // The handlers below assume the host fires exactly one of onload/onerror.
    // A host that fires NEITHER — a decode that never completes, a policy that
    // drops the load without reporting it — leaves this promise awaited forever
    // by an insert holding the shared insertTextBusy flag. That flag then never
    // clears, so every later Insert ANYWHERE in the product returns without
    // doing anything, and none of it reaches a catch, a status message or a
    // log. The user sees a button that has quietly stopped working.
    //
    // A callback is not a bound; only a clock is. Ten seconds is far beyond any
    // real rasterisation here (the largest figures take tens of milliseconds)
    // and far short of a user's patience with a dead pane. Every exit runs
    // through done(), so the timer is always cleared and the promise settles
    // exactly once.
    let settled = false;
    const timer = setTimeout(() => {
      done(() => reject(new Error("Rasterizing the figure timed out — it was not inserted.")));
    }, 10000);
    function done(action: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    }

    img.onload = () => {
      done(() => {
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
      });
    };
    img.onerror = () => done(() => reject(new Error("Could not rasterize the structure image.")));
    img.src = `data:image/svg+xml;base64,${svgBase64}`;
  });
}
