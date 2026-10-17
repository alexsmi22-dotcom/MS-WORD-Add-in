/**
 * The offline-delivery service worker, exercised OUTSIDE a browser.
 *
 * Two layers. scripts/sw-manifest.js decides which emitted files are precached
 * and renders the worker from its template; src/sw/sw.js is the worker. The
 * second is loaded here into a hand-built runtime (self / caches / fetch /
 * Request / Response) so every routing decision can be asserted with the
 * network recorded: what was fetched, with which cache mode, and what was
 * answered from the cache instead.
 *
 * The real-browser proof is scripts/check-offline.js, which cuts the network
 * and reloads the built pane. This file is the part that can run in CI.
 */
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const manifest = require("../../../scripts/sw-manifest.js") as {
  isPrecacheAsset: (n: string) => boolean;
  buildServiceWorker: (
    t: string,
    a: Array<{ name: string; content: string | Buffer }>,
    v: string,
  ) => { source: string; precache: string[]; cacheName: string };
  CDN_ORIGINS: string[];
};

const TEMPLATE = fs.readFileSync(path.join(__dirname, "..", "..", "sw", "sw.js"), "utf8");

describe("sw-manifest — which files the pane needs offline", () => {
  const yes = [
    "taskpane.html",
    "commands.html",
    "drawdialog.html",
    "solvedialog.html",
    "caddialog.html",
    "taskpane.11dbe936eeda3aa5c0cc.js",
    "791.2a088e7e9a0fa0477df0.js",
    "ppt.90ee716840d17eb50afe.js",
    "908.3fc57131af1c066378bc.js",
    "3c9f82c79cca728ac296.css",
    "assets/icon-32-v2.png",
    "assets/logo.svg",
  ];
  const no = [
    "taskpane.11dbe936eeda3aa5c0cc.js.map",
    "791.2a088e7e9a0fa0477df0.js.LICENSE.txt",
    "version.json",
    "sw.js",
    "manifest.xml",
    "index.html",
    "tool.html",
    "science.html",
    "students.html",
    "legal.html",
    "manual.html",
    "",
  ];
  it.each(yes)("precaches %s", (n) => expect(manifest.isPrecacheAsset(n)).toBe(true));
  it.each(no)("does not precache %s", (n) => expect(manifest.isPrecacheAsset(n)).toBe(false));
  it("a lazy chunk is precached — the PPT export must not be the one tool that breaks offline", () => {
    expect(manifest.isPrecacheAsset("ppt.deadbeef.js")).toBe(true);
  });
  it("the CDN list is exactly Office.js's host", () => {
    expect(manifest.CDN_ORIGINS).toEqual(["https://appsforoffice.microsoft.com"]);
  });
});

const ASSETS = [
  { name: "taskpane.html", content: "<html>pane</html>" },
  { name: "taskpane.abc123.js", content: "console.log(1)" },
  { name: "main.css", content: "body{}" },
  { name: "assets/icon-16.png", content: Buffer.from([1, 2, 3]) },
  { name: "taskpane.abc123.js.map", content: "{}" },
  { name: "index.html", content: "<html>site</html>" },
  { name: "version.json", content: '{"version":"1.0.0"}' },
];

describe("buildServiceWorker — renders the template from the real asset list", () => {
  it("replaces every placeholder and yields valid JavaScript", () => {
    const out = manifest.buildServiceWorker(TEMPLATE, ASSETS, "1.0.0");
    expect(out.source).not.toContain("__PRECACHE__");
    expect(out.source).not.toContain("__CACHE_NAME__");
    expect(out.source).not.toContain("__CDN_ORIGINS__");
    expect(() => new vm.Script(out.source)).not.toThrow();
    expect(out.precache).toEqual(["assets/icon-16.png", "main.css", "taskpane.abc123.js", "taskpane.html"]);
    expect(out.cacheName).toMatch(/^jurislab-v1\.0\.0-[0-9a-f]{12}$/);
  });

  it("the cache name follows the BYTES, not the names: an icon edit alone changes it", () => {
    const a = manifest.buildServiceWorker(TEMPLATE, ASSETS, "1.0.0").cacheName;
    const edited = ASSETS.map((x) => (x.name === "assets/icon-16.png" ? { ...x, content: Buffer.from([9]) } : x));
    const b = manifest.buildServiceWorker(TEMPLATE, edited, "1.0.0").cacheName;
    expect(b).not.toBe(a);
    // …but a source-map edit (not precached) does not.
    const mapOnly = ASSETS.map((x) => (x.name.endsWith(".map") ? { ...x, content: "{changed}" } : x));
    expect(manifest.buildServiceWorker(TEMPLATE, mapOnly, "1.0.0").cacheName).toBe(a);
  });

  it("is deterministic across asset ORDER", () => {
    const a = manifest.buildServiceWorker(TEMPLATE, ASSETS, "1.0.0").source;
    const b = manifest.buildServiceWorker(TEMPLATE, [...ASSETS].reverse(), "1.0.0").source;
    expect(b).toBe(a);
  });

  it("refuses to build a worker for a compilation with no taskpane.html", () => {
    expect(() => manifest.buildServiceWorker(TEMPLATE, ASSETS.filter((a) => a.name !== "taskpane.html"), "1.0.0")).toThrow(
      /taskpane\.html/,
    );
  });

  it("refuses a template missing a placeholder", () => {
    expect(() => manifest.buildServiceWorker(TEMPLATE.replace("__CACHE_NAME__", "x"), ASSETS, "1.0.0")).toThrow(
      /__CACHE_NAME__/,
    );
  });
});

