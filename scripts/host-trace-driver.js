/* eslint-disable no-undef */
// The host-trace driver: runs after the pane bundle, in headless Chromium.
//
// For each tool in the mode picker it selects the tool, then clicks every
// visible Word-facing button (the list is derived from the source by
// scripts/host-trace.js) and waits for the recorded trace to go quiet. Each
// click becomes one labelled segment of the trace. Buttons never visible in any
// tool are clicked last, under "(hidden)". Seeds put a known input into the
// tools whose buttons refuse on an empty field, because a refusal before
// Word.run proves nothing about the code being moved.
(function () {
  "use strict";
  var ht = window.__ht;
  var out = [];
  var SEEDS = window.__HT_SEEDS || {};

  function finish(err) {
    if (window.__HT_DEBUG) console.log("HTFINISH " + (err || "").slice(0, 200));
    // Quiet the page once the drive is over. --dump-dom waits for the virtual
    // time budget to drain, and a pane timer that keeps re-arming (a retry, a
    // poll) keeps the page busy so the budget drains at wall-clock speed. How
    // many timers were still armed is reported, because a timer that re-arms
    // forever in the pane would be a defect in its own right.
    var rearmed = 0;
    var origST = window.setTimeout;
    window.setTimeout = function () { rearmed++; return 0; };
    window.setInterval = function () { rearmed++; return 0; };
    window.requestAnimationFrame = function () { rearmed++; return 0; };
    var maxId = origST(function () {}, 0);
    for (var ti = 0; ti <= maxId; ti++) { clearTimeout(ti); clearInterval(ti); }
    // Results leave through the console in base64 chunks (the runner reads
    // Chromium's stderr and stops the browser at HTEND). --dump-dom would wait
    // for the virtual-time budget, which a busy page never drains.
    var json = JSON.stringify({ error: err || null, segments: out, callSites: ht.callSites, timersAtEnd: maxId, rearmed: rearmed });
    var b64 = btoa(unescape(encodeURIComponent(json)));
    for (var ci = 0; ci < b64.length; ci += 3000) console.log("HTRESULT " + b64.slice(ci, ci + 3000));
    console.log("HTEND");
  }

  // Quiet = no new trace line and no Word.run in flight for 400 ms, AND the
  // pane no longer looks busy: the clicked button re-enabled (handlers disable
  // it for the whole insert) and no "Inserting…" status. Rasterising a figure
  // to PNG happens BEFORE Word.run and records nothing, so trace silence alone
  // ended segments mid-insert and made the trace flaky.
  function settle(done, watchBtn) {
    var last = -1;
    var quiet = 0;
    var waited = 0;
    var statusEl = document.getElementById("status");
    var tick = function () {
      // A button that stays disabled ON PURPOSE after its work (paragraph
      // numbering's Apply, once the plan is consumed) would otherwise hold
      // every segment to the 20 s cap, so a disabled button counts as busy
      // only for its first 6 s; the trace and Word.run checks still apply.
      var busy =
        (watchBtn && watchBtn.disabled && waited < 6000) ||
        /…\s*$/.test(String((statusEl && statusEl.textContent) || ""));
      if (ht.trace.length === last && ht.inFlight() === 0 && !busy) quiet++;
      else quiet = 0;
      last = ht.trace.length;
      waited += 50;
      if (quiet >= 8 && waited >= 400) done(false);
      else if (waited > 20000) done(true);
      else setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  }

  function take(label) {
    if (window.__HT_DEBUG) console.log("HTTAKE " + label + " ops=" + ht.trace.length);
    var seg = ht.trace.splice(0, ht.trace.length);
    // The LAST NON-EMPTY status the segment set, not whatever the line holds
    // when the drive looks: some statuses clear themselves on a timer, and
    // reading the line at the end made the trace depend on that timer.
    var said = statusSeen.filter(Boolean);
    statusSeen = [];
    out.push({ label: label, ops: seg, status: said.length ? said[said.length - 1].slice(0, 160) : "" });
  }

  var statusSeen = [];
  function watchStatus() {
    var el = document.getElementById("status");
    if (!el) return;
    new MutationObserver(function () { statusSeen.push(String(el.textContent || "")); }).observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  function visible(el) {
    return !!(el && el.offsetParent !== null && !el.closest("[hidden]"));
  }

  // A seed step is [elementId, value], ["click", elementId],
  // ["q:<css selector>", value] (the first match), or ["file:<inputId>", name,
  // content] (a File handed to a file input, as a real pick would).
  function setVal(id, v, extra) {
    if (id === "click" || id === "qclick") {
      var b = id === "click" ? document.getElementById(v) : document.querySelector(v);
      if (b) b.click();
      return;
    }
    if (id.indexOf("file:") === 0) {
      var fi = document.getElementById(id.slice(5));
      if (!fi) return;
      var dt = new DataTransfer();
      dt.items.add(new File([extra], v, { type: "text/plain" }));
      fi.files = dt.files;
      fi.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    var el = id.indexOf("q:") === 0 ? document.querySelector(id.slice(2)) : document.getElementById(id);
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Seed steps run one per settle, so a step that triggers async work (a
  // Convert, a file read) finishes before the next step reads its result.
  function runSeed(steps, done) {
    if (!steps || !steps.length) return done();
    var i = 0;
    (function step() {
      if (i >= steps.length) return done();
      var st = steps[i++];
      setVal(st[0], st[1], st[2]);
      settle(step);
    })();
  }

  try {
    watchStatus();
    window.__officeCb({ host: "Word" });
    var modeSel = document.getElementById("mode-select");
    var modes = Array.prototype.map.call(modeSel.options, function (o) { return o.value; }).filter(Boolean);
    var targets = window.__HT_TARGETS || [];
    var clicked = {};
    var queue = [];
    settle(function () {
      take("(boot)");
      modes.forEach(function (m) { queue.push({ mode: m }); });
      queue.push({ mode: null });
      next();
    });

    var pending = [];
    function next() {
      if (pending.length) {
        var job = pending.shift();
        var btn = document.getElementById(job.id);
        if (window.__HT_DEBUG) console.log("HTJOB " + job.label);
        // The vector-SVG option is a sticky pane setting; a seed turns it on for
        // ONE insert, so every other figure keeps exercising the PNG route.
        var vec = document.getElementById("figstyle-vector");
        if (vec && vec.checked) setVal("figstyle-vector", false);
        // Whatever a seed step does to the document (a callout row's own
        // Insert) is recorded as part of this segment.
        runSeed(job.seed, function () {
          var enabled = !!(btn && !btn.disabled);
          if (enabled) btn.click();
          settle(function (timedOut) {
            take(job.label + (enabled ? "" : " [disabled]") + (timedOut ? " [TIMED OUT]" : ""));
            next();
          }, enabled ? btn : null);
        });
        return;
      }
      if (!queue.length) return finish(null);
      var q = queue.shift();
      if (q.mode) {
        modeSel.value = q.mode;
        modeSel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      settle(function () {
        ht.trace.splice(0, ht.trace.length);
        targets.forEach(function (id) {
          var el = document.getElementById(id);
          if (!el) return;
          // A button shared by several tools (the main Insert) does different
          // things in each, so visible buttons are clicked once PER TOOL; the
          // final hidden pass clicks only what no tool ever showed.
          if (q.mode ? !visible(el) || clicked[q.mode + "/" + id] : clicked[id]) return;
          clicked[id] = true;
          if (q.mode) clicked[q.mode + "/" + id] = true;
          var seedKey = (q.mode || "") + "/" + id;
          pending.push({ id: id, label: (q.mode || "(hidden)") + "/" + id, seed: SEEDS[seedKey] || SEEDS[id] || null });
          // "mode/id#2", "#3"…: the same button again with another seed, for a
          // second branch of one handler (reaction structures vs formulas).
          for (var v = 2; SEEDS[seedKey + "#" + v]; v++) {
            pending.push({ id: id, label: seedKey + "#" + v, seed: SEEDS[seedKey + "#" + v] });
          }
        });
        next();
      });
    }
  } catch (e) {
    finish(String((e && e.stack) || e));
  }
})();
