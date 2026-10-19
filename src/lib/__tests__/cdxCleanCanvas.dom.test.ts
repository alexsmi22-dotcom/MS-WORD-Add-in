/**
 * @jest-environment jsdom
 */
// Clean refused part-way through a page (one structure fine, the next refused): the page is restored whole,
// and what the canvas reads (chemistry, inserts) is the page as it was — never a half-cleaned layout.
import { TextDecoder as NodeTextDecoder } from "util";
import { readCdxml } from "../cdxml";
import { addBrackets, findById } from "../cdxmlEdit";
import { createChemCanvas } from "../../taskpane/chemCanvas";

(globalThis as unknown as { TextDecoder: unknown }).TextDecoder ??= NodeTextDecoder;

test("3. refused on the second structure: the first is back where it was, in the page and in what is read", () => {
  document.body.innerHTML = '<div id="m"></div>';
  const c = createChemCanvas(document.getElementById("m")!, { setStatus: () => undefined });
  const r = readCdxml('<CDXML BondLength="30"><page id="900"><fragment id="10"><n id="101" p="100 100"/><n id="102" p="150 100"/><n id="103" p="155 111"/><b id="104" B="101" E="102"/><b id="105" B="102" E="103"/></fragment><fragment id="20"><n id="201" p="300 300"/><n id="202" p="330 300"/><n id="203" p="360 300"/><n id="204" p="390 300"/><b id="205" B="201" E="202"/><b id="206" B="202" E="203"/><b id="207" B="203" E="204"/></fragment></page></CDXML>');
  if (!r.ok) throw new Error(r.reason);
  expect(addBrackets(r.doc, [318, 285, 372, 315])).toBeNull();
  // loadPage takes a parsed page: re-read after the bracket edit so the page knows its brackets.
  const { readCdxmlTree } = jest.requireActual("../cdxml") as typeof import("../cdxml");
  const withBrackets = readCdxmlTree(r.doc.root);
  if (!withBrackets.ok) throw new Error(withBrackets.reason);
  c.loadPage(withBrackets.doc);
  expect(c.clean()).toBe(false);
  expect(findById(c.page().root, "101")!.el.attrs.p).toBe("100 100");
  const node = c.page().objects.flatMap((o) => o.items.flatMap((it) => (it.kind === "fragment" ? it.v.nodes : []))).find((n) => n.id === "101")!;
  expect(node.p).toEqual([100, 100]);
});
