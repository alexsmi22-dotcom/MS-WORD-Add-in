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
    why: "Same-origin GET of version.json to drive the update banner. Carries no document content.",
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

  test("the allowlisted files are the only two, and both still exist", () => {
    // If a listed file is deleted or renamed the allowlist has silently widened,
    // so pin it from both directions.
    expect(ALLOWED.length).toBe(2);
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
        external.add(host);
      }
    }
    expect([...external].sort()).toEqual(["www.ebi.ac.uk"]);
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
