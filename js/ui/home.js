(function (K) {
  'use strict';

  // Home: a greeting, what's next, after-class attendance, a quick task,
  // then every main page as a tile. The middle cards come from the `plan`
  // bundle (K.HomeCards) and appear as soon as it has loaded.
  var D = K.dom, U = K.util;
  var screen = {};
  var st = null;

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function firstName() {
    var e = (K.sb && K.sb.email && K.sb.email()) || '';
    var n = e.split('@')[0].replace(/[^A-Za-z]/g, '');
    return n ? n.charAt(0).toUpperCase() + n.substr(1).toLowerCase() : 'friend';
  }

  // A different, slightly silly greeting every visit, by time and day
  function greeting() {
    var d = new Date(), h = d.getHours(), day = d.getDay(), n = firstName();
    var byTime =
      h < 4 ? ['Still up, ' + n + '? The owls are impressed. 🦉', 'It’s ' + h + ' AM. Bold of you, ' + n + '.', 'Night shift, ' + n + '? Sleep is also a hobby, you know. 🌙', 'The moon says hi, ' + n + '. 🌚']
        : h < 7 ? ['Early bird mode, ' + n + '! 🐦', 'Up before the sun, ' + n + '? Respect. 🌅', 'Fajr gang, ' + n + '. The day is all yours. ✨']
          : h < 12 ? ['Morning, ' + n + '! Coffee first, chaos later. ☕', 'Rise and grind, ' + n + '. Mostly grind. 💪', 'Good morning, ' + n + '! The day is a blank page. 📄', 'Hey ' + n + '! Brain booting… 99%. 🧠', 'Morning, ' + n + '. Let’s make today slightly legendary. 🌞']
            : h < 14 ? ['Lunch o’clock, ' + n + '. Fuel up. 🍛', 'Midday check-in, ' + n + '! Halfway there. ⏳', 'Hey ' + n + ', the sun is peak sun right now. ☀️']
              : h < 17 ? ['Good afternoon, ' + n + '! Power through. ⚡', 'Afternoon slump? Not today, ' + n + '. 🚀', 'Hey ' + n + ', cha break soon? 🍵', 'Afternoon, ' + n + '. Stay sharp, stay snacky. 🍪']
                : h < 21 ? ['Evening, ' + n + '! You survived the day. 🌆', 'Good evening, ' + n + '. Time to wind down (or cram). 📚', 'Hey ' + n + ', golden hour vibes. 🌇', 'Evening, ' + n + '! What did today teach you? 🤔']
                  : ['Good night, ' + n + '. Tomorrow-you says thanks for planning. 🌛', 'Late evening, ' + n + '. Wrap it up, champ. 🛌', 'Hey ' + n + ', the stars are out and so are you. ⭐'];
    var byDay = {
      4: ['Class day, ' + n + '! Backpack packed? 🎓', 'Thursday, ' + n + ': almost the weekend. Almost. 😅'],
      5: ['Jummah Mubarak, ' + n + '! Rest mode: on. 🕌', 'It’s Friday, ' + n + '. Do nothing. Professionally. 🛋️'],
      6: ['Saturday classes, ' + n + '. Weekend? Never heard of it. 😂', 'Saturday, ' + n + '! Class day again. 📚'],
      0: ['Sunday, ' + n + '. A fresh week, a fresh you. 🌱'],
      1: ['Monday, ' + n + '. We move. 💪']
    };
    var pool = byTime.concat(byDay[day] && h >= 6 && h < 21 ? byDay[day] : []);
    return pick(pool);
  }

  function dateLine() {
    var d = new Date();
    var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MON[d.getMonth()];
  }

  K.docIconEl = function (d, cls) {
    if (d && d.icon) { return D.el('span.doc-ico.emoji' + (cls ? '.' + cls : ''), { text: d.icon }); }
    return D.el('span.doc-ico' + (cls ? '.' + cls : ''), null, D.icon(d && d.kind === 'database' ? 'table' : (d && d.kind === 'canvas' ? 'pen' : 'file')));
  };

  var GRADS = [
    'linear-gradient(135deg,#F6D365,#FDA085)', 'linear-gradient(135deg,#A1C4FD,#C2E9FB)', 'linear-gradient(135deg,#D4FC79,#96E6A1)',
    'linear-gradient(135deg,#FBC2EB,#A6C1EE)', 'linear-gradient(135deg,#E0C3FC,#8EC5FC)', 'linear-gradient(135deg,#FFECD2,#FCB69F)',
    '#2F3640', '#1F3A5F', '#2E5E3E', '#7A2E3A', '#C9A227', '#1F7A7A'
  ];
  function paintCover(el, d) {
    var c = d.cover || '';
    if (c.indexOf('g:') === 0) { el.style.background = GRADS[(+c.substr(2)) % GRADS.length]; return; }
    if (c.indexOf('a:') === 0 && K.Assets) {
      K.Assets.get(c.substr(2), function (err, img) { if (!err) { el.style.backgroundImage = 'url("' + img.src + '")'; } });
      return;
    }
    // no cover: a soft colour from the title
    var h = 0, t = K.Docs.titleOf(d);
    for (var i = 0; i < t.length; i++) { h = (h * 31 + t.charCodeAt(i)) | 0; }
    el.style.background = GRADS[Math.abs(h) % 6];
    el.className += ' plain';
  }

  function tile(d) {
    var n = K.Docs.treeChildren(d.id).length;
    var cover = D.el('div.ht-cover');
    paintCover(cover, d);
    var t = D.el('button.home-tile', { type: 'button' }, [
      cover,
      D.el('div.ht-body', null, [
        D.el('span.ht-ico', null, K.docIconEl(d)),
        D.el('span.ht-title', { text: K.Docs.titleOf(d) }),
        D.el('span.ht-sub', { text: d.kind === 'database' ? 'Database' : (d.kind === 'canvas' ? 'Handwritten' : (n ? n + (n === 1 ? ' page inside' : ' pages inside') : 'Edited ' + U.relTime(d.updated_at))) })
      ])
    ]);
    D.tap(t, function () { K.shell.openDoc(d); });
    return t;
  }

  function render() {
    if (!st) { return; }
    // don't wipe a half-typed task or an attendance being marked
    if (K.HomeCards && K.HomeCards.busy() && st.body.firstChild) { return; }
    var body = D.empty(st.body);
    if (!st.hello) { st.hello = greeting(); }
    body.appendChild(D.el('div.home-date', { text: dateLine() }));
    body.appendChild(D.el('h1.home-hello', { text: st.hello }));

    if (K.HomeCards) { K.HomeCards.render(body); }
    else { body.appendChild(D.el('div.hc-loading', { text: 'Checking your schedule…' })); }

    var secs = K.Docs.sections ? K.Docs.sections() : [];
    secs.forEach(function (sec) {
      var pages = K.Docs.treeChildren(sec.id).filter(K.Docs.isLive);
      if (!pages.length) { return; }
      body.appendChild(D.el('h2.section-title', { text: (sec.icon ? sec.icon + '  ' : '') + K.Docs.titleOf(sec) }));
      var grid = D.el('div.home-tiles');
      pages.forEach(function (d) { grid.appendChild(tile(d)); });
      body.appendChild(grid);
    });
    if (!secs.length || !K.Docs.all().length) {
      body.appendChild(D.el('div.home-empty', null, [
        D.el('p', { text: 'This is your workspace. Make a page for anything: notes, a course, a project, a journal.' }),
        D.el('p', { text: 'Type / on a page to add headings, lists, to-dos, tables, databases and more.' })
      ]));
    }
  }

  screen.mount = function (root) {
    var top = D.el('header.topbar.doc-top', null, [K.shell.menuButton(), D.el('div.top-title', { text: 'Home' }), D.el('div.spacer')]);
    var body = D.el('div.home-body');
    D.append(root, [top, D.el('div.doc-scroll.scrolls', null, body)]);
    st = { body: body, onChange: U.debounce(render, 250) };
    K.Docs.on('change', st.onChange);
    K.app.on('bundle', st.onChange);
    // "next up" changes with the clock
    st.timer = setInterval(function () { if (st) { render(); } }, 60000);
    render();
    // the schedule cards need the database code
    K.app.needAll(['editor', 'db', 'plan']);
  };
  screen.unmount = function () {
    if (!st) { return; }
    K.Docs.off('change', st.onChange);
    K.app.off('bundle', st.onChange);
    st.onChange.cancel();
    clearInterval(st.timer);
    st = null;
  };

  K.screens = K.screens || {};
  K.screens.home = screen;
})(window.Kagoj = window.Kagoj || {});
