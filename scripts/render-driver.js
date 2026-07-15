// Headless render driver. Boots the real pane bundle against a stubbed Office,
// then drives every mode and reports what actually renders. Chromium here is the
// same engine as Word's WebView2, so this exercises the real rendering path.
(function () {
  var out = [];
  function vis(el) {
    return !!el && getComputedStyle(el).display !== "none";
  }
  try {
    window.__officeCb({ host: "Word" });

    var sel = document.getElementById("mode-select");
    var sections = [].slice.call(document.querySelectorAll("main > section"));
    var modes = [].slice.call(sel.querySelectorAll("option")).map(function (o) {
      return o.value;
    });
    out.push("BOOTED sections=" + sections.length + " modes=" + modes.length);

    // 1. Home must show ONLY the tiles — this is the bug the user found.
    var leaks = sections
      .filter(function (s) {
        return s.id !== "home-section" && vis(s);
      })
      .map(function (s) {
        return s.id;
      });
    out.push("HOME_LEAKS=" + (leaks.length ? leaks.join(",") : "none"));
    out.push("HOME_TILES=" + document.querySelectorAll("#home-groups button, #home-groups .home-card").length);

    // 2. Every mode: exactly its own section, and help content present.
    modes.forEach(function (m) {
      sel.value = m;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      var shown = sections.filter(vis).map(function (s) {
        return s.id;
      });
      var ex = document.getElementById("examples-body");
      var exLen = ex ? ex.innerHTML.trim().length : -1;
      out.push("MODE " + m + " shown=" + (shown.join("+") || "NONE") + " examples=" + exLen);
    });

    // 3. Spectra must actually compute and show its caveat.
    sel.value = "spectra";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    var si = document.getElementById("spec-input");
    si.value = "toluene";
    si.dispatchEvent(new Event("input", { bubbles: true }));
    var sr = document.getElementById("spec-result");
    out.push("SPECTRA_ROWS=" + sr.querySelectorAll(".spec-row").length);
    out.push("SPECTRA_HAS_CAVEAT=" + /verify|estimate/i.test(sr.textContent));
    out.push("SPECTRA_SNIPPET=" + sr.textContent.replace(/\s+/g, " ").slice(0, 120));

    // 4. Analyze / ODE must solve the new default (y'' = -y) end to end.
    sel.value = "analyze";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    var calc = document.getElementById("analyze-calc");
    calc.value = "ode";
    calc.dispatchEvent(new Event("change", { bubbles: true }));
    var res = document.getElementById("analyze-result");
    out.push("ODE_TEXT=" + res.textContent.replace(/\s+/g, " ").slice(0, 150));

    // 5. Chemical preview must render a real structure.
    sel.value = "chemical";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    var inp = document.getElementById("formula-input");
    inp.value = "H2O";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    out.push("CHEM_PREVIEW=" + (document.getElementById("preview") || { innerHTML: "?" }).innerHTML.slice(0, 80));
  } catch (e) {
    out.push("ERROR: " + (e && e.message));
    out.push("STACK: " + (e && e.stack ? String(e.stack).split("\n").slice(0, 3).join(" << ") : "?"));
  }
  var d = document.createElement("div");
  d.id = "__results";
  d.setAttribute("data-results", out.join(" ||| "));
  document.body.appendChild(d);
})();
