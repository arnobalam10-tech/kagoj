(function (K) {
  'use strict';

  var MAX = 200;
  var lines = [];
  var remoteQueue = [];
  var listeners = [];

  // Never let tokens or keys reach the console or the remote log.
  function mask(s) {
    return String(s)
      .replace(/eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g, 'eyJ…[masked]')
      .replace(/("?(access_token|refresh_token|password)"?\s*[:=]\s*"?)[^",\s}]+/gi, '$1[masked]');
  }

  function stamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function push(level, msg) {
    msg = mask(msg);
    var line = { t: stamp(), level: level, msg: msg };
    lines.push(line);
    if (lines.length > MAX) { lines.shift(); }
    if (level === 'error' || level === 'warn') {
      remoteQueue.push({ level: level, message: msg.substr(0, 3900) });
      if (remoteQueue.length > 50) { remoteQueue.shift(); }
    }
    if (window.console && window.console.log) {
      try { window.console.log('[kagoj] ' + level + ' ' + msg); } catch (e) { /* ignore */ }
    }
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](line); } catch (e2) { /* ignore */ }
    }
  }

  function fmt(args) {
    var out = [], i, a;
    for (i = 0; i < args.length; i++) {
      a = args[i];
      if (a instanceof Error) { out.push(a.message + (a.stack ? '\n' + a.stack.split('\n').slice(0, 4).join('\n') : '')); }
      else if (typeof a === 'object') {
        try { out.push(JSON.stringify(a)); } catch (e) { out.push(String(a)); }
      } else { out.push(String(a)); }
    }
    return out.join(' ');
  }

  var log = function () { push('info', fmt(arguments)); };
  log.info = log;
  log.warn = function () { push('warn', fmt(arguments)); };
  log.error = function () { push('error', fmt(arguments)); };
  log.lines = function () { return lines; };
  log.onLine = function (fn) { listeners.push(fn); };
  log.takeRemote = function (n) { return remoteQueue.splice(0, n || 20); };
  log.requeueRemote = function (items) { remoteQueue = items.concat(remoteQueue).slice(-50); };
  log.mask = mask;

  window.onerror = function (msg, file, line, col, err) {
    var f = file ? String(file).split('/').pop() : '?';
    push('error', msg + ' @ ' + f + ':' + line + (col ? ':' + col : '') + (err && err.stack ? '\n' + String(err.stack).split('\n').slice(0, 3).join('\n') : ''));
    return false;
  };

  // Shared runtime stats for the debug overlay
  K.stats = { frameMs: 0, commitMs: 0, renderMs: 0, strokes: 0, points: 0, fps: 0 };

  K.log = log;
})(window.Kagoj = window.Kagoj || {});
