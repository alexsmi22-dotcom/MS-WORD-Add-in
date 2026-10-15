/**
 * @jest-environment jsdom
 */
// Document store, marker tags (docs/SCOPE-CITATIONS-2026-10.md §C4) and the bibliography OOXML
// block. jsdom supplies DOMParser for the "the OOXML parses" check.

import type { BibRecord } from "../bibRecord";
import {
  BIB_STORE_MAX_BYTES, BIBLIOGRAPHY_TAG, CITE_TAG_PREFIX, WORD_TAG_MAX, addMarker, citeTag, emptyStore,
  markersFromControls, mergeRecords, nextMarkerId, parseCiteTag, parseStore, recordProblem, serializeStore, setMarkerItems,
  type BibStoreData,
} from "../bibStore";
import { bibliographyOoxml, decodeEntities, htmlToRuns } from "../bibOoxml";
import { renumberPlan } from "../bibliography";

const r = (id: string, title = "T", extra: Partial<BibRecord> = {}): BibRecord => ({
  id, type: "article-journal", title, author: [{ family: "Smith", given: "J." }], issued: { "date-parts": [[2020]] }, ...extra,
});

const withLib = (...recs: BibRecord[]): BibStoreData => mergeRecords(emptyStore("ieee"), recs).store;

// ------------------------------------------------------------------ tags

describe("marker tags", () => {
  test("formula-inserter:cite:<id>, within Word's reported 64-character limit", () => {
    expect(citeTag("1a")).toEqual({ ok: true, tag: "formula-inserter:cite:1a" });
    expect(CITE_TAG_PREFIX.length).toBe(22);
    const longest = "z".repeat(WORD_TAG_MAX - CITE_TAG_PREFIX.length);
    const ok = citeTag(longest);
    expect(ok.ok && ok.tag.length).toBe(64);
  });
  test("anything over 64 characters is refused by name", () => {
    const id = "z".repeat(43);
    const res = citeTag(id);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain(id);
      expect(res.reason).toContain("65 characters");
      expect(res.reason).toContain("64");
    }
  });
  test("non-base-36 ids are refused by name", () => {
    for (const bad of ["", "A1", "smith2020:x", "1 2", "é"]) {
      const res = citeTag(bad);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toContain(`"${bad}"`);
    }
  });
  test("old tags are never read as markers", () => {
    for (const t of ["formula-inserter:citation", "formula-inserter:bibliography", "formula-inserter:toa",
      "jurislab:toafield", "formula-inserter:cite:", "formula-inserter:cite:UPPER", "formula-inserter:cite", null, undefined, ""]) {
      expect(parseCiteTag(t)).toBeNull();
    }
    expect(parseCiteTag(`formula-inserter:cite:${"z".repeat(43)}`)).toBeNull();
    expect(parseCiteTag("formula-inserter:cite:1a")).toBe("1a");
    expect(BIBLIOGRAPHY_TAG).toBe("formula-inserter:bibliography");
  });
  test("markersFromControls keeps document order and ignores every other control", () => {
    const controls = [
      { tag: "formula-inserter:citation", text: "Alice, 573 U.S. 208" },
      { tag: "formula-inserter:cite:2", text: "[1]" },
      { tag: "formula-inserter:bibliography", text: "…" },
      { tag: "formula-inserter:cite:1", text: "[2]" },
      { tag: null, text: "x" },
      { tag: "formula-inserter:cite:2", text: "[1]" },
    ];
    expect(markersFromControls(controls)).toEqual([
      { markerId: "2", text: "[1]" }, { markerId: "1", text: "[2]" }, { markerId: "2", text: "[1]" },
    ]);
  });
  test("nextMarkerId counts in base 36 and never reuses an id", () => {
    const s = emptyStore("ieee");
    expect(nextMarkerId(s)).toBe("1");
    expect(nextMarkerId({ ...s, markers: { "9": [] } })).toBe("a");
    expect(nextMarkerId({ ...s, markers: { z: [], "3": [] } })).toBe("10");
  });
  test("nextMarkerId is exact past 2^53 (no Number round-off)", () => {
    const s = emptyStore("ieee");
    expect(nextMarkerId({ ...s, markers: { "1000000000000": [], "1000000000001": [] } })).toBe("1000000000002");
    expect(nextMarkerId({ ...s, markers: { zzzzzzzzzzzzz: [] } })).toBe("10000000000000");
    expect(nextMarkerId({ ...s, markers: { "007": [] } })).toBe("8");
  });
});

