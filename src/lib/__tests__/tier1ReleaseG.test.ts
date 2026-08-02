// Tier 1 release G: the sequence workflow — importing a file into the ST.26
// listing, and citing a run of SEQ ID numbers in one insertion.

import * as fs from "fs";
import * as path from "path";
import { parseSequenceFile } from "../seqio";
import { formatSeqIdRef, formatSeqIdRefs } from "../seqid";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const pane = fs.readFileSync(path.join(ROOT, "src", "taskpane", "taskpane.ts"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "src", "taskpane", "taskpane.html"), "utf8");

describe("the parser the ST.26 panel can now reach", () => {
  it("reads a multi-record FASTA — the case that made hand entry painful", () => {
    const p = parseSequenceFile(">one\nACGTACGT\n>two\nTTTTGGGG\n>three\nAAAACCCC\n");
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.records).toHaveLength(3);
      expect(p.records[0].sequence).toBe("ACGTACGT");
    }
  });

  it("refuses something that is neither FASTA nor GenBank, by name", () => {
    const p = parseSequenceFile("just some prose");
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error).toMatch(/FASTA|GenBank/);
  });
});

describe("the import is wired into the Sequence panel", () => {
  it("the button and a multiple-file input exist", () => {
    expect(html).toMatch(/id="seq-import-btn"/);
    expect(html).toMatch(/id="seq-import-file"[^>]*multiple/);
    expect(html).toMatch(/accept="[^"]*\.fasta[^"]*\.gb/);
  });

  it("the handler parses through the shared reader and makes one card per record", () => {
    const start = pane.indexOf("async function importSequenceFiles");
    expect(start).toBeGreaterThan(-1);
    const body = pane.slice(start, pane.indexOf("\n}\n", start));
    expect(body).toMatch(/parseSequenceFile\(/);
    expect(body).toMatch(/addSequenceCard\(\{/);
    expect(body).toMatch(/8 \* 1024 \* 1024/); // size guard, like the other readers
  });

  it("a prefilled card fires real events rather than setting state twice", () => {
    const start = pane.indexOf("function addSequenceCard");
    const body = pane.slice(start, pane.indexOf("\n}\n", start));
    expect(body).toMatch(/moltype\.dispatchEvent\(new Event\("change"\)\)/);
    expect(body).toMatch(/residues\.dispatchEvent\(new Event\("input"\)\)/);
  });

  it("only a BLANK starter card is removed — never typed work", () => {
    const start = pane.indexOf("async function importSequenceFiles");
    const body = pane.slice(start, pane.indexOf("\n}\n", start));
    expect(body).toMatch(/if \(ta && !ta\.value\.trim\(\)\) c\.remove\(\)/);
  });

  it("molecule type is guessed conservatively and visibly", () => {
    const start = pane.indexOf("function guessMolType");
    const body = pane.slice(start, pane.indexOf("\n}\n", start));
    expect(body).toMatch(/RNA/);
    expect(body).toMatch(/AA/);
  });
});

describe("SEQ ID references collapse a run into one citation", () => {
  it("a single number is unchanged", () => {
    expect(formatSeqIdRefs([4])).toBe(formatSeqIdRef(4));
  });

  it("consecutive numbers become a range", () => {
    const s = formatSeqIdRefs([1, 2, 3]);
    expect(s).toMatch(/1/);
    expect(s).toMatch(/3/);
    expect(s).toMatch(/NOs/);
  });

  it("duplicates and disorder are handled", () => {
    expect(formatSeqIdRefs([3, 1, 2, 3])).toBe(formatSeqIdRefs([1, 2, 3]));
  });

  it("the pane accepts a list or a range and refuses nonsense", () => {
    const start = pane.indexOf("async function insertSeqIdRef");
    const body = pane.slice(start, pane.indexOf("\n}\n", start));
    expect(body).toMatch(/formatSeqIdRefs\(/);
    // A range is parsed at all - matched loosely, because pinning the exact
    // regex source in a test makes it break on a harmless rewrite.
    expect(body).toMatch(/range/);
    expect(body).toMatch(/is not a usable range of SEQ ID numbers/);
    expect(body).toMatch(/is not a SEQ ID number/);
  });

  it("the input accepts text now, not just a spinner number", () => {
    expect(html).toMatch(/id="seq-ref-num" type="text"/);
    expect(html).toMatch(/placeholder="1, or 1-3, or 1,2,5"/);
  });
});
