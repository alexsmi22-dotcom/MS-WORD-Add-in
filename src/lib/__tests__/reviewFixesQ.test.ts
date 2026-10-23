// Review fixes after Release Q (2026-10-23): one row per confirmed defect. Cumulative gate: every later fix round keeps
// every row's outcome.
//
// Oracle (C:\Users\AlexanderSmith\jurislab-oracle-venv, numpy/scipy) for the decoy rows, with expm1 throughout:
//
//   import numpy as np
//   from scipy.optimize import brentq, minimize_scalar
//   def H(p):
//       p=min(0.5,p); return 0.0 if p<=0 else -p*np.log2(p)-(1-p)*np.log2(1-p)
//   def R(L,mu,y0,ed=0.033,det=0.045,f=1.22):
//       eta=10**(-L/10)*det; d=-np.expm1(-eta*mu); q=y0+d; E=(0.5*y0+ed*d)/q
//       y1=y0+eta-y0*eta; e1=(0.5*y0+ed*eta)/y1
//       return 0.5*(-q*f*H(E)+y1*mu*np.exp(-mu)*(1-H(e1))), q, E
//   brentq(lambda L: R(L,0.5,1e-20)[0], 0, 400, xtol=1e-12)     # 172.09242822772157 dB
//   R(200,0.5,1e-20)                                            # rate −6.23e−21 per pulse: no key at 200 dB
//   o=minimize_scalar(lambda m: -R(200,m,0)[0], bounds=(0.01,1.5), method='bounded')
//   o.x, 1e7*R(200,o.x,0)[0]                                    # μ 0.478923, 2.527990e−16 bit/s

import { convert, parseMeasured, formatUnit } from "../units";
import { qkdLink, type QkdInput } from "../quantumLinks";
import { QUANTUM_LINKS_CALCS } from "../quantumLinksCalcs";
import { QUANTUM_GATES_CALCS } from "../quantumGatesCalcs";
import { parseMathAst } from "../mathParse";
import { mathToHtml } from "../mathHtml";
import { mathToOmml } from "../mathOmml";
import { astToLatex, latexToDsl } from "../latex";
import { parseCircuit } from "../quantumCircuits";
import { circuitDiagramPages } from "../quantumCharts";
import type { AnalyzeOutput } from "../analyzeBlocks";

const close = (a: number | null, b: number, rel = 1e-9): void => {
  expect(a).not.toBeNull();
  expect(Math.abs((a as number) - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));
};

function runIn(calcs: { id: string; fields: { key: string; default: string }[]; compute: (r: (k: string) => string) => AnalyzeOutput }[], id: string, over: Record<string, string>): AnalyzeOutput {
  const c = calcs.find((x) => x.id === id);
  if (!c) throw new Error(`no calculator ${id}`);
  const vals: Record<string, string> = Object.fromEntries(c.fields.map((f) => [f.key, f.default]));
  Object.assign(vals, over);
  return c.compute((k) => vals[k] ?? "");
}
const CONTRACT = /NaN|Infinity|undefined|\^|\de[-+]?\d/;

