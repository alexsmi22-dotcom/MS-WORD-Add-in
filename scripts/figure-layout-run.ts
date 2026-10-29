// Drives the figure-layout audit over every chart builder we ship.
//
//   npm run check:figures
//
// This file is the CORPUS. The analyser lives in figure-layout-audit.js and the
// runner in check-figures.js; the list is here because the builders are
// TypeScript. Cases are chosen to stress layout rather than to be pretty: long
// labels, many legend entries, values that need wide tick text, and curves that
// sweep through the corners where labels live.
//
// IT USED TO BE INVOKED AS `npx ts-node …`, AND ts-node WAS NOT INSTALLED.
// Offline the gate could not run at all; online it network-installed on every QC
// run. It now loads through scripts/ts-require.js, which uses the `typescript`
// devDependency that is already on disk. No network, no new dependency.
//
// THE CORPUS WAS ENGINEERING-ONLY UNTIL 2026-08-05. It imported mechchart, plot,
// reliability and colourspace — so a Table→Chart, Spectra, heat-map, candlestick,
// sequence-map, beam or periodic-table figure had no geometry gate of any kind.
// check-figures.js now derives the list of SVG-producing modules FROM THE
// FILESYSTEM and fails if any of them is missing from this file's imports, so a
// new chart module cannot be added without a figure landing here.
import {
  mohrCircleSvg,
  goodmanDiagramSvg,
  sectionShapeSvg,
  columnCurveSvg,
  trussSvg,
  torsionProfileSvg,
  npshLadderSvg,
  poleZeroSvg,
  hBarSvg,
  logicWaveSvg,
  powerTriangleSvg,
  gamutTriangleSvg,
  ladderSvg,
  orbitChartSvg,
  vectorTriangleSvg,
  armSvg,
} from "../src/lib/mechchart";
import { ASSAY_QUANT_CALCS } from "../src/lib/assayQuantCalcs";
import { MATERIALS_CALCS } from "../src/lib/materialsCalcs";
import { CONTROL_CALCS } from "../src/lib/controlCalcs";
import { rootLocusSvg, nyquistSvg, zPlaneSvg } from "../src/lib/controlCharts";
import { rootLocus, nyquist, c2d } from "../src/lib/controlDesign";
import { monteCarlo, mcHistogramSvg } from "../src/lib/monteCarlo";
import { FILM_CALCS } from "../src/lib/filmCalcs";
import { BOND_CALCS } from "../src/lib/bondCalcs";
import { IPVAL_CALCS } from "../src/lib/ipValuationCalcs";
import { DERIV_CALCS } from "../src/lib/derivCalcs";
import { SCHED_CALCS } from "../src/lib/schedCalcs";
import { PORTCORP_CALCS } from "../src/lib/portcorpCalcs";
import { LITIG_CALCS } from "../src/lib/litigCalcs";
import { FORENSIC_CALCS } from "../src/lib/forensicCalcs";
import { TS2_STAT_CALCS } from "../src/lib/ts2StatCalcs";
import { CAUSAL_STAT_CALCS } from "../src/lib/causalStatCalcs";
import { LIMDEP_STAT_CALCS } from "../src/lib/limdepStatCalcs";
import { MICROMACRO_STAT_CALCS } from "../src/lib/micromacroStatCalcs";
import { GMM_STAT_CALCS, DYN_DEFAULT_TABLE, rhoFigure } from "../src/lib/gmmStatCalcs";
import { ivDefaultTable } from "../src/lib/ivCalcs";
import { CBA_CALCS } from "../src/lib/cbaCalcs";
import { polarisationEllipseSvg } from "../src/lib/filmCharts";
import { RIGHT_CIRCULAR, linearState } from "../src/lib/jones";
import { TITRATION_CALCS } from "../src/lib/titrationCalcs";
import { speciationSvg, rsLineSvg, cvSimSvg } from "../src/lib/titrationCharts";
import { buildPlotSvg, Series } from "../src/lib/plot";
import { weibullFit, reliabilityBlock, kOutOfN, redundancy, availability } from "../src/lib/reliability";
import { GAMUTS as GAMUT_DEFS } from "../src/lib/colourspace";
import { boxPlotSvg, forestPlotSvg, groupedBarSvg } from "../src/lib/statchart";
import { rmAnovaCalc, coxCalc, readCoxField, coxFigureParts } from "../src/lib/statsBatchCalcs";
import { coxRegression } from "../src/lib/cox";
// --- the non-Engineering half, added 2026-08-05 ------------------------------
import { parseTableData, buildChartPreviewSvg, ChartKind } from "../src/lib/tablechart";
import { buildTableFigureSvg } from "../src/lib/tablefigure";
import { buildFlowchartSvg, buildHierarchySvg } from "../src/lib/tablediagram";
import { buildHeatmapSvg } from "../src/lib/heatmap";
import { buildCandlestickSvg } from "../src/lib/candlestick";
import {
  nmrChartSvg,
  irChartSvg,
  msChartSvg,
  cosyChartSvg,
  hsqcChartSvg,
  hmbcChartSvg,
  tocsyChartSvg,
  jcampChartSvg,
} from "../src/lib/spectraChart";
import { predictNmr } from "../src/lib/nmr";
import { predictIr } from "../src/lib/ir";
import { predictFragments } from "../src/lib/fragment";
import { predictUvVis } from "../src/lib/uvvis";
import { parseJcamp, JcampSpectrum } from "../src/lib/jcamp";
import { overlaySpectrum, displayUnits } from "../src/lib/spectrumOverlay";
import { overlayChartSvg } from "../src/lib/overlayChart";
import { analyzeSolid, solidExample, type SolidKind } from "../src/lib/solidformAnalyze";
// solidformChart.ts builds every Solid form figure (analyzeSolid calls it); its size is checked below.
import { SOLID_CHART_SIZE } from "../src/lib/solidformChart";
import { isotopeChartSvg } from "../src/lib/isotopeChart";
import { resolveMassSpec } from "../src/lib/massspec";
import { overlayPrediction, parseReferencePeak, jcampDrawPoints, OverlaySource } from "../src/lib/spectroPane";
import * as fsForCorpus from "fs";
import * as pathForCorpus from "path";
import { predictCosy, predictHsqc, predictHmbc, predictTocsy } from "../src/lib/nmr2d";
import { beamDiagramSvg } from "../src/lib/beamChart";
import { analyzeBeam, BeamInput, BeamResult, Support, Load } from "../src/lib/beam";
import { Rat, ratInt, ratDiv } from "../src/lib/cas";
import { inequality, lorenzSvg } from "../src/lib/inequality";
import { solveMarket, marketFigureSvg, type MarketSpec } from "../src/lib/microMarket";
import { buildPeriodicTableSvg, buildBohrSvg, buildOrbitalSvg } from "../src/lib/periodicChart";
import { buildLinearMapSvg } from "../src/lib/seqmap";
import { buildCircularMapSvg } from "../src/lib/seqmapcirc";
import { parseGenBank } from "../src/lib/seqio";
import { persistentHomology, barcodeSvg } from "../src/lib/persistence";
import { solveFunctionSvg } from "../src/lib/solveFigure";
import { parseDaeSystem } from "../src/lib/daeParse";
import { solveDaeAuto } from "../src/lib/daeIndex";
import { tryGraph } from "../src/lib/graphs";
import { tryAutomata } from "../src/lib/automata";
import { tryProbability } from "../src/lib/probability";
import { tryMarkov } from "../src/lib/markov";
import { tryRadius, radiusSvg } from "../src/lib/radius";
import { taylorSeries } from "../src/lib/analysis";
import { tryInterpolate } from "../src/lib/interpolate";
import { trySpline } from "../src/lib/spline";
import { tryLp } from "../src/lib/lp";
import { lpRegionSvg } from "../src/lib/lpFigure";
import { treeSvg } from "../src/lib/treeSvg";
import { cayleyTableSvg } from "../src/lib/cayleyTableSvg";
import { moneyOverTimeSvg, cashFlowLadderSvg, bondPriceCurveSvg, optionCurveSvg } from "../src/lib/financeFigures";
import { assayLineSvg } from "../src/lib/assayFormat";
import { bondPrice } from "../src/lib/finance";
import { starterDoc, defaultParams, docToAssembly } from "../src/lib/cadShapes";
import { tessellate as cadTessellate } from "../src/lib/cadModel";
import { layoutSheet } from "../src/lib/cadSheet";
import type { SheetMark } from "../src/lib/cadMarks";
type Vec3c = [number, number, number];
import { dihedralGroup, cosets as cosetsOfGroup, op as groupOp } from "../src/lib/algebraGroups";
import { tryAlgebra } from "../src/lib/algebra";
import { solveGrammar } from "../src/lib/grammar";
import { balanceText } from "../src/lib/balance";
import { balanceReport, stoichCalc, BalanceReport } from "../src/lib/chembioCalcs";
import { solvePda } from "../src/lib/pda";
import { solveTuring } from "../src/lib/turing";
import { solveFol } from "../src/lib/fol";
import { solveSat } from "../src/lib/sat";
import { solveLambda } from "../src/lib/lambda";
import { solveComposite } from "../src/lib/compositeGeometry";
import { compositeShapeSvg, geometryFigureSvg, drawnShapesSvg } from "../src/lib/geometryChart";
import { solveGeometry } from "../src/lib/geometryParse";
import { emptyDrawState, setTool, clickAt, renderDrawSvg, DrawState } from "../src/lib/geometryDraw";
import { fitSketch } from "../src/lib/sketchFit";
import { sketchSurfaceSvg, sketchFitSvg } from "../src/lib/sketchChart";
import { generate3d, isMol3dError, projectScene, opsToSvg, defaultMol3dView, formulaSubscripts } from "../src/lib/mol3d";
import { Molecule as OclMoleculeForCorpus } from "openchemlib/full";
// v2.140.0 audio / video / light: the engines return figure data, avFigures
// draws it — the same calls the pane makes from each tool's shipped defaults.
import {
  audioFigureSvg,
  photoFigureSvg,
  timecodeDriftSvg,
  cadenceSvg,
  aspectFrameSvg,
  transferSvg,
  interfaceBarsSvg,
  daylightLocusSvg,
} from "../src/lib/avFigures";
import {
  levelConvert,
  levelSum,
  bandsToWeighted,
  coherentSum,
  ditherBudget,
  audioSize,
  speakerSpl,
  absorptionBudget,
  passiveCrossover,
  cableDamping,
} from "../src/lib/audio";
import { normaliseGain, sineLoudness, gatedIntegrated } from "../src/lib/loudness";
import { driftFigure } from "../src/lib/timecode";
import { pulldown, aspect, transfer, interfaceRate } from "../src/lib/video";
import { pointIlluminance, coneFlux, screenLuminance, depthOfField, exposureValue } from "../src/lib/photometry";
import { daylightLocusFigure } from "../src/lib/colourspace";
// v2.143.0 journal-grade figures: figure styles, significance brackets, panels.
// Each figure is built by the SAME lib call the pane makes (prepareFigure,
// bracketedBoxPlot, composePanelFigure), so the corpus sees what inserts.
import { getPreset, presetWidthMm, PRESET_IDS } from "../src/lib/figureStyle";
import { seriesStyle, seriesMarkerSvg, CATEGORICAL_PALETTE } from "../src/lib/categoricalPalette";
import { prepareFigure, composePanelFigure, type FigurePresetChoice } from "../src/lib/insertCapability";
import { bracketedBoxPlot } from "../src/lib/statsBrackets";
import { tukeyHSD } from "../src/lib/tukey";
// The v2.175.0 engineering figures (frames, plate FEA, shelf life, electrochemistry), from each calculator's defaults.
import { analyzeFrame, parseFrame } from "../src/lib/frame2d";
import { frameChartSvg } from "../src/lib/frameChart";
import { analyzePlate, parsePlate } from "../src/lib/planeStress";
import { arrhenius, parseStability } from "../src/lib/arrhenius";
import { butlerVolmerCurve, nernst, tafelFit, simulateReversibleCv } from "../src/lib/electrochem";
import { arrheniusChartSvg, butlerVolmerChartSvg, nernstChartSvg, plateChartSvg, tafelChartSvg } from "../src/lib/engCharts2026";
import { twoSampleTTest } from "../src/lib/stats";
import { kruskalWallis, dunnTest } from "../src/lib/nonparametric";
// The compound table's structure cells (Reaction ▸ Compounds in this document), drawn as the pane draws them.
import { structureSvg } from "../src/lib/compoundTable";
// Plot ▸ Plot type (Release B): parametric, polar, two y axes, contour, 3D surface — each built by
// plotKinds.buildPlotKind, the call the pane makes, from representative field values.
import { buildPlotKind, PlotKindInput, parametricPlotSvg } from "../src/lib/plotKinds";
import { polarPlotSvg } from "../src/lib/polarPlot";
import { dualAxisPlotSvg } from "../src/lib/dualAxisPlot";
import { contourPlotSvg } from "../src/lib/contour";
import { surfacePlotSvg } from "../src/lib/surface3d";
// --- Release C: circuit transient ---
import { CIRCUIT_CALCS } from "../src/lib/circuitCalcs";
// --- end Release C: circuit transient ---
// --- Release C: hplc --- the reconstructed chromatogram (chromChart.ts), built by the calculator the pane registers.
import { chromatogramSvg } from "../src/lib/chromChart";
import { CHROM_CALCS } from "../src/lib/chromCalcs";
// --- end Release C: hplc ---
// --- Release C: cloning (gap #13) --------------------------------------------
import { CLONING_CALCS } from "../src/lib/cloningCalcs";
import { gelSvg } from "../src/lib/gelChart";
import { goldenGateSvg, gibsonSvg, primerMapSvg, partsDiagramSvg } from "../src/lib/cloningCharts";
import { PUC19 } from "../src/lib/__tests__/fixtures/puc19";
// --- Release C: nmr ---
import { TLC_CALCS } from "../src/lib/tlcCalcs";
import { tlcPlateSvg } from "../src/lib/tlcChart";
import { readTlc } from "../src/lib/tlc";
// --- end Release C: nmr ---
// --- Release C: lc ---
// Liquid-crystal retarder / achromatic wave plate and LC voltage tools: their charts and drawings.
import { LC_CALCS } from "../src/lib/lcCalcs";
import { lcLineChartSvg, lcTransmissionSvg, lcNetRetardanceSvg, lcMeasuredSvg, lcProfilesSvg, lcGammaVoltageSvg, lcMidTiltSvg } from "../src/lib/lcCharts";
import { lcCellSvg, lcDirectorSvg, lcDeviceSvg } from "../src/lib/lcDrawings";
// --- end Release C: lc ---
// --- Release E: thermal ---
import { THERMAL_STRESS_CALCS } from "../src/lib/thermalStressCalcs";
import { bilayerStressProfileSvg } from "../src/lib/thermalStressCharts";
import { timoshenkoBilayer } from "../src/lib/thermalStress";
// --- end Release E: thermal ---
// --- Release E: flow ---
// Compressible flow beyond isentropic: normal shock, θ–β–M / Prandtl–Meyer, Fanno and Rayleigh.
import { GAS_DYNAMICS_CALCS } from "../src/lib/gasDynamicsCalcs";
import { thetaBetaSvg, prandtlMeyerSvg, fannoSvg, rayleighSvg, normalShockSvg } from "../src/lib/gasDynamicsCharts";
// --- end Release E: flow ---
// --- Release E: vessels ---
import { VESSELS_CALCS } from "../src/lib/vesselsCalcs";
// --- end Release E: vessels ---
// --- Release E: vibration ---
// Random vibration (PSD + Miles), base excitation and shaft critical speeds: their charts.
import { RANDOM_VIBRATION_CALCS } from "../src/lib/randomVibrationCalcs";
import { psdChartSvg, transmissibilityChartSvg, shaftCriticalSvg } from "../src/lib/randomVibrationCharts";
import { psdProfile } from "../src/lib/randomVibration";
// --- end Release E: vibration ---
// --- Release E: kalman ---
// Kalman filter (steady state, run on data) and attitude conversions: their charts and the body-axes triad.
import { KALMAN_CALCS } from "../src/lib/kalmanCalcs";
import { attitudeTriadSvg } from "../src/lib/kalmanCharts";
// --- end Release E: kalman ---
// --- Release E: quantum gates ---
// Release Q part Q2: single-qubit gates (Bloch sphere), the circuit simulator and the protocol presets.
import { QUANTUM_GATES_CALCS } from "../src/lib/quantumGatesCalcs";
import { blochSphereSvg, circuitDiagramPages, probabilityBarsSvg } from "../src/lib/quantumCharts";
import { grover as qGrover, parseCircuit as qParseCircuit } from "../src/lib/quantumCircuits";
// --- end Release E: quantum gates ---

// --- Release E: laser ---
// Fabry–Pérot, threshold, coherence and SHG: their charts, through the calculators and straight from the builders.
import { LASER_CALCS } from "../src/lib/laserCalcs";
import { fpAiryChartSvg, fpPeakChartSvg, thresholdChartSvg, coherenceChartSvg, shgGrowthChartSvg, shgSincChartSvg } from "../src/lib/laserCharts";
import { fabryPerot } from "../src/lib/laserPhysics";
// --- end Release E: laser ---

// --- Astronomy & lunar ---
import { ASTRO_CALCS } from "../src/lib/astroCalcs";
import { moonDiscSvg, skyDomeSvg, fovSvg, timeScalesChartSvg } from "../src/lib/astroCharts";
// --- end Astronomy & lunar ---

// --- Release E: link budget ---
import { LINK_BUDGET_CALCS } from "../src/lib/linkBudgetCalcs";
import { berWaterfallSvg, cascadeNfSvg, linkRangeSvg } from "../src/lib/linkBudgetCharts";
// --- end Release E: link budget ---

// --- Release E: linear optics ---
// Release Q part Q4: Mach–Zehnder fringes, the HOM dip, multiphoton pattern bars (Fock labels) and CZ success vs η.
import { LINEAR_OPTICS_CALCS } from "../src/lib/linearOpticsCalcs";
import { fockBarsSvg } from "../src/lib/linearOpticsCharts";
// --- end Release E: linear optics ---

// --- Release E: semiconductor ---
import { SEMICONDUCTOR_CALCS } from "../src/lib/semiconductorCalcs";
import { cvChartSvg, fermiChartSvg, idVdsFamilySvg, ivChartSvg } from "../src/lib/semiconductorCharts";
// --- end Release E: semiconductor ---

// --- Release E: quantum dirac ---
// Release Q parts Q1 + Q3: states, operators, measurement, density matrices, bipartite entanglement.
import { QUANTUM_DIRAC_CALCS } from "../src/lib/quantumDiracCalcs";
import { amplitudeChartSvg, matrixHeatmapSvg, quantumBarsSvg } from "../src/lib/quantumDiracCharts";
// --- end Release E: quantum dirac ---

// --- Release E: transmission lines ---
// Release E3-e: the Smith chart, the matching networks' |Γ| against f/f₀, and the S-parameter bars.
import { TLINE_CALCS } from "../src/lib/tlineCalcs";
import { sParamBarsSvg, smithChartSvg } from "../src/lib/tlineCharts";
// --- end Release E: transmission lines ---

// --- Release E: AI compute ---
import { AI_COMPUTE_CALCS } from "../src/lib/aiComputeCalcs";
import { memoryBarsSvg, quantStairSvg, rooflineSvg, spacingChartSvg } from "../src/lib/aiComputeCharts";
// --- end Release E: AI compute ---

// --- Release Q: quantum links ---
// Release Q5: link loss against range, coincidences and accidentals against the window, key rate against loss.
import { QUANTUM_LINKS_CALCS } from "../src/lib/quantumLinksCalcs";
import { entRatesSvg, fsoLossSvg, qkdKeySvg } from "../src/lib/quantumLinksCharts";
import { entanglement, fsoLink, qkdLink } from "../src/lib/quantumLinks";
// --- end Release Q: quantum links ---

// --- Release E: quantum mechanics ---
// Release Q part Q6: well / oscillator levels with |ψ|², the hydrogen level diagram and P(r), T(E/V₀), two-level dynamics.
import { QUANTUM_MECHANICS_CALCS } from "../src/lib/quantumMechanicsCalcs";
import { curvesSvg, hydrogenLevelSvg, levelFigureSvg, tunnelSvg } from "../src/lib/quantumMechanicsCharts";
// --- end Release E: quantum mechanics ---

import { kaplanMeier } from "../src/lib/survival";
import { kaplanMeierSvg } from "../src/lib/survivalFigure";
// "Fully inclusive" (2026-10-28): the figures added to the calculators that drew none.
import { finCurrencyFigure } from "../src/lib/finPaneFigures";
import { cipParitySvg, uipPathSvg, pppPathSvg, putCallParitySvg, stepBarsSvg, namedBarsSvg, pppBasketSvg } from "../src/lib/finLibFigures";
import { logitCoefFigureSvg, regTableFigureSvg } from "../src/lib/statPaneFigures";
import { coefForestSvg, depositExpansionSvg } from "../src/lib/statLibFigures";
import { finCurrencyCalc, FIN_CURRENCY_DEFAULTS } from "../src/lib/econE5aCalcs";
import { econLogitCalc, econRegTableCalc, LOGIT_DEFAULT, LOGIT_SPEC_DEFAULT, LONGLEY_DEFAULT, ECON_SPECS_DEFAULT } from "../src/lib/econCalcs";
const figures: [string, string][] = [];

// Composite plane figures (Solve → geometry). The three layout regimes: a
// cutout row that fits, one that must shrink to stay legible, and additions.
{
  const rectTri = solveComposite("rectangle 10in x 5in minus triangle b=4in h=3in");
  if (rectTri) figures.push(["composite rect minus triangle", compositeShapeSvg(rectTri)]);
  const crowded = solveComposite("rectangle 6 x 3 minus circle r=1.4 minus square s=2 minus triangle b=2 h=2");
  if (crowded) figures.push(["composite crowded cutouts", compositeShapeSvg(crowded)]);
  const lshape = solveComposite("rectangle 8 x 3 plus rectangle 3 x 5 plus semicircle r=1.5");
  if (lshape) figures.push(["composite additions", compositeShapeSvg(lshape)]);
}

// Compound-table structure cells: a small acyclic one, a ring with substituents, a charged one.
for (const [name, smiles] of [
  ["compound table cell butan-2-ol", "C[C@@H](O)CC"],
  ["compound table cell aspirin", "CC(=O)Oc1ccccc1C(=O)O"],
  ["compound table cell tetramethylammonium", "C[N+](C)(C)C"],
] as [string, string][]) {
  const d = structureSvg(smiles);
  if (!d) throw new Error(`corpus: ${name}: not drawn`);
  figures.push([name, d.svg]);
}

// Plain geometry figures (v2.106.0): each drawable kind at least once, plus the
// stress cases — a thin sliver triangle (labels crowd), the SSA pair (two
// panels), a reflex sector, and a hyperbola (two branches).
{
  const push = (name: string, input: string): void => {
    const g = solveGeometry(input);
    if (g?.figure) figures.push([name, geometryFigureSvg(g.figure)]);
  };
  push("geometry triangle sss", "triangle 3 4 5");
  push("geometry triangle sliver", "triangle 10 10 19.6");
  push("geometry triangle ssa pair", "triangle a=6 b=8 A=30");
  push("geometry polygon points", "polygon (0,0) (4,0) (5,3) (2,5) (-1,3)");
  push("geometry point in polygon", "inside (1,1) polygon (0,0) (4,0) (4,4) (0,4)");
  push("geometry conic ellipse", "x^2/9 + y^2/4 = 1");
  push("geometry conic hyperbola", "x^2/4 - y^2/9 = 1");
  push("geometry conic parabola", "y = x^2/8");
  push("geometry circle through 3 points", "circle (1,0) (0,1) (-1,0)");
  push("geometry sector", "sector r=5 angle=60");
  push("geometry sector reflex", "sector r=5 angle=300");
  push("geometry segment", "segment r=4 angle=90");
  push("geometry arc", "arc r=6 angle=120");
  push("geometry tangent", "tangent r=3 d=5");
}

// The draw-to-solve surface (v2.107.0): grid + shapes + hover readout, and the
// composite (cutout) coloring state.
{
  const clicksAt = (state: DrawState, pts: [number, number][]): DrawState =>
    pts.reduce((s, [x, y]) => clickAt(s, { x, y }), state);
  const tri = clicksAt(emptyDrawState("triangle"), [[1, 1], [9, 1], [3, 7]]);
  figures.push(["draw surface triangle", renderDrawSvg(tri, { x: 6, y: 4 })]);
  const composite = clicksAt(
    setTool(clicksAt(emptyDrawState("rectangle"), [[1, 1], [11, 8]]), "circle"),
    [[5, 4.5], [6.5, 4.5]]
  );
  figures.push(["draw surface composite", renderDrawSvg(composite, { x: 13, y: 9 })]);
  const pendingCircle = clicksAt(emptyDrawState("circle"), [[8, 5]]);
  figures.push(["draw surface pending", renderDrawSvg(pendingCircle, { x: 11, y: 5 })]);

  // Placement-faithful drawn figures (v2.108.0) — what actually inserts when
  // the request came from the drawing.
  figures.push([
    "drawn composite true placement",
    drawnShapesSvg(
      [
        { kind: "rectangle", a: { x: 1, y: 1 }, b: { x: 11, y: 8 } },
        { kind: "circle", c: { x: 3.5, y: 4.5 }, r: 1.5 },
        { kind: "rectangle", a: { x: 7, y: 3 }, b: { x: 9.5, y: 6 } },
      ],
      ["base area 70   ·   removed 14.57   ·   net 55.43"]
    ),
  ]);
  figures.push([
    "drawn single circle",
    drawnShapesSvg([{ kind: "circle", c: { x: 5, y: 5 }, r: 2.5 }], ["Circle, r = 2.5"]),
  ]);
  figures.push([
    "drawn segment pair",
    drawnShapesSvg(
      [
        { kind: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 4 } },
        { kind: "segment", a: { x: 0, y: 4 }, b: { x: 4, y: 0 } },
      ],
      ["Line — intersection (2, 2)"]
    ),
  ]);
  // The two layouts the independent pass broke (v2.108.0): an asymmetric
  // crossing (labels used to be struck) and touching tiny cutouts (labels
  // used to collide).
  figures.push([
    "drawn asymmetric crossing",
    drawnShapesSvg(
      [
        { kind: "segment", a: { x: 0, y: 0 }, b: { x: 16, y: 8 } },
        { kind: "segment", a: { x: 0, y: 4 }, b: { x: 16, y: 0 } },
      ],
      ["Line"]
    ),
  ]);
  figures.push([
    "drawn touching tiny cutouts",
    drawnShapesSvg(
      [
        { kind: "rectangle", a: { x: 1, y: 1 }, b: { x: 11, y: 8 } },
        { kind: "circle", c: { x: 5, y: 4 }, r: 0.5 },
        { kind: "circle", c: { x: 6, y: 4 }, r: 0.5 },
      ],
      ["base area 70   ·   removed 1.57   ·   net 68.43"]
    ),
  ]);
}

// Sketch data → function (v2.109.0): the click surface and the fit overlay.
{
  // SNAPPED, IN-WORLD points only — the first pin here carried (3, 6.8) with
  // y beyond the surface's own clamp, an exemplar the UI cannot produce.
  const linePts = [{ x: -3, y: -4.5 }, { x: -1, y: -1.5 }, { x: 0, y: 0.5 }, { x: 2, y: 3 }, { x: 3, y: 4.5 }];
  figures.push(["sketch surface", sketchSurfaceSvg(linePts, { x: 1, y: 2 })]);
  const lin = fitSketch(linePts).fits.find((f) => f.model === "linear");
  if (lin) figures.push(["sketch fit linear overlay", sketchFitSvg(linePts, lin)]);
  const logPts = [{ x: 0.5, y: 0.3 }, { x: 1, y: 1 }, { x: 2, y: 1.7 }, { x: 4, y: 2.4 }];
  const lg = fitSketch(logPts).fits.find((f) => f.model === "logarithmic");
  if (lg) figures.push(["sketch fit log overlay", sketchFitSvg(logPts, lg)]);
}

// 3D molecular models (v2.118.0): the dialog's draw list emitted as the
// inserted SVG, across all three styles and the H-hidden refit.
{
  const benzene = OclMoleculeForCorpus.fromSmiles("c1ccccc1");
  const ethanol = OclMoleculeForCorpus.fromSmiles("CCO");
  const b3 = generate3d(benzene.getIDCode());
  const e3 = generate3d(ethanol.getIDCode());
  // Same recipe as the pane's insertDraw3d: scene in the band above the
  // caption line, caption stating formula (subscripted), style, provenance.
  const fig = (m: ReturnType<typeof generate3d>, view: Parameters<typeof projectScene>[1], style: string): string => {
    if (isMol3dError(m)) throw new Error(m.error);
    const caption = `${formulaSubscripts(m.formula)} — ${style}, MMFF94s conformer`;
    return opsToSvg(projectScene(m, view, 640, 454), 640, 480, caption);
  };
  if (!isMol3dError(b3)) {
    figures.push(["mol3d benzene ballstick", fig(b3, defaultMol3dView(), "ball-and-stick")]);
    figures.push(["mol3d benzene spacefill", fig(b3, { ...defaultMol3dView(), style: "spacefill" }, "space-filling")]);
  }
  if (!isMol3dError(e3)) {
    figures.push(["mol3d ethanol stick", fig(e3, { ...defaultMol3dView(), style: "stick" }, "stick")]);
    figures.push(["mol3d ethanol no-H", fig(e3, { ...defaultMol3dView(), showH: false }, "ball-and-stick, hydrogens hidden")]);
  }
  // v2.119.0: a carbonyl pins the parallel-rod double bond + the O label.
  const acetone = generate3d(OclMoleculeForCorpus.fromSmiles("CC(=O)C").getIDCode());
  if (!isMol3dError(acetone)) {
    figures.push(["mol3d acetone double bond", fig(acetone, defaultMol3dView(), "ball-and-stick")]);
  }
}

figures.push([
  "mohr",
  mohrCircleSvg({ sigmaX: 100, sigmaY: 60, tauXY: 30, sigma1: 113.7, sigma2: 46.3, centre: 80, radius: 33.7, unit: "MPa" }),
]);
figures.push([
  "mohr wide",
  mohrCircleSvg({ sigmaX: 1200, sigmaY: -400, tauXY: 500, sigma1: 1300, sigma2: -500, centre: 400, radius: 900, unit: "MPa" }),
]);
figures.push([
  "mohr tiny",
  mohrCircleSvg({ sigmaX: 0.004, sigmaY: 0.002, tauXY: 0.001, sigma1: 0.0044, sigma2: 0.0016, centre: 0.003, radius: 0.0014, unit: "MPa" }),
]);

const gerber = Array.from({ length: 41 }, (_, i) => ({ m: (700 * i) / 40, a: 250 * (1 - (i / 40) ** 2) }));
const asme = Array.from({ length: 41 }, (_, i) => ({ m: (500 * i) / 40, a: 250 * Math.sqrt(Math.max(0, 1 - (i / 40) ** 2)) }));
figures.push([
  "goodman",
  goodmanDiagramSvg({
    sigmaM: 200,
    sigmaA: 100,
    sutMPa: 700,
    seMPa: 250,
    lines: [
      { name: "Modified Goodman", colour: "#2563eb", points: [{ m: 0, a: 250 }, { m: 700, a: 0 }] },
      { name: "Soderberg", colour: "#7c3aed", points: [{ m: 0, a: 250 }, { m: 500, a: 0 }] },
      { name: "Gerber", colour: "#059669", points: gerber },
      { name: "ASME elliptic", colour: "#d97706", points: asme },
      { name: "Langer yield", colour: "#b91c1c", points: [{ m: 0, a: 500 }, { m: 500, a: 0 }] },
    ],
  }),
]);
figures.push([
  "goodman two-point",
  goodmanDiagramSvg({
    sigmaM: 0,
    sigmaA: 200,
    yieldSigmaM: 400,
    sutMPa: 700,
    seMPa: 250,
    lines: [{ name: "Langer yield", colour: "#b91c1c", points: [{ m: 0, a: 500 }, { m: 500, a: 0 }] }],
  }),
]);

figures.push([
  "section rect",
  sectionShapeSvg({ name: "Rectangle", strips: [{ b: 100, h: 200, yc: 100, sign: 1 }], depth: 200, yBar: 100, unit: "mm" }),
]);
figures.push([
  "section tee",
  sectionShapeSvg({
    name: "Tee",
    strips: [
      { b: 6, h: 190, yc: 95, sign: 1 },
      { b: 100, h: 10, yc: 195, sign: 1 },
    ],
    depth: 200,
    yBar: 150,
    unit: "mm",
  }),
]);
figures.push(["section circle", sectionShapeSvg({ name: "Solid circle", strips: [], depth: 100, yBar: 50, circle: { d: 100 }, unit: "mm" })]);

figures.push(["column", columnCurveSvg({ E: 200e9, Fy: 250e6, slenderness: 95, sigmaCritical: 1.9e8, transition: 125 })]);
figures.push(["column no yield", columnCurveSvg({ E: 200e9, Fy: null, slenderness: 200, sigmaCritical: 4.9e7, transition: null })]);

figures.push([
  "truss",
  trussSvg(
    [
      { name: "A", x: 0, y: 0 },
      { name: "B", x: 4, y: 0 },
      { name: "C", x: 2, y: 2 },
    ],
    [
      { a: "A", b: "B", force: -30 },
      { a: "A", b: "C", force: 42 },
      { a: "B", b: "C", force: 0 },
    ],
  ),
]);
figures.push([
  "truss flat",
  trussSvg(
    [
      { name: "A", x: 0, y: 0 },
      { name: "B", x: 10, y: 0 },
      { name: "C", x: 5, y: 0.4 },
    ],
    [
      { a: "A", b: "B", force: -100 },
      { a: "A", b: "C", force: 60 },
    ],
  ),
]);

