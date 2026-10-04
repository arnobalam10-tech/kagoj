(function (K) {
  'use strict';

  var D = K.dom, U = K.util;

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
    bandLines: 4,
    paletteOpen: false,
    palettePos: null
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

  // Floating tool palette: a small round button that can be dragged anywhere
  // over the page. Tap it to open the panel (tools, colours, sizes, zoom,
  // pages); tap it again to close. Its position is saved as a fraction of the
  // page area so it survives rotation.
  // ws: workspace controller (see workspace.js)
  var DRAG_PX = 8;
  var FAB = 52;

  function Toolbar(ws) {
    this.ws = ws;
    this.open = !!K.prefs.get('paletteOpen');
    this.fab = D.el('button.pal-fab', { type: 'button', title: 'Tools', 'aria-label': 'Tools' });
    this.panel = D.el('div.pal-panel');
    this.el = D.el('div.palette', null, [this.panel, this.fab]);
    this.zoomLabel = null;
    this.bindFab();
    // nothing on the palette may reach the drawing input underneath
    var el = this.el;
    ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'wheel'].forEach(function (ev) {
      D.on(el, ev, function (e) { e.stopPropagation(); });
    });
  }

  function sep() { return D.el('span.tb-sep'); }

  // ---------- dragging / toggling the round button ----------

  Toolbar.prototype.bindFab = function () {
    var self = this, fab = this.fab;
    var sx = 0, sy = 0, ox = 0, oy = 0, down = false, moved = false, lastTouch = 0;
    function pt(e) { var t = e.touches ? e.touches[0] : e; return { x: t.clientX, y: t.clientY }; }
    function start(e) {
      var p = pt(e);
      down = true; moved = false;
      sx = p.x; sy = p.y;
      ox = self.el.offsetLeft; oy = self.el.offsetTop;
      fab.classList.add('pressed');
    }
    function move(e) {
      if (!down) { return; }
      var p = pt(e);
      if (!moved && Math.abs(p.x - sx) + Math.abs(p.y - sy) < DRAG_PX) { return; }
      if (e.cancelable) { e.preventDefault(); }
      moved = true;
      self.place(ox + p.x - sx, oy + p.y - sy, false);
    }
    function end() {
      if (!down) { return; }
      down = false;
      fab.classList.remove('pressed');
      if (moved) { self.savePos(); self.layoutPanel(); return; }
      self.toggle();
    }
    D.on(fab, 'touchstart', function (e) { lastTouch = Date.now(); start(e); }, { passive: true });
    D.on(fab, 'touchmove', move, D.passiveFalse);
    D.on(fab, 'touchend', function (e) { if (e.cancelable) { e.preventDefault(); } end(); }, D.passiveFalse);
    D.on(fab, 'touchcancel', function () { down = false; fab.classList.remove('pressed'); });
    D.on(fab, 'mousedown', function (e) { if (Date.now() - lastTouch < 800) { return; } start(e); });
    this.unbind = [
      D.on(window, 'mousemove', function (e) { if (Date.now() - lastTouch > 800) { move(e); } }),
      D.on(window, 'mouseup', function () { if (Date.now() - lastTouch > 800) { end(); } })
    ];
  };

  Toolbar.prototype.destroy = function () {
    if (this.unbind) { this.unbind.forEach(function (f) { f(); }); }
  };

  Toolbar.prototype.toggle = function () {
    this.open = !this.open;
    K.prefs.set('paletteOpen', this.open);
    this.render();
  };

  Toolbar.prototype.area = function () {
    var host = this.el.parentNode;
    return { w: (host && host.clientWidth) || window.innerWidth, h: (host && host.clientHeight) || window.innerHeight };
  };

  // Put the round button at (x, y) inside the page area.
  Toolbar.prototype.place = function (x, y) {
    var a = this.area();
    x = U.clamp(x, 6, Math.max(6, a.w - FAB - 6));
    y = U.clamp(y, 6, Math.max(6, a.h - FAB - 6));
    this.el.style.left = Math.round(x) + 'px';
    this.el.style.top = Math.round(y) + 'px';
  };

  Toolbar.prototype.savePos = function () {
    var a = this.area();
    K.prefs.set('palettePos', { x: this.el.offsetLeft / Math.max(1, a.w - FAB), y: this.el.offsetTop / Math.max(1, a.h - FAB) });
  };

  // Restore the saved spot (default: bottom-left, away from a right hand).
  Toolbar.prototype.restorePos = function () {
    var a = this.area();
    var p = K.prefs.get('palettePos');
    if (!p || typeof p.x !== 'number') { p = { x: 0, y: 1 }; }
    this.place(p.x * (a.w - FAB), p.y * (a.h - FAB));
  };

  // Open the panel toward the side with more room.
  Toolbar.prototype.layoutPanel = function () {
    var a = this.area(), panel = this.panel;
    if (!this.open) { return; }
    var x = this.el.offsetLeft, y = this.el.offsetTop;
    panel.style.maxWidth = Math.max(160, a.w - 12) + 'px';  // rows wrap on narrow screens
    var pw = panel.offsetWidth, ph = panel.offsetHeight;
    var left = x + FAB / 2 > a.w / 2 ? FAB - pw : 0;               // grow leftwards on the right half
    var top = y + FAB / 2 > a.h / 2 ? -ph - 8 : FAB + 8;           // above on the lower half
    // keep the panel inside the page area
    left = U.clamp(x + left, 6, Math.max(6, a.w - pw - 6)) - x;
    top = U.clamp(y + top, 6, Math.max(6, a.h - ph - 6)) - y;
    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(top) + 'px';
  };

  // ---------- panel content ----------

  Toolbar.prototype.toolButtons = function (into) {
    var ws = this.ws, cur = ws.prefs.tool;
    ['pen', 'highlighter', 'eraser', 'hand', 'select'].forEach(function (t) {
      var def = K.TOOLS[t];
      var b = D.button({ icon: def.icon, title: def.label, cls: 'tool' + (cur === t ? ' selected' : '') });
      D.tap(b, function () {
        if (cur === t && t === 'eraser') { ws.toggleEraserMode(); }
        else { ws.setTool(t); }
      });
      into.appendChild(b);
    });
  };

  Toolbar.prototype.styleButtons = function (into) {
    var ws = this.ws, tool = ws.prefs.tool, def = K.TOOLS[tool], tp = ws.prefs[tool];
    if (def.colors.length) {
      def.colors.forEach(function (c) {
        var b = D.el('button.btn.color' + (tp.color === c[0] ? '.selected' : ''), { type: 'button', title: c[1], 'aria-label': c[1] });
        var dot = D.el('span.color-dot');
        dot.style.backgroundColor = c[0];
        b.appendChild(dot);
        D.tap(b, function () { ws.setColor(c[0]); });
        into.appendChild(b);
      });
      into.appendChild(sep());
    }
    if (def.sizes.length) {
      def.sizes.forEach(function (sz, i) {
        var b = D.el('button.btn.size' + (tp.size === sz[0] ? '.selected' : ''), { type: 'button', title: sz[1], 'aria-label': sz[1] });
        var bar = D.el('span.size-bar' + (tool === 'eraser' ? '.size-ring' : ''));
        var px = tool === 'eraser' ? [8, 13, 20][i] : (tool === 'highlighter' ? [8, 12, 17][i] : [3, 5, 8][i]);
        bar.style.width = px + 'px';
        bar.style.height = px + 'px';
        if (tool !== 'eraser') { bar.style.backgroundColor = tp.color; }
        b.appendChild(bar);
        D.tap(b, function () { ws.setSize(sz[0]); });
        into.appendChild(b);
      });
    }
    if (tool === 'eraser') {
      into.appendChild(sep());
      var m = ws.prefs.eraser.mode;
      var mb = D.button({ label: m === 'whole' ? 'Whole stroke' : 'Partial', title: 'Eraser mode', cls: 'mode-btn' });
      D.tap(mb, function () { ws.toggleEraserMode(); });
      into.appendChild(mb);
    }
  };

  Toolbar.prototype.renderFab = function () {
    var ws = this.ws, fab = D.empty(this.fab);
    fab.classList.toggle('open', this.open);
    if (ws.readOnly) {
      fab.appendChild(D.icon(this.open ? 'close' : 'eye'));
      return;
    }
    var t = ws.prefs.tool;
    fab.appendChild(D.icon(this.open ? 'close' : K.TOOLS[t].icon));
    var c = ws.prefs[t] && ws.prefs[t].color;
    if (c && !this.open) {
      var dot = D.el('span.pal-dot');
      dot.style.backgroundColor = c;
      fab.appendChild(dot);
    }
  };

  Toolbar.prototype.render = function () {
    var ws = this.ws;
    this.renderFab();
    var panel = D.empty(this.panel);
    panel.style.display = this.open ? '' : 'none';
    this.zoomLabel = null;
    if (!this.el.style.left) { this.restorePos(); }
    if (!this.open) { return; }

    if (!ws.readOnly) {
      var r1 = D.el('div.pal-row');
      this.toolButtons(r1);
      panel.appendChild(r1);
      var t = ws.prefs.tool;
      if (K.TOOLS[t].colors.length || K.TOOLS[t].sizes.length) {
        var r2 = D.el('div.pal-row');
        this.styleButtons(r2);
        panel.appendChild(r2);
      }
    }

    var zm = D.button({ icon: 'minus', title: 'Zoom out' });
    D.tap(zm, function () { ws.zoom(-1); });
    var zl = D.button({ label: ws.zoomPct + '%', title: 'Fit width', cls: 'zoom-label' });
    D.tap(zl, function () { ws.resetZoom(); });
    var zp = D.button({ icon: 'plus', title: 'Zoom in' });
    D.tap(zp, function () { ws.zoom(1); });
    this.zoomLabel = zl.querySelector('.btn-label');
    var prev = D.button({ icon: 'chevron-left', title: 'Previous page', cls: ws.pageIdx <= 0 ? 'disabled' : '' });
    D.tap(prev, function () { ws.goPage(ws.pageIdx - 1); });
    var label = D.button({ label: (ws.pageIdx + 1) + ' / ' + ws.pages.length, title: 'Pages', cls: 'page-label' });
    D.tap(label, function () { ws.pageList(); });
    var next = D.button({ icon: 'chevron-right', title: 'Next page', cls: ws.pageIdx >= ws.pages.length - 1 ? 'disabled' : '' });
    D.tap(next, function () { ws.goPage(ws.pageIdx + 1); });
    var add = D.button({ icon: 'page-add', title: 'Add page after this one' });
    D.tap(add, function () { ws.addPage(); });
    panel.appendChild(D.el('div.pal-row', null, [zm, zl, zp, sep(), prev, label, next, add]));
    this.layoutPanel();
  };

  // Called when the page area changes size (rotation, hiding the top bar).
  Toolbar.prototype.reflow = function () {
    this.restorePos();
    this.layoutPanel();
  };

  Toolbar.prototype.setZoom = function (pct) {
    if (this.zoomLabel) { this.zoomLabel.textContent = pct + '%'; }
  };

  K.Toolbar = Toolbar;
})(window.Kagoj = window.Kagoj || {});
