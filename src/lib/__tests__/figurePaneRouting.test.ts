/**
 * Routing, not engine (v2.143.0): the pane must REACH the figure-style, bracket and
 * panel engines. A green insertCapability / statsBrackets / panels suite proves
 * nothing about whether a click in the pane gets there (three Solve features were
 * once unreachable while fully tested). taskpane.ts cannot be imported under jest,
 * so the wiring is asserted on its source and markup; the decisions themselves are
 * exercised for real in insertCapability.test.ts and statsBrackets.test.ts.
 */
import * as fs from "fs";
import * as path from "path";
import { FIGURE_PRESET_CHOICES } from "../insertCapability";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
const HTML = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.html"), "utf8");

/** The body of a top-level pane function. */
function fnBody(name: string): string {
  const a1 = PANE.indexOf(`\nasync function ${name}(`);
  const a2 = PANE.indexOf(`\nfunction ${name}(`);
  const at = a1 >= 0 ? a1 : a2;
  expect({ name, found: at >= 0 }).toEqual({ name, found: true });
  const ends = [PANE.indexOf("\nfunction ", at + 10), PANE.indexOf("\nasync function ", at + 10), PANE.indexOf("\nconst ", at + 10), PANE.indexOf("\ninterface ", at + 10)].filter((n) => n > 0);
  return PANE.slice(at, Math.min(...ends));
}

