/**
 * @jest-environment jsdom
 */
// The Diagrams pane over its real markup: Example fills the box, the preview is the figure that inserts, the notes
// list the engine's refusals, Insert hands the same SVG to the picture insert.
import * as fs from "fs";
import * as path from "path";
import { initDiagramPane } from "../../taskpane/diagramPane";

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="diagram-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function setup() {
  document.body.innerHTML = SECTION;
  const inserted: Array<{ svg: string; w: number; h: number; alt: string }> = [];
  const status: string[] = [];
  const api = initDiagramPane({
    setStatus: (t) => void status.push(t),
    insertPicture: async (svg, w, h, alt) => {
      inserted.push({ svg, w, h, alt });
      return true;
    },
  });
  return { api, inserted, status };
}

describe("Diagrams pane", () => {
  it("is in the tool list with every control the module reads", () => {
    expect(PANE_HTML).toContain('<option value="diagram">Diagrams</option>');
    setup();
    expect(($("diagram-kind") as HTMLSelectElement).options.length).toBe(6);
    expect(($("diagram-insert") as HTMLButtonElement).disabled).toBe(true);
    expect($("diagram-help").textContent).toMatch(/104 -> 112/);
  });
  it("Example draws the kind's figure; Insert hands the preview's SVG to the picture insert", async () => {
    const { inserted, status } = setup();
    for (const kind of ["block", "flowchart", "state", "sequence", "timing", "schematic"]) {
      ($("diagram-kind") as HTMLSelectElement).value = kind;
      $("diagram-kind").dispatchEvent(new Event("change"));
      $("diagram-example").click();
      expect($("diagram-preview").innerHTML).toMatch(/^<svg/);
      expect(($("diagram-insert") as HTMLButtonElement).disabled).toBe(false);
    }
    const shown = $("diagram-preview").innerHTML;
    $("diagram-insert").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(inserted).toHaveLength(1);
    expect(inserted[0].alt).toMatch(/Schematic \(JurisLab\), FIG\. 1:/);
    expect(shown).toContain("FIG. 1");
    expect(status.join(" ")).toMatch(/FIG\. 1 inserted/);
  });
  it("refusals show as notes and Insert stays off", () => {
    setup();
    ($("diagram-input") as HTMLTextAreaElement).value = "104 Sensor\n104 -> 999";
    ($("diagram-kind") as HTMLSelectElement).dispatchEvent(new Event("change"));
    expect($("diagram-notes").textContent).toMatch(/refers to “999”, which is not defined/);
    expect(($("diagram-insert") as HTMLButtonElement).disabled).toBe(true);
  });
});
