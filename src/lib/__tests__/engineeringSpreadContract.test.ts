// The Engineering tools that live in library registries (src/lib/*Calcs.ts, spread into the pane's ENG_CALCS) held to
// the same declarations engineeringRouting.test.ts holds the pane's own entries to. Until Release E (2026-10-23) the
// 26 spread tools sat outside both the routing gate and the unit contract — the engineering gap analysis found it —
// and Release E adds dozens more there. Read from source text, as the routing test reads the pane, so the gate needs
// no import of the registries (and cannot be satisfied by a test double).
import * as fs from "fs";
import * as path from "path";

const SRC = path.join(__dirname, "..", "..");
const PANE = fs.readFileSync(path.join(SRC, "taskpane", "taskpane.ts"), "utf8").replace(/\r\n/g, "\n");

const ENG_BODY = (() => {
  const i = PANE.indexOf("const ENG_CALCS");
  if (i < 0) throw new Error("ENG_CALCS not found");
  return PANE.slice(i, PANE.indexOf("\n];", i));
})();
const ORDER = (() => {
  const i = PANE.indexOf("const ENG_GROUP_ORDER");
  return [...PANE.slice(i, PANE.indexOf("] as const", i)).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
})();

/** The registries spread into ENG_CALCS, with the file each is imported from. */
const REGISTRIES = [...ENG_BODY.matchAll(/\.\.\.([A-Z][A-Z0-9_]*_CALCS)\b/g)].map((m) => {
  const name = m[1];
  const imp = new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "\\.\\./lib/([A-Za-z0-9]+)"`).exec(PANE);
  return { name, file: imp ? imp[1] : null };
});

const CONTRACTS = ["converts", "same-units", "exact", "spice", "domain"];
const PARSES = /\b(parseMeasured|unitReader|engUnits)\(/;

interface Entry {
  registry: string;
  file: string;
  id: string;
  /** The tool's own object literal: its declarations. */
  obj: string;
  /** The object plus the same-file functions it calls, two levels deep: where its fields are read. */
  seg: string;
}

/** The text from the `{` at `open` to its matching `}` (registry objects hold braces only in code and template
 *  literals, which balance). */
function braced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length && i < open + 200000; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

function entriesOf(file: string, registry: string): Entry[] {
  const src = fs.readFileSync(path.join(SRC, "lib", file + ".ts"), "utf8").replace(/\r\n/g, "\n");
  const ids = [...src.matchAll(/\n(\s+)id: "([a-z0-9-]+)",/g)];
  // A same-file function's body: `function name(` or `const name = (…) =>` — the brace after its parameter list.
  const fnBody = (name: string): string => {
    const decl = new RegExp(`\\n(?:export )?(?:function ${name}\\s*\\(|const ${name}\\s*=\\s*\\()`).exec(src);
    if (!decl) return "";
    const parenOpen = src.indexOf("(", decl.index + 1);
    let depth = 0, i = parenOpen;
    for (; i < src.length && i < parenOpen + 5000; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) break;
    }
    // The body's brace ends the line the parameter list closes on (`) {`, `): T | { error: string } {`, `) => {`); a
    // return type's inline object type does not end it. No brace there: an expression-bodied arrow (nothing to read),
    // never the next function's body.
    const eol = src.indexOf("\n", i);
    const line = src.slice(i, eol < 0 ? src.length : eol);
    return line.endsWith("{") ? braced(src, i + line.length - 1) : "";
  };
  const callsIn = (t: string): string[] => [...new Set([...t.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\(/g)].map((c) => c[1]))];
  return ids.map((m) => {
    const obj = braced(src, src.lastIndexOf("{", m.index!));
    const level1 = callsIn(obj).map(fnBody).join("\n");
    const level2 = callsIn(level1).map(fnBody).join("\n");
    return { registry, file, id: m[2], obj, seg: [obj, level1, level2].join("\n") };
  });
}
const ENTRIES: Entry[] = REGISTRIES.filter((r) => r.file).flatMap((r) => entriesOf(r.file!, r.name));

describe("the scan is not vacuous", () => {
  test("registries are spread into ENG_CALCS, each imported from a lib file", () => {
    expect(REGISTRIES.length).toBeGreaterThanOrEqual(9);
    expect(REGISTRIES.filter((r) => !r.file).map((r) => r.name)).toEqual([]);
  });
  test("they hold at least the 26 tools of v2.190.0", () => {
    expect(ENTRIES.length).toBeGreaterThanOrEqual(26);
  });
});

describe("every spread Engineering tool declares its inputs, group and unit contract", () => {
  test.each(ENTRIES.map((e) => [e.id, e] as const))("%s has a name, a hint, fields with defaults and a compute", (_id, e) => {
    expect(e.obj).toMatch(/\bname:\s*"/);
    expect(e.obj).toMatch(/\bhint:/);
    expect(e.obj).toMatch(/\bfields:\s*\[/);
    // `compute: (read) =>` or the method form `compute(read) {`.
    expect(e.obj).toMatch(/\bcompute(?::\s*\(|\s*\()/);
    expect(e.obj).toMatch(/key:\s*"[^"]+",\s*label:/);
    expect(e.obj).toMatch(/default:/);
  });

  test.each(ENTRIES.map((e) => [e.id, e] as const))("%s reads every field key it declares", (id, e) => {
    // One occurrence is the declaration; a key that is ever read appears again (in the object or a helper it calls).
    const declared = [...e.obj.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);
    const unread = declared.filter((k) => e.seg.split(`"${k}"`).length - 1 < 2);
    expect({ id, unread }).toEqual({ id, unread: [] });
  });

  test.each(ENTRIES.map((e) => [e.id, e] as const))("%s names a group the menu renders", (id, e) => {
    const g = /\bgroup:\s*"([^"]+)"/.exec(e.obj)?.[1] ?? null;
    // A group given by a constant (CLONING_GROUP, CHEM_ENG_GROUP): resolved in its own file or the one it imports from.
    const viaConst = /\bgroup:\s*([A-Z_]+)\b/.exec(e.obj)?.[1];
    const constIn = (f: string, depth = 0): string | null => {
      const text = fs.readFileSync(path.join(SRC, "lib", f + ".ts"), "utf8");
      const own = new RegExp(`const ${viaConst}\\s*=\\s*"([^"]+)"`).exec(text)?.[1];
      if (own) return own;
      const from = new RegExp(`import \\{[^}]*\\b${viaConst}\\b[^}]*\\} from "\\./([A-Za-z0-9]+)"`).exec(text)?.[1];
      return from && depth < 3 ? constIn(from, depth + 1) : null;
    };
    const resolved = g ?? (viaConst ? constIn(e.file) : null);
    expect({ id, group: resolved, rendered: resolved !== null && ORDER.includes(resolved) }).toEqual({ id, group: resolved, rendered: true });
  });

  test.each(ENTRIES.map((e) => [e.id, e] as const))("%s declares exactly one unit contract", (id, e) => {
    const found = [...e.obj.matchAll(/\bunitContract:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect({ id, found: found.length, known: found.every((c) => CONTRACTS.includes(c)) }).toEqual({ id, found: 1, known: true });
  });

  test.each(ENTRIES.filter((e) => /unitContract:\s*"converts"/.test(e.obj)).map((e) => [e.id, e] as const))(
    "%s converts: it actually reads fields through the unit layer",
    (id, e) => {
      expect({ id, parses: PARSES.test(e.seg) }).toEqual({ id, parses: true });
    },
  );

  test.each(ENTRIES.filter((e) => /unitContract:\s*"(same-units|exact|domain)"/.test(e.obj)).map((e) => [e.id, e] as const))(
    "%s does not convert behind its own declaration",
    (id, e) => {
      expect({ id, converts: PARSES.test(e.seg) }).toEqual({ id, converts: false });
    },
  );
});

describe("tool ids are unique across the pane and every registry", () => {
  test("no id repeats", () => {
    const pane = [...ENG_BODY.matchAll(/\bid: "([a-z0-9-]+)"/g)].map((m) => m[1]);
    const all = [...pane, ...ENTRIES.map((e) => e.id)];
    const dup = all.filter((x, i) => all.indexOf(x) !== i);
    expect(dup).toEqual([]);
  });
});
