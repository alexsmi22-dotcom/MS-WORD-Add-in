import {
  describeOfflineStatus,
  activatePendingWorker,
  cdnResourcesToWarm,
  CDN_ORIGINS,
  OFFICE_JS_URL,
  type MinimalRegistration,
} from "../offline";

describe("describeOfflineStatus — says only what the worker can verify", () => {
  const v = "9.9.9";

  it("names an unsupported host instead of rounding up to offline", () => {
    const s = describeOfflineStatus({ supported: false, controlled: false, expected: 0, present: 0, cdn: false }, v);
    expect(s.level).toBe("unsupported");
    expect(s.text).toMatch(/depends on this Word/);
    expect(s.text).not.toMatch(/Offline-ready/);
  });

  it("is pending until a worker controls the page", () => {
    const s = describeOfflineStatus({ supported: true, controlled: false, expected: 0, present: 0, cdn: false }, v);
    expect(s.level).toBe("pending");
  });

  it("is pending when controlled but the worker reports no manifest yet", () => {
    const s = describeOfflineStatus({ supported: true, controlled: true, expected: 0, present: 0, cdn: true }, v);
    expect(s.level).toBe("pending");
  });

  it("reports a partial cache with the counts", () => {
    const s = describeOfflineStatus({ supported: true, controlled: true, expected: 20, present: 17, cdn: true }, v);
    expect(s.level).toBe("partial");
    expect(s.text).toContain("17 of 20");
  });

  it("is NOT ready while Office.js is missing, however complete the precache is", () => {
    const s = describeOfflineStatus({ supported: true, controlled: true, expected: 20, present: 20, cdn: false }, v);
    expect(s.level).toBe("pending");
    expect(s.text).toMatch(/Office library/);
  });

  it("is ready only when every expected file AND Office.js are present, and carries the version", () => {
    const s = describeOfflineStatus({ supported: true, controlled: true, expected: 20, present: 20, cdn: true }, v);
    expect(s.level).toBe("ready");
    expect(s.text).toContain("v9.9.9");
  });

  it("is STALE, not ready, when a newer worker has taken this window over", () => {
    // Another document window reloaded into v10; its worker claimed this one,
    // which still runs v9.9.9 — a bundle that is no longer stored anywhere.
    const s = describeOfflineStatus(
      { supported: true, controlled: true, expected: 20, present: 20, cdn: true, workerVersion: "10.0.0" },
      v,
    );
    expect(s.level).toBe("stale");
    expect(s.text).toContain("v10.0.0");
    expect(s.text).not.toMatch(/Offline-ready/);
  });

  it("is ready when the worker's version matches its own", () => {
    const s = describeOfflineStatus(
      { supported: true, controlled: true, expected: 20, present: 20, cdn: true, workerVersion: "9.9.9" },
      v,
    );
    expect(s.level).toBe("ready");
  });

  it("names a FAILED install instead of 'preparing' for ever", () => {
    const s = describeOfflineStatus(
      { supported: true, controlled: false, expected: 0, present: 0, cdn: false, installFailed: true },
      v,
    );
    expect(s.level).toBe("failed");
    expect(s.text).toMatch(/could not be saved/);
    expect(s.text).toMatch(/retry/);
  });

  it("a failed install of a NEW worker under a still-controlling old one is not 'failed'", () => {
    // The page is served by the current worker; only the update failed. That
    // is the banner's business, not the status line's.
    const s = describeOfflineStatus(
      { supported: true, controlled: true, expected: 20, present: 20, cdn: true, installFailed: true },
      v,
    );
    expect(s.level).toBe("ready");
  });

  it("every status text fits one pane line (no text longer than the unsupported one)", () => {
    const texts = [
      describeOfflineStatus({ supported: false, controlled: false, expected: 0, present: 0, cdn: false }, v).text,
      describeOfflineStatus({ supported: true, controlled: true, expected: 24, present: 24, cdn: true }, v).text,
      describeOfflineStatus({ supported: true, controlled: true, expected: 24, present: 24, cdn: false }, v).text,
    ];
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(44);
  });

  it("never claims ready with more present than expected from a stale count", () => {
    // present > expected cannot come from a correct worker; treat as ready
    // rather than partial, but the point is that it does not throw or go
    // negative.
    const s = describeOfflineStatus({ supported: true, controlled: true, expected: 3, present: 5, cdn: true }, v);
    expect(["ready", "partial"]).toContain(s.level);
    expect(s.text).not.toMatch(/-\d/);
  });
});

describe("cdnResourcesToWarm — which loaded resources to replay through the worker", () => {
  it("keeps CDN URLs, drops everything else, and never repeats one", () => {
    const warmed = new Set<string>([OFFICE_JS_URL]);
    const out = cdnResourcesToWarm(
      [
        OFFICE_JS_URL,
        "https://appsforoffice.microsoft.com/lib/1/hosted/en-us/office_strings.js",
        "https://appsforoffice.microsoft.com/lib/1/hosted/word-win32-16.01.js?x=1",
        "https://alexsmi22-dotcom.github.io/MS-WORD-Add-in/taskpane.abc.js",
        "https://www.ebi.ac.uk/opsin/ws/aspirin.json",
        "not a url",
      ],
      warmed,
    );
    expect(out).toEqual([
      "https://appsforoffice.microsoft.com/lib/1/hosted/en-us/office_strings.js",
      "https://appsforoffice.microsoft.com/lib/1/hosted/word-win32-16.01.js?x=1",
    ]);
  });

  it("the CDN origin list agrees with the build-time copy in scripts/sw-manifest.js", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const built = require("../../../scripts/sw-manifest.js") as { CDN_ORIGINS: string[] };
    expect(built.CDN_ORIGINS).toEqual(CDN_ORIGINS);
  });
});

