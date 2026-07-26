/* eslint-disable no-undef */
// Reports horizontal overflow in the task pane, per mode, at a given width.
//
// Word gives a task pane roughly 320-450 CSS px and the user can drag it
// narrower. Anything wider than the viewport is simply unreachable: the pane
// scrolls vertically, so a clipped right-hand column is invisible, not scrollable
// to. Nothing measured this, which is how a two-column tile grid came to run off
// the edge at 360px.
//
// Loaded into the pane harness; writes its findings into #PANE-LAYOUT.
(function () {
  function boot() {
    if (window.__officeCb) window.__officeCb({ host: "Word" });
  }

  /** Elements whose painted box extends past the viewport's right edge. */
  function overflowing(limit) {
    const bad = [];
    const all = document.querySelectorAll("body *");
    for (const el of all) {
      if (!el.offsetParent && el !== document.body) continue; // hidden
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // 1px of tolerance for sub-pixel rounding and borders.
      if (r.right > limit + 1) {
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        bad.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || "").toString().slice(0, 60),
          id: el.id || "",
          right: Math.round(r.right),
          text: (el.textContent || "").trim().slice(0, 40),
        });
      }
    }
    return bad;
  }

  function run() {
    const out = [];
    const width = document.documentElement.clientWidth;
    const sel = document.getElementById("mode-select");
    const modes = sel
      ? [...sel.querySelectorAll("option")].map((o) => o.value)
      : ["home"];

    for (const mode of modes) {
      if (sel) {
        sel.value = mode;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const docScroll = document.documentElement.scrollWidth;
      const bad = overflowing(width);
      if (docScroll > width + 1 || bad.length) {
        // Report only the outermost offenders: a clipped parent drags its
        // children along, and listing all of them buries the cause.
        const seen = new Set();
        const top = bad.filter((b) => {
          const key = b.cls || b.tag;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        out.push(
          `${mode}: scrollWidth=${docScroll} viewport=${width}` +
            top.slice(0, 6).map((b) => `\n    <${b.tag} class="${b.cls}"> right=${b.right} "${b.text}"`).join(""),
        );
      }
    }

    const pre = document.createElement("pre");
    pre.id = "PANE-LAYOUT";
    pre.textContent = out.length ? out.join("\n") : "CLEAN";
    document.body.appendChild(pre);
    document.title = "DONE";
  }

  boot();
  setTimeout(run, 500);
})();
