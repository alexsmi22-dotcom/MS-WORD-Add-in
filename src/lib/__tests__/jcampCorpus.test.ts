// JCAMP-DX reader against REAL files and an INDEPENDENT decoder.
//
// docs/SCOPE-SPECTROSCOPY-BATCH.md §D1. The oracle is the Python `jcamp` 1.3.2
// decoder (nzhagen), run over these exact files; its digest is fixtures/jcamp/
// oracle.json (see ATTRIBUTION.txt). Before v2.138.0 this reader got 1,083 of
// compound.jdx's 1,976 points wrong (DUP after DIF repeated the value), slid x
// by one sample after every y-check line, read E-notation AFFN as SQZ, and
// returned a one-point (0, 0) "spectrum" for every NTUPLES file — all `ok`.
//
// Every fixture is hashed (line endings normalised, so a CRLF checkout cannot
// change the hash): a test that passes against a different file proves nothing.

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { parseJcamp, JcampSpectrum } from "../jcamp";

const DIR = path.join(__dirname, "fixtures", "jcamp");
const read = (f: string): string => fs.readFileSync(path.join(DIR, f), "latin1");

const HASHES: Record<string, string> = {
  "1HQuinine.jdx": "9c4f514880808120",
  "2Methyl1Propanol.jdx": "511f677d14c1f6b7",
  "BRUKNTUP.DX": "2d4749ba0e94dc35",
  "BRUKPAC.DX": "5e093417f8f27cae",
  "BRUKSQZ.DX": "dc8c9effe8532229",
  "IMSDEMO.DX": "94fda20f2290817c",
  "ISAS_MS1.DX": "bb79ab9c3291a9b7",
  "LABCALC.DX": "034a2709cc285960",
  "PE1800.DX": "e6473ca929605bf1",
  "TESTFID.DX": "692b07e38e66760d",
  "TESTNTUP.DX": "0f9ada4e073d8b77",
  "TESTSPEC.DX": "2666ead11e702f16",
  "brukdif.jdx": "9e8881bb7d84999b",
  "compound.jdx": "daaf9c1ebdea0131",
  "ethanol_nmr.jdx": "109b75a0af3be806",
  "fixdec1.jdx": "f653acad9b3a39a5",
  "oracle.json": "ad4338a619ae6f5f",
  "pktab1.jdx": "8d4c84f81df72f8b",
  "scientific_notation_example.jdx": "53ac2bf79bde436d",
};

interface OracleFile {
  n: number;
  xmin?: number;
  xmax?: number;
  ymin?: number;
  ymax?: number;
  ysum?: number;
  samples?: [number, number, number][];
}
const ORACLE: { oracle: string; files: Record<string, OracleFile> } = JSON.parse(read("oracle.json"));

const parse = (f: string) => {
  const r = parseJcamp(read(f));
  if (!r.ok) throw new Error(`${f}: ${r.error}`);
  return r;
};
const block = (f: string, i = -1): JcampSpectrum => {
  const r = parse(f);
  return r.spectra[i < 0 ? r.defaultIndex : i];
};
/** Points sorted by x, as the oracle digest is. */
const sorted = (s: JcampSpectrum) => s.points.map((p, i) => ({ ...p, i })).sort((a, b) => a.x - b.x || a.i - b.i);
const close = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));

describe("fixtures are the files the oracle read", () => {
  test.each(Object.keys(HASHES))("%s hash", (f) => {
    const t = read(f).replace(/\r\n?/g, "\n");
    expect(crypto.createHash("sha256").update(t, "latin1").digest("hex").slice(0, 16)).toBe(HASHES[f]);
  });
});

describe("§D1 — every file the oracle reads decodes IDENTICALLY (Δy = 0, Δx ≈ 0)", () => {
  // compound.jdx block 1 is the DIFDUP file that was 1,083 points wrong.
  const files = Object.keys(ORACLE.files).filter((f) => ORACLE.files[f].n > 0);
  test("the oracle covers the §D1 rows", () => {
    for (const f of ["compound.jdx", "brukdif.jdx", "IMSDEMO.DX", "scientific_notation_example.jdx", "BRUKPAC.DX", "BRUKSQZ.DX", "PE1800.DX", "LABCALC.DX", "fixdec1.jdx", "2Methyl1Propanol.jdx", "1HQuinine.jdx"]) {
      expect(files).toContain(f);
    }
  });

  test.each(files)("%s", (f) => {
    const o = ORACLE.files[f];
    // LINK files: the oracle reads the first block holding data.
    const s = block(f, 0);
    expect(s.corrupt).toBeFalsy();
    expect(s.caveats.join(" ")).not.toMatch(/y-check failed|declares \d+ points but|X-check/);
    expect(s.points.length).toBe(o.n);
    const ps = sorted(s);
    expect(close(ps[0].x, o.xmin!)).toBe(true);
    expect(close(ps[ps.length - 1].x, o.xmax!)).toBe(true);
    let ymin = Infinity;
    let ymax = -Infinity;
    let ysum = 0;
    for (const p of ps) {
      if (p.y < ymin) ymin = p.y;
      if (p.y > ymax) ymax = p.y;
      ysum += p.y;
    }
    expect(ymin).toBe(o.ymin);
    expect(ymax).toBe(o.ymax);
    expect(close(ysum, o.ysum!, 1e-12)).toBe(true);
    for (const [i, x, y] of o.samples!) {
      expect(close(ps[i].x, x)).toBe(true);
      expect(ps[i].y).toBe(y);
    }
  });
});

