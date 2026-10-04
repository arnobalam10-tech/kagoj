(function (K) {
  'use strict';

  // Small UI pieces shared by every screen.
  var D = K.dom, sheets = K.sheets;

  // Status pill shared by dashboard and workspace
  K.statusPill = function () {
    var pill = D.el('button.pill', { type: 'button' });
    var dot = D.el('span.pill-dot');
    var txt = D.el('span.pill-text');
    D.append(pill, [dot, txt]);
    function show(s) {
      pill.className = 'pill pill-' + s.code;
      txt.textContent = s.text;
    }
    show(K.Sync.status());
    var h = K.Sync.on('status', show);
    D.tap(pill, function () {
      var s = K.Sync.status();
      if (s.code === 'loggedout') { K.router.go('#/login'); return; }
      if (s.code === 'error') {
        sheets.confirm({ title: 'Sync failed', message: s.detail || 'Unknown error', ok: 'Retry' }, function (ok) {
          if (ok) { K.Sync.retryFailed(); }
        });
        return;
      }
      if (s.code === 'offline') { sheets.toast('No connection. Everything is saved on this device.'); }
      K.Sync.now();
    });
    pill.destroy = function () { K.Sync.off('status', h); };
    return pill;
  };

  // Notebooks | Uploads switch shown in the top bar of both sections
  K.mainTabs = function (active) {
    var wrap = D.el('div.segmented.main-tabs');
    [['notebooks', 'Notebooks', '#/'], ['uploads', 'Uploads', '#/uploads']].forEach(function (t) {
      var b = D.el('button.seg' + (t[0] === active ? '.selected' : ''), { type: 'button', text: t[1] });
      D.tap(b, function () { if (t[0] !== active) { K.router.go(t[2]); } });
      wrap.appendChild(b);
    });
    return wrap;
  };
})(window.Kagoj = window.Kagoj || {});
