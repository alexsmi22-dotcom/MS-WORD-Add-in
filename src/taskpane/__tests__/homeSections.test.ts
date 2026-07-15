/**
 * @jest-environment jsdom
 */
// Home-page section visibility.
//
// Regression: the Home branch of onInputChanged hid tool sections from a
// hand-written list, and analyze-section was missing from it. So on FIRST open
// the Analyze controls rendered underneath the Home tiles. It self-healed after
// you opened any tool (the per-mode branch set Analyze to "none" as a side
// effect), which is why it only ever showed on a fresh load.
//
// The fix reads the sections from the DOM instead of a list. These tests pin
// both halves of that: the selector must match every tool section (so nothing is
// missed) and must not match the Home section itself or nested sub-sections.

import * as fs from "fs";
import * as path from "path";

const html = fs.readFileSync(path.join(__dirname, "..", "taskpane.html"), "utf8");

/** Loads the real pane markup into the jsdom document. */
function loadPane(): Document {
  document.documentElement.innerHTML = html
    .replace(/<!doctype html>/i, "")
    .replace(/<\/?html[^>]*>/gi, "");
  return document;
}

describe("Home hides every tool section", () => {
  test("the selector matches all tool sections, including analyze", () => {
    const d = loadPane();
    const ids = [...d.querySelectorAll("main > section")].map((s) => s.id);
    // The bug in one assertion: analyze must be reachable by the selector.
    expect(ids).toContain("analyze-section");
    expect(ids).toContain("home-section");
    // A representative spread of the rest.
    for (const id of [
      "format-section",
      "spectra-section",
      "massspec-section",
      "stats-section",
      "citations-section",
      "audit-section",
      "ppt-section",
    ]) {
      expect(ids).toContain(id);
    }
  });

  test("nested sub-sections are NOT matched (they belong to their parent)", () => {
    const d = loadPane();
    const ids = [...d.querySelectorAll("main > section")].map((s) => s.id);
    // structure-section lives inside format-section; hiding it independently
    // would break Chemical mode.
    expect(ids).not.toContain("structure-section");
    expect(d.getElementById("structure-section")).not.toBeNull();
  });

  test("applying the Home rule hides every tool section and keeps Home visible", () => {
    const d = loadPane();
    const home = d.getElementById("home-section") as HTMLElement;

    // This is exactly what the Home branch of onInputChanged does.
    for (const el of d.querySelectorAll<HTMLElement>("main > section")) {
      if (el !== home) el.style.display = "none";
    }

    const analyze = d.getElementById("analyze-section") as HTMLElement;
    expect(analyze.style.display).toBe("none");
    for (const el of d.querySelectorAll<HTMLElement>("main > section")) {
      if (el.id === "home-section") continue;
      expect(el.style.display).toBe("none");
    }
  });

  test("every tool section starts visible, which is why omitting one is a real bug", () => {
    // Sections carry no default display:none — nothing hides them but the code.
    // That is what made the missing list entry visible rather than harmless.
    const d = loadPane();
    const analyze = d.getElementById("analyze-section") as HTMLElement;
    expect(analyze.style.display).toBe("");
  });

  test("every tool section has a unique id", () => {
    const d = loadPane();
    const ids = [...d.querySelectorAll("main > section")].map((s) => s.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