// ---------------------------------------------------------------------------
// A tiny worker runtime.

const ORIGIN = "https://alexsmi22-dotcom.github.io";
const SCOPE = ORIGIN + "/MS-WORD-Add-in/";

class FakeResponse {
  constructor(
    public body: string,
    public status = 200,
    public type: string = "basic",
  ) {}
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  clone() {
    return new FakeResponse(this.body, this.status, this.type);
  }
  async text() {
    return this.body;
  }
}
class FakeRequest {
  url: string;
  method: string;
  cache: string;
  mode: string;
  constructor(url: string | FakeRequest, init: { method?: string; cache?: string; mode?: string } = {}) {
    this.url = typeof url === "string" ? url : url.url;
    this.method = init.method || (typeof url === "string" ? "GET" : url.method) || "GET";
    this.cache = init.cache || "default";
    this.mode = init.mode || "no-cors";
  }
}
class FakeCache {
  store = new Map<string, FakeResponse>();
  async match(key: string | FakeRequest) {
    const k = typeof key === "string" ? key : key.url;
    return this.store.get(k);
  }
  async put(key: string | FakeRequest, res: FakeResponse) {
    const k = typeof key === "string" ? key : key.url;
    this.store.set(k, res);
  }
}
class FakeCaches {
  caches = new Map<string, FakeCache>();
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name)!;
  }
  async keys() {
    return [...this.caches.keys()];
  }
  async delete(name: string) {
    return this.caches.delete(name);
  }
  async match(key: string) {
    for (const c of this.caches.values()) {
      const hit = await c.match(key);
      if (hit) return hit;
    }
    return undefined;
  }
}

interface Runtime {
  self: any;
  caches: FakeCaches;
  fetched: FakeRequest[];
  handlers: Record<string, (e: any) => void>;
  network: (req: FakeRequest) => FakeResponse | Promise<FakeResponse>;
  skipped: number;
  claimed: number;
  /** How many window clients `clients.matchAll` reports. */
  windows: number;
  install: () => Promise<void>;
  activate: () => Promise<void>;
  /** Dispatches a fetch; returns the response the worker gave, or null if it did not intercept. */
  request: (url: string, init?: { method?: string; mode?: string }) => Promise<FakeResponse | null>;
  message: (data: any) => Promise<any>;
}

