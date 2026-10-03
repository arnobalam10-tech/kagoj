(function (K) {
  'use strict';

  // Hash routes: #/login, #/, #/nb/<id>/<page>, #/settings
  var D = K.dom;
  var router = { current: null, screenName: null, root: null };

  router.parse = function (hash) {
    var h = (hash || '').replace(/^#/, '');
    var parts = h.split('/').filter(function (x) { return x !== ''; });
    if (parts[0] === 'login') { return { name: 'login' }; }
    if (parts[0] === 'settings') { return { name: 'settings' }; }
    if (parts[0] === 'nb' && parts[1]) {
      return { name: 'workspace', id: parts[1], page: Math.max(1, parseInt(parts[2], 10) || 1) };
    }
    return { name: 'dashboard' };
  };

  router.go = function (hash) {
    if (location.hash === hash) { router.handle(); return; }
    location.hash = hash;
  };

  // Change the URL without re-rendering (e.g. page turns inside a notebook)
  router.replace = function (hash) {
    router.silent = hash;
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', hash);
      router.silent = null;
    } else {
      location.replace(hash);
    }
  };

  router.handle = function () {
    if (router.silent && location.hash === router.silent) { router.silent = null; return; }
    var r = router.parse(location.hash);
    if (r.name !== 'login' && !K.app.canUseApp()) { router.go('#/login'); return; }
    var screen = K.screens[r.name];
    if (router.current && router.screenName === r.name && router.current.update && router.current.update(r)) {
      return;
    }
    if (router.current && router.current.unmount) {
      try { router.current.unmount(); } catch (e) { K.log.error(e); }
    }
    D.empty(router.root);
    var host = D.el('div.screen.screen-' + r.name);
    router.root.appendChild(host);
    router.screenName = r.name;
    router.current = screen;
    document.body.className = 'on-' + r.name;
    try {
      screen.mount(host, r);
    } catch (e2) {
      K.log.error(e2);
      host.appendChild(D.el('p.fatal', { text: 'Something went wrong: ' + e2.message }));
    }
  };

  router.start = function (root) {
    router.root = root;
    D.on(window, 'hashchange', router.handle);
    router.handle();
  };

  K.screens = K.screens || {};
  K.router = router;
})(window.Kagoj = window.Kagoj || {});