figures.push(["torsion", torsionProfileSvg(40, 20, 95, "MPa", "mm")]);
figures.push(["torsion solid", torsionProfileSvg(40, 0, 95, "MPa", "mm")]);

// Plane frame, plate in plane stress, Arrhenius shelf life, Nernst, Butler–Volmer and Tafel: each calculator's defaults.
{
  const fr = parseFrame(
    ["node A 0,0", "node B 0,4", "node C 6,4", "node D 6,0", "E=200e6 A=0.01 I=1e-4", "member 1 A-B", "member 2 B-C", "member 3 C-D", "support A fixed", "support D fixed", "load B Fx=10", "udl 2 -5"].join("\n"),
  );
  const frr = fr.model ? analyzeFrame(fr.model) : null;
  if (!frr || !frr.ok) throw new Error("corpus: frame default did not solve");
  figures.push(["plane frame portal", frameChartSvg(frr, { force: "kN", length: "m" })]);
  const pl = parsePlate(["plate 100 x 20 t=1", "material E=200000 nu=0.3", "mesh 60 x 12", "support left fixed", "traction right ty=-5"].join("\n"));
  const plr = pl.model ? analyzePlate(pl.model) : null;
  if (!plr || !plr.ok) throw new Error("corpus: plate default did not solve");
  figures.push(["plate fea cantilever", plateChartSvg(plr, "MPa")]);
  const st = parseStability(["40 0.00412", "50 0.0119", "60 0.0318", "70 0.0805"].join("\n"), "first");
  if (!st.points) throw new Error("corpus: stability default did not parse");
  const ar = arrhenius(st.points, 25, "first");
  if (!ar.ok) throw new Error("corpus: arrhenius default did not fit");
  figures.push(["arrhenius shelf life", arrheniusChartSvg(ar)]);
  const ne = nernst(0.34, 2, 25, [], [{ a: 0.01, nu: 1 }]);
  if (typeof ne === "string") throw new Error(`corpus: nernst: ${ne}`);
  figures.push(["nernst line", nernstChartSvg(0.34, ne.slopePerDecade, ne.lnQ / Math.LN10)]);
  const bv = { j0: 1e-3, alphaA: 0.5, alphaC: 0.5, tC: 25 };
  figures.push(["butler-volmer curve", butlerVolmerChartSvg(bv, 0.2, "A/cm²")]);
  const tdata = butlerVolmerCurve(bv, -0.3, 0.3, 25).filter(([e]) => Math.abs(e) >= 0.1);
  const tf = tafelFit(tdata, 25, 0.1);
  if (typeof tf === "string") throw new Error(`corpus: tafel: ${tf}`);
  figures.push(["tafel fit", tafelChartSvg(tdata, tf)]);
}

// The general plotter, on the shapes the Thermal release uses.
figures.push([
  "plot hx profile",
  buildPlotSvg(
    [
      { points: Array.from({ length: 61 }, (_, i) => ({ x: i / 60, y: 150 - i })), type: "line", color: "#b91c1c", label: "hot" },
      { points: Array.from({ length: 61 }, (_, i) => ({ x: i / 60, y: 70 - (40 * i) / 60 })), type: "line", color: "#2563eb", label: "cold" },
    ],
    { width: 380, height: 250, xlabel: "Fraction along the exchanger", ylabel: "Temperature (deg C)", title: "Counterflow temperature profile" },
  ),
]);
const ntuSeries: Series[] = ["counter", "parallel", "crossboth", "shell"].map((f, i) => ({
  points: Array.from({ length: 121 }, (_, j) => ({ x: (j * 6) / 120, y: 100 * (1 - Math.exp(-(j * 6) / 120)) * (1 - i * 0.1) })),
  type: "line" as const,
  color: ["#2563eb", "#b91c1c", "#059669", "#d97706"][i],
  label: f,
}));
ntuSeries.push({ points: [{ x: 2, y: 66.7 }], type: "scatter", color: "#111111", label: "this exchanger" });
figures.push([
  "plot ntu",
  buildPlotSvg(ntuSeries, { width: 380, height: 260, xlabel: "NTU = U*A / Cmin", ylabel: "Effectiveness (%)", title: "Effectiveness vs NTU at Cr = 0.75" }),
]);
figures.push([
  "plot cooling",
  buildPlotSvg(
    [
      { points: Array.from({ length: 81 }, (_, i) => ({ x: i * 10, y: 25 + 175 * Math.exp((-i * 10) / 202) })), type: "line", color: "#2563eb", label: "body" },
      { points: [{ x: 0, y: 25 }, { x: 800, y: 25 }], type: "line", color: "#888888", label: "ambient" },
    ],
    { width: 380, height: 250, xlabel: "Time (s)", ylabel: "Temperature (deg C)", title: "Cooling curve, tau = 202 s" },
  ),
]);
figures.push([
  "plot big numbers",
  buildPlotSvg(
    [{ points: Array.from({ length: 40 }, (_, i) => ({ x: i * 1e5, y: i * 1.234e7 })), type: "line", color: "#2563eb", label: "a very long series label indeed" }],
    { width: 380, height: 250, xlabel: "A rather long x axis label", ylabel: "A rather long y axis label", title: "A title that is also quite long" },
  ),
]);

// The Reliability release. These are built FROM THE ENGINES rather than from
// hand-made points, because the layout hazards here come from what the engines
// actually produce: a probability plot whose y axis is ln(-ln(1-F)) and runs
// negative, availabilities that sit at 0.996 so every tick needs four decimals,
// and mean lives that reach 1e5 hours.
const wf = weibullFit({
  times: [412, 598, 742, 801, 955, 1120, 1204, 1580, 2000, 2000, 2000, 2000],
  events: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
});
if (wf.ok) {
  figures.push([
    "rel weibull plot",
    buildPlotSvg(
      [
        { points: wf.points, type: "scatter", color: "#2563eb", label: "observed" },
        { points: wf.fitLine, type: "line", color: "#b91c1c", label: "maximum likelihood" },
      ],
      { width: 380, height: 260, xlabel: "ln(life in hours)", ylabel: "ln(-ln(1 - F))", title: "Straight means Weibull fits" },
    ),
  ]);
}
for (const cfg of ["series", "parallel"] as const) {
  const rb = reliabilityBlock({
    components: [
      { name: "Pump", lambda: 1.2e-4, quantity: 2 },
      { name: "Control valve", lambda: 5e-5, quantity: 3 },
      { name: "Sensor", lambda: 3e-5, quantity: 4 },
    ],
    configuration: cfg,
    timeH: 8760,
  });
  if (rb.ok) {
    figures.push([
      `rel rbd ${cfg}`,
      buildPlotSvg(
        [
          { points: rb.curve.map((c) => ({ x: c.t, y: c.R })), type: "line", color: "#2563eb", label: "system" },
          { points: rb.unitCurve.map((c) => ({ x: c.t, y: c.R })), type: "line", color: "#b91c1c", label: rb.unitCurveLabel },
        ],
        { width: 380, height: 260, xlabel: "Hours", ylabel: "Surviving", title: "The system outlives every part" },
      ),
    ]);
  }
}
const kn = kOutOfN({ n: 3, k: 2, unitReliability: Math.exp(-5e-5 * 8760), lambda: 5e-5 });
if (kn.ok) {
  figures.push([
    "rel koon",
    buildPlotSvg(
      [
        { points: kn.curve.map((c) => ({ x: c.unitR, y: c.R })), type: "line", color: "#2563eb", label: "2 of 3" },
        { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], type: "line", color: "#94a3b8", label: "one unit alone" },
        { points: [{ x: Math.exp(-5e-5 * 8760), y: kn.systemReliability }], type: "scatter", color: "#b91c1c", label: "this system" },
      ],
      { width: 380, height: 260, xlabel: "Reliability of one unit", ylabel: "Reliability of the system", title: "Redundancy only pays where units are good" },
    ),
  ]);
}
const rd = redundancy({ lambda: 1e-4, n: 3, timeH: 5000 });
if (rd.ok) {
  figures.push([
    "rel redundancy",
    buildPlotSvg(
      [
        { points: rd.standbySweep.map((p) => ({ x: p.n, y: p.mttf })), type: "line", color: "#2563eb", label: "standby, ideal switch" },
        { points: rd.activeSweep.map((p) => ({ x: p.n, y: p.mttf })), type: "line", color: "#b91c1c", label: "active" },
      ],
      { width: 380, height: 260, xlabel: "Units in total", ylabel: "Mean time to failure (h)", title: "Linear against harmonic" },
    ),
  ]);
}
for (const [mtbf, mttr] of [[2000, 8], [1e6, 0.5]] as [number, number][]) {
  const av = availability({ mtbfH: mtbf, mttrH: mttr, windowH: 8760, unitsInSeries: 5 });
  if (av.ok) {
    figures.push([
      `rel availability ${mtbf}/${mttr}`,
      buildPlotSvg(
        [
          { points: av.curve.map((c) => ({ x: c.mttr, y: c.A })), type: "line", color: "#2563eb", label: "availability" },
          { points: [{ x: mttr, y: av.availability }], type: "scatter", color: "#b91c1c", label: "this repair time" },
        ],
        { width: 380, height: 260, xlabel: "Mean time to repair (h)", ylabel: "Availability", title: "Repair time is the lever" },
      ),
    ]);
  }
}

// --- v2.83.0: fluids, thermal and fatigue figures --------------------------

// The S-N sketch, both material classes — log x, two legend entries, and the
// steel knee that pushes a flat segment to the right edge.
for (const mclass of ["steel", "non-ferrous"] as const) {
  const sut = 700;
  const mk = (limit: number) => {
    const s1000 = 0.9 * sut;
    const b = -Math.log10(s1000 / limit) / 3;
    const a = s1000 / Math.pow(1000, b);
    const endExp = mclass === "steel" ? 6 : Math.log10(5e8);
    const pts = Array.from({ length: 61 }, (_, i) => {
      const N = Math.pow(10, 3 + ((endExp - 3) * i) / 60);
      return { x: N, y: a * Math.pow(N, b) };
    });
    if (mclass === "steel") pts.push({ x: 1e7, y: limit });
    return pts;
  };
  figures.push([
    `sn ${mclass}`,
    buildPlotSvg(
      [
        { points: mk(350), type: "line", color: "#9ca3af", label: "uncorrected Se'" },
        { points: mk(178), type: "line", color: "#2563eb", label: "corrected Se" },
      ],
      { width: 380, height: 260, xScale: "log", xlabel: "cycles to failure N", ylabel: "alternating stress (MPa)", title: "Estimated S-N curve" },
    ),
  ]);
}

// The specific-energy diagram: four legend entries, two scatter points close
// to the curve's nose where labels like to collide.
{
  const Q = 8.6;
  const g = 9.80665;
  const A = (y: number) => (3 + 2 * y) * y; // trapezoid b=3, z=2
  const curve = Array.from({ length: 60 }, (_, i) => {
    const y = (2.7 * (i + 1)) / 60;
    return { x: y + (Q * Q) / (2 * g * A(y) * A(y)), y };
  }).filter((p) => p.x <= 5);
  figures.push([
    "spec energy",
    buildPlotSvg(
      [
        { points: curve, type: "line", color: "#2563eb", label: "E(y) at this Q" },
        { points: [{ x: 0, y: 0 }, { x: 2.7, y: 2.7 }], type: "line", color: "#9ca3af", label: "E = y" },
        { points: [{ x: 1.31, y: 1.2 }], type: "scatter", color: "#b91c1c", label: "this flow" },
        { points: [{ x: 1.24, y: 0.83 }], type: "scatter", color: "#059669", label: "critical depth" },
      ],
      { width: 380, height: 270, xlabel: "specific energy E (m)", ylabel: "depth y (m)", title: "Specific energy diagram" },
    ),
  ]);
}

// The NPSH ledger: healthy, cavitating, a pump far above the liquid (drives
// the bars hard right — the case that clipped a value label), and a
// requirement far past every bar (drives ITS label to the edge).
figures.push(["npsh ledger", npshLadderSvg({ surfaceHead: 10.35, staticHead: 2, vapourHead: 0.24, losses: 0.5, npshAvailable: 11.61, npshRequired: 3 })]);
figures.push(["npsh cavitating", npshLadderSvg({ surfaceHead: 10.35, staticHead: -6, vapourHead: 3.8, losses: 1.9, npshAvailable: -1.35, npshRequired: 3 })]);
figures.push(["npsh deep lift", npshLadderSvg({ surfaceHead: 10.35, staticHead: -50, vapourHead: 0.24, losses: 0.5, npshAvailable: -40.39, npshRequired: 3 })]);
figures.push(["npsh big requirement", npshLadderSvg({ surfaceHead: 10.35, staticHead: 2, vapourHead: 0.24, losses: 0.5, npshAvailable: 11.61, npshRequired: 120 })]);

// The system head curve — quadratic-ish sweep with the working point on it.
figures.push([
  "system head",
  buildPlotSvg(
    [
      { points: Array.from({ length: 36 }, (_, i) => { const q = 15.7 * (0.1 + (1.9 * (i + 1)) / 36); return { x: q, y: 0.052 * q * q }; }), type: "line", color: "#2563eb", label: "system head" },
      { points: [{ x: 15.7, y: 12.8 }], type: "scatter", color: "#b91c1c", label: "this flow" },
    ],
    { width: 380, height: 260, xlabel: "flow rate (L/s)", ylabel: "head loss (m)", title: "System head curve" },
  ),
]);

// The wall temperature profile — vertical film steps at both faces.
figures.push([
  "wall profile",
  buildPlotSvg(
    [{ points: [{ x: 0, y: 20 }, { x: 0, y: 12.4 }, { x: 200, y: 8.1 }, { x: 250, y: -3.9 }, { x: 250, y: -5 }], type: "line", color: "#b91c1c" }],
    { width: 380, height: 250, xlabel: "distance from inner surface (mm)", ylabel: "temperature (°C)", title: "Temperature through the wall" },
  ),
]);

// NPSH against flow: three series, one of them a flat requirement line.
figures.push([
  "npsh vs flow",
  buildPlotSvg(
    [
      { points: Array.from({ length: 36 }, (_, i) => { const q = 15 * (0.1 + (1.9 * (i + 1)) / 36); return { x: q, y: 12.1 - 0.02 * q * q }; }), type: "line", color: "#2563eb", label: "NPSH available" },
      { points: [{ x: 1.5, y: 3 }, { x: 30, y: 3 }], type: "line", color: "#b91c1c", label: "NPSH required" },
      { points: [{ x: 15, y: 7.6 }], type: "scatter", color: "#059669", label: "this flow" },
    ],
    { width: 380, height: 250, xlabel: "flow (L/s)", ylabel: "NPSH (m)", title: "NPSH available against flow" },
  ),
]);

// Load blocks over the S-N line — scatter points deliberately ON the curve.
{
  const sut = 700, se = 250, s1000 = 0.9 * sut;
  const b = -Math.log10(s1000 / se) / 3;
  const a = s1000 / Math.pow(1000, b);
  const line = Array.from({ length: 61 }, (_, i) => { const N = Math.pow(10, 3 + (3 * i) / 60); return { x: N, y: a * Math.pow(N, b) }; });
  line.push({ x: 1e7, y: se });
  figures.push([
    "sn blocks",
    buildPlotSvg(
      [
        { points: line, type: "line", color: "#2563eb", label: "S-N line" },
        { points: [{ x: 1000, y: 420 }, { x: 20000, y: 350 }, { x: 500000, y: 280 }], type: "scatter", color: "#b91c1c", label: "applied blocks" },
      ],
      { width: 380, height: 260, xScale: "log", xlabel: "cycles N", ylabel: "alternating stress (MPa)", title: "Load blocks against the S-N line" },
    ),
  ]);
}

// --- v2.84.0: thermo and aero figures ---------------------------------------

// P-v process path: isentropic compression 10:1 — steep curve into the corner
// where the state-2 label lives.
{
  const p1 = 100, v1 = 0.8614, n = 1.4, v2 = 0.1663;
  const path = Array.from({ length: 49 }, (_, i) => {
    const v = v1 * Math.pow(v2 / v1, i / 48);
    return { x: v, y: p1 * Math.pow(v1 / v, n) };
  });
  figures.push([
    "pv process",
    buildPlotSvg(
      [
        { points: path, type: "line", color: "#2563eb", label: "process path" },
        { points: [{ x: v1, y: p1 }], type: "scatter", color: "#059669", label: "state 1" },
        { points: [{ x: v2, y: 1000 }], type: "scatter", color: "#b91c1c", label: "state 2" },
      ],
      { width: 380, height: 260, xlabel: "volume (m³)", ylabel: "pressure (kPa)", title: "isentropic process on the P-v plane" },
    ),
  ]);
}

// Otto cycle on log pressure — the full four-leg loop with corner markers.
{
  const k = 1.4, r = 8, p2 = Math.pow(r, k), p3 = p2 * (1800.15 / 689.2);
  const path: { x: number; y: number }[] = [{ x: r, y: 1 }];
  for (let i = 1; i <= 30; i++) { const v = r * Math.pow(1 / r, i / 30); path.push({ x: v, y: Math.pow(r / v, k) }); }
  path.push({ x: 1, y: p3 });
  for (let i = 1; i <= 30; i++) { const v = Math.pow(r, i / 30); path.push({ x: v, y: p3 * Math.pow(1 / v, k) }); }
  path.push({ x: r, y: 1 });
  figures.push([
    "otto cycle",
    buildPlotSvg(
      [
        { points: path, type: "line", color: "#2563eb", label: "cycle path" },
        { points: [{ x: r, y: 1 }, { x: 1, y: p2 }, { x: 1, y: p3 }, { x: r, y: p3 * Math.pow(1 / r, k) }], type: "scatter", color: "#b91c1c", label: "states 1-4" },
      ],
      { width: 380, height: 270, yScale: "log", xlabel: "volume ratio", ylabel: "pressure ratio P/P₁", title: "Otto cycle on the P-v plane" },
    ),
  ]);
}

// ISA profile: three ratio curves that converge at (1, 0) — label crowding at
// the shared origin is the case to police.
{
  const t = (zkm: number) => Math.max(0.75, 1 - 0.0226 * zkm);
  const pr = (zkm: number) => Math.exp(-zkm / 7.3);
  figures.push([
    "isa profile",
    buildPlotSvg(
      [
        { points: Array.from({ length: 61 }, (_, i) => ({ x: t(i / 3), y: i / 3 })), type: "line", color: "#b91c1c", label: "T / T₀" },
        { points: Array.from({ length: 61 }, (_, i) => ({ x: pr(i / 3), y: i / 3 })), type: "line", color: "#2563eb", label: "p / p₀" },
        { points: Array.from({ length: 61 }, (_, i) => ({ x: pr(i / 3) / t(i / 3), y: i / 3 })), type: "line", color: "#059669", label: "ρ / ρ₀" },
        { points: [{ x: 0.34, y: 10 }], type: "scatter", color: "#111111", label: "this altitude" },
      ],
      { width: 380, height: 270, xlabel: "fraction of sea-level value", ylabel: "altitude (km)", title: "Standard atmosphere profile" },
    ),
  ]);
}

// Drag polar with the tangent ray and two markers near the curve.
{
  const cd0 = 0.02, kInd = 1 / (Math.PI * 9 * 0.8);
  const polar = Array.from({ length: 51 }, (_, i) => { const cl = (0.95 * i) / 50; return { x: cd0 + kInd * cl * cl, y: cl }; });
  figures.push([
    "drag polar",
    buildPlotSvg(
      [
        { points: polar, type: "line", color: "#2563eb", label: "drag polar" },
        { points: [{ x: 0, y: 0 }, { x: 0.05, y: 0.841 }], type: "line", color: "#9ca3af", label: "best L/D ray" },
        { points: [{ x: 0.028, y: 0.425 }], type: "scatter", color: "#b91c1c", label: "this flight" },
        { points: [{ x: 0.04, y: 0.673 }], type: "scatter", color: "#059669", label: "best L/D" },
      ],
      { width: 380, height: 270, xlabel: "CD", ylabel: "CL", title: "Drag polar" },
    ),
  ]);
}

// Turn radius on a log axis, spanning 34 m to 4.4 km.
figures.push([
  "turn radius",
  buildPlotSvg(
    [
      { points: Array.from({ length: 81 }, (_, i) => { const deg = 5 + i; return { x: deg, y: (61.7 * 61.7) / (9.80665 * Math.tan((deg * Math.PI) / 180)) }; }), type: "line", color: "#2563eb", label: "turn radius" },
      { points: [{ x: 45, y: 389 }], type: "scatter", color: "#b91c1c", label: "this bank" },
    ],
    { width: 380, height: 250, yScale: "log", xlabel: "bank angle (°)", ylabel: "turn radius (m)", title: "Turn radius against bank" },
  ),
]);

// --- v2.85.0: control, vibration and electronics figures --------------------

// Pole-zero maps: a stable triple, an unstable pair in the shaded half plane,
// and a cluster hugging the imaginary axis where labels crowd the boundary.
figures.push(["pz stable", poleZeroSvg([{ re: -1, im: 0 }, { re: -0.5, im: 1.2 }, { re: -0.5, im: -1.2 }], [{ re: -2, im: 0 }])]);
figures.push(["pz unstable", poleZeroSvg([{ re: 0.3, im: 2 }, { re: 0.3, im: -2 }, { re: -3, im: 0 }], [])]);
figures.push(["pz axis-hugging", poleZeroSvg([{ re: -0.01, im: 0.5 }, { re: -0.01, im: -0.5 }, { re: 0, im: 0 }], [{ re: 0.02, im: 0 }])]);

// Power bars: milliwatt values (the formatter case), and a mixed-sign budget.
figures.push(["power bars", hBarSvg([
  { name: "V1", value: -8.33e-3, colour: "#059669" },
  { name: "R1", value: 2.78e-3, colour: "#2563eb" },
  { name: "R2", value: 5.56e-3, colour: "#2563eb" },
], { title: "Power per element", unit: "W" })]);
figures.push(["long bars", hBarSvg(
  Array.from({ length: 12 }, (_, i) => ({ name: `element-${i + 1}`, value: (i - 4) * 1.7 })),
  { title: "A longer mixed-sign budget", unit: "kJ" },
)]);

// Logic waveforms at the default four variables (16 columns).
figures.push(["logic waves", logicWaveSvg({
  variables: ["A", "B", "C", "D"],
  rows: Array.from({ length: 16 }, (_, i) => ({
    inputs: [8, 4, 2, 1].map((b) => (i & b) !== 0),
    output: [0, 1, 2, 5, 6, 7, 8, 9, 10, 14].includes(i),
  })),
})]);

// The FRF with resonance peaks on a log axis and the operating point off-peak.
{
  const frf = Array.from({ length: 90 }, (_, i) => {
    const w = (14 * (i + 1)) / 90;
    const den = (wn: number) => Math.sqrt((wn * wn - w * w) ** 2 + (2 * 0.02 * wn * w) ** 2);
    return { x: w, y: 10 / den(6.18) + 4 / den(16.18) };
  });
  figures.push([
    "mdof frf",
    buildPlotSvg(
      [
        { points: frf, type: "line", color: "#2563eb", label: "DOF 1" },
        { points: [{ x: 8, y: 0.34 }], type: "scatter", color: "#b91c1c", label: "this frequency" },
      ],
      { width: 380, height: 250, yScale: "log", xlabel: "forcing frequency ω (rad/s)", ylabel: "steady-state amplitude", title: "Frequency response, DOF 1" },
    ),
  ]);
}

// Mode shapes: five modes of a five-mass chain, legend at its row cap.
figures.push([
  "mode shapes",
  buildPlotSvg(
    Array.from({ length: 5 }, (_, j) => ({
      points: Array.from({ length: 6 }, (_, i) => ({ x: i, y: i === 0 ? 0 : Math.sin(((j + 1) * Math.PI * i) / 5.5) })),
      type: "line" as const,
      color: ["#2563eb", "#b91c1c", "#059669", "#d97706", "#7c3aed"][j],
      label: `mode ${j + 1} (${(1.1 * (j + 1)).toFixed(2)} Hz)`,
    })),
    { width: 380, height: 250, xlabel: "degree of freedom (0 = anchor)", ylabel: "mass-normalised amplitude", title: "Mode shapes" },
  ),
]);

// Op-amp gain: closed loop meeting the open-loop roll-off, both log axes.
{
  const bw = 1e4;
  const pts = Array.from({ length: 61 }, (_, i) => {
    const f = 10 * Math.pow(1e5, i / 60);
    return { x: f, y: 20 * Math.log10(100 / Math.sqrt(1 + (f / bw) ** 2)) };
  });
  const ol = Array.from({ length: 61 }, (_, i) => {
    const f = 10 * Math.pow(1e5, i / 60);
    return { x: f, y: 20 * Math.log10(1e6 / f) };
  }).filter((p) => p.y > -0.1);
  figures.push([
    "opamp gain",
    buildPlotSvg(
      [
        { points: pts, type: "line", color: "#2563eb", label: "closed-loop gain" },
        { points: ol, type: "line", color: "#9ca3af", label: "open-loop roll-off" },
        { points: [{ x: bw, y: 20 * Math.log10(100) - 3 }], type: "scatter", color: "#b91c1c", label: "-3 dB" },
      ],
      { width: 380, height: 250, xScale: "log", xlabel: "frequency (Hz)", ylabel: "gain (dB)", title: "Gain against frequency" },
    ),
  ]);
}

// --- v2.86.0: energy figures -------------------------------------------------

// The power triangle at the default 0.8 pf, at unity (collapsed), and at a
// heavily reactive 0.3 where the arc label crowds the hypotenuse.
figures.push(["power triangle", powerTriangleSvg(55.4, 41.6, 69.3, 0.8)]);
figures.push(["power triangle unity", powerTriangleSvg(69.3, 0, 69.3, 1)]);
figures.push(["power triangle reactive", powerTriangleSvg(20.8, 66.1, 69.3, 0.3)]);

// The cube-law wind curve: four series, three of them near-coincident at the
// left where the legend used to sit.
figures.push([
  "wind cube law",
  buildPlotSvg(
    [
      { points: Array.from({ length: 51 }, (_, i) => { const v = (25 * i) / 50; return { x: v, y: 1994 * Math.pow(v / 8, 3) }; }), type: "line", color: "#9ca3af", label: "in the wind" },
      { points: Array.from({ length: 51 }, (_, i) => { const v = (25 * i) / 50; return { x: v, y: 1181 * Math.pow(v / 8, 3) }; }), type: "line", color: "#2563eb", label: "Betz bound 16/27" },
      { points: Array.from({ length: 51 }, (_, i) => { const v = (25 * i) / 50; return { x: v, y: 897 * Math.pow(v / 8, 3) }; }), type: "line", color: "#059669", label: "Cp = 0.45" },
      { points: [{ x: 8, y: 897 }], type: "scatter", color: "#b91c1c", label: "this wind speed" },
    ],
    { width: 380, height: 260, xlabel: "hub-height wind speed (m/s)", ylabel: "power (kW)", title: "Power goes as the cube of wind speed" },
  ),
]);

// The Weibull pdf with three unlabeled stems and two markers near the peak.
{
  const k = 2, c = 8;
  const pdf = (v: number) => (k / c) * Math.pow(v / c, k - 1) * Math.exp(-Math.pow(v / c, k));
  const curve = Array.from({ length: 120 }, (_, i) => { const v = 0.05 + (27.95 * i) / 119; return { x: v, y: pdf(v) }; });
  const yCap = Math.max(...curve.map((p) => p.y));
  figures.push([
    "weibull pdf",
    buildPlotSvg(
      [
        { points: curve, type: "line", color: "#2563eb", label: "Weibull k=2, c=8" },
        { points: [{ x: 3, y: 0 }, { x: 3, y: yCap * 0.85 }], type: "line", color: "#9ca3af" },
        { points: [{ x: 12, y: 0 }, { x: 12, y: yCap * 0.85 }], type: "line", color: "#9ca3af" },
        { points: [{ x: 25, y: 0 }, { x: 25, y: yCap * 0.85 }], type: "line", color: "#9ca3af" },
        { points: [{ x: 7.09, y: pdf(7.09) }, { x: 5.66, y: pdf(5.66) }], type: "scatter", color: "#b91c1c", label: "mean / mode" },
      ],
      { width: 380, height: 260, xlabel: "wind speed (m/s)", ylabel: "probability density (per m/s)", title: "The fitted wind distribution" },
    ),
  ]);
}

// Battery runtime log-log with two curves and a marker.
figures.push([
  "battery runtime",
  buildPlotSvg(
    [
      { points: Array.from({ length: 49 }, (_, i) => { const I = 1 * Math.pow(100, i / 48); return { x: I, y: 18 / I }; }), type: "line", color: "#2563eb", label: "ideal Ah / I" },
      { points: Array.from({ length: 49 }, (_, i) => { const I = 1 * Math.pow(100, i / 48); return { x: I, y: 18 / Math.pow(I, 1.15) }; }), type: "line", color: "#b91c1c", label: "Peukert-corrected" },
      { points: [{ x: 10, y: 1.8 }], type: "scatter", color: "#059669", label: "this load" },
    ],
    { width: 380, height: 250, xScale: "log", yScale: "log", xlabel: "discharge current (A)", ylabel: "runtime (h)", title: "Runtime against discharge current" },
  ),
]);

// The solar day curve crossing the horizon twice, markers at the crossings.
{
  const elev = (h: number) => 73.4 * Math.sin((Math.PI * (h - 4.7)) / 14.6) - 10;
  const day = Array.from({ length: 97 }, (_, i) => { const h = (24 * i) / 96; return { x: h, y: Math.max(-35, elev(h)) }; });
  figures.push([
    "solar day",
    buildPlotSvg(
      [
        { points: day, type: "line", color: "#d97706", label: "solar elevation" },
        { points: [{ x: 0, y: 0 }, { x: 24, y: 0 }], type: "line", color: "#9ca3af" },
        { points: [{ x: 12, y: 63.4 }], type: "scatter", color: "#b91c1c", label: "solar noon" },
        { points: [{ x: 4.7, y: 0 }, { x: 19.3, y: 0 }], type: "scatter", color: "#2563eb", label: "sunrise / sunset" },
      ],
      { width: 380, height: 260, xlabel: "solar time (h)", ylabel: "sun elevation (°)", title: "The sun's day at this latitude" },
    ),
  ]);
}

// The combustion mass-balance bars, with the long balance-row name.
figures.push([
  "combustion balance",
  hBarSvg(
    [
      { name: "fuel in", value: 1, colour: "#059669" },
      { name: "air in", value: 17.2, colour: "#059669" },
      { name: "CO₂ out", value: -2.74, colour: "#b91c1c" },
      { name: "H₂O out", value: -2.25, colour: "#2563eb" },
      { name: "N₂ + unused O₂ out", value: -13.2, colour: "#9ca3af" },
    ],
    { title: "Mass balance per kg of fuel", unit: "kg" },
  ),
]);

// --- v2.87.0: audio + video figures -----------------------------------------

// The gamut triangles: an enclosing pair and a partial-coverage pair.
{
  const by = (id: string) => GAMUT_DEFS.find((g) => g.id === id)!;
  figures.push([
    "gamut dcip3 vs srgb",
    gamutTriangleSvg({
      gamutLabel: "DCI-P3",
      refLabel: "sRGB",
      gamutPrimaries: by("dcip3").primaries,
      refPrimaries: by("srgb").primaries,
      coverageUv: 1,
    }),
  ]);
  figures.push([
    "gamut srgb vs bt2020",
    gamutTriangleSvg({
      gamutLabel: "sRGB",
      refLabel: "BT.2020",
      gamutPrimaries: by("srgb").primaries,
      refPrimaries: by("bt2020").primaries,
      coverageUv: 0.52,
    }),
  ]);
}

// The fold diagram — the sawtooth plus three markers near its teeth.
{
  const fs = 44100;
  const fold = Array.from({ length: 200 }, (_, i) => {
    const f = (2.5 * fs * (i + 1)) / 200;
    const m = f % fs;
    return { x: f, y: m <= fs / 2 ? m : fs - m };
  });
  figures.push([
    "fold diagram",
    buildPlotSvg(
      [
        { points: fold, type: "line", color: "#2563eb", label: "lands at" },
        { points: [{ x: 20000, y: 20000 }], type: "scatter", color: "#059669", label: "signal max" },
        { points: [{ x: 22050, y: 22050 }], type: "scatter", color: "#b91c1c", label: "Nyquist" },
      ],
      { width: 380, height: 260, xlabel: "input frequency (Hz)", ylabel: "apparent frequency after sampling (Hz)", title: "The fold diagram" },
    ),
  ]);
}

// The comb with its floored notches on a log axis.
{
  const t = 0.001;
  const comb = Array.from({ length: 401 }, (_, i) => {
    const f = 100 * Math.pow(20, i / 400);
    return { x: f, y: Math.max(-30, 20 * Math.log10(Math.abs(2 * Math.cos(Math.PI * f * t)))) };
  });
  figures.push([
    "comb response",
    buildPlotSvg(
      [
        { points: comb, type: "line", color: "#2563eb", label: "response" },
        { points: [500, 1500, 2500, 3500, 4500].map((f) => ({ x: f, y: -30 })), type: "scatter", color: "#b91c1c", label: "cancellations" },
        { points: [1000, 2000, 3000, 4000, 5000].map((f) => ({ x: f, y: 6.02 })), type: "scatter", color: "#059669", label: "reinforcements" },
      ],
      { width: 380, height: 250, xScale: "log", xlabel: "frequency (Hz)", ylabel: "response (dB, floored at -30)", title: "The comb" },
    ),
  ]);
}

