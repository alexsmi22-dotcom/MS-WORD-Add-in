/* eslint-disable no-undef */
// Pane audit driver — the Engineering audit's loop, aimed at the other four
// calculator registries. Runs inside the real production bundle.
//
// WHY THIS EXISTS. `engineering-audit-driver.js` drives 130 calculators through
// their defaults, their dropdown options, an emptied form, rubbish input and a
// real insert against a recording Word mock — and it does `sel.value =
// "engineering"` at line 37 and iterates `#engineering-calc` only. Statistics,
// Analyze, Bio/Assay and Finance are 84 more calculators with no equivalent.
// GAP-ANALYSIS-2026-08-05 §1.1 is blunt about what covers them: "essentially
// nothing".
//
// So this is the same instrument pointed at the rest of the product. The four
// registries share a DOM contract — `<mode>-calc`, `<mode>-inputs`,
// `<mode>-result`, `<mode>-insert` — which is what makes one driver possible.
//
// SCOPE, DELIBERATELY. Engineering keeps its own driver and is NOT re-driven
// here: it has discipline panels, an <optgroup> menu and a re-entry check that
// none of these four have, and duplicating its 130-tool loop would double the
// slowest gate in the repo to prove something already proven.
//
// WHAT THE INSERT CHECK CAN AND CANNOT SEE — unchanged from the Engineering
// driver, and worth restating rather than assuming: it records every call the
// pane makes, so it catches an insert that throws, that emits the wrong number
// of objects, or that never reaches the figures at the end of a report. It
// CANNOT catch Word declining to honour a call. A mock always says yes.
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

  // Control characters invalidate a whole OOXML package, so this has to be
  // detected — but the OBVIOUS way to write it is a character-class regex full
  // of backslash escapes, and this repo has already shipped a bug where exactly
  // those escapes were eaten on the way into the file and became LITERAL
  // control characters. The regex still compiled, still linted clean, and could
  // never match what it was written to catch.
  //
  // The first draft of THIS FILE reproduced it: twelve literal control
  // characters landed in the source. So the check carries no escapes at all.
  // Code points, compared as numbers, cannot be mangled by whatever writes the
  // file.
  function hasControlChar(s) {
    var str = String(s);
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      // Tab (9), LF (10) and CR (13) are legal in XML; everything below 32 and
      // the DEL range are not.
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) return true;
    }
    return false;
  }

  // The registries, in the order the campaign works through them.
  //
  // `figureHost` is separate from `result` because Bio/Assay renders its fit
  // plot into its own `#assay-preview` div rather than into the result block.
  // Counting SVGs in the result element alone would report every Assay figure
  // as missing — a harness fault that reads exactly like a product one, which
  // this repo has now paid for three times.
  var REGISTRIES = [
    { mode: "stats", label: "Statistics", calc: "stats-calc", inputs: "stats-inputs", result: "stats-result", insert: "stats-insert" },
    { mode: "analyze", label: "Analyze", calc: "analyze-calc", inputs: "analyze-inputs", result: "analyze-result", insert: "analyze-insert" },
    { mode: "assay", label: "Bio/Assay", calc: "assay-calc", inputs: "assay-inputs", result: "assay-result", insert: "assay-insert", figureHost: "assay-preview" },
    { mode: "finance", label: "Finance", calc: "fin-calc", inputs: "fin-inputs", result: "fin-result", insert: "fin-insert" },
  ];

  try {
    window.__officeCb({ host: "Word" });

    var modeSel = document.getElementById("mode-select");
    var statusEl = document.getElementById("status");

    // ---- The recording Word mock. ---------------------------------------
    var ops;
    var packages;
    function makeRange(tag) {
      return {
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
    }
    window.Word.run = function (cb) {
      return cb({
        document: {
          getSelection: function () { return makeRange("sel"); },
          body: {
            inlinePictures: {
              items: [],
              load: function () {
                this.items = ops.filter(function (o) { return o === "picture"; }).map(function () { return {}; });
              },
            },
          },
        },
        sync: function () { ops.push("sync"); return Promise.resolve(); },
      });
    };

    // A rejected insert is swallowed by the pane's own catch, so listen at the
    // window level too; an insert that silently does nothing and one that threw
    // are different bugs and must not read the same.
    var insertErrors = [];
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
    // Three separate times the Engineering audit reported a catastrophe or an
    // all-clear that turned out to be the harness rather than the product: a
    // missing Word enum, a missing mock method, and a log read one tick too
    // early. A check nobody has watched fail is not evidence.
    function selfTest() {
      var bad = [];
      var wellFormed = '<pkg:package xmlns:pkg="p"><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"/></pkg:package>';

      var brokenDoc = new DOMParser().parseFromString("<a><b></a>", "application/xml");
      if (!brokenDoc.getElementsByTagName("parsererror").length) bad.push("parsererror-blind");
      var goodDoc = new DOMParser().parseFromString(wellFormed, "application/xml");
      if (goodDoc.getElementsByTagName("parsererror").length) bad.push("parsererror-trigger-happy");
      if (goodDoc.getElementsByTagNameNS("*", "oMath").length !== 1) bad.push("omath-ns-blind");

      if (!badNumbers("x = NaN")) bad.push("badnumber-blind");
      if (badNumbers('rejected "NaN" as a width')) bad.push("badnumber-trigger-happy");
      if (!hasControlChar("a" + String.fromCharCode(8) + "b")) {
        bad.push("controlchar-blind");
      }

      // THE FIGURE COUNTER IS THE POINT OF THIS AUDIT, so it gets a negative
      // control of its own. A counter that reads 0 for everything would report
      // the entire campaign as unfinished forever; one that reads >0 for
      // everything would report it as finished on day one. Both are silent.
      var roots = function (host) {
        return [].slice.call(host.querySelectorAll("svg")).filter(function (el) {
          return !(el.parentNode && el.parentNode.closest && el.parentNode.closest("svg"));
        }).length;
      };
      var probe = document.createElement("div");
      probe.innerHTML = '<svg width="10" height="10"><text>x</text></svg>';
      if (roots(probe) !== 1) bad.push("figure-counter-blind");
      var empty = document.createElement("div");
      empty.innerHTML = "<p>no figure here</p>";
      if (roots(empty) !== 0) bad.push("figure-counter-trigger-happy");
      // THE NESTED CASE, which is the one that actually went wrong: a
      // combineSvgs-style stack is three <svg> tags and ONE figure.
      var stacked = document.createElement("div");
      stacked.innerHTML =
        '<svg width="20" height="20"><svg width="10" height="10"><text>a</text></svg>' +
        '<svg width="10" height="10"><text>b</text></svg></svg>';
      if (stacked.querySelectorAll("svg").length !== 3) bad.push("figure-counter-nesting-assumption-wrong");
      if (roots(stacked) !== 1) bad.push("figure-counter-counts-nested-panels");

      push("SELFTEST " + (bad.length ? "BROKEN=" + bad.join(",") : "ok"));
    }
    selfTest();

    // ---- The per-registry loop. -----------------------------------------
    var queue = REGISTRIES.slice();

    function nextRegistry() {
      if (!queue.length) {
        finish();
        return;
      }
      var reg = queue.shift();

      modeSel.value = reg.mode;
      modeSel.dispatchEvent(new Event("change", { bubbles: true }));

      var calcSel = document.getElementById(reg.calc);
      var resultEl = document.getElementById(reg.result);
      var insertBtn = document.getElementById(reg.insert);
      var inputsEl = document.getElementById(reg.inputs);
      var figureEl = reg.figureHost ? document.getElementById(reg.figureHost) : null;

      if (!calcSel || !resultEl || !insertBtn || !inputsEl) {
        push("REGISTRY " + reg.mode + " BROKEN missing pane elements");
        nextRegistry();
        return;
      }

      var tools = [].slice.call(calcSel.querySelectorAll("option")).map(function (o) { return o.value; });
      push("REGISTRY " + reg.mode + " label=" + reg.label + " tools=" + tools.length);
      if (!tools.length) {
        push("REGISTRY " + reg.mode + " BROKEN the menu is empty, so every check below is vacuous");
        nextRegistry();
        return;
      }

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
      // Figures can land in the result block or, for Assay, in a preview div
      // beside it. Both count; neither is assumed.
      //
      // ONLY TOP-LEVEL <svg> ELEMENTS COUNT, and this cost a false alarm on the
      // very first run. `combineSvgs` (plot.ts:427) stacks a multi-panel figure
      // by NESTING each child <svg> inside one outer <svg> — so the regression
      // diagnostics are five <svg> tags and exactly one picture. A naive
      // querySelectorAll("svg") read that as "the preview showed 5 figures and
      // the insert delivered 1" and reported a insert-path defect in code that
      // is correct.
      //
      // A harness reports itself first. What is wanted is the number of
      // INDEPENDENT figures, which is the number of svg roots with no svg
      // ancestor.
      function countRoots(host) {
        if (!host) return 0;
        return [].slice.call(host.querySelectorAll("svg")).filter(function (el) {
          return !(el.parentNode && el.parentNode.closest && el.parentNode.closest("svg"));
        }).length;
      }
      function figuresNow() {
        return countRoots(resultEl) + countRoots(figureEl);
      }

      // ---- 1. Every tool on its own defaults. ---------------------------
      tools.forEach(function (t) {
        try {
          selectTool(t);
          recompute();
          var text = textNow();
          var flags = [];
          if (badNumbers(text)) flags.push("BADNUMBER");
          if (/not finite/i.test(text)) flags.push("notfinite");
          if (/^Couldn't compute/i.test(text)) flags.push("THREW");
          if (!text.length) flags.push("EMPTY");
          // AN EM DASH IS REPORTED, BUT IT IS NOT A FINDING ON ITS OWN.
          //
          // It matters only when it reaches the pane's "not computable"
          // sentinel scan and kills the Insert button — and whether it does
          // depends on WHERE it sits. Finance appends its `assumes:` disclosure
          // AFTER the insertability decision is made, so five Finance tools
          // carry an em dash and insert perfectly well.
          //
          // Flagging those as defects would be a gate crying wolf, and a gate
          // that cries wolf gets switched off. The INSERT pass below measures
          // the actual consequence (NOTHING_INSERTED), so that is the gate and
          // this is the diagnostic that explains it.
          if (text.indexOf("—") >= 0) flags.push("note:emdash");
          push(
            "DEFAULT " + reg.mode + " " + t + " len=" + text.length + " fig=" + figuresNow() +
              " insert=" + (insertBtn.disabled ? "OFF" : "on") +
              " flags=" + (flags.length ? flags.join("+") : "clean") + " :: " + text.slice(0, 150)
          );
        } catch (e) {
          push("DEFAULT " + reg.mode + " " + t + " EXCEPTION " + (e && e.message));
        }
      });

      // ---- 1b. Every non-default select option. -------------------------
      //
      // Pass 1 only ever exercises a dropdown at whatever it opens on. A select
      // is how these registries offer alternative MODELS — a tail, a variance
      // assumption, a day-count convention — and each is a path pass 1 never
      // enters. One option at a time, everything else at its default, so a
      // failure names the choice that caused it.
      tools.forEach(function (t) {
        try {
          selectTool(t);
          var sels = fields().filter(function (el) { return el.tagName === "SELECT"; });
          sels.forEach(function (s) {
            var key = s.getAttribute("data-key");
            var original = s.value;
            var opts = [].slice.call(s.options).map(function (o) { return o.value; });
            opts.forEach(function (v) {
              if (v === original) return;
              try {
                selectTool(t);
                var s2 = fields().filter(function (el) { return el.getAttribute("data-key") === key; })[0];
                if (!s2) return;
                s2.value = v;
                fire(s2);
                var text = textNow();
                var bad = [];
                if (badNumbers(text)) bad.push("BADNUMBER");
                if (/not finite/i.test(text)) bad.push("notfinite");
                if (/^Couldn't compute/i.test(text)) bad.push("THREW");
                if (!text.length) bad.push("EMPTY");
                // An em dash matters only when it BLOCKS an otherwise good
                // result. With Insert still enabled it is punctuation; with
                // Insert disabled it is either the sentinel doing its job on a
                // real refusal or the sentinel misfiring on prose — and only
                // the second is a defect, which a human has to judge. So it is
                // reported at the point where it could bite and nowhere else.
                if (text.indexOf("—") >= 0) {
                  bad.push(insertBtn.disabled ? "EMDASH_BLOCKS_INSERT" : "note:emdash");
                }
                push(
                  "OPTION " + reg.mode + " " + t + " " + key + "=" + v +
                    " insert=" + (insertBtn.disabled ? "OFF" : "on") +
                    " issues=" + (bad.length ? bad.join("+") : "ok") + " :: " + text.slice(0, 110)
                );
              } catch (e) {
                push("OPTION " + reg.mode + " " + t + " " + key + "=" + v + " EXCEPTION " + (e && e.message));
              }
            });
          });
        } catch (e) {
          push("OPTION " + reg.mode + " " + t + " EXCEPTION " + (e && e.message));
        }
      });

      // ---- 2. Every field blank. ----------------------------------------
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
          push(
            "BLANK " + reg.mode + " " + t + " insert=" + (insertBtn.disabled ? "OFF" : "on") +
              " issues=" + (bad.length ? bad.join("+") : "ok") + " :: " + text.slice(0, 110)
          );
        } catch (e) {
          push("BLANK " + reg.mode + " " + t + " EXCEPTION " + (e && e.message));
        }
      });

      // ---- 3. Rubbish in every field. -----------------------------------
      //
      // Not to see it refuse — to see it refuse WITHOUT emitting a computed
      // NaN. A tool that prints "NaN" here prints it into a document.
      tools.forEach(function (t) {
        try {
          selectTool(t);
          var f = fields();
          f.forEach(function (el) {
            if (el.tagName !== "SELECT") el.value = "abc";
          });
          if (f.length) fire(f[0]);
          var text = textNow();
          var bad = [];
          // A COMPUTED NaN IS ALWAYS A DEFECT, even under deliberate rubbish:
          // "Delta NaN" was rendering here while the insert happened to be
          // blocked by unrelated punctuation beside it, which is a NaN kept out
          // of a document by accident rather than by a guard.
          if (badNumbers(text)) bad.push("BADNUMBER");
          // REFUSING RUBBISH IS THE CORRECT OUTCOME, so a refusal is only a
          // finding if the pane would still let it be inserted. Whether the
          // refusal comes from a designed guard or a caught parse error is a
          // question of style; whether "abc" can reach a document is not.
          // Flagging the style would make ten matrix tools fail a gate for
          // behaving properly, and a gate that cries wolf gets switched off.
          if (/^Couldn't compute/i.test(text) && !insertBtn.disabled) bad.push("THREW_BUT_INSERTABLE");
          push(
            "JUNK " + reg.mode + " " + t + " insert=" + (insertBtn.disabled ? "OFF" : "on") +
              " issues=" + (bad.length ? bad.join("+") : "ok") + " :: " + text.slice(0, 110)
          );
        } catch (e) {
          push("JUNK " + reg.mode + " " + t + " EXCEPTION " + (e && e.message));
        }
      });

      // ---- 4. What each tool produces, and what INSERTING it attempts. --
      var pending = tools.slice();
      function insertNext() {
        if (!pending.length) {
          nextRegistry();
          return;
        }
        var t = pending.shift();
        try {
          selectTool(t);
          recompute();
          var figures = figuresNow();
          var equations = resultEl.querySelectorAll(".math-preview").length;
          ops = [];
          packages = [];
          var errorsBefore = insertErrors.length;
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

            if (/could not|couldn't|still inserting|nothing to insert/i.test(status)) {
              issues.push("STATUS(" + status.slice(0, 60) + ")");
            }
            // EVERY FIGURE THE PREVIEW SHOWED MUST BE ATTEMPTED AS A PICTURE.
            //
            // This is the check the campaign turns on. A figure that renders in
            // the pane and never reaches the document is this repo's recorded
            // "preview is not insert" defect, and it shipped three times in one
            // week without a single test noticing.
            if (pics !== figures) issues.push("PICTURES " + pics + "!=" + figures);
            if (eqIn !== equations) issues.push("EQUATIONS " + eqIn + "!=" + equations);
            if (!ops.length) issues.push("NOTHING_INSERTED");
            for (var ei = errorsBefore; ei < insertErrors.length; ei++) {
              issues.push("THREW(" + insertErrors[ei] + ")");
            }

            // ADVERSARIAL 1 — is the OOXML actually well formed? Counting
            // <m:oMath> proves a package CONTAINS an equation; it says nothing
            // about whether Word can parse it, and Word's answer to a malformed
            // flat-OPC package is to decline it quietly.
            packages.forEach(function (xml, pi) {
              var doc = new DOMParser().parseFromString(xml, "application/xml");
              if (doc.getElementsByTagName("parsererror").length) {
                issues.push("MALFORMED_OOXML[" + pi + "]");
                return;
              }
              if (!/<pkg:package/.test(xml)) issues.push("NOT_FLAT_OPC[" + pi + "]");
              var loose = doc.getElementsByTagNameNS("*", "oMath").length;
              if (loose === 0 && /oMath/.test(xml)) issues.push("OMATH_NOT_IN_MATH_NS[" + pi + "]");
              if (hasControlChar(xml)) {
                issues.push("CONTROL_CHAR_IN_OOXML[" + pi + "]");
              }
            });

            // ADVERSARIAL 2 — a second click must neither double-insert nor be
            // permanently swallowed. A busy guard that never clears leaves
            // Insert dead after one use, which no single-click test can detect.
            if (!issues.length) {
              var before = ops.length;
              insertBtn.click();
              insertBtn.click();
              settle(function () {
                if (ops.length - before === 0) issues.push("SECOND_INSERT_DEAD");
                report(issues);
              });
              return;
            }
            report(issues);
            return;

            function report(list) {
              push(
                "INSERT " + reg.mode + " " + t + " preview[fig=" + figures + ",eq=" + equations + "]" +
                  " attempted[para=" + paras + ",text=" + texts + ",pic=" + pics +
                  ",pkg=" + pkgs.length + ",eq=" + eqIn + ",sync=" + syncs + "]" +
                  " " + (list.length ? "ISSUES=" + list.join("+") : "ok")
              );
              insertNext();
            }
          });
        } catch (e) {
          push("INSERT " + reg.mode + " " + t + " EXCEPTION " + (e && e.message));
          insertNext();
        }
      }
      insertNext();
    }

    function finish() {
      var d = document.createElement("div");
      d.id = "__results";
      d.setAttribute("data-results", out.join(" ||| "));
      document.body.appendChild(d);
    }

    nextRegistry();
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
