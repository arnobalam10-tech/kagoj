// Phase 0 device spike: drawing feel, HTTPS/XHR to Supabase, storage.
(function () {
  'use strict';

  var SUPABASE = 'https://djkvzmeziimnabxcezde.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqa3Z6bWV6aWltbmFieGNlemRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3ODUzMTksImV4cCI6MjA4MTM2MTMxOX0.5k0KvmHT61FJMDGZhOY4yvzGQW2UGuWQ1B5jXnJCvzI';

  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var out = document.getElementById('out');
  var fpsEl = document.getElementById('fps');
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var pts = [], drawn = 0, active = false, id = null, need = false, last = 0, fps = 0;
  var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame || function (f) { return setTimeout(f, 16); };

  function say(msg) { out.textContent = msg + '\n' + out.textContent; }

  function size() {
    var w = window.innerWidth, h = window.innerHeight - 56;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#FDFCF8';
    ctx.fillRect(0, 0, w, h);
  }

  function frame(t) {
    if (last) { fps = Math.round(fps * 0.8 + (1000 / Math.max(1, t - last)) * 0.2); fpsEl.textContent = fps + ' fps'; }
    last = t;
    if (!need) { return; }
    need = false;
    var n = pts.length / 2;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = '#1F1F1F';
    ctx.beginPath();
    for (var i = Math.max(1, drawn + 1); i <= n - 2; i++) {
      var sx = i === 1 ? pts[0] : (pts[(i - 1) * 2] + pts[i * 2]) / 2;
      var sy = i === 1 ? pts[1] : (pts[(i - 1) * 2 + 1] + pts[i * 2 + 1]) / 2;
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(pts[i * 2], pts[i * 2 + 1], (pts[i * 2] + pts[i * 2 + 2]) / 2, (pts[i * 2 + 1] + pts[i * 2 + 3]) / 2);
      drawn = i;
    }
    ctx.stroke();
    if (active) { raf(frame); }
  }

  function local(t) {
    var r = canvas.getBoundingClientRect();
    return [t.clientX - r.left, t.clientY - r.top];
  }

  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    if (e.touches.length > 1) { active = false; return; }
    var t = e.changedTouches[0];
    id = t.identifier; active = true; drawn = 0; last = 0;
    pts = local(t);
    raf(frame);
  }, false);
  canvas.addEventListener('touchmove', function (e) {
    e.preventDefault();
    if (!active) { return; }
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.identifier !== id) { continue; }
      var p = local(t);
      if (Math.abs(p[0] - pts[pts.length - 2]) + Math.abs(p[1] - pts[pts.length - 1]) < 0.8) { continue; }
      pts.push(p[0], p[1]);
      need = true;
    }
  }, false);
  canvas.addEventListener('touchend', function (e) { e.preventDefault(); active = false; }, false);
  canvas.addEventListener('mousedown', function (e) { active = true; drawn = 0; pts = [e.offsetX, e.offsetY]; raf(frame); }, false);
  canvas.addEventListener('mousemove', function (e) { if (active) { pts.push(e.offsetX, e.offsetY); need = true; } }, false);
  window.addEventListener('mouseup', function () { active = false; }, false);
  document.addEventListener('touchmove', function (e) { e.preventDefault(); }, false);

  function xhr(method, url, body, cb) {
    var x = new XMLHttpRequest();
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; x.abort(); cb('TIMEOUT'); } }, 15000);
    x.open(method, url, true);
    x.setRequestHeader('apikey', ANON);
    x.setRequestHeader('Content-Type', 'application/json');
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || done) { return; }
      done = true; clearTimeout(timer);
      cb(x.status + ' ' + (x.responseText || '').substr(0, 140));
    };
    x.send(body ? JSON.stringify(body) : null);
  }

  document.getElementById('clear').addEventListener('click', size, false);

  document.getElementById('net').addEventListener('click', function () {
    say('Testing HTTPS to Supabase… (status 0 = certificate or network problem)');
    xhr('GET', SUPABASE + '/auth/v1/settings', null, function (r) {
      say('/auth/v1/settings -> ' + r);
      xhr('POST', SUPABASE + '/auth/v1/token?grant_type=password', { email: 'probe@kagoj.app', password: 'x' }, function (r2) {
        say('/auth/v1/token -> ' + r2 + '  (400 = reachable, OK)');
        xhr('GET', SUPABASE + '/rest/v1/', null, function (r3) { say('/rest/v1/ -> ' + r3 + '  (any non-0 = reachable)'); });
      });
    });
  }, false);

  document.getElementById('store').addEventListener('click', function () {
    var idb = window.indexedDB || window.webkitIndexedDB;
    say('standalone (home screen): ' + (navigator.standalone ? 'yes' : 'no'));
    try {
      window.localStorage.setItem('spike', 'ok');
      say('localStorage: ' + (window.localStorage.getItem('spike') === 'ok' ? 'OK' : 'FAIL'));
    } catch (e) { say('localStorage: FAIL ' + e.message); }
    if (!idb) { say('IndexedDB: not available'); return; }
    var req = idb.open('kagoj-spike', 1);
    req.onupgradeneeded = function () { req.result.createObjectStore('t', { keyPath: 'id' }); };
    req.onerror = function () { say('IndexedDB open: FAIL ' + req.error); };
    req.onsuccess = function () {
      var db = req.result;
      var tx = db.transaction('t', 'readwrite');
      tx.objectStore('t').put({ id: 'a', v: 42 });
      tx.oncomplete = function () {
        var g = db.transaction('t', 'readonly').objectStore('t').get('a');
        g.onsuccess = function () {
          var ok = g.result && g.result.v === 42;
          var d = db.transaction('t', 'readwrite');
          d.objectStore('t')['delete']('a');
          d.oncomplete = function () { say('IndexedDB write/read/delete: ' + (ok ? 'OK' : 'FAIL')); };
        };
        g.onerror = function () { say('IndexedDB read: FAIL'); };
      };
      tx.onerror = function () { say('IndexedDB write: FAIL ' + tx.error); };
    };
  }, false);

  var t0 = window.Touch && window.Touch.prototype;
  say('UA: ' + navigator.userAgent + '\nscreen ' + screen.width + 'x' + screen.height + ' dpr ' + (window.devicePixelRatio || 1) +
    '\nTouch.radiusX: ' + (t0 && 'radiusX' in t0 ? 'yes' : 'unknown') + ' | PointerEvent: ' + (window.PointerEvent ? 'yes' : 'no'));
  window.addEventListener('resize', size, false);
  size();
})();