// The PQ curve on log nits.
figures.push([
  "pq curve",
  buildPlotSvg(
    [
      { points: Array.from({ length: 201 }, (_, i) => { const code = 0.005 + (0.995 * i) / 200; const m1 = 0.1593017578125, m2 = 78.84375, c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875; const cp = Math.pow(code, 1 / m2); const n = Math.max(cp - c1, 0) / (c2 - c3 * cp); return { x: code, y: 10000 * Math.pow(n, 1 / m1) }; }).filter((p) => p.y > 0), type: "line", color: "#2563eb", label: "ST 2084 (PQ)" },
      { points: [{ x: 0.751, y: 1000 }], type: "scatter", color: "#b91c1c", label: "this peak" },
    ],
    { width: 380, height: 250, yScale: "log", xlabel: "PQ code value (0-1)", ylabel: "luminance (nits)", title: "The absolute PQ curve" },
  ),
]);

// The buffer timeline and the latency bars.
figures.push([
  "buffer timeline",
  buildPlotSvg(
    [
      { points: [{ x: 0, y: 0 }, { x: 13.33, y: 8 }, { x: 21.33, y: 0 }], type: "line", color: "#2563eb", label: "buffer held" },
      { points: [{ x: 13.33, y: 8 }], type: "scatter", color: "#059669", label: "playback starts" },
      { points: [{ x: 21.33, y: 0 }], type: "scatter", color: "#b91c1c", label: "stall if outage" },
    ],
    { width: 380, height: 250, xlabel: "time (s)", ylabel: "buffer held (s of video)", title: "Fill on the surplus, drain through an outage" },
  ),
]);
figures.push([
  "latency bars",
  hBarSvg(
    [
      { name: "capture", value: 5, colour: "#2563eb" },
      { name: "encode", value: 20, colour: "#2563eb" },
      { name: "network", value: 30, colour: "#b91c1c" },
      { name: "decode", value: 8, colour: "#2563eb" },
      { name: "sum", value: 63, colour: "#9ca3af" },
      { name: "delivered", value: 66.67, colour: "#059669" },
    ],
    { title: "Latency budget at 60 Hz", unit: "ms" },
  ),
]);

// The mode map: three scatter rows with crowded low-frequency axials.
figures.push([
  "mode map",
  buildPlotSvg(
    [
      { points: [34.3, 42.9, 68.6, 68.6, 85.8, 102.9, 137.2].map((f) => ({ x: f, y: 3 })), type: "scatter", color: "#b91c1c", label: "axial" },
      { points: [54.9, 77.4, 80.9, 98.6, 110.1, 123.5].map((f) => ({ x: f, y: 2 })), type: "scatter", color: "#2563eb", label: "tangential" },
      { points: [89.5, 112.3, 130.7, 145.2].map((f) => ({ x: f, y: 1 })), type: "scatter", color: "#9ca3af", label: "oblique" },
    ],
    { width: 380, height: 220, xlabel: "mode frequency (Hz)", ylabel: "audibility rank", title: "The mode map" },
  ),
]);

// --- v2.88.0: comp, chips, optics and quantum figures ------------------------

// The generic ladder in both conventions: a thermal ladder that must stay
// LEFT of its limit, and a timing budget that must end RIGHT of zero.
figures.push([
  "thermal ladder",
  ladderSvg(
    [
      { name: "ambient", delta: 25, gain: true },
      { name: "θ sink-to-ambient", delta: 19.5, gain: true },
      { name: "θ case-to-sink", delta: 3, gain: true },
      { name: "θ junction-to-case", delta: 7.5, gain: true },
      { name: "junction", delta: 55, gain: true, result: true },
    ],
    { title: "The thermal ladder", axisLabel: "temperature (°C)", fmt: (v) => v.toFixed(1), limit: 125, limitLabel: "Tj max 125 °C", limitOkAbove: false, okText: "within limit", failText: "OVER LIMIT" },
  ),
]);
figures.push([
  "timing ladder",
  ladderSvg(
    [
      { name: "clock period", delta: 1000, gain: true },
      { name: "clock-to-Q", delta: -100, gain: false },
      { name: "longest logic", delta: -700, gain: false },
      { name: "setup time", delta: -80, gain: false },
      { name: "clock skew", delta: 0, gain: true },
      { name: "setup slack", delta: 120, gain: true, result: true },
    ],
    { title: "The setup budget", axisLabel: "time (ps)", fmt: (v) => `${Math.round(v)}`, limit: 0, limitLabel: "slack = 0", limitOkAbove: true, okText: "PASS", failText: "FAIL" },
  ),
]);
figures.push([
  "timing ladder FAIL",
  ladderSvg(
    [
      { name: "clock period", delta: 500, gain: true },
      { name: "clock-to-Q", delta: -100, gain: false },
      { name: "longest logic", delta: -700, gain: false },
      { name: "setup slack", delta: -300, gain: true, result: true },
    ],
    { title: "The setup budget", axisLabel: "time (ps)", fmt: (v) => `${Math.round(v)}`, limit: 0, limitLabel: "slack = 0", limitOkAbove: true, okText: "PASS", failText: "FAIL" },
  ),
]);

// The stability diagram's parametric hyperbola with the axes as series.
{
  const G = 3;
  const hyp: { x: number; y: number }[] = [];
  for (let i = 0; i <= 80; i++) {
    const t = -Math.log(G) + (2 * Math.log(G) * i) / 80;
    hyp.push({ x: Math.exp(t), y: Math.exp(-t) });
  }
  figures.push([
    "stability diagram",
    buildPlotSvg(
      [
        { points: hyp, type: "line", color: "#2563eb", label: "g₁g₂ = 1" },
        { points: hyp.map((p) => ({ x: -p.x, y: -p.y })), type: "line", color: "#2563eb" },
        { points: [{ x: -G, y: 0 }, { x: G, y: 0 }], type: "line", color: "#9ca3af" },
        { points: [{ x: 0, y: -G }, { x: 0, y: G }], type: "line", color: "#9ca3af" },
        { points: [{ x: 0.5, y: 0.5 }], type: "scatter", color: "#059669", label: "this cavity (stable)" },
      ],
      { width: 380, height: 270, xlabel: "g₁ = 1 − L/R₁", ylabel: "g₂ = 1 − L/R₂", title: "The stability diagram" },
    ),
  ]);
}

// The CHSH stem chart: bounds as lines, S saturating Tsirelson exactly.
figures.push([
  "chsh stems",
  buildPlotSvg(
    [
      { points: [{ x: -0.6, y: 0 }, { x: 4.6, y: 0 }], type: "line", color: "#9ca3af" },
      { points: [{ x: -0.6, y: 2 }, { x: 4.6, y: 2 }], type: "line", color: "#d97706", label: "classical ±2" },
      { points: [{ x: -0.6, y: -2 }, { x: 4.6, y: -2 }], type: "line", color: "#d97706" },
      { points: [{ x: -0.6, y: 2.8284 }, { x: 4.6, y: 2.8284 }], type: "line", color: "#059669", label: "Tsirelson ±2√2" },
      { points: [{ x: -0.6, y: -2.8284 }, { x: 4.6, y: -2.8284 }], type: "line", color: "#059669" },
      { points: [{ x: 0, y: 0 }, { x: 0, y: 2.8284 }], type: "line", color: "#b91c1c", label: "S" },
      { points: [{ x: 1, y: 0 }, { x: 1, y: 0.7071 }], type: "line", color: "#2563eb" },
      { points: [{ x: 2, y: 0 }, { x: 2, y: 0.7071 }], type: "line", color: "#2563eb" },
      { points: [{ x: 3, y: 0 }, { x: 3, y: 0.7071 }], type: "line", color: "#2563eb" },
      { points: [{ x: 4, y: 0 }, { x: 4, y: 0.7071 }], type: "line", color: "#2563eb" },
    ],
    { width: 380, height: 260, xlabel: "S, then the four contributions", ylabel: "correlation sum", title: "S against both bounds" },
  ),
]);

// The Snell sweep stopping at the critical angle.
{
  const snell: { x: number; y: number }[] = [];
  for (let deg = 0; deg <= 41.5; deg += 0.5) {
    const s = (1.5 / 1.0) * Math.sin((deg * Math.PI) / 180);
    if (s <= 1) snell.push({ x: deg, y: (Math.asin(s) * 180) / Math.PI });
  }
  figures.push([
    "snell sweep",
    buildPlotSvg(
      [
        { points: snell, type: "line", color: "#2563eb", label: "Snell" },
        { points: [{ x: 41.81, y: 0 }, { x: 41.81, y: 90 }], type: "line", color: "#9ca3af", label: "critical angle" },
        { points: [{ x: 30, y: 48.59 }], type: "scatter", color: "#b91c1c", label: "your angle" },
        { points: [{ x: 33.69, y: 56.3 }], type: "scatter", color: "#059669", label: "Brewster" },
      ],
      { width: 380, height: 260, xlabel: "angle of incidence (°)", ylabel: "angle of refraction (°)", title: "Snell's law at this interface" },
    ),
  ]);
}

// The birthday curve with its far-left working point.
{
  const space = Math.pow(2, 64);
  const curve: { x: number; y: number }[] = [];
  for (let i = 0; i <= 60; i++) {
    const k = Math.max(1, Math.round(Math.pow(5.06e10, i / 60)));
    const p = 1 - Math.exp((-k * (k - 1)) / 2 / space);
    curve.push({ x: k, y: p });
  }
  figures.push([
    "birthday curve",
    buildPlotSvg(
      [
        { points: curve, type: "line", color: "#2563eb", label: "P(collision)" },
        { points: [{ x: 1, y: 0.5 }, { x: 5.06e10, y: 0.5 }], type: "line", color: "#9ca3af" },
        { points: [{ x: 1e6, y: 2.7e-8 }], type: "scatter", color: "#b91c1c", label: "this count" },
        { points: [{ x: 5.06e9, y: 0.5 }], type: "scatter", color: "#059669", label: "50% crossing" },
      ],
      { width: 380, height: 250, xScale: "log", xlabel: "items (log scale)", ylabel: "P(at least one collision)", title: "The birthday curve" },
    ),
  ]);
}

// --- v2.89.0: the final 24 — orbits, triangles, arms and ledgers -------------

figures.push([
  "orbit leo",
  orbitChartSvg(6371000, [{ a: 6771000, e: 0, colour: "#2563eb", label: "400 km orbit" }], [], "Circular orbit of Earth"),
]);
figures.push([
  "orbit gto",
  orbitChartSvg(
    6371000,
    [{ a: 24371000, e: 0.7306, colour: "#2563eb", label: "e = 0.731" }],
    [
      { rM: 6671000, side: 1, label: "peri 10.2 km/s", colour: "#b91c1c" },
      { rM: 42164000, side: -1, label: "apo 1.6 km/s", colour: "#059669" },
    ],
    "Elliptical orbit of Earth",
  ),
]);
figures.push([
  "orbit hohmann",
  orbitChartSvg(
    6371000,
    [
      { a: 6671000, e: 0, colour: "#9ca3af", dashed: true },
      { a: 42164000, e: 0, colour: "#9ca3af", dashed: true },
      { a: 24417500, e: 0.7268, colour: "#2563eb", label: "transfer", half: true },
    ],
    [
      { rM: 6671000, side: 1, label: "burn 1: 2440 m/s", colour: "#b91c1c" },
      { rM: 42164000, side: -1, label: "burn 2: 1472 m/s", colour: "#059669" },
    ],
    "Hohmann transfer at Earth",
  ),
]);

figures.push([
  "wind triangle",
  vectorTriangleSvg(
    [
      { dx: 49.0, dy: -9.9, colour: "#2563eb", label: "air 50 m/s hdg 101.3°" },
      { dx: 0, dy: 10, colour: "#b91c1c", label: "wind 10 m/s" },
    ],
    { dx: 49.0, dy: 0.1, colour: "#059669", label: "ground 49 m/s trk 90°" },
    "The wind triangle",
    "drift 11.3°, north up",
  ),
]);
figures.push([
  "climb triangle",
  vectorTriangleSvg(
    [
      { dx: 79.6, dy: 0, colour: "#9ca3af", label: "ground leg 79.6 m/s" },
      { dx: 0, dy: 8, colour: "#b91c1c", label: "climb 8.0 m/s" },
    ],
    { dx: 79.6, dy: 8, colour: "#2563eb", label: "V = 80 m/s at γ 5.74°" },
    "The climb triangle",
    "sin γ = (T − D)/W = 0.1",
  ),
]);

figures.push([
  "arm fk",
  armSvg(
    [
      {
        joints: [
          { x: 0, y: 0 },
          { x: 0.433, y: 0.25 },
          { x: 0.537, y: 0.636 },
          { x: 0.712, y: 0.667 },
        ],
        colour: "#2563eb",
        label: "tip",
      },
    ],
    [{ r: 1.1 }],
    { title: "The chain in the plane", note: "tip (0.712, 0.667) m, reach 1.1 m" },
  ),
]);
figures.push([
  "arm ik unreachable",
  armSvg([], [{ r: 0.9 }, { r: 0.1 }], {
    title: "The target is outside the workspace",
    target: { x: 1.1, y: 0.4 },
    note: "outside the annulus by 0.27 m",
  }),
]);
figures.push([
  "arm ellipse",
  armSvg(
    [
      {
        joints: [
          { x: 0, y: 0 },
          { x: 0.433, y: 0.25 },
          { x: 0.433, y: 0.65 },
        ],
        colour: "#2563eb",
      },
    ],
    [],
    {
      title: "The manipulability ellipse",
      ellipse: { cx: 0.433, cy: 0.65, a: 0.82, b: 0.21, phi: 1.2, colour: "#b91c1c" },
      note: "condition number 3.9",
    },
  ),
]);
figures.push([
  "diffdrive circles",
  armSvg(
    [
      {
        joints: [
          { x: -0.2, y: 0 },
          { x: 0.2, y: 0 },
        ],
        colour: "#2563eb",
        label: "robot",
      },
    ],
    [
      { r: 1.0, cx: -1.0, cy: 0, dashed: false, colour: "#2563eb" },
      { r: 0.8, cx: -1.0, cy: 0, colour: "#9ca3af" },
      { r: 1.2, cx: -1.0, cy: 0, colour: "#9ca3af" },
    ],
    { title: "The turning circles", target: { x: -1.0, y: 0 }, note: "turn radius 1.0 m about the marked centre" },
  ),
]);

figures.push([
  "rankine ledger",
  ladderSvg(
    [
      { name: "heat in (boiler)", delta: 3019, gain: true },
      { name: "heat out (condenser)", delta: -1908.2, gain: false },
      { name: "pump work in", delta: 3.2, gain: true },
      { name: "net work", delta: 1110.8, gain: true, result: true },
    ],
    { title: "The Rankine energy ledger", axisLabel: "specific energy (kJ/kg)", fmt: (v) => v.toFixed(0) },
  ),
]);

// The great-circle track with its chord, and the S-curve pair.
figures.push([
  "great circle",
  buildPlotSvg(
    [
      { points: Array.from({ length: 101 }, (_, i) => { const f = i / 100; const lat = 51.4775 + (40.6413 - 51.4775) * f + 12 * Math.sin(Math.PI * f); const lon = -0.4614 + (-73.7781 + 0.4614) * f; return { x: lon, y: lat }; }), type: "line", color: "#2563eb", label: "great circle" },
      { points: [{ x: -0.4614, y: 51.4775 }, { x: -73.7781, y: 40.6413 }], type: "line", color: "#9ca3af", label: "straight on the chart" },
      { points: [{ x: -0.4614, y: 51.4775 }, { x: -73.7781, y: 40.6413 }], type: "scatter", color: "#b91c1c" },
    ],
    { width: 380, height: 260, xlabel: "longitude (°E)", ylabel: "latitude (°N)", title: "The shortest route bends poleward" },
  ),
]);
figures.push([
  "scurve pair",
  buildPlotSvg(
    [
      { points: Array.from({ length: 141 }, (_, i) => { const t = (2.55 * i) / 140; const Ta = 0.45, vp = 0.5, cruise = 1.35; const va = (tt: number) => (tt <= 0 ? 0 : tt >= Ta ? vp : tt <= 0.2 ? 25 * tt * tt : tt <= 0.25 ? 0.5 * (tt - 0.1) * 4 - 0 + 25 * 0.04 - 1 * 0 : vp - 25 * (Ta - tt) * (Ta - tt)); const y = t <= Ta ? va(t) : t <= Ta + cruise ? vp : va(2.55 - t); return { x: t, y: Math.max(0, Math.min(vp, y)) }; }), type: "line", color: "#2563eb", label: "S-curve" },
      { points: [{ x: 0, y: 0 }, { x: 0.25, y: 0.5 }, { x: 2.05, y: 0.5 }, { x: 2.3, y: 0 }], type: "line", color: "#9ca3af", label: "trapezoidal" },
    ],
    { width: 380, height: 250, xlabel: "time (s)", ylabel: "speed (m/s)", title: "The jerk limit rounds the corners" },
  ),
]);

// =============================================================================
// THE NON-ENGINEERING HALF
// =============================================================================
// Everything above this line is Engineering. Everything below is the half of the
// product that had no figure gate at all until 2026-08-05 — Table→Chart, the
// table figure and diagrams, heat maps, candlesticks, predicted and measured
// spectra, beams, the periodic table, sequence maps and the persistence barcode.
//
// Inputs are built THROUGH THE REAL PARSERS AND ENGINES (`parseTableData`,
// `predictNmr`, `analyzeBeam`, `parseGenBank`, `persistentHomology`) rather than
// hand-assembled, for the same reason the Reliability block above does it: a
// hand-made object that does not match what the pane actually passes produces a
// figure nobody ever sees, and a corpus of those is a gate that measures nothing.

// --- Table → Chart ------------------------------------------------------------
// Long category labels, a five-series legend, thousands separators and a unit
// suffix — the four things that make the tick column and the legend fight.
const SALES: string[][] = [
  ["Fiscal quarter", "North America", "Europe, Middle East & Africa", "Asia-Pacific", "Latin America", "Rest of world"],
  ["Q1 2024 (restated)", "1,204,500", "886,000", "1,455,900", "212,400", "18,900"],
  ["Q2 2024", "1,318,750", "902,300", "1,502,100", "244,050", "21,300"],
  ["Q3 2024", "1,101,200", "1,044,800", "1,688,400", "198,700", "17,050"],
  ["Q4 2024 (preliminary)", "1,590,300", "1,120,600", "1,742,250", "301,900", "26,400"],
  ["Q1 2025", "1,622,100", "1,208,400", "1,811,000", "288,300", "24,800"],
];
const salesChart = parseTableData(SALES);
for (const kind of [
  "column",
  "bar",
  "line",
  "area",
  "scatter",
  "stacked-column",
  "stacked-bar",
  "stacked-area",
  "pie",
  "doughnut",
] as ChartKind[]) {
  figures.push([
    `tablechart ${kind}`,
    buildChartPreviewSvg(salesChart, kind, "Revenue by region and quarter, in reporting currency").svg,
  ]);
}
// Mixed signs with a zero crossing, which moves the baseline off the frame edge.
const SWING = parseTableData([
  ["Month", "Net cash flow", "Cumulative"],
  ["January", "-48200", "-48200"],
  ["February", "12400", "-35800"],
  ["March", "-6050", "-41850"],
  ["April", "88100", "46250"],
  ["May", "-2.5", "46247.5"],
]);
figures.push(["tablechart signed", buildChartPreviewSvg(SWING, "column", "Net cash flow, signed").svg]);
// FEMTO MAGNITUDES. This is gap-analysis defect 0.1: an absolute 1e-9 tick slack
// with no count cap built 2,000,011 tick labels and a 510 MB SVG here. The
// product deliberately ships fs, fF and fJ units, so this input is ordinary.
// It stays in the corpus as the regression guard: if the cap is ever removed,
// this figure alone will take the gate from seconds to never.
const FEMTO = parseTableData([
  ["Pulse", "Width (s)", "Energy (J)"],
  ["seed", "1.2e-15", "3.4e-15"],
  ["amplified", "8.7e-15", "9.1e-15"],
  ["compressed", "4.4e-15", "6.8e-15"],
]);
figures.push(["tablechart femto", buildChartPreviewSvg(FEMTO, "column", "Femtosecond pulse train").svg]);
// A patent-drawing rendering with a figure label: hatching, markers and an extra
// caption band beneath the frame.
figures.push([
  "tablechart patent",
  buildChartPreviewSvg(salesChart, "column", "Revenue by region", { patent: true, figLabel: "FIG. 4" }).svg,
]);

// --- The table figure and the two diagram kinds -------------------------------
figures.push(["tablefigure", buildTableFigureSvg(SALES, "Table 1 — quarterly revenue").svg]);
figures.push([
  "tablefigure narrow",
  buildTableFigureSvg(
    [
      ["Step", "Reagent", "Conditions", "Yield"],
      ["1", "n-BuLi in THF at -78 °C under argon", "45 min", "88%"],
      ["2", "Pd(PPh₃)₄, K₂CO₃, dioxane/water 4:1", "12 h reflux", "61%"],
      ["3", "TBAF in THF", "2 h, 0 °C to rt", "94%"],
    ],
    "Table 2 — a synthesis with long condition cells",
  ).svg,
]);
const FLOW: string[][] = [
  ["Step", "Description", "Next"],
  ["1", "Receive the Office Action and docket the three-month statutory period", "2"],
  ["2", "Map every rejection to its claim set", "3"],
  ["3", "Pull and read each cited reference in full", "4"],
  ["4", "Is the rejection well founded on the reference as a whole?", "5,6"],
  ["5", "Draft distinguishing arguments with pin cites", "7"],
  ["6", "Draft claim amendments under 37 CFR 1.121", "7"],
  ["7", "File the response and confirm the acknowledgement receipt", ""],
];
figures.push(["diagram flowchart", buildFlowchartSvg(FLOW, "Office Action response workflow").svg]);
// A hierarchy is COLUMN-INDEXED: depth is the column a cell sits in, not a level
// number in a column of its own. Getting that wrong builds a tree of orphans that
// still renders — which is why check-figures.js refuses a blank figure but cannot
// refuse a wrong-shaped one, and why these inputs go through the real parser.
const TREE: string[][] = [
  ["Independent claim 1 — an optical assembly"],
  ["", "Claim 2 — wherein the lens is aspheric"],
  ["", "", "Claim 3 — wherein the aspheric surface is diamond-turned"],
  ["", "Claim 4 — wherein the housing is anodised aluminium"],
  ["", "", "Claim 5 — wherein the anodising is type III hard coat"],
  ["", "", "Claim 6 — wherein a gasket seals the housing to IP67"],
  ["Independent claim 7 — a method of assembling the optical assembly"],
  ["", "Claim 8 — wherein the assembling includes active alignment"],
];
figures.push(["diagram hierarchy", buildHierarchySvg(TREE, "Claim dependency tree").svg]);

// --- Heat map -----------------------------------------------------------------
const CORR = parseTableData([
  ["Assay", "IC50 (nM)", "Hill slope", "Emax (%)", "Selectivity ratio"],
  ["Kinase A binding", "12.4", "1.02", "97.5", "1.0"],
  ["Kinase B binding", "1180", "0.88", "62.1", "95.2"],
  ["Cell proliferation", "44.9", "1.41", "88.0", "3.6"],
  ["Whole blood", "302.7", "1.15", "71.4", "24.4"],
  ["Off-target hERG patch clamp", "9840", "0.79", "18.2", "793.5"],
]);
figures.push(["heatmap sequential", buildHeatmapSvg(CORR, "Assay panel, sequential scale").svg]);
figures.push([
  "heatmap diverging",
  buildHeatmapSvg(
    parseTableData([
      ["Gene", "0 h", "6 h", "24 h", "72 h"],
      ["TP53", "-2.41", "0.12", "1.88", "3.04"],
      ["MYC", "3.19", "-0.44", "-2.90", "-3.55"],
      ["CDKN1A", "0.02", "2.71", "2.44", "0.81"],
      ["BAX", "-0.15", "-1.02", "0.36", "1.99"],
    ]),
    "Log₂ fold change against time",
    { scale: "diverging", midpoint: 0 },
  ).svg,
]);
figures.push(["heatmap grey", buildHeatmapSvg(CORR, "Assay panel, print rendering", { grey: true }).svg]);

// --- Candlestick --------------------------------------------------------------
const OHLC = parseTableData([
  ["Session", "Open", "High", "Low", "Close"],
  ["2025-01-06", "184.20", "188.95", "183.10", "188.02"],
  ["2025-01-07", "188.40", "189.10", "181.75", "182.30"],
  ["2025-01-08", "182.05", "186.60", "180.90", "186.11"],
  ["2025-01-09", "186.30", "192.44", "185.80", "191.90"],
  ["2025-01-10", "191.75", "191.80", "176.20", "177.45"],
  ["2025-01-13", "177.10", "180.05", "174.65", "179.88"],
]);
figures.push(["candlestick", buildCandlestickSvg(OHLC, "Six sessions").svg]);
figures.push(["candlestick grey", buildCandlestickSvg(OHLC, "Six sessions, print", { grey: true }).svg]);
figures.push([
  "candlestick redIsUp",
  buildCandlestickSvg(OHLC, "Six sessions, East Asian convention", { redIsUp: true }).svg,
]);
// Same femtoscale guard as above: candlestick carried the identical tick loop.
figures.push([
  "candlestick femto",
  buildCandlestickSvg(
    parseTableData([
      ["Shot", "Open", "High", "Low", "Close"],
      ["1", "1.20e-15", "1.44e-15", "1.02e-15", "1.31e-15"],
      ["2", "1.31e-15", "1.52e-15", "1.19e-15", "1.22e-15"],
      ["3", "1.22e-15", "1.38e-15", "1.10e-15", "1.36e-15"],
    ]),
    "Femtojoule shot energies",
  ).svg,
]);

// --- Predicted and measured spectra -------------------------------------------
// Toluene, ethanol, aspirin and 2-hexanone: enough signals to crowd an axis, and
// the shifts are real predictions rather than invented coordinates.
//
// The axes here are FLIPPED (δ and wavenumber increase leftward), and gap-analysis
// defect 0.4 was that every one of these drew a NEGATIVE axis for eight months.
// A tick label reading "-4" is not a layout defect, so this corpus cannot catch
// it — spectraChart.test.ts asserts on the tick VALUES. What the corpus catches
// is the other half: a stick spectrum whose assignment labels sit on top of each
// other, which is what a dense aromatic region produces.
for (const [name, smiles, nucleus] of [
  ["nmr toluene 1H", "Cc1ccccc1", "1H"],
  ["nmr aspirin 1H", "CC(=O)Oc1ccccc1C(=O)O", "1H"],
  ["nmr aspirin 13C", "CC(=O)Oc1ccccc1C(=O)O", "13C"],
  ["nmr ethanol 1H", "CCO", "1H"],
] as [string, string, "1H" | "13C"][]) {
  const r = predictNmr(smiles, nucleus);
  const svg = r ? nmrChartSvg(r) : null;
  if (svg) figures.push([name, svg]);
}
{
  const ir = predictIr("CC(=O)Oc1ccccc1C(=O)O");
  const svg = ir ? irChartSvg(ir.bands) : null;
  if (svg) figures.push(["ir aspirin", svg]);
}
{
  const fr = predictFragments("CCCC(=O)C");
  const svg = fr ? msChartSvg(fr) : null;
  if (svg) figures.push(["ms hexanone", svg]);
}
{
  const c = predictCosy("CCO");
  if (c) { const s = cosyChartSvg(c); if (s) figures.push(["cosy ethanol", s]); }
  const h = predictHsqc("Cc1ccccc1");
  if (h) { const s = hsqcChartSvg(h); if (s) figures.push(["hsqc toluene", s]); }
  const b = predictHmbc("Cc1ccccc1");
  if (b) { const s = hmbcChartSvg(b); if (s) figures.push(["hmbc toluene", s]); }
  const t = predictTocsy("CCCCO");
  if (t) { const s = tocsyChartSvg(t); if (s) figures.push(["tocsy butanol", s]); }
}
// A measured trace, as a JCAMP-DX import delivers it: 900 points, four-digit
// wavenumbers, and a title long enough to reach the frame edge.
{
  const pts = Array.from({ length: 900 }, (_, i) => {
    const x = 4000 - (3500 * i) / 899;
    const band = (c: number, w: number, d: number) => d * Math.exp(-(((x - c) / w) ** 2));
    return { x, y: 100 - band(3300, 180, 45) - band(2950, 60, 30) - band(1715, 25, 78) - band(1240, 30, 52) };
  });
  const s = jcampChartSvg({
    title: "Acetylsalicylic acid, KBr disc, 4 cm⁻¹ resolution",
    kind: "ir",
    xUnits: "wavenumber (cm⁻¹)",
    yUnits: "transmittance (%)",
    points: pts,
  });
  if (s) figures.push(["jcamp measured ir", s]);
}
// --- v2.139.0: measured vs predicted, and the isotope stick chart ---------------
//
// Built through the SAME calls the pane makes (parseJcamp → its defaultIndex
// block; spectroPane.overlayPrediction; spectroPane.parseReferencePeak;
// overlaySpectrum; overlayChartSvg), so the gate sees the inserted figure, not a
// look-alike. Fixtures are the committed, attributed JCAMP test files plus small
// synthetic files (no NIST SRD data in the repo, §E10). The long-title case is
// why overlayChart measures and truncates its title: no CLIPPED waiver is added.
{
  const FIX = pathForCorpus.join(__dirname, "..", "src", "lib", "__tests__", "fixtures", "jcamp");
  const block = (text: string): JcampSpectrum => {
    const r = parseJcamp(text);
    if (!r.ok || !r.spectra.length) throw new Error(`corpus JCAMP fixture did not parse: ${r.ok ? "no blocks" : r.error}`);
    return r.spectra[r.defaultIndex];
  };
  const fixture = (f: string): JcampSpectrum => block(fsForCorpus.readFileSync(pathForCorpus.join(FIX, f), "latin1"));
  const overlay = (name: string, file: JcampSpectrum, src: OverlaySource, refText = ""): void => {
    const pred = overlayPrediction(src);
    if ("error" in pred) throw new Error(`${name}: ${pred.error}`);
    const ref = parseReferencePeak(refText);
    if (!ref.ok) throw new Error(`${name}: ${ref.error}`);
    const r = overlaySpectrum(file, pred, ref.reference ? { reference: ref.reference } : {});
    if (!r.ok) throw new Error(`${name}: ${r.error}`);
    const svg = overlayChartSvg(r);
    if (!svg) throw new Error(`${name}: no overlay figure`);
    figures.push([name, svg]);
  };
  const irFile = (title: string): string => {
    const xs: number[] = [];
    for (let x = 450; x <= 3966; x += 4) xs.push(x);
    const peaks: [number, number][] = [[3674, 0.19], [2978, 0.89], [1066, 1]];
    const lines: string[] = [];
    for (let i = 0; i < xs.length; i += 8) {
      lines.push(`${xs[i]} ${xs.slice(i, i + 8).map((x) => Math.round(1e5 * peaks.reduce((t, [c, h]) => t + h / (1 + ((x - c) / 8) ** 2), 0))).join(" ")}`);
    }
    return `##TITLE=${title}\n##DATA TYPE=INFRARED SPECTRUM\n##MOLFORM=C 2 H 6 O\n##XUNITS=1/CM\n##YUNITS=ABSORBANCE\n##YFACTOR=0.00001\n##FIRSTX=450\n##LASTX=3966\n##NPOINTS=${xs.length}\n##XYDATA=(X++(Y..Y))\n${lines.join("\n")}\n##END=`;
  };
  const uvPts = Array.from({ length: 200 }, (_, i) => {
    const x = 230 + i * 0.2;
    return `${x.toFixed(2)},${(1 + 1 / (1 + ((x - 260.6) / 2) ** 2)).toFixed(5)}`;
  });
  const uvFile = `##TITLE=Toluene (synthetic)\n##DATA TYPE=UV/VIS SPECTRUM\n##MOLFORM=C7H8\n##XUNITS=NANOMETERS\n##YUNITS=ABSORBANCE\n##XYPOINTS=(XY..XY)\n${uvPts.join("\n")}\n##END=`;
  const msAcetone = `##TITLE=Acetone (synthetic EI)\n##DATA TYPE=MASS SPECTRUM\n##MOLFORM=C3H6O\n##XUNITS=M/Z\n##YUNITS=RELATIVE INTENSITY\n##PEAK TABLE=(XY..XY)\n15,1201 42,961 43,9999 58,2484\n##END=`;
  const msC2Cl4 = `##TITLE=Tetrachloroethylene (synthetic, molecular-ion cluster)\n##DATA TYPE=MASS SPECTRUM\n##MOLFORM=C2Cl4\n##XUNITS=M/Z\n##YUNITS=RELATIVE INTENSITY\n##PEAK TABLE=(XY..XY)\n164,7790 166,10000 168,4790 170,1020 172,80\n##END=`;

  const nmr = (smiles: string, nucleus: "1H" | "13C"): OverlaySource => {
    const r = predictNmr(smiles, nucleus);
    if (!r) throw new Error(`corpus: no NMR for ${smiles}`);
    return { kind: nucleus, nmr: r };
  };
  overlay("overlay 1H 2-methyl-1-propanol", fixture("2Methyl1Propanol.jdx"), nmr("CC(C)CO", "1H"));
  overlay("overlay 13C ethylbenzene, user reference", fixture("BRUKPAC.DX"), nmr("CCc1ccccc1", "13C"), "86.25 = 77.16");
  overlay("overlay ir ethanol", block(irFile("Ethanol (synthetic)")), { kind: "ir", ir: predictIr("CCO")! });
  overlay(
    "overlay ir long title",
    block(irFile("Ethanol, gas phase, 10 cm path, 0.5 cm⁻¹ resolution, averaged over 256 scans at 298 K (synthetic)")),
    { kind: "ir", ir: predictIr("CCO")! },
  );
  overlay("overlay uv toluene", block(uvFile), { kind: "uvvis", uv: predictUvVis("Cc1ccccc1")! });
  overlay("overlay ms acetone head-to-tail", block(msAcetone), { kind: "ms", ms: predictFragments("CC(C)=O")! });
  // Mass Spec's comparison: the computed isotope pattern against a measured cluster.
  const c2cl4 = resolveMassSpec("C2Cl4", "auto");
  if (c2cl4.kind !== "ok") throw new Error("corpus: C2Cl4 did not resolve");
  overlay("overlay ms isotope pattern C2Cl4", block(msC2Cl4), { kind: "isotopes", spec: c2cl4.result });

  // The Solid form figures, built exactly as the pane builds them (analyzeSolid on each kind's Example, and a typed list).
  for (const [name, kind, input] of [
    ["solid form XRPD pattern", "xrpd", solidExample("xrpd")],
    ["solid form XRPD peak list (sticks)", "xrpd", "6.8 100\n13.6 40\n17.2 80\n21.3 60"],
    ["solid form DSC thermogram", "dsc", solidExample("dsc")],
    ["solid form TGA thermogram", "tga", solidExample("tga")],
  ] as [string, SolidKind, string][]) {
    const r = analyzeSolid(kind, input);
    if (!r.ok) throw new Error(`corpus: ${name}: ${r.errors.join(" ")}`);
    if (!r.svg.includes(`width="${SOLID_CHART_SIZE.width}"`)) throw new Error(`corpus: ${name}: not drawn at its declared width`);
    figures.push([name, r.svg]);
  }

  // The isotope stick chart, built exactly as updateMassSpec builds it.
  for (const [name, input] of [
    ["isotope pattern C2Cl4 (M+2 base peak)", "C2Cl4"],
    ["isotope pattern ferrocene (M−2 below M)", "[CH-]1C=CC=C1.[CH-]1C=CC=C1.[Fe+2]"],
    ["isotope pattern chlorophyll a (long formula)", "chlorophyll a"],
  ] as [string, string][]) {
    const r = resolveMassSpec(input, "auto");
    if (r.kind !== "ok") throw new Error(`corpus: ${input} did not resolve`);
    const spec = r.result;
    const svg = isotopeChartSvg({ formula: spec.formula, netCharge: spec.netCharge, pattern: spec.pattern, patternNote: spec.patternNote });
    if (!svg) throw new Error(`corpus: no isotope chart for ${input}`);
    figures.push([name, svg]);
  }

  // The measured-file chart for an NMR PEAK TABLE, built as showJcampBlock
  // builds it: sticks (jcampDrawPoints), display units, x leftward.
  const eth = parseJcamp(fsForCorpus.readFileSync(pathForCorpus.join(FIX, "ethanol_nmr.jdx"), "latin1"));
  if (!eth.ok) throw new Error(eth.error);
  const pk = eth.spectra.find((s) => s.form === "peaks");
  if (!pk) throw new Error("corpus: ethanol_nmr.jdx has no peak-table block");
  const pkSvg = jcampChartSvg({ title: pk.title, kind: pk.kind, xUnits: displayUnits(pk.xUnits), yUnits: displayUnits(pk.yUnits), points: jcampDrawPoints(pk) });
  if (!pkSvg) throw new Error("corpus: no chart for the NMR peak table");
  figures.push(["jcamp measured nmr peak table (sticks)", pkSvg]);
}

