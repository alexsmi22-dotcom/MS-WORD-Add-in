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

    // 2b. The Home audience filter. It must narrow the CARDS without ever making
    // a tool unreachable — the dropdown stays complete, and it is reversible.
    sel.value = "home";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    var chip = function (t) {
      var c = [].slice.call(document.querySelectorAll(".home-chip")).filter(function (x) {
        return x.textContent.indexOf(t) >= 0;
      })[0];
      if (c) c.click();
    };
    var cardModes = function () {
      return [].slice.call(document.querySelectorAll(".home-card")).map(function (c) {
        return c.dataset.mode;
      });
    };
    out.push("FILTER_DEFAULT=" + cardModes().length);
    chip("Science");
    var sci = cardModes();
    out.push("FILTER_SCIENCE=" + sci.length + " citations=" + (sci.indexOf("citations") >= 0) + " spectra=" + (sci.indexOf("spectra") >= 0) + " math=" + (sci.indexOf("math") >= 0) + " sequence=" + (sci.indexOf("sequence") >= 0));
    chip("Patent");
    var leg = cardModes();
    out.push("FILTER_LEGAL=" + leg.length + " citations=" + (leg.indexOf("citations") >= 0) + " spectra=" + (leg.indexOf("spectra") >= 0) + " sequence=" + (leg.indexOf("sequence") >= 0));
    out.push("FILTER_DROPDOWN=" + document.querySelectorAll("#mode-select option").length);
    chip("All tools");
    out.push("FILTER_RESTORED=" + cardModes().length);


    // 2c. Sequence Map: a GenBank record must parse, draw, and enable insert;
    // junk must refuse rather than offer a bad figure.
    sel.value = "seqmap";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    var gbLines = [
      "LOCUS       pPROBE                   600 bp    DNA     circular SYN 15-JUL-2026",
      "FEATURES             Location/Qualifiers",
      "     promoter        1..100",
      '                     /label="T7 promoter"',
      "     CDS             complement(201..400)",
      '                     /gene="probeG"',
      "ORIGIN",
      "        1 " + new Array(151).join("acgt"),
      "//",
    ];
    var ta = document.getElementById("seqmap-input");
    ta.value = gbLines.join(String.fromCharCode(10));
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    out.push(
      "SEQMAP_GB svg=" + document.querySelectorAll("#seqmap-preview svg").length +
      " paths=" + document.querySelectorAll("#seqmap-preview path").length +
      " insert=" + !document.getElementById("seqmap-insert").disabled +
      " file=" + !!document.getElementById("seqmap-file")
    );
    // Auto must follow the record's own topology: a plasmid is a ring, and a
    // ring drawn from a linear record misrepresents the construct.
    var sm = document.querySelector("#seqmap-preview svg");
    out.push("SEQMAP_AUTO_CIRC circles=" + (sm ? sm.querySelectorAll("circle").length : -1) + " w=" + (sm ? sm.getAttribute("width") : "?"));
    ta.value = gbLines.join(String.fromCharCode(10)).replace("circular", "linear  ");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    sm = document.querySelector("#seqmap-preview svg");
    out.push("SEQMAP_AUTO_LIN circles=" + (sm ? sm.querySelectorAll("circle").length : -1));

    ta.value = "%PDF-1.4 junk";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    out.push("SEQMAP_JUNK insert=" + !document.getElementById("seqmap-insert").disabled);
    ta.value = "";
    ta.dispatchEvent(new Event("input", { bubbles: true }));

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
