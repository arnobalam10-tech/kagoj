(function (K) {
  'use strict';

  // Search window (Ctrl/Cmd+P): page titles and text, notebooks, uploaded files.
  var D = K.dom, sheets = K.sheets;

  function row(icon, title, sub, onTap) {
    var b = D.el('button.search-row', { type: 'button' }, [icon, D.el('span.sr-main', null, [
      D.el('span.sr-title', { text: title }), sub ? D.el('span.sr-sub', { text: sub }) : null
    ])]);
    D.tap(b, onTap);
    return b;
  }

  K.app.search = function () {
    var input = D.el('input.search-input', { type: 'search', placeholder: 'Search pages, notebooks and files', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
    var titleOnly = false;
    var tOnly = D.el('button.seg', { type: 'button', text: 'Titles only' });
    var list = D.el('div.search-list.scrolls');
    var m = sheets.modal({ body: D.el('div.search-box', null, [D.el('div.search-head', null, [input, tOnly]), list]), cls: 'sheet-search', actions: [] });
    var rows = [], sel = 0;

    function open(fn) { return function () { m.close(); setTimeout(fn, 10); }; }
    function render() {
      var q = input.value.replace(/^\s+|\s+$/g, '');
      D.empty(list);
      rows = [];
      if (!q) {
        list.appendChild(D.el('div.search-sec', { text: 'Recent' }));
        K.Docs.recent(8).forEach(function (d) {
          rows.push(row(K.docIconEl(d), K.Docs.titleOf(d), K.Docs.path(d.id).slice(0, -1).map(K.Docs.titleOf).join(' / '), open(function () { K.shell.openDoc(d); })));
        });
      } else {
        K.Docs.search(q, { titleOnly: titleOnly }).forEach(function (r) {
          rows.push(row(K.docIconEl(r.doc), K.Docs.titleOf(r.doc), r.snippet || K.Docs.path(r.doc.id).slice(0, -1).map(K.Docs.titleOf).join(' / '), open(function () { K.shell.openDoc(r.doc); })));
        });
        var ql = q.toLowerCase();
        K.Repo.notebooks().forEach(function (nb) {
          if (nb.title.toLowerCase().indexOf(ql) < 0) { return; }
          rows.push(row(D.el('span.doc-ico', null, D.icon('pen')), nb.title, 'Handwritten notebook', open(function () { K.router.go('#/nb/' + nb.id + '/1'); })));
        });
        K.Repo.documents().forEach(function (doc) {
          if (doc.title.toLowerCase().indexOf(ql) < 0) { return; }
          rows.push(row(D.el('span.doc-ico', null, D.icon('file')), doc.title, 'Uploaded file', open(function () { K.router.go('#/nb/' + doc.id + '/1'); })));
        });
        if (!rows.length) { list.appendChild(D.el('p.empty', { text: 'Nothing found for “' + q + '”.' })); }
      }
      rows.forEach(function (r) { list.appendChild(r); });
      sel = 0;
      mark();
    }
    function mark() { rows.forEach(function (r, i) { r.classList.toggle('sel', i === sel); }); }
    D.on(input, 'input', render);
    D.on(input, 'keydown', function (e) {
      if (e.keyCode === 40) { e.preventDefault(); sel = Math.min(rows.length - 1, sel + 1); mark(); if (rows[sel] && rows[sel].scrollIntoView) { rows[sel].scrollIntoView(false); } }
      else if (e.keyCode === 38) { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
      else if (e.keyCode === 13 && rows[sel]) { e.preventDefault(); rows[sel].click(); }
      else if (e.keyCode === 27) { m.close(); }
    });
    D.tap(tOnly, function () { titleOnly = !titleOnly; tOnly.classList.toggle('selected', titleOnly); render(); });
    render();
    input.focus();
  };
})(window.Kagoj = window.Kagoj || {});
