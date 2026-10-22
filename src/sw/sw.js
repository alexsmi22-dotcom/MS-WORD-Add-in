/* eslint-disable no-undef */
// JurisLab service worker — the offline DELIVERY layer.
//
// WHY THIS EXISTS. Every calculation in the pane already runs on the user's
// machine, but Word fetches the pane itself from GitHub Pages every time it
// opens, and nothing guaranteed that fetch would succeed without a connection:
// the WebView's ordinary HTTP cache is evictable, and the bundle filename changes
// on every release, so the first open after a deploy needed the network. This
// worker precaches the pane's own files at install time and answers for them
// cache-first, so an installed pane opens without a network at all.
//
// This file is a TEMPLATE. webpack (scripts/sw-manifest.js) replaces the three
// placeholders below with the real emitted asset list, a cache name derived
// from the assets' content, and the CDN origins to cache at runtime. The
// placeholders are plain identifiers on purpose: the file stays valid JS, so
// the unit tests can load it with a stub manifest.
//
// Three rules, each the answer to a specific failure:
//   1. Match IGNORES THE QUERY STRING. Office appends `?_host_Info=Word$Win32…`
//      to the task pane URL, so an exact-URL lookup misses the cached
//      taskpane.html every time and the pane is "offline-capable" in theory only.
//   2. version.json and sw.js are NEVER served from this cache. version.json is
//      the update trigger; a cached copy would announce no update forever.
//   3. Cross-origin is cached ONLY for the Office.js CDN, which the pane cannot
//      run without. Everything else cross-origin (the opt-in OPSIN lookup) is
//      passed through untouched — caching a consented lookup would quietly
//      answer a later request without the consent dialog's fetch ever happening.

const PRECACHE = __PRECACHE__;
const CACHE_NAME = __CACHE_NAME__;
const CDN_ORIGINS = __CDN_ORIGINS__;
const VERSION = __VERSION__;
/** On-demand engines (engines/<name>-<version>/…): fetched the first time a tool needs one, then kept — across
 *  releases — in their own cache, so the 7.6 MB STEP reader is downloaded once, not with every update. */
const ENGINE_FILES = __ENGINE_FILES__;

/** The one runtime cache for CDN responses. Not versioned: Office.js changes on
 *  Microsoft's schedule, not ours, and a pane cannot boot without it. */
const RUNTIME_CACHE = "jurislab-runtime";
const CACHE_PREFIX = "jurislab-v";
/** Not under CACHE_PREFIX: the release sweep never empties it; engines no release names are swept one by one. */
const ENGINE_CACHE = "jurislab-engines";
/** The one CDN file whose presence decides "ready": nothing renders without it. */
const OFFICE_JS = CDN_ORIGINS[0] + "/lib/1/hosted/office.js";

/** Pathname → precache membership, so the query string never takes part. */
function stripSearch(url) {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  return u.href;
}

const scopeBase = new URL("./", self.location.href).href;
const PRECACHE_URLS = PRECACHE.map((p) => new URL(p, scopeBase).href);
const PRECACHE_SET = new Set(PRECACHE_URLS);
const ENGINE_URLS = ENGINE_FILES.map((p) => new URL(p, scopeBase).href);
const ENGINE_SET = new Set(ENGINE_URLS);

/** Files that must always come from the network while it is there. */
function isNeverCached(href) {
  const name = href.slice(scopeBase.length);
  return name === "version.json" || name === "sw.js";
}

/**
 * The precached pages must name only precached scripts and stylesheets.
 *
 * `cache: "reload"` bypasses the browser's HTTP cache, but not GitHub Pages'
 * edge (max-age=600): for ten minutes after a deploy the edge can still hand
 * out the PREVIOUS release's taskpane.html under this release's worker. That
 * page names a bundle hash that is in no cache — a 404 online once the old
 * file is gone, a throw offline — and a cache-first worker would keep serving
 * it for the life of the release. Refuse the install instead; the browser
 * retries on the next open, by which time the edge has caught up.
 */
async function verifyPagesReferToPrecache(cache) {
  const names = new Set(PRECACHE);
  for (const p of PRECACHE) {
    if (!p.endsWith(".html")) continue;
    const res = await cache.match(new URL(p, scopeBase).href);
    if (!res) throw new Error("precache verification: " + p + " missing");
    const html = await res.clone().text();
    const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
    for (const r of refs) {
      if (/^https?:/.test(r)) continue; // the Office.js CDN
      if (!names.has(r)) {
        throw new Error("precache mismatch: " + p + " refers to " + r + ", which this release does not ship");
      }
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        await Promise.all(
          PRECACHE_URLS.map(async (href) => {
            const res = await fetch(new Request(href, { cache: "reload" }));
            if (!res.ok) throw new Error("precache failed: " + href + " (" + res.status + ")");
            await cache.put(href, res);
          }),
        );
        await verifyPagesReferToPrecache(cache);
      } catch (e) {
        // A half cache is worse than none: nothing would ever serve it, and
        // its presence makes "how much is stored" look like progress.
        await caches.delete(CACHE_NAME);
        throw e;
      }
      // No skipWaiting() here. A new worker activating under a pane that is
      // mid-session would swap its cache out from under it; the pane asks for
      // the swap itself (SKIP_WAITING) once it has decided to reload.
    })(),
  );
});