// --- The beam diagram ---------------------------------------------------------
{
  const R = (n: number, d = 1): Rat => ratDiv(ratInt(n), ratInt(d));
  const beam = (name: string, supports: Support[], loads: Load[], ei: Rat | null): void => {
    const input: BeamInput = { length: R(8), supports, loads, ei };
    const r = analyzeBeam(input);
    if (!r.ok) return;
    figures.push([
      name,
      beamDiagramSvg({
        result: r as BeamResult,
        supports,
        loads,
        forceUnit: "kN",
        momentUnit: "kN·m",
        lengthUnit: "m",
      }),
    ]);
  };
  beam("beam udl", [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8) }], [{ kind: "udl", a: R(0), b: R(8), w: R(5) }], null);
  beam(
    "beam cantilever point",
    [{ kind: "fixed", x: R(0) }],
    [{ kind: "point", x: R(8), p: R(12) }],
    null,
  );
  beam(
    "beam mixed loads",
    [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8) }],
    [
      { kind: "udl", a: R(0), b: R(3), w: R(9) },
      { kind: "point", x: R(5), p: R(24) },
      { kind: "moment", x: R(6), m: R(15) },
      { kind: "ramp", a: R(6), b: R(8), w1: R(0), w2: R(11) },
    ],
    null,
  );
  // Tiny magnitudes: the value labels become exponential and grow wide.
  beam(
    "beam micro",
    [{ kind: "pin", x: R(0) }, { kind: "roller", x: R(8) }],
    [{ kind: "udl", a: R(0), b: R(8), w: ratDiv(ratInt(1), ratInt(1000000)) }],
    null,
  );
}

// --- The periodic table and the two atom views --------------------------------
figures.push(["periodic table", buildPeriodicTableSvg("Fe").svg]);
figures.push(["periodic table no highlight", buildPeriodicTableSvg().svg]);
for (const [name, z] of [["bohr H", 1], ["bohr Fe", 26], ["bohr U", 92]] as [string, number][]) {
  const r = buildBohrSvg(z);
  if (r) figures.push([name, r.svg]);
}
for (const [name, z] of [["orbital C", 6], ["orbital Fe", 26], ["orbital U", 92]] as [string, number][]) {
  const r = buildOrbitalSvg(z);
  if (r) figures.push([name, r.svg]);
}

// --- Sequence maps, linear and circular ---------------------------------------
{
  const GB = `LOCUS       pEXAMPLE                 900 bp    DNA     circular SYN 05-AUG-2026
DEFINITION  An example construct for the figure corpus.
FEATURES             Location/Qualifiers
     CDS             40..480
                     /label="a rather long coding sequence label"
     promoter        1..38
                     /label="Ptac"
     terminator      500..560
                     /label="rrnB T1"
     misc_feature    complement(600..720)
                     /label="reverse element with a long name"
     primer_bind     complement(861..880)
                     /label="M13rev"
     rep_origin      740..850
                     /label="ColE1"
ORIGIN
        1 ${"acgt".repeat(225)}
//
`;
  const parsed = parseGenBank(GB);
  if (parsed.ok && parsed.records.length) {
    const rec = parsed.records[0];
    const lin = buildLinearMapSvg(rec);
    if (lin) figures.push(["seqmap linear", lin]);
    const circ = buildCircularMapSvg(rec);
    if (circ) figures.push(["seqmap circular", circ]);
  }
}

// --- The persistence barcode --------------------------------------------------
{
  // A noisy circle: one long H1 bar plus a spray of short ones, which is exactly
  // the case where the bar labels crowd the left margin.
  const pts: number[][] = [];
  for (let i = 0; i < 14; i++) {
    const a = (2 * Math.PI * i) / 14;
    pts.push([Math.cos(a) + 0.03 * Math.sin(7 * a), Math.sin(a) + 0.03 * Math.cos(5 * a)]);
  }
  figures.push(["persistence barcode", barcodeSvg(persistentHomology(pts, { maxDim: 1 }))]);
}

// --- v2.160.0: Solve's curve (lib/solveFigure.ts) ------------------------------------
//
// The root plot of an equation typed with an implicit product (it drew nothing before
// v2.160.0), and the integral's shaded stretch: the two shapes the pane inserts most.
figures.push(["solve roots", solveFunctionSvg({ exprs: [{ expr: "(x^2 - 5x + 6) - (0)", label: "f", color: "#2563eb" }], variable: "x", marks: [2, 3].map((x) => ({ x, y: 0, label: "root" })), title: "Where the function crosses zero" }) ?? ""]);
figures.push(["solve integral", solveFunctionSvg({ exprs: [{ expr: "x*sin(x)", label: "f", color: "#94a3b8" }], variable: "x", window: { lo: -1, hi: 4 }, shadeBetween: { lo: 0, hi: 3 }, title: "Area from 0 to 3" }) ?? ""]);

// --- v2.138.0: the 𝔽₂ | 𝔽₃ compare barcode -----------------------------------
//
// The two stacked panels (460 × 600) the pane draws for a `compare` header,
// on the §D4 klein150 cloud (2-torsion: one long H₁ bar is missing over 𝔽₃).
// A user scale of 1.5, below the enclosing radius, so long bars are CENSORED
// and the dashed "≥ s" glyph and its legend are in the figure too.
{
  const phi = (1 + Math.sqrt(5)) / 2;
  const pts: number[][] = [];
  for (let k = 0; k < 150; k++) {
    const u = (2 * Math.PI * k) / 150;
    const v = 2 * Math.PI * ((k * phi) % 1);
    pts.push([(2 + Math.cos(v)) * Math.cos(u), (2 + Math.cos(v)) * Math.sin(u), Math.sin(v) * Math.cos(u / 2), Math.sin(v) * Math.sin(u / 2)]);
  }
  const pr = persistentHomology(pts, { maxDim: 1, maxScale: 1.5, p: 3, compare: true });
  figures.push(["persistence compare", barcodeSvg(pr, 460, 300, { compare: true })]);
}

// --- v2.138.0: the Cartesian pendulum, index 3 -----------------------------------
//
// Built exactly as the pane's Analyze DAE entry builds it: parseDaeSystem →
// solveDaeAuto → one line per result.names column. Five series (x, y, u, v,
// lam) with lam reaching ~28 against |x| ≤ 1, which is where a legend and the
// y-axis labels compete.
{
  const p = parseDaeSystem(
    "x' = u\ny' = v\nu' = -lam*x\nv' = -lam*y - 9.81\nx^2 + y^2 - 1",
    "x = 1, y = 0, u = 0, v = 0",
    "",
  );
  if (!p.ok) throw new Error(`figure corpus: pendulum DAE did not parse: ${p.error}`);
  const out = solveDaeAuto(p.system, 0, 10, { points: 500 });
  if (!out.ok) throw new Error(`figure corpus: pendulum DAE did not solve: ${out.error}`);
  const res = out.result;
  const colors = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed"];
  const series: Series[] = res.names.map((n, i) => ({
    points: res.t.map((t, k) => ({ x: t, y: res.states[n][k] })),
    type: "line",
    color: colors[i % colors.length],
    label: n,
  }));
  figures.push(["dae pendulum", buildPlotSvg(series, { title: "DAE solution", xlabel: "t", ylabel: "", width: 380, height: 270 })]);
}

// --- Discrete math: graphs and state diagrams ----------------------------------
//
// The stress cases: a weighted graph with a highlighted path (labels, weights
// and the halo all compete at the midpoints), the 24-vertex layout switch
// where names give way to dots and radial labels, and a DFA with self-loops
// and an opposite-direction pair, which is where arrows overlap if curved badly.
{
  const dijkstra = tryGraph([
    "shortest path A to F", "A-B 7", "A-C 9", "A-F 14", "B-C 10", "B-D 15", "C-D 11", "C-F 2", "D-E 6", "E-F 9",
  ].join("\n"));
  if (dijkstra && dijkstra.svg) figures.push(["graph shortest path", dijkstra.svg]);
  const ring: string[] = [];
  for (let i = 0; i < 24; i++) ring.push(`v${i}-v${(i + 1) % 24}`);
  for (let i = 0; i < 24; i += 3) ring.push(`v${i}-v${(i + 12) % 24}`);
  const big = tryGraph(ring.join("\n"));
  if (big && big.svg) figures.push(["graph 24 vertices", big.svg]);
  const dfa = tryAutomata([
    "dfa", "states: q0 q1 q2", "alphabet: 0 1", "start: q0", "accept: q2",
    "q0 0 q0", "q0 1 q1", "q1 0 q0", "q1 1 q2", "q2 0 q2", "q2 1 q2", "test: 011 0101 11",
  ].join("\n"));
  if (dfa && dfa.svg) figures.push(["dfa state diagram", dfa.svg]);
}

// Probability figures (v2.131.0): a pmf with the event's bars filled (the
// 61-bar window stresses the tick thinning), a probability tree, and a
// Markov state diagram with self-loops and labelled edges.
{
  const pmf = tryProbability("binomial n=60 p=0.3 P(X <= 15)");
  if (pmf && pmf.svg) figures.push(["pmf bars 61 wide", pmf.svg]);
  const small = tryProbability("hypergeometric N=50 K=5 n=10 P(X=1)");
  if (small && small.svg) figures.push(["pmf bars hypergeometric", small.svg]);
  const tree = tryProbability("bayes P(A)=0.01, P(B|A)=0.9, P(B|not A)=0.05, P(A|B)");
  if (tree && tree.svg) figures.push(["bayes tree", tree.svg]);
  const chain = tryMarkov("markov [[0.5,0.3,0.2],[0.2,0.6,0.2],[0.1,0.2,0.7]] stationary");
  if (chain && chain.svg) figures.push(["markov state diagram", chain.svg]);
}

// Interpolation and splines (v2.132.0): a 12-point interpolant (the cap —
// Runge oscillation is the stress on the y range) and a 4-knot clamped
// spline with its end tangents drawn and a query point marked.
{
  const twelve = tryInterpolate(
    "interpolate (-5, 1/26), (-4, 1/17), (-3, 1/10), (-2, 1/5), (-1, 1/2), (0, 1), (1, 1/2), (2, 1/5), (3, 1/10), (4, 1/17), (5, 1/26), (6, 1/37) at x = 4.5",
  );
  if (twelve && twelve.svg) figures.push(["interpolant 12 points", twelve.svg]);
  const clamped = trySpline("clamped cubic spline through (0, 0), (1, 1), (2, 0), (3, 2) with S'(0) = 1, S'(3) = -1 at x = 1.5");
  if (clamped && clamped.svg) figures.push(["clamped spline 4 knots", clamped.svg]);
}

// Linear programming (v2.132.0): the Taha problem — five constraint lines,
// their labels crowding the region — and an unbounded LP whose ray must be
// drawn off the edge of the window without the labels following it.
{
  const taha = tryLp("maximize 5x + 4y subject to 6x + 4y <= 24, x + 2y <= 6, -x + y <= 1, y <= 2, x, y >= 0");
  if (taha && taha.svg) figures.push(["lp region 5 constraints", taha.svg]);
  const ray = tryLp("maximize x + y subject to x - y <= 1, x >= 0, y >= 0");
  if (ray && ray.svg) figures.push(["lp unbounded ray", ray.svg]);
  // The empty region, built directly: two half-planes that do not meet, no
  // vertices, nothing shaded — the caption is the whole figure.
  figures.push([
    "lp infeasible empty",
    lpRegionSvg({
      vars: ["x", "y"],
      rows: [
        { a: [1, 1], rel: "<=", b: 1, label: "x + y ≤ 1" },
        { a: [1, 1], rel: ">=", b: 2, label: "x + y ≥ 2" },
      ],
      nonneg: [true, true],
      vertices: [],
      c: [1, 1],
      sense: "max",
      status: "infeasible",
      caption: "feasible region: empty — x + y ≤ 1 and x + y ≥ 2 cannot both hold",
    }),
  ]);
}

// Computation theory (v2.133.0): the stress case of each figure — the deepest
// parse tree, two ambiguity trees side by side, a DPLL tree with ⊥ leaves, a
// resolution DAG with shared parents, the 2-SAT implication graph with ¬
// vertex names, the PDA and TM diagram + configuration strip (the tallest
// figures in the product, ~800 px), the stacked-label PDA built from the
// E/T/F grammar (labels that crowd self-loops), and a W derivation tree.
{
  const push = (name: string, svg: string | undefined): void => {
    if (svg) figures.push([name, svg]);
  };
  push("parse tree aabb", solveGrammar("S -> aSb | ε\ntest: aaabbb")?.svg);
  push("ambiguity two trees", solveGrammar("E -> E + E | E * E | id\nis it ambiguous")?.svg);
  push("dpll tree", solveSat("dpll (a ∨ b ∨ c) ∧ (¬a ∨ b) ∧ (¬b ∨ c) ∧ (¬c ∨ a) ∧ (¬a ∨ ¬b ∨ ¬c)")?.svg);
  push("resolution dag", solveFol("resolve ∀x (P(x) → Q(x)), ∀x (Q(x) → R(x)), P(a) ⊢ R(a)")?.svg);
  push("2sat implication graph", solveSat("2sat (x1 ∨ x2) ∧ (¬x1 ∨ x3) ∧ (¬x2 ∨ ¬x3) ∧ (x3 ∨ x4) ∧ (¬x4 ∨ x1)")?.svg);
  push("pda diagram + stack strip", solvePda("pda\nstates: q0 q1 q2\nalphabet: a b\nstack: Z A\nstart: q0\naccept: q2\nq0 a Z -> q0 AZ\nq0 a A -> q0 AA\nq0 b A -> q1 ε\nq1 b A -> q1 ε\nq1 ε Z -> q2 Z\ntest: aaabbb")?.svg);
  push("tm diagram + tape strip", solveTuring("tm binary increment 10111")?.svg);
  push("pda stacked labels", solvePda("cfg to pda E -> E + T | T\nT -> T * F | F\nF -> ( E ) | id\ntest: id+id*id")?.svg);
  push("hm derivation tree", solveLambda("hm let compose = λf.λg.λx.f (g x) in compose")?.svg);
  // The bare builder, at its node cap: 230 nodes, so the "not drawn" caption shows.
  const nodes = Array.from({ length: 230 }, (_, i) => ({ id: `n${i}`, label: `S${i % 7}` }));
  const edges = nodes.slice(1).map((n, i) => ({ from: `n${Math.floor(i / 3)}`, to: n.id }));
  push("tree at the node cap", treeSvg({ nodes, edges, caption: "230-node tree" }));
}

// --- Abstract algebra (v2.135.0) --------------------------------------------
//
// The Cayley-table grid with coset bands (D₄ by the cosets of ⟨r⟩), the
// subgroup lattice as a Hasse diagram (S₃: three incomparable order-2
// subgroups on one row), a permutation's cycle diagram with fixed points as
// loops, and GF(16)'s × table — the widest labels, drawn as coefficient strings.
{
  const push = (name: string, svg: string | undefined): void => {
    if (svg) figures.push([name, svg]);
  };
  const D4 = dihedralGroup(4);
  const rot = cosetsOfGroup(D4, [0, 1, 2, 3], "left");
  const band = new Array<number>(D4.n).fill(0);
  rot.forEach((c, i) => c.forEach((x) => { band[x] = i; }));
  const d4table = D4.labels.map((_, a) => D4.labels.map((__, b) => groupOp(D4, a, b)));
  push("cayley table D4 coset bands", cayleyTableSvg(D4.labels, d4table, { caption: "Cayley table of D₄, tinted by the cosets of ⟨r⟩", identity: D4.e, bands: band }));
  push("subgroup lattice S3", tryAlgebra("subgroup lattice of S3")?.svg);
  push("subgroup lattice Z/12", tryAlgebra("subgroup lattice of Z/12")?.svg);
  push("permutation cycle diagram", tryAlgebra("cycle diagram of (1 2 3)(4 5)(6)(7 8 9 10)")?.svg);
  push("GF(16) multiplication table", tryAlgebra("GF(16) multiplication table")?.svg);
}

// --- CAD drawing sheets (Drawing tool, docs/SCOPE-CAD-CANVAS.md) -----------------
//
// layoutSheet returns its SVG inside a result object, so the corpus-coverage
// scan (which looks for exported *Svg builders) cannot see it; it is added here
// on purpose. One assembly — plate with holes, flange, L-bracket — on every
// standard's sheet, with callouts, so view titles, balloons, numerals, the
// scale note and the projection symbol are all audited.
{
  const push = (name: string, svg: string | undefined): void => {
    if (svg) figures.push([name, svg]);
  };
  const doc = {
    ...starterDoc("asme"),
    parts: [
      { id: "a", name: "Plate", shape: "plate" as const, params: defaultParams("plate"), placement: { translate: [0, 0, 0] as Vec3c, rotateDeg: [0, 0, 0] as Vec3c } },
      { id: "b", name: "Flange", shape: "flange" as const, params: defaultParams("flange"), placement: { translate: [40, 25, 8] as Vec3c, rotateDeg: [0, 0, 0] as Vec3c } },
    ],
  };
  const asmR = docToAssembly(doc);
  const tess = asmR.ok ? cadTessellate(asmR.assembly) : null;
  if (tess && tess.ok) {
    const callouts = [{ anchor: [70, 10, 8] as Vec3c, label: "10" }, { anchor: [40, 25, 18] as Vec3c, label: "12" }];
    for (const std of ["asme", "iso", "uspto", "journal"] as const) {
      push(`cad sheet ${std}`, layoutSheet(tess.mesh, { standard: std, views: doc.views, callouts }).svg);
    }
    // Hand-drawn marks (cadMarks): a wrapped note, a numeral, an arrow and a stroke, plus a blank figure.
    const marks: SheetMark[] = [
      { kind: "text", view: "front", at: [0, -20], text: "THE FLANGE SITS ON THE PLATE OVER ITS CENTRE HOLE" },
      { kind: "numeral", view: "iso", tip: [40, 10], at: [70, 40], label: "14" },
      { kind: "line", view: "top", a: [-10, 60], b: [20, 40], arrow: true },
      { kind: "pen", view: "blank", pts: [[10, 10], [30, 25], [50, 15], [70, 30]] },
      { kind: "text", view: "blank", at: [10, 50], text: "SKETCH" },
    ];
    // A long note and a numeral on a two-figure patent sheet; short marks on the engineering sheet (a long
    // note there would shrink the drawing past a third and is refused); a blank figure with no model.
    const on = (vs: string[]): SheetMark[] => marks.filter((m) => vs.includes(m.view));
    push("cad sheet uspto with marks", layoutSheet(tess.mesh, { standard: "uspto", views: [{ kind: "front" }, { kind: "iso" }], callouts, marks: on(["front", "iso"]) }).svg);
    push("cad sheet asme with marks", layoutSheet(tess.mesh, { standard: "asme", views: doc.views, callouts, marks: on(["top", "iso"]) }).svg);
    const empty = { ...tess.mesh, positions: [], triangles: [], cornerNormals: [], triBody: [], edges: [], crossings: [], overlaps: [], bodySag: [] };
    push("cad sheet blank figure", layoutSheet(empty, { standard: "uspto", views: [{ kind: "blank" }], marks: on(["blank"]) }).svg);
  }
}

// --- Bio/Assay quantitation (src/lib/assayQuantCalcs.ts) ---------------------
//
// Each calculator at its shipped defaults: the standard curve with SD bars and the
// unknowns, the plate heat map stacked over the 4PL curve, and the Livak / Pfaffl
// fold-change bars (asymmetric error bars, superscript 2^−ΔΔCt).
{
  for (const c of ASSAY_QUANT_CALCS) {
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    const out = c.compute((k) => vals[k] ?? "");
    if (out.ok === false || !out.svg) throw new Error(`corpus: assay ${c.id} default did not draw`);
    figures.push([`assay ${c.id}`, out.svg]);
  }
}

// --- Control design (src/lib/controlCalcs.ts, controlCharts.ts) --------------
//
// Every figure each control calculator draws, at its defaults and on stress cases:
// a root locus with a breakaway, a surd crossing and complex zeros, the order-20
// locus (twenty branches through the key), Nyquist plots that encircle −1, that
// start unstable, and that race to infinity at imaginary-axis poles, the lead/lag
// Bode pair and step, and the discrete step over the continuous one with its
// z-plane map (stable, unstable, aliased).
{
  const ctrlCases: Array<[string, Record<string, string>]> = [
    ["control-rlocus", { k: "2" }],
    ["control-rlocus", { num: "s+3", den: "s^4+7*s^3+14*s^2+8*s", k: "4" }],
    ["control-rlocus", { num: "s^2+2*s+5", den: "s^4+8*s^3+19*s^2+12*s" }],
    ["control-rlocus", { num: "1", den: "1 20 190 1140 4845 15504 38760 77520 125970 167960 184756 167960 125970 77520 38760 15504 4845 1140 190 20 1" }],
    ["control-rlocus", { num: "-s+1", den: "s+1" }],
    ["control-rlocus", { num: "-1", den: "s^2+2*s+2" }],
    ["control-nyquist", {}],
    ["control-nyquist", { num: "10" }],
    ["control-nyquist", { num: "s+2", den: "s^2-1" }],
    ["control-nyquist", { num: "1", den: "s^4+2*s^2+1" }],
    ["control-nyquist", { num: "2", den: "s+1" }],
    ["control-nyquist", { num: "1000", den: "s^3+3*s^2+3*s+1" }],
    ["control-nyquist", { num: "100", den: "s^3+6*s^2+11*s+6" }],
    ["control-leadlag", {}],
    ["control-leadlag", { kind: "lag", num: "1", den: "0.5*s^3+1.5*s^2+s", err: "5", pm: "40" }],
    ["control-c2d", {}],
    ["control-c2d", { num: "1", den: "s-1", T: "0.1" }],
    ["control-c2d", { num: "1", den: "s^2+100", T: "0.5", method: "tustin" }],
  ];
  for (const [id, over] of ctrlCases) {
    const c = CONTROL_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: no control calculator ${id}`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: control ${id} ${JSON.stringify(over)} did not draw`);
    const tag = Object.entries(over).map(([k, v]) => `${k}=${v.length > 24 ? v.slice(0, 21) + "…" : v}`).join(" ") || "defaults";
    plots.forEach((b, i) => {
      if (b.kind === "plot") figures.push([`control ${id} ${tag} #${i + 1}`, b.svg]);
    });
  }
  // The chart builders directly, on an engine result the calculators do not reach:
  // a Nyquist that passes THROUGH −1, a locus whose sweep is the whole figure, and the
  // z-plane with a pole outside the unit circle at the edge of the frame.
  const ny6 = nyquist({ num: [ratInt(6)], den: [ratInt(1), ratInt(3), ratInt(2), ratInt(0)] });
  if (ny6.ok) figures.push(["control nyquist through −1 (K = 6)", nyquistSvg(ny6)]);
  const rlAxis = rootLocus({ num: [ratInt(1)], den: [ratInt(1), ratInt(0), ratInt(1)] });
  if (rlAxis.ok) figures.push(["control root locus on the imaginary axis", rootLocusSvg(rlAxis)]);
  const zUnst = c2d({ num: [ratInt(1)], den: [ratInt(1), ratInt(-3)] }, 0.5, "zoh");
  if (zUnst.ok) figures.push(["control z-plane pole far outside", zPlaneSvg(zUnst)]);
}

// --- Monte Carlo uncertainty histogram (v2.186.0) ---------------------------
//
// A near-normal output (a·b/c) and a skewed one (exp(a)): the 95 % interval
// markers, the first-order band and the axis labels must read on both.
{
  const a = monteCarlo("a*b/c", [{ name: "a", value: 10, u: 0.45 }, { name: "b", value: 4, u: 0.05 }, { name: "c", value: 2, u: 0.055 }], { seed: 1 });
  figures.push(["monte carlo a·b/c", mcHistogramSvg(a, "a·b/c")]);
  const e = monteCarlo("exp(a)", [{ name: "a", value: 0, u: 0.5 }], { seed: 1 });
  figures.push(["monte carlo exp(a)", mcHistogramSvg(e, "exp(a)")]);
}

// --- Fixed income on dates and yield curves (src/lib/bondCalcs.ts, F1) --------
//
// Each Finance calculator at its defaults, then Svensson, a bootstrap from bond prices and the Treasury 365/366 bill
// year: the figures BOND_CALCS draws (bondDatesPriceYieldSvg, bondCallPriceYieldSvg, billYieldsSvg, zeroCurveSvg,
// nelsonSiegelSvg).
{
  const bond = (id: string, over: Record<string, string>, name: string) => {
    const c = BOND_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: bond calc ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    if (typeof out === "string" || out.ok === false || !out.svg) throw new Error(`corpus: bond ${name} did not draw`);
    figures.push([`bond ${name}`, out.svg]);
  };
  for (const c of BOND_CALCS) bond(c.id, {}, `${c.id} default`);
  bond("curve-nelson-siegel", { model: "svensson" }, "svensson");
  bond("curve-bootstrap", { mode: "prices", rows: "0.5\t0\t97.9\n1\t0\t95.9\n2\t4\t99.8\n5\t4\t99.1\n10\t4.5\t101.2" }, "bootstrap from prices");
  bond("tbill-yields", { year: "treasury" }, "bill treasury year");
}

// --- "Fully inclusive" (2026-10-28): figures for the calculators that were tables only ---------------------------
// The library registries' defaults (fx, deriv-parity, ipv-*, fin-ratios) enter through their own loops below; these
// are the pane calculators' figures and the non-default branches.
{
  const must = (name: string, svg: string | undefined) => {
    if (!svg) throw new Error(`corpus: ${name} did not draw`);
    figures.push([name, svg]);
  };
  const cur = (over: Record<string, string>) => finCurrencyFigure(finCurrencyCalc((k) => over[k] ?? FIN_CURRENCY_DEFAULTS[k] ?? ""));
  must("fin-currency default", cur({}));
  must("fin-currency negative beside positive", cur({ amounts: "-500 EUR\n250 GBP" }));
  must("fin-currency huge beside one", cur({ amounts: "999999999999999 JPY\n1 EUR" }));
  const logit: Record<string, string> = { data: LOGIT_DEFAULT, spec: LOGIT_SPEC_DEFAULT, model: "logit", se: "classical", constant: "yes" };
  must("econ-logit default", econLogitCalc((k) => logit[k] ?? "").svg);
  must("econ-logit probit", econLogitCalc((k) => ({ ...logit, model: "probit" })[k] ?? "").svg);
  must("econ-regtable default", econRegTableCalc((k) => ({ data: LONGLEY_DEFAULT, specs: ECON_SPECS_DEFAULT })[k as "data"] ?? "").svg);
  must("econ-regtable ols beside logit", econRegTableCalc((k) => ({ data: LOGIT_DEFAULT, specs: "grade ~ GPA\nlogit: grade ~ GPA" })[k as "data"] ?? "").svg);
  must("cip parity no quote", cipParitySvg((d) => 1.25 * (1 + 0.05 * d / 360) / (1 + 0.03 * d / 360), 182, null));
  must("uip path realized", uipPathSvg(1.25, 1.0194, 1, 1.24));
  must("ppp relative path", pppPathSvg(1.25, 0.02, 5));
  must("ppp basket", pppBasketSvg(100, 88, 1.25, (x) => x.toFixed(2)));
  must("put-call parity", putCallParitySvg(100, 0.98, 95.12, 5.55));
  must("step bars long names", stepBarsSvg([
    { name: "Entire market value of the multi-component product", value: 120e6, text: "$120,000,000.00" },
    { name: "Smallest salable patent-practicing unit", value: 36e6, text: "$36,000,000.00" },
    { name: "Royalty", value: 432000, text: "$432,000.00" },
  ], "Apportionment from the base to the royalty"));
  must("named bars", namedBarsSvg([
    { name: "With the feature", value: 9e6, text: "$9,000,000.00" },
    { name: "Next-best alternative", value: 6.5e6, text: "$6,500,000.00" },
    { name: "Surplus", value: 2.5e6, text: "$2,500,000.00", emphasis: true },
  ], "Nash bargaining split"));
  void logitCoefFigureSvg;
  void regTableFigureSvg;
  // The tobit, heckman and mlogit defaults and the money multiplier enter through the LIMDEP and MICROMACRO loops.
  must("coef forest negative and positive", coefForestSvg([{ title: "Tobit: hours", terms: [{ name: "educ", coef: 1.1024, lo: 0.8447, hi: 1.3602 }, { name: "kids", coef: -2.7295, lo: -3.4795, hi: -1.9796 }] }]));
  must("coef forest 25 terms", coefForestSvg([{ title: "Many terms", terms: Array.from({ length: 25 }, (_, i) => ({ name: `regressor_${i + 1}`, coef: (i - 12) / 5, lo: (i - 14) / 5, hi: (i - 10) / 5 })) }]));
  must("deposit expansion", depositExpansionSvg({ cumulative: [100, 175, 231.25], limit: 400, limitLabel: "m·ΔB = 400", title: "Deposit expansion out of ΔB = 100", injectionLabel: "change in the base" }));
}

// --- IP valuation & licensing (src/lib/ipValuationCalcs.ts, F1): every default that draws ---------------------
{
  for (const c of IPVAL_CALCS) {
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    const out = c.compute((k) => vals[k] ?? "");
    if (typeof out !== "string" && out.ok !== false && out.svg) figures.push([`ipval ${c.id} default`, out.svg]);
  }
}

