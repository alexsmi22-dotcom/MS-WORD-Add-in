// ChemDraw CDXML: the bounded XML reader, the document model and the renderer. Every document here
// is written by hand for the test (no client file is ever committed); each pins one rule of the
// format or of how ChemDraw draws it.
import { parseXml, XML_LIMITS } from "../xmlLite";
import { readCdxml, cssColor, CdxDoc } from "../cdxml";
import { renderCdx } from "../cdxmlRender";

const HEAD = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >
<CDXML CreationProgram="Test" BondLength="30" LineWidth="1" BoldWidth="4" HashSpacing="2.7" MarginWidth="2" BondSpacing="12" LabelFont="3" LabelSize="10" LabelFace="96" CaptionFont="3" CaptionSize="12">
<colortable><color r="1" g="1" b="1"/><color r="0" g="0" b="0"/><color r="1" g="0" b="0"/></colortable>
<fonttable><font id="3" charset="iso-8859-1" name="Arial"/></fonttable>
<page id="1" BoundingBox="0 0 540 720">`;
const TAIL = `</page></CDXML>`;
const doc = (body: string): CdxDoc => {
  const r = readCdxml(HEAD + body + TAIL);
  if (!r.ok) throw new Error(r.reason);
  return r.doc;
};
const svgOf = (body: string): string => renderCdx(doc(body))!.svg;

describe("the XML reader is bounded and never fetches", () => {
  test("elements, attributes, text and the five entities", () => {
    const r = parseXml(`<a x="1 &amp; 2"><b>A&lt;B &#916; &#x3B1;</b><c/></a>`);
    expect(r.ok && r.root.attrs.x).toBe("1 & 2");
    expect(r.ok && r.root.children[0].text).toBe("A<B Δ α");
    expect(r.ok && r.root.children.map((c) => c.name)).toEqual(["b", "c"]);
  });
  test.each([
    ["<a><b></a>", "line 1: </a> closes <b> (opened on line 1)"],
    ["<a>\n<b>\n</a>", "line 3: </a> closes <b> (opened on line 2)"],
    ['<a x="1" x="2"/>', "line 1: <a> has the attribute x twice"],
    ["<a>&nbsp;</a>", "line 1: the reference &nbsp; is not one XML defines"],
    ['<!DOCTYPE a [<!ENTITY e "boom">]><a>&e;</a>', "line 1: the DOCTYPE declares its own entities, which this reader does not accept"],
    ["<a>", "line 1: <a> (line 1) is never closed"],
    ["<a/><b/>", "line 1: a second root element"],
    ["<a x=1/>", "line 1: the value of x on <a> is not quoted"],
  ])("%s is refused by name", (src, why) => {
    expect(parseXml(src)).toEqual({ ok: false, reason: `it is not well-formed XML (${why})` });
  });
  test("the limits are checked before the work", () => {
    expect(parseXml("<a><a><a/></a></a>", { ...XML_LIMITS, depth: 2 })).toEqual({ ok: false, reason: "its elements are nested more than 2 deep" });
    expect(parseXml("<a><b/><b/><b/></a>", { ...XML_LIMITS, elements: 3 })).toEqual({ ok: false, reason: "it has more than 3 elements" });
    expect(parseXml("<a/>", { ...XML_LIMITS, chars: 2 })).toEqual({ ok: false, reason: "it is larger than 0 MB of text" });
  });
});

