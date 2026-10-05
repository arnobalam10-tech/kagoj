(function (K) {
  'use strict';

  // V2 extras: version history, page templates, template buttons, math,
  // diagrams, import / export, print, keyboard shortcuts.
  var D = K.dom, U = K.util, Docs = K.Docs, R = K.rich, sheets = K.sheets;
  var V = K.BlockViews = K.BlockViews || {};
  var X = K.extraSlash = K.extraSlash || [];
  var M = K.pageMenuExtras = K.pageMenuExtras || [];

  function loadScript(src, test, cb) {
    if (test()) { cb(null); return; }
    var s = document.createElement('script');
    s.src = src;
    s.onload = function () { cb(test() ? null : new Error('Could not start ' + src)); };
    s.onerror = function () { cb(new Error('Could not load this part. Check the connection.')); };
    document.body.appendChild(s);
  }
  function loadCss(href) {
    if (document.querySelector('link[href="' + href + '"]')) { return; }
    document.getElementsByTagName('head')[0].appendChild(D.el('link', { rel: 'stylesheet', href: href }));
  }

  // ---------- version history ----------

  function fmtWhen(iso) { var t = U.parseTime(iso), d = new Date(t); return K.dateLabel(K.isoDay(d)) + ', ' + K.timeLabel(t); }

  function blockText(b) {
    var t = b.html ? Docs.plain(b.html) : (b.text || '');
    var pre = { h1: '# ', h2: '## ', h3: '### ', bul: '\u2022 ', num: '1. ', todo: b.checked ? '\u2611 ' : '\u2610 ', quote: '\u201c ' }[b.type] || '';
    if (b.type === 'div') { return '\u2014\u2014\u2014'; }
    if (b.type === 'image') { return '[image]'; }
    if (b.type === 'table') { return (b.rows || []).map(function (r) { return r.map(function (c) { return Docs.plain(c); }).join(' | '); }).join('\n'); }
    if (b.type === 'cols') { return (b.cols || []).map(function (l) { return l.map(blockText).join('\n'); }).join('\n'); }
    return new Array((b.d || 0) + 1).join('   ') + pre + t;
  }

  function history(page) {
    var doc = page.doc;
    if (!K.sb.isLoggedIn()) { sheets.toast('Log in to see older versions.', 4000); return; }
    var list = D.el('div.vh-list', null, D.el('p.set-sub', { text: 'Loading\u2026' }));
    var m = sheets.modal({ title: 'Version history', body: list, cls: 'sheet-prop', actions: [{ label: 'Close', primary: true }] });
    K.sb.rest('GET', 'doc_versions?doc_id=eq.' + encodeURIComponent(doc.id) + '&select=id,title,created_at&order=created_at.desc&limit=40', {}, function (err, rows) {
      D.empty(list);
      if (err) { list.appendChild(D.el('p.set-sub', { text: 'Could not load versions. Check the connection.' })); return; }
      if (!rows || !rows.length) { list.appendChild(D.el('p.set-sub', { text: 'No saved versions yet. Kagoj keeps a version at most every 10 minutes while you edit (after it syncs).' })); return; }
      rows.forEach(function (v) {
        var b = D.el('button.opt-row.vh-row', { type: 'button' }, [D.el('span.vh-when', { text: fmtWhen(v.created_at) }), D.el('span.vh-title', { text: v.title || 'Untitled' })]);
        D.tap(b, function () { m.close(); preview(page, v); });
        list.appendChild(b);
      });
    });
  }

  function preview(page, v) {
    var box = D.el('pre.vh-preview', { text: 'Loading\u2026' });
    var got = null;
    sheets.modal({ title: fmtWhen(v.created_at), body: box, cls: 'sheet-prop', actions: [
      { label: 'Back', onTap: function () { setTimeout(function () { history(page); }, 180); } },
      { label: 'Restore this version', primary: true, onTap: function () {
        if (!got) { return false; }
        page.snapshot();
        page.undoStack.push(page.lastState);
        page.applyState(JSON.stringify({ c: got.content || [], t: got.title || '' }));
        sheets.toast('Restored. Undo brings the newer text back.', 4000);
      } }
    ] });
    K.sb.rest('GET', 'doc_versions?id=eq.' + encodeURIComponent(v.id) + '&select=title,content', {}, function (err, rows) {
      if (err || !rows || !rows[0]) { box.textContent = 'Could not load this version.'; return; }
      got = rows[0];
      box.textContent = (got.title || 'Untitled') + '\n\n' + (got.content || []).map(blockText).join('\n');
    });
  }

  M.push({ icon: 'clock', label: 'Version history', run: history, when: function (p) { return p.doc.kind !== 'canvas'; } });

  // ---------- page templates ----------

  function isTpl(d) { return !!(d.settings && d.settings.pageTemplate); }
  K.pageTemplates = function () { return Docs.all().filter(function (d) { return Docs.isLive(d) && isTpl(d); }).sort(function (a, b) { return Docs.titleOf(a) < Docs.titleOf(b) ? -1 : 1; }); };

  K.newFromTemplate = function (tpl, parentId) {
    var c = Docs.duplicate(tpl.id, parentId || K.shell.defaultParent());
    if (!c) { return null; }
    var s = U.copy(c.settings || {}); delete s.pageTemplate;
    Docs.update(c.id, { title: tpl.title, settings: s, favorite: false, position: Docs.positionAt(c.parent_id, null) }, { meta: true });
    K.shell.openDoc(c);
    return c;
  };

  M.push({ icon: 'page-add', label: 'Use as a template', when: function (p) { return p.doc.kind === 'page' && !isTpl(p.doc); }, run: function (p) {
    var s = U.copy(p.doc.settings || {}); s.pageTemplate = true;
    Docs.update(p.doc.id, { settings: s }, { meta: true });
    sheets.toast('Saved as a template. Pick it from Templates in the sidebar or with /template.', 4500);
  } });
  M.push({ icon: 'page-add', label: 'Stop using as a template', when: function (p) { return isTpl(p.doc); }, run: function (p) {
    var s = U.copy(p.doc.settings || {}); delete s.pageTemplate;
    Docs.update(p.doc.id, { settings: s }, { meta: true });
  } });

  K.templatePicker = function (parentId) {
    var tpls = K.pageTemplates();
    if (!tpls.length) { sheets.toast('No templates yet. Open a page \u203a \u2022\u2022\u2022 \u203a Use as a template.', 5000); return; }
    sheets.actionSheet({ title: 'New page from template', items: tpls.map(function (t) {
      return { label: Docs.titleOf(t), onTap: function () { K.newFromTemplate(t, parentId); } };
    }) });
  };
  X.push({ label: 'Page from template', icon: 'page-add', desc: 'A new sub-page from one of your templates', keys: 'template page', group: 'Basic blocks',
    run: function (ed, id) {
      var tpls = K.pageTemplates();
      if (!tpls.length) { sheets.toast('No templates yet. Open a page \u203a \u2022\u2022\u2022 \u203a Use as a template.', 5000); return; }
      sheets.actionSheet({ title: 'Template', items: tpls.map(function (t) {
        return { label: Docs.titleOf(t), onTap: function () {
          ed.page.flush();
          var c = Docs.duplicate(t.id, ed.page.doc.id);
          var s = U.copy(c.settings || {}); delete s.pageTemplate;
          Docs.update(c.id, { title: t.title, settings: s }, { meta: true });
          ed.insertAfter(id, Docs.newBlock('page', { ref: c.id }), false);
          ed.page.flush();
        } };
      }) });
    } });

  // ---------- template button: copies the blocks indented under it ----------

  function subtree(ed, b) {
    var i = ed.index(b.id), out = [];
    for (var j = i + 1; j < ed.blocks.length && (ed.blocks[j].d || 0) > (b.d || 0); j++) { out.push(ed.blocks[j]); }
    return out;
  }
  function cloneBlock(x, shift) {
    var c = JSON.parse(JSON.stringify(x));
    function ids(o) {
      o.id = Docs.blockId();
      if (o.cols) { o.cols.forEach(function (l) { l.forEach(ids); }); }
    }
    ids(c);
    c.d = Math.max(0, (c.d || 0) - shift);
    if (c.type === 'todo') { c.checked = false; }
    return c;
  }
  V.tbtn = function (b, ed) {
    var box = D.el('div.tbtn-box');
    var btn = D.el('button.tbtn', { type: 'button' }, [D.icon('plus'), D.el('span', { text: b.label || 'Add item' })]);
    D.tap(btn, function () {
      var kids = subtree(ed, b);
      if (!kids.length) { sheets.toast('Indent blocks under the button (Tab) to make what it adds.', 4500); return; }
      ed.snapshot();
      var at = ed.index(kids[kids.length - 1].id) + 1;
      var copies = kids.map(function (x) { return cloneBlock(x, 1); });
      // keep the new copies at the button's level, dates in text become today
      copies.forEach(function (c) { if (c.html) { c.html = c.html.replace(/data-date="[0-9\-]{10}/g, 'data-date="' + K.isoDay(new Date())); } });
      Array.prototype.splice.apply(ed.blocks, [at, 0].concat(copies));
      ed.render();
      ed.changed(true);
      if (copies[0] && K.isTextBlock(copies[0])) { ed.focus(copies[0].id); }
    });
    var edit = D.el('button.tbtn-edit', { type: 'button', title: 'Rename button' }, D.icon('edit'));
    D.tap(edit, function () {
      if (ed.locked()) { return; }
      sheets.prompt({ title: 'Button label', value: b.label || 'Add item' }, function (v) { if (v !== null) { ed.snapshot(); b.label = v.substr(0, 80); ed.rerender(b.id); ed.changed(true); } });
    });
    D.append(box, [btn, edit, D.el('span.tbtn-hint', { text: 'copies the blocks indented below' })]);
    return box;
  };
  V.tbtn.after = function (b, ed) {
    // start with an indented to-do so it works right away
    ed.insertAfter(b.id, Docs.newBlock('todo', { d: (b.d || 0) + 1 }), true);
  };
  X.push({ label: 'Template button', icon: 'plus', desc: 'A button that adds a copy of the blocks under it', keys: 'template button repeat', group: 'Advanced', type: 'tbtn',
    extra: function () { return { label: 'Add item' }; } });

  // ---------- math (KaTeX) ----------

  function katex(cb) {
    loadCss('/vendor/katex/katex.min.css');
    loadScript('/vendor/katex/katex.min.js', function () { return !!window.katex; }, cb);
  }
  // KaTeX and Mermaid need a modern browser (classes, arrows). The old iPad shows the
  // result saved by a device that could draw it.
  var modernJs = (function () { try { return !!new Function('class A {}; var f = (x) => x; return 1;')(); } catch (e) { return false; } })();

  // saved equation markup is shown with innerHTML: keep only plain markup
  function cleanHtml(html) {
    try {
      var doc = document.implementation.createHTMLDocument('');
      var box = doc.createElement('div');
      box.innerHTML = html;
      Array.prototype.slice.call(box.querySelectorAll('script, iframe, object, embed, link, meta, style, img, a, form, input')).forEach(function (n) { n.parentNode.removeChild(n); });
      Array.prototype.slice.call(box.querySelectorAll('*')).forEach(function (n) {
        Array.prototype.slice.call(n.attributes).forEach(function (at) {
          var nm = at.name.toLowerCase(), v = String(at.value).replace(/\s+/g, '').toLowerCase();
          if (nm.indexOf('on') === 0 || nm === 'href' || nm === 'xlink:href' || nm === 'src' || (nm === 'style' && /url\(|expression|javascript:/.test(v))) { n.removeAttribute(at.name); }
        });
      });
      return box.innerHTML.substr(0, 200000);
    } catch (e) { return ''; }
  }

  V.math = function (b, ed, entry) {
    var box = D.el('div.math-box');
    var out = D.el('div.math-out');
    var src = D.el('textarea.math-src', { rows: 2, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', placeholder: 'LaTeX, e.g. E = mc^2 or \\frac{a}{b}' });
    src.value = b.tex || '';
    function show() {
      if (!b.tex) { out.textContent = 'Tap to write an equation'; out.className = 'math-out ph'; return; }
      out.className = 'math-out';
      if (!modernJs) {
        loadCss('/vendor/katex/katex.min.css');
        if (b.out && b.outTex === b.tex) { out.innerHTML = cleanHtml(b.out); } else { out.className = 'math-out raw'; out.textContent = b.tex; }
        return;
      }
      katex(function (err) {
        if (err) { out.textContent = b.tex; return; }
        try {
          window.katex.render(b.tex, out, { displayMode: true, throwOnError: false, trust: false, maxSize: 50, maxExpand: 500, output: 'html' });
          if (b.outTex !== b.tex) { b.out = cleanHtml(out.innerHTML); b.outTex = b.tex; ed.changed(); }
        } catch (e) { out.textContent = b.tex; }
      });
    }
    function editing(on) { box.classList.toggle('editing', on); if (on) { src.focus(); } }
    D.tap(out, function () { if (!ed.locked()) { editing(true); } });
    D.on(src, 'input', function () { b.tex = src.value.substr(0, 5000); show(); ed.changed(); });
    D.on(src, 'blur', function () { editing(false); });
    D.on(src, 'keydown', function (e) { if (e.keyCode === 13 && !e.shiftKey) { e.preventDefault(); editing(false); ed.insertAfter(b.id, Docs.newBlock('p', { d: b.d || 0 }), true); } else if (e.keyCode === 27) { src.blur(); } });
    show();
    entry.focusEl = src;
    D.append(box, [out, src]);
    if (!modernJs) { box.appendChild(D.el('div.math-note', { text: 'This device shows equations saved on a computer or phone. Edits here appear as code until opened there.' })); }
    return box;
  };
  V.math.after = function (b, ed) { var e = ed.els[b.id]; if (e) { e.wrap.querySelector('.math-box').classList.add('editing'); setTimeout(function () { e.focusEl.focus(); }, 30); } };
  X.push({ label: 'Equation', icon: 'function', desc: 'Math with LaTeX (KaTeX)', keys: 'math equation latex katex formula tex', group: 'Advanced', type: 'math', extra: function () { return { tex: '' }; } });

  // ---------- diagrams (Mermaid; drawn on PC/phone, the picture is saved for the iPad) ----------

  // saved diagram pictures are shown with innerHTML: keep only drawing markup
  function cleanSvg(svg) {
    try {
      // Mermaid writes HTML-style <br> inside labels, so parse as HTML (an inert document)
      var doc = document.implementation.createHTMLDocument('');
      var holder = doc.createElement('div');
      holder.innerHTML = svg;
      var root = holder.querySelector('svg');
      if (!root) { return ''; }
      Array.prototype.slice.call(root.querySelectorAll('style')).forEach(function (st) { st.textContent = st.textContent.replace(/@import[^;]*;?|url\([^)]*\)|expression\s*\(/gi, ''); });
      Array.prototype.slice.call(root.querySelectorAll('script, iframe, object, embed, link, meta, animate, set')).forEach(function (n) { n.parentNode.removeChild(n); });
      Array.prototype.slice.call(root.querySelectorAll('*')).concat([root]).forEach(function (n) {
        Array.prototype.slice.call(n.attributes).forEach(function (a) {
          var nm = a.name.toLowerCase(), v = String(a.value).replace(/\s+/g, '').toLowerCase();
          if (nm.indexOf('on') === 0 || ((nm === 'href' || nm === 'xlink:href' || nm === 'src') && !/^#/.test(v))) { n.removeAttribute(a.name); }
          if (nm === 'style' && /url\(|expression|javascript:/.test(v)) { n.removeAttribute(a.name); }
        });
      });
      while (holder.firstChild) { holder.removeChild(holder.firstChild); }
      holder.appendChild(root);
      return holder.innerHTML.substr(0, 400000);
    } catch (e) { return ''; }
  }
  K.cleanSvg = cleanSvg;

  var mermaidOk = modernJs;
  var mermaidReady = false, mseq = 0;
  function mermaid(cb) {
    if (!mermaidOk) { cb(new Error('old')); return; }
    loadScript('/vendor/mermaid/mermaid.min.js', function () { return !!window.mermaid; }, function (err) {
      if (!err && !mermaidReady) {
        mermaidReady = true;
        window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: K.Theme.isDark() ? 'dark' : 'neutral' });
      }
      cb(err);
    });
  }
  V.mermaid = function (b, ed, entry) {
    var box = D.el('div.mm-box');
    var out = D.el('div.mm-out');
    var src = D.el('textarea.mm-src', { rows: 6, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' });
    src.value = b.text || '';
    var err = D.el('div.mm-err');
    function paint() {
      if (b.svg) { out.innerHTML = cleanSvg(b.svg); } else { out.textContent = mermaidOk ? 'Write a diagram below' : 'Open this page on a computer or phone to draw the diagram.'; }
    }
    var draw = U.debounce(function () {
      if (!b.text) { b.svg = null; paint(); return; }
      mermaid(function (e) {
        if (e) { return; }
        var id = 'mm' + (++mseq) + Date.now();
        try {
          window.mermaid.render(id, b.text).then(function (res) {
            // keep the SVG (sanitised by Mermaid's strict mode) so devices that can't run Mermaid still show it
            b.svg = cleanSvg(res.svg);
            err.textContent = '';
            paint();
            ed.changed();
          }, function (x) { err.textContent = String((x && x.message) || x).split('\n')[0]; var junk = document.getElementById('d' + id); if (junk) { D.remove(junk); } });
        } catch (x) { err.textContent = String(x.message || x); }
      });
    }, 500);
    D.on(src, 'input', function () { b.text = src.value.substr(0, 20000); ed.changed(); draw(); });
    D.tap(out, function () { if (!ed.locked()) { box.classList.toggle('editing'); if (box.classList.contains('editing')) { src.focus(); } } });
    paint();
    if (b.text && !b.svg) { draw(); }
    entry.focusEl = src;
    D.append(box, [out, src, err]);
    if (!mermaidOk) { src.setAttribute('readonly', 'readonly'); }
    return box;
  };
  V.mermaid.after = function (b, ed) { var e = ed.els[b.id]; if (e) { e.wrap.querySelector('.mm-box').classList.add('editing'); } };
  X.push({ label: 'Diagram', icon: 'columns', desc: 'Flowcharts, timelines and more (Mermaid)', keys: 'diagram mermaid flowchart chart sequence gantt mindmap', group: 'Advanced', type: 'mermaid',
    extra: function () { return { text: 'flowchart LR\n  A[Idea] --> B{Worth it?}\n  B -- yes --> C[Do it]\n  B -- no --> D[Skip]', svg: null }; } });

  // ---------- export ----------

  function inlineMd(html) {
    return String(html || '')
      .replace(/<span class="mention"[^>]*data-page="([^"]+)"[^>]*>([^<]*)<\/span>/g, '[[$2]]')
      .replace(/<span class="mdate[^"]*" data-date="([^"]+)"[^>]*>[^<]*<\/span>/g, '@$1')
      .replace(/<(b|strong)>([\s\S]*?)<\/\1>/g, '**$2**')
      .replace(/<(i|em)>([\s\S]*?)<\/\1>/g, '*$2*')
      .replace(/<(s|strike|del)>([\s\S]*?)<\/\1>/g, '~~$2~~')
      .replace(/<code>([\s\S]*?)<\/code>/g, '`$1`')
      .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, '[$2]($1)')
      .replace(/<br\s*\/?>/g, '  \n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }
  function toMd(blocks) {
    var out = [], n = 0;
    blocks.forEach(function (b) {
      var ind = new Array((b.d || 0) + 1).join('  '), t = inlineMd(b.html);
      if (b.type !== 'num') { n = 0; }
      switch (b.type) {
        case 'h1': out.push('# ' + t); break;
        case 'h2': out.push('## ' + t); break;
        case 'h3': out.push('### ' + t); break;
        case 'bul': case 'toggle': out.push(ind + '- ' + t); break;
        case 'num': out.push(ind + (++n) + '. ' + t); break;
        case 'todo': out.push(ind + '- [' + (b.checked ? 'x' : ' ') + '] ' + t); break;
        case 'quote': out.push('> ' + t); break;
        case 'callout': out.push('> ' + (b.icon || '\uD83D\uDCA1') + ' ' + t); break;
        case 'div': out.push('---'); break;
        case 'code': out.push('```' + (b.lang && b.lang !== 'plain' ? b.lang : '') + '\n' + (b.text || '') + '\n```'); break;
        case 'math': out.push('$$\n' + (b.tex || '') + '\n$$'); break;
        case 'mermaid': out.push('```mermaid\n' + (b.text || '') + '\n```'); break;
        case 'table':
          (b.rows || []).forEach(function (r, i) {
            out.push('| ' + r.map(function (c) { return inlineMd(c).replace(/\|/g, '\\|'); }).join(' | ') + ' |');
            if (i === 0) { out.push('|' + r.map(function () { return ' --- '; }).join('|') + '|'); }
          });
          break;
        case 'cols': (b.cols || []).forEach(function (l) { out.push(toMd(l)); }); break;
        case 'page': case 'link': var d = Docs.get(b.ref); out.push('[[' + (d ? Docs.titleOf(d) : 'page') + ']]'); break;
        case 'bookmark': out.push('[' + (b.title || b.url) + '](' + b.url + ')'); break;
        case 'image': out.push('![' + inlineMd(b.caption) + '](image)'); break;
        case 'file': out.push('[' + (b.name || 'file') + '](file)'); break;
        case 'db': var x = Docs.get(b.ref); if (x && K.DB) { out.push(dbMd(x)); } break;
        default: if (t || b.html !== undefined) { out.push(ind + t); }
      }
    });
    return out.join('\n\n').replace(/\n{3,}/g, '\n\n');
  }
  function dbRows(db) {
    var view = (db.schema.views || [])[0] || { filter: null, sorts: [], hidden: [] };
    var props = K.DbView ? K.DbView.ordered(db, view) : db.schema.props;
    return { props: props, rows: K.DB.query(db, view) };
  }
  function dbMd(db) {
    var q = dbRows(db);
    var lines = ['| ' + q.props.map(function (p) { return p.name; }).join(' | ') + ' |', '|' + q.props.map(function () { return ' --- '; }).join('|') + '|'];
    q.rows.forEach(function (r) { lines.push('| ' + q.props.map(function (p) { return K.DB.text(db, r, p).replace(/\|/g, '\\|').replace(/\n/g, ' '); }).join(' | ') + ' |'); });
    return lines.join('\n');
  }
  function csvCell(s) { s = String(s === null || s === undefined ? '' : s); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function dbCsv(db) {
    var q = dbRows(db);
    var lines = [q.props.map(function (p) { return csvCell(p.name); }).join(',')];
    q.rows.forEach(function (r) { lines.push(q.props.map(function (p) { return csvCell(K.DB.text(db, r, p)); }).join(',')); });
    return '\ufeff' + lines.join('\r\n');
  }
  function fileName(doc, ext) { return (Docs.titleOf(doc).replace(/[\\\/:*?"<>|]+/g, ' ').replace(/^\s+|\s+$/g, '') || 'Untitled') + '.' + ext; }

  // download a file (old iOS cannot download: the text opens in a new tab instead)
  K.saveFile = function (name, text, type) {
    var blob = null;
    try { blob = new window.Blob([text], { type: type + ';charset=utf-8' }); } catch (e) { blob = null; }
    var a = document.createElement('a');
    if (blob && window.URL && 'download' in a) {
      var url = window.URL.createObjectURL(blob);
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); D.remove(a);
      setTimeout(function () { window.URL.revokeObjectURL(url); }, 4000);
    } else {
      var w = window.open('', '_blank');
      if (w) { w.document.open(); w.document.write('<pre style="white-space:pre-wrap;font:14px Menlo,monospace">' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>'); w.document.close(); }
      else { sheets.toast('Allow pop-ups to export on this device.'); }
    }
  };

  function exportMd(page) {
    var doc = page.doc;
    var md = '# ' + Docs.titleOf(doc) + '\n\n' + (doc.kind === 'database' ? dbMd(doc) : toMd(doc.content || []));
    K.saveFile(fileName(doc, 'md'), md, 'text/markdown');
  }
  function exportHtml(page) {
    var doc = page.doc;
    var body = page.pageEl.cloneNode(true);
    Array.prototype.forEach.call(body.querySelectorAll('.blk-gut, .page-adds, .add-link, .cover-btn, .row-open, .dbv-tools, .dbv-tabs .add, [contenteditable]'), function (n) {
      if (n.getAttribute && n.getAttribute('contenteditable') !== null) { n.removeAttribute('contenteditable'); return; }
      D.remove(n);
    });
    var css = 'body{font:16px/1.6 -apple-system,"Helvetica Neue",Arial,sans-serif;color:#2B2B2B;max-width:760px;margin:40px auto;padding:0 20px}' +
      'img,svg{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}pre{background:#F5F4F0;padding:12px;overflow:auto}' +
      'blockquote,.t-quote{border-left:3px solid #ccc;padding-left:12px}.chip{background:#eee;border-radius:4px;padding:0 6px;margin-right:4px}';
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>' + Docs.titleOf(doc).replace(/</g, '&lt;') + '</title><style>' + css + '</style></head><body>' + body.innerHTML + '</body></html>';
    K.saveFile(fileName(doc, 'html'), html, 'text/html');
  }

  M.push({ icon: 'upload', label: 'Export (Markdown, HTML, CSV, PDF)', when: function (p) { return p.doc.kind !== 'canvas'; }, run: function (page) {
    var items = [
      { label: 'Markdown (.md)', onTap: function () { exportMd(page); } },
      { label: 'Web page (.html)', onTap: function () { exportHtml(page); } }
    ];
    if (page.doc.kind === 'database') { items.push({ label: 'Spreadsheet (.csv)', onTap: function () { K.saveFile(fileName(page.doc, 'csv'), dbCsv(page.doc), 'text/csv'); } }); }
    var inl = [];
    Docs.eachBlock(page.doc.content || [], function (b) { if (b.type === 'db' && Docs.get(b.ref)) { inl.push(Docs.get(b.ref)); } });
    inl.forEach(function (d) { items.push({ label: Docs.titleOf(d) + ' (.csv)', onTap: function () { K.saveFile(fileName(d, 'csv'), dbCsv(d), 'text/csv'); } }); });
    items.push({ label: 'PDF (print)', onTap: function () { window.print(); } });
    sheets.actionSheet({ title: 'Export', items: items });
  } });

  // ---------- import ----------

  // **bold** *italic* ~~strike~~ `code` [text](https://link) on already-escaped text
  function mdInline(h) {
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
    return R.clean(h);
  }

  function mdToBlocks(text) {
    var lines = String(text).replace(/\r\n?/g, '\n').split('\n'), out = [], i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
      if (fence) {
        var code = []; i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        if (fence[1] === 'mermaid') { out.push(Docs.newBlock('mermaid', { text: code.join('\n'), svg: null })); }
        else { out.push(Docs.newBlock('code', { text: code.join('\n'), lang: fence[1] || 'plain' })); }
        continue;
      }
      if (/^\s*\$\$\s*$/.test(line)) {
        var tex = []; i++;
        while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) { tex.push(lines[i]); i++; }
        i++;
        out.push(Docs.newBlock('math', { tex: tex.join('\n') }));
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
        var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          if (!/^\s*\|?\s*:?-{3,}/.test(lines[i])) { rows.push(lines[i].replace(/^\s*\||\|\s*$/g, '').split('|').map(function (c) { return R.text(c.replace(/^\s+|\s+$/g, '')); })); }
          i++;
        }
        var w = Math.max.apply(null, rows.map(function (r) { return r.length; }));
        rows.forEach(function (r) { while (r.length < w) { r.push(''); } });
        out.push(Docs.newBlock('table', { rows: rows }));
        continue;
      }
      if (/^\s*$/.test(line)) { i++; continue; }
      var b = K.blockFromMarkdownLine(line);
      if (b.html) { b.html = mdInline(b.html); }
      out.push(b);
      i++;
    }
    return out.length ? out : [Docs.newBlock('p')];
  }
  K.mdToBlocks = mdToBlocks;

  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false, s = String(text).replace(/^\ufeff/, '');
    var sep = (s.split('\n')[0].match(/;/g) || []).length > (s.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (q) {
        if (c === '"') { if (s.charAt(i + 1) === '"') { cell += '"'; i++; } else { q = false; } } else { cell += c; }
      } else if (c === '"') { q = true; }
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && s.charAt(i + 1) === '\n') { i++; } row.push(cell); rows.push(row); row = []; cell = ''; }
      else { cell += c; }
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.join('') !== ''; });
  }
  K.parseCsv = parseCsv;

  function csvToDb(name, text, parentId) {
    var rows = parseCsv(text);
    if (!rows.length) { sheets.toast('That file is empty.'); return null; }
    var head = rows.shift().slice(0, 40);
    var DB = K.DB;
    var db = DB.create(parentId, name.replace(/\.[^.]+$/, ''), false);
    var props = [{ id: 'title', name: head[0] || 'Name', type: 'title' }];
    head.slice(1).forEach(function (h, j) {
      var col = rows.map(function (r) { return r[j + 1] || ''; }).filter(function (x) { return x !== ''; });
      var type = 'text';
      if (col.length && col.every(function (x) { return /^-?[\d,]*\.?\d+$/.test(x.replace(/[$€£৳₹%\s]/g, '')); })) { type = 'number'; }
      else if (col.length && col.every(function (x) { return /^\d{4}-\d\d-\d\d/.test(x); })) { type = 'date'; }
      else if (col.length && col.every(function (x) { return /^(true|false|yes|no|x|✓|)$/i.test(x); })) { type = 'check'; }
      else {
        var uniq = {};
        col.forEach(function (x) { uniq[x] = 1; });
        if (col.length > 3 && Object.keys(uniq).length <= Math.max(2, col.length / 3) && Object.keys(uniq).length <= 20) { type = 'select'; }
      }
      var p = { id: DB.pid(), name: h || 'Column ' + (j + 2), type: type };
      if (type === 'select') { p.options = Object.keys(uniq).map(function (n, k) { return { id: DB.oid(), name: n.substr(0, 100), color: DB.COLORS[1 + (k % 9)] }; }); }
      props.push(p);
    });
    db.schema.props = props;
    db.schema.views = [DB.newView('table', 'Table')];
    DB.saveSchema(db);
    rows.slice(0, 5000).forEach(function (r) {
      var init = { title: (r[0] || '').substr(0, 500) };
      props.slice(1).forEach(function (p, j) {
        var v = r[j + 1];
        if (v === undefined || v === '') { return; }
        if (p.type === 'number') { var n = parseFloat(v.replace(/[^0-9.\-]/g, '')); if (!isNaN(n)) { init[p.id] = n; } }
        else if (p.type === 'date') { init[p.id] = { s: v.substr(0, 10) + (/T\d\d:\d\d/.test(v) ? v.substr(10, 6) : '') }; }
        else if (p.type === 'check') { init[p.id] = /^(true|yes|x|✓)$/i.test(v); }
        else if (p.type === 'select') { var o = null; p.options.forEach(function (x) { if (x.name === v) { o = x; } }); if (o) { init[p.id] = o.id; } }
        else { init[p.id] = v.substr(0, 5000); }
      });
      DB.newRow(db, init);
    });
    return db;
  }

  function importFiles(parentId) {
    var input = D.el('input', { type: 'file', accept: '.md,.markdown,.txt,.csv,text/markdown,text/plain,text/csv', multiple: 'multiple', style: { display: 'none' } });
    document.body.appendChild(input);
    D.on(input, 'change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      D.remove(input);
      var last = null;
      U.eachSeries(files, function (f, next) {
        var rd = new window.FileReader();
        rd.onload = function () {
          var text = String(rd.result || '');
          if (/\.csv$/i.test(f.name) || /csv/.test(f.type)) { last = csvToDb(f.name, text, parentId) || last; }
          else {
            var blocks = mdToBlocks(text), title = f.name.replace(/\.[^.]+$/, '');
            if (blocks[0] && blocks[0].type === 'h1') { title = Docs.plain(blocks.shift().html); }
            last = Docs.create({ parent_id: parentId, title: title.substr(0, 500), content: blocks.length ? blocks : [Docs.newBlock('p')] });
          }
          next();
        };
        rd.onerror = function () { next(); };
        rd.readAsText(f);
      }, function () {
        if (last) { sheets.toast('Imported ' + files.length + (files.length === 1 ? ' file' : ' files')); K.shell.renderSide(); K.shell.openDoc(last); }
      });
    });
    input.click();
  }
  K.importFiles = importFiles;
  M.push({ icon: 'upload', label: 'Import Markdown or CSV here', when: function (p) { return p.doc.kind === 'page'; }, run: function (p) { importFiles(p.doc.id); } });

  // ---------- keyboard shortcuts ----------

  K.showShortcuts = function () {
    var mod = /Mac|iPhone|iPad/.test(navigator.platform || '') ? '\u2318' : 'Ctrl';
    var rows = [
      ['Search', mod + ' P'], ['New page', mod + ' N'], ['Show / hide sidebar', mod + ' \\'], ['Back / forward', mod + ' [  /  ' + mod + ' ]'],
      ['Dark mode', mod + ' Shift L'], ['Undo / redo', mod + ' Z  /  ' + mod + ' Shift Z'], ['Bold / italic / underline', mod + ' B / I / U'],
      ['Heading 1 / 2 / 3', mod + ' Alt 1 / 2 / 3'], ['Indent / outdent', 'Tab / Shift Tab'], ['Block menu', 'Type /'],
      ['Mention a page or date', 'Type @'], ['Link to a page', 'Type [['], ['Markdown', '# ## - 1. [] > ``` ---'], ['Shortcuts', mod + ' /']
    ];
    var t = D.el('table.kb-table');
    rows.forEach(function (r) { t.appendChild(D.el('tr', null, [D.el('td', { text: r[0] }), D.el('td', null, D.el('kbd', { text: r[1] }))])); });
    sheets.modal({ title: 'Keyboard shortcuts', body: t, cls: 'sheet-prop', actions: [{ label: 'Done', primary: true }] });
  };
  D.on(document, 'keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.keyCode === 191 || e.key === '/')) { e.preventDefault(); K.showShortcuts(); }
  });
})(window.Kagoj = window.Kagoj || {});
