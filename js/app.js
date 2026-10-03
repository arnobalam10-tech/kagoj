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
    document.body.classList.toggle('phone', U.isPhone());
    app.emit('resize');
  };

  app.canUseApp = function () {
    return K.sb.isLoggedIn() || K.Repo.hasData() || U.lsGet('kagoj.offlineOk', false);
  };

  // Where to go on launch (or after login)
  app.startHash = function (afterLogin) {
    if (!app.canUseApp()) { return '#/login'; }
    var last = K.Repo.meta('lastOpen', null);
    if (!afterLogin && K.prefs.get('reopenLast') && last && last.id) {
      var nb = K.Repo.notebook(last.id);
      if (nb && !nb.deleted_at) { return '#/nb/' + last.id + '/' + (last.page || 1); }
    }
    return '#/';
  };

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
        K.Sync.start();
        if (K.debug.isOn()) { K.debug.show(); }
        var splash = document.getElementById('splash');
        if (splash) { D.remove(splash); }
        if (!location.hash || location.hash === '#' || location.hash === '#/') {
          var h = app.startHash(false);
          if (window.history && window.history.replaceState) { window.history.replaceState(null, '', h); }
          else { location.hash = h; }
        }
        K.router.start(root);
      });
    });
  };

  K.app = app;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', app.boot);
  } else {
    app.boot();
  }
})(window.Kagoj = window.Kagoj || {});
