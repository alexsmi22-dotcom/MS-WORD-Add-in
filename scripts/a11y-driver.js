/* eslint-disable no-undef */
// In-page driver for scripts/a11y-check.js: runs axe-core over Home and every tool, in the light AND the dark theme
// (data-theme on <html> — the pane's own override — so the PC's theme never decides what is checked), and writes one
// line per violation into data-a11y on <body>. A canary runs first: axe must flag an <img> with no alt, or the gate
// reports itself broken instead of passing on a check that never ran.
(async function () {
  var out = [];
  var RULES = { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations", "incomplete"] };
  // axe reports a labelled <div> without a role as a VIOLATION only while it is empty; with children it is "needs
  // review" — and the gate passed over three such divs (review). These rule ids fail the gate in either list.
  var STRICT_INCOMPLETE = { "aria-prohibited-attr": true };
  try {
    window.__officeCb({ host: "Word" });

    var canary = document.createElement("img");
    canary.src = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    canary.id = "a11y-canary";
    document.body.appendChild(canary);
    var c = await axe.run("#a11y-canary", { runOnly: { type: "rule", values: ["image-alt"] } });
    out.push("CANARY " + (c.violations.length === 1 ? "ok" : "MISSED"));
    canary.remove();

    var sel = document.getElementById("mode-select");
    var modes = [].slice.call(sel.querySelectorAll("option")).map(function (o) {
      return o.value;
    });
    var checked = 0;
    var themes = ["light", "dark"];
    for (var t = 0; t < themes.length; t++) {
      document.documentElement.setAttribute("data-theme", themes[t]);
      for (var i = 0; i < modes.length; i++) {
        sel.value = modes[i];
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        // The pane re-applies its own theme on some changes: set the one under test again, and check it held.
        document.documentElement.setAttribute("data-theme", themes[t]);
        if (document.documentElement.getAttribute("data-theme") !== themes[t]) out.push("ERROR theme " + themes[t] + " did not hold in " + modes[i]);
        var r = await axe.run(document, RULES);
        checked++;
        r.violations.concat(r.incomplete.filter(function (v) { return STRICT_INCOMPLETE[v.id]; })).forEach(function (v) {
          var where = v.nodes
            .slice(0, 3)
            .map(function (n) {
              var d = v.id === "color-contrast" && n.any[0] && n.any[0].data;
              return n.target.join(" ") + (d ? " (" + d.fgColor + " on " + d.bgColor + ", " + d.contrastRatio + ":1)" : "");
            })
            .join(" ; ");
          out.push("VIOLATION\t" + themes[t] + "\t" + modes[i] + "\t" + v.id + "\t" + v.impact + "\t" + v.nodes.length + "\t" + where);
        });
      }
    }
    out.push("CHECKED " + checked + " modes=" + modes.length);
  } catch (e) {
    out.push("ERROR " + (e && e.message));
  }
  document.body.setAttribute("data-a11y", out.join(" ||| "));
})();
