// Pane glue for the Release E link-budget calculators (gap #6): the RF link budget (Friis transmission), the noise
// figure cascade (Friis noise) with the receiver sensitivity it implies, and Eb/N0 ↔ bit error rate. Kept OUT of
// taskpane.ts; the integrator spreads LINK_BUDGET_CALCS into ENG_CALCS (group "Electronics", which already exists).
//
// No number is computed here: linkBudget.ts owns them. This file reads the fields — frequency, distance, bandwidth and
// data rate through units.ts parseMeasured; levels, gains, losses and noise figures as dB numbers, because the unit
// layer (rightly) refuses decibels — words the result under the display contract (U+2212, ×10ⁿ, no em dash, NaN or
// Infinity in an ok result) and draws.

import type { EngCalcDef } from "./engCalc";
import { engReport, type EngLine } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput, EngOutput } from "./analyzeBlocks";
import { formatUnit, parseMeasured } from "./units";
import { fmtSig } from "./axis";
import { trueMinus } from "./numberList";
import { readDataBlock } from "./dataBlock";
import {
  KT0_DBM_HZ,
  MAX_STAGES,
  MODULATIONS,
  T0_NOISE,
  berAt,
  cn0FromEbn0,
  ebn0FromCn0,
  linkBudget,
  rateDb,
  wattsToDbm,
  noiseCascade,
  requiredEbN0,
  sensitivity,
  type LinkInput,
  type Modulation,
} from "./linkBudget";
import { berWaterfallSvg, cascadeNfSvg, distText, linkRangeSvg } from "./linkBudgetCharts";

type ElecCalc = EngCalcDef<"Electronics">;

const UNIT_NOTE =
  "Units: frequency, distance, bandwidth and data rate convert (2.4 GHz, 5 mi, 200 kHz, 2 Mbps), and a unit of the " +
  "wrong quantity is refused. Levels, gains, losses and noise figures are decibels: type the number, optionally with " +
  "the field's own dB unit (dBm, dBi, dB); a transmit power or sensitivity may also be given in watts.";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")), ok: false });

/** Four significant figures (a computed value), ×10ⁿ outside 10⁻³…10⁵, U+2212. */
const n4 = (v: number): string => fmtSig(v, 4);
/** Six significant figures with trailing zeros dropped (a value as typed). */
const trimSig = (v: number): string => fmtSig(v, 6).replace(/(\.\d*?)0+(?=$|×)/, "$1").replace(/\.(?=$|×)/, "");
/** dB to two decimals (a link budget is read to 0.01 dB), U+2212, no "−0.00". */
const db2 = (v: number): string => (Math.abs(v) < 0.005 ? "0.00" : v.toFixed(2)).replace(/^-/, "−");
/** A signed dB line item: +6.00, −100.05. */
const dbSigned = (v: number): string => (Math.abs(v) < 0.005 ? "0.00" : (v > 0 ? "+" : "") + db2(v));

const NUM = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$/;

