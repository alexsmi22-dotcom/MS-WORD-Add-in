// Pane glue for the TLC plate calculator (Chemistry & electrochemistry): lanes of spots → an Rf table and the
// schematic plate. Kept out of taskpane.ts so the object the pane registers is the object the tests run (the pattern
// of titrationCalcs.ts). No number is computed here beyond what tlc.ts reads; this file words the result under the
// display contract (U+2212, no em dash, no e-notation) and draws through tlcChart.ts.

import { engReport } from "./engReport";
import type { AnalyzeBlock, AnalyzeOutput } from "./analyzeBlocks";
import { trueMinus } from "./numberList";
import { CHEM_ENG_GROUP, type ChemEngCalc } from "./titrationCalcs";
import { plainNum, readTlc, rf2, TLC_MAX_LANES, TLC_MAX_SPOTS, type TlcStyle } from "./tlc";
import { tlcPlateSvg } from "./tlcChart";
import { typesetLabel } from "./spectrumOverlay";

const refuse = (text: string): AnalyzeOutput => ({ text: trueMinus(text.replace(/—/g, "-")).replace(/[“”]/g, '"'), ok: false });

/** A distance as typed back: up to 4 significant figures, never e-notation. */
const dist = (v: number): string => plainNum(Number(v.toPrecision(4)));

export const tlcCalc: ChemEngCalc = {
  id: "chem-tlc",
  name: "TLC plate",
  group: CHEM_ENG_GROUP,
  hint:
    "Thin-layer chromatography: one lane per line, label then spots (SM: 0.62 / co: 0.62, 0.35 / rxn: 0.35). Give Rf values, or each spot's distance from the origin with the solvent front's distance (Rf = spot distance ÷ front distance). Draws the plate schematic: origin, solvent front, lanes and spots, outlined (UV) or filled (stained). Up to " +
    `${TLC_MAX_LANES} lanes and ${TLC_MAX_SPOTS} spots per lane.`,
  fields: [
    { key: "lanes", label: "Lanes (label: spots, one lane per line)", default: "SM: 0.62\nco: 0.62, 0.35\nrxn: 0.35", kind: "block", rows: 4 },
    {
      key: "mode",
      label: "Spots given as",
      default: "rf",
      kind: "select",
      options: [
        { value: "rf", label: "Rf values" },
        { value: "distance", label: "Distances from the origin" },
      ],
    },
    { key: "front", label: "Solvent front distance from the origin (cm or mm; distances only)", default: "", kind: "text" },
    { key: "eluent", label: "Eluent (optional)", default: "hexanes/EtOAc 4:1", kind: "text" },
    { key: "plate", label: "Plate size, width × height (optional, e.g. 2.5 × 7.5 cm)", default: "", kind: "text" },
    {
      key: "style",
      label: "Spots",
      default: "uv",
      kind: "select",
      options: [
        { value: "uv", label: "Outlined (UV, circled)" },
        { value: "stain", label: "Filled (stained)" },
      ],
    },
  ],
  compute: (read) => {
    const mode = read("mode") === "distance" ? "distance" : "rf";
    const style: TlcStyle = read("style") === "stain" ? "stain" : "uv";
    const r = readTlc({ lanes: read("lanes"), mode, front: read("front"), eluent: read("eluent"), plate: read("plate"), style });
    if (!r.ok) return refuse(r.error);
    const p = r.plate;
    const fig = tlcPlateSvg(p);
    const lines: string[] = [];
    lines.push(`TLC${p.eluent ? ` (${typesetLabel(p.eluent)})` : ""}: ${p.lanes.length} lane${p.lanes.length > 1 ? "s" : ""}, spots ${style === "stain" ? "stained" : "visualised under UV (outlined)"}.`);
    for (const l of p.lanes) {
      const vals = l.spots.map((s) => (mode === "distance" ? `${dist(s.distance as number)} ${p.unit} → Rf ${rf2(s.rf)}` : `Rf ${rf2(s.rf)}`));
      lines.push(`${l.label}: ${vals.join("; ")}`);
    }
    if (mode === "distance") lines.push(`Solvent front: ${dist(p.unit === "mm" ? (p.front as number) * 10 : (p.front as number))} ${p.unit} from the origin. Rf = spot distance ÷ front distance, both from the origin.`);
    for (const n of [...r.notes, ...fig.notes]) lines.push(`Note: ${n}`);
    lines.push("The plate is a schematic: spot positions follow the Rf values; spot size and shape are not measured.");
    const plot: AnalyzeBlock = { kind: "plot", svg: fig.svg, caption: `TLC plate${p.eluent ? `, ${typesetLabel(p.eluent)}` : ""}`, alt: `TLC plate schematic with ${p.lanes.length} lanes (${p.lanes.map((l) => l.label).join(", ")}), origin and solvent front marked`, w: fig.width, h: fig.height };
    return engReport(lines.map((l) => trueMinus(l)), [plot]);
  },
};

/** The TLC calculator, for the Chemistry & electrochemistry group. */
export const TLC_CALCS: ChemEngCalc[] = [tlcCalc];
