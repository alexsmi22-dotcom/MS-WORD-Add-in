// The last line of defence: turning an uncaught error into something the user
// can see and repeat back, instead of a pane that silently stopped.
//
// WHY THIS EXISTS. In an Office task pane an unhandled rejection renders
// NOTHING. The WebView keeps showing the last painted frame, so a failure
// mid-render looks exactly like a pane that is thinking, and the user's only
// options are to close it or blame Word. Every other quality mechanism in this
// product — twelve QC gates, 7,700 tests, a headless render check — exists to
// stop a bug reaching the host, and the one failure mode that DID reach the
// host produced no signal for the user or for me.
//
// This module is deliberately pure and dependency-free so it can be unit
// tested; the listeners that call it live in taskpane.ts.
//
// NOTHING IS SENT ANYWHERE. There is no telemetry in this product and adding
// some here would break the offline promise that is its main privacy claim.
// The user is given the text and asked to send it if they want to.

/** How the pane refers to itself when asking for a report. */
export const CRASH_CONTACT = "github.com/alexsmi22-dotcom/MS-WORD-Add-in/issues";

export interface CrashInfo {
  /** One-line summary for the banner heading. */
  headline: string;
  /** The error message, cleaned of noise. */
  detail: string;
  /** Where it came from, e.g. "an unhandled promise rejection". */
  source: string;
  /** Copy-paste block: message + version + trimmed stack. */
  report: string;
}

/** Pulls a message out of whatever was actually thrown — which may not be an Error. */
export function messageOf(err: unknown): string {
  if (err === null) return "null was thrown";
  if (err === undefined) return "undefined was thrown";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    // Office.js rejects with {code, message, name} shapes rather than Errors.
    for (const k of ["message", "description", "code", "name"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v;
      if (typeof v === "number") return `code ${v}`;
    }
    try {
      const j = JSON.stringify(err);
      if (j && j !== "{}") return j.slice(0, 300);
    } catch {
      /* circular — fall through */
    }
  }
  return String(err);
}

/**
 * The stack, trimmed to something a human will actually paste.
 *
 * Bundled frames are one enormous line each; keeping six is enough to identify
 * the path and short enough that the user does not give up copying it.
 */
export function trimStack(err: unknown, maxFrames = 6): string {
  const raw = err instanceof Error && typeof err.stack === "string" ? err.stack : "";
  if (!raw) return "";
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  // Drop the leading "Error: message" line; the message is reported separately.
  const frames = lines.filter((l) => l.startsWith("at ")).slice(0, maxFrames);
  return frames.join("\n");
}

/**
 * Builds everything the banner needs from an arbitrary thrown value.
 *
 * `version` is passed in rather than imported so this stays free of build-time
 * globals and testable without a bundler.
 */
export function describeCrash(err: unknown, source: string, version: string): CrashInfo {
  const detail = messageOf(err).trim() || "No message was provided.";
  const stack = trimStack(err);
  const report = [
    `JurisLab ${version} — ${source}`,
    detail,
    stack,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    headline: "Something in the add-in failed.",
    detail,
    source,
    report,
  };
}

/**
 * The user-facing paragraph. Says what happened, what to check, and what to do —
 * in that order, because the first question anyone asks after a crash in a word
 * processor is whether they lost work.
 *
 * IT DOES NOT PROMISE THE DOCUMENT IS UNTOUCHED. It used to open with "Your
 * document has not been changed by this error", unconditionally — but this
 * banner is raised by a global handler that cannot know where the failure
 * happened, and several insert paths commit in more than one flush (a table
 * writes its content, then its style, then detaches list formatting). A throw
 * between those flushes leaves the document half-modified, and the banner would
 * have told the user it was fine. Telling someone their work is safe when it
 * might not be is worse than saying nothing.
 */
export function crashAdvice(): string {
  return (
    "If you were inserting something when this happened, check the document — part of it may " +
    "have been written. Press Ctrl/⌘+Z until it looks right. Close and reopen the pane to " +
    `recover. If it keeps happening, the details below identify it: ${CRASH_CONTACT}`
  );
}
