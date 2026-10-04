(function (K) {
  'use strict';

  var D = K.dom, U = K.util, Repo = K.Repo, sheets = K.sheets;
  var screen = {};
  var ws = null;

  function fitModeFor() {
    var m = K.prefs.get('fitMode');
    if (m === 'width' || m === 'page') { return m; }
    if (U.isPhone()) { return 'width'; }
    return window.innerHeight > window.innerWidth ? 'page' : 'width';
  }

  function Workspace(root, params) {
    var self = this;
    this.root = root;
    this.nb = Repo.notebook(params.id);
    this.prefs = K.prefs.all();
    this.histories = {};
    this.pages = [];
    this.pageIdx = 0;
    this.page = null;
    this.loadToken = 0;
    this.zoomPct = 100;
    this.readOnly = U.isPhone();
    this.unbind = [];
    this.saveTimer = null;
    this.pendingPageId = null;

    this.build();
    this.refreshPages();
    this.engine = new K.Engine(this.stage, {
      onChange: function (pid) { self.scheduleSave(pid); },
      onHistory: function (u, r) {
        self.undoBtn.classList.toggle('disabled', !u);
        self.redoBtn.classList.toggle('disabled', !r);
      },
      onView: function (pct) { self.zoomPct = pct; self.toolbar.setZoom(pct); },
      onSelect: function (id, kind) {
        self.selBar.style.display = id ? '' : 'none';
        self.editBtn.style.display = kind === 'text' ? '' : 'none';
      },
      onPick: function (n) {
        self.pickBar.style.display = n ? '' : 'none';
        self.convBtn.querySelector('.btn-label').textContent = 'Convert ' + n + (n === 1 ? ' stroke' : ' strokes') + ' to text';
      },
      onStylus: function () { self.offerPencilOnly(); }
    });
    this.selBar.style.display = 'none';
    this.pickBar.style.display = 'none';
    this.applyPalm();
    this.applyTool();
    this.engine.setReadOnly(this.readOnly);
    this.bindEvents();
    Repo.markOpened(this.nb.id);
    this.openPage(params.page - 1, true);
  }

  var P = Workspace.prototype;

  // ---------- DOM ----------

  P.build = function () {
    var self = this;
    var back = D.button({ icon: 'back', label: U.isPhone() ? null : 'Back', title: 'Back to notebooks', cls: 'back-btn' });
    D.tap(back, function () { K.router.go(self.backHash()); });
    this.titleBtn = D.button({ label: this.nb.title, title: 'Rename notebook', cls: 'title-btn' });
    D.tap(this.titleBtn, function () { K.renameNotebook(self.nb); });
    this.undoBtn = D.button({ icon: 'undo', title: 'Undo', cls: 'disabled' });
    D.tap(this.undoBtn, function () { self.engine.undo(); });
    this.redoBtn = D.button({ icon: 'redo', title: 'Redo', cls: 'disabled' });
    D.tap(this.redoBtn, function () { self.engine.redo(); });
    this.modeBtn = D.button({ icon: this.readOnly ? 'pencil' : 'eye', title: this.readOnly ? 'Write mode' : 'View mode', cls: 'mode-toggle' });
    D.tap(this.modeBtn, function () { self.setReadOnly(!self.readOnly); });
    this.pill = K.statusPill();
    var more = D.button({ icon: 'more', title: 'More' });
    D.tap(more, function () { self.moreMenu(); });

    this.top = D.el('header.topbar.ws-top', null, [
      back, D.el('div.title-wrap', null, this.titleBtn), this.undoBtn, this.redoBtn,
      D.el('div.spacer'), this.pill, this.modeBtn, more
    ]);
    this.stage = D.el('div.stage');
    this.msg = D.el('div.stage-msg');
    this.toolbar = new K.Toolbar(this);
    this.showBtn = D.button({ icon: 'chevron-down', title: 'Show top bar', cls: 'float-btn' });
    D.tap(this.showBtn, function () { self.setToolbarsHidden(false); });
    D.append(this.root, [this.top, this.stage, this.showBtn]);
    // the floating tool palette lives over the page
    this.stage.appendChild(this.toolbar.el);
    this.stage.appendChild(this.msg);
    // floating bar while an image is selected
    var del = D.button({ icon: 'trash', label: 'Delete', cls: 'danger' });
    D.tap(del, function () { self.engine.deleteSelected(); });
    var done = D.button({ label: 'Done' });
    D.tap(done, function () { self.engine.setSelection(null); });
    this.editBtn = D.button({ icon: 'edit', label: 'Edit text' });
    D.tap(this.editBtn, function () {
      var id = self.engine.sel;
      K.app.loadExtras(function (err) { if (!err) { K.Handwriting.editDialog(self.engine, id); } });
    });
    this.selBar = D.el('div.sel-bar', null, [this.editBtn, del, done]);
    // bar shown after a lasso pick: convert handwriting to typed text
    this.convBtn = D.button({ icon: 'text', label: 'Convert to text', cls: 'primary' });
    D.tap(this.convBtn, function () { self.convertPicked(); });
    var cancel = D.button({ label: 'Cancel' });
    D.tap(cancel, function () { self.engine.setPicked(null); });
    this.pickBar = D.el('div.sel-bar.pick-bar2', null, [this.convBtn, cancel]);
    this.stage.appendChild(this.pickBar);
    this.stage.appendChild(this.selBar);
    // overlays inside the stage must not reach the drawing input underneath
    [this.selBar, this.pickBar, this.msg].forEach(function (el) {
      ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointermove', 'pointerup', 'mousedown'].forEach(function (ev) {
        D.on(el, ev, function (e) { e.stopPropagation(); });
      });
    });
    // wrist guard (ignored zone at the bottom), height adjustable by its handle
    this.guard = D.el('div.wrist-guard', null, D.el('div.guard-handle', null, D.el('span', { text: 'Wrist guard ↕' })));
    this.stage.appendChild(this.guard);
    this.bindGuard();
    this.root.classList.toggle('bars-hidden', !!this.prefs.toolbarsHidden);
    this.toolbar.render();
  };

  P.backHash = function () {
    return Repo.isDocument(this.nb) ? '#/up/' + (this.nb.folder_id && Repo.folder(this.nb.folder_id) ? this.nb.folder_id : 'unfiled') : '#/';
  };

  P.setToolbarsHidden = function (h) {
    this.prefs.toolbarsHidden = h;
    K.prefs.set('toolbarsHidden', h);
    this.root.classList.toggle('bars-hidden', h);
    this.engine.resize();
    this.toolbar.reflow();
  };

  P.setReadOnly = function (ro) {
    this.readOnly = ro;
    this.engine.setReadOnly(ro);
    D.empty(this.modeBtn).appendChild(D.icon(ro ? 'pencil' : 'eye'));
    this.modeBtn.setAttribute('title', ro ? 'Write mode' : 'View mode');
    this.toolbar.render();
    sheets.toast(ro ? 'View mode: one finger scrolls' : 'Write mode');
  };

  // ---------- tools ----------

  P.applyTool = function () {
    var t = this.prefs.tool, tp = this.prefs[t] || {};
    this.engine.setTool({
      tool: t, color: tp.color, size: tp.size,
      eraserMode: this.prefs.eraser.mode
    });
    this.toolbar.render();
  };

  P.setTool = function (t) {
    this.prefs.tool = t;
    K.prefs.set('tool', t);
    this.applyTool();
  };

  P.setColor = function (c) {
    var t = this.prefs.tool;
    this.prefs[t].color = c;
    K.prefs.set(t, this.prefs[t]);
    this.applyTool();
  };

  P.setSize = function (s) {
    var t = this.prefs.tool;
    this.prefs[t].size = s;
    K.prefs.set(t, this.prefs[t]);
    this.applyTool();
  };

  P.toggleEraserMode = function () {
    this.prefs.eraser.mode = this.prefs.eraser.mode === 'whole' ? 'partial' : 'whole';
    K.prefs.set('eraser', this.prefs.eraser);
    this.prefs.tool = 'eraser';
    K.prefs.set('tool', 'eraser');
    this.applyTool();
    sheets.toast(this.prefs.eraser.mode === 'whole' ? 'Eraser: whole stroke' : 'Eraser: partial');
  };

  P.zoom = function (dir) { this.engine.zoomStep(dir); };
  P.resetZoom = function () { this.engine.fit('width'); };

  // ---------- pages ----------

  P.refreshPages = function () {
    this.nb = Repo.notebook(this.nb.id) || this.nb;
    this.pages = Repo.pagesOf(this.nb.id);
    if (!this.pages.length && !this.nb.deleted_at) {
      // a notebook always has at least one page
      this.pages = [Repo.addPage(this.nb.id, null, this.nb.default_paper)];
    }
    if (this.page) {
      for (var i = 0; i < this.pages.length; i++) {
        if (this.pages[i].id === this.page.id) { this.pageIdx = i; break; }
      }
    }
    if (this.titleBtn) { this.titleBtn.querySelector('.btn-label').textContent = this.nb.title; }
  };

  P.goPage = function (idx) {
    if (idx < 0 || idx >= this.pages.length || idx === this.pageIdx) { return; }
    this.openPage(idx);
  };

  P.openPage = function (idx, first) {
    var self = this;
    this.flushSave();
    idx = U.clamp(idx, 0, this.pages.length - 1);
    var p = this.pages[idx];
    this.pageIdx = idx;
    this.page = p;
    this.toolbar.render();
    K.router.replace('#/nb/' + this.nb.id + '/' + (idx + 1));
    Repo.setMeta('lastPage.' + this.nb.id, idx + 1);
    Repo.setMeta('lastOpen', { id: this.nb.id, page: idx + 1 });
    var token = ++this.loadToken;
    this.showMsg(p.needsDrawing ? 'Downloading page…' : '');
    Repo.loadDrawing(p.id, function (err, d) {
      if (token !== self.loadToken || self.destroyed) { return; }
      if (err) {
        self.engine.setPage(null, Repo.emptyDrawing(), p.paper, null, fitModeFor(), { bg: p.background_asset });
        self.showMsg(err.type === 'network' || err.type === 'timeout'
          ? 'This page isn’t on this device yet. Connect to the internet to download it.'
          : (err.message || 'Could not load this page'), true);
        return;
      }
      self.showMsg('');
      if (!self.histories[p.id]) { self.histories[p.id] = new K.History(); }
      self.engine.setPage(p.id, d, p.paper, self.histories[p.id], fitModeFor(), { bg: p.background_asset });
      // pre-load the next page from local storage so "›" feels instant
      var nx = self.pages[idx + 1];
      if (nx) { setTimeout(function () { Repo.preload(nx.id); K.Assets.prefetch(nx.background_asset); }, 300); }
      if (first) { self.prefetchNotebook(); }
    });
  };

  // Download any pages of this notebook not yet on the device.
  P.prefetchNotebook = function () {
    var self = this;
    var missing = this.pages.filter(function (p) { return p.needsDrawing; });
    if (!missing.length || !K.sb.isLoggedIn()) { return; }
    U.eachSeries(missing, function (p, next) {
      if (self.destroyed) { return; }
      K.Sync.fetchDrawing(p.id, function () { next(); });
    });
  };

  P.showMsg = function (text, retry) {
    var self = this;
    D.empty(this.msg);
    this.msg.style.display = text ? '' : 'none';
    if (!text) { return; }
    this.msg.appendChild(D.el('p', { text: text }));
    if (retry) {
      var b = D.button({ label: 'Try again', cls: 'primary' });
      D.tap(b, function () { self.openPage(self.pageIdx); });
      this.msg.appendChild(b);
    }
  };

  P.addPage = function () {
    this.flushSave();
    var p = Repo.addPage(this.nb.id, this.page ? this.page.id : null, this.nb.default_paper);
    this.refreshPages();
    for (var i = 0; i < this.pages.length; i++) {
      if (this.pages[i].id === p.id) { this.openPage(i); break; }
    }
    sheets.toast('Page ' + (this.pageIdx + 1) + ' added');
  };

  P.pageList = function () {
    var self = this;
    var list = D.el('div.page-list');
    this.pages.forEach(function (p, i) {
      var row = D.el('button.page-row' + (i === self.pageIdx ? '.current' : ''), { type: 'button' }, [
        D.el('span.page-num', { text: 'Page ' + (i + 1) }),
        p.label ? D.el('span.page-lbl', { text: '— ' + p.label }) : null,
        D.el('span.page-paper', { text: p.paper })
      ]);
      D.tap(row, function () { m.close(); self.goPage(i); });
      list.appendChild(row);
    });
    var m = sheets.modal({ title: this.nb.title + ' · ' + this.pages.length + ' pages', body: list, actions: [{ label: 'Close' }], cls: 'sheet-pages' });
    setTimeout(function () {
      var cur = list.querySelector('.current');
      if (cur && cur.scrollIntoView) { cur.scrollIntoView(false); }
    }, 50);
  };

  P.moreMenu = function () {
    var self = this, p = this.page;
    sheets.actionSheet({
      title: 'Page ' + (this.pageIdx + 1),
      items: [
        { label: 'Paper style…', icon: 'paper', onTap: function () { self.paperMenu(); } },
        { label: 'Page list', icon: 'list', onTap: function () { self.pageList(); } },
        { label: 'Import from Uploads…', icon: 'upload', onTap: function () { self.importFromUploads(); } },
        { label: 'Convert page handwriting to text…', icon: 'text', onTap: function () { self.convertPage(); } },
        { label: 'Fit whole page', icon: 'fit', onTap: function () { self.engine.fit('page'); } },
        { label: 'Fit page width', icon: 'fit', onTap: function () { self.engine.fit('width'); } },
        { label: this.readOnly ? 'Write mode' : 'View mode (no writing)', icon: this.readOnly ? 'pencil' : 'eye', onTap: function () { self.setReadOnly(!self.readOnly); } },
        { label: 'Hide top bar', icon: 'tools', onTap: function () { self.setToolbarsHidden(true); } },
        { label: 'Clear page', icon: 'clear', danger: true, onTap: function () {
          sheets.confirm({ title: 'Clear this page?', message: 'You can undo this.', ok: 'Clear', danger: true }, function (ok) {
            if (ok) { self.engine.clear(); }
          });
        } },
        p ? { label: 'Delete page', icon: 'trash', danger: true, onTap: function () { self.deletePage(); } } : null
      ]
    });
  };

  P.paperMenu = function () {
    var self = this, p = this.page;
    sheets.actionSheet({
      title: 'Paper for this page',
      items: K.PAPERS.map(function (pp) {
        return {
          label: pp.name, checked: p.paper === pp.id,
          onTap: function () {
            Repo.updatePage(p.id, { paper: pp.id });
            self.engine.setPaper(pp.id);
          }
        };
      })
    });
  };

  P.deletePage = function () {
    var self = this;
    if (this.pages.length <= 1) {
      sheets.toast('A notebook needs at least one page. Use “Clear page” instead.', 4000);
      return;
    }
    sheets.confirm({
      title: 'Delete page ' + (this.pageIdx + 1) + '?',
      message: 'It stays in Settings → Recently deleted for 30 days.',
      ok: 'Delete', danger: true
    }, function (ok) {
      if (!ok) { return; }
      self.flushSave();
      var idx = self.pageIdx, id = self.page.id;
      Repo.deletePage(id);
      delete self.histories[id];
      self.page = null;
      self.refreshPages();
      self.openPage(Math.min(idx, self.pages.length - 1));
      sheets.toast('Page deleted');
    });
  };

  // ---------- uploads / images ----------

  P.importFromUploads = function () {
    var self = this;
    K.app.loadExtras(function (err) {
      if (err) { sheets.toast(err.message, 4000); return; }
      self.openPicker();
    });
  };

  P.openPicker = function () {
    var self = this;
    K.pickPages({ actions: [{ label: 'Place on this page' }, { label: 'Add as new pages', primary: true }] }, function (idx, items) {
      if (idx === 0) {
        if (self.readOnly) { self.setReadOnly(false); }
        self.engine.addImages(items);
        self.setTool('select');
        sheets.toast('Drag to move, drag the corner to resize');
        return;
      }
      self.flushSave();
      var after = self.page ? self.page.id : null, first = null;
      items.forEach(function (it) {
        var p = Repo.addPage(self.nb.id, after, 'blank', { background_asset: it.a, w: 1000, h: Math.round(1000 * it.ratio) });
        after = p.id;
        first = first || p;
      });
      Repo.recount(self.nb.id);
      self.refreshPages();
      for (var i = 0; i < self.pages.length; i++) {
        if (self.pages[i].id === first.id) { self.openPage(i); break; }
      }
      sheets.toast(items.length + (items.length === 1 ? ' page' : ' pages') + ' added');
    });
  };

  // ---------- handwriting to text ----------

  P.convertPicked = function () {
    var self = this;
    K.app.loadExtras(function (err) {
      if (err) { sheets.toast(err.message, 4000); return; }
      K.Handwriting.convert(self.engine);
    });
  };

  P.convertPage = function () {
    if (this.readOnly) { this.setReadOnly(false); }
    this.engine.pickAll();
    if (!this.engine.picked) { sheets.toast('There is no handwriting on this page.'); return; }
    this.convertPicked();
  };

  // ---------- palm rejection ----------

  P.toggleBand = function () {
    var on = !K.prefs.get('band');
    K.prefs.set('band', on);
    if (on && this.readOnly) { this.setReadOnly(false); }
    this.applyPalm();
    sheets.toast(on ? 'Writing band on: only touches inside the band write. \u25B2\u25BC move it.' : 'Writing band off', 3500);
  };

  P.toggleWristGuard = function () {
    var on = !K.prefs.get('wristGuard');
    K.prefs.set('wristGuard', on ? 140 : 0);
    this.applyPalm();
    sheets.toast(on ? 'Wrist guard on: touches in the shaded strip are ignored. Drag its edge to resize.' : 'Wrist guard off', 3500);
  };

  P.togglePencilOnly = function () {
    var on = !K.prefs.get('pencilOnly');
    K.prefs.set('pencilOnly', on);
    this.applyPalm();
    sheets.toast(on ? 'Pencil only: fingers scroll and zoom, only the Apple Pencil writes.' : 'Pencil only off', 3500);
  };

  P.applyPalm = function () {
    var p = K.prefs.all();
    this.engine.setBand(!!p.band, p.bandLines || 4);
    if (this.toolbar) { this.toolbar.render(); }
    this.engine.input.pencilOnly = !!p.pencilOnly;
    this.engine.input.guardPx = p.wristGuard || 0;
    this.guard.style.display = p.wristGuard ? '' : 'none';
    this.guard.style.height = (p.wristGuard || 0) + 'px';
  };

  P.bindGuard = function () {
    var self = this, handle = this.guard.firstChild, startY = 0, startH = 0;
    function y(e) { return e.touches ? e.touches[0].clientY : e.clientY; }
    function down(e) {
      e.stopPropagation();
      if (e.cancelable) { e.preventDefault(); }
      startY = y(e); startH = K.prefs.get('wristGuard') || 140;
      self.guardDrag = true;
    }
    function move(e) {
      if (!self.guardDrag) { return; }
      e.stopPropagation();
      if (e.cancelable) { e.preventDefault(); }
      var h = U.clamp(startH - (y(e) - startY), 60, Math.round(self.stage.clientHeight * 0.7));
      self.guard.style.height = h + 'px';
      self.engine.input.guardPx = h;
    }
    function up() {
      if (!self.guardDrag) { return; }
      self.guardDrag = false;
      K.prefs.set('wristGuard', parseInt(self.guard.style.height, 10) || 140);
    }
    D.on(handle, 'touchstart', down, D.passiveFalse);
    D.on(handle, 'touchmove', move, D.passiveFalse);
    D.on(handle, 'touchend', up);
    D.on(handle, 'mousedown', down);
    D.on(handle, 'pointerdown', function (e) { e.stopPropagation(); });
    this.unbind.push(D.on(window, 'mousemove', move));
    this.unbind.push(D.on(window, 'mouseup', up));
  };

  P.offerPencilOnly = function () {
    var self = this;
    if (K.prefs.get('pencilOnly') || K.prefs.get('pencilAsked')) { return; }
    K.prefs.set('pencilAsked', true);
    sheets.confirm({
      title: 'Apple Pencil detected',
      message: 'Turn on Pencil-only mode? Only the Pencil writes; fingers scroll and zoom, and your palm is ignored. You can change this in Settings.',
      ok: 'Turn on'
    }, function (ok) {
      if (ok) { K.prefs.set('pencilOnly', true); self.applyPalm(); }
    });
  };

  // ---------- saving ----------

  P.scheduleSave = function (pageId) {
    var self = this;
    if (!pageId) { return; }
    if (this.pendingPageId && this.pendingPageId !== pageId) { this.flushSave(); }
    this.pendingPageId = pageId;
    if (this.saveTimer) { clearTimeout(this.saveTimer); }
    this.saveTimer = setTimeout(function () { self.flushSave(); }, 400);
  };

  P.flushSave = function () {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    var id = this.pendingPageId;
    if (!id) { return; }
    this.pendingPageId = null;
    if (this.engine.pageId !== id) { return; }
    Repo.saveDrawing(id, this.engine.getDrawing());
  };

  // ---------- events ----------

  P.bindEvents = function () {
    var self = this, u = this.unbind;
    // never let the page scroll or bounce while in the workspace
    u.push(D.on(document, 'touchmove', function (e) {
      if (sheets.isOpen()) { return; }
      if (e.cancelable) { e.preventDefault(); }
    }, D.passiveFalse));
    u.push(D.on(document, 'gesturestart', function (e) { e.preventDefault(); }, D.passiveFalse));
    u.push(D.on(document, 'keydown', function (e) { self.onKey(e); }));
    u.push(D.on(document, 'keyup', function (e) { if (e.keyCode === 32) { self.engine.input.spaceHeld = false; } }));
    this.onResize = function () {
      self.engine.resize();
      self.toolbar.reflow();
    };
    K.app.on('resize', this.onResize);
    this.onHide = function () { self.flushSave(); };
    K.app.on('hide', this.onHide);
    this.onRepoChange = U.debounce(function () {
      if (self.destroyed) { return; }
      var cur = self.page && Repo.page(self.page.id);
      var nb = Repo.notebook(self.nb.id);
      if (!nb || nb.deleted_at) { K.router.go('#/'); return; }
      self.refreshPages();
      if (cur && cur.deleted_at) {
        self.page = null;
        self.openPage(Math.min(self.pageIdx, self.pages.length - 1));
        return;
      }
      self.toolbar.render();
    }, 200);
    Repo.on('change', this.onRepoChange);
    this.onRemotePage = function (id) {
      if (!self.page || id !== self.page.id) { return; }
      if (self.pendingPageId === id || self.engine.cur || self.engine.erase) { return; }
      delete self.histories[id];
      self.openPage(self.pageIdx);
    };
    K.Sync.on('remotePage', this.onRemotePage);
    this.onConflict = function () {
      sheets.toast('A page was edited on two devices. Both versions were kept.', 5000);
    };
    K.Sync.on('conflict', this.onConflict);
  };

  P.onKey = function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || sheets.isOpen()) { return; }
    var mod = e.ctrlKey || e.metaKey;
    var k = e.keyCode;
    if (mod && k === 90) { e.preventDefault(); if (e.shiftKey) { this.engine.redo(); } else { this.engine.undo(); } return; }
    if (mod && k === 89) { e.preventDefault(); this.engine.redo(); return; }
    if (mod && (k === 187 || k === 61 || k === 107)) { e.preventDefault(); this.zoom(1); return; }
    if (mod && (k === 189 || k === 173 || k === 109)) { e.preventDefault(); this.zoom(-1); return; }
    if (mod && k === 48) { e.preventDefault(); this.resetZoom(); return; }
    if (mod || e.altKey) { return; }
    if (k === 32) { this.engine.input.spaceHeld = true; e.preventDefault(); return; }
    if (k === 80) { this.setTool('pen'); }
    else if (k === 72) { this.setTool('highlighter'); }
    else if (k === 69) { this.setTool('eraser'); }
    else if (k === 37 || k === 33) { this.goPage(this.pageIdx - 1); }
    else if (k === 39 || k === 34) { this.goPage(this.pageIdx + 1); }
  };

  P.destroy = function () {
    this.flushSave();
    this.destroyed = true;
    for (var i = 0; i < this.unbind.length; i++) { this.unbind[i](); }
    K.app.off('resize', this.onResize);
    K.app.off('hide', this.onHide);
    Repo.off('change', this.onRepoChange);
    this.onRepoChange.cancel();
    K.Sync.off('remotePage', this.onRemotePage);
    K.Sync.off('conflict', this.onConflict);
    this.pill.destroy();
    this.toolbar.destroy();
    this.engine.destroy();
  };

  // ---------- screen interface ----------

  screen.mount = function (root, params) {
    var nb = Repo.notebook(params.id);
    if (!nb || nb.deleted_at) {
      root.appendChild(D.el('p.empty', { text: 'This notebook isn’t on this device.' }));
      setTimeout(function () { K.router.go('#/'); }, 1200);
      return;
    }
    ws = new Workspace(root, params);
  };

  screen.update = function (params) {
    if (!ws || params.id !== ws.nb.id) { return false; }
    ws.goPage(params.page - 1);
    return true;
  };

  screen.unmount = function () {
    if (ws) { var w = ws; ws = null; w.destroy(); }
  };

  K.screens = K.screens || {};
  K.screens.workspace = screen;
})(window.Kagoj = window.Kagoj || {});
