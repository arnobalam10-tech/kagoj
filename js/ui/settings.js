(function (K) {
  'use strict';

  var D = K.dom, U = K.util, Repo = K.Repo, sheets = K.sheets;
  var screen = {};
  var st = null;

  function section(title, rows) {
    return D.el('section.set-section', null, [D.el('h2.section-title', { text: title }), D.el('div.set-card', null, rows)]);
  }

  function row(label, right, sub) {
    return D.el('div.set-row', null, [
      D.el('div.set-label', null, [D.el('div', { text: label }), sub ? D.el('div.set-sub', { text: sub }) : null]),
      right || null
    ]);
  }

  function toggle(on, onChange) {
    var b = D.el('button.toggle' + (on ? '.on' : ''), { type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false' }, D.el('span.knob'));
    D.tap(b, function () {
      on = !on;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      onChange(on);
    });
    return b;
  }

  function segmented(options, value, onChange) {
    var wrap = D.el('div.segmented');
    options.forEach(function (o) {
      var b = D.el('button.seg' + (o[0] === value ? '.selected' : ''), { type: 'button', text: o[1] });
      D.tap(b, function () {
        var all = wrap.querySelectorAll('.seg');
        for (var i = 0; i < all.length; i++) { all[i].classList.remove('selected'); }
        b.classList.add('selected');
        onChange(o[0]);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function smallBtn(label, fn, cls) {
    var b = D.button({ label: label, cls: 'small-btn' + (cls ? ' ' + cls : '') });
    D.tap(b, fn);
    return b;
  }

  function logout() {
    sheets.actionSheet({
      title: 'Log out of Kagoj on this device?',
      items: [
        { label: 'Log out (keep notebooks on this device)', onTap: function () { doLogout(false); } },
        { label: 'Log out and clear this device', danger: true, onTap: function () {
          var n = K.Sync.pendingCount();
          sheets.confirm({
            title: 'Clear this device?',
            message: n ? n + ' change(s) have not synced yet and will be lost.' : 'Everything is synced. Notebooks stay in the cloud.',
            ok: 'Clear', danger: true
          }, function (ok) { if (ok) { doLogout(true); } });
        } }
      ]
    });
  }

  function doLogout(clear) {
    K.sb.logout(function () {
      if (!clear) { render(); return; }
      Repo.clearDevice(function () {
        U.lsDel('kagoj.offlineOk');
        U.lsDel('kagoj.lastSyncOk');
        K.router.go('#/login');
      });
    });
  }

  function deletedSection() {
    var items = Repo.deletedItems();
    var rows = [];
    items.notebooks.forEach(function (nb) {
      rows.push(row(nb.title, smallBtn('Restore', function () {
        Repo.restoreNotebook(nb.id);
        sheets.toast('Restored “' + nb.title + '”');
        render();
      }), 'Notebook · deleted ' + U.relTime(nb.deleted_at)));
    });
    items.pages.forEach(function (p) {
      var nb = Repo.notebook(p.notebook_id);
      rows.push(row('Page in “' + (nb ? nb.title : '?') + '”', smallBtn('Restore', function () {
        Repo.restorePage(p.id);
        sheets.toast('Page restored');
        render();
      }), (p.label ? p.label + ' · ' : '') + 'deleted ' + U.relTime(p.deleted_at)));
    });
    if (!rows.length) { rows.push(D.el('div.set-row.muted', { text: 'Nothing here. Deleted notebooks and pages stay for 30 days.' })); }
    return section('Recently deleted', rows);
  }

  function storageSection() {
    var limited = K.Store.isLimited();
    var u = K.Store.usage();
    var rows = [row('Storage on this device', D.el('span.set-value', { text: limited ? 'localStorage' : 'IndexedDB' }))];
    if (limited) {
      rows.push(D.el('div.set-row.warn', { text: 'Using limited storage (about 5 MB). Cloud sync is your backup.' }));
      if (u) { rows.push(row('Used', D.el('span.set-value', { text: Math.round(u.fraction * 100) + '%' }))); }
    }
    var nbs = Repo.notebooks().length;
    var live = U.values(Repo.pages).filter(function (p) {
      var nb = Repo.notebook(p.notebook_id);
      return !p.deleted_at && nb && !nb.deleted_at;
    });
    var pages = live.length;
    var local = live.filter(function (p) { return !p.needsDrawing; }).length;
    rows.push(row('Notebooks / pages', D.el('span.set-value', { text: nbs + ' / ' + pages + (local !== pages ? ' (' + local + ' downloaded)' : '') })));
    return section('Storage', rows);
  }

  function render() {
    if (!st) { return; }
    var body = D.empty(st.body);
    var s = K.Sync.status();
    var loggedIn = K.sb.isLoggedIn();

    body.appendChild(section('Account', [
      loggedIn
        ? row(K.sb.email(), smallBtn('Log out', logout), 'Logged in')
        : row('Not logged in', smallBtn('Log in', function () { K.router.go('#/login'); }, 'primary'), 'Notebooks are only saved on this device')
    ]));

    body.appendChild(section('Sync', [
      row(s.text, smallBtn('Sync now', function () { K.Sync.retryFailed(); sheets.toast('Syncing…'); }),
        (K.Sync.lastOkAt ? 'Last synced ' + U.relTime(K.Sync.lastOkAt) : 'Never synced') + (s.detail ? ' · ' + s.detail : ''))
    ]));

    var p = K.prefs.all();
    body.appendChild(section('Writing', [
      row('Reopen last notebook on launch', toggle(p.reopenLast, function (v) { K.prefs.set('reopenLast', v); })),
      row('Default zoom', segmented([['auto', 'Auto'], ['width', 'Fit width'], ['page', 'Fit page']], p.fitMode, function (v) { K.prefs.set('fitMode', v); }),
        'Auto: whole page in portrait, page width in landscape')
    ]));

    body.appendChild(deletedSection());
    body.appendChild(storageSection());

    var info = [
      'Device: ' + U.deviceName(),
      'Screen: ' + window.screen.width + '×' + window.screen.height + ' @' + (window.devicePixelRatio || 1) + 'x',
      'Home-screen app: ' + (U.isStandalone ? 'yes' : 'no'),
      'IndexedDB: ' + (window.indexedDB ? 'yes' : 'no') + ' (using ' + K.Store.backend + ')'
    ].join(' · ');
    var ver = D.el('div.version', { text: 'Kagoj ' + K.config.version });
    var taps = 0, tapTimer = null;
    D.tap(ver, function () {
      taps++;
      if (tapTimer) { clearTimeout(tapTimer); }
      tapTimer = setTimeout(function () { taps = 0; }, 1500);
      if (taps >= 5) {
        taps = 0;
        var on = K.debug.toggle();
        sheets.toast(on ? 'Debug console on' : 'Debug console off');
        render();
      }
    });
    var aboutRows = [D.el('div.set-row.about', null, [ver, D.el('div.set-sub', { text: info })])];
    if (K.debug.isOn()) {
      aboutRows.push(row('FPS meter', toggle(K.debug.fpsOn(), function (v) { K.debug.setFps(v); })));
      aboutRows.push(row('Force localStorage backend', toggle(U.lsGet('kagoj.forceLs', false), function (v) {
        U.lsSet('kagoj.forceLs', v);
        sheets.toast('Takes effect after reopening the app');
      }), 'For testing the fallback only'));
    }
    body.appendChild(section('About', aboutRows));
  }

  screen.mount = function (root) {
    var back = D.button({ icon: 'back', label: 'Notebooks', cls: 'back-btn' });
    D.tap(back, function () { K.router.go('#/'); });
    var top = D.el('header.topbar', null, [back, D.el('div.top-title', { text: 'Settings' }), D.el('div.spacer')]);
    var body = D.el('div.set-body');
    D.append(root, [top, D.el('div.dash-scroll.scrolls', null, body)]);
    st = { body: body, onStatus: function () {}, onChange: U.debounce(render, 300) };
    Repo.on('change', st.onChange);
    render();
  };

  screen.unmount = function () {
    if (!st) { return; }
    Repo.off('change', st.onChange);
    st.onChange.cancel();
    st = null;
  };

  K.screens = K.screens || {};
  K.screens.settings = screen;
})(window.Kagoj = window.Kagoj || {});