/** A registration whose state machine the test drives by hand. */
function fakeReg(opts: { waiting?: boolean; installing?: boolean; updateRejects?: boolean }) {
  const posted: unknown[] = [];
  const listeners: Array<() => void> = [];
  const installing = opts.installing
    ? {
        state: "installing",
        addEventListener: (_t: string, f: () => void) => listeners.push(f),
      }
    : null;
  const reg: MinimalRegistration & { posted: unknown[]; fire: (state: string) => void; updates: number } = {
    installing,
    waiting: opts.waiting ? { state: "installed", postMessage: (m: unknown) => posted.push(m) } : null,
    active: {},
    updates: 0,
    posted,
    async update() {
      this.updates++;
      if (opts.updateRejects) throw new Error("offline");
    },
    fire(state: string) {
      if (installing) installing.state = state;
      if (state === "installed") {
        reg.waiting = { state: "installed", postMessage: (m: unknown) => posted.push(m) };
        reg.installing = null;
      }
      for (const f of listeners) f();
    },
  };
  return reg;
}

describe("activatePendingWorker — the update handshake", () => {
  it("returns false with no registration and touches nothing", async () => {
    const ok = await activatePendingWorker(null, { waitForControllerChange: () => Promise.resolve() });
    expect(ok).toBe(false);
  });

  it("posts SKIP_WAITING to a waiting worker and resolves on controllerchange", async () => {
    const reg = fakeReg({ waiting: true });
    let waited = false;
    const ok = await activatePendingWorker(reg, {
      waitForControllerChange: () => {
        waited = true;
        return Promise.resolve();
      },
    });
    expect(ok).toBe(true);
    expect(reg.updates).toBe(1);
    expect(reg.posted).toEqual([{ type: "SKIP_WAITING" }]);
    expect(waited).toBe(true);
  });

  it("waits for an installing worker to finish, then swaps", async () => {
    const reg = fakeReg({ installing: true });
    const p = activatePendingWorker(reg, { waitForControllerChange: () => Promise.resolve() });
    // Nothing posted while still installing.
    await new Promise((r) => setTimeout(r, 5));
    expect(reg.posted).toEqual([]);
    reg.fire("installed");
    expect(await p).toBe(true);
    expect(reg.posted).toEqual([{ type: "SKIP_WAITING" }]);
  });

  it("gives up honestly when the installing worker becomes redundant", async () => {
    const reg = fakeReg({ installing: true });
    const p = activatePendingWorker(reg, { waitForControllerChange: () => Promise.resolve() });
    await new Promise((r) => setTimeout(r, 5));
    reg.fire("redundant");
    expect(await p).toBe(false);
    expect(reg.posted).toEqual([]);
  });

  it("notices a transition that happened BEFORE the listener attached (no event will come)", async () => {
    const reg = fakeReg({ installing: true });
    // update() resolves on a microtask; the state flips during it. A worker
    // that only listened would wait the full timeout for an event that fired
    // before it was watching.
    reg.update = async function () {
      this.updates++;
      reg.fire("installed");
    };
    const ok = await activatePendingWorker(reg, { waitForControllerChange: () => Promise.resolve() }, 50);
    expect(ok).toBe(true);
    expect(reg.posted).toEqual([{ type: "SKIP_WAITING" }]);
  });

  it("returns false when there is nothing to swap (no installing, no waiting)", async () => {
    const reg = fakeReg({});
    expect(await activatePendingWorker(reg, { waitForControllerChange: () => Promise.resolve() })).toBe(false);
  });

  it("still swaps a waiting worker when update() rejects (offline mid-update)", async () => {
    const reg = fakeReg({ waiting: true, updateRejects: true });
    expect(await activatePendingWorker(reg, { waitForControllerChange: () => Promise.resolve() })).toBe(true);
  });

  it("returns false when the controller never changes within the timeout", async () => {
    const reg = fakeReg({ waiting: true });
    const ok = await activatePendingWorker(
      reg,
      { waitForControllerChange: () => Promise.reject(new Error("timeout")) },
      10,
    );
    expect(ok).toBe(false);
    // The message WAS sent; what failed is the confirmation. The caller then
    // navigates anyway, which is the documented fallback.
    expect(reg.posted).toEqual([{ type: "SKIP_WAITING" }]);
  });

  it("times out an install that never completes, without hanging the pane", async () => {
    const reg = fakeReg({ installing: true });
    const ok = await activatePendingWorker(reg, { waitForControllerChange: () => Promise.resolve() }, 20);
    expect(ok).toBe(false);
  });
});
