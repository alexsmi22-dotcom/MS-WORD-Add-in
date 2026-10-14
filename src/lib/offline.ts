/**
 * Offline delivery — the pane-side model.
 *
 * The service worker (src/sw/sw.js) does the caching; this module decides what
 * the pane may truthfully SAY about it, and drives the update handshake. It is
 * pure and host-free so it can be tested; the DOM glue in taskpane.ts is a few
 * lines that feed it.
 *
 * Honesty is the whole design. "Works offline" used to be a sentence in the
 * install guide resting on the WebView's evictable HTTP cache. Now the pane
 * reports one of four states it can actually verify, and the state it cannot
 * verify (a host with no service workers — Word on Mac may be one) is named
 * as such rather than rounded up to "offline".
 */

export type OfflineLevel = "ready" | "pending" | "partial" | "stale" | "failed" | "unsupported";

/** The Office.js CDN. Must agree with scripts/sw-manifest.js (a test pins it):
 *  the worker caches this origin at runtime, and the pane replays what it
 *  loaded from here through the worker on a first visit (see warmCdnCache in
 *  taskpane.ts). */
export const CDN_ORIGINS = ["https://appsforoffice.microsoft.com"];
export const OFFICE_JS_URL = CDN_ORIGINS[0] + "/lib/1/hosted/office.js";

export interface OfflineProbe {
  /** `navigator.serviceWorker` exists AND register() did not reject. */
  supported: boolean;
  /** A worker currently controls this page. */
  controlled: boolean;
  /** Precache entries the worker expects, and how many it holds. */
  expected: number;
  present: number;
  /** The Office.js library is in the runtime cache. Without it the pane's own
   *  files are useless offline: Office never initialises and nothing renders. */
  cdn: boolean;
  /** The release the controlling worker stores, as it reports it. A window
   *  claimed by a NEWER worker is running a bundle that is no longer stored. */
  workerVersion?: string | null;
  /** The install of this page's own worker ended "redundant" with nothing in
   *  control: the copy could not be saved. */
  installFailed?: boolean;
}

/** Picks out the CDN resources a page has loaded so far, from the browser's
 *  resource-timing log, so they can be replayed through the worker. */
export function cdnResourcesToWarm(entryUrls: string[], alreadyWarmed: Set<string>): string[] {
  const out: string[] = [];
  for (const raw of entryUrls) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (!CDN_ORIGINS.includes(u.origin)) continue;
    if (alreadyWarmed.has(u.href)) continue;
    out.push(u.href);
  }
  return out;
}

export interface OfflineStatus {
  level: OfflineLevel;
  /** One short line for the pane header. */
  text: string;
  /** Hover text with the detail a curious user wants. */
  title: string;
}

/** Turns a probe into the one line the header shows. */
export function describeOfflineStatus(p: OfflineProbe, version: string): OfflineStatus {
  if (!p.supported) {
    return {
      level: "unsupported",
      text: "Offline: depends on this Word's cache",
      title:
        "This Word's browser control does not allow the add-in to keep a verified offline copy of itself. " +
        "Every calculation still runs on your machine; opening the pane may need a connection.",
    };
  }
  if (p.installFailed && !p.controlled) {
    // The install ended "redundant" — a file 404ed, or the deploy was mid-way.
    // Nothing is in control and nothing will change until the next open, so
    // "preparing" would be a lie that never resolves.
    return {
      level: "failed",
      text: "Offline copy could not be saved — will retry next time",
      title:
        "Saving the add-in's files for offline use failed (a file was missing or the connection dropped). " +
        "It is retried the next time the pane opens with a connection. Every calculation still runs on your machine.",
    };
  }
  if (!p.controlled || p.expected <= 0) {
    return {
      level: "pending",
      text: "Preparing offline copy…",
      title: "The add-in is saving its own files for offline use. This finishes in the background.",
    };
  }
  if (p.workerVersion && p.workerVersion !== version) {
    // A newer release's worker has taken this window over (another window
    // reloaded into it). This window's own bundle is no longer what is stored.
    return {
      level: "stale",
      text: `Newer copy stored (v${p.workerVersion}) · reload to use it`,
      title:
        `This window is still running v${version}; the offline copy on this machine is now v${p.workerVersion}. ` +
        "Close and reopen the pane to run the stored version.",
    };
  }
  if (p.present < p.expected) {
    return {
      level: "partial",
      text: `Offline copy incomplete (${p.present} of ${p.expected} files)`,
      title: "Part of the offline copy is missing. It is re-fetched the next time the pane opens with a connection.",
    };
  }
  if (!p.cdn) {
    // Our own files are all there; Microsoft's library is not yet. Still
    // pending, not ready — a pane without Office.js opens to nothing.
    return {
      level: "pending",
      text: "Preparing offline copy… (Office library)",
      title: "The add-in's own files are stored. The Office.js library it runs on is being saved now.",
    };
  }
  return {
    level: "ready",
    text: `Offline-ready · v${version}`,
    title: `All ${p.expected} files this pane needs are stored on this machine. It opens without a connection.`,
  };
}

/** The subset of ServiceWorkerRegistration this module touches — typed so the
 *  tests can hand in a fake without the DOM lib's full interface. */
export interface MinimalRegistration {
  installing: { state: string; addEventListener: (t: string, f: () => void) => void } | null;
  waiting: { postMessage: (m: unknown) => void; state: string } | null;
  active: unknown;
  update(): Promise<unknown>;
}

export interface UpdateHooks {
  /** Resolves on the next `controllerchange`, or rejects on timeout. */
  waitForControllerChange(timeoutMs: number): Promise<void>;
  now?: () => number;
}

/**
 * Brings a NEW worker to control the page before a reload, so the reload is
 * served from the new release's cache rather than the old one.
 *
 * Returns true when a new worker took control; false when there was nothing
 * to swap (no registration, no update found, or the handshake timed out), in
 * which case the caller falls back to a plain navigation — which, under a
 * cache-first worker, may legitimately land back on the current release.
 * The update banner reappears on the next open and the user can try again;
 * that is the honest outcome of an update that could not be downloaded.
 */
export async function activatePendingWorker(
  reg: MinimalRegistration | null | undefined,
  hooks: UpdateHooks,
  timeoutMs = 60_000,
): Promise<boolean> {
  if (!reg) return false;
  try {
    await reg.update();
  } catch {
    /* offline mid-update: the browser keeps the current worker */
  }
  const waiting = await waitForInstalled(reg, timeoutMs);
  if (!waiting) return false;
  const change = hooks.waitForControllerChange(timeoutMs);
  waiting.postMessage({ type: "SKIP_WAITING" });
  try {
    await change;
    return true;
  } catch {
    return false;
  }
}

/** Resolves with the `waiting` worker once installation has finished. */
function waitForInstalled(
  reg: MinimalRegistration,
  timeoutMs: number,
): Promise<MinimalRegistration["waiting"] | null> {
  return new Promise((resolve) => {
    if (reg.waiting) {
      resolve(reg.waiting);
      return;
    }
    const inst = reg.installing;
    if (!inst) {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const check = () => {
      if (inst.state === "installed") {
        clearTimeout(timer);
        resolve(reg.waiting);
      } else if (inst.state === "redundant") {
        clearTimeout(timer);
        resolve(null);
      }
    };
    inst.addEventListener("statechange", check);
    // The state may already have moved on between update() resolving and the
    // listener attaching; a transition that already happened fires no event.
    check();
  });
}
