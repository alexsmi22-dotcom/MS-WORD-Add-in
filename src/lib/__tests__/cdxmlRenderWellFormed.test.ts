/**
 * @jest-environment jsdom
 */
// Every picture the canvas inserts goes through an SVG image load, and an image loads only well-formed XML: an
// attribute written twice (the hashed wedge's stroke-linecap) makes the whole picture fail. Each element the
// renderer writes is parsed strictly here, over drawings that use every bond style.
import { readCdxml } from "../cdxml";
import { renderCdx } from "../cdxmlRender";

const page = (bonds: string): string =>
  `<CDXML BondLength="30" LabelSize="10"><page id="900"><fragment id="10"><n id="101" p="0 0"/><n id="102" p="30 0"/><n id="103" p="45 26" Element="7" NumHydrogens="2"><t p="45 26"><s font="3" size="10" face="96">NH2</s></t></n><n id="104" p="45 -26" Charge="1"/>${bonds}</fragment><t id="20" p="0 60"><s font="3" size="10">caption</s></t><arrow id="30" Head3D="120 0 0" Tail3D="80 0 0" ArrowheadHead="Full" ArrowheadType="Solid"/></page></CDXML>`;

test.each([
  ["hashed wedge", '<b id="105" B="101" E="102"/><b id="106" B="102" E="103" Display="WedgedHashBegin"/><b id="107" B="102" E="104"/>'],
  ["wedge, bold, dashed", '<b id="105" B="101" E="102" Display="Bold"/><b id="106" B="102" E="103" Display="WedgeBegin"/><b id="107" B="102" E="104" Display="Dash"/>'],
  ["double, triple, aromatic, wavy", '<b id="105" B="101" E="102" Order="2"/><b id="106" B="102" E="103" Order="3"/><b id="107" B="102" E="104" Order="1.5" Display="Wavy"/>'],
  ["query marks and a stereo group", '<b id="105" B="101" E="102" Order="1 2" Topology="Ring"/><b id="106" B="102" E="103"/><b id="107" B="102" E="104" Display="WedgeBegin"/>'],
])("%s: the picture is well-formed SVG (no attribute written twice)", (_n, bonds) => {
  const d = readCdxml(page(bonds));
  if (!d.ok) throw new Error(d.reason);
  const svg = renderCdx(d.doc)!.svg;
  for (const tag of svg.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    const names = [...tag.matchAll(/\s([a-zA-Z:-]+)=/g)].map((m) => m[1]);
    expect([tag, names.length]).toEqual([tag, new Set(names).size]);
  }
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(doc.getElementsByTagName("parsererror").length).toBe(0);
});
