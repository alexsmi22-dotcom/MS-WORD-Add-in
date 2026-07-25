// Overlap detector for the landing page. Runs inside the harness and is pointed
// at the iframe holding landing/index.html, so one browser launch can measure
// many viewport widths.
//
// Why this exists: three separate rounds of landing-page bugs — a leader line
// drawn through the "OH" label, an "AmpR" feature label printed on top of a
// "2700" tick, and the hero mock silently clipping the F and p columns off a
// statistics table below 940px — were all invisible in the markup. The
// coordinates read fine; only a laid-out browser shows the collision.
//
// Two rules, both deliberately narrow so a pass means something:
//   1. No two pieces of TEXT may overlap. Compared per line box
//      (getClientRects), not per element, or a paragraph wrapped over four
//      lines reads as one tall rectangle covering its neighbours. SVG <text> is
//      included: two of the three bugs above were exactly that.
//   2. Nothing may extend past the viewport, and the page may not scroll
//      sideways.
//
// Decorative layers are excluded by intent, not by convenience: the watermark
// on the dark bands overlaps everything by design, and aria-hidden content is
// not read by anyone.

(function () {
  function detect(doc, win, label) {
    var out = [];

    function visible(el) {
      if (el.closest("[hidden]")) return false;
      var cs = win.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (parseFloat(cs.opacity) < 0.05) return false;
      return true;
    }

    function describe(el) {
      var p = el.tagName.toLowerCase();
      if (el.className && typeof el.className === "string") {
        p += "." + el.className.trim().split(/\s+/)[0];
      }
      var par = el.parentElement;
      if (par) {
        p = par.tagName.toLowerCase() + (par.id ? "#" + par.id : "") + " > " + p;
      }
      return p;
    }

    // Leaf text only: an element with text but no child element that also has
    // text. Comparing a container with its own child is never interesting.
    var boxes = [];
    var all = doc.querySelectorAll("body *");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      if (el.closest(".chem-bg")) continue; // watermark: overlaps by design
      var txt = (el.textContent || "").trim();
      if (!txt) continue;
      var hasTextChild = false;
      for (var c = 0; c < el.children.length; c++) {
        if ((el.children[c].textContent || "").trim()) { hasTextChild = true; break; }
      }
      if (hasTextChild) continue;
      if (!visible(el)) continue;
      var rects = el.getClientRects();
      for (var r = 0; r < rects.length; r++) {
        var b = rects[r];
        if (b.width < 1 || b.height < 1) continue;
        boxes.push({ el: el, b: b, t: txt.slice(0, 44) });
      }
    }

    for (var a = 0; a < boxes.length; a++) {
      for (var z = a + 1; z < boxes.length; z++) {
        var A = boxes[a], B = boxes[z];
        if (A.el === B.el) continue;
        if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
        var ox = Math.min(A.b.right, B.b.right) - Math.max(A.b.left, B.b.left);
        var oy = Math.min(A.b.bottom, B.b.bottom) - Math.max(A.b.top, B.b.top);
        // 1.5px of slack absorbs sub-pixel rounding without hiding a real hit.
        if (ox > 1.5 && oy > 1.5) {
          out.push(
            label + " TEXT-OVERLAP " + Math.round(ox) + "x" + Math.round(oy) + "px :: \"" +
            A.t + "\" [" + describe(A.el) + "] vs \"" + B.t + "\" [" + describe(B.el) + "]"
          );
        }
      }
    }

    var de = doc.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) {
      out.push(label + " PAGE-H-SCROLL scrollWidth=" + de.scrollWidth + " clientWidth=" + de.clientWidth);
    }
    var vw = de.clientWidth;
    var every = doc.querySelectorAll("body *");
    for (var k = 0; k < every.length; k++) {
      var e2 = every[k];
      if (e2.closest("[hidden]")) continue;
      // The skip link is parked off-screen on purpose; that is the pattern, not a bug.
      if (e2.classList && e2.classList.contains("skip")) continue;
      if (!visible(e2)) continue;
      var r2 = e2.getBoundingClientRect();
      if (r2.width > 0 && (r2.right > vw + 1.5 || r2.left < -1.5)) {
        out.push(
          label + " OVERFLOW left=" + Math.round(r2.left) + " right=" + Math.round(r2.right) +
          " viewport=" + vw + " :: " + describe(e2)
        );
      }
    }
    return out;
  }

  window.__overlapDetect = detect;
})();
