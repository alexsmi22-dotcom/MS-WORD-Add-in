import { formatCodeBlock } from "../codeblock";

describe("formatCodeBlock — algorithm style", () => {
  const algo = "function KeyGen(λ)\n  if x > 0 then\n    return x\n  end";

  it("bolds control-flow keywords", () => {
    const html = formatCodeBlock(algo, { style: "algorithm", lineNumbers: true });
    expect(html).toContain("<b>function</b>");
    expect(html).toContain("<b>if</b>");
    expect(html).toContain("<b>then</b>");
    expect(html).toContain("<b>return</b>");
    expect(html).toContain("<b>end</b>");
  });

  it("numbers lines when requested", () => {
    const html = formatCodeBlock(algo, { style: "algorithm", lineNumbers: true });
    // four lines → numbers 1..4 each in their own cell
    expect(html).toContain(">1</td>");
    expect(html).toContain(">4</td>");
  });

  it("renders a bold caption row when a title is given", () => {
    const html = formatCodeBlock(algo, { style: "algorithm", title: "Algorithm 1: KeyGen", lineNumbers: true });
    expect(html).toContain("font-weight:bold");
    expect(html).toContain("Algorithm 1: KeyGen");
  });

  it("preserves indentation via white-space:pre", () => {
    const html = formatCodeBlock(algo, { style: "algorithm", lineNumbers: false });
    expect(html).toContain("white-space:pre");
    expect(html).toContain("    <b>return</b>"); // leading spaces kept
  });
});

describe("formatCodeBlock — code style", () => {
  const code = "for (i = 0; i < n; i++) {\n    sum += a[i];\n}";

  it("does not bold keywords (verbatim)", () => {
    const html = formatCodeBlock(code, { style: "code", lineNumbers: true });
    expect(html).not.toContain("<b>for</b>");
  });

  it("escapes HTML-special characters", () => {
    const html = formatCodeBlock("a < b && c > d", { style: "code", lineNumbers: false });
    expect(html).toContain("a &lt; b &amp;&amp; c &gt; d");
  });

  it("omits line-number cells when lineNumbers is false", () => {
    const html = formatCodeBlock(code, { style: "code", lineNumbers: false });
    // exactly one <td> per row (the code cell)
    const rows = html.match(/<tr>/g) || [];
    const cells = html.match(/<td/g) || [];
    expect(cells.length).toBe(rows.length);
  });
});

describe("formatCodeBlock — trimming", () => {
  it("trims leading and trailing blank lines but keeps internal ones", () => {
    const html = formatCodeBlock("\n\na\n\nb\n\n", { style: "code", lineNumbers: true });
    expect(html).toContain(">1</td>");
    expect(html).toContain(">3</td>"); // a, blank, b → 3 lines
    expect(html).not.toContain(">4</td>");
  });
});