/**
 * Deletes the previous releases' caches — but only when no OTHER window may
 * still be running one of them.
 *
 * Word opens one task pane per document window. When window B reloads into a
 * new release it asks this worker to take over (SKIP_WAITING), and the
 * takeover also claims window A, still mid-session on the old bundle. A's
 * lazily-loaded chunk (the PPT export) has the OLD hash, which is in no new
 * cache; it must keep coming from the old one. So while more than one window
 * is open the old caches stay, and the sweep runs again on the next page
 * load, when A has gone.
 */
async function sweepOldCaches() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (windows.length > 1) return false;
  const names = await caches.keys();
  await Promise.all(
    names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME).map((n) => caches.delete(n)),
  );
  // An engine this release no longer ships (a newer version replaced it) goes; the current one stays.
  if (names.includes(ENGINE_CACHE)) {
    const engines = await caches.open(ENGINE_CACHE);
    for (const req of await engines.keys()) if (!ENGINE_SET.has(stripSearch(req.url))) await engines.delete(req);
  }
  return true;
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await sweepOldCaches();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "STATUS") {
    const port = event.ports && event.ports[0];
    if (!port) return;
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        let present = 0;
        for (const href of PRECACHE_URLS) {
          if (await cache.match(href)) present++;
        }
        const runtime = await caches.open(RUNTIME_CACHE);
        const cdn = !!(await runtime.match(OFFICE_JS));
        // `version` lets a page compare the worker's release with its own: a
        // window claimed by a NEWER worker is running a bundle that is no
        // longer stored, and must not call itself offline-ready.
        port.postMessage({ cacheName: CACHE_NAME, version: VERSION, expected: PRECACHE_URLS.length, present, cdn });
      })(),
    );
  }
});

/** Cache-first for the pane's own files; the network is the fallback, and a
 *  network miss is recached so a cache evicted mid-life heals itself. */
async function precached(request, key) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(key, res.clone());
  return res;
}

/** Cache-first for an on-demand engine: the network once, then the engine cache for good. */
async function engine(request, key) {
  const cache = await caches.open(ENGINE_CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(request);
  // A store that fails (quota) must not fail the answer the network already gave.
  if (res.ok && res.status === 200) await cache.put(key, res.clone()).catch(() => undefined);
  return res;
}

/** Stale-while-revalidate for the Office.js CDN: answer from the runtime cache
 *  at once when possible and refresh in the background; otherwise fetch and
 *  keep the (opaque) response for next time. */
async function cdn(request, event) {
  const cache = await caches.open(RUNTIME_CACHE);
  const key = stripSearch(request.url);
  const hit = await cache.match(key);
  const refresh = fetch(request)
    .then(async (res) => {
      // Opaque responses have status 0; they are still the script Office
      // asked for and are what the browser executes, so keep them.
      if (res && (res.ok || res.type === "opaque")) await cache.put(key, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (hit) {
    // The response goes out now; the refresh must outlive it, or the worker
    // may be stopped before the fresh copy lands.
    event.waitUntil(refresh);
    return hit;
  }
  const res = await refresh;
  if (!res) throw new Error("offline and not cached: " + key);
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  const key = stripSearch(req.url);

  if (url.origin === self.location.origin) {
    if (isNeverCached(key)) return; // network only, by design
    if (req.mode === "navigate") event.waitUntil(sweepOldCaches());
    if (PRECACHE_SET.has(key)) {
      event.respondWith(precached(req, key));
      return;
    }
    if (ENGINE_SET.has(key)) {
      event.respondWith(engine(req, key));
      return;
    }
    // Same-origin but not in THIS release's precache: the website pages, or a
    // previous release's chunk requested by a window still running it.
    // Network first, then any cache that holds it — never the other way round.
    event.respondWith(
      fetch(req).catch(async () => {
        const hit = await caches.match(key);
        if (hit) return hit;
        throw new Error("offline: " + key);
      }),
    );
    return;
  }

  if (CDN_ORIGINS.includes(url.origin)) {
    event.respondWith(cdn(req, event));
  }
  // Any other origin: not ours to intercept.
});

// Exposed for the unit tests only; a real worker never reads these.
self.__jurislabSw = { stripSearch, isNeverCached, PRECACHE_URLS, CACHE_NAME, RUNTIME_CACHE, ENGINE_URLS, ENGINE_CACHE };
