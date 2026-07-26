// Contrast, measured rather than eyeballed.
//
// A dark palette is easy to make look plausible in a screenshot and still be
// unreadable: the first cut of this one put near-black text on a mid-blue button
// (2.3:1) and left the hint inside the white structure preview as pale grey on
// white, because that panel deliberately keeps its paper background while the
// ink token had flipped light.
//
// WCAG AA is the bar: 4.5:1 for body text, 3:1 for large text and UI edges.

import * as fs from "fs";
import * as path from "path";
import { luminanceOf } from "../theme";

const CSS = fs.readFileSync(
  path.join(__dirname, "..", "..", "taskpane", "taskpane.css"),
  "utf8",
);

/** Pulls a `--token: #value;` map out of one CSS block. */
function tokensIn(blockRe: RegExp): Record<string, string> {
  const m = blockRe.exec(CSS);
  if (!m) throw new Error("block not found: " + blockRe);
  const out: Record<string, string> = {};
  for (const t of m[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    out[t[1]] = t[2].trim();
  }
  return out;
}

const LIGHT = tokensIn(/:root \{([\s\S]*?)\n\}/);
const DARK = tokensIn(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/);

/** Resolves a token to a hex colour, following one level of var() aliasing. */
function resolve(name: string, palette: Record<string, string>): string {
  const raw = palette[name] ?? LIGHT[name];
  if (!raw) throw new Error("unknown token " + name);
  const alias = /^var\((--[a-z0-9-]+)\)$/.exec(raw);
  return alias ? resolve(alias[1], palette) : raw;
}

function contrast(a: string, b: string): number {
  const la = luminanceOf(a);
  const lb = luminanceOf(b);
  if (la === null || lb === null) throw new Error(`unparseable colour: ${a} / ${b}`);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text/background pairs the pane actually renders, per theme. */
const PAIRS: Array<{ name: string; fg: string; bg: string; min: number }> = [
  { name: "body text on the pane", fg: "--ink", bg: "--app-bg", min: 4.5 },
  { name: "body text on a card", fg: "--ink", bg: "--paper", min: 4.5 },
  { name: "secondary text on a card", fg: "--ink-2", bg: "--paper", min: 4.5 },
  { name: "muted text on the pane", fg: "--ink-3", bg: "--app-bg", min: 4.5 },
  { name: "tool card title", fg: "--navy-900", bg: "--paper", min: 4.5 },
  { name: "tool card description", fg: "--ink-2", bg: "--paper", min: 4.5 },
  { name: "icon on a card", fg: "--mid", bg: "--paper", min: 3 },
  { name: "error text", fg: "--error", bg: "--paper", min: 4.5 },
  { name: "success text", fg: "--success", bg: "--paper", min: 4.5 },
  { name: "warning text", fg: "--warn", bg: "--warn-bg", min: 4.5 },
  { name: "success pill", fg: "--success", bg: "--success-bg", min: 4.5 },
  { name: "rule against the pane", fg: "--rule", bg: "--app-bg", min: 1.1 },
  // Text on a filled control. These were missed the first time and the active
  // filter chip shipped at 2.3:1 in dark — the same defect as the button.
  { name: "label on the primary button", fg: "--on-accent", bg: "--accent", min: 4.5 },
  { name: "label on the active filter chip", fg: "--on-accent", bg: "--chip-on", min: 4.5 },
];

describe.each([
  ["light", LIGHT],
  ["dark", DARK],
] as const)("%s theme meets WCAG AA", (themeName, palette) => {
  test.each(PAIRS)("$name", ({ fg, bg, min }) => {
    const ratio = contrast(resolve(fg, palette), resolve(bg, palette));
    expect({ pair: `${fg} on ${bg}`, ok: ratio >= min, ratio: Number(ratio.toFixed(2)) }).toEqual({
      pair: `${fg} on ${bg}`,
      ok: true,
      ratio: Number(ratio.toFixed(2)),
    });
  });
});

describe("the paper preview stays readable", () => {
  test("--paper-fixed is white in BOTH themes", () => {
    // The structure/plot preview shows artwork that is inserted into the
    // document as black-on-white. It must not follow the theme.
    expect(resolve("--paper-fixed", LIGHT).toLowerCase()).toBe("#ffffff");
    expect(DARK["--paper-fixed"]).toBeUndefined(); // never overridden
  });

  test("text drawn ON that paper is dark in both themes", () => {
    // The bug this catches: --ink flips light for the dark pane, and the hint
    // inside the white preview becomes pale grey on white.
    for (const [name, palette] of [["light", LIGHT], ["dark", DARK]] as const) {
      const onPaper = CSS.includes("--ink-on-paper")
        ? resolve("--ink-on-paper", palette)
        : null;
      expect({ theme: name, defined: onPaper !== null }).toEqual({ theme: name, defined: true });
      expect(contrast(onPaper as string, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
  });
});
