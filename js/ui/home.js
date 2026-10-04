(function (K) {
  'use strict';

  // Home: recent pages, quick actions, open to-dos, upcoming dates, notebooks.
  var D = K.dom, U = K.util;
  var screen = {};
  var st = null;

  function greeting() {
    var h = new Date().getHours();
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  K.docIconEl = function (d, cls) {
    if (d && d.icon) { return D.el('span.doc-ico.emoji' + (cls ? '.' + cls : ''), { text: d.icon }); }
    return D.el('span.doc-ico' + (cls ? '.' + cls : ''), null, D.icon(d && d.kind === 'database' ? 'table' : (d && d.kind === 'canvas' ? 'pen' : 'file')));
  };

  // Unchecked to-do blocks across all pages
  function openTodos(limit) {
    var out = [];
    K.Docs.all().forEach(function (d) {
      if (!K.Docs.isLive(d) || d.kind === 'canvas') { return; }
      K.Docs.eachBlock(d.content, function (b) {
        if (b.type === 'todo' && !b.checked && K.Docs.plain(b.html).replace(/\s+/g, '')) { out.push({ doc: d, block: b }); }
      });
    });
    out.sort(function (a, b) { return a.doc.updated_at < b.doc.updated_at ? 1 : -1; });
    return out.slice(0, limit);
  }

  function card(d) {
    var path = K.Docs.path(d.id).slice(0, -1).map(K.Docs.titleOf).join(' / ');
    var c = D.el('button.home-card', { type: 'button' }, [
      K.docIconEl(d, 'big'),
      D.el('span.hc-title', { text: K.Docs.titleOf(d) }),
      D.el('span.hc-sub', { text: path || U.relTime(d.updated_at) })
    ]);
    D.tap(c, function () { K.shell.openDoc(d); });
    return c;
  }

  function action(icon, label, fn) {
    var b = D.el('button.home-action', { type: 'button' }, [D.icon(icon), D.el('span', { text: label })]);
    D.tap(b, fn);
    return b;
  }

  function render() {
    if (!st) { return; }
    var body = D.empty(st.body);
    body.appendChild(D.el('h1.home-hello', { text: greeting() }));

    body.appendChild(D.el('div.home-actions', null, [
      action('page-add', 'New page', function () { K.shell.newPage(null); }),
      action('table', 'New database', function () { K.shell.newPage(null, 'database'); }),
      action('pen', 'Handwritten page', function () { K.shell.newCanvas(null); }),
      action('search', 'Search', function () { K.app.search(); }),
      action('upload', 'Uploads', function () { K.router.go('#/uploads'); })
    ]));

    var recent = K.Docs.recent(8);
    if (recent.length) {
      body.appendChild(D.el('h2.section-title', { text: 'Recently visited' }));
      var row = D.el('div.home-cards');
      recent.forEach(function (d) { row.appendChild(card(d)); });
      body.appendChild(row);
    }

    if (K.Upcoming) {
      var up = K.Upcoming.list(7);
      if (up.length) {
        body.appendChild(D.el('h2.section-title', { text: 'Upcoming' }));
        var ul = D.el('div.home-list');
        up.forEach(function (it) {
          var r = D.el('button.home-li', { type: 'button' }, [D.el('span.home-date', { text: it.label }), D.el('span', { text: it.title })]);
          D.tap(r, function () { K.shell.openDoc(it.doc); });
          ul.appendChild(r);
        });
        body.appendChild(ul);
      }
    }

    var todos = openTodos(12);
    if (todos.length) {
      body.appendChild(D.el('h2.section-title', { text: 'To-dos' }));
      var tl = D.el('div.home-list');
      todos.forEach(function (t) {
        var box = D.el('button.home-check', { type: 'button', 'aria-label': 'Done' });
        D.tap(box, function () {
          t.block.checked = true;
          K.Docs.save(t.doc);
          render();
        });
        var txt = D.el('button.home-li', { type: 'button' }, [
          D.el('span', { text: K.Docs.plain(t.block.html) }),
          D.el('span.home-from', { text: K.Docs.titleOf(t.doc) })
        ]);
        D.tap(txt, function () { K.shell.openDoc(t.doc); });
        tl.appendChild(D.el('div.home-todo', null, [box, txt]));
      });
      body.appendChild(tl);
    }

    var nbs = K.Repo.notebooks().filter(function (n) { return n.last_opened_at; })
      .sort(function (a, b) { return U.parseTime(b.last_opened_at) - U.parseTime(a.last_opened_at); }).slice(0, 4);
    if (nbs.length) {
      body.appendChild(D.el('h2.section-title', { text: 'Handwritten notebooks' }));
      var nl = D.el('div.home-cards');
      nbs.forEach(function (nb) {
        var c = D.el('button.home-card', { type: 'button' }, [
          D.el('span.doc-ico.big.nb-swatch'), D.el('span.hc-title', { text: nb.title }), D.el('span.hc-sub', { text: nb.page_count + ' pages' })
        ]);
        c.firstChild.style.backgroundColor = nb.cover_color;
        D.tap(c, function () { K.router.go('#/nb/' + nb.id + '/' + K.Repo.meta('lastPage.' + nb.id, 1)); });
        nl.appendChild(c);
      });
      body.appendChild(nl);
    }

    if (!recent.length && !todos.length && !K.Docs.treeChildren(null).length) {
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
    render();
  };
  screen.unmount = function () {
    if (!st) { return; }
    K.Docs.off('change', st.onChange);
    st.onChange.cancel();
    st = null;
  };

  K.screens = K.screens || {};
  K.screens.home = screen;
})(window.Kagoj = window.Kagoj || {});
