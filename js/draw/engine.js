(function (K) {
  'use strict';

  var U = K.util, D = K.dom, G = K.geom, R = K.render;

  // One page on screen. Four stacked viewport-sized canvases:
  // paper, highlight (CSS opacity 0.4), ink, live.
  function Engine(host, opts) {
    this.host = host;
    this.opts = opts || {};
    this.vp = new K.Viewport();
    this.dpr = U.dpr();
    this.strokes = [];
    this.history = new K.History();
    this.paperStyle = 'ruled';
    this.pageId = null;
    this.tool = { tool: 'pen', color: '#1F1F1F', size: 3.5, eraserMode: 'partial' };
    this.readOnly = false;
    this.cur = null;       // stroke being drawn
    this.erase = null;     // eraser gesture
    this.panState = null;
    this.pinch = null;
    this.rafId = null;
    this.needsFrame = false;
    this.lastFrameT = 0;
    this.hoverPt = null;

    this.layers = D.el('div.layers');
    this.c = {
      paper: D.el('canvas.layer.layer-paper'),
      hl: D.el('canvas.layer.layer-hl'),
      ink: D.el('canvas.layer.layer-ink'),
      live: D.el('canvas.layer.layer-live')
    };
    D.append(this.layers, [this.c.paper, this.c.hl, this.c.ink, this.c.live]);
    host.appendChild(this.layers);
    this.x = {
      paper: this.c.paper.getContext('2d'),
      hl: this.c.hl.getContext('2d'),
      ink: this.c.ink.getContext('2d'),
      live: this.c.live.getContext('2d')
    };
    this.input = new K.Input(host, this);
    this.resize(true);
  }

  var P = Engine.prototype;

  // ---------- page / settings ----------

  P.setPage = function (pageId, drawing, paper, history, fitMode) {
    this.cancel();
    this.pageId = pageId;
    this.strokes = K.codec.decode(drawing);
    this.history = history || new K.History();
    this.paperStyle = paper || 'ruled';
    if (fitMode) { this.vp.fit(fitMode); }
    this.updateStats();
    this.render();
    this.notifyHistory();
  };

  P.setPaper = function (p) { this.paperStyle = p; this.renderPaper(); };

  P.setTool = function (t) {
    U.extend(this.tool, t);
    this.clearLive();
    if (this.opts.onCursor) { this.opts.onCursor(this.tool.tool); }
  };

  P.setReadOnly = function (b) { this.readOnly = !!b; this.cancel(); };

  P.getDrawing = function () { return K.codec.encode(this.strokes); };

  P.updateStats = function () {
    var pts = 0;
    for (var i = 0; i < this.strokes.length; i++) { pts += this.strokes[i].pts.length / 2; }
    K.stats.strokes = this.strokes.length;
    K.stats.points = pts;
  };

  P.changed = function () {
    this.updateStats();
    if (this.opts.onChange) { this.opts.onChange(this.pageId); }
    this.notifyHistory();
  };

  P.notifyHistory = function () {
    if (this.opts.onHistory) { this.opts.onHistory(this.history.canUndo(), this.history.canRedo()); }
  };

  // ---------- sizing & rendering ----------

  P.resize = function (first) {
    var w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) { return; }
    if (!first && w === this.vp.w && h === this.vp.h) { return; }
    this.dpr = U.dpr();
    for (var k in this.c) {
      if (Object.prototype.hasOwnProperty.call(this.c, k)) { R.sizeCanvas(this.c[k], w, h, this.dpr); }
    }
    this.vp.resize(w, h);
    this.render();
  };

  P.renderPaper = function () {
    R.paper(this.x.paper, this.vp, this.paperStyle, this.dpr);
  };

  P.render = function () {
    if (!this.vp.w) { return; }
    var t0 = U.perfNow();
    this.renderPaper();
    R.layer(this.x.hl, this.vp, this.dpr, this.strokes, 'h', null);
    R.layer(this.x.ink, this.vp, this.dpr, this.strokes, 'p', null);
    this.clearLive();
    K.stats.renderMs = Math.round(U.perfNow() - t0);
    if (this.opts.onView) { this.opts.onView(this.vp.zoomPct()); }
  };

  P.renderDirty = function (rect) {
    if (!rect) { return; }
    R.layer(this.x.hl, this.vp, this.dpr, this.strokes, 'h', rect);
    R.layer(this.x.ink, this.vp, this.dpr, this.strokes, 'p', rect);
  };

  P.clearLive = function () {
    var x = this.x.live;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, this.c.live.width, this.c.live.height);
  };

  // ---------- frame loop (runs only during a gesture) ----------

  P.requestFrame = function () {
    this.needsFrame = true;
    if (this.rafId !== null) { return; }
    var self = this;
    this.rafId = U.raf(function (t) { self.rafId = null; self.frame(t); });
  };

  P.frame = function () {
    if (!this.needsFrame) { return; }
    this.needsFrame = false;
    var t0 = U.perfNow();
    if (this.lastFrameT) {
      var dt = t0 - this.lastFrameT;
      if (dt > 0 && dt < 1000) { K.stats.fps = Math.round(K.stats.fps * 0.8 + (1000 / dt) * 0.2); }
    }
    this.lastFrameT = t0;
    if (this.cur) { this.drawLive(); }
    else if (this.erase || this.hoverPt) { this.drawEraserCursor(); }
    else if (this.pinch && this.pinch.k !== undefined) { this.applyCss(this.pinch.tx, this.pinch.ty, this.pinch.k); }
    else if (this.panState) { this.applyCss(this.panState.dx, this.panState.dy, 1); }
    K.stats.frameMs = Math.round((U.perfNow() - t0) * 10) / 10;
  };

  P.liveCtx = function () {
    var x = this.x.live;
    R.pageTransform(x, this.vp, this.dpr);
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.strokeStyle = this.cur.c;
    x.lineWidth = this.cur.w;
    return x;
  };

  P.drawLive = function () {
    var s = this.cur, p = s.pts, n = p.length / 2, x;
    if (s.t === 'h') {
      // re-stroke the whole highlighter path each frame (no overlap darkening)
      this.clearLive();
      x = this.liveCtx();
      x.save();
      R.clipToPage(x, this.vp);
      x.globalAlpha = 0.4;
      x.beginPath();
      R.trace(x, p);
      x.stroke();
      x.restore();
      return;
    }
    // pen: append only the new curve segments
    x = this.liveCtx();
    x.save();
    R.clipToPage(x, this.vp);
    x.beginPath();
    if (n <= 2) {
      // just a dot at the start until there is enough for a curve
      x.moveTo(p[0], p[1]);
      x.lineTo(p[0] + 0.01, p[1]);
      x.stroke();
      x.restore();
      return;
    }
    var from = Math.max(1, s.drawn + 1);
    var any = false;
    for (var i = from; i <= n - 2; i++) {
      var sx = i === 1 ? p[0] : (p[(i - 1) * 2] + p[i * 2]) / 2;
      var sy = i === 1 ? p[1] : (p[(i - 1) * 2 + 1] + p[i * 2 + 1]) / 2;
      x.moveTo(sx, sy);
      x.quadraticCurveTo(p[i * 2], p[i * 2 + 1], (p[i * 2] + p[i * 2 + 2]) / 2, (p[i * 2 + 1] + p[i * 2 + 3]) / 2);
      any = true;
      s.drawn = i;
    }
    if (any) { x.stroke(); }
    x.restore();
  };

  P.drawEraserCursor = function () {
    this.clearLive();
    var pt = this.erase ? this.erase.last : this.hoverPt;
    if (!pt || this.tool.tool !== 'eraser') { return; }
    var x = this.x.live;
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    var r = this.tool.size * this.vp.scale;
    x.beginPath();
    x.arc(pt.sx, pt.sy, Math.max(2, r), 0, 6.2832);
    x.lineWidth = 1;
    x.strokeStyle = 'rgba(90,90,90,0.8)';
    x.stroke();
  };

  // ---------- input handlers ----------

  P.down = function (sx, sy, kind) {
    if (this.pinch) { return; }
    var tool = this.tool.tool;
    if (this.readOnly || tool === 'hand' || (this.input.spaceHeld && kind !== 'touch')) {
      this.panState = { lx: sx, ly: sy, dx: 0, dy: 0 };
      return;
    }
    var pt = this.vp.toPage(sx, sy);
    if (tool === 'eraser') {
      this.erase = { steps: [], dirty: null, last: { x: pt.x, y: pt.y, sx: sx, sy: sy } };
      this.eraseAt(pt.x, pt.y);
      this.requestFrame();
      return;
    }
    this.cur = {
      t: tool === 'highlighter' ? 'h' : 'p',
      c: this.tool.color,
      w: this.tool.size,
      pts: [pt.x, pt.y],
      drawn: 0
    };
    this.lastFrameT = 0;
    this.requestFrame();
  };

  P.move = function (sx, sy) {
    if (this.panState) {
      this.panState.dx += sx - this.panState.lx;
      this.panState.dy += sy - this.panState.ly;
      this.panState.lx = sx; this.panState.ly = sy;
      this.requestFrame();
      return;
    }
    var pt = this.vp.toPage(sx, sy);
    if (this.erase) {
      var last = this.erase.last;
      var dx = pt.x - last.x, dy = pt.y - last.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var step = Math.max(1, this.tool.size / 2);
      var n = Math.ceil(d / step);
      for (var i = 1; i <= n; i++) { this.eraseAt(last.x + dx * i / n, last.y + dy * i / n); }
      this.erase.last = { x: pt.x, y: pt.y, sx: sx, sy: sy };
      this.requestFrame();
      return;
    }
    if (!this.cur) { return; }
    var p = this.cur.pts, L = p.length;
    var ex = pt.x - p[L - 2], ey = pt.y - p[L - 1];
    var min = 0.8 / this.vp.scale;
    if (ex * ex + ey * ey < min * min) { return; }
    p.push(pt.x, pt.y);
    this.requestFrame();
  };

  P.up = function () {
    if (this.panState) { this.endPan(); return; }
    if (this.erase) { this.endErase(); return; }
    if (this.cur) { this.commit(); }
  };

  P.cancel = function () {
    this.cur = null;
    if (this.erase) { this.endErase(); }
    if (this.panState) { this.endPan(); }
    this.clearLive();
  };

  P.hover = function (sx, sy) {
    if (this.tool.tool !== 'eraser' || this.erase) { if (this.hoverPt) { this.hoverPt = null; this.clearLive(); } return; }
    this.hoverPt = { sx: sx, sy: sy };
    this.requestFrame();
  };

  // ---------- commit ----------

  P.commit = function () {
    var t0 = U.perfNow();
    var s = this.cur;
    this.cur = null;
    var pts = s.pts;
    if (pts.length > 4) { pts = G.simplify(pts, 0.35); }
    pts = G.resample(pts, 4);
    var stroke = G.finishStroke({ id: U.strokeId(), t: s.t, c: s.c, w: s.w, pts: pts });
    this.strokes.push(stroke);
    R.one(s.t === 'h' ? this.x.hl : this.x.ink, this.vp, this.dpr, stroke);
    this.clearLive();
    this.history.push({ type: 'add', stroke: stroke });
    K.stats.commitMs = Math.round((U.perfNow() - t0) * 10) / 10;
    this.changed();
  };

  // ---------- eraser ----------

  P.eraseAt = function (x, y) {
    var res = K.eraser.apply(this.strokes, x, y, this.tool.size, this.tool.eraserMode);
    if (!res.steps.length) { return; }
    for (var i = 0; i < res.steps.length; i++) { this.erase.steps.push(res.steps[i]); }
    this.renderDirty(res.dirty);
    this.erase.dirty = G.union(this.erase.dirty, res.dirty);
  };

  P.endErase = function () {
    var e = this.erase;
    this.erase = null;
    this.clearLive();
    if (e && e.steps.length) {
      this.history.push({ type: 'erase', steps: e.steps });
      this.changed();
    }
  };

  // ---------- pan / pinch (CSS transform during, re-render after) ----------

  P.applyCss = function (tx, ty, k) {
    var v = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + k + ')';
    this.layers.style.webkitTransform = v;
    this.layers.style.transform = v;
  };

  P.resetCss = function () {
    this.layers.style.webkitTransform = '';
    this.layers.style.transform = '';
  };

  P.endPan = function () {
    var ps = this.panState;
    this.panState = null;
    if (!ps) { return; }
    this.resetCss();
    if (ps.dx || ps.dy) { this.vp.pan(ps.dx, ps.dy); this.render(); }
  };

  P.pan = function (dx, dy) { // mouse pan (middle button / space-drag)
    this.vp.pan(dx, dy);
    this.scheduleRender();
  };
  P.panEnd = function () {};

  P.gestureStart = function (a, b) {
    if (this.cur) { this.cur = null; this.clearLive(); }
    if (this.erase) { this.endErase(); }
    if (this.panState) { this.endPan(); }
    var dx = b.x - a.x, dy = b.y - a.y;
    this.pinch = {
      start: this.vp.snapshot(),
      d0: Math.max(10, Math.sqrt(dx * dx + dy * dy)),
      m0x: (a.x + b.x) / 2, m0y: (a.y + b.y) / 2
    };
  };

  P.gestureMove = function (a, b) {
    var g = this.pinch;
    if (!g) { return; }
    var dx = b.x - a.x, dy = b.y - a.y;
    var d = Math.max(10, Math.sqrt(dx * dx + dy * dy));
    var k = d / g.d0;
    var s = U.clamp(g.start.scale * k, this.vp.minScale(), this.vp.maxScale());
    k = s / g.start.scale;
    g.k = k;
    g.mx = (a.x + b.x) / 2; g.my = (a.y + b.y) / 2;
    g.tx = g.mx - k * g.m0x;
    g.ty = g.my - k * g.m0y;
    this.requestFrame();
  };

  P.gestureEnd = function () {
    var g = this.pinch;
    this.pinch = null;
    this.resetCss();
    if (!g || g.k === undefined) { return; }
    this.vp.applyPinch(g.start, g.k, g.m0x, g.m0y, g.mx, g.my);
    this.render();
  };

  P.wheel = function (dx, dy, zoom, x, y) {
    if (zoom) {
      this.vp.zoomAt(this.vp.scale * Math.exp(-dy * 0.0025), x, y);
    } else {
      this.vp.pan(-dx, -dy);
    }
    this.scheduleRender();
  };

  P.scheduleRender = function () {
    if (this.renderPending) { return; }
    this.renderPending = true;
    var self = this;
    U.raf(function () { self.renderPending = false; self.render(); });
  };

  // ---------- commands ----------

  P.undo = function () {
    if (this.cur || this.erase) { return; }
    var r = this.history.undo(this.strokes);
    if (!r) { return; }
    if (r.full) { this.render(); } else { this.renderDirty(r.dirty); }
    this.changed();
  };

  P.redo = function () {
    if (this.cur || this.erase) { return; }
    var r = this.history.redo(this.strokes);
    if (!r) { return; }
    if (r.full) { this.render(); } else { this.renderDirty(r.dirty); }
    this.changed();
  };

  P.clear = function () {
    if (!this.strokes.length) { return; }
    this.history.push({ type: 'clear', strokes: this.strokes.slice() });
    this.strokes.length = 0;
    this.render();
    this.changed();
  };

  P.zoomStep = function (dir) { this.vp.stepZoom(dir); this.render(); };
  P.fit = function (mode) { this.vp.fit(mode); this.render(); };
  P.zoomPct = function () { return this.vp.zoomPct(); };

  P.destroy = function () {
    this.input.destroy();
    if (this.rafId !== null) { U.caf(this.rafId); }
    // release canvas memory promptly (matters on iOS)
    for (var k in this.c) {
      if (Object.prototype.hasOwnProperty.call(this.c, k)) { this.c[k].width = 0; this.c[k].height = 0; }
    }
    D.remove(this.layers);
  };

  K.Engine = Engine;
})(window.Kagoj = window.Kagoj || {});
