/**
 * Open ChemDraw file… and Open ChemDraw picture in the Structure ▸ Draw tab: the file or the selected
 * picture is read here (src/lib/chemdrawOpen) and opens on the chemistry canvas — the one builder.
 */
import type { CdxDoc } from "../lib/cdxml";
import { CHEMDRAW_MAX_BYTES, openChemdrawFile, pictureToPage } from "../lib/chemdrawOpen";

export interface ChemdrawOpenHost {
  setStatus(text: string, kind?: "success" | "error" | ""): void;
  /** The document's selection as Flat OPC (Open ChemDraw picture). */
  readSelectionOoxml?(): Promise<string | null>;
  /** Puts an opened ChemDraw page on the Draw canvas (true = done). */
  openPage(doc: CdxDoc, name: string): boolean;
  /** A structure picture JurisLab drew opens again from the idcode in its alt text (true = done). */
  openIdcode?(idcode: string): boolean;
}

export function initChemdrawOpen(host: ChemdrawOpenHost): void {
  const openBtn = document.getElementById("chemdraw-open") as HTMLButtonElement | null;
  const fromDocBtn = document.getElementById("chemdraw-from-doc") as HTMLButtonElement | null;
  const fileIn = document.getElementById("chemdraw-file") as HTMLInputElement | null;
  const load = (d: CdxDoc, label: string): void => {
    if (!host.openPage(d, label)) host.setStatus(`${label} could not be opened on the drawing canvas here.`, "error");
  };
  openBtn?.addEventListener("click", () => {
    if (!fileIn) return;
    fileIn.value = ""; // the same file picked again still opens
    fileIn.click();
  });
  fileIn?.addEventListener("change", () => {
    const file = fileIn.files?.[0];
    if (!file) return;
    if (file.size > CHEMDRAW_MAX_BYTES) return host.setStatus(`${file.name}: the file is ${Math.ceil((file.size / 1048576) * 10) / 10} MB — this reads ChemDraw files up to 40 MB`, "error");
    host.setStatus(`Reading ${file.name}…`, "");
    const reader = new FileReader();
    reader.onerror = () => host.setStatus(`Could not read ${file.name}.`, "error");
    reader.onload = () => {
      // Yield once so "Reading…" is painted before a large file is drawn.
      window.setTimeout(() => {
        let r: ReturnType<typeof openChemdrawFile>;
        try {
          r = openChemdrawFile(file.name, new Uint8Array(reader.result as ArrayBuffer));
        } catch (e) {
          return host.setStatus(`${file.name}: the file could not be read (${(e as Error).message}).`, "error");
        }
        if (!r.ok) return host.setStatus(r.reason, "error");
        load(r.doc, file.name);
      }, 0);
    };
    reader.readAsArrayBuffer(file);
  });
  // A ChemDraw picture in the document carries its drawing (emfCdx): it opens as that drawing.
  let reading = false;
  fromDocBtn?.addEventListener("click", async () => {
    if (reading || !host.readSelectionOoxml) return;
    reading = true;
    host.setStatus("Reading the selected picture…", "");
    try {
      const opc = await host.readSelectionOoxml();
      if (!opc) return host.setStatus("Select a ChemDraw picture in the document first (click it), then Open ChemDraw picture.", "error");
      const r = pictureToPage(opc);
      if (r.kind === "page") return load(r.doc, "The ChemDraw picture");
      if (r.kind === "idcode" && host.openIdcode?.(r.idcode)) return;
      host.setStatus(r.kind === "refused" ? r.reason : "The structure in the picture's description could not be opened.", "error");
    } catch (e) {
      host.setStatus(`Could not read the selected picture: ${(e as Error).message}`, "error");
    } finally {
      reading = false;
    }
  });
}
