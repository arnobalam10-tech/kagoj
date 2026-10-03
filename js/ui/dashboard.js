(function (K) {
  'use strict';

  var D = K.dom, U = K.util, Repo = K.Repo, sheets = K.sheets;
  var screen = {};
  var st = null;

  K.COVERS = [
    { name: 'Charcoal', c: '#2F3640' }, { name: 'Navy', c: '#1F3A5F' },
    { name: 'Forest green', c: '#2E5E3E' }, { name: 'Maroon', c: '#7A2E3A' },
    { name: 'Mustard', c: '#C9A227' }, { name: 'Teal', c: '#1F7A7A' },
    { name: 'Purple', c: '#5B3F8C' }, { name: 'Sand', c: '#C8B48A' }
  ];
  K.PAPERS = [
    { id: 'blank', name: 'Blank' }, { id: 'ruled', name: 'Ruled' },
    { id: 'grid', name: 'Grid' }, { id: 'dotted', name: 'Dotted' }
  ];

  function lightCover(c) { return c === '#C9A227' || c === '#C8B48A'; }

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

  // Paper preview tile (small canvas)
  K.paperTile = function (style, w, h) {
    var c = D.el('canvas.paper-tile');
    var dpr = U.dpr();
    K.render.sizeCanvas(c, w, h, dpr);
    var vp = { w: w, h: h, scale: w / 360, ox: 0, oy: 0, pw: 1000, ph: 1414 };
    K.render.paper(c.getContext('2d'), vp, style, dpr);
    return c;
  };

  function cover(nb, small) {
    var el = D.el('div.cover' + (small ? '.cover-small' : '') + (lightCover(nb.cover_color) ? '.cover-light' : ''));
    el.style.backgroundColor = nb.cover_color;
    el.appendChild(D.el('div.cover-title', { text: nb.title }));
    return el;
  }

  function openNotebook(nb) {
    var last = Repo.meta('lastPage.' + nb.id, 1);
    K.router.go('#/nb/' + nb.id + '/' + last);
  }

  function longPress(el, fn) {
    var t = null, fired = false, sx = 0, sy = 0;
    D.on(el, 'touchstart', function (e) {
      fired = false;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      t = setTimeout(function () { fired = true; t = null; fn(); }, 600);
    }, { passive: true });
    D.on(el, 'touchmove', function (e) {
      if (t && (Math.abs(e.touches[0].clientX - sx) > 10 || Math.abs(e.touches[0].clientY - sy) > 10)) { clearTimeout(t); t = null; }
    }, { passive: true });
    D.on(el, 'touchend', function (e) {
      if (t) { clearTimeout(t); t = null; }
      if (fired && e.cancelable) { e.preventDefault(); }
    }, D.passiveFalse);
    D.on(el, 'contextmenu', function (e) { e.preventDefault(); fn(); });
    return function () { return fired; };
  }

  function card(nb) {
    var el = D.el('div.card');
    var more = D.button({ icon: 'more', title: 'Notebook actions', cls: 'card-more' });
    var meta = D.el('div.card-meta', null, [
      D.el('div.card-title', { text: nb.title }),
      D.el('div.card-sub', { text: nb.page_count + (nb.page_count === 1 ? ' page' : ' pages') + ' · Edited ' + U.relTime(nb.updated_at) })
    ]);
    var body = D.el('div.card-tap', null, [cover(nb), meta]);
    D.append(el, [body, more]);
    var wasLong = longPress(body, function () { actions(nb); });
    D.tap(body, function () { if (!wasLong()) { openNotebook(nb); } });
    D.tap(more, function () { actions(nb); });
    return el;
  }

  function newCard() {
    var el = D.el('div.card.card-new');
    var c = D.el('div.cover.cover-new', null, [D.icon('plus'), D.el('div', { text: 'New notebook' })]);
    el.appendChild(D.el('div.card-tap', null, [c]));
    D.tap(el, function () { createSheet(); });
    return el;
  }

  function actions(nb) {
    sheets.actionSheet({
      title: nb.title,
      items: [
        { label: 'Rename', icon: 'edit', onTap: function () { renameNotebook(nb); } },
        { label: 'Change colour', icon: 'palette', onTap: function () { colourSheet(nb); } },
        { label: 'Duplicate', icon: 'copy', onTap: function () {
          sheets.toast('Duplicating…');
          Repo.duplicateNotebook(nb.id, function (err) {
            sheets.toast(err ? 'Could not duplicate: ' + (err.message || err) : 'Notebook duplicated');
          });
        } },
        { label: 'Delete', icon: 'trash', danger: true, onTap: function () { deleteNotebook(nb); } }
      ]
    });
  }

  function renameNotebook(nb) {
    sheets.prompt({ title: 'Rename notebook', value: nb.title }, function (v) {
      if (v === null) { return; }
      v = v.replace(/^\s+|\s+$/g, '');
      if (!v) { return; }
      Repo.updateNotebook(nb.id, { title: v });
    });
  }
  K.renameNotebook = renameNotebook;

  function swatchRow(selected, onPick) {
    var row = D.el('div.swatches');
    K.COVERS.forEach(function (cv) {
      var b = D.el('button.swatch' + (cv.c === selected ? '.selected' : ''), { type: 'button', title: cv.name, 'aria-label': cv.name });
      b.style.backgroundColor = cv.c;
      D.tap(b, function () {
        var all = row.querySelectorAll('.swatch');
        for (var i = 0; i < all.length; i++) { all[i].classList.remove('selected'); }
        b.classList.add('selected');
        onPick(cv.c);
      });
      row.appendChild(b);
    });
    return row;
  }

  function colourSheet(nb) {
    var picked = nb.cover_color;
    sheets.modal({
      title: 'Cover colour',
      body: swatchRow(picked, function (c) { picked = c; }),
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onTap: function () {
        Repo.updateNotebook(nb.id, { cover_color: picked });
      } }]
    });
  }

  function deleteNotebook(nb) {
    sheets.confirm({
      title: 'Delete “' + nb.title + '”?',
      message: 'It will stay in Settings → Recently deleted for 30 days.',
      ok: 'Delete', danger: true
    }, function (ok) {
      if (!ok) { return; }
      Repo.deleteNotebook(nb.id);
      sheets.toast('Notebook deleted');
    });
  }

  function createSheet() {
    var color = K.COVERS[0].c, paper = 'ruled';
    var title = D.el('input.text-input', {
      type: 'text', value: '', placeholder: 'Untitled notebook', maxlength: 120,
      autocapitalize: 'sentences', autocorrect: 'off'
    });
    var papers = D.el('div.paper-tiles');
    K.PAPERS.forEach(function (p) {
      var b = D.el('button.paper-choice' + (p.id === paper ? '.selected' : ''), { type: 'button' }, [
        K.paperTile(p.id, 54, 72), D.el('span', { text: p.name })
      ]);
      D.tap(b, function () {
        var all = papers.querySelectorAll('.paper-choice');
        for (var i = 0; i < all.length; i++) { all[i].classList.remove('selected'); }
        b.classList.add('selected');
        paper = p.id;
      });
      papers.appendChild(b);
    });
    var body = D.el('div.create-form', null, [
      D.el('label.field-label', { text: 'Title' }), title,
      D.el('label.field-label', { text: 'Cover colour' }), swatchRow(color, function (c) { color = c; }),
      D.el('label.field-label', { text: 'Default paper' }), papers
    ]);
    function create() {
      var t = title.value.replace(/^\s+|\s+$/g, '') || 'Untitled notebook';
      var res = Repo.createNotebook({ title: t, cover_color: color, default_paper: paper });
      K.router.go('#/nb/' + res.notebook.id + '/1');
    }
    var m = sheets.modal({
      title: 'New notebook', body: body, cls: 'sheet-create',
      actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onTap: create }]
    });
    D.on(title, 'keydown', function (e) { if (e.keyCode === 13) { m.close(); create(); } });
    title.focus();
  }

  function render() {
    if (!st) { return; }
    var q = st.search.value.replace(/^\s+|\s+$/g, '').toLowerCase();
    var all = Repo.notebooks();
    var list = all.filter(function (n) { return !q || n.title.toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return U.parseTime(b.updated_at) - U.parseTime(a.updated_at); });
    var body = D.empty(st.body);

    if (!q && all.length > 1) {
      var recent = all.filter(function (n) { return n.last_opened_at; })
        .sort(function (a, b) { return U.parseTime(b.last_opened_at) - U.parseTime(a.last_opened_at); })
        .slice(0, U.isPhone() ? 2 : 4);
      if (recent.length) {
        body.appendChild(D.el('h2.section-title', { text: 'Recent' }));
        var row = D.el('div.recent-row');
        recent.forEach(function (nb) {
          var r = D.el('button.recent', { type: 'button' }, [cover(nb, true), D.el('span.recent-title', { text: nb.title })]);
          D.tap(r, function () { openNotebook(nb); });
          row.appendChild(r);
        });
        body.appendChild(row);
      }
    }

    body.appendChild(D.el('h2.section-title', { text: q ? 'Results' : 'All notebooks' }));
    var grid = D.el('div.grid');
    if (!q) { grid.appendChild(newCard()); }
    list.forEach(function (nb) { grid.appendChild(card(nb)); });
    body.appendChild(grid);
    if (!all.length) {
      body.appendChild(D.el('p.empty', { text: 'No notebooks yet. Tap “New notebook” to start writing.' }));
    } else if (q && !list.length) {
      body.appendChild(D.el('p.empty', { text: 'No notebooks match “' + st.search.value + '”.' }));
    }
  }

  function homeTip() {
    if (!U.isIOS || U.isStandalone || U.lsGet('kagoj.tipDismissed', false)) { return null; }
    var tip = D.el('div.tip', null, [
      D.el('span', { text: 'Tap Share → Add to Home Screen for fullscreen.' })
    ]);
    var x = D.button({ icon: 'close', title: 'Dismiss', cls: 'tip-close' });
    D.tap(x, function () { U.lsSet('kagoj.tipDismissed', true); D.remove(tip); K.app.layout(); });
    tip.appendChild(x);
    return tip;
  }

  screen.mount = function (root) {
    var pill = K.statusPill();
    var settingsBtn = D.button({ icon: 'settings', title: 'Settings' });
    D.tap(settingsBtn, function () { K.router.go('#/settings'); });
    var top = D.el('header.topbar', null, [
      D.el('div.wordmark', null, [D.el('span.wm-en', { text: 'Kagoj' }), D.el('span.wm-bn', { text: 'কাগজ' })]),
      D.el('div.spacer'), pill, settingsBtn
    ]);
    var search = D.el('input.search', {
      type: 'search', placeholder: 'Search notebooks', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false'
    });
    var body = D.el('div.dash-body');
    var scroller = D.el('div.dash-scroll.scrolls', null, [
      D.el('div.search-wrap', null, [D.icon('search', 'search-icon'), search]),
      body
    ]);
    D.append(root, [top, homeTip(), scroller]);
    st = { root: root, search: search, body: body, pill: pill };
    D.on(search, 'input', render);
    st.onChange = U.debounce(render, 150);
    Repo.on('change', st.onChange);
    render();
  };

  screen.unmount = function () {
    if (!st) { return; }
    Repo.off('change', st.onChange);
    st.onChange.cancel();
    st.pill.destroy();
    st = null;
  };

  K.screens = K.screens || {};
  K.screens.dashboard = screen;
})(window.Kagoj = window.Kagoj || {});
