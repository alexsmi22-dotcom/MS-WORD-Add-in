// The Engineering pane must be able to REACH every engine it claims to offer.
//
// This test exists because of a real failure mode this repo has already hit:
// three Solve features were fully implemented and fully unit-tested while the
// pane could not reach any of them. A green engine suite says the mathematics
// is right. It says nothing about whether a person clicking through the task
// pane ever gets to run it, and "tested" is exactly the word that stops anyone
// checking.
//
// taskpane.ts cannot be imported here — it pulls in Office.js at module scope —
// so the check is a source scan, which is the convention the other pane tests
// use. It is a weaker check than executing the compute, and it is deliberately
// written to fail loudly if the registry it scans ever stops being found, so it
// cannot pass vacuously.

import * as fs from "fs";
import * as path from "path";

const PANE = fs
  .readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8")
  .replace(/\r\n/g, "\n");

function registrySource(name: string): string {
  const start = PANE.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`${name} not found in taskpane.ts`);
  const end = PANE.indexOf("\n];", start);
  if (end < 0) throw new Error(`end of ${name} not found`);
  return PANE.slice(start, end);
}

/** Entries of the registry, sliced at each `id: "..."`. */
function entries(name: string): { id: string; body: string }[] {
  const src = registrySource(name);
  const out: { id: string; body: string }[] = [];
  const re = /\bid: "([a-z0-9-]+)",/g;
  const hits: { id: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) hits.push({ id: m[1], at: m.index });
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].at : src.length;
    out.push({ id: hits[i].id, body: src.slice(hits[i].at, end) });
  }
  return out;
}

const ENG = entries("ENG_CALCS");