function boot(assets = ASSETS, version = "1.0.0", caches?: FakeCaches): Runtime {
  const { source } = manifest.buildServiceWorker(TEMPLATE, assets, version);
  const rt: Partial<Runtime> = { fetched: [], handlers: {}, skipped: 0, claimed: 0, windows: 1 };
  rt.caches = caches ?? new FakeCaches();
  // The default network answers with the URL it was asked for, so a body
  // identifies WHICH response a later request was answered with — and for
  // pages, with the asset's own content so the install's verification can
  // read the script references out of it.
  rt.network = (r) => {
    const name = r.url.startsWith(SCOPE) ? r.url.slice(SCOPE.length) : "";
    const asset = assets.find((a) => a.name === name);
    return new FakeResponse(asset && name.endsWith(".html") ? String(asset.content) : "served:" + r.url);
  };
  const self: any = {
    location: { href: SCOPE + "sw.js", origin: ORIGIN },
    addEventListener: (type: string, fn: (e: any) => void) => {
      rt.handlers![type] = fn;
    },
    skipWaiting: () => {
      rt.skipped!++;
    },
    clients: {
      claim: async () => {
        rt.claimed!++;
      },
      matchAll: async () => Array.from({ length: rt.windows! }, () => ({})),
    },
  };
  const ctx = vm.createContext({
    self,
    caches: rt.caches,
    fetch: async (req: FakeRequest | string) => {
      const r = typeof req === "string" ? new FakeRequest(req) : req;
      rt.fetched!.push(r);
      return rt.network!(r);
    },
    Request: FakeRequest,
    Response: FakeResponse,
    URL,
    Promise,
    Error,
    Set,
    Map,
    JSON,
    console,
  });
  new vm.Script(source).runInContext(ctx);
  rt.self = self;
  const waits: Promise<unknown>[] = [];
  const ev = (extra: object = {}) => ({ waitUntil: (p: Promise<unknown>) => waits.push(p), ...extra });
  rt.install = async () => {
    rt.handlers!.install(ev());
    await Promise.all(waits.splice(0));
  };
  rt.activate = async () => {
    rt.handlers!.activate(ev());
    await Promise.all(waits.splice(0));
  };
  rt.request = async (url, init = {}) => {
    let answered: Promise<FakeResponse> | null = null;
    rt.handlers!.fetch(ev({ request: new FakeRequest(url, init), respondWith: (p: Promise<FakeResponse>) => (answered = p) }));
    const res = answered ? await answered : null;
    await Promise.all(waits.splice(0));
    return res;
  };
  rt.message = async (data) => {
    let reply: any;
    const port = { postMessage: (m: any) => (reply = m) };
    rt.handlers!.message(ev({ data, ports: [port] }));
    await Promise.all(waits.splice(0));
    return reply;
  };
  return rt as Runtime;
}

describe("sw.js — install", () => {
  it("fetches every precache entry with the HTTP cache BYPASSED and stores it under the versioned cache", async () => {
    const rt = boot();
    await rt.install();
    const urls = rt.fetched.map((r) => r.url).sort();
    expect(urls).toEqual([
      SCOPE + "assets/icon-16.png",
      SCOPE + "main.css",
      SCOPE + "taskpane.abc123.js",
      SCOPE + "taskpane.html",
    ]);
    expect(rt.fetched.every((r) => r.cache === "reload")).toBe(true);
    const names = await rt.caches.keys();
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^jurislab-v1\.0\.0-/);
    expect((await rt.caches.open(names[0])).store.size).toBe(4);
    // Install never claims or skips on its own.
    expect(rt.skipped).toBe(0);
  });

  it("fails the install if any precache fetch is not ok, and deletes the half cache", async () => {
    const rt = boot();
    rt.network = (r) => new FakeResponse("", r.url.endsWith(".css") ? 404 : 200);
    await expect(rt.install()).rejects.toThrow(/precache failed.*main\.css.*404/);
    // A half cache is worse than none: nothing would serve it, and its
    // presence makes "how much is stored" look like progress.
    expect((await rt.caches.keys()).filter((n) => n.startsWith("jurislab-v"))).toEqual([]);
  });

  it("refuses a precached page that names a script this release does not ship (Pages edge served the OLD html)", async () => {
    // Pages' edge (max-age=600) can still hand out the previous release's
    // taskpane.html under the new worker. Its bundle hash is in no cache.
    const stale = ASSETS.map((a) =>
      a.name === "taskpane.html" ? { ...a, content: '<html><script src="taskpane.OLDHASH.js"></script></html>' } : a,
    );
    const rt = boot(stale);
    await expect(rt.install()).rejects.toThrow(/precache mismatch.*taskpane\.OLDHASH\.js/);
    expect((await rt.caches.keys()).filter((n) => n.startsWith("jurislab-v"))).toEqual([]);
  });

  it("accepts a page whose references are all precached, plus the Office.js CDN", async () => {
    const good = ASSETS.map((a) =>
      a.name === "taskpane.html"
        ? {
            ...a,
            content:
              '<html><script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>' +
              '<link href="main.css"><script src="taskpane.abc123.js"></script></html>',
          }
        : a,
    );
    const rt = boot(good);
    await expect(rt.install()).resolves.toBeUndefined();
  });

  it("never precaches version.json, sw.js, source maps or the website", async () => {
    const rt = boot();
    await rt.install();
    const urls = rt.fetched.map((r) => r.url);
    for (const bad of ["version.json", "sw.js", ".map", "index.html"]) {
      expect(urls.some((u) => u.includes(bad))).toBe(false);
    }
  });
});

