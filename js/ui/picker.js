(function (K) {
  'use strict';

  // Page picker for Uploads: folder -> document -> tick pages.
  // K.pickPages({ docId?, actions: [{label, primary}] }, cb(actionIndex, items))
  // items: [{ a: storage path, ratio: h / w }]
  var D = K.dom, Repo = K.Repo, sheets = K.sheets;

  // Load thumbnails a few at a time (the iPad 2 dislikes many parallel requests).
  function ThumbQueue() { this.q = []; this.active = 0; this.dead = false; }
  ThumbQueue.prototype.add = function (path, cb) { this.q.push([path, cb]); this.pump(); };
  ThumbQueue.prototype.pump = function () {
    var self = this;
    while (!this.dead && this.active < 3 && this.q.length) {
      var job = this.q.shift();
      this.active++;
      (function (j) {
        K.Assets.get(j[0], function (err, img) {
          self.active--;
          if (!self.dead) { j[1](err, img); self.pump(); }
        });
      })(job);
    }
  };

  K.ThumbQueue = ThumbQueue;

  // Sets an element's background to an image (object-fit is not in Safari 9)
  K.setBgImage = function (el, img) {
    el.style.backgroundImage = 'url("' + img.src + '")';
    el.classList.add('has-img');
  };

  function docPages(docId) {
    return Repo.pagesOf(docId).filter(function (p) { return !!p.background_asset; });
  }

  function folderDocsCount(fid) { return Repo.documents(fid).length; }

  K.unfiledDocs = function () {
    return Repo.documents().filter(function (d) {
      var f = d.folder_id && Repo.folder(d.folder_id);
      return !f || f.deleted_at;
    });
  };

  K.pickPages = function (opts, done) {
    var queue = new ThumbQueue();
    var body = D.el('div.picker');
    var m = sheets.modal({
      title: 'Choose from Uploads', body: body, cls: 'sheet-picker',
      actions: [{ label: 'Cancel' }],
      onClose: function () { queue.dead = true; }
    });
    var titleEl = m.panel.querySelector('.sheet-title');
    function setTitle(t) { if (titleEl) { titleEl.textContent = t; } }

    function row(label, sub, onTap, icon) {
      var b = D.el('button.pick-row', { type: 'button' }, [
        icon ? D.icon(icon) : null,
        D.el('span.pick-label', null, [D.el('span', { text: label }), sub ? D.el('span.pick-sub', { text: sub }) : null]),
        D.icon('chevron-right', 'small')
      ]);
      D.tap(b, onTap);
      return b;
    }

    function showFolders() {
      setTitle('Choose from Uploads');
      D.empty(body);
      var folders = Repo.folders();
      folders.forEach(function (f) {
        var n = folderDocsCount(f.id);
        body.appendChild(row(f.name, n + (n === 1 ? ' file' : ' files'), function () { showDocs(f.id, f.name); }, 'folder'));
      });
      var unfiled = K.unfiledDocs();
      if (unfiled.length) {
        body.appendChild(row('Unfiled', unfiled.length + ' files', function () { showDocs(null, 'Unfiled'); }, 'folder'));
      }
      if (!folders.length && !unfiled.length) {
        body.appendChild(D.el('p.empty', { text: 'Nothing uploaded yet. Open the Uploads tab to add PDFs or photos.' }));
      }
    }

    function showDocs(fid, name) {
      setTitle(name);
      D.empty(body);
      body.appendChild(row('‹ All folders', null, showFolders));
      var docs = fid ? Repo.documents(fid) : K.unfiledDocs();
      docs.forEach(function (d) {
        body.appendChild(row(d.title, d.page_count + (d.page_count === 1 ? ' page' : ' pages'), function () { showPages(d, function () { showDocs(fid, name); }); }, 'file'));
      });
      if (!docs.length) { body.appendChild(D.el('p.empty', { text: 'This folder is empty.' })); }
    }

    function showPages(doc, back) {
      setTitle(doc.title);
      D.empty(body);
      if (back) { body.appendChild(row('‹ Back', null, back)); }
      var pages = docPages(doc.id);
      var picked = {}, ratios = {};
      var bar = D.el('div.pick-bar');
      var count = D.el('span.pick-count');
      var allBtn = D.button({ label: 'Select all', cls: 'small-btn' });
      D.append(bar, [count, D.el('div.spacer'), allBtn]);
      var grid = D.el('div.pick-grid');
      var acts = D.el('div.pick-actions');
      D.append(body, [bar, grid, acts]);

      function selected() {
        return pages.filter(function (p) { return picked[p.id]; }).map(function (p) {
          return { a: p.background_asset, ratio: ratios[p.id] || 1.414 };
        });
      }
      function refresh() {
        var n = selected().length;
        count.textContent = n ? n + ' selected' : 'Tap pages to select';
        allBtn.querySelector('.btn-label').textContent = n === pages.length ? 'Select none' : 'Select all';
        var btns = acts.querySelectorAll('.btn');
        for (var i = 0; i < btns.length; i++) { btns[i].classList.toggle('disabled', !n); }
      }
      pages.forEach(function (p, i) {
        var cell = D.el('button.pick-cell', { type: 'button' }, [
          D.el('div.pick-thumb'), D.el('span.pick-num', { text: String(i + 1) }), D.el('span.pick-check', null, D.icon('check'))
        ]);
        var th = cell.firstChild;
        queue.add(K.Assets.thumbOf(p.background_asset), function (err, img) {
          if (err) { th.classList.add('err'); return; }
          ratios[p.id] = (img.naturalHeight || img.height) / (img.naturalWidth || img.width);
          K.setBgImage(th, img);
        });
        D.tap(cell, function () {
          picked[p.id] = !picked[p.id];
          cell.classList.toggle('picked', !!picked[p.id]);
          refresh();
        });
        grid.appendChild(cell);
      });
      D.tap(allBtn, function () {
        var all = selected().length !== pages.length;
        var cells = grid.querySelectorAll('.pick-cell');
        pages.forEach(function (p, i) { picked[p.id] = all; cells[i].classList.toggle('picked', all); });
        refresh();
      });
      opts.actions.forEach(function (a, idx) {
        var b = D.button({ label: a.label, cls: 'sheet-btn' + (a.primary ? ' primary' : '') });
        D.tap(b, function () {
          var items = selected();
          if (!items.length) { return; }
          m.close();
          done(idx, items, doc);
        });
        acts.appendChild(b);
      });
      if (pages.length === 1) { picked[pages[0].id] = true; grid.firstChild.classList.add('picked'); }
      refresh();
    }

    if (opts.docId) {
      var doc = Repo.notebook(opts.docId);
      if (doc) { showPages(doc, null); return m; }
    }
    showFolders();
    return m;
  };
})(window.Kagoj = window.Kagoj || {});
