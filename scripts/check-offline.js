/* eslint-disable no-undef */
// Offline-delivery gate — does the built pane open with NO network?
//
// "Works offline" was a sentence in the install guide resting on the WebView's
// evictable HTTP cache. The service worker (src/sw/sw.js) makes it true; this
// gate makes it ENFORCED, in the project's idiom: the real production bundle,
// a real Chromium (the engine behind Word's WebView2), and an assertion on what
// actually happened in the page. An unenforced promise drifts, and this one is
// now the value proposition.
//
// Three phases, driven over the DevTools protocol (the WebSocket Node ships —
// no puppeteer), on one browser profile:
//   A. ONLINE. A local static server serves dist/ with GitHub Pages' own
//      Cache-Control (max-age=600). The real taskpane.html is loaded, with the
//      `_host_Info` query string Office appends, and watched until the worker
//      controls the page and the gate has verified — by reading dist/sw.js's
//      own manifest, not by asking the worker — that every precached file is
//      present, and that Office.js and the host files it pulled in have passed
//      through into the runtime cache. This phase needs the internet.
//   B. OFFLINE. The server is stopped and the browser relaunched on the same
//      profile with every hostname resolving to nothing. Each add-in page is
//      loaded. The bundle marks <html> with `data-jurislab-version` at module
//      scope, and the pane marks whether Office.js was delivered; both must be
//      present with the network cut, the pane's own status line must settle
//      on Offline-ready, and no crash banner may appear.
//   C. NEGATIVE CONTROL. The same offline launch on a FRESH profile must fail
//      — otherwise the predicate was never capable of failing and phase B
//      proved nothing. (House rule: a harness reports itself first.)
//
// Office.onReady never fires outside Word — there is no host to call it — so
// the pane renders nothing here on purpose. What this gate proves is DELIVERY:
// every byte the pane needs arrives with the network gone. Rendering is the
// render check's job, on the same bundle.
//
//   node scripts/check-offline.js        (expects `npm run build` to have run)
//
// Exit 0 pass · 1 fail · 2 skipped (no browser, or no internet for phase A).

const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { makeProfile } = require("./headless-profile.js");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const pkg = require(path.join(ROOT, "package.json"));
const HOST_INFO = "?_host_Info=Word$Win32$16.01$en-US$$$$0";
const CDN = "https://appsforoffice.microsoft.com/lib/1/hosted/";

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".map": "application/json",
  ".txt": "text/plain",
};

