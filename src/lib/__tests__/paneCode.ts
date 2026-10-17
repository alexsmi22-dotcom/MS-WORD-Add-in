// The pane's code, wherever it now lives.
//
// The host-adapter refactor (docs/SCOPE-HOST-ADAPTER.md) moves code out of
// taskpane.ts: every document batch into src/host, and pure helpers into
// src/lib. Tests that pin a moved function by reading source text must follow
// it, or an assertion like `not.toMatch(/InsertLocation\.replace/)` passes
// VACUOUSLY on a body that no longer holds the code. Reading through here,
// a moved function is still found by name, and a deleted one still fails.
import * as fs from "fs";
import * as path from "path";

const SRC = path.join(__dirname, "..", "..");

/** Modules that took code out of taskpane.ts (src/lib side). Add one per move. */
const MOVED_FROM_PANE = ["lib/financeFigures.ts", "lib/assayFormat.ts"];

export function paneCode(): string {
  const parts = [path.join(SRC, "taskpane", "taskpane.ts")];
  const hostDir = path.join(SRC, "host");
  for (const f of fs.readdirSync(hostDir).sort()) if (f.endsWith(".ts")) parts.push(path.join(hostDir, f));
  for (const m of MOVED_FROM_PANE) parts.push(path.join(SRC, m));
  return parts.map((p) => fs.readFileSync(p, "utf8")).join("\n");
}
