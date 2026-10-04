(function (K) {
  'use strict';

  // Handwriting -> typed text using Google's handwriting-input service (the one
  // Gboard uses). Strokes are grouped into lines and sent as ink; the result is
  // shown for correction, then replaces the handwriting on the page.
  // Needs a network connection; only stroke coordinates are sent.
  var D = K.dom, sheets = K.sheets;
  var HW = {};
  var URL_ = 'https://inputtools.google.com/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8';

  function overlap(a0, a1, b0, b1) { return Math.min(a1, b1) - Math.max(a0, b0); }

  // Group strokes into text lines (top to bottom). Each line keeps the
  // original writing order, which the recogniser relies on.
  HW.groupLines = function (strokes) {
    var items = strokes.map(function (s, i) {
      var b = K.geom.bbox(s.pts, 0);
      return { s: s, i: i, y0: b.minY, y1: b.maxY, x0: b.minX, x1: b.maxX, h: Math.max(4, b.maxY - b.minY) };
    });
    // tall strokes first so lines get a sensible band before dots and dashes join
    var order = items.slice().sort(function (a, b) { return b.h - a.h; });
    var lines = [];
    order.forEach(function (it) {
      var best = null, bestOv = 0;
      for (var k = 0; k < lines.length; k++) {
        var L = lines[k];
        // share of the stroke's own height that lies within the line (dots fully inside count as 1)
        var ov = overlap(it.y0, it.y1, L.y0, L.y1) / Math.max(1, Math.min(it.y1 - it.y0, L.y1 - L.y0));
        // small marks (i-dots, commas) just above or below a line belong to it
        if (ov <= 0 && it.h < (L.y1 - L.y0) * 0.35) {
          var gap = Math.min(Math.abs(it.y1 - L.y0), Math.abs(it.y0 - L.y1));
          if (gap < (L.y1 - L.y0) * 0.6 && overlap(it.x0, it.x1, L.x0 - 20, L.x1 + 20) > -1) { ov = 0.3; }
        }
        if (ov > bestOv) { bestOv = ov; best = L; }
      }
      if (best && bestOv >= 0.3) {
        best.items.push(it);
        if (it.h >= (best.y1 - best.y0) * 0.35) { best.y0 = Math.min(best.y0, it.y0); best.y1 = Math.max(best.y1, it.y1); }
        best.x0 = Math.min(best.x0, it.x0); best.x1 = Math.max(best.x1, it.x1);
      } else {
        lines.push({ items: [it], y0: it.y0, y1: it.y1, x0: it.x0, x1: it.x1 });
      }
    });
    lines.forEach(function (L) { L.items.sort(function (a, b) { return a.i - b.i; }); });
    lines.sort(function (a, b) { return a.y0 - b.y0; });
    return lines.map(function (L) { return { strokes: L.items.map(function (it) { return it.s; }), y0: L.y0, y1: L.y1, x0: L.x0, x1: L.x1 }; });
  };

  // One recognition request per line (Google ink format: [[xs], [ys], [ts]])
  HW.buildRequest = function (lines) {
    var t = 0;
    return {
      options: 'enable_pre_space',
      requests: lines.map(function (L) {
        var ink = L.strokes.map(function (s) {
          var xs = [], ys = [], ts = [];
          for (var i = 0; i < s.pts.length; i += 2) {
            xs.push(Math.round((s.pts[i] - L.x0) * 2));
            ys.push(Math.round((s.pts[i + 1] - L.y0) * 2));
            ts.push(t); t += 8;
          }
          t += 60;
          return [xs, ys, ts];
        });
        return {
          writing_guide: { writing_area_width: Math.round((L.x1 - L.x0) * 2) + 20, writing_area_height: Math.round((L.y1 - L.y0) * 2) + 20 },
          ink: ink, language: 'en'
        };
      })
    };
  };

  HW.parse = function (data, n) {
    if (!data || data[0] !== 'SUCCESS' || !data[1]) { return null; }
    var out = [];
    for (var i = 0; i < n; i++) {
      var r = data[1][i];
      out.push(r && r[1] && r[1][0] ? r[1][0] : '');
    }
    return out;
  };

  // cb(err, { text, size })
  HW.recognize = function (strokes, cb) {
    if (!strokes.length) { cb(new Error('Nothing selected')); return; }
    if (navigator.onLine === false) { cb(new Error('Handwriting to text needs an internet connection.')); return; }
    var lines = HW.groupLines(strokes);
    K.xhr({
      method: 'POST', url: URL_, headers: { 'Content-Type': 'application/json' },
      body: HW.buildRequest(lines), timeout: 20000
    }, function (err, res) {
      if (err) {
        cb(new Error(err.type === 'network' || err.type === 'timeout'
          ? 'Could not reach the handwriting service. Check the connection.'
          : 'The handwriting service said no (' + (err.status || '?') + ').'));
        return;
      }
      var texts = HW.parse(res.data, lines.length);
      if (!texts) { cb(new Error('The handwriting service gave no answer.')); return; }
      // typed size about two thirds of the handwritten line height
      var hs = lines.map(function (L) { return L.y1 - L.y0; }).sort(function (a, b) { return a - b; });
      var mid = hs[Math.floor(hs.length / 2)] || 30;
      var size = Math.max(14, Math.min(48, Math.round(mid * 0.62)));
      cb(null, { text: texts.join('\n').replace(/^\s+|\s+$/g, ''), size: size });
    });
  };

  function textArea(value) {
    var ta = D.el('textarea.text-area', { rows: 6, autocapitalize: 'sentences', spellcheck: 'true' });
    ta.value = value;
    return ta;
  }

  // Lasso selection -> preview -> replace on the page
  HW.convert = function (engine) {
    var strokes = engine.pickedStrokes();
    if (!strokes.length) { sheets.toast('Draw a loop around some handwriting first.'); return; }
    var body = D.el('div.hw-body', null, D.el('p.sheet-text', { text: 'Reading your handwriting…' }));
    var result = null, ta = null;
    var m = sheets.modal({
      title: 'Handwriting to text', body: body, cls: 'sheet-hw',
      actions: [
        { label: 'Cancel' },
        { label: 'Replace', primary: true, onTap: function () {
          if (!result) { return false; }
          var text = ta.value.replace(/^\s+|\s+$/g, '');
          if (!text) { return false; }
          engine.convertPicked(text, result.size);
          sheets.toast('Converted. Undo brings the handwriting back.');
        } }
      ]
    });
    HW.recognize(strokes, function (err, res) {
      D.empty(body);
      if (err) {
        body.appendChild(D.el('p.sheet-text.hw-err', { text: err.message }));
        return;
      }
      result = res;
      ta = textArea(res.text || '');
      D.append(body, [D.el('p.sheet-text', { text: 'Fix anything that was misread, then tap Replace.' }), ta]);
    });
    return m;
  };

  HW.editDialog = function (engine, id) {
    var f = engine.findObj(id);
    if (!f || f.kind !== 'text') { return; }
    var ta = textArea(f.obj.t);
    sheets.modal({
      title: 'Edit text', body: ta, cls: 'sheet-hw',
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onTap: function () {
        var v = ta.value.replace(/^\s+|\s+$/g, '');
        if (v) { engine.editText(id, v); } else { engine.deleteSelected(); }
      } }]
    });
    ta.focus();
  };

  K.Handwriting = HW;
})(window.Kagoj = window.Kagoj || {});