/** Every tool the Engineering pane offers, and the engine each one must call. */
const EXPECTED: { id: string; calls: string[]; module: string }[] = [
  { id: "beam", calls: ["analyzeBeam("], module: "../lib/beam" },
  { id: "section", calls: ["sectionProperties("], module: "../lib/section" },
  { id: "circuit-dc", calls: ["solveDc("], module: "../lib/circuit" },
  { id: "circuit-ac", calls: ["solveAc(", "frequencySweep("], module: "../lib/circuit" },
  { id: "stress", calls: ["analyzeStress("], module: "../lib/stress" },
  { id: "truss", calls: ["analyzeTruss(", "parseTruss("], module: "../lib/truss" },
  { id: "column", calls: ["analyzeColumn("], module: "../lib/stress" },
  { id: "torsion", calls: ["analyzeTorsion("], module: "../lib/stress" },
  { id: "pipe", calls: ["analyzePipe("], module: "../lib/fluids" },
  { id: "flow-meter", calls: ["flowMeter("], module: "../lib/fluids2" },
  { id: "pump-system", calls: ["pumpSystemCurve("], module: "../lib/fluids2" },
  { id: "affinity", calls: ["affinityLaws("], module: "../lib/fluids2" },
  { id: "body-drag", calls: ["bodyDrag("], module: "../lib/fluids2" },
  { id: "fracture-k", calls: ["stressIntensity("], module: "../lib/fracture" },
  { id: "fracture-paris", calls: ["parisGrowth("], module: "../lib/fracture" },
  { id: "fracture-transition", calls: ["fractureTransition("], module: "../lib/fracture" },
  { id: "wall", calls: ["analyzeWall("], module: "../lib/heat" },
  { id: "hx", calls: ["analyzeExchanger("], module: "../lib/heat" },
  { id: "hx-ntu", calls: ["effectivenessNtu("], module: "../lib/heat2" },
  { id: "fin", calls: ["finPerformance("], module: "../lib/heat2" },
  { id: "lumped", calls: ["lumpedCapacitance("], module: "../lib/heat2" },
  { id: "radiation", calls: ["radiationExchange("], module: "../lib/heat2" },
  { id: "control-tf", calls: ["analyzeStability(", "parseTf("], module: "../lib/control" },
  { id: "control-step", calls: ["timeResponse(", "secondOrderMetrics("], module: "../lib/control" },
  { id: "control-bode", calls: ["margins(", "frequencyResponse("], module: "../lib/control" },
  { id: "control-pid", calls: ["pidTf(", "feedback(", "series("], module: "../lib/control" },
  { id: "pk-dose", calls: ["singleDoseCurve("], module: "../lib/pk" },
  { id: "pk-steady", calls: ["steadyState(", "multipleDoseCurve("], module: "../lib/pk" },
  { id: "pk-nca", calls: ["nca(", "parseConcentrationData("], module: "../lib/pk" },
  { id: "vib-free", calls: ["sdofProperties(", "freeResponse("], module: "../lib/vibration" },
  { id: "vib-forced", calls: ["forcedResponse("], module: "../lib/vibration" },
  { id: "vib-modal", calls: ["modalAnalysis(", "chainSystem("], module: "../lib/vibration" },
  { id: "vib-mdof-forced", calls: ["modalForcedResponse(", "chainSystem("], module: "../lib/vibration" },
  { id: "chips-power", calls: ["switchingPower("], module: "../lib/chips" },
  { id: "chips-thermal", calls: ["junctionTemperature("], module: "../lib/chips" },
  { id: "chips-delay", calls: ["interconnectDelay("], module: "../lib/chips" },
  { id: "chips-timing", calls: ["timingCheck("], module: "../lib/chips" },
  { id: "comp-speedup", calls: ["parallelSpeedup("], module: "../lib/computation" },
  { id: "comp-entropy", calls: ["shannonEntropy("], module: "../lib/computation" },
  { id: "comp-channel", calls: ["channelCapacity(", "bscCapacity("], module: "../lib/computation" },
  { id: "comp-collision", calls: ["collisionProbability("], module: "../lib/computation" },
  { id: "comp-float", calls: ["floatPrecision("], module: "../lib/computation" },
  { id: "comp-scaling", calls: ["runtimeScaling("], module: "../lib/computation" },
  { id: "energy-wind", calls: ["windPower("], module: "../lib/energy" },
  { id: "energy-solar", calls: ["solarPV("], module: "../lib/energy" },
  { id: "energy-fill-factor", calls: ["fillFactor("], module: "../lib/energy" },
  { id: "energy-hydro", calls: ["hydroPower("], module: "../lib/energy" },
  { id: "energy-battery", calls: ["batteryPack("], module: "../lib/energy" },
  { id: "energy-combustion", calls: ["combustion("], module: "../lib/energy" },
  { id: "energy-lcoe", calls: ["lcoe("], module: "../lib/energy" },
  { id: "energy-capacity-factor", calls: ["capacityFactor("], module: "../lib/energy" },
  { id: "energy-three-phase", calls: ["threePhase("], module: "../lib/grid" },
  { id: "energy-pf-correction", calls: ["pfCorrection("], module: "../lib/grid" },
  { id: "energy-voltage-drop", calls: ["voltageDrop("], module: "../lib/grid" },
  { id: "energy-wind-shear", calls: ["windShear("], module: "../lib/energy" },
  { id: "energy-weibull", calls: ["weibullWind("], module: "../lib/energy" },
  { id: "energy-flue-gas", calls: ["flueGas("], module: "../lib/energy" },
  { id: "energy-storage", calls: ["storageSizing("], module: "../lib/energy" },
  { id: "energy-solar-geometry", calls: ["solarGeometry("], module: "../lib/energy" },
  { id: "energy-flame-temp", calls: ["flameTemperature("], module: "../lib/flame" },
  { id: "audio-sampling", calls: ["audioSamplingCheck("], module: "../lib/biomed" },
  { id: "audio-quantisation", calls: ["quantisation("], module: "../lib/audio" },
  { id: "audio-decibel", calls: ["toDb(", "fromDb("], module: "../lib/audio" },
  { id: "audio-spl", calls: ["splAtDistance(", "sumIncoherent("], module: "../lib/audio" },
  { id: "audio-reverb", calls: ["reverbTime("], module: "../lib/audio" },
  { id: "audio-roommodes", calls: ["roomModes("], module: "../lib/audio" },
  { id: "audio-comb", calls: ["combFilter("], module: "../lib/audio" },
  { id: "video-bitrate", calls: ["bitrate("], module: "../lib/video" },
  { id: "video-resolution", calls: ["resolution("], module: "../lib/video" },
  { id: "video-hdr", calls: ["hdrRange("], module: "../lib/video" },
  { id: "video-psnr", calls: ["psnr("], module: "../lib/video" },
  { id: "video-stream", calls: ["streamBuffer("], module: "../lib/video" },
  { id: "video-latency", calls: ["latencyBudget("], module: "../lib/video" },
  { id: "video-gamut", calls: ["gamutCoverage("], module: "../lib/colourspace" },
  { id: "traj-vacuum", calls: ["vacuumShot("], module: "../lib/trajectory" },
  { id: "traj-drag", calls: ["dragShot("], module: "../lib/trajectory" },
  { id: "traj-aim", calls: ["aimForRange("], module: "../lib/trajectory" },
  { id: "traj-impact", calls: ["impactEnergy("], module: "../lib/trajectory" },
  { id: "orbit-circular", calls: ["circularOrbit("], module: "../lib/orbital" },
  { id: "orbit-elliptical", calls: ["ellipticalOrbit("], module: "../lib/orbital" },
  { id: "orbit-hohmann", calls: ["hohmannTransfer("], module: "../lib/orbital" },
  { id: "orbit-rocket", calls: ["rocketEquation("], module: "../lib/orbital" },
  { id: "orbit-escape", calls: ["escapeSpeed("], module: "../lib/orbital" },
  { id: "traj-scurve", calls: ["sCurveProfile("], module: "../lib/trajectory" },
  { id: "traj-multiaxis", calls: ["multiAxisMove("], module: "../lib/trajectory" },
  { id: "nav-greatcircle", calls: ["greatCircle("], module: "../lib/trajectory" },
  { id: "nav-windtriangle", calls: ["windTriangle("], module: "../lib/trajectory" },
  { id: "robotics-fk", calls: ["planarFk("], module: "../lib/robotics" },
  { id: "robotics-ik", calls: ["planar2rIk("], module: "../lib/robotics" },
  { id: "robotics-jacobian", calls: ["planar2rJacobian("], module: "../lib/robotics" },
  { id: "robotics-dh", calls: ["dhForward("], module: "../lib/robotics" },
  { id: "robotics-profile", calls: ["trapezoidalProfile("], module: "../lib/robotics" },
  { id: "robotics-diffdrive", calls: ["diffDriveFromWheels(", "diffDriveToWheels("], module: "../lib/robotics" },
  { id: "aero-isa", calls: ["atmosphere(", "pressureAltitude("], module: "../lib/aero" },
  { id: "aero-airspeed", calls: ["airspeeds(", "atmosphere("], module: "../lib/aero" },
  { id: "aero-polar", calls: ["dragPolar(", "atmosphere("], module: "../lib/aero" },
  { id: "aero-turn", calls: ["levelTurn("], module: "../lib/aero" },
  { id: "aero-climb", calls: ["climbGlide("], module: "../lib/aero" },
  { id: "optics-photon", calls: ["photonRelations("], module: "../lib/optics" },
  { id: "optics-gaussian", calls: ["gaussianBeam("], module: "../lib/optics" },
  { id: "optics-abcd", calls: ["systemMatrix(", "qFromBeam(", "propagateQ(", "beamFromQ("], module: "../lib/optics" },
  { id: "optics-resonator", calls: ["resonator("], module: "../lib/optics" },
  { id: "optics-pulse", calls: ["pulseMetrics("], module: "../lib/optics" },
  { id: "optics-refraction", calls: ["refraction("], module: "../lib/optics" },
  { id: "optics-diffraction", calls: ["airy(", "grating("], module: "../lib/optics" },
  { id: "optics-fibre", calls: ["fibre("], module: "../lib/optics" },
  { id: "quantum-entanglement", calls: ["pureTwoQubit("], module: "../lib/quantum" },
  { id: "quantum-chsh", calls: ["chsh("], module: "../lib/quantum" },
  { id: "quantum-werner", calls: ["wernerState("], module: "../lib/quantum" },
  { id: "quantum-qkd", calls: ["bb84KeyRate("], module: "../lib/quantum" },
  { id: "thermo-process", calls: ["idealGasProcess(", "toKelvin("], module: "../lib/thermo" },
  { id: "thermo-cycle", calls: ["ottoCycle(", "dieselCycle(", "braytonCycle("], module: "../lib/thermo" },
  { id: "thermo-vapour", calls: ["rankineFromEnthalpies(", "refrigerationFromEnthalpies(", "checkAgainstCarnot("], module: "../lib/thermo" },
  { id: "fatigue-endurance", calls: ["enduranceLimit(", "notchFactor("], module: "../lib/fatigue" },
  { id: "fatigue-safety", calls: ["meanStressAnalysis("], module: "../lib/fatigue" },
  { id: "fatigue-life", calls: ["finiteLife(", "minerDamage("], module: "../lib/fatigue" },
  { id: "opamp", calls: ["analyzeOpamp("], module: "../lib/opamp" },
  { id: "filter-design", calls: ["designFilter(", "toTransferFunction("], module: "../lib/filter" },
  { id: "logic", calls: ["truthTable(", "minimise("], module: "../lib/logic" },
  { id: "open-channel", calls: ["openChannelFlow("], module: "../lib/fluids" },
  { id: "pump-npsh", calls: ["npshAnalysis("], module: "../lib/fluids" },
  { id: "compressible", calls: ["compressibleFlow("], module: "../lib/fluids" },
  { id: "haemodynamics", calls: ["vesselFlow(", "circulation("], module: "../lib/biomed" },
  { id: "biomechanics", calls: ["jointStatics("], module: "../lib/biomed" },
  { id: "biosignal", calls: ["samplingCheck("], module: "../lib/biomed" },
];

