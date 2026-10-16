// The offline claim, made enforceable.
//
// SECURITY.md used to assert "no external API calls" and that office.js was the
// only network request, and attributed that to a source scan in CI. There was no
// such scan, and the assertion was false: the pane also fetches version.json and
// the Chemical tool can call EMBL-EBI's OPSIN service.
//
// A promise about what a program does NOT do is worth nothing unless something
// checks it. This scans the shipped source for every network primitive and fails
// on any call site — or any destination — not on the list below. Adding a new
// one is then a deliberate act that updates this file and SECURITY.md together.

import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..", "..", "..");
const SRC = path.join(ROOT, "src");

/** Every way a browser can start a network request. */
const PRIMITIVES = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bnew\s+WebSocket\b/,
  /\bnavigator\.sendBeacon\b/,
  /\bnew\s+EventSource\b/,
  /\bimport\s*\(\s*["'`]https?:/,
];

/**
 * The complete allowlist. `file` is where the call lives, `why` is the reason it
 * is acceptable. Anything else is a failure.
 */
const ALLOWED: { file: string; why: string }[] = [
  {
    file: "lib/opsin.ts",
    why: "The one opt-in exception: sends a single user-typed chemical name to EMBL-EBI OPSIN, behind a per-name consent prompt.",
  },
  {
    file: "taskpane/taskpane.ts",
    why:
      "Same-origin GET of version.json to drive the update banner, and (v2.127.0) a replay of the Office.js CDN " +
      "scripts the page has ALREADY loaded, so they pass through the service worker into its offline cache. " +
      "Carries no document content; never a new host.",
  },
  {
    file: "sw/sw.js",
    why:
      "The offline-delivery service worker: precaches the add-in's own files at install (same origin) and keeps a " +
      "runtime copy of what Office.js loads from appsforoffice.microsoft.com. Any other origin — the OPSIN lookup " +
      "included — is passed through untouched; serviceWorker.test.ts pins that.",
  },
];

/** Source files, excluding tests. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      sourceFiles(full, out);
    } else if (/\.(ts|tsx|js|html)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(SRC);

/**
 * Is the URL at `index` in `text` on a COMMENT line (a citation) rather than a
 * code line (an address)? The one predicate the host scan below uses, factored
 * out so it can be tested on known-good and known-bad lines (v2.143.0).
 */
function urlIsOnCommentLine(text: string, index: number): boolean {
  const lines = text.split(String.fromCharCode(10));
  const line = lines[text.slice(0, index).split(String.fromCharCode(10)).length - 1] ?? "";
  return /^\s*(\/\/|\*|\/\*)/.test(line);
}
const rel = (f: string): string => path.relative(SRC, f).replace(/\\/g, "/");

describe("network surface — the offline claim is enforceable", () => {
  test("the scan actually looks at the source (guard against a vacuous pass)", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => rel(f) === "lib/opsin.ts")).toBe(true);
    expect(files.some((f) => rel(f) === "taskpane/taskpane.ts")).toBe(true);
  });

  test("no source file starts a network request outside the allowlist", () => {
    const allowed = new Set(ALLOWED.map((a) => a.file));
    const offenders: string[] = [];

    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Comments describing the policy are not call sites.
        if (/^\s*(\/\/|\*|<!--)/.test(line)) continue;
        for (const re of PRIMITIVES) {
          if (re.test(line) && !allowed.has(rel(f))) {
            offenders.push(`${rel(f)}:${i + 1}  ${line.trim().slice(0, 90)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the allowlisted files are the only three, and all still exist", () => {
    // If a listed file is deleted or renamed the allowlist has silently widened,
    // so pin it from both directions.
    expect(ALLOWED.length).toBe(3);
    for (const a of ALLOWED) {
      expect(fs.existsSync(path.join(SRC, a.file))).toBe(true);
      expect(a.why.length).toBeGreaterThan(20);
    }
  });

  test("OPSIN is the only external host in the source", () => {
    const external = new Set<string>();
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        const host = m[1].toLowerCase();
        // WHICH LINE IS IT ON? A URL in a comment is a citation; a URL in code is an
        // address. The difference is the whole point of this test, so it is measured
        // rather than assumed — the exemption below applies only to comment lines, so
        // adding a real fetch to the same host still fails.
        const isComment = urlIsOnCommentLine(text, m.index ?? 0);
        // A URL on a COMMENT line is a citation, whatever its host (v2.143.0). The
        // journal-figure modules cite the guides their numbers came from (Nature's
        // final-artwork PDF, Elsevier's sizing page, eCFR 1.84, Okabe & Ito's J*Fly
        // page), exactly as elementData.ts cites PubChem — which was the only host
        // this exemption covered before. A comment cannot start a request, and the
        // PRIMITIVES scan above (code lines only) still fails any call site, so a
        // real fetch to one of these hosts is still caught: by that test, and by
        // this one if the URL appears on the code line that fetches it.
        if (isComment) continue;
        // NO string-literal exemption for citations: figureStyle.ts keeps its
        // presets' `sources` WITHOUT the https:// scheme, so they are not URLs to
        // this scan, and a URL literal in code anywhere is still an address.
        // The add-in's own host and Microsoft's required office.js CDN.
        if (host.endsWith("github.io") || host.endsWith("github.com")) continue;
        if (host === "appsforoffice.microsoft.com") continue;
        if (host === "localhost" || host === "127.0.0.1") continue;
        // XML namespace URIs. These are identifiers, not addresses — an OOXML
        // namespace is never dereferenced, and mathOmml.ts uses them to build
        // the markup Word expects. Verified: none appears in a fetch or a src=.
        if (host.endsWith("w3.org")) continue;
        if (host.endsWith("schemas.microsoft.com")) continue;
        if (host.endsWith("schemas.openxmlformats.org")) continue;
        if (host.endsWith("openchemlib.org") || host.endsWith("opensource.org")) continue; // licence URLs
        // Printed DOI links (v2.142.0). A reference list prints a DOI as
        // "https://doi.org/10.…", the form the style guides require, and doi.ts
        // recognises pasted "dx.doi.org" links. Like the namespaces above, these are
        // IDENTIFIERS written into the user's text, never dereferenced: the tests
        // below pin that doi.ts and every bib* module contain no network primitive,
        // and that no request anywhere is built from a DOI. EXACT host match only,
        // so "evil-doi.org" or "doi.org.example.com" still fail.
        if (host === "doi.org" || host === "dx.doi.org") continue;
        external.add(host);
      }
    }
    expect([...external].sort()).toEqual(["www.ebi.ac.uk"]);
  });

  test("the comment exemption is for COMMENTS only: a real fetch URL on a code line still counts (self-test)", () => {
    // Known-good: citations on //, /* and * lines are exempt.
    const cited = [
      "// Source: https://www.nature.com/documents/nature-final-artwork.pdf",
      "  /* https://www.ecfr.gov/x */",
      "   * (https://www.elsevier.com/about)",
    ];
    for (const c of cited) expect({ c, comment: urlIsOnCommentLine(c, c.indexOf("https://")) }).toEqual({ c, comment: true });
    // Known-bad: the SAME hosts in code — a fetch, a string literal, a URL after code
    // with a trailing comment — are NOT exempt, so the host scan would report them.
    const code = [
      'const r = await fetch("https://www.nature.com/x");',
      'const u = "https://www.ecfr.gov/y"; // cited',
      '  img.src = "https://www.elsevier.com/z";',
    ];
    for (const c of code) expect({ c, comment: urlIsOnCommentLine(c, c.indexOf("https://")) }).toEqual({ c, comment: false });
    // Multi-line text: the predicate reads the URL's OWN line, not the first line.
    const two = "// a citation\nfetch(\"https://www.nature.com/q\");";
    expect(urlIsOnCommentLine(two, two.indexOf("https://"))).toBe(false);
    // And the scan reports such a host: run the same host extraction over the probe.
    const hosts = [...code.join("\n").matchAll(/https?:\/\/([a-z0-9.-]+)/gi)]
      .filter((m) => !urlIsOnCommentLine(code.join("\n"), m.index ?? 0))
      .map((m) => m[1]);
    expect(hosts).toEqual(["www.nature.com", "www.ecfr.gov", "www.elsevier.com"]);
  });

  test("figureStyle.ts cites its sources without a scheme and holds no network primitive", () => {
    const fsrc = fs.readFileSync(path.join(SRC, "lib", "figureStyle.ts"), "utf8");
    const code = fsrc.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    for (const re of PRIMITIVES) expect({ primitive: String(re), found: re.test(code) }).toEqual({ primitive: String(re), found: false });
    expect(/https?:\/\//.test(code)).toBe(false);
  });

  test("printed DOIs are never fetched: doi.ts and the bib* modules hold no network primitive", () => {
    // The doi.org exemption above is for TEXT. It holds only while nothing turns a
    // DOI into a request, so pin that from three directions.
    const bibFiles = files.filter((f) => /^lib\/(doi|bib[A-Za-z]*|bibliography|bibtex|ris|cslJson|latexUnicode|journalAbbrev)\.ts$/.test(rel(f)));
    expect(bibFiles.map(rel)).toEqual(expect.arrayContaining(["lib/doi.ts", "lib/bibStyles.ts", "lib/bibPane.ts", "lib/bibtex.ts"]));
    for (const f of bibFiles) {
      const code = fs.readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      for (const re of PRIMITIVES) expect({ file: rel(f), primitive: String(re), found: re.test(code) }).toEqual({ file: rel(f), primitive: String(re), found: false });
      // No dynamic import of anything at all from these modules.
      expect({ file: rel(f), dynamicImport: /\bimport\s*\(/.test(code) }).toEqual({ file: rel(f), dynamicImport: false });
    }
    // Anywhere in the source: a line that starts a request never mentions a DOI.
    for (const f of files) {
      for (const line of fs.readFileSync(f, "utf8").split("\n")) {
        if (/^\s*(\/\/|\*|<!--)/.test(line)) continue;
        if (PRIMITIVES.some((re) => re.test(line))) expect(`${rel(f)}: ${line.trim()}`).not.toMatch(/doi/i);
      }
    }
    // The pane is allowlisted wholesale, so pin its fetch call sites by count: a new
    // one (a DOI lookup, say) has to change this number on purpose.
    const pane = fs.readFileSync(path.join(SRC, "taskpane", "taskpane.ts"), "utf8");
    const fetches = pane.split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l) && /\bfetch\s*\(/.test(l));
    expect(fetches).toHaveLength(3);
  });

  test("the OPSIN call is gated by an explicit consent flag", () => {
    // The library must not be callable without the pane's consent gate having
    // been passed; if this ever becomes automatic, the offline claim is gone.
    const pane = fs.readFileSync(path.join(SRC, "taskpane", "taskpane.ts"), "utf8");
    expect(pane).toMatch(/opsinConsent/);
    expect(pane).toMatch(/Send .* to the EMBL-EBI OPSIN service/);
  });

  test("version.json is fetched same-origin, with no host in the URL", () => {
    const pane = fs.readFileSync(path.join(SRC, "taskpane", "taskpane.ts"), "utf8");
    const call = /fetch\(`version\.json\?[^`]*`/.exec(pane);
    expect(call).not.toBeNull();
    // A relative URL cannot reach a third party.
    expect(call![0]).not.toMatch(/https?:/);
  });
});
