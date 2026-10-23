import { fieldText, splitValue, runSweep, runUncertainty, handoffsFor } from "../engWorkbench";
import { parseMeasured, formatUnit } from "../units";
import type { AnalyzeOutput } from "../analyzeBlocks";

const log = (...a: unknown[]) => process.stdout.write(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n");

test("units", () => {
  for (const [t, u] of [
    ["250 kt", "m/s"], ["1 t", "kg"], ["3 W/(m^2*K)", "W/(m^2*K)"], ["1 kN*m", "N*m"], ["1e-6 m^4", "m^4"], ["2 Mbit/s", "bit/s"],
    ["5 MWh", "MWh"], ["1 kg/m^3", "kg/m^3"], ["1 Hz^0.5", "Hz^0.5"], ["1 m^-2", "m^-2"], ["1 s^-1", "Hz"], ["12 µm/(m*K)", "1/K"],
    ["1 °", "rad"], ["5 %/°C", "1/K"], ["1 mil", "m"], ["1 MPa*m^0.5", "Pa*m^0.5"], ["1 V/Hz^0.5", "V/Hz^0.5"], ["1 A/Hz^0.5", "A/Hz^0.5"],
    ["0.000316227766017 m", "m"], ["1.2e-7 m", "m"], ["1 W/(m*K)", "W/(m*K)"], ["1 1/m", "1/m"], ["1 m⁻¹", "1/m"], ["1 ms", "s"], ["20 °C/W", "K/W"],
    ["1 g^2/Hz", "g^2/Hz"], ["1 (m/s^2)^2/Hz", "m^2/s^4/Hz"], ["1 nV/√Hz", "V/Hz^0.5"],
  ] as const) log(t, "->", u, parseMeasured(t, u));
});

test("fieldText", () => {
  for (const [v, u] of [[1e-7, "m"], [123456789012345, "N"], [0.1 + 0.2, "W/(m²·K)"], [1, "m⁻²"], [2, "V/√Hz"], [3, "°"], [4, "kg/m³"], [5, "g²/Hz"], [6, "µm/(m·K)"], [1e21, "Pa"], [-0, "N"], [1e-320, "m"]] as const) {
    const s = fieldText(v, u);
    log(v, u, "->", s, parseMeasured(s, "m"));
  }
});

test("splitValue quirks", () => {
  for (const s of ["1, 2, 3", "20 0.01\n80 0.04", ".5 m", "+5", "−3 kN", "-.5", "a5", "5e", "5e3m", "1/125 s", "0x10", "Infinity", "1e400 m", " 7 "]) log(JSON.stringify(s), "->", splitValue(s));
});

test("uncertainty draws NaN", () => {
  const compute = (r: (k: string) => string): AnalyzeOutput => {
    const a = parseFloat(r("a"));
    return { text: "y", outputs: [{ key: "y", label: "y", value: a * 2, unit: "" }] };
  };
  const res = runUncertainty(compute, (k) => (k === "a" ? "3" : ""), [{ field: "a", u: 0.1, relative: false }], "y", NaN);
  log("NaN draws", res.ok ? { draws: (res as any).draws, mean: (res as any).mean } : res);
  // list field
  const listCompute = (r: (k: string) => string): AnalyzeOutput => {
    const xs = r("a").split(",").map(Number);
    return { text: "y", outputs: [{ key: "y", label: "sum", value: xs.reduce((s, v) => s + v, 0), unit: "" }] };
  };
  const res2 = runUncertainty(listCompute, () => "10, 10, 10", [{ field: "a", u: 10, relative: true }], "y", 400);
  log("list field", res2.ok ? { sd: (res2 as any).sd, gum: (res2 as any).gum } : res2);
  const sw = runSweep(listCompute, () => "10, 10, 10", { field: "a", from: "1", to: "5", points: 3, log: false, output: "y" });
  log("list sweep", sw);
  // sweep with points NaN / Infinity
  log(runSweep(compute, () => "3", { field: "a", from: "1", to: "1e308", points: 41, log: true, output: "y" }).ok);
  log(runSweep(compute, () => "3", { field: "a", from: "-1e308", to: "1e308", points: 41, log: false, output: "y" }));
  log(handoffsFor("x", { text: "", outputs: [{ key: "q", label: "q", value: 1, unit: "" }] }));
});

test("pane uncertainty regex", () => {
  const re = /^(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*(%?)\s*\S*$/;
  for (const t of ["0.1 m", "2 percent", "5 %", "2%", "1e-3", "0.5 kN", "3 mm"]) {
    const m = re.exec(t);
    log(t, "->", m ? { u: parseFloat(t), rel: m[2] === "%" } : null);
  }
  log(formatUnit("W/(m^2*K)"), formatUnit("Hz^0.5"), formatUnit("m^0.5"), formatUnit("kg/m^3"));
});
