(function (K) {
  'use strict';

  // Turns touch / pointer / mouse events into engine calls.
  // Apple Pencil (and the mouse) write; fingers never do. One finger scrolls
  // (or swipes to turn the page), two fingers pinch-zoom. Fingers that land
  // while the Pencil is down are a resting palm and are ignored.
  var D = K.dom;
  var U = K.util;
  var PAN_PX = 8;          // a finger must move this far before it scrolls (a resting palm barely moves)
  var HAS_POINTER = !!window.PointerEvent;

  function Input(el, h) {
    this.el = el;
    this.h = h;            // handler: down, move, up, cancel, gestureStart/Move/End, wheel, pan, swipe
    this.state = 'idle';   // touch: idle | wait | pan | stylus | gesture | ignore
    this.pState = 'idle';  // pointer: idle | active | mpan
    this.id = null;
    this.g = null;         // gesture touch ids
    this.rect = null;
    this.spaceHeld = false;
    this.penDown = false;
    this.ignored = {};     // touch ids that never count (palm, Pencil handled by pointer events)
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
    u.push(D.on(el, 'touchend', function (e) { self.touchEnd(e); }, opt));
    u.push(D.on(el, 'touchcancel', function (e) { self.touchEnd(e); }, opt));

    if (HAS_POINTER) {
      u.push(D.on(el, 'pointerdown', function (e) { self.pDown(e); }));
      u.push(D.on(el, 'pointermove', function (e) { self.pMove(e); }));
      u.push(D.on(el, 'pointerup', function (e) { self.pUp(e); }));
      u.push(D.on(el, 'pointercancel', function (e) { self.pUp(e); }));
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
  };

  // ---------- touch (fingers; the Pencil only when there are no pointer events) ----------

  function findTouch(list, id) {
    for (var i = 0; i < list.length; i++) { if (list[i].identifier === id) { return list[i]; } }
    return null;
  }

  Input.prototype.live = function (list) {
    var out = [];
    for (var i = 0; i < list.length; i++) { if (!this.ignored[list[i].identifier]) { out.push(list[i]); } }
    return out;
  };

  Input.prototype.startGesture = function (touches) {
    if (this.state === 'pan') { this.h.cancel(); }
    this.state = 'gesture';
    var a = touches[0], b = touches[1];
    this.g = [a.identifier, b.identifier];
    this.h.gestureStart(this.local(a.clientX, a.clientY), this.local(b.clientX, b.clientY));
  };

  // The Pencil touched down: stop whatever the fingers were doing.
  Input.prototype.stopFingers = function () {
    if (this.state === 'gesture') { this.h.gestureEnd(); }
    else if (this.state === 'pan') { this.h.cancel(); }
    if (this.state !== 'idle' && this.state !== 'stylus') { this.state = 'ignore'; }
  };

  Input.prototype.touchStart = function (e) {
    if (e.cancelable) { e.preventDefault(); }
    this.rect = this.el.getBoundingClientRect();
    var i, c, p;
    for (i = 0; i < e.changedTouches.length; i++) {
      c = e.changedTouches[i];
      if (c.touchType === 'stylus') {
        this.ignored[c.identifier] = true;
        if (HAS_POINTER) { continue; }        // pointer events draw the Pencil (with coalesced points)
        this.stopFingers();
        if (this.state === 'idle' || this.state === 'ignore') {
          p = this.local(c.clientX, c.clientY);
          this.state = 'stylus';
          this.id = c.identifier;
          this.h.down(p.x, p.y, 'pen');
        }
        continue;
      }
      if (this.penDown || this.state === 'stylus') { this.ignored[c.identifier] = true; }  // palm
    }
    var list = this.live(e.touches);
    if (this.state === 'idle' && list.length === 1) {
      var t = list[0];
      this.id = t.identifier;
      this.s0 = this.local(t.clientX, t.clientY);
      this.t0 = Date.now();
      this.state = 'wait';
      return;
    }
    if (list.length >= 2 && (this.state === 'wait' || this.state === 'pan' || this.state === 'idle' || this.state === 'ignore')) {
      this.startGesture(list);
    }
  };

  Input.prototype.touchMove = function (e) {
    if (e.cancelable) { e.preventDefault(); }
    var t, p, i;
    if (this.state === 'stylus' && !HAS_POINTER) {
      t = findTouch(e.changedTouches, this.id);
      if (t) { p = this.local(t.clientX, t.clientY); this.h.move(p.x, p.y); }
      return;
    }
    if (this.state === 'wait' || this.state === 'pan') {
      for (i = 0; i < e.changedTouches.length; i++) {
        t = e.changedTouches[i];
        if (t.identifier !== this.id) { continue; }
        p = this.local(t.clientX, t.clientY);
        if (this.state === 'wait') {
          if (Math.abs(p.x - this.s0.x) + Math.abs(p.y - this.s0.y) < PAN_PX) { return; }
          this.state = 'pan';
          this.h.down(this.s0.x, this.s0.y, 'finger-pan');
        }
        this.h.move(p.x, p.y);
      }
    } else if (this.state === 'gesture') {
      var a = findTouch(e.touches, this.g[0]), b = findTouch(e.touches, this.g[1]);
      if (a && b) {
        this.h.gestureMove(this.local(a.clientX, a.clientY), this.local(b.clientX, b.clientY));
      }
    }
  };

  Input.prototype.touchEnd = function (e) {
    if (e.cancelable) { e.preventDefault(); }
    var ended = findTouch(e.changedTouches, this.id);
    var i;
    for (i = 0; i < e.changedTouches.length; i++) { delete this.ignored[e.changedTouches[i].identifier]; }
    var left = this.live(e.touches).length;
    if (this.state === 'stylus' && ended) {
      this.h.up();
      this.state = left ? 'ignore' : 'idle';
    } else if ((this.state === 'pan' || this.state === 'wait') && ended) {
      if (this.state === 'pan') { this.h.up(); }
      var p = this.local(ended.clientX, ended.clientY);
      var dx = p.x - this.s0.x, dy = p.y - this.s0.y, dt = Date.now() - this.t0;
      // a quick sideways flick turns the page (left = next)
      if (this.h.swipe && Math.abs(dx) > 70 && Math.abs(dx) > 1.6 * Math.abs(dy) && dt < 800) { this.h.swipe(dx < 0 ? 1 : -1); }
      this.state = left ? 'ignore' : 'idle';
    } else if (this.state === 'gesture') {
      if (left < 2) {
        this.h.gestureEnd();
        this.state = left ? 'ignore' : 'idle';
      }
    } else if (!left) {
      this.state = 'idle';
    }
    if (!e.touches.length) { this.ignored = {}; this.state = 'idle'; }
  };

  // ---------- pointer (mouse / Apple Pencil) ----------

  Input.prototype.pDown = function (e) {
    if (e.pointerType === 'touch') { return; } // touch events handle fingers
    e.preventDefault();
    this.rect = this.el.getBoundingClientRect();
    try { this.el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    var p = this.local(e.clientX, e.clientY);
    this.pid = e.pointerId;
    if (e.pointerType === 'pen') { this.penDown = true; this.stopFingers(); }
    if (e.button === 1 || e.button === 2 || this.spaceHeld) {
      this.pState = 'mpan';
      this.last = p;
      return;
    }
    if (e.button !== 0) { return; }
    this.pState = 'active';
    this.h.down(p.x, p.y, e.pointerType || 'mouse');
  };

  Input.prototype.pMove = function (e) {
    if (e.pointerType === 'touch' || e.pointerId !== this.pid) {
      if (this.h.hover && e.pointerType !== 'touch') { var hp = this.local(e.clientX, e.clientY); this.h.hover(hp.x, hp.y); }
      return;
    }
    var p;
    if (this.pState === 'mpan') {
      p = this.local(e.clientX, e.clientY);
      this.h.pan(p.x - this.last.x, p.y - this.last.y);
      this.last = p;
      return;
    }
    if (this.pState !== 'active') {
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

  Input.prototype.pUp = function (e) {
    if (e.pointerType === 'touch' || e.pointerId !== this.pid) { return; }
    if (this.pState === 'active') { this.h.up(); }
    if (this.pState === 'mpan' && this.h.panEnd) { this.h.panEnd(); }
    this.pState = 'idle';
    this.pid = null;
    this.penDown = false;
  };

  // ---------- legacy mouse ----------

  Input.prototype.mDown = function (e) {
    this.rect = this.el.getBoundingClientRect();
    var p = this.local(e.clientX, e.clientY);
    e.preventDefault();
    if (e.button !== 0 || this.spaceHeld) { this.pState = 'mpan'; this.last = p; return; }
    this.pState = 'active';
    this.h.down(p.x, p.y, 'mouse');
  };
  Input.prototype.mMove = function (e) {
    if (this.pState !== 'active' && this.pState !== 'mpan') { return; }
    var p = this.local(e.clientX, e.clientY);
    if (this.pState === 'mpan') { this.h.pan(p.x - this.last.x, p.y - this.last.y); this.last = p; return; }
    this.h.move(p.x, p.y);
  };
  Input.prototype.mUp = function () {
    if (this.pState === 'active') { this.h.up(); }
    if (this.pState === 'mpan' && this.h.panEnd) { this.h.panEnd(); }
    this.pState = 'idle';
  };

  Input.prototype.onWheel = function (e) {
    e.preventDefault();
    var p = this.local(e.clientX, e.clientY);
    var k = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 400 : 1);
    this.h.wheel(e.deltaX * k, e.deltaY * k, e.ctrlKey || e.metaKey, p.x, p.y);
  };

  K.Input = Input;
})(window.Kagoj = window.Kagoj || {});
