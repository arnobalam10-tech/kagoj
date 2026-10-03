// Unit tests for the pure parts of Kagoj, run in Node with a fake window.
/* eslint-disable */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var assert = require('assert');

var ROOT = path.resolve(__dirname, '..');
var store = {};
var win = {
  navigator: { userAgent: 'node', maxTouchPoints: 0 },
  screen: { width: 1024, height: 768 },
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  },
  addEventListener: function () {}, removeEventListener: function () {},
  Object: Object, devicePixelRatio: 1, crypto: require('crypto').webcrypto
};
win.window = win;
var ctx = vm.createContext(Object.assign(win, {
  console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Date: Date, Math: Math, JSON: JSON,
  Uint8Array: Uint8Array, document: { addEventListener: function () {} }
}));
['js/config.js', 'js/core/util.js', 'js/core/dom.js', 'js/core/log.js', 'js/draw/geometry.js', 'js/draw/codec.js',
 'js/draw/eraser.js', 'js/draw/history.js', 'js/draw/viewport.js', 'js/draw/band.js', 'js/draw/input.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
});
var K = win.Kagoj;
var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function near(a, b, eps) { assert.ok(Math.abs(a - b) <= (eps || 1e-6), a + ' != ' + b); }

console.log('util');
test('uuid v4 format', function () {
  var u = K.util.uuid();
  assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u), u);
});
test('strokeId format', function () { assert.ok(/^s_[0-9a-z]{8}$/.test(K.util.strokeId())); });
test('parseTime handles postgres timestamps with +00:00 and 6 decimals', function () {
  assert.strictEqual(K.util.parseTime('2026-10-03T10:20:30.123456+00:00'), Date.UTC(2026, 9, 3, 10, 20, 30, 123));
  assert.strictEqual(K.util.parseTime('2026-10-03T10:20:30+06:00'), Date.UTC(2026, 9, 3, 4, 20, 30, 0));
  assert.strictEqual(K.util.parseTime('2026-10-03T10:20:30.5Z'), Date.UTC(2026, 9, 3, 10, 20, 30, 500));
});

console.log('geometry');
test('simplify removes collinear points, keeps ends', function () {
  var pts = [];
  for (var i = 0; i <= 100; i++) { pts.push(i, 0); }
  var s = K.geom.simplify(pts, 0.35);
  assert.deepStrictEqual(Array.from(s), [0, 0, 100, 0]);
});
test('simplify keeps a corner', function () {
  var s = K.geom.simplify([0, 0, 5, 0, 10, 0, 10, 5, 10, 10], 0.35);
  assert.deepStrictEqual(Array.from(s), [0, 0, 10, 0, 10, 10]);
});
test('resample: no gap > 4 units', function () {
  var r = K.geom.resample([0, 0, 20, 0, 20, 9], 4);
  for (var i = 2; i < r.length; i += 2) {
    var d = Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]);
    assert.ok(d <= 4 + 1e-9, 'gap ' + d);
  }
  near(r[r.length - 2], 20); near(r[r.length - 1], 9);
});
test('segDist2', function () {
  near(K.geom.segDist2(5, 3, 0, 0, 10, 0), 9);
  near(K.geom.segDist2(-3, 4, 0, 0, 10, 0), 25);
});

console.log('codec');
test('round trip within 0.1 units, delta encoded', function () {
  var s = K.geom.finishStroke({ id: 's_abc', t: 'p', c: '#1F1F1F', w: 3.5, pts: [100.04, 120.0, 105.06, 124.8, 110.0, 130.11] });
  var enc = K.codec.encode([s]);
  assert.strictEqual(enc.v, 1); assert.strictEqual(enc.w, 1000); assert.strictEqual(enc.h, 1414);
  assert.deepStrictEqual(Array.from(enc.strokes[0].pts), [1000, 1200, 51, 48, 49, 53]);
  var dec = K.codec.decode(JSON.parse(JSON.stringify(enc)));
  assert.strictEqual(dec.length, 1);
  for (var i = 0; i < s.pts.length; i++) { near(dec[0].pts[i], s.pts[i], 0.051); }
  assert.ok(dec[0].bb.minX < 100 && dec[0].bb.maxX > 110);
});
test('PRD example decodes', function () {
  var d = K.codec.decode({ v: 1, w: 1000, h: 1414, strokes: [{ id: 's_p1m7q2bc', t: 'h', c: '#FFE34D', w: 20, pts: [900, 3000, 120, 0, 118, 2] }] });
  assert.deepStrictEqual(Array.from(d[0].pts), [90, 300, 102, 300, 113.8, 300.2]);
  assert.strictEqual(d[0].t, 'h');
});

