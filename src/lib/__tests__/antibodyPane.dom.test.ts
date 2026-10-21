/**
 * @jest-environment jsdom
 */
// The Antibody pane over its real markup: Example fills the box, the CDR and identity tables and the claim text come
// from the engine, the options reach it, and each Insert hands over what the pane shows.
import * as fs from "fs";
import * as path from "path";
import { ANTIBODY_EXAMPLE, initAntibodyPane } from "../../taskpane/antibodyPane";

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="antibody-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const BUTTONS = ["cdrs", "regions", "numbering", "identity", "annotated", "claims", "seqids"].map((b) => `ab-insert-${b}`);

function setup(textOk = true) {
  document.body.innerHTML = SECTION;
  const tables: Array<{ rows: string[][]; label: string }> = [];
  const texts: string[] = [];
  const html: string[] = [];
  const status: string[] = [];
  initAntibodyPane({
    setStatus: (t) => void status.push(t),
    insertTable: async (rows, label) => void tables.push({ rows, label }),
    insertText: async (t) => {
      texts.push(t);
      return textOk;
    },
    insertHtml: async (h) => void html.push(h),
  });
  return { tables, texts, html, status };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const choose = (id: string, v: string) => {
  ($(id) as HTMLSelectElement).value = v;
  $(id).dispatchEvent(new Event("change"));
};
const cells = (id: string) => [...$(id).querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => c.textContent));

describe("Antibody pane", () => {
  it("is in the tool list and starts with nothing to insert", () => {
    expect(PANE_HTML).toContain('<option value="antibody">Antibody</option>');
    setup();
    for (const id of BUTTONS) expect(($(id) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Example: Kabat CDRs of trastuzumab, an identity matrix, and claim text", () => {
    setup();
    $("ab-example").click();
    const rows = cells("ab-cdrs");
    expect(rows).toHaveLength(5);
    expect(rows[1].slice(2)).toEqual(["DTYIH (H1, 5)", "RIYPTNGYTRYADSVKG (H2, 17)", "WGGDGFYAMDY (H3, 11)"]);
    expect(rows[2].slice(2).map((c) => c!.split(" ")[0])).toEqual(["RASQDVNTAVA", "SASFLYS", "QQHYTTPPT"]);
    expect(cells("ab-identity").length).toBe(5);
    expect($("ab-claims").textContent).toMatch(/SEQ ID NO: 1/);
    for (const id of BUTTONS) expect(($(id) as HTMLButtonElement).disabled).toBe(false);
  });

  it("the definition reaches the table and the claims; the first SEQ ID NO reaches the claims", async () => {
    setup();
    $("ab-example").click();
    choose("ab-def", "imgt");
    expect(cells("ab-cdrs")[1][4]).toMatch(/^SRWGGDGFYAMDY /);
    expect($("ab-claims").textContent).toMatch(/IMGT/);
    ($("ab-seqid") as HTMLInputElement).value = "21";
    $("ab-seqid").dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 250));
    expect($("ab-claims").textContent).toMatch(/SEQ ID NO: 21/);
    expect($("ab-claims").textContent).not.toMatch(/SEQ ID NO: 1\b/);
  });

  it("each Insert hands over what is shown", async () => {
    const { tables, texts, html, status } = setup();
    $("ab-example").click();
    for (const id of BUTTONS) {
      $(id).click();
      await flush();
    }
    expect(tables[0].rows).toEqual(cells("ab-cdrs"));
    expect(tables[0].label).toBe("CDRs (Kabat)");
    // regions and numbering: one table per chain (4 chains each), then identity, then the SEQ ID table.
    expect(tables).toHaveLength(1 + 4 + 4 + 1 + 1);
    expect(tables[9].rows).toEqual(cells("ab-identity"));
    expect(tables[10].rows[0]).toEqual(["SEQ ID NO", "Description", "Sequence"]);
    expect(html[0]).toContain("<b><u>DTYIH</u></b>");
    expect(texts[0]).toBe($("ab-claims").textContent);
    expect(status.at(-1)).toBe("SEQ ID table inserted.");
  });

  it("a claim insert the host declined says nothing of success", async () => {
    const { status } = setup(false);
    $("ab-example").click();
    $("ab-insert-claims").click();
    await flush();
    expect(status).toEqual([]);
  });

  it("a first SEQ ID NO that is not a whole number from 1 is said; claims and the SEQ ID table wait for one", async () => {
    setup();
    $("ab-example").click();
    for (const bad of ["0", "-5", "2.5", "abc", "", "1000000"]) {
      ($("ab-seqid") as HTMLInputElement).value = bad;
      choose("ab-def", "kabat");
      expect($("ab-notes").textContent).toMatch(/First SEQ ID NO: a whole number from 1 to 999999\./);
      expect($("ab-claims").textContent).toBe("");
      expect(($("ab-insert-claims") as HTMLButtonElement).disabled).toBe(true);
      expect(($("ab-insert-seqids") as HTMLButtonElement).disabled).toBe(true);
      expect(($("ab-insert-cdrs") as HTMLButtonElement).disabled).toBe(false);
    }
    ($("ab-seqid") as HTMLInputElement).value = "100000";
    choose("ab-def", "kabat");
    expect($("ab-claims").textContent).toMatch(/SEQ ID NO: 100000\b/);
    expect(($("ab-insert-claims") as HTMLButtonElement).disabled).toBe(false);
  });

  it("one VH and one VL: nothing of one kind to compare, so Identity stays off", () => {
    setup();
    ($("ab-input") as HTMLTextAreaElement).value = ANTIBODY_EXAMPLE.split("\n").slice(0, 4).join("\n");
    choose("ab-def", "kabat");
    expect(cells("ab-cdrs")).toHaveLength(3);
    expect(cells("ab-identity")).toEqual([]);
    expect(($("ab-insert-identity") as HTMLButtonElement).disabled).toBe(true);
  });

  it("one chain: no identity matrix, Identity stays off; nonsense clears everything", () => {
    setup();
    ($("ab-input") as HTMLTextAreaElement).value = ">VH\nEVQLVESGGGLVQPGGSLRLSCAASGFNIKDTYIHWVRQAPGKGLEWVARIYPTNGYTRYADSVKGRFTISADTSKNTAYLQMNSLRAEDTAVYYCSRWGGDGFYAMDYWGQGTLVTVSS";
    choose("ab-def", "kabat");
    expect(cells("ab-identity")).toEqual([]);
    expect(($("ab-insert-identity") as HTMLButtonElement).disabled).toBe(true);
    expect(($("ab-insert-cdrs") as HTMLButtonElement).disabled).toBe(false);
    ($("ab-input") as HTMLTextAreaElement).value = ">x\nHELLO";
    choose("ab-def", "kabat");
    expect(cells("ab-cdrs")).toEqual([]);
    expect($("ab-notes").querySelector(".scheme-error")).not.toBeNull();
    for (const id of BUTTONS) expect(($(id) as HTMLButtonElement).disabled).toBe(true);
  });
});