// ------------------------------------------------------------------ store construction

describe("store construction", () => {
  test("addMarker refuses a citekey that is not in the library, by name", () => {
    const s = withLib(r("smith2020"));
    const res = addMarker(s, [{ id: "smith2020" }, { id: "jones1999" }]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("\"jones1999\"");
    expect(addMarker(s, []).ok).toBe(false);
  });
  test("addMarker returns the new id and tag, without mutating the input", () => {
    const s = withLib(r("smith2020"));
    const res = addMarker(s, [{ id: "smith2020", locator: "4" }]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.markerId).toBe("1");
      expect(res.tag).toBe("formula-inserter:cite:1");
      expect(res.store.markers["1"]).toEqual([{ id: "smith2020", locator: "4" }]);
      const second = addMarker(res.store, [{ id: "smith2020" }]);
      expect(second.ok && second.markerId).toBe("2");
    }
    expect(s.markers).toEqual({});
  });
  test("setMarkerItems edits a citation and refuses unknown ids", () => {
    const s0 = withLib(r("a"), r("b"));
    const add = addMarker(s0, [{ id: "a" }]);
    if (!add.ok) throw new Error(add.reason);
    const ed = setMarkerItems(add.store, "1", [{ id: "a" }, { id: "b" }]);
    expect(ed.ok && ed.store.markers["1"].length).toBe(2);
    expect(setMarkerItems(add.store, "1", [{ id: "nope" }]).ok).toBe(false);
    expect(setMarkerItems(add.store, "9", [{ id: "a" }]).ok).toBe(false);
  });
});

describe("duplicate ids from two imports", () => {
  test("the identical record is a no-op", () => {
    const s = withLib(r("smith2020"));
    const m = mergeRecords(s, [r("smith2020")]);
    expect(m.identical).toEqual(["smith2020"]);
    expect(m.added).toEqual([]);
    expect(Object.keys(m.store.library)).toEqual(["smith2020"]);
  });
  test("a different record under a taken id is renamed and reported; the existing one is never overwritten", () => {
    const s = withLib(r("smith2020", "First import"));
    const m = mergeRecords(s, [r("smith2020", "Second import"), r("smith2020", "Third import")]);
    expect(m.renamed).toEqual([{ from: "smith2020", to: "smith2020-2" }, { from: "smith2020", to: "smith2020-3" }]);
    expect(m.store.library.smith2020.title).toBe("First import");
    expect(m.store.library["smith2020-2"]).toEqual({ ...r("smith2020", "Second import"), id: "smith2020-2" });
    expect(s.library["smith2020-2"]).toBeUndefined();
    // Importing the second file again changes nothing.
    const again = mergeRecords(m.store, [r("smith2020", "Second import")]);
    expect(again.renamed).toEqual([]);
    expect(again.identical).toEqual(["smith2020-2"]);
  });
  test("duplicates inside one import are handled the same way", () => {
    const m = mergeRecords(emptyStore("apa7"), [r("k", "A"), r("k", "B"), r("k", "A")]);
    expect(m.added).toEqual(["k"]);
    expect(m.renamed).toEqual([{ from: "k", to: "k-2" }]);
    expect(m.identical).toEqual(["k"]);
  });
  test("an invalid record is refused by name", () => {
    const m = mergeRecords(emptyStore("apa7"), [{ id: "x", type: "novel" } as unknown as BibRecord, { id: "", type: "book" } as BibRecord]);
    expect(m.refused[0]).toEqual({ id: "x", reason: "record \"x\" has an unsupported type \"novel\"" });
    expect(m.refused[1].reason).toBe("the record has no id");
    expect(recordProblem(r("ok"))).toBeNull();
  });
});

// ------------------------------------------------------------------ (de)serialisation

