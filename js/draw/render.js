(function (K) {
  'use strict';

  var G = K.geom;
  var R = {};

  R.DESK = '#ECEAE4';
  R.PAPER = '#FDFCF8';
  var PATTERN = {
    ruled: { step: 36, first: 110, color: '#C9D6E8', margin: 90, marginColor: '#E8B4B4' },
    grid: { step: 36, color: '#DCE3EC' },
    dotted: { step: 36, r: 1.6, color: '#B8C2CE' }
  };

  R.sizeCanvas = function (c, w, h, dpr) {
    var bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (c.width !== bw) { c.width = bw; }
    if (c.height !== bh) { c.height = bh; }
    c.style.width = w + 'px';
    c.style.height = h + 'px';
  };

  R.pageTransform = function (ctx, vp, dpr) {
    ctx.setTransform(dpr * vp.scale, 0, 0, dpr * vp.scale, dpr * vp.ox, dpr * vp.oy);
  };

  R.clipToPage = function (ctx, vp) {
    ctx.beginPath();
    ctx.rect(0, 0, vp.pw, vp.ph);
    ctx.clip();
  };

  // Midpoint quadratic smoothing (identical for live and committed strokes)
  R.trace = function (ctx, p) {
    var n = p.length / 2;
    if (n === 0) { return; }
    ctx.moveTo(p[0], p[1]);
    if (n === 1) { ctx.lineTo(p[0] + 0.01, p[1]); return; }
    if (n === 2) { ctx.lineTo(p[2], p[3]); return; }
    for (var i = 1; i < n - 1; i++) {
      var cx = p[i * 2], cy = p[i * 2 + 1];
      var mx = (cx + p[i * 2 + 2]) / 2, my = (cy + p[i * 2 + 3]) / 2;
      ctx.quadraticCurveTo(cx, cy, mx, my);
    }
    ctx.lineTo(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
  };

  // ---------- paper ----------

  function drawImg(ctx, item, x, y, w, h) {
    if (item && item.img && item.img !== 'error') {
      try { ctx.drawImage(item.img, x, y, w, h); return; } catch (e) { /* fall through */ }
    }
    ctx.fillStyle = item && item.img === 'error' ? '#F3E3E1' : '#EFEDE7';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#DAD7CF';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  }

  // extras: { bg: {img}|null, imgs: [{x, y, w, h, img}] }
  R.paper = function (ctx, vp, style, dpr, extras) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = R.DESK;
    ctx.fillRect(0, 0, vp.w, vp.h);
    var x = vp.ox, y = vp.oy, pw = vp.pw * vp.scale, ph = vp.ph * vp.scale;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 3 * dpr;
    ctx.shadowOffsetY = 1 * dpr;
    ctx.fillStyle = R.PAPER;
    ctx.fillRect(x, y, pw, ph);
    ctx.restore();

    var pat = PATTERN[style];
    var s = vp.scale;
    if (extras && extras.bg) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, pw, ph); ctx.clip();
      drawImg(ctx, extras.bg, x, y, pw, ph);
      ctx.restore();
    }
    if (pat) { R.pattern(ctx, vp, style, dpr, pat); }
    if (extras && extras.imgs && extras.imgs.length) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, pw, ph); ctx.clip();
      for (var m = 0; m < extras.imgs.length; m++) {
        var it = extras.imgs[m];
        drawImg(ctx, it, it.x * s + vp.ox, it.y * s + vp.oy, it.w * s, it.h * s);
      }
      ctx.restore();
    }
  };

  R.drawImg = drawImg;

  R.pattern = function (ctx, vp, style, dpr, pat) {
    var x = vp.ox, y = vp.oy, pw = vp.pw * vp.scale, ph = vp.ph * vp.scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, pw, ph);
    ctx.clip();
    var s = vp.scale;
    // visible page range
    var y0 = Math.max(0, -vp.oy / s), y1 = Math.min(vp.ph, (vp.h - vp.oy) / s);
    var x0 = Math.max(0, -vp.ox / s), x1 = Math.min(vp.pw, (vp.w - vp.ox) / s);
    var half = 0.5 / dpr;
    var k, sy, sx;
    ctx.lineWidth = 1 / dpr;
    if (style === 'ruled' || style === 'grid') {
      ctx.strokeStyle = pat.color;
      ctx.beginPath();
      var startY = style === 'ruled' ? pat.first : pat.step;
      k = Math.max(0, Math.ceil((y0 - startY) / pat.step));
      for (var py = startY + k * pat.step; py <= y1; py += pat.step) {
        sy = Math.round((py * s + vp.oy) * dpr) / dpr + half;
        ctx.moveTo(x, sy); ctx.lineTo(x + pw, sy);
      }
      if (style === 'grid') {
        k = Math.max(1, Math.ceil(x0 / pat.step));
        for (var px = k * pat.step; px <= x1; px += pat.step) {
          sx = Math.round((px * s + vp.ox) * dpr) / dpr + half;
          ctx.moveTo(sx, y); ctx.lineTo(sx, y + ph);
        }
      }
      ctx.stroke();
      if (style === 'ruled') {
        ctx.strokeStyle = pat.marginColor;
        ctx.beginPath();
        sx = Math.round((pat.margin * s + vp.ox) * dpr) / dpr + half;
        ctx.moveTo(sx, y); ctx.lineTo(sx, y + ph);
        ctx.stroke();
      }
    } else if (style === 'dotted') {
      ctx.fillStyle = pat.color;
      var r = Math.max(0.8, Math.min(2.5, pat.r * s));
      ctx.beginPath();
      var ky = Math.max(1, Math.ceil(y0 / pat.step)), kx = Math.max(1, Math.ceil(x0 / pat.step));
      for (var dy = ky * pat.step; dy <= y1; dy += pat.step) {
        sy = dy * s + vp.oy;
        for (var dx = kx * pat.step; dx <= x1; dx += pat.step) {
          sx = dx * s + vp.ox;
          ctx.moveTo(sx + r, sy);
          ctx.arc(sx, sy, r, 0, 6.2832);
        }
      }
      ctx.fill();
    }
    ctx.restore();
  };

  // ---------- strokes ----------

  // Draw strokes of one type ('p' or 'h'), batched by colour+width.
  // Assumes the page transform is already set on ctx.
  R.strokes = function (ctx, list, type, rect) {
    var batches = {}, order = [], i, s, key;
    for (i = 0; i < list.length; i++) {
      s = list[i];
      if (s.t !== type) { continue; }
      if (rect && !G.intersects(s.bb, rect)) { continue; }
      key = s.c + '|' + s.w;
      if (!batches[key]) { batches[key] = []; order.push(key); }
      batches[key].push(s);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (i = 0; i < order.length; i++) {
      var b = batches[order[i]];
      ctx.strokeStyle = b[0].c;
      ctx.lineWidth = b[0].w;
      ctx.beginPath();
      for (var j = 0; j < b.length; j++) { R.trace(ctx, b[j].pts); }
      ctx.stroke();
    }
  };

  // Redraw a committed layer. dirty: page-space rect or null for everything.
  R.layer = function (ctx, vp, dpr, strokes, type, dirty) {
    var vis = vp.visibleRect();
    var rect = dirty ? (G.intersects(dirty, vis) ? dirty : null) : vis;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!dirty) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    } else {
      if (!rect) { ctx.restore(); return; }
      // device-pixel rect, rounded outward
      var x0 = Math.floor((rect.minX * vp.scale + vp.ox) * dpr) - 1;
      var y0 = Math.floor((rect.minY * vp.scale + vp.oy) * dpr) - 1;
      var x1 = Math.ceil((rect.maxX * vp.scale + vp.ox) * dpr) + 1;
      var y1 = Math.ceil((rect.maxY * vp.scale + vp.oy) * dpr) + 1;
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
      // widen to cover anti-aliasing of neighbours
      rect = G.expand(rect, 2 / vp.scale);
    }
    R.pageTransform(ctx, vp, dpr);
    R.clipToPage(ctx, vp);
    R.strokes(ctx, strokes, type, rect);
    ctx.restore();
  };

  // Draw a single stroke on top of a layer (commit fast-path)
  R.one = function (ctx, vp, dpr, s) {
    ctx.save();
    R.pageTransform(ctx, vp, dpr);
    R.clipToPage(ctx, vp);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.c;
    ctx.lineWidth = s.w;
    ctx.beginPath();
    R.trace(ctx, s.pts);
    ctx.stroke();
    ctx.restore();
  };

  K.render = R;
})(window.Kagoj = window.Kagoj || {});
