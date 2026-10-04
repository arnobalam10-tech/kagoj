(function (K) {
  'use strict';

  // Non-text blocks. Each view: function (block, editor, entry) -> element.
  // Optional: view.menu(block, editor) -> extra block-menu items,
  //           view.after(block, editor) -> runs right after the block is inserted.
  var D = K.dom, U = K.util, R = K.rich, Docs = K.Docs, sheets = K.sheets;
  var V = K.BlockViews = K.BlockViews || {};
  var X = K.extraSlash = K.extraSlash || [];

  // ---------- divider ----------
  V.div = function () { return D.el('div.divider', null, D.el('hr')); };
  X.push({ label: 'Divider', icon: 'minus', desc: 'Visually divide blocks', keys: 'divider hr line ---', group: 'Basic blocks', type: 'div' });

  // ---------- sub-page / link to page ----------
  function pageCard(b, ed, label) {
    var d = Docs.get(b.ref);
    var live = d && Docs.isLive(d);
    var card = D.el('button.page-link' + (live ? '' : '.gone'), { type: 'button' }, [
      live ? K.docIconEl(d) : D.el('span.doc-ico', null, D.icon('file')),
      D.el('span.pl-title', { text: live ? Docs.titleOf(d) : 'Deleted page' }),
      label ? D.el('span.pl-tag', { text: label }) : null
    ]);
    D.tap(card, function () { if (live) { K.shell.openDoc(d); } });
    return card;
  }
  V.page = function (b, ed) { return pageCard(b, ed, null); };
  V.link = function (b, ed) { return pageCard(b, ed, '↗'); };
  X.push({ label: 'Page', icon: 'file', desc: 'Embed a sub-page inside this page', keys: 'page subpage new', group: 'Basic blocks',
    run: function (ed, id) {
      var child = Docs.create({ parent_id: ed.page.doc.id });
      var b = ed.block(id);
      var nb = Docs.newBlock('page', { ref: child.id, d: b ? b.d || 0 : 0 });
      if (b && K.isTextBlock(b) && !Docs.plain(b.html)) { ed.snapshot(); ed.blocks.splice(ed.index(id), 1, nb); ed.render(); ed.changed(true); }
      else { ed.insertAfter(id, nb, false); }
      ed.page.flush();
      K.shell.openDoc(child);
    } });
  X.push({ label: 'Link to page', icon: 'link', desc: 'Link to an existing page', keys: 'link page reference', group: 'Basic blocks',
    run: function (ed, id) {
      var list = Docs.all().filter(function (d) { return d.id !== ed.page.doc.id && d.kind !== 'row' && Docs.isLive(d); })
        .sort(function (a, c) { return a.updated_at < c.updated_at ? 1 : -1; }).slice(0, 50);
      sheets.actionSheet({ title: 'Link to page', items: list.map(function (d) {
        return { label: Docs.titleOf(d), onTap: function () { ed.insertAfter(id, Docs.newBlock('link', { ref: d.id }), false); } };
      }) });
    } });

  // ---------- simple table ----------
  V.table = function (b, ed, entry) {
    if (!b.rows || !b.rows.length) { b.rows = [['', '', ''], ['', '', ''], ['', '', '']]; }
    var wrap = D.el('div.stable-wrap.scrolls-x');
    var t = D.el('table.stable' + (b.head ? '.head-row' : '') + (b.hcol ? '.head-col' : ''));
    var cells = [];
    b.rows.forEach(function (row, ri) {
      var tr = D.el('tr');
      cells[ri] = [];
      row.forEach(function (html, ci) {
        var td = D.el('td');
        var c = D.el('div.cell');
        c.innerHTML = R.clean(html);
        if (!ed.locked()) { c.setAttribute('contenteditable', 'true'); }
        D.on(c, 'input', function () { b.rows[ri][ci] = c.innerHTML; ed.changed(); });
        D.on(c, 'keydown', function (e) {
          if (e.keyCode === 9) {
            e.preventDefault();
            var n = ri * row.length + ci + (e.shiftKey ? -1 : 1);
            var r2 = Math.floor(n / row.length), c2 = n % row.length;
            if (n < 0) { return; }
            if (r2 >= b.rows.length) { addRow(); r2 = b.rows.length - 1; c2 = 0; }
            if (cells[r2] && cells[r2][c2]) { R.place(cells[r2][c2], -1); }
          } else if (e.keyCode === 13 && !e.shiftKey) {
            e.preventDefault();
            if (cells[ri + 1]) { R.place(cells[ri + 1][ci], -1); } else { addRow(); R.place(cells[ri + 1][ci], -1); }
          }
        });
        cells[ri][ci] = c;
        td.appendChild(c);
        tr.appendChild(td);
      });
      t.appendChild(tr);
    });
    function addRow() { ed.snapshot(); b.rows.push(b.rows[0].map(function () { return ''; })); ed.rerender(b.id); ed.changed(true); cells = ed.els[b.id].cells; }
    function addCol() { ed.snapshot(); b.rows.forEach(function (r) { r.push(''); }); ed.rerender(b.id); ed.changed(true); }
    entry.cells = cells;
    entry.focusEl = cells[0][0];
    wrap.appendChild(t);
    if (!ed.locked()) {
      var ar = D.el('button.tbl-add.tbl-row', { type: 'button', title: 'Add a row' }, D.icon('plus'));
      var ac = D.el('button.tbl-add.tbl-col', { type: 'button', title: 'Add a column' }, D.icon('plus'));
      D.tap(ar, addRow);
      D.tap(ac, addCol);
      return D.el('div.stable-box', null, [D.el('div.stable-inner', null, [wrap, ac]), ar]);
    }
    return D.el('div.stable-box', null, wrap);
  };
  V.table.menu = function (b, ed) {
    function upd(fn) { return function () { ed.snapshot(); fn(); ed.rerender(b.id); ed.changed(true); }; }
    return [
      { label: b.head ? 'Header row off' : 'Header row on', icon: 'table', onTap: upd(function () { b.head = !b.head; }) },
      { label: b.hcol ? 'Header column off' : 'Header column on', icon: 'table', onTap: upd(function () { b.hcol = !b.hcol; }) },
      { label: 'Delete last row', icon: 'minus', onTap: upd(function () { if (b.rows.length > 1) { b.rows.pop(); } }) },
      { label: 'Delete last column', icon: 'minus', onTap: upd(function () { if (b.rows[0].length > 1) { b.rows.forEach(function (r) { r.pop(); }); } }) }
    ];
  };
  X.push({ label: 'Table', icon: 'table', desc: 'A simple grid of text', keys: 'table grid simple', group: 'Basic blocks', type: 'table',
    extra: function () { return { rows: [['', '', ''], ['', '', ''], ['', '', '']], head: true }; } });

  // ---------- columns ----------
  V.cols = function (b, ed) {
    if (!b.cols || !b.cols.length) { b.cols = [[Docs.newBlock('p')], [Docs.newBlock('p')]]; }
    var row = D.el('div.cols');
    b.cols.forEach(function (list) {
      if (!list.length) { list.push(Docs.newBlock('p')); }
      var col = D.el('div.col');
      col.style.width = (100 / b.cols.length) + '%';
      var sub = new K.Editor(ed.page, list, col, true);
      sub.render();
      ed.children.push(sub);
      row.appendChild(col);
    });
    return row;
  };
  V.cols.menu = function (b, ed) {
    return [
      { label: 'Add a column', icon: 'plus', onTap: function () { if (b.cols.length < 5) { ed.snapshot(); b.cols.push([Docs.newBlock('p')]); ed.rerender(b.id); ed.changed(true); } } },
      { label: 'Remove the last column', icon: 'minus', onTap: function () {
        if (b.cols.length < 2) { return; }
        ed.snapshot();
        var last = b.cols.pop();
        b.cols[b.cols.length - 1] = b.cols[b.cols.length - 1].concat(last.filter(function (x) { return !K.isTextBlock(x) || Docs.plain(x.html); }));
        ed.rerender(b.id); ed.changed(true);
      } },
      { label: 'Unwrap columns (stack the content)', icon: 'list', onTap: function () {
        ed.snapshot();
        var i = ed.index(b.id), flat = [];
        b.cols.forEach(function (list) { list.forEach(function (x) { x.d = (x.d || 0) + (b.d || 0); flat.push(x); }); });
        Array.prototype.splice.apply(ed.blocks, [i, 1].concat(flat));
        ed.render(); ed.changed(true);
      } }
    ];
  };
  [2, 3, 4].forEach(function (n) {
    X.push({ label: n + ' columns', icon: 'columns', desc: 'Side-by-side columns', keys: 'columns layout side ' + n, group: 'Layout', type: 'cols',
      avail: function () { return true; },
      extra: function () { var c = []; for (var i = 0; i < n; i++) { c.push([Docs.newBlock('p')]); } return { cols: c }; } });
  });

  // ---------- code ----------
  var LANGS = ['plain', 'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'php', 'ruby', 'swift', 'kotlin', 'sql', 'html', 'css', 'json', 'bash', 'markdown'];
  V.code = function (b, ed, entry) {
    var box = D.el('div.code-box');
    var lang = D.el('button.code-lang', { type: 'button', text: b.lang || 'plain' });
    D.tap(lang, function () {
      if (ed.locked()) { return; }
      sheets.actionSheet({ title: 'Language', items: LANGS.map(function (l) {
        return { label: l, checked: (b.lang || 'plain') === l, onTap: function () { b.lang = l; ed.rerender(b.id); ed.changed(true); } };
      }) });
    });
    var copy = D.el('button.code-copy', { type: 'button', text: 'Copy' });
    D.tap(copy, function () { K.copyText(b.text || ''); });
    var pre = D.el('pre.code');
    function show() { pre.innerHTML = K.highlight(b.text || '', b.lang || 'plain') || '<span class="code-ph">Code</span>'; }
    show();
    if (!ed.locked()) {
      pre.setAttribute('contenteditable', 'true');
      pre.setAttribute('spellcheck', 'false');
      D.on(pre, 'focus', function () { pre.textContent = b.text || ''; });
      D.on(pre, 'blur', function () { show(); });
      D.on(pre, 'input', function () { b.text = pre.textContent; ed.changed(); });
      D.on(pre, 'keydown', function (e) {
        if (e.keyCode === 13 && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); document.execCommand('insertText', false, '\n'); }
        else if (e.keyCode === 9) { e.preventDefault(); document.execCommand('insertText', false, '  '); }
        else if (e.keyCode === 13) { e.preventDefault(); ed.insertAfter(b.id, Docs.newBlock('p', { d: b.d || 0 }), true); }
      });
      D.on(pre, 'paste', function (e) {
        var cd = e.clipboardData;
        if (!cd) { return; }
        e.preventDefault();
        document.execCommand('insertText', false, cd.getData('text/plain'));
      });
    }
    entry.focusEl = pre;
    D.append(box, [D.el('div.code-head', null, [lang, D.el('div.spacer'), copy]), pre]);
    return box;
  };
  X.push({ label: 'Code', icon: 'code', desc: 'Code with syntax colours', keys: 'code snippet program ```', group: 'Basic blocks', type: 'code',
    extra: function () { return { text: '', lang: 'plain' }; } });

  K.copyText = function (text) {
    var ta = D.el('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); sheets.toast('Copied'); } catch (e) { sheets.toast('Select the text to copy it'); }
    D.remove(ta);
  };

  // ---------- table of contents / breadcrumb ----------
  V.toc = function (b, ed) {
    var box = D.el('div.toc');
    var heads = [];
    Docs.eachBlock(ed.page.doc.content, function (x) { if (/^h[123]$/.test(x.type) && Docs.plain(x.html)) { heads.push(x); } });
    if (!heads.length) { box.appendChild(D.el('div.toc-empty', { text: 'Add headings to build a table of contents.' })); }
    heads.forEach(function (h) {
      var a = D.el('button.toc-item.toc-' + h.type, { type: 'button', text: Docs.plain(h.html) });
      D.tap(a, function () { ed.page.scrollToBlock(h.id); });
      box.appendChild(a);
    });
    return box;
  };
  X.push({ label: 'Table of contents', icon: 'list', desc: 'Links to the headings on this page', keys: 'toc contents outline', group: 'Advanced', type: 'toc' });
  V.crumb = function (b, ed) {
    var box = D.el('div.crumb-block');
    Docs.path(ed.page.doc.id).forEach(function (d, i) {
      if (i) { box.appendChild(D.el('span.cb-sep', { text: '/' })); }
      var a = D.el('button.cb-link', { type: 'button', text: Docs.titleOf(d) });
      D.tap(a, function () { K.shell.openDoc(d); });
      box.appendChild(a);
    });
    return box;
  };
  X.push({ label: 'Breadcrumb', icon: 'chevron-right', desc: 'Where this page sits', keys: 'breadcrumb path', group: 'Advanced', type: 'crumb' });

  // ---------- image ----------
  V.image = function (b, ed, entry) {
    var box = D.el('div.img-block.align-' + (b.align || 'center'));
    if (!b.asset) {
      var pick = D.el('label.btn.small-btn.img-pick', null, [D.icon('upload'), D.el('span.btn-label', { text: 'Add an image' })]);
      var input = D.el('input.file-input', { type: 'file', accept: 'image/*' });
      pick.appendChild(input);
      D.on(input, 'change', function () {
        var f = input.files && input.files[0];
        if (!f) { return; }
        pick.querySelector('.btn-label').textContent = 'Uploading…';
        K.uploadMedia(f, true, function (err, res) {
          if (err) { pick.querySelector('.btn-label').textContent = 'Add an image'; sheets.toast(err.message || String(err), 4000); return; }
          b.asset = res.asset; b.ratio = res.h / res.w;
          ed.rerender(b.id);
          ed.changed(true);
        });
      });
      box.appendChild(ed.locked() ? D.el('div.img-empty', { text: 'Empty image' }) : pick);
      return box;
    }
    var frame = D.el('div.img-frame');
    frame.style.width = (b.w || 100) + '%';
    var ph = D.el('div.img-ph');
    ph.style.paddingTop = ((b.ratio || 0.6) * 100) + '%';
    frame.appendChild(ph);
    K.Assets.get(b.asset, function (err, img) {
      if (err) { ph.classList.add('err'); ph.setAttribute('data-msg', 'Image not available offline'); return; }
      var el = D.el('img.img-el', { alt: '' });
      el.src = img.src;
      frame.replaceChild(el, ph);
    });
    if (!ed.locked()) {
      var grip = D.el('div.img-resize');
      frame.appendChild(grip);
      var sx = 0, sw = 0;
      var move = function (x) { var pw = box.clientWidth || 1; b.w = U.clamp(Math.round(sw + (x - sx) / pw * 200), 15, 100); frame.style.width = b.w + '%'; };
      D.on(grip, 'touchstart', function (e) { e.stopPropagation(); sx = e.touches[0].clientX; sw = b.w || 100; }, D.passiveFalse);
      D.on(grip, 'touchmove', function (e) { if (e.cancelable) { e.preventDefault(); } move(e.touches[0].clientX); }, D.passiveFalse);
      D.on(grip, 'touchend', function () { ed.changed(true); });
      D.on(grip, 'mousedown', function (e) {
        e.preventDefault(); sx = e.clientX; sw = b.w || 100;
        function mm(ev) { move(ev.clientX); }
        function mu() { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); ed.changed(true); }
        window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
      });
    }
    box.appendChild(frame);
    var cap = D.el('div.img-cap', { 'data-ph': ed.locked() ? '' : 'Add a caption' });
    cap.innerHTML = R.clean(b.caption || '');
    if (!ed.locked()) {
      cap.setAttribute('contenteditable', 'true');
      D.on(cap, 'input', function () { b.caption = cap.innerHTML; ed.changed(); });
    }
    box.appendChild(cap);
    return box;
  };
  V.image.menu = function (b, ed) {
    function al(a) { return function () { b.align = a; ed.rerender(b.id); ed.changed(true); }; }
    return [
      { label: 'Align left', icon: 'chevron-left', onTap: al('left') },
      { label: 'Align centre', icon: 'minus', onTap: al('center') },
      { label: 'Align right', icon: 'chevron-right', onTap: al('right') },
      { label: 'Replace image', icon: 'upload', onTap: function () { delete b.asset; ed.rerender(b.id); ed.changed(true); } }
    ];
  };
  X.push({ label: 'Image', icon: 'image', desc: 'Upload a photo or picture', keys: 'image photo picture upload', group: 'Media', type: 'image' });

  // ---------- file ----------
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  V.file = function (b, ed) {
    if (!b.asset) {
      var pick = D.el('label.btn.small-btn.img-pick', null, [D.icon('upload'), D.el('span.btn-label', { text: 'Attach a file' })]);
      var input = D.el('input.file-input', { type: 'file' });
      pick.appendChild(input);
      D.on(input, 'change', function () {
        var f = input.files && input.files[0];
        if (!f) { return; }
        if (f.size > 50 * 1048576) { sheets.toast('Files can be up to 50 MB on the free plan.', 4000); return; }
        pick.querySelector('.btn-label').textContent = 'Uploading…';
        K.uploadMedia(f, false, function (err, res) {
          if (err) { pick.querySelector('.btn-label').textContent = 'Attach a file'; sheets.toast(err.message || String(err), 4000); return; }
          b.asset = res.asset; b.name = f.name; b.size = f.size;
          ed.rerender(b.id);
          ed.changed(true);
        });
      });
      return ed.locked() ? D.el('div.img-empty', { text: 'Empty file' }) : pick;
    }
    var row = D.el('button.file-row', { type: 'button' }, [D.icon('file'), D.el('span.fr-name', { text: b.name || 'File' }), D.el('span.fr-size', { text: b.size ? fmtSize(b.size) : '' })]);
    D.tap(row, function () {
      sheets.toast('Opening…');
      K.sb.storageSign(b.asset, function (err, url) {
        if (err) { sheets.toast('Could not open the file. ' + K.sb.describeError(err), 4000); return; }
        window.open(url, '_blank');
      });
    });
    return row;
  };
  X.push({ label: 'File', icon: 'file', desc: 'Attach any file (up to 50 MB)', keys: 'file attachment upload pdf doc', group: 'Media', type: 'file' });

  // ---------- web bookmark ----------
  V.bookmark = function (b, ed) {
    if (!b.url) {
      var input = D.el('input.text-input.bm-input', { type: 'url', placeholder: 'Paste a link and press Enter', autocapitalize: 'off', autocorrect: 'off' });
      D.on(input, 'keydown', function (e) {
        if (e.keyCode !== 13) { return; }
        e.preventDefault();
        var u = input.value.replace(/^\s+|\s+$/g, '');
        if (!u) { return; }
        if (!/^https?:\/\//i.test(u)) { u = 'https://' + u; }
        b.url = u; b.title = u;
        ed.rerender(b.id);
        ed.changed(true);
        K.fetchPreview(u, function (err, info) {
          if (err || !info) { return; }
          b.title = info.title || u; b.desc = info.description || ''; b.site = info.site || '';
          ed.rerender(b.id);
          ed.changed(true);
        });
      });
      return ed.locked() ? D.el('div.img-empty', { text: 'Empty bookmark' }) : input;
    }
    var card = D.el('a.bookmark', { href: b.url, target: '_blank', rel: 'noopener noreferrer' }, [
      D.el('span.bm-title', { text: b.title || b.url }),
      b.desc ? D.el('span.bm-desc', { text: b.desc }) : null,
      D.el('span.bm-url', { text: b.url })
    ]);
    return card;
  };
  X.push({ label: 'Web bookmark', icon: 'link', desc: 'A link with a title and preview', keys: 'bookmark link url web', group: 'Media', type: 'bookmark',
    extra: function () { return { url: '' }; } });

  K.fetchPreview = function (url, cb) {
    if (!K.sb.isLoggedIn()) { cb(new Error('offline')); return; }
    K.sb.fn('kagoj-link', { url: url }, function (err, data) { cb(err, data); });
  };

  // ---------- sketch (handwriting inside a typed page) ----------
  V.sketch = function (b, ed) {
    var d = Docs.get(b.ref);
    var nbId = d && d.settings ? d.settings.notebook : null;
    var nb = nbId ? K.Repo.notebook(nbId) : null;
    var box = D.el('button.sketch', { type: 'button' });
    var cv = D.el('canvas.sketch-cv');
    var label = D.el('span.sk-label', { text: nb ? (nb.title || 'Sketch') + ' · tap to draw' : 'Sketch not available' });
    D.append(box, [cv, label]);
    D.tap(box, function () { if (nb) { K.router.go('#/nb/' + nb.id + '/1'); } });
    if (nb) {
      var first = K.Repo.pagesOf(nb.id)[0];
      if (first) {
        K.app.need('canvas', function (err) {
          if (err || !K.render) { return; }
          K.Repo.loadDrawing(first.id, function (e2, drawing) {
            if (e2 || !drawing) { return; }
            var w = box.clientWidth || 600, pw = drawing.w || 1000, ph = drawing.h || 1414;
            // show the top part of the page that has ink
            var strokes = K.codec.decode(drawing), maxY = 200;
            strokes.forEach(function (s) { maxY = Math.max(maxY, s.bb.maxY + 20); });
            maxY = Math.min(ph, maxY);
            var h = Math.round(w * maxY / pw);
            var dpr = U.dpr();
            K.render.sizeCanvas(cv, w, h, dpr);
            var ctx = cv.getContext('2d');
            var vp = { w: w, h: h, scale: w / pw, ox: 0, oy: 0, pw: pw, ph: ph };
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = K.Theme.isDark() ? '#252525' : '#FDFCF8';
            ctx.fillRect(0, 0, w, h);
            ctx.save(); K.render.pageTransform(ctx, vp, dpr); ctx.globalAlpha = 0.4; K.render.strokes(ctx, strokes, 'h', null); ctx.restore();
            ctx.save(); K.render.pageTransform(ctx, vp, dpr); K.render.strokes(ctx, strokes, 'p', null); ctx.restore();
          });
        });
      }
    }
    return box;
  };
  X.push({ label: 'Sketch (handwriting)', icon: 'pen', desc: 'Draw or write by hand inside this page', keys: 'sketch draw handwriting pen ink canvas', group: 'Media',
    run: function (ed, id) {
      var res = K.Repo.createNotebook({ title: 'Sketch', cover_color: '#2F3640', default_paper: 'blank' });
      var cdoc = Docs.create({ parent_id: ed.page.doc.id, kind: 'canvas', title: 'Sketch', icon: '✍️', content: [], settings: { notebook: res.notebook.id, sketch: true } });
      var b = ed.block(id);
      var nb = Docs.newBlock('sketch', { ref: cdoc.id, d: b ? b.d || 0 : 0 });
      if (b && K.isTextBlock(b) && !Docs.plain(b.html)) { ed.snapshot(); ed.blocks.splice(ed.index(id), 1, nb); ed.render(); ed.changed(true); }
      else { ed.insertAfter(id, nb, false); }
      ed.page.flush();
      K.router.go('#/nb/' + res.notebook.id + '/1');
    } });

  // ---------- uploads for image / file blocks ----------
  K.uploadMedia = function (file, isImage, cb) {
    var uid = K.sb.userId();
    if (!K.sb.isLoggedIn() || !uid) { cb(new Error('Log in to add images and files.')); return; }
    if (navigator.onLine === false) { cb(new Error('No internet connection')); return; }
    var id = U.uuid();
    if (!isImage) {
      var safe = String(file.name || 'file').replace(/[^\w.\-]+/g, '_').substr(-80);
      var path = uid + '/files/' + id + '/' + safe;
      K.sb.storageUpload(path, file, file.type || 'application/octet-stream', function (err) {
        cb(err || null, err ? null : { asset: path });
      });
      return;
    }
    var fr = new window.FileReader();
    fr.onerror = function () { cb(new Error('Could not read the image')); };
    fr.onload = function () {
      var img = new Image();
      img.onerror = function () { img.onload = img.onerror = null; cb(new Error('This image format is not supported')); };
      img.onload = function () {
        img.onload = img.onerror = null;
        var sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
        var w = Math.min(1600, sw), h = Math.round(sh * w / sw);
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var x = c.getContext('2d');
        x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, w, h);
        x.drawImage(img, 0, 0, w, h);
        var dataUrl = c.toDataURL('image/jpeg', 0.85);
        c.width = 0; c.height = 0; img.src = '';
        var parts = dataUrl.split(','), bin = window.atob(parts[1]), u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) { u8[i] = bin.charCodeAt(i); }
        var path = uid + '/media/' + id + '.jpg';
        K.sb.storageUpload(path, new window.Blob([u8], { type: 'image/jpeg' }), 'image/jpeg', function (err) {
          if (err) { cb(err); return; }
          K.Assets.putDataUrl(path, dataUrl);
          cb(null, { asset: path, w: w, h: h });
        });
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  };

  // ---------- syntax highlighting (small, works on the iPad 2) ----------
  var KW = {
    javascript: 'var let const function return if else for while do switch case break continue new this class extends import export from default try catch finally throw typeof instanceof in of async await yield null undefined true false',
    python: 'def return if elif else for while in not and or is import from as class try except finally raise with lambda pass break continue yield None True False self global nonlocal async await',
    c: 'int char float double long short unsigned signed void return if else for while do switch case break continue struct union enum typedef static const sizeof include define NULL true false',
    java: 'public private protected class interface extends implements static final void int long double float boolean char byte short return if else for while do switch case break continue new this super try catch finally throw throws import package null true false',
    sql: 'select from where and or not insert into values update set delete create table drop alter join left right inner outer on group by order having limit as distinct count sum avg min max null is in like between union primary key',
    bash: 'if then else elif fi for while do done case esac function return echo export local cd ls rm mv cp sudo in',
    go: 'func package import var const type struct interface map chan go defer return if else for range switch case break continue select nil true false',
    rust: 'fn let mut const struct enum impl trait pub use mod match if else for while loop return break continue self Self true false None Some Ok Err',
    php: 'function return if else elseif foreach for while class public private protected static new echo use namespace null true false array',
    ruby: 'def end if elsif else unless while until for in do return class module require nil true false self yield',
    css: 'important',
    html: ''
  };
  KW.typescript = KW.javascript + ' interface type enum implements private public readonly';
  KW.cpp = KW.c + ' class public private protected namespace using template typename new delete virtual override nullptr bool std';
  KW.csharp = KW.java + ' using namespace var string bool async await get set';
  KW.swift = 'func let var return if else for while in guard switch case class struct enum protocol import self nil true false';
  KW.kotlin = 'fun val var return if else for while when class object interface import null true false';
  KW.json = 'true false null';
  var KWSETS = {};
  function kwSet(lang) {
    if (!KWSETS[lang]) { var s = {}; (KW[lang] || '').split(' ').forEach(function (w) { if (w) { s[w] = 1; } }); KWSETS[lang] = s; }
    return KWSETS[lang];
  }
  K.highlight = function (src, lang) {
    if (!src) { return ''; }
    if (lang === 'plain' || lang === 'markdown') { return R.esc(src); }
    if (lang === 'html') {
      return R.esc(src).replace(/(&lt;\/?)([a-zA-Z0-9\-]+)/g, '$1<span class="tk-k">$2</span>').replace(/([a-zA-Z\-]+)=(&quot;[^&]*&quot;)/g, '<span class="tk-a">$1</span>=<span class="tk-s">$2</span>');
    }
    var kws = kwSet(lang);
    var hashComment = lang === 'python' || lang === 'bash' || lang === 'ruby';
    var re = hashComment
      ? /(#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g
      : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|--[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)/g;
    if (lang === 'css') { re = /(\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms)?\b)|([a-zA-Z\-]+)(?=\s*:)/g; }
    var out = '', last = 0, m;
    while ((m = re.exec(src))) {
      out += R.esc(src.substring(last, m.index));
      if (m[1]) { out += '<span class="tk-c">' + R.esc(m[1]) + '</span>'; }
      else if (m[2]) { out += '<span class="tk-s">' + R.esc(m[2]) + '</span>'; }
      else if (m[3]) { out += '<span class="tk-n">' + R.esc(m[3]) + '</span>'; }
      else if (m[4]) {
        var w = m[4];
        out += (kws[w] || kws[w.toLowerCase()] && lang === 'sql') ? '<span class="tk-k">' + R.esc(w) + '</span>' : (lang === 'css' ? '<span class="tk-a">' + R.esc(w) + '</span>' : R.esc(w));
      }
      last = re.lastIndex;
    }
    return out + R.esc(src.substr(last));
  };
})(window.Kagoj = window.Kagoj || {});
