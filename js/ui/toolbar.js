(function (K) {
  'use strict';

  var D = K.dom;

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
    lasso: { label: 'Lasso: handwriting to text', icon: 'lasso', colors: [], sizes: [] },
    select: { label: 'Select images and text', icon: 'select', colors: [], sizes: [] },
    hand: { label: 'Hand', icon: 'hand', colors: [], sizes: [] }
  };

  // GoodNotes-style tool strip, always visible under the top bar:
  // tools | colours | sizes. Page and zoom controls live in `nav`, which the
  // workspace puts in its top bar.
  // ws: workspace controller (see workspace.js)
  function Toolbar(ws) {
    this.ws = ws;
    this.el = D.el('div.ws-tools');
    this.nav = D.el('div.ws-nav');
    this.zoomLabel = null;
    // nothing on the strip may reach the drawing input
    var el = this.el;
    ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'wheel'].forEach(function (ev) {
      D.on(el, ev, function (e) { e.stopPropagation(); });
    });
  }

  function sep() { return D.el('span.tb-sep'); }

  Toolbar.prototype.toolButtons = function (into) {
    var ws = this.ws, cur = ws.readOnly ? null : ws.prefs.tool;
    ['pen', 'highlighter', 'eraser', 'lasso', 'select', 'hand'].forEach(function (t) {
      var def = K.TOOLS[t];
      var b = D.button({ icon: def.icon, title: def.label, cls: 'tool' + (cur === t ? ' selected' : '') });
      var c = ws.prefs[t] && ws.prefs[t].color;
      if (c) {
        var dot = D.el('span.tool-dot');
        dot.style.backgroundColor = c;
        b.appendChild(dot);
      }
      D.tap(b, function () {
        if (ws.readOnly) { ws.setReadOnly(false); }
        if (cur === t && t === 'eraser') { ws.toggleEraserMode(); }
        else { ws.setTool(t); }
      });
      into.appendChild(b);
    });
  };

  Toolbar.prototype.styleButtons = function (into) {
    var ws = this.ws, tool = ws.prefs.tool, def = K.TOOLS[tool], tp = ws.prefs[tool];
    if (ws.readOnly || (!def.colors.length && !def.sizes.length)) { return; }
    into.appendChild(sep());
    def.colors.forEach(function (c) {
      var b = D.el('button.btn.color' + (tp.color === c[0] ? '.selected' : ''), { type: 'button', title: c[1], 'aria-label': c[1] });
      var dot = D.el('span.color-dot');
      dot.style.backgroundColor = c[0];
      b.appendChild(dot);
      D.tap(b, function () { ws.setColor(c[0]); });
      into.appendChild(b);
    });
    if (def.colors.length && def.sizes.length) { into.appendChild(sep()); }
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
    if (tool === 'eraser') {
      var m = ws.prefs.eraser.mode;
      var mb = D.button({ label: m === 'whole' ? 'Whole stroke' : 'Partial', title: 'Eraser mode', cls: 'mode-btn' });
      D.tap(mb, function () { ws.toggleEraserMode(); });
      into.appendChild(mb);
    }
  };

  Toolbar.prototype.renderNav = function () {
    var ws = this.ws, nav = D.empty(this.nav);
    var zl = D.button({ label: ws.zoomPct + '%', title: 'Fit width', cls: 'zoom-label' });
    D.tap(zl, function () { ws.resetZoom(); });
    this.zoomLabel = zl.querySelector('.btn-label');
    var prev = D.button({ icon: 'chevron-left', title: 'Previous page', cls: ws.pageIdx <= 0 ? 'disabled' : '' });
    D.tap(prev, function () { ws.goPage(ws.pageIdx - 1); });
    var label = D.button({ label: (ws.pageIdx + 1) + ' / ' + ws.pages.length, title: 'Pages', cls: 'page-label' });
    D.tap(label, function () { ws.pageList(); });
    var next = D.button({ icon: 'chevron-right', title: 'Next page (or a new one)' });
    D.tap(next, function () { ws.nextPage(); });
    D.append(nav, [zl, prev, label, next]);
  };

  Toolbar.prototype.render = function () {
    var el = D.empty(this.el);
    this.renderNav();
    el.classList.toggle('viewing', !!this.ws.readOnly);
    this.toolButtons(el);
    this.styleButtons(el);
  };

  Toolbar.prototype.reflow = function () {};
  Toolbar.prototype.destroy = function () {};

  Toolbar.prototype.setZoom = function (pct) {
    if (this.zoomLabel) { this.zoomLabel.textContent = pct + '%'; }
  };

  K.Toolbar = Toolbar;
})(window.Kagoj = window.Kagoj || {});