function line(x0, x1, y, id) {
  var pts = [];
  for (var x = x0; x <= x1; x += 2) { pts.push(x, y); }
  return K.geom.finishStroke({ id: id, t: 'p', c: '#000', w: 2, pts: pts });
}

console.log('eraser + history');
test('partial erase splits a stroke in two; undo/redo restore exactly', function () {
  var a = line(0, 100, 50, 'a'), b = line(0, 100, 200, 'b');
  var strokes = [a, b];
  var res = K.eraser.apply(strokes, 50, 50, 8, 'partial');
  assert.strictEqual(res.steps.length, 1);
  assert.strictEqual(strokes.length, 3);
  assert.strictEqual(strokes[2].id, 'b');           // z-order preserved
  assert.ok(strokes[0].bb.maxX < 50 && strokes[1].bb.minX > 50);
  var h = new K.History();
  h.push({ type: 'erase', steps: res.steps });
  h.undo(strokes);
  assert.deepStrictEqual(strokes.map(function (s) { return s.id; }), ['a', 'b']);
  h.redo(strokes);
  assert.strictEqual(strokes.length, 3);
});
test('whole-stroke erase removes it', function () {
  var strokes = [line(0, 100, 50, 'a'), line(0, 100, 200, 'b')];
  var res = K.eraser.apply(strokes, 10, 52, 8, 'whole');
  assert.strictEqual(strokes.length, 1);
  assert.strictEqual(strokes[0].id, 'b');
  assert.ok(res.dirty);
});
test('eraser misses far strokes', function () {
  var strokes = [line(0, 100, 50, 'a')];
  assert.strictEqual(K.eraser.apply(strokes, 50, 80, 8, 'partial').steps.length, 0);
});
test('add / clear history', function () {
  var strokes = [], h = new K.History(), s = line(0, 10, 0, 'x');
  strokes.push(s); h.push({ type: 'add', stroke: s });
  h.push({ type: 'clear', strokes: strokes.slice() }); strokes.length = 0;
  h.undo(strokes); assert.strictEqual(strokes.length, 1);
  h.undo(strokes); assert.strictEqual(strokes.length, 0);
  h.redo(strokes); h.redo(strokes); assert.strictEqual(strokes.length, 0);
  assert.ok(!h.canRedo());
});
test('history depth capped at 100', function () {
  var h = new K.History();
  for (var i = 0; i < 150; i++) { h.push({ type: 'add', stroke: line(0, 4, i, 'i' + i) }); }
  assert.strictEqual(h.undos.length, 100);
});

