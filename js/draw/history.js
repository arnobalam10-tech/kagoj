(function (K) {
  'use strict';

  var G = K.geom;
  var MAX = 100;

  function History() { this.undos = []; this.redos = []; }

  History.prototype.push = function (op) {
    this.undos.push(op);
    if (this.undos.length > MAX) { this.undos.shift(); }
    this.redos = [];
  };

  History.prototype.canUndo = function () { return this.undos.length > 0; };
  History.prototype.canRedo = function () { return this.redos.length > 0; };

  function indexOfId(strokes, id) {
    for (var i = strokes.length - 1; i >= 0; i--) { if (strokes[i].id === id) { return i; } }
    return -1;
  }

  function replaceAll(strokes, list) {
    strokes.length = 0;
    for (var i = 0; i < list.length; i++) { strokes.push(list[i]); }
  }

  function imgIndex(imgs, id) {
    for (var i = 0; i < imgs.length; i++) { if (imgs[i].id === id) { return i; } }
    return -1;
  }

  // Each returns { dirty: rect|null, full: bool, paper: bool }
  function apply(op, strokes, forward, imgs) {
    var i, st, dirty = null;
    if (op.type === 'img-add') {
      for (i = 0; i < op.imgs.length; i++) {
        var k = imgIndex(imgs, op.imgs[i].id);
        if (forward && k < 0) { imgs.push(op.imgs[i]); }
        if (!forward && k >= 0) { imgs.splice(k, 1); }
      }
      return { dirty: null, full: false, paper: true };
    }
    if (op.type === 'img-del') {
      if (forward) { i = imgIndex(imgs, op.img.id); if (i >= 0) { imgs.splice(i, 1); } }
      else { imgs.splice(Math.min(op.i, imgs.length), 0, op.img); }
      return { dirty: null, full: false, paper: true };
    }
    if (op.type === 'img-set') {
      i = imgIndex(imgs, op.id);
      if (i >= 0) {
        var r = forward ? op.after : op.before;
        imgs[i].x = r.x; imgs[i].y = r.y; imgs[i].w = r.w; imgs[i].h = r.h;
      }
      return { dirty: null, full: false, paper: true };
    }
    if (op.type === 'add') {
      if (forward) { strokes.push(op.stroke); }
      else {
        i = indexOfId(strokes, op.stroke.id);
        if (i >= 0) { strokes.splice(i, 1); }
      }
      return { dirty: op.stroke.bb, full: false };
    }
    if (op.type === 'erase') {
      if (forward) {
        for (i = 0; i < op.steps.length; i++) {
          st = op.steps[i];
          Array.prototype.splice.apply(strokes, [st.i, 1].concat(st.added));
          dirty = G.union(dirty, st.removed.bb);
        }
      } else {
        for (i = op.steps.length - 1; i >= 0; i--) {
          st = op.steps[i];
          strokes.splice(st.i, st.added.length, st.removed);
          dirty = G.union(dirty, st.removed.bb);
        }
      }
      return { dirty: dirty, full: false };
    }
    if (op.type === 'clear') {
      replaceAll(strokes, forward ? [] : op.strokes);
      return { dirty: null, full: true };
    }
    return { dirty: null, full: true };
  }

  History.prototype.undo = function (strokes, imgs) {
    var op = this.undos.pop();
    if (!op) { return null; }
    this.redos.push(op);
    return apply(op, strokes, false, imgs || []);
  };

  History.prototype.redo = function (strokes, imgs) {
    var op = this.redos.pop();
    if (!op) { return null; }
    this.undos.push(op);
    return apply(op, strokes, true, imgs || []);
  };

  K.History = History;
})(window.Kagoj = window.Kagoj || {});
