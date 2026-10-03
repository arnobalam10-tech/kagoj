(function (K) {
  'use strict';

  var G = K.geom;
  var E = {};

  function hits(s, x, y, rr) {
    var p = s.pts, n = p.length / 2;
    if (n === 1) {
      var dx = p[0] - x, dy = p[1] - y;
      return dx * dx + dy * dy <= rr;
    }
    for (var i = 0; i < n - 1; i++) {
      if (G.segDist2(x, y, p[i * 2], p[i * 2 + 1], p[i * 2 + 2], p[i * 2 + 3]) <= rr) { return true; }
    }
    return false;
  }

  // Remove points within the eraser and split into fragments.
  // Returns null when nothing was removed.
  function split(s, x, y, rr) {
    var p = s.pts, n = p.length / 2, frags = [], cur = [], removedAny = false;
    for (var i = 0; i < n; i++) {
      var dx = p[i * 2] - x, dy = p[i * 2 + 1] - y;
      if (dx * dx + dy * dy <= rr) {
        removedAny = true;
        if (cur.length >= 4) { frags.push(cur); }
        cur = [];
      } else {
        cur.push(p[i * 2], p[i * 2 + 1]);
      }
    }
    if (!removedAny) { return null; }
    if (cur.length >= 4) { frags.push(cur); }
    var out = [];
    for (var j = 0; j < frags.length; j++) {
      out.push(G.finishStroke({ id: K.util.strokeId(), t: s.t, c: s.c, w: s.w, pts: frags[j] }));
    }
    return out;
  }

  // Erase at page point (x, y). Mutates `strokes`.
  // Returns { steps: [{i, removed, added}], dirty: rect|null }
  E.apply = function (strokes, x, y, r, mode) {
    var steps = [], dirty = null;
    var probe = { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r };
    for (var i = strokes.length - 1; i >= 0; i--) {
      var s = strokes[i];
      if (!G.intersects(s.bb, probe)) { continue; }
      var reach = r + s.w / 2;
      var rr = reach * reach;
      if (!hits(s, x, y, rr)) { continue; }
      var added;
      if (mode === 'whole' || s.pts.length <= 2) {
        added = [];
      } else {
        added = split(s, x, y, rr);
        if (!added) { continue; }
      }
      Array.prototype.splice.apply(strokes, [i, 1].concat(added));
      steps.push({ i: i, removed: s, added: added });
      dirty = G.union(dirty, s.bb);
    }
    return { steps: steps, dirty: dirty };
  };

  K.eraser = E;
})(window.Kagoj = window.Kagoj || {});
