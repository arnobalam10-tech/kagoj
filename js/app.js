(function (K) {
  'use strict';

  var D = K.dom, U = K.util;
  var app = U.emitter({});
  var root = null;

  // Size the shell from window.innerHeight (100vh is buggy on iOS 9).
  app.layout = function () {
    if (!root) { return; }
    root.style.height = window.innerHeight + 'px';
    root.style.width = window.innerWidth + 'px';
    document.body.classList.toggle('portrait', window.innerHeight > window.innerWidth);
    document.body.classList.toggle('phone', U.isPhone() || window.innerWidth < 600);
    document.body.classList.toggle('has-touch', !!U.hasTouch);
    app.emit('resize');
  };

  app.canUseApp = function () {
    return K.sb.isLoggedIn() || K.Repo.hasData() || (K.Docs && K.Docs.all().length > 0) || U.lsGet('kagoj.offlineOk', false);
  };

  // Where to go on launch (or after login)
  app.startHash = function (afterLogin) {
    if (!app.canUseApp()) { return '#/login'; }
    var last = K.Repo.meta('lastRoute', null);
    if (!afterLogin && K.prefs.get('reopenLast') && last) {
      var m = /^#\/p\/([^/]+)/.exec(last), n = /^#\/nb\/([^/]+)/.exec(last);
      if (m && K.Docs.get(m[1]) && K.Docs.isLive(K.Docs.get(m[1]))) { return last; }
      if (n && K.Repo.notebook(n[1]) && !K.Repo.notebook(n[1]).deleted_at) { return last; }
    }
    return '#/';
  };

  // On-demand bundles (see index.html / scripts/build.js). In development every
  // file is already loaded, so need() answers at once.
  var waiting = {};
  K.loaded = K.loaded || {};
  app.need = function (name, cb) {
    cb = cb || function () {};
    var map = window.KAGOJ_BUNDLES;
    if (!map || !map[name] || K.loaded[name]) { cb(null); return; }
    if (waiting[name]) { waiting[name].push(cb); return; }
    waiting[name] = [cb];
    var s = document.createElement('script');
    s.src = map[name];
    function finish(err) {
      var list = waiting[name]; delete waiting[name];
      if (err) { D.remove(s); }
      for (var i = 0; i < list.length; i++) { list[i](err); }
      if (!err) { app.emit('bundle', name); }
    }
    s.onload = function () { finish(K.loaded[name] ? null : new Error('Part of the app did not load (' + name + ').')); };
    s.onerror = function () { finish(new Error('Could not load this part of the app. Check the connection.')); };
    document.body.appendChild(s);
  };
  // several bundles in order
  app.needAll = function (names, cb) {
    names = [].concat(names);
    U.eachSeries(names, function (n, next) { app.need(n, next); }, cb);
  };
  app.loadExtras = function (cb) { app.need('extra', cb); };
  app.extrasLoaded = function () { return !window.KAGOJ_BUNDLES || !!K.loaded.extra; };

  // Which bundle each screen lives in
  app.screenBundle = { workspace: 'canvas', dashboard: ['extra', 'canvas'], uploads: 'extra', folder: 'extra', settings: 'extra', login: 'extra', trash: 'extra', page: ['editor', 'db', 'more'], calendar: ['editor', 'db', 'plan', 'cal'] };

  // Application Cache lets the iOS 9 home-screen app open with no network.
  function watchAppCache() {
    var ac = window.applicationCache;
    if (!ac) { return; }
    function ready() {
      if (ac.status !== 4) { return; } // UPDATEREADY
      try { ac.swapCache(); } catch (e) { /* ignore */ }
      app.updateReady = true;
      K.log('app update downloaded');
      if (K.router.screenName !== 'workspace') { location.reload(); }
    }
    ac.addEventListener('updateready', ready, false);
    ready();
  }

  function fatal(msg) {
    D.empty(root);
    root.appendChild(D.el('div.fatal', null, [
      D.el('h1', { text: 'Kagoj could not start' }),
      D.el('p', { text: msg })
    ]));
  }

  app.boot = function () {
    root = document.getElementById('app');
    app.layout();
    var resizeT = null;
    function onResize() {
      if (resizeT) { clearTimeout(resizeT); }
      // iOS reports the old size for a moment after rotating
      resizeT = setTimeout(app.layout, 120);
    }
    D.on(window, 'resize', onResize);
    D.on(window, 'orientationchange', function () { setTimeout(app.layout, 350); });

    // Save immediately when the app is hidden or closed.
    function hide() { app.emit('hide'); }
    D.on(window, 'pagehide', hide);
    D.on(document, 'visibilitychange', function () { if (document.hidden) { hide(); } });
    D.on(window, 'beforeunload', hide);

    K.log('boot ' + K.config.version + ' on ' + U.deviceName() + (U.isStandalone ? ' (home screen)' : ''));
    K.Store.init(function (err) {
      if (err) { fatal('This browser cannot store data (' + (err.message || err) + '). Private browsing may be on.'); return; }
      K.log('storage: ' + K.Store.backend);
      K.Repo.init(function (err2) {
        if (err2) { fatal('Could not read local data: ' + (err2.message || err2)); return; }
        K.Repo.purgeOld();
        K.Docs.init(function (err3) {
          if (err3) { fatal('Could not read your pages: ' + (err3.message || err3)); return; }
          K.Docs.purgeOld();
          start();
        });
      });
    });

    function start() {
      K.Theme.apply();
      K.Sync.start();
      // databases + reminders load in the background so Home can show Upcoming and alerts fire anywhere
      setTimeout(function () { if (app.canUseApp()) { app.needAll(['editor', 'db', 'plan', 'more']); } }, 2500);
      if (U.lsGet('kagoj.debug', false)) { app.need('extra', function () { if (K.debug) { K.debug.show(); } }); }
      var splash = document.getElementById('splash');
      if (splash) { D.remove(splash); }
      // open on Home; the home-screen app (iPad) ignores the address it was left on
      var homeScreenApp = !!window.navigator.standalone;
      if (!location.hash || location.hash === '#' || location.hash === '#/' || (homeScreenApp && !K.prefs.get('reopenLast') && location.hash !== '#/login')) {
        var h = app.startHash(false);
        if (window.history && window.history.replaceState) { window.history.replaceState(null, '', h); }
        else { location.hash = h; }
      }
      K.router.start(K.shell.build(root));
      watchAppCache();
      bindShortcuts();
    }
  };

  // Keyboard shortcuts that work everywhere (PC)
  function bindShortcuts() {
    D.on(document, 'keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey, k = e.keyCode;
      if (!mod) { return; }
      if (k === 80 && !e.shiftKey) { e.preventDefault(); app.search(); }
      else if (k === 78 && !e.shiftKey && K.router.screenName !== 'workspace') { e.preventDefault(); K.shell.newPage(null); }
      else if (k === 220) { e.preventDefault(); K.shell.toggle(); }
      else if (k === 76 && e.shiftKey) { e.preventDefault(); K.Theme.toggle(); }
      else if (k === 219 && !e.shiftKey && !e.altKey) { e.preventDefault(); window.history.back(); }
      else if (k === 221 && !e.shiftKey && !e.altKey) { e.preventDefault(); window.history.forward(); }
    });
  }

  K.app = app;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', app.boot);
  } else {
    app.boot();
  }
})(window.Kagoj = window.Kagoj || {});
