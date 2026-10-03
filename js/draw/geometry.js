(function (K) {
  'use strict';

  // Points are flat arrays [x0, y0, x1, y1, ...] in page units.
  var G = {};

  // Squared distance from point p to segment a-b
  G.segDist2 = function (px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = 0;
    if (len2 > 0) {
      t = ((px - ax) * dx + (py - ay) * dy) / len2;
      if (t < 0) { t = 0; } else if (t > 1) { t = 1; }
    }
    var qx = ax + t * dx - px, qy = ay + t * dy - py;
    return qx * qx + qy * qy;
  };

  // Ramer–Douglas–Peucker, iterative (no recursion depth issues).
  G.simplify = function (pts, tol) {
    var n = pts.length / 2;
    if (n <= 2) { return pts.slice(); }
    var keep = [];
    var i;
    for (i = 0; i < n; i++) { keep.push(0); }
    keep[0] = 1; keep[n - 1] = 1;
    var tol2 = tol * tol;
    var stack = [0, n - 1];
    while (stack.length) {
      var last = stack.pop(), first = stack.pop();
      var maxD = 0, idx = -1;
      var ax = pts[first * 2], ay = pts[first * 2 + 1], bx = pts[last * 2], by = pts[last * 2 + 1];
      for (i = first + 1; i < last; i++) {
        var d = G.segDist2(pts[i * 2], pts[i * 2 + 1], ax, ay, bx, by);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (idx >= 0 && maxD > tol2) {
        keep[idx] = 1;
        stack.push(first, idx, idx, last);
      }
    }
    var out = [];
    for (i = 0; i < n; i++) {
      if (keep[i]) { out.push(pts[i * 2], pts[i * 2 + 1]); }
    }
    return out;
  };

  // Insert points so consecutive points are at most maxDist apart.
  G.resample = function (pts, maxDist) {
    var n = pts.length / 2;
    if (n < 2) { return pts.slice(); }
    var out = [pts[0], pts[1]];
    for (var i = 1; i < n; i++) {
      var ax = pts[(i - 1) * 2], ay = pts[(i - 1) * 2 + 1];
      var bx = pts[i * 2], by = pts[i * 2 + 1];
      var dx = bx - ax, dy = by - ay;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxDist) {
        var steps = Math.ceil(d / maxDist);
        for (var s = 1; s < steps; s++) {
          out.push(ax + dx * s / steps, ay + dy * s / steps);
        }
      }
      out.push(bx, by);
    }
    return out;
  };

  G.bbox = function (pts, pad) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < pts.length; i += 2) {
      var x = pts[i], y = pts[i + 1];
      if (x < minX) { minX = x; }
      if (x > maxX) { maxX = x; }
      if (y < minY) { minY = y; }
      if (y > maxY) { maxY = y; }
    }
    pad = pad || 0;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  };

  G.intersects = function (a, b) {
    return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
  };

  G.union = function (a, b) {
    if (!a) { return b ? { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY } : null; }
    if (!b) { return a; }
    return {
      minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
      maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY)
    };
  };

  G.expand = function (r, d) {
    return { minX: r.minX - d, minY: r.minY - d, maxX: r.maxX + d, maxY: r.maxY + d };
  };

  // Stroke helpers
  G.finishStroke = function (s) {
    s.bb = G.bbox(s.pts, s.w / 2 + 1);
    return s;
  };

  K.geom = G;
})(window.Kagoj = window.Kagoj || {});