describe("serialize / parse (jurislab.bib.v1)", () => {
  test("round trip, Unicode intact", () => {
    const t = "H₂O, CO₂ & <b>Å</b> in µ-scale α-helices";
    const s0 = withLib(r("u", t, { author: [{ family: "Ångström", given: "Anders", "non-dropping-particle": "van" }] }));
    const add = addMarker(s0, [{ id: "u", locator: "12–14", label: "page" }]);
    if (!add.ok) throw new Error(add.reason);
    const ser = serializeStore(add.store);
    expect(ser.ok).toBe(true);
    if (!ser.ok) return;
    expect(JSON.parse(ser.json).version).toBe(1);
    const back = parseStore(ser.json);
    expect(back).toEqual({ ok: true, store: add.store });
    // Settings may hand back the already-parsed object.
    expect(parseStore(JSON.parse(ser.json))).toEqual({ ok: true, store: add.store });
    if (back.ok && back.store) expect(back.store.library.u.title).toBe(t);
  });
  test("no store yet", () => {
    expect(parseStore(undefined)).toEqual({ ok: true, store: null });
    expect(parseStore(null)).toEqual({ ok: true, store: null });
    expect(parseStore("")).toEqual({ ok: true, store: null });
  });
  test("a newer version is refused by name", () => {
    const res = parseStore(JSON.stringify({ version: 2, style: "ieee", library: {}, markers: {} }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("version 2, made by a newer JurisLab");
  });
  test("bad JSON, unknown version and damaged stores are refused by name", () => {
    const bad = parseStore("{not json");
    expect(bad.ok === false && bad.reason).toContain("jurislab.bib.v1");
    const nov = parseStore({ style: "ieee", library: {}, markers: {} });
    expect(nov.ok === false && nov.reason).toContain("unknown version");
    const mism = parseStore({ version: 1, style: "ieee", library: { a: r("b") }, markers: {} });
    expect(mism.ok === false && mism.reason).toContain("library key \"a\" holds record \"b\"");
    const sty = parseStore({ version: 1, style: "bluebook", library: {}, markers: {} });
    expect(sty.ok === false && sty.reason).toContain("unknown style \"bluebook\"");
    const mk = parseStore({ version: 1, style: "ieee", library: {}, markers: { "Bad Id": [] } });
    expect(mk.ok === false && mk.reason).toContain("marker id \"Bad Id\"");
    const item = parseStore({ version: 1, style: "ieee", library: {}, markers: { "1": [{ id: "a", label: "verse" }] } });
    expect(item.ok === false && item.reason).toContain("unknown label \"verse\"");
  });
  test("an oversized store is refused with its size and the limit", () => {
    const big = "x".repeat(BIB_STORE_MAX_BYTES);
    const res = serializeStore(withLib(r("huge", big)));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain(BIB_STORE_MAX_BYTES.toLocaleString("en-US"));
      expect(res.reason).toMatch(/is [\d,]+ bytes/);
    }
  });
  test("multi-byte characters count as UTF-8 bytes", () => {
    const res = serializeStore(withLib(r("u", "₂".repeat(1000))));
    expect(res.ok && res.bytes).toBeGreaterThan(3000);
  });
  test("1,000 references: serialize + parse quickly and well under the limit", () => {
    const recs = Array.from({ length: 1000 }, (_, i) => r(`k${i}`, `A fairly typical article title number ${i} about H₂O`, {
      "container-title": "Journal of the American Chemical Society", volume: "142", issue: "3", page: "1234–1240", DOI: `10.1021/jacs.${i}`,
    }));
    const t0 = Date.now();
    const s = withLib(...recs);
    const ser = serializeStore(s);
    expect(ser.ok).toBe(true);
    if (!ser.ok) return;
    const back = parseStore(ser.json);
    expect(back.ok && back.store && Object.keys(back.store.library).length).toBe(1000);
    expect(ser.bytes).toBeLessThan(BIB_STORE_MAX_BYTES / 4);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

// ------------------------------------------------------------------ OOXML

describe("bibliography OOXML", () => {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const parse = (xml: string): Document => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagName("parsererror").length).toBe(0);
    return doc;
  };

  test("parses, hanging indent, label + tab, H₂O and italics as run properties", () => {
    const xml = bibliographyOoxml([
      { n: 1, formatted: { html: "A. Smith, “H<sub>2</sub>O and H₂O,” <i>J. Test.</i>, vol. 1, pp. 1–2.", plain: "" } },
      { n: 2, formatted: null },
      { n: 3, formatted: { html: "B. Jones &amp; C. Lee, “x &lt; y,” <span class=\"nocase\">pH</span>.", plain: "" } },
    ], { heading: "References", label: (n) => `[${n}]` });
    const doc = parse(xml);
    const paras = doc.getElementsByTagNameNS(W, "p");
    expect(paras.length).toBe(3); // heading + two entries (the refused one is skipped)
    const ind = paras[1].getElementsByTagNameNS(W, "ind")[0];
    expect(ind.getAttributeNS(W, "left")).toBe("720");
    expect(ind.getAttributeNS(W, "hanging")).toBe("720");
    const text = (p: Element): string => Array.from(p.getElementsByTagNameNS(W, "t")).map((t) => t.textContent).join("");
    expect(text(paras[0])).toBe("References");
    expect(text(paras[1])).toBe("[1]A. Smith, “H2O and H₂O,” J. Test., vol. 1, pp. 1–2.");
    expect(paras[1].getElementsByTagNameNS(W, "tab").length).toBe(1);
    const sub = paras[1].getElementsByTagNameNS(W, "vertAlign")[0];
    expect(sub.getAttributeNS(W, "val")).toBe("subscript");
    expect(paras[1].getElementsByTagNameNS(W, "i").length).toBe(1);
    expect(text(paras[2])).toBe("[3]B. Jones & C. Lee, “x < y,” pH.");
    expect(xml).toContain("&amp; C. Lee");
    expect(xml).not.toContain("&amp;amp;");
  });

  test("author-date: no label, plain Formatted[] accepted, superscript and small caps", () => {
    const xml = bibliographyOoxml([{ html: "Smith, J. (2020a). <b>Bold</b> ¹³C <sup>13</sup>C <span style=\"font-variant: small-caps\">Sc</span>.", plain: "" }]);
    const doc = parse(xml);
    const p = doc.getElementsByTagNameNS(W, "p")[0];
    expect(p.getElementsByTagNameNS(W, "tab").length).toBe(0);
    expect(p.getElementsByTagNameNS(W, "vertAlign")[0].getAttributeNS(W, "val")).toBe("superscript");
    expect(p.getElementsByTagNameNS(W, "smallCaps").length).toBe(1);
    expect(p.getElementsByTagNameNS(W, "b").length).toBe(1);
    expect(p.textContent).toContain("¹³C");
  });

  test("reverse italics: a species name inside an italic title stays roman", () => {
    const doc = parse(bibliographyOoxml([{ html: "<i>Genetics of <span style=\"font-style:normal\">Escherichia coli</span> today</i>.", plain: "" }]));
    const runs = Array.from(doc.getElementsByTagNameNS(W, "r")).map((r) => [r.textContent, r.getElementsByTagNameNS(W, "i").length]);
    expect(runs).toEqual([["Genetics of ", 1], ["Escherichia coli", 0], [" today", 1], [".", 0]]);
  });

  test("an empty list is still a valid package; forbidden XML characters are dropped", () => {
    parse(bibliographyOoxml([]));
    const ctrl = "a" + String.fromCharCode(0x0b) + "b" + String.fromCharCode(0xfffe) + "c";
    const runs = htmlToRuns(ctrl);
    expect(runs).toContain(">abc<");
  });

  test("entities decode once", () => {
    expect(decodeEntities("&amp;lt; &#8211; &#x2082; &nbsp;")).toBe(`&lt; – ₂ ${String.fromCharCode(0xa0)}`);
  });

  test("a plan's entries go straight in", () => {
    const s = withLib(r("a", "Alpha H₂O"), r("b", "Beta"));
    const add = addMarker(s, [{ id: "b" }, { id: "a" }]);
    if (!add.ok) throw new Error(add.reason);
    const style = {
      id: "ieee" as const, name: "stub", kind: "numeric" as const, order: "citation" as const,
      reference: (rec: BibRecord) => ({ html: rec.title ?? "", plain: rec.title ?? "" }),
      marker: () => ({ html: "", plain: "" }),
    };
    const plan = renumberPlan([add.markerId], add.store, style);
    const doc = parse(bibliographyOoxml(plan.entries, { label: (n) => `${n}.` }));
    const texts = Array.from(doc.getElementsByTagNameNS(W, "p")).map((p) => p.textContent);
    expect(texts).toEqual(["1.Beta", "2.Alpha H₂O"]);
  });
});