describe("§D1 — the rows by name", () => {
  test("compound.jdx block 1 (DIFDUP): 1,976 points, x 450–4400, 0 y-check failures", () => {
    const r = parse("compound.jdx");
    const s = r.spectra[0];
    expect(s.title).toBe("block 1");
    expect(s.points).toHaveLength(1976);
    expect(s.points[0].x).toBe(4400);
    expect(s.points[s.points.length - 1].x).toBe(450);
    // Every block of the LINK file passes its own checks now (34 failures in block 1 before).
    for (const b of r.spectra) expect(b.corrupt).toBeFalsy();
  });

  test("brukdif.jdx: 16,384 points, x 24 038.5 → 0 Hz exactly", () => {
    const s = block("brukdif.jdx");
    expect(s.points).toHaveLength(16384);
    expect(s.points[0].x).toBeCloseTo(24038.5, 9);
    expect(Math.abs(s.points[16383].x)).toBeLessThan(1e-9 * 24038.5);
  });

  test("scientific_notation_example.jdx: 1,867 points, y from 0 to 1, no count caveat", () => {
    const s = block("scientific_notation_example.jdx");
    expect(s.points).toHaveLength(1867);
    expect(Math.min(...s.points.map((p) => p.y))).toBe(0);
    expect(Math.max(...s.points.map((p) => p.y))).toBe(1);
    expect(s.caveats.join(" ")).not.toMatch(/declares/);
    expect(s.caveats.join(" ")).toMatch(/read as exponents because that reading gives the declared 1,867 points/);
  });

  test("1HQuinine.jdx: 65,536 points, kind NMR (no DATA TYPE, no nucleus)", () => {
    const s = block("1HQuinine.jdx");
    expect(s.points).toHaveLength(65536);
    expect(s.kind).toBe("nmr");
    expect(s.nucleus).toBeUndefined();
    expect(s.meta[".OBSERVEFREQUENCY"]).toBeUndefined();
  });

  test("BRUKNTUP.DX: the real page, checked against the file's own header", () => {
    // The Python oracle returns 0 points here, so the header is the oracle:
    // VAR_DIM 16,384; FIRST/LAST x 24 038.5 → 0; R 2 254 931 → 1 513 177.
    const r = parse("BRUKNTUP.DX");
    expect(r.spectra).toHaveLength(1);
    const s = r.spectra[0];
    expect(s.points).toHaveLength(16384);
    expect(s.points[0].x).toBeCloseTo(24038.5, 6);
    expect(Math.abs(s.points[16383].x)).toBeLessThan(1e-9);
    expect(s.points[0].y).toBe(2254931);
    expect(s.points[16383].y).toBe(1513177);
    expect(s.kind).toBe("nmr");
    expect(s.nucleus).toBe("13C");
    expect(s.corrupt).toBeFalsy();
    expect(s.ntuples?.unusedPages).toEqual(["N=2 (SPECTRUM/IMAG)"]);
  });

  test("TESTNTUP.DX's real page is TESTSPEC.DX point for point, and BRUKNTUP to within quantisation", () => {
    const a = block("TESTNTUP.DX").points;
    const b = block("TESTSPEC.DX").points;
    const c = block("BRUKNTUP.DX").points;
    expect(a).toHaveLength(16384);
    expect(a).toEqual(b);
    // TESTNTUP stores R scaled by FACTOR 29 670.15; BRUKNTUP stores it raw.
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i].y - c[i].y));
    expect(worst).toBeLessThan(2);
  });

  test("TESTFID.DX is refused: an FID needs a Fourier transform", () => {
    const r = parseJcamp(read("TESTFID.DX"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/NMR FID — needs Fourier transform and phasing/);
  });

  test("ethanol_nmr.jdx: the default is the 16,384-point spectrum, titles carry no $$", () => {
    const r = parse("ethanol_nmr.jdx");
    expect(r.spectra).toHaveLength(2);
    expect(r.spectra.map((s) => s.title)).toEqual(["Ethanol", "Ethanol"]);
    expect(r.spectra[0].points).toHaveLength(4);
    expect(r.spectra[0].form).toBe("peaks");
    expect(r.defaultIndex).toBe(1);
    expect(r.spectra[1].points).toHaveLength(16384);
    expect(r.spectra[1].xUnits).toBe("HZ");
    expect(r.defaultReason).toMatch(/showing block 2 .*16,384 points/);
  });

  test("IMSDEMO.DX stays an unknown kind (ion mobility, not guessed)", () => {
    expect(block("IMSDEMO.DX").kind).toBe("unknown");
  });

  test("every fixture parses inside 4 s", () => {
    for (const f of Object.keys(HASHES).filter((n) => !n.endsWith(".json"))) {
      const text = read(f);
      const c0 = process.cpuUsage();
      parseJcamp(text);
      const u = process.cpuUsage(c0);
      expect((u.user + u.system) / 1000).toBeLessThan(4000);
    }
  });
});
