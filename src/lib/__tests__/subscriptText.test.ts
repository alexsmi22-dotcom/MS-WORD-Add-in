// Underscore subscripts in Engineering prose (v2.191.0 QC) — the rule, and a gate over every library registry's
// default result: after the pane's tidy pass no prose, table, caption or output name keeps an "X_y", and every math
// line typesets (a math line that does not parse is inserted as its text fallback, silently).
import * as fs from "fs";
import * as path from "path";
import type { AnalyzeOutput } from "../analyzeBlocks";
import { mathToOmml } from "../mathOmml";
import { tidyResultSubscripts, tidySubscripts } from "../subscriptText";

describe("tidySubscripts", () => {
  test.each([
    ["S_a = 60000 /s", "Sₐ = 60000 /s"],
    ["D_t = 0.3 m, D_r = 1 m", "Dₜ = 0.3 m, Dᵣ = 1 m"],
    ["CHSH S_max", "CHSH Sₘₐₓ"],
    ["η_geo is exact", "η(geo) is exact"],
    ["P_succ per attempt", "P(succ) per attempt"],
    ["ρ_A = tr_B |ψ⟩⟨ψ|", "ρ(A) = tr(B) |ψ⟩⟨ψ|"],
    ["η_{da} and x_{12}", "η(da) and x₁₂"],
    ["[H⁺] + C_b = [OH⁻] + C_a", "[H⁺] + C(b) = [OH⁻] + Cₐ"],
    ["no subscript here", "no subscript here"],
    ["a file_name? 3_4", "a fileₙₐₘₑ? 3_4"],
  ])("%s → %s", (a, b) => expect(tidySubscripts(a)).toBe(b));

  test("math sources keep their underscores; fallbacks, tables, captions and outputs are tidied", () => {
    const out: AnalyzeOutput = {
      text: "S_a = 1",
      blocks: [
        { kind: "math", math: "S_a = R η_a", fallback: "S_a = R·η_a" },
        { kind: "table", label: "Singles S_a", rows: [["Singles S_b", "6000"]] },
        { kind: "plot", svg: "<svg/>", caption: "η_geo against range", alt: "η_geo", w: 1, h: 1 },
      ],
      outputs: [{ key: "smax", label: "CHSH S_max", value: 2.5, unit: "" }],
    };
    const t = tidyResultSubscripts(out);
    expect(t.text).toBe("Sₐ = 1");
    expect(t.blocks![0]).toEqual({ kind: "math", math: "S_a = R η_a", fallback: "Sₐ = R·ηₐ" });
    expect(t.blocks![1]).toEqual({ kind: "table", label: "Singles Sₐ", rows: [["Singles S(b)", "6000"]] });
    expect((t.blocks![2] as { caption: string }).caption).toBe("η(geo) against range");
    expect(t.outputs![0].label).toBe("CHSH Sₘₐₓ");
  });
});

describe("every library registry tool, on its defaults", () => {
  const PANE = fs.readFileSync(path.join(__dirname, "..", "..", "taskpane", "taskpane.ts"), "utf8");
  const regs = [...PANE.matchAll(/import \{ ([A-Z_]+_CALCS) \} from "\.\.\/lib\/([A-Za-z0-9]+)"/g)].map((m) => [m[1], m[2]]);
  type Tool = { id: string; fields: Array<{ key: string; default: string }>; compute: (r: (k: string) => string) => AnalyzeOutput };
  const tools: Tool[] = [];
  for (const [name, file] of regs) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("../" + file);
    for (const c of (mod[name] ?? []) as Array<Partial<Tool>>) if (c.fields && typeof c.compute === "function") tools.push(c as Tool);
  }
  const run = (c: Tool): AnalyzeOutput => {
    const d: Record<string, string> = {};
    for (const f of c.fields) d[f.key] = f.default;
    return tidyResultSubscripts(c.compute((k) => d[k] ?? ""));
  };

  test("the scan is not vacuous", () => expect(tools.length).toBeGreaterThan(80));

  test.each(tools.map((c) => [c.id, c] as const))("%s: no underscore subscript left in what is read", (id, c) => {
    const out = run(c);
    if (out.ok === false) return;
    const texts: string[] = [];
    for (const b of out.blocks ?? []) {
      if (b.kind === "line") texts.push(b.text);
      if (b.kind === "math") texts.push(b.fallback);
      if (b.kind === "table") texts.push(b.label ?? "", ...b.rows.flat());
      if (b.kind === "plot") texts.push(b.caption, b.alt);
    }
    for (const o of out.outputs ?? []) texts.push(o.label);
    const left = texts.filter((t) => /[A-Za-zα-ωΑ-Ω)\]⟩|]_[A-Za-z0-9{]/.test(t));
    expect({ id, left }).toEqual({ id, left: [] });
  });

  test.each(tools.map((c) => [c.id, c] as const))("%s: every math line typesets", (id, c) => {
    const out = run(c);
    if (out.ok === false) return;
    const bad = (out.blocks ?? []).filter((b) => b.kind === "math").filter((b) => {
      try {
        mathToOmml((b as { math: string }).math);
        return false;
      } catch {
        return true;
      }
    });
    expect({ id, bad: bad.map((b) => (b as { math: string }).math) }).toEqual({ id, bad: [] });
  });
});
