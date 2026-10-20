/**
 * @jest-environment jsdom
 */
// The Characterization pane over its real markup: typing reaches the engine, the preview is the
// text that inserts, Insert hands Word an OOXML package of runs (italic J, subscripts), From Build
// takes the drawn structure, and the checks list what the engine found.
import * as fs from "fs";
import * as path from "path";
import { initCharzPane } from "../../taskpane/charzPane";

const PANE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");
const SECTION = /<section id="charz-section">[\s\S]*?<\/section>/.exec(PANE_HTML)![0];

function setup(buildSmiles: string | null = null) {
  document.body.innerHTML = SECTION;
  const status: Array<[string, string]> = [];
  const inserted: string[] = [];
  const api = initCharzPane({
    setStatus: (t, k) => void status.push([t, k ?? ""]),
    insertOoxml: async (ooxml) => {
      inserted.push(ooxml);
      return true;
    },
    buildSmiles: () => buildSmiles,
  });
  const set = (id: string, v: string) => {
    const el = document.getElementById(id) as HTMLInputElement;
    el.value = v;
    el.dispatchEvent(new Event("input"));
  };
  return { api, status, inserted, set };
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

describe("Characterization pane", () => {
  it("is in the pane's tool list and has every control the module reads", () => {
    expect(PANE_HTML).toContain('<option value="charz">Characterization</option>');
    setup();
    expect(($("charz-solvent") as HTMLSelectElement).options.length).toBeGreaterThan(5);
    expect(($("charz-ms-ion") as HTMLSelectElement).options.length).toBe(11);
    expect($("charz-source").textContent).toMatch(/J\. Org\. Chem\./);
    expect(($("charz-insert") as HTMLButtonElement).disabled).toBe(true);
  });

  it("typing a list reaches the engine; Insert puts the previewed text in as runs", async () => {
    const { api, inserted, set } = setup();
    set("charz-compound", "CC(=O)OCc1ccccc1");
    set("charz-h-list", "1H NMR (400 MHz, Chloroform-d) δ 7.36 – 7.27 (m, 5H), 5.12 (s, 2H), 2.10 (s, 3H).");
    api.update();
    expect($("charz-preview").textContent).toBe("¹H NMR (CDCl3, 400 MHz): δ 7.36–7.27 (m, 5H), 5.12 (s, 2H), 2.10 (s, 3H).".replace("¹H", "1H"));
    expect($("charz-preview").innerHTML).toContain("CDCl<sub>3</sub>");
    expect($("charz-checks").textContent).toMatch(/matching the formula/);
    ($("charz-insert") as HTMLButtonElement).click();
    await Promise.resolve();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toContain('<w:vertAlign w:val="subscript"/></w:rPr><w:t xml:space="preserve">3</w:t>');
    expect(inserted[0]).toContain('<w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">1</w:t>');
    expect(inserted[0]).not.toMatch(/&lt;sub&gt;/);
  });

  it("HRMS with the italic m/z and J, in one paragraph after the NMR lines", async () => {
    const { api, inserted, set } = setup();
    set("charz-compound", "caffeine");
    set("charz-h-list", "7.51 (s, 1H), 3.99 (s, 3H), 3.57 (s, 3H), 3.40 (s, 3H)");
    const on = $("charz-ms-on") as HTMLInputElement;
    on.checked = true;
    on.dispatchEvent(new Event("change"));
    set("charz-ms-found", "195.0874");
    api.update();
    const lines = api.lines();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("<i>m</i>/<i>z</i>: [M + H]<sup>+</sup> Calcd for C<sub>8</sub>H<sub>11</sub>N<sub>4</sub>O<sub>2</sub> 195.0877; Found 195.0874.");
    ($("charz-insert") as HTMLButtonElement).click();
    await Promise.resolve();
    expect((inserted[0].match(/<w:p>/g) ?? []).length).toBe(1);
    expect(inserted[0]).toContain("<w:i/><w:iCs/></w:rPr><w:t xml:space=\"preserve\">m</w:t>");
  });

  it("an unread segment shows as an error, and Insert says checks are still flagged", async () => {
    const { api, status, set } = setup();
    set("charz-h-list", "7.26 (d, J = 8.0 Hz, 2H), see SI");
    api.update();
    expect($("charz-checks").querySelector(".charz-error")!.textContent).toMatch(/see SI/);
    ($("charz-insert") as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(status.some(([t]) => /still flagged/.test(t))).toBe(true);
  });

  it("From Build takes the drawn structure; with nothing drawn it says so", () => {
    const a = setup("CC(=O)OCc1ccccc1");
    $("charz-from-build").click();
    expect(($("charz-compound") as HTMLInputElement).value).toBe("smiles:CC(=O)OCc1ccccc1");
    expect($("charz-compound-info").textContent).toMatch(/C9H10O2 · MW 150\.18 g\/mol · 10 ¹H/);
    const b = setup(null);
    $("charz-from-build").click();
    expect(b.status.some(([t, k]) => /Nothing drawn in Build/.test(t) && k === "error")).toBe(true);
    void a;
  });

  it("style and solvent selects re-render at once", () => {
    const { api, set } = setup();
    set("charz-h-list", "7.26 (d, J = 8.0 Hz, 2H)");
    const style = $("charz-style") as HTMLSelectElement;
    style.value = "common";
    style.dispatchEvent(new Event("change"));
    const solv = $("charz-solvent") as HTMLSelectElement;
    solv.value = "DMSO-d6";
    solv.dispatchEvent(new Event("change"));
    expect(api.lines()[0]).toBe("<sup>1</sup>H NMR (DMSO-<i>d</i><sub>6</sub>) δ 7.26 (d, <i>J</i> = 8.0 Hz, 2H).");
  });

  it("user text is escaped before it reaches the preview", () => {
    const { api, set } = setup();
    set("charz-h-list", "7.26 (s, 1H, <img src=x onerror=alert(1)>)");
    set("charz-state", "<b>oil</b>");
    set("charz-mass", "10");
    api.update();
    expect($("charz-preview").querySelector("img")).toBeNull();
    expect($("charz-preview").querySelector("b")).toBeNull();
    expect($("charz-preview").textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("Characterization reads the document's compound register (v2.167.0)", () => {
  it("“compound 3” is the registered structure, and the check list says so", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { compoundFieldInput, mergeIntoRegister } = require("../compoundRegister");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildScheme, parseScheme } = require("../scheme");
    const b = buildScheme(parseScheme("aspirin (3)"));
    const register = mergeIntoRegister({ entries: [] }, b.compounds).register;
    document.body.innerHTML = SECTION;
    const api = initCharzPane({
      setStatus: () => undefined,
      insertOoxml: async () => true,
      buildSmiles: () => null,
      compoundInput: (t, reads) => compoundFieldInput(register, t, reads),
    });
    const c = document.getElementById("charz-compound") as HTMLInputElement;
    c.value = "compound 3";
    api.update();
    expect($("charz-compound-info").textContent).toMatch(/C9H8O4|C₉H₈O₄/);
    expect($("charz-checks").textContent).toMatch(/Compound 3 of this document: C₉H₈O₄ \(aspirin\)/);
  });
});
