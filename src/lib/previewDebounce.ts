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
