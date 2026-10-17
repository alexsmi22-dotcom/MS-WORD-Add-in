/// <reference types="office-js" />
/**
 * Office calls outside Word.run (docs/SCOPE-HOST-ADAPTER.md, Kind 5): the
 * document's settings store and the pop-out dialogs. Thin pass-throughs on
 * purpose — each call is what the pane made before, with its result handed
 * back untouched, so the pane's own try/catch and messages behave exactly as
 * they did (a missing Office throws here and is caught there, as before).
 */
import type { DialogHandlers, SettingsSaveResult } from "./host";

export function getSetting(key: string): unknown {
  return Office.context.document.settings.get(key);
}

export function setSetting(key: string, value: unknown): void {
  Office.context.document.settings.set(key, value);
}

/** saveAsync, with the result reduced to what the pane reads. No callback = fire and forget, as before. */
export function saveSettings(done?: (r: SettingsSaveResult) => void): void {
  if (!done) {
    Office.context.document.settings.saveAsync();
    return;
  }
  Office.context.document.settings.saveAsync((res) => {
    done({ succeeded: res.status === Office.AsyncResultStatus.Succeeded, error: res.error ? { message: res.error.message } : null });
  });
}

/** Whether this host can open a pop-out dialog window at all. */
export function dialogsSupported(): boolean {
  const ui = Office.context?.ui;
  return !(!ui || typeof ui.displayDialogAsync !== "function");
}

/**
 * Opens a dialog page. The pane's handlers get: the open failure's error (as
 * Office reported it), each message with the dialog (so it can close it), and
 * the user closing the window.
 */
export function openDialog(url: string, opts: { height: number; width: number }, h: DialogHandlers): void {
  Office.context.ui.displayDialogAsync(url, opts, (result) => {
    if (result.status !== Office.AsyncResultStatus.Succeeded) {
      h.failed(result.error);
      return;
    }
    const dialog = result.value;
    // Sending to the page needs DialogApi 1.2; asked only when a pane actually sends.
    const handle = {
      close: (): void => dialog.close(),
      messageChild: (message: string): boolean => {
        if (Office.context.requirements.isSetSupported("DialogApi", "1.2") !== true || typeof dialog.messageChild !== "function") return false;
        dialog.messageChild(message);
        return true;
      },
    };
    dialog.addEventHandler(Office.EventType.DialogMessageReceived, (arg) => h.message(arg, handle));
    // The user closing the dialog window (X) arrives here.
    dialog.addEventHandler(Office.EventType.DialogEventReceived, () => h.closed());
  });
}