describe("the scan is not vacuous", () => {
  test("the registry was found and has entries", () => {
    expect(ENG.length).toBeGreaterThanOrEqual(EXPECTED.length);
  });

  test("the pane still builds the Engineering menu from this registry", () => {
    // If the select is ever populated from a second, hand-written list, adding a
    // calc here would silently not appear — the exact drift modes.ts was created
    // to end. Pin the loop that reads the registry.
    expect(PANE).toContain("ENG_CALCS.filter((c) => c.group === title)");
    expect(PANE).toContain("engineeringCalcSelect.appendChild(g)");
  });

  test("selection and compute both resolve against the registry", () => {
    // Both the field renderer and the compute path must look the tool up in
    // ENG_CALCS; a hardcoded index in either is how a tool becomes unreachable.
    const hits = PANE.split("ENG_CALCS.find((c) => c.id === engineeringCalcSelect.value)").length - 1;
    expect(hits).toBe(2);
  });
});

describe("every Engineering tool is reachable and wired to its engine", () => {
  test.each(EXPECTED)("$id is present in the registry", ({ id }) => {
    expect(ENG.map((e) => e.id)).toContain(id);
  });

  test.each(EXPECTED)("$id calls its engine rather than reimplementing it", ({ id, calls }) => {
    const entry = ENG.find((e) => e.id === id);
    expect(entry).toBeDefined();
    for (const c of calls) {
      expect(entry!.body).toContain(c);
    }
  });

  test.each(EXPECTED)("$id's engine module is imported by the pane", ({ module }) => {
    expect(PANE).toContain(`from "${module}"`);
  });

  test("no tool in the registry is missing from this test's list", () => {
    // Without this, a new calc could be added and never routing-checked — the
    // list above would go stale exactly the way the old hand-written MODES array
    // did, and every test here would still pass.
    const known = new Set(EXPECTED.map((e) => e.id));
    const unlisted = ENG.map((e) => e.id).filter((id) => !known.has(id));
    expect(unlisted).toEqual([]);
  });
});

