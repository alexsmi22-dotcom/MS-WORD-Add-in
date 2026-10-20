// The CIP release gate (docs/SCOPE-CIP.md): the shipped cipDescriptors scored against the CIP Validation Suite
// (Hanson et al., J. Chem. Inf. Model. 2018, 58, 1755). The suite states no licence, so it is never in the repo:
// `node scripts/cip-suite.js` fetches it and runs this file with CIP_SUITE_DIR set; without it, this is skipped.
// The gate: ZERO wrong labels and ZERO labels the suite does not give — from SMILES and from the wedged 2D SDF.
import * as fs from "fs";
import * as path from "path";
import { Molecule } from "openchemlib/full";
import { cipDescriptors } from "../cip";

const DIR = process.env.CIP_SUITE_DIR;
const run = DIR ? describe : describe.skip;

interface Entry {
  id: string;
  labels: string;
  mol: () => Molecule;
}

function entries(file: string): Entry[] {
  const text = fs.readFileSync(path.join(DIR!, file), "utf8");
  if (file.endsWith(".sdf")) {
    return text
      .split("$$$$")
      .filter((r) => r.trim())
      .map((rec) => {
        const molfile = rec.slice(0, rec.indexOf("M  END") + 6).replace(/^\s*\n/, "");
        return {
          id: /> *<STRUCTURE_ID>\s*\n([^\n]*)/.exec(rec)?.[1]?.trim() ?? "?",
          labels: /> *<CIP_LABELS>\s*\n([^\n]*)/.exec(rec)?.[1]?.trim() ?? "",
          mol: () => Molecule.fromMolfile(molfile),
        };
      });
  }
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [smi, id, labels = ""] = line.split("\t");
      return { id, labels: labels.trim(), mol: () => Molecule.fromSmiles(smi) };
    });
}

function score(file: string): { right: number; refused: number; wrong: string[]; extra: string[]; slowest: number } {
  let right = 0, refused = 0, slowest = 0;
  const wrong: string[] = [], extra: string[] = [];
  for (const e of entries(file)) {
    const mol = e.mol();
    const t0 = Date.now();
    const r = cipDescriptors(mol);
    slowest = Math.max(slowest, Date.now() - t0);
    const want = new Map<number, string>();
    for (const w of e.labels.split(/\s+/)) {
      const m = /^(\d+)([A-Za-z])$/.exec(w);
      if (m) want.set(Number(m[1]), m[2]);
    }
    const given = new Set<number>();
    for (const c of r.centres) {
      const atoms = c.kind === "bond" ? [c.atom, c.atom2!] : [c.atom];
      for (const a of atoms) {
        const w = want.get(a + 1);
        if (!c.label) {
          if (w) refused++;
          continue;
        }
        given.add(a + 1);
        if (!w) extra.push(`${e.id}: ${c.label} at atom ${a + 1}, the suite gives none`);
        else if (w !== c.label) wrong.push(`${e.id}: atom ${a + 1} ${c.label}, the suite says ${w}`);
        else right++;
      }
    }
  }
  return { right, refused, wrong, extra, slowest };
}

run("CIP Validation Suite gate", () => {
  for (const file of ["compounds.smi", "compounds_2d.sdf"]) {
    test(`${file}: no wrong label, no label the suite does not give`, () => {
      const s = score(file);
      // eslint-disable-next-line no-console
      console.log(`${file}: ${s.right} right, ${s.refused} refused by name, ${s.wrong.length} wrong, ${s.extra.length} extra; slowest ${s.slowest} ms`);
      expect(s.wrong).toEqual([]);
      expect(s.extra).toEqual([]);
    }, 600_000);
  }
});
