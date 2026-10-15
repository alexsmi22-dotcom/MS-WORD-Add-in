// Every shipped default of the v2.140.0 audio / video / light calculators must
// parse (brief SCOPE-AUDIO-VIDEO-2026-10 §C0, §E8).
//
// A default that fails to parse makes engUnits refuse, so the tool inserts
// NOTHING on its own defaults — and the Engineering audit only notices after a
// build. This reads the defaults FROM THE PANE SOURCE (taskpane.ts cannot be
// imported under jest), pairs each field with the SI unit its compute reads it
// in, and parses it through the same parseMeasured the pane uses, so a default
// added later, or a units edit that breaks an old one, fails here.
//
// Defaults read by a lib parser instead of the unit layer (band lists with
// "1k", surfaces, timecodes, ratios, frame sizes, level lists) are pinned below
// through those parsers, verbatim.

import * as fs from "fs";
import * as path from "path";
import { parseMeasured } from "../units";
import { parseBandList, parseLevelList, parseSurfaceList } from "../audio";
import { parseTimecode, parseRate } from "../timecode";
import { parseRatio, parseFrameSize } from "../video";

const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");

const NEW_IDS = [
  "audio-levels",
  "audio-levelmath",
  "audio-dither",
  "audio-filesize",
  "audio-loudness",
  "audio-speaker",
  "audio-absorption",
  "audio-crossover",
  "audio-damping",
  "video-timecode",
  "video-framerate",
  "video-aspect",
  "video-transfer",
  "video-interface",
  "light-photometry",
  "light-exposure",
  "light-colourtemp",
];

function entryBody(id: string): string {
  const start = PANE.indexOf(`id: "${id}",`);
  if (start < 0) throw new Error(`${id} not found in taskpane.ts`);
  const next = PANE.indexOf("\n    id: \"", start + 10);
  return PANE.slice(start, next < 0 ? undefined : next);
}

function defaults(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/key:\s*"([^"]+)",\s*label:\s*(?:"(?:[^"\\]|\\.)*"|`[^`]*`),\s*default:\s*"([^"]*)"/g)) {
    out.set(m[1], m[2]);
  }
  return out;
}

const pairs: { id: string; key: string; si: string; value: string }[] = [];
for (const id of NEW_IDS) {
  const body = entryBody(id);
  const d = defaults(body);
  for (const m of body.matchAll(/u\.(?:req|opt|optNull)\("([^"]+)",\s*"([^"]+)"/g)) {
    const value = d.get(m[1]);
    if (value !== undefined) pairs.push({ id, key: m[1], si: m[2], value });
  }
}

describe("v2.140.0 calculator defaults parse (the scan is not vacuous)", () => {
  it("finds every new calculator and enough unit-read defaults", () => {
    for (const id of NEW_IDS) expect(PANE.includes(`id: "${id}",`)).toBe(true);
    expect(pairs.length).toBeGreaterThanOrEqual(39); // 39 at v2.140.0
    expect(pairs.filter((p) => p.value !== "").length).toBeGreaterThanOrEqual(30);
  });

  it.each(pairs.filter((p) => p.value !== ""))("$id · $key: \"$value\" parses as $si", ({ value, si }) => {
    const r = parseMeasured(value, si);
    expect("error" in r ? r.error : "ok").toBe("ok");
  });
});

describe("§C0 strings that were FAIL before v2.140.0 now parse", () => {
  it.each([
    ["29.97 FPS", "fps"],
    ["30 Fps", "fps"],
    ["48 KHz", "Hz"],
    ["48 khz", "Hz"],
    ["5 Mbps", "bit/s"],
    ["320 kbps", "bit/s"],
    ["1000 NIT", "nit"],
    ["50 fc", "lx"],
    ["14 ftL", "nit"],
    ["20 µPa", "Pa"],
    ["1 pW", "W"],
    ["1/125 s", "s"],
  ])("%s → %s", (text, si) => {
    const r = parseMeasured(text, si);
    expect("error" in r ? r.error : "ok").toBe("ok");
  });

  it("1/125 s is exactly 0.008 s", () => {
    const r = parseMeasured("1/125 s", "s");
    expect("error" in r ? NaN : r.inTarget).toBeCloseTo(0.008, 15);
  });
});

describe("defaults read by lib parsers parse verbatim", () => {
  const val = (id: string, key: string): string => {
    const v = defaults(entryBody(id)).get(key);
    if (v === undefined) throw new Error(`${id}.${key} has no default`);
    return v;
  };

  it("band list with 1k (audio-levelmath)", () => {
    const r = parseBandList(val("audio-levelmath", "bands"));
    expect(r.ok && r.values).toEqual([63, 125, 250, 500, 1000, 2000, 4000, 8000]);
  });

  it("level lists (levelmath levels, band levels, loudness blocks)", () => {
    for (const [id, key] of [
      ["audio-levelmath", "levels"],
      ["audio-levelmath", "bandlv"],
      ["audio-loudness", "blocks"],
    ]) {
      expect(parseLevelList(val(id, key)).ok).toBe(true);
    }
  });

  it("surfaces (audio-absorption)", () => {
    const r = parseSurfaceList(val("audio-absorption", "surf"));
    expect(r.ok && r.values.length).toBe(3);
  });

  it("timecode and rate (video-timecode)", () => {
    expect("error" in parseTimecode(val("video-timecode", "tca"))).toBe(false);
    expect(parseRate(val("video-timecode", "rate")).ok).toBe(true);
  });

  it("source and target frame rates (video-framerate)", () => {
    expect(parseRate(val("video-framerate", "src")).ok).toBe(true);
    expect(parseRate(val("video-framerate", "dst")).ok).toBe(true);
  });

  it("ratios and frame sizes (video-aspect, video-interface), with × and with x", () => {
    expect("error" in parseRatio(val("video-aspect", "dar"))).toBe(false);
    expect("error" in parseRatio(val("video-aspect", "content"))).toBe(false);
    expect("error" in parseFrameSize(val("video-aspect", "frame"))).toBe(false);
    expect("error" in parseFrameSize(val("video-interface", "active"))).toBe(false);
    expect("error" in parseFrameSize(val("video-interface", "total"))).toBe(false);
    expect("error" in parseFrameSize("1920x1080")).toBe(false);
  });
});