// --- Derivatives (src/lib/derivCalcs.ts, F1): every default that draws, then the tree, convergence, strategy, swap -----
{
  const deriv = (c: (typeof DERIV_CALCS)[number], over: Record<string, string>, name: string, must: boolean) => {
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    if (typeof out !== "string" && out.ok !== false && out.svg) figures.push([`deriv ${name}`, out.svg]);
    else if (must) throw new Error(`corpus: deriv ${name} did not draw`);
  };
  const byId = (id: string) => {
    const c = DERIV_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: deriv calc ${id} missing`);
    return c;
  };
  for (const c of DERIV_CALCS) deriv(c, {}, `${c.id} default`, false);
  deriv(byId("deriv-crr"), { style: "european", n: "200" }, "crr european convergence", true);
  deriv(byId("deriv-crr"), { n: "6" }, "crr tree n6", true);
  deriv(byId("deriv-strategy"), { legs: "call, 100, 1, 6\nput, 100, 1, 5.5", mult: "100" }, "strategy straddle", true);
  deriv(byId("deriv-swap"), { tenor: "100", ffix: "12", fflt: "12", curve: "1 0.96\n100 0.02" }, "swap long monthly", true);
}

// --- Schedules and statements (src/lib/schedCalcs.ts, F1): loanBalanceSvg, bookValueSvg, cvpChartSvg, hBarSvg ---
{
  const sched = (id: string, over: Record<string, string>, name: string, must: boolean) => {
    const c = SCHED_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: sched calc ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    if (typeof out !== "string" && out.ok !== false && out.svg) figures.push([`sched ${name}`, out.svg]);
    else if (must) throw new Error(`corpus: sched ${name} did not draw`);
  };
  for (const c of SCHED_CALCS) sched(c.id, {}, `${c.id} default`, false);
  sched("loan-schedule", { balloon: "200000", extra: "", lumps: "", years: "7" }, "balloon", true);
  sched("depr-schedule", { method: "db", factor: "1.5", salvage: "1000" }, "db shortfall", true);
  sched("depr-schedule", { method: "uop" }, "units of production", true);
  sched("depr-schedule", { life: "40", cost: "123456789" }, "long life", true);
  sched("macrs", { system: "sl", slperiod: "50", basis: "98765432.1" }, "macrs sl 50", true);
  sched("altman-z", { variant: "zdouble" }, "altman z2", true);
  sched("cvp-breakeven", { units: "500" }, "cvp below break-even", true);
}

// --- Portfolio & risk, capital budgeting & valuation (src/lib/portcorpCalcs.ts, F1) -------------------------------
{
  const pc = (id: string, over: Record<string, string>, name: string, must: boolean) => {
    const c = PORTCORP_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: portcorp calc ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    if (typeof out !== "string" && out.ok !== false && out.svg) figures.push([`portcorp ${name}`, out.svg]);
    else if (must) throw new Error(`corpus: portcorp ${name} did not draw`);
  };
  for (const c of PORTCORP_CALCS) pc(c.id, {}, `${c.id} default`, true);
  pc("port-capm", { se: "hac" }, "capm hac", true);
  pc("port-var", { horizon: "10", conf: "99" }, "var 10-period 99", true);
  pc("corp-wacc", { betakind: "peer" }, "wacc peer beta", true);
  pc("corp-capbudget", { cfa: "-1600, 10000, -10000", cfb: "" }, "capbudget two roots", true);
  pc("corp-capbudget", { cfb: "" }, "capbudget one project", true);
  pc("corp-dcf", { terminal: "exit", tstep: "1" }, "dcf exit multiple", true);
  pc("corp-dcf", { shares: "" }, "dcf no shares", true);
}

// --- Securities, antitrust, forensic lost earnings, actuarial (F2: litigCalcs.ts, forensicCalcs.ts) ------------------
{
  const f2 = (calcs: typeof LITIG_CALCS, tag: string, id: string, over: Record<string, string>, name: string, must: boolean) => {
    const c = calcs.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: ${tag} calc ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    if (typeof out !== "string" && out.ok !== false && out.svg) figures.push([`${tag} ${name}`, out.svg]);
    else if (must) throw new Error(`corpus: ${tag} ${name} did not draw`);
  };
  for (const c of LITIG_CALCS) f2(LITIG_CALCS, "litig", c.id, {}, `${c.id} default`, false);
  f2(LITIG_CALCS, "litig", "dmg-sec-ribbon", { mode: "ar-pct" }, "ribbon percent", true);
  f2(LITIG_CALCS, "litig", "dmg-pslra", { sale: "2025-05-09" }, "pslra sale in window", true);
  f2(LITIG_CALCS, "litig", "dmg-sec-aggregate", { model: "one" }, "aggregate one-trader", true);
  f2(LITIG_CALCS, "litig", "dmg-antitrust", { method: "forecast", form: "level" }, "antitrust forecast level", true);
  for (const c of FORENSIC_CALCS) f2(FORENSIC_CALCS, "forensic", c.id, {}, `${c.id} default`, false);
}

// --- Time series II (F2: ts2StatCalcs.ts): garchVolatilitySvg, seriesLinesSvg, varIrfGridSvg, egResidualSvg ---------
{
  const ts2 = (id: string, over: Record<string, string>, name: string) => {
    const c = TS2_STAT_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: ts2 calc ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    if (out.ok === false || !out.svg) throw new Error(`corpus: ts2 ${name} did not draw: ${out.text.slice(0, 120)}`);
    figures.push([`ts2 ${name}`, out.svg]);
  };
  for (const c of TS2_STAT_CALCS) ts2(c.id, {}, `${c.id} default`);
  ts2("ts-garch", { model: "egarch" }, "egarch one-step");
  ts2("ts-garch", { model: "garch", dist: "normal", h: "250" }, "garch normal h250");
  ts2("ts-engle-granger", { trend: "ct" }, "engle-granger trend");
  // long series names stress the panel titles and legends
  const varData = TS2_STAT_CALCS.find((x) => x.id === "ts-var")!.fields.find((f) => f.key === "data")!.default;
  const longVar = varData.replace(/^[^\n]*/, (h) => h.replace("Growth", "RealGrowthRateAnnualised").replace("Inflation", "CoreInflationExFoodEnergy").replace(/\bRate\b/, "PolicyRateEffective"));
  ts2("ts-var", { data: longVar }, "var long names");
  ts2("ts-var-irf", { data: longVar, p: "1", h: "24" }, "irf long names h24");
}

// --- Causal inference II (F2: causalStatCalcs.ts): RDD binned scatter, synthetic-control gaps, pscore overlap/balance --
{
  const cz = (id: string, over: Record<string, string>, name: string) => {
    const c = CAUSAL_STAT_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: causal calc ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    if (out.ok === false || !out.svg) throw new Error(`corpus: causal ${name} did not draw: ${out.text.slice(0, 120)}`);
    figures.push([`causal ${name}`, out.svg]);
  };
  for (const c of CAUSAL_STAT_CALCS) cz(c.id, {}, `${c.id} default`);
  cz("causal-rdd", { design: "fuzzy" }, "rdd fuzzy");
  cz("causal-pscore", { method: "ipw" }, "pscore ipw");
  // long covariate names are the balance plot's y-axis labels
  const ps = CAUSAL_STAT_CALCS.find((x) => x.id === "causal-pscore")!;
  const psData = ps.fields.find((f) => f.key === "data")!.default.replace(/^[^\n]*/, (h) =>
    h.replace("age", "age_at_enrolment_years").replace("educ", "years_of_schooling_completed").replace("income", "household_income_prior_year"),
  );
  cz("causal-pscore", { data: psData, covariates: "age_at_enrolment_years + years_of_schooling_completed + household_income_prior_year" }, "pscore long names");
}

// --- Limited dependent & count models (F2: limdepStatCalcs.ts): count and ordered frequency figures ---------------
{
  for (const c of LIMDEP_STAT_CALCS) {
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    const out = c.compute((k) => vals[k] ?? "");
    if (out.ok !== false && out.svg) figures.push([`limdep ${c.id} default`, out.svg]);
  }
  const cnt = LIMDEP_STAT_CALCS.find((x) => x.id === "econ-count")!;
  const vals: Record<string, string> = Object.fromEntries(cnt.fields.map((f) => [f.key, f.default]));
  const nb = cnt.compute((k) => (k === "model" ? "nb2" : (vals[k] ?? "")));
  if (nb.ok === false || !nb.svg) throw new Error(`corpus: limdep count NB2 did not draw: ${nb.text.slice(0, 120)}`);
  figures.push(["limdep econ-count nb2", nb.svg]);
}

// --- GMM and dynamic panels (F3: gmmStatCalcs.ts): 2SLS vs GMM coefficients, ρ by estimator (the Nickell bracket) --
{
  const gm = (id: string, over: Record<string, string>, name: string) => {
    const c = GMM_STAT_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: gmm calc ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    if (out.ok === false || !out.svg) throw new Error(`corpus: gmm ${name} did not draw: ${out.text.slice(0, 120)}`);
    figures.push([`gmm ${name}`, out.svg]);
  };
  for (const c of GMM_STAT_CALCS) gm(c.id, {}, `${c.id} default`);
  gm("econ-gmm", { endog: "educ + exper", spec: "lwage ~", instruments: "dist + sibs" }, "two endogenous");
  gm("panel-dyn-gmm", { estimator: "difference", steps: "one" }, "difference one-step");
  gm("panel-dyn-gmm", { endog: "price", collapse: "yes", lagLast: "" }, "system endogenous collapsed");
  // Long endogenous names: the ticks are shortened to their slots (review 2 found them colliding).
  const longIv = ivDefaultTable().replace(/^lwage(\s)educ(\s)exper/m, "lwage$1years_of_schooling_completed$2labor_market_experience_total");
  gm("econ-gmm", { data: longIv, spec: "lwage ~", endog: "years_of_schooling_completed + labor_market_experience_total", instruments: "dist + sibs" }, "long endogenous names");
  // Long names sharing a prefix: numbered ticks, keyed in the note with each "n = name" pair kept on one line.
  const twinIv = ivDefaultTable().replace(/^lwage(\s)educ(\s)exper/m, "lwage$1years_of_schooling_completed_mother$2years_of_schooling_completed_father");
  gm("econ-gmm", { data: twinIv, spec: "lwage ~", endog: "years_of_schooling_completed_mother + years_of_schooling_completed_father", instruments: "dist + sibs" }, "numbered ticks");
  // Long response names in the ρ figure title (a 32-character name clipped "Coefficient of L.… by estimator"): the
  // title drops "Coefficient of", and a still longer name moves to the note.
  for (const [nm, tag] of [["log_real_sales_per_employee_defl", "long response name"], ["WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW", "wide response name at the title switch"], ["log_real_sales_per_employee_deflated_by_the_gdp_price_index_2015", "very long response name"]]) {
    gm("panel-dyn-gmm", { data: DYN_DEFAULT_TABLE.replace(/\bsales\b/, nm), spec: `${nm} ~ L.${nm} + price` }, tag);
  }
  // The other estimator's two-step weight is singular (system GMM, more instruments than groups): no point, no tick,
  // the reason in the note.
  gm("panel-dyn-gmm", { estimator: "difference", endog: "price" }, "difference with a singular system two-step");
  // An estimator not computed (the pair budget): no tick without a point, the reason in the note.
  const skipped = rhoFigure(
    [
      { name: "Pooled OLS", b: 0.914, se: 0.0177 },
      { name: "Fixed effects", b: 0.4604, se: 0.032 },
      { name: "Difference GMM", b: 0.6629, se: 0.08 },
      { name: "System GMM", note: "fitting it too would exceed the task pane's work budget" },
    ],
    "L.y",
  );
  if (!skipped) throw new Error("corpus: gmm skipped-estimator figure did not draw");
  figures.push(["gmm rho with an estimator not computed", skipped]);
}

// --- Micro II, macro II (micromacroStatCalcs.ts), CBA, Pigou, CIP/UIP/PPP (cbaCalcs.ts) — F2 ----------------------
{
  const mm = (calcs: { id: string; fields: { key: string; default: string }[]; compute: (r: (k: string) => string) => unknown }[], id: string, over: Record<string, string>, name: string, must: boolean) => {
    const c = calcs.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: micromacro calc ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "") as string | { ok?: boolean; svg?: string; text: string };
    if (typeof out !== "string" && out.ok !== false && out.svg) figures.push([`micromacro ${name}`, out.svg]);
    else if (must) throw new Error(`corpus: micromacro ${name} did not draw`);
  };
  for (const c of MICROMACRO_STAT_CALCS) mm(MICROMACRO_STAT_CALCS, c.id, {}, `${c.id} default`, false);
  for (const c of CBA_CALCS) mm(CBA_CALCS, c.id, {}, `${c.id} default`, false);
  mm(MICROMACRO_STAT_CALCS, "micro-demand", { form: "semilog" }, "demand semilog", true);
  mm(MICROMACRO_STAT_CALCS, "micro-consumer", { util: "ces" }, "consumer ces", true);
  mm(MICROMACRO_STAT_CALCS, "micro-consumer", { util: "leontief", a: "1", b: "2" }, "consumer leontief", true);
  mm(MICROMACRO_STAT_CALCS, "micro-consumer", { util: "linear", a: "2", b: "1", p1: "1" }, "consumer linear", true);
  mm(MICROMACRO_STAT_CALCS, "micro-cost", { tc: "200, 30, −2, −0.05, 0.01", price: "40" }, "cost quartic", true);
  mm(MICROMACRO_STAT_CALCS, "micro-price-disc", { a2: "30", b2: "1" }, "price disc second market", true);
  mm(MICROMACRO_STAT_CALCS, "micro-auction", { reserve: "50" }, "auction reserve", true);
  mm(MICROMACRO_STAT_CALCS, "micro-auction", { n: "200", lo: "0.1234567890123", hi: "987654.321098765", reserve: "123456.789012345" }, "auction long decimals", true);
  mm(MICROMACRO_STAT_CALCS, "macro-growth-accounting", { growth: "simple" }, "growth simple", true);
  mm(MICROMACRO_STAT_CALCS, "macro-mundell-fleming", { mobility: "imperfect", regime: "fixed", shock: "devaluation" }, "mf fixed devaluation", true);
  mm(MICROMACRO_STAT_CALCS, "macro-mundell-fleming", { shock: "monetary" }, "mf monetary", true);
  mm(MICROMACRO_STAT_CALCS, "macro-fiscal-multipliers", { dT: "100" }, "fiscal tax cut", true);
  mm(MICROMACRO_STAT_CALCS, "macro-phillips", { form: "expect", se: "hac" }, "phillips expectations hac", true);
  mm(CBA_CALCS, "cba-scenarios", { factors: "1, 0.8", rate: "12" }, "cba shadow 12pct", true);
  mm(CBA_CALCS, "cba-scenarios", { data: "Year\tProject benefits\tProject costs\n2025\t0\t500\n2027\t400\t0\n2030\t600\t0\n2032\t0\t450", rate: "6", base: "2024" }, "cba gaps", true);
  mm(CBA_CALCS, "cba-pigou", { e0: "−4", e1: "−0.1", a: "50", c: "5", d: "1" }, "pigou zero efficient", true);
  mm(CBA_CALCS, "cba-pigou", { e0: "200" }, "pigou large externality", true);
}

// --- Thin films, Fresnel s/p, Jones calculus (src/lib/filmCalcs.ts) ----------
//
// Each calculator at its defaults, then the states that stress the layout: TIR
// (critical + Brewster markers and the 100 % plateau), a metal (curves bunched
// at the top, pseudo-Brewster), a quarter-wave mirror, an absorbing stack (third
// A curve), an opaque layer, crossed polarisers (the "no light" panel), a thin
// elliptical output and the bare circular ellipse builder.
{
  const film = (id: string, over: Record<string, string>, name: string) => {
    const c = FILM_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: film calc ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: film ${name} did not draw`);
    plots.forEach((b, i) => {
      if (b.kind === "plot") figures.push([`film ${name}${i ? " " + i : ""}`, b.svg]);
    });
  };
  for (const c of FILM_CALCS) film(c.id, {}, `${c.id} default`);
  film("optics-fresnel", { n1: "1.5", n2: "1.0", th: "60" }, "fresnel TIR");
  film("optics-fresnel", { n2: "0.05+3.4i", th: "70" }, "fresnel metal");
  film("optics-thin-film", { layers: `repeat 4
H 2.35 QW
L 1.38 QW
end
H 2.35 QW` }, "stack HL mirror");
  film("optics-thin-film", { layers: "Ag 0.05+3.4i 40 nm", th: "45" }, "stack absorbing oblique");
  film("optics-thin-film", { layers: "Au 0.2+3.5i 1000000", lmin: "300", lmax: "2500", lam0: "1064" }, "stack opaque wide range");
  film("optics-jones", { elements: `polariser 0
polariser 90` }, "jones crossed");
  film("optics-jones", { input: "custom", ex: "1", ey: "0.5i", elements: `retarder 30 60
rotator 15` }, "jones elliptical");
  figures.push(["film ellipse circular + linear", polarisationEllipseSvg([
    { title: "Right circular", vec: RIGHT_CIRCULAR, lines: ["right-handed circular", "I/I₀ = 1"], colour: "#2563eb" },
    { title: "Linear 120°", vec: linearState(120), lines: ["linear at 120°", "I/I₀ = 0.5"], colour: "#b91c1c" },
  ])]);
}

// --- Materials testing and quality (Release B #15) ---------------------------
//
// Every plot block of every MATERIALS_CALCS tool at its shipped defaults, plus
// the variants that change a figure's shape: the stack-up with Monte Carlo on,
// a one-sided capability limit, a ksi tensile curve and a single-peak Scherrer
// (no Williamson–Hall panel).
{
  const variants: Record<string, Record<string, string>[]> = {
    "mat-tensile": [
      {},
      { stressUnit: "ksi", data: "0 0\n0.05 5\n0.1 10\n0.15 15\n0.2 20\n0.3 27\n0.5 31\n1 34\n3 38\n6 40\n9 39\n11 36" },
      // mild steel with a yield-point drop (ReH/ReL markers) and two post-break rows
      {
        offset: "0.2",
        data:
          "0 0\n0.02 40\n0.04 80\n0.06 120\n0.08 160\n0.1 200\n0.12 240\n0.15 300\n0.2 270\n0.4 272\n0.6 268\n0.8 271\n1 269\n1.3 270\n1.6 271\n2 270\n" +
          "3 303\n5 350\n8 385\n12 405\n18 418\n22 410\n25 380\n27 352\n27.1 4\n27.2 0",
      },
      // too few elastic rows: no modulus, a single curve-and-UTS figure
      { data: "0 0\n0.1 70\n0.2 140\n0.3 200\n0.5 240\n1 260\n2 290\n5 350\n10 410\n15 440\n20 450\n25 420\n28 320" },
      // curved from the start (polypropylene-like): chord slope with caveat
      { data: "0 0\n0.25 3.2\n0.5 6.2\n0.75 8.8\n1 11.2\n1.25 13.4\n1.5 15.3\n2 18.7\n3 23.8\n4 27.1\n6 30.9\n8 32.6\n12 33.7" },
    ],
    "mat-weibull-strength": [{}],
    "mat-scherrer": [{}, { peaks: "38.2 0.18" }],
    "qual-capability": [{}, { lsl: "", subgroup: "" }],
    "qual-tolerance-stack": [{}, { mc: "on", gapMin: "0.3", gapMax: "0.7" }],
  };
  for (const c of MATERIALS_CALCS) {
    (variants[c.id] ?? [{}]).forEach((over, vi) => {
      const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
      Object.assign(vals, over);
      const out = c.compute((k) => vals[k] ?? "");
      const svgs = (out.blocks ?? []).filter((b) => b.kind === "plot").map((b) => (b as { svg: string }).svg);
      if (out.ok === false || !svgs.length) throw new Error(`corpus: materials ${c.id} did not draw`);
      svgs.forEach((s, i) => figures.push([`materials ${c.id} v${vi} ${Object.keys(over).join("+") || "default"} #${i + 1}`, s]));
    });
  }
}

// --- Chemistry & electrochemistry (src/lib/titrationCalcs.ts, titrationCharts.ts) ----
//
// Every calculator at its shipped defaults, then the layouts that crowd: phosphoric acid with a measured curve
// overlaid (two breaks, four legend rows), a strong acid (a dpH/dV needle ~4300 pH/mL tall beside a flat line), a
// diprotic base from pKb values, a strong-only solution (β panel alone), four-pKa speciation (five legend rows), a
// six-rate oxidation-first CV at n = 2, and Randles–Ševčík data from an adsorbed layer (log–log slope 1).
{
  const runChem = (id: string, over: Record<string, string> = {}): string => {
    const c = TITRATION_CALCS.find((k) => k.id === id);
    if (!c) throw new Error(`corpus: no chemistry calculator ${id}`);
    const vals: Record<string, string> = { ...Object.fromEntries(c.fields.map((f) => [f.key, f.default])), ...over };
    const out = c.compute((k) => vals[k] ?? "");
    const p = (out.blocks ?? []).find((b) => b.kind === "plot");
    if (out.ok === false || !p || p.kind !== "plot") throw new Error(`corpus: chemistry ${id} did not draw: ${out.text}`);
    return p.svg;
  };
  for (const c of TITRATION_CALCS) figures.push([`chem ${c.id} defaults`, runChem(c.id)]);
  figures.push([
    "chem titration phosphoric + measured",
    runChem("chem-titration", {
      pk: "2.15, 7.20, 12.35",
      data: "0 1.70\n5 1.95\n10 2.15\n15 2.40\n20 2.85\n23 3.40\n24 3.80\n25 4.60\n26 5.70\n27 6.10\n30 6.70\n35 7.05\n40 7.40\n45 7.95\n48 8.60\n49 9.00\n50 9.60\n51 10.20\n52 10.50\n55 11.00\n60 11.40",
    }),
  ]);
  figures.push(["chem titration strong acid needle", runChem("chem-titration", { kind: "strong-acid", vat: "" })]);
  figures.push(["chem titration diprotic base from pKb", runChem("chem-titration", { kind: "weak-base", pktype: "pkb", pk: "4.07, 7.15", c0: "50 mM", ct: "0.2 M" })]);
  figures.push(["chem solution strong only", runChem("chem-solution-ph", { sys: "none", csa: "1 mM" })]);
  figures.push(["chem speciation four pKa", runChem("chem-speciation", { pk: "1.99, 2.67, 6.16, 10.26", ph: "4.5" })]);
  figures.push(["chem cv six rates oxidation n=2", runChem("chem-cv-peak", { n: "2", dir: "ox", rates: "10, 20, 50, 100, 200, 500, 1000", ehalf: "-0.45" })]);
  figures.push(["chem rs analysis adsorbed", runChem("chem-cv-randles", { data: "10 0.50\n25 1.25\n50 2.49\n100 5.02\n200 9.95\n400 20.1" })]);
  // The builders directly, at the smallest legal inputs: a monoprotic speciation with no mark, one CV curve, one rate.
  figures.push(["chem speciation svg monoprotic", speciationSvg([4.76], false, 14, null)]);
  figures.push(["chem rs line one rate", rsLineSvg([0.1], [1.6558e-5])]);
  const one = simulateReversibleCv({ n: 1, E0: 0, Estart: 0.3, Eswitch: -0.3, v: 0.1, D: 1e-5, A: 0.07, C: 1e-6, tC: 25, steps: 500 });
  if (typeof one !== "string") figures.push(["chem cv svg single", cvSimSvg([{ v: 0.1, sim: one }])]);
}

// --- Figures that moved out of the pane (v2.144.0, host adapter) -------------
//
// The Finance and Bio/Assay figure builders lived inside taskpane.ts, where
// this audit could not import them; the move to src/lib put them in reach, and
// the coverage check above flagged them the same day. Inputs are each
// calculator's shipped defaults (FIN_CALCS / ASSAY_CALCS).
{
  const push = (name: string, svg: string | undefined): void => {
    if (svg) figures.push([name, svg]);
  };
  push(
    "finance money over time (compound interest)",
    moneyOverTimeSvg({ periods: 10, valueAt: (k) => 1000 * Math.pow(1.05, k), title: "Value over time", xlabel: "period", ylabel: "value" }),
  );
  const flows = [-1000, 300, 400, 500];
  push("finance cash-flow ladder (NPV)", cashFlowLadderSvg(flows, flows.map((c, k) => c / Math.pow(1.08, k)), "Discounted cash flows"));
  push(
    "finance bond price curve",
    bondPriceCurveSvg({ face: 1000, coupon: 0.05, ytm: 0.06, years: 10, freq: 2, price: bondPrice(1000, 0.05, 0.06, 10, 2) }),
  );
  push("finance option value curve", optionCurveSvg({ type: "call", s: 100, k: 100, t: 1, r: 0.05, sig: 0.2, price: 10.45 }));
  push(
    "assay proportional law (Beer-Lambert)",
    assayLineSvg({ slope: 6220, x: 1e-4, y: 0.622, xlabel: "concentration (M)", ylabel: "absorbance", title: "Beer–Lambert law" }),
  );
}

// --- Symbolic batch (v2.136.0) ------------------------------------------------
//
// The disc of convergence with complex poles off the axis and an irrational
// radius (1/(x^2 + 4) about 1: R = sqrt(5), poles at ±2i), the Taylor branch's
// disc with three labelled singularities near the circle (1/(1 + x + x^2):
// poles at e^{±2πi/3}), an interval of convergence with one closed and one open
// end; the proportion-interval bars (three methods; the p̂ = 0 case puts a
// zero-width Wald bar on the axis edge); and the Markov diagram with the
// hitting target ringed.
{
  const push = (name: string, svg: string | undefined): void => {
    if (svg) figures.push([name, svg]);
  };
  push("radius disc complex poles", tryRadius("radius of convergence of 1/(x^2 + 4) about 1")?.svg);
  const tay = taylorSeries("1/(1 + x + x^2)");
  push("taylor disc of convergence", tay?.radius ? radiusSvg(tay.radius) : undefined);
  push("interval of convergence half-open", tryRadius("interval of convergence of sum (x-3)^n/(n*2^n)")?.svg);
  push("proportion CI bars", tryProbability("95% confidence interval for a proportion with 12 successes out of 40")?.svg);
  push("proportion CI bars at p = 0", tryProbability("confidence interval 95% proportion p = 0 n = 20")?.svg);
  push("markov hitting target ringed", tryMarkov("markov [[0.5,0.5,0],[0.25,0.5,0.25],[0,0.5,0.5]] probability of reaching 3 before 1 starting from 2")?.svg);
}

// --- The statistics charts ----------------------------------------------------
//
// Stress entries, not happy paths. Each one is the case that crowds the layout:
// the longest labels, the most rows, the widest magnitude spread - because a
// figure that reads at three tidy groups can still be unreadable at twelve.
{
  figures.push([
    "box plot 2 groups",
    boxPlotSvg(
      [
        { label: "control", values: [5, 6, 7, 8, 9] },
        { label: "treated", values: [10, 11, 12, 13, 40] },
      ],
      { title: "Response by group", ylabel: "response (mg/L)" },
    ),
  ]);
  // Twelve groups is the cap: the tightest the category labels ever get.
  figures.push([
    "box plot at the cap",
    boxPlotSvg(
      Array.from({ length: 12 }, (_, i) => ({
        label: "condition " + (i + 1),
        values: [i, i + 1, i + 2, i + 3, i + 9],
      })),
      { title: "Twelve groups, long labels", ylabel: "value" },
    ),
  ]);
  // A forest plot whose labels are long AND whose intervals span both sides of
  // the null line, so the tick labels and the row labels compete for margin.
  figures.push([
    "forest plot pairwise",
    forestPlotSvg(
      [
        { label: "control vs low dose", estimate: -2.5, low: -4.1, high: -0.9 },
        { label: "control vs mid dose", estimate: -0.4, low: -2.2, high: 1.4 },
        { label: "control vs high dose", estimate: 3.8, low: 1.9, high: 5.7 },
        { label: "low dose vs high dose", estimate: 6.3, low: 4.0, high: 8.6 },
      ],
      { title: "Tukey HSD, 95% CI on the difference", xlabel: "difference in means" },
    ),
  ]);
  figures.push([
    "grouped bars obs vs exp",
    groupedBarSvg(
      ["strongly agree", "agree", "neutral", "disagree", "strongly disagree"],
      [
        { label: "observed", values: [42, 31, 18, 7, 2] },
        { label: "expected", values: [20, 20, 20, 20, 20] },
      ],
      { title: "Goodness of fit", ylabel: "count" },
    ),
  ]);

  // v2.134.0 — repeated-measures ANOVA and Cox regression. The figures come
  // from the SAME functions the pane calls (statsBatchCalcs), on the shipped
  // defaults, so the corpus checks what a user inserts.
  const svgOf = (o: { ok: boolean; svg?: string }, what: string): string => {
    if (!o.ok || !o.svg) throw new Error(`${what}: the calculator did not draw`);
    return o.svg;
  };
  figures.push([
    "rm anova profile (bushtucker, condition names, CIs)",
    svgOf(
      rmAnovaCalc(
        "Stick_insect Kangaroo_testicle Fish_eye Witchetty_grub\n8 7 1 6\n9 5 2 5\n6 2 3 8\n5 3 1 9\n8 4 5 8\n7 5 6 7\n10 2 7 2\n12 6 8 1",
        "holm",
      ),
      "rm anova",
    ),
  ]);
  figures.push([
    "rm anova mixed profile (two group means + subject lines)",
    svgOf(
      rmAnovaCalc(
        "Day_1 Day_7 Day_14\nDrug 10 12 14\nDrug 9 11 15\nDrug 12 13 16\nDrug 8 10 13\nPlacebo 11 11 12\nPlacebo 10 12 11\nPlacebo 12 12 13\nPlacebo 9 10 10",
        "holm",
      ),
      "rm anova mixed",
    ),
  ]);
  // The Cox figure is two panels joined by combineSvgs; the analyser does not
  // follow nested-<svg> offsets, so each panel is measured on its own. The
  // calculator must also draw (svgOf) from the same default text.
  const GEHAN =
    "time status placebo\n6 1 0\n6 1 0\n6 1 0\n6 0 0\n7 1 0\n9 0 0\n10 1 0\n10 0 0\n11 0 0\n13 1 0\n16 1 0\n17 0 0\n19 0 0\n20 0 0\n22 1 0\n23 1 0\n25 0 0\n32 0 0\n32 0 0\n34 0 0\n35 0 0\n1 1 1\n1 1 1\n2 1 1\n2 1 1\n3 1 1\n4 1 1\n4 1 1\n5 1 1\n5 1 1\n8 1 1\n8 1 1\n8 1 1\n8 1 1\n11 1 1\n11 1 1\n12 1 1\n12 1 1\n15 1 1\n17 1 1\n22 1 1\n23 1 1";
  svgOf(coxCalc(GEHAN, "efron"), "cox");
  const gehanInput = readCoxField(GEHAN);
  if ("error" in gehanInput) throw new Error(gehanInput.error);
  const gehanFit = coxRegression(gehanInput);
  if (!gehanFit.ok) throw new Error(gehanFit.reason);
  const [coxForest, coxCurves] = coxFigureParts(gehanFit);
  figures.push(["cox HR forest, log axis (Gehan default)", coxForest]);
  figures.push(["cox adjusted survival curves (Gehan default)", coxCurves]);
  // Log-axis stress: three decades (Larynx Stage IV reaches 12.6), a row inside
  // one decade below 1, long labels competing with the decade labels.
  figures.push([
    "forest plot log axis, three decades, long labels",
    forestPlotSvg(
      [
        { label: "Stage II vs I", estimate: 1.15032, low: 0.46468, high: 2.84766 },
        { label: "Stage III vs I", estimate: 1.901, low: 0.94593, high: 3.82036 },
        { label: "Stage IV vs I", estimate: 5.50678, low: 2.4086, high: 12.59015 },
        { label: "age (per year)", estimate: 1.01921, low: 0.99112, high: 1.0481 },
        { label: "financial aid received at release", estimate: 0.68426, low: 0.47024, high: 0.99568 },
      ],
      { log: true, title: "Hazard ratios (95% CI)", xlabel: "Hazard ratio" },
    ),
  ]);
  // v2.137.0 chemistry batch: the figures Solve / Reaction (Formulas) and the
  // stoichiometry calculator draw, built by the SAME functions the pane calls.
  const balanced = (eq: string): BalanceReport => {
    const rep = balanceReport(balanceText(eq));
    if (!rep.svg) throw new Error(`${eq}: no figure`);
    return rep;
  };
  figures.push(["balance conservation bars (Fe + O2 -> Fe2O3)", balanced("Fe + O2 -> Fe2O3").svg as string]);
  // Ionic: a non-zero charge pair (+17 each side) beside six element pairs.
  figures.push(["balance conservation bars, ionic (MnO4- / Fe2+ in acid)", balanced("MnO4^- + Fe^2+ + H^+ -> Mn^2+ + Fe^3+ + H2O").svg as string]);
  // Refusal figures: the independent reactions of a non-unique balancing,
  // short and long (the long one stresses the table column width).
  figures.push(["balance basis table (C + O2 -> CO + CO2)", balanced("C + O2 -> CO + CO2").svg as string]);
  figures.push([
    "balance basis table, long equations (KMnO4 + H2O2 + H2SO4)",
    balanced("KMnO4 + H2O2 + H2SO4 -> K2SO4 + MnSO4 + O2 + H2O").svg as string,
  ]);
  const st = stoichCalc("2 H2 + O2 -> 2 H2O", "H2: 10.0 g\nO2: 10.0 g", "", "IUPAC-STP");
  figures.push(["stoichiometry available vs needed (shipped default)", svgOf(st, "stoich")]);
  // Log-axis stress: inside ONE decade, so 0.2 and 0.5 are labelled too.
  figures.push([
    "forest plot log axis, one decade",
    forestPlotSvg([{ label: "fin", estimate: 0.68426, low: 0.47024, high: 0.99568 }], {
      log: true,
      title: "One protective effect",
      xlabel: "Hazard ratio",
    }),
  ]);
}

