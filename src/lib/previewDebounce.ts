// A debounced preview that Insert can FLUSH: the Stats and Solve panes recompute after a pause in typing, and
// nothing may ever insert the result of an earlier keystroke (preview-is-not-insert).
//
// Release D, measured in the production bundle (headless Edge, per keystroke, compute + layout of the result):
//   Statistics, every calculator on ~2000 pasted values: most 1–30 ms, but polynomial regression 162 ms, Tukey HSD
//   at 20 groups 504 ms, Dunnett at 20 groups 207 ms (both now capped at 20 groups: 50 groups were 4.0 s / 0.77 s,
//   500 groups 31.8 s / 5.3 s);
//   Solve: most kinds 0.3–5 ms, a derivative 18–24 ms, the integral of x³·eˣ·sin x 94–112 ms.
// So typing into those fields recomputed for up to a fifth of a second per character. PREVIEW_DEBOUNCE_MS waits for
// a pause instead; a "change" event (leaving the field), Insert, and any direct recompute run it at once.
//
// Pure: no DOM, no Office.js.

/** The pause after the last keystroke before Stats and Solve recompute. */
export const PREVIEW_DEBOUNCE_MS = 200;

export interface DebouncedPreview {
  /** Run the preview PREVIEW_DEBOUNCE_MS (or the given delay) after the last call. */
  schedule(): void;
  /** If a run is pending, run it NOW (synchronously) and clear it. Returns whether it ran. */
  flush(): boolean;
  /** Drop a pending run (the caller is about to recompute directly). */
  cancel(): void;
  /** Is a run pending? */
  pending(): boolean;
}

type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};
const DEFAULT_TIMERS: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function debouncedPreview(run: () => void, ms: number = PREVIEW_DEBOUNCE_MS, timers: Timers = DEFAULT_TIMERS): DebouncedPreview {
  let handle: unknown = null;
  const cancel = (): void => {
    if (handle !== null) timers.clear(handle);
    handle = null;
  };
  return {
    schedule() {
      cancel();
      handle = timers.set(() => {
        handle = null;
        run();
      }, ms);
    },
    flush() {
      if (handle === null) return false;
      cancel();
      run();
      return true;
    },
    cancel,
    pending: () => handle !== null,
  };
}

/**
 * For an Insert click: bring the preview up to date first, then say whether the (now current) result may be
 * inserted. The button's `disabled` is what the preview just decided; a result that stopped being insertable on the
 * last keystroke is therefore never inserted from the stale one.
 */
export function flushBeforeInsert(preview: DebouncedPreview, button: { disabled: boolean }): boolean {
  preview.flush();
  return !button.disabled;
}

/**
 * The pause after the last keystroke in a Finance BLOCK (multi-line table) field. E1 fix, measured in jest before the
 * row caps were lowered: a 50,000-row prejudgment table compounded monthly took 3.9 s per keystroke and a 100,000-row
 * damages summary 3.4 s; at the 10,000-row cap a run is a few hundred ms, still too much per character.
 */
export const FIN_BLOCK_DEBOUNCE_MS = 300;

/**
 * A field listener for a registry whose number fields are cheap but whose block fields are not: an "input" event
 * from a TEXTAREA (a block field: a pasted or typed table) waits for the pause; every other event (a number field's
 * keystroke, a select's "change", leaving a field) and a direct call (no event) drops any pending run and runs now.
 */
export function blockFieldListener(preview: DebouncedPreview, runNow: () => void): (e?: Event | { type: string; target?: unknown }) => void {
  return (e) => {
    const t = e && (e as { target?: unknown }).target;
    const isBlock = !!t && typeof t === "object" && (t as { tagName?: unknown }).tagName === "TEXTAREA";
    if (e && e.type === "input" && isBlock) preview.schedule();
    else {
      preview.cancel();
      runNow();
    }
  };
}

/** A field listener: "input" (a keystroke) waits for the pause; "change" or a direct call (no event) runs now. */
export function previewListener(preview: DebouncedPreview, runNow: () => void): (e?: Event | { type: string }) => void {
  return (e) => {
    if (e && e.type === "input") preview.schedule();
    else {
      preview.cancel();
      runNow();
    }
  };
}