console.log('images');
test('codec keeps page size and placed images', function () {
  var d = K.codec.encode([], 1000, 563, [{ id: 'i_1', a: 'u/d/p001.jpg', x: 10.04, y: 20, w: 300.26, h: 169 }]);
  assert.strictEqual(d.h, 563);
  assert.strictEqual(d.imgs[0].x, 10);
  assert.strictEqual(d.imgs[0].w, 300.3);
  var back = K.codec.decodeImgs(JSON.parse(JSON.stringify(d)));
  assert.strictEqual(back.length, 1);
  assert.strictEqual(back[0].a, 'u/d/p001.jpg');
  assert.strictEqual(K.codec.encode([]).imgs, undefined);
});
test('image add / move / delete undo and redo', function () {
  var h = new K.History(), strokes = [], imgs = [];
  var a = { id: 'i_a', a: 'x', x: 0, y: 0, w: 100, h: 50 };
  imgs.push(a); h.push({ type: 'img-add', imgs: [a] });
  a.x = 40; h.push({ type: 'img-set', id: 'i_a', before: { x: 0, y: 0, w: 100, h: 50 }, after: { x: 40, y: 0, w: 100, h: 50 } });
  imgs.splice(0, 1); h.push({ type: 'img-del', img: a, i: 0 });
  assert.strictEqual(imgs.length, 0);
  var r = h.undo(strokes, imgs); assert.ok(r.paper); assert.strictEqual(imgs.length, 1);
  h.undo(strokes, imgs); assert.strictEqual(imgs[0].x, 0);
  h.undo(strokes, imgs); assert.strictEqual(imgs.length, 0);
  h.redo(strokes, imgs); h.redo(strokes, imgs); assert.strictEqual(imgs[0].x, 40);
  h.redo(strokes, imgs); assert.strictEqual(imgs.length, 0);
});
test('viewport fits a landscape (slide) page', function () {
  var v = new K.Viewport(); v.pw = 1000; v.ph = 563; v.resize(768, 900);
  v.fit('page');
  near(v.scale, (768 - 48) / 1000);
  assert.ok(v.oy > 24);   // centred vertically
});

console.log('palm rejection (input)');
function palmRig(opts) {
  var log = [];
  var el = { addEventListener: function () {}, removeEventListener: function () {},
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 400, height: 600 }; } };
  var h = { down: function (x, y, k) { log.push('down:' + k); }, move: function () { if (log[log.length - 1] !== 'move') { log.push('move'); } },
    up: function () { log.push('up'); }, cancel: function () { log.push('cancel'); }, gestureStart: function () { log.push('gesture'); },
    gestureMove: function () {}, gestureEnd: function () { log.push('gestureEnd'); }, wheel: function () {}, pan: function () {} };
  var inp = new K.Input(el, h);
  inp.pencilOnly = !!opts.pencilOnly; inp.guardPx = opts.guardPx || 0;
  return { inp: inp, log: log };
}
function T(id, x, y, type) { return { identifier: id, clientX: x, clientY: y, touchType: type }; }
function ev(changed, all) { return { cancelable: true, preventDefault: function () {}, changedTouches: changed, touches: all }; }
test('wrist guard: a resting palm does not turn writing into a pinch', function () {
  var r = palmRig({ guardPx: 140 }), palm = T(1, 200, 560), p = T(2, 100, 100);
  r.inp.touchStart(ev([palm], [palm]));
  r.inp.touchStart(ev([p], [palm, p]));
  p = T(2, 130, 110); r.inp.touchMove(ev([p], [palm, p]));
  r.inp.touchEnd(ev([p], [palm]));
  assert.strictEqual(r.log.join(' '), 'down:touch move up');
  r.inp.destroy();
});
test('pencil only: fingers pan, the Pencil writes even with palms down', function () {
  var r = palmRig({ pencilOnly: true });
  var f = T(1, 100, 300, 'direct'); r.inp.touchStart(ev([f], [f])); r.inp.touchEnd(ev([f], []));
  assert.strictEqual(r.log.join(' '), 'down:finger-pan up');
  r.log.length = 0;
  var palm = T(5, 250, 400, 'direct'), pen = T(6, 80, 120, 'stylus'), palm2 = T(7, 300, 420, 'direct');
  r.inp.touchStart(ev([palm], [palm]));
  r.inp.touchStart(ev([pen], [palm, pen]));
  pen = T(6, 100, 120, 'stylus'); r.inp.touchMove(ev([pen], [palm, pen]));
  r.inp.touchStart(ev([palm2], [palm, pen, palm2]));
  pen = T(6, 120, 120, 'stylus'); r.inp.touchMove(ev([pen], [palm, pen, palm2]));
  r.inp.touchEnd(ev([pen], [palm, palm2]));
  assert.strictEqual(r.log.join(' '), 'down:finger-pan up down:touch move up');
  r.inp.destroy();
});
test('pencil only: two fingers still pinch-zoom', function () {
  var r = palmRig({ pencilOnly: true }), a = T(1, 100, 100, 'direct'), b = T(2, 200, 200, 'direct');
  r.inp.touchStart(ev([a], [a])); r.inp.touchStart(ev([b], [a, b])); r.inp.touchEnd(ev([a, b], []));
  assert.strictEqual(r.log.join(' '), 'down:finger-pan cancel gesture gestureEnd');
  r.inp.destroy();
});