// v2.140.0 audio, video and light. Each entry is a calculator's shipped default
// (or a named stress case), drawn by the avFigures function the pane calls.
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ok = (r: any, what: string): any => {
    if (!r || r.ok === false) throw new Error(`${what}: ${r ? r.error : "no result"}`);
    return r;
  };
  figures.push(["av level ladder (+4 dBu, EBU R68 alignment)", audioFigureSvg(ok(levelConvert(4, "dBu", "dBFS", { alignment: "ebu-r68" }), "levels").figure)]);
  figures.push(["av level ladder, sound pressure (94 dB SPL)", audioFigureSvg(ok(levelConvert(94, "dBSPL", "Pa"), "spl ladder").figure)]);
  figures.push(["av level ladder, sound power (1 W)", audioFigureSvg(ok(levelConvert(1, "W", "dBSWL"), "swl ladder").figure)]);
  figures.push(["av level sum shares (80, 80, 74)", audioFigureSvg(ok(levelSum([80, 80, 74]), "sum").figure)]);
  figures.push([
    "av A-weighting of octave bands at 80 dB",
    audioFigureSvg(ok(bandsToWeighted([63, 125, 250, 500, 1000, 2000, 4000, 8000], [80, 80, 80, 80, 80, 80, 80, 80], "A"), "weight").figure),
  ]);
  figures.push(["av coherent total against phase", audioFigureSvg(ok(coherentSum([80, 80], [0, 90]), "coherent").figure)]);
  figures.push(["av dither budget (16-bit TPDF)", audioFigureSvg(ok(ditherBudget(16, "tpdf", 1, 0), "dither").figure)]);
  figures.push([
    "av file size against duration (48 kHz/24/2, 1 h)",
    audioFigureSvg(ok(audioSize({ mode: "pcm", fs: 48000, bits: 24, channels: 2, durationS: 3600 }), "size").figure),
  ]);
  figures.push(["av loudness normalisation bars (−16.3 → −23 LUFS)", audioFigureSvg(ok(normaliseGain(-16.3, -23, -1.5, -1), "normalise").figure)]);
  figures.push(["av K-weighting curve (997 Hz sine)", audioFigureSvg(ok(sineLoudness(0, 997, "L"), "sine").figure)]);
  figures.push(["av gated block loudness", audioFigureSvg(ok(gatedIntegrated([-20, -22, -23, -24, -75]), "gated").figure)]);
  figures.push([
    "av loudspeaker SPL against distance",
    audioFigureSvg(
      ok(
        speakerSpl({ sensitivityDb: 88, basis: "1W", impedanceOhm: 8, powerW: 100, distanceM: 4, boxes: 1, coherent: false, crestDb: 12, targetSplDb: null }),
        "speaker",
      ).figure,
    ),
  ]);
  figures.push([
    "av absorption per surface with a 0.5 s target",
    audioFigureSvg(ok(absorptionBudget(200, [{ area: 60, alpha: 0.02 }, { area: 60, alpha: 0.6 }, { area: 120, alpha: 0.1 }], 0, 0.5), "absorption").figure),
  ]);
  figures.push(["av crossover LR2 at 2.5 kHz", audioFigureSvg(ok(passiveCrossover(2500, 8, "lr2"), "crossover").figure)]);
  figures.push([
    "av damping factor against cable length",
    audioFigureSvg(ok(cableDamping({ loadOhm: 8, sourceOhm: 0.02, lengthM: 10, areaM2: 2.5e-6 }), "damping").figure),
  ]);
  figures.push(["av timecode drift, 29.97 DF at 00:10:00;00", timecodeDriftSvg(ok(driftFigure("29.97 DF", 60, 17982), "drift"), "29.97")]);
  figures.push(["av timecode drift, 25 fps (no drift)", timecodeDriftSvg(ok(driftFigure("25", 60, 90000), "drift 25"), "25")]);
  figures.push(["av pulldown cadence 23.976 → 29.97 (fields)", cadenceSvg(ok(pulldown("23.976", "29.97"), "pulldown"))]);
  figures.push(["av pulldown cadence 24 → 60 (frame cadence)", cadenceSvg(ok(pulldown("24", "60"), "pulldown 60"))]);
  figures.push([
    "av aspect frame, 2.39 letterbox in 1920×1080",
    aspectFrameSvg(ok(aspect({ width: 720, height: 480, dar: "4:3", frame: "1920×1080", content: "2.39" }), "aspect").figure),
  ]);
  figures.push([
    "av aspect frame, 4:3 pillarbox in 1920×1080",
    aspectFrameSvg(ok(aspect({ width: 1440, height: 1080, frame: "1920×1080", content: "4:3" }), "pillarbox").figure),
  ]);
  figures.push(["av transfer BT.1886 at 0.5", transferSvg(ok(transfer("bt1886", "toLight", 0.5), "1886"))]);
  figures.push(["av transfer PQ, log luminance axis", transferSvg(ok(transfer("pq", "toLight", 0.5), "pq"))]);
  figures.push(["av interface bars, 1080p60 4:2:2 10-bit", interfaceBarsSvg(ok(interfaceRate(1920, 1080, "60", 2200, 1125, 20), "interface").figure)]);
  figures.push(["light illuminance against distance, 30° incidence", photoFigureSvg(ok(pointIlluminance(1000, 2, 30), "point").figure)]);
  figures.push(["light flux of a uniform cone", photoFigureSvg(ok(coneFlux(1000, 30), "cone").figure)]);
  figures.push(["light screen luminance against area", photoFigureSvg(ok(screenLuminance(5000, 10, 1), "screen").figure)]);
  figures.push(["light depth of field (50 mm f/8 at 5 m)", photoFigureSvg(ok(depthOfField(0.05, 8, 0.00003, 5), "dof").figure)]);
  figures.push(["light exposure line (f/8, 1/125 s, ISO 100)", photoFigureSvg(ok(exposureValue(8, 1 / 125, 100), "ev").figure)]);
  figures.push([
    "light daylight and Planckian loci, 3200 K, 5600 K and D65 xy",
    daylightLocusSvg(daylightLocusFigure([3200, 5600], { x: 0.3127, y: 0.329 })),
  ]);
}

// v2.143.0 journal-grade figures. Names of figures drawn under a style start
// "preset <id> <mm> mm", which figure-label-audit.js reads to check the text
// against that style at that printed width (its PRESET predicate).
{
  const need = (r: ReturnType<typeof prepareFigure>, what: string): string => {
    if (!r.ok) throw new Error(`${what}: ${r.reason}: ${r.problems.join("; ")}`);
    return r.svg;
  };
  const presetName = (id: string, width: "single" | "double", what: string): string => {
    const p = getPreset(id);
    if (!p) throw new Error(id);
    return `preset ${id} ${presetWidthMm(p, width)} mm ${what}`;
  };
  const sinPlot = (w: number): string =>
    buildPlotSvg(
      [
        { type: "line", label: "sin x", points: Array.from({ length: 61 }, (_, i) => ({ x: i / 6, y: Math.sin(i / 6) })) },
        { type: "scatter", label: "measured", points: Array.from({ length: 11 }, (_, i) => ({ x: i, y: Math.sin(i) + 0.1 * Math.cos(3 * i) })) },
      ],
      { title: "Damped response", xlabel: "Time (s)", ylabel: "Amplitude (mV)", width: w, height: Math.round((270 * w) / 380) },
    );
  const table = parseTableData([
    ["Quarter", "Control", "Treated", "Sham"],
    ["Q1", "12.5", "14.1", "11.9"],
    ["Q2", "13.2", "16.8", "12.4"],
    ["Q3", "15.0", "19.3", "13.0"],
    ["Q4", "15.8", "21.6", "13.5"],
  ]);
  const okabe = (kind: ChartKind) => (w: number): string => buildChartPreviewSvg(table, kind, "Yield by quarter", { palette: "okabe-ito" }, w).svg;
  const patent = (kind: ChartKind) => (w: number): string => buildChartPreviewSvg(table, kind, "", { patent: true }, w).svg;

  // Every journal style, single column, the Plot tool's figure.
  for (const id of PRESET_IDS.filter((p) => p !== "uspto")) {
    figures.push([presetName(id, "single", "plot"), need(prepareFigure({ svg: sinPlot(380), preset: id, width: "single", render: sinPlot }), id)]);
  }
  // Double column and the Okabe–Ito Table→Chart series (marker + dash per series).
  figures.push([presetName("nature", "double", "table column okabe-ito"), need(prepareFigure({ svg: okabe("column")(380), preset: "nature", width: "double", render: okabe("column"), chartKind: "column" }), "okabe column")]);
  figures.push([presetName("elsevier", "single", "table line okabe-ito"), need(prepareFigure({ svg: okabe("line")(380), preset: "elsevier", width: "single", render: okabe("line"), chartKind: "line" }), "okabe line")]);
  figures.push([presetName("cell", "single", "table scatter okabe-ito"), need(prepareFigure({ svg: okabe("scatter")(380), preset: "cell", width: "single", render: okabe("scatter"), chartKind: "scatter" }), "okabe scatter")]);
  // USPTO: the patent drawing at the 170 mm sight, black and white, no title.
  for (const kind of ["column", "line", "stacked-bar"] as ChartKind[]) {
    figures.push([presetName("uspto", "single", `table ${kind}`), need(prepareFigure({ svg: patent(kind)(380), preset: "uspto", width: "single", render: patent(kind), chartKind: kind }), `uspto ${kind}`)]);
  }

  // Significance brackets, from the engines' own results.
  const A = [5.1, 5.4, 5.0, 5.6, 5.3, 5.2];
  const B = [6.4, 6.8, 6.1, 6.9, 6.5, 6.6];
  const C = [5.2, 5.5, 5.1, 5.7, 5.0, 5.4];
  const D = [7.1, 7.4, 6.9, 7.6, 7.2, 7.0];
  const g = (xs: number[][]) => xs.map((v, i) => ({ label: `group ${i + 1}`, values: v }));
  const fig = (r: ReturnType<typeof bracketedBoxPlot>, what: string): string => {
    if (!r.ok) throw new Error(`${what}: ${r.error}`);
    return r.svg;
  };
  const tk = tukeyHSD([A, B, C, D], 0.05);
  if (!tk) throw new Error("tukey");
  figures.push(["brackets t-test stars", fig(bracketedBoxPlot(g([A, B]), { title: "Two-sample t-test", ylabel: "value" }, { kind: "t", result: twoSampleTTest(A, B) }, { label: "stars", hideNs: false, tall: false }), "t")]);
  figures.push(["brackets tukey 4 groups exact p, taller", fig(bracketedBoxPlot(g([A, B, C, D]), { title: "Tukey HSD (4 groups)", ylabel: "value" }, { kind: "tukey", result: tk }, { label: "p", hideNs: false, tall: true }), "tukey")]);
  figures.push(["brackets tukey 4 groups stars, ns hidden", fig(bracketedBoxPlot(g([A, B, C, D]), { title: "Tukey HSD (4 groups)", ylabel: "value" }, { kind: "tukey", result: tk }, { label: "stars", hideNs: true, tall: false }), "tukey ns")]);
  const kw = [A, B, C];
  if (!(kruskalWallis(kw).p < 0.05)) throw new Error("kruskal not significant");
  figures.push(["brackets dunn after kruskal-wallis", fig(bracketedBoxPlot(g(kw), { title: "Kruskal-Wallis (3 groups)", ylabel: "value" }, { kind: "dunn", result: dunnTest(kw, "holm"), k: 3, correction: "holm" }, { label: "stars", hideNs: false, tall: false }), "dunn")]);
  const brRender = (w: number): string => fig(bracketedBoxPlot(g([A, B, C, D]), { title: "Tukey HSD (4 groups)", ylabel: "value" }, { kind: "tukey", result: tk }, { label: "stars", hideNs: false, tall: true }, w), "tukey at width");
  figures.push([presetName("nature", "single", "brackets tukey"), need(prepareFigure({ svg: brRender(380), preset: "nature", width: "single", render: brRender }), "nature brackets")]);

  // Multi-panel figures from the tray, as drawn and under styles.
  const panel = (svg: string, render: ((w: number) => string) | undefined, source: string) => ({ svg, render, source });
  const compose = (choice: FigurePresetChoice, width: "single" | "double", cols: number, items: ReturnType<typeof panel>[], what: string): string => {
    const r = composePanelFigure(items, choice, width, cols);
    if (!r.ok) throw new Error(`${what}: ${r.reason}: ${r.problems.join("; ")}`);
    return r.svg;
  };
  // The bracketed panel is a two-group t-test: four groups of Tukey brackets need
  // more height than a half-column cell has, and the tray refuses that by name
  // (insertCapability.test.ts), so it cannot be a corpus figure.
  const ttRender = (w: number): string =>
    fig(bracketedBoxPlot(g([A, B]), { title: "Two-sample t-test", ylabel: "value" }, { kind: "t", result: twoSampleTTest(A, B) }, { label: "stars", hideNs: false, tall: false }, w), "t at width");
  const twoUp = [panel(sinPlot(380), sinPlot, "Plot"), panel(ttRender(380), ttRender, "Statistics")];
  figures.push(["panels as drawn, two across", compose("asdrawn", "single", 2, twoUp, "asdrawn panels")]);
  figures.push([presetName("nature", "double", "panels a b"), compose("nature", "double", 2, twoUp, "nature panels")]);
  figures.push([presetName("cell", "double", "panels A B C"), compose("cell", "double", 3, [...twoUp, panel(okabe("column")(380), okabe("column"), "Table → Chart")], "cell panels")]);
  figures.push([presetName("uspto", "single", "panels FIG. 1A 1B"), compose("uspto", "single", 2, [panel(patent("column")(380), patent("column"), "Table → Chart"), panel(patent("line")(380), patent("line"), "Table → Chart")], "uspto panels")]);

  // The categorical palette's redundant encoding: a marker shape per series.
  const swatch = CATEGORICAL_PALETTE.map((_, i) => {
    const st = seriesStyle(i);
    return seriesMarkerSvg(st, 20, 20 + i * 22, 5) + `<text x="34" y="${24 + i * 22}" font-family="Arial, Helvetica, sans-serif" font-size="11" fill="#111111">series ${i + 1}</text>`;
  }).join("");
  figures.push(["okabe-ito series markers", `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="${CATEGORICAL_PALETTE.length * 22 + 20}"><rect width="160" height="${CATEGORICAL_PALETTE.length * 22 + 20}" fill="#fff"/>${swatch}</svg>`]);
}

// Plot ▸ Plot type. Every figure is the pane's own build (buildPlotKind) — the
// SVG that currentPlotSvg holds and insertFigure sizes from its root — and five
// are also fitted to a journal style through their render(w), as inserted.
{
  const base: PlotKindInput = {
    kind: "parametric", fn: "", fn2: "", xmin: "-10", xmax: "10", tmin: "0", tmax: "2*pi", ymin: "-10", ymax: "10",
    angleUnit: "rad", data: "", title: "", xlabel: "", ylabel: "", y2label: "", zlabel: "", xscale: "linear", yscale: "linear",
    y2scale: "linear", equal: true, levels: "", filled: false, grid: "", az: "-60", el: "30", surfaceStyle: "filled",
  };
  const kindFig = (name: string, o: Partial<PlotKindInput>): ((w: number) => string) => {
    const r = buildPlotKind({ ...base, ...o });
    if (!r.ok) throw new Error(`corpus: ${name}: ${r.error}`);
    figures.push([name, r.svg]);
    return r.render;
  };
  const circle = kindFig("plot kind parametric unit circle, equal scales", { kind: "parametric", fn: "cos(t)", fn2: "sin(t)" });
  kindFig("plot kind parametric lissajous with title and labels", { kind: "parametric", fn: "sin(3*t)", fn2: "sin(2*t)", title: "Lissajous figure 3:2", xlabel: "Horizontal deflection (V)", ylabel: "Vertical deflection (V)" });
  kindFig("plot kind parametric with a gap (sqrt of t² − 1)", { kind: "parametric", fn: "t", fn2: "sqrt(t^2 - 1)", tmin: "-2", tmax: "2", equal: false });
  const rose = kindFig("plot kind polar rose cos 3θ, radians", { kind: "polar", fn: "cos(3*theta)", tmin: "0", tmax: "pi" });
  kindFig("plot kind polar limaçon 1 + 2 cos θ, degrees, negative r", { kind: "polar", fn: "1 + 2*cos(theta)", tmin: "0", tmax: "360", angleUnit: "deg", title: "Limaçon with an inner loop" });
  kindFig("plot kind polar Archimedean spiral r = θ", { kind: "polar", fn: "theta", tmin: "0", tmax: "6*pi" });
  const dual = kindFig("plot kind two y axes, right axis log", {
    kind: "dualy",
    data: "0 21.5 1.2\n10 24.1 3.5\n20 27.9 11\n30 31.2 40\n40 33.8 150\n50 35.0 610",
    title: "Reactor warm-up", xlabel: "Time (min)", ylabel: "Temperature (°C)", y2label: "Pressure (kPa)", y2scale: "log",
  });
  kindFig("plot kind two y axes, missing values, wide numbers", { kind: "dualy", data: "1 120000 0.0012\n2 135000 -\n3 - 0.0031\n4 171000 0.0044", xlabel: "Batch", ylabel: "Count", y2label: "Fraction" });
  const rings = kindFig("plot kind contour x² + y², lines", { kind: "contour", fn: "x^2 + y^2", xmin: "-3", xmax: "3", ymin: "-3", ymax: "3" });
  kindFig("plot kind contour sin x cos y, filled bands", { kind: "contour", fn: "sin(x)*cos(y)", xmin: "-pi", xmax: "pi", ymin: "-pi", ymax: "pi", filled: true, title: "Saddle field", zlabel: "Potential (V)" });
  kindFig("plot kind contour with a hole (sqrt of 4 − x² − y²)", { kind: "contour", fn: "sqrt(4 - x^2 - y^2)", xmin: "-3", xmax: "3", ymin: "-3", ymax: "3", filled: true, levels: "0.5 1 1.5" });
  kindFig("plot kind contour, long thin rectangle, user levels", { kind: "contour", fn: "x*y", xmin: "0", xmax: "100", ymin: "0", ymax: "5", levels: "10 50 100 200 400" });
  const surf = kindFig("plot kind surface sin r, filled, default view", { kind: "surface", fn: "sin(sqrt(x^2 + y^2))", title: "Ripple" });
  kindFig("plot kind surface saddle wireframe, az 30 el 45", { kind: "surface", fn: "x^2 - y^2", xmin: "-2", xmax: "2", ymin: "-2", ymax: "2", az: "30", el: "45", surfaceStyle: "wireframe", grid: "24" });
  kindFig("plot kind surface with labels, az 135", { kind: "surface", fn: "exp(-(x^2 + y^2)/4)", xmin: "-5", xmax: "5", ymin: "-5", ymax: "5", az: "135", el: "20", xlabel: "Position x (mm)", ylabel: "Position y (mm)", zlabel: "Intensity" });
  const pName = (what: string): string => {
    const p = getPreset("nature");
    if (!p) throw new Error("nature");
    return `preset nature ${presetWidthMm(p, "single")} mm ${what}`;
  };
  const styled: [string, (w: number) => string][] = [
    ["plot kind parametric", circle],
    ["plot kind polar", rose],
    ["plot kind two y axes", dual],
    ["plot kind contour", rings],
    ["plot kind surface", surf],
  ];
  for (const [what, render] of styled) {
    const r = prepareFigure({ svg: render(380), preset: "nature", width: "single", render });
    if (!r.ok) throw new Error(`${what}: ${r.reason}: ${r.problems.join("; ")}`);
    figures.push([pName(what), r.svg]);
  }
  // The builders the kinds call, named so the coverage gate sees each module imported for its figure.
  void [parametricPlotSvg, polarPlotSvg, dualAxisPlotSvg, contourPlotSvg, surfacePlotSvg];
}

// --- Release C: circuit transient ---
// The transient calculator at its default (RC charge), then the layouts that crowd: an
// underdamped RLC (three traces overshooting the source), a SIN steady state (a negative
// axis), a repeating pulse into an RLC with a PWL current source (three legend rows, µs
// axis, spikes kept by the min/max decimation), flat DC traces (a degenerate y range),
// six traces at the cap, and a millivolt-scale run on a nanosecond axis.
{
  const tranCases: Record<string, string>[] = [
    {},
    { net: "V1 1 0 PULSE(0 1 0 1n 1n 1 2)\nR1 1 2 10\nL1 2 3 1m\nC1 3 0 1u", stop: "1m" },
    { net: "V1 1 0 SIN(0 1 159.155 0)\nR1 1 2 1k\nC1 2 0 1u", stop: "40m" },
    { net: "V1 in 0 PULSE(0 3.3 0.1u 10n 10n 1u 2u)\nR1 in a 50\nL1 a out 1u\nC1 out 0 1n\nR2 out 0 1k\nI1 0 out PWL(0 0 3u 0 3.1u 5m 6u 5m)", stop: "8u" },
    { net: "V1 1 0 9\nR1 1 2 1k\nR2 2 0 2k\nC1 2 0 1u", stop: "5m" },
    { net: "V1 n0 0 PULSE(0 5 0 1u 1u 10m)\nR1 n0 n1 1k\nC1 n1 0 1u\nR2 n1 n2 1k\nC2 n2 0 1u\nR3 n2 n3 1k\nC3 n3 0 1u\nR4 n3 n4 1k\nC4 n4 0 1u\nR5 n4 n5 1k\nC5 n5 0 1u", stop: "30m" },
    { net: "V1 1 0 PULSE(0 2m 10n 1n 1n 1 2)\nR1 1 2 1k\nC1 2 0 10p", stop: "100n" },
  ];
  const tran = CIRCUIT_CALCS.find((c) => c.id === "circuit-transient");
  if (!tran) throw new Error("corpus: no circuit-transient calculator");
  for (const over of tranCases) {
    const vals: Record<string, string> = { ...Object.fromEntries(tran.fields.map((f) => [f.key, f.default])), ...over };
    const out = tran.compute((k) => vals[k] ?? "");
    const p = (out.blocks ?? []).find((b) => b.kind === "plot");
    if (out.ok === false || !p || p.kind !== "plot") throw new Error(`corpus: circuit-transient ${JSON.stringify(over)} did not draw: ${out.text}`);
    const tag = over.net ? over.net.split("\n")[0] : "defaults";
    figures.push([`circuit-transient ${tag} stop=${over.stop ?? "default"}`, p.svg]);
  }
}
// --- end Release C: circuit transient ---
// --- Release C: hplc ---
// HPLC/GC peak table: the chromatogram reconstructed from the table (Gaussian peaks), as the calculator inserts it:
// the default four-peak run with names at the apices; two nearly co-eluting peaks with long names (numbers + key);
// thirty peaks (label collisions); a peak with no W0.5 drawn as a line; a run in seconds sized from area/(1.0645 W0.5).
{
  const peakCalc = CHROM_CALCS.find((c) => c.id === "chem-peak-table");
  if (!peakCalc) throw new Error("corpus: chem-peak-table missing");
  const chrom = (name: string, data: string | null, tm = "", unit = "min"): void => {
    const f: Record<string, string> = { tm, unit };
    const out = peakCalc.compute((k) => (k === "data" ? (data ?? peakCalc.fields[0].default) : (f[k] ?? "")));
    const plot = (out.blocks ?? []).find((b) => b.kind === "plot");
    if (out.ok === false || !plot || plot.kind !== "plot") throw new Error(`corpus: ${name}: ${out.text}`);
    figures.push([name, plot.svg]);
  };
  chrom("chromatogram default four peaks, names at apices", null, "1.05");
  chrom(
    "chromatogram co-eluting pair, long names (numbers and key)",
    "Name\tRT\tArea\tHeight\tW0.5\n4-Hydroxybenzoic acid methyl ester\t6.10\t120\t800\t0.11\nPropylparaben (related compound)\t6.22\t95\t620\t0.12\nButylparaben\t8.4\t60\t300\t0.15",
  );
  chrom("chromatogram thirty peaks", "Name\tRT\tHeight\tW0.5\n" + Array.from({ length: 30 }, (_, i) => `Compound ${i + 1}\t${(2 + i * 0.25).toFixed(2)}\t${100 + ((i * 37) % 200)}\t0.06`).join("\n"));
  chrom("chromatogram peak without W0.5 drawn as a line", "RT\tHeight\tW0.5\n2.0\t40\t0.05\n3.5\t100\t-\n5.0\t70\t0.08");
  chrom("chromatogram in seconds, heights from areas", "RT\tArea\tW0.5\n125\t5000\t3.1\n188\t12000\t3.9\n241\t800\t4.4", "", "s");
  void chromatogramSvg;
}
// --- end Release C: hplc ---
// --- Release C: cloning (gap #13) --------------------------------------------
// The gel, the two assembly diagrams and the PCR map, drawn through the pane's
// own calculators so the corpus gates exactly what a user inserts. Cases are
// chosen for layout stress: 15 lanes, a ladder whose 500/517 labels collide, a
// band off each end of the ladder, a circular assembly whose closing junction
// sits at the right-hand edge, and the longest primer labels the tools produce.
{
  const clone = (id: string, over: Record<string, string>, name: string): void => {
    const c = CLONING_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: cloning calc ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: cloning ${name} did not draw: ${out.text}`);
    plots.forEach((b, i) => {
      if (b.kind === "plot") figures.push([`cloning ${name}${i ? " " + i : ""}`, b.svg]);
    });
  };
  for (const c of CLONING_CALCS) clone(c.id, {}, `${c.id} defaults`);
  const NL = String.fromCharCode(10);
  clone("cloning-gel", { style: "ethidium", lanes: ["Digest A: 3000, 1500, 850", "Mini 1: 5000, 2000", "Mini 2: 4001, 3800, 700"].join(NL) }, "gel ethidium three lanes");
  clone("cloning-gel", { lanes: ["Big: 20000", "Small: 120", "Mid: 1500"].join(NL) }, "gel bands off both ends of the ladder");
  clone("cloning-gel", { ladder: "neb-100bp", lanes: Array.from({ length: 14 }, (_, i) => `L${i + 1}: ${300 + i * 80}, ${1000 + i * 30}`).join(NL) }, "gel fourteen lanes 100 bp ladder");
  clone("cloning-gel", { ladder: "generuler-1kb", lanes: "Digest: 10000, 3500, 750, 250" }, "gel GeneRuler every band matched");
  clone("cloning-gel", { ladder: "custom", custom: "8000, 4000, 2000, 1000, 500", lanes: "Sample: 2500, 1500" }, "gel custom ladder");
  clone("cloning-gel", { lanes: "Marker check: 2686", seq: PUC19, enzymes: "EcoRI", topology: "circular" }, "gel pUC19 EcoRI circular");
  clone("cloning-gibson", { mode: "tm" }, "gibson overlaps chosen by Tm");
  clone("cloning-pcr-primers", { start: "40", end: "250" }, "pcr primers inside the template");
  // Named so the coverage gate sees every builder's module imported for a figure.
  void [gelSvg, goldenGateSvg, gibsonSvg, primerMapSvg, partsDiagramSvg];
}
// --- Release C: nmr ---
// TLC plate (src/lib/tlcCalcs.ts → tlcChart.ts): the calculator at its defaults (SM / co / rxn, UV-outlined), stained,
// distances on a sized 2.5 × 10 cm plate, 12 lanes whose labels go to two rows, 10 spots in one lane, spots at
// Rf 0.02 and 1.00 (on the origin and front lines), a long eluent wider than the plate, a short wide plate, and the
// builder directly on one lane.
{
  const runTlc = (over: Record<string, string> = {}): string => {
    const c = TLC_CALCS[0];
    const vals: Record<string, string> = { ...Object.fromEntries(c.fields.map((f) => [f.key, f.default])), ...over };
    const out = c.compute((k) => vals[k] ?? "");
    const p = (out.blocks ?? []).find((b) => b.kind === "plot");
    if (out.ok === false || !p || p.kind !== "plot") throw new Error(`corpus: TLC did not draw: ${out.text}`);
    return p.svg;
  };
  const NL = "\n";
  figures.push(["tlc defaults (SM, co, rxn; UV)", runTlc()]);
  figures.push(["tlc stained", runTlc({ style: "stain" })]);
  figures.push(["tlc distances on a 2.5 x 10 cm plate", runTlc({ mode: "distance", lanes: ["SM: 3.2", "co: 3.2, 5.1", "rxn: 5.1"].join(NL), front: "8.0 cm", plate: "2.5 x 10 cm" })]);
  figures.push(["tlc 12 lanes, labels in two rows", runTlc({ lanes: Array.from({ length: 12 }, (_, i) => `fraction ${i + 10}: ${(0.1 + i * 0.07).toFixed(2)}`).join(NL) })]);
  figures.push(["tlc 10 spots in one lane, stained", runTlc({ lanes: ["crude: 0.05, 0.14, 0.22, 0.31, 0.40, 0.52, 0.61, 0.72, 0.85, 0.97", "P: 0.40"].join(NL), style: "stain" })]);
  figures.push(["tlc spots on the origin and the front", runTlc({ lanes: ["A: 0.02", "B: 1.00", "C: 0.02, 1"].join(NL) })]);
  figures.push(["tlc long eluent", runTlc({ eluent: "CH2Cl2/MeOH/NH4OH (aq) 90:9:1, two developments" })]);
  figures.push(["tlc short wide plate", runTlc({ lanes: ["A: 0.5", "B: 0.3", "C: 0.5, 0.3"].join(NL), plate: "10 x 3 cm" })]);
  const one = readTlc({ lanes: "P: 0.45", mode: "rf" });
  if (!one.ok) throw new Error(`corpus: TLC builder: ${one.error}`);
  figures.push(["tlc builder, one lane, no eluent", tlcPlateSvg(one.plate).svg]);
}
// --- end Release C: nmr ---
// --- Release C: lc ---
// Every figure the two LC calculators return, as the pane receives them (the calculator's own compute), at the
// defaults and at stressed inputs: black-and-white style, six cells, measured noisy spectra, a design solution, an
// analyser at an angle; plus the drawings at extreme tilts and angles.
{
  const lcRun = (id: string, over: Record<string, string>): { svg: string; caption: string }[] => {
    const c = LC_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: no ${id}`);
    const vals: Record<string, string> = {};
    for (const f of c.fields) vals[f.key] = f.default;
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    if (out.ok === false) throw new Error(`corpus: ${id}: ${out.text}`);
    return (out.blocks ?? []).flatMap((b) => (b.kind === "plot" ? [{ svg: b.svg, caption: b.caption }] : []));
  };
  const noisy = Array.from({ length: 3000 }, (_, i) => {
    const l = 450 + i * 0.15;
    const tc = Math.sin((2 * Math.PI * 0.21) / (l / 1000) / 2) ** 2;
    const n = Math.sin(i * 12.9898) * 2.5;
    return [l.toFixed(2), (88 * tc + n).toFixed(2), (88 * (1 - tc) - n).toFixed(2)].join("\t");
  }).join("\n");
  const lcCases: [string, string, Record<string, string>][] = [
    ["lc retarder defaults", "optics-lc-retarder", {}],
    ["lc retarder B/W, half-wave, fraction axis", "optics-lc-retarder", { style: "bw", target: "hwp", tunits: "fraction", levels: "π, 0.8π" }],
    ["lc retarder analyser at 30°, three cells", "optics-lc-retarder", { analyser: "angle", anaAngle: "30", cells: ["3 10 45 LC-A", "2.5 35 -45 LC-B", "1 5 45 LC-A"].join("\n") }],
    [
      "lc retarder six cells, wide range",
      "optics-lc-retarder",
      { cells: ["10 0 45 LC-A", "5 24.26 -45 LC-B", "8 10 45 LC-A", "4 30 -45 LC-B", "2 0 45 LC-A", "1 50 -45 LC-B"].join("\n"), lamFrom: "350", lamTo: "1700", points: "2000" },
    ],
    ["lc retarder measured noisy spectra, model overlay", "optics-lc-retarder", { measured: noisy, levels: "0.56π, 0.53π, π/2, 0.47π, 0.44π" }],
    ["lc retarder design mode", "optics-lc-retarder", { mode: "design", cells: ["10 0 45 LC-A", "5 0 -45 LC-B"].join("\n") }],
    ["lc retarder published example, achromatic HWP", "optics-lc-retarder", { preset: "ol-ahwp" }],
    ["lc voltage defaults", "optics-lc-voltage", {}],
    ["lc voltage B/W, zero pretilt, target retardance", "optics-lc-voltage", { style: "bw", pretilt: "0", vTo: "10", vProfile: "4", targetKind: "gamma", targetGamma: "π" }],
  ];
  for (const [name, id, over] of lcCases) lcRun(id, over).forEach((p, i) => figures.push([`${name} ${i + 1}: ${p.caption}`, p.svg]));
  // The builders directly, at edges the calculators reach rarely.
  figures.push(["lc cell drawing, uniform tilt 90°", lcCellSvg({ tiltsDeg: [90], uniformTiltDeg: 90, style: "colour", title: "Cell 1: uniform tilt θ = 90°" })]);
  figures.push([
    "lc cell drawing, profile, B/W, field",
    lcCellSvg({ tiltsDeg: [3, 25, 50, 68, 80, 68, 50, 25, 3], uniformTiltDeg: null, pretiltDeg: 3, voltage: 12.5, style: "bw", title: "Director profile at 12.5 V rms" }),
  ]);
  for (const t of [10, 45, 80]) figures.push([`lc director geometry θ = ${t}°`, lcDirectorSvg({ tiltDeg: t, style: t === 45 ? "bw" : "colour" })]);
  figures.push(["lc device, P 10°, one cell at 0°, A 100°", lcDeviceSvg({ polDeg: 10, cellsOaDeg: [0], anaDeg: 100, style: "colour" })]);
  figures.push(["lc device, six cells, B/W", lcDeviceSvg({ polDeg: 0, cellsOaDeg: [45, -45, 45, -45, 45, -45], anaDeg: 90, style: "bw" })]);
  figures.push(["lc line chart, one series", lcLineChartSvg({ xLabel: "x", yLabel: "y", series: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], colour: "#111111", label: "line" }] })]);
  // Named so the coverage gate sees each builder imported for its figure (the calculators call them above).
  void [lcTransmissionSvg, lcNetRetardanceSvg, lcMeasuredSvg, lcProfilesSvg, lcGammaVoltageSvg, lcMidTiltSvg];
}
// --- end Release C: lc ---
// --- Release D: plots ---
// The plot kinds under the USPTO figure style (37 CFR 1.84(a)(1), black and white), fitted as inserted: prepareFigure
// re-renders each through render(w, preset), which draws black line art (contour values written on their lines,
// holes hatched, hidden-line wireframe, dotted polar grid, dash and marker for the two series).
{
  const base: PlotKindInput = {
    kind: "parametric", fn: "", fn2: "", xmin: "-1", xmax: "1", tmin: "0", tmax: "2*pi", ymin: "-1", ymax: "1",
    angleUnit: "rad", data: "", title: "", xlabel: "", ylabel: "", y2label: "", zlabel: "", xscale: "linear", yscale: "linear",
    y2scale: "linear", equal: true, levels: "", filled: false, grid: "", az: "-60", el: "30", surfaceStyle: "wireframe",
  };
  const uspto: [string, Partial<PlotKindInput>][] = [
    ["parametric figure eight", { kind: "parametric", fn: "cos(t)", fn2: "sin(2*t)" }],
    ["polar rose, radians", { kind: "polar", fn: "cos(3*theta)" }],
    ["polar limaçon, degrees", { kind: "polar", fn: "1+0.5*cos(theta)", angleUnit: "deg", tmax: "360" }],
    ["two y axes", { kind: "dualy", data: "1 2 30\n2 3 20\n3 5 10\n4 6 8\n5 8 5", xlabel: "Time (h)", ylabel: "Mass (g)", y2label: "Rate (g/h)" }],
    ["contour saddle x·y, values on the lines", { kind: "contour", fn: "x*y" }],
    ["contour sin 3x cos 3y, 200 grid", { kind: "contour", fn: "sin(3*x)*cos(3*y)", grid: "200" }],
    ["contour with a hatched hole and a z name", { kind: "contour", fn: "log(x)+y", xmin: "-1", xmax: "2", ymin: "0", ymax: "2", zlabel: "T (K)" }],
    ["surface wireframe sin x cos y", { kind: "surface", fn: "sin(x)*cos(y)", xmin: "-pi", xmax: "pi", ymin: "-pi", ymax: "pi" }],
    ["surface wireframe with a gap", { kind: "surface", fn: "log(x*y)", xmin: "-1", xmax: "2", ymin: "0.1", ymax: "2", grid: "30" }],
  ];
  for (const [what, o] of uspto) {
    const r = buildPlotKind({ ...base, ...o });
    if (!r.ok) throw new Error(`corpus: USPTO ${what}: ${r.error}`);
    const p = prepareFigure({ svg: r.svg, preset: "uspto", width: "single", render: r.render, chartKind: r.chartKind });
    if (!p.ok) throw new Error(`corpus: USPTO ${what}: ${p.reason}: ${p.problems.join("; ")}`);
    figures.push([`preset uspto 170 mm plot kind ${what}`, p.svg]);
  }
}
// --- end Release D: plots ---

