(function (K) {
  'use strict';

  // Turns touch / pointer / mouse events into engine calls.
  // All palm-rejection style filtering (v2) belongs in this file.
  var D = K.dom;
  var U = K.util;
  var PENDING_MS = 100;
  var ACTIVATE_PX = 3;

  function Input(el, h) {
    this.el = el;
    this.h = h;            // handler: down, move, up, cancel, gestureStart/Move/End, wheel, pan
    this.state = 'idle';
    this.id = null;
    this.buf = [];
    this.timer = null;
    this.t0 = 0;
    this.g = null;         // gesture touch ids
    this.rect = null;
    this.spaceHeld = false;
    this.pencilOnly = false; // fingers pan, only an Apple Pencil writes
    this.guardPx = 0;        // wrist guard: ignore touches starting this close to the bottom
    this.stylusSeen = false;
    this.ignored = {};       // touch ids treated as palm
    this.unbind = [];
    this.bind();
  }

  Input.prototype.local = function (cx, cy) {
    var r = this.rect || (this.rect = this.el.getBoundingClientRect());
    return { x: cx - r.left, y: cy - r.top };
  };

  Input.prototype.bind = function () {
    var self = this, el = this.el, u = this.unbind;
    var opt = D.passiveFalse;
    u.push(D.on(el, 'touchstart', function (e) { self.touchStart(e); }, opt));
    u.push(D.on(el, 'touchmove', function (e) { self.touchMove(e); }, opt));
    u.push(D.on(el, 'touchend', function (e) { self.touchEnd(e, false); }, opt));
    u.push(D.on(el, 'touchcancel', function (e) { self.touchEnd(e, true); }, opt));

    if (window.PointerEvent) {
      u.push(D.on(el, 'pointerdown', function (e) { self.pDown(e); }));
      u.push(D.on(el, 'pointermove', function (e) { self.pMove(e); }));
      u.push(D.on(el, 'pointerup', function (e) { self.pUp(e, false); }));
      u.push(D.on(el, 'pointercancel', function (e) { self.pUp(e, true); }));
    } else if (!U.isIOS) {
      u.push(D.on(el, 'mousedown', function (e) { self.mDown(e); }));
      u.push(D.on(window, 'mousemove', function (e) { self.mMove(e); }));
      u.push(D.on(window, 'mouseup', function (e) { self.mUp(e); }));
    }
    u.push(D.on(el, 'wheel', function (e) { self.onWheel(e); }, opt));
    u.push(D.on(el, 'contextmenu', function (e) { e.preventDefault(); }));
    u.push(D.on(window, 'resize', function () { self.rect = null; }));
  };

  Input.prototype.destroy = function () {
    for (var i = 0; i < this.unbind.length; i++) { this.unbind[i](); }
    this.unbind = [];
    if (this.timer) { clearTimeout(this.timer); }
  };

  // ---------- touch ----------

  function findTouch(list, id) {
    for (var i = 0; i < list.length; i++) { if (list[i].identifier === id) { return list[i]; } }
    return null;
  }

  Input.prototype.activate = function () {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.state !== 'pending') { return; }
    this.state = 'active';
    var b = this.buf;
    this.h.down(b[0].x, b[0].y, 'touch');
    for (var i = 1; i < b.length; i++) { this.h.move(b[i].x, b[i].y); }
    this.buf = [];
  };

  Input.prototype.startGesture = function (touches) {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.state = 'gesture';
    this.buf = [];
    var a = touches[0], b = touches[1];
    this.g = [a.identifier, b.identifier];
    this.h.gestureStart(this.local(a.clientX, a.clientY), this.local(b.clientX, b.clientY));
  };

  // Touches that count: everything except palms/wrists we decided to ignore.
  Input.prototype.live = function (list) {
    var out = [];
    for (var i = 0; i < list.length; i++) { if (!this.ignored[list[i].identifier]) { out.push(list[i]); } }
    return out;
  };

  Input.prototype.touchStart = function (e) {
    if (e.cancelable) { e.preventDefault(); }
    this.rect = this.el.getBoundingClientRect();
    var i, c, newcomer = null;
    for (i = 0; i < e.changedTouches.length; i++) {
      c = e.changedTouches[i];
      var stylus = c.touchType === 'stylus';
      if (stylus && !this.stylusSeen) {
        this.stylusSeen = true;
        if (this.h.onStylus) { this.h.onStylus(); }
      }
      var cp = this.local(c.clientX, c.clientY);
      if (!stylus && this.guardPx && cp.y > this.rect.height - this.guardPx) {
        this.ignored[c.identifier] = true;   // resting wrist / palm in the guard zone
        continue;
      }
      if (stylus && this.pencilOnly && this.state !== 'idle') {
        // The Pencil always wins: stop any finger pan/pinch, ignore those fingers.
        if (this.state === 'gesture') { this.h.gestureEnd(); }
        else if (this.state === 'active' && this.fingerPan) { this.h.up(); }
        else if (this.state === 'pending') { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
        for (var j = 0; j < e.touches.length; j++) {
          if (e.touches[j].identifier !== c.identifier) { this.ignored[e.touches[j].identifier] = true; }
        }
        this.state = 'idle';
      }
      if (!this.ignored[c.identifier]) { newcomer = newcomer || c; }
    }
    if (!newcomer) { return; }
    var list = this.live(e.touches);
    var n = list.length;
    if (this.state === 'idle' && n === 1) {
      var t = list[0];
      var isStylus = t.touchType === 'stylus';
      var lp = this.local(t.clientX, t.clientY);
      this.fingerPan = false;
      this.stylusStroke = isStylus;
      this.id = t.identifier;
      this.t0 = Date.now();
      if (this.pencilOnly && !isStylus) {
        this.state = 'active';
        this.fingerPan = true;
        this.h.down(lp.x, lp.y, 'finger-pan');
        return;
      }
      this.buf = [lp];
      this.state = 'pending';
      var self = this;
      this.timer = setTimeout(function () { self.activate(); }, PENDING_MS);
      return;
    }
    if (n >= 2) {
      if (this.stylusStroke && this.pencilOnly && (this.state === 'active' || this.state === 'pending')) {
        // fingers landing while the Pencil writes are palms: ignore them
        for (i = 0; i < list.length; i++) { if (list[i].identifier !== this.id) { this.ignored[list[i].identifier] = true; } }
        return;
      }
      if (this.state === 'pending') { this.startGesture(list); return; }
      if (this.state === 'active' && (this.fingerPan || Date.now() - this.t0 < 250)) {
        this.h.cancel();
        this.startGesture(list);
        return;
      }
      if (this.state === 'idle' || this.state === 'ignore') {
        this.startGesture(list);
      }
    }
  };

  Input.prototype.touchMove = function (e) {
    if (e.cancelable) { e.preventDefault(); }
    var t, p, i;
    if (this.state === 'pending' || this.state === 'active') {
      for (i = 0; i < e.changedTouches.length; i++) {
        t = e.changedTouches[i];
        if (t.identifier !== this.id) { continue; }
        p = this.local(t.clientX, t.clientY);
        if (this.state === 'pending') {
          this.buf.push(p);
          var f = this.buf[0];
          if (Math.abs(p.x - f.x) > ACTIVATE_PX || Math.abs(p.y - f.y) > ACTIVATE_PX) { this.activate(); }
        } else {
          this.h.move(p.x, p.y);
        }
      }
    } else if (this.state === 'gesture') {
      var a = findTouch(e.touches, this.g[0]), b = findTouch(e.touches, this.g[1]);
      if (a && b) {
        this.h.gestureMove(this.local(a.clientX, a.clientY), this.local(b.clientX, b.clientY));
      }
    }
  };

  Input.prototype.touchEnd = function (e, cancelled) {
    if (e.cancelable) { e.preventDefault(); }
    var ended = findTouch(e.changedTouches, this.id);
    for (var i = 0; i < e.changedTouches.length; i++) { delete this.ignored[e.changedTouches[i].identifier]; }
    var left = this.live(e.touches).length;
    if (this.state === 'pending' && ended) {
      this.activate();          // a quick tap becomes a dot
      this.h.up();
      this.state = left ? 'ignore' : 'idle';
    } else if (this.state === 'active' && ended) {
      this.h.up();
      this.state = left ? 'ignore' : 'idle';
    } else if (this.state === 'gesture') {
      if (left < 2) {
        this.h.gestureEnd();
        this.state = left ? 'ignore' : 'idle';
      }
    } else if (!left) {
      this.state = 'idle';
    }
    if (!left && this.state === 'ignore') { this.state = 'idle'; }
    if (!e.touches.length) { this.ignored = {}; }
  };

  // ---------- pointer (mouse / pen on modern browsers) ----------

  Input.prototype.pDown = function (e) {
    if (e.pointerType === 'touch') { return; } // touch events handle fingers
    e.preventDefault();
    this.rect = this.el.getBoundingClientRect();
    try { this.el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    var p = this.local(e.clientX, e.clientY);
    this.pid = e.pointerId;
    if (e.button === 1 || e.button === 2 || this.spaceHeld) {
      this.state = 'mpan';
      this.last = p;
      return;
    }
    if (e.button !== 0) { return; }
    this.state = 'active';
    this.h.down(p.x, p.y, e.pointerType || 'mouse');
  };

  Input.prototype.pMove = function (e) {
    if (e.pointerType === 'touch' || e.pointerId !== this.pid) {
      if (this.h.hover && e.pointerType !== 'touch') { var hp = this.local(e.clientX, e.clientY); this.h.hover(hp.x, hp.y); }
      return;
    }
    var p;
    if (this.state === 'mpan') {
      p = this.local(e.clientX, e.clientY);
      this.h.pan(p.x - this.last.x, p.y - this.last.y);
      this.last = p;
      return;
    }
    if (this.state !== 'active') {
      if (this.h.hover) { p = this.local(e.clientX, e.clientY); this.h.hover(p.x, p.y); }
      return;
    }
    var list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (list && list.length) {
      for (var i = 0; i < list.length; i++) {
        p = this.local(list[i].clientX, list[i].clientY);
        this.h.move(p.x, p.y);
      }
    } else {
      p = this.local(e.clientX, e.clientY);
      this.h.move(p.x, p.y);
    }
  };

  Input.prototype.pUp = function (e, cancelled) {
    if (e.pointerType === 'touch' || e.pointerId !== this.pid) { return; }
    if (this.state === 'active') { this.h.up(); }
    if (this.state === 'mpan' && this.h.panEnd) { this.h.panEnd(); }
    this.state = 'idle';
    this.pid = null;
  };

  // ---------- legacy mouse ----------

  Input.prototype.mDown = function (e) {
    this.rect = this.el.getBoundingClientRect();
    var p = this.local(e.clientX, e.clientY);
    e.preventDefault();
    if (e.button !== 0 || this.spaceHeld) { this.state = 'mpan'; this.last = p; return; }
    this.state = 'active';
    this.h.down(p.x, p.y, 'mouse');
  };
  Input.prototype.mMove = function (e) {
    if (this.state !== 'active' && this.state !== 'mpan') { return; }
    var p = this.local(e.clientX, e.clientY);
    if (this.state === 'mpan') { this.h.pan(p.x - this.last.x, p.y - this.last.y); this.last = p; return; }
    this.h.move(p.x, p.y);
  };
  Input.prototype.mUp = function () {
    if (this.state === 'active') { this.h.up(); }
    if (this.state === 'mpan' && this.h.panEnd) { this.h.panEnd(); }
    this.state = 'idle';
  };

  Input.prototype.onWheel = function (e) {
    e.preventDefault();
    var p = this.local(e.clientX, e.clientY);
    var k = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 400 : 1);
    this.h.wheel(e.deltaX * k, e.deltaY * k, e.ctrlKey || e.metaKey, p.x, p.y);
  };

  K.Input = Input;
})(window.Kagoj = window.Kagoj || {});