console.log('writing band');
test('band snaps to ruled rows and stays on the page', function () {
  var B = K.band;
  assert.strictEqual(B.height(4), 4 * 36 + 12);
  assert.strictEqual(B.initial(4, 1414), 74 - 6);          // first row starts at 74 (first line 110)
  assert.strictEqual(B.snap(100, 4, 1414), 74 + 36 - 6);    // nearest row
  assert.strictEqual(B.step(68, 4, 1414, 1), 68 + 144);     // next 4 lines
  assert.strictEqual(B.step(68, 4, 1414, -1), 0);           // clamped at the top
  var last = B.snap(5000, 4, 1414);
  assert.ok(last + B.height(4) <= 1414 && last > 1200);
  assert.ok(B.contains(68, 4, 100, 0) && !B.contains(68, 4, 300, 0));
});
test('band: touches outside are ignored, so a palm never becomes a pinch', function () {
  var log = [];
  var el = { addEventListener: function () {}, removeEventListener: function () {},
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 400, height: 600 }; } };
  var h = { down: function () { log.push('down'); }, move: function () { if (log[log.length - 1] !== 'move') { log.push('move'); } },
    up: function () { log.push('up'); }, cancel: function () { log.push('cancel'); }, gestureStart: function () { log.push('gesture'); },
    gestureMove: function () {}, gestureEnd: function () {}, wheel: function () {}, pan: function () {},
    acceptsTouch: function (x, y) { return y >= 100 && y <= 200; } };
  var inp = new K.Input(el, h);
  function T(id, x, y) { return { identifier: id, clientX: x, clientY: y }; }
  function ev(c, a) { return { cancelable: true, preventDefault: function () {}, changedTouches: c, touches: a }; }
  var palm = T(1, 300, 450);
  inp.touchStart(ev([palm], [palm]));             // palm below the band: ignored
  var p = T(2, 50, 150);
  inp.touchStart(ev([p], [palm, p]));             // finger inside the band: writes
  p = T(2, 90, 160); inp.touchMove(ev([p], [palm, p]));
  p = T(2, 120, 260); inp.touchMove(ev([p], [palm, p]));   // may leave the band once started
  inp.touchEnd(ev([p], [palm]));
  assert.strictEqual(log.join(' '), 'down move up');
  inp.destroy();
});

console.log('viewport');
test('fit width, zoom steps, pan limits', function () {
  var v = new K.Viewport();
  v.resize(1024, 652);
  near(v.scale, (1024 - 48) / 1000);
  assert.strictEqual(v.zoomPct(), 100);
  v.stepZoom(1); assert.strictEqual(v.zoomPct(), 150);
  v.stepZoom(-1); v.stepZoom(-1); assert.strictEqual(v.zoomPct(), 75);
  v.zoomToPct(100);
  v.pan(5000, 5000); assert.ok(v.ox <= 100 && v.oy <= 100);
  v.pan(-99999, -99999); assert.ok(v.ox + 1000 * v.scale >= 1024 - 100 - 1e-6);
  v.zoomToPct(10); assert.ok(v.scale >= v.minScale() - 1e-9);
});
test('page <-> screen conversion', function () {
  var v = new K.Viewport(); v.resize(800, 600);
  var p = v.toPage(v.ox + 500 * v.scale, v.oy + 700 * v.scale);
  near(p.x, 500); near(p.y, 700);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