/** The option values of a <select id="…"> in the markup. */
function optionValues(id: string): string[] {
  const m = new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`).exec(HTML);
  expect({ id, found: !!m }).toEqual({ id, found: true });
  return [...(m as RegExpExecArray)[1].matchAll(/<option value="([^"]+)"/g)].map((x) => x[1]);
}

/** The modes listed in the pane's FIGURE_STYLE_MODES set. */
function figureStyleModes(): string[] {
  const m = /const FIGURE_STYLE_MODES = new Set<string>\(\[([^\]]*)\]\)/.exec(PANE);
  expect(m).not.toBeNull();
  return [...(m as RegExpExecArray)[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
}

describe("the figure-style picker reaches prepareFigure", () => {
  test("the markup offers exactly the styles the engine knows, As drawn first and selected", () => {
    expect(optionValues("figstyle-select")).toEqual([...FIGURE_PRESET_CHOICES]);
    expect(HTML).toMatch(/<option value="asdrawn" selected>/);
    expect(optionValues("figstyle-width")).toEqual(["single", "oneAndHalf", "double"]);
  });
  test("vector insert is an explicit opt-in, unticked by default", () => {
    const m = /<input type="checkbox" id="figstyle-vector"([^>]*)>/.exec(HTML);
    expect(m).not.toBeNull();
    expect((m as RegExpExecArray)[1]).not.toMatch(/checked/);
    expect(fnBody("hostCapability")).toMatch(/vectorRequested: !!figVectorCheckbox\?\.checked/);
  });
  test("insertFigure: style → prepareFigure, host → decideInsertRoute(hostCapability()), dpi from the PNG's own header", () => {
    const b = fnBody("insertFigure");
    expect(b).toMatch(/prepareFigure\(\s*\{ svg: o\.svg, preset: currentFigurePreset\(\), width: currentFigureWidth\(\), render: o\.render, chartKind: o\.chartKind \}/);
    expect(b).toMatch(/if \(!prepared\.ok\) throw new Error\(refusalText\(prepared\)\)/);
    expect(b).toMatch(/decideInsertRoute\(hostCapability\(\)\)/);
    expect(b).toMatch(/rasterTarget\(prepared, o\.supersample \?\? 1\)/);
    expect(b).toMatch(/pngPixelSize\(png\)/);
    expect(b).toMatch(/picture\.width = prepared\.widthPt;\s*picture\.height = prepared\.heightPt;/);
  });
  test("capability detection uses ImageCoercion 1.2 and a throw is null (never optimistic)", () => {
    const b = fnBody("hostCapability");
    expect(b).toMatch(/isSetSupported\("ImageCoercion", "1\.2"\) === true/);
    expect(b).toMatch(/catch \{\s*imageCoercion12 = null;/);
  });
  test("the vector route re-finds its picture with findInsertedPicture and never adds a PNG after Word reported success", () => {
    const b = fnBody("insertFigureVector");
    expect(b).toMatch(/findInsertedPicture\(before, sigs\)/);
    expect(b).toMatch(/if \(!found\.ok\) \{\s*throw new Error/);
    // The only fallback return is the one where setSelectedSvg itself failed.
    expect((b.match(/fallback: `/g) ?? []).length).toBe(1);
    expect(b).toMatch(/catch \(e\) \{\s*return \{ fallback: `Word refused the vector picture/);
  });
  test("every FIGURE_STYLE_MODES mode inserts through insertFigure, and nothing else does (the row is shown only where it works)", () => {
    const insertFnFor: Record<string, string> = {
      plot: "insertPlot",
      ppt: "insertTableFigure",
      stats: "insertStatsChart",
      finance: "insertFinanceResult",
      assay: "insertAssayPlot",
    };
    const modes = figureStyleModes();
    expect(modes.sort()).toEqual(Object.keys(insertFnFor).sort());
    for (const mode of modes) {
      const b = fnBody(insertFnFor[mode]);
      expect({ mode, viaInsertFigure: /await insertFigure\(\{/.test(b), ownPng: /insertInlinePictureFromBase64/.test(b) }).toEqual({
        mode,
        viaInsertFigure: true,
        ownPng: false,
      });
    }
    const callers = [...PANE.matchAll(/await insertFigure\(/g)].length;
    expect(callers).toBe(modes.length + 1); // + insertPanels
    expect(fnBody("onInputChanged")).toMatch(/figStyleRow\.hidden = !FIGURE_STYLE_MODES\.has\(mode\)/);
  });
  test("Table→Chart: USPTO draws the patent style with no title; a journal style takes the Okabe–Ito palette; re-render passed", () => {
    const style = fnBody("currentChartStyle");
    expect(style).toMatch(/pptPatentCheckbox\.checked \|\| preset === "uspto"/);
    expect(style).toMatch(/preset !== "asdrawn" && !patent \? \{ palette: "okabe-ito" as const \}/);
    expect(fnBody("renderTableGraphic")).toMatch(/currentFigurePreset\(\) === "uspto" \? "" : pptTitleInput/);
    expect(fnBody("insertTableFigure")).toMatch(/render: tableGraphicRender\(\) \?\? undefined,\s*chartKind: kind/);
  });
  test("the style row's listeners are wired", () => {
    expect(PANE).toMatch(/figStyleSelect\.addEventListener\("change", updateFigureStyleNote\)/);
    expect(PANE).toMatch(/figWidthSelect\.addEventListener\("change", updateFigureStyleNote\)/);
  });
});

describe("significance brackets: the Stats pane reaches bracketedBoxPlot, from engine results only", () => {
  test("the pane never builds a bracket set itself (no sigBrackets import, no bracketsFrom* call)", () => {
    expect(PANE).not.toMatch(/from "\.\.\/lib\/sigBrackets"/);
    expect(PANE).not.toMatch(/bracketsFrom(Tukey|Pairwise|Dunn)\(/);
  });
  test("each bracketed calculator passes its OWN engine result object — never a literal p, star or label", () => {
    const sites = [...PANE.matchAll(/brackets:\s*(?:\(choice, w\) =>|dunn && dunn\.ok)/g)];
    const ids: string[] = [];
    for (const s of sites) {
      const before = PANE.slice(0, s.index);
      const id = [...before.matchAll(/\n {4}id: "([a-z0-9-]+)"/g)].pop()?.[1] ?? "?";
      ids.push(id);
      const body = PANE.slice(s.index, (s.index ?? 0) + 900);
      const src = /\{ kind: "(t|mann-whitney|wilcoxon|tukey|dunn)", result: (res|dunn as ReturnType<typeof dunnTest>)[,\s}]/.exec(body);
      expect({ id, source: !!src }).toEqual({ id, source: true });
      expect({ id, call: /bracketedBoxPlot\(/.test(body) }).toEqual({ id, call: true });
    }
    expect(ids.sort()).toEqual(["kruskal", "mannwhitney", "paired", "twosample", "tukey", "wilcoxon"].sort());
  });
  test("the preview reads the bracket controls; a failed re-render throws instead of dropping the brackets", () => {
    const b = fnBody("updateStatsPreview");
    expect(b).toMatch(/const choice = currentBracketChoice\(\);/);
    expect(b).toMatch(/const bf = out\.ok !== false \? out\.brackets : undefined;/);
    expect(b).toMatch(/statsBracketsRow\.hidden = !bf;/);
    expect(b).toMatch(/if \(!again\.ok\) throw new Error/);
    expect(b).not.toMatch(/\|\| figSvg/);
    for (const id of ["statsBracketsSelect", "statsBracketsHideNs", "statsBracketsTall"]) {
      expect(PANE).toMatch(new RegExp(`${id}\\.addEventListener\\("change", updateStatsPreview\\)`));
    }
  });
  test("ns show/hide is an explicit control; brackets are off by default", () => {
    expect(optionValues("stats-brackets")).toEqual(["off", "stars", "p"]);
    expect(HTML).toMatch(/<input type="checkbox" id="stats-brackets-hidens" \/>/);
  });
  test("the bracket legend (test, correction, hidden ns count) is inserted as the caption", () => {
    expect(fnBody("insertStatsChart")).toMatch(/after: captionAfter\(caption\)/);
  });
});

describe("multi-panel figures: the tray reaches composePanelFigure → insertFigure", () => {
  test("add / insert / clear are wired, and the tray takes the current tool's figure WITH its re-render", () => {
    expect(PANE).toMatch(/figPanelAddBtn\.addEventListener\("click", addCurrentFigureToPanels\)/);
    expect(PANE).toMatch(/figPanelInsertBtn\.addEventListener\("click", \(\) => void insertPanels\(\)\)/);
    expect(fnBody("addCurrentFigureToPanels")).toMatch(/currentModeFigure\(\)/);
    const cmf = fnBody("currentModeFigure");
    expect(cmf).toMatch(/render: currentStatsRender/);
    expect(cmf).toMatch(/render: currentPlotRender/);
    expect(cmf).toMatch(/render: tableGraphicRender\(\)/);
    const ip = fnBody("insertPanels");
    expect(ip).toMatch(/composePanelFigure\(figPanels\.slice\(\), currentFigurePreset\(\), currentFigureWidth\(\), cols\)/);
    expect(ip).toMatch(/await insertFigure\(\{/);
  });
  test("every mode the tray can take a figure from shows the row", () => {
    const cases = [...fnBody("currentModeFigure").matchAll(/case "([a-z]+)":/g)].map((m) => m[1]).sort();
    expect(cases).toEqual(figureStyleModes().sort());
  });
});
