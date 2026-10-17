/* eslint-disable no-undef */
// Builds the service worker from its template and the REAL emitted asset list.
//
// Plain CommonJS so webpack.config.js can require it at build time and the jest
// suite can require it without a build. Nothing here is typed by hand: the
// precache list is whatever the compilation emitted, filtered by the rules
// below, and the cache name is a digest of those assets' bytes, so any change
// to any shipped file yields a byte-different sw.js — which is exactly what
// makes the browser install the new worker.

const crypto = require("crypto");

/** The Office.js CDN. The pane cannot boot without it, so the worker keeps a
 *  runtime copy of whatever Office loads from here. */
const CDN_ORIGINS = ["https://appsforoffice.microsoft.com"];

/**
 * Which emitted files the pane needs to open offline.
 *
 * In: the four add-in pages, every JS chunk (hashed or not — lazy chunks
 * included, or the PPT export would be the one tool that breaks offline), the
 * extracted CSS, and the icons.
 * Out: source maps (debug only, 20 MB), licence stubs, the website pages
 * (index/tool/science/students/legal/manual — those are the SITE, not the
 * add-in), the installable manifest, and the two files that must never be
 * served from cache: version.json (the update trigger) and sw.js itself.
 */
const SITE_PAGES = new Set(["index.html", "tool.html", "science.html", "students.html", "legal.html", "manual.html"]);
const ADDIN_PAGES = new Set(["taskpane.html", "commands.html", "drawdialog.html", "solvedialog.html", "caddialog.html"]);

function isPrecacheAsset(name) {
  if (typeof name !== "string" || !name) return false;
  if (name.endsWith(".map")) return false;
  if (name.endsWith(".LICENSE.txt")) return false;
  if (name === "version.json" || name === "sw.js" || name === "manifest.xml") return false;
  if (name.endsWith(".html")) return ADDIN_PAGES.has(name) && !SITE_PAGES.has(name);
  if (name.endsWith(".js") || name.endsWith(".css")) return true;
  if (name.startsWith("assets/")) return true;
  return false;
}

/**
 * Renders the worker.
 * @param template  the sw.js template source
 * @param assets    [{ name, content: Buffer|string }] — every emitted asset
 * @param version   package.json version
 */
function buildServiceWorker(template, assets, version) {
  const chosen = assets.filter((a) => isPrecacheAsset(a.name)).sort((a, b) => (a.name < b.name ? -1 : 1));
  if (!chosen.some((a) => a.name === "taskpane.html")) {
    throw new Error("sw-manifest: taskpane.html is not among the emitted assets — the worker would precache a pane that does not exist");
  }
  const h = crypto.createHash("sha256");
  h.update(String(version));
  for (const a of chosen) {
    h.update("\0" + a.name + "\0");
    h.update(Buffer.isBuffer(a.content) ? a.content : Buffer.from(String(a.content)));
  }
  const cacheName = "jurislab-v" + version + "-" + h.digest("hex").slice(0, 12);
  const names = chosen.map((a) => a.name);
  for (const ph of ["__PRECACHE__", "__CACHE_NAME__", "__CDN_ORIGINS__", "__VERSION__"]) {
    if (!template.includes(ph)) throw new Error("sw-manifest: template is missing " + ph);
  }
  const out = template
    .replace("__PRECACHE__", JSON.stringify(names))
    .replace("__CACHE_NAME__", JSON.stringify(cacheName))
    .replace("__CDN_ORIGINS__", JSON.stringify(CDN_ORIGINS))
    .replace("__VERSION__", JSON.stringify(String(version)));
  return { source: out, precache: names, cacheName };
}

module.exports = { isPrecacheAsset, buildServiceWorker, CDN_ORIGINS, ADDIN_PAGES, SITE_PAGES };
