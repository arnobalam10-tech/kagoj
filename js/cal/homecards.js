(function (K) {
  'use strict';

  // Home cards: what's next (12 h), after-class attendance, quick task.
  // Class databases carry schema.classes = { course }, with a Date property
  // and an "Attendance" select (Present / Absent). Task databases carry schema.tasks.
  var D = K.dom, Docs = K.Docs, DB = K.DB, sheets = K.sheets;
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

  // ---------- quick task ----------

  var typing = false;
  function taskCard() {
    var box = D.el('div.hc-card.hc-task');
    var now = new Date(Date.now() + HOUR);
    var title = D.el('input.text-input.task-title', { type: 'text', placeholder: 'Add a task… (e.g. Submit INB372 report)', autocapitalize: 'sentences' });
    var date = D.el('input.text-input.task-date', { type: 'date', value: K.isoDay(now) });
    var time = D.el('input.text-input.task-time', { type: 'time', value: pad(now.getHours()) + ':00' });
    var add = D.el('button.small-btn.primary', { type: 'button', text: 'Add' });
    function busy(on) { typing = on; }
    [title, date, time].forEach(function (i) { D.on(i, 'focus', function () { busy(true); }); D.on(i, 'blur', function () { busy(!!title.value); }); });
    function go() {
      var t = title.value.replace(/^\s+|\s+$/g, '');
      if (!t) { title.focus(); return; }
      var db = tasksDb();
      var due = DB.propByName(db, 'Due') || DB.firstOf(db, ['date']);
      var init = { title: t.substr(0, 500) };
      if (date.value) { init[due.id] = { s: date.value + (time.value ? 'T' + time.value : ''), r: 0 }; }
      var st0 = DB.firstOf(db, ['status']);
      if (st0 && st0.options && st0.options[0]) { init[st0.id] = st0.options[0].id; }
      DB.newRow(db, init);
      typing = false;
      sheets.toast('Task added' + (date.value ? ' for ' + K.dateLabel(date.value + (time.value ? 'T' + time.value : '')) : '') + ' ✅');
      refresh();
    }
    D.tap(add, go);
    D.on(title, 'keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); go(); } });
    D.append(box, [D.el('div.hc-kicker', { text: '⚡ Quick task' }), title, D.el('div.task-when', null, [date, time, add])]);
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
    },
    busy: function () { return !st.forcing && (typing || !!draft); },
    todaysClasses: todaysClasses
  };
})(window.Kagoj = window.Kagoj || {});
