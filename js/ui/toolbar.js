(function (K) {
  'use strict';

  var D = K.dom, U = K.util, sheets = K.sheets;

  K.TOOLS = {
    pen: {
      label: 'Pen', icon: 'pen',
      colors: [['#1F1F1F', 'Black'], ['#1E4FD8', 'Blue'], ['#D0312D', 'Red'], ['#1E8A44', 'Green']],
      sizes: [[2, 'Thin'], [3.5, 'Medium'], [6, 'Thick']]
    },
    highlighter: {
      label: 'Highlighter', icon: 'highlighter',
      colors: [['#FFE34D', 'Yellow'], ['#8CE68C', 'Green'], ['#FF8FC7', 'Pink'], ['#7FC8FF', 'Blue']],
      sizes: [[12, 'Thin'], [20, 'Medium'], [30, 'Thick']]
    },
    eraser: {
      label: 'Eraser', icon: 'eraser', colors: [],
      sizes: [[8, 'Small'], [18, 'Medium'], [36, 'Large']]
    },
    hand: { label: 'Hand', icon: 'hand', colors: [], sizes: [] },
    select: { label: 'Select images', icon: 'select', colors: [], sizes: [] }
  };

  var PREFS_KEY = 'kagoj.prefs';
  var DEFAULTS = {
    tool: 'pen',
    pen: { color: '#1F1F1F', size: 3.5 },
    highlighter: { color: '#FFE34D', size: 20 },
    eraser: { size: 18, mode: 'partial' },
    reopenLast: true,
    fitMode: 'auto',
    toolbarsHidden: false,
    pencilOnly: false,
    pencilAsked: false,
    wristGuard: 0,
    band: false,
    bandLines: 4
  };

  K.prefs = {
    all: function () {
      var p = U.lsGet(PREFS_KEY, {}) || {};
      var out = {};
      for (var k in DEFAULTS) {
        if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) {
          var d = DEFAULTS[k];
          out[k] = (typeof d === 'object') ? U.extend({}, d, p[k] || {}) : (p[k] === undefined ? d : p[k]);
        }
      }
      return out;
    },
    get: function (k) { return K.prefs.all()[k]; },
    set: function (k, v) {
      var p = U.lsGet(PREFS_KEY, {}) || {};
      p[k] = v;
      U.lsSet(PREFS_KEY, p);
    }
  };

  // ws: workspace controller (see workspace.js)
  function Toolbar(ws) {
    this.ws = ws;
    this.el = D.el('footer.toolbar');
  }

  Toolbar.prototype.mode = function () {
    var w = window.innerWidth;
    if (w < 600) { return 'compact'; }
    if (w < 900) { return 'mid'; }
    return 'full';
  };

  function sep() { return D.el('span.tb-sep'); }

  Toolbar.prototype.toolButtons = function (into, onPicked) {
    var ws = this.ws, cur = ws.prefs.tool;
    ['pen', 'highlighter', 'eraser', 'hand', 'select'].forEach(function (t) {
      var def = K.TOOLS[t];
      var b = D.button({ icon: def.icon, title: def.label, cls: 'tool' + (cur === t ? ' selected' : '') });
      D.tap(b, function () {
        if (cur === t && t === 'eraser') { ws.toggleEraserMode(); }
        else { ws.setTool(t); }
        if (onPicked) { onPicked(); }
      });
      into.appendChild(b);
    });
  };

  Toolbar.prototype.styleButtons = function (into, onPicked) {
    var ws = this.ws, tool = ws.prefs.tool, def = K.TOOLS[tool], tp = ws.prefs[tool];
    var self = this;
    if (def.colors.length) {
      var g = D.el('div.tb-group');
      def.colors.forEach(function (c) {
        var b = D.el('button.btn.color' + (tp.color === c[0] ? '.selected' : ''), { type: 'button', title: c[1], 'aria-label': c[1] });
        var dot = D.el('span.color-dot');
        dot.style.backgroundColor = c[0];
        b.appendChild(dot);
        D.tap(b, function () { ws.setColor(c[0]); if (onPicked) { onPicked(); } });
        g.appendChild(b);
      });
      into.appendChild(g);
      into.appendChild(sep());
    }
    if (def.sizes.length) {
      var s = D.el('div.tb-group');
      def.sizes.forEach(function (sz, i) {
        var b = D.el('button.btn.size' + (tp.size === sz[0] ? '.selected' : ''), { type: 'button', title: sz[1], 'aria-label': sz[1] });
        var bar = D.el('span.size-bar' + (tool === 'eraser' ? '.size-ring' : ''));
        var px = tool === 'eraser' ? [8, 13, 20][i] : (tool === 'highlighter' ? [8, 12, 17][i] : [3, 5, 8][i]);
        bar.style.width = px + 'px';
        bar.style.height = px + 'px';
        if (tool !== 'eraser') { bar.style.backgroundColor = tp.color; }
        b.appendChild(bar);
        D.tap(b, function () { ws.setSize(sz[0]); if (onPicked) { onPicked(); } });
        s.appendChild(b);
      });
      into.appendChild(s);
    }
    if (tool === 'eraser') {
      into.appendChild(sep());
      var m = ws.prefs.eraser.mode;
      var mb = D.button({ label: m === 'whole' ? 'Whole stroke' : 'Partial', title: 'Eraser mode', cls: 'mode-btn' });
      D.tap(mb, function () { ws.toggleEraserMode(); if (onPicked) { onPicked(); } else { self.render(); } });
      into.appendChild(mb);
    }
  };

  Toolbar.prototype.render = function () {
    var ws = this.ws, mode = this.mode(), self = this;
    var el = D.empty(this.el);
    el.className = 'toolbar toolbar-' + mode;
    var left = D.el('div.tb-left');

    if (!ws.readOnly) {
      if (mode === 'compact') {
        var cur = K.TOOLS[ws.prefs.tool];
        var tb = D.button({ icon: cur.icon, title: 'Tools', cls: 'tool selected tool-pop' });
        var cd = ws.prefs[ws.prefs.tool] && ws.prefs[ws.prefs.tool].color;
        if (cd) { var d = D.el('span.tool-dot'); d.style.backgroundColor = cd; tb.appendChild(d); }
        D.tap(tb, function () {
          var box = D.el('div.pop-tools');
          var r1 = D.el('div.pop-row'); self.toolButtons(r1, function () { pop.close(); });
          var r2 = D.el('div.pop-row'); self.styleButtons(r2, function () { pop.close(); });
          D.append(box, [r1, r2]);
          var pop = sheets.popover(tb, box);
        });
        left.appendChild(tb);
      } else {
        var tg = D.el('div.tb-group');
        this.toolButtons(tg);
        left.appendChild(tg);
        left.appendChild(sep());
        if (mode === 'full') {
          this.styleButtons(left);
        } else if (ws.prefs.tool !== 'hand' && ws.prefs.tool !== 'select') {
          var t = ws.prefs.tool, tp = ws.prefs[t];
          var sb = D.button({ title: 'Colour and size', cls: 'style-btn' });
          var dot = D.el('span.color-dot');
          dot.style.backgroundColor = tp.color || '#999';
          if (t === 'eraser') { dot.className = 'size-bar size-ring'; dot.style.backgroundColor = ''; }
          sb.appendChild(dot);
          sb.appendChild(D.icon('chevron-down', 'small'));
          D.tap(sb, function () {
            var box = D.el('div.pop-row');
            self.styleButtons(box, function () { pop2.close(); });
            var pop2 = sheets.popover(sb, box);
          });
          left.appendChild(sb);
        }
      }
    }

    var right = D.el('div.tb-right');
    if (mode !== 'compact') {
      var zm = D.button({ icon: 'minus', title: 'Zoom out' });
      D.tap(zm, function () { ws.zoom(-1); });
      var zl = D.button({ label: ws.zoomPct + '%', title: 'Fit width', cls: 'zoom-label' });
      D.tap(zl, function () { ws.resetZoom(); });
      var zp = D.button({ icon: 'plus', title: 'Zoom in' });
      D.tap(zp, function () { ws.zoom(1); });
      this.zoomLabel = zl.querySelector('.btn-label');
      D.append(right, [D.el('div.tb-group', null, [zm, zl, zp]), sep()]);
    } else {
      this.zoomLabel = null;
    }
    var prev = D.button({ icon: 'chevron-left', title: 'Previous page', cls: ws.pageIdx <= 0 ? 'disabled' : '' });
    D.tap(prev, function () { ws.goPage(ws.pageIdx - 1); });
    var label = D.button({ label: (ws.pageIdx + 1) + ' / ' + ws.pages.length, title: 'Pages', cls: 'page-label' });
    D.tap(label, function () { ws.pageList(); });
    var next = D.button({ icon: 'chevron-right', title: 'Next page', cls: ws.pageIdx >= ws.pages.length - 1 ? 'disabled' : '' });
    D.tap(next, function () { ws.goPage(ws.pageIdx + 1); });
    var add = D.button({ icon: 'page-add', title: 'Add page after this one' });
    D.tap(add, function () { ws.addPage(); });
    D.append(right, [D.el('div.tb-group', null, [prev, label, next]), add]);

    D.append(el, [left, D.el('div.spacer'), right]);
  };

  Toolbar.prototype.setZoom = function (pct) {
    if (this.zoomLabel) { this.zoomLabel.textContent = pct + '%'; }
  };

  K.Toolbar = Toolbar;
})(window.Kagoj = window.Kagoj || {});
