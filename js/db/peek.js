(function (K) {
  'use strict';

  // Row pages: the property list under the title, the side peek, and the
  // inline database block.
  var D = K.dom, U = K.util, Docs = K.Docs, DB = K.DB, E = K.DBEdit, sheets = K.sheets;

  // ---------- properties on a row page ----------

  K.PageProps = {
    render: function (row, page) {
      var box = D.el('div.page-props');
      var db = Docs.get(row.parent_id);
      if (!db || db.kind !== 'database' || !db.schema) { return box; }
      var showAll = false;
      function render() {
        D.empty(box);
        if (row.settings && row.settings.template) {
          box.appendChild(D.el('div.tpl-note', { text: 'Template for ' + Docs.titleOf(db) + '. New rows made from it copy these properties and the content below.' }));
        }
        var list = D.el('div.pp-list');
        var props = (db.schema.props || []).filter(function (p) { return p.type !== 'title'; });
        var hiddenEmpty = 0;
        props.forEach(function (p) {
          var empty = K.Formula.isEmpty(DB.value(db, row, p));
          if (empty && !showAll && props.length > 6 && ['formula', 'rollup', 'created', 'edited', 'uid'].indexOf(p.type) >= 0) { hiddenEmpty++; return; }
          var label = D.el('button.pp-name', { type: 'button' }, [D.icon(DB.typeIcon(p.type), 'mini'), D.el('span', { text: p.name })]);
          D.tap(label, function () { E.propMenu(db, p, null, render); });
          var val = D.el('div.pp-val' + (empty ? '.empty' : ''), { tabindex: '0' });
          var shown = K.DbView.display(db, row, p, false);
          if (shown) { val.appendChild(shown); } else { val.appendChild(D.el('span.pp-ph', { text: 'Empty' })); }
          if (['formula', 'rollup', 'created', 'edited', 'uid'].indexOf(p.type) < 0) {
            D.tap(val, function (e) {
              if (e && e.target && e.target.closest && e.target.closest('.rel-chip')) { return; }
              if (page.locked && page.locked()) { return; }
              E.value(val, db, row, p, render);
            });
          } else { val.classList.add('ro'); }
          list.appendChild(D.el('div.pp-row', null, [label, val]));
        });
        box.appendChild(list);
        var foot = D.el('div.pp-foot');
        if (hiddenEmpty) {
          var more = D.el('button.add-link', { type: 'button', text: hiddenEmpty + ' more properties' });
          D.tap(more, function () { showAll = true; render(); });
          foot.appendChild(more);
        }
        var add = D.el('button.add-link', { type: 'button' }, [D.icon('plus'), D.el('span', { text: 'Add a property' })]);
        D.tap(add, function () { E.addProperty(db, null, function () { render(); }); });
        foot.appendChild(add);
        var back = D.el('button.add-link', { type: 'button' }, [D.icon('database'), D.el('span', { text: Docs.titleOf(db) })]);
        D.tap(back, function () { K.shell.openDoc(db); });
        foot.appendChild(back);
        box.appendChild(foot);
      }
      render();
      // reflect changes made elsewhere (peek + table side by side, sync)
      var refresh = U.debounce(function () {
        if (!document.body.contains(box)) { Docs.off('change', onChange); return; }
        if (box.querySelector('.pp-val:focus')) { return; }
        render();
      }, 200);
      function onChange(id) { if (id === row.id || id === db.id) { refresh(); } }
      Docs.on('change', onChange);
      return box;
    }
  };

  // ---------- side peek ----------

  var peek = null;
  K.DbPeek = {
    open: function (row) {
      if (peek && peek.row.id === row.id) { return; }
      K.DbPeek.close();
      var panel = D.el('div.peek');
      var head = D.el('div.peek-head');
      var close = D.button({ icon: 'close', title: 'Close (Esc)' });
      var full = D.button({ icon: 'expand', title: 'Open as full page' });
      D.tap(close, function () { K.DbPeek.close(); });
      D.tap(full, function () { K.DbPeek.close(); K.shell.openDoc(row); });
      D.append(head, [close, full]);
      var host = D.el('div.peek-page');
      D.append(panel, [head, host]);
      document.body.appendChild(panel);
      setTimeout(function () { panel.classList.add('open'); }, 10);
      var view = new K.PageView(host, row);
      if (!row.title && view.titleEl) { setTimeout(function () { try { view.titleEl.focus(); } catch (e) { /* ignore */ } }, 220); }
      var onKey = D.on(document, 'keydown', function (e) { if (e.keyCode === 27 && !sheets.isOpen()) { K.DbPeek.close(); } });
      var onRoute = function () { K.DbPeek.close(); };
      window.addEventListener('hashchange', onRoute);
      peek = { row: row, panel: panel, view: view, off: function () { onKey(); window.removeEventListener('hashchange', onRoute); } };
    },
    close: function () {
      if (!peek) { return; }
      var p = peek;
      peek = null;
      p.off();
      p.view.flush();
      p.view.destroy();
      p.panel.classList.remove('open');
      setTimeout(function () { D.remove(p.panel); }, 200);
    },
    isOpen: function () { return !!peek; }
  };

  // ---------- inline database block ----------

  var V = K.BlockViews = K.BlockViews || {};
  var X = K.extraSlash = K.extraSlash || [];

  V.db = function (b, ed) {
    var db = Docs.get(b.ref);
    var host = D.el('div.db-inline');
    // the editor must not treat clicks and keys inside the database as text editing
    host.setAttribute('contenteditable', 'false');
    if (!db || db.kind !== 'database') { host.appendChild(D.el('p.empty', { text: 'This database is not on this device yet.' })); return host; }
    setTimeout(function () { K.DbView.mount(host, db, ed.page, { inline: true, blockId: b.id }); }, 0);
    return host;
  };

  // ---------- attendance summary (for class databases) ----------

  V.attsum = function (b) {
    var host = D.el('div.attsum');
    host.setAttribute('contenteditable', 'false');
    function draw() {
      var db = Docs.get(b.ref);
      D.empty(host);
      if (!db || !Docs.isLive(db) || !db.schema) { host.appendChild(D.el('p.empty', { text: 'The attendance database is not on this device yet.' })); return; }
      var dp = DB.firstOf(db, ['date']), ap = DB.propByName(db, 'Attendance');
      var now = Date.now(), held = 0, pres = 0, abs = 0, next = null;
      DB.rows(db).forEach(function (r) {
        var v = dp ? DB.value(db, r, dp) : null;
        if (!v || !v.d) { return; }
        var a = ap ? DB.value(db, r, ap) : null;
        if (v.d <= now) { held++; if (a === 'Present') { pres++; } else if (a === 'Absent') { abs++; } }
        else if (!next || v.d < next) { next = v.d; }
      });
      var marked = pres + abs, pct = marked ? Math.round(pres / marked * 100) : 0;
      var grade = !marked ? 'none' : pct >= 80 ? 'good' : pct >= 60 ? 'ok' : 'bad';
      function tileEl(num, label, cls) { return D.el('div.as-tile' + (cls ? '.' + cls : ''), null, [D.el('div.as-num', { text: String(num) }), D.el('div.as-label', { text: label })]); }
      var tiles = D.el('div.as-tiles', null, [
        tileEl(held, 'Classes held', ''),
        tileEl(pres, 'Present', 'present'),
        tileEl(abs, 'Absent', 'absent'),
        tileEl(marked ? pct + '%' : '–', 'Attendance', 'pct.' + grade)
      ]);
      host.appendChild(tiles);
      var bar = D.el('div.as-bar', null, [D.el('span.as-p', { style: { width: (held ? pres / held * 100 : 0) + '%' } }), D.el('span.as-a', { style: { width: (held ? abs / held * 100 : 0) + '%' } })]);
      host.appendChild(bar);
      var notes = [];
      if (held - marked > 0) { notes.push((held - marked) + ' not marked yet'); }
      if (next) { notes.push('Next class: ' + K.dateLabel(K.isoDay(new Date(next)) + 'T' + ('0' + new Date(next).getHours()).slice(-2) + ':' + ('0' + new Date(next).getMinutes()).slice(-2))); }
      if (marked && pct < 80) { notes.push(pct < 60 ? 'Careful: attendance is low' : 'Try to keep it above 80%'); }
      if (notes.length) { host.appendChild(D.el('div.as-note', { text: notes.join('  ·  ') })); }
    }
    draw();
    var redraw = U.debounce(function () {
      if (!document.body.contains(host)) { Docs.off('change', onCh); return; }
      draw();
    }, 250);
    function onCh(id) { var d = Docs.get(id); if (d && (d.id === b.ref || d.parent_id === b.ref)) { redraw(); } }
    Docs.on('change', onCh);
    return host;
  };

  function insertDb(ed, id, b) {
    var cur = ed.block(id);
    b.d = cur ? cur.d || 0 : 0;
    if (cur && K.isTextBlock(cur) && !Docs.plain(cur.html)) { ed.snapshot(); ed.blocks.splice(ed.index(id), 1, b); ed.render(); ed.changed(true); }
    else { ed.insertAfter(id, b, false); }
    ed.page.flush();
  }

  X.push({ label: 'Database – inline', icon: 'database', desc: 'A table inside this page', keys: 'database table inline db notion', group: 'Databases',
    run: function (ed, id) {
      var db = DB.create(ed.page.doc.id, '', true);
      insertDb(ed, id, Docs.newBlock('db', { ref: db.id }));
    } });
  X.push({ label: 'Database – full page', icon: 'database', desc: 'A database on its own page', keys: 'database full page db', group: 'Databases',
    run: function (ed, id) {
      var db = DB.create(ed.page.doc.id, '', false);
      insertDb(ed, id, Docs.newBlock('page', { ref: db.id }));
      K.shell.openDoc(db);
    } });
  [['board', 'Board view', 'columns', 'kanban board'], ['calendar', 'Calendar view', 'calendar', 'calendar month'], ['list', 'List view', 'list', 'list'],
    ['gallery', 'Gallery view', 'image', 'gallery cards'], ['timeline', 'Timeline view', 'timeline', 'timeline gantt'], ['chart', 'Chart', 'chart', 'chart graph']].forEach(function (t) {
    X.push({ label: t[1], icon: t[2], desc: 'A new database shown as a ' + t[1].toLowerCase(), keys: t[3] + ' database view', group: 'Databases',
      run: function (ed, id) {
        var db = DB.create(ed.page.doc.id, '', true);
        var v = DB.newView(t[0], t[1].replace(' view', ''));
        E.ensureViewDefaults(db, v);
        db.schema.views = [v, DB.newView('table', 'Table')];
        DB.saveSchema(db);
        insertDb(ed, id, Docs.newBlock('db', { ref: db.id }));
      } });
  });
  X.push({ label: 'Linked view of database', icon: 'link', desc: 'Show an existing database here', keys: 'linked view database existing', group: 'Databases',
    run: function (ed, id) {
      var dbs = Docs.all().filter(function (d) { return d.kind === 'database' && Docs.isLive(d); });
      if (!dbs.length) { sheets.toast('No databases yet. Create one first.'); return; }
      sheets.actionSheet({ title: 'Choose a database', items: dbs.map(function (d) {
        return { label: Docs.titleOf(d), icon: 'database', onTap: function () { insertDb(ed, id, Docs.newBlock('db', { ref: d.id })); } };
      }) });
    } });

  // a full-page database can be made from the sidebar / home too
  K.newDatabase = function (parentId) {
    var db = DB.create(parentId || null, '', false);
    K.shell.openDoc(db);
    return db;
  };
})(window.Kagoj = window.Kagoj || {});
