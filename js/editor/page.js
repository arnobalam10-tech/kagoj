(function (K) {
  'use strict';

  // Page screen (#/p/<id>): cover, icon, title, properties (database rows),
  // the block editor, backlinks. Owns save, undo/redo and page style.
  var D = K.dom, U = K.util, R = K.rich, Docs = K.Docs, sheets = K.sheets;
  var screen = {};
  var view = null;

  var COVERS = [
    'linear-gradient(135deg,#F6D365,#FDA085)', 'linear-gradient(135deg,#A1C4FD,#C2E9FB)', 'linear-gradient(135deg,#D4FC79,#96E6A1)',
    'linear-gradient(135deg,#FBC2EB,#A6C1EE)', 'linear-gradient(135deg,#E0C3FC,#8EC5FC)', 'linear-gradient(135deg,#FFECD2,#FCB69F)',
    '#2F3640', '#1F3A5F', '#2E5E3E', '#7A2E3A', '#C9A227', '#1F7A7A'
  ];

  function PageView(root, doc) {
    var self = this;
    this.root = root;
    this.doc = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.lastState = this.state();
    this.saveTimer = null;
    this.recordSoon = U.debounce(function () { self.record(); }, 700);
    this.unbind = [];
    this.build();
    Docs.visit(doc.id);
  }
  var P = PageView.prototype;

  P.locked = function () { return !!(this.doc.settings && this.doc.settings.lock); };

  // ---------- history ----------
  P.state = function () { return JSON.stringify({ c: this.doc.content, t: this.doc.title }); };
  P.record = function () {
    var cur = this.state();
    if (cur === this.lastState) { return; }
    this.undoStack.push(this.lastState);
    if (this.undoStack.length > 100) { this.undoStack.shift(); }
    this.redoStack = [];
    this.lastState = cur;
    this.updateUndo();
  };
  P.snapshot = function () { this.recordSoon.cancel(); this.record(); };
  P.applyState = function (s) {
    var o = JSON.parse(s);
    this.doc.content.length = 0;
    for (var i = 0; i < o.c.length; i++) { this.doc.content.push(o.c[i]); }
    this.doc.title = o.t;
    this.lastState = s;
    this.titleEl.textContent = o.t;
    this.editor.render();
    this.save(true);
    this.updateUndo();
  };
  P.undo = function () {
    this.snapshot();
    if (!this.undoStack.length) { return; }
    this.redoStack.push(this.lastState);
    this.applyState(this.undoStack.pop());
  };
  P.redo = function () {
    if (!this.redoStack.length) { return; }
    this.undoStack.push(this.lastState);
    this.applyState(this.redoStack.pop());
  };
  P.updateUndo = function () {
    if (!this.undoBtn) { return; }
    this.undoBtn.classList.toggle('disabled', !this.undoStack.length);
    this.redoBtn.classList.toggle('disabled', !this.redoStack.length);
  };

  // ---------- saving ----------
  P.changed = function (structural) {
    if (structural) { this.snapshot(); } else { this.recordSoon(); }
    this.save(false);
  };
  P.save = function (now) {
    var self = this;
    if (this.saveTimer) { clearTimeout(this.saveTimer); }
    this.saveTimer = setTimeout(function () { self.flush(); }, now ? 0 : 600);
  };
  P.flush = function () {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    else { return; }
    if (this.destroyed) { return; }
    Docs.save(this.doc);
    this.updateEdited();
  };

  // ---------- building ----------
  P.build = function () {
    var self = this, doc = this.doc;
    var undo = D.button({ icon: 'undo', title: 'Undo (Ctrl+Z)', cls: 'disabled' });
    D.tap(undo, function () { self.undo(); });
    var redo = D.button({ icon: 'redo', title: 'Redo (Ctrl+Shift+Z)', cls: 'disabled' });
    D.tap(redo, function () { self.redo(); });
    this.undoBtn = undo; this.redoBtn = redo;
    this.star = D.button({ icon: 'star', title: 'Favorite', cls: 'star-btn' + (doc.favorite ? ' on' : '') });
    D.tap(this.star, function () { Docs.update(doc.id, { favorite: !doc.favorite }, { meta: true }); self.star.classList.toggle('on', doc.favorite); });
    var more = D.button({ icon: 'more', title: 'Page options' });
    D.tap(more, function () { self.pageMenu(); });
    this.crumbs = D.el('div.crumbs');
    this.edited = D.el('span.edited');
    var top = D.el('header.topbar.doc-top', null, [K.shell.menuButton(), this.crumbs, D.el('div.spacer'), this.edited, undo, redo, this.star, more]);
    this.scroller = D.el('div.doc-scroll.scrolls');
    this.pageEl = D.el('div.page');
    this.styleEl = D.el('style');
    this.scroller.appendChild(this.pageEl);
    D.append(this.root, [top, this.scroller, this.styleEl]);
    this.renderAll();
    this.unbind.push(D.on(this.root, 'keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.keyCode === 90) { e.preventDefault(); if (e.shiftKey) { self.redo(); } else { self.undo(); } }
      else if (mod && e.keyCode === 89) { e.preventDefault(); self.redo(); }
    }));
  };

  P.renderAll = function () {
    var self = this, doc = this.doc, page = D.empty(this.pageEl);
    if (this.editor) { this.editor.destroy(); }
    if (this.dbView && this.dbView.destroy) { this.dbView.destroy(); this.dbView = null; }
    this.applyStyle();
    this.renderCrumbs();
    this.updateEdited();
    // cover
    if (doc.cover) {
      var cover = D.el('div.cover-band');
      this.paintCover(cover);
      if (!this.locked()) {
        var cbtn = D.el('button.cover-btn', { type: 'button', text: 'Change cover' });
        D.tap(cbtn, function () { self.coverMenu(); });
        cover.appendChild(cbtn);
      }
      page.appendChild(cover);
    }
    var head = D.el('div.page-head' + (doc.cover ? '.has-cover' : ''));
    if (doc.icon) {
      var ib = D.el('button.page-icon', { type: 'button', text: doc.icon });
      D.tap(ib, function () { if (!self.locked()) { K.emojiPicker(ib, function (e) { Docs.update(doc.id, { icon: e }, { meta: true }); self.renderAll(); }, true); } });
      head.appendChild(ib);
    }
    if (!this.locked()) {
      var adds = D.el('div.page-adds');
      if (!doc.icon) {
        var ai = D.el('button.add-link', { type: 'button' }, [D.icon('smile'), D.el('span', { text: 'Add icon' })]);
        D.tap(ai, function () { K.emojiPicker(ai, function (e) { if (e) { Docs.update(doc.id, { icon: e }, { meta: true }); self.renderAll(); } }); });
        adds.appendChild(ai);
      }
      if (!doc.cover) {
        var ac = D.el('button.add-link', { type: 'button' }, [D.icon('image'), D.el('span', { text: 'Add cover' })]);
        D.tap(ac, function () { Docs.update(doc.id, { cover: 'g:' + Math.floor(Math.random() * 6) }, { meta: true }); self.renderAll(); });
        adds.appendChild(ac);
      }
      head.appendChild(adds);
    }
    this.titleEl = D.el('h1.page-title', { 'data-ph': doc.kind === 'database' ? 'Untitled database' : 'Untitled' });
    this.titleEl.textContent = doc.title || '';
    if (!this.locked()) {
      this.titleEl.setAttribute('contenteditable', 'true');
      D.on(this.titleEl, 'input', function () {
        var t = self.titleEl.textContent.replace(/[\r\n]+/g, ' ');
        doc.title = t.substr(0, 500);
        self.renderCrumbs();
        self.changed(false);
        K.shell.renderSide();
        if (doc.kind === 'canvas' && doc.settings && doc.settings.notebook) { K.Repo.updateNotebook(doc.settings.notebook, { title: t || 'Handwritten notes' }); }
      });
      D.on(this.titleEl, 'keydown', function (e) {
        if (e.keyCode === 13 || (e.keyCode === 40 && R.onLastLine(self.titleEl))) {
          e.preventDefault();
          var first = null;
          for (var i = 0; i < doc.content.length; i++) { if (K.isTextBlock(doc.content[i])) { first = doc.content[i]; break; } }
          if (e.keyCode === 13 && (!first || Docs.plain(first.html))) {
            if (!first) { first = self.editor.insertAfter(null, Docs.newBlock('p'), false); }
          } else if (e.keyCode === 13) {
            first = Docs.newBlock('p');
            doc.content.unshift(first);
            self.editor.render();
            self.changed(true);
          }
          if (first) { self.editor.focus(first.id, 0); }
        }
      });
      D.on(this.titleEl, 'paste', function (e) {
        var cd = e.clipboardData;
        if (!cd) { return; }
        e.preventDefault();
        document.execCommand('insertText', false, cd.getData('text/plain').replace(/[\r\n]+/g, ' '));
      });
    }
    head.appendChild(this.titleEl);
    page.appendChild(head);
    // database rows show their properties; databases show their views (Phase 2)
    if (K.PageProps && doc.kind === 'row') { page.appendChild(K.PageProps.render(doc, this)); }
    if (doc.kind === 'database' && K.DbView) {
      var dbHost = D.el('div.db-full');
      page.appendChild(dbHost);
      this.dbView = K.DbView.mount(dbHost, doc, this, { full: true });
    }
    var blocksEl = D.el('div.page-blocks');
    page.appendChild(blocksEl);
    if (!doc.content) { doc.content = []; }
    this.editor = new K.Editor(this, doc.content, blocksEl, false);
    if (doc.kind === 'database' && !doc.content.length) { blocksEl.style.display = 'none'; }
    else { this.editor.render(); }
    this.backlinksEl = D.el('div.backlinks');
    page.appendChild(this.backlinksEl);
    this.renderBacklinks();
    // tapping the empty space under the page continues the text
    var tail = D.el('div.page-tail');
    D.tap(tail, function () { if (!self.locked() && doc.kind !== 'database') { self.editor.onClick({ target: self.editor.el }); } });
    page.appendChild(tail);
  };

  P.paintCover = function (el) {
    var c = this.doc.cover || '';
    if (c.indexOf('g:') === 0) { el.style.background = COVERS[(+c.substr(2)) % COVERS.length]; return; }
    if (c.indexOf('a:') === 0) {
      el.style.background = '#DAD7CF';
      K.Assets.get(c.substr(2), function (err, img) {
        if (!err) { el.style.backgroundImage = 'url("' + img.src + '")'; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; }
      });
    }
  };

  P.coverMenu = function () {
    var self = this, doc = this.doc;
    var box = D.el('div.cover-pick');
    COVERS.forEach(function (c, i) {
      var b = D.el('button.cover-chip', { type: 'button' });
      b.style.background = c;
      D.tap(b, function () { m.close(); Docs.update(doc.id, { cover: 'g:' + i }, { meta: true }); self.renderAll(); });
      box.appendChild(b);
    });
    var up = D.el('label.btn.small-btn', null, [D.icon('upload'), D.el('span.btn-label', { text: 'Upload an image' })]);
    var input = D.el('input.file-input', { type: 'file', accept: 'image/*' });
    up.appendChild(input);
    D.on(input, 'change', function () {
      var f = input.files && input.files[0];
      if (!f) { return; }
      m.close();
      sheets.toast('Uploading…');
      K.uploadMedia(f, true, function (err, res) {
        if (err) { sheets.toast(err.message, 4000); return; }
        Docs.update(doc.id, { cover: 'a:' + res.asset }, { meta: true });
        self.renderAll();
      });
    });
    var m = sheets.modal({ title: 'Cover', body: D.el('div', null, [box, up]), actions: [
      { label: 'Remove cover', onTap: function () { Docs.update(doc.id, { cover: null }, { meta: true }); self.renderAll(); } },
      { label: 'Done', primary: true }
    ] });
  };

  P.renderCrumbs = function () {
    var self = this, c = D.empty(this.crumbs);
    var path = Docs.path(this.doc.id);
    var narrow = window.innerWidth < 700;
    if (narrow && path.length > 2) { path = [path[0], null, path[path.length - 1]]; }
    path.forEach(function (d, i) {
      if (i) { c.appendChild(D.el('span.crumb-sep', { text: '/' })); }
      if (!d) { c.appendChild(D.el('span.crumb-more', { text: '…' })); return; }
      var a = D.el('button.crumb', { type: 'button' }, [d.icon ? D.el('span.emoji', { text: d.icon + ' ' }) : null, D.el('span', { text: Docs.titleOf(d) })]);
      if (d.id !== self.doc.id) { D.tap(a, function () { K.shell.openDoc(d); }); }
      c.appendChild(a);
    });
  };

  P.updateEdited = function () {
    if (this.edited) { this.edited.textContent = window.innerWidth > 900 ? 'Edited ' + U.relTime(this.doc.updated_at) : ''; }
  };

  P.renderBacklinks = function () {
    var el = D.empty(this.backlinksEl), links = Docs.backlinks(this.doc.id);
    if (!links.length) { return; }
    el.appendChild(D.el('div.bl-head', { text: links.length + (links.length === 1 ? ' backlink' : ' backlinks') }));
    links.forEach(function (d) {
      var a = D.el('button.bl-item', { type: 'button' }, [K.docIconEl(d), D.el('span', { text: Docs.titleOf(d) })]);
      D.tap(a, function () { K.shell.openDoc(d); });
      el.appendChild(a);
    });
  };

  P.focusTitle = function () { if (!this.locked()) { R.place(this.titleEl, -1); } };

  P.scrollToBlock = function (id) {
    var e = this.editor.els[id];
    if (!e) { return; }
    var r = e.wrap.getBoundingClientRect(), s = this.scroller.getBoundingClientRect();
    this.scroller.scrollTop += r.top - s.top - 60;
    e.wrap.classList.add('flash');
    setTimeout(function () { e.wrap.classList.remove('flash'); }, 1200);
  };

  P.onDerived = function () {
    // keep tables of contents current
    var tocs = this.pageEl.querySelectorAll('.t-toc');
    if (!tocs.length) { return; }
    var self = this;
    clearTimeout(this.tocTimer);
    this.tocTimer = setTimeout(function () {
      self.doc.content.forEach(function (b) { if (b.type === 'toc' && self.editor.els[b.id]) { self.editor.rerender(b.id); } });
    }, 400);
  };

  // ---------- style ----------
  function setting(doc, key, pref) {
    var s = doc.settings || {};
    return s[key] !== undefined ? s[key] : K.prefs.get(pref);
  }

  P.applyStyle = function () {
    var doc = this.doc, s = doc.settings || {};
    var font = setting(doc, 'font', 'docFont'), head = setting(doc, 'headFont', 'docHeadFont');
    var size = setting(doc, 'size', 'docSize'), line = setting(doc, 'line', 'docLine');
    this.pageEl.className = 'page' + (s.full ? ' full' : '') + (this.locked() ? ' locked' : '');
    this.pageEl.style.fontFamily = K.Fonts.stack(font);
    this.pageEl.style.fontSize = size + 'px';
    var css = '.page .rt,.page .img-cap{line-height:' + line + ';}';
    if (head && head !== font) { css += '.page .t-h1 .rt,.page .t-h2 .rt,.page .t-h3 .rt,.page .page-title{font-family:' + K.Fonts.stack(head) + ';}'; }
    this.styleEl.textContent = css;
  };

  P.setSetting = function (key, val) {
    var s = U.copy(this.doc.settings || {});
    if (val === undefined || val === null) { delete s[key]; } else { s[key] = val; }
    Docs.update(this.doc.id, { settings: s }, { meta: true });
    this.applyStyle();
  };

  P.pageMenu = function () {
    var self = this, doc = this.doc;
    var body = D.el('div.page-menu');
    function seg(options, value, fn) {
      var w = D.el('div.segmented');
      options.forEach(function (o) {
        var b = D.el('button.seg' + (String(o[0]) === String(value) ? '.selected' : ''), { type: 'button', text: o[1] });
        D.tap(b, function () {
          var all = w.querySelectorAll('.seg');
          for (var i = 0; i < all.length; i++) { all[i].classList.remove('selected'); }
          b.classList.add('selected');
          fn(o[0]);
        });
        w.appendChild(b);
      });
      return w;
    }
    function rowEl(label, ctl) { return D.el('div.pm-row', null, [D.el('span.pm-label', { text: label }), ctl]); }
    function fontBtn(key, pref, title) {
      var cur = setting(doc, key, pref);
      var b = D.el('button.small-btn.font-btn', { type: 'button', text: (K.Fonts.byId[cur] || K.Fonts.byId['default']).name });
      b.style.fontFamily = K.Fonts.stack(cur);
      D.tap(b, function () {
        K.fontPicker(title, cur, false, function (id) { self.setSetting(key, id); b.textContent = K.Fonts.byId[id].name; b.style.fontFamily = K.Fonts.stack(id); });
      });
      return b;
    }
    var quick = D.el('div.font-quick');
    [['default', 'Default', 'Ag'], ['serif', 'Serif', 'Ag'], ['mono', 'Mono', 'Ag']].forEach(function (f) {
      var b = D.el('button.fq' + (setting(doc, 'font', 'docFont') === f[0] ? '.selected' : ''), { type: 'button' }, [D.el('span.fq-ag', { text: f[2] }), D.el('span', { text: f[1] })]);
      b.firstChild.style.fontFamily = K.Fonts.stack(f[0]);
      D.tap(b, function () {
        self.setSetting('font', f[0]);
        var all = quick.querySelectorAll('.fq');
        for (var i = 0; i < all.length; i++) { all[i].classList.remove('selected'); }
        b.classList.add('selected');
      });
      quick.appendChild(b);
    });
    var s = doc.settings || {};
    function toggle(on, fn) {
      var t = D.el('button.toggle' + (on ? '.on' : ''), { type: 'button' }, D.el('span.knob'));
      D.tap(t, function () { on = !on; t.classList.toggle('on', on); fn(on); });
      return t;
    }
    D.append(body, [
      quick,
      rowEl('Body font', fontBtn('font', 'docFont', 'Body font')),
      rowEl('Heading font', fontBtn('headFont', 'docHeadFont', 'Heading font')),
      rowEl('Text size', seg([[14, 'S'], [16, 'M'], [18, 'L'], [20, 'XL']], setting(doc, 'size', 'docSize'), function (v) { self.setSetting('size', v); })),
      rowEl('Line spacing', seg([[1.3, 'Tight'], [1.5, 'Normal'], [1.8, 'Loose']], setting(doc, 'line', 'docLine'), function (v) { self.setSetting('line', v); })),
      rowEl('Full width', toggle(!!s.full, function (v) { self.setSetting('full', v || null); })),
      rowEl('Lock page', toggle(!!s.lock, function (v) { self.setSetting('lock', v || null); self.renderAll(); })),
      (function () {
        var b = D.el('button.link-btn', { type: 'button', text: 'Use this style for new pages' });
        D.tap(b, function () {
          K.prefs.set('docFont', setting(doc, 'font', 'docFont'));
          K.prefs.set('docHeadFont', setting(doc, 'headFont', 'docHeadFont'));
          K.prefs.set('docSize', setting(doc, 'size', 'docSize'));
          K.prefs.set('docLine', setting(doc, 'line', 'docLine'));
          sheets.toast('New pages will use this style');
        });
        return b;
      })()
    ]);
    var acts = D.el('div.pm-actions');
    function act(icon, label, fn, danger) {
      var b = D.el('button.action-item' + (danger ? '.danger' : ''), { type: 'button' }, [D.icon(icon), D.el('span', { text: label })]);
      D.tap(b, function () { m.close(); setTimeout(fn, 170); });
      acts.appendChild(b);
    }
    act('star', doc.favorite ? 'Remove from Favorites' : 'Add to Favorites', function () { Docs.update(doc.id, { favorite: !doc.favorite }, { meta: true }); self.star.classList.toggle('on', doc.favorite); });
    act('copy', 'Duplicate', function () { self.flush(); var c = Docs.duplicate(doc.id); if (c) { K.shell.openDoc(c); } });
    act('folder', 'Move to…', function () { K.shell.moveTo(doc); });
    act('plus', 'Add a sub-page', function () { self.flush(); K.shell.newPage(doc.id); });
    (K.pageMenuExtras || []).forEach(function (x) { act(x.icon, x.label, function () { self.flush(); x.run(self); }); });
    act('trash', 'Delete', function () { self.flush(); K.shell.remove(doc); }, true);
    body.appendChild(acts);
    var m = sheets.modal({ title: 'Page', body: body, cls: 'sheet-page-menu', actions: [{ label: 'Done', primary: true }] });
  };

  // Another device changed this page: show the new version (keep the caret)
  P.reloadFromRemote = function () {
    var cur = this.current, caret = -1;
    if (cur && cur.ed && cur.ed.rt(cur.id)) { caret = R.caret(cur.ed.rt(cur.id)); }
    this.lastState = this.state();
    this.renderAll();
    if (cur && caret >= 0 && this.editor.block(cur.id)) { this.editor.focus(cur.id, caret); }
  };

  P.destroy = function () {
    this.flush();
    this.destroyed = true;
    this.recordSoon.cancel();
    if (this.editor) { this.editor.destroy(); }
    if (this.dbView && this.dbView.destroy) { this.dbView.destroy(); }
    this.unbind.forEach(function (f) { f(); });
    if (K.hideSelectionBar) { K.hideSelectionBar(); }
    if (K.slashMenu) { K.slashMenu.close(); }
  };

  // ---------- screen ----------
  screen.mount = function (root, params) {
    var doc = Docs.get(params.id);
    if (!doc || !Docs.isLive(doc)) {
      var top = D.el('header.topbar.doc-top', null, [K.shell.menuButton(), D.el('div.top-title', { text: 'Not found' })]);
      var home = D.el('button.small-btn', { type: 'button', text: 'Go home' });
      D.tap(home, function () { K.router.go('#/'); });
      D.append(root, [top, D.el('div.doc-scroll', null, D.el('div.page', null, [D.el('p.empty', { text: doc ? 'This page is in the Trash.' : 'This page is not on this device yet. It will appear after the next sync.' }), home]))]);
      return;
    }
    if (doc.kind === 'canvas' && doc.settings && doc.settings.notebook) { K.router.go('#/nb/' + doc.settings.notebook + '/1'); return; }
    view = new PageView(root, doc);
    view.onRemote = function (id) {
      if (!view || id !== view.doc.id) { return; }
      var fresh = Docs.get(id);
      if (fresh && fresh !== view.doc) { view.doc = fresh; }
      view.reloadFromRemote();
    };
    K.Sync.on('remoteDoc', view.onRemote);
    K.Sync.on('docMerged', view.onRemote);
    view.onBeforeSync = function () { if (view) { view.flush(); } };
    K.Sync.on('beforeRun', view.onBeforeSync);
    view.onHide = function () { if (view) { view.flush(); } };
    K.app.on('hide', view.onHide);
    view.onDocsChange = U.debounce(function () { if (view) { view.renderBacklinks(); view.renderCrumbs(); view.star.classList.toggle('on', !!view.doc.favorite); } }, 400);
    Docs.on('change', view.onDocsChange);
  };

  screen.update = function (params) {
    return !!(view && params.id === view.doc.id);
  };

  screen.unmount = function () {
    if (!view) { return; }
    var v = view;
    view = null;
    K.Sync.off('remoteDoc', v.onRemote);
    K.Sync.off('docMerged', v.onRemote);
    K.Sync.off('beforeRun', v.onBeforeSync);
    K.app.off('hide', v.onHide);
    Docs.off('change', v.onDocsChange);
    v.onDocsChange.cancel();
    v.destroy();
  };

  K.PageView = PageView;
  K.screens = K.screens || {};
  K.screens.page = screen;
})(window.Kagoj = window.Kagoj || {});
