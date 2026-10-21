// The Diagrams tool's pane (docs/SCOPE-DIAGRAMS.md): the kind, the text, the numeral style and the FIG number in, a
// live preview out; Insert hands the SAME SVG the preview shows to the pane's picture insert. All parsing, layout and
// drawing is lib/diagram*.ts.

import { buildDiagram, DIAGRAM_KINDS, DiagramKind } from "../lib/diagram";
import type { NumeralStyle } from "../lib/diagramCore";

export interface DiagramPaneDeps {
  setStatus: (text: string, kind?: "success" | "error" | "") => void;
  /** Inserts the figure as a picture at its natural size; true when it reached the document. */
  insertPicture: (svg: string, widthPt: number, heightPt: number, alt: string) => Promise<boolean>;
}

export interface DiagramPaneApi {
  update: () => void;
}

const HELP: Record<DiagramKind, string> = {
  block: "One box per line: numeral and label (104 Physiological sensor). Arrows: 104 -> 112; a plain line: 104 -- 112; both ways: 104 <-> 112.",
  flowchart: "start, then one step per line (405 Detect a parameter), decisions with ? (? 410 Asleep?), end. Steps follow in order; a decision's exits: 410 yes -> 415, 410 no -> 405.",
  state: "Transitions: Idle -> Active : start. [*] -> Idle is the initial state; Active -> [*] a final one. Give a state a numeral with a line like 202 Idle.",
  sequence: "participant 102 Client, then messages: 102 -> 104 : request, and replies (dashed): 104 --> 102 : response.",
  timing: "One signal per line: NAME: levels per period — 0, 1, x (unknown), z (high impedance), or a bus value (A0); CLK: clock 8 draws 8 periods.",
  schematic: "Parts on a grid (x right, y up): R1 resistor 0,0 2,0 10k; GND ground 2,-2; Q1 npn 3,1; U1 opamp 5,0; wire 0,0 0,-2; label VOUT 4,0. A reference numeral: add #210.",
};

export function initDiagramPane(deps: DiagramPaneDeps): DiagramPaneApi {
  const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const kind = el<HTMLSelectElement>("diagram-kind");
  const input = el<HTMLTextAreaElement>("diagram-input");
  const exampleBtn = el<HTMLButtonElement>("diagram-example");
  const numerals = el<HTMLSelectElement>("diagram-numerals");
  const fig = el<HTMLInputElement>("diagram-fig");
  const figNum = el<HTMLInputElement>("diagram-fignum");
  const help = el<HTMLElement>("diagram-help");
  const preview = el<HTMLElement>("diagram-preview");
  const notesEl = el<HTMLElement>("diagram-notes");
  const insertBtn = el<HTMLButtonElement>("diagram-insert");

  let current: { svg: string; widthPt: number; heightPt: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inserting = false;

  const showNotes = (errors: string[], notes: string[]): void => {
    notesEl.replaceChildren();
    for (const [list, cls] of [[errors, "scheme-error"], [notes, "scheme-warn"]] as const) {
      for (const t of list) {
        const li = document.createElement("li");
        li.className = cls;
        li.textContent = t;
        notesEl.appendChild(li);
      }
    }
  };

  const update = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    const k = kind.value as DiagramKind;
    help.textContent = HELP[k];
    current = null;
    insertBtn.disabled = true;
    if (!input.value.trim()) {
      preview.replaceChildren();
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = "Type the diagram, or press Example.";
      preview.appendChild(hint);
      notesEl.replaceChildren();
      return;
    }
    const r = buildDiagram(k, input.value, {
      fig: fig.value.trim() || null,
      numerals: numerals.value as NumeralStyle,
      figureNumeral: figNum.value.trim() || null,
    });
    if (!r.ok) {
      preview.replaceChildren();
      showNotes(r.errors, r.notes);
      return;
    }
    // The engine escapes every piece of text it draws.
    preview.innerHTML = r.svg;
    showNotes([], r.notes);
    current = { svg: r.svg, widthPt: r.widthPt, heightPt: r.heightPt };
    insertBtn.disabled = inserting;
  };
  const soon = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(update, 150);
  };

  input.addEventListener("input", soon);
  for (const c of [fig, figNum]) c.addEventListener("input", soon);
  for (const c of [kind, numerals]) c.addEventListener("change", update);
  exampleBtn.addEventListener("click", () => {
    const k = DIAGRAM_KINDS.find((x) => x.id === kind.value);
    if (!k) return;
    input.value = k.example;
    if (!fig.value.trim()) fig.value = "1";
    update();
  });
  insertBtn.addEventListener("click", async () => {
    update();
    if (!current || inserting) return;
    inserting = true;
    insertBtn.disabled = true;
    const k = DIAGRAM_KINDS.find((x) => x.id === kind.value)!;
    const label = fig.value.trim() ? `FIG. ${fig.value.trim()}` : k.name;
    try {
      const ok = await deps.insertPicture(current.svg, current.widthPt, current.heightPt, `${k.name} (JurisLab)${fig.value.trim() ? `, ${label}` : ""}: ${input.value.trim().replace(/\s*\n\s*/g, "; ").slice(0, 900)}`);
      if (ok) deps.setStatus(`${label} inserted at its drawn size (lettering ≥ 1/8 in).`, "success");
    } finally {
      inserting = false;
      insertBtn.disabled = !current;
    }
  });
  update();
  return { update };
}
