(function (K) {
  'use strict';

  // Stroke format v1 (PRD §13.1): coordinates ×10, rounded, delta-encoded.
  var C = {};

  C.encodeStroke = function (s) {
    var out = [], px = 0, py = 0;
    for (var i = 0; i < s.pts.length; i += 2) {
      var x = Math.round(s.pts[i] * 10), y = Math.round(s.pts[i + 1] * 10);
      if (i === 0) { out.push(x, y); } else { out.push(x - px, y - py); }
      px = x; py = y;
    }
    return { id: s.id, t: s.t, c: s.c, w: s.w, pts: out };
  };

  C.decodeStroke = function (e) {
    var pts = [], x = 0, y = 0, src = e.pts || [];
    for (var i = 0; i + 1 < src.length; i += 2) {
      if (i === 0) { x = src[0]; y = src[1]; } else { x += src[i]; y += src[i + 1]; }
      pts.push(x / 10, y / 10);
    }
    var s = { id: e.id, t: e.t === 'h' ? 'h' : 'p', c: e.c || '#1F1F1F', w: +e.w || 3.5, pts: pts };
    return K.geom.finishStroke(s);
  };

  C.encode = function (strokes) {
    var out = [];
    for (var i = 0; i < strokes.length; i++) { out.push(C.encodeStroke(strokes[i])); }
    return { v: 1, w: K.config.pageW, h: K.config.pageH, strokes: out };
  };

  C.decode = function (d) {
    var out = [];
    if (!d || !d.strokes) { return out; }
    for (var i = 0; i < d.strokes.length; i++) {
      var s = C.decodeStroke(d.strokes[i]);
      if (s.pts.length >= 2) { out.push(s); }
    }
    return out;
  };

  K.codec = C;
})(window.Kagoj = window.Kagoj || {});