/** Serves dist/ the way GitHub Pages does: max-age=600, no surprises. */
function serveDist() {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "") || "index.html";
    const file = path.join(DIST, rel);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "max-age=600",
      "Access-Control-Allow-Origin": "*",
    });
    fs.createReadStream(file).pipe(res);
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        port,
        stop: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy();
            server.close(() => r());
          }),
      });
    });
  });
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal DevTools-protocol client over the WebSocket Node ships. */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    /** Exceptions and log entries the page produced — the evidence when it fails. */
    this.events = [];
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
        return;
      }
      if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        this.events.push(
          "exception: " +
            (d.exception?.description || d.text) +
            (d.url ? ` @ ${d.url}:${d.lineNumber}:${d.columnNumber}` : ""),
        );
      } else if (m.method === "Log.entryAdded") {
        const e = m.params.entry;
        if (e.level === "error" || e.level === "warning") {
          this.events.push(`${e.source} ${e.level}: ${e.text}` + (e.url ? ` (${e.url})` : ""));
        }
      } else if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
        this.events.push("console." + m.params.type + ": " + m.params.args.map((a) => a.value ?? a.description).join(" "));
      }
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener("open", () => resolve(new Cdp(ws)));
      ws.addEventListener("error", () => reject(new Error("CDP connect failed: " + url)));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  /** Evaluates an async expression and returns its JSON-serialised value. */
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error("page threw: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

/** Launches a headless browser on `profile` and attaches to its first page.
 *  `noHttpCache` disables the renderer's HTTP cache, so an offline phase can
 *  only be answered by the worker — phase A fills the HTTP cache too, and
 *  without this a pass would not prove which of the two served the page. */
async function launch(browser, profile, extraArgs, noHttpCache = false) {
  const dbgPort = await freePort();
  const proc = spawn(
    browser,
    ["--headless=new", "--disable-gpu", "--no-sandbox", profile.arg, "--remote-debugging-port=" + dbgPort, ...extraArgs, "about:blank"],
    { stdio: "ignore" },
  );
  const exited = new Promise((r) => proc.on("exit", r));
  let targets = null;
  for (let i = 0; i < 100 && !targets; i++) {
    await sleep(100);
    try {
      targets = await (await fetch(`http://127.0.0.1:${dbgPort}/json`)).json();
    } catch {
      /* not up yet */
    }
  }
  if (!targets) {
    proc.kill("SIGKILL");
    throw new Error("the browser never opened its DevTools port");
  }
  const page = targets.find((t) => t.type === "page");
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  if (noHttpCache) {
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  }
  return {
    cdp,
    async close() {
      try {
        await cdp.send("Browser.close");
      } catch {
        /* closing anyway */
      }
      cdp.close();
      const t = setTimeout(() => proc.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(t);
    },
  };
}

/** Navigates and re-evaluates `expr` until `done(value)` or the deadline. Returns the last value. */
async function observe(cdp, url, expr, done, timeoutMs) {
  await cdp.send("Page.navigate", { url });
  let last = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(400);
    try {
      last = await cdp.eval(expr);
    } catch (e) {
      last = { error: e.message };
      continue;
    }
    if (done(last)) break;
  }
  return last;
}

/** What the page can report about itself — the same expression in every phase. */
function pageExpr(precache) {
  return `(async () => {
    const out = {
      readyState: document.readyState,
      version: document.documentElement.dataset.jurislabVersion || null,
      officeLoaded: document.documentElement.dataset.officeLoaded || null,
      officeHost: document.documentElement.dataset.officeHost || null,
      crash: (() => { const b = document.getElementById("crash-banner"); return b ? b.textContent.replace(/\\s+/g, " ").trim().slice(0, 300) : null; })(),
      statusLevel: (() => { const s = document.getElementById("offline-status"); return s ? s.dataset.level : null; })(),
      statusText: (() => { const s = document.getElementById("offline-status"); return s ? s.textContent : null; })(),
      title: document.title,
      supported: "serviceWorker" in navigator,
      controlled: false, registered: false, hasCache: false, present: 0, office: false, runtimeKeys: [], loaded: [],
    };
    if (!out.supported) return out;
    out.controlled = !!navigator.serviceWorker.controller;
    out.registered = !!(await navigator.serviceWorker.getRegistration().catch(() => null));
    const names = await caches.keys();
    const want = ${JSON.stringify(precache.cacheName)};
    out.hasCache = names.includes(want);
    if (out.hasCache) {
      const c = await caches.open(want);
      for (const p of ${JSON.stringify(precache.list)}) {
        if (await c.match(new URL(p, location.href).href)) out.present++;
      }
    }
    if (names.includes("jurislab-runtime")) {
      const r = await caches.open("jurislab-runtime");
      out.office = !!(await r.match(${JSON.stringify(CDN + "office.js")}));
      out.runtimeKeys = (await r.keys()).map((k) => k.url.replace(${JSON.stringify(CDN)}, ""));
      // An opaque entry cannot answer a CORS load, and Office.js loads its
      // strings and host script with CORS; such a cache fails offline.
      out.opaque = [];
      for (const k of await r.keys()) {
        const res = await r.match(k);
        if (res && res.type === "opaque") out.opaque.push(k.url.replace(${JSON.stringify(CDN)}, ""));
      }
    }
    out.loaded = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes("appsforoffice")).map((n) => n.replace(${JSON.stringify(CDN)}, ""));
    return out;
  })()`;
}

/** The precache manifest, read from the EMITTED worker — the gate's own copy of
 *  the list, independent of what the worker reports about itself. The emitted
 *  file is minified, so whitespace is optional. */
function readPrecache() {
  const sw = fs.readFileSync(path.join(DIST, "sw.js"), "utf8");
  // A JSON array of strings, matched as such — `[^\]]*` would stop at a `]`
  // inside a filename.
  const m = /PRECACHE\s*=\s*(\[(?:\s*"(?:[^"\\]|\\.)*"\s*,?)*\s*\])/.exec(sw);
  if (!m) throw new Error("dist/sw.js carries no PRECACHE list — the build did not render the worker");
  const list = JSON.parse(m[1]);
  if (!list.includes("taskpane.html")) throw new Error("dist/sw.js precache does not include taskpane.html");
  const c = /CACHE_NAME\s*=\s*("[^"]+")/.exec(sw);
  if (!c) throw new Error("dist/sw.js carries no CACHE_NAME");
  return { list, cacheName: JSON.parse(c[1]) };
}

const OFFLINE_ARGS = ["--host-resolver-rules=MAP * ~NOTFOUND"];

async function run() {
  const browser = findBrowser();
  if (!browser) {
    console.log("SKIP: no Chromium-family browser found (set CHROME_PATH to run this check).");
    return 2;
  }
  if (!fs.existsSync(path.join(DIST, "taskpane.html"))) {
    console.error("FAIL: dist/taskpane.html not found — run `npm run build` first.");
    return 1;
  }
  const precache = readPrecache();
  const expr = pageExpr(precache);
  console.log(`precache manifest: ${precache.list.length} files, cache ${precache.cacheName}`);
  const failures = [];
  const dumpOn = (label, v) => failures.push(`${label}\n      observed: ${JSON.stringify(v)}`);

  // ---- Phase A: online -----------------------------------------------------
  const profile = makeProfile("offline");
  const server = await serveDist();
  const base = `http://127.0.0.1:${server.port}/`;
  let online;
  {
    const b = await launch(browser, profile, []);
    try {
      online = await observe(
        b.cdp,
        base + "taskpane.html" + HOST_INFO,
        expr,
        (v) =>
          v.supported === false ||
          (v.controlled && v.hasCache && v.present === precache.list.length && v.office && v.statusLevel === "ready"),
        90_000,
      );
    } finally {
      await b.close();
      await server.stop();
    }
  }
  if (!online || online.error) {
    console.error("FAIL: phase A (online) could not be observed: " + (online && online.error));
    return 1;
  }
  if (online.supported === false) {
    console.error("FAIL: this browser exposes no navigator.serviceWorker — the gate cannot run here.");
    return 1;
  }
  if (!online.office) {
    // Phase A needs the real CDN. Without it the rest cannot be asserted, and
    // a PASS here would be the false green this script exists to prevent.
    console.log("SKIP: Office.js could not be fetched from the CDN during the online phase (no internet?).");
    console.log("      observed: " + JSON.stringify(online));
    return 2;
  }
  if (!online.registered) failures.push("online: the pane did not register the service worker");
  if (!online.controlled) failures.push("online: the worker never took control of the page");
  if (!online.hasCache) failures.push(`online: the versioned cache ${precache.cacheName} was not created`);
  if (online.present !== precache.list.length) failures.push(`online: precache incomplete, ${online.present} of ${precache.list.length}`);
  if (online.version !== pkg.version) failures.push(`online: bundle version marker is ${online.version}, expected ${pkg.version}`);
  if (online.statusLevel !== "ready") failures.push(`online: the pane's status line reads "${online.statusText}" (${online.statusLevel}), not Offline-ready`);
  // Every CDN file the page loaded must have been replayed into the runtime cache.
  const missing = online.loaded.map((n) => n.split("?")[0]).filter((n) => !online.runtimeKeys.includes(n));
  if (missing.length) failures.push("online: CDN files loaded but not cached: " + missing.join(", "));
  if (online.opaque && online.opaque.length) {
    failures.push("online: CDN cache holds OPAQUE responses, which cannot answer Office.js's CORS loads: " + online.opaque.join(", "));
  }
  if (failures.length) {
    console.error("OFFLINE CHECK FAILED (online phase):");
    for (const f of failures) console.error("  - " + f);
    console.error("  observed: " + JSON.stringify(online));
    return 1;
  }
  console.log(`online: worker controls the page; ${online.present}/${precache.list.length} precached; status "${online.statusText}"`);
  console.log(`  CDN files loaded → cached: ${online.runtimeKeys.join(", ")}`);
  if (online.crash) console.log(`  note: crash banner online in a plain browser (no host): "${online.crash.slice(0, 120)}"`);

  // ---- Phase B: offline, same profile, server gone, DNS dead ---------------
  {
    const b = await launch(browser, profile, OFFLINE_ARGS, true);
    try {
      const pane = await observe(
        b.cdp,
        base + "taskpane.html" + HOST_INFO,
        expr,
        (v) => v.readyState === "complete" && v.statusLevel && v.statusLevel !== "pending",
        30_000,
      );
      const p = [];
      if (pane.version !== pkg.version) p.push("bundle did not execute (no version marker)");
      if (pane.officeLoaded !== "true") p.push("Office.js was not delivered (officeLoaded=" + pane.officeLoaded + ")");
      if (!pane.controlled) p.push("no worker controls the page");
      if (pane.statusLevel !== "ready") p.push(`status line reads "${pane.statusText}" (${pane.statusLevel})`);
      // A crash banner offline that was NOT there online is an offline defect.
      if (pane.crash && !online.crash) p.push("crash banner appeared offline only: " + pane.crash.slice(0, 200));
      if (p.length) {
        dumpOn("offline taskpane.html: " + p.join("; "), pane);
        if (b.cdp.events.length) failures.push("      page events:\n        " + b.cdp.events.slice(0, 20).join("\n        "));
      }
      else console.log(`offline: taskpane.html served from cache; Office.js delivered; status "${pane.statusText}"`);

      for (const page of ["drawdialog.html", "solvedialog.html?kind=equation", "caddialog.html"]) {
        const v = await observe(b.cdp, base + page, expr, (x) => x.readyState === "complete" && x.version, 20_000);
        if (!v || v.version !== pkg.version) dumpOn(`offline ${page}: bundle did not execute`, v);
        else console.log(`offline: ${page.split("?")[0]} served from cache and executed`);
      }
    } finally {
      await b.close();
    }
  }

  // ---- Phase C: negative control — fresh profile must FAIL offline ---------
  {
    const fresh = makeProfile("offline-ctl");
    const b = await launch(browser, fresh, OFFLINE_ARGS, true);
    try {
      const v = await observe(b.cdp, base + "taskpane.html" + HOST_INFO, expr, (x) => x.readyState === "complete", 15_000);
      if (v && v.version === pkg.version) {
        dumpOn("NEGATIVE CONTROL: a fresh profile with no worker ALSO loaded the pane offline — the predicate cannot fail", v);
      } else {
        console.log("negative control: a fresh profile fails offline, as it must");
      }
    } finally {
      await b.close();
      fresh.cleanup();
    }
  }
  profile.cleanup();

  if (failures.length) {
    console.error("OFFLINE CHECK FAILED:");
    for (const f of failures) console.error("  - " + f);
    return 1;
  }
  console.log(`PASS: the pane and both dialogs open with the network cut; Office.js and all ${precache.list.length} files served from cache.`);
  return 0;
}

run().then(
  (code) => process.exit(code),
  (e) => {
    console.error("OFFLINE CHECK ERROR: " + (e && e.stack ? e.stack : e));
    process.exit(1);
  },
);
