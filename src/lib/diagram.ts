// The Diagrams tool's engine entry (docs/SCOPE-DIAGRAMS.md): one call per kind, the same result shape for all.

import { MAX_SHEETS, SHEET_HEIGHT_PT, SHEET_WIDTH_PT, type DiagramOptions, type DiagramResult } from "./diagramCore";
import { drawFlow, parseFlow } from "./diagramFlow";
import { drawSequence } from "./diagramSeq";
import { drawTiming } from "./diagramTiming";
import { drawSchematic } from "./diagramSchematic";

export type DiagramKind = "block" | "flowchart" | "state" | "sequence" | "timing" | "schematic";

export const DIAGRAM_KINDS: Array<{ id: DiagramKind; name: string; example: string }> = [
  { id: "block", name: "Block diagram", example: "104 Physiological sensor\n106 Physiological sensor\n112 Control circuit\n108 Automatically activated scent diffuser\n104 -> 112\n106 -> 112\n112 -> 108" },
  { id: "flowchart", name: "Flowchart", example: "start\n405 Detect a physiological parameter of a user\n? 410 Is the user entering a hypnogogic state?\n410 yes -> 415\n410 no -> 405\n415 Trigger release of a scent\nend" },
  { id: "state", name: "State diagram", example: "[*] -> Idle\nIdle -> Monitoring : sensor on\nMonitoring -> Releasing : sleep onset\nReleasing -> Idle : done\nMonitoring -> Idle : sensor off" },
  { id: "sequence", name: "Sequence diagram", example: "participant 102 Sensor\nparticipant 112 Control circuit\nparticipant 108 Diffuser\n102 -> 112 : heart rate\n112 -> 112 : classify state\n112 -> 108 : release\n108 --> 112 : done" },
  { id: "timing", name: "Timing diagram", example: "CLK: clock 8\nEN: 0 1 1 1 1 1 0 0\nDATA: x x A0 A0 D1 D1 x x\nREADY: 0 0 0 0 1 1 0 0" },
  { id: "schematic", name: "Schematic", example: "V1 vsource 0,0 0,-2 5V\nwire 0,0 1,0\nR1 resistor 1,0 3,0 10k\nwire 3,0 4,0\nC1 capacitor 4,0 4,-2 100nF\nwire 0,-2 4,-2\nGND ground 2,-2\nlabel VOUT 4,0" },
];

export function buildDiagram(kind: DiagramKind, input: string, opts: DiagramOptions = {}): DiagramResult {
  const r = draw(kind, input, opts);
  // Every kind under one size bound: past MAX_SHEETS sheets either way a figure cannot be inserted legibly.
  if (r.ok && (!Number.isFinite(r.widthPt) || !Number.isFinite(r.heightPt) || r.widthPt > SHEET_WIDTH_PT * MAX_SHEETS || r.heightPt > SHEET_HEIGHT_PT * MAX_SHEETS)) {
    return {
      ok: false,
      errors: [`This figure would be ${(r.widthPt / 72 * 2.54).toFixed(0)} × ${(r.heightPt / 72 * 2.54).toFixed(0)} cm — more than ${MAX_SHEETS} sheets; split it or shorten the labels.`],
      notes: r.notes,
    };
  }
  return r;
}

function draw(kind: DiagramKind, input: string, opts: DiagramOptions): DiagramResult {
  switch (kind) {
    case "block":
    case "flowchart":
    case "state":
      return drawFlow(kind, parseFlow(kind, input), opts);
    case "sequence":
      return drawSequence(input, opts);
    case "timing":
      return drawTiming(input, opts);
    case "schematic":
      return drawSchematic(input, opts);
  }
}
