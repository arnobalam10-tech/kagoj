(function (K) {
  'use strict';

  // Everything that has a date: database rows, @date mentions in pages and
  // events from subscribed (read-only) calendars. Used by the Calendar screen,
  // Home "Upcoming" and reminders.
  var U = K.util, Docs = K.Docs, DB = K.DB;
  var DAY = 86400000;

  function day0(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function parseLocal(s) { return DB.parseDay(s); }

  // ---------- user settings that follow the user (calendar subscriptions, feed token) ----------

  var Settings = { data: U.lsGet('kg.userSettings', null) || { data: {}, feed_token: null } };
  Settings.loaded = false;
  Settings.load = function (cb) {
    cb = cb || U.noop;
    if (!K.sb.isLoggedIn()) { cb(null, Settings.data); return; }
    K.sb.rest('GET', 'user_settings?select=data,feed_token', {}, function (err, rows) {
      if (!err && rows) {
        Settings.data = rows[0] ? { data: rows[0].data || {}, feed_token: rows[0].feed_token || null } : { data: {}, feed_token: null };
        Settings.loaded = true;
        U.lsSet('kg.userSettings', Settings.data);
      }
      cb(err, Settings.data);
    });
  };
  Settings.save = function (cb) {
    cb = cb || U.noop;
    U.lsSet('kg.userSettings', Settings.data);
    if (!K.sb.isLoggedIn()) { cb(new Error('Log in to save this on all your devices.')); return; }
    K.sb.rest('POST', 'user_settings', {
      body: { user_id: K.sb.userId(), data: Settings.data.data || {}, feed_token: Settings.data.feed_token || null },
      prefer: 'resolution=merge-duplicates,return=minimal'
    }, function (err) { cb(err || null); });
  };
  K.UserSettings = Settings;

  // ---------- external calendars (iCal URLs, read-only) ----------

  var Ext = {};
  Ext.list = function () { return (Settings.data.data && Settings.data.data.cals) || []; };
  Ext.cacheKey = function (c) { return 'kg.ical.' + c.id; };
  Ext.events = function (c) { return U.lsGet(Ext.cacheKey(c), null) || { at: 0, ev: [] }; };

  function unfold(text) { return String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }
  function icsDate(v, params) {
    var m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?/.exec(v || '');
    if (!m) { return null; }
    if (!m[4] || /VALUE=DATE(;|$)/.test(params || '') && !m[4]) { return { t: new Date(+m[1], +m[2] - 1, +m[3]).getTime(), all: true }; }
    if (m[7]) { return { t: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)), all: false }; }
    return { t: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime(), all: false };
  }
  function icsText(s) { return String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); }

  // Parse VEVENTs and expand simple repeating rules inside [from, to)
  Ext.parse = function (text, from, to) {
    var lines = unfold(text).split('\n'), out = [], ev = null;
    lines.forEach(function (line) {
      if (line === 'BEGIN:VEVENT') { ev = {}; return; }
      if (line === 'END:VEVENT') { if (ev) { expand(ev, from, to, out); } ev = null; return; }
      if (!ev) { return; }
      var i = line.indexOf(':');
      if (i < 0) { return; }
      var head = line.substr(0, i), val = line.substr(i + 1), semi = head.indexOf(';');
      var name = (semi < 0 ? head : head.substr(0, semi)).toUpperCase(), params = semi < 0 ? '' : head.substr(semi + 1);
      if (name === 'DTSTART') { ev.s = icsDate(val, params); }
      else if (name === 'DTEND') { ev.e = icsDate(val, params); }
      else if (name === 'SUMMARY') { ev.title = icsText(val).substr(0, 300); }
      else if (name === 'LOCATION') { ev.loc = icsText(val).substr(0, 300); }
      else if (name === 'RRULE') { ev.rrule = val; }
      else if (name === 'UID') { ev.uid = val; }
      else if (name === 'EXDATE') { (ev.ex = ev.ex || []).push(val.split(',').map(function (x) { var d = icsDate(x); return d ? day0(d.t) : 0; })); }
      else if (name === 'STATUS' && /CANCELLED/i.test(val)) { ev.cancelled = true; }
    });
    return out.slice(0, 3000);
  };

  var WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  function expand(ev, from, to, out) {
    if (!ev.s || ev.cancelled) { return; }
    var dur = ev.e ? Math.max(0, ev.e.t - ev.s.t) : (ev.s.all ? DAY : 3600000);
    var ex = [].concat.apply([], ev.ex || []);
    function push(t) {
      if (t + dur < from || t >= to || ex.indexOf(day0(t)) >= 0) { return; }
      out.push({ uid: (ev.uid || '') + ':' + t, title: ev.title || '(No title)', loc: ev.loc || '', s: t, e: t + dur, all: ev.s.all });
    }
    if (!ev.rrule) { push(ev.s.t); return; }
    var r = {};
    ev.rrule.split(';').forEach(function (p) { var kv = p.split('='); r[kv[0].toUpperCase()] = kv[1] || ''; });
    var freq = r.FREQ, iv = Math.max(1, +r.INTERVAL || 1), count = +r.COUNT || 0;
    var until = r.UNTIL ? (icsDate(r.UNTIL) || {}).t : null;
    var byday = r.BYDAY ? r.BYDAY.split(',').map(function (x) { return WD[x.replace(/^[-+\d]+/, '')]; }).filter(function (x) { return x !== undefined; }) : null;
    var n = 0, guard = 0, base = new Date(ev.s.t);
    for (var k = 0; guard < 2000; k++) {
      guard++;
      var occ = [];
      var d = new Date(base.getTime());
      if (freq === 'DAILY') { d.setDate(base.getDate() + k * iv); occ.push(d.getTime()); }
      else if (freq === 'WEEKLY') {
        var wk = new Date(base.getTime()); wk.setDate(base.getDate() + k * 7 * iv);
        if (byday && byday.length) {
          var ws = new Date(wk.getTime()); ws.setDate(wk.getDate() - wk.getDay());
          byday.slice().sort().forEach(function (w) { var x = new Date(ws.getTime()); x.setDate(ws.getDate() + w); if (x.getTime() >= ev.s.t) { occ.push(x.getTime()); } });
        } else { occ.push(wk.getTime()); }
      }
      else if (freq === 'MONTHLY') { d.setMonth(base.getMonth() + k * iv); if (d.getDate() === base.getDate()) { occ.push(d.getTime()); } }
      else if (freq === 'YEARLY') { d.setFullYear(base.getFullYear() + k * iv); occ.push(d.getTime()); }
      else { push(ev.s.t); return; }
      for (var j = 0; j < occ.length; j++) {
        if ((until && occ[j] > until) || (count && n >= count)) { return; }
        n++;
        push(occ[j]);
      }
      if (occ.length && occ[occ.length - 1] >= to) { return; }
    }
  }

  Ext.refresh = function (c, cb) {
    cb = cb || U.noop;
    K.sb.fn('kagoj-ical', { url: c.url }, function (err, res) {
      if (err || !res || res.error) { cb(err || new Error((res && res.error) || 'Could not load that calendar.')); return; }
      var now = Date.now();
      var ev = Ext.parse(res.text || '', now - 400 * DAY, now + 400 * DAY);
      try { U.lsSet(Ext.cacheKey(c), { at: now, ev: ev }); } catch (e) { U.lsSet(Ext.cacheKey(c), { at: now, ev: ev.slice(0, 800) }); }
      Items.invalidate();
      cb(null, ev.length);
    });
  };
  Ext.refreshAll = function (force) {
    Ext.list().forEach(function (c) {
      if (force || Date.now() - Ext.events(c).at > 3 * 3600000) { Ext.refresh(c); }
    });
  };
  K.ExtCal = Ext;

  // ---------- items ----------

  var Items = {}, cache = null;
  Items.invalidate = function () { cache = null; if (K.Upcoming) { K.Upcoming.changed(); } };
  Docs.on('change', function () { cache = null; });

  Items.hidden = function () { return U.lsGet('kg.calHidden', []) || []; };
  Items.setHidden = function (list) { U.lsSet('kg.calHidden', list); Items.invalidate(); };

  var COLORS = ['blue', 'green', 'orange', 'purple', 'red', 'pink', 'brown', 'yellow'];
  function colorFor(id) { var h = 0; for (var i = 0; i < id.length; i++) { h = (h * 31 + id.charCodeAt(i)) | 0; } return COLORS[Math.abs(h) % COLORS.length]; }
  Items.colorFor = colorFor;

  function build() {
    var out = [];
    // database rows
    DB.datedItems().forEach(function (it) {
      var raw = DB.raw(it.db, it.doc, it.prop) || {};
      out.push({
        id: it.doc.id, src: 'db', title: Docs.titleOf(it.doc), doc: it.doc, db: it.db, prop: it.prop,
        s: it.start, e: raw.e ? DB.parseDay(raw.e) : it.start, all: !it.time, remind: raw.r, color: it.db.schema.calColor || colorFor(it.db.id),
        done: isDone(it.db, it.doc), cal: it.db.id
      });
    });
    // @date mentions in pages
    Docs.all().forEach(function (d) {
      if (!Docs.isLive(d) || d.kind === 'database' || !d.content) { return; }
      Docs.eachBlock(d.content, function (b) {
        if (!b.html || b.html.indexOf('data-date') < 0) { return; }
        var re = /data-date="([0-9T:\-]+)"( data-remind="1")?/g, m, k = 0;
        var text = Docs.plain(b.html.replace(/<span class="mdate[^>]*>[^<]*<\/span>/g, '')).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
        while ((m = re.exec(b.html))) {
          var t = parseLocal(m[1]);
          if (t === null) { continue; }
          out.push({
            id: d.id + ':' + b.id + ':' + (k++), src: 'page', title: text || Docs.titleOf(d), from: Docs.titleOf(d), doc: d,
            s: t, e: t, all: !/T/.test(m[1]), remind: m[2] ? 0 : undefined, color: 'gray', done: !!b.checked, cal: 'pages'
          });
        }
      });
    });
    // subscribed calendars
    Ext.list().forEach(function (c) {
      Ext.events(c).ev.forEach(function (e) {
        out.push({ id: 'x:' + c.id + ':' + e.uid, src: 'ext', title: e.title, loc: e.loc, s: e.s, e: e.all ? e.e - DAY : e.e, all: e.all, color: c.color || 'purple', cal: 'x:' + c.id, ext: c });
      });
    });
    return out;
  }
  function isDone(db, row) {
    var st = DB.firstOf(db, ['status']);
    if (st) { var o = DB.option(st, DB.raw(db, row, st)); if (o && o.g === 'done') { return true; } }
    var ck = DB.firstOf(db, ['check']);
    return !!(ck && DB.raw(db, row, ck));
  }

  // items overlapping [from, to), hidden calendars left out unless all=true
  Items.range = function (from, to, all) {
    if (!cache) { cache = build(); }
    var hidden = all ? [] : Items.hidden();
    return cache.filter(function (it) {
      var end = it.all ? day0(it.e) + DAY : Math.max(it.e, it.s + 1);
      return it.s < to && end > from && hidden.indexOf(it.cal) < 0;
    }).sort(function (a, b) { return day0(a.s) - day0(b.s) || (b.all ? 1 : 0) - (a.all ? 1 : 0) || a.s - b.s; });
  };

  // calendars that can be shown or hidden
  Items.calendars = function () {
    var list = Docs.all().filter(function (d) {
      return d.kind === 'database' && Docs.isLive(d) && d.schema && (d.schema.props || []).some(function (p) { return p.type === 'date'; });
    }).map(function (d) { return { id: d.id, name: Docs.titleOf(d), color: d.schema.calColor || colorFor(d.id), db: d }; });
    list.push({ id: 'pages', name: 'Dates in pages', color: 'gray' });
    Ext.list().forEach(function (c) { list.push({ id: 'x:' + c.id, name: c.name, color: c.color || 'purple', ext: c }); });
    return list;
  };

  // the database new events go into (made on first use)
  Items.targetDb = function () {
    var id = U.lsGet('kg.calDb', null), d = id ? Docs.get(id) : null;
    if (d && Docs.isLive(d) && DB.firstOf(d, ['date'])) { return d; }
    var cals = Items.calendars().filter(function (c) { return c.db; });
    var named = cals.filter(function (c) { return /calendar|event|schedule/i.test(c.name); })[0];
    if (named || cals[0]) { return (named || cals[0]).db; }
    var db = DB.create(null, 'Calendar', false);
    db.icon = '\uD83D\uDCC5';
    var v = DB.newView('calendar', 'Calendar');
    v.dateProp = DB.firstOf(db, ['date']).id;
    db.schema.views.unshift(v);
    DB.saveSchema(db);
    U.lsSet('kg.calDb', db.id);
    return db;
  };

  Items.create = function (title, startIso, endIso, db) {
    db = db || Items.targetDb();
    var dp = (db.schema.calProp && DB.prop(db, db.schema.calProp)) || DB.firstOf(db, ['date']);
    var init = { title: title || '' }, v = { s: startIso };
    if (endIso && endIso !== startIso) { v.e = endIso; }
    init[dp.id] = v;
    return DB.newRow(db, init);
  };

  // move an item to a new start (ms) keeping its length; time kept unless allDay changes
  Items.move = function (it, newStart, allDay) {
    if (it.src !== 'db') { return false; }
    var raw = DB.raw(it.db, it.doc, it.prop) || {};
    var len = (raw.e ? DB.parseDay(raw.e) : it.s) - it.s;
    function iso(t, timed) { var d = new Date(t); return K.isoDay(d) + (timed ? 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : ''); }
    var timed = allDay === undefined ? !it.all : !allDay;
    var v = U.copy(raw);
    v.s = iso(newStart, timed);
    if (raw.e) { v.e = iso(newStart + len, timed); } else { delete v.e; }
    DB.set(it.doc, it.prop.id, v);
    return true;
  };
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  K.CalItems = Items;

  // ---------- Home: upcoming ----------

  var listeners = [];
  K.Upcoming = {
    list: function (days) {
      var now = Date.now(), t0 = day0(now);
      return Items.range(t0, t0 + (days || 7) * DAY).filter(function (it) { return !it.done && (it.all ? day0(it.e) >= t0 : it.e >= now - 3600000); }).slice(0, 12).map(function (it) {
        var d = new Date(it.s);
        var label = K.dateLabel(K.isoDay(d) + (it.all ? '' : 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes())));
        return { label: label, title: it.title, doc: it.doc || null, item: it };
      });
    },
    onChange: function (fn) { listeners.push(fn); },
    changed: U.debounce(function () { listeners.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } }); }, 300)
  };

  // ---------- reminders (in-app; the phone gets them through the calendar feed) ----------

  var fired = U.lsGet('kg.remFired', {}) || {};
  function fireTime(it) {
    var base = it.all ? day0(it.s) + 9 * 3600000 : it.s;
    return base - (it.remind || 0) * 60000;
  }
  function check() {
    var now = Date.now();
    var due = Items.range(now - 2 * DAY, now + 9 * DAY, true).filter(function (it) {
      if (it.remind === undefined || it.remind === null || it.done) { return false; }
      var ft = fireTime(it);
      return ft <= now && now - ft < 20 * 60000 && !fired[it.id + '@' + ft];
    });
    due.forEach(function (it) {
      fired[it.id + '@' + fireTime(it)] = now;
      notify(it);
    });
    if (due.length) {
      // keep the list short
      Object.keys(fired).forEach(function (k) { if (now - fired[k] > 14 * DAY) { delete fired[k]; } });
      U.lsSet('kg.remFired', fired);
    }
  }
  function notify(it) {
    var when = it.all ? 'Today' : K.timeLabel(it.s);
    if (window.Notification && window.Notification.permission === 'granted' && document.hidden) {
      try {
        var n = new window.Notification('\u23F0 ' + it.title, { body: when + (it.from ? ' \u00b7 ' + it.from : ''), tag: it.id });
        n.onclick = function () { window.focus(); if (it.doc) { K.shell.openDoc(it.doc); } n.close(); };
      } catch (e) { /* ignore */ }
    }
    banner(it, when);
  }
  function banner(it, when) {
    var D = K.dom;
    var el = D.el('div.rem-banner', null, [
      D.el('div.rem-title', { text: '\u23F0 ' + it.title }),
      D.el('div.rem-sub', { text: when + (it.from ? ' \u00b7 ' + it.from : '') })
    ]);
    var open = D.el('button.small-btn', { type: 'button', text: 'Open' });
    var close = D.el('button.small-btn', { type: 'button', text: 'Dismiss' });
    D.tap(open, function () { D.remove(el); if (it.doc) { K.shell.openDoc(it.doc); } });
    D.tap(close, function () { D.remove(el); });
    el.appendChild(D.el('div.rem-actions', null, [close, open]));
    document.body.appendChild(el);
  }
  K.Reminders = {
    start: function () {
      if (K.Reminders.timer) { return; }
      check();
      K.Reminders.timer = setInterval(check, 30000);
    },
    check: check,
    askPermission: function (cb) {
      if (!window.Notification) { cb(false); return; }
      try { window.Notification.requestPermission(function (p) { cb(p === 'granted'); }); } catch (e) { cb(false); }
    }
  };

  // ---------- private calendar feed (.ics) for the phone's calendar app ----------

  function randomToken() {
    var bytes = new Uint8Array(24), c = window.crypto || window.msCrypto, s = '';
    if (c && c.getRandomValues) { c.getRandomValues(bytes); } else { for (var i = 0; i < bytes.length; i++) { bytes[i] = Math.floor(Math.random() * 256); } }
    for (var j = 0; j < bytes.length; j++) { s += (bytes[j] < 16 ? '0' : '') + bytes[j].toString(16); }
    return s;
  }
  K.CalFeed = {
    url: function () {
      var t = Settings.data.feed_token;
      return t ? K.config.supabaseUrl + '/functions/v1/kagoj-ics?t=' + t : null;
    },
    // make (or replace) the private link
    reset: function (cb) {
      Settings.load(function () {
        Settings.data.feed_token = randomToken();
        Settings.save(function (err) { cb(err, K.CalFeed.url()); });
      });
    }
  };

  // start reminders and calendar refresh once this bundle is in
  setTimeout(function () {
    K.Reminders.start();
    Settings.load(function () { Ext.refreshAll(false); });
  }, 1500);
})(window.Kagoj = window.Kagoj || {});
