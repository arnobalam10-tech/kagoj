(function (K) {
  'use strict';

  // Repeating templates: a database template can make a new row every day,
  // on chosen weekdays, or every month. Row ids are derived from the template
  // and the date, so two devices never make the same row twice.
  var U = K.util, Docs = K.Docs, DB = K.DB, D = K.dom, sheets = K.sheets;
  var WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function day0(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function addDays(t, n) { var d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); }

  // 128-bit hash of a string, shaped like a v4 uuid (the docs table wants uuids)
  function hashUuid(str) {
    var seeds = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b], h = [];
    for (var k = 0; k < 4; k++) {
      var x = seeds[k] ^ (k * 0x27d4eb2d);
      for (var i = 0; i < str.length; i++) {
        x = Math.imul(x ^ str.charCodeAt(i), 0x5bd1e995);
        x ^= x >>> 15;
      }
      // final avalanche (murmur3 fmix)
      x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
      h.push(('00000000' + (x >>> 0).toString(16)).slice(-8));
    }
    var s = h.join('');
    return s.substr(0, 8) + '-' + s.substr(8, 4) + '-4' + s.substr(13, 3) + '-' + '89ab'.charAt(parseInt(s.charAt(16), 16) % 4) + s.substr(17, 3) + '-' + s.substr(20, 12);
  }

  function due(rep, t) {
    var d = new Date(t);
    if (rep.every === 'day') { return true; }
    if (rep.every === 'week') { return (rep.days || []).indexOf((d.getDay() + 6) % 7) >= 0; }
    if (rep.every === 'month') { return d.getDate() === Math.min(rep.date || 1, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()); }
    return false;
  }

  function run() {
    var today = day0(Date.now());
    Docs.all().forEach(function (t) {
      var rep = t.settings && t.settings.template && t.settings.repeat;
      if (!rep || !Docs.isLive(t)) { return; }
      var db = Docs.get(t.parent_id);
      if (!db || !Docs.isLive(db) || !db.schema) { return; }
      var from = DB.parseDay(rep.from) || today;
      // catch up at most a week of missed days
      var start = Math.max(from, rep.last ? addDays(DB.parseDay(rep.last), 1) : from, addDays(today, -6));
      var made = false;
      for (var d = start; d <= today; d = addDays(d, 1)) {
        if (!due(rep, d)) { continue; }
        var id = hashUuid(t.id + '|' + K.isoDay(new Date(d)));
        if (Docs.get(id)) { continue; }
        var init = {};
        var dp = DB.firstOf(db, ['date']);
        if (dp) { init[dp.id] = { s: K.isoDay(new Date(d)) }; }
        var row = DB.newRow(db, init, t, id);
        // title gets the date so daily rows are easy to tell apart
        Docs.update(row.id, { title: (t.title || 'Untitled') + ' — ' + DB.fmtDate(d, false).replace(/, \d{4}$/, '') });
        made = true;
      }
      if (made || rep.last !== K.isoDay(new Date(today))) {
        var s = U.copy(t.settings); s.repeat = U.copy(rep); s.repeat.last = K.isoDay(new Date(today));
        Docs.update(t.id, { settings: s }, { meta: true });
      }
    });
  }

  function edit(db, t) {
    var rep = U.copy((t.settings && t.settings.repeat) || { every: 'none', days: [0, 1, 2, 3, 4], date: new Date().getDate() });
    var body = D.el('div.prop-set');
    var daysBox = D.el('div.rep-days');
    var dateBox = D.el('div');
    function show() {
      daysBox.style.display = rep.every === 'week' ? '' : 'none';
      dateBox.style.display = rep.every === 'month' ? '' : 'none';
    }
    body.appendChild(D.el('label.field-label', { text: 'Make a new row from “' + Docs.titleOf(t) + '”' }));
    body.appendChild(K.DBEdit.sel([['none', 'Never'], ['day', 'Every day'], ['week', 'On these weekdays'], ['month', 'Every month']], rep.every || 'none', function (v) { rep.every = v; show(); }));
    WD.forEach(function (w, i) {
      var on = (rep.days || []).indexOf(i) >= 0;
      var b = D.el('button.seg' + (on ? '.selected' : ''), { type: 'button', text: w });
      D.tap(b, function () {
        on = !on; b.classList.toggle('selected', on);
        rep.days = (rep.days || []).filter(function (x) { return x !== i; });
        if (on) { rep.days.push(i); }
      });
      daysBox.appendChild(b);
    });
    var dayIn = D.el('input.text-input', { type: 'number', min: '1', max: '31', value: rep.date || 1 });
    D.on(dayIn, 'input', function () { rep.date = Math.max(1, Math.min(31, parseInt(dayIn.value, 10) || 1)); });
    D.append(dateBox, [D.el('label.field-label', { text: 'Day of the month' }), dayIn]);
    D.append(body, [daysBox, dateBox, D.el('p.set-sub', { text: 'Rows are made when Kagoj is open on any device, dated that day, with the template’s properties and content.' })]);
    show();
    sheets.modal({ title: 'Repeat', body: body, cls: 'sheet-prop', actions: [
      { label: 'Cancel' },
      { label: 'Save', primary: true, onTap: function () {
        var s = U.copy(t.settings || {});
        if (rep.every === 'none') { delete s.repeat; }
        else { rep.from = rep.from || K.isoDay(new Date()); delete rep.last; s.repeat = rep; }
        Docs.update(t.id, { settings: s }, { meta: true });
        run();
        sheets.toast(rep.every === 'none' ? 'Repeat off' : 'Repeat on');
      } }
    ] });
  }

  K.Repeat = { run: run, edit: edit, hashUuid: hashUuid };

  // run after each sync (so rows made on another device are known first), and hourly
  var runSoon = U.debounce(run, 2000);
  K.Sync.on('done', function (err) { if (!err) { runSoon(); } });
  setTimeout(function () { if (!K.sb.isLoggedIn()) { run(); } }, 4000);
  setInterval(runSoon, 3600000);
})(window.Kagoj = window.Kagoj || {});
