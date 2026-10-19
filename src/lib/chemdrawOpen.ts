/**
 * Opening ChemDraw's own files and pictures: a .cdx or .cdxml file's bytes, or the selection's Flat OPC
 * holding a picture pasted from ChemDraw (its drawing rides inside the picture, emfCdx) — read on this
 * machine; nothing of it leaves it.
 */
import { readCdxml, readCdxmlTree, CdxDoc } from "./cdxml";
import { readCdx } from "./cdx";
import { cdxFromFlatOpc, idcodeFromAlt } from "./emfCdx";

export const CHEMDRAW_MAX_BYTES = 40 * 1024 * 1024;

/** A picked file's bytes → the document, or a refusal naming the file and the way to read it. */
export function openChemdrawFile(name: string, bytes: Uint8Array): { ok: true; doc: CdxDoc } | { ok: false; reason: string } {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  // A binary ChemDraw file is known by its first bytes, whatever it is called.
  if (magic === "VjCD0100") {
    if (bytes.length > CHEMDRAW_MAX_BYTES) return { ok: false, reason: `${name}: the file is ${Math.ceil((bytes.length / 1048576) * 10) / 10} MB — this reads ChemDraw files up to 40 MB` };
    const b = readCdx(bytes);
    if (!b.ok) return { ok: false, reason: `${name}: ${b.reason}` };
    const r = readCdxmlTree(b.root);
    if (!r.ok) return { ok: false, reason: `${name}: ${r.reason}` };
    r.doc.notes = [...b.notes.map((n) => `${n} (in the .cdx)`), ...r.doc.notes];
    if (!r.doc.objects.length) return { ok: false, reason: `${name}: the page has nothing drawn on it` };
    return r;
  }
  if (ext === "cdx") return { ok: false, reason: `${name}: it is not a ChemDraw CDX file (it does not start with VjCD0100)` };
  if (ext !== "cdxml" && ext !== "xml") return { ok: false, reason: `${name}: this opens ChemDraw files (.cdx and .cdxml)` };
  if (bytes.length > CHEMDRAW_MAX_BYTES) return { ok: false, reason: `${name}: the file is ${Math.ceil((bytes.length / 1048576) * 10) / 10} MB — this reads ChemDraw files up to 40 MB` };
  const r = readCdxml(new TextDecoder("utf-8").decode(bytes));
  if (!r.ok) return { ok: false, reason: `${name}: ${r.reason}` };
  if (!r.doc.objects.length) return { ok: false, reason: `${name}: the page has nothing drawn on it` };
  return r;
}

/**
 * The picture selected in the document: ChemDraw's drawing inside it, or — for a structure picture JurisLab
 * drew — the idcode in its alt text, or why it is neither.
 */
export function pictureToPage(opc: string): { kind: "page"; doc: CdxDoc } | { kind: "idcode"; idcode: string } | { kind: "refused"; reason: string } {
  const c = cdxFromFlatOpc(opc);
  if (!c.ok) {
    const id = c.alt ? idcodeFromAlt(c.alt) : null;
    if (id) return { kind: "idcode", idcode: id };
    return { kind: "refused", reason: c.reason.charAt(0).toUpperCase() + c.reason.slice(1) + "." };
  }
  const b = readCdx(c.cdx);
  if (!b.ok) return { kind: "refused", reason: `The picture's ChemDraw drawing could not be read: ${b.reason}.` };
  const r = readCdxmlTree(b.root);
  if (!r.ok) return { kind: "refused", reason: `The picture's ChemDraw drawing could not be read: ${r.reason}.` };
  r.doc.notes = [...b.notes, ...r.doc.notes];
  return { kind: "page", doc: r.doc };
}