/** Unit-aware field reading (dimensional fields), plus the dB reader: errors collected, conversions reported. */
function unitReader(r: (k: string) => string) {
  const errors: string[] = [];
  const conversions: string[] = [];
  const read = (key: string, si: string, shown: string, label: string, required: boolean): number | null => {
    const raw = (r(key) ?? "").trim().replace(/[−–]/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const m = parseMeasured(raw, si);
    if ("error" in m) {
      errors.push(`${label}: ${m.error}`);
      return NaN;
    }
    if (m.unit.replace(/\s+/g, "") === si) return m.value;
    if (!Number.isFinite(m.inTarget)) {
      errors.push(`${label}: "${raw}" is not a finite number.`);
      return NaN;
    }
    if (!m.assumed && Math.abs(m.inTarget / m.value - 1) > 1e-12) conversions.push(`${label}: ${trimSig(m.value)} ${formatUnit(m.unit)} = ${n4(m.inTarget)} ${shown}`);
    return m.inTarget;
  };
  /**
   * A decibel field: a number, optionally followed by one of `units` (the field's own; offsets convert, e.g. dBW →
   * dBm is +30 dB). With `watts`, a power in W/mW/µW converts to dBm through the unit layer.
   */
  const readDb = (key: string, label: string, units: Record<string, number>, required: boolean, watts = false): number | null => {
    const raw = (r(key) ?? "").trim().replace(/[−–]/g, "-");
    if (!raw) {
      if (required) errors.push(`${label}: this field is required.`);
      return required ? NaN : null;
    }
    const m = NUM.exec(raw);
    if (!m) {
      errors.push(`${label}: "${raw}" does not start with a number.`);
      return NaN;
    }
    const v = Number(m[1]);
    const unit = m[2].trim();
    if (!Number.isFinite(v)) {
      errors.push(`${label}: "${raw}" is not a finite number.`);
      return NaN;
    }
    const exact = Object.keys(units).find((u) => u === unit) ?? Object.keys(units).find((u) => u.toLowerCase() === unit.toLowerCase() && u !== "");
    if (unit === "" || exact !== undefined) {
      const off = units[exact ?? ""] ?? 0;
      if (off !== 0) conversions.push(`${label}: ${trimSig(v)} ${unit} = ${trimSig(v + off)} ${Object.keys(units).find((u) => units[u] === 0 && u !== "")}`);
      return v + off;
    }
    if (watts) {
      const w = parseMeasured(raw, "W");
      if (!("error" in w)) {
        if (!(w.inTarget > 0)) {
          errors.push(`${label}: a power in watts must be greater than zero.`);
          return NaN;
        }
        const dbm = wattsToDbm(w.inTarget);
        conversions.push(`${label}: ${trimSig(w.value)} ${formatUnit(w.unit)} = ${db2(dbm)} dBm`);
        return dbm;
      }
    }
    if (/^dBd$/i.test(unit)) {
      errors.push(`${label}: "dBd" is gain over a half-wave dipole; this field takes dBi (gain over an isotropic radiator), so convert the value to dBi first.`);
      return NaN;
    }
    const allowed = Object.keys(units).filter((u) => u !== "");
    errors.push(`${label}: "${unit}" is not accepted here. Write a number of ${allowed.join(" or ")}${watts ? " (or a power in W, mW or µW)" : ""}.`);
    return NaN;
  };
  return {
    errors,
    conversions,
    req: (key: string, si: string, shown: string, label: string): number => read(key, si, shown, label, true) as number,
    opt: (key: string, si: string, shown: string, label: string): number | null => read(key, si, shown, label, false),
    db: (key: string, label: string, units: Record<string, number>, watts = false): number => readDb(key, label, units, true, watts) as number,
    dbOpt: (key: string, label: string, units: Record<string, number>, watts = false): number | null => readDb(key, label, units, false, watts),
  };
}

const DBM = { "": 0, dBm: 0, dBW: 30 };
const DBI = { "": 0, dBi: 0 };
const DB = { "": 0, dB: 0 };

const plot = (svg: string, caption: string, alt: string): AnalyzeBlock => {
  const w = Number(/^<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 460);
  const h = Number(/^<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 300);
  return { kind: "plot", svg, caption, alt, w, h };
};

function finish(lines: EngLine[], conversions: string[], extra: AnalyzeBlock[], outputs: EngOutput[]): AnalyzeOutput {
  if (conversions.length) lines.push("Units read: " + conversions.join("; ") + ".");
  lines.push(UNIT_NOTE);
  const out = engReport(lines.map((l) => trueMinus(l)), extra);
  return { ...out, outputs };
}

/** "1 MHz" style frequency for prose. */
function freqText(hz: number): string {
  for (const [f, u] of [[1e9, "GHz"], [1e6, "MHz"], [1e3, "kHz"]] as const) if (hz >= f) return `${trimSig(hz / f)} ${u}`;
  return `${trimSig(hz)} Hz`;
}

// ---------------------------------------------------------------------------------------------------------------
// 1. RF link budget
// ---------------------------------------------------------------------------------------------------------------

const linkCalc: ElecCalc = {
  id: "rf-link-budget",
  name: "RF link budget (Friis free-space)",
  group: "Electronics",
  unitContract: "converts",
  hint:
    "A line-of-sight radio link: transmit power, antenna gains, frequency and distance give the free-space path loss " +
    "and the received power, with the budget as a table of dB line items. Give the receiver sensitivity for the link " +
    "margin and the free-space range. Losses are entered as positive dB. Free space and the far field only: no ground " +
    "reflection, terrain, rain or multipath (add them as other losses).",
  fields: [
    { key: "f", label: "Frequency (Hz; 2.4 GHz)", default: "2.4 GHz", kind: "text" },
    { key: "d", label: "Distance (m; 1 km)", default: "1 km", kind: "text" },
    { key: "pt", label: "Transmit power (dBm, dBW or W)", default: "20 dBm", kind: "text" },
    { key: "gt", label: "Transmit antenna gain (dBi)", default: "6", kind: "text" },
    { key: "gr", label: "Receive antenna gain (dBi)", default: "6", kind: "text" },
    { key: "ltx", label: "Transmit feeder loss (dB)", default: "0", kind: "text" },
    { key: "lrx", label: "Receive feeder loss (dB)", default: "0", kind: "text" },
    { key: "lother", label: "Other losses: atmosphere, polarisation, fade allowance (dB)", default: "0", kind: "text" },
    { key: "sens", label: "Receiver sensitivity (dBm; blank for none)", default: "-90 dBm", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const fHz = u.req("f", "Hz", "Hz", "Frequency");
    const dM = u.req("d", "m", "m", "Distance");
    const pt = u.db("pt", "Transmit power", DBM, true);
    const gt = u.db("gt", "Transmit antenna gain", DBI);
    const gr = u.db("gr", "Receive antenna gain", DBI);
    const ltx = u.db("ltx", "Transmit feeder loss", DB);
    const lrx = u.db("lrx", "Receive feeder loss", DB);
    const lo = u.db("lother", "Other losses", DB);
    const sens = u.dbOpt("sens", "Receiver sensitivity", DBM, true);
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const inp: LinkInput = { ptDbm: pt, gtDbi: gt, grDbi: gr, fHz, dM, txLossDb: ltx, rxLossDb: lrx, otherLossDb: lo, sensDbm: sens };
    const res = linkBudget(inp);
    if (!res.ok) return refuse(res.error);
    const lines: EngLine[] = [];
    lines.push(`Received power: ${db2(res.prDbm)} dBm (${n4(res.prW)} W) at ${distText(dM)}, ${freqText(fHz)} (λ = ${n4(res.lambda)} m).`);
    lines.push(`Free-space path loss: ${db2(res.fsplDb)} dB; EIRP ${db2(res.eirpDbm)} dBm.`);
    if (res.marginDb !== null && sens !== null) {
      lines.push(
        res.marginDb >= 0
          ? `Link margin: ${db2(res.marginDb)} dB above the ${db2(sens)} dBm sensitivity; in free space the link closes out to ${distText(res.maxRangeM as number)}.`
          : `Link margin: ${db2(res.marginDb)} dB: the received power is BELOW the ${db2(sens)} dBm sensitivity, so the link does not close; in free space it would reach ${distText(res.maxRangeM as number)}.`,
      );
    }
    lines.push({ math: "λ = c/f", fallback: "λ = c/f" });
    lines.push({ math: "FSPL = 20 log_10((4 π d)/λ)", fallback: "FSPL = 20 log₁₀(4πd/λ) dB" });
    lines.push({ math: "P_r = P_t - L_t + G_t - FSPL - L_o + G_r - L_r", fallback: "Pr = Pt − Lt + Gt − FSPL − Lo + Gr − Lr (all in dB, dBm, dBi)" });
    lines.push("Assumes free space and the far field (d ≫ λ and beyond 2D²/λ for an antenna of size D, which this tool cannot check), matched polarisation unless entered as a loss, and gains in dBi (over an isotropic radiator).");
    const table: string[][] = [["Line item", "Value (dB)", "Unit"]];
    for (const it of res.items) {
      const isLevel = it.unit === "dBm";
      table.push([it.label, isLevel ? db2(it.db) : dbSigned(it.db), it.unit]);
    }
    const outputs: EngOutput[] = [
      { key: "fspl", label: "Free-space path loss", value: res.fsplDb, unit: "dB" },
      { key: "eirp", label: "EIRP", value: res.eirpDbm, unit: "dBm" },
      { key: "pr", label: "Received power", value: res.prDbm, unit: "dBm" },
      { key: "prW", label: "Received power", value: res.prW, unit: "W" },
      { key: "lambda", label: "Wavelength", value: res.lambda, unit: "m" },
    ];
    if (res.marginDb !== null) {
      outputs.push({ key: "margin", label: "Link margin", value: res.marginDb, unit: "dB" });
      outputs.push({ key: "range", label: "Free-space range at sensitivity", value: res.maxRangeM as number, unit: "m" });
    }
    const extra: AnalyzeBlock[] = [
      { kind: "table", label: "Link budget", rows: table },
      plot(
        linkRangeSvg(inp, res.prDbm, res.maxRangeM),
        "Received power against distance (free space)",
        "Received power in dBm against distance on a logarithmic axis, falling 20 dB per decade, with the design distance marked" + (sens !== null ? " and the sensitivity line" : ""),
      ),
    ];
    return finish(lines, u.conversions, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Noise figure cascade and sensitivity
// ---------------------------------------------------------------------------------------------------------------

/** Rows of exactly `need` numbers from a pasted block (RULE N reader); a string is a refusal. */
function readRows(text: string, what: string, need: number, cap: number, columns: string): { rows: number[][]; notes: string[] } | string {
  if (!(text ?? "").trim()) return `${what}: nothing to read. Paste ${columns}, one row per line.`;
  const b = readDataBlock(text, what, { maxRows: cap });
  if (!b.ok) return b.error;
  const rows: number[][] = [];
  for (let i = 0; i < b.rows.length; i++) {
    const row = b.rows[i];
    if (row.length !== need || row.some((v) => v === null))
      return `${what}: line ${b.lines[i]} must hold exactly ${need} numbers (${columns}).`;
    rows.push(row as number[]);
  }
  return { rows, notes: b.notes };
}

const cascadeCalc: ElecCalc = {
  id: "noise-figure-cascade",
  name: "Noise figure cascade (Friis) & receiver sensitivity",
  group: "Electronics",
  unitContract: "converts",
  hint:
    "The receive chain in signal order, one stage per line: gain (dB) and noise figure (dB). A passive loss is a " +
    "negative gain with a noise figure equal to the loss (a 3 dB cable: −3 3). Gives the cascade noise figure and noise " +
    "temperature, the noise floor kT₀B + NF and, with a required SNR, the sensitivity. T₀ = 290 K, the noise-figure " +
    "reference temperature; impedances matched.",
  fields: [
    { key: "stages", label: "Stages: gain (dB), noise figure (dB)", default: "20 1.5\n10 6\n3 10", kind: "block", rows: 5 },
    { key: "bw", label: "Noise bandwidth (Hz; 1 MHz)", default: "1 MHz", kind: "text" },
    { key: "snr", label: "Required SNR at the detector (dB; blank for none)", default: "10", kind: "text" },
  ],
  compute: (r) => {
    const u = unitReader(r);
    const bw = u.req("bw", "Hz", "Hz", "Noise bandwidth");
    const snr = u.dbOpt("snr", "Required SNR", DB);
    if (u.errors.length) return refuse(u.errors.join("\n"));
    const t = readRows(r("stages"), "Stages", 2, MAX_STAGES, "gain in dB, noise figure in dB");
    if (typeof t === "string") return refuse(t);
    const c = noiseCascade(t.rows.map(([g, nf]) => ({ gainDb: g, nfDb: nf })));
    if (!c.ok) return refuse(c.error);
    const s = sensitivity(c.nfDb, bw, snr ?? 0);
    if (!s.ok) return refuse(s.error);
    const lines: EngLine[] = [...t.notes];
    lines.push(`Cascade noise figure: ${fmtSig(c.nfDb, 6)} dB (noise factor F = ${fmtSig(c.factor, 6)}); noise temperature Te = ${fmtSig(c.teK, 6)} K; total gain ${db2(c.gainDb)} dB over ${c.rows.length} stage${c.rows.length > 1 ? "s" : ""}.`);
    lines.push(`Thermal noise kT₀B at ${T0_NOISE} K in ${freqText(bw)}: ${fmtSig(s.ktbDbm, 6)} dBm (kT₀ = ${db2(KT0_DBM_HZ)} dBm/Hz); noise floor at the input kT₀B + NF = ${db2(s.floorDbm)} dBm.`);
    if (snr !== null) lines.push(`Sensitivity for ${db2(snr)} dB SNR: ${db2(s.sensDbm)} dBm.`);
    lines.push({ math: "F = F_1 + sum(i=2, n, (F_i - 1)/prod(j=1, i-1, G_j))", fallback: "F = F₁ + (F₂ − 1)/G₁ + (F₃ − 1)/(G₁G₂) + … (linear factors, not dB)" });
    lines.push({ math: "T_e = T_0 (F - 1)", fallback: "Te = T₀(F − 1), T₀ = 290 K" });
    lines.push({ math: "S_min = 10 log_10((k T_0)/(1 mW)) + 10 log_10 B + NF + SNR", fallback: "Smin = kT₀ (dBm/Hz) + 10 log₁₀B + NF + SNR = kT₀B (dBm) + NF + SNR" });
    lines.push("Assumes matched impedances, the IEEE reference T₀ = 290 K at the input (an antenna at another temperature changes the system noise, not the receiver's NF), and a noise bandwidth equal to B.");
    const total = c.factor - 1;
    const table: string[][] = [["Stage", "Gain (dB)", "NF (dB)", "Stage Te (K)", "Cumulative gain (dB)", "Cascade NF (dB)", "Share of F − 1"]];
    for (const row of c.rows) {
      const pctShare = total > 0 ? (100 * (row.n === 1 ? row.term - 1 : row.term)) / total : NaN;
      const share = !Number.isFinite(pctShare) ? "n/a" : pctShare < 0.01 ? "< 0.01 %" : `${fmtSig(pctShare, 3)} %`;
      table.push([String(row.n), dbSigned(row.gainDb), db2(row.nfDb), fmtSig(row.teK, 4), dbSigned(row.cumGainDb), fmtSig(row.cumNfDb, 4), share]);
    }
    const outputs: EngOutput[] = [
      { key: "nf", label: "Cascade noise figure", value: c.nfDb, unit: "dB" },
      { key: "F", label: "Cascade noise factor", value: c.factor, unit: "" },
      { key: "te", label: "Noise temperature", value: c.teK, unit: "K" },
      { key: "gain", label: "Total gain", value: c.gainDb, unit: "dB" },
      { key: "ktb", label: "kT₀B", value: s.ktbDbm, unit: "dBm" },
      { key: "floor", label: "Input noise floor", value: s.floorDbm, unit: "dBm" },
    ];
    if (snr !== null) outputs.push({ key: "sens", label: "Sensitivity", value: s.sensDbm, unit: "dBm" });
    const extra: AnalyzeBlock[] = [
      { kind: "table", label: "Noise cascade", rows: table.map((row) => row.map((x) => trueMinus(x))) },
      plot(cascadeNfSvg(c.rows), "Cascade noise figure stage by stage", "Noise figure of the chain up to each stage, with each stage's own noise figure marked"),
    ];
    return finish(lines, u.conversions, extra, outputs);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 3. Eb/N0 ↔ BER
// ---------------------------------------------------------------------------------------------------------------

/** A target BER: 1e-6, 0.000001, 1×10⁻⁶ or 10^-6. NaN when unreadable. */
export function readBer(text: string): number {
  const t = (text ?? "").trim().replace(/[−–]/g, "-").replace(/\s+/g, "");
  const sup: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+" };
  const m = /^(?:([0-9]*\.?[0-9]+)[×x*])?10(?:\^([+-]?\d+)|([⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+))$/.exec(t);
  if (m) {
    const e = m[2] ?? [...m[3]].map((ch) => sup[ch]).join("");
    return (m[1] ? Number(m[1]) : 1) * Math.pow(10, Number(e));
  }
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) ? Number(t) : NaN;
}

const MODE_OPTIONS = [
  { value: "ebn0", label: "BER from Eb/N₀" },
  { value: "cn0", label: "BER from C/N₀ and data rate" },
  { value: "target", label: "Required Eb/N₀ for a target BER" },
];

const berCalc: ElecCalc = {
  id: "ber-ebn0",
  name: "Eb/N₀ ↔ bit error rate (BPSK, QPSK, DBPSK, M-PSK)",
  group: "Electronics",
  unitContract: "converts",
  hint:
    "Uncoded bit error rate in additive white Gaussian noise. BPSK and Gray-coded QPSK share Pb = ½ erfc(√(Eb/N₀)); " +
    "DBPSK is ½ exp(−Eb/N₀); 8-PSK and 16-PSK use the high-SNR approximation (checked against simulation for Pb ≤ 10⁻¹). " +
    "Go from Eb/N₀ (or C/N₀ and the data rate) to BER, or from a target BER to the Eb/N₀ it needs. M-QAM is not offered.",
  fields: [
    { key: "mod", label: "Modulation", default: "bpsk", kind: "select", options: MODULATIONS.map((m) => ({ value: m.id, label: m.label })) },
    { key: "mode", label: "Compute", default: "ebn0", kind: "select", options: MODE_OPTIONS },
    { key: "ebn0", label: "Eb/N₀ (dB)", default: "9.6", kind: "text" },
    { key: "cn0", label: "C/N₀ (dB-Hz)", default: "70", kind: "text" },
    { key: "rate", label: "Data rate (bit/s; 1 Mbps; optional except from C/N₀)", default: "1 Mbps", kind: "text" },
    { key: "target", label: "Target BER (1e-6 or 10^-6)", default: "1e-6", kind: "text" },
  ],
  compute: (r) => {
    const modId = r("mod");
    const m = MODULATIONS.find((x) => x.id === modId);
    if (!m) return refuse("Choose a modulation.");
    const mod = m.id as Modulation;
    const mode = r("mode") === "cn0" ? "cn0" : r("mode") === "target" ? "target" : "ebn0";
    const u = unitReader(r);
    const rate = u.opt("rate", "bps", "bit/s", "Data rate");
    let ebn0: number | null = null;
    let cn0: number | null = null;
    let target: number | null = null;
    if (mode === "ebn0") ebn0 = u.db("ebn0", "Eb/N₀", DB);
    else if (mode === "cn0") cn0 = u.db("cn0", "C/N₀", { "": 0, "dB-Hz": 0, dBHz: 0 });
    else {
      target = readBer(r("target"));
      if (!Number.isFinite(target)) u.errors.push(`Target BER: "${r("target")}" is not a number (write 1e-6 or 10^-6).`);
    }
    if (rate !== null && !(rate > 0)) u.errors.push("Data rate: it must be greater than zero.");
    if (mode === "cn0" && rate === null) u.errors.push("Data rate: needed to go from C/N₀ to Eb/N₀.");
    if (u.errors.length) return refuse(u.errors.join("\n"));

    const lines: EngLine[] = [];
    const outputs: EngOutput[] = [];
    let point: { ebn0Db: number; ber: number } | null = null;
    const k = m.bits;
    if (mode === "target") {
      const q = requiredEbN0(mod, target as number);
      if (!q.ok) return refuse(q.error);
      const b = berAt(mod, q.ebn0Db);
      if (!b.ok) return refuse(b.error);
      point = { ebn0Db: q.ebn0Db, ber: target as number };
      lines.push(`Required Eb/N₀ for BER ${fmtSig(target as number, 3)} with ${m.label}: ${fmtSig(q.ebn0Db, 6)} dB (Es/N₀ ${fmtSig(q.esn0Db, 6)} dB at ${k} bit${k > 1 ? "s" : ""} per symbol).`);
      outputs.push({ key: "ebn0", label: "Required Eb/N₀", value: q.ebn0Db, unit: "dB" }, { key: "esn0", label: "Required Es/N₀", value: q.esn0Db, unit: "dB" });
      if (rate !== null) {
        const c = cn0FromEbn0(q.ebn0Db, rate);
        lines.push(`At ${trimSig(rate)} bit/s that needs C/N₀ = ${db2(c)} dB-Hz.`);
        outputs.push({ key: "cn0", label: "Required C/N₀", value: c, unit: "dB-Hz" });
      }
    } else {
      const e = mode === "cn0" ? ebn0FromCn0(cn0 as number, rate as number) : (ebn0 as number);
      const b = berAt(mod, e);
      if (!b.ok) return refuse(mode === "cn0" ? `${b.error} (C/N₀ ${db2(cn0 as number)} dB-Hz at ${trimSig(rate as number)} bit/s gives Eb/N₀ = ${db2(e)} dB.)` : b.error);
      if (b.outsideApprox)
        return refuse(`At Eb/N₀ = ${db2(e)} dB the ${m.label} approximation gives Pb above 10⁻¹, where it was not checked against simulation; it is not used there. Raise Eb/N₀ or choose BPSK, QPSK or DBPSK.`);
      point = { ebn0Db: e, ber: b.ber };
      if (mode === "cn0") lines.push(`Eb/N₀ = C/N₀ − 10 log₁₀ Rb = ${db2(cn0 as number)} − ${db2(rateDb(rate as number))} = ${db2(e)} dB.`);
      const berText = b.ber === 0 ? "below 10⁻³⁰⁰ (underflows double precision)" : fmtSig(b.ber, 6);
      lines.push(`Bit error rate with ${m.label} at Eb/N₀ = ${db2(e)} dB: ${berText}${b.ber > 0 && b.ber < 1e-15 ? " (far below anything a link test can measure)" : ""}.`);
      lines.push(`Es/N₀ = ${db2(b.esn0Db)} dB at ${k} bit${k > 1 ? "s" : ""} per symbol.`);
      outputs.push({ key: "ber", label: "Bit error rate", value: b.ber, unit: "" }, { key: "ebn0", label: "Eb/N₀", value: e, unit: "dB" }, { key: "esn0", label: "Es/N₀", value: b.esn0Db, unit: "dB" });
      if (mode === "ebn0" && rate !== null) {
        const c = cn0FromEbn0(e, rate);
        lines.push(`At ${trimSig(rate)} bit/s this Eb/N₀ corresponds to C/N₀ = ${db2(c)} dB-Hz.`);
        outputs.push({ key: "cn0", label: "C/N₀", value: c, unit: "dB-Hz" });
      }
    }
    if (mod === "bpsk" || mod === "qpsk") lines.push({ math: "P_b = (1/2) erfc(sqrt(E_b/N_0))", fallback: "Pb = ½ erfc(√(Eb/N₀))" });
    else if (mod === "dbpsk") lines.push({ math: "P_b = (1/2) exp(-E_b/N_0)", fallback: "Pb = ½ exp(−Eb/N₀)" });
    else {
      lines.push({ math: "P_s ≈ 2 Q(sqrt(2 E_s/N_0) sin(π/M))", fallback: "Ps ≈ 2Q(√(2Es/N₀)·sin(π/M))" });
      lines.push({ math: "P_b ≈ P_s/(log_2 M)", fallback: "Pb ≈ Ps/log₂M (Gray coding)" });
    }
    lines.push({ math: "E_b/N_0 = (C/N_0)/R_b", fallback: "Eb/N₀ = (C/N₀)/Rb, in dB: Eb/N₀ = C/N₀ (dB-Hz) − 10 log₁₀Rb" });
    lines.push(
      (mod === "qpsk" ? "QPSK with Gray coding has the same bit error rate as BPSK at the same Eb/N₀. " : "") +
        (m.approx
          ? "The M-PSK curve is the high-SNR (nearest-neighbour) approximation with Gray coding; a Gray-coded Monte Carlo simulation agreed within 4 % (8-PSK checked down to Pb ≈ 10⁻⁵, 16-PSK down to 1.25×10⁻⁴; the approximation tightens as Eb/N₀ rises). "
          : "") +
        "Assumes uncoded transmission, additive white Gaussian noise, coherent detection (differential for DBPSK) with perfect synchronisation; sources: Wikipedia, “Phase-shift keying” (citing Xiong; Stüber), and MathWorks, “Analytical Expressions Used in berawgn Function”.",
    );
    const extra: AnalyzeBlock[] = [
      plot(
        berWaterfallSvg(mod, point, target),
        `BER waterfall, ${m.label}`,
        `Bit error rate on a logarithmic axis against Eb/N₀ in dB for ${m.label}, with the operating point marked` + (target !== null ? " and the target BER line" : ""),
      ),
    ];
    return finish(lines, u.conversions, extra, outputs);
  },
};

/** The link-budget calculators, for the integrator to spread into ENG_CALCS (group "Electronics"). */
export const LINK_BUDGET_CALCS: ElecCalc[] = [linkCalc, cascadeCalc, berCalc];
