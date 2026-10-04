(function (K) {
  'use strict';

  var D = K.dom, U = K.util;
  var screen = {};

  screen.mount = function (root) {
    var err = D.el('p.login-error', { role: 'alert' });
    var email = D.el('input.text-input', {
      type: 'email', placeholder: 'Email or username', autocapitalize: 'off', autocorrect: 'off',
      spellcheck: 'false', autocomplete: 'username', name: 'email', value: K.sb.email() || ''
    });
    var pass = D.el('input.text-input', {
      type: 'password', placeholder: 'Password', autocomplete: 'current-password', name: 'password'
    });
    var btn = D.el('button.btn.primary.login-btn', { type: 'submit', text: 'Log in' });
    var form = D.el('form.login-form', { novalidate: true, action: '#' }, [email, pass, btn, err]);

    var busy = false;
    function submit(e) {
      if (e) { e.preventDefault(); }
      if (busy) { return; }
      err.textContent = '';
      if (!email.value || !pass.value) { err.textContent = 'Enter your email and password'; return; }
      busy = true;
      btn.textContent = 'Logging in…';
      btn.disabled = true;
      K.sb.login(email.value, pass.value, function (e2) {
        busy = false;
        btn.textContent = 'Log in';
        btn.disabled = false;
        if (e2) { err.textContent = K.sb.describeError(e2); return; }
        pass.value = '';
        if (email.blur) { email.blur(); }
        if (pass.blur) { pass.blur(); }
        K.router.go(K.app.startHash(true));
      });
    }
    D.on(form, 'submit', submit);

    var children = [
      D.el('div.logo', null, [
        D.el('div.logo-word', { text: 'Kagoj' }),
        D.el('div.logo-bn', { text: 'কাগজ' })
      ]),
      form
    ];
    if (K.Repo.hasData() || U.lsGet('kagoj.offlineOk', false)) {
      var offline = D.button({ label: 'Continue without logging in', cls: 'link-btn' });
      D.tap(offline, function () {
        U.lsSet('kagoj.offlineOk', true);
        K.router.go('#/');
      });
      children.push(offline);
    } else {
      var local = D.button({ label: 'Use on this device only (no sync)', cls: 'link-btn' });
      D.tap(local, function () {
        U.lsSet('kagoj.offlineOk', true);
        K.router.go('#/');
      });
      children.push(local);
    }
    root.appendChild(D.el('div.login-wrap.scrolls', null, D.el('div.login-box', null, children)));
  };

  screen.unmount = function () {};

  K.screens = K.screens || {};
  screen.chrome = false;
  K.screens.login = screen;
})(window.Kagoj = window.Kagoj || {});
