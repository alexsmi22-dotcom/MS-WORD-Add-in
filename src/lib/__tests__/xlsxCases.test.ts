// FIXED CASE TABLE for the .xlsx reader (Release C quick win). Cumulative: later rounds keep every row's outcome.
//
// Fixtures are built HERE with jszip, the XML parts written as Excel writes them ([Content_Types].xml,
// xl/workbook.xml, xl/_rels/workbook.xml.rels, xl/worksheets/sheetN.xml, xl/sharedStrings.xml, xl/styles.xml).
// EXTERNAL ORACLE: two workbooks written by openpyxl 3.1.5 (statvenv), inlined as base64 below, with openpyxl's own
// reading of them pinned. Script: scratchpad/xlsx-oracle.py —
//   wb.active.title = "Run 1"; A1 Peak, B1 RT, C1 Area; A2 Caffeine, B2 4.95, C2 0.1+0.2; A3 rich text
//   "Theo"(bold)+"phylline", B3 3.86, C3 1e-7; A4 True, B4 -0.0, C4 1.2345678901234568e29; A6 "merged" (A6:B6);
//   E7 7; sheets "Run 2" (A1 1) and "Blank". Second workbook: sheet "Data", A1 1.5, B2 datetime(2026,10,22,9,30).
//   openpyxl reads back: sheets ['Run 1', 'Run 2', 'Blank'], dims A1:E7, C2 0.3 (openpyxl WRITES 0.1+0.2 rounded
//   to 0.3; Excel writes 0.30000000000000004, pinned separately below), C3 1e-07, A4 True, B4 0, A6 'merged';
//   B2 of the second is a datetime with number format 'yyyy-mm-dd h:mm:ss'.

import JSZip from "jszip";
import { readXlsx, numberText, isDateFormat, colIndex, colLetters, XLSX_MAX_ENTRIES } from "../xlsxRead";
import { readDataBlock } from "../dataBlock";
import { gridToFieldText } from "../dataimport";

const CT =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>';
const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const STYLES_PLAIN =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<styleSheet ${NS}>` +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0;[Red]\\-#,##0"/><numFmt numFmtId="165" formatCode="[$-409]d\\-mmm\\-yy;@"/></numFmts>' +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
  '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>';

interface Sheet {
  name: string;
  rows: string;
  merges?: string;
  hidden?: boolean;
}
async function xlsx(sheets: Sheet[], shared: string[] = [], opts: { compression?: "DEFLATE" | "STORE"; extra?: Record<string, string | Uint8Array> } = {}): Promise<Uint8Array> {
  const z = new JSZip();
  z.file("[Content_Types].xml", CT);
  z.file("_rels/.rels", ROOT_RELS);
  z.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<workbook ${NS}><bookViews><workbookView/></bookViews><sheets>` +
      sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}"${s.hidden ? ` state="hidden"` : ""} r:id="rId${i + 1}"/>`).join("") +
      "</sheets></workbook>",
  );
  z.file(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
      "</Relationships>",
  );
  sheets.forEach((s, i) =>
    z.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<worksheet ${NS}><sheetData>${s.rows}</sheetData>${s.merges ? `<mergeCells count="1">${s.merges}</mergeCells>` : ""}</worksheet>`,
    ),
  );
  z.file("xl/styles.xml", STYLES_PLAIN);
  z.file(
    "xl/sharedStrings.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<sst ${NS} count="${shared.length}" uniqueCount="${shared.length}">` + shared.map((s) => `<si>${s}</si>`).join("") + "</sst>",
  );
  for (const [k, v] of Object.entries(opts.extra ?? {})) z.file(k, v);
  return z.generateAsync({ type: "uint8array", compression: opts.compression ?? "DEFLATE" });
}
const one = (rows: string, shared: string[] = [], merges?: string) => xlsx([{ name: "Sheet1", rows, merges }], shared);
const ok = async (bytes: Uint8Array, name = "test.xlsx") => {
  const r = await readXlsx(bytes, name);
  if (!r.ok) throw new Error(r.error);
  return r;
};
const refusal = async (bytes: Uint8Array, name = "test.xlsx"): Promise<string> => {
  const r = await readXlsx(bytes, name);
  return r.ok ? "" : r.error;
};
const b64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));
const dataNumbers = (text: string): (number | null)[][] => {
  const b = readDataBlock(text, "data");
  if (!b.ok) throw new Error(b.error);
  return b.rows;
};