describe("reading a CDXML document", () => {
  test("the drawing style, colours (2-based) and fonts come from the document", () => {
    const d = doc("");
    expect(d.style).toMatchObject({ bondLength: 30, lineWidth: 1, boldWidth: 4, hashSpacing: 2.7, marginWidth: 2, labelSize: 10, captionSize: 12 });
    expect(d.style.bondGap).toBeCloseTo(3.6); // 12 % of the bond length
    expect([cssColor(d, 0), cssColor(d, 1), cssColor(d, 2), cssColor(d, 3), cssColor(d, 4)]).toEqual(["#000", "#fff", "rgb(255,255,255)", "rgb(0,0,0)", "rgb(255,0,0)"]);
    expect(d.fonts.get(3)).toBe("Arial");
  });
  test("not CDXML, or no page: refused by name", () => {
    expect(readCdxml("<svg/>")).toEqual({ ok: false, reason: "it is not a ChemDraw CDXML file (its root element is <svg>, not <CDXML>)" });
    expect(readCdxml("<CDXML/>")).toEqual({ ok: false, reason: "it has no page" });
  });
  test("an old copy marked SupersededBy is not drawn (an arrow would draw twice)", () => {
    const d = doc(`<graphic id="5" SupersededBy="6" BoundingBox="10 10 10 60" GraphicType="Line" ArrowType="FullHead"/>
      <arrow id="6" Head3D="10 60 0" Tail3D="10 10 0" ArrowheadHead="Full" ArrowheadType="Solid" HeadSize="1000" ArrowheadCenterSize="875" ArrowheadWidth="250"/>`);
    expect(d.objects.map((o) => o.kind)).toEqual(["arrow"]);
  });
  test("what is not drawn is counted by kind, never dropped silently", () => {
    const d = doc(`<spectrum id="9"/><tlcplate id="10"/>`);
    expect(d.notes).toEqual(["<spectrum> objects", "<tlcplate> objects"]);
  });
  test("bracketed groups and chemical-property links are read as meaning", () => {
    const d = doc(`<fragment id="2"><n id="3" p="10 10"/><n id="4" p="40 10"/><b id="5" B="3" E="4"/></fragment>
      <graphic id="7" BoundingBox="25 2 25 18" GraphicType="Bracket" BracketType="Square"/>
      <bracketedgroup id="8" BracketedObjectIDs="4"><bracketattachment id="9" GraphicID="7"><crossingbond id="10" BondID="5" InnerAtomID="4"/></bracketattachment></bracketedgroup>
      <t id="11" p="50 50"><s font="3" size="12">2-butanol</s></t>
      <chemicalproperty id="12" ChemicalPropertyDisplayID="11" ChemicalPropertyType="1" BasisObjects="2"/>`);
    expect(d.brackets).toEqual([expect.objectContaining({ objectIds: ["4"], attachments: [{ graphicId: "7", bondId: "5", innerAtomId: "4" }] })]);
    expect(d.properties).toEqual([{ displayId: "11", basis: ["2"], type: "1" }]);
  });
});

