(function (K) {
  'use strict';

  // Uploads: folders of course material (documents). Documents open in the
  // same workspace as notebooks but never appear in the Notebooks tab.
  var D = K.dom, U = K.util, Repo = K.Repo, sheets = K.sheets;

  // ---------- shared helpers ----------

  function fileCount(n) { return n + (n === 1 ? ' file' : ' files'); }

  function newFolder(cb) {
    sheets.prompt({ title: 'New folder', value: '', ok: 'Create' }, function (v) {
      if (v === null) { return; }
      v = v.replace(/^\s+|\s+$/g, '');
      if (!v) { return; }
      var f = Repo.createFolder(v);
      if (cb) { cb(f); }
    });
  }

  function renameFolder(f) {
    sheets.prompt({ title: 'Rename folder', value: f.name }, function (v) {
      if (v === null) { return; }
      v = v.replace(/^\s+|\s+$/g, '');
      if (v) { Repo.updateFolder(f.id, { name: v }); }
    });
  }

  function deleteFolder(f, after) {
    var n = Repo.documents(f.id).length;
    sheets.confirm({
      title: 'Delete folder “' + f.name + '”?',
      message: (n ? 'Its ' + fileCount(n) + ' will be deleted too. ' : '') + 'You can restore it from Settings → Recently deleted for 30 days.',
      ok: 'Delete', danger: true
    }, function (ok) {
      if (!ok) { return; }
      Repo.deleteFolder(f.id);
      sheets.toast('Folder deleted');
      if (after) { after(); }
    });
  }

  function folderActions(f, after) {
    sheets.actionSheet({
      title: f.name,
      items: [
        { label: 'Rename', icon: 'edit', onTap: function () { renameFolder(f); } },
        { label: 'Delete', icon: 'trash', danger: true, onTap: function () { deleteFolder(f, after); } }
      ]
    });
  }

  // Thumbnail of a document's first page as its cover
  function docCover(doc, queue) {
    var el = D.el('div.cover.doc-cover');
    var first = Repo.pagesOf(doc.id)[0];
    var label = D.el('div.doc-cover-label', { text: doc.title });
    el.appendChild(label);
    if (first && first.background_asset) {
      queue.add(K.Assets.thumbOf(first.background_asset), function (err, img) {
        if (err) { return; }
        K.setBgImage(el, img);
        label.style.display = 'none';
      });
    }
    return el;
  }

  function openDoc(doc) {
    var last = Repo.meta('lastPage.' + doc.id, 1);
    K.router.go('#/nb/' + doc.id + '/' + last);
  }

  function chooseFolder(title, exceptId, cb) {
    var items = Repo.folders().filter(function (f) { return f.id !== exceptId; }).map(function (f) {
      return { label: f.name, icon: 'folder', onTap: function () { cb(f.id); } };
    });
    items.push({ label: 'New folder…', icon: 'plus', onTap: function () { newFolder(function (f) { cb(f.id); }); } });
    sheets.actionSheet({ title: title, items: items });
  }

  // Document -> pages appended to a notebook
  function addToNotebook(doc) {
    var nbs = Repo.notebooks().sort(function (a, b) { return U.parseTime(b.updated_at) - U.parseTime(a.updated_at); });
    function pickPagesFor(nbId) {
      K.pickPages({ docId: doc.id, actions: [{ label: 'Add to notebook', primary: true }] }, function (idx, items) {
        var nb = Repo.notebook(nbId);
        var list = Repo.pagesOf(nbId);
        var after = list.length ? list[list.length - 1].id : null;
        items.forEach(function (it) {
          var p = Repo.addPage(nbId, after, 'blank', { background_asset: it.a, w: 1000, h: Math.round(1000 * it.ratio) });
          after = p.id;
        });
        Repo.recount(nbId);
        sheets.toast(items.length + (items.length === 1 ? ' page' : ' pages') + ' added to “' + nb.title + '”');
      });
    }
    var items = nbs.map(function (nb) {
      return { label: nb.title, icon: 'paper', onTap: function () { pickPagesFor(nb.id); } };
    });
    items.unshift({ label: 'New notebook…', icon: 'plus', onTap: function () {
      var res = Repo.createNotebook({ title: doc.title + ' notes', cover_color: '#1F3A5F', default_paper: 'ruled', noPage: true });
      pickPagesFor(res.notebook.id);
    } });
    sheets.actionSheet({ title: 'Add pages of “' + doc.title + '” to…', items: items });
  }
  K.addDocToNotebook = addToNotebook;

  function docActions(doc) {
    sheets.actionSheet({
      title: doc.title,
      items: [
        { label: 'Open', icon: 'file', onTap: function () { openDoc(doc); } },
        { label: 'Add pages to a notebook…', icon: 'paper', onTap: function () { addToNotebook(doc); } },
        { label: 'Rename', icon: 'edit', onTap: function () {
          sheets.prompt({ title: 'Rename', value: doc.title }, function (v) {
            if (v === null) { return; }
            v = v.replace(/^\s+|\s+$/g, '');
            if (v) { Repo.updateNotebook(doc.id, { title: v }); }
          });
        } },
        { label: 'Move to folder…', icon: 'folder', onTap: function () {
          chooseFolder('Move “' + doc.title + '” to', doc.folder_id, function (fid) {
            Repo.updateNotebook(doc.id, { folder_id: fid });
            sheets.toast('Moved');
          });
        } },
        { label: 'Delete', icon: 'trash', danger: true, onTap: function () {
          sheets.confirm({
            title: 'Delete “' + doc.title + '”?',
            message: 'Your writing on it is deleted too. You can restore it from Settings → Recently deleted for 30 days.',
            ok: 'Delete', danger: true
          }, function (ok) { if (ok) { Repo.deleteNotebook(doc.id); sheets.toast('Deleted'); } });
        } }
      ]
    });
  }

  function longPress(el, fn) {
    var t = null, fired = false, sx = 0, sy = 0;
    D.on(el, 'touchstart', function (e) {
      fired = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      t = setTimeout(function () { fired = true; t = null; fn(); }, 600);
    }, { passive: true });
    D.on(el, 'touchmove', function (e) {
      if (t && (Math.abs(e.touches[0].clientX - sx) > 10 || Math.abs(e.touches[0].clientY - sy) > 10)) { clearTimeout(t); t = null; }
    }, { passive: true });
    D.on(el, 'touchend', function (e) { if (t) { clearTimeout(t); t = null; } if (fired && e.cancelable) { e.preventDefault(); } }, D.passiveFalse);
    D.on(el, 'contextmenu', function (e) { e.preventDefault(); fn(); });
    return function () { return fired; };
  }

  function topBar(active) {
    var pill = K.statusPill();
    var settingsBtn = D.button({ icon: 'settings', title: 'Settings' });
    D.tap(settingsBtn, function () { K.router.go('#/settings'); });
    var top = D.el('header.topbar', null, [
      D.el('div.wordmark', null, [D.el('span.wm-en', { text: 'Kagoj' }), D.el('span.wm-bn', { text: 'কাগজ' })]),
      K.mainTabs(active), D.el('div.spacer'), pill, settingsBtn
    ]);
    return { el: top, pill: pill };
  }

  // ---------- #/uploads : folders ----------

  var up = {};
  var ust = null;

  function renderFolders() {
    if (!ust) { return; }
    var body = D.empty(ust.body);
    body.appendChild(D.el('h2.section-title', { text: 'Folders' }));
    var grid = D.el('div.grid');
    var add = D.el('div.card.card-new', null, D.el('div.card-tap', null, D.el('div.folder-tile.folder-new', null, [D.icon('plus'), D.el('div', { text: 'New folder' })])));
    D.tap(add, function () { newFolder(function (f) { K.router.go('#/up/' + f.id); }); });
    grid.appendChild(add);
    var folders = Repo.folders();
    var unfiled = K.unfiledDocs();
    function folderCard(name, count, onOpen, onMore) {
      var el = D.el('div.card');
      var tap = D.el('div.card-tap', null, [
        D.el('div.folder-tile', null, [D.icon('folder', 'folder-icon')]),
        D.el('div.card-meta', null, [D.el('div.card-title', { text: name }), D.el('div.card-sub', { text: fileCount(count) })])
      ]);
      el.appendChild(tap);
      var wasLong = onMore ? longPress(tap, onMore) : function () { return false; };
      D.tap(tap, function () { if (!wasLong()) { onOpen(); } });
      if (onMore) {
        var more = D.button({ icon: 'more', title: 'Folder actions', cls: 'card-more' });
        D.tap(more, onMore);
        el.appendChild(more);
      }
      return el;
    }
    folders.forEach(function (f) {
      grid.appendChild(folderCard(f.name, Repo.documents(f.id).length,
        function () { K.router.go('#/up/' + f.id); }, function () { folderActions(f); }));
    });
    if (unfiled.length) {
      grid.appendChild(folderCard('Unfiled', unfiled.length, function () { K.router.go('#/up/unfiled'); }, null));
    }
    body.appendChild(grid);
    if (!folders.length && !unfiled.length) {
      body.appendChild(D.el('p.empty', { text: 'Make a folder for each course, then upload its PDFs into it.' }));
    }
  }

  up.mount = function (root) {
    var tb = topBar('uploads');
    var body = D.el('div.dash-body');
    D.append(root, [tb.el, D.el('div.dash-scroll.scrolls', null, body)]);
    ust = { body: body, pill: tb.pill, onChange: U.debounce(renderFolders, 150) };
    Repo.on('change', ust.onChange);
    renderFolders();
  };
  up.unmount = function () {
    if (!ust) { return; }
    Repo.off('change', ust.onChange);
    ust.onChange.cancel();
    ust.pill.destroy();
    ust = null;
  };

  // ---------- #/up/<folderId> : documents in a folder ----------

  var fd = {};
  var fst = null;

  function jobRow(file) {
    var bar = D.el('div.job-bar-fill');
    var status = D.el('div.job-status', { text: 'Waiting…' });
    var el = D.el('div.job', null, [
      D.el('div.job-name', { text: file.name }), status, D.el('div.job-bar', null, bar)
    ]);
    return {
      el: el,
      set: function (text, frac) { status.textContent = text; bar.style.width = Math.round((frac || 0) * 100) + '%'; },
      fail: function (msg) {
        el.classList.add('job-failed');
        status.textContent = msg;
        var x = D.button({ icon: 'close', title: 'Dismiss', cls: 'job-close' });
        D.tap(x, function () { D.remove(el); });
        el.appendChild(x);
      }
    };
  }

  function startUploads(files) {
    if (!K.sb.isLoggedIn()) { sheets.toast('Log in first to upload files.', 4000); return; }
    var folderId = fst.folderId === 'unfiled' ? null : fst.folderId;
    var list = [];
    for (var i = 0; i < files.length; i++) { list.push(files[i]); }
    var rows = list.map(function (f) { var r = jobRow(f); fst.jobs.appendChild(r.el); return r; });
    var k = 0;
    U.eachSeries(list, function (file, next) {
      var row = rows[k++];
      K.Importer.importFile(file, folderId, function (ev) {
        if (ev.phase === 'load') { row.set('Opening…', 0.02); }
        else if (ev.phase === 'render') { row.set('Preparing page ' + ev.i + ' of ' + ev.n, (ev.i - 1) / ev.n); }
        else if (ev.phase === 'upload') { row.set('Uploading page ' + ev.i + ' of ' + ev.n, (ev.i - 1 + (ev.f || 0)) / ev.n); }
      }, function (err, doc) {
        if (err) { row.fail(err.message || String(err)); next(); return; }
        D.remove(row.el);
        sheets.toast('“' + doc.title + '” uploaded (' + fileCount(doc.page_count).replace('file', 'page') + ')');
        next();
      });
    }, function () {});
  }

  function renderDocs() {
    if (!fst) { return; }
    if (fst.queue) { fst.queue.dead = true; }
    fst.queue = new K.ThumbQueue();
    var body = D.empty(fst.body);
    var docs = fst.folderId === 'unfiled' ? K.unfiledDocs() : Repo.documents(fst.folderId);
    var grid = D.el('div.grid');
    docs.forEach(function (doc) {
      var el = D.el('div.card');
      var tap = D.el('div.card-tap', null, [
        docCover(doc, fst.queue),
        D.el('div.card-meta', null, [
          D.el('div.card-title', { text: doc.title }),
          D.el('div.card-sub', { text: doc.page_count + (doc.page_count === 1 ? ' page' : ' pages') + ' · ' + U.relTime(doc.updated_at) })
        ])
      ]);
      var more = D.button({ icon: 'more', title: 'Actions', cls: 'card-more' });
      D.append(el, [tap, more]);
      var wasLong = longPress(tap, function () { docActions(doc); });
      D.tap(tap, function () { if (!wasLong()) { openDoc(doc); } });
      D.tap(more, function () { docActions(doc); });
      grid.appendChild(el);
    });
    body.appendChild(grid);
    if (!docs.length) {
      body.appendChild(D.el('p.empty', {
        text: K.Importer.canPdf()
          ? 'No files yet. Tap Upload to add PDFs or photos.'
          : 'No files yet. Photos can be uploaded from this device; upload PDFs from your PC or phone.'
      }));
    }
  }

  fd.mount = function (root, params) {
    var folder = params.id === 'unfiled' ? { id: 'unfiled', name: 'Unfiled' } : Repo.folder(params.id);
    if (!folder || folder.deleted_at) { K.router.go('#/uploads'); return; }
    var back = D.button({ icon: 'back', label: U.isPhone() ? null : 'Uploads', cls: 'back-btn' });
    D.tap(back, function () { K.router.go('#/uploads'); });
    var title = D.button({ label: folder.name, title: 'Folder actions', cls: 'title-btn' });
    if (folder.id !== 'unfiled') {
      D.tap(title, function () { folderActions(Repo.folder(folder.id), function () { K.router.go('#/uploads'); }); });
    }
    var pill = K.statusPill();
    // A <label> opens the file picker natively (works on iOS 9 too).
    var input = D.el('input.file-input', { type: 'file', multiple: true, accept: K.Importer.accept() });
    var upBtn = D.el('label.btn.primary.upload-btn', null, [D.icon('upload'), D.el('span.btn-label', { text: 'Upload' }), input]);
    D.on(input, 'change', function () {
      if (input.files && input.files.length) { startUploads(input.files); }
      input.value = '';
    });
    var top = D.el('header.topbar', null, [back, D.el('div.title-wrap', null, title), D.el('div.spacer'), pill, upBtn]);
    var jobs = D.el('div.jobs');
    var body = D.el('div.dash-body');
    D.append(root, [top, D.el('div.dash-scroll.scrolls', null, [jobs, body])]);
    fst = { folderId: folder.id, body: body, jobs: jobs, pill: pill, onChange: U.debounce(function () {
      if (fst && fst.folderId !== 'unfiled') {
        var f = Repo.folder(fst.folderId);
        if (!f || f.deleted_at) { K.router.go('#/uploads'); return; }
        title.querySelector('.btn-label').textContent = f.name;
      }
      renderDocs();
    }, 200) };
    Repo.on('change', fst.onChange);
    renderDocs();
  };

  fd.unmount = function () {
    if (!fst) { return; }
    Repo.off('change', fst.onChange);
    fst.onChange.cancel();
    if (fst.queue) { fst.queue.dead = true; }
    fst.pill.destroy();
    fst = null;
  };

  K.screens = K.screens || {};
  K.screens.uploads = up;
  K.screens.folder = fd;
})(window.Kagoj = window.Kagoj || {});
