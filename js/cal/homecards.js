(function (K) {
  'use strict';

  // Home cards: what's next (12 h), after-class attendance, quick task.
  // Class databases carry schema.classes = { course }, with a Date property
  // and an "Attendance" select (Present / Absent). Task databases carry schema.tasks.
  var D = K.dom, U = K.util, Docs = K.Docs, DB = K.DB, sheets = K.sheets;
  var HOUR = 3600000;

  function day0(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clock(t) { var d = new Date(t), h = d.getHours(), m = d.getMinutes(); return ((h % 12) || 12) + ':' + pad(m) + (h < 12 ? ' AM' : ' PM'); }

  function classDbs() { return Docs.all().filter(function (d) { return d.kind === 'database' && Docs.isLive(d) && d.schema && d.schema.classes; }); }
  function attProp(db) { return DB.propByName(db, 'Attendance'); }
  function dateProp(db) { return DB.firstOf(db, ['date']); }

  function tasksDb() {
    var list = Docs.all().filter(function (d) { return d.kind === 'database' && Docs.isLive(d) && d.schema && d.schema.tasks; });
    if (list.length) { return list[0]; }
    // first quick task: make a Tasks database in the first section
    var parent = K.shell.defaultParent ? K.shell.defaultParent() : null;
    var db = DB.create(parent, 'Tasks', false);
    db.icon = '✅';
    db.schema.tasks = true;
    var due = DB.firstOf(db, ['date']);
    due.name = 'Due';
    var v = DB.newView('board', 'Board'); v.group = DB.firstOf(db, ['status']).id;
    var c = DB.newView('calendar', 'Calendar'); c.dateProp = due.id;
    db.schema.views.push(v, c);
    DB.saveSchema(db);
    Docs.update(db.id, { icon: db.icon }, { meta: true });
    return db;
  }

  // ---------- next up ----------

  function nextUp() {
    var now = Date.now();
    var items = K.CalItems.range(now, now + 12 * HOUR, true).filter(function (it) { return !it.all && it.s > now && !it.done; });
    items.sort(function (a, b) { return a.s - b.s; });
    return items[0] || null;
  }

  function nextCard() {
    var it = nextUp(), now = Date.now();
    var box = D.el('div.hc-card.hc-next');
    if (!it) {
      box.classList.add('free');
      D.append(box, [D.el('div.hc-big', { text: 'Oh, you’re free for the next 12 hours! 🎉' }), D.el('div.hc-small', { text: 'Nothing on the calendar until ' + clock(now + 12 * HOUR) + (day0(now + 12 * HOUR) !== day0(now) ? ' tomorrow' : '') + '.' })]);
      return box;
    }
    var isClass = !!(it.db && it.db.schema && it.db.schema.classes);
    var name = isClass ? (it.db.schema.classes.course || it.title) : it.title;
    var mins = Math.round((it.s - now) / 60000);
    var when = (day0(it.s) !== day0(now) ? 'tomorrow ' : '') + 'at ' + clock(it.s);
    var soon = mins <= 60 ? (mins <= 1 ? 'starting now' : 'in ' + mins + ' min') : (mins < 180 ? 'in ' + Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min' : '');
    var big = D.el('div.hc-big');
    D.append(big, isClass ? ['You have ', D.el('b', { text: name }), ' ' + when + ' next'] : ['Next up: ', D.el('b', { text: name }), ' ' + when]);
    D.append(box, [D.el('div.hc-kicker', { text: isClass ? '🎓 Next class' : '✅ Next task' }), big, soon ? D.el('div.hc-small', { text: soon.charAt(0).toUpperCase() + soon.substr(1) }) : null]);
    if (mins <= 60) { box.classList.add('soon'); }
    D.tap(box, function () { if (it.doc) { K.DbView ? K.DbView.openRow(it.doc, null) : K.shell.openDoc(it.doc); } });
    return box;
  }

  // ---------- attendance ----------

  function todaysClasses() {
    var t0 = day0(Date.now()), out = [];
    classDbs().forEach(function (db) {
      var dp = dateProp(db), ap = attProp(db);
      if (!dp || !ap) { return; }
      DB.rows(db).forEach(function (r) {
        var v = DB.value(db, r, dp);
        if (v && v.d && day0(v.d) === t0) { out.push({ db: db, row: r, s: v.d, ap: ap, course: db.schema.classes.course || db.title }); }
      });
    });
    return out.sort(function (a, b) { return a.s - b.s; });
  }
  function optionId(ap, name) { var o = (ap.options || []).filter(function (x) { return x.name === name; })[0]; return o ? o.id : null; }

  var draft = null;   // choices being made, survives re-renders
  function attendanceCard() {
    var list = todaysClasses();
    if (!list.length) { return null; }
    var last = list[list.length - 1].s;
    if (Date.now() < last) { return null; }   // shows once today's last class has started
    var allMarked = list.every(function (c) { return !!DB.raw(c.db, c.row, c.ap); });
    var box = D.el('div.hc-card.hc-att');
    if (allMarked && !draft) {
      var pres = list.filter(function (c) { return DB.raw(c.db, c.row, c.ap) === optionId(c.ap, 'Present'); }).length;
      box.classList.add('done');
      var edit = D.el('button.link-btn', { type: 'button', text: 'Change' });
      D.tap(edit, function () { draft = {}; refresh(); });
      D.append(box, [D.el('div.hc-big', { text: pres === list.length ? 'Perfect attendance today! 🌟' : 'Attendance logged: ' + pres + ' of ' + list.length + ' classes ✅' }), edit]);
      return box;
    }
    var dr = draft || {};
    var head = pick(['Class wrap-up! Which ones did you make it to today? 📝', 'Roll call, but for you: which classes did you attend today? 🙋', 'Day’s done! Tick the classes you showed up for. ✅']);
    box.appendChild(D.el('div.hc-kicker', { text: '📋 Today’s attendance' }));
    box.appendChild(D.el('div.hc-big', { text: st.attHead || (st.attHead = head) }));
    list.forEach(function (c) {
      var cur = dr[c.row.id] !== undefined ? dr[c.row.id] : DB.raw(c.db, c.row, c.ap);
      var row = D.el('div.att-row');
      row.appendChild(D.el('div.att-name', null, [D.el('b', { text: c.course }), D.el('span', { text: '  ' + clock(c.s) })]));
      var seg = D.el('div.att-seg');
      [['Present', 'p'], ['Absent', 'a']].forEach(function (o) {
        var id = optionId(c.ap, o[0]);
        var b = D.el('button.att-btn.' + o[1] + (cur && cur === id ? '.on' : ''), { type: 'button', text: o[0] });
        D.tap(b, function () { draft = draft || {}; draft[c.row.id] = id; refresh(); });
        seg.appendChild(b);
      });
      row.appendChild(seg);
      box.appendChild(row);
    });
    var save = D.el('button.small-btn.primary.att-save', { type: 'button', text: 'Save attendance' });
    D.tap(save, function () {
      var n = 0;
      list.forEach(function (c) { var v = (draft || {})[c.row.id] || DB.raw(c.db, c.row, c.ap); if (v) { if (v !== DB.raw(c.db, c.row, c.ap)) { DB.set(c.row, c.ap.id, v); } n++; } });
      draft = null;
      sheets.toast(n ? 'Attendance saved ✅' : 'Pick Present or Absent first');
      refresh();
    });
    box.appendChild(save);
    return box;
  }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  // ---------- task lists: pages marked settings.taskList (Baazar, courses...) ----------

  function taskLists() {
    var secs = Docs.sections ? Docs.sections() : [];
    function rank(d) { var s = Docs.sectionOf(d.id); var i = s ? secs.indexOf(s) : 99; return i * 1e9 + (d.position || 0); }
    return Docs.all().filter(function (d) { return d.kind === 'page' && d.settings && d.settings.taskList && Docs.isLive(d); })
      .sort(function (a, b) { return rank(a) - rank(b); });
  }
  // open to-dos at the top level of a task page (the add-task button's template is indented, so it's skipped)
  function openTodos(page) {
    return (page.content || []).filter(function (b) {
      return b.type === 'todo' && !b.checked && !(b.d > 0) && (Docs.plain(b.html).replace(/\s+/g, '') || /data-date/.test(b.html || ''));
    });
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // a new to-do at the top of the page's Tasks list (after the heading and the add-task button)
  function addTodo(page, text, whenIso) {
    var c = page.content = page.content || [];
    var at = -1;
    for (var i = 0; i < c.length; i++) { if (/^h[123]$/.test(c[i].type) && /tasks/i.test(Docs.plain(c[i].html))) { at = i + 1; break; } }
    if (at < 0) { c.push(Docs.newBlock('h2', { html: '✅ Tasks' })); at = c.length; }
    while (at < c.length && (c[at].type === 'tbtn' || (c[at].d || 0) > 0)) { at++; }
    var html = esc(text);
    if (whenIso) {
      var timed = /T/.test(whenIso);
      html += ' <span class="mdate' + (timed ? ' remind' : '') + '" data-date="' + whenIso + '"' + (timed ? ' data-remind="1"' : '') + ' contenteditable="false">' + (timed ? '⏰ ' : '') + esc(K.dateLabel(whenIso)) + '</span>';
    }
    c.splice(at, 0, Docs.newBlock('todo', { html: html, checked: false }));
    Docs.save(page);
  }

  function tasksCard() {
    var lists = taskLists(), any = false;
    var box = D.el('div.hc-card.hc-tasks', null, D.el('div.hc-kicker', { text: '☑️ Tasks' }));
    function row(label, done) {
      var cb = D.el('button.home-check', { type: 'button', 'aria-label': 'Done' });
      D.tap(cb, function () { cb.classList.add('on'); setTimeout(function () { done(); refresh(); }, 250); });
      return D.el('div.ht-row', null, [cb, label]);
    }
    function group(icon, name, items, open) {
      if (!items.length) { return; }
      any = true;
      var head = D.el('button.ht-group', { type: 'button' }, [D.el('span', { text: (icon ? icon + '  ' : '') + name }), D.el('span.ht-count', { text: String(items.length) })]);
      D.tap(head, open);
      box.appendChild(head);
      items.slice(0, 6).forEach(function (it) { box.appendChild(it); });
      if (items.length > 6) {
        var more = D.el('button.link-btn.ht-more', { type: 'button', text: '+' + (items.length - 6) + ' more' });
        D.tap(more, open);
        box.appendChild(more);
      }
    }
    // the general Tasks database ("Random")
    var tdb = Docs.all().filter(function (d) { return d.kind === 'database' && Docs.isLive(d) && d.schema && d.schema.tasks; })[0];
    if (tdb) {
      var stp = DB.firstOf(tdb, ['status']);
      var doneOpt = stp ? (stp.options || []).filter(function (o) { return o.g === 'done'; })[0] : null;
      var rows = DB.rows(tdb).filter(function (r) { var o = stp ? DB.option(stp, DB.raw(tdb, r, stp)) : null; return !(o && o.g === 'done'); });
      group(tdb.icon, 'Random', rows.map(function (r) {
        var dp = DB.firstOf(tdb, ['date']), v = dp ? DB.raw(tdb, r, dp) : null;
        var label = D.el('button.ht-text', { type: 'button' }, [D.el('span', { text: Docs.titleOf(r) }), v && v.s ? D.el('span.ht-when', { text: K.dateLabel(v.s) }) : null]);
        D.tap(label, function () { if (K.DbView) { K.DbView.openRow(r, null); } else { K.shell.openDoc(r); } });
        return row(label, function () { if (doneOpt) { DB.set(r, stp.id, doneOpt.id); } });
      }), function () { K.shell.openDoc(tdb); });
    }
    lists.forEach(function (page) {
      group(page.icon, page.settings.taskList, openTodos(page).map(function (b) {
        var m = /data-date="([^"]+)"/.exec(b.html || '');
        var text = Docs.plain((b.html || '').replace(/<span class="mdate[^>]*>[^<]*<\/span>/g, '')).replace(/^\s+|\s+$/g, '');
        var label = D.el('button.ht-text', { type: 'button' }, [D.el('span', { text: text || 'Task' }), m ? D.el('span.ht-when', { text: K.dateLabel(m[1]) }) : null]);
        D.tap(label, function () { K.shell.openDoc(page); });
        return row(label, function () { b.checked = true; Docs.save(page); });
      }), function () { K.shell.openDoc(page); });
    });
    if (!any) { box.appendChild(D.el('div.hc-small', { text: 'No open tasks. Nice. 🌿' })); }
    return box;
  }

  // ---------- quick task ----------

  var typing = false;
  function taskCard() {
    var box = D.el('div.hc-card.hc-task');
    var now = new Date(Date.now() + HOUR);
    var title = D.el('input.text-input.task-title', { type: 'text', placeholder: 'Add a task… (e.g. Submit INB372 report)', autocapitalize: 'sentences' });
    var lists = taskLists();
    var choices = [['', 'Random']].concat(lists.map(function (p) { return [p.id, (p.icon ? p.icon + ' ' : '') + p.settings.taskList]; }));
    var last = U.lsGet('kg.taskList', '');
    if (last && !lists.some(function (p) { return p.id === last; })) { last = ''; }
    var where = last;
    var pick = K.DBEdit.sel(choices, last, function (v) { where = v; U.lsSet('kg.taskList', v); });
    pick.className += ' task-list';
    var date = D.el('input.text-input.task-date', { type: 'date', value: K.isoDay(now) });
    var time = D.el('input.text-input.task-time', { type: 'time', value: pad(now.getHours()) + ':00' });
    var add = D.el('button.small-btn.primary', { type: 'button', text: 'Add' });
    [title, date, time, pick].forEach(function (i) { D.on(i, 'focus', function () { typing = true; }); D.on(i, 'blur', function () { typing = !!title.value; }); });
    function go() {
      var t = title.value.replace(/^\s+|\s+$/g, '');
      if (!t) { title.focus(); return; }
      var when = date.value ? date.value + (time.value ? 'T' + time.value : '') : '';
      var page = where ? Docs.get(where) : null, name = 'Random';
      if (page) { addTodo(page, t.substr(0, 500), when); name = page.settings.taskList; }
      else {
        var db = tasksDb();
        var due = DB.propByName(db, 'Due') || DB.firstOf(db, ['date']);
        var init = { title: t.substr(0, 500) };
        if (when) { init[due.id] = { s: when, r: 0 }; }
        var st0 = DB.firstOf(db, ['status']);
        if (st0 && st0.options && st0.options[0]) { init[st0.id] = st0.options[0].id; }
        DB.newRow(db, init);
      }
      typing = false;
      sheets.toast('Added to ' + name + (when ? ' for ' + K.dateLabel(when) : '') + ' ✅');
      refresh();
    }
    D.tap(add, go);
    D.on(title, 'keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); go(); } });
    var nodate = D.el('button.link-btn.task-nodate', { type: 'button', text: 'No date' });
    D.tap(nodate, function () { date.value = ''; time.value = ''; });
    D.append(box, [D.el('div.hc-kicker', { text: '⚡ Quick task' }), title, pick,
      D.el('div.task-when', null, [date, time, add]), nodate]);
    return box;
  }

  // Home redraws on any doc change but skips while a task is typed or attendance
  // is being chosen; our own redraws force it for a moment.
  var st = { forcing: false };
  function refresh() {
    st.forcing = true;
    K.Docs.emit('change', 'home');
    setTimeout(function () { st.forcing = false; }, 400);
  }

  K.HomeCards = {
    render: function (body) {
      body.appendChild(nextCard());
      var att = attendanceCard();
      if (att) { body.appendChild(att); }
      body.appendChild(taskCard());
      body.appendChild(tasksCard());
    },
    busy: function () { return !st.forcing && (typing || !!draft); },
    todaysClasses: todaysClasses
  };
})(window.Kagoj = window.Kagoj || {});