describe("drawing it as ChemDraw does", () => {
  test("a bond stops at its atom's label, the label's box grown by MarginWidth", () => {
    // O at (40, 10) with its label box 36…44 × 4…14; the bond from (10, 10) stops at x = 36 − 2.
    const svg = svgOf(`<fragment id="2"><n id="3" p="10 10"/><n id="4" p="40 10" Element="8"><t p="36.5 13.5" BoundingBox="36 4 44 14" LabelJustification="Left"><s font="3" size="10" face="96">O</s></t></n><b id="5" B="3" E="4"/></fragment>`);
    expect(svg).toContain('<line x1="10" y1="10" x2="34" y2="10"');
  });
  test("a ring's double bond has its second line inside the ring, shortened at both ends", () => {
    // A square ring (for simplicity) with one double bond along its top edge.
    const svg = svgOf(`<fragment id="2"><n id="3" p="0 0"/><n id="4" p="30 0"/><n id="5" p="30 30"/><n id="6" p="0 30"/>
      <b id="7" B="3" E="4" Order="2"/><b id="8" B="4" E="5"/><b id="9" B="5" E="6"/><b id="10" B="6" E="3"/></fragment>`);
    // The inner line is 3.6 below the top edge, trimmed 0.6 × 3.6 = 2.16 from each end.
    expect(svg).toContain('<line x1="2.16" y1="3.6" x2="27.84" y2="3.6"');
  });
  test("a C=O to a terminal labelled atom is centred", () => {
    const svg = svgOf(`<fragment id="2"><n id="3" p="0 0"/><n id="4" p="0 30" Element="8"><t p="-3 33.5" BoundingBox="-4 25 4 35"><s font="3" size="10" face="96">O</s></t></n>
      <n id="5" p="-26 -15"/><b id="6" B="5" E="3"/><b id="7" B="3" E="4" Order="2"/></fragment>`);
    expect(svg).toContain('x1="-1.8" y1="0"');
    expect(svg).toContain('x1="1.8" y1="0"');
  });
  test("a wedge is narrow at the begin atom and 1.5 × BoldWidth wide at the other", () => {
    const svg = svgOf(`<fragment id="2"><n id="3" p="0 0"/><n id="4" p="30 0"/><b id="5" B="3" E="4" Display="WedgeBegin"/></fragment>`);
    expect(svg).toMatch(/<path d="M0 0L30 3L30 -3Z"/);
  });
  test("formula labels set counts as subscripts and charges as superscripts", () => {
    const svg = svgOf(`<fragment id="2"><n id="3" p="10 10" NumHydrogens="3"><t p="6 13.5" BoundingBox="6 4 26 16"><s font="3" size="10" face="96">CH3</s></t></n></fragment>
      <t id="9" p="60 60"><s font="3" size="12" face="96">NH4+</s></t>`);
    expect(svg).toContain('font-size="10">CH</tspan><tspan font-family="Arial, Arial, Helvetica, sans-serif" font-size="7.5" dy="2.5">3</tspan>');
    // NH₄⁺: the 4 is lowered by 3, so the + rises 3 + 4.8 from there (the shift back rides on the next piece).
    expect(svg).toContain('font-size="9" dy="-7.8">+</tspan>');
  });
  test("a caption's subscript run (face 0x20) is a subscript", () => {
    const svg = svgOf(`<t id="9" p="10 20"><s font="3" size="12">CH</s><s font="3" size="12" face="32">3</s><s font="3" size="12">I</s></t>`);
    expect(svg).toMatch(/>CH<\/tspan><tspan[^>]*font-size="9" dy="3">3<\/tspan><tspan[^>]*font-size="12" dy="-3">I</);
    // No empty <tspan dy> to undo a shift: some rasterisers skip it and lower the rest of the line.
    expect(svg).not.toMatch(/<tspan dy="[^"]*"><\/tspan>/);
  });
  test("a stacked label (H below N) puts the element's line at p and the H under it", () => {
    const svg = svgOf(`<fragment id="2"><n id="3" p="190 103.8" Element="7" NumHydrogens="1"><t p="186.39 107.7" BoundingBox="186.39 99.36 193.61 116.04" LabelJustification="Left" LabelAlignment="Below"><s font="3" size="10" face="96">NH</s></t></n></fragment>`);
    expect(svg).toContain('y="107.7" text-anchor="start"');
    expect(svg).toContain('y="119.2" text-anchor="start"');
  });
  test("arrowheads: HeadSize, centre size and width in hundredths of the line width", () => {
    const svg = svgOf(`<arrow id="6" Head3D="10 60 0" Tail3D="10 10 0" ArrowheadHead="Full" ArrowheadType="Solid" HeadSize="1000" ArrowheadCenterSize="875" ArrowheadWidth="250"/>`);
    // Tip at (10, 60); back corners 10 back, 2.5 either side; the notch 8.75 back; the shaft ends at the notch.
    expect(svg).toContain('<path d="M10 60L7.5 50L10 51.25L12.5 50Z"');
    expect(svg).toContain('<line x1="10" y1="10" x2="10" y2="51.25"');
  });
  test("a bracket's lips turn toward the atoms it brackets", () => {
    const body = (inner: string): string => `<fragment id="2"><n id="3" p="10 10"/><n id="4" p="40 10"/><b id="5" B="3" E="4"/></fragment>
      <graphic id="7" BoundingBox="25 0 25 20" GraphicType="Bracket" BracketType="Square"/>
      <bracketedgroup id="8" BracketedObjectIDs="${inner}"><bracketattachment id="9" GraphicID="7"><crossingbond id="10" BondID="5" InnerAtomID="${inner}"/></bracketattachment></bracketedgroup>`;
    expect(svgOf(body("4"))).toContain('<path d="M27 0L25 0L25 20L27 20"'); // lips toward x = 40
    expect(svgOf(body("3"))).toContain('<path d="M23 0L25 0L25 20L23 20"'); // lips toward x = 10
  });
  test("a circled charge sits at its centre point", () => {
    const svg = svgOf(`<graphic id="7" BoundingBox="100 100 88 100" GraphicType="Symbol" SymbolType="CirclePlus"/>`);
    expect(svg).toContain('<circle cx="100" cy="100" r="4"');
  });
  test("the SVG is in points, at the document's own size, with only the chosen objects", () => {
    const d = doc(`<fragment id="2"><n id="3" p="10 10"/><n id="4" p="40 10"/><b id="5" B="3" E="4"/></fragment><t id="9" p="200 200"><s font="3" size="12">far</s></t>`);
    const one = renderCdx(d, { objects: new Set(["2"]), pad: 0 })!;
    expect(one.svg).not.toContain(">far<");
    expect(one.widthPt).toBeCloseTo(31, 6); // 30 + the line's own width
    expect(one.svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="31pt"/);
  });
});
