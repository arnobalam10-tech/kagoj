(function (K) {
  'use strict';

  var U = {};
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function randomBytes(n) {
    var out = [], i;
    var c = window.crypto || window.msCrypto;
    if (c && c.getRandomValues && window.Uint8Array) {
      var arr = new Uint8Array(n);
      c.getRandomValues(arr);
      for (i = 0; i < n; i++) { out.push(arr[i]); }
      return out;
    }
    for (i = 0; i < n; i++) { out.push(Math.floor(Math.random() * 256)); }
    return out;
  }

  function hex2(b) { return (b < 16 ? '0' : '') + b.toString(16); }

  // RFC 4122 v4
  U.uuid = function () {
    var b = randomBytes(16), s = '', i;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    for (i = 0; i < 16; i++) {
      s += hex2(b[i]);
      if (i === 3 || i === 5 || i === 7 || i === 9) { s += '-'; }
    }
    return s;
  };

  U.strokeId = function () {
    var b = randomBytes(8), s = 's_', i;
    for (i = 0; i < 8; i++) { s += (b[i] % 36).toString(36); }
    return s;
  };

  U.now = function () { return Date.now(); };
  U.isoNow = function () { return new Date().toISOString(); };

  U.debounce = function (fn, ms) {
    var t = null;
    var d = function () {
      var args = arguments, self = this;
      if (t) { clearTimeout(t); }
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms);
    };
    d.flush = function () {
      if (t) { clearTimeout(t); t = null; fn(); }
    };
    d.cancel = function () { if (t) { clearTimeout(t); t = null; } };
    d.pending = function () { return t !== null; };
    return d;
  };

  U.extend = function (target) {
    var i, k, src;
    for (i = 1; i < arguments.length; i++) {
      src = arguments[i];
      if (!src) { continue; }
      for (k in src) {
        if (Object.prototype.hasOwnProperty.call(src, k)) { target[k] = src[k]; }
      }
    }
    return target;
  };

  U.copy = function (o) { return U.extend({}, o); };

  U.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };

  U.values = function (obj) {
    var out = [], k;
    for (k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) { out.push(obj[k]); }
    }
    return out;
  };

  U.parseTime = function (s) {
    if (!s) { return 0; }
    if (typeof s === 'number') { return s; }
    // Safari 9 cannot parse "+00:00" with 6 fractional digits; trim to ms.
    var m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.(\d+))?(Z|[+\-]\d\d:?\d\d)?$/.exec(s);
    if (!m) { var t = Date.parse(s); return isNaN(t) ? 0 : t; }
    var ms = m[7] ? parseInt((m[7] + '00').substr(0, 3), 10) : 0;
    var utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
    var tz = m[8];
    if (tz && tz !== 'Z') {
      var sign = tz.charAt(0) === '-' ? -1 : 1;
      var hh = parseInt(tz.substr(1, 2), 10);
      var mm = parseInt(tz.replace(':', '').substr(3, 2), 10);
      utc -= sign * (hh * 60 + mm) * 60000;
    }
    return utc;
  };

  U.relTime = function (s) {
    var t = U.parseTime(s);
    if (!t) { return ''; }
    var diff = (Date.now() - t) / 1000;
    if (diff < 60) { return 'just now'; }
    if (diff < 3600) { var m = Math.floor(diff / 60); return m + (m === 1 ? ' minute ago' : ' minutes ago'); }
    if (diff < 86400) { var h = Math.floor(diff / 3600); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
    var d = Math.floor(diff / 86400);
    if (d === 1) { return 'yesterday'; }
    if (d < 30) { return d + ' days ago'; }
    return U.shortDate(t);
  };

  U.shortDate = function (t) {
    var d = new Date(typeof t === 'number' ? t : U.parseTime(t));
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  };

  U.stampLabel = function (t) {
    var d = new Date(t);
    var hh = d.getHours(), mm = d.getMinutes();
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  };

  var ua = navigator.userAgent || '';
  U.isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  U.hasTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  U.isStandalone = !!(navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
  U.isPhone = function () {
    var w = Math.min(window.screen.width, window.screen.height);
    return U.hasTouch && w < 600;
  };
  U.deviceName = function () {
    if (/iPhone|iPod/.test(ua)) { return 'iPhone'; }
    if (U.isIOS) { return 'iPad'; }
    if (/Android/.test(ua)) { return U.isPhone() ? 'phone' : 'tablet'; }
    return 'PC';
  };
  U.dpr = function () { return Math.min(window.devicePixelRatio || 1, 2); };

  // Minimal event emitter mixin
  U.emitter = function (obj) {
    var handlers = {};
    obj.on = function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return fn; };
    obj.off = function (ev, fn) {
      var list = handlers[ev], i;
      if (!list) { return; }
      for (i = list.length - 1; i >= 0; i--) { if (list[i] === fn) { list.splice(i, 1); } }
    };
    obj.emit = function (ev) {
      var list = handlers[ev], args = Array.prototype.slice.call(arguments, 1), i;
      if (!list) { return; }
      list = list.slice();
      for (i = 0; i < list.length; i++) {
        try { list[i].apply(obj, args); } catch (e) { if (K.log) { K.log.error(e); } }
      }
    };
    return obj;
  };

  // Simple localStorage JSON helpers (prefs, session, flags)
  U.lsGet = function (key, def) {
    try {
      var v = window.localStorage.getItem(key);
      return v === null ? def : JSON.parse(v);
    } catch (e) { return def; }
  };
  U.lsSet = function (key, val) {
    try { window.localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  };
  U.lsDel = function (key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  };

  // Run tasks (fn(cb)) one after another; done(err) at the end.
  U.series = function (tasks, done) {
    var i = 0;
    function next(err) {
      if (err || i >= tasks.length) { if (done) { done(err || null); } return; }
      var t = tasks[i++];
      t(next);
    }
    next();
  };

  // Calls fn(item, cb) for each, sequentially.
  U.eachSeries = function (items, fn, done) {
    var i = 0;
    function next(err) {
      if (err || i >= items.length) { if (done) { done(err || null); } return; }
      var item = items[i++];
      fn(item, next);
    }
    next();
  };

  var rafFn = window.requestAnimationFrame || window.webkitRequestAnimationFrame;
  var cafFn = window.cancelAnimationFrame || window.webkitCancelAnimationFrame;
  U.raf = function (f) { return rafFn ? rafFn.call(window, f) : setTimeout(f, 16); };
  U.caf = function (id) { if (cafFn) { cafFn.call(window, id); } else { clearTimeout(id); } };

  U.perfNow = function () {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  };

  K.util = U;
})(window.Kagoj = window.Kagoj || {});
