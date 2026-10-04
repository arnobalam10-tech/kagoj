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

  function r1(v) { return Math.round(v * 10) / 10; }

  // w/h: page size in page units (default A4 1000 x 1414); imgs: placed images
  C.encode = function (strokes, w, h, imgs, texts) {
    var out = [];
    for (var i = 0; i < strokes.length; i++) { out.push(C.encodeStroke(strokes[i])); }
    var d = { v: 1, w: w || K.config.pageW, h: h || K.config.pageH, strokes: out };
    if (imgs && imgs.length) {
      d.imgs = imgs.map(function (m) { return { id: m.id, a: m.a, x: r1(m.x), y: r1(m.y), w: r1(m.w), h: r1(m.h) }; });
    }
    if (texts && texts.length) {
      d.texts = texts.map(function (t) { return { id: t.id, x: r1(t.x), y: r1(t.y), w: r1(t.w), s: r1(t.s), c: t.c, t: t.t }; });
    }
    return d;
  };

  C.decodeTexts = function (d) {
    var out = [];
    if (!d || !d.texts) { return out; }
    for (var i = 0; i < d.texts.length; i++) {
      var t = d.texts[i];
      if (t && typeof t.t === 'string' && t.w > 0 && t.s > 0) {
        out.push({ id: t.id, x: +t.x, y: +t.y, w: +t.w, s: +t.s, c: t.c || '#1F1F1F', t: t.t });
      }
    }
    return out;
  };

  C.decodeImgs = function (d) {
    var out = [];
    if (!d || !d.imgs) { return out; }
    for (var i = 0; i < d.imgs.length; i++) {
      var m = d.imgs[i];
      if (m && m.a && m.w > 0 && m.h > 0) { out.push({ id: m.id, a: m.a, x: +m.x, y: +m.y, w: +m.w, h: +m.h }); }
    }
    return out;
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
