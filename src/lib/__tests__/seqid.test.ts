import { extractSeqIdRefs, formatSeqIdRef, formatSeqIdRefs, reconcileSeqIds } from "../seqid";

describe("extractSeqIdRefs", () => {
  it("finds singular, plural, and dotted forms", () => {
    const text = "the polypeptide of SEQ ID NO: 1 and SEQ ID NOs: 2 and 4, plus SEQ ID NO. 3";
    expect(extractSeqIdRefs(text)).toEqual([1, 2, 3, 4]);
  });
  it("expands ranges", () => {
    expect(extractSeqIdRefs("SEQ ID NOs: 1-3")).toEqual([1, 2, 3]);
  });
});

describe("formatSeqIdRef(s)", () => {
  it("formats a single reference", () => {
    expect(formatSeqIdRef(1)).toBe("SEQ ID NO: 1");
  });
  it("collapses runs of 3+ and lists the rest", () => {
    expect(formatSeqIdRefs([1, 2, 3])).toBe("SEQ ID NOs: 1-3");
    expect(formatSeqIdRefs([1, 3])).toBe("SEQ ID NOs: 1 and 3");
    expect(formatSeqIdRefs([1, 2, 4, 5])).toBe("SEQ ID NOs: 1, 2, 4 and 5");
  });
});

describe("reconcileSeqIds", () => {
  it("reports uncited listing entries", () => {
    expect(reconcileSeqIds([1, 2], 3)).toMatchObject({ uncited: [3], outOfRange: [], ok: false });
  });
  it("reports references beyond the listing size", () => {
    expect(reconcileSeqIds([1, 5], 3)).toMatchObject({ outOfRange: [5], uncited: [2, 3] });
  });
  it("is ok when references exactly match the listing", () => {
    expect(reconcileSeqIds([1, 2, 3], 3).ok).toBe(true);
  });
});