// --- Release D: golden gate destination vector -------------------------------
// The Golden Gate diagram when the backbone is a DESTINATION VECTOR: the vector
// body is one more box in the row, in its own tint, and the footer names the
// dropout that left and the two overhangs. Layout stress: a 2.7 kb vector box
// next to 80 bp parts (the minimum-width floor), the longest footer the tool
// writes (it has to wrap), one part (the vector box takes nearly the whole row)
// and six parts (junction labels step to two rows).
{
  const ggd = (parts: string[], backbone: string, enzyme: string, name: string): void => {
    const c = CLONING_CALCS.find((x) => x.id === "cloning-golden-gate");
    if (!c) throw new Error("corpus: cloning-golden-gate missing");
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    vals.parts = parts.join(String.fromCharCode(10));
    vals.backbone = backbone;
    vals.enzyme = enzyme;
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: ${name} did not draw: ${out.text}`);
    plots.forEach((b) => {
      if (b.kind === "plot") figures.push([`cloning ${name}`, b.svg]);
    });
  };
  // Built the way the oracle and cloningD.test.ts build it: pUC19 (L09137.2)
  // with its one native BsaI site domesticated, then a cassette of
  // [overhang][spacer][inverted site][stuffer][site][spacer][overhang] in lacZα.
  const rcDna = (s: string): string =>
    s
      .split("")
      .reverse()
      .map((ch) => ({ A: "T", T: "A", G: "C", C: "G" })[ch] ?? "N")
      .join("");
  const pucBsaIFree = PUC19.slice(0, 1770) + "G" + PUC19.slice(1771);
  const pucIisFree = (() => {
    const b = pucBsaIFree.split("");
    b[1] = "A";
    b[55] = "A";
    b[1770] = "A";
    return b.join("");
  })();
  const stuffer =
    "CATGATTACGGATTCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCGTTACCCAACTTAATC" +
    "GCCTTGCAGCACATCCCCCTTTCGCCAGCTGGCGTAATAGCGAAGAGGCCCGCACCGATCGCCCTTCCCAACAG";
  const destV = (scaffold: string, site: string, ov5: string, ov3: string): string =>
    scaffold.slice(0, 400) + ov5 + "A" + rcDna(site) + stuffer + site + "A" + ov3 + scaffold.slice(400);
  const vBsaI = destV(pucBsaIFree, "GGTCTC", "AATG", "GCTT");
  const vBsmBI = destV(pucIisFree, "CGTCTC", "TTCG", "ATCC");
  const gg1 = "AGCAAAGGCGAAGAACTGTTTACCGGCGTTGTGCCGATTCTGGTGGAACTGGATGGTGATGTGAACGGTCATAAATTTTCT";
  const gg2 = "GTGAGCGGCGAAGGCGAAGGCGATGCGACCTATGGCAAACTGACCCTGAAATTTATTTGCACCACCGGCAAACTGCCGGTG";
  const gg3 = "TTCCGGTGAACAGCTGCCGGTGCCGTGGCCGACCCTGGTGACCACCTTTAGCTATGGCGTGCAGTGCTTTAGCCGCTATCC";
  const gg4 = "CAGGATCATATGAAACAGCATGATTTTTTTAAAAGCGCGATGCCGGAAGGCTATGTGCAGGAACGCACCATTTTTTTTAAA";
  const gg5 = "GATGATGGCAACTATAAAACCCGCGCGGAAGTGAAATTTGAAGGCGATACCCTGGTGAACCGCATTGAACTGAAAGGCATT";
  const gg6 = "ACCTTTAAAGAAGATGGCAACATTCTGGGCCATAAACTGGAATATAACTTTAACAGCCATAACGTGTATATTACCGCGGAT";
  ggd([`insert 1: ${gg1}`, `insert 2: ${gg2}`], `pDEST-lacZalpha: ${vBsaI}`, "BsaI", "golden gate destination vector, two parts");
  ggd([`cds: ${gg1}`], `pDEST-ccdB: ${vBsmBI}`, "BsmBI", "golden gate destination vector, one part, BsmBI");
  ggd(
    [`p1: ${gg1}`, `p2: ${gg2}`, `p3: ${gg3}`, `p4: ${gg4}`, `p5: ${gg5}`, `p6: ${gg6}`],
    `pDEST-lacZalpha: ${vBsaI}`,
    "BsaI",
    "golden gate destination vector, six parts",
  );
}
// --- end Release D: golden gate destination vector ---------------------------

// --- Release E: thermal ---
// The four thermal-stress tools through their real compute paths (every builder in thermalStressCharts.ts): the
// restrained stress with its yield line (heating, cooling biaxial), the gap kink, the ΔT = 0 range note; the bimetal
// κ–ΔT line and its through-thickness stress profile; Stoney; and the thermal-shock crossing.
{
  const th = (id: string, over: Record<string, string>, name: string): void => {
    const c = THERMAL_STRESS_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: thermal ${name} did not draw: ${out.text}`);
    plots.forEach((b, i) => {
      if (b.kind === "plot") figures.push([`thermal ${name}${plots.length > 1 ? ` ${i + 1}` : ""}`, b.svg]);
    });
  };
  th("thermal-restrained", {}, "restrained bar with yield line");
  th("thermal-restrained", { mode: "biaxial", dT: "-180 °F" }, "restrained plate cooled, tension past yield");
  th("thermal-restrained", { restraint: "gap" }, "restrained bar with a gap");
  th("thermal-restrained", { dT: "0", sy: "" }, "restrained bar at zero ΔT");
  th("thermal-bilayer", {}, "bimetal Al on steel");
  th("thermal-stoney", {}, "Stoney film stress");
  th("thermal-shock", {}, "thermal shock crossing");
  // The crowding case for the profile: the thinnest layer it is drawn for (10% of the total; below that the tool
  // leaves the profile out), a 100 µm layer on 900 µm, cooled, so the thin layer's segment sits at the top frame.
  const film = timoshenkoBilayer({ t1: 100e-6, t2: 900e-6, E1: 400e9, E2: 130e9, dAlpha: 3e-6, dT: -300, length: null });
  if (!film.ok) throw new Error(`corpus: thermal thin layer: ${film.error}`);
  figures.push(["thermal bimetal profile, 100 µm layer on 900 µm", bilayerStressProfileSvg(film, 100e-6, 900e-6)]);
}
// --- end Release E: thermal ---

// --- Release E: flow ---
// Each compressible-flow calculator at its defaults, then the layouts that crowd: a strong shock (log axis to M 15),
// a barely supersonic one, a Mach wave (θ = 0), θ at θmax (one solution), a non-standard M₁ among the standard
// curves, γ = 5/3, an expansion near νmax (axis out to M 50), a very low subsonic Fanno inlet (tall left branch), a
// supersonic Fanno duct, Rayleigh cooling and a near-choked supersonic heating.
{
  const gd = (id: string, over: Record<string, string>, name: string): void => {
    const c = GAS_DYNAMICS_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: ${name} did not draw: ${out.text}`);
    plots.forEach((b) => {
      if (b.kind === "plot") figures.push([`gas dynamics ${name}`, b.svg]);
    });
  };
  gd("gd-normal-shock", {}, "normal shock defaults");
  gd("gd-normal-shock", { M1: "10", p1: "", T1: "" }, "normal shock M1 10 ratios only");
  gd("gd-normal-shock", { M1: "1.05", gamma: "1.6667" }, "normal shock M1 1.05 monatomic");
  gd("gd-oblique-pm", {}, "oblique defaults");
  gd("gd-oblique-pm", { theta: "0" }, "oblique Mach wave");
  gd("gd-oblique-pm", { theta: "22.9735" }, "oblique at theta max");
  gd("gd-oblique-pm", { M1: "7", theta: "30" }, "oblique M1 7");
  gd("gd-oblique-pm", { M1: "1.2", theta: "3", gamma: "1.3" }, "oblique M1 1.2 gamma 1.3");
  gd("gd-oblique-pm", { mode: "expansion", theta: "" }, "Prandtl-Meyer nu only");
  gd("gd-oblique-pm", { mode: "expansion", theta: "20" }, "Prandtl-Meyer turn 20");
  gd("gd-oblique-pm", { mode: "expansion", theta: "80" }, "Prandtl-Meyer large turn");
  gd("gd-fanno", {}, "Fanno defaults");
  gd("gd-fanno", { M1: "0.05", L: "100", D: "0.1", f: "0.003" }, "Fanno low inlet Mach");
  gd("gd-fanno", { M1: "3", L: "0.5", conv: "darcy", f: "0.02" }, "Fanno supersonic Darcy");
  gd("gd-fanno", { L: "" }, "Fanno state only");
  gd("gd-rayleigh", {}, "Rayleigh defaults");
  gd("gd-rayleigh", { M1: "0.1", ratio: "0.5" }, "Rayleigh subsonic cooling");
  gd("gd-rayleigh", { M1: "4", ratio: "1.6" }, "Rayleigh supersonic heating");
  gd("gd-rayleigh", { heat: "q", q: "200 kJ/kg", T1: "600 K" }, "Rayleigh heat q");
  figures.push(["gas dynamics theta-beta-M chart, no solution", thetaBetaSvg(3, 1.4, null).svg]);
  figures.push(["gas dynamics Prandtl-Meyer, no turn, M1 1", prandtlMeyerSvg(1, null, 1.4).svg]);
  figures.push(["gas dynamics Fanno, one mark", fannoSvg(1.3, [{ M: 0.3, label: "inlet M₁ = 0.3" }]).svg]);
  figures.push(["gas dynamics Rayleigh, one mark", rayleighSvg(1.3, [{ M: 2.5, label: "inlet M₁ = 2.5" }]).svg]);
  figures.push(["gas dynamics normal shock, M1 40", normalShockSvg(40, 1.4).svg]);
}
// --- end Release E: flow ---

// --- Release E: vessels ---
// Every plot of every VESSELS_CALCS tool (thin vessel bar chart, Lamé and shrink-fit and rotating-disk stress
// profiles, the combined-loading Mohr's circle, the Hertz pressure and subsurface-shear figures) at its shipped
// defaults, plus the layouts that change a figure's shape: a sphere (three bars), open ends (no σz line), external
// pressure only, a hollow shaft in a dissimilar hub (σθ jumps in both directions), a hollow disk, the neutral axis
// governing (V given), a compressed beam-column, dissimilar Hertz bodies (two shear curves) and a ν = 0 cylinder
// (the peak at the surface).
{
  const variants: Record<string, Record<string, string>[]> = {
    "vessel-thin-wall": [{}, { shape: "sphere" }],
    "vessel-lame": [{}, { ends: "open" }, { pi: "0", po: "50" }],
    "vessel-shrink-fit": [{}, { a: "10", b: "25", c: "50", delta: "0.01", Es: "70", nus: "0.33" }],
    "vessel-rotating-disk": [{}, { a: "50" }],
    "combined-loading": [{}, { V: "40 kN" }, { P: "-10 kN", L: "1" }, { T: "0" }, { section: "rect", T: "0" }, { P: "0", M: "0", T: "0" }],
    "hertz-contact": [{}, { geom: "sphere-sphere", R2: "20", E2: "70", nu2: "0.33" }, { geom: "cyl-flat", nu1: "0", nu2: "0.3", F: "1000" }],
  };
  for (const c of VESSELS_CALCS) {
    (variants[c.id] ?? [{}]).forEach((over, vi) => {
      const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
      Object.assign(vals, over);
      const out = c.compute((k) => vals[k] ?? "");
      const svgs = (out.blocks ?? []).filter((b) => b.kind === "plot").map((b) => (b as { svg: string }).svg);
      if (out.ok === false || !svgs.length) throw new Error(`corpus: vessels ${c.id} did not draw: ${out.text}`);
      svgs.forEach((s, i) => figures.push([`vessels ${c.id} v${vi} ${Object.keys(over).join("+") || "default"} #${i + 1}`, s]));
    });
  }
  // Mohr's circle label placement (moved outside the circle in Release E): shear-free states, where the applied
  // points sit on the σ axis beside the σ₁ / σ₂ labels, and a nearly shear-free one.
  const mohrOf = (sx: number, sy: number, txy: number): string => {
    const c = (sx + sy) / 2;
    const r = Math.hypot((sx - sy) / 2, txy);
    return mohrCircleSvg({ sigmaX: sx, sigmaY: sy, tauXY: txy, sigma1: c + r, sigma2: c - r, centre: c, radius: r, unit: "MPa" });
  };
  figures.push(["vessels mohr uniaxial 100, 0, 0", mohrOf(100, 0, 0)]);
  figures.push(["vessels mohr biaxial 100, 60, 0", mohrOf(100, 60, 0)]);
  figures.push(["vessels mohr small shear 100, 60, 2", mohrOf(100, 60, 2)]);
}
// --- end Release E: vessels ---

// --- Release E: vibration ---------------------------------------------------
// Each calculator through its own compute() (the figure the pane inserts) at its defaults and at layout stress: a
// ten-breakpoint profile with a high-Q item near its upper edge, a profile alone, an isolator run near resonance and
// far above it, a shaft with no masses (three modes on the ladder) and one with twelve close masses in inches
// (stepped labels, long ladder). Plus the three builders called directly at their edges.
{
  const vib = (id: string, over: Record<string, string>, name: string): void => {
    const c = RANDOM_VIBRATION_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: ${name} did not draw: ${out.text}`);
    plots.forEach((b, i) => {
      if (b.kind === "plot") figures.push([`vibration ${name}${plots.length > 1 ? ` ${i + 1}` : ""}`, b.svg]);
    });
  };
  const NL = String.fromCharCode(10);
  vib("vib-random-psd", {}, "random PSD NAVMAT with Miles at 100 Hz");
  vib("vib-random-psd", { fn: "" }, "random PSD profile alone");
  vib(
    "vib-random-psd",
    { psd: ["10 0.002", "15 0.01", "40 0.01", "60 0.05", "100 0.05", "150 0.2", "300 0.2", "500 0.08", "1000 0.08", "2000 0.005"].join(NL), fn: "1800", dkind: "q", damp: "50" },
    "random PSD ten breakpoints, Q 50 near the top",
  );
  vib("vib-base-excitation", {}, "base excitation isolating r 4");
  vib("vib-base-excitation", { fn: "98", f: "100", damp: "0.02" }, "base excitation near resonance");
  vib("vib-base-excitation", { fn: "10", f: "400", ikind: "disp", amp: "0.5 mm" }, "base excitation r 40 displacement input");
  vib("vib-base-excitation", { fn: "200", f: "30", dkind: "q", damp: "3" }, "base excitation r 0.15 low Q");
  vib("vib-shaft-critical", {}, "shaft uniform plus central mass");
  vib("vib-shaft-critical", { masses: "", op: "12000 rpm" }, "shaft uniform three modes");
  vib(
    "vib-shaft-critical",
    {
      rho: "",
      L: "48 in",
      d: "2 in",
      munit: "lb",
      xunit: "in",
      masses: Array.from({ length: 12 }, (_, i) => `${10 + i * 3} ${4 + i * 3.6}`).join(NL),
      op: "1800 rpm",
    },
    "shaft twelve close masses in inches",
  );
  const prof = psdProfile([[20, 0.01], [2000, 0.01]]);
  if (!prof.ok) throw new Error("corpus: flat profile refused");
  figures.push(["vibration PSD builder flat white profile with low fn", psdChartSvg(prof, { fn: 21, zeta: 0.01, grms: 4.43 })]);
  figures.push(["vibration transmissibility builder heavy damping r 0.002", transmissibilityChartSvg(0.7, 0.002)]);
  figures.push([
    "vibration shaft builder no operating speed, long labels",
    shaftCriticalSvg(
      2.5,
      Array.from({ length: 61 }, (_, k) => [(2.5 * k) / 60, Math.sin((Math.PI * k) / 60)] as [number, number]),
      [{ x: 0.2, label: "impeller 120 kg" }, { x: 2.3, label: "coupling hub 45 kg" }],
      [
        { label: "Shaft alone, mode 1", rpm: 41250 },
        { label: "Masses (Rayleigh)", rpm: 980 },
        { label: "Dunkerley (shaft + masses)", rpm: 975 },
      ],
      null,
    ),
  ]);
}
// --- end Release E: vibration ---

// --- Release E: kalman ---
// Every plot of every KALMAN_CALCS tool at its defaults, plus the shapes that change a figure: one state (random
// walk), three states (three panels, two measurements), four states (one ratio panel with coinciding curves merged),
// huge magnitudes (log axis, ×10ⁿ legends), two measured channels (stacked run and innovation panels), missing
// measurements, and the triad at identity (coincident axes), gimbal lock, a 180° yaw, and a body axis pointing at the
// viewer (zero-length projection).
{
  const variants: Record<string, Record<string, string>[]> = {
    "kalman-steady": [
      {},
      { model: "rw", q: "0.01", r: "1" },
      { model: "matrix", F: "1 0.1 0\n0 1 0\n0 0 0.9", H: "1 0 0\n0 0 1", Q: "0.01 0 0\n0 0.1 0\n0 0 0.05", R: "0.2 0.05\n0.05 0.3" },
      { model: "matrix", F: "1 0.1 0 0\n0 1 0 0\n0 0 1 0.1\n0 0 0 1", H: "1 0 0 0\n0 0 1 0", Q: "0.0003 0.005 0 0\n0.005 0.1 0 0\n0 0 0.0003 0.005\n0 0 0.005 0.1", R: "0.25 0\n0 0.25", p0: "100" },
      { model: "cv", q: "1e12", r: "1e10" },
    ],
    "kalman-run": [
      {},
      { model: "matrix", F: "1 0.1 0\n0 1 0\n0 0 0.9", H: "1 0 0\n0 0 1", Q: "0.01 0 0\n0 0.1 0\n0 0 0.05", R: "0.2 0.05\n0.05 0.3", data: "1 0.5\n1.2 0.4\n1.1 0.6\n1.5 0.2\n1.6 0.1\n1.9 0.3", p0: "1" },
      { data: "0.60, 1.53, 1.62, NA, NA, 2.14, 1.99, 2.62, 2.75, 2.63, 3.66, 3.37" },
    ],
    "attitude-convert": [
      {},
      { formA: "quat", quatA: "0, 0, 0, 1" },
      { a1: "30", a2: "90", a3: "10" },
      { a1: "180", a2: "0", a3: "0" },
      { formA: "axis", axisA: "0, -1, 1", angleA: "26.565" },
      { op: "compose" },
      { op: "slerp", formA: "quat", quatA: "0, 0, 0, 1", formB: "euler", seqB: "ZYX", b1: "90", b2: "0", b3: "0", t: "0.5" },
    ],
  };
  for (const c of KALMAN_CALCS) {
    (variants[c.id] ?? [{}]).forEach((over, vi) => {
      const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
      Object.assign(vals, over);
      const out = c.compute((k) => vals[k] ?? "");
      const svgs = (out.blocks ?? []).filter((b) => b.kind === "plot").map((b) => (b as { svg: string }).svg);
      if (out.ok === false || !svgs.length) throw new Error(`corpus: kalman ${c.id} did not draw: ${out.text}`);
      svgs.forEach((s, i) => figures.push([`kalman ${c.id} v${vi} ${Object.keys(over).join("+") || "default"} #${i + 1}`, s]));
    });
  }
  // The triad straight from its builder: a pure roll.
  figures.push(["kalman triad, a 19.5° roll", attitudeTriadSvg([[1, 0, 0], [0, 0.9428, -0.3333], [0, 0.3333, 0.9428]]).svg]);
}
// --- end Release E: kalman ---
// --- Release E: circuit ---
// The transient calculator with the Release E elements (no new builder; CIRCUIT_CALCS is
// imported in the Release C block): a k 0.999 transformer driven by a 1 kHz sine (primary
// and secondary on one axis, the start-up offset visible), and an RC charge buffered by a
// VCVS of gain 2 (the buffer output above its input, three traces).
{
  const tran = CIRCUIT_CALCS.find((c) => c.id === "circuit-transient");
  if (!tran) throw new Error("corpus: no circuit-transient calculator");
  const relECases: Record<string, string>[] = [
    { net: "V1 1 0 SIN(0 1 1k)\nRs 1 3 1\nL1 3 0 1m\nL2 2 0 4m\nK1 L1 L2 0.999\nRL 2 0 1k", stop: "5m", step: "1u", nodes: "3 2" },
    { net: "V1 1 0 PULSE(0 1 0 1n 1n 1 2)\nR1 1 2 1k\nC1 2 0 1u\nE1 3 0 2 0 2\nRL 3 0 1k", stop: "5m" },
  ];
  for (const over of relECases) {
    const vals: Record<string, string> = { ...Object.fromEntries(tran.fields.map((f) => [f.key, f.default])), ...over };
    const out = tran.compute((k) => vals[k] ?? "");
    const p = (out.blocks ?? []).find((b) => b.kind === "plot");
    if (out.ok === false || !p || p.kind !== "plot") throw new Error(`corpus: circuit-transient ${JSON.stringify(over)} did not draw: ${out.text}`);
    figures.push([`circuit-transient Release E ${over.net.split("\n").find((l) => /^[EK]/.test(l))}`, p.svg]);
  }
}
// --- end Release E: circuit ---

// --- Release E: quantum gates ---------------------------------------------
// Each tool through its own compute() at its defaults and at layout stress: a long single-qubit sequence (long path),
// a ten-qubit circuit that folds into bands with a 1024-outcome bar chart, every multi-qubit gate kind, a 3-qubit
// Grover with two iterations, Deutsch-Jozsa on 3 qubits. Plus the three builders called directly at their edges.
{
  const qc = (id: string, over: Record<string, string>, name: string): void => {
    const c = QUANTUM_GATES_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: ${name} did not draw: ${out.text}`);
    plots.forEach((b, i) => {
      if (b.kind === "plot") figures.push([`quantum ${name}${plots.length > 1 ? ` ${i + 1}` : ""}`, b.svg]);
    });
  };
  const NL = String.fromCharCode(10);
  qc("qc-single-qubit", {}, "single-qubit H T");
  qc("qc-single-qubit", { gates: "Rx(60) Rz(90)" }, "single-qubit Rx Rz case row");
  qc("qc-single-qubit", { start: "bloch", theta: "150", phi: "-120", gates: "Rx(pi/3) Ry(-70) Rz(200) H U(30, 60, 90) √X T†" }, "single-qubit long path to the back");
  qc("qc-circuit", {}, "circuit GHZ measured");
  qc(
    "qc-circuit",
    { n: "10", circuit: [...Array.from({ length: 10 }, (_, q) => `H ${q}`), ...Array.from({ length: 9 }, (_, q) => `CNOT ${q} ${q + 1}`), "CU(Rz(pi/4)) 0 9", "CCX 2 5 8", "CSWAP 1 4 7", "iSWAP 3 6", "SWAP 0 9", "RY(30) 5", "MEASURE 0", "CX 0 9"].join(NL) },
    "circuit ten qubits folded",
  );
  qc("qc-circuit", { n: "4", circuit: ["H 0", "CY 0 1", "CH 1 2", "CS 2 3", "CRZ(45) 0 3", "CP(pi/8) 1 3", "iSWAP 1 2", "CCZ 0 1 2", "CU(U(90, 0, 180)) 3 0", "MEASURE 0 1"].join(NL) }, "circuit every gate kind");
  qc("qc-interference", {}, "Mach-Zehnder 60 degrees");
  qc("qc-interference", { setup: "hzh" }, "H Z H");
  qc("qc-bell", {}, "Bell all four");
  qc("qc-bell", { which: "11" }, "Bell from 11");
  qc("qc-teleport", {}, "teleportation");
  qc("qc-superdense", {}, "superdense all");
  qc("qc-deutsch-jozsa", { n: "3", oracle: "table", table: "0 1 1 0 1 0 0 1" }, "Deutsch-Jozsa 3 qubits");
  qc("qc-grover", { n: "3", marked: "101" }, "Grover 3 qubits");
  qc("qc-qft", { n: "3", input: "110" }, "QFT 3 qubits");
  figures.push(["quantum Bloch builder state at the pole, no path", blochSphereSvg({ start: [0, 0, 1], end: [0, 0, 1], path: [], startLabel: "start", endLabel: "final: (0, 0, 1)" })]);
  figures.push(["quantum Bloch builder pointing at the viewer", blochSphereSvg({ start: [0, 0, -1], end: [0.81, 0.38, 0.45], path: [], startLabel: "start: (0, 0, −1)", endLabel: "final: (0.81, 0.38, 0.45)" })]);
  const pc = qParseCircuit(["H 0", "CNOT 0 1", "MEASURE 1", "CZ 1 0"].join(NL), 2);
  if ("error" in pc) throw new Error(pc.error);
  figures.push(["quantum circuit builder classical control", circuitDiagramPages({ n: 2, ops: pc.ops })[0]]);
  figures.push(["quantum bars builder 2 qubits Grover", probabilityBarsSvg(qGrover(2, 2, 1).final.map((z) => z.re * z.re + z.im * z.im), 2)]);
}
// --- end Release E: quantum gates ---

// --- Release E: laser ---
// Each laser calculator at its defaults and at the variants that change a figure's layout (unequal mirrors, a
// low-finesse etalon, a sub-threshold pump, a Gaussian line from a wavelength width with Schawlow–Townes, an
// off-axis bulk SHG crystal, Δk = 0), then each builder directly at extreme scales.
{
  const variants: Record<string, Record<string, string>[]> = {
    "laser-fabry-perot": [{}, { R2: "0.95" }, { L: "5 mm", n: "1.5", R1: "0.3", R2: "0.3", lam: "1550 nm" }, { L: "2 µm", R1: "0.999", R2: "0.999" }],
    "laser-threshold": [{}, { pp: "1 W" }, { pp: "" }, { L: "1 mm", ai: "5 cm^-1", R1: "0.3", R2: "0.95", lp: "940 nm", lam: "1030 nm", etai: "80 %", pth: "300 mW", pp: "2 W" }],
    "laser-coherence": [{}, { shape: "gaussian" }, { shape: "gaussian", dnu: "0.01 nm", lam: "1550 nm", dnuc: "4.8 MHz" }, { dnu: "10 kHz" }],
    "laser-shg": [{}, { mode: "none", deff: "14 pm/V", I: "1e9" }, { mode: "qpm", per: "6.9 µm", L: "1 mm" }, { nw: "2.2", n2w: "2.2", mode: "perfect", L: "" }],
  };
  for (const c of LASER_CALCS) {
    (variants[c.id] ?? [{}]).forEach((over, vi) => {
      const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
      Object.assign(vals, over);
      const out = c.compute((k) => vals[k] ?? "");
      const svgs = (out.blocks ?? []).filter((b) => b.kind === "plot").map((b) => (b as { svg: string }).svg);
      if (out.ok === false || !svgs.length) throw new Error(`corpus: laser ${c.id} did not draw: ${out.text}`);
      svgs.forEach((s, i) => figures.push([`laser ${c.id} v${vi} ${Object.keys(over).join("+") || "default"} #${i + 1}`, s]));
    });
  }
  const fp = fabryPerot({ L: 0.25, n: 1, R1: 0.9999, R2: 0.98, lambda: null });
  if (fp.ok) {
    figures.push(["laser fpAiryChartSvg, F ≈ 300 unequal", fpAiryChartSvg(0.9999, 0.98, fp)]);
    figures.push(["laser fpPeakChartSvg, F ≈ 300 unequal", fpPeakChartSvg(0.9999, 0.98, fp)]);
  }
  figures.push(["laser thresholdChartSvg, µW scale", thresholdChartSvg(0.05, 2e-3, 5e-3)]);
  figures.push(["laser coherenceChartSvg, 1 GHz Gaussian", coherenceChartSvg("gaussian", 1e9)]);
  figures.push(["laser shgGrowthChartSvg, 20 µm coherence length", shgGrowthChartSvg(Math.PI / 20e-6, 20e-6)]);
  figures.push(["laser shgSincChartSvg, operating point near the first zero", shgSincChartSvg(2 * 3.0 / 0.01, 0.01)]);
}
// --- end Release E: laser ---

