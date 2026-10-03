(function (K) {
  'use strict';

  var U = K.util, D = K.dom, G = K.geom, R = K.render;
  var HANDLE = 26; // screen px for the resize handle hit area

  // One page on screen. Four stacked viewport-sized canvases:
  // paper (+ background / placed images), highlight (CSS opacity 0.4), ink, live.
  function Engine(host, opts) {
    this.host = host;
    this.opts = opts || {};
    this.vp = new K.Viewport();
    this.dpr = U.dpr();
    this.strokes = [];
    this.imgs = [];          // placed images {id, a, x, y, w, h}
    this.bgPath = null;      // page background (uploaded PDF page / photo)
    this.assets = {};        // path -> HTMLImageElement | 'error'
    this.history = new K.History();
    this.paperStyle = 'ruled';
    this.pageId = null;
    this.tool = { tool: 'pen', color: '#1F1F1F', size: 3.5, eraserMode: 'partial' };
    this.readOnly = false;
    this.cur = null;       // stroke being drawn
    this.erase = null;     // eraser gesture
    this.panState = null;
    this.pinch = null;
    this.sel = null;       // selected image id
    this.drag = null;      // image move/resize gesture
    this.rafId = null;
    this.needsFrame = false;
    this.lastFrameT = 0;
    this.hoverPt = null;
    this.band = { on: false, n: 4, y: 0 };  // writing band (palm rejection)
    this.bandY = {};                           // band position per page

    this.layers = D.el('div.layers');
    this.c = {
      paper: D.el('canvas.layer.layer-paper'),
      hl: D.el('canvas.layer.layer-hl'),
      ink: D.el('canvas.layer.layer-ink'),
      live: D.el('canvas.layer.layer-live')
    };
    D.append(this.layers, [this.c.paper, this.c.hl, this.c.ink, this.c.live]);
    host.appendChild(this.layers);
    this.buildBand();
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

  // opts: { bg: storage path of the page background }
  P.setPage = function (pageId, drawing, paper, history, fitMode, opts) {
    this.cancel();
    this.setSelection(null);
    this.pageId = pageId;
    this.strokes = K.codec.decode(drawing);
    this.imgs = K.codec.decodeImgs(drawing);
    this.vp.pw = (drawing && drawing.w) || K.config.pageW;
    this.vp.ph = (drawing && drawing.h) || K.config.pageH;
    this.bgPath = (opts && opts.bg) || null;
    this.assets = {};
    this.history = history || new K.History();
    this.paperStyle = paper || 'ruled';
    if (fitMode) { this.vp.fit(fitMode); } else { this.vp.clamp(); }
    this.band.y = this.bandY[pageId] !== undefined ? this.bandY[pageId] : K.band.initial(this.band.n, this.vp.ph);
    if (this.band.on) { this.ensureBandVisible(true); }
    this.updateStats();
    this.render();
    this.notifyHistory();
    this.loadAssets();
  };

  // Load background + placed images, re-rendering the paper layer as each arrives.
  P.loadAssets = function () {
    var self = this, page = this.pageId;
    var paths = [];
    if (this.bgPath) { paths.push(this.bgPath); }
    for (var i = 0; i < this.imgs.length; i++) {
      if (paths.indexOf(this.imgs[i].a) < 0) { paths.push(this.imgs[i].a); }
    }
    paths.forEach(function (p) {
      if (self.assets[p]) { return; }
      K.Assets.get(p, function (err, img) {
        if (self.pageId !== page || self.destroyed) { return; }
        self.assets[p] = err ? 'error' : img;
        if (err) { K.log.warn('image not available: ' + (err.message || err)); }
        self.renderPaper();
        if (self.sel) { self.drawSelection(); }
      });
    });
  };

  P.setPaper = function (p) { this.paperStyle = p; this.renderPaper(); };

  P.setTool = function (t) {
    U.extend(this.tool, t);
    if (this.tool.tool !== 'select') { this.setSelection(null); }
    this.clearLive();
    if (this.sel) { this.drawSelection(); }
    if (this.opts.onCursor) { this.opts.onCursor(this.tool.tool); }
  };

  P.setReadOnly = function (b) { this.readOnly = !!b; this.cancel(); this.setSelection(null); this.positionBand(); };

  P.getDrawing = function () { return K.codec.encode(this.strokes, this.vp.pw, this.vp.ph, this.imgs); };

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

  P.paperExtras = function () {
    var self = this, hide = this.drag ? this.drag.id : null;
    var imgs = [];
    for (var i = 0; i < this.imgs.length; i++) {
      var m = this.imgs[i];
      if (m.id === hide) { continue; }
      imgs.push({ x: m.x, y: m.y, w: m.w, h: m.h, img: self.assets[m.a] || null });
    }
    return { bg: this.bgPath ? { img: this.assets[this.bgPath] || null } : null, imgs: imgs };
  };

  P.renderPaper = function () {
    R.paper(this.x.paper, this.vp, this.paperStyle, this.dpr, this.paperExtras());
  };

  P.render = function () {
    if (!this.vp.w) { return; }
    var t0 = U.perfNow();
    this.renderPaper();
    R.layer(this.x.hl, this.vp, this.dpr, this.strokes, 'h', null);
    R.layer(this.x.ink, this.vp, this.dpr, this.strokes, 'p', null);
    this.clearLive();
    if (this.sel) { this.drawSelection(); }
    this.positionBand();
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
    else if (this.drag) { this.drawSelection(); }
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

  // ---------- placed images: selection ----------

  P.imgById = function (id) {
    for (var i = 0; i < this.imgs.length; i++) { if (this.imgs[i].id === id) { return this.imgs[i]; } }
    return null;
  };

  P.setSelection = function (id) {
    if (this.sel === id) { return; }
    this.sel = id;
    if (!id) { this.clearLive(); } else { this.drawSelection(); }
    if (this.opts.onSelect) { this.opts.onSelect(id); }
  };

  // Screen rect of a page-space rect
  P.screenRect = function (r) {
    var s = this.vp.scale;
    return { x: r.x * s + this.vp.ox, y: r.y * s + this.vp.oy, w: r.w * s, h: r.h * s };
  };

  P.drawSelection = function () {
    this.clearLive();
    var m = this.drag ? this.drag.rect : this.imgById(this.sel);
    if (!m) { return; }
    var x = this.x.live;
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    var r = this.screenRect(m);
    if (this.drag) {
      var src = this.imgById(this.drag.id);
      x.globalAlpha = 0.85;
      R.drawImg(x, { img: src ? this.assets[src.a] : null }, r.x, r.y, r.w, r.h);
      x.globalAlpha = 1;
    }
    x.lineWidth = 2;
    x.strokeStyle = '#2F5DA8';
    x.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h));
    // resize handle (bottom-right)
    x.fillStyle = '#FFFFFF';
    x.beginPath();
    x.arc(r.x + r.w, r.y + r.h, 9, 0, 6.2832);
    x.fill();
    x.stroke();
  };

  P.hitImage = function (sx, sy) {
    for (var i = this.imgs.length - 1; i >= 0; i--) {
      var r = this.screenRect(this.imgs[i]);
      if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) { return this.imgs[i]; }
    }
    return null;
  };

  P.selectDown = function (sx, sy) {
    var cur = this.imgById(this.sel);
    if (cur) {
      var r = this.screenRect(cur);
      if (Math.abs(sx - (r.x + r.w)) < HANDLE && Math.abs(sy - (r.y + r.h)) < HANDLE) {
        this.startDrag(cur, 'resize', sx, sy);
        return;
      }
    }
    var hit = this.hitImage(sx, sy);
    if (!hit) { this.setSelection(null); return; }
    this.setSelection(hit.id);
    this.startDrag(hit, 'move', sx, sy);
  };

  P.startDrag = function (m, mode, sx, sy) {
    this.drag = { id: m.id, mode: mode, sx: sx, sy: sy, r0: { x: m.x, y: m.y, w: m.w, h: m.h }, rect: { x: m.x, y: m.y, w: m.w, h: m.h }, moved: false };
    this.renderPaper(); // without the dragged image; it follows the finger on the live layer
    this.drawSelection();
  };

  P.dragMove = function (sx, sy) {
    var d = this.drag, s = this.vp.scale;
    var dx = (sx - d.sx) / s, dy = (sy - d.sy) / s;
    if (Math.abs(sx - d.sx) + Math.abs(sy - d.sy) > 2) { d.moved = true; }
    if (d.mode === 'move') {
      d.rect.x = d.r0.x + dx;
      d.rect.y = d.r0.y + dy;
    } else {
      var w = Math.max(40, d.r0.w + dx);
      d.rect.w = w;
      d.rect.h = w * d.r0.h / d.r0.w;
    }
    this.requestFrame();
  };

  P.endDrag = function () {
    var d = this.drag;
    this.drag = null;
    var m = this.imgById(d.id);
    if (m && d.moved) {
      var before = d.r0, after = { x: d.rect.x, y: d.rect.y, w: d.rect.w, h: d.rect.h };
      m.x = after.x; m.y = after.y; m.w = after.w; m.h = after.h;
      this.history.push({ type: 'img-set', id: m.id, before: before, after: after });
      this.changed();
    }
    this.renderPaper();
    this.drawSelection();
  };

  // Place images on the current page: list of {a, ratio} (ratio = h / w)
  P.addImages = function (list) {
    var added = [];
    var w = this.vp.pw * 0.6;
    for (var i = 0; i < list.length; i++) {
      var h = w * (list[i].ratio || 0.75);
      var off = 30 * i;
      added.push({
        id: 'i_' + U.strokeId().substr(2), a: list[i].a,
        x: (this.vp.pw - w) / 2 + off, y: Math.max(20, (this.vp.ph - h) / 4) + off, w: w, h: h
      });
    }
    for (var j = 0; j < added.length; j++) { this.imgs.push(added[j]); }
    this.history.push({ type: 'img-add', imgs: added });
    this.loadAssets();
    this.renderPaper();
    this.changed();
    if (added.length) { this.setSelection(added[added.length - 1].id); }
  };

  P.deleteSelected = function () {
    var id = this.sel;
    if (!id) { return; }
    for (var i = 0; i < this.imgs.length; i++) {
      if (this.imgs[i].id === id) {
        var img = this.imgs.splice(i, 1)[0];
        this.history.push({ type: 'img-del', img: img, i: i });
        break;
      }
    }
    this.setSelection(null);
    this.renderPaper();
    this.changed();
  };

  // ---------- input handlers ----------

  P.down = function (sx, sy, kind) {
    if (this.pinch) { return; }
    var tool = this.tool.tool;
    if (this.readOnly || tool === 'hand' || kind === 'finger-pan' || (this.input.spaceHeld && kind !== 'touch')) {
      this.panState = { lx: sx, ly: sy, dx: 0, dy: 0 };
      return;
    }
    if (tool === 'select') { this.selectDown(sx, sy); return; }
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
    if (this.drag) { this.dragMove(sx, sy); return; }
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
    if (this.drag) { this.endDrag(); return; }
    if (this.erase) { this.endErase(); return; }
    if (this.cur) { this.commit(); }
  };

  P.cancel = function () {
    this.cur = null;
    if (this.erase) { this.endErase(); }
    if (this.panState) { this.endPan(); }
    if (this.drag) { this.drag = null; this.renderPaper(); }
    this.clearLive();
    if (this.sel) { this.drawSelection(); }
  };

  P.hover = function (sx, sy) {
    if (this.tool.tool !== 'eraser' || this.erase) { if (this.hoverPt) { this.hoverPt = null; this.clearLive(); } return; }
    this.hoverPt = { sx: sx, sy: sy };
    this.requestFrame();
  };

  P.onStylus = function () { if (this.opts.onStylus) { this.opts.onStylus(); } };

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
    if (this.drag) { this.drag = null; this.renderPaper(); }
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

  // ---------- writing band ----------

  P.buildBand = function () {
    var self = this;
    var up = D.button({ icon: 'chevron-up', title: 'Move band up', cls: 'band-btn' });
    var down = D.button({ icon: 'chevron-down', title: 'Next lines', cls: 'band-btn' });
    var grip = D.el('div.band-grip', { title: 'Drag to move the band' }, D.icon('grip'));
    D.tap(up, function () { self.bandStep(-1); });
    D.tap(down, function () { self.bandStep(1); });
    var ctl = D.el('div.band-ctl', null, [up, grip, down]);
    // the controls must never reach the drawing input underneath
    ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointermove', 'pointerup', 'mousedown'].forEach(function (ev) {
      D.on(ctl, ev, function (e) { e.stopPropagation(); });
    });
    var startY = 0, startBand = 0, dragging = false;
    function y(e) { return e.touches ? e.touches[0].clientY : e.clientY; }
    function dDown(e) {
      if (e.cancelable) { e.preventDefault(); }
      dragging = true; startY = y(e); startBand = self.band.y;
    }
    function dMove(e) {
      if (!dragging) { return; }
      if (e.cancelable) { e.preventDefault(); }
      var maxY = Math.max(0, self.vp.ph - K.band.height(self.band.n));
      self.band.y = U.clamp(startBand + (y(e) - startY) / self.vp.scale, 0, maxY);
      self.positionBand();
    }
    function dUp() {
      if (!dragging) { return; }
      dragging = false;
      self.band.y = K.band.snap(self.band.y, self.band.n, self.vp.ph);
      self.bandY[self.pageId] = self.band.y;
      self.positionBand();
    }
    D.on(grip, 'touchstart', dDown, D.passiveFalse);
    D.on(grip, 'touchmove', dMove, D.passiveFalse);
    D.on(grip, 'touchend', dUp);
    D.on(grip, 'mousedown', dDown);
    this.unbindBand = [D.on(window, 'mousemove', dMove), D.on(window, 'mouseup', dUp)];
    this.bandCtl = ctl;
    this.bandEl = D.el('div.band', null, ctl);
    this.bandEl.style.display = 'none';
    this.layers.appendChild(this.bandEl);
  };

  P.setBand = function (on, n) {
    this.band.on = !!on;
    if (n && n !== this.band.n) {
      this.band.n = n;
      this.band.y = K.band.snap(this.band.y, n, this.vp.ph);
    }
    if (this.band.on) { this.ensureBandVisible(false); }
    this.positionBand();
  };

  P.positionBand = function () {
    var el = this.bandEl;
    if (!el) { return; }
    if (!this.band.on || this.readOnly) { el.style.display = 'none'; return; }
    var s = this.vp.scale;
    el.style.display = '';
    el.style.left = Math.round(this.vp.ox) + 'px';
    el.style.top = Math.round(this.vp.oy + this.band.y * s) + 'px';
    el.style.width = Math.round(this.vp.pw * s) + 'px';
    el.style.height = Math.round(K.band.height(this.band.n) * s) + 'px';
    // keep the controls on screen even when the page's left edge is scrolled away
    this.bandCtl.style.left = Math.max(6, 6 - Math.round(this.vp.ox)) + 'px';
    // controls sit above the band, or below it when there is no room
    this.bandCtl.classList.toggle('below', this.vp.oy + this.band.y * s < 52);
  };

  // Keep the band in a comfortable part of the screen; scroll the page if needed.
  P.ensureBandVisible = function (quiet) {
    var s = this.vp.scale, vh = this.vp.h;
    var top = this.vp.oy + this.band.y * s, bottom = top + K.band.height(this.band.n) * s;
    if (top < vh * 0.08 || bottom > vh * 0.78) {
      this.vp.oy = vh * 0.3 - this.band.y * s;
      this.vp.clamp();
      if (!quiet) { this.render(); return; }
    }
    this.positionBand();
  };

  P.bandStep = function (dir) {
    this.band.y = K.band.step(this.band.y, this.band.n, this.vp.ph, dir);
    this.bandY[this.pageId] = this.band.y;
    this.ensureBandVisible(false);
  };

  // Called by the input layer for every new touch.
  P.acceptsTouch = function (sx, sy) {
    if (!this.band.on || this.readOnly) { return true; }
    var t = this.tool.tool;
    if (t === 'hand' || t === 'select') { return true; }
    var py = (sy - this.vp.oy) / this.vp.scale;
    return K.band.contains(this.band.y, this.band.n, py, 6 / this.vp.scale);
  };

  // ---------- commands ----------

  P.applyHistory = function (r) {
    if (!r) { return; }
    if (r.paper) {
      if (this.sel && !this.imgById(this.sel)) { this.setSelection(null); }
      this.loadAssets();
      this.renderPaper();
      if (this.sel) { this.drawSelection(); }
    } else if (r.full) { this.render(); } else { this.renderDirty(r.dirty); }
    this.changed();
  };

  P.undo = function () {
    if (this.cur || this.erase || this.drag) { return; }
    this.applyHistory(this.history.undo(this.strokes, this.imgs));
  };

  P.redo = function () {
    if (this.cur || this.erase || this.drag) { return; }
    this.applyHistory(this.history.redo(this.strokes, this.imgs));
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
    this.destroyed = true;
    this.input.destroy();
    if (this.unbindBand) { this.unbindBand.forEach(function (f) { f(); }); }
    if (this.rafId !== null) { U.caf(this.rafId); }
    // release canvas memory promptly (matters on iOS)
    for (var k in this.c) {
      if (Object.prototype.hasOwnProperty.call(this.c, k)) { this.c[k].width = 0; this.c[k].height = 0; }
    }
    this.assets = {};
    D.remove(this.layers);
  };

  K.Engine = Engine;
})(window.Kagoj = window.Kagoj || {});
