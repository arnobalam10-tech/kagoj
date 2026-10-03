(function (K) {
  'use strict';

  // On-screen debug console (toggled by tapping the version 5 times).
  var D = K.dom, U = K.util;
  var dbg = {};
  var el = null, statsEl = null, logEl = null, fpsEl = null, timer = null;

  dbg.isOn = function () { return U.lsGet('kagoj.debug', false); };
  dbg.fpsOn = function () { return U.lsGet('kagoj.fps', false); };

  dbg.toggle = function () {
    var on = !dbg.isOn();
    U.lsSet('kagoj.debug', on);
    if (on) { dbg.show(); } else { dbg.hide(); }
    return on;
  };

  dbg.setFps = function (v) {
    U.lsSet('kagoj.fps', v);
    if (fpsEl) { fpsEl.style.display = v ? '' : 'none'; }
  };

  function deviceLine() {
    return 'UA: ' + navigator.userAgent + '\nscreen ' + window.screen.width + 'x' + window.screen.height +
      ' dpr ' + (window.devicePixelRatio || 1) + ' | standalone ' + (U.isStandalone ? 'yes' : 'no') +
      ' | IDB ' + (window.indexedDB ? 'yes' : 'no') + ' | store ' + K.Store.backend;
  }

  function update() {
    var s = K.stats;
    statsEl.textContent = deviceLine() + '\nstrokes ' + s.strokes + ' | points ' + s.points +
      ' | frame ' + s.frameMs + 'ms | commit ' + s.commitMs + 'ms | render ' + s.renderMs + 'ms' +
      ' | sync ' + K.Sync.status().code + ' | pending ' + K.Sync.pendingCount();
    if (fpsEl) { fpsEl.textContent = s.fps + ' fps'; }
  }

  function addLine(line) {
    if (!logEl) { return; }
    var div = D.el('div.dbg-line.dbg-' + line.level, { text: line.t + ' ' + line.msg });
    logEl.appendChild(div);
    while (logEl.childNodes.length > 60) { logEl.removeChild(logEl.firstChild); }
    logEl.scrollTop = logEl.scrollHeight;
  }

  dbg.show = function () {
    if (el) { return; }
    statsEl = D.el('pre.dbg-stats');
    logEl = D.el('div.dbg-log.scrolls');
    var close = D.button({ label: 'Hide', cls: 'small-btn' });
    D.tap(close, function () { dbg.toggle(); });
    el = D.el('div.debug', null, [D.el('div.dbg-head', null, [D.el('b', { text: 'Debug' }), close]), statsEl, logEl]);
    fpsEl = D.el('div.fps-meter');
    fpsEl.style.display = dbg.fpsOn() ? '' : 'none';
    document.body.appendChild(el);
    document.body.appendChild(fpsEl);
    var lines = K.log.lines();
    for (var i = Math.max(0, lines.length - 60); i < lines.length; i++) { addLine(lines[i]); }
    update();
    timer = setInterval(update, 500);
  };

  dbg.hide = function () {
    if (timer) { clearInterval(timer); timer = null; }
    D.remove(el); D.remove(fpsEl);
    el = null; fpsEl = null; logEl = null; statsEl = null;
  };

  K.log.onLine(addLine);

  K.debug = dbg;
})(window.Kagoj = window.Kagoj || {});