describe("sw.js — activate", () => {
  it("deletes older versioned caches, keeps the runtime cache and foreign caches, and claims clients", async () => {
    const rt = boot();
    await rt.caches.open("jurislab-v0.9.0-oldoldoldold");
    await rt.caches.open("jurislab-runtime");
    await rt.caches.open("someone-elses-cache");
    await rt.install();
    await rt.activate();
    const names = (await rt.caches.keys()).sort();
    expect(names.some((n) => n.startsWith("jurislab-v0.9.0"))).toBe(false);
    expect(names).toContain("jurislab-runtime");
    expect(names).toContain("someone-elses-cache");
    expect(names.some((n) => n.startsWith("jurislab-v1.0.0-"))).toBe(true);
    expect(rt.claimed).toBe(1);
  });

  it("KEEPS the old release's cache while another window may still be running it, and sweeps on a later page load", async () => {
    // Word opens one pane per document window. Window B reloads into v2 and
    // asks the v2 worker to take over; window A is mid-session on v1 and its
    // lazy PPT chunk has the v1 hash. Deleting v1's cache strands A.
    const shared = new FakeCaches();
    const v1 = boot(ASSETS, "1.0.0", shared);
    await v1.install();
    const v1Cache = (await shared.keys()).find((n) => n.startsWith("jurislab-v1.0.0"))!;
    const v2 = boot(
      ASSETS.map((a) => (a.name === "taskpane.abc123.js" ? { ...a, content: "console.log(2)" } : a)),
      "2.0.0",
      shared,
    );
    v2.windows = 2;
    await v2.install();
    await v2.activate();
    expect(await shared.keys()).toContain(v1Cache);
    expect(v2.claimed).toBe(1);
    // A still runs and, offline, asks for its OLD chunk: served from v1's cache.
    v2.network = () => {
      throw new Error("offline");
    };
    const old = await v2.request(SCOPE + "taskpane.abc123.js");
    expect(old!.body).toBe("served:" + SCOPE + "taskpane.abc123.js");
    // A closes; the next page load sweeps.
    v2.windows = 1;
    v2.network = (r) => new FakeResponse("served:" + r.url);
    await v2.request(SCOPE + "taskpane.html", { mode: "navigate" });
    expect(await shared.keys()).not.toContain(v1Cache);
    expect((await shared.keys()).some((n) => n.startsWith("jurislab-v2.0.0"))).toBe(true);
  });
});