// ---------------------------------------------------------------------------------------------------------------
// 1. Temperature differences never pick up an offset
// ---------------------------------------------------------------------------------------------------------------
describe("1. Δ temperature units convert as differences", () => {
  test.each([
    ["10 Δ°C", "K", 10],
    ["10 Δ°C", "Δ°F", 18],
    ["18 Δ°F", "Δ°C", 10],
    ["10 deltaC", "ΔK", 10],
    ["37 deltaC", "Δ°F", 66.6],
    ["180 deltaF", "K", 100],
    ["10 Δ°C", "°R", 18],
  ])("%s → %s = %d", (text, target, want) => {
    const m = parseMeasured(text, target);
    expect("error" in m).toBe(false);
    close((m as { inTarget: number }).inTarget, want);
  });

  test.each([
    ["10 Δ°C", "°C"],
    ["37 deltaC", "°F"],
    ["10 deltaF", "°C"],
    ["20 °C", "Δ°C"],
  ])("%s into a lone %s is refused by name, never offset", (text, target) => {
    const m = parseMeasured(text, target);
    expect("error" in m).toBe(true);
    expect((m as { error: string }).error).toMatch(/temperature difference/);
  });

  test("convert() returns null for Δ ↔ °C/°F (no −263.15, no −393.07)", () => {
    expect(convert(10, "Δ°C", "°C")).toBeNull();
    expect(convert(37, "deltaC", "°F")).toBeNull();
    expect(convert(10, "deltaF", "°C")).toBeNull();
  });

  test("a ΔT field read in K still subtracts the zero for absolute units (thermal stress deltaT idiom)", () => {
    const m = parseMeasured("180 °F", "K") as { inTarget: number; unit: string };
    close(m.inTarget - (convert(0, m.unit, "K") as number), 100);
    const d = parseMeasured("180 Δ°F", "K") as { inTarget: number; unit: string };
    close(d.inTarget - (convert(0, d.unit, "K") as number), 100);
  });

  test("inside a compound °C is still a difference", () => {
    close(convert(1, "W/(m^2*°C)", "W/(m^2*K)"), 1);
    close(convert(1, "W/(m^2*Δ°F)", "W/(m^2*K)"), 1.8);
  });

  test("a lone temperature with exponent 1 keeps its offset; other powers are refused", () => {
    close(convert(20, "°C^1", "K"), 293.15);
    close(convert(20, "°C¹", "K"), 293.15);
    expect(parseMeasured("20 °C^1", "K")).toMatchObject({ inTarget: 293.15 });
    expect(convert(20, "°C^2", "K^2")).toBeNull();
  });

  test("formatUnit √ only for exactly 0.5", () => {
    expect(formatUnit("Pa*m^0.5")).toBe("Pa·√m");
    expect(formatUnit("m^0.55")).toBe("m⁰.⁵⁵");
    expect(formatUnit("m^0.50")).toBe("√m");
    expect(formatUnit("m^0.5/s")).toBe("√m/s");
    expect(formatUnit("m^2")).toBe("m²");
    // what is displayed parses back
    close(convert(1, "m⁰.⁵⁵", "m^0.55"), 1);
  });

  test("the glued-slash refusal quotes what was typed", () => {
    const m = parseMeasured("120/K", "1/K") as { error: string };
    expect(m.error).toContain('"120 /K"');
    expect(m.error).not.toContain("51");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Decoy QKD at high loss: expm1, no phantom cutoff, no NaN
// ---------------------------------------------------------------------------------------------------------------
describe("2. decoy QKD precision", () => {
  const base: QkdInput = { rate: 1e7, lossDb: 20, detEff: 0.045, y0: 1.7e-6, ed: 0.033, source: "decoy", mu: 0.48, f: 1.22 };

  test("μ 0.5, Y₀ 0, 20 dB: no zero-key cutoff (the rate never changes sign)", () => {
    const r = qkdLink({ ...base, mu: 0.5, y0: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r.cutoffDb).toBeNull();
    const o = runIn(QUANTUM_LINKS_CALCS, "qlink-qkd", { source: "decoy", mu: "0.5", y0: "0" });
    expect(o.text).not.toMatch(/Zero-key cutoff at/);
    expect(o.text).toMatch(/No zero-key cutoff/);
  });

  test("μ blank, Y₀ 0, 200 dB: finite values (QBER = e_det, rate 2.528×10⁻¹⁶ bit/s)", () => {
    const r = qkdLink({ ...base, mu: null, y0: 0, lossDb: 200 });
    if (!r.ok) throw new Error(r.error);
    close(r.qber, 0.033, 1e-9);
    close(r.mu as number, 0.47892274874413926, 1e-6);
    close(r.keyRate, 2.527990041917502e-16, 1e-6);
    expect(r.cutoffDb).toBeNull();
    const o = runIn(QUANTUM_LINKS_CALCS, "qlink-qkd", { source: "decoy", mu: "", y0: "0", loss: "200" });
    expect(o.ok).not.toBe(false);
    expect(o.text).not.toMatch(/NaN|Infinity/);
  });

  test("μ 0.5, Y₀ 10⁻²⁰, 200 dB: no key at this loss, cutoff 172.09 dB", () => {
    const r = qkdLink({ ...base, mu: 0.5, y0: 1e-20, lossDb: 200 });
    if (!r.ok) throw new Error(r.error);
    expect(r.keyRate).toBe(0);
    close(r.cutoffDb, 172.09242822772157, 1e-8);
    const o = runIn(QUANTUM_LINKS_CALCS, "qlink-qkd", { source: "decoy", mu: "0.5", y0: "1e-20", loss: "200" });
    expect(o.text).toMatch(/no key at this loss/);
    expect(o.text).toMatch(/Zero-key cutoff at 172\.09/);
  });

  test("the GYS decoy default is unchanged (223.74 bit/s at 20 dB, cutoff 29.8246 dB)", () => {
    const r = qkdLink(base);
    if (!r.ok) throw new Error(r.error);
    close(r.keyRate, 223.74131, 1e-6);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 3–4. Lone sign scripts; LaTeX glyphs
// ---------------------------------------------------------------------------------------------------------------
describe("3. a lone sign after ^ or _ is the whole script", () => {
  test.each([
    ["Phi^+ + Psi^-", "Φ<sup>+</sup> + Ψ<sup>−</sup>", "\\Phi ^{+} + \\Psi ^{-}"],
    ["sigma_+ sigma_-", "σ<sub>+</sub>σ<sub>−</sub>", "\\sigma _{+} \\sigma _{-}"],
    // (the HTML preview prints a binary minus as typed; only the script signs are true minus)
    ["E_+ - E_-", "E<sub>+</sub> - E<sub>−</sub>", "E_{+} - E_{-}"],
    ["a_- a_+", "a<sub>−</sub>a<sub>+</sub>", "a_{-} a_{+}"],
    ["a_+ + a_-", "a<sub>+</sub> + a<sub>−</sub>", "a_{+} + a_{-}"],
  ])("%s", (src, html, latex) => {
    const plain = mathToHtml(src).replace(/<\/?(?:i|span|em)[^>]*>/g, "").replace(/\s+/g, " ").replace(/ ?([+−]) ?(?=[ΦΨEa])/g, " $1 ");
    expect(plain.replace(/\s+/g, "")).toBe(html.replace(/\s+/g, ""));
    expect(astToLatex(parseMathAst(src)).replace(/\s+/g, "")).toBe(latex.replace(/\s+/g, ""));
    const omml = mathToOmml(src);
    expect((omml.match(/<m:sSup>|<m:sSub>/g) ?? []).length).toBe(2);
  });

  test.each([["x^-1"], ["x^-n"], ["e^-x"]])("%s still signs the operand", (src) => {
    expect(astToLatex(parseMathAst(src)).replace(/\s+/g, "")).toMatch(/\^\{-[1nx]\}/);
  });
});

describe("4. LaTeX export of − and †", () => {
  test("A^dagger → A^{\\dagger}", () => {
    expect(astToLatex(parseMathAst("A^dagger")).replace(/\s+/g, "")).toBe("A^{\\dagger}");
    expect(latexToDsl("A^{\\dagger}")).toContain("†");
  });
  test("ket(-1) has no raw U+2212", () => {
    const l = astToLatex(parseMathAst("ket(-1)"));
    expect(l).not.toContain("−");
    expect(l.replace(/\s+/g, "")).toContain("-1");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 5–7. Circuits
// ---------------------------------------------------------------------------------------------------------------
describe("5. fixed gates refuse an argument", () => {
  test.each([
    ["CZ(pi/2) 0 1", /CZ takes no argument[\s\S]*CP\(φ\)/],
    ["CNOT(30) 0 1", /CNOT takes no argument/],
    ["CX(30) 0 1", /CX takes no argument/],
    ["CCX(1) 0 1 2", /CCX takes no argument/],
    ["CCZ(1) 0 1 2", /CCZ takes no argument/],
    ["SWAP(1) 0 1", /SWAP takes no argument/],
    ["CSWAP(1) 0 1 2", /CSWAP takes no argument/],
    ["iSWAP(1) 0 1", /iSWAP takes no argument/],
    ["MEASURE(1) 0", /MEASURE takes no argument/],
  ])("%s", (line, re) => {
    const r = parseCircuit(line, 3);
    expect("error" in r).toBe(true);
    expect((r as { error: string }).error).toMatch(re);
  });
  test("CP(pi/2) 0 1 still reads", () => {
    expect("ops" in parseCircuit("CP(pi/2) 0 1", 3)).toBe(true);
  });
});

describe("6. a long circuit is split into page-sized figures", () => {
  const lines: string[] = [];
  for (let i = 0; i < 195; i++) lines.push(i % 3 === 0 ? `CNOT ${i % 10} ${(i + 3) % 10}` : `H ${i % 10}`);
  const p = parseCircuit(lines.join("\n"), 10);
  if ("error" in p) throw new Error(p.error);
  test("every page ≤ 624 × 864 px (6.5 × 9 in at 0.75 pt/px)", () => {
    const pages = circuitDiagramPages({ n: 10, ops: p.ops });
    expect(pages.length).toBeGreaterThan(1);
    for (const svg of pages) {
      const w = Number(/width="([\d.]+)"/.exec(svg)?.[1]);
      const h = Number(/height="([\d.]+)"/.exec(svg)?.[1]);
      expect(w).toBeLessThanOrEqual(624);
      expect(h).toBeLessThanOrEqual(864);
    }
  });
  test("the circuit tool inserts parts with captions", () => {
    const o = runIn(QUANTUM_GATES_CALCS, "qc-circuit", { n: "10", circuit: lines.join("\n") });
    const plots = (o.blocks ?? []).filter((b) => b.kind === "plot") as { caption: string; w: number; h: number }[];
    const parts = plots.filter((b) => /part 1 of/.test(b.caption));
    expect(parts.length).toBe(1);
    for (const b of plots) expect(b.h * 0.75).toBeLessThanOrEqual(648);
  });
  test("a short circuit is still one figure", () => {
    expect(circuitDiagramPages({ n: 2, ops: (parseCircuit("H 0\nCNOT 0 1", 2) as { ops: never[] }).ops }).length).toBe(1);
  });
});

describe("7. teleport note with tiny amplitudes", () => {
  test("α = 10⁻²⁰⁰, β = 10⁻²⁰⁰i gives the true norm", () => {
    const o = runIn(QUANTUM_GATES_CALCS, "qc-teleport", { alpha: "1e-200", beta: "1e-200i" });
    expect(o.ok).not.toBe(false);
    expect(o.text).toMatch(/\|α\|² \+ \|β\|² = 2×10⁻⁴⁰⁰, not 1/);
    expect(o.text).not.toMatch(/divided by 0\)/);
    expect(o.text).toMatch(/divided by 1\.41421[0-9]*×10⁻²⁰⁰/);
    expect(o.text).not.toMatch(CONTRACT);
  });
});