// --- Release E: link budget ---
// Each calculator through its own compute() at its defaults and at layout stress: a short 5.8 GHz link with no
// sensitivity (no line, no range point), a long link that does not close (range point left of the design point), a
// fourteen-stage chain with lossy stages (stepped stage ticks, NF to 25 dB), a one-stage chain, every modulation, the
// required-Eb/N0 mode with its target line, and a point far below the axis (named in a note). Plus the three builders
// called directly at their edges.
{
  const lb = (id: string, over: Record<string, string>, name: string): void => {
    const c = LINK_BUDGET_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: ${name} did not draw: ${out.text}`);
    plots.forEach((b) => {
      if (b.kind === "plot") figures.push([`link budget ${name}`, b.svg]);
    });
  };
  const NL = String.fromCharCode(10);
  lb("rf-link-budget", {}, "Friis 2.4 GHz 1 km with sensitivity");
  lb("rf-link-budget", { f: "5.8 GHz", d: "50 m", sens: "", lother: "3" }, "Friis 5.8 GHz 50 m no sensitivity");
  lb("rf-link-budget", { d: "100 km", sens: "-80 dBm" }, "Friis link that does not close");
  lb("noise-figure-cascade", {}, "cascade three stages");
  lb(
    "noise-figure-cascade",
    { stages: ["-0.5 0.5", "18 0.9", "-3 3", "-6 6", "25 4", "10 8", "-8 8", "30 12", "12 10", "-2 2", "20 15", "15 18", "40 20", "6 25"].join(NL), snr: "" },
    "cascade fourteen stages with losses",
  );
  lb("noise-figure-cascade", { stages: "15 0.6" }, "cascade one stage");
  lb("ber-ebn0", {}, "BER BPSK 9.6 dB");
  lb("ber-ebn0", { mod: "dbpsk", mode: "cn0", cn0: "68", rate: "64 kbps" }, "BER DBPSK point below the axis");
  lb("ber-ebn0", { mod: "8psk", mode: "target", target: "1e-6" }, "BER 8-PSK required for 1e-6");
  lb("ber-ebn0", { mod: "16psk", ebn0: "16" }, "BER 16-PSK 16 dB");
  lb("ber-ebn0", { mod: "qpsk", mode: "target", target: "1e-15" }, "BER QPSK target 1e-15");
  figures.push([
    "link budget range builder, no sensitivity, 60 GHz 10 m",
    linkRangeSvg({ ptDbm: 10, gtDbi: 20, grDbi: 20, fHz: 60e9, dM: 10, txLossDb: 0, rxLossDb: 0, otherLossDb: 0, sensDbm: null }, -38.0, null),
  ]);
  figures.push(["link budget BER builder, DBPSK, no point", berWaterfallSvg("dbpsk", null, null)]);
  figures.push(["link budget cascade builder, 50 stages", cascadeNfSvg(Array.from({ length: 50 }, (_, i) => ({ n: i + 1, gainDb: 10, nfDb: 3 + (i % 7), teK: 290, cumGainDb: 10 * (i + 1), cumNfDb: 3.2, term: 0 })))]);
}
// --- end Release E: link budget ---

// --- Release E: linear optics ---
// Each linear-optics tool through its own compute() at its defaults and at layout stress: unbalanced splitters with a
// negative phase, a partially distinguishable dip in ps with the delay on the flank, a delay far outside the dip, the
// tritter, 2+1+1 photons in a 4-mode multiport (rotated labels), 3 photons in 6 modes (56 patterns, the top 16 drawn),
// one gate only with lossy transmission. Then the pattern-bar builder directly: no distinguishable bars, many bars.
{
  const lo = (id: string, over: Record<string, string>, name: string): void => {
    const c = LINEAR_OPTICS_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: linear optics ${name} did not draw: ${out.text}`);
    plots.forEach((b, i) => {
      if (b.kind === "plot") figures.push([`linear optics ${name}${plots.length > 1 ? ` ${i + 1}` : ""}`, b.svg]);
    });
  };
  lo("lo-mach-zehnder", {}, "Mach-Zehnder 60 degrees");
  lo("lo-mach-zehnder", { R1: "0.3", R2: "0.6", phi: "-40", power: "1 mW" }, "Mach-Zehnder unbalanced, negative phase");
  lo("lo-hom", {}, "HOM dip default");
  lo("lo-hom", { R: "0.3", M0: "0.8", width: "2 ps", delay: "-1.5 ps" }, "HOM dip partial, on the flank");
  lo("lo-hom", { width: "1 ps", delay: "50 ps" }, "HOM dip delay off the plot");
  lo("lo-multiphoton", {}, "tritter 111");
  lo("lo-multiphoton", { net: "dft", m: "4", input: "2, 1, 1, 0" }, "4-mode multiport 2110");
  lo("lo-multiphoton", { net: "dft", m: "6", input: "1, 1, 1, 0, 0, 0" }, "6-mode multiport top 16");
  lo("lo-dual-rail-gates", {}, "CZ success both gates");
  lo("lo-dual-rail-gates", { gate: "klm", trans: "0.7" }, "CZ success KLM lossy");
  figures.push(["linear optics fockBarsSvg no distinguishable bars", fockBarsSvg([{ t: [2, 0], p: 0.5 }, { t: [1, 1], p: 0 }, { t: [0, 2], p: 0.5 }])]);
  figures.push([
    "linear optics fockBarsSvg 40 patterns",
    fockBarsSvg(Array.from({ length: 40 }, (_, i) => ({ t: [i % 5, 3, (i * 7) % 4, 1], p: (i % 7) / 100, pDist: (i % 3) / 80 })), { title: "Input |1,1,1,1,0⟩" }),
  ]);
}
// --- end Release E: linear optics ---

// --- Release E: semiconductor ---
// The pn junction (C–V and the semilog forward I–V), the MOSFET output family and the Fermi level against doping,
// each through its calculator at the defaults and at layout stress: the brief's case junction at 5 V, a GaAs p⁺n with
// a reverse diode point (note under the I–V), a one-sided junction to 40 V with fA saturation current, the triode
// point with λ, cutoff (note), a power device (mA scale, 20 V), a weak device (µA scale), a p-type and a
// custom-material intrinsic sample. Plus the four builders called directly at their edges.
{
  const sc = (id: string, over: Record<string, string>, name: string): void => {
    const c = SEMICONDUCTOR_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: ${name} did not draw: ${out.text}`);
    plots.forEach((b, i) => {
      if (b.kind === "plot") figures.push([`semiconductor ${name} #${i + 1}`, b.svg]);
    });
  };
  sc("semi-pn-junction", {}, "pn junction Si defaults");
  sc("semi-pn-junction", { ni: "1e10", vr: "5 V" }, "pn junction brief case at 5 V");
  sc("semi-pn-junction", { mat: "gaas", na: "1e17", nd: "1e16", vd: "-1 V" }, "pn junction GaAs reverse diode point");
  sc("semi-pn-junction", { na: "5e17", nd: "1e15", vr: "40 V", is: "2 fA", nid: "1.8", vd: "0.8 V" }, "pn junction one-sided 40 V");
  sc("semi-mosfet-square-law", {}, "MOSFET defaults");
  sc("semi-mosfet-square-law", { lambda: "0.05", vds: "0.4" }, "MOSFET triode with lambda");
  sc("semi-mosfet-square-law", { vgs: "0.3" }, "MOSFET cutoff");
  sc("semi-mosfet-square-law", { mu: "50", wl: "1000", vgs: "12 V", vth: "2 V", vds: "20 V", lambda: "0.01" }, "MOSFET power device");
  sc("semi-mosfet-square-law", { mu: "600", wl: "0.5", vgs: "0.6", vth: "0.45", vds: "0.05", tox: "2 nm" }, "MOSFET weak device");
  sc("semi-carriers", {}, "carriers Si n-type");
  sc("semi-carriers", { nd: "0", na: "1e17" }, "carriers Si p-type");
  sc("semi-carriers", { nd: "0", mat: "custom", ni: "1e10" }, "carriers custom intrinsic");
  sc("semi-carriers", { nd: "1e19" }, "carriers Si within 3kT of the conduction band");
  figures.push(["semiconductor cvChartSvg 1 kV one-sided", cvChartSvg({ na: 1e14, nd: 1e19, epsR: 11.7 }, 0.8, 1000)]);
  figures.push(["semiconductor ivChartSvg near the exponent cap", ivChartSvg(1e-20, 1, 0.025852, 1.15)]);
  figures.push(["semiconductor ivChartSvg 1 mV forward", ivChartSvg(1e-14, 1, 0.025852, 0.001)]);
  figures.push(["semiconductor idVdsFamilySvg nA scale", idVdsFamilySvg(1e-9, 0.4, 0.45, 0.02, 0.1)]);
  figures.push(["semiconductor fermiChartSvg GaAs p-type", fermiChartSvg(2.1e6, 0.025852, -1e15, 4.7e17, 9e18)]);
}
// --- end Release E: semiconductor ---

// --- Release E: quantum dirac ---
// Each Q1/Q3 tool through its own compute() at its defaults and at layout stress (a 4-qubit amplitude chart with
// rotated labels, a qutrit, the 16 × 16 heat map, a 4 × 4 heat map of long complex entries, a 10-qubit X-basis
// measurement capped at 32 bars, the Bell basis, a partial-transpose spectrum with a negative eigenvalue, a product
// state's single Schmidt bar, an interior Bloch vector), then the three builders directly at their edges.
{
  const qd = (id: string, over: Record<string, string>, name: string): void => {
    const c = QUANTUM_DIRAC_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: ${name} did not draw: ${out.text}`);
    plots.forEach((b, i) => {
      if (b.kind === "plot") figures.push([`quantum dirac ${name}${plots.length > 1 ? ` ${i + 1}` : ""}`, b.svg]);
    });
  };
  qd("qc-dirac-states", {}, "states default");
  qd("qc-dirac-states", { psi: "0.5|0000⟩ - 0.5i|0101⟩ + 0.5|1010⟩ + e^(i pi/3)*0.5|1111⟩", phi: "|0000⟩ + |1111⟩" }, "states four qubits");
  qd("qc-dirac-states", { psi: "|0⟩ + i|1⟩ - |2⟩", phi: "|2⟩", dim: "3" }, "states qutrit");
  qd("qc-operators", {}, "operator Hermitian 2x2");
  qd("qc-operators", { A: "(0.6+0.8i)/sqrt(2)*CNOT + 0.25*SWAP" }, "operator 4x4 long entries");
  qd("qc-operators", { A: "X⊗Z⊗H⊗Y + 0.5*(Z⊗Z⊗I⊗I)" }, "operator 16x16");
  qd("qc-measurement", {}, "measurement Z");
  qd("qc-measurement", { state: "|Φ⁺⟩", basis: "bell" }, "measurement Bell");
  qd("qc-measurement", { state: "|0000000000⟩ + |1111111111⟩", basis: "X" }, "measurement ten qubits X capped");
  qd("qc-measurement", { basis: "typed", set: "|+⟩" }, "measurement incomplete set");
  qd("qc-density", {}, "density mixture");
  qd("qc-density", { mode: "matrix", matrix: "0.0625*(I⊗I⊗I⊗I)" }, "density maximally mixed 16");
  qd("qc-bipartite", {}, "bipartite Schmidt");
  qd("qc-bipartite", { state: "|01⟩" }, "bipartite product");
  qd("qc-bipartite", { mode: "werner" }, "bipartite Werner");
  qd("qc-bipartite", { mode: "mixed", matrix: "[[0.5,0,0,0,0,0.5],[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0],[0.5,0,0,0,0,0.5]]", split: "2x3" }, "bipartite 2x3 NPT");
  // Builders at their edges: 64 basis states (32 drawn, the rest noted), an all-zero operator, 32 signed bars.
  const amps = Array.from({ length: 64 }, (_, k) => ({ re: Math.cos(k) / 8, im: Math.sin(k) / 8 }));
  figures.push(["quantum dirac amplitudes 64 states capped", amplitudeChartSvg(Array.from({ length: 64 }, (_, k) => `|${k.toString(2).padStart(6, "0")}⟩`), [{ name: "|ψ⟩", amps }])]);
  figures.push(["quantum dirac heat map zero operator", matrixHeatmapSvg([[{ re: 0, im: 0 }, { re: 0, im: 0 }], [{ re: 0, im: 0 }, { re: 0, im: 0 }]], ["0", "1"], () => "0")]);
  figures.push(["quantum dirac bars 32 signed", quantumBarsSvg({ values: Array.from({ length: 40 }, (_, k) => Math.sin(k) / 4), labels: Array.from({ length: 40 }, (_, k) => `μ${k + 1}`), yTitle: "Eigenvalue", xTitle: "Spectrum", ref: { value: 0.1, label: "0.1" } })]);
}
// --- end Release E: quantum dirac ---

// --- Release E: transmission lines ---
// Each transmission-line tool through its own compute() at its defaults and at layout stress: the Smith chart with a
// load near Γ = 1 (5 kΩ), a short (both points on the rim), an open, a matched load, a 0.01λ line (overlapping labels),
// a half wavelength (Z_L = Z_in), several wavelengths, a capacitive load in degrees, a high-VSWR circle through the
// reactance labels, a near match (points overlap), coax with a physical length and microstrip geometry; both matching
// figures; the S-parameter bars with S12 = 0 and an attenuator. Then the builders directly: the Smith chart with no
// line, and one bar.
{
  const tl = (id: string, over: Record<string, string>, name: string): void => {
    const c = TLINE_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: transmission line ${name} did not draw: ${out.text}`);
    plots.forEach((b, i) => {
      if (b.kind === "plot") figures.push([`transmission line ${name}${plots.length > 1 ? ` ${i + 1}` : ""}`, b.svg]);
    });
  };
  tl("tl-line-termination", {}, "Smith 100+j50 at 0.125 wavelength");
  tl("tl-line-termination", { rl: "5 kΩ", xl: "0", len: "0.08" }, "Smith 5 kohm near the rim");
  tl("tl-line-termination", { term: "short" }, "Smith short");
  tl("tl-line-termination", { term: "open", len: "0.3" }, "Smith open");
  tl("tl-line-termination", { rl: "50", xl: "0" }, "Smith matched");
  tl("tl-line-termination", { len: "0.01" }, "Smith 0.01 wavelength");
  tl("tl-line-termination", { len: "0.5" }, "Smith half wavelength");
  tl("tl-line-termination", { len: "3.725" }, "Smith 3.725 wavelengths");
  tl("tl-line-termination", { rl: "25", xl: "-30", lenMode: "deg", len: "72" }, "Smith capacitive 72 degrees");
  tl("tl-line-termination", { rl: "20", xl: "80", len: "0.3" }, "Smith high VSWR");
  tl("tl-line-termination", { rl: "52", xl: "1", len: "0.2" }, "Smith near match");
  tl("tl-line-termination", { z0mode: "coax", lenMode: "phys", len: "30 cm", freq: "2.4 GHz", vf: "" }, "Smith coax physical length");
  tl("tl-line-termination", { z0mode: "microstrip", er: "4.5", rl: "30", xl: "-60", len: "0.4" }, "Smith microstrip");
  tl("tl-match", {}, "match 100 ohm");
  tl("tl-match", { rl: "60", xl: "-80", stub: "open" }, "match 60-j80 open stubs");
  tl("tl-two-port", {}, "S-parameters amplifier");
  tl("tl-two-port", { s: ["0.61 -170", "2.24 32", "0 0", "0.72 -83"].join(String.fromCharCode(10)) }, "S-parameters unilateral");
  tl("tl-two-port", { fmt: "db", s: ["-30 0", "-3 0", "-3 0", "-30 0"].join(String.fromCharCode(10)) }, "S-parameters attenuator");
  figures.push([
    "transmission line smithChartSvg no line",
    smithChartSvg({ gammaL: { re: 0.4, im: 0.2 }, gammaIn: null, turns: 0, halfWaves: 0, z0: 50, zlText: "100 + j50 Ω", zinText: null, vswr: 2.618 }),
  ]);
  figures.push(["transmission line sParamBarsSvg one bar", sParamBarsSvg([{ sub: "21", db: 12.5, angleDeg: -45, kind: "transmission" }])]);
}
// --- end Release E: transmission lines ---

// --- Release E: AI compute ---
// The roofline (the brief's compute-bound GEMM, a convolution with a measured point, a memory-bound GEMV at PFLOP/s,
// a typed kernel at GFLOP/s), the memory bars (defaults, a GQA model without activations, a 175-billion-parameter
// model at 128k context), the float spacing chart (fp16 at 0.1, a bf16 subnormal over the wide envelope range, an
// overflowing E4M3 value) and the quantisation staircase (int8 symmetric, int4 asymmetric clipped). Plus the four
// builders called directly at their edges.
{
  const ai = (id: string, over: Record<string, string>, name: string): void => {
    const c = AI_COMPUTE_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: ${name} did not draw: ${out.text}`);
    plots.forEach((b, i) => {
      if (b.kind === "plot") figures.push([`AI compute ${name} #${i + 1}`, b.svg]);
    });
  };
  ai("ai-roofline", {}, "roofline GEMM 4096 cubed");
  ai("ai-roofline", { kernel: "conv", meas: "150 TFLOPS" }, "roofline convolution measured");
  ai("ai-roofline", { mnk: "1, 4096, 4096", peak: "5 PFLOP/s", bw: "8 TB/s", elem: "1 B" }, "roofline GEMV memory-bound");
  ai("ai-roofline", { kernel: "typed", ai: "1e-4", peak: "1 GFLOP/s", bw: "1 GB/s" }, "roofline typed GFLOP/s");
  ai("ai-transformer-size", {}, "transformer defaults");
  ai("ai-transformer-size", { kvheads: "8", ffn: "3.5", ffntype: "gated", vocab: "128256", seq: "8192", batch: "8", tied: "untied" }, "transformer GQA gated");
  ai("ai-transformer-size", { d: "12288", layers: "96", heads: "96", seq: "131072" }, "transformer 175B long context");
  ai("ai-number-formats", {}, "formats fp16 0.1");
  ai("ai-number-formats", { fmt: "bf16", x: "1e-39" }, "formats bf16 subnormal wide range");
  ai("ai-number-formats", { fmt: "e4m3fn", x: "465" }, "formats E4M3 overflow");
  ai("ai-number-formats", { fmt: "int8s" }, "formats int8 symmetric");
  ai("ai-number-formats", { fmt: "int4a", x: "5", lo: "0.5", hi: "4" }, "formats int4 asymmetric clipped");
  figures.push(["AI compute rooflineSvg tiny bandwidth", rooflineSvg(1e18, 1e9, [{ intensity: 1e6, perf: 1e15, label: "Kernel, I = 10⁶", color: "#c00000" }])]);
  figures.push(["AI compute memoryBarsSvg one segment", memoryBarsSvg([{ label: "Weights only", segments: [{ name: "Weights", bytes: 1500 }] }], "Memory, tiny model")]);
  figures.push(["AI compute spacingChartSvg no value", spacingChartSvg(null, null)]);
  figures.push(["AI compute quantStairSvg int4 symmetric", quantStairSvg({ scale: 3 / 7, zeroPoint: 0, qmin: -7, qmax: 7, lo: -1.5, hi: 3 }, -2.9)]);
}
// --- end Release E: AI compute ---

// --- Release Q: quantum links ---
// Each quantum-link tool through its own compute(): the free-space link at each preset, a custom range in the capped
// near field and one far beyond the Moon, with extra losses; entanglement distribution at its defaults, with jitter and
// dark counts, at the Earth–Moon preset and with a window near the saturation limit; BB84 single-photon and decoy, μ
// optimised, no dark counts (no cutoff), past the cutoff (no operating point) and at 0 dB. Then the builders directly.
{
  const ql = (id: string, over: Record<string, string>, name: string): void => {
    const c = QUANTUM_LINKS_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: quantum link ${name} did not draw: ${out.text}`);
    plots.forEach((b) => {
      if (b.kind === "plot") figures.push([`quantum link ${name}`, b.svg]);
    });
  };
  ql("qlink-fso", {}, "FSO Earth-Moon 1550 nm");
  ql("qlink-fso", { preset: "leo", lambda: "810 nm" }, "FSO LEO 810 nm");
  ql("qlink-fso", { preset: "geo", point: "3", atm: "1", det: "60 %" }, "FSO GEO with losses");
  ql("qlink-fso", { preset: "custom", range: "100 km", lambda: "810 nm" }, "FSO capped near field");
  ql("qlink-fso", { preset: "custom", range: "1.496e11 m" }, "FSO 1 AU");
  ql("qlink-entanglement", {}, "entanglement defaults");
  ql("qlink-entanglement", { jitter: "300 ps", darkA: "500", darkB: "500" }, "entanglement jitter and darks");
  ql("qlink-entanglement", { preset: "moon" }, "entanglement Earth-Moon");
  ql("qlink-entanglement", { tau: "1 µs" }, "entanglement near saturation");
  ql("qlink-qkd", {}, "BB84 single photon");
  ql("qlink-qkd", { source: "decoy" }, "BB84 decoy");
  ql("qlink-qkd", { source: "decoy", mu: "" }, "BB84 decoy optimised");
  ql("qlink-qkd", { y0: "0" }, "BB84 no dark counts");
  ql("qlink-qkd", { loss: "45" }, "BB84 past the cutoff");
  ql("qlink-qkd", { loss: "0" }, "BB84 at 0 dB");
  const fsoIn = { lambda: 1550e-9, dt: 0.3, dr: 1.0, rangeM: 1e6, pointingDb: 0, atmosDb: 0, opticsDb: 0, detEff: 1, emitRate: null };
  const fsoRes = fsoLink(fsoIn);
  if (!fsoRes.ok) throw new Error("corpus: fso direct refused");
  figures.push(["quantum link fsoLossSvg custom 1000 km", fsoLossSvg(fsoIn, 1e6, fsoRes.lossDb, null)]);
  const entIn = { pairRate: 1e6, etaA: 0.1, etaB: 0.1, detA: 0.5, detB: 0.5, darkA: 100, darkB: 100, tau: 2e-9, jitter: 5e-10 };
  const entRes = entanglement(entIn);
  if (!entRes.ok) throw new Error("corpus: entanglement direct refused");
  figures.push(["quantum link entRatesSvg direct", entRatesSvg(entIn, entRes)]);
  const qIn = { rate: 1e9, lossDb: 10, detEff: 0.8, y0: 1e-5, ed: 0.01, source: "single" as const, mu: null, f: 1.16 };
  const qRes = qkdLink(qIn);
  if (!qRes.ok) throw new Error("corpus: qkd direct refused");
  figures.push(["quantum link qkdKeySvg direct", qkdKeySvg(qIn, qRes)]);
}
// --- end Release Q: quantum links ---

// --- Release E: quantum mechanics ---
// Each quantum-mechanics tool through its own compute() at its defaults and at layout stress: the infinite well with 8
// levels (labels decluttered at the bottom) and with 1; the finite well with 11 bound states (8 drawn, V₀ label kept), a
// single state at the rim (tails across the frame), a GaAs effective-mass well; the oscillator with 8 levels and a
// proton at 1 level; hydrogen Lyman α (1s), 20 → 2 (crowded levels near 0 with a leader to n = ∞), He⁺ with a 4f P(r);
// tunnelling below, above (resonances), at a very low energy (the E label clear of the axis), through 10 nm (resonances too dense: the shaded band) and 1 mm
// (T below 10⁻³⁰⁰ runs off the axis); Rabi resonant and detuned (the Ω²/(Ω² + Δ²) line), t beyond the window; Larmor
// precession; a typed Hamiltonian. Then the builders directly at their edges.
{
  const qm = (id: string, over: Record<string, string>, name: string): void => {
    const c = QUANTUM_MECHANICS_CALCS.find((x) => x.id === id);
    if (!c) throw new Error(`corpus: ${id} missing`);
    const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
    Object.assign(vals, over);
    const out = c.compute((k) => vals[k] ?? "");
    const plots = (out.blocks ?? []).filter((b) => b.kind === "plot");
    if (out.ok === false || !plots.length) throw new Error(`corpus: quantum mechanics ${name} did not draw: ${out.text}`);
    plots.forEach((b, i) => {
      if (b.kind === "plot") figures.push([`quantum mechanics ${name}${plots.length > 1 ? ` ${i + 1}` : ""}`, b.svg]);
    });
  };
  qm("qm-particle-box", {}, "infinite well 4 levels");
  qm("qm-particle-box", { levels: "8" }, "infinite well 8 levels");
  qm("qm-particle-box", { levels: "1", particle: "proton", width: "10 pm" }, "infinite well 1 level proton");
  qm("qm-particle-box", { well: "finite" }, "finite well 2 states");
  qm("qm-particle-box", { well: "finite", depth: "10 eV", width: "2 nm", levels: "8" }, "finite well 11 states 8 drawn");
  qm("qm-particle-box", { well: "finite", depth: "0.01 eV" }, "finite well one state at the rim");
  qm("qm-particle-box", { well: "finite", particle: "effective", depth: "0.3 eV", width: "10 nm" }, "finite well GaAs");
  qm("qm-harmonic-oscillator", {}, "oscillator 5 levels");
  qm("qm-harmonic-oscillator", { levels: "8", n: "7" }, "oscillator 8 levels");
  qm("qm-harmonic-oscillator", { levels: "1", particle: "proton", omega: "1e14 rad/s" }, "oscillator proton 1 level");
  qm("qm-hydrogen", {}, "hydrogen Balmer alpha 2p");
  qm("qm-hydrogen", { upper: "2", lower: "1", orbital: "1s", nucleus: "proton" }, "hydrogen Lyman alpha 1s");
  qm("qm-hydrogen", { upper: "20", lower: "2", orbital: "3d" }, "hydrogen 20 to 2 3d");
  qm("qm-hydrogen", { Z: "2", nucleus: "alpha", upper: "4", lower: "3", orbital: "4f" }, "hydrogen He+ 4 to 3 4f");
  qm("qm-tunnelling", {}, "tunnelling below the barrier");
  qm("qm-tunnelling", { E: "5 eV" }, "tunnelling above the barrier");
  qm("qm-tunnelling", { E: "0.001 eV" }, "tunnelling very low energy");
  qm("qm-tunnelling", { width: "10 nm" }, "tunnelling 10 nm resonance band");
  qm("qm-tunnelling", { width: "1 mm" }, "tunnelling 1 mm off the axis");
  qm("qm-two-level", {}, "Rabi resonant");
  qm("qm-two-level", { detuning: "0.5 MHz", t: "0.3 µs" }, "Rabi detuned");
  qm("qm-two-level", { t: "20 µs" }, "Rabi t beyond the window");
  qm("qm-two-level", { mode: "spin" }, "Larmor precession electron");
  qm("qm-two-level", { mode: "hamiltonian" }, "typed Hamiltonian");
  figures.push([
    "quantum mechanics levelFigureSvg 12 levels capped",
    levelFigureSvg({
      xRange: [0, 1],
      potential: [[0, 0], [1, 0]],
      levels: Array.from({ length: 12 }, (_, i) => ({ E: i + 1, x1: 0, x2: 1, label: `n = ${i + 1}`, value: `${i + 1} eV`, curve: [[0, 0], [0.5, 1], [1, 0]] as Array<[number, number]> })),
      amp: 0.5,
      eRange: [0, 14],
      xTicks: [{ v: 0, label: "0" }, { v: 1, label: "L" }],
      xTitle: "Position x",
      yTitle: "Energy (eV)",
    }),
  ]);
  figures.push(["quantum mechanics hydrogenLevelSvg two levels", hydrogenLevelSvg({ levels: [{ n: 1, E: -13.6 }, { n: 2, E: -3.4 }], upper: 2, lower: 1, arrowLabel: "121.5 nm", unit: "eV" })]);
  figures.push(["quantum mechanics curvesSvg six series", curvesSvg({ series: Array.from({ length: 6 }, (_, k) => ({ name: `series ${k + 1}`, pts: Array.from({ length: 50 }, (_, i) => [i / 49, Math.sin(i / 8 + k) ** 2] as [number, number]), color: ["#1f5fa8", "#d07a00", "#2e8b57", "#8e44ad", "#c0392b", "#555555"][k] })), xTitle: "Time t (ns)", yTitle: "Probability", xRange: [0, 1], yRange: [0, 1], marker: { x: 0.98, y: 0.5, label: "t = 98 ns" } })]);
  figures.push(["quantum mechanics tunnelSvg one point each", tunnelSvg({ below: [{ x: 0.5, lt: -2, wkb: -3 }, { x: 0.9, lt: -1, wkb: -1.5 }], above: [{ x: 1, t: 0.1 }, { x: 3, t: 0.9 }], xMax: 3, mark: { x: 0.95, lt: -1, t: 0.1 } })]);
}
// --- end Release E: quantum mechanics ---

{
  // Kaplan–Meier (v2.194.0): curve to last follow-up, y fixed 0–1, censoring + ticks (incl. one at S = 1).
  const t = [6, 6, 6, 7, 10, 13, 16, 22, 23, 6, 9, 10, 11, 17, 19, 20, 25, 32, 32, 34, 35];
  const e = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  figures.push(["kaplan-meier with censoring ticks", kaplanMeierSvg([{ km: kaplanMeier(t, e), label: "S(t)" }], { title: "Kaplan-Meier" })]);
  const t2 = [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23];
  const e2 = t2.map(() => 1);
  figures.push(["kaplan-meier two groups", kaplanMeierSvg([{ km: kaplanMeier(t, e), label: "treated" }, { km: kaplanMeier(t2, e2), label: "control" }], { title: "Kaplan-Meier" })]);
}

{
  // Release E5 (v2.199.0): the Lorenz curve (individual and grouped) and the supply-and-demand figure under every policy.
  const incomes = [8, 12, 15, 18, 22, 25, 30, 41, 55, 120];
  const ind = inequality({ x: incomes, w: incomes.map(() => 1), grouped: false }, [0.5, 1, 2]);
  figures.push(["lorenz curve individual", lorenzSvg(ind.lorenz, "0.4117", false)]);
  const grp = inequality({ x: [5, 15, 30, 80], w: [40, 30, 20, 10], grouped: true }, [0.5, 1, 2]);
  figures.push(["lorenz curve grouped", lorenzSvg(grp.lorenz, "0.4400", true)]);
  const Rq = (n: number): Rat => ratInt(n);
  const markets: [string, MarketSpec][] = [
    ["supply demand no policy", { a: Rq(120), b: Rq(2), c: Rq(20), d: Rq(3), policy: "none", amount: null, side: "sellers" }],
    ["supply demand tax on sellers", { a: Rq(120), b: Rq(2), c: Rq(20), d: Rq(3), policy: "tax", amount: Rq(10), side: "sellers" }],
    ["supply demand tax on buyers", { a: Rq(120), b: Rq(2), c: Rq(20), d: Rq(3), policy: "tax", amount: Rq(10), side: "buyers" }],
    ["supply demand subsidy", { a: Rq(120), b: Rq(2), c: Rq(20), d: Rq(3), policy: "subsidy", amount: Rq(10), side: "sellers" }],
    ["supply demand price ceiling", { a: Rq(120), b: Rq(2), c: Rq(20), d: Rq(3), policy: "ceiling", amount: Rq(50), side: "sellers" }],
    ["supply demand price floor", { a: Rq(120), b: Rq(2), c: Rq(20), d: Rq(3), policy: "floor", amount: Rq(90), side: "sellers" }],
    ["supply demand flat supply", { a: Rq(120), b: Rq(2), c: Rq(20), d: Rq(0), policy: "tax", amount: Rq(10), side: "sellers" }],
  ];
  for (const [name, spec] of markets) {
    const r = solveMarket(spec);
    if (!r.ok) throw new Error(`corpus: ${name}: ${r.reason}`);
    figures.push([name, marketFigureSvg(spec, r.r, { qunit: "unit", cur: "$" })]);
  }
}
// --- Astronomy & lunar ---
// Every calculator at its defaults and at the variants that change a figure's layout: a polar site (the Sun and Moon
// never set or never rise), a date before the leap-second era (two scale bars), a whole-year calendar (the lit-fraction
// line instead of the month grid), February of a leap year, a star below the horizon, a telescope with no camera and
// one with no eyepiece, a star given only its temperature (the Planck curve) or only magnitudes (the modulus line), an
// orbit with no transit (the Kepler line), the smallest and largest bodies; then the hand-drawn builders at their edges.
{
  const variants: Record<string, Record<string, string>[]> = {
    "astro-time": [{}, { date: "1950-06-01" }, { mode: "jd", jd: "0" }],
    "astro-coords": [{}, { time: "10:00" }, { ra: "2h 31m 49s", dec: "+89° 15′ 51″", lat: "78", lon: "15", ra2: "" }],
    "astro-moon": [{}, { date: "2026-11-24", time: "23:00" }, { date: "2026-11-17", lat: "78.22", lon: "15.65", tz: "1" }, { lat: "-33.87", lon: "151.21", tz: "10" }],
    "astro-moon-calendar": [{}, { month: "all" }, { year: "2028", month: "2", span: "12" }],
    "astro-ephemeris": [{}, { date: "2026-06-21", lat: "78.22", lon: "15.65", tz: "1" }, { date: "2040-09-08" }],
    "astro-telescope": [{}, { pix: "" }, { fe: "", target: "" }, { D: "80 mm", F: "400 mm", fe: "40 mm", target: "120" }],
    "astro-stars": [{}, { L: "", R: "", T: "3500 K", m: "", plx: "" }, { m: "12.3", M: "4.8", plx: "", R: "", T: "" }, { T: "30000 K", R: "6.5" }],
    "astro-cosmology": [{}, { z: "0.01" }, { z: "6" }],
    "astro-kepler": [{}, { Rs: "", P: "", a: "5.2 au", Mp: "1 MJ" }, { Ms: "1 Msun", Mp: "1 Mearth", P: "365.25 d", Rp: "1 Rearth", b: "0.5" }],
    "astro-gravity": [{}, { body: "jupiter" }, { body: "phobos", mass: "150 lb" }, { body: "earth" }],
  };
  for (const c of ASTRO_CALCS) {
    (variants[c.id] ?? [{}]).forEach((over, vi) => {
      const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
      Object.assign(vals, over);
      const out = c.compute((k) => vals[k] ?? "");
      const svgs = (out.blocks ?? []).filter((b) => b.kind === "plot").map((b) => (b as { svg: string }).svg);
      if (out.ok === false || !svgs.length) throw new Error(`corpus: astro ${c.id} did not draw: ${out.text}`);
      svgs.forEach((s, i) => figures.push([`astro ${c.id} v${vi} ${Object.keys(over).join("+") || "default"} #${i + 1}`, s]));
    });
  }
  figures.push(["astro moonDiscSvg new Moon", moonDiscSvg(0, 90, null, "New Moon, 0 % lit", "north up")]);
  figures.push(["astro moonDiscSvg full Moon tilted", moonDiscSvg(1, 300, 40, "Full Moon, 100 % lit", "as seen")]);
  figures.push(["astro moonDiscSvg first quarter", moonDiscSvg(0.5, 270, 0, "First quarter", "as seen")]);
  figures.push(["astro skyDomeSvg crowded", skyDomeSvg([0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ altDeg: 10 + 9 * i, azDeg: 45 * i, label: `body ${i + 1} at azimuth ${45 * i}°` })), "Eight bodies")]);
  figures.push(["astro skyDomeSvg below horizon", skyDomeSvg([{ altDeg: -30, azDeg: 200, label: "below" }], "One body below the horizon")]);
  figures.push(["astro fovSvg tiny target", fovSvg(10, [5, 3], 0.05, "planet")]);
  figures.push(["astro timeScalesChartSvg UT only", timeScalesChartSvg([{ name: "UT", offset: 0, note: "Earth rotation" }, { name: "TT", offset: 29.1, note: "ΔT 29.1 s" }])]);
}
// --- end Astronomy & lunar ---
export { figures };
