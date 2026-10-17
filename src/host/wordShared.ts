/// <reference types="office-js" />
/**
 * Word helpers shared by the host transactions (docs/SCOPE-HOST-ADAPTER.md).
 * Office.js types are allowed here and in the other src/host/word*.ts files;
 * nowhere else should need them.
 */
import type { InsertAt } from "./host";

/**
 * The Word insert location for a plain-data one. Resolved at call time, never
 * at module load: the Word namespace exists by the time anything inserts, but
 * a module-scope read would bind whatever stood there when the bundle ran.
 */
export function wordLocation(at: InsertAt): Word.InsertLocation {
  return at === "replace" ? Word.InsertLocation.replace : Word.InsertLocation.after;
}

/**
 * Wraps an already-inserted, already-synced range in a hidden, tagged content
 * control so the artifact can be re-found and updated later (e.g. renumbering
 * callouts, refreshing a list). Best-effort and isolated in its own sync: if
 * content controls aren't supported on this build, the inserted content is left
 * exactly as-is. The "hidden" appearance keeps the document visually unchanged.
 */
export async function tagInserted(context: Word.RequestContext, range: Word.Range, tag: string): Promise<void> {
  try {
    const cc = range.insertContentControl();
    cc.tag = tag;
    cc.title = "JurisLab";
    cc.appearance = Word.ContentControlAppearance.hidden;
    await context.sync();
  } catch {
    // Content controls unsupported here — the inserted content remains in place.
  }
}
