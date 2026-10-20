// CHANGELOG headings. Three releases in a row (2.162.0, 2.162.1, 2.163.0) lost their
// "## [x.y.z]" heading when the next release's section was put above them: the date line
// was left behind with no version, and the release's notes read as part of the one above.
import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..", "..", "..");
const log = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string };

describe("CHANGELOG headings", () => {
  it("every dated release line is a versioned heading", () => {
    const orphans = log.split("\n").filter((l) => /^\s*—\s*\d{4}-\d{2}-\d{2}\s*—/.test(l));
    expect(orphans).toEqual([]);
  });

  it("the shipping version has its section, at the top", () => {
    const first = /^## \[(\d+\.\d+\.\d+)\]/m.exec(log);
    expect(first && first[1]).toBe(pkg.version);
  });

  it("versions run newest first, each once", () => {
    const vs = [...log.matchAll(/^## \[(\d+)\.(\d+)\.(\d+)\]/gm)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    const key = (v: number[]) => v[0] * 1e6 + v[1] * 1e3 + v[2];
    for (let i = 1; i < vs.length; i++) expect(key(vs[i - 1])).toBeGreaterThan(key(vs[i]));
  });
});
