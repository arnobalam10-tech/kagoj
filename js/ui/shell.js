(function (K) {
  'use strict';

  // App shell (V2): left sidebar + main area. The sidebar is pinned on wide
  // screens and slides over the page on narrow ones (iPad portrait, phones).
  var D = K.dom, U = K.util, sheets = K.sheets;
  var Shell = U.emitter({});
  var el = {}, chromeOn = true, overlayOpen = false;
  var PIN_W = 1000;

  Shell.pinned = function () { return window.innerWidth >= PIN_W && !K.prefs.get('sbCollapsed'); };

  Shell.build = function (root) {
    el.root = root;
    el.side = D.el('aside.sidebar');
    el.back = D.el('div.sb-backdrop');
    el.main = D.el('div.main');
    el.shell = D.el('div.shell', null, [el.side, el.back, el.main]);
    root.appendChild(el.shell);
    D.tap(el.back, function () { Shell.close(); });
    D.on(el.back, 'touchmove', function (e) { if (e.cancelable) { e.preventDefault(); } }, D.passiveFalse);
    Shell.renderSide = U.debounce(renderSide, 120);
    K.Docs.on('change', function () { Shell.renderSide(); });
    K.Repo.on('change', function () { Shell.renderSide(); });
    K.app.on('resize', layout);
    renderSide();
    layout();
    return el.main;
  };

  function layout() {
    var sideVisible = chromeOn && (Shell.pinned() || overlayOpen);
    el.shell.className = 'shell' + (chromeOn ? '' : ' no-chrome') + (Shell.pinned() ? ' pinned' : ' floating') +
      (sideVisible ? ' side-open' : '') + (overlayOpen && !Shell.pinned() ? ' sb-over' : '');
    Shell.emit('layout');
  }

  // Screens that need the whole screen (pen canvas, login) turn the chrome off.
  Shell.chrome = function (on) { chromeOn = on !== false; overlayOpen = false; layout(); };
  Shell.open = function () { if (Shell.pinned()) { return; } overlayOpen = true; renderSide(); layout(); };
  Shell.close = function () { if (!overlayOpen) { return; } overlayOpen = false; layout(); };
  Shell.toggle = function () {
    if (window.innerWidth >= PIN_W) {
      K.prefs.set('sbCollapsed', !K.prefs.get('sbCollapsed'));
      overlayOpen = false;
      layout();
      return;
    }
    if (overlayOpen) { Shell.close(); } else { Shell.open(); }
  };
  Shell.isOpen = function () { return chromeOn && (Shell.pinned() || overlayOpen); };

  // ☰ button for screen top bars; hidden while the sidebar is pinned open
  // Save, sync, then reload (also picks up a new app version). For the iPad
  // home-screen app, which has no browser reload button.
  var refreshing = false;
  Shell.refresh = function () {
    if (refreshing) { return; }
    refreshing = true;
    sheets.toast('Refreshing…', 8000);
    K.app.emit('hide');                       // open pages save their edits
    var done = false;
    function reload() { if (done) { return; } done = true; location.reload(); }
    if (K.sb.isLoggedIn() && navigator.onLine !== false) {
      var onDone = function () { K.Sync.off('done', onDone); setTimeout(reload, 150); };
      K.Sync.on('done', onDone);
      setTimeout(reload, 6000);
      K.Sync.now();
    } else {
      setTimeout(reload, 300);
    }
  };
  Shell.refreshButton = function (cls) {
    var b = D.button({ icon: 'refresh', title: 'Refresh (sync and reload)', cls: cls || 'refresh-btn' });
    D.tap(b, Shell.refresh);
    return b;
  };

  Shell.menuButton = function () {
    var b = D.button({ icon: 'menu', title: 'Sidebar (Ctrl+\\)', cls: 'menu-btn' });
    D.tap(b, Shell.toggle);
    return b;
  };

  // ---------- opening things ----------

  Shell.hrefFor = function (d) {
    if (!d) { return '#/'; }
    if (d.kind === 'canvas' && d.settings && d.settings.notebook) { return '#/nb/' + d.settings.notebook + '/1'; }
    return '#/p/' + d.id;
  };
  Shell.openDoc = function (d) {
    if (d && d.kind === 'section') {
      // sections aren't pages: show them in the sidebar
      setSecOpen(d.id, true); K.prefs.set('sbLastSection', d.id); renderSide(); Shell.open(); return;
    }
    Shell.close();
    if (d) { K.Docs.visit(d.id); }
    K.router.go(Shell.hrefFor(d));
  };

  Shell.newPage = function (parentId, kind) {
    parentId = parentId || Shell.defaultParent();
    var sec = K.Docs.get(parentId);
    if (sec && sec.kind === 'section') { K.prefs.set('sbLastSection', sec.id); }
    var d = K.Docs.create({ parent_id: parentId || null, kind: kind || 'page', content: kind === 'database' ? [] : undefined });
    if (parentId) { var o = K.prefs.get('sbOpen'); o[parentId] = true; K.prefs.set('sbOpen', o); }
    Shell.openDoc(d);
    return d;
  };

  // A handwritten notebook that lives in the page tree
  Shell.newCanvas = function (parentId) {
    parentId = parentId || Shell.defaultParent();
    var res = K.Repo.createNotebook({ title: 'Handwritten notes', cover_color: '#2F3640', default_paper: 'ruled' });
    var d = K.Docs.create({ parent_id: parentId || null, kind: 'canvas', title: res.notebook.title, icon: '✍️', content: [], settings: { notebook: res.notebook.id } });
    Shell.openDoc(d);
    return d;
  };

  // ---------- sidebar ----------

  function navItem(icon, label, hash, extra) {
    var b = D.el('button.sb-item' + (location.hash === hash ? '.active' : ''), { type: 'button' }, [D.icon(icon), D.el('span', { text: label })]);
    D.tap(b, function () { Shell.close(); if (extra) { extra(); } else { K.router.go(hash); } });
    return b;
  }

  function sectionHead(label, prefKey, onAdd) {
    var open = K.prefs.get(prefKey) !== false;
    var head = D.el('div.sb-sec', null, [D.el('span', { text: label })]);
    if (onAdd) {
      var add = D.button({ icon: 'plus', title: 'Add a page', cls: 'sb-mini' });
      D.tap(add, function (e) { if (e && e.stopPropagation) { e.stopPropagation(); } onAdd(); });
      head.appendChild(add);
    }
    D.tap(head.firstChild, function () { K.prefs.set(prefKey, !open); renderSide(); });
    return { el: head, open: open };
  }

  function docIcon(d) {
    if (d.icon) { return D.el('span.ti.emoji', { text: d.icon }); }
    return D.el('span.ti', null, D.icon(d.kind === 'database' ? 'table' : (d.kind === 'canvas' ? 'pen' : 'file')));
  }

  function currentDocId() {
    var m = /^#\/p\/([^/]+)/.exec(location.hash);
    return m ? m[1] : null;
  }

  var drag = null;

  function treeRow(d, depth, container) {
    var open = !!K.prefs.get('sbOpen')[d.id];
    var kids = d.kind === 'canvas' ? [] : K.Docs.treeChildren(d.id);
    var row = D.el('div.tree-row' + (currentDocId() === d.id ? '.active' : ''), { 'data-id': d.id });
    row.style.paddingLeft = (6 + depth * 14) + 'px';
    var tw = D.el('button.tw', { type: 'button', 'aria-label': open ? 'Collapse' : 'Expand' }, D.icon(open ? 'chevron-down' : 'chevron-right'));
    if (d.kind === 'canvas') { tw.style.visibility = 'hidden'; }
    D.tap(tw, function () {
      var o = K.prefs.get('sbOpen');
      if (open) { delete o[d.id]; } else { o[d.id] = true; }
      K.prefs.set('sbOpen', o);
      renderSide();
    });
    var label = D.el('span.tt', { text: K.Docs.titleOf(d) });
    var more = D.button({ icon: 'more', title: 'Page actions', cls: 'sb-mini' });
    D.tap(more, function () { Shell.docMenu(d); });
    var plus = D.button({ icon: 'plus', title: 'Add a page inside', cls: 'sb-mini' });
    D.tap(plus, function () { Shell.newPage(d.id); });
    var body = D.el('div.tree-main', null, [docIcon(d), label]);
    D.append(row, [tw, body, D.el('span.tree-act', null, d.kind === 'canvas' ? [more] : [more, plus])]);
    bindDrag(row, body, d);
    container.appendChild(row);
    if (open && d.kind !== 'canvas') {
      if (!kids.length) {
        var empty = D.el('div.tree-empty', { text: d.kind === 'database' ? 'Open to see its rows' : 'No pages inside' });
        empty.style.paddingLeft = (34 + (depth + 1) * 14) + 'px';
        container.appendChild(empty);
      }
      kids.forEach(function (k) { treeRow(k, depth + 1, container); });
    }
  }

  // Tap opens; press-and-hold (touch) or drag (mouse) moves the page:
  // drop on a page = nest inside it, drop on its top edge = put before it.
  function bindDrag(row, body, d) {
    var timer = null, sx = 0, sy = 0, moved = false, startT = 0;
    function begin(x, y) { drag = { id: d.id, ghost: null, x: x, y: y }; row.classList.add('dragging'); }
    function target(x, y) {
      var list = el.side.querySelectorAll('.tree-row, .sb-section');
      for (var i = 0; i < list.length; i++) {
        var r = list[i].getBoundingClientRect();
        if (y >= r.top && y <= r.bottom) { return { row: list[i], before: y < r.top + r.height * 0.3 }; }
      }
      return null;
    }
    function mark(t) {
      var marked = el.side.querySelectorAll('.drop-in, .drop-before');
      for (var i = 0; i < marked.length; i++) { marked[i].classList.remove('drop-in'); marked[i].classList.remove('drop-before'); }
      if (t && t.row.getAttribute('data-id') !== d.id) { t.row.classList.add(t.before && !t.row.classList.contains('sb-section') ? 'drop-before' : 'drop-in'); }
    }
    function finish(x, y) {
      row.classList.remove('dragging');
      var t = target(x, y);
      mark(null);
      drag = null;
      if (!t) { return; }
      var tid = t.row.getAttribute('data-id');
      if (tid === d.id) { return; }
      var tdoc = K.Docs.get(tid);
      if (!tdoc) { return; }
      var ok;
      if (tdoc.kind === 'section') {
        ok = K.Docs.move(d.id, tid, null);
        if (ok) { setSecOpen(tid, true); }
      } else if (t.before) {
        var sibs = K.Docs.treeChildren(tdoc.parent_id), prev = null;
        for (var i = 0; i < sibs.length; i++) { if (sibs[i].id === tid) { break; } if (sibs[i].id !== d.id) { prev = sibs[i]; } }
        ok = K.Docs.move(d.id, tdoc.parent_id, prev ? prev.id : null);
        if (ok && !prev) { K.Docs.update(d.id, { position: tdoc.position - 1 }, { meta: true }); }
      } else {
        if (tdoc.kind === 'canvas') { return; }
        ok = K.Docs.move(d.id, tid, null);
        if (ok) { var o = K.prefs.get('sbOpen'); o[tid] = true; K.prefs.set('sbOpen', o); }
      }
      if (!ok) { sheets.toast('A page cannot go inside itself.'); }
    }
    D.on(body, 'touchstart', function (e) {
      var t = e.touches[0];
      sx = t.clientX; sy = t.clientY; moved = false; startT = Date.now();
      timer = setTimeout(function () { timer = null; begin(sx, sy); }, 450);
    }, { passive: true });
    D.on(body, 'touchmove', function (e) {
      var t = e.touches[0];
      if (timer && (Math.abs(t.clientX - sx) > 8 || Math.abs(t.clientY - sy) > 8)) { clearTimeout(timer); timer = null; moved = true; }
      if (drag) { if (e.cancelable) { e.preventDefault(); } mark(target(t.clientX, t.clientY)); }
    }, D.passiveFalse);
    D.on(body, 'touchend', function (e) {
      if (timer) { clearTimeout(timer); timer = null; }
      var t = e.changedTouches[0];
      if (drag) { if (e.cancelable) { e.preventDefault(); } finish(t.clientX, t.clientY); return; }
      if (!moved && Date.now() - startT < 450) { if (e.cancelable) { e.preventDefault(); } Shell.openDoc(d); }
    }, D.passiveFalse);
    D.on(body, 'mousedown', function (e) {
      if (e.button !== 0) { return; }
      sx = e.clientX; sy = e.clientY; moved = false;
      function mm(ev) {
        if (!drag && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 6) { begin(sx, sy); }
        if (drag) { mark(target(ev.clientX, ev.clientY)); }
      }
      function mu(ev) {
        window.removeEventListener('mousemove', mm);
        window.removeEventListener('mouseup', mu);
        if (drag) { finish(ev.clientX, ev.clientY); } else { Shell.openDoc(d); }
      }
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', mu);
    });
  }

  Shell.docMenu = function (d) {
    var items = [
      { label: 'Open', icon: 'file', onTap: function () { Shell.openDoc(d); } },
      { label: d.favorite ? 'Remove from Favorites' : 'Add to Favorites', icon: 'star', onTap: function () { K.Docs.update(d.id, { favorite: !d.favorite }, { meta: true }); } },
      { label: 'Rename', icon: 'edit', onTap: function () { Shell.rename(d); } },
      d.kind !== 'canvas' ? { label: 'Duplicate', icon: 'copy', onTap: function () { var c = K.Docs.duplicate(d.id); sheets.toast('Duplicated'); if (c) { Shell.renderSide(); } } } : null,
      { label: 'Move to…', icon: 'folder', onTap: function () { Shell.moveTo(d); } },
      d.kind !== 'canvas' ? { label: 'Add a page inside', icon: 'plus', onTap: function () { Shell.newPage(d.id); } } : null,
      { label: 'Delete', icon: 'trash', danger: true, onTap: function () { Shell.remove(d); } }
    ];
    sheets.actionSheet({ title: K.Docs.titleOf(d), items: items });
  };

  Shell.rename = function (d) {
    sheets.prompt({ title: 'Rename', value: d.title }, function (v) {
      if (v === null) { return; }
      K.Docs.update(d.id, { title: v.replace(/^\s+|\s+$/g, '').substr(0, 500) }, { meta: true });
      if (d.kind === 'canvas' && d.settings && d.settings.notebook) { K.Repo.updateNotebook(d.settings.notebook, { title: v || 'Handwritten notes' }); }
    });
  };

  Shell.remove = function (d) {
    var n = 0;
    (function count(id) { K.Docs.children(id).forEach(function (c) { n++; count(c.id); }); })(d.id);
    sheets.confirm({
      title: 'Delete “' + K.Docs.titleOf(d) + '”?',
      message: (n ? 'Its ' + n + ' sub-page' + (n === 1 ? '' : 's') + ' go too. ' : '') + 'It stays in Trash for 30 days.',
      ok: 'Delete', danger: true
    }, function (ok) {
      if (!ok) { return; }
      K.Docs.remove(d.id);
      if (d.kind === 'canvas' && d.settings && d.settings.notebook) { K.Repo.deleteNotebook(d.settings.notebook); }
      sheets.toast('Moved to Trash');
      if (currentDocId() === d.id || K.Docs.isAncestor(d.id, currentDocId())) { K.router.go('#/'); }
    });
  };

  // Pick a new parent (or the top level)
  Shell.moveTo = function (d) {
    var body = D.el('div.move-list.scrolls');
    var input = D.el('input.text-input', { type: 'search', placeholder: 'Search pages', autocapitalize: 'off', autocorrect: 'off' });
    var m = sheets.modal({ title: 'Move “' + K.Docs.titleOf(d) + '” to', body: D.el('div', null, [input, body]), actions: [{ label: 'Cancel' }] });
    function choose(pid) {
      if (K.Docs.move(d.id, pid, null)) { sheets.toast('Moved'); } else { sheets.toast('A page cannot go inside itself.'); }
      m.close();
    }
    function render() {
      D.empty(body);
      var q = input.value.toLowerCase();
      K.Docs.sections().forEach(function (sec) {
        if (q && K.Docs.titleOf(sec).toLowerCase().indexOf(q) < 0) { return; }
        var r0 = D.el('button.pick-row', { type: 'button' }, [D.el('span.ti', { text: sec.icon || '' }, sec.icon ? null : D.icon('folder')), D.el('span.pick-label', null, [D.el('span', { text: K.Docs.titleOf(sec) }), D.el('span.pick-sub', { text: 'Section' })])]);
        D.tap(r0, function () { choose(sec.id); });
        body.appendChild(r0);
      });
      K.Docs.all().filter(function (x) {
        return (x.kind === 'page' || x.kind === 'database') && x.id !== d.id && K.Docs.isLive(x) && !K.Docs.isAncestor(d.id, x.id) &&
          (!q || K.Docs.titleOf(x).toLowerCase().indexOf(q) >= 0);
      }).slice(0, 60).forEach(function (x) {
        var path = K.Docs.path(x.id).map(K.Docs.titleOf).join(' / ');
        var r = D.el('button.pick-row', { type: 'button' }, [docIcon(x), D.el('span.pick-label', null, [D.el('span', { text: K.Docs.titleOf(x) }), D.el('span.pick-sub', { text: path })])]);
        D.tap(r, function () { choose(x.id); });
        body.appendChild(r);
      });
    }
    D.on(input, 'input', render);
    render();
  };

  // ---------- sections (Personal, University, Life ...) ----------

  // Always at least one section; pages left at the top level (made on an older
  // version or another device) go into the first one.
  function ensureSections() {
    var secs = K.Docs.sections();
    if (!secs.length) {
      var uid = K.sb && K.sb.userId && K.sb.userId();
      // the same id on every device, so two devices never make two "Personal" sections
      var id = uid && /^[0-9a-f]{8}-/.test(uid) ? '5ec7104e' + uid.substr(8) : undefined;
      var existing = id ? K.Docs.get(id) : null;
      if (existing) { K.Docs.update(id, { deleted_at: null }, { meta: true }); }
      else { K.Docs.create({ id: id, kind: 'section', title: 'Personal', content: [], settings: { auto: true } }); }
      secs = K.Docs.sections();
    }
    // a device that was logged out made its own "Personal": fold it into the shared one
    var uid2 = K.sb && K.sb.userId && K.sb.userId();
    var shared = uid2 && /^[0-9a-f]{8}-/.test(uid2) ? K.Docs.get('5ec7104e' + uid2.substr(8)) : null;
    if (shared && !shared.deleted_at) {
      secs.forEach(function (s) {
        if (s.id === shared.id || !(s.settings && s.settings.auto)) { return; }
        K.Docs.children(s.id).forEach(function (c) { K.Docs.update(c.id, { parent_id: shared.id, position: K.Docs.positionAt(shared.id, null) }, { meta: true }); });
        K.Docs.remove(s.id);
      });
      secs = K.Docs.sections();
    }
    var first = secs[0];
    K.Docs.treeChildren(null).forEach(function (d) {
      if (K.Docs.isLive(d)) { K.Docs.update(d.id, { parent_id: first.id, position: K.Docs.positionAt(first.id, null) }, { meta: true }); }
    });
  }

  // Where "New page" goes: the section of the open page, else the last one used
  Shell.defaultParent = function () {
    var cur = currentDocId(), sec = cur ? K.Docs.sectionOf(cur) : null;
    if (!sec) { var last = K.Docs.get(K.prefs.get('sbLastSection') || ''); if (last && last.kind === 'section' && !last.deleted_at) { sec = last; } }
    if (!sec) { ensureSections(); sec = K.Docs.sections()[0]; }
    return sec ? sec.id : null;
  };

  function setSecOpen(id, on) {
    var c = K.prefs.get('sbSecClosed');
    if (on) { delete c[id]; } else { c[id] = true; }
    K.prefs.set('sbSecClosed', c);
  }

  function renderSection(sec, scroll) {
    var open = !K.prefs.get('sbSecClosed')[sec.id];
    var head = D.el('div.sb-sec.sb-section' + (open ? '' : '.closed'), { 'data-id': sec.id });
    var name = D.el('button.sb-sec-name', { type: 'button' }, [sec.icon ? D.el('span.sb-sec-ico', { text: sec.icon }) : null, D.el('span', { text: K.Docs.titleOf(sec) === 'Untitled' ? 'Untitled section' : K.Docs.titleOf(sec) }), D.icon('chevron-down', 'sb-sec-caret')]);
    D.tap(name, function () { setSecOpen(sec.id, !open); renderSide(); });
    var more = D.button({ icon: 'more', title: 'Section options', cls: 'sb-mini' });
    D.tap(more, function (e) { if (e && e.stopPropagation) { e.stopPropagation(); } Shell.sectionMenu(sec); });
    var add = D.button({ icon: 'plus', title: 'Add a page to ' + K.Docs.titleOf(sec), cls: 'sb-mini' });
    D.tap(add, function (e) { if (e && e.stopPropagation) { e.stopPropagation(); } setSecOpen(sec.id, true); Shell.newPage(sec.id); });
    D.append(head, [name, D.el('span.tree-act', null, [more, add])]);
    scroll.appendChild(head);
    if (!open) { return; }
    var tl = D.el('div.tree');
    var kids = K.Docs.treeChildren(sec.id);
    kids.forEach(function (d) { treeRow(d, 0, tl); });
    if (!kids.length) {
      var e2 = D.el('button.sb-item.sb-add.sb-sec-empty', { type: 'button' }, [D.icon('plus'), D.el('span', { text: 'Add a page' })]);
      D.tap(e2, function () { Shell.newPage(sec.id); });
      tl.appendChild(e2);
    }
    scroll.appendChild(tl);
  }

  Shell.newSection = function () {
    sheets.prompt({ title: 'New section', value: '', ok: 'Add' }, function (v) {
      if (v === null) { return; }
      v = v.replace(/^\s+|\s+$/g, '').substr(0, 100);
      if (!v) { return; }
      var s = K.Docs.create({ kind: 'section', title: v, content: [] });
      K.prefs.set('sbLastSection', s.id);
      renderSide();
    });
  };

  Shell.sectionMenu = function (sec) {
    var secs = K.Docs.sections(), i = secs.indexOf(sec);
    function inSec(fn) { return function () { K.prefs.set('sbLastSection', sec.id); fn(); }; }
    sheets.actionSheet({ title: K.Docs.titleOf(sec), items: [
      { label: 'Add a page', icon: 'plus', onTap: inSec(function () { Shell.newPage(sec.id); }) },
      { label: 'Add a database', icon: 'table', onTap: inSec(function () { Shell.newPage(sec.id, 'database'); }) },
      { label: 'Add a handwritten page', icon: 'pen', onTap: inSec(function () { Shell.newCanvas(sec.id); }) },
      { label: 'New page from a template', icon: 'page-add', onTap: inSec(function () {
        K.app.needAll(['editor', 'db', 'more'], function (err) { if (!err && K.templatePicker) { Shell.close(); K.templatePicker(sec.id); } });
      }) },
      { label: 'Rename', icon: 'edit', onTap: function () { Shell.rename(sec); } },
      { label: 'Choose an icon', icon: 'smile', onTap: function () {
        sheets.prompt({ title: 'Icon (an emoji, or empty for none)', value: sec.icon || '', max: 8 }, function (v) {
          if (v !== null) { K.Docs.update(sec.id, { icon: v.replace(/^\s+|\s+$/g, '') || null }, { meta: true }); renderSide(); }
        });
      } },
      i > 0 ? { label: 'Move up', icon: 'chevron-up', onTap: function () { swapPos(sec, secs[i - 1]); } } : null,
      i < secs.length - 1 ? { label: 'Move down', icon: 'chevron-down', onTap: function () { swapPos(sec, secs[i + 1]); } } : null,
      { label: 'Delete section', icon: 'trash', danger: true, onTap: function () {
        if (secs.length < 2) { sheets.toast('Keep at least one section. Add another one first.', 4000); return; }
        Shell.remove(sec);
      } }
    ] });
  };
  function swapPos(a, b) {
    var pa = a.position, pb = b.position;
    if (pa === pb) { pb = pa + 1; }
    K.Docs.update(a.id, { position: pb }, { meta: true });
    K.Docs.update(b.id, { position: pa }, { meta: true });
    renderSide();
  }

  function renderSide() {
    if (!el.side) { return; }
    var side = D.empty(el.side);
    var collapse = D.button({ icon: 'chevrons-left', title: 'Hide sidebar', cls: 'sb-mini sb-collapse' });
    D.tap(collapse, Shell.toggle);
    side.appendChild(D.el('div.sb-head', null, [
      D.el('div.sb-brand', null, [D.el('span.wm-en', { text: 'Kagoj' }), D.el('span.wm-bn', { text: 'কাগজ' })]),
      Shell.refreshButton('sb-mini sb-refresh'),
      collapse
    ]));
    var scroll = D.el('div.sb-scroll.scrolls');
    var nav = D.el('div.sb-nav', null, [
      navItem('search', 'Search', null, function () { K.app.search(); }),
      navItem('home', 'Home', '#/'),
      navItem('calendar', 'Calendar', '#/calendar'),
      navItem('pen', 'Handwritten notebooks', '#/notebooks'),
      navItem('upload', 'Uploads', '#/uploads'),
      navItem('settings', 'Settings', '#/settings')
    ]);
    scroll.appendChild(nav);

    var favs = K.Docs.favorites();
    if (favs.length) {
      var fh = sectionHead('Favorites', 'sbFavOpen');
      scroll.appendChild(fh.el);
      if (fh.open) {
        var fl = D.el('div.tree');
        favs.forEach(function (d) { treeRow(d, 0, fl); });
        scroll.appendChild(fl);
      }
    }

    ensureSections();
    K.Docs.sections().forEach(function (sec) { renderSection(sec, scroll); });
    var addSec = D.el('button.sb-item.sb-add', { type: 'button' }, [D.icon('plus'), D.el('span', { text: 'Add a section' })]);
    D.tap(addSec, function () { Shell.newSection(); });
    scroll.appendChild(addSec);
    scroll.appendChild(D.el('div.sb-gap'));
    scroll.appendChild(navItem('trash', 'Trash', '#/trash'));
    side.appendChild(scroll);

    if (!el.pill) { el.pill = K.statusPill(); }
    var pill = el.pill;
    var newBtn = D.button({ icon: 'page-add', label: 'New page', cls: 'sb-new' });
    D.tap(newBtn, function () { Shell.newPage(null); });
    side.appendChild(D.el('div.sb-foot', null, [pill, newBtn]));
  }

  K.shell = Shell;
})(window.Kagoj = window.Kagoj || {});