describe("xlsx fixed case table", () => {
  test("sparse cells A1, C1, B2 → 'A1\\t\\tC1\\n\\tB2' (placed by reference)", async () => {
    const r = await ok(await one('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="B2" t="s"><v>2</v></c></row>', ["<t>A1</t>", "<t>C1</t>", "<t>B2</t>"]));
    expect(r.text).toBe("A1\t\tC1\n\tB2");
    expect(r.rows).toEqual([["A1", "", "C1"], ["", "B2"]]);
  });
  test("shared strings, rich text runs joined, phonetic runs dropped, entities and _x000D_ decoded", async () => {
    const r = await ok(
      await one('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>', [
        "<t>RT (min)</t>",
        '<r><rPr><b/></rPr><t>Theo</t></r><r><t xml:space="preserve">phylline</t></r><rPh sb="0" eb="1"><t>XX</t></rPh>',
        "<t>A &amp; B_x000D_\nC &lt;1&gt;</t>",
      ]),
    );
    expect(r.rows[0]).toEqual(["RT (min)", "Theophylline", "A & B C <1>"]);
  });
  test("inline string", async () => {
    const r = await ok(await one('<row r="1"><c r="A1" t="inlineStr"><is><t>Peak</t></is></c><c r="B1"><v>5</v></c></row>'));
    expect(r.text).toBe("Peak\t5");
  });
  test("formula with a cached value → the value", async () => {
    const r = await ok(await one('<row r="1"><c r="A1"><f>1/3</f><v>0.33333333333333331</v></c><c r="B1" t="str"><f>"x"&amp;"y"</f><v>xy</v></c></row>'));
    expect(r.text).toBe("0.3333333333333333\txy");
  });
  test("formula without a cached value → named refusal", async () => {
    expect(await refusal(await one('<row r="5"><c r="C5"><f>A5*2</f></c></row>'))).toBe(
      "test.xlsx: cell C5 of sheet 'Sheet1' is a formula with no saved value; open and save the file in Excel first.",
    );
    expect(await refusal(await one('<row r="5"><c r="C5"><f>A5*2</f><v></v></c></row>'))).toMatch(/cell C5 .* formula with no saved value/);
  });
  test("#DIV/0! → refusal naming the cell", async () => {
    expect(await refusal(await one('<row r="3"><c r="B3" t="e"><f>1/0</f><v>#DIV/0!</v></c></row>'))).toMatch(/cell B3 of sheet 'Sheet1' holds the error #DIV\/0!/);
    expect(await refusal(await one('<row r="1"><c r="A1" t="e"><v>#N/A</v></c></row>'))).toMatch(/cell A1 .* #N\/A/);
  });
  test("date-formatted cell → refusal naming it (built-in 14, custom d-mmm-yy, t=\"d\")", async () => {
    expect(await refusal(await one('<row r="2"><c r="D2" s="1"><v>46317</v></c></row>'))).toMatch(/cell D2 of sheet 'Sheet1' is formatted as a date or time/);
    expect(await refusal(await one('<row r="2"><c r="A2" s="3"><v>46317</v></c></row>'))).toMatch(/cell A2 .* date or time/);
    expect(await refusal(await one('<row r="2"><c r="A2" t="d"><v>2026-10-22T09:30:00</v></c></row>'))).toMatch(/cell A2 .* holds a date or time/);
  });
  test("a [Red] number format and a 2-decimal format are NOT dates", async () => {
    const r = await ok(await one('<row r="1"><c r="A1" s="2"><v>1234</v></c><c r="B1" s="4"><v>2.5</v></c></row>'));
    expect(r.text).toBe("1234\t2.5");
  });
  test("0.1+0.2 stored as 0.30000000000000004 → written so dataBlock reads 0.30000000000000004", async () => {
    const r = await ok(await one('<row r="1"><c r="A1"><v>0.30000000000000004</v></c></row>'));
    expect(r.text).toBe("0.30000000000000004");
    expect(dataNumbers(r.text)[0][0]).toBe(0.1 + 0.2);
  });
  test("1e-7 (stored 1E-7) → plain decimal that dataBlock reads back exactly", async () => {
    const r = await ok(await one('<row r="1"><c r="A1"><v>1E-7</v></c><c r="B1"><v>-2.5E-3</v></c></row>'));
    expect(r.text).toBe("0.0000001\t-0.0025");
    expect(dataNumbers(r.text)[0]).toEqual([1e-7, -0.0025]);
  });
  test("two sheets → the first, and a note naming the others", async () => {
    const r = await ok(await xlsx([{ name: "Run 1", rows: '<row r="1"><c r="A1"><v>1</v></c></row>' }, { name: "Run 2", rows: '<row r="1"><c r="A1"><v>2</v></c></row>' }, { name: "Blank", rows: "" }]));
    expect(r.sheet).toBe("Run 1");
    expect(r.text).toBe("1");
    expect(r.note).toBe("sheet 'Run 1'; also in the file: 'Run 2', 'Blank'");
  });
  test(".xls bytes (D0 CF 11 E0 header) → refusal", async () => {
    const xls = new Uint8Array(1024);
    xls.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(await refusal(xls, "old.xls")).toMatch(/^old\.xls: this is a legacy Excel 97–2003 workbook \(\.xls\)/);
  });
  test("password-protected (encrypted OLE container) → refusal", async () => {
    const enc = new Uint8Array(2048);
    enc.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    enc.set([..."EncryptionInfo"].flatMap((c) => [c.charCodeAt(0), 0]), 1100);
    expect(await refusal(enc, "locked.xlsx")).toMatch(/password-protected/);
  });
  test("entry-count bomb → refused before inflating", async () => {
    const z = new JSZip();
    for (let i = 0; i <= XLSX_MAX_ENTRIES; i++) z.file(`f${i}.xml`, "x");
    const bytes = await z.generateAsync({ type: "uint8array" });
    expect(await refusal(bytes)).toMatch(/holds 2001 entries, more than the 2000/);
  });
  test("declared-size bomb (21 MB of zeros, deflated) → refused before inflating", async () => {
    const z = new JSZip();
    z.file("[Content_Types].xml", CT);
    z.file("xl/worksheets/sheet1.xml", new Uint8Array(21 * 1024 * 1024));
    const bytes = await z.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    expect(bytes.length).toBeLessThan(200 * 1024);
    expect(await refusal(bytes)).toMatch(/would inflate to more than 20 MB/);
  });
  test("a LYING header (declared small, inflates large) is stopped while inflating", async () => {
    const pad = "<!--" + " ".repeat(3 * 1024 * 1024) + "-->";
    const bytes = await xlsx([{ name: "Sheet1", rows: '<row r="1"><c r="A1"><v>1</v></c></row>' + pad }]);
    // Patch the sheet's uncompressed size in the central directory down to 1 000 bytes.
    const name = "xl/worksheets/sheet1.xml";
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let patched = 0;
    for (let i = 0; i + 46 < bytes.length; i++) {
      if (dv.getUint32(i, true) !== 0x02014b50) continue;
      const nlen = dv.getUint16(i + 28, true);
      const nm = String.fromCharCode(...bytes.subarray(i + 46, i + 46 + nlen));
      if (nm === name) {
        dv.setUint32(i + 24, 1000, true);
        patched++;
      }
    }
    expect(patched).toBe(1);
    expect(await refusal(bytes)).toMatch(/inflates to more than its declared size/);
  });
  test("boolean → TRUE/FALSE text", async () => {
    const r = await ok(await one('<row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>0</v></c></row>'));
    expect(r.text).toBe("TRUE\tFALSE");
  });
  test("merged cells: the top-left value only", async () => {
    const r = await ok(await one('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>3</v></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>2</v></c><c r="C2"><v>4</v></c></row>', ["<t>Title</t>", "<t>stray</t>"], '<mergeCell ref="A1:B1"/>'));
    expect(r.text).toBe("Title\t\t3\n1\t2\t4");
  });
});

describe("xlsx adversarial rows", () => {
  test("what the pane puts in a block field keeps the placement (gridToFieldText pads, never shifts)", async () => {
    const r = await ok(await one('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="B2" t="s"><v>2</v></c></row>', ["<t>A1</t>", "<t>C1</t>", "<t>B2</t>"]));
    expect(gridToFieldText(r.rows, "block")).toBe("A1\t\tC1\n\tB2\t");
  });
  test("a hidden first sheet is passed over for the first VISIBLE worksheet, and the note says so", async () => {
    const r = await ok(await xlsx([{ name: "Lookup", rows: '<row r="1"><c r="A1"><v>9</v></c></row>', hidden: true }, { name: "Data", rows: '<row r="1"><c r="A1"><v>1</v></c></row>' }]));
    expect(r.sheet).toBe("Data");
    expect(r.text).toBe("1");
    expect(r.note).toBe("sheet 'Data'; also in the file: 'Lookup' (hidden)");
  });
  test("thousands of full-height merges over a wide sheet refuse or finish fast (bounded work)", async () => {
    const row = (r: number) => `<row r="${r}">` + Array.from({ length: 500 }, (_, i) => `<c r="${colLetters(i + 1)}${r}"><v>${i}</v></c>`).join("") + "</row>";
    const rows = Array.from({ length: 200 }, (_, i) => row(i + 1)).join("");
    const merges = Array.from({ length: 5000 }, (_, i) => `<mergeCell ref="${colLetters((i % 500) + 1)}1:${colLetters((i % 500) + 1)}200"/>`).join("");
    const bytes = await xlsx([{ name: "Wide", rows, merges }]);
    const t0 = Date.now();
    const r = await readXlsx(bytes, "m.xlsx");
    expect(Date.now() - t0).toBeLessThan(5000);
    if (r.ok) expect(r.rows.length).toBeGreaterThan(0);
    else expect(r.error).toMatch(/too many merged ranges/);
  }, 60000);
  test("openpyxl fixture A (external writer): sheet order, rich text, bool, −0, huge number, merge, sparse E7", async () => {
    const r = await ok(b64(FIXTURE_A), "openpyxl.xlsx");
    expect(r.sheet).toBe("Run 1");
    expect(r.otherSheets).toEqual(["Run 2", "Blank"]);
    expect(r.range).toBe("A1:E7");
    expect(r.rows[0]).toEqual(["Peak", "RT", "Area"]);
    expect(r.rows[1]).toEqual(["Caffeine", "4.95", "0.3"]); // openpyxl wrote 0.3 (its reading: 0.3)
    expect(r.rows[2]).toEqual(["Theophylline", "3.86", "0.0000001"]);
    expect(r.rows[3][0]).toBe("TRUE");
    expect(r.rows[3][1]).toBe("0");
    expect(Number(r.rows[3][2])).toBe(1.234567890123457e29); // openpyxl's own reading
    expect(r.rows[3][2]).toBe("123456789012345700000000000000");
    expect(r.rows[4]).toEqual([]);
    expect(r.rows[5]).toEqual(["merged"]);
    expect(r.rows[6]).toEqual(["", "", "", "", "7"]);
  });
  test("openpyxl fixture B: its datetime cell is refused by name", async () => {
    expect(await refusal(b64(FIXTURE_B), "dates.xlsx")).toMatch(/^dates\.xlsx: cell B2 of sheet 'Data' is formatted as a date or time/);
  });
  test("leading empty rows and columns are dropped, the range named", async () => {
    const r = await ok(await one('<row r="3"><c r="B3"><v>1</v></c><c r="C3"><v>2</v></c></row><row r="4"><c r="B4"><v>3</v></c></row>'));
    expect(r.text).toBe("1\t2\n3");
    expect(r.note).toBe("sheet 'Sheet1', B3:C4");
  });
  test("cells without r attributes are placed in order; styled empty cells are skipped", async () => {
    const r = await ok(await one('<row><c><v>1</v></c><c s="2"/><c><v>3</v></c></row><row><c><v>4</v></c></row>'));
    expect(r.text).toBe("1\t\t3\n4");
  });
  test("namespace-prefixed elements are read", async () => {
    const z = await xlsx([{ name: "S", rows: "" }]);
    const zip = await JSZip.loadAsync(z);
    zip.file("xl/worksheets/sheet1.xml", `<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1"><x:v>9</x:v></x:c></x:row></x:sheetData></x:worksheet>`);
    const r = await ok(await zip.generateAsync({ type: "uint8array" }));
    expect(r.text).toBe("9");
  });
  test("one value at XFD1048576 plus A1 → used-range refusal, nothing materialised", async () => {
    expect(await refusal(await one('<row r="1"><c r="A1"><v>1</v></c></row><row r="1048576"><c r="XFD1048576"><v>2</v></c></row>'))).toMatch(/used range of sheet 'Sheet1' \(A1:XFD1048576\) spans more than 200,000 cells/);
  });
  test("empty sheet → refusal; corrupt zip → refusal; not a zip → refusal", async () => {
    expect(await refusal(await one(""))).toMatch(/sheet 'Sheet1' is empty/);
    expect(await refusal(await one('<row r="1"><c r="A1" s="2"/></row>'))).toMatch(/is empty/);
    const junk = new Uint8Array(200);
    junk.set([0x50, 0x4b, 0x03, 0x04]);
    expect(await refusal(junk)).toMatch(/not a complete zip archive/);
    expect(await refusal(new TextEncoder().encode("a,b,c\n1,2,3\n"))).toMatch(/not a zip archive/);
    expect(await refusal(new Uint8Array(3))).toMatch(/empty or too short/);
  });
  test(".ods, .numbers, .xlsb are refused by name", async () => {
    const z = new JSZip();
    z.file("mimetype", "application/vnd.oasis.opendocument.spreadsheet");
    z.file("content.xml", "<x/>");
    expect(await refusal(await z.generateAsync({ type: "uint8array" }), "sheet.ods")).toMatch(/OpenDocument/);
    expect(await refusal(await z.generateAsync({ type: "uint8array" }), "renamed.xlsx")).toMatch(/OpenDocument/);
    expect(await refusal(await one('<row r="1"><c r="A1"><v>1</v></c></row>'), "data.numbers")).toMatch(/Apple Numbers/);
    const n = new JSZip();
    n.file("Index/Document.iwa", "x");
    expect(await refusal(await n.generateAsync({ type: "uint8array" }), "renamed.xlsx")).toMatch(/Apple Numbers/);
    expect(await refusal(await one('<row r="1"><c r="A1"><v>1</v></c></row>'), "data.xlsb")).toMatch(/xlsb/);
  });
  test(".xlsm is read as data (a vbaProject.bin part is never touched)", async () => {
    const r = await ok(await xlsx([{ name: "Macro", rows: '<row r="1"><c r="A1"><v>42</v></c></row>' }], [], { extra: { "xl/vbaProject.bin": new Uint8Array([1, 2, 3]) } }), "m.xlsm");
    expect(r.text).toBe("42");
  });
  test("a shared-string index past the table → corrupt refusal; a bad reference → refusal", async () => {
    expect(await refusal(await one('<row r="1"><c r="A1" t="s"><v>5</v></c></row>', ["<t>x</t>"]))).toMatch(/shared string that is missing/);
    expect(await refusal(await one('<row r="1"><c r="A0"><v>1</v></c></row>'))).toMatch(/not valid/);
  });
  test("numbers are never e-notation in the field text unless 33+ characters would be needed", () => {
    expect(numberText(0.30000000000000004)).toBe("0.30000000000000004");
    expect(numberText(1e-7)).toBe("0.0000001");
    expect(numberText(-0)).toBe("0");
    expect(numberText(1e21)).toBe("1000000000000000000000");
    expect(numberText(1.5e-300)).toBe("1.5e-300");
    expect(numberText(1e300)).toBe("1e+300");
    for (const v of [1.5e-300, 1e300, 1e-7, 0.30000000000000004, 123456.789, -4.2e-12]) expect(dataNumbers(numberText(v))[0][0]).toBe(v);
  });
  test("date-format detection", () => {
    for (const c of ["yyyy-mm-dd", "d-mmm-yy", "h:mm AM/PM", "[h]:mm:ss", "mm:ss.0", '[$-409]d\\-mmm\\-yy;@']) expect(isDateFormat(c)).toBe(true);
    for (const c of ["General", "0.00", "#,##0;[Red]-#,##0", "[Magenta]0.0", '0.0" ms"', "0.00E+00", "@", '#,##0_);\\(#,##0\\)']) expect(isDateFormat(c)).toBe(false);
  });
  test("column letters", () => {
    expect(colIndex("A")).toBe(1);
    expect(colIndex("XFD")).toBe(16384);
    expect(colIndex("XFE")).toBe(0);
    expect(colLetters(28)).toBe("AB");
  });
  test("a 200 000-cell sheet reads within the cap; one more cell is refused", async () => {
    const row = (r: number, n: number) => `<row r="${r}">` + Array.from({ length: n }, (_, i) => `<c r="${colLetters(i + 1)}${r}"><v>${i}</v></c>`).join("") + "</row>";
    const ok200 = Array.from({ length: 1000 }, (_, i) => row(i + 1, 200)).join("");
    const t0 = Date.now();
    const r = await ok(await one(ok200));
    expect(r.rows.length).toBe(1000);
    expect(Date.now() - t0).toBeLessThan(15000);
    expect(await refusal(await one(ok200 + row(1001, 1)))).toMatch(/more than 200,000 cells/);
  }, 60000);
});

const FIXTURE_A = "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";
const FIXTURE_B = "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";

// Review round 1 (review-c1/repro R06, R07 and review-c1/xl): every repro is a row; earlier rows unchanged.
const stylesWith = (ids: number[], custom: Record<number, string> = {}): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<styleSheet ${NS}>` +
  (Object.keys(custom).length ? `<numFmts count="${Object.keys(custom).length}">${Object.entries(custom).map(([id, c]) => `<numFmt numFmtId="${id}" formatCode="${c}"/>`).join("")}</numFmts>` : "") +
  `<cellXfs count="${ids.length + 1}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  ids.map((id) => `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join("") +
  "</cellXfs></styleSheet>";
const styled = (styles: string, rows: string) => xlsx([{ name: "Sheet1", rows }], [], { extra: { "xl/styles.xml": styles } });

describe("xlsx review round 1", () => {
  test.each([27, 31, 36, 50, 57, 58, 71, 76, 81])("R06: CJK/Thai built-in date id %i (no numFmt in the file) is refused as a date", async (id) => {
    const bytes = await styled(stylesWith([id]), '<row r="1"><c r="A1"><v>1</v></c></row><row r="2"><c r="B2" s="1"><v>45000</v></c></row>');
    expect(await refusal(bytes)).toMatch(/cell B2 of sheet 'Sheet1' is formatted as a date or time/);
  });
  test("R06: the same ids redefined by a custom numFmt follow the custom code (0.00 is not a date)", async () => {
    const r = await ok(await styled(stylesWith([27], { 27: "0.00" }), '<row r="1"><c r="A1" s="1"><v>45000</v></c></row>'));
    expect(r.text).toBe("45000");
  });
  test("R07: 40 000 unclosed <c> elements are refused as malformed, quickly (one forward pass)", async () => {
    const cells = '<c r="A1" t="n"><v>1</v>'.repeat(40000);
    const bytes = await one(`<row r="1">${cells}</row>`);
    const t0 = Date.now();
    const msg = await refusal(bytes, "unclosed.xlsx");
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(msg).toMatch(/^unclosed\.xlsx: the workbook's XML is malformed \(a <c> element is (never closed|not closed before the next one opens)\); the file is corrupt/);
  });
  test("R07: other malformed shapes (unclosed row, tag never ended, unclosed sheetData) are refused fast", async () => {
    for (const rows of ['<row r="1"><c r="A1"><v>1</v></c>', '<row r="1"><c r="A1"', '<row r="1"><c r="A1"><v>1</v></c></row><row r="2">']) {
      const t0 = Date.now();
      expect(await refusal(await one(rows))).toMatch(/malformed/);
      expect(Date.now() - t0).toBeLessThan(1000);
    }
    const z = await JSZip.loadAsync(await one(""));
    z.file("xl/worksheets/sheet1.xml", `<worksheet ${NS}><sheetData><row r="1"><c r="A1"><v>1</v></c></row>`);
    expect(await refusal(await z.generateAsync({ type: "uint8array" }))).toMatch(/<sheetData> element is never closed/);
  });
  test("percent- and thousands-scaled formats: read as stored, the note names the column", async () => {
    const pct = await ok(await styled(stylesWith([10]), '<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c><c r="B1" t="inlineStr"><is><t>y</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2" s="1"><v>0.455</v></c></row>'));
    expect(pct.text).toBe("x\ty\n1\t0.455");
    expect(pct.note).toContain("column B is formatted as a percentage; read as stored (0.455 in B2)");
    const mil = await ok(await styled(stylesWith([164], { 164: '0.0,,&quot;M&quot;' }), '<row r="1"><c r="C1" s="1"><v>45000.5</v></c></row>'));
    expect(mil.note).toContain("column C is formatted to show thousands or millions; read as stored (45000.5 in C1)");
    const units = await ok(await styled(stylesWith([164, 165], { 164: '#,##0&quot; mm&quot;', 165: "[Red]0.00;[Blue]-0.00" }), '<row r="1"><c r="A1" s="1"><v>5</v></c><c r="B1" s="2"><v>6</v></c></row>'));
    expect(units.note).toBe("sheet 'Sheet1'");
  });
  test("a stored value Number() would misread (0x10, Infinity, 1e400) is refused, not read as 16", async () => {
    expect(await refusal(await one('<row r="1"><c r="A1"><v>0x10</v></c></row>'))).toMatch(/cell A1 .* cannot read \("0x10"\)/);
    expect(await refusal(await one('<row r="1"><c r="A1"><v>Infinity</v></c></row>'))).toMatch(/cannot read \("Infinity"\)/);
    expect(await refusal(await one('<row r="1"><c r="A1"><v>1e400</v></c></row>'))).toMatch(/cannot read \("1e400"\)/);
    expect((await ok(await one('<row r="1"><c r="A1"><v> 5 </v></c></row>'))).text).toBe("5");
  });
});
