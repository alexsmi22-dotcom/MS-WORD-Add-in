// Page ranges per style (bibPages.ts). Every expected string below is either quoted from
// a fetched manual (source named on the line) or is a CMOS 9.64 table entry, labelled so.
import { formatPages, isPageRange, splitRange } from "../bibPages";

const EN = String.fromCharCode(0x2013);
const MINUS = String.fromCharCode(0x2212);

describe("full rule (IEEE, APA, ACS, Nature): all digits, en dash", () => {
  test.each([
    // IEEE Reference Guide V 3.28.2025: "pp. 2787–2793", "pp. 55–70".
    ["2787-2793", `2787${EN}2793`],
    ["55--70", `55${EN}70`],
    // APA (apastyle.apa.org journal-article-references, 2026-10-14): "207–217".
    ["207–217", `207${EN}217`],
    // ACS quick guide renders ranges with U+2212 MINUS SIGN; we print the en dash.
    [`1174${MINUS}1184`, `1174${EN}1184`],
    // An elided input is expanded, because these styles print full numbers.
    ["284-7", `284${EN}287`],
    ["1818-59", `1818${EN}1859`],
  ])("%s → %s", (input, want) => {
    expect(formatPages(input, "full")).toBe(want);
  });
});

describe("NLM rule: hyphen with leading digits elided", () => {
  // nlm.nih.gov/bsd/uniform_requirements.html, fetched 2026-10-14.
  test.each([
    ["284-287", "284-7"], // Halpern … N Engl J Med … 347(4):284-7
    ["40-46", "40-6"], // Rose … Brain Res … 935(1-2):40-6
    ["1151-1168", "1151-68"], // Malinowski … Clin Ther … 22(10):1151-68
    ["93-113", "93-113"], // Meltzer chapter "p. 93-113": different lengths, nothing elided
    ["229–332", "229-332"], // Rojko chapter (Citing Medicine ch. 2) "p. 229-332"
    ["221-228", "221-8"], // Whiteside chapter "p. 221-8"
    ["909-911", "909-11"],
  ])("%s → %s", (input, want) => {
    expect(formatPages(input, "nlm")).toBe(want);
  });
});

describe("Chicago rule: CMOS 9.64", () => {
  // The eight pairs printed in the CMOS 18 citation quick guide (fetched 2026-10-14).
  test.each([
    ["1818-1859", `1818${EN}59`],
    ["471-485", `471${EN}85`],
    ["307-313", `307${EN}13`],
    ["225-251", `225${EN}51`],
    ["117-118", `117${EN}18`],
    ["1842-1843", `1842${EN}43`],
    ["9-10", `9${EN}10`],
    ["104-105", `104${EN}5`],
  ])("quick guide: %s → %s", (input, want) => {
    expect(formatPages(input, "chicago")).toBe(want);
  });
  // CMOS 9.64 table entries (implementation of the table, not a fetched page).
  test.each([
    ["71-72", `71${EN}72`],
    ["96-117", `96${EN}117`],
    ["100-104", `100${EN}104`],
    ["1100-1113", `1100${EN}1113`],
    ["101-108", `101${EN}8`],
    ["808-833", `808${EN}33`],
    ["1103-1104", `1103${EN}4`],
    ["321-328", `321${EN}28`],
    ["498-532", `498${EN}532`],
    ["1087-1089", `1087${EN}89`],
    ["1496-1504", `1496${EN}1504`],
  ])("CMOS table: %s → %s", (input, want) => {
    expect(formatPages(input, "chicago")).toBe(want);
  });
  test("an already-elided input is re-elided the Chicago way", () => {
    expect(formatPages("1818-59", "chicago")).toBe(`1818${EN}59`);
  });
});

describe("never elided, never mistaken for a range", () => {
  test("article numbers are not ranges", () => {
    expect(formatPages("e0318239", "chicago")).toBe("e0318239");
    expect(formatPages("230903", "full")).toBe("230903");
    expect(isPageRange("e0318239")).toBe(false);
  });
  test("alphanumeric ranges keep both ends (IEEE \"pp. A635–A646\")", () => {
    expect(formatPages("A635-A646", "full")).toBe(`A635${EN}A646`);
    expect(formatPages("S93-S99", "nlm")).toBe("S93-S99");
    expect(formatPages("iii-v", "chicago")).toBe(`iii${EN}v`);
  });
  test("a strong separator wins over inner hyphens (IEEE \"pp. 2.2-1–2.2-6\")", () => {
    expect(splitRange("2.2-1–2.2-6")).toEqual(["2.2-1", "2.2-6"]);
    expect(formatPages("2.2-1–2.2-6", "full")).toBe(`2.2-1${EN}2.2-6`);
  });
  test("single pages and lists", () => {
    expect(formatPages("475", "full")).toBe("475");
    expect(isPageRange("475")).toBe(false);
    expect(isPageRange("475-480")).toBe(true);
    expect(formatPages("1-5, 7-9", "full")).toBe(`1${EN}5, 7${EN}9`);
  });
  test("an impossible elision is printed as given, not invented", () => {
    expect(formatPages("350-20", "full")).toBe(`350${EN}20`); // 320 < 350: not an elision
    expect(formatPages("300-20", "full")).toBe(`300${EN}320`); // a valid elision of 300–320
  });
  test("empty input", () => {
    expect(formatPages(undefined, "full")).toBe("");
    expect(formatPages("  ", "nlm")).toBe("");
  });
});
