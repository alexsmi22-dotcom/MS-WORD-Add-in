/* global Office */

// Host for function-backed ribbon commands. The "Insert Formula" button opens
// the task pane via the manifest's ShowTaskpane action, so no custom command is
// strictly required yet — this file exists so the manifest's command surface has
// a valid runtime, and is where future one-click commands would be registered.

Office.onReady(() => {
  // No-op: the ribbon button shows the task pane directly.
});