describe("sw.js — fetch routing", () => {
  it("serves a precached page from the cache with Office's _host_Info query string present, touching no network", async () => {
    const rt = boot();
    await rt.install();
    rt.fetched.length = 0;
    // After install the network changes its answers; a cache hit still carries
    // what was precached, and no fetch is recorded.
    rt.network = () => new FakeResponse("CHANGED");
    const res = await rt.request(SCOPE + "taskpane.html?_host_Info=Word$Win32$16.01$en-US$$$$0");
    expect(res).not.toBeNull();
    expect(res!.body).toBe("<html>pane</html>"); // the page as precached, not "CHANGED"
    expect(rt.fetched).toHaveLength(0);
  });

  it("serves the hashed bundle and the stylesheet from the cache", async () => {
    const rt = boot();
    await rt.install();
    rt.fetched.length = 0;
    rt.network = () => new FakeResponse("CHANGED");
    expect((await rt.request(SCOPE + "taskpane.abc123.js"))!.body).toBe("served:" + SCOPE + "taskpane.abc123.js");
    expect((await rt.request(SCOPE + "main.css"))!.body).toBe("served:" + SCOPE + "main.css");
    expect(rt.fetched).toHaveLength(0);
  });

  it("does NOT intercept version.json — the update trigger must always reach the server", async () => {
    const rt = boot();
    await rt.install();
    expect(await rt.request(SCOPE + "version.json?t=123")).toBeNull();
    expect(await rt.request(SCOPE + "sw.js")).toBeNull();
  });

  it("does not intercept non-GET requests", async () => {
    const rt = boot();
    await rt.install();
    expect(await rt.request(SCOPE + "taskpane.html", { method: "POST" })).toBeNull();
  });

  it("re-fetches and re-stores a precached file that was evicted", async () => {
    const rt = boot();
    await rt.install();
    const [name] = await rt.caches.keys();
    const cache = await rt.caches.open(name);
    cache.store.delete(SCOPE + "main.css");
    rt.fetched.length = 0;
    rt.network = () => new FakeResponse("body{refetched}");
    const res = await rt.request(SCOPE + "main.css");
    expect(res!.body).toBe("body{refetched}");
    expect(rt.fetched.map((r) => r.url)).toEqual([SCOPE + "main.css"]);
    expect((await cache.match(SCOPE + "main.css"))!.body).toBe("body{refetched}");
  });

  it("website pages go network-first and fall back to any cached copy only when the network fails", async () => {
    const rt = boot();
    await rt.install();
    rt.network = () => new FakeResponse("<html>fresh site</html>");
    expect((await rt.request(SCOPE + "index.html"))!.body).toBe("<html>fresh site</html>");
    rt.network = () => {
      throw new Error("offline");
    };
    await expect(rt.request(SCOPE + "index.html")).rejects.toThrow(/offline/);
  });

  it("caches the Office.js CDN at runtime, serves it when offline, and keeps OPAQUE responses", async () => {
    const rt = boot();
    await rt.install();
    const officeUrl = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";
    rt.network = () => new FakeResponse("", 0, "opaque");
    const first = await rt.request(officeUrl);
    expect(first).not.toBeNull();
    expect(first!.type).toBe("opaque");
    // Now offline: the cached opaque copy answers.
    rt.network = () => {
      throw new Error("offline");
    };
    const second = await rt.request(officeUrl);
    expect(second!.type).toBe("opaque");
    const runtime = await rt.caches.open("jurislab-runtime");
    expect(runtime.store.has(officeUrl)).toBe(true);
  });

  it("revalidates a cached CDN file in the background while answering from the cache", async () => {
    const rt = boot();
    await rt.install();
    const url = "https://appsforoffice.microsoft.com/lib/1/hosted/office_strings.js?x=1";
    rt.network = () => new FakeResponse("v1");
    await rt.request(url);
    rt.network = () => new FakeResponse("v2");
    const served = await rt.request(url);
    expect(served!.body).toBe("v1"); // stale answer…
    const runtime = await rt.caches.open("jurislab-runtime");
    // …and the refresh landed, keyed WITHOUT the query string.
    expect((await runtime.match("https://appsforoffice.microsoft.com/lib/1/hosted/office_strings.js"))!.body).toBe("v2");
  });

  it("does not intercept any other cross-origin request (the opt-in OPSIN lookup stays untouched)", async () => {
    const rt = boot();
    await rt.install();
    expect(await rt.request("https://www.ebi.ac.uk/opsin/ws/aspirin.json")).toBeNull();
    expect(rt.fetched.filter((r) => r.url.includes("ebi"))).toHaveLength(0);
  });

  it("never serves a cross-origin file from the PRECACHE even if a name collides", async () => {
    const rt = boot();
    await rt.install();
    rt.fetched.length = 0;
    expect(await rt.request("https://evil.example/MS-WORD-Add-in/taskpane.html")).toBeNull();
  });
});

describe("sw.js — messages", () => {
  it("SKIP_WAITING calls skipWaiting, and nothing else does", async () => {
    const rt = boot();
    await rt.install();
    await rt.message({ type: "STATUS" });
    expect(rt.skipped).toBe(0);
    await rt.message({ type: "SKIP_WAITING" });
    expect(rt.skipped).toBe(1);
  });

  it("STATUS reports the real count held, not the count expected, and the worker's own version", async () => {
    const rt = boot();
    await rt.install();
    expect(await rt.message({ type: "STATUS" })).toMatchObject({ expected: 4, present: 4, version: "1.0.0" });
    const [name] = (await rt.caches.keys()).filter((n) => n.startsWith("jurislab-v"));
    (await rt.caches.open(name)).store.delete(SCOPE + "main.css");
    expect(await rt.message({ type: "STATUS" })).toMatchObject({ expected: 4, present: 3 });
  });

  it("STATUS reports Office.js as absent until it has passed through the runtime cache", async () => {
    const rt = boot();
    await rt.install();
    expect(await rt.message({ type: "STATUS" })).toMatchObject({ cdn: false });
    rt.network = () => new FakeResponse("", 0, "opaque");
    await rt.request("https://appsforoffice.microsoft.com/lib/1/hosted/office.js");
    expect(await rt.message({ type: "STATUS" })).toMatchObject({ cdn: true });
  });

  it("STATUS with no reply port is ignored rather than thrown", async () => {
    const rt = boot();
    await rt.install();
    await expect(
      (async () => {
        rt.handlers.message({ data: { type: "STATUS" }, ports: [], waitUntil: () => undefined });
      })(),
    ).resolves.toBeUndefined();
  });
});
