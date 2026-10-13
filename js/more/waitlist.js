(function (K) {
  'use strict';

  // Waitlist sign-ups from the landing page (/landing). Only the owner's
  // account can read the table (row-level security); everyone else sees an
  // empty list. Each row: email, why they want Kagoj, when, emailed yet.
  var D = K.dom, U = K.util, sheets = K.sheets;
  var V = K.BlockViews = K.BlockViews || {};
  var X = K.extraSlash = K.extraSlash || [];

  var WL = K.Waitlist = {
    rows: null, at: 0, loading: false, err: null, subs: [],
    load: function (force, cb) {
      if (!K.sb.isLoggedIn()) { WL.err = 'Log in to see the waitlist.'; if (cb) { cb(); } return; }
      if (WL.loading || (!force && WL.rows && Date.now() - WL.at < 120000)) { if (cb) { cb(); } return; }
      WL.loading = true;
      K.sb.rest('GET', 'waitlist?select=id,email,note,created_at,contacted&order=created_at.desc&limit=1000', {}, function (err, rows) {
        WL.loading = false;
        WL.err = err ? (err.message || 'Could not load the waitlist.') : null;
        if (!err) { WL.rows = rows || []; WL.at = Date.now(); }
        WL.subs.slice().forEach(function (f) { f(); });
        if (cb) { cb(); }
      });
    },
    fresh: function () { return (WL.rows || []).filter(function (r) { return !r.contacted; }).length; },
    setContacted: function (r, v, cb) {
      r.contacted = v;
      WL.subs.slice().forEach(function (f) { f(); });
      K.sb.rest('PATCH', 'waitlist?id=eq.' + r.id, { body: { contacted: v }, prefer: 'return=minimal' }, function (err) {
        if (err) { r.contacted = !v; sheets.toast('Could not save. Check the connection.'); WL.subs.slice().forEach(function (f) { f(); }); }
        if (cb) { cb(err); }
      });
    },
    on: function (f) { WL.subs.push(f); },
    off: function (f) { var i = WL.subs.indexOf(f); if (i >= 0) { WL.subs.splice(i, 1); } }
  };

  function when(iso) {
    var t = U.parseTime(iso), d = new Date(t);
    return K.dateLabel(K.isoDay(d)) + ', ' + K.timeLabel(t);
  }

  function copy(text, msg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { sheets.toast(msg || 'Copied'); }, function () { sheets.toast('Could not copy'); });
    } else { sheets.toast('Copy is not available here'); }
  }

  V.waitlist = function () {
    var host = D.el('div.wl-block');
    host.setAttribute('contenteditable', 'false');
    var filter = 'new';
    function draw() {
      D.empty(host);
      var rows = WL.rows || [];
      var fresh = WL.fresh();
      var refresh = D.button({ icon: 'refresh', label: WL.loading ? 'Loading…' : 'Refresh', cls: 'small-btn' });
      D.tap(refresh, function () { WL.load(true); draw(); });
      var tabs = D.el('div.wl-tabs', null, [['new', 'Not emailed (' + fresh + ')'], ['all', 'Everyone (' + rows.length + ')']].map(function (t) {
        var b = D.el('button.wl-tab' + (filter === t[0] ? '.on' : ''), { type: 'button', text: t[1] });
        D.tap(b, function () { filter = t[0]; draw(); });
        return b;
      }));
      var copyAll = D.button({ icon: 'mail', label: 'Copy emails', cls: 'small-btn', title: 'Copy the emails in this list, separated by commas' });
      D.tap(copyAll, function () {
        var list = shown().map(function (r) { return r.email; });
        if (!list.length) { sheets.toast('No emails here'); return; }
        copy(list.join(', '), list.length + (list.length === 1 ? ' email copied' : ' emails copied'));
      });
      host.appendChild(D.el('div.wl-head', null, [
        D.el('div.wl-count', null, [D.el('span.wl-num', { text: String(rows.length) }), D.el('span', { text: rows.length === 1 ? ' person on the waitlist' : ' people on the waitlist' })]),
        D.el('div.spacer'), copyAll, refresh
      ]));
      host.appendChild(tabs);
      if (WL.err && !WL.rows) { host.appendChild(D.el('p.empty', { text: WL.err })); return; }
      if (!WL.rows) { host.appendChild(D.el('p.empty', { text: 'Loading…' })); return; }
      var list = shown();
      if (!list.length) {
        host.appendChild(D.el('p.empty', { text: filter === 'new' ? (rows.length ? 'Everyone has been emailed. 🎉' : 'No one yet. Share /landing and they will show up here.') : 'No one yet.' }));
        return;
      }
      list.forEach(function (r, i) {
        var n = rows.length - rows.indexOf(r);
        var cb = D.el('input', { type: 'checkbox', title: 'Emailed' });
        cb.checked = !!r.contacted;
        cb.addEventListener('change', function () { WL.setContacted(r, cb.checked); });
        var mail = D.el('a.wl-email', { href: 'mailto:' + encodeURIComponent(r.email).replace(/%40/g, '@') + '?subject=' + encodeURIComponent('Your Kagoj login'), text: r.email });
        var cp = D.button({ icon: 'copy', title: 'Copy email', cls: 'wl-copy' });
        D.tap(cp, function () { copy(r.email, 'Email copied'); });
        host.appendChild(D.el('div.wl-row' + (r.contacted ? '.done' : ''), null, [
          D.el('div.wl-top', null, [
            D.el('span.wl-n', { text: '#' + n + (n <= 50 ? ' 🎁' : '') }),
            mail, cp,
            D.el('span.wl-when', { text: when(r.created_at) }),
            D.el('label.wl-sent', null, [cb, D.el('span', { text: 'Emailed' })])
          ]),
          r.note ? D.el('div.wl-note', { text: '“' + r.note + '”' }) : D.el('div.wl-note.none', { text: 'No reason given.' })
        ]));
      });
      host.appendChild(D.el('p.wl-foot', { text: '🎁 = one of the first 50 (handmade templates). Tick “Emailed” once you have sent their login.' }));
    }
    function shown() { return (WL.rows || []).filter(function (r) { return filter === 'all' || !r.contacted; }); }
    function sub() {
      if (host.parentNode && !document.body.contains(host)) { WL.off(sub); return; }
      draw();
    }
    WL.on(sub);
    draw();
    WL.load(false);
    return host;
  };

  X.push({ label: 'Waitlist sign-ups', icon: 'mail', desc: 'Who joined the waitlist on /landing (owner only)', keys: 'waitlist signups landing emails', group: 'Advanced',
    run: function (ed, id) {
      var cur = ed.block(id);
      var b = K.Docs.newBlock('waitlist', {});
      b.d = cur ? cur.d || 0 : 0;
      ed.insertAfter(id, b, false);
      ed.page.flush();
    } });
})(window.Kagoj = window.Kagoj || {});
