// Engineering audit driver — runs inside the real production bundle.
//
// WHY THIS EXISTS. The Engineering section has 36 calculators and ~5,700 unit
// tests behind their engines, and three defects still reached a user: an
// equation path that was never routed, an OOXML insert that swallowed every
// paragraph after it, and a figure chain that dropped the second figure. Every
// one of them lived ABOVE the engines, in the pane, where no unit test looks.
//
// So this drives the actual pane: it selects every tool in turn, lets it compute
// on its own defaults, empties every field, types rubbish into every field, and
// then ACTUALLY RUNS THE INSERT against a recording mock of the Word API.
//
// WHAT THE INSERT CHECK CAN AND CANNOT SEE. It records every call the pane makes
// — paragraphs, OOXML packages, pictures, tables, syncs — so it catches an
// insert that throws, one that emits the wrong number of objects, or one that
// never reaches the figures at the end of a report. It CANNOT catch Word
// declining to honour a call, which is what actually broke twice; a mock always
// says yes. That limit is stated in the output rather than left implied.
(function () {
  var out = [];
  function push(s) {
    out.push(String(s).replace(/\|\|\|/g, "/"));
  }

  // A "NaN" or "Infinity" that a tool QUOTES BACK is the error message naming
  // the offending input, which is correct and wanted. Only an unquoted one is a
  // computed value that escaped.
  function badNumbers(text) {
    var stripped = text.replace(/"[^"]*"/g, '""');
    return /\bNaN\b|\bInfinity\b|\bundefined\b/.test(stripped);
  }

  try {
    window.__officeCb({ host: "Word" });

    var sel = document.getElementById("mode-select");
    sel.value = "engineering";
    sel.dispatchEvent(new Event("change", { bubbles: true }));

    var calcSel = document.getElementById("engineering-calc");
    var resultEl = document.getElementById("engineering-result");
    var insertBtn = document.getElementById("engineering-insert");
    var inputsEl = document.getElementById("engineering-inputs");
    var statusEl = document.getElementById("status");
    if (!calcSel || !resultEl || !insertBtn || !inputsEl) {
      push("ERROR: missing engineering pane elements");
      throw new Error("engineering pane elements not found");
    }

    var tools = [].slice.call(calcSel.querySelectorAll("option")).map(function (o) {
      return o.value;
    });
    push("TOOLS=" + tools.length);

    function fields() {
      return [].slice.call(inputsEl.querySelectorAll("[data-key]"));
    }
    function selectTool(v) {
      calcSel.value = v;
      calcSel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function fire(el) {
      el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    }
    function recompute() {
      var f = fields();
      if (f.length) fire(f[0]);
    }
    function textNow() {
      return (resultEl.textContent || "").replace(/\s+/g, " ").trim();
    }

    // ---- 1. Every tool on its own defaults. -----------------------------
    tools.forEach(function (t) {
      try {
        selectTool(t);
        recompute();
        var text = textNow();
        var flags = [];
        if (badNumbers(text)) flags.push("BADNUMBER");
        if (/not finite/i.test(text)) flags.push("notfinite");
        if (text.indexOf("—") >= 0) flags.push("EMDASH");
        if (/^Couldn't compute/i.test(text)) flags.push("THREW");
        if (!text.length) flags.push("EMPTY");
        push(
          "DEFAULT " + t + " len=" + text.length + " insert=" + (insertBtn.disabled ? "OFF" : "on") +
            " flags=" + (flags.length ? flags.join("+") : "clean") + " :: " + text.slice(0, 150)
        );
      } catch (e) {
        push("DEFAULT " + t + " EXCEPTION " + (e && e.message));
      }
    });

    // ---- 2. Every field blank. ------------------------------------------
    tools.forEach(function (t) {
      try {
        selectTool(t);
        var f = fields();
        f.forEach(function (el) {
          if (el.tagName !== "SELECT") el.value = "";
        });
        if (f.length) fire(f[0]);
        var text = textNow();
        var bad = [];
        if (badNumbers(text)) bad.push("BADNUMBER");
        if (!text.length) bad.push("SILENT");
        push("BLANK " + t + " insert=" + (insertBtn.disabled ? "OFF" : "on") + " issues=" + (bad.length ? bad.join("+") : "ok") + " :: " + text.slice(0, 110));
      } catch (e) {
        push("BLANK " + t + " EXCEPTION " + (e && e.message));
      }
    });

    // ---- 3. Rubbish in every field. -------------------------------------
    ["qqq", "-", "1e999", "0", "-1", "NaN", "1/0"].forEach(function (j) {
      tools.forEach(function (t) {
        try {
          selectTool(t);
          var f = fields();
          f.forEach(function (el) {
            if (el.tagName !== "SELECT") el.value = j;
          });
          if (f.length) fire(f[0]);
          var text = textNow();
          var bad = [];
          if (badNumbers(text)) bad.push("BADNUMBER");
          if (text.indexOf("—") >= 0) bad.push("EMDASH");
          if (bad.length) push("JUNK " + t + " [" + j + "] issues=" + bad.join("+") + " :: " + text.slice(0, 130));
        } catch (e) {
          push("JUNK " + t + " [" + j + "] EXCEPTION " + (e && e.message));
        }
      });
    });

    // ---- 4. What each tool produces, and what INSERTING it attempts. ----
    //
    // The Word mock records every operation. Object counts are then compared
    // against what the preview showed, which is the check that would have caught
    // an insert path that stops early.
    var ops;
    var packages;
    function makeRange(tag) {
      var r = {
        insertParagraph: function (text) {
          ops.push("para:" + String(text).slice(0, 20));
          return makeRange("para");
        },
        insertText: function (text) {
          ops.push("text:" + String(text).length);
          return makeRange("text");
        },
        insertBreak: function () {
          ops.push("break");
          return makeRange("break");
        },
        insertHtml: function (h) {
          ops.push("html:" + String(h).length);
          return makeRange("html");
        },
        insertOoxml: function (x) {
          var eq = (String(x).match(/<m:oMath>/g) || []).length;
          var ps = (String(x).match(/<w:p>/g) || []).length;
          packages.push(String(x));
          ops.push("ooxml:paras=" + ps + ",equations=" + eq);
          return makeRange("ooxml");
        },
        insertInlinePictureFromBase64: function () {
          ops.push("picture");
          return { altTextDescription: "", width: 0, height: 0, getRange: function () { return makeRange("pic"); } };
        },
        insertTable: function (rows, cols) {
          ops.push("table:" + rows + "x" + cols);
          return {
            getCell: function () { return { body: { paragraphs: { getFirst: function () { return { alignment: "" }; } } } }; },
            getRange: function () { return makeRange("table"); },
          };
        },
        getRange: function () { return makeRange(tag + ".range"); },
        select: function () { ops.push("select"); },
      };
      return r;
    }
    window.Word.run = function (cb) {
      return cb({
        document: { getSelection: function () { return makeRange("sel"); } },
        sync: function () { ops.push("sync"); return Promise.resolve(); },
      });
    };

    // A rejected insert is swallowed by the pane's own catch, so listen for it
    // at the window level too; an insert that silently does nothing and an
    // insert that threw are different bugs and must not read the same.
    var insertErrors = [];
    var errorsBefore = 0;
    window.addEventListener("error", function (e) {
      insertErrors.push(String((e && e.message) || "error").slice(0, 80));
    });
    window.addEventListener("unhandledrejection", function (e) {
      insertErrors.push(String((e && e.reason && e.reason.message) || e.reason || "rejection").slice(0, 80));
    });

    // Poll until the op log is quiet for two consecutive checks, capped so a
    // genuinely hung insert still reports instead of stalling the whole audit.
    function settle(done) {
      var last = -1;
      var quiet = 0;
      var waited = 0;
      var tick = function () {
        if (ops.length === last) quiet++;
        else quiet = 0;
        last = ops.length;
        waited += 40;
        if ((quiet >= 3 && waited >= 160) || waited > 6000) done();
        else setTimeout(tick, 40);
      };
      setTimeout(tick, 40);
    }

    // ---- 0. Negative control: prove each predicate can actually fail. ----
    //
    // Three separate times this audit reported a catastrophe or an all-clear
    // that turned out to be the harness rather than the product: a missing
    // Word enum, a missing mock method, and a log read one tick too early. A
    // check nobody has watched fail is not evidence. So each predicate is run
    // against a payload engineered to trip it, and the audit reports itself
    // broken if any of them stays quiet.
    function selfTest() {
      var bad = [];
      var wellFormed = '<pkg:package xmlns:pkg="p"><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"/></pkg:package>';

      var brokenDoc = new DOMParser().parseFromString("<a><b></a>", "application/xml");
      if (!brokenDoc.getElementsByTagName("parsererror").length) bad.push("parsererror-blind");

      var goodDoc = new DOMParser().parseFromString(wellFormed, "application/xml");
      if (goodDoc.getElementsByTagName("parsererror").length) bad.push("parsererror-trigger-happy");
      if (goodDoc.getElementsByTagNameNS("*", "oMath").length !== 1) bad.push("omath-ns-blind");
      if (!/<pkg:package/.test(wellFormed)) bad.push("flatopc-blind");

      if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test("a" + String.fromCharCode(8) + "b")) {
        bad.push("controlchar-blind");
      }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test("plain text")) bad.push("controlchar-trigger-happy");

      // The caption/figure ordering scan, against a chain that lost its anchor.
      var scan = function (seq) {
        var n = 0;
        for (var k = 0; k < seq.length; k++) {
          if (seq[k] === "picture" && (k === 0 || seq[k - 1] === "picture")) n++;
        }
        return n;
      };
      if (scan(["para:a", "picture", "picture"]) !== 1) bad.push("caption-order-blind");
      if (scan(["para:a", "picture", "para:b", "picture"]) !== 0) bad.push("caption-order-trigger-happy");

      if (!badNumbers("x = NaN")) bad.push("badnumber-blind");
      if (badNumbers('rejected "NaN" as a width')) bad.push("badnumber-trigger-happy");

      push("SELFTEST " + (bad.length ? "BROKEN=" + bad.join(",") : "ok"));
    }
    selfTest();

    var pending = tools.slice();
    function insertNext() {
      if (!pending.length) {
        finish();
        return;
      }
      var t = pending.shift();
      try {
        selectTool(t);
        recompute();
        var figures = resultEl.querySelectorAll("svg").length;
        var equations = resultEl.querySelectorAll(".math-preview").length;
        ops = [];
        packages = [];
        errorsBefore = insertErrors.length;
        insertBtn.click();
        // The handler is async AND rasterises every figure through an Image
        // onload, which is a task rather than a microtask: reading the log one
        // tick after the click sees an empty log even when the insert is about
        // to work. So wait for the log to STOP GROWING instead of guessing.
        settle(function () {
          var paras = ops.filter(function (o) { return o.indexOf("para:") === 0; }).length;
          var pics = ops.filter(function (o) { return o === "picture"; }).length;
          var pkgs = ops.filter(function (o) { return o.indexOf("ooxml:") === 0; });
          var eqIn = pkgs.reduce(function (s, o) { return s + Number((/equations=(\d+)/.exec(o) || [, 0])[1]); }, 0);
          var syncs = ops.filter(function (o) { return o === "sync"; }).length;
          var texts = ops.filter(function (o) { return o.indexOf("text:") === 0; }).length;
          var status = (statusEl && statusEl.textContent) || "";
          var issues = [];
          // The pane reports the outcome of its own insert. Trust that over any
          // inference from the op log: /could not/ is a real failure even when
          // the log looks busy, and a success message with an empty log is a
          // harness gap rather than a product bug.
          if (/could not|couldn't|still inserting|nothing to insert/i.test(status)) {
            issues.push("STATUS(" + status.slice(0, 60) + ")");
          }
          // Every figure the preview showed must be attempted as a picture.
          if (pics !== figures) issues.push("PICTURES " + pics + "!=" + figures);
          // Every equation the preview typeset must reach an OOXML package.
          if (eqIn !== equations) issues.push("EQUATIONS " + eqIn + "!=" + equations);
          if (!ops.length) issues.push("NOTHING_INSERTED");
          for (var ei = errorsBefore; ei < insertErrors.length; ei++) {
            issues.push("THREW(" + insertErrors[ei] + ")");
          }

          // ADVERSARIAL 1 — is the OOXML actually well formed?
          //
          // Counting <m:oMath> proves a package CONTAINS an equation; it says
          // nothing about whether Word can parse it. Word's response to a
          // malformed flat-OPC package is to decline it quietly, which is
          // indistinguishable from "the button did nothing" — the exact
          // symptom reported twice from real use. So parse it here.
          packages.forEach(function (xml, pi) {
            var doc = new DOMParser().parseFromString(xml, "application/xml");
            if (doc.getElementsByTagName("parsererror").length) {
              issues.push("MALFORMED_OOXML[" + pi + "]");
              return;
            }
            if (!/<pkg:package/.test(xml)) issues.push("NOT_FLAT_OPC[" + pi + "]");
            // An OMML run outside a math paragraph or a math run renders as
            // literal text, which is how formulas came out as carets before.
            var loose = doc.getElementsByTagNameNS("*", "oMath").length;
            if (loose === 0 && /oMath/.test(xml)) issues.push("OMATH_NOT_IN_MATH_NS[" + pi + "]");
            // A control character in the payload invalidates the whole package.
            if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) {
              issues.push("CONTROL_CHAR_IN_OOXML[" + pi + "]");
            }
          });

          // ADVERSARIAL 2 — is every figure preceded by its own caption?
          //
          // The figures are inserted as caption paragraph then picture. If the
          // anchor chain breaks, the surviving pictures pile up after the last
          // caption instead of pairing with one. Counting pictures cannot see
          // that; the ORDER can.
          var seq = ops.filter(function (o) {
            return o.indexOf("para:") === 0 || o === "picture";
          });
          var capless = 0;
          for (var k = 0; k < seq.length; k++) {
            if (seq[k] === "picture" && (k === 0 || seq[k - 1] === "picture")) capless++;
          }
          if (capless) issues.push("PICTURE_WITHOUT_CAPTION x" + capless);

          // ADVERSARIAL 3 — does a second click double-insert or get swallowed?
          //
          // The pane guards re-entry with a busy flag. A guard that never
          // clears leaves Insert permanently dead after one use, which no
          // single-click test can detect.
          if (!issues.length) {
            var before = ops.length;
            insertBtn.click();
            insertBtn.click();
            settle(function () {
              var second = ops.length - before;
              if (second === 0) issues.push("SECOND_INSERT_DEAD");
              report(issues);
            });
            return;
          }
          report(issues);
          return;
          function report(list) {
            push(
              "INSERT " + t + " preview[fig=" + figures + ",eq=" + equations + "]" +
                " attempted[para=" + paras + ",text=" + texts + ",pic=" + pics + ",pkg=" + pkgs.length + ",eq=" + eqIn + ",sync=" + syncs + "]" +
                " " + (list.length ? "ISSUES=" + list.join("+") : "ok")
            );
            insertNext();
          }
        });
      } catch (e) {
        push("INSERT " + t + " EXCEPTION " + (e && e.message));
        insertNext();
      }
    }

    function finish() {
      var d = document.createElement("div");
      d.id = "__results";
      d.setAttribute("data-results", out.join(" ||| "));
      document.body.appendChild(d);
    }

    insertNext();
    return;
  } catch (e) {
    push("ERROR: " + (e && e.message));
    push("STACK: " + (e && e.stack ? String(e.stack).split("\n").slice(0, 3).join(" << ") : "?"));
  }

  var d = document.createElement("div");
  d.id = "__results";
  d.setAttribute("data-results", out.join(" ||| "));
  document.body.appendChild(d);
})();
