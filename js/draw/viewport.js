(function (K) {
  'use strict';

  // View transform: screenX = pageX * scale + ox (canvas-relative CSS px).
  var U = K.util;
  var STEPS = [50, 75, 100, 150, 200, 300, 400];

  function Viewport() {
    this.w = 0; this.h = 0;
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.pw = K.config.pageW; this.ph = K.config.pageH;
    this.mode = 'width'; // default fit mode
  }

  Viewport.prototype.margin = function () { return this.w < 600 ? 8 : 24; };

  Viewport.prototype.fitWidthScale = function () {
    return Math.max(0.05, (this.w - 2 * this.margin()) / this.pw);
  };
  Viewport.prototype.fitPageScale = function () {
    var m = this.margin();
    return Math.max(0.05, Math.min((this.w - 2 * m) / this.pw, (this.h - 2 * m) / this.ph));
  };
  Viewport.prototype.minScale = function () {
    return Math.min(this.fitWidthScale() * 0.5, this.fitPageScale());
  };
  Viewport.prototype.maxScale = function () { return this.fitWidthScale() * 4; };

  Viewport.prototype.resize = function (w, h) {
    var hadSize = this.w > 0;
    var cx = this.w / 2, cy = this.h / 2;
    var pageCx = (cx - this.ox) / this.scale, pageCy = (cy - this.oy) / this.scale;
    var relZoom = hadSize ? this.scale / this.fitWidthScale() : 0;
    this.w = w; this.h = h;
    if (!hadSize) { this.fit(); return; }
    // keep the same relative zoom and centre point (e.g. on rotation)
    this.scale = U.clamp(relZoom * this.fitWidthScale(), this.minScale(), this.maxScale());
    this.ox = w / 2 - pageCx * this.scale;
    this.oy = h / 2 - pageCy * this.scale;
    this.clamp();
  };

  // mode: 'width' | 'page'
  Viewport.prototype.fit = function (mode) {
    mode = mode || this.mode;
    var m = this.margin();
    if (mode === 'page') {
      this.scale = this.fitPageScale();
      this.ox = (this.w - this.pw * this.scale) / 2;
      this.oy = Math.max(m, (this.h - this.ph * this.scale) / 2);
    } else {
      this.scale = this.fitWidthScale();
      this.ox = m;
      this.oy = m;
    }
    this.clamp();
  };

  Viewport.prototype.clampAxis = function (o, pageLen, viewLen) {
    if (pageLen + 200 <= viewLen) { return (viewLen - pageLen) / 2; }
    return U.clamp(o, viewLen - pageLen - 100, 100);
  };

  Viewport.prototype.clamp = function () {
    this.ox = this.clampAxis(this.ox, this.pw * this.scale, this.w);
    this.oy = this.clampAxis(this.oy, this.ph * this.scale, this.h);
  };

  Viewport.prototype.zoomPct = function () {
    return Math.round(this.scale / this.fitWidthScale() * 100);
  };

  // Zoom to an absolute scale around screen point (sx, sy)
  Viewport.prototype.zoomAt = function (newScale, sx, sy) {
    newScale = U.clamp(newScale, this.minScale(), this.maxScale());
    var px = (sx - this.ox) / this.scale, py = (sy - this.oy) / this.scale;
    this.scale = newScale;
    this.ox = sx - px * newScale;
    this.oy = sy - py * newScale;
    this.clamp();
  };

  Viewport.prototype.zoomToPct = function (pct) {
    this.zoomAt(this.fitWidthScale() * pct / 100, this.w / 2, this.h / 2);
  };

  Viewport.prototype.stepZoom = function (dir) {
    var cur = this.zoomPct(), i, target = null;
    if (dir > 0) {
      for (i = 0; i < STEPS.length; i++) { if (STEPS[i] > cur + 1) { target = STEPS[i]; break; } }
    } else {
      for (i = STEPS.length - 1; i >= 0; i--) { if (STEPS[i] < cur - 1) { target = STEPS[i]; break; } }
    }
    if (target !== null) { this.zoomToPct(target); }
  };

  Viewport.prototype.pan = function (dx, dy) {
    this.ox += dx; this.oy += dy;
    this.clamp();
  };

  Viewport.prototype.toPage = function (sx, sy) {
    return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale };
  };

  // Visible page-space rectangle
  Viewport.prototype.visibleRect = function () {
    return {
      minX: -this.ox / this.scale, minY: -this.oy / this.scale,
      maxX: (this.w - this.ox) / this.scale, maxY: (this.h - this.oy) / this.scale
    };
  };

  Viewport.prototype.snapshot = function () {
    return { scale: this.scale, ox: this.ox, oy: this.oy };
  };

  // Apply pinch result: k = scale factor, mapping p -> k*p + (mid - k*mid0)
  Viewport.prototype.applyPinch = function (start, k, mid0x, mid0y, midx, midy) {
    var s = U.clamp(start.scale * k, this.minScale(), this.maxScale());
    k = s / start.scale;
    this.scale = s;
    this.ox = k * start.ox + (midx - k * mid0x);
    this.oy = k * start.oy + (midy - k * mid0y);
    this.clamp();
  };

  Viewport.STEPS = STEPS;
  K.Viewport = Viewport;
})(window.Kagoj = window.Kagoj || {});
