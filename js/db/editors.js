(function (K) {
  'use strict';

  // Database editing UI: value editors, property settings, filters, sorts, view settings.
  var D = K.dom, U = K.util, Docs = K.Docs, DB = K.DB, sheets = K.sheets;
  var E = {};

  function sel(options, value, onChange) {
    var s = D.el('select.db-select');
    options.forEach(function (o) {
      var opt = D.el('option', { value: String(o[0]), text: o[1] });
      if (String(o[0]) === String(value)) { opt.selected = true; }
      s.appendChild(opt);
    });
    D.on(s, 'change', function () { onChange(s.value); });
    return s;
  }
  E.sel = sel;

  function chip(name, color) { return D.el('span.chip.chip-' + (color || 'default'), { text: name }); }
  E.chip = chip;

  function title(p) { return p.type === 'title' ? { id: 'title', type: 'title', name: p.name } : p; }

  // ---------- value editors ----------

  E.value = function (anchor, db, row, p, onDone) {
    onDone = onDone || function () {};
    if (p.type === 'check') { DB.set(row, p.id, !DB.raw(db, row, p)); onDone(); return; }
    if (p.type === 'select' || p.type === 'status' || p.type === 'multi') { optionPicker(anchor, db, row, p, onDone); return; }
    if (p.type === 'date') { datePicker(anchor, db, row, p, onDone); return; }
    if (p.type === 'relation') { relationPicker(anchor, db, row, p, onDone); return; }
    if (['formula', 'rollup', 'created', 'edited', 'uid'].indexOf(p.type) >= 0) { return; }
    var cur = p.type === 'title' ? row.title || '' : (DB.raw(db, row, p) === null ? '' : String(DB.raw(db, row, p)));
    var input = D.el('input.text-input.db-input', {
      type: p.type === 'number' ? 'text' : (p.type === 'url' ? 'url' : (p.type === 'email' ? 'email' : (p.type === 'phone' ? 'tel' : 'text'))),
      value: cur, autocapitalize: p.type === 'text' || p.type === 'title' ? 'sentences' : 'off', autocorrect: 'off'
    });
    if (p.type === 'number') { input.setAttribute('inputmode', 'decimal'); }
    var box = D.el('div.db-edit', null, [input]);
    if ((p.type === 'url' || p.type === 'email' || p.type === 'phone') && cur) {
      var open = D.el('a.small-btn.db-open', { href: p.type === 'url' ? (/^https?:/i.test(cur) ? cur : 'http://' + cur) : (p.type === 'email' ? 'mailto:' + cur : 'tel:' + cur), target: '_blank', rel: 'noopener', text: 'Open' });
      box.appendChild(open);
    }
    var done = false;
    function save() {
      if (done) { return; }
      done = true;
      var v = input.value.replace(/^\s+|\s+$/g, '');
      if (p.type === 'title') { Docs.update(row.id, { title: v.substr(0, 500) }); }
      else if (p.type === 'number') { var n = parseFloat(v.replace(/,/g, '')); DB.set(row, p.id, v === '' || isNaN(n) ? null : n); }
      else { DB.set(row, p.id, v); }
      onDone();
    }
    var pop = sheets.popover(anchor, box, { onClose: save });
    D.on(input, 'keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); pop.close(); } else if (e.keyCode === 27) { done = true; pop.close(); } });
    input.focus();
    try { input.setSelectionRange(0, input.value.length); } catch (e) { /* ignore */ }
  };

  function optionPicker(anchor, db, row, p, onDone) {
    var multi = p.type === 'multi';
    var input = D.el('input.text-input.db-input', { type: 'text', placeholder: multi ? 'Search or add tags' : 'Search or add an option', autocapitalize: 'off', autocorrect: 'off' });
    var list = D.el('div.opt-list.scrolls');
    var picked = D.el('div.opt-picked');
    var box = D.el('div.db-edit.opt-edit', null, [picked, input, list]);
    function current() { var v = DB.raw(db, row, p); return multi ? (v || []) : (v ? [v] : []); }
    function setVal(ids) { DB.set(row, p.id, multi ? ids : (ids[0] || null)); }
    function render() {
      D.empty(picked);
      current().forEach(function (id) {
        var o = DB.option(p, id);
        if (!o) { return; }
        var c = chip(o.name, o.color);
        var x = D.el('button.chip-x', { type: 'button', text: '\u00d7' });
        D.tap(x, function () { setVal(current().filter(function (y) { return y !== id; })); render(); });
        c.appendChild(x);
        picked.appendChild(c);
      });
      D.empty(list);
      var q = input.value.replace(/^\s+|\s+$/g, '').toLowerCase();
      var opts = (p.options || []).filter(function (o) { return !q || o.name.toLowerCase().indexOf(q) >= 0; });
      var lastG = null;
      opts.forEach(function (o) {
        if (p.type === 'status' && o.g !== lastG) { lastG = o.g; list.appendChild(D.el('div.menu-group', { text: { todo: 'To-do', doing: 'In progress', done: 'Complete' }[o.g] || '' })); }
        var on = current().indexOf(o.id) >= 0;
        var r = D.el('button.opt-row' + (on ? '.on' : ''), { type: 'button' }, [chip(o.name, o.color), on ? D.icon('check') : null]);
        D.tap(r, function () {
          var cur = current();
          if (multi) { setVal(on ? cur.filter(function (y) { return y !== o.id; }) : cur.concat([o.id])); render(); }
          else { setVal(on ? [] : [o.id]); pop.close(); }
        });
        list.appendChild(r);
      });
      var exact = (p.options || []).some(function (o) { return o.name.toLowerCase() === q; });
      if (q && !exact) {
        var add = D.el('button.opt-row', { type: 'button' }, [D.el('span', { text: 'Create ' }), chip(input.value.replace(/^\s+|\s+$/g, ''), 'default')]);
        D.tap(add, function () {
          var o = { id: DB.oid(), name: input.value.replace(/^\s+|\s+$/g, '').substr(0, 100), color: DB.COLORS[1 + Math.floor(Math.random() * 9)] };
          if (p.type === 'status') { o.g = 'todo'; }
          p.options = (p.options || []).concat([o]);
          DB.saveSchema(db);
          input.value = '';
          if (multi) { setVal(current().concat([o.id])); render(); } else { setVal([o.id]); pop.close(); }
        });
        list.appendChild(add);
      }
    }
    var pop = sheets.popover(anchor, box, { onClose: onDone });
    D.on(input, 'input', render);
    D.on(input, 'keydown', function (e) {
      if (e.keyCode === 13) { e.preventDefault(); var first = list.querySelector('.opt-row'); if (first) { first.click(); } }
    });
    render();
    if (!U.hasTouch) { input.focus(); }
  }

  var REMIND = [['', 'No reminder'], ['0', 'At the time'], ['5', '5 minutes before'], ['15', '15 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before'], ['10080', '1 week before']];

  function datePicker(anchor, db, row, p, onDone) {
    var v = DB.raw(db, row, p) || {};
    var s = v.s || '', e = v.e || '';
    var hasTime = /T/.test(s);
    function dpart(x) { return (x || '').substr(0, 10); }
    function tpart(x) { return /T(\d\d:\d\d)/.test(x || '') ? /T(\d\d:\d\d)/.exec(x)[1] : '09:00'; }
    var start = D.el('input.text-input.db-input', { type: 'date', value: dpart(s) || K.isoDay(new Date()) });
    var startT = D.el('input.text-input.db-input.time', { type: 'time', value: tpart(s) });
    var end = D.el('input.text-input.db-input', { type: 'date', value: dpart(e) });
    var endT = D.el('input.text-input.db-input.time', { type: 'time', value: tpart(e) });
    var endOn = !!e, timeOn = hasTime;
    function tog(label, on, fn) {
      var t = D.el('button.toggle' + (on ? '.on' : ''), { type: 'button' }, D.el('span.knob'));
      D.tap(t, function () { on = !on; t.classList.toggle('on', on); fn(on); });
      return D.el('div.pm-row', null, [D.el('span.pm-label', { text: label }), t]);
    }
    var endRow = D.el('div.date-row', null, [D.el('span.dl', { text: 'End' }), end, endT]);
    var remind = sel(REMIND, v.r === undefined || v.r === null ? '' : v.r, function () {});
    function show() {
      endRow.style.display = endOn ? '' : 'none';
      startT.style.display = timeOn ? '' : 'none';
      endT.style.display = timeOn && endOn ? '' : 'none';
    }
    var box = D.el('div.db-edit.date-edit', null, [
      D.el('div.date-row', null, [D.el('span.dl', { text: 'Start' }), start, startT]),
      endRow,
      tog('End date', endOn, function (on) { endOn = on; if (on && !end.value) { end.value = start.value; } show(); }),
      tog('Include time', timeOn, function (on) { timeOn = on; show(); }),
      D.el('div.pm-row', null, [D.el('span.pm-label', { text: 'Remind' }), remind])
    ]);
    var clear = D.el('button.small-btn', { type: 'button', text: 'Clear' });
    var cleared = false;
    D.tap(clear, function () { cleared = true; pop.close(); });
    box.appendChild(clear);
    show();
    function save() {
      if (cleared || !start.value) { DB.set(row, p.id, null); onDone(); return; }
      var val = { s: start.value + (timeOn ? 'T' + (startT.value || '09:00') : '') };
      if (endOn && end.value) { val.e = end.value + (timeOn ? 'T' + (endT.value || startT.value || '09:00') : ''); if (val.e < val.s) { var t = val.e; val.e = val.s; val.s = t; } }
      if (remind.value !== '') { val.r = +remind.value; }
      DB.set(row, p.id, val);
      onDone();
    }
    var pop = sheets.popover(anchor, box, { onClose: save });
  }

  function relationPicker(anchor, db, row, p, onDone) {
    var target = Docs.get(p.db);
    if (!target || !Docs.isLive(target)) { sheets.toast('Choose which database this relation points to (property settings).', 4000); return; }
    var input = D.el('input.text-input.db-input', { type: 'search', placeholder: 'Search ' + Docs.titleOf(target), autocapitalize: 'off' });
    var list = D.el('div.opt-list.scrolls');
    var box = D.el('div.db-edit.opt-edit', null, [input, list]);
    function cur() { return DB.raw(db, row, p) || []; }
    function render() {
      D.empty(list);
      var q = input.value.toLowerCase();
      DB.rows(target).filter(function (r) { return r.id !== row.id && (!q || Docs.titleOf(r).toLowerCase().indexOf(q) >= 0); }).slice(0, 80).forEach(function (r) {
        var on = cur().indexOf(r.id) >= 0;
        var b = D.el('button.opt-row' + (on ? '.on' : ''), { type: 'button' }, [K.docIconEl(r), D.el('span', { text: Docs.titleOf(r) }), on ? D.icon('check') : null]);
        D.tap(b, function () {
          DB.set(row, p.id, on ? cur().filter(function (x) { return x !== r.id; }) : cur().concat([r.id]));
          render();
        });
        list.appendChild(b);
      });
      if (q) {
        var add = D.el('button.opt-row', { type: 'button' }, [D.icon('plus'), D.el('span', { text: 'New \u201c' + input.value + '\u201d in ' + Docs.titleOf(target) })]);
        D.tap(add, function () { var nr = DB.newRow(target, { title: input.value }); DB.set(row, p.id, cur().concat([nr.id])); input.value = ''; render(); });
        list.appendChild(add);
      }
    }
    sheets.popover(anchor, box, { onClose: onDone });
    D.on(input, 'input', render);
    render();
  }

  // ---------- property settings ----------

  E.addProperty = function (db, after, cb) {
    sheets.actionSheet({ title: 'New property', items: DB.TYPES.map(function (t) {
      return { label: t[1], icon: t[2], onTap: function () {
        var p = { id: DB.pid(), name: uniqueName(db, t[1]), type: t[0] };
        if (t[0] === 'select' || t[0] === 'multi') { p.options = []; }
        if (t[0] === 'status') { p.options = DB.defaultSchema().props[1].options; }
        if (t[0] === 'uid') { p.prefix = ''; }
        if (t[0] === 'number') { p.fmt = 'plain'; }
        var ps = db.schema.props, i = after ? ps.indexOf(after) : ps.length - 1;
        ps.splice(i + 1, 0, p);
        DB.saveSchema(db);
        if (t[0] === 'uid') { DB.rows(db).sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; }).forEach(function (r) { db.schema.uid = (db.schema.uid || 0) + 1; DB.set(r, p.id, db.schema.uid); }); DB.saveSchema(db); }
        if (cb) { cb(p); }
        if (['formula', 'relation', 'rollup'].indexOf(t[0]) >= 0) { E.propSettings(db, p, cb); }
      } };
    }) });
  };
  function uniqueName(db, base) {
    var n = base, i = 1;
    while (DB.propByName(db, n)) { i++; n = base + ' ' + i; }
    return n;
  }

  // Property menu from a column header
  E.propMenu = function (db, p, view, cb, extra) {
    cb = cb || function () {};
    function upd(fn) { return function () { fn(); DB.saveSchema(db); cb(); }; }
    var items = [
      { label: 'Rename', icon: 'edit', onTap: function () {
        sheets.prompt({ title: 'Property name', value: p.name }, function (v) {
          if (v && v.replace(/\s/g, '')) { p.name = v.replace(/^\s+|\s+$/g, '').substr(0, 100); DB.saveSchema(db); cb(); }
        });
      } }
    ];
    if (p.type !== 'title') {
      items.push({ label: 'Change type (' + DB.typeName(p.type) + ')', icon: DB.typeIcon(p.type), onTap: function () {
        sheets.actionSheet({ title: 'Type', items: DB.TYPES.map(function (t) {
          return { label: t[1], checked: p.type === t[0], onTap: upd(function () { changeType(db, p, t[0]); }) };
        }) });
      } });
      if (['select', 'multi', 'status', 'number', 'formula', 'relation', 'rollup', 'uid'].indexOf(p.type) >= 0) {
        items.push({ label: 'Edit property\u2026', icon: 'settings', onTap: function () { E.propSettings(db, p, cb); } });
      }
    }
    if (view) {
      items.push({ label: 'Sort ascending', icon: 'chevron-up', onTap: function () { view.sorts = [{ pid: p.id, dir: 'asc' }]; saveView(db, view); cb(); } });
      items.push({ label: 'Sort descending', icon: 'chevron-down', onTap: function () { view.sorts = [{ pid: p.id, dir: 'desc' }]; saveView(db, view); cb(); } });
      items.push({ label: 'Filter by this', icon: 'search', onTap: function () {
        var kind = DB.condKind(p);
        view.filter.rules.push({ pid: p.id, cond: DB.CONDS[kind][0][0], val: '' });
        saveView(db, view);
        E.filters(db, view, cb);
      } });
      if (p.type !== 'title') {
        items.push({ label: 'Hide in this view', icon: 'eye', onTap: function () { if (view.hidden.indexOf(p.id) < 0) { view.hidden.push(p.id); } saveView(db, view); cb(); } });
      }
    }
    if (p.type !== 'title') {
      items.push({ label: 'Duplicate property', icon: 'copy', onTap: upd(function () {
        var c = JSON.parse(JSON.stringify(p)); c.id = DB.pid(); c.name = uniqueName(db, p.name);
        db.schema.props.splice(db.schema.props.indexOf(p) + 1, 0, c);
        DB.rows(db).forEach(function (r) { var v = (r.props || {})[p.id]; if (v !== undefined) { DB.set(r, c.id, JSON.parse(JSON.stringify(v))); } });
      }) });
      items.push({ label: 'Delete property', icon: 'trash', danger: true, onTap: function () {
        sheets.confirm({ title: 'Delete \u201c' + p.name + '\u201d?', message: 'Its values in every row are removed.', ok: 'Delete', danger: true }, function (ok) {
          if (!ok) { return; }
          db.schema.props = db.schema.props.filter(function (x) { return x.id !== p.id; });
          DB.saveSchema(db);
          cb();
        });
      } });
    }
    sheets.actionSheet({ title: p.name, items: items.slice(0, 2).concat(extra || [], items.slice(2)) });
  };

  function changeType(db, p, type) {
    var old = p.type;
    if (old === type) { return; }
    var rows = DB.rows(db);
    // convert values where it makes sense
    rows.forEach(function (r) {
      var raw = (r.props || {})[p.id];
      if (raw === undefined) { return; }
      var txt = K.Formula.str(DB.value(db, r, p));
      var nv = null;
      if (type === 'text' || type === 'url' || type === 'email' || type === 'phone') { nv = txt; }
      else if (type === 'number') { var n = parseFloat(txt); nv = isNaN(n) ? null : n; }
      else if (type === 'check') { nv = !!raw && txt !== '' && txt !== '0' && txt.toLowerCase() !== 'false'; }
      else if (type === 'select' || type === 'status' || type === 'multi') {
        var names = old === 'multi' ? DB.value(db, r, p) : (txt ? [txt] : []);
        p.options = p.options || [];
        var ids = names.map(function (nm) {
          var o = null;
          p.options.forEach(function (x) { if (x.name === nm) { o = x; } });
          if (!o) { o = { id: DB.oid(), name: nm, color: DB.COLORS[1 + (p.options.length % 9)] }; if (type === 'status') { o.g = 'todo'; } p.options.push(o); }
          return o.id;
        });
        nv = type === 'multi' ? ids : (ids[0] || null);
      }
      else if (type === 'date') { var d = DB.parseDay(txt); nv = d ? { s: K.isoDay(new Date(d)) } : null; }
      DB.set(r, p.id, nv);
    });
    p.type = type;
    if ((type === 'select' || type === 'multi') && !p.options) { p.options = []; }
    if (type === 'status' && (!p.options || !p.options.length)) { p.options = DB.defaultSchema().props[1].options; }
    if (type === 'status') { p.options.forEach(function (o) { o.g = o.g || 'todo'; }); }
  }

  E.propSettings = function (db, p, cb) {
    cb = cb || function () {};
    var body = D.el('div.prop-set');
    var name = D.el('input.text-input', { type: 'text', value: p.name });
    body.appendChild(D.el('label.field-label', { text: 'Name' }));
    body.appendChild(name);
    var formula = null, preview = null;
    if (p.type === 'number') {
      body.appendChild(D.el('label.field-label', { text: 'Number format' }));
      body.appendChild(sel([['plain', 'Number'], ['comma', 'Number with commas'], ['percent', 'Percent'], ['dollar', 'US dollar'], ['euro', 'Euro'], ['pound', 'Pound'], ['taka', 'Taka'], ['rupee', 'Rupee'], ['bar', 'Progress bar (0-100)'], ['ring', 'Progress ring (0-100)']], p.fmt || 'plain', function (v) { p.fmt = v; }));
    }
    if (p.type === 'uid') {
      body.appendChild(D.el('label.field-label', { text: 'Prefix (optional, e.g. TASK)' }));
      var pre = D.el('input.text-input', { type: 'text', value: p.prefix || '', autocapitalize: 'characters' });
      D.on(pre, 'input', function () { p.prefix = pre.value.replace(/[^A-Za-z0-9]/g, '').substr(0, 10); });
      body.appendChild(pre);
    }
    if (p.type === 'select' || p.type === 'multi' || p.type === 'status') {
      body.appendChild(D.el('label.field-label', { text: 'Options' }));
      var ol = D.el('div.opt-settings');
      var renderOpts = function () {
        D.empty(ol);
        (p.options || []).forEach(function (o, i) {
          var inp = D.el('input.text-input.opt-name', { type: 'text', value: o.name });
          D.on(inp, 'input', function () { o.name = inp.value.substr(0, 100); });
          var col = sel(DB.COLORS.map(function (c) { return [c, c]; }), o.color || 'default', function (v) { o.color = v; sw.className = 'chip chip-' + v; });
          var sw = D.el('span.chip.chip-' + (o.color || 'default'), { text: ' ' });
          var grp = p.type === 'status' ? sel([['todo', 'To-do'], ['doing', 'In progress'], ['done', 'Complete']], o.g || 'todo', function (v) { o.g = v; }) : null;
          var up = D.el('button.small-btn', { type: 'button', text: '\u2191' });
          D.tap(up, function () { if (i > 0) { p.options.splice(i - 1, 0, p.options.splice(i, 1)[0]); renderOpts(); } });
          var del = D.el('button.small-btn.danger', { type: 'button', text: '\u00d7' });
          D.tap(del, function () { p.options.splice(i, 1); renderOpts(); });
          ol.appendChild(D.el('div.opt-set-row', null, [sw, inp, col, grp, up, del]));
        });
        var add = D.el('button.small-btn', { type: 'button', text: '+ Add an option' });
        D.tap(add, function () { p.options = p.options || []; p.options.push({ id: DB.oid(), name: 'Option ' + (p.options.length + 1), color: DB.COLORS[1 + (p.options.length % 9)], g: p.type === 'status' ? 'todo' : undefined }); renderOpts(); });
        ol.appendChild(add);
      };
      renderOpts();
      body.appendChild(ol);
    }
    if (p.type === 'formula') {
      body.appendChild(D.el('label.field-label', { text: 'Formula' }));
      formula = D.el('textarea.text-area.formula', { rows: 3, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' });
      formula.value = p.expr || '';
      preview = D.el('div.formula-preview');
      var help = D.el('div.formula-help', { text: 'Use prop("Name") for properties. Examples: prop("Price") * prop("Qty") \u00b7 if(prop("Done"), "\u2705", "") \u00b7 dateBetween(prop("Due"), now(), "days") \u00b7 Functions: ' + K.Formula.functions.join(', ') });
      var check = function () {
        var rows = DB.rows(db);
        var res = K.Formula.run(formula.value, function (n) {
          var q = DB.propByName(db, n);
          if (!q) { throw new Error('No property called \u201c' + n + '\u201d'); }
          return rows[0] ? DB.value(db, rows[0], q) : null;
        });
        preview.textContent = res.err ? '\u26A0 ' + res.err : (rows[0] ? 'First row: ' + K.Formula.str(res.v) : 'Looks fine');
        preview.classList.toggle('err', !!res.err);
      };
      D.on(formula, 'input', check);
      check();
      D.append(body, [formula, preview, help]);
    }
    if (p.type === 'relation') {
      body.appendChild(D.el('label.field-label', { text: 'Related database' }));
      var dbs = Docs.all().filter(function (d) { return d.kind === 'database' && Docs.isLive(d); });
      body.appendChild(sel([['', 'Choose\u2026']].concat(dbs.map(function (d) { return [d.id, Docs.titleOf(d) + (d.id === db.id ? ' (this database)' : '')]; })), p.db || '', function (v) { p.db = v || null; }));
    }
    if (p.type === 'rollup') {
      var rels = (db.schema.props || []).filter(function (x) { return x.type === 'relation'; });
      body.appendChild(D.el('label.field-label', { text: 'Relation' }));
      var targetSel = D.el('div');
      var renderTarget = function () {
        D.empty(targetSel);
        var rel = DB.prop(db, p.rel), tdb = rel ? Docs.get(rel.db) : null;
        if (!tdb) { targetSel.appendChild(D.el('p.set-sub', { text: 'Pick a relation first.' })); return; }
        targetSel.appendChild(D.el('label.field-label', { text: 'Property of ' + Docs.titleOf(tdb) }));
        targetSel.appendChild(sel([['title', 'Name']].concat((tdb.schema.props || []).filter(function (x) { return x.type !== 'title'; }).map(function (x) { return [x.id, x.name]; })), p.target || 'title', function (v) { p.target = v; }));
      };
      body.appendChild(sel([['', 'Choose\u2026']].concat(rels.map(function (r) { return [r.id, r.name]; })), p.rel || '', function (v) { p.rel = v; renderTarget(); }));
      body.appendChild(targetSel);
      renderTarget();
      body.appendChild(D.el('label.field-label', { text: 'Calculate' }));
      body.appendChild(sel([['show', 'Show original'], ['count', 'Count'], ['count_values', 'Count values'], ['sum', 'Sum'], ['avg', 'Average'], ['min', 'Min'], ['max', 'Max'],
        ['checked', 'Checked'], ['pct_checked', 'Percent checked'], ['earliest', 'Earliest date'], ['latest', 'Latest date']], p.fn || 'show', function (v) { p.fn = v; }));
    }
    sheets.modal({ title: DB.typeName(p.type) + ' property', body: body, cls: 'sheet-prop', actions: [
      { label: 'Cancel', onTap: function () { cb(); } },
      { label: 'Save', primary: true, onTap: function () {
        if (name.value.replace(/\s/g, '')) { p.name = name.value.replace(/^\s+|\s+$/g, '').substr(0, 100); }
        if (formula) { p.expr = formula.value; }
        DB.saveSchema(db);
        cb();
      } }
    ] });
  };

  // ---------- views ----------

  function saveView(db, view) { DB.saveSchema(db); return view; }
  E.saveView = saveView;

  function valueControl(db, p, rule, onChange) {
    var kind = DB.condKind(p);
    if (rule.cond === 'empty' || rule.cond === 'nempty' || kind === 'check') { return null; }
    if (kind === 'select' || (kind === 'multi' && p.type !== 'relation')) {
      return sel([['', 'Choose\u2026']].concat((p.options || []).map(function (o) { return [o.id, o.name]; })), rule.val || '', onChange);
    }
    if (kind === 'date') {
      var rel = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['yesterday', 'Yesterday'], ['this_week', 'This week'], ['next_week', 'Next week'], ['last_week', 'Last week'], ['past_7', 'Past 7 days'], ['next_7', 'Next 7 days'], ['this_month', 'This month']];
      var wrap = D.el('span.date-rule');
      var s = sel([['__exact', 'Exact date\u2026']].concat(rel), DB.relRange(rule.val) ? rule.val : '__exact', function (v) {
        if (v === '__exact') { inp.style.display = ''; onChange(inp.value); } else { inp.style.display = 'none'; onChange(v); }
      });
      var inp = D.el('input.text-input.db-input', { type: 'date', value: DB.relRange(rule.val) ? '' : (rule.val || '') });
      if (DB.relRange(rule.val)) { inp.style.display = 'none'; }
      D.on(inp, 'change', function () { onChange(inp.value); });
      D.append(wrap, [s, inp]);
      return wrap;
    }
    var t = D.el('input.text-input.db-input', { type: kind === 'number' ? 'text' : 'text', value: rule.val || '', placeholder: 'Value' });
    D.on(t, 'input', function () { onChange(t.value); });
    return t;
  }

  E.filters = function (db, view, cb) {
    var body = D.el('div.filter-box');
    function allProps() { return [{ id: 'title', name: DB.prop(db, 'title') ? DB.prop(db, 'title').name : 'Name', type: 'title' }].concat((db.schema.props || []).filter(function (x) { return x.type !== 'title'; })); }
    function render() {
      D.empty(body);
      var f = view.filter;
      if (f.rules.length > 1) {
        body.appendChild(D.el('div.pm-row', null, [D.el('span.pm-label', { text: 'Match' }), sel([['and', 'All filters (AND)'], ['or', 'Any filter (OR)']], f.op || 'and', function (v) { f.op = v; saveView(db, view); cb(); })]));
      }
      f.rules.forEach(function (r, i) {
        var p = r.pid === 'title' ? title(DB.prop(db, 'title') || { id: 'title', type: 'title', name: 'Name' }) : DB.prop(db, r.pid);
        if (!p) { return; }
        var row = D.el('div.rule-row');
        row.appendChild(sel(allProps().map(function (x) { return [x.id, x.name]; }), r.pid, function (v) {
          r.pid = v; var np = v === 'title' ? { type: 'title' } : DB.prop(db, v); r.cond = DB.CONDS[DB.condKind(np)][0][0]; r.val = ''; saveView(db, view); render(); cb();
        }));
        row.appendChild(sel(DB.CONDS[DB.condKind(p)], r.cond, function (v) { r.cond = v; saveView(db, view); render(); cb(); }));
        var vc = valueControl(db, p, r, function (v) { r.val = v; saveView(db, view); cb(); });
        if (vc) { row.appendChild(vc); }
        var x = D.el('button.small-btn.danger', { type: 'button', text: '\u00d7' });
        D.tap(x, function () { f.rules.splice(i, 1); saveView(db, view); render(); cb(); });
        row.appendChild(x);
        body.appendChild(row);
      });
      var add = D.el('button.small-btn', { type: 'button', text: '+ Add a filter' });
      D.tap(add, function () {
        var p0 = allProps()[0];
        f.rules.push({ pid: p0.id, cond: DB.CONDS[DB.condKind(p0)][0][0], val: '' });
        saveView(db, view); render(); cb();
      });
      body.appendChild(add);
    }
    render();
    sheets.modal({ title: 'Filters', body: body, cls: 'sheet-filter', actions: [{ label: 'Done', primary: true }] });
  };

  E.sorts = function (db, view, cb) {
    var body = D.el('div.filter-box');
    function render() {
      D.empty(body);
      view.sorts.forEach(function (s, i) {
        var row = D.el('div.rule-row');
        row.appendChild(sel([['title', 'Name']].concat((db.schema.props || []).filter(function (x) { return x.type !== 'title'; }).map(function (x) { return [x.id, x.name]; })), s.pid, function (v) { s.pid = v; saveView(db, view); cb(); }));
        row.appendChild(sel([['asc', 'Ascending'], ['desc', 'Descending']], s.dir || 'asc', function (v) { s.dir = v; saveView(db, view); cb(); }));
        var x = D.el('button.small-btn.danger', { type: 'button', text: '\u00d7' });
        D.tap(x, function () { view.sorts.splice(i, 1); saveView(db, view); render(); cb(); });
        row.appendChild(x);
        body.appendChild(row);
      });
      var add = D.el('button.small-btn', { type: 'button', text: '+ Add a sort' });
      D.tap(add, function () { view.sorts.push({ pid: 'title', dir: 'asc' }); saveView(db, view); render(); cb(); });
      body.appendChild(add);
    }
    render();
    sheets.modal({ title: 'Sort', body: body, cls: 'sheet-filter', actions: [{ label: 'Done', primary: true }] });
  };

  E.viewSettings = function (db, view, views, cb) {
    var body = D.el('div.prop-set');
    var name = D.el('input.text-input', { type: 'text', value: view.name });
    D.on(name, 'input', function () { view.name = name.value.substr(0, 60) || 'View'; });
    D.append(body, [D.el('label.field-label', { text: 'View name' }), name]);
    body.appendChild(D.el('label.field-label', { text: 'Layout' }));
    body.appendChild(sel(DB.VIEW_TYPES.map(function (t) { return [t[0], t[1]]; }), view.type, function (v) { view.type = v; ensureViewDefaults(db, view); }));
    var groupable = (db.schema.props || []).filter(function (p) { return ['select', 'status', 'multi', 'check', 'date', 'text', 'number', 'created', 'edited'].indexOf(p.type) >= 0; });
    body.appendChild(D.el('label.field-label', { text: 'Group by (board, table, list, gallery, chart)' }));
    body.appendChild(sel([['', 'None']].concat(groupable.map(function (p) { return [p.id, p.name]; })), view.group || '', function (v) { view.group = v || null; }));
    var dates = (db.schema.props || []).filter(function (p) { return ['date', 'created', 'edited'].indexOf(p.type) >= 0; });
    body.appendChild(D.el('label.field-label', { text: 'Date property (calendar, timeline)' }));
    body.appendChild(sel([['', 'Choose\u2026']].concat(dates.map(function (p) { return [p.id, p.name]; })), view.dateProp || '', function (v) { view.dateProp = v || null; }));
    body.appendChild(D.el('label.field-label', { text: 'Chart' }));
    body.appendChild(sel([['bar', 'Bar chart'], ['donut', 'Donut chart'], ['line', 'Line chart']], view.chart || 'bar', function (v) { view.chart = v; }));
    var nums = (db.schema.props || []).filter(function (p) { return p.type === 'number' || p.type === 'formula' || p.type === 'rollup'; });
    body.appendChild(sel([['', 'Count rows']].concat(nums.map(function (p) { return [p.id, 'Sum of ' + p.name]; })), view.measure || '', function (v) { view.measure = v || null; }));
    body.appendChild(D.el('label.field-label', { text: 'Open rows as' }));
    body.appendChild(sel([['peek', 'Side peek'], ['page', 'Full page']], view.open || 'peek', function (v) { view.open = v; }));
    body.appendChild(D.el('label.field-label', { text: 'Show properties' }));
    var vis = D.el('div.vis-list');
    (db.schema.props || []).forEach(function (p) {
      if (p.type === 'title') { return; }
      var on = view.hidden.indexOf(p.id) < 0;
      var t = D.el('button.toggle' + (on ? '.on' : ''), { type: 'button' }, D.el('span.knob'));
      D.tap(t, function () {
        on = !on; t.classList.toggle('on', on);
        if (on) { view.hidden = view.hidden.filter(function (x) { return x !== p.id; }); } else { view.hidden.push(p.id); }
      });
      vis.appendChild(D.el('div.pm-row', null, [D.el('span.pm-label', { text: p.name }), t]));
    });
    body.appendChild(vis);
    var del = D.el('button.small-btn.danger', { type: 'button', text: 'Delete this view' });
    D.tap(del, function () {
      if (views.length < 2) { sheets.toast('A database needs at least one view.'); return; }
      views.splice(views.indexOf(view), 1);
      DB.saveSchema(db);
      m.close();
      cb(true);
    });
    body.appendChild(del);
    var m = sheets.modal({ title: 'View settings', body: body, cls: 'sheet-prop', actions: [{ label: 'Done', primary: true, onTap: function () { DB.saveSchema(db); cb(); } }] });
  };

  function ensureViewDefaults(db, view) {
    if (view.type === 'board' && !view.group) { var g = DB.firstOf(db, ['status', 'select']); view.group = g ? g.id : null; }
    if ((view.type === 'calendar' || view.type === 'timeline') && !view.dateProp) { var d = DB.firstOf(db, ['date']); view.dateProp = d ? d.id : null; }
    if (view.type === 'chart' && !view.group) { var c = DB.firstOf(db, ['status', 'select', 'multi', 'check']); view.group = c ? c.id : null; }
  }
  E.ensureViewDefaults = ensureViewDefaults;

  K.DBEdit = E;
})(window.Kagoj = window.Kagoj || {});
