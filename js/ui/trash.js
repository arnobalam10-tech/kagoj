(function (K) {
  'use strict';

  // Trash: deleted pages (kept 30 days). Notebooks and uploads have their own
  // list under Settings -> Recently deleted.
  var D = K.dom, U = K.util, Docs = K.Docs, sheets = K.sheets;
  var screen = {};
  var st = null;

  function hardDelete(d) {
    var ids = [];
    (function collect(id) { ids.push(id); Docs.all().forEach(function (c) { if (c.parent_id === id) { collect(c.id); } }); })(d.id);
    ids.forEach(function (id) { Docs.forget(id); });
    if (K.sb.isLoggedIn()) { K.sb.rest('DELETE', 'docs?id=eq.' + d.id, { prefer: 'return=minimal' }, function () {}); }
  }

  function render() {
    if (!st) { return; }
    var body = D.empty(st.body), list = Docs.trash();
    body.appendChild(D.el('p.trash-note', { text: 'Deleted pages stay here for 30 days, then they are removed for good. Handwritten notebooks and uploads are under Settings → Recently deleted.' }));
    if (!list.length) { body.appendChild(D.el('p.empty', { text: 'Trash is empty.' })); return; }
    var card = D.el('div.set-card');
    list.forEach(function (d) {
      var restore = D.el('button.small-btn', { type: 'button', text: 'Restore' });
      D.tap(restore, function () {
        Docs.restore(d.id);
        if (d.kind === 'canvas' && d.settings && d.settings.notebook) { K.Repo.restoreNotebook(d.settings.notebook); }
        sheets.toast('Restored “' + Docs.titleOf(d) + '”');
        render();
      });
      var del = D.el('button.small-btn.danger', { type: 'button', text: 'Delete forever' });
      D.tap(del, function () {
        sheets.confirm({ title: 'Delete “' + Docs.titleOf(d) + '” forever?', message: 'This cannot be undone.', ok: 'Delete', danger: true }, function (ok) {
          if (ok) { hardDelete(d); render(); }
        });
      });
      var path = Docs.path(d.id).slice(0, -1).map(Docs.titleOf).join(' / ');
      card.appendChild(D.el('div.set-row', null, [
        K.docIconEl(d),
        D.el('div.set-label', null, [D.el('div', { text: Docs.titleOf(d) }), D.el('div.set-sub', { text: (path ? 'In ' + path + ' · ' : '') + 'deleted ' + U.relTime(d.deleted_at) })]),
        restore, del
      ]));
    });
    body.appendChild(card);
  }

  screen.mount = function (root) {
    var top = D.el('header.topbar.doc-top', null, [K.shell.menuButton(), D.el('div.top-title', { text: 'Trash' }), D.el('div.spacer')]);
    var body = D.el('div.set-body');
    D.append(root, [top, D.el('div.doc-scroll.scrolls', null, body)]);
    st = { body: body, onChange: U.debounce(render, 200) };
    Docs.on('change', st.onChange);
    render();
  };
  screen.unmount = function () {
    if (!st) { return; }
    Docs.off('change', st.onChange);
    st.onChange.cancel();
    st = null;
  };

  K.screens = K.screens || {};
  K.screens.trash = screen;
})(window.Kagoj = window.Kagoj || {});
