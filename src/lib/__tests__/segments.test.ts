import { escapeHtml, segmentsToHtml, pushSegment, Segment } from "../segments";

describe("escapeHtml", () => {
  it("escapes XML-significant characters", () => {
    expect(escapeHtml("a<b>&c")).toBe("a&lt;b&gt;&amp;c");
  });
});

describe("pushSegment", () => {
  it("merges adjacent same-type segments", () => {
    const segs: Segment[] = [];
    pushSegment(segs, "H", "normal");
    pushSegment(segs, "e", "normal");
    pushSegment(segs, "2", "sub");
    expect(segs).toEqual([
      { text: "He", type: "normal" },
      { text: "2", type: "sub" },
    ]);
  });

  it("ignores empty text", () => {
    const segs: Segment[] = [];
    pushSegment(segs, "", "normal");
    expect(segs).toHaveLength(0);
  });
});

describe("segmentsToHtml", () => {
  it("wraps sub/sup and escapes text", () => {
    expect(
      segmentsToHtml([
        { text: "x", type: "normal" },
        { text: "<2", type: "sup" },
      ]),
    ).toBe("x<sup>&lt;2</sup>");
  });
});
