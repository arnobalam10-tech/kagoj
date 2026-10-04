(function (K) {
  'use strict';

  // Database views: table, board, list, gallery, calendar, timeline, chart.
  // DbView.mount(host, db, pageView, {full|inline}) -> {destroy}
  var D = K.dom, U = K.util, Docs = K.Docs, DB = K.DB, E = K.DBEdit, sheets = K.sheets;
  var DAY = 86400000;

  function trim(s) { return String(s || '').replace(/^\s+|\s+$/g, ''); }
  function isWide() { return window.innerWidth >= 900; }

  // Properties in the view's column order, without hidden ones
  function ordered(db, view, withHidden) {
    var ps = (db.schema.props || []).slice(), ord = view.order || [];
    ps.sort(function (a, b) {
      if (a.type === 'title') { return -1; }
      if (b.type === 'title') { return 1; }
      var ia = ord.indexOf(a.id), ib = ord.indexOf(b.id);
      if (ia < 0) { ia = 1000 + ps.indexOf(a); }
      if (ib < 0) { ib = 1000 + ps.indexOf(b); }
      return ia - ib;
    });
    return withHidden ? ps : ps.filter(function (p) { return (view.hidden || []).indexOf(p.id) < 0; });
  }
  function moveProp(db, view, p, dir) {
    var ids = ordered(db, view, true).map(function (x) { return x.id; });
    var i = ids.indexOf(p.id), j = i + dir;
    if (i < 1 || j < 1 || j >= ids.length) { return; }
    ids.splice(i, 1); ids.splice(j, 0, p.id);
    view.order = ids;
    DB.saveSchema(db);
  }

  // ---------- value display ----------

  function display(db, row, p, compact) {
    var raw = DB.raw(db, row, p);
    switch (p.type) {
      case 'title':
        return D.el('span.cell-title', null, [row.icon ? K.docIconEl(row) : null, D.el('span.ct-text', { text: row.title || (compact ? 'Untitled' : '') })]);
      case 'select': case 'status':
        var o = DB.option(p, raw);
        return o ? E.chip(o.name, o.color) : null;
      case 'multi':
        var box = D.el('span.chips');
        (raw || []).forEach(function (id) { var o2 = DB.option(p, id); if (o2) { box.appendChild(E.chip(o2.name, o2.color)); } });
        return box.firstChild ? box : null;
      case 'relation':
        var rb = D.el('span.chips');
        (raw || []).forEach(function (id) {
          var r = Docs.get(id);
          if (!r || !Docs.isLive(r)) { return; }
          var a = D.el('button.rel-chip', { type: 'button' }, [K.docIconEl(r), D.el('span', { text: Docs.titleOf(r) })]);
          D.tap(a, function (e) { if (e && e.stopPropagation) { e.stopPropagation(); } openRow(r, null); });
          rb.appendChild(a);
        });
        return rb.firstChild ? rb : null;
      case 'check':
        return D.el('span.cb-box' + (raw ? '.on' : ''), null, raw ? D.icon('check') : null);
      case 'number':
        if (typeof raw === 'number' && (p.fmt === 'bar' || p.fmt === 'ring')) {
          var pct = Math.max(0, Math.min(100, raw));
          if (p.fmt === 'ring') {
            var c = 2 * Math.PI * 7;
            var svg = '<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" class="ring-bg"/><circle cx="9" cy="9" r="7" class="ring-fg" stroke-dasharray="' + (c * pct / 100).toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 9 9)"/></svg>';
            var ring = D.el('span.ring');
            ring.innerHTML = svg;
            return D.el('span.num-ring', null, [ring, D.el('span', { text: Math.round(raw) + '%' })]);
          }
          var bar = D.el('span.num-bar', null, D.el('span.nb-fill', { style: { width: pct + '%' } }));
          return D.el('span.num-barbox', null, [bar, D.el('span.nb-num', { text: Math.round(raw) + '%' })]);
        }
        break;
      case 'url': case 'email': case 'phone':
        return raw ? D.el('span.cell-link', { text: raw }) : null;
      case 'date':
        if (!raw) { return null; }
        var t = DB.text(db, row, p);
        var dv = DB.value(db, row, p);
        var over = false;
        var today0 = new Date(); today0.setHours(0, 0, 0, 0);
        if (dv && (dv.e || dv.d) < today0.getTime() && !isDone(db, row)) { over = true; }
        return D.el('span.cell-date' + (over ? '.overdue' : ''), null, [D.el('span', { text: t }), raw.r !== undefined ? D.icon('bell', 'mini') : null]);
    }
    var s = DB.text(db, row, p);
    return s ? D.el('span.cell-text' + (s.charAt(0) === '\u26A0' ? '.err' : ''), { text: s }) : null;
  }
  function isDone(db, row) {
    var st = DB.firstOf(db, ['status']);
    if (st) { var o = DB.option(st, DB.raw(db, row, st)); if (o && o.g === 'done') { return true; } }
    var ck = DB.firstOf(db, ['check']);
    return !!(ck && DB.raw(db, row, ck));
  }

  // ---------- opening rows ----------

  function openRow(row, view) {
    if (!row) { return; }
    if (isWide() && !(view && view.open === 'page') && K.DbPeek) { K.DbPeek.open(row); }
    else { K.shell.openDoc(row); }
  }

  function rowMenu(db, row, cb) {
    sheets.actionSheet({ title: Docs.titleOf(row), items: [
      { label: 'Open', icon: 'expand', onTap: function () { openRow(row, null); } },
      { label: 'Open as full page', icon: 'file', onTap: function () { K.shell.openDoc(row); } },
      { label: 'Duplicate', icon: 'copy', onTap: function () { Docs.duplicate(row.id); cb(); } },
      { label: 'Copy link', icon: 'link', onTap: function () { K.copyText(location.origin + '/#/p/' + row.id); } },
      { label: 'Delete', icon: 'trash', danger: true, onTap: function () { Docs.remove(row.id); cb(); sheets.toast('Moved to Trash'); } }
    ] });
  }

  // ---------- drag (cards and calendar items; mouse + touch long-press) ----------

  function draggable(el, opts) {
    var start = null, ghost = null, timer = null, dragging = false, lastTarget = null;
    function pt(e) { var t = e.touches ? (e.changedTouches || e.touches)[0] : e; return { x: t.clientX, y: t.clientY }; }
    function target(p) {
      if (ghost) { ghost.style.display = 'none'; }
      var n = document.elementFromPoint(p.x, p.y);
      if (ghost) { ghost.style.display = ''; }
      while (n && n !== document.body) {
        if (n.getAttribute && n.getAttribute('data-drop') !== null) { return n; }
        n = n.parentNode;
      }
      return null;
    }
    function begin(p) {
      dragging = true;
      var r = el.getBoundingClientRect();
      ghost = el.cloneNode(true);
      ghost.className += ' drag-ghost';
      D.css(ghost, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
      ghost.offX = p.x - r.left; ghost.offY = p.y - r.top;
      document.body.appendChild(ghost);
      el.classList.add('dragging');
    }
    function move(p) {
      ghost.style.left = (p.x - ghost.offX) + 'px';
      ghost.style.top = (p.y - ghost.offY) + 'px';
      var t = target(p);
      if (t !== lastTarget) {
        if (lastTarget) { lastTarget.classList.remove('drop-on'); }
        if (t) { t.classList.add('drop-on'); }
        lastTarget = t;
      }
    }
    function end(p) {
      clearTimeout(timer);
      var was = dragging;
      dragging = false; start = null;
      if (ghost) { D.remove(ghost); ghost = null; }
      el.classList.remove('dragging');
      if (lastTarget) { lastTarget.classList.remove('drop-on'); }
      var t = was ? target(p) : null;
      lastTarget = null;
      if (was && t) { opts.drop(t.getAttribute('data-drop'), t); }
      return was;
    }
    D.on(el, 'mousedown', function (e) {
      if (e.button !== 0) { return; }
      start = pt(e);
      var offMove = D.on(document, 'mousemove', function (ev) {
        var p = pt(ev);
        if (!dragging && start && (Math.abs(p.x - start.x) > 6 || Math.abs(p.y - start.y) > 6)) { begin(start); }
        if (dragging) { ev.preventDefault(); move(p); }
      });
      var offUp = D.on(document, 'mouseup', function (ev) {
        offMove(); offUp();
        if (end(pt(ev))) { el.dragJustEnded = Date.now(); }
      });
    });
    D.on(el, 'touchstart', function (e) {
      if (e.touches.length !== 1) { return; }
      start = pt(e);
      timer = setTimeout(function () { if (start) { begin(start); if (navigator.vibrate) { navigator.vibrate(15); } } }, 380);
    }, { passive: true });
    D.on(el, 'touchmove', function (e) {
      var p = pt(e);
      if (!dragging) {
        if (start && (Math.abs(p.x - start.x) > 8 || Math.abs(p.y - start.y) > 8)) { clearTimeout(timer); start = null; }
        return;
      }
      if (e.cancelable) { e.preventDefault(); }
      move(p);
    }, D.passiveFalse);
    D.on(el, 'touchend', function (e) {
      if (end(pt(e))) { el.dragJustEnded = Date.now(); if (e.cancelable) { e.preventDefault(); } }
    }, D.passiveFalse);
    D.on(el, 'touchcancel', function () { clearTimeout(timer); if (dragging) { end({ x: -1, y: -1 }); } start = null; });
  }
  function justDragged(el) { return el.dragJustEnded && Date.now() - el.dragJustEnded < 400; }

  // ---------- the view ----------

  function DbView(host, db, page, opts) {
    this.host = host; this.db = db; this.page = page; this.opts = opts || {};
    this.search = '';
    this.searchOpen = false;
    var self = this;
    if (!db.schema || !db.schema.props) { db.schema = DB.defaultSchema(); DB.saveSchema(db); }
    if (!db.schema.views || !db.schema.views.length) { db.schema.views = [DB.newView('table')]; DB.saveSchema(db); }
    this.refresh = U.debounce(function () { self.render(); }, 120);
    this.onChange = function (id) {
      if (!document.body.contains(self.host)) { self.destroy(); return; }
      var d = Docs.get(id);
      if (!d) { return; }
      if (d.id === self.db.id || d.kind === 'row' || d.kind === 'database') { self.refresh(); }
    };
    Docs.on('change', this.onChange);
    host.classList.add('dbv');
    this.render();
  }
  var P = DbView.prototype;

  P.destroy = function () {
    if (this.dead) { return; }
    this.dead = true;
    Docs.off('change', this.onChange);
    this.refresh.cancel();
  };

  P.views = function () { return this.db.schema.views; };
  P.view = function () {
    var vs = this.views(), id = U.lsGet('dbv:' + this.db.id + (this.opts.blockId ? ':' + this.opts.blockId : ''), null);
    for (var i = 0; i < vs.length; i++) { if (vs[i].id === id) { return norm(vs[i]); } }
    return norm(vs[0]);
  };
  function norm(v) {
    v.filter = v.filter || { op: 'and', rules: [] };
    v.filter.rules = v.filter.rules || [];
    v.sorts = v.sorts || []; v.hidden = v.hidden || []; v.order = v.order || [];
    v.calc = v.calc || {}; v.widths = v.widths || {};
    return v;
  }
  P.setView = function (v) {
    U.lsSet('dbv:' + this.db.id + (this.opts.blockId ? ':' + this.opts.blockId : ''), v.id);
    this.render();
  };

  P.render = function () {
    if (this.dead) { return; }
    var self = this, db = this.db, host = D.empty(this.host);
    if (!Docs.isLive(db)) { host.appendChild(D.el('p.empty', { text: 'This database was deleted.' })); return; }
    var view = this.view();
    // scroll position of wide views survives re-rendering
    var keepScroll = this.scrollEl ? this.scrollEl.scrollLeft : 0;
    if (this.opts.inline) {
      var t = D.el('button.dbv-title', { type: 'button' }, [D.icon('database'), D.el('span', { text: Docs.titleOf(db) === 'Untitled' ? 'Untitled database' : Docs.titleOf(db) })]);
      D.tap(t, function () { K.shell.openDoc(db); });
      host.appendChild(t);
    }
    // view tabs + toolbar
    var bar = D.el('div.dbv-bar');
    var tabs = D.el('div.dbv-tabs.scrolls');
    this.views().forEach(function (v) {
      var on = v.id === view.id;
      var tb = D.el('button.dbv-tab' + (on ? '.on' : ''), { type: 'button' }, [D.icon(viewIcon(v.type)), D.el('span', { text: v.name })]);
      D.tap(tb, function () {
        if (on) { E.viewSettings(db, view, self.views(), function () { self.render(); }); }
        else { self.setView(v); }
      });
      tabs.appendChild(tb);
    });
    var addV = D.el('button.dbv-tab.add', { type: 'button', title: 'Add a view' }, D.icon('plus'));
    D.tap(addV, function () { self.addView(); });
    tabs.appendChild(addV);
    bar.appendChild(tabs);
    var tools = D.el('div.dbv-tools');
    var nf = view.filter.rules.length, ns = view.sorts.length;
    var fb = D.el('button.dbv-tool' + (nf ? '.on' : ''), { type: 'button', title: 'Filter' }, [D.el('span', { text: nf ? 'Filter \u00b7 ' + nf : 'Filter' })]);
    D.tap(fb, function () { E.filters(db, view, function () { self.refresh(); }); });
    var sb = D.el('button.dbv-tool' + (ns ? '.on' : ''), { type: 'button', title: 'Sort' }, [D.el('span', { text: ns ? 'Sort \u00b7 ' + ns : 'Sort' })]);
    D.tap(sb, function () { E.sorts(db, view, function () { self.refresh(); }); });
    var srch = D.el('button.dbv-tool.icon-only' + (this.search ? '.on' : ''), { type: 'button', title: 'Search' }, D.icon('search'));
    D.tap(srch, function () { self.searchOpen = !self.searchOpen; if (!self.searchOpen) { self.search = ''; } self.render(); });
    var setb = D.el('button.dbv-tool.icon-only', { type: 'button', title: 'View settings' }, D.icon('settings'));
    D.tap(setb, function () { E.viewSettings(db, view, self.views(), function () { self.render(); }); });
    var nw = D.el('button.dbv-new', { type: 'button' }, [D.el('span', { text: 'New' })]);
    D.tap(nw, function () { self.newRow(view, {}, true); });
    var nwMore = D.el('button.dbv-new.more', { type: 'button', title: 'Templates' }, D.icon('chevron-down'));
    D.tap(nwMore, function () { self.templateMenu(view); });
    D.append(tools, [fb, sb, srch, setb, D.el('span.dbv-newgrp', null, [nw, nwMore])]);
    bar.appendChild(tools);
    host.appendChild(bar);
    if (this.searchOpen) {
      var si = D.el('input.text-input.dbv-search', { type: 'search', placeholder: 'Search this view', value: this.search });
      var applySearch = U.debounce(function () { self.search = trim(si.value); self.renderBody(); }, 200);
      D.on(si, 'input', applySearch);
      host.appendChild(si);
      setTimeout(function () { if (!U.hasTouch && !self.search) { si.focus(); } }, 0);
    }
    this.body = D.el('div.dbv-body.dbv-' + view.type);
    host.appendChild(this.body);
    this.renderBody();
    if (this.scrollEl && keepScroll) { this.scrollEl.scrollLeft = keepScroll; }
  };

  function viewIcon(t) { for (var i = 0; i < DB.VIEW_TYPES.length; i++) { if (DB.VIEW_TYPES[i][0] === t) { return DB.VIEW_TYPES[i][2]; } } return 'table'; }

  P.renderBody = function () {
    var view = this.view(), body = D.empty(this.body);
    this.scrollEl = null;
    var rows = DB.query(this.db, view, this.search);
    var fn = this['r_' + view.type] || this.r_table;
    fn.call(this, body, view, rows);
  };

  P.addView = function () {
    var self = this, db = this.db;
    sheets.actionSheet({ title: 'Add a view', items: DB.VIEW_TYPES.map(function (t) {
      return { label: t[1], icon: t[2], onTap: function () {
        var v = DB.newView(t[0], t[1]);
        E.ensureViewDefaults(db, v);
        db.schema.views.push(v);
        DB.saveSchema(db);
        self.setView(v);
        if ((t[0] === 'calendar' || t[0] === 'timeline') && !v.dateProp) { sheets.toast('Add a Date property to use this view.', 4000); }
      } };
    }) });
  };

  // New row, pre-filled from the view's filters and the group it was added to
  P.newRow = function (view, init, open, template) {
    var db = this.db;
    init = init || {};
    view.filter.rules.forEach(function (r) {
      if (r.rules || init[r.pid] !== undefined || r.val === '' || r.val === undefined) { return; }
      var p = DB.prop(db, r.pid);
      if (!p) { return; }
      if (r.cond === 'is' && (p.type === 'select' || p.type === 'status')) { init[p.id] = r.val; }
      if (r.cond === 'has' && p.type === 'multi') { init[p.id] = [r.val]; }
      if (r.cond === 'checked') { init[p.id] = true; }
    });
    if (!template && db.schema.defTpl) {
      var dt = Docs.get(db.schema.defTpl);
      if (dt && Docs.isLive(dt)) { template = dt; }
    }
    var row = DB.newRow(db, init, template);
    if (open) { openRow(row, view); }
    else { this.refresh(); }
    return row;
  };

  P.templateMenu = function (view) {
    var self = this, db = this.db, tpls = DB.templates(db).filter(Docs.isLive);
    var items = tpls.map(function (t) {
      return { label: Docs.titleOf(t) + (db.schema.defTpl === t.id ? ' (default)' : ''), icon: 'file', onTap: function () { self.newRow(view, {}, true, t); } };
    });
    items.push({ label: 'Empty page', icon: 'plus', onTap: function () { self.newRow(view, {}, true, { props: {}, content: [] }); } });
    items.push({ label: 'New template', icon: 'page-add', onTap: function () {
      var t = Docs.create({ parent_id: db.id, kind: 'row', title: 'New template', settings: { template: true } });
      sheets.toast('Editing a template. Rows made from it copy its properties and content.', 4500);
      K.shell.openDoc(t);
    } });
    if (tpls.length) {
      items.push({ label: 'Manage templates\u2026', icon: 'settings', onTap: function () {
        sheets.actionSheet({ title: 'Templates', items: tpls.map(function (t) {
          return { label: Docs.titleOf(t), onTap: function () {
            sheets.actionSheet({ title: Docs.titleOf(t), items: [
              { label: 'Edit', icon: 'edit', onTap: function () { K.shell.openDoc(t); } },
              { label: db.schema.defTpl === t.id ? 'Stop using as default' : 'Set as default', icon: 'check', onTap: function () { db.schema.defTpl = db.schema.defTpl === t.id ? null : t.id; DB.saveSchema(db); } },
              { label: 'Delete', icon: 'trash', danger: true, onTap: function () { Docs.remove(t.id); if (db.schema.defTpl === t.id) { db.schema.defTpl = null; DB.saveSchema(db); } } }
            ] });
          } };
        }) });
      } });
    }
    sheets.actionSheet({ title: 'New', items: items });
  };

  P.edit = function (anchor, row, p) {
    var self = this;
    E.value(anchor, this.db, row, p, function () { self.refresh(); });
  };

  // value for a row added inside a group
  function groupInit(db, view, g) {
    var o = {};
    if (!view.group || !g || g.key === '__none' || g.key === null) { return o; }
    var p = DB.prop(db, view.group);
    if (!p) { return o; }
    if (p.type === 'select' || p.type === 'status') { o[p.id] = g.key; }
    else if (p.type === 'multi') { o[p.id] = [g.key]; }
    else if (p.type === 'check') { o[p.id] = g.key === true || g.key === 'true'; }
    return o;
  }

  function setGroup(db, view, row, key, fromKey) {
    var p = DB.prop(db, view.group);
    if (!p) { return; }
    if (p.type === 'select' || p.type === 'status') { DB.set(row, p.id, key === '__none' ? null : key); }
    else if (p.type === 'multi') {
      var cur = (DB.raw(db, row, p) || []).filter(function (x) { return x !== fromKey; });
      if (key !== '__none' && cur.indexOf(key) < 0) { cur.push(key); }
      DB.set(row, p.id, cur);
    } else if (p.type === 'check') { DB.set(row, p.id, key === 'true'); }
    else { sheets.toast('Cards can only be moved between Select, Status, Multi-select or Checkbox groups.', 4000); }
  }

  function groupsFor(self, view, rows) {
    if (!view.group || !DB.prop(self.db, view.group)) { return null; }
    var gs = DB.group(self.db, rows, view.group);
    // hide the empty "No value" group unless it has rows
    return gs.filter(function (g) { return g.key !== '__none' || g.rows.length; });
  }

  function groupHead(self, view, g, extra) {
    var collapsed = (view.collapsed || []).indexOf(String(g.key)) >= 0;
    var h = D.el('button.grp-head' + (collapsed ? '.collapsed' : ''), { type: 'button' }, [
      D.icon('chevron-down', 'grp-caret'),
      g.color ? E.chip(g.label, g.color) : D.el('span', { text: g.label }),
      D.el('span.grp-count', { text: String(g.rows.length) }), extra || null
    ]);
    D.tap(h, function () {
      view.collapsed = view.collapsed || [];
      var k = String(g.key), i = view.collapsed.indexOf(k);
      if (i >= 0) { view.collapsed.splice(i, 1); } else { view.collapsed.push(k); }
      DB.saveSchema(self.db);
      self.renderBody();
    });
    return { el: h, collapsed: collapsed };
  }

  // ---------- table ----------

  P.r_table = function (body, view, rows) {
    var self = this, db = this.db;
    var props = ordered(db, view);
    var wrap = D.el('div.tbl-wrap.scrolls');
    this.scrollEl = wrap;
    var gs = groupsFor(this, view, rows);
    var groups = gs || [{ key: null, rows: rows }];
    var table = D.el('table.dbt');
    var colgroup = D.el('colgroup'), total = 44;
    props.forEach(function (p) { var w = view.widths[p.id] || (p.type === 'title' ? (window.innerWidth < 600 ? 180 : 240) : 170); total += w; colgroup.appendChild(D.el('col', { style: { width: w + 'px' } })); });
    table.style.width = total + 'px';
    colgroup.appendChild(D.el('col', { style: { width: '44px' } }));
    table.appendChild(colgroup);
    // header
    var thead = D.el('thead'), hr = D.el('tr');
    props.forEach(function (p) {
      var th = D.el('th', null, [D.icon(p.type === 'title' ? 'text' : DB.typeIcon(p.type), 'mini'), D.el('span.th-name', { text: p.name })]);
      D.tap(th, function () { self.headerMenu(p, view); });
      var grip = D.el('span.col-resize');
      resizer(grip, th, function (w) { view.widths[p.id] = Math.max(70, Math.round(w)); DB.saveSchema(db); self.renderBody(); });
      th.appendChild(grip);
      hr.appendChild(th);
    });
    var addTh = D.el('th.th-add', null, D.icon('plus'));
    D.tap(addTh, function () { E.addProperty(db, null, function () { self.refresh(); }); });
    hr.appendChild(addTh);
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = D.el('tbody');
    groups.forEach(function (g) {
      if (gs) {
        var gh = groupHead(self, view, g);
        tbody.appendChild(D.el('tr.grp-row', null, D.el('td', { colspan: props.length + 1 }, gh.el)));
        if (gh.collapsed) { return; }
      }
      g.rows.forEach(function (row) {
        var tr = D.el('tr.dbr');
        props.forEach(function (p) {
          var td = D.el('td.cell.c-' + p.type, null, display(db, row, p));
          if (p.type === 'title') {
            var open = D.el('button.row-open', { type: 'button', title: 'Open' }, [D.icon('expand'), D.el('span', { text: 'Open' })]);
            D.tap(open, function (e) { if (e && e.stopPropagation) { e.stopPropagation(); } openRow(row, view); });
            td.appendChild(open);
          }
          D.tap(td, function (e) {
            if (e && e.target && e.target.closest && e.target.closest('.row-open, .rel-chip')) { return; }
            self.edit(td, row, p);
          });
          tr.appendChild(td);
        });
        var more = D.el('td.cell.row-more', null, D.icon('more'));
        D.tap(more, function () { rowMenu(db, row, function () { self.refresh(); }); });
        tr.appendChild(more);
        tbody.appendChild(tr);
      });
      var add = D.el('tr.add-row', null, D.el('td', { colspan: props.length + 1 }, [D.icon('plus'), D.el('span', { text: 'New' })]));
      D.tap(add, function () {
        var r = self.newRow(view, groupInit(db, view, g), false);
        setTimeout(function () {
          var cells = self.body.querySelectorAll('tr.dbr');
          for (var i = 0; i < cells.length; i++) { if (cells[i].rowId === r.id) { self.edit(cells[i].firstChild, r, { id: 'title', type: 'title', name: 'Name' }); } }
        }, 200);
      });
      tbody.appendChild(add);
    });
    table.appendChild(tbody);
    // mark rows so a just-added row can be found after the debounced re-render
    var trs = tbody.querySelectorAll('tr.dbr'), k = 0;
    groups.forEach(function (g) {
      if (gs && (view.collapsed || []).indexOf(String(g.key)) >= 0) { return; }
      g.rows.forEach(function (row) { if (trs[k]) { trs[k].rowId = row.id; } k++; });
    });
    // calculations
    var tf = D.el('tfoot'), fr = D.el('tr');
    props.forEach(function (p) {
      var fn = view.calc[p.id];
      var v = fn ? DB.calc(db, rows, p, fn) : '';
      var label = fn ? calcLabel(fn) : '';
      var td = D.el('td.calc' + (fn ? '.on' : ''), null, fn ? [D.el('span.calc-l', { text: label }), D.el('span.calc-v', { text: v })] : D.el('span.calc-l', { text: 'Calculate' }));
      D.tap(td, function () {
        sheets.actionSheet({ title: 'Calculate ' + p.name, items: DB.calcsFor(p).map(function (c) {
          return { label: c[1], checked: (fn || 'none') === c[0], onTap: function () { if (c[0] === 'none') { delete view.calc[p.id]; } else { view.calc[p.id] = c[0]; } DB.saveSchema(db); self.renderBody(); } };
        }) });
      });
      fr.appendChild(td);
    });
    fr.appendChild(D.el('td'));
    tf.appendChild(fr);
    table.appendChild(tf);
    wrap.appendChild(table);
    body.appendChild(wrap);
    if (!rows.length && (view.filter.rules.length || this.search)) { body.appendChild(D.el('p.dbv-none', { text: 'No rows match this view.' })); }
  };

  function calcLabel(fn) { for (var i = 0; i < DB.CALCS.length; i++) { if (DB.CALCS[i][0] === fn) { return DB.CALCS[i][1]; } } return ''; }

  function resizer(grip, th, done) {
    D.on(grip, 'mousedown', function (e) {
      e.preventDefault(); e.stopPropagation();
      var x0 = e.clientX, w0 = th.offsetWidth, tbl = th.parentNode.parentNode.parentNode, tw0 = tbl.offsetWidth, col = tbl.querySelectorAll('col')[th.cellIndex];
      var offM = D.on(document, 'mousemove', function (ev) { var w = Math.max(70, w0 + ev.clientX - x0); col.style.width = w + 'px'; tbl.style.width = (tw0 + w - w0) + 'px'; });
      var offU = D.on(document, 'mouseup', function (ev) { offM(); offU(); done(w0 + ev.clientX - x0); });
    });
    D.on(grip, 'click', function (e) { e.stopPropagation(); });
    D.on(grip, 'touchstart', function (e) {
      e.stopPropagation();
      var x0 = e.touches[0].clientX, w0 = th.offsetWidth, tbl = th.parentNode.parentNode.parentNode, tw0 = tbl.offsetWidth, col = tbl.querySelectorAll('col')[th.cellIndex], last = w0;
      var offM = D.on(grip, 'touchmove', function (ev) { if (ev.cancelable) { ev.preventDefault(); } last = Math.max(70, w0 + ev.touches[0].clientX - x0); col.style.width = last + 'px'; tbl.style.width = (tw0 + last - w0) + 'px'; }, D.passiveFalse);
      var offU = D.on(grip, 'touchend', function (ev) { offM(); offU(); if (ev.cancelable) { ev.preventDefault(); } done(last); }, D.passiveFalse);
    }, { passive: true });
  }

  P.headerMenu = function (p, view) {
    var self = this, db = this.db;
    var extra = [];
    if (p.type !== 'title') {
      extra.push({ label: 'Move left', icon: 'chevron-left', onTap: function () { moveProp(db, view, p, -1); self.render(); } });
      extra.push({ label: 'Move right', icon: 'chevron-right', onTap: function () { moveProp(db, view, p, 1); self.render(); } });
    }
    E.propMenu(db, p, view, function () { self.render(); }, extra);
  };

  // ---------- board ----------

  P.r_board = function (body, view, rows) {
    var self = this, db = this.db;
    var gp = DB.prop(db, view.group);
    if (!gp) {
      body.appendChild(this.needProp('Group the board by a Select, Status or Checkbox property.', ['status', 'select', 'multi', 'check'], 'group', view));
      return;
    }
    var gs = DB.group(db, rows, view.group);
    var props = ordered(db, view).filter(function (p) { return p.type !== 'title' && p.id !== view.group; });
    var wrap = D.el('div.board.scrolls');
    this.scrollEl = wrap;
    gs.forEach(function (g) {
      if (g.key === '__none' && !g.rows.length && gp.type !== 'check') { return; }
      var col = D.el('div.bcol', { 'data-drop': String(g.key) });
      col.appendChild(D.el('div.bcol-head', null, [g.color ? E.chip(g.label, g.color) : D.el('span', { text: g.label }), D.el('span.grp-count', { text: String(g.rows.length) })]));
      var list = D.el('div.bcol-list');
      g.rows.forEach(function (row) {
        var card = self.card(row, props, view);
        draggable(card, { drop: function (key) { if (key !== String(g.key)) { setGroup(db, view, row, key, g.key); } } });
        list.appendChild(card);
      });
      col.appendChild(list);
      var add = D.el('button.bcol-add', { type: 'button' }, [D.icon('plus'), D.el('span', { text: 'New' })]);
      D.tap(add, function () { self.newRow(view, groupInit(db, view, g), true); });
      col.appendChild(add);
      wrap.appendChild(col);
    });
    body.appendChild(wrap);
  };

  P.card = function (row, props, view, cover) {
    var db = this.db;
    var card = D.el('div.dcard', { tabindex: '0' });
    if (cover) {
      var cv = D.el('div.dcard-cover');
      var src = coverOf(row);
      if (src) { paint(cv, src); } else { cv.appendChild(D.el('div.dcard-snip', { text: snippet(row) })); }
      card.appendChild(cv);
    }
    card.appendChild(D.el('div.dcard-title', null, [row.icon ? K.docIconEl(row) : null, D.el('span', { text: Docs.titleOf(row) })]));
    props.forEach(function (p) {
      var v = display(db, row, p, true);
      if (v && !(p.type === 'check' && !DB.raw(db, row, p))) { card.appendChild(D.el('div.dcard-prop', null, v)); }
    });
    D.tap(card, function () { if (!justDragged(card)) { openRow(row, view); } });
    D.on(card, 'contextmenu', function (e) { e.preventDefault(); rowMenu(db, row, U.noop); });
    return card;
  };

  function coverOf(row) {
    if (row.cover) { return row.cover; }
    var src = null;
    Docs.eachBlock(row.content || [], function (b) { if (!src && b.type === 'image' && (b.asset || b.src)) { src = b.asset ? 'a:' + b.asset : 'u:' + b.src; } });
    return src;
  }
  function paint(el, c) {
    if (c.indexOf('a:') === 0) {
      K.Assets.get(c.substr(2), function (err, img) { if (!err) { el.style.backgroundImage = 'url("' + img.src + '")'; } });
    } else if (c.indexOf('u:') === 0) { el.style.backgroundImage = 'url("' + c.substr(2).replace(/"/g, '') + '")'; }
    else if (c.indexOf('g:') === 0 && K.PageView && K.PageView.prototype.paintCover) { K.PageView.prototype.paintCover.call({ doc: { cover: c } }, el); }
  }
  function snippet(row) {
    var out = [];
    Docs.eachBlock(row.content || [], function (b) { if (out.join(' ').length < 160 && b.html) { out.push(Docs.plain(b.html)); } });
    return out.join(' ').substr(0, 160);
  }

  // ---------- list & gallery ----------

  P.r_list = function (body, view, rows) {
    var self = this, db = this.db;
    var props = ordered(db, view).filter(function (p) { return p.type !== 'title'; });
    var gs = groupsFor(this, view, rows) || [{ key: null, rows: rows }];
    gs.forEach(function (g) {
      if (g.label !== undefined) {
        var gh = groupHead(self, view, g);
        body.appendChild(gh.el);
        if (gh.collapsed) { return; }
      }
      g.rows.forEach(function (row) {
        var li = D.el('div.dl-row');
        li.appendChild(D.el('div.dl-title', null, [K.docIconEl(row), D.el('span', { text: Docs.titleOf(row) })]));
        var right = D.el('div.dl-props');
        props.forEach(function (p) { var v = display(db, row, p, true); if (v && !(p.type === 'check' && !DB.raw(db, row, p))) { right.appendChild(v); } });
        li.appendChild(right);
        D.tap(li, function (e) { if (e && e.target && e.target.closest && e.target.closest('.rel-chip')) { return; } openRow(row, view); });
        D.on(li, 'contextmenu', function (e) { e.preventDefault(); rowMenu(db, row, U.noop); });
        body.appendChild(li);
      });
      var add = D.el('button.dl-add', { type: 'button' }, [D.icon('plus'), D.el('span', { text: 'New' })]);
      D.tap(add, function () { self.newRow(view, groupInit(db, view, g), true); });
      body.appendChild(add);
    });
  };

  P.r_gallery = function (body, view, rows) {
    var self = this, db = this.db;
    var props = ordered(db, view).filter(function (p) { return p.type !== 'title'; });
    var gs = groupsFor(this, view, rows) || [{ key: null, rows: rows }];
    gs.forEach(function (g) {
      if (g.label !== undefined) {
        var gh = groupHead(self, view, g);
        body.appendChild(gh.el);
        if (gh.collapsed) { return; }
      }
      var grid = D.el('div.gallery');
      g.rows.forEach(function (row) { grid.appendChild(self.card(row, props, view, true)); });
      var add = D.el('button.dcard.gal-add', { type: 'button' }, [D.icon('plus'), D.el('span', { text: 'New' })]);
      D.tap(add, function () { self.newRow(view, groupInit(db, view, g), true); });
      grid.appendChild(add);
      body.appendChild(grid);
    });
  };

  // ---------- calendar ----------

  P.needProp = function (msg, types, key, view) {
    var self = this, db = this.db;
    var box = D.el('div.dbv-need', null, [D.el('p', { text: msg })]);
    var cands = (db.schema.props || []).filter(function (p) { return types.indexOf(p.type) >= 0; });
    cands.forEach(function (p) {
      var b = D.el('button.small-btn', { type: 'button', text: 'Use \u201c' + p.name + '\u201d' });
      D.tap(b, function () { view[key] = p.id; DB.saveSchema(db); self.render(); });
      box.appendChild(b);
    });
    var add = D.el('button.small-btn', { type: 'button', text: '+ Add a ' + DB.typeName(types[0]) + ' property' });
    D.tap(add, function () {
      var p = { id: DB.pid(), name: DB.typeName(types[0]), type: types[0] };
      if (types[0] === 'status') { p.options = DB.defaultSchema().props[1].options; }
      db.schema.props.push(p);
      view[key] = p.id;
      DB.saveSchema(db);
      self.render();
    });
    box.appendChild(add);
    return box;
  };

  function day0(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function addDays(t, n) { var d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); }
  function shiftIso(s, days) {
    if (!s) { return s; }
    var t = DB.parseDay(s), d = new Date(addDays(t, days));
    return K.isoDay(d) + (/T(\d\d:\d\d)/.test(s) ? 'T' + /T(\d\d:\d\d)/.exec(s)[1] : '');
  }
  function moveDate(db, row, p, days, endOnly) {
    var raw = DB.raw(db, row, p);
    if (!raw || !raw.s || !days) { return; }
    var v = U.copy(raw);
    if (!endOnly) { v.s = shiftIso(v.s, days); }
    if (v.e || endOnly) { v.e = shiftIso(v.e || raw.s, days); if (v.e < v.s) { v.e = v.s; } }
    DB.set(row, p.id, v);
  }
  K.dbMoveDate = moveDate;

  P.r_calendar = function (body, view, rows) {
    var self = this, db = this.db;
    var dp = DB.prop(db, view.dateProp);
    if (!dp) { body.appendChild(this.needProp('Choose the date property this calendar shows.', ['date'], 'dateProp', view)); return; }
    var month = this.calMonth || (function () { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); })();
    this.calMonth = month;
    var m0 = new Date(month);
    var head = D.el('div.cal-head');
    var prev = D.button({ icon: 'chevron-left', title: 'Previous month' });
    var next = D.button({ icon: 'chevron-right', title: 'Next month' });
    var todayB = D.el('button.small-btn', { type: 'button', text: 'Today' });
    D.tap(prev, function () { self.calMonth = new Date(m0.getFullYear(), m0.getMonth() - 1, 1).getTime(); self.renderBody(); });
    D.tap(next, function () { self.calMonth = new Date(m0.getFullYear(), m0.getMonth() + 1, 1).getTime(); self.renderBody(); });
    D.tap(todayB, function () { self.calMonth = null; self.renderBody(); });
    D.append(head, [D.el('div.cal-month', { text: MONTHS[m0.getMonth()] + ' ' + m0.getFullYear() }), D.el('div.spacer'), prev, todayB, next]);
    body.appendChild(head);
    var byDay = {};
    rows.forEach(function (r) {
      var v = DB.value(db, r, dp);
      if (!v || typeof v.d !== 'number') { return; }
      var s = day0(v.d), e = v.e ? day0(v.e) : s, guard = 0;
      for (var t = s; t <= e && guard < 62; t = addDays(t, 1), guard++) { (byDay[t] = byDay[t] || []).push({ row: r, first: t === s, time: v.t ? v.d : null }); }
    });
    var grid = D.el('table.cal-grid');
    var hr = D.el('tr');
    WEEK.forEach(function (w) { hr.appendChild(D.el('th', { text: w })); });
    grid.appendChild(D.el('thead', null, hr));
    var tb = D.el('tbody');
    var first = new Date(m0.getFullYear(), m0.getMonth(), 1);
    var start = addDays(first.getTime(), -((first.getDay() + 6) % 7));
    var today = day0(Date.now());
    var t = start;
    for (var w = 0; w < 6; w++) {
      var tr = D.el('tr');
      for (var i = 0; i < 7; i++) {
        tr.appendChild(this.calCell(t, m0.getMonth(), today, byDay[t] || [], dp, view));
        t = addDays(t, 1);
      }
      tb.appendChild(tr);
      if (new Date(t).getMonth() !== m0.getMonth() && w >= 3) { break; }
    }
    grid.appendChild(tb);
    body.appendChild(D.el('div.cal-wrap', null, grid));
    var undated = rows.filter(function (r) { return !DB.raw(db, r, dp); });
    if (undated.length) {
      var ub = D.el('details.cal-undated', null, D.el('summary', { text: 'No date (' + undated.length + ')' }));
      undated.forEach(function (r) {
        var it = D.el('button.cal-item', { type: 'button', text: Docs.titleOf(r) });
        D.tap(it, function () { openRow(r, view); });
        ub.appendChild(it);
      });
      body.appendChild(ub);
    }
  };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  P.calCell = function (t, month, today, items, dp, view) {
    var self = this, db = this.db, d = new Date(t);
    var td = D.el('td.cal-day' + (d.getMonth() !== month ? '.out' : '') + (t === today ? '.today' : ''), { 'data-drop': String(t) });
    td.appendChild(D.el('div.cal-num', { text: String(d.getDate()) }));
    items.sort(function (a, b) { return (a.time || 0) - (b.time || 0); });
    items.slice(0, 4).forEach(function (it) {
      var lab = (it.time && it.first ? timeLabel(it.time) + ' ' : '') + Docs.titleOf(it.row);
      var el = D.el('div.cal-item' + (it.first ? '' : '.cont') + (isDone(db, it.row) ? '.done' : ''), { text: lab });
      draggable(el, { drop: function (key) { var nd = +key; if (!isNaN(nd)) { moveDate(db, it.row, dp, Math.round((nd - t) / DAY)); } } });
      D.tap(el, function (e) { if (e && e.stopPropagation) { e.stopPropagation(); } if (!justDragged(el)) { openRow(it.row, view); } });
      td.appendChild(el);
    });
    if (items.length > 4) {
      var more = D.el('div.cal-more', { text: '+' + (items.length - 4) + ' more' });
      D.tap(more, function (e) {
        if (e && e.stopPropagation) { e.stopPropagation(); }
        sheets.actionSheet({ title: K.dateLabel(K.isoDay(new Date(t))), items: items.map(function (it) { return { label: Docs.titleOf(it.row), onTap: function () { openRow(it.row, view); } }; }) });
      });
      td.appendChild(more);
    }
    D.tap(td, function () {
      var init = {};
      init[dp.id] = { s: K.isoDay(new Date(t)) };
      self.newRow(view, init, true);
    });
    return td;
  };
  function timeLabel(ms) { var d = new Date(ms), h = d.getHours(), m = d.getMinutes(); return ((h % 12) || 12) + (m ? ':' + (m < 10 ? '0' : '') + m : '') + (h < 12 ? 'a' : 'p'); }
  K.timeLabel = timeLabel;

  // ---------- timeline ----------

  P.r_timeline = function (body, view, rows) {
    var self = this, db = this.db;
    var dp = DB.prop(db, view.dateProp);
    if (!dp) { body.appendChild(this.needProp('Choose the date property for the timeline.', ['date'], 'dateProp', view)); return; }
    var dayW = view.zoom === 'month' ? 12 : (view.zoom === 'day' ? 56 : 30);
    var startT = this.tlStart || addDays(day0(Date.now()), -7);
    this.tlStart = startT;
    var days = Math.ceil(Math.max(window.innerWidth, 700) * 1.6 / dayW);
    var head = D.el('div.cal-head');
    var prev = D.button({ icon: 'chevron-left', title: 'Earlier' });
    var next = D.button({ icon: 'chevron-right', title: 'Later' });
    var todayB = D.el('button.small-btn', { type: 'button', text: 'Today' });
    D.tap(prev, function () { self.tlStart = addDays(startT, -Math.round(days / 2)); self.renderBody(); });
    D.tap(next, function () { self.tlStart = addDays(startT, Math.round(days / 2)); self.renderBody(); });
    D.tap(todayB, function () { self.tlStart = null; self.renderBody(); });
    var zoom = E.sel([['day', 'Days'], ['week', 'Weeks'], ['month', 'Months']], view.zoom || 'week', function (v) { view.zoom = v; DB.saveSchema(db); self.renderBody(); });
    D.append(head, [D.el('div.cal-month', { text: MONTHS[new Date(startT).getMonth()] + ' ' + new Date(startT).getFullYear() }), D.el('div.spacer'), zoom, prev, todayB, next]);
    body.appendChild(head);
    var wrap = D.el('div.tl-wrap.scrolls');
    this.scrollEl = wrap;
    var inner = D.el('div.tl-inner', { style: { width: (days * dayW + 200) + 'px' } });
    var scale = D.el('div.tl-scale');
    var today = day0(Date.now());
    for (var i = 0; i < days; i++) {
      var t = addDays(startT, i), d = new Date(t);
      var lab = d.getDate() === 1 ? MONTHS[d.getMonth()].substr(0, 3) : (dayW >= 30 || d.getDay() === 1 ? String(d.getDate()) : '');
      if (view.zoom === 'month' && d.getDate() !== 1) { lab = ''; }
      scale.appendChild(D.el('div.tl-tick' + (t === today ? '.today' : '') + (d.getDay() === 0 || d.getDay() === 6 ? '.we' : ''), { style: { left: (200 + i * dayW) + 'px', width: dayW + 'px' }, text: lab }));
    }
    inner.appendChild(scale);
    var endT = addDays(startT, days);
    rows.forEach(function (r) {
      var line = D.el('div.tl-row');
      var name = D.el('button.tl-name', { type: 'button', text: Docs.titleOf(r) });
      D.tap(name, function () { openRow(r, view); });
      line.appendChild(name);
      var v = DB.value(db, r, dp);
      if (v && typeof v.d === 'number') {
        var s = day0(v.d), e = v.e ? day0(v.e) : s;
        if (e >= startT && s < endT) {
          var x0 = Math.max(0, Math.round((s - startT) / DAY)), x1 = Math.min(days, Math.round((e - startT) / DAY) + 1);
          var bar = D.el('div.tl-bar' + (isDone(db, r) ? '.done' : ''), { style: { left: (200 + x0 * dayW) + 'px', width: Math.max(dayW, (x1 - x0) * dayW) - 4 + 'px' } }, D.el('span', { text: Docs.titleOf(r) }));
          var handle = D.el('div.tl-handle');
          bar.appendChild(handle);
          tlDrag(bar, handle, dayW, function (delta, endOnly) { moveDate(db, r, dp, delta, endOnly); }, function () { openRow(r, view); });
          line.appendChild(bar);
        }
      } else {
        var place = D.el('div.tl-empty', { style: { left: '200px', width: (days * dayW) + 'px' } });
        D.on(place, 'click', function (e) {
          var rect = place.getBoundingClientRect();
          var di = Math.floor((e.clientX - rect.left) / dayW);
          DB.set(r, dp.id, { s: K.isoDay(new Date(addDays(startT, di))) });
        });
        place.title = 'Click to set a date';
        line.appendChild(place);
      }
      inner.appendChild(line);
    });
    var add = D.el('button.dl-add', { type: 'button' }, [D.icon('plus'), D.el('span', { text: 'New' })]);
    D.tap(add, function () { var init = {}; init[dp.id] = { s: K.isoDay(new Date()) }; self.newRow(view, init, true); });
    inner.appendChild(add);
    wrap.appendChild(inner);
    body.appendChild(wrap);
  };

  // drag a timeline bar sideways (move) or by its right edge (resize)
  function tlDrag(bar, handle, dayW, done, tap) {
    function attach(el, endOnly) {
      function startAt(x0, isTouch) {
        var moved = 0, base = parseFloat(bar.style.left), baseW = parseFloat(bar.style.width);
        function mv(x) {
          moved = x - x0;
          if (endOnly) { bar.style.width = Math.max(dayW - 4, baseW + moved) + 'px'; } else { bar.style.left = (base + moved) + 'px'; }
        }
        function up() {
          var days = Math.round(moved / dayW);
          if (Math.abs(moved) < 5) { if (!endOnly) { tap(); } return; }
          if (days) { done(days, endOnly); } else { bar.style.left = base + 'px'; bar.style.width = baseW + 'px'; }
        }
        if (isTouch) {
          var offM = D.on(el, 'touchmove', function (e) { if (e.cancelable) { e.preventDefault(); } mv(e.touches[0].clientX); }, D.passiveFalse);
          var offE = D.on(el, 'touchend', function (e) { offM(); offE(); if (e.cancelable) { e.preventDefault(); } up(); }, D.passiveFalse);
        } else {
          var offMm = D.on(document, 'mousemove', function (e) { mv(e.clientX); });
          var offU = D.on(document, 'mouseup', function () { offMm(); offU(); up(); });
        }
      }
      D.on(el, 'mousedown', function (e) { if (e.button === 0) { e.preventDefault(); e.stopPropagation(); startAt(e.clientX, false); } });
      D.on(el, 'touchstart', function (e) { e.stopPropagation(); startAt(e.touches[0].clientX, true); }, { passive: true });
    }
    attach(handle, true);
    attach(bar, false);
  }

  // ---------- chart ----------

  var PALETTE = { 'default': '#9B9A97', gray: '#9B9A97', brown: '#A27763', orange: '#E08A3C', yellow: '#D9B13B', green: '#4E9A6A', blue: '#4A7FC1', purple: '#8E6BBF', pink: '#C9649A', red: '#D2584A' };
  var CYCLE = ['blue', 'orange', 'green', 'purple', 'red', 'yellow', 'pink', 'brown', 'gray'];

  P.r_chart = function (body, view, rows) {
    var db = this.db;
    var gp = DB.prop(db, view.group);
    if (!gp) { body.appendChild(this.needProp('Choose what the chart groups rows by.', ['status', 'select', 'multi', 'check', 'date'], 'group', view)); return; }
    var mp = view.measure ? DB.prop(db, view.measure) : null;
    var gs = DB.group(db, rows, view.group).filter(function (g) { return g.rows.length || g.key !== '__none'; });
    if (gp.type === 'date' || gp.type === 'created' || gp.type === 'edited') { gs.sort(function (a, b) { return a.key === '__none' ? 1 : (b.key === '__none' ? -1 : (a.key < b.key ? -1 : 1)); }); }
    var data = gs.map(function (g, i) {
      var val = mp ? g.rows.reduce(function (s, r) { var v = DB.value(db, r, mp); return s + (typeof v === 'number' ? v : 0); }, 0) : g.rows.length;
      return { label: g.label, value: Math.round(val * 100) / 100, color: PALETTE[g.color && g.color !== 'default' ? g.color : CYCLE[i % CYCLE.length]] };
    });
    var title = (mp ? 'Sum of ' + mp.name : 'Count') + ' by ' + gp.name;
    body.appendChild(D.el('div.chart-title', { text: title }));
    var total = data.reduce(function (s, d) { return s + d.value; }, 0);
    var box = D.el('div.chart-box');
    if (!total) { body.appendChild(D.el('p.dbv-none', { text: 'Nothing to chart yet.' })); return; }
    var svg;
    if (view.chart === 'donut') { svg = donut(data, total); }
    else if (view.chart === 'line') { svg = line(data); }
    else { svg = bars(data); }
    box.innerHTML = svg;
    body.appendChild(box);
    var legend = D.el('div.chart-legend');
    data.forEach(function (d) {
      legend.appendChild(D.el('span.lg-item', null, [D.el('span.lg-dot', { style: { background: d.color } }), D.el('span', { text: d.label + ' \u00b7 ' + d.value })]));
    });
    body.appendChild(legend);
  };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function bars(data) {
    var W = Math.max(320, data.length * 64), H = 240, max = Math.max.apply(null, data.map(function (d) { return d.value; })) || 1;
    var bw = (W - 40) / data.length;
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + (H + 40) + '" preserveAspectRatio="xMidYMid meet">';
    data.forEach(function (d, i) {
      var h = Math.round(d.value / max * (H - 30)), x = 30 + i * bw + bw * 0.15, w = bw * 0.7;
      s += '<rect x="' + x.toFixed(1) + '" y="' + (H - h) + '" width="' + w.toFixed(1) + '" height="' + h + '" rx="3" fill="' + d.color + '"/>';
      s += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - h - 6) + '" text-anchor="middle" class="ch-val">' + esc(d.value) + '</text>';
      s += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H + 18) + '" text-anchor="middle" class="ch-lab">' + esc(String(d.label).substr(0, 12)) + '</text>';
    });
    s += '<line x1="24" x2="' + (W - 6) + '" y1="' + H + '" y2="' + H + '" class="ch-axis"/></svg>';
    return s;
  }
  function donut(data, total) {
    var R = 90, r = 56, cx = 120, cy = 120, a = -Math.PI / 2;
    var s = '<svg class="chart donut" viewBox="0 0 240 240">';
    data.forEach(function (d) {
      if (!d.value) { return; }
      var frac = d.value / total;
      if (frac >= 0.9999) { s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((R + r) / 2) + '" fill="none" stroke="' + d.color + '" stroke-width="' + (R - r) + '"/>'; return; }
      var b = a + frac * 2 * Math.PI, large = frac > 0.5 ? 1 : 0;
      function p(rad, ang) { return (cx + rad * Math.cos(ang)).toFixed(2) + ' ' + (cy + rad * Math.sin(ang)).toFixed(2); }
      s += '<path d="M' + p(R, a) + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + p(R, b) + ' L' + p(r, b) + ' A' + r + ' ' + r + ' 0 ' + large + ' 0 ' + p(r, a) + ' Z" fill="' + d.color + '"/>';
      a = b;
    });
    s += '<text x="120" y="126" text-anchor="middle" class="ch-total">' + esc(Math.round(total * 100) / 100) + '</text></svg>';
    return s;
  }
  function line(data) {
    var W = Math.max(320, data.length * 64), H = 240, max = Math.max.apply(null, data.map(function (d) { return d.value; })) || 1;
    var step = data.length > 1 ? (W - 60) / (data.length - 1) : 0;
    var pts = data.map(function (d, i) { return [30 + i * step, H - Math.round(d.value / max * (H - 30))]; });
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + (H + 40) + '">';
    s += '<polyline fill="none" stroke="#4A7FC1" stroke-width="2.5" points="' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1]; }).join(' ') + '"/>';
    pts.forEach(function (p, i) {
      s += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1] + '" r="4" fill="#4A7FC1"/>';
      s += '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] - 9) + '" text-anchor="middle" class="ch-val">' + esc(data[i].value) + '</text>';
      s += '<text x="' + p[0].toFixed(1) + '" y="' + (H + 18) + '" text-anchor="middle" class="ch-lab">' + esc(String(data[i].label).substr(0, 12)) + '</text>';
    });
    s += '<line x1="24" x2="' + (W - 6) + '" y1="' + H + '" y2="' + H + '" class="ch-axis"/></svg>';
    return s;
  }

  // ---------- public ----------

  K.DbView = {
    mount: function (host, db, page, opts) { return new DbView(host, db, page, opts); },
    display: display,
    openRow: openRow,
    ordered: ordered
  };
})(window.Kagoj = window.Kagoj || {});
