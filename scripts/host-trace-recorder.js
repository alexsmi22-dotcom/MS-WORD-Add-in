/* eslint-disable no-undef */
// The recording Office/Word stub for the host-trace gate (scripts/host-trace.js).
//
// Loaded BEFORE the pane bundle, so `Office` and `Word` exist when it evaluates.
// Every object the pane touches is a Proxy that records what is done to it:
// each method call and its arguments, each property set, each load and sync,
// and the boundaries of each Word.run batch. Long strings (HTML, OOXML, base64
// pictures, SVG) are recorded as length + hash, so the trace stays small while
// a single changed byte still shows.
//
// WHY. The host-adapter refactor (docs/SCOPE-HOST-ADAPTER.md) moves 52 Word.run
// sites out of taskpane.ts. jest cannot run Office.js and the in-Word passes are
// the user's, so a site that is moved wrongly would be found first in someone's
// document. The gate's contract is simple: the trace from the moved code must be
// byte-identical to the golden trace from the code before the move.
//
// Naming is by PATH for property reads (ctx.document.body) and by call order for
// call results (#12), so an incidental extra property read cannot renumber the
// trace, while a reordered or missing call always does.
(function () {
  "use strict";
  Error.stackTraceLimit = 30; // the default 10 can stop short of the pane frame
  var trace = [];
  var callSites = [];
  var nextId = 1;
  var runNo = 0;
  var inFlight = 0;
  window.__ht = { trace: trace, callSites: callSites, fixtures: window.__HT_FIXTURES || {}, bodyPics: 0, inFlight: function () { return inFlight; } };

  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ("0000000" + h.toString(16)).slice(-8);
  }

  function summ(v, depth) {
    depth = depth || 0;
    if (v && (typeof v === "object" || typeof v === "function") && v.__htName) return v.__htName;
    var t = typeof v;
    // A caption's cross-reference bookmark is named from the clock (_Ref + nine digits, captionsPane.ts): the same
    // call every run, its name not — read as one name, or the trace would differ on every run.
    // The bookmark's w:id is derived from the same digits.
    if (t === "string") v = v.replace(/_Ref\d{9}/g, "_Ref#########").replace(/(<w:bookmark(?:Start|End) w:id=")\d+"/g, '$1#"');
    if (t === "string") return v.length > 48 ? "s" + v.length + ":" + fnv(v) : JSON.stringify(v);
    if (t === "number" || t === "boolean" || v === null || v === undefined) return String(v);
    if (t === "function") return "fn";
    if (depth > 4) return "…";
    if (Array.isArray(v)) {
      var a = v.map(function (x) { return summ(x, depth + 1); }).join(",");
      return a.length > 160 ? "[n" + v.length + ":" + fnv(a) + "]" : "[" + a + "]";
    }
    var keys = Object.keys(v).sort();
    var o = keys.map(function (k) { return k + ":" + summ(v[k], depth + 1); }).join(",");
    return o.length > 160 ? "{k" + keys.length + ":" + fnv(o) + "}" : "{" + o + "}";
  }

  function log(line) {
    trace.push(line);
  }

  // Scalar answers an empty document would give. Anything not listed reads as a
  // further recorded object.
  var SCALARS = {
    text: "",
    value: "",
    length: 0,
    isNullObject: true,
    width: 100,
    height: 100,
    tag: "",
    title: "",
    imageFormat: "Png",
    altTextDescription: "",
    altTextTitle: "",
    style: "",
    styleBuiltIn: "Normal",
    alignment: "Left",
    type: "",
    code: "",
    result: "",
    rowCount: 0,
    columnCount: 0,
    values: [],
  };

  function fixture(name, prop) {
    var fx = window.__ht.fixtures;
    var key = name + "." + prop;
    for (var k in fx) {
      if (Object.prototype.hasOwnProperty.call(fx, k) && new RegExp(k).test(key)) {
        var v = fx[k];
        return typeof v === "function" ? { v: v(name, prop) } : { v: v };
      }
    }
    return null;
  }

  // A fixture value {__items: [overrides, ...]} becomes recorded objects, so
  // what the pane does to a fixture item (f.delete(), p.insertText) is traced.
  function materialise(path, v) {
    if (v && typeof v === "object" && Array.isArray(v.__items)) {
      return v.__items.map(function (o, i) { return obj(path + "[" + i + "]", o); });
    }
    return v;
  }

  function obj(name, overrides) {
    var store = {};
    if (overrides) for (var ok_ in overrides) store[ok_] = overrides[ok_];
    var target = function () {};
    var self = new Proxy(target, {
      get: function (_t, k) {
        if (k === "__htName") return name;
        if (k === "then") return undefined;
        if (k === Symbol.toPrimitive) return function () { return "[" + name + "]"; };
        if (typeof k === "symbol") return undefined;
        if (k === "toJSON") return function () { return name; };
        if (Object.prototype.hasOwnProperty.call(store, k)) return store[k];
        var fx = fixture(name, k);
        if (fx) return (store[k] = materialise(name + "." + k, fx.v));
        if (k === "items" && /\.inlinePictures$/.test(name)) {
          // The body's pictures: one per picture inserted so far in this run, so
          // the "Word kept N of M figures" check and the vector route's
          // before/after diff see a document that behaves like Word's.
          var pics = [];
          // Each picture has its OWN width, as real pictures do: identical
          // signatures made the vector route's "find the one new picture"
          // ambiguous, so its success path was never traced (review, v2.145.0).
          for (var pi = 0; pi < window.__ht.bodyPics; pi++) pics.push(obj(name + "[" + pi + "]", { width: 100 + pi }));
          return pics; // not cached: a later load must see later inserts
        }
        if (k === "items") return (store[k] = []);
        if (Object.prototype.hasOwnProperty.call(SCALARS, k)) return SCALARS[k];
        if (k === "sync") return (store[k] = function () { log("  " + name + ".sync()"); return Promise.resolve(); });
        var child = method(name, k);
        store[k] = child;
        return child;
      },
      set: function (_t, k, v) {
        log("  set " + name + "." + String(k) + " = " + summ(v));
        store[k] = v;
        return true;
      },
    });
    return self;
  }

  // A property that is usually called (range.insertHtml) but may be read as an
  // object (range.font): one Proxy serves both.
  function method(parent, k) {
    var asObj = null;
    var path = parent + "." + k;
    function ensure() { return asObj || (asObj = obj(path)); }
    return new Proxy(function () {}, {
      apply: function (_t, _this, args) {
        var id = "#" + nextId++;
        log("  " + id + " = " + path + "(" + args.map(function (a) { return summ(a); }).join(", ") + ")");
        if (k === "load" || k === "track" || k === "untrack") return ensure();
        if (k === "insertInlinePictureFromBase64") window.__ht.bodyPics++;
        var fx = fixture(path, "()");
        if (fx) return materialise(id, fx.v);
        return obj(id);
      },
      get: function (_t, k2) {
        if (k2 === "__htName") return path;
        return ensure()[k2];
      },
      set: function (_t, k2, v) {
        ensure()[k2] = v;
        return true;
      },
    });
  }

  // ---- Network --------------------------------------------------------------
  // The drive runs offline. Chromium pauses virtual time while a fetch is in
  // flight, so one online lookup (a name resolver, PubChem) that never answers
  // freezes the whole drive; every fetch fails at once instead, as offline.
  window.fetch = function (url) {
    log("NET fetch(" + summ(String((url && url.url) || url).replace(/[?#].*$/, "")) + ") -> offline");
    return Promise.reject(new TypeError("Failed to fetch (host-trace runs offline)"));
  };

  // ---- Word -----------------------------------------------------------------
  var enums = window.__HT_ENUMS || {};
  var Word = {
    run: function (a, b) {
      var cb = typeof a === "function" ? a : b;
      var frames = String(new Error().stack || "").split("\n");
      // The whole synchronous stack, not just the caller: a pane handler that
      // reaches Word through src/host has the HOST's Word.run as its caller and
      // the pane's docHost call a few frames further up. Coverage is counted
      // at both, so one shared host method cannot stand in for all its callers.
      callSites.push(frames.slice(2, 14).join("\n"));
      runNo++;
      var ctxName = "R" + runNo;
      log("RUN " + ctxName + " {");
      inFlight++;
      var done = function () { inFlight--; log("} " + ctxName); };
      var p;
      try {
        p = Promise.resolve(cb(obj(ctxName)));
      } catch (e) {
        p = Promise.reject(e);
      }
      return p.then(
        function (v) { done(); return v; },
        function (e) { log("  THREW " + String((e && e.message) || e).slice(0, 120)); done(); throw e; }
      );
    },
  };
  for (var ns in enums) Word[ns] = enums[ns];
  window.Word = Word;

  // ---- Office ---------------------------------------------------------------
  var ok = function (v) { return { status: "succeeded", value: v }; };
  var settingsStore = {};

  // Office calls are coverage sites too: settings, dialogs and capability
  // probes never run inside a Word.run, so without their own stacks the pane
  // calls that reach them (docHost.getSetting, openDialog…) could never show
  // as reached. Stacks are not part of the trace text.
  var site = function () {
    callSites.push(String(new Error().stack || "").split("\n").slice(2, 14).join("\n"));
  };

  var ui = {
    displayDialogAsync: function (url, opts, cb) {
      site();
      var file = String(url).replace(/^.*\//, "").replace(/\?.*$/, "");
      log("OFFICE displayDialogAsync(" + summ(file) + ", " + summ(opts) + ")");
      // A dialog fixture answers with the message the real dialog would
      // send (e.g. the large canvas handing back a 3D model); without one
      // the dialog fails to open, which is a path the pane also handles.
      var msg = (window.__HT_DIALOGS || {})[file];
      if (!cb) return;
      if (msg === undefined) return cb({ status: "failed", error: { message: "harness: no dialogs" } });
      var dialog = {
        addEventHandler: function (type, h) {
          if (type === "dialogMessageReceived") setTimeout(function () { h({ message: msg }); }, 0);
        },
        close: function () { log("OFFICE dialog.close()"); },
        messageChild: function () {},
      };
      cb({ status: "succeeded", value: dialog });
    },
  };

  var context = {
    platform: "PC",
    requirements: {
      isSetSupported: function () {
        site();
        return true;
      },
    },
    document: {
      settings: {
        get: function (k) {
          site();
          var v = Object.prototype.hasOwnProperty.call(settingsStore, k) ? settingsStore[k] : null;
          log("OFFICE settings.get(" + summ(k) + ") -> " + summ(v));
          return v;
        },
        set: function (k, v) {
          site();
          log("OFFICE settings.set(" + summ(k) + ", " + summ(v) + ")");
          settingsStore[k] = v;
        },
        saveAsync: function (a, b) {
          site();
          log("OFFICE settings.saveAsync()");
          var cb = typeof a === "function" ? a : b;
          if (cb) cb(ok());
        },
      },
      setSelectedDataAsync: function (data, opts, cb) {
        site();
        log("OFFICE setSelectedDataAsync(" + summ(data) + ", " + summ(opts) + ")");
        window.__ht.bodyPics++;
        var f = typeof opts === "function" ? opts : cb;
        if (f) f(ok());
      },
    },
  };
  // A getter, so "can this host open dialogs?" — a property read — counts as a site.
  Object.defineProperty(context, "ui", {
    get: function () {
      site();
      return ui;
    },
  });

  window.Office = {
    HostType: { Word: "Word" },
    AsyncResultStatus: { Succeeded: "succeeded", Failed: "failed" },
    CoercionType: { XmlSvg: "XmlSvg", Ooxml: "ooxml", Html: "html", Text: "text" },
    EventType: { DialogMessageReceived: "dialogMessageReceived", DialogEventReceived: "dialogEventReceived" },
    onReady: function (cb) { window.__officeCb = cb; return Promise.resolve({ host: "Word" }); },
    context: context,
  };
})();