describe("every Engineering tool declares its inputs and can produce a result", () => {
  test.each(EXPECTED)("$id has a name, a hint, fields and a compute", ({ id }) => {
    const body = ENG.find((e) => e.id === id)!.body;
    expect(body).toMatch(/\bname:\s*"/);
    expect(body).toMatch(/\bhint:/);
    expect(body).toMatch(/\bfields:\s*\[/);
    expect(body).toMatch(/\bcompute:\s*\(/);
  });

  test.each(EXPECTED)("$id declares at least one field with a default", ({ id }) => {
    const body = ENG.find((e) => e.id === id)!.body;
    // A tool whose fields array is empty renders an empty panel and can never
    // be driven from the pane, however good its engine is.
    expect(body).toMatch(/key:\s*"[^"]+",\s*label:/);
    expect(body).toMatch(/default:/);
  });

  test.each(EXPECTED)("$id reads every field key it declares", ({ id }) => {
    // A field whose key is never read back is dead chrome: the user types into
    // it and nothing changes. This catches a rename made on one side only.
    //
    // The check counts occurrences of the quoted key rather than looking for a
    // literal r("key"), because the computes legitimately read through local
    // helpers — num("rho", NaN) is a read, and an earlier version of this test
    // reported it as dead. One occurrence is the declaration; a field that is
    // ever used appears at least twice.
    const body = ENG.find((e) => e.id === id)!.body;
    const declared = [...body.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    const unread = declared.filter((k) => body.split(`"${k}"`).length - 1 < 2);
    expect(unread).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE UNIT CONTRACT.
//
// The Engineering tools had drifted into three different unit contracts, and
// the dangerous half was silent: column, torsion, pipe flow and the heat tools
// DECLARED strict SI and then accepted whatever was typed without checking. A
// declaration enforces nothing. The concrete trap that produced was inside the
// product — the cross-section tool reports I in mm^4 (as every section table
// does) and the column tool wanted m^4, so the most natural workflow in the
// whole section was wrong by 10^12 and said nothing.
//
// The rule now is: a tool converts units unless it is dimensionally homogeneous
// or computes over exact rationals, and EVERY tool declares which it is. These
// tests enforce the declaration, because the last thing to enforce it was a
// sentence in a hint.
// ---------------------------------------------------------------------------
const UNIT_NOTES = [
  "ENG_UNIT_NOTE",
  "ENG_SAME_UNIT_NOTE",
  "ENG_EXACT_UNIT_NOTE",
  "ENG_CONTROL_UNIT_NOTE",
  "ENG_PK_UNIT_NOTE",
  "ENG_VIB_UNIT_NOTE",
  "ENG_THERMO_UNIT_NOTE",
  "ENG_FATIGUE_UNIT_NOTE",
  "ENG_ELEC_UNIT_NOTE",
  "ENG_BIOMED_UNIT_NOTE",
  "ENG_PHOTON_UNIT_NOTE",
  "ENG_QUANTUM_UNIT_NOTE",
] as const;

/** Which contract each tool is on, asserted rather than inferred. */
const CONTRACT: Record<string, (typeof UNIT_NOTES)[number]> = {
  beam: "ENG_EXACT_UNIT_NOTE",
  truss: "ENG_EXACT_UNIT_NOTE",
  section: "ENG_UNIT_NOTE",
  stress: "ENG_SAME_UNIT_NOTE",
  column: "ENG_UNIT_NOTE",
  torsion: "ENG_UNIT_NOTE",
  pipe: "ENG_UNIT_NOTE",
  "flow-meter": "ENG_UNIT_NOTE",
  "pump-system": "ENG_UNIT_NOTE",
  affinity: "ENG_SAME_UNIT_NOTE",
  "body-drag": "ENG_UNIT_NOTE",
  "fracture-k": "ENG_UNIT_NOTE",
  "fracture-paris": "ENG_UNIT_NOTE",
  "fracture-transition": "ENG_UNIT_NOTE",
  wall: "ENG_UNIT_NOTE",
  hx: "ENG_UNIT_NOTE",
  "hx-ntu": "ENG_UNIT_NOTE",
  fin: "ENG_UNIT_NOTE",
  lumped: "ENG_UNIT_NOTE",
  radiation: "ENG_UNIT_NOTE",
  "circuit-dc": "ENG_SAME_UNIT_NOTE",
  "circuit-ac": "ENG_SAME_UNIT_NOTE",
  "control-tf": "ENG_CONTROL_UNIT_NOTE",
  "control-step": "ENG_CONTROL_UNIT_NOTE",
  "control-bode": "ENG_CONTROL_UNIT_NOTE",
  "control-pid": "ENG_CONTROL_UNIT_NOTE",
  "pk-dose": "ENG_PK_UNIT_NOTE",
  "pk-steady": "ENG_PK_UNIT_NOTE",
  "pk-nca": "ENG_PK_UNIT_NOTE",
  "vib-free": "ENG_VIB_UNIT_NOTE",
  "vib-forced": "ENG_VIB_UNIT_NOTE",
  "vib-modal": "ENG_VIB_UNIT_NOTE",
  "vib-mdof-forced": "ENG_VIB_UNIT_NOTE",
  "thermo-process": "ENG_THERMO_UNIT_NOTE",
  "thermo-cycle": "ENG_THERMO_UNIT_NOTE",
  "thermo-vapour": "ENG_THERMO_UNIT_NOTE",
  "fatigue-endurance": "ENG_FATIGUE_UNIT_NOTE",
  "fatigue-safety": "ENG_FATIGUE_UNIT_NOTE",
  "fatigue-life": "ENG_FATIGUE_UNIT_NOTE",
  opamp: "ENG_ELEC_UNIT_NOTE",
  "filter-design": "ENG_ELEC_UNIT_NOTE",
  logic: "ENG_ELEC_UNIT_NOTE",
  // The two fluids additions share the converting contract with pipe flow.
  "open-channel": "ENG_UNIT_NOTE",
  "pump-npsh": "ENG_UNIT_NOTE",
  compressible: "ENG_THERMO_UNIT_NOTE",
  haemodynamics: "ENG_BIOMED_UNIT_NOTE",
  biomechanics: "ENG_BIOMED_UNIT_NOTE",
  biosignal: "ENG_BIOMED_UNIT_NOTE",
  "chips-power": "ENG_UNIT_NOTE",
  "chips-thermal": "ENG_UNIT_NOTE",
  "chips-delay": "ENG_UNIT_NOTE",
  "chips-timing": "ENG_UNIT_NOTE",
  "comp-speedup": "ENG_SAME_UNIT_NOTE",
  "comp-entropy": "ENG_SAME_UNIT_NOTE",
  "comp-channel": "ENG_UNIT_NOTE",
  "comp-collision": "ENG_SAME_UNIT_NOTE",
  "comp-float": "ENG_SAME_UNIT_NOTE",
  "comp-scaling": "ENG_SAME_UNIT_NOTE",
  "energy-wind": "ENG_UNIT_NOTE",
  "energy-solar": "ENG_UNIT_NOTE",
  "energy-fill-factor": "ENG_UNIT_NOTE",
  "energy-hydro": "ENG_UNIT_NOTE",
  "energy-battery": "ENG_UNIT_NOTE",
  "energy-combustion": "ENG_UNIT_NOTE",
  "energy-lcoe": "ENG_UNIT_NOTE",
  "energy-capacity-factor": "ENG_UNIT_NOTE",
  "energy-three-phase": "ENG_UNIT_NOTE",
  "energy-pf-correction": "ENG_UNIT_NOTE",
  "energy-voltage-drop": "ENG_UNIT_NOTE",
  "energy-wind-shear": "ENG_UNIT_NOTE",
  "energy-weibull": "ENG_UNIT_NOTE",
  "energy-flue-gas": "ENG_SAME_UNIT_NOTE",
  "energy-storage": "ENG_UNIT_NOTE",
  "energy-solar-geometry": "ENG_SAME_UNIT_NOTE",
  "energy-flame-temp": "ENG_UNIT_NOTE",
  "audio-sampling": "ENG_UNIT_NOTE",
  "audio-quantisation": "ENG_UNIT_NOTE",
  "audio-decibel": "ENG_SAME_UNIT_NOTE",
  "audio-spl": "ENG_UNIT_NOTE",
  "audio-reverb": "ENG_UNIT_NOTE",
  "audio-roommodes": "ENG_UNIT_NOTE",
  "audio-comb": "ENG_UNIT_NOTE",
  "video-bitrate": "ENG_UNIT_NOTE",
  "video-resolution": "ENG_SAME_UNIT_NOTE",
  "video-hdr": "ENG_UNIT_NOTE",
  "video-psnr": "ENG_SAME_UNIT_NOTE",
  "video-stream": "ENG_UNIT_NOTE",
  "video-latency": "ENG_UNIT_NOTE",
  "video-gamut": "ENG_SAME_UNIT_NOTE",
  "traj-vacuum": "ENG_UNIT_NOTE",
  "traj-drag": "ENG_UNIT_NOTE",
  "traj-aim": "ENG_UNIT_NOTE",
  "traj-impact": "ENG_UNIT_NOTE",
  "orbit-circular": "ENG_UNIT_NOTE",
  "orbit-elliptical": "ENG_UNIT_NOTE",
  "orbit-hohmann": "ENG_UNIT_NOTE",
  "orbit-rocket": "ENG_UNIT_NOTE",
  "orbit-escape": "ENG_UNIT_NOTE",
  "traj-scurve": "ENG_UNIT_NOTE",
  "traj-multiaxis": "ENG_SAME_UNIT_NOTE",
  "nav-greatcircle": "ENG_SAME_UNIT_NOTE",
  "nav-windtriangle": "ENG_UNIT_NOTE",
  "robotics-fk": "ENG_SAME_UNIT_NOTE",
  "robotics-ik": "ENG_SAME_UNIT_NOTE",
  "robotics-jacobian": "ENG_UNIT_NOTE",
  "robotics-dh": "ENG_SAME_UNIT_NOTE",
  "robotics-profile": "ENG_UNIT_NOTE",
  "robotics-diffdrive": "ENG_UNIT_NOTE",
  "aero-isa": "ENG_UNIT_NOTE",
  "aero-airspeed": "ENG_UNIT_NOTE",
  "aero-polar": "ENG_UNIT_NOTE",
  "aero-turn": "ENG_UNIT_NOTE",
  "aero-climb": "ENG_UNIT_NOTE",
  "optics-photon": "ENG_PHOTON_UNIT_NOTE",
  "optics-gaussian": "ENG_UNIT_NOTE",
  "optics-abcd": "ENG_UNIT_NOTE",
  "optics-resonator": "ENG_UNIT_NOTE",
  "optics-pulse": "ENG_UNIT_NOTE",
  "optics-refraction": "ENG_SAME_UNIT_NOTE",
  "optics-diffraction": "ENG_UNIT_NOTE",
  "optics-fibre": "ENG_UNIT_NOTE",
  "quantum-entanglement": "ENG_QUANTUM_UNIT_NOTE",
  "quantum-chsh": "ENG_QUANTUM_UNIT_NOTE",
  "quantum-werner": "ENG_QUANTUM_UNIT_NOTE",
  "quantum-qkd": "ENG_QUANTUM_UNIT_NOTE",
};

describe("every Engineering tool declares one unit contract", () => {
  test("the three declarations exist", () => {
    for (const n of UNIT_NOTES) expect(PANE).toContain(`const ${n} =`);
  });

  test.each(EXPECTED)("$id declares exactly one contract", ({ id }) => {
    const body = ENG.find((e) => e.id === id)!.body;
    const found = UNIT_NOTES.filter((n) => body.includes(n));
    // Exactly one: none means the tool says nothing about units, and more than
    // one means it contradicts itself in the same result.
    expect({ id, found }).toEqual({ id, found: [CONTRACT[id]] });
  });

  test("no tool is missing from the contract map", () => {
    const unlisted = ENG.map((e) => e.id).filter((id) => !(id in CONTRACT));
    expect(unlisted).toEqual([]);
  });

  // A tool that claims to convert must actually read its fields through the
  // unit layer. This is the assertion that would have caught the original bug:
  // column DECLARED SI and read with Number().
  test.each(Object.keys(CONTRACT).filter((id) => CONTRACT[id] === "ENG_UNIT_NOTE"))(
    "%s actually parses units rather than only claiming to",
    (id) => {
      const body = ENG.find((e) => e.id === id)!.body;
      const parses = body.includes("engUnits(") || body.includes("parseMeasured(");
      expect({ id, parses }).toEqual({ id, parses: true });
    },
  );

  // The converse: a tool that says it does NOT convert must not quietly convert.
  test.each(Object.keys(CONTRACT).filter((id) => CONTRACT[id] !== "ENG_UNIT_NOTE"))(
    "%s does not convert behind its own declaration",
    (id) => {
      const body = ENG.find((e) => e.id === id)!.body;
      expect({ id, converts: body.includes("engUnits(") }).toEqual({ id, converts: false });
    },
  );

  test("the shared reader exists and refuses a wrong-quantity unit", () => {
    // engUnits delegates the refusal to parseMeasured; pin that it is wired to
    // the error path rather than defaulting past it.
    expect(PANE).toContain("function engUnits(");
    const body = PANE.slice(PANE.indexOf("function engUnits("), PANE.indexOf("const ENG_UNIT_NOTE"));
    expect(body).toContain("parseMeasured(");
    expect(body).toContain("errors.push(");
  });

  test.each(Object.keys(CONTRACT).filter((id) => CONTRACT[id] === "ENG_UNIT_NOTE"))(
    "%s refuses when a field fails to parse, instead of computing on NaN",
    (id) => {
      const body = ENG.find((e) => e.id === id)!.body;
      // Two legitimate shapes, and the property is the same either way: a parse
      // failure must be detected before the value is used.
      //   - The engUnits tools collect into u.errors and bail on it.
      //   - Cross-sections check `"error" in` inline and skip only the stress
      //     block, so a bad moment unit still returns the section properties
      //     rather than throwing all of it away. That is better behaviour, not
      //     a missing guard, so the test accepts it rather than forcing the
      //     tools to converge on one shape for its own sake.
      const guards =
        body.includes("u.errors.length") || body.includes("errors.length") || body.includes('"error" in');
      expect({ id, guards }).toEqual({ id, guards: true });
    },
  );
});

// ---------------------------------------------------------------------------
// THE RICH-INSERT DISPATCH.
//
// A block kind is only useful if the insert path actually takes the rich branch
// for it. When "math" was added, the dispatch guard still tested only for
// "matrix" and "plot" — so the three tools whose reports contain formulas but no
// figure fell through to insertPlainText and put the caret form into the
// document, with the equation code written, tested and never reached. That is
// the same "engine built, pane cannot reach it" failure as the dead Solve
// features, one layer further in: the tool WAS reachable, the block kind was
// not.
// ---------------------------------------------------------------------------
/**
 * The whole body of insertResultBlocks.
 *
 * These scans used to slice a fixed 4000/8000 characters from the RICH_KINDS
 * marker. That is a window, not a scope: adding an explanatory comment inside
 * the function pushed the code being scanned past the end of it, and the gate
 * failed on a change that touched none of the behaviour it guards. A test that
 * breaks when a comment grows is measuring the wrong thing. Bound it by the
 * function instead — the closing brace is where the function actually ends,
 * whatever is written inside it.
 */
function insertBlocksBody(): string {
  const start = PANE.indexOf("async function insertResultBlocks(");
  if (start < 0) throw new Error("insertResultBlocks not found in taskpane.ts");
  const end = PANE.indexOf("\n}", start);
  if (end < 0) throw new Error("end of insertResultBlocks not found");
  // Comments are stripped. This function is documented with the exact code
  // shapes that broke it — "insertParagraph("")" appears in prose explaining
  // why it must not appear in code — so a scan that reads comments fails on the
  // very fix it is meant to protect.
  const body = PANE.slice(start, end)
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
  // Fail loudly rather than scanning a truncated body: every assertion below
  // would pass vacuously against an empty or clipped string.
  if (!body.includes("const RICH_KINDS")) throw new Error("insertResultBlocks body looks truncated");
  return body;
}

describe("every non-text block kind reaches the rich insert path", () => {
  test("the dispatch lists every rich kind", () => {
    const i = PANE.indexOf("const RICH_KINDS");
    expect(i).toBeGreaterThan(-1);
    const line = PANE.slice(i, PANE.indexOf(";", i));
    for (const kind of ["matrix", "plot", "math"]) {
      expect({ kind, listed: line.includes(`"${kind}"`) }).toEqual({ kind, listed: true });
    }
  });

  test("the guard is driven by that list, not by a hand-written condition", () => {
    expect(PANE).toContain("blocks.some((b) => RICH_KINDS.includes(b.kind))");
  });

  test("every block kind in the union is either plain text or listed as rich", () => {
    // Parses the AnalyzeBlock union so a NEW kind cannot be added without either
    // being routed or being consciously left as text.
    const start = PANE.indexOf("type AnalyzeBlock =");
    const end = PANE.indexOf("interface AnalyzeOutput", start);
    const union = PANE.slice(start, end);
    const kinds = [...union.matchAll(/kind: "([a-z]+)"/g)].map((m) => m[1]);
    expect(kinds.length).toBeGreaterThanOrEqual(4);
    const richLine = PANE.slice(PANE.indexOf("const RICH_KINDS"), PANE.indexOf(";", PANE.indexOf("const RICH_KINDS")));
    const unrouted = kinds.filter((k) => k !== "line" && !richLine.includes(`"${k}"`));
    expect(unrouted).toEqual([]);
  });

  test("a formula tool with no figure still produces a rich block", () => {
    // The three that regressed. Each must emit a math block, which the guard
    // above now routes.
    for (const id of ["control-tf", "control-pid", "filter-design"]) {
      const body = ENG.find((e) => e.id === id)!.body;
      const emitsMath = body.includes("tfLine(") || body.includes("tfLineDecimal(");
      expect({ id, emitsMath }).toEqual({ id, emitsMath: true });
    }
  });

  // THE SECOND WAY THIS BROKE. mathToOoxml builds a COMPLETE flat-OPC document,
  // and inserting one mid-sequence breaks the anchor chain — every paragraph
  // after the first equation silently failed to land, so a report whose first
  // line is a formula inserted ONLY that formula. The fix is the pattern Solve
  // already used: batch consecutive prose and equations into ONE package.
  test("text and equations are batched into one package per run", () => {
    const body = insertBlocksBody();
    // A run accumulator, flushed as a single buildDerivationOoxml insert.
    expect(body).toContain("buildDerivationOoxml(run)");
    expect(body).toContain("const flushRun");
    // Line and math blocks must PUSH to the run, never insert on their own.
    expect(body).toMatch(/kind === "line"[\s\S]{0,120}run\.push/);
    expect(body).toMatch(/kind === "math"[\s\S]{0,400}run\.push/);
  });

  test("the run is flushed before every non-text block and at the end", () => {
    const body = insertBlocksBody();
    // Once before the plot/matrix branches, once after the loop.
    expect(body.split("flushRun()").length - 1).toBeGreaterThanOrEqual(2);
    // The final flush must come immediately before the selection is moved.
    const tail = body.slice(body.lastIndexOf("flushRun()"));
    expect(tail).toMatch(/^flushRun\(\);[\s]*anchor\.select/);
  });

  // The batching must not change how the rest of the product inserts. A run with
  // no equation in it still goes in as plain paragraphs, because insertParagraph
  // inherits the style at the cursor while an OOXML package brings its own — so
  // beam, sections, stats and every other figure-bearing tool are untouched.
  test("a run with no formula in it still inserts as plain paragraphs", () => {
    const i = PANE.indexOf("const flushRun");
    expect(i).toBeGreaterThan(-1);
    const body = PANE.slice(i, i + 1600);
    expect(body).toContain("if (runHasMath)");
    expect(body).toContain("buildDerivationOoxml(run)");
    // The else branch is the old behaviour, unchanged.
    expect(body).toContain("insertParagraph(b.content");
  });

  test("only a formula that actually typesets switches the run to the package path", () => {
    const i = PANE.indexOf('block.kind === "math"', PANE.indexOf("const RICH_KINDS"));
    const body = PANE.slice(i, i + 700);
    // An unparseable expression becomes text and must NOT force the OOXML path.
    expect(body).toContain("if (parses) runHasMath = true;");
  });

  // THIS GATE ONCE DEMANDED FIVE SYNCS. IT WAS WRONG, AND IT COST A RELEASE.
  //
  // The theory was that an anchor chained off unsynced content is unusable and
  // that a sync between every hop was the remedy. The user's picture counts say
  // the opposite: the release that added a sync per hop took the
  // frequency-response report from one figure of two to NONE, and broke the
  // single-figure beam report too. Every sync added to this loop has cost
  // figures; none has ever recovered one.
  //
  // So the gate is inverted. The block loop must not sync at all — the syncs
  // that remain in this routine are the picture-count probes and the single
  // closing sync, all outside the loop.
  test("the block loop does not sync while it is building content", () => {
    const routine = insertBlocksBody();
    const loopStart = routine.indexOf("for (let i = 0; i < blocks.length; i++)", routine.indexOf("const flushRun"));
    const loopEnd = routine.indexOf("anchor.select(");
    expect(loopStart).toBeGreaterThan(-1);
    expect(loopEnd).toBeGreaterThan(loopStart);
    const loop = routine.slice(loopStart, loopEnd);
    expect(loop.split("await context.sync()").length - 1).toBe(0);
  });

  test("the routine still closes with a sync", () => {
    // Removing the mid-loop syncs must not remove the one that commits the batch.
    const routine = insertBlocksBody();
    expect(routine).toMatch(/anchor\.select\([\s\S]{0,120}await context\.sync\(\)/);
  });

  /** The plot branch, bounded by its own `continue` rather than a byte count. */
  function figureBranch(): string {
    const body = insertBlocksBody();
    const i = body.indexOf('block.kind === "plot"');
    if (i < 0) throw new Error("plot branch not found");
    const end = body.indexOf("continue;", i);
    if (end < 0) throw new Error("end of plot branch not found");
    const branch = body.slice(i, end);
    if (!branch.includes("insertInlinePictureFromBase64")) {
      throw new Error("plot branch looks truncated");
    }
    return branch;
  }

  // THE FIGURE SHAPE IS WHERE FIVE RELEASES WENT, so it is pinned as a whole.
  //
  // Read the ladder honestly, because an earlier version of this comment did
  // not. There are THREE measurements and ONE inference:
  //   - v2.31.0, caption paragraph: count UNKNOWN. The picture counter did not
  //     exist yet. "2 of 2" was inferred from a user's remark about two plots
  //     being misaligned, and four releases were spent reverting toward a state
  //     nobody had ever verified.
  //   - v2.31.1, empty paragraph: 1 of 2.       (measured)
  //   - v2.31.4, empty paragraph + sync/hop: 0 of 2, and beam lost its one too.
  //   - v2.31.7, caption paragraph + Start: 1 of 2, instrumented.
  //
  // Every one of those chained the next anchor .after a paragraph CONTAINING a
  // picture. That is the token these gates actually protect; the rest of the
  // shape is pinned because each regression came from adding one more thing to
  // a sequence that was already correct.

  test("the picture goes into a paragraph that has text in it", () => {
    // An empty paragraph is where the figures went missing. Word accepts a
    // picture destined for one, reports no error, and keeps nothing.
    const body = figureBranch();
    expect(body).toContain("anchor.insertParagraph(block.caption");
    expect(body).not.toMatch(/insertParagraph\(""/);
  });

  test("the picture is inserted at the END of the caption paragraph", () => {
    // InsertLocation.start was an attempt to make figures line up at the margin
    // without changing the paragraph structure, and v2.31.7 measured 1 of 2
    // with it. That does NOT convict it: the same build had OOXML upstream, a
    // sync in-branch, and .after off a picture paragraph, so Start was never
    // the only variable and the "2 of 2" it was compared against was never a
    // count. Start is unconvicted, not refuted.
    //
    // End is pinned anyway, on the narrower ground that it is what the three
    // shipped N-picture inserts use and what every candidate fix has to vary
    // from. If a future release wants Start for alignment, it may have it —
    // but alone, on top of a CONFIRMED 2 of 2, and never bundled with a
    // structural change. Bundling the cosmetic fix with a structural one is
    // exactly what v2.31.1 did.
    const body = figureBranch();
    expect(body).toMatch(/insertInlinePictureFromBase64\([^)]*Word\.InsertLocation\.end/);
    expect(body).not.toMatch(/insertInlinePictureFromBase64\([^)]*Word\.InsertLocation\.start/);
  });

  test("the figure branch does not sync at all", () => {
    // Syncing inside this branch took the report from 1 of 2 figures to 0 of 2.
    // The v2.31.0 branch that rendered both had no sync in it.
    const body = figureBranch();
    expect(body.split("await context.sync()").length - 1).toBe(0);
  });

  test("the next anchor comes from RangeLocation.end, as insertGallery does", () => {
    // insertGallery inserts N pictures in one loop in one Word.run and has
    // shipped untouched for years. It differs from this branch in exactly one
    // token: .end rather than .after. Chaining .after off a paragraph that
    // CONTAINS a picture does not give a usable insertion point, so the next
    // picture is accepted and kept by nobody. Text paragraphs chain off .after
    // fine, which is why only figures went missing.
    const body = figureBranch();
    expect(body).toContain("para.getRange(Word.RangeLocation.end)");
    expect(body).not.toContain("para.getRange(Word.RangeLocation.after)");
  });

  test("the gallery this is modelled on still uses the same anchor rule", () => {
    // If insertGallery ever changes, the justification above is stale and this
    // suite is asserting a shape nothing corroborates any more.
    const g = PANE.indexOf("insertInlinePictureFromBase64(item.base64");
    expect(g).toBeGreaterThan(-1);
    const loop = PANE.slice(g, g + 400);
    expect(loop).toContain("para.getRange(Word.RangeLocation.end)");
  });

  test("every shipped site that chains off a picture uses .end", () => {
    // The comment in the figure branch claims THREE shipped sites follow one
    // rule — chain .end off a picture, .after off text. That claim is the whole
    // justification for the token, so it is gated rather than asserted. The
    // table-figure and structure inserts each take their tail from a picture.
    const sites = PANE.split("\n")
      .map((l) => l.trim())
      .filter((l) => /^(let|const)\s+tail = picture\.getRange\(/.test(l));
    expect(sites.length).toBeGreaterThanOrEqual(2);
    for (const s of sites) expect(s).toContain("Word.RangeLocation.end");
  });

  test("the OOXML anchor in flushRun is deliberately NOT changed", () => {
    // One variable per release. An OOXML package upstream was the rival theory
    // for the missing figure, and it was set aside on evidence: step response
    // is math (hence insertOoxml) plus exactly ONE plot and has never been
    // reported to lose it. If someone later changes this to .end as well, the
    // next picture count stops being a single-variable measurement — so this
    // pins the NON-change until Bode has been confirmed at 2 of 2.
    const routine = insertBlocksBody();
    expect(routine).toContain("inserted.getRange(Word.RangeLocation.after)");
  });

  test("the figure branch is exactly the five statements that worked", () => {
    // Pinned as a whole, not statement by statement, because every regression
    // here came from adding ONE more thing to a sequence that was already
    // correct. If this needs to change, it needs a picture count proving it.
    const body = figureBranch();
    const code = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.includes('block.kind === "plot"'));
    expect(code).toEqual([
      "const para = anchor.insertParagraph(block.caption, Word.InsertLocation.after);",
      "const pic = para.insertInlinePictureFromBase64(images[i], Word.InsertLocation.end);",
      "sizeFigure(pic, block.w, block.h);",
      "pic.altTextDescription = block.alt;",
      "anchor = para.getRange(Word.RangeLocation.end);",
    ]);
  });

  test("properties may be set in the same batch as the insert", () => {
    // Pinned deliberately, against a refuted theory. insertSubstituentGallery,
    // the table-figure insert and the structure insert all do this and have
    // worked for many versions; "sync before setting properties" was a wrong
    // diagnosis that cost a release, and it should not come back by imitation.
    const body = figureBranch();
    const insert = body.indexOf("insertInlinePictureFromBase64");
    const sized = body.indexOf("sizeFigure(");
    expect(sized).toBeGreaterThan(insert);
    expect(body.slice(insert, sized)).not.toContain("await context.sync()");
  });

  test("Word is asked to confirm the pictures it kept", () => {
    // The pane's own count is what it rasterised, not what the host stored, and
    // the two disagreeing silently is the entire bug. Word has to be the
    // witness.
    const body = insertBlocksBody();
    expect(body).toContain("body.inlinePictures");
    expect(body).toContain("picturesConfirmed");
    expect(PANE).toContain("but Word kept");
  });

  test("a formula that will not typeset falls back to the tool's own text", () => {
    // Not to its math source, which is what the generic builder would use.
    const i = PANE.indexOf('kind === "math"', PANE.indexOf("const RICH_KINDS"));
    const body = PANE.slice(i, i + 600);
    expect(body).toContain("mathToOmml(block.math)");
    expect(body).toContain("block.fallback");
  });

  test("a math block ends up as an equation, not as a paragraph of characters", () => {
    // It no longer inserts its own package — that was the bug. It contributes a
    // math paragraph to the batched run, which buildDerivationOoxml turns into
    // real OMML in a single insert.
    const i = PANE.indexOf('block.kind === "math"', PANE.indexOf("const RICH_KINDS"));
    expect(i).toBeGreaterThan(-1);
    const body = PANE.slice(i, i + 700);
    expect(body).toContain("run.push(");
    expect(body).toContain('kind: "math"');
    // The whole run is inserted as one OOXML package.
    const routine = PANE.slice(PANE.indexOf("const RICH_KINDS"), PANE.indexOf("const RICH_KINDS") + 8000);
    expect(routine).toContain("buildDerivationOoxml(run)");
    expect(routine).toContain("insertOoxml(");
  });
});

describe("the em-dash sentinel cannot disable Insert on an Engineering result", () => {
  // formatNum() renders a non-finite number as an em dash and the pane blocks
  // insertion when it sees one anywhere in the result text. Library caveats are
  // written with em dashes because they are prose, so every compute must pass
  // its assembled text through plainDashes() before returning it. Missing that
  // call does not fail anything — the Insert button just quietly stops working.
  test.each(EXPECTED)("$id normalises its result text", ({ id }) => {
    // Two acceptable shapes: call plainDashes directly, or return through
    // engReport(), which does it for every line and every formula fallback on
    // the tool's behalf. The indirection is pinned by its own test below, so it
    // cannot become a hole in this one.
    const body = ENG.find((e) => e.id === id)!.body;
    const normalises = body.includes("plainDashes") || body.includes("engReport(");
    expect({ id, normalises }).toEqual({ id, normalises: true });
  });

  test("engReport normalises every line and every formula fallback", () => {
    // The tools that delegate to it are only safe if it really does this.
    const i = PANE.indexOf("function engReport(");
    expect(i).toBeGreaterThan(-1);
    const body = PANE.slice(i, PANE.indexOf("\n}", i));
    // Once for the prose lines, once for the math fallbacks.
    expect(body.split("plainDashes").length - 1).toBeGreaterThanOrEqual(2);
  });

  test("the guard this defends is still in place", () => {
    // If the pane stops scanning for the sentinel, this suite is obsolete rather
    // than wrong — so pin the thing it is protecting.
    expect(PANE).toContain("function plainDashes(");
    expect(PANE).toContain("\\u2014");
  });
});

// ---------------------------------------------------------------------------
// The menu is grouped, and a grouped menu can drop a tool in a way a flat one
// could not: the pane renders one <optgroup> per heading in ENG_GROUP_ORDER and
// fills it by filtering ENG_CALCS. A calculation whose group is absent from
// that order is therefore built into the registry, reachable by every routing
// test above, and INVISIBLE IN THE MENU. TypeScript's union type catches a
// typo, but not a group deleted from the order list while calcs still name it,
// and not a heading that ends up with nothing under it.
// ---------------------------------------------------------------------------
describe("every Engineering tool appears under a heading in the menu", () => {
  const ORDER = (() => {
    const i = PANE.indexOf("const ENG_GROUP_ORDER");
    expect(i).toBeGreaterThan(-1);
    const seg = PANE.slice(i, PANE.indexOf("] as const", i));
    return [...seg.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  })();

  const groupOf = (body: string): string | null => {
    const m = /\bgroup: "([^"]+)"/.exec(body);
    return m ? m[1] : null;
  };

  test("the heading list was found and is not empty", () => {
    expect(ORDER.length).toBeGreaterThanOrEqual(2);
  });

  test.each(ENG.map((e) => [e.id, e.body] as const))("%s declares a group", (id, body) => {
    expect({ id, group: groupOf(body) !== null }).toEqual({ id, group: true });
  });

  test.each(ENG.map((e) => [e.id, e.body] as const))(
    "%s names a group the menu actually renders",
    (id, body) => {
      const g = groupOf(body);
      // Not `toContain` on the array: the failure message should name the tool
      // and the orphaned heading, because that is the whole diagnosis.
      expect({ id, group: g, rendered: g !== null && ORDER.includes(g) }).toEqual({
        id,
        group: g,
        rendered: true,
      });
    },
  );

  test("no heading is empty", () => {
    const used = new Set(ENG.map((e) => groupOf(e.body)));
    const empty = ORDER.filter((g) => !used.has(g));
    expect(empty).toEqual([]);
  });

  test("no calculation repeats its heading in its own name", () => {
    // "Control: frequency response" under a "Control systems" heading is the
    // stutter this change removed; it creeps back the moment someone copies an
    // existing entry as a template.
    const stutters = ENG.filter((e) => {
      const g = groupOf(e.body);
      const n = /\bname: "([^"]+)"/.exec(e.body);
      if (!g || !n) return false;
      const first = g.split(/[ &]/)[0].toLowerCase();
      return n[1].toLowerCase().startsWith(first + ":");
    }).map((e) => e.id);
    expect(stutters).toEqual([]);
  });

  test("no two calculations show the same label", () => {
    // Names got shorter to fit under a heading, which is exactly when two of
    // them collide. Within a group a duplicate is unusable; across groups it is
    // merely confusing, so this checks globally.
    const names = ENG.map((e) => (/\bname: "([^"]+)"/.exec(e.body) || [, ""])[1]);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The menu is a set of PANELS, not a dropdown. Thirty-six options in one
// <select> is a scroll rather than a menu, and Engineering was the only mode in
// the add-in that worked that way. The <select> is kept as the selection's
// single source of truth — the panels set its value and fire `change`, so every
// downstream path is untouched — which means the failure mode to guard is the
// two drifting apart, or the panels silently not being built at all.
// ---------------------------------------------------------------------------
describe("the Engineering menu is rendered as discipline panels", () => {
  test("the pane builds a panel per group and a button per calculation", () => {
    expect(PANE).toContain("function renderEngineeringGroups()");
    expect(PANE).toContain('document.getElementById("engineering-groups")');
    expect(PANE).toContain('panel.className = "eng-group"');
    expect(PANE).toContain('btn.className = "eng-tool"');
  });

  test("the panel host exists in the markup", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
    expect(html).toContain('id="engineering-groups"');
    // The select is kept, hidden, as the state holder.
    expect(html).toContain('id="engineering-calc"');
    expect(html).toContain("eng-state-select");
  });

  test("a panel click routes through the select rather than around it", () => {
    // Two controls drift; a control and a state holder cannot. If the click
    // handler ever renders inputs directly, the select stops being the truth
    // and the audit — which drives the select — stops testing what users click.
    const i = PANE.indexOf("function selectEngineeringCalc(");
    expect(i).toBeGreaterThan(-1);
    const body = PANE.slice(i, PANE.indexOf("\n}", i));
    expect(body).toContain("engineeringCalcSelect.value = id");
    expect(body).toContain('dispatchEvent(new Event("change"');
    expect(body).not.toContain("renderEngineeringInputs(");
  });

  test("the panels follow the select however it was changed", () => {
    // The audit and any restored state set the select directly. If the
    // highlight only moved on panel clicks, those paths would leave the panels
    // showing a different tool from the one being computed.
    const i = PANE.indexOf('engineeringCalcSelect.addEventListener("change"');
    expect(i).toBeGreaterThan(-1);
    const body = PANE.slice(i, i + 400);
    expect(body).toContain("renderEngineeringInputs()");
    expect(body).toContain("markEngineeringSelection(");
  });

  test("only the panel holding the current calculation starts open", () => {
    // Nine panels open at once is the scroll this replaced.
    const i = PANE.indexOf("function renderEngineeringGroups()");
    const body = PANE.slice(i, PANE.indexOf("\n}", PANE.indexOf("for (const title", i)));
    expect(body).toContain("panel.open = members.some((m) => m.id === current)");
  });

  test("every calculation is reachable from a panel", () => {
    // The panels are built from the same registry as the select, so a tool
    // cannot be in one and not the other — pin that they share the source.
    const i = PANE.indexOf("function renderEngineeringGroups()");
    const body = PANE.slice(i, i + 2000);
    expect(body).toContain("ENG_CALCS.filter((c) => c.group === title)");
    expect(body).toContain("for (const title of ENG_GROUP_ORDER)");
  });
});
