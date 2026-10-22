/**
 * The STEP / IGES reader (docs/SCOPE-STEP-IMPORT.md): OpenCascade as WebAssembly (occt-import-js 0.0.23, LGPL-2.1),
 * run in a Web Worker so a large assembly never freezes the pane (it takes about 190 MB while it reads), one worker per
 * file, ended when it answers — its memory goes with it.
 *
 * NOT bundled: the published files are shipped unmodified (the LGPL's terms, and webpack would rewrite them) in
 * dist/engines/occt-0.0.23/ beside our own small worker (webpack.config.js copies all of them). They are not in the
 * precache — 7.6 MB that every release would fetch again — but fetched the first time a STEP file is opened and kept by
 * the service worker in its engine cache from then on, across releases (src/sw/sw.js).
 */
import type { OcctResult } from "../lib/step";

/** The engine's folder in dist: its version is in the name, so a new engine is a new URL (and a new cache entry). */
export const STEP_ENGINE_DIR = "engines/occt-0.0.23/";
/** Longer than any file a drawing can hold takes (an 18-part assembly reads in a third of a second). */
export const STEP_TIMEOUT_MS = 120_000;

/** Reads one file in a fresh worker: the engine's answer, or why not (in words, for the status line). */
export function readStepFile(format: "step" | "iges", bytes: Uint8Array, timeoutMs = STEP_TIMEOUT_MS): Promise<{ ok: true; result: OcctResult } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL(STEP_ENGINE_DIR + "step-worker.js", document.baseURI).href);
    } catch {
      resolve({ ok: false, reason: "the STEP reader could not start in this version of Word" });
      return;
    }
    let done = false;
    const finish = (v: { ok: true; result: OcctResult } | { ok: false; reason: string }): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      worker.terminate();
      resolve(v);
    };
    const timer = window.setTimeout(
      () => finish({ ok: false, reason: `reading it took longer than ${Math.round(timeoutMs / 60000)} minutes and was stopped — export the parts you need on their own` }),
      timeoutMs,
    );
    // The reader's script or its WebAssembly not to be had (offline before the first STEP file — review: a cached
    // script with no wasm gave a bare "Aborted(…)"), or out of memory.
    const couldNotLoad = (detail: string): string =>
      navigator.onLine === false
        ? "the STEP reader is downloaded the first time a STEP file is opened (3 MB) — connect once, and it is kept for offline use"
        : `the STEP reader could not load (${detail})`;
    worker.onmessage = (ev: MessageEvent<{ ok: boolean; result?: OcctResult; reason?: string }>) => {
      const d = ev.data;
      if (d && d.ok && d.result) return finish({ ok: true, result: d.result });
      const why = d?.reason ?? "no answer";
      finish({
        ok: false,
        // Not "memory access out of bounds" (a crash, third review): only a real shortage of memory.
        reason: /out of memory|cannot enlarge memory|allocat/i.test(why)
          ? "the STEP reader ran out of memory reading it — export the parts you need on their own"
          : /aborted|fetch|network|failed to|wasm/i.test(why) ? couldNotLoad(why) : `the STEP reader failed (${why})`,
      });
    };
    worker.onerror = (ev: ErrorEvent) => {
      ev.preventDefault();
      finish({ ok: false, reason: couldNotLoad(ev.message || "an internal error") });
    };
    const copy = bytes.slice(); // the worker takes the bytes; the pane keeps its own for the file's fingerprint
    worker.postMessage({ format, bytes: copy }, [copy.buffer]);
  });
}
