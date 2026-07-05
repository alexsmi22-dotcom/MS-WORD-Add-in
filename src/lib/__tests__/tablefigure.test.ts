import { buildTableFigureSvg, prepareTableFigure } from "../tablefigure";

const count = (svg: string, needle: string): number => svg.split(needle).length - 1;

// A grouped "baseline characteristics" table like those in a real patent spec:
// a Section column with a group-header band row + blank continuation cells.
const characteristics = [
  ["Section", "Characteristic", "Overall", "GLP-switcher"],
  ["Demographics", "", "", ""],
  ["", "Age at index, years", "52.3 (14.6)", "52.1 (14.4)"],
  ["", "Female", "8,408 (75.0%)", "3,669 (74.4%)"],
  ["", "Male", "2,803 (25.0%)", "1,263 (25.6%)"],
];

describe("prepareTableFigure (shared by the SVG figure and the editable Word table)", () => {
  test("drops the section column, classifies rows, flags numeric columns", () => {
    const p = prepareTableFigure(characteristics);
    expect(p.grid[0]).toEqual(["Characteristic", "Overall", "GLP-switcher"]); // Section col dropped
    expect(p.kinds).toEqual(["header", "band", "data", "data", "data"]);
    expect(p.bandText[1]).toBe("Demographics");
    expect(p.numericCol).toEqual([false, true, true]);
    expect(p.hasHeader).toBe(true);
  });

  test("keeps a section column that has a value on every row (merged style)", () => {
    const p = prepareTableFigure([
      ["Section", "Item", "n"],
      ["Cohort", "Total", "100"],
      ["Cohort", "Female", "75"],
    ]);
    expect(p.grid[0]).toEqual(["Section", "Item", "n"]);
    expect(p.kinds).toEqual(["header", "data", "data"]);
  });

  test("caps very long tables with a warning", () => {
    const rows = [["A", "B"], ...Array.from({ length: 60 }, (_, i) => [`r${i}`, String(i)])];
    const p = prepareTableFigure(rows);
    expect(p.grid.length).toBe(40); // capped to 40 rows total
    expect(p.warnings.some((w) => w.includes("first 40"))).toBe(true);
  });
});

describe("buildTableFigureSvg", () => {
  test("renders scalable SVG with the header, cells, and content", () => {
    const { svg } = buildTableFigureSvg(characteristics);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("viewBox");
    expect(svg).toContain("Characteristic");
    expect(svg).toContain("8,408 (75.0%)".replace(/&/g, "&amp;"));
  });

  test("a group-header row (only first cell filled) becomes a full-width band", () => {
    const { svg } = buildTableFigureSvg(characteristics);
    // The band rect spans the full table width; the pane is 380 wide.
    expect(svg).toMatch(/<rect x="0" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="#dbe6f2"/);
    expect(svg).toContain("Demographics");
  });

  test("a redundant blank section column is dropped (no dead left column)", () => {
    // Sections appear only on band rows; the leading column is blank in every
    // data row, so it should be removed and the bands carry the section names.
    const { svg } = buildTableFigureSvg(characteristics);
    // After dropping, the header is Characteristic | Overall | GLP-switcher —
    // three columns, so three header-fill cells.
    expect(count(svg, 'fill="#e7eef6"')).toBe(3);
    // The band still shows its section text.
    expect(svg).toContain("Demographics");
    // The "Section" header label is gone (it was the dropped column).
    expect(svg).not.toContain(">Section<");
  });

  test("a section column with a value on every row is kept and merged", () => {
    // Merged-cell style: the section repeats down column 0 (no band rows).
    const merged = [
      ["Section", "Item", "n"],
      ["Cohort", "Total", "100"],
      ["Cohort", "Female", "75"],
      ["Outcome", "Responders", "40"],
    ];
    const { svg } = buildTableFigureSvg(merged);
    expect(svg).toContain(">Section<");
    expect(svg).toContain("Cohort");
    expect(svg).toContain("Outcome");
  });

  test("header row is shaded and bold", () => {
    const { svg } = buildTableFigureSvg(characteristics);
    expect(svg).toContain('fill="#e7eef6"'); // header fill (color style)
    expect(svg).toContain('font-weight="bold"');
  });

  test("patent style is pure black & white and shows the FIG. label", () => {
    const { svg } = buildTableFigureSvg(characteristics, "", { patent: true, figLabel: "FIG. 5" });
    expect(svg).toContain("FIG. 5");
    for (const c of ["#e7eef6", "#dbe6f2", "#c4c4c4", "#1f77b4"]) expect(svg).not.toContain(c);
  });

  test("caps very long tables with a warning", () => {
    const rows = [["Row", "Value"], ...Array.from({ length: 60 }, (_, i) => [String(i + 1), String(i)])];
    const { warnings } = buildTableFigureSvg(rows);
    expect(warnings.some((w) => w.includes("first 40"))).toBe(true);
  });

  test("wide tables scale down to the pane width", () => {
    const wide = [Array.from({ length: 9 }, (_, j) => `Column heading ${j + 1}`), Array.from({ length: 9 }, (_, j) => `v${j}`)];
    const { svg } = buildTableFigureSvg(wide);
    expect(svg).toMatch(/width="380"/);
  });

  test("escapes markup in cells", () => {
    const { svg } = buildTableFigureSvg([
      ["A", "B"],
      ["x<y & z", "1"],
    ]);
    expect(svg).toContain("x&lt;y &amp; z");
    expect(svg).not.toContain("x<y");
  });

  test("reference numerals are free-standing with lead lines (not a boxed rail)", () => {
    const { svg } = buildTableFigureSvg(characteristics, "", { numerals: true });
    expect(svg).toContain(">100<"); // Demographics section
    expect(svg).toContain(">102<"); // first row in the section
    expect(svg).toContain(">104<");
    // Lead lines present…
    expect(svg).toContain('class="fi-lead"');
    // …and no full-height numeral rail cell drawn at the left edge (x="0").
    expect(svg).not.toMatch(/<rect x="0" y="[\d.]+" width="46"/);
  });

  test("numeric columns are right-aligned", () => {
    const { svg } = buildTableFigureSvg([
      ["Item", "Count"],
      ["A", "1,234"],
      ["B", "56"],
    ]);
    expect(svg).toContain('text-anchor="end"');
  });

  test("single-column table renders", () => {
    const { svg } = buildTableFigureSvg([["Step"], ["Mix"], ["Heat"]]);
    expect(count(svg, "<rect")).toBeGreaterThan(3);
  });

  test("empty input is handled", () => {
    const { svg } = buildTableFigureSvg([]);
    expect(svg).toContain("Empty table");
  });
});
