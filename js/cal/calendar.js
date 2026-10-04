(function (K) {
  'use strict';

  // Calendar screen: #/calendar/<month|week|day|agenda>/<yyyy-mm-dd>
  var D = K.dom, U = K.util, Docs = K.Docs, DB = K.DB, Items = K.CalItems, sheets = K.sheets;
  var DAY = 86400000, HOUR_PX = 48;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var HEX = { blue: '#4A7FC1', green: '#4E9A6A', orange: '#E08A3C', purple: '#8E6BBF', red: '#D2584A', pink: '#C9649A', brown: '#A27763', yellow: '#C9A227', gray: '#8A857B' };

  function day0(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function addDays(t, n) { var d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); }
  function weekStart(t) { var d = new Date(day0(t)); return addDays(d.getTime(), -((d.getDay() + 6) % 7)); }
  function iso(t) { return K.isoDay(new Date(t)); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function parse(s) { var t = s ? DB.parseDay(s) : null; return t === null ? day0(Date.now()) : day0(t); }

  var st = null;

  function defaultView() { return U.lsGet('kg.calView', null) || (window.innerWidth < 600 ? 'agenda' : 'month'); }

  function go(view, t) { K.router.go('#/calendar/' + view + '/' + iso(t)); }

  // ---------- item chips ----------

  function openItem(it) {
    if (it.src === 'ext') {
      var body = D.el('div.ext-ev', null, [
        D.el('p', { text: whenText(it) }),
        it.loc ? D.el('p', { text: '📍 ' + it.loc }) : null,
        D.el('p.set-sub', { text: 'From ' + it.ext.name + ' (read-only)' })
      ]);
      sheets.modal({ title: it.title, body: body, actions: [{ label: 'Close', primary: true }] });
      return;
    }
    if (it.doc) {
      if (it.doc.kind === 'row' && K.DbView) { K.DbView.openRow(it.doc, null); } else { K.shell.openDoc(it.doc); }
    }
  }
  function whenText(it) {
    var s = K.dateLabel(iso(it.s) + (it.all ? '' : 'T' + hhmm(it.s)));
    if (it.e && day0(it.e) !== day0(it.s)) { s += ' → ' + K.dateLabel(iso(it.e) + (it.all ? '' : 'T' + hhmm(it.e))); }
    else if (!it.all && it.e > it.s) { s += ' – ' + K.timeLabel(it.e); }
    return s;
  }

  function chip(it, cls, label) {
    var el = D.el('div.cv-item' + (cls ? '.' + cls : '') + (it.done ? '.done' : '') + (it.src === 'ext' ? '.ext' : ''), { title: it.title });
    el.style.borderLeftColor = HEX[it.color] || HEX.blue;
    el.appendChild(D.el('span', { text: label !== undefined ? label : it.title }));
    if (it.remind !== undefined && it.remind !== null) { el.appendChild(D.icon('bell', 'mini')); }
    D.tap(el, function (e) {
      if (e && e.stopPropagation) { e.stopPropagation(); }
      if (K.dbJustDragged(el)) { return; }
      openItem(it);
    });
    return el;
  }

  // ---------- quick add ----------

  function quickAdd(t, timed, endT) {
    var title = D.el('input.text-input', { type: 'text', placeholder: 'Title', autocapitalize: 'sentences' });
    var date = D.el('input.text-input', { type: 'date', value: iso(t) });
    var allDay = !timed;
    var start = D.el('input.text-input.time', { type: 'time', value: timed ? hhmm(t) : '09:00' });
    var end = D.el('input.text-input.time', { type: 'time', value: timed ? hhmm(endT || t + 3600000) : '10:00' });
    var times = D.el('div.qa-times', null, [start, D.el('span.qa-dash', { text: '–' }), end]);
    var tog = D.el('button.toggle' + (allDay ? '.on' : ''), { type: 'button' }, D.el('span.knob'));
    function show() { times.style.display = allDay ? 'none' : ''; }
    D.tap(tog, function () { allDay = !allDay; tog.classList.toggle('on', allDay); show(); });
    show();
    var cals = Items.calendars().filter(function (c) { return c.db; });
    var target = cals.length ? Items.targetDb().id : '';
    if (!cals.length) { cals = []; }
    var calSel = K.DBEdit.sel(cals.length ? cals.map(function (c) { return [c.id, c.name]; }) : [['', 'Calendar (new database)']], target, function (v) { target = v; });
    var remind = K.DBEdit.sel([['', 'No reminder'], ['0', 'At the time'], ['10', '10 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before']], '', U.noop);
    var body = D.el('div.qa', null, [title, date,
      D.el('div.pm-row', null, [D.el('span.pm-label', { text: 'All day' }), tog]), times,
      D.el('label.field-label', { text: 'Calendar' }), calSel,
      D.el('label.field-label', { text: 'Reminder' }), remind]);
    var m = sheets.modal({ title: 'New event', body: body, cls: 'sheet-prop', actions: [
      { label: 'Cancel' },
      { label: 'Add', primary: true, onTap: function () {
        if (!date.value) { sheets.toast('Pick a date.'); return false; }
        var s = date.value + (allDay ? '' : 'T' + (start.value || '09:00'));
        var e = allDay ? null : date.value + 'T' + (end.value || start.value || '10:00');
        if (e && e < s) { e = null; }
        var db = target ? Docs.get(target) : null;
        var row = Items.create(title.value.replace(/^\s+|\s+$/g, ''), s, e, db);
        if (remind.value !== '') {
          var dbx = Docs.get(row.parent_id), dp = (dbx.schema.calProp && DB.prop(dbx, dbx.schema.calProp)) || DB.firstOf(dbx, ['date']);
          var v = U.copy(DB.raw(dbx, row, dp)); v.r = +remind.value; DB.set(row, dp.id, v);
        }
        U.lsSet('kg.calDb', row.parent_id);
        render();
      } }
    ] });
    D.on(title, 'keydown', function (e) { if (e.keyCode === 13) { e.preventDefault(); m.panel.querySelector('.sheet-btn.primary').click(); } });
    setTimeout(function () { title.focus(); }, 50);
  }

  // ---------- views ----------

  function renderMonth(body, t) {
    var m0 = new Date(t); m0 = new Date(m0.getFullYear(), m0.getMonth(), 1);
    var start = weekStart(m0.getTime());
    var weeks = 6, end = addDays(start, weeks * 7);
    var items = Items.range(start, end);
    var today = day0(Date.now());
    var grid = D.el('table.cv-month');
    var hr = D.el('tr');
    WEEK.forEach(function (w) { hr.appendChild(D.el('th', { text: w })); });
    grid.appendChild(D.el('thead', null, hr));
    var tb = D.el('tbody'), d = start, maxShow = window.innerWidth < 600 ? 2 : 4;
    for (var w = 0; w < weeks; w++) {
      if (w >= 5 && new Date(d).getMonth() !== m0.getMonth()) { break; }
      var tr = D.el('tr');
      for (var i = 0; i < 7; i++) { tr.appendChild(monthCell(d, m0.getMonth(), today, items, maxShow)); d = addDays(d, 1); }
      tb.appendChild(tr);
    }
    grid.appendChild(tb);
    body.appendChild(D.el('div.cv-month-wrap', null, grid));
  }

  function monthCell(t, month, today, items, maxShow) {
    var dt = new Date(t), next = addDays(t, 1);
    var td = D.el('td.cv-day' + (dt.getMonth() !== month ? '.out' : '') + (t === today ? '.today' : ''), { 'data-drop': String(t) });
    var num = D.el('button.cv-num', { type: 'button', text: String(dt.getDate()) });
    D.tap(num, function (e) { if (e && e.stopPropagation) { e.stopPropagation(); } go('day', t); });
    td.appendChild(num);
    var mine = items.filter(function (it) { var e = it.all ? day0(it.e) + DAY : Math.max(it.e, it.s + 1); return it.s < next && e > t; });
    mine.slice(0, maxShow).forEach(function (it) {
      var lab = (!it.all && day0(it.s) === t ? K.timeLabel(it.s) + ' ' : '') + it.title;
      var c = chip(it, it.all ? 'allday' : '', lab);
      if (it.all) { c.style.backgroundColor = tint(it.color); }
      drag(c, it);
      td.appendChild(c);
    });
    if (mine.length > maxShow) {
      var more = D.el('button.cv-more', { type: 'button', text: '+' + (mine.length - maxShow) + ' more' });
      D.tap(more, function (e) { if (e && e.stopPropagation) { e.stopPropagation(); } go('day', t); });
      td.appendChild(more);
    }
    D.tap(td, function () { quickAdd(t, false); });
    return td;
  }

  function tint(c) {
    return { blue: '#DCE7F5', green: '#DDEEE2', orange: '#FBE6D3', purple: '#EAE2F4', red: '#F8DEDA', pink: '#F5E0EB', brown: '#EEE2DC', yellow: '#F7EDCC', gray: '#ECEAE5' }[c] || '#DCE7F5';
  }

  // drag to another day (month) or another time (week/day)
  function drag(el, it) {
    if (it.src !== 'db') { return; }
    K.dbDraggable(el, { drop: function (key, target, p) {
      var parts = String(key).split(':');
      var dayT = +parts[0];
      if (isNaN(dayT)) { return; }
      if (parts[1] === 'all') { Items.move(it, dayT, true); }
      else if (parts[1] === 'time') {
        var r = target.getBoundingClientRect();
        var mins = Math.max(0, Math.min(24 * 60 - 15, Math.round(((p.y - (p.offY || 0) - r.top) / HOUR_PX * 60) / 15) * 15));
        Items.move(it, dayT + mins * 60000, false);
      } else {
        // keep the time of day
        Items.move(it, dayT + (it.s - day0(it.s)));
      }
      render();
    } });
  }

  function renderDays(body, t, n) {
    var start = n === 7 ? weekStart(t) : day0(t), end = addDays(start, n);
    var items = Items.range(start, end);
    var today = day0(Date.now());
    var wrap = D.el('div.cv-week' + (n === 1 ? '.one' : ''));
    // header + all-day row
    var head = D.el('div.cv-whead', null, D.el('div.cv-gutter'));
    var allRow = D.el('div.cv-allday', null, D.el('div.cv-gutter', { text: 'all day' }));
    for (var i = 0; i < n; i++) {
      var dt = addDays(start, i), dd = new Date(dt);
      var h = D.el('button.cv-dhead' + (dt === today ? '.today' : ''), { type: 'button' }, [D.el('span.cv-dname', { text: WEEK[(dd.getDay() + 6) % 7] }), D.el('span.cv-dnum', { text: String(dd.getDate()) })]);
      (function (x) { D.tap(h, function () { if (n > 1) { go('day', x); } }); })(dt);
      head.appendChild(h);
      var cell = D.el('div.cv-allcell', { 'data-drop': dt + ':all' });
      items.filter(function (it) { return it.all && it.s < addDays(dt, 1) && day0(it.e) + DAY > dt; }).forEach(function (it) {
        var c = chip(it, 'allday');
        c.style.backgroundColor = tint(it.color);
        drag(c, it);
        cell.appendChild(c);
      });
      (function (x) { D.tap(cell, function () { quickAdd(x, false); }); })(dt);
      allRow.appendChild(cell);
    }
    wrap.appendChild(head);
    wrap.appendChild(allRow);
    // hour grid
    var scroller = D.el('div.cv-hours.scrolls');
    var grid = D.el('div.cv-hgrid', { style: { height: (24 * HOUR_PX) + 'px' } });
    var gut = D.el('div.cv-gutter.hours');
    for (var hr = 1; hr < 24; hr++) { gut.appendChild(D.el('div.cv-hlabel', { style: { top: (hr * HOUR_PX - 7) + 'px' }, text: ((hr % 12) || 12) + (hr < 12 ? ' AM' : ' PM') })); }
    grid.appendChild(gut);
    for (var j = 0; j < n; j++) { grid.appendChild(dayColumn(addDays(start, j), items, today)); }
    scroller.appendChild(grid);
    wrap.appendChild(scroller);
    body.appendChild(wrap);
    // start the view around 7 AM (or now, on today)
    setTimeout(function () {
      var nowH = new Date().getHours();
      scroller.scrollTop = Math.max(0, ((today >= start && today < end ? Math.max(7, nowH - 2) : 7) * HOUR_PX) - 10);
    }, 0);
  }

  function dayColumn(t, items, today) {
    var col = D.el('div.cv-col' + (t === today ? '.today' : ''), { 'data-drop': t + ':time' });
    for (var h = 0; h < 24; h++) { col.appendChild(D.el('div.cv-line', { style: { top: (h * HOUR_PX) + 'px' } })); }
    var timed = items.filter(function (it) { return !it.all && it.s < addDays(t, 1) && Math.max(it.e, it.s + 1) > t; });
    // lay overlapping events side by side
    var lanes = [];
    timed.forEach(function (it) {
      var s = Math.max(it.s, t), e = Math.min(Math.max(it.e, it.s + 30 * 60000), addDays(t, 1));
      var lane = 0;
      while (lanes[lane] && lanes[lane] > s) { lane++; }
      lanes[lane] = e;
      it._lane = lane; it._s = s; it._e = e;
    });
    var nl = Math.max(1, lanes.length);
    timed.forEach(function (it) {
      var top = (it._s - t) / 60000 / 60 * HOUR_PX, hgt = Math.max(20, (it._e - it._s) / 60000 / 60 * HOUR_PX - 2);
      var c = chip(it, 'timed', it.title);
      c.insertBefore(D.el('span.cv-time', { text: K.timeLabel(it.s) + ' ' }), c.firstChild);
      D.css(c, { top: top + 'px', height: hgt + 'px', left: (it._lane / nl * 100) + '%', width: (100 / nl) + '%', backgroundColor: tint(it.color) });
      drag(c, it);
      col.appendChild(c);
    });
    if (t === today) {
      var now = new Date();
      col.appendChild(D.el('div.cv-now', { style: { top: ((now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_PX) + 'px' } }));
    }
    D.on(col, 'click', function (e) {
      if (e.target !== col && !(e.target.classList && e.target.classList.contains('cv-line'))) { return; }
      var r = col.getBoundingClientRect();
      var mins = Math.floor(((e.clientY - r.top) / HOUR_PX * 60) / 30) * 30;
      quickAdd(t + mins * 60000, true, t + (mins + 60) * 60000);
    });
    return col;
  }

  function renderAgenda(body, t) {
    var start = day0(t), days = st.agendaDays || 45, end = addDays(start, days);
    var items = Items.range(start, end);
    var today = day0(Date.now());
    var any = false;
    for (var d = start; d < end; d = addDays(d, 1)) {
      var next = addDays(d, 1);
      var mine = items.filter(function (it) { var e = it.all ? day0(it.e) + DAY : Math.max(it.e, it.s + 1); return it.s < next && e > d; });
      if (!mine.length && d !== today) { continue; }
      any = true;
      var dd = new Date(d);
      var head = D.el('div.ag-day' + (d === today ? '.today' : ''), null, [
        D.el('span.ag-num', { text: String(dd.getDate()) }),
        D.el('span.ag-name', { text: WEEK[(dd.getDay() + 6) % 7] + ', ' + MONTHS[dd.getMonth()].substr(0, 3) + (dd.getFullYear() !== new Date().getFullYear() ? ' ' + dd.getFullYear() : '') + (d === today ? ' · Today' : '') })
      ]);
      (function (x) {
        var add = D.el('button.ag-add', { type: 'button', title: 'Add' }, D.icon('plus'));
        D.tap(add, function () { quickAdd(x, false); });
        head.appendChild(add);
      })(d);
      body.appendChild(head);
      if (!mine.length) { body.appendChild(D.el('div.ag-empty', { text: 'Nothing planned' })); }
      mine.forEach(function (it) {
        var row = D.el('div.ag-item' + (it.done ? '.done' : ''));
        row.appendChild(D.el('span.ag-dot', { style: { background: HEX[it.color] || HEX.blue } }));
        row.appendChild(D.el('span.ag-time', { text: it.all ? 'All day' : K.timeLabel(it.s) + (it.e > it.s ? '–' + K.timeLabel(it.e) : '') }));
        row.appendChild(D.el('span.ag-title', { text: it.title }));
        if (it.from && it.from !== it.title) { row.appendChild(D.el('span.ag-from', { text: it.from })); }
        if (it.remind !== undefined && it.remind !== null) { row.appendChild(D.icon('bell', 'mini')); }
        D.tap(row, function () { openItem(it); });
        body.appendChild(row);
      });
    }
    if (!any) { body.appendChild(D.el('p.empty', { text: 'Nothing planned.' })); }
    var more = D.el('button.small-btn.ag-more', { type: 'button', text: 'Show more' });
    D.tap(more, function () { st.agendaDays = days + 60; render(); });
    body.appendChild(more);
  }

  // ---------- settings ----------

  function settingsSheet() {
    var body = D.el('div.cal-set');
    var hidden = Items.hidden();
    body.appendChild(D.el('label.field-label', { text: 'Show calendars' }));
    Items.calendars().forEach(function (c) {
      var on = hidden.indexOf(c.id) < 0;
      var t = D.el('button.toggle' + (on ? '.on' : ''), { type: 'button' }, D.el('span.knob'));
      D.tap(t, function () {
        on = !on; t.classList.toggle('on', on);
        var h = Items.hidden().filter(function (x) { return x !== c.id; });
        if (!on) { h.push(c.id); }
        Items.setHidden(h);
      });
      var row = D.el('div.pm-row', null, [D.el('span.ag-dot', { style: { background: HEX[c.color] || HEX.blue } }), D.el('span.pm-label', { text: c.name }), t]);
      if (c.ext) {
        var rm = D.el('button.small-btn.danger', { type: 'button', text: 'Remove' });
        D.tap(rm, function () {
          var d = K.UserSettings.data.data;
          d.cals = (d.cals || []).filter(function (x) { return x.id !== c.ext.id; });
          U.lsDel(K.ExtCal.cacheKey(c.ext));
          K.UserSettings.save(); Items.invalidate(); D.remove(row); render();
        });
        row.insertBefore(rm, t);
      }
      body.appendChild(row);
    });

    // subscribe to another calendar
    body.appendChild(D.el('label.field-label', { text: 'Add a calendar (iCal link, read-only)' }));
    var url = D.el('input.text-input', { type: 'url', placeholder: 'https://…/basic.ics (Google: “Secret address in iCal format”)', autocapitalize: 'off', autocorrect: 'off' });
    var nm = D.el('input.text-input', { type: 'text', placeholder: 'Name (e.g. University)' });
    var addB = D.el('button.small-btn', { type: 'button', text: 'Add calendar' });
    D.tap(addB, function () {
      var u = url.value.replace(/^\s+|\s+$/g, '').replace(/^webcal:\/\//i, 'https://');
      if (!/^https?:\/\//i.test(u)) { sheets.toast('Paste an iCal link that starts with https://'); return; }
      var d = K.UserSettings.data.data = K.UserSettings.data.data || {};
      var c = { id: U.strokeId().substr(2), url: u, name: nm.value.replace(/^\s+|\s+$/g, '') || 'Calendar', color: ['purple', 'orange', 'green', 'red', 'pink'][(d.cals || []).length % 5] };
      addB.disabled = true; addB.textContent = 'Loading…';
      K.ExtCal.refresh(c, function (err, n) {
        addB.disabled = false; addB.textContent = 'Add calendar';
        if (err) { sheets.toast(err.message || 'Could not load that calendar.', 5000); return; }
        d.cals = (d.cals || []).concat([c]);
        K.UserSettings.save();
        Items.invalidate();
        sheets.toast('Added ' + c.name + ' (' + n + ' events)');
        url.value = ''; nm.value = '';
        render();
      });
    });
    D.append(body, [url, nm, addB]);
    if (K.ExtCal.list().length) {
      var ref = D.el('button.small-btn', { type: 'button', text: 'Refresh calendars now' });
      D.tap(ref, function () { K.ExtCal.refreshAll(true); sheets.toast('Refreshing…'); setTimeout(render, 4000); });
      body.appendChild(ref);
    }

    // phone feed
    body.appendChild(D.el('label.field-label', { text: 'On your phone' }));
    body.appendChild(D.el('p.set-sub', { text: 'Subscribe to this private link in your phone’s calendar app. Your dated rows, @dates and reminders appear there, with alerts, and update on their own (phones refresh subscribed calendars every few hours). Keep the link private; reset it if it leaks.' }));
    var linkBox = D.el('div.feed-box');
    function showLink() {
      D.empty(linkBox);
      var u = K.CalFeed.url();
      if (!u) {
        var mk = D.el('button.small-btn.primary', { type: 'button', text: 'Create my calendar link' });
        D.tap(mk, function () {
          mk.disabled = true;
          K.CalFeed.reset(function (err) { if (err) { sheets.toast(K.sb.describeError ? K.sb.describeError(err) : err.message, 5000); } showLink(); });
        });
        linkBox.appendChild(mk);
        return;
      }
      var inp = D.el('input.text-input.feed-url', { type: 'text', value: u, readonly: 'readonly' });
      D.on(inp, 'focus', function () { try { inp.setSelectionRange(0, inp.value.length); } catch (e) { /* ignore */ } });
      var copy = D.el('button.small-btn', { type: 'button', text: 'Copy link' });
      D.tap(copy, function () { K.copyText(u); });
      var open = D.el('a.small-btn.feed-open', { href: u.replace(/^https:/, 'webcal:'), text: 'Add to this device' });
      var reset = D.el('button.small-btn.danger', { type: 'button', text: 'Reset link' });
      D.tap(reset, function () {
        sheets.confirm({ title: 'Reset the calendar link?', message: 'The old link stops working. Subscribe again with the new one.', ok: 'Reset', danger: true }, function (ok) {
          if (ok) { K.CalFeed.reset(function (err) { if (err) { sheets.toast(err.message, 5000); } showLink(); }); }
        });
      });
      D.append(linkBox, [inp, D.el('div.feed-btns', null, [copy, open, reset]),
        D.el('p.set-sub', { text: 'iPhone: Settings › Calendar › Accounts › Add Account › Other › Add Subscribed Calendar. Android: open calendar.google.com on a computer › Other calendars › From URL.' })]);
    }
    showLink();
    body.appendChild(linkBox);
    if (!K.UserSettings.loaded) { K.UserSettings.load(function () { showLink(); }); }

    // in-app alerts
    body.appendChild(D.el('label.field-label', { text: 'Alerts while Kagoj is open' }));
    if (window.Notification && window.Notification.permission !== 'granted') {
      var ask = D.el('button.small-btn', { type: 'button', text: 'Allow notifications on this device' });
      D.tap(ask, function () { K.Reminders.askPermission(function (ok) { sheets.toast(ok ? 'Notifications on' : 'Not allowed by the browser'); }); });
      body.appendChild(ask);
    } else {
      body.appendChild(D.el('p.set-sub', { text: window.Notification ? 'Notifications are on.' : 'Reminders show as a banner inside the app on this device.' }));
    }
    sheets.modal({ title: 'Calendar settings', body: body, cls: 'sheet-prop', actions: [{ label: 'Done', primary: true, onTap: function () { render(); } }] });
  }

  // ---------- screen ----------

  function title(view, t) {
    var d = new Date(t);
    if (view === 'month' || view === 'agenda') { return (window.innerWidth < 600 ? MONTHS[d.getMonth()].substr(0, 3) : MONTHS[d.getMonth()]) + ' ' + d.getFullYear(); }
    if (view === 'day') { return K.dateLabel(iso(t)) + (K.dateLabel(iso(t)).length < 10 ? ', ' + MONTHS[d.getMonth()].substr(0, 3) + ' ' + d.getDate() : ''); }
    var s = weekStart(t), e = addDays(s, 6), ds = new Date(s), de = new Date(e);
    return MONTHS[ds.getMonth()].substr(0, 3) + ' ' + ds.getDate() + ' – ' + (ds.getMonth() !== de.getMonth() ? MONTHS[de.getMonth()].substr(0, 3) + ' ' : '') + de.getDate() + ', ' + de.getFullYear();
  }

  function step(view, t, dir) {
    var d = new Date(t);
    if (view === 'month') { return new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime(); }
    if (view === 'week') { return addDays(t, 7 * dir); }
    if (view === 'agenda') { return addDays(t, 30 * dir); }
    return addDays(t, dir);
  }

  function render() {
    if (!st) { return; }
    var view = st.view, t = st.t;
    st.titleEl.textContent = title(view, t);
    Array.prototype.forEach.call(st.segs.childNodes, function (b) { b.classList.toggle('selected', b.getAttribute('data-v') === view); });
    var body = D.empty(st.body);
    body.className = 'cv-body cv-' + view;
    if (view === 'month') { renderMonth(body, t); }
    else if (view === 'week') { renderDays(body, t, 7); }
    else if (view === 'day') { renderDays(body, t, 1); }
    else { renderAgenda(body, t); }
  }

  K.Upcoming.onChange(function () { if (st) { st.onChange(); } });

  var screen = {};
  screen.mount = function (root, params) {
    var view = params.view && /^(month|week|day|agenda)$/.test(params.view) ? params.view : defaultView();
    st = { view: view, t: parse(params.date) };
    var prev = D.button({ icon: 'chevron-left', title: 'Previous' });
    var next = D.button({ icon: 'chevron-right', title: 'Next' });
    var todayB = D.el('button.small-btn.cv-today', { type: 'button', text: 'Today' });
    D.tap(prev, function () { go(st.view, step(st.view, st.t, -1)); });
    D.tap(next, function () { go(st.view, step(st.view, st.t, 1)); });
    D.tap(todayB, function () { go(st.view, Date.now()); });
    var segs = D.el('div.segmented.cv-segs');
    [['month', 'Month'], ['week', 'Week'], ['day', 'Day'], ['agenda', 'List']].forEach(function (v) {
      var b = D.el('button.seg', { type: 'button', text: v[1], 'data-v': v[0] });
      D.tap(b, function () { U.lsSet('kg.calView', v[0]); go(v[0], st.t); });
      segs.appendChild(b);
    });
    var add = D.button({ icon: 'plus', title: 'New event' });
    D.tap(add, function () { quickAdd(st.view === 'day' ? st.t : day0(Date.now()), false); });
    var set = D.button({ icon: 'settings', title: 'Calendar settings' });
    D.tap(set, settingsSheet);
    st.titleEl = D.el('div.top-title.cv-title');
    st.segs = segs;
    var top = D.el('header.topbar.doc-top.cv-top', null, [K.shell.menuButton(), st.titleEl, D.el('div.spacer'), prev, next, add, set]);
    var bar = D.el('div.cv-bar', null, [segs, todayB]);
    st.body = D.el('div.cv-body');
    D.append(root, [top, bar, D.el('div.doc-scroll.scrolls.cv-scroll', null, st.body)]);
    st.onChange = U.debounce(render, 300);
    Docs.on('change', st.onChange);
    // swipe left/right to change the period on touch screens
    var sx = null, sy = null;
    D.on(st.body, 'touchstart', function (e) { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } }, { passive: true });
    D.on(st.body, 'touchend', function (e) {
      if (sx === null || st.view === 'agenda') { return; }
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      sx = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) { go(st.view, step(st.view, st.t, dx < 0 ? 1 : -1)); }
    }, { passive: true });
    render();
  };
  screen.update = function (params) {
    if (!st) { return false; }
    st.view = params.view && /^(month|week|day|agenda)$/.test(params.view) ? params.view : st.view;
    st.t = parse(params.date);
    render();
    return true;
  };
  screen.unmount = function () {
    if (!st) { return; }
    Docs.off('change', st.onChange);
    st.onChange.cancel();
    st = null;
  };

  K.screens = K.screens || {};
  K.screens.calendar = screen;
})(window.Kagoj = window.Kagoj || {});
