(function (K) {
  'use strict';

  var D = K.dom, U = K.util, R = K.rich, Docs = K.Docs, sheets = K.sheets;

  // ---------- floating list menu (shared by / and @) ----------

  var active = null; // { kind, el, items, sel, ed, id, startLen, onPick }

  function closeMenu() {
    if (!active) { return; }
    D.remove(active.el);
    active = null;
  }

  function placeAtCaret(el) {
    var r = R.caretRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var w = Math.min(320, vw - 16);
    el.style.width = w + 'px';
    var left = r ? Math.min(Math.max(8, r.left), vw - w - 8) : 20;
    var top = r ? r.bottom + 6 : 80;
    el.style.left = left + 'px';
    var h = Math.min(340, el.scrollHeight || 340);
    if (r && top + h > vh - 8 && r.top - h - 6 > 8) { top = r.top - h - 6; }
    el.style.top = Math.max(8, Math.min(top, vh - h - 8)) + 'px';
  }

  function renderMenu() {
    var a = active, el = D.empty(a.el);
    if (!a.items.length) { el.appendChild(D.el('div.menu-empty', { text: 'No results' })); placeAtCaret(el); return; }
    var lastGroup = null;
    a.items.forEach(function (it, i) {
      if (it.group && it.group !== lastGroup) { el.appendChild(D.el('div.menu-group', { text: it.group })); lastGroup = it.group; }
      var row = D.el('button.menu-item' + (i === a.sel ? '.sel' : ''), { type: 'button' }, [
        D.el('span.mi-icon', null, it.emoji ? D.el('span.emoji', { text: it.emoji }) : D.icon(it.icon || 'file')),
        D.el('span.mi-main', null, [D.el('span.mi-label', { text: it.label }), it.desc ? D.el('span.mi-desc', { text: it.desc }) : null])
      ]);
      // mousedown keeps the editor focused; touch handled by tap
      D.on(row, 'mousedown', function (e) { e.preventDefault(); });
      D.tap(row, function () { pick(i); });
      el.appendChild(row);
    });
    placeAtCaret(el);
    var cur = el.querySelector('.sel');
    if (cur && cur.scrollIntoView && el.scrollHeight > el.clientHeight) {
      if (cur.offsetTop < el.scrollTop) { el.scrollTop = cur.offsetTop - 4; }
      else if (cur.offsetTop + cur.offsetHeight > el.scrollTop + el.clientHeight) { el.scrollTop = cur.offsetTop + cur.offsetHeight - el.clientHeight + 4; }
    }
  }

  function pick(i) {
    var a = active;
    if (!a || !a.items[i]) { return; }
    var it = a.items[i], ed = a.ed, id = a.id, kind = a.kind, typed = a.typed;
    closeMenu();
    var rt = ed.rt(id);
    if (rt) {
      // remove what was typed to open the menu ("/hea", "@tom")
      if (rt !== document.activeElement) { R.place(rt, a.caret); }
      if (typed) { R.deleteBefore(typed); }
      ed.syncFromDom(id);
    }
    it.run(ed, id, kind);
  }

  K.menuKey = function (e) {
    if (!active) { return false; }
    var k = e.keyCode;
    if (k === 40 || (k === 9 && !e.shiftKey)) { e.preventDefault(); active.sel = Math.min(active.items.length - 1, active.sel + 1); renderMenu(); return true; }
    if (k === 38 || (k === 9 && e.shiftKey)) { e.preventDefault(); active.sel = Math.max(0, active.sel - 1); renderMenu(); return true; }
    if (k === 13) { e.preventDefault(); pick(active.sel); return true; }
    if (k === 27) { e.preventDefault(); closeMenu(); return true; }
    return false;
  };

  function openMenu(kind, ed, id, typedLen, items) {
    if (!active || active.kind !== kind || active.id !== id) {
      closeMenu();
      active = { kind: kind, el: D.el('div.menu-pop.scrolls'), ed: ed, id: id, sel: 0 };
      document.body.appendChild(active.el);
    }
    var rt = ed.rt(id);
    active.typed = typedLen;
    active.caret = rt ? R.caret(rt) : -1;
    active.items = items;
    active.sel = Math.min(active.sel, Math.max(0, items.length - 1));
    renderMenu();
  }

  K.dom.on(document, 'mousedown', function (e) {
    if (active && !active.el.contains(e.target)) { closeMenu(); }
  });

  function match(it, q) {
    if (!q) { return true; }
    var hay = (it.label + ' ' + (it.keys || '')).toLowerCase();
    return q.toLowerCase().split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  // ---------- / slash menu ----------

  // How to apply a block type from the menu: reuse an empty text block, otherwise add below
  function applyType(type, extra, nonText) {
    return function (ed, id) {
      var b = ed.block(id);
      var emptyText = b && K.isTextBlock(b) && !Docs.plain(b.html) && !/mention|mdate/.test(b.html || '');
      if (nonText) {
        var nb = Docs.newBlock(type, extra ? extra() : {});
        nb.d = b ? b.d || 0 : 0;
        if (emptyText) {
          ed.snapshot();
          var i = ed.index(id);
          ed.blocks.splice(i, 1, nb);
          ed.render();
          ed.changed(true);
        } else {
          ed.insertAfter(id, nb, false);
        }
        if (K.BlockViews[type] && K.BlockViews[type].after) { K.BlockViews[type].after(nb, ed); }
        // keep typing below things like dividers and tables
        var j = ed.index(nb.id);
        if (j === ed.blocks.length - 1 && !ed.nested) { ed.insertAfter(nb.id, Docs.newBlock('p', { d: nb.d }), true); }
        else { var e = ed.els[nb.id]; if (e && e.focusEl) { e.focusEl.focus(); } }
        return;
      }
      if (emptyText || (b && b.type === type)) { ed.turnInto(id, type, extra ? extra() : null); }
      else { ed.insertAfter(id, Docs.newBlock(type, U.extend({ d: b ? b.d || 0 : 0 }, extra ? extra() : {})), true); }
    };
  }

  var SLASH = [
    ['Text', 'p', 'text', 'Just start writing', 'paragraph plain', 'Basic blocks'],
    ['Heading 1', 'h1', 'h1', 'Big section heading', 'title h1 #', 'Basic blocks'],
    ['Heading 2', 'h2', 'h2', 'Medium section heading', 'subtitle h2 ##', 'Basic blocks'],
    ['Heading 3', 'h3', 'h3', 'Small section heading', 'h3 ###', 'Basic blocks'],
    ['Bulleted list', 'bul', 'list', 'A simple bulleted list', 'bullet ul -', 'Basic blocks'],
    ['Numbered list', 'num', 'list-num', 'A list with numbering', 'ordered ol 1.', 'Basic blocks'],
    ['To-do list', 'todo', 'checkbox', 'Track tasks with a to-do list', 'todo task check []', 'Basic blocks'],
    ['Toggle list', 'toggle', 'toggle', 'Hide and show content inside', 'toggle dropdown collapse >', 'Basic blocks'],
    ['Toggle heading 1', 'h1', 'toggle', 'Heading that collapses its section', 'toggle heading', 'Basic blocks', { tg: true, open: true }],
    ['Toggle heading 2', 'h2', 'toggle', 'Heading that collapses its section', 'toggle heading', 'Basic blocks', { tg: true, open: true }],
    ['Toggle heading 3', 'h3', 'toggle', 'Heading that collapses its section', 'toggle heading', 'Basic blocks', { tg: true, open: true }],
    ['Quote', 'quote', 'quote', 'Capture a quote', 'blockquote "', 'Basic blocks'],
    ['Callout', 'callout', 'callout', 'Make writing stand out', 'note info box !', 'Basic blocks']
  ];

  K.slashItems = function () {
    var items = SLASH.map(function (s) {
      return { label: s[0], icon: s[2], desc: s[3], keys: s[4], group: s[5], run: applyType(s[1], s[6] ? function () { return U.copy(s[6]); } : null, false) };
    });
    (K.extraSlash || []).forEach(function (x) {
      if (x.avail && !x.avail()) { return; }
      items.push({
        label: x.label, icon: x.icon, desc: x.desc, keys: x.keys, group: x.group,
        run: x.run || applyType(x.type, x.extra, true)
      });
    });
    return items;
  };

  K.slashMenu = {
    open: function (ed, id) { openMenu('slash', ed, id, 0, K.slashItems()); active.fromPlus = true; },
    track: function (ed, id, before) {
      var m = /\/([^\s/]{0,24})$/.exec(before);
      var q = m ? m[1] : '';
      var items = K.slashItems().filter(function (it) { return match(it, q); });
      if (!items.length && q.length > 3) { closeMenu(); return; }
      openMenu('slash', ed, id, q.length + 1, items);
    },
    isOpenFor: function (ed, id) { return !!(active && active.kind === 'slash' && active.id === id && active.ed === ed); },
    close: closeMenu
  };

  // ---------- @ mentions and [[ links ----------

  var DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  K.isoDay = iso;

  K.dateLabel = function (s) {
    var m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?/.exec(s || '');
    if (!m) { return s; }
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var diff = Math.round((d - today) / 86400000);
    var label = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' :
      (['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + d.getDate() + (d.getFullYear() !== today.getFullYear() ? ', ' + d.getFullYear() : ''));
    if (m[4]) {
      var h = +m[4], ap = h < 12 ? 'AM' : 'PM';
      label += ' ' + ((h % 12) || 12) + ':' + m[5] + ' ' + ap;
    }
    return label;
  };

  function dateOptions(q) {
    var base = new Date(); base.setHours(0, 0, 0, 0);
    var opts = [['Today', 0], ['Tomorrow', 1], ['Yesterday', -1]];
    DAYS.forEach(function (n, i) {
      var diff = (i - base.getDay() + 7) % 7 || 7;
      opts.push(['Next ' + n.charAt(0).toUpperCase() + n.substr(1), diff]);
    });
    var out = opts.filter(function (o) { return !q || o[0].toLowerCase().indexOf(q.toLowerCase()) >= 0 || (q === 'date' || q === 'remind'); })
      .slice(0, q ? 4 : 2).map(function (o) {
        var d = new Date(base.getTime() + o[1] * 86400000);
        return { day: iso(d), label: o[0] };
      });
    // a typed date like 2026-11-03 or 3/11
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(q || '');
    if (m) { out.unshift({ day: m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]), label: K.dateLabel(m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3])) }); }
    return out;
  }

  function insertMention(ed, id, node) {
    var rt = ed.rt(id);
    if (!rt) { return; }
    if (document.activeElement !== rt) { rt.focus(); }
    R.insertNode(node);
    ed.syncFromDom(id);
    ed.changed();
  }

  function pageMention(d) {
    var s = document.createElement('span');
    s.className = 'mention';
    s.setAttribute('data-page', d.id);
    s.setAttribute('contenteditable', 'false');
    s.textContent = Docs.titleOf(d);
    return s;
  }
  function dateMention(day, remind) {
    var s = document.createElement('span');
    s.className = 'mdate' + (remind ? ' remind' : '');
    s.setAttribute('data-date', day);
    if (remind) { s.setAttribute('data-remind', '1'); }
    s.setAttribute('contenteditable', 'false');
    s.textContent = (remind ? '⏰ ' : '') + K.dateLabel(day);
    return s;
  }
  K.dateMention = dateMention;

  K.mentionMenu = {
    track: function (ed, id, before, trigger) {
      var q = trigger === '@' ? /@([^@]{0,30})$/.exec(before)[1] : /\[\[([^\]]{0,30})$/.exec(before)[1];
      var items = [];
      var page = ed.page.doc;
      if (trigger === '@') {
        var remindQ = /^remind\s*(.*)$/i.exec(q);
        if (remindQ) {
          dateOptions(remindQ[1] || '').slice(0, 3).forEach(function (o) {
            items.push({ group: 'Remind me', label: o.label + ' at 9:00 AM', icon: 'bell', run: function (e2, bid) { insertMention(e2, bid, dateMention(o.day + 'T09:00', true)); } });
          });
        }
        dateOptions(q).forEach(function (o) {
          items.push({ group: 'Date', label: o.label, icon: 'calendar', desc: o.day, run: function (e2, bid) { insertMention(e2, bid, dateMention(o.day, false)); } });
        });
        if (!remindQ && (!q || 'remind'.indexOf(q.toLowerCase()) === 0)) {
          items.push({ group: 'Remind me', label: 'Remind me tomorrow 9:00 AM', icon: 'bell', run: function (e2, bid) {
            var t = new Date(); t.setDate(t.getDate() + 1);
            insertMention(e2, bid, dateMention(iso(t) + 'T09:00', true));
          } });
        }
      }
      var pages = (q ? Docs.search(q, { titleOnly: true }).map(function (r) { return r.doc; }) : Docs.recent(6))
        .filter(function (d) { return d.id !== page.id && d.kind !== 'row'; }).slice(0, 6);
      pages.forEach(function (d) {
        items.push({ group: 'Link to page', label: Docs.titleOf(d), emoji: d.icon || null, icon: 'file', run: function (e2, bid) { insertMention(e2, bid, pageMention(d)); } });
      });
      if (q && q.replace(/\s+/g, '')) {
        items.push({ group: 'New', label: 'New page “' + q + '”', icon: 'plus', desc: 'inside this page', run: function (e2, bid) {
          var nd = Docs.create({ parent_id: page.id, title: q.replace(/^\s+|\s+$/g, '') });
          insertMention(e2, bid, pageMention(nd));
        } });
      }
      openMenu('mention', ed, id, q.length + trigger.length, items);
    },
    isOpenFor: function (ed, id) { return !!(active && active.kind === 'mention' && active.id === id && active.ed === ed); },
    close: closeMenu
  };

  // ---------- selection toolbar ----------

  var bar = null, barState = null;

  function currentRt() {
    var s = R.sel();
    if (!s || !s.rangeCount) { return null; }
    var n = s.getRangeAt(0).commonAncestorContainer;
    while (n && n !== document.body) {
      if (n.classList && n.classList.contains('rt') && n.getAttribute('contenteditable') === 'true') { return n; }
      n = n.parentNode;
    }
    return null;
  }

  function hideBar() { if (bar) { bar.style.display = 'none'; } barState = null; }

  function after(fn) {
    return function () {
      var st = barState;
      if (!st) { return; }
      fn(st);
      st.ed.syncFromDom(st.id);
      st.ed.changed();
      setTimeout(updateBar, 10);
    };
  }

  K.selectionLink = function (ed, id) {
    var s = R.sel();
    var saved = s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
    sheets.prompt({ title: 'Link to', value: 'https://', ok: 'Add link' }, function (v) {
      if (!v || !saved) { return; }
      var rt = ed.rt(id);
      rt.focus();
      var s2 = R.sel();
      s2.removeAllRanges();
      s2.addRange(saved);
      v = v.replace(/^\s+|\s+$/g, '');
      if (!/^(https?:|mailto:|#\/)/i.test(v)) { v = 'https://' + v; }
      document.execCommand('createLink', false, v);
      ed.syncFromDom(id);
      ed.changed();
    });
  };

  function colorMenu(st) {
    var box = D.el('div.color-pop');
    function swatch(cls, label) {
      var b = D.el('button.color-chip.' + cls, { type: 'button', title: label }, D.el('span', { text: 'A' }));
      D.on(b, 'mousedown', function (e) { e.preventDefault(); });
      D.tap(b, function () {
        var rt = st.ed.rt(st.id);
        rt.focus();
        var s = R.sel();
        if (st.range) { s.removeAllRanges(); s.addRange(st.range); }
        R.wrap('span', cls);
        st.ed.syncFromDom(st.id);
        st.ed.changed();
        pop.close();
      });
      return b;
    }
    box.appendChild(D.el('div.cp-label', { text: 'Text colour' }));
    var r1 = D.el('div.cp-row');
    r1.appendChild(swatch('c-default', 'Default'));
    R.COLORS.forEach(function (c) { r1.appendChild(swatch('c-' + c, c)); });
    box.appendChild(r1);
    box.appendChild(D.el('div.cp-label', { text: 'Highlight' }));
    var r2 = D.el('div.cp-row');
    r2.appendChild(swatch('bg-default', 'None'));
    R.COLORS.forEach(function (c) { r2.appendChild(swatch('bg-' + c, c)); });
    box.appendChild(r2);
    var pop = sheets.popover(bar, box);
  }

  function buildBar() {
    bar = D.el('div.sel-tool');
    function btn(label, title, fn, cls) {
      var b = D.el('button.st-btn' + (cls ? '.' + cls : ''), { type: 'button', title: title }, label);
      D.on(b, 'mousedown', function (e) { e.preventDefault(); });
      D.tap(b, fn);
      bar.appendChild(b);
      return b;
    }
    btn(D.el('b', { text: 'B' }), 'Bold (Ctrl+B)', after(function () { document.execCommand('bold', false, null); }));
    btn(D.el('i', { text: 'i' }), 'Italic (Ctrl+I)', after(function () { document.execCommand('italic', false, null); }));
    btn(D.el('u', { text: 'U' }), 'Underline (Ctrl+U)', after(function () { document.execCommand('underline', false, null); }));
    btn(D.el('s', { text: 'S' }), 'Strikethrough', after(function () { document.execCommand('strikeThrough', false, null); }));
    btn(D.el('code', { text: '</>' }), 'Inline code (Ctrl+E)', after(function () { R.wrap('code'); }));
    btn(D.icon('link'), 'Link (Ctrl+K)', function () { if (barState) { K.selectionLink(barState.ed, barState.id); } });
    btn(D.el('span.st-a', { text: 'A' }), 'Colour', function () {
      if (!barState) { return; }
      var s = R.sel();
      barState.range = s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
      colorMenu(barState);
    });
    btn(D.icon('clear'), 'Clear formatting', after(function () { document.execCommand('removeFormat', false, null); R.wrap('span', 'c-default'); }));
    document.body.appendChild(bar);
    D.on(bar, 'touchstart', function (e) { e.stopPropagation(); }, { passive: true });
  }

  function updateBar() {
    var s = R.sel();
    var rt = currentRt();
    if (!rt || !s || s.isCollapsed || !s.rangeCount || !String(s).replace(/\s+/g, '')) { hideBar(); return; }
    var w = rt;
    while (w && !(w.classList && w.classList.contains('blk'))) { w = w.parentNode; }
    var ed = w && K.Editor.byUid ? K.Editor.byUid[w.getAttribute('data-ed')] : null;
    if (!ed) { hideBar(); return; }
    barState = { ed: ed, id: w.getAttribute('data-id') };
    if (!bar) { buildBar(); }
    bar.style.display = '';
    var r = s.getRangeAt(0).getBoundingClientRect();
    var bw = bar.offsetWidth, bh = bar.offsetHeight;
    var left = U.clamp(r.left + r.width / 2 - bw / 2, 8, window.innerWidth - bw - 8);
    // below the selection on touch devices (iOS shows its own menu above)
    var top = U.hasTouch ? r.bottom + 10 : r.top - bh - 8;
    if (top < 8) { top = r.bottom + 10; }
    if (top + bh > window.innerHeight - 8) { top = r.top - bh - 8; }
    bar.style.left = Math.round(left) + 'px';
    bar.style.top = Math.round(top) + 'px';
  }
  var updateSoon = U.debounce(updateBar, 120);
  K.dom.on(document, 'selectionchange', function () { updateSoon(); });
  K.hideSelectionBar = hideBar;

  // ---------- block menu (⋮⋮) ----------

  var TURN = [['Text', 'p'], ['Heading 1', 'h1'], ['Heading 2', 'h2'], ['Heading 3', 'h3'], ['Bulleted list', 'bul'],
    ['Numbered list', 'num'], ['To-do list', 'todo'], ['Toggle list', 'toggle'], ['Quote', 'quote'], ['Callout', 'callout'], ['Code', 'code']];

  K.blockMenu = function (ed, b) {
    if (ed.locked()) { sheets.toast('This page is locked. Unlock it from the ••• menu.'); return; }
    var isText = K.isTextBlock(b) || b.type === 'code';
    var items = [];
    if (isText) {
      items.push({ label: 'Turn into…', icon: 'refresh', onTap: function () {
        sheets.actionSheet({ title: 'Turn into', items: TURN.map(function (t) {
          return { label: t[0], checked: b.type === t[1], onTap: function () { ed.turnInto(b.id, t[1]); } };
        }).concat(/^h[123]$/.test(b.type) ? [{ label: b.tg ? 'Normal heading (not a toggle)' : 'Toggle heading', onTap: function () { b.tg = !b.tg; b.open = true; ed.rerender(b.id); ed.changed(true); } }] : []) });
      } });
      items.push({ label: 'Colour…', icon: 'palette', onTap: function () {
        var list = [{ label: 'Default', checked: !b.color, onTap: function () { delete b.color; ed.rerender(b.id); ed.changed(true); } }];
        R.COLORS.forEach(function (c) { list.push({ label: c.charAt(0).toUpperCase() + c.substr(1) + ' text', checked: b.color === 'c-' + c, onTap: function () { b.color = 'c-' + c; ed.rerender(b.id); ed.changed(true); } }); });
        R.COLORS.forEach(function (c) { list.push({ label: c.charAt(0).toUpperCase() + c.substr(1) + ' background', checked: b.color === 'bg-' + c, onTap: function () { b.color = 'bg-' + c; ed.rerender(b.id); ed.changed(true); } }); });
        sheets.actionSheet({ title: 'Block colour', items: list });
      } });
      if (K.isTextBlock(b)) {
        items.push({ label: 'Font…', icon: 'text', onTap: function () {
          K.fontPicker('Font for this block', b.font || '', true, function (id) {
            if (id) { b.font = id; } else { delete b.font; }
            ed.rerender(b.id);
            ed.changed(true);
          });
        } });
      }
    }
    items.push({ label: 'Indent', icon: 'chevron-right', onTap: function () { ed.indent(b.id, 1); } });
    items.push({ label: 'Outdent', icon: 'chevron-left', onTap: function () { ed.indent(b.id, -1); } });
    if (K.BlockViews[b.type] && K.BlockViews[b.type].menu) { items = items.concat(K.BlockViews[b.type].menu(b, ed)); }
    items.push({ label: 'Duplicate', icon: 'copy', onTap: function () { ed.duplicate(b.id); } });
    items.push({ label: 'Move to another page…', icon: 'folder', onTap: function () { K.moveBlockTo(ed, b); } });
    items.push({ label: 'Delete', icon: 'trash', danger: true, onTap: function () {
      ed.snapshot();
      var i = ed.index(b.id), n = ed.span(i);
      for (var k = 0; k < n; k++) { ed.removeBlock(ed.blocks[i].id, true); }
    } });
    sheets.actionSheet({ title: (K.isTextBlock(b) ? Docs.plain(b.html).substr(0, 40) : '') || 'Block', items: items });
  };

  K.moveBlockTo = function (ed, b) {
    var page = ed.page.doc;
    var list = Docs.all().filter(function (d) { return d.id !== page.id && (d.kind === 'page' || d.kind === 'row') && Docs.isLive(d); })
      .sort(function (a, c) { return a.updated_at < c.updated_at ? 1 : -1; }).slice(0, 40);
    sheets.actionSheet({ title: 'Move block to', items: list.map(function (d) {
      return { label: Docs.titleOf(d), onTap: function () {
        ed.syncFromDom(b.id);
        var i = ed.index(b.id), n = ed.span(i);
        var moving = ed.blocks.slice(i, i + n);
        ed.snapshot();
        for (var k = 0; k < n; k++) { ed.removeBlock(ed.blocks[i].id, true); }
        var base = moving[0].d || 0;
        moving.forEach(function (m) { m.d = (m.d || 0) - base; });
        d.content = (d.content || []).concat(moving);
        Docs.save(d);
        sheets.toast('Moved to “' + Docs.titleOf(d) + '”');
      } };
    }) });
  };

  // ---------- drag handle: tap = menu, hold/drag = move ----------

  K.blockDrag = function (ed, handle, b) {
    var timer = null, dragging = false, sy = 0, line = null, target = -1;
    function start() {
      if (ed.locked()) { return; }
      dragging = true;
      line = D.el('div.drop-line');
      document.body.appendChild(line);
      var e = ed.els[b.id];
      if (e) { e.wrap.classList.add('dragging'); }
    }
    function move(y) {
      var best = -1, bestY = 0;
      var rects = ed.blocks.map(function (x) { var e = ed.els[x.id]; return e && e.wrap.style.display !== 'none' ? e.wrap.getBoundingClientRect() : null; });
      for (var i = 0; i < rects.length; i++) {
        if (!rects[i]) { continue; }
        if (y < rects[i].top + rects[i].height / 2) { best = i; bestY = rects[i].top; break; }
        best = i + 1; bestY = rects[i].bottom;
      }
      target = best;
      var box = ed.el.getBoundingClientRect();
      line.style.left = box.left + 'px';
      line.style.width = box.width + 'px';
      line.style.top = (bestY - 1) + 'px';
    }
    function end() {
      var e = ed.els[b.id];
      if (e) { e.wrap.classList.remove('dragging'); }
      D.remove(line);
      if (dragging && target >= 0) { ed.syncFromDom(b.id); ed.moveBlock(b.id, target); }
      dragging = false;
    }
    D.on(handle, 'touchstart', function (e) {
      var t = e.touches[0];
      sy = t.clientY;
      timer = setTimeout(function () { timer = null; start(); move(sy); }, 350);
    }, { passive: true });
    D.on(handle, 'touchmove', function (e) {
      var t = e.touches[0];
      if (timer && Math.abs(t.clientY - sy) > 8) { clearTimeout(timer); timer = null; start(); }
      if (dragging) { if (e.cancelable) { e.preventDefault(); } move(t.clientY); }
    }, D.passiveFalse);
    D.on(handle, 'touchend', function (e) {
      if (e.cancelable) { e.preventDefault(); }
      if (timer) { clearTimeout(timer); timer = null; K.blockMenu(ed, b); return; }
      if (dragging) { end(); }
    }, D.passiveFalse);
    D.on(handle, 'mousedown', function (e) {
      if (e.button !== 0) { return; }
      e.preventDefault();
      sy = e.clientY;
      var moved = false;
      function mm(ev) {
        if (!moved && Math.abs(ev.clientY - sy) > 5) { moved = true; start(); }
        if (dragging) { move(ev.clientY); }
      }
      function mu() {
        window.removeEventListener('mousemove', mm);
        window.removeEventListener('mouseup', mu);
        if (moved) { end(); } else { K.blockMenu(ed, b); }
      }
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', mu);
    });
  };

  // ---------- emoji picker ----------

  var EMOJI = ('📄 📝 📓 📔 📚 📖 📌 📎 📅 📆 🗓 ⏰ ' +
    '✅ ☑️ ❌ ❗ ❓ 💡 ⭐ 🌟 🔥 ❤️ 💜 💙 💚 💛 ' +
    '🎯 🏆 🚀 📈 📊 💰 💼 🏠 🏫 🎓 🔬 🧪 🧬 🩺 💊 🧠 🫀 ' +
    '💻 📱 🎨 🎵 🎬 📷 ✏️ 🖊️ 📐 🧮 🔍 🔒 🔑 ⚙️ ' +
    '🌱 🌻 🌍 ☀️ 🌙 ☕ 🍎 🍔 ⚽ 🏋️ 🧘 ✈️ 🚗 ' +
    '😀 😊 😎 🤔 😴 🙏 👍 👋 💪 🎉 🎁 🔔 📣 💬').split(' ');

  K.emojiPicker = function (anchor, cb, allowRemove) {
    var box = D.el('div.emoji-pop');
    var grid = D.el('div.emoji-grid');
    EMOJI.forEach(function (e) {
      var b = D.el('button.emoji-btn', { type: 'button', text: e });
      D.on(b, 'mousedown', function (ev) { ev.preventDefault(); });
      D.tap(b, function () { pop.close(); cb(e); });
      grid.appendChild(b);
    });
    box.appendChild(grid);
    if (allowRemove) {
      var rm = D.el('button.small-btn', { type: 'button', text: 'Remove icon' });
      D.tap(rm, function () { pop.close(); cb(null); });
      box.appendChild(rm);
    }
    var pop = sheets.popover(anchor, box);
  };

  // ---------- font picker ----------

  K.fontPicker = function (title, current, allowDefault, cb) {
    var items = [];
    if (allowDefault) { items.push({ label: 'Same as the page', checked: !current, onTap: function () { cb(''); } }); }
    K.Fonts.groups.forEach(function (g) {
      K.Fonts.list.filter(function (f) { return f.group === g; }).forEach(function (f) {
        items.push({ label: f.name, checked: current === f.id, onTap: function () { cb(f.id); } });
      });
    });
    var m = sheets.actionSheet({ title: title, items: items });
    // preview each name in its own font
    var rows = m.panel.querySelectorAll('.action-item span');
    var k = allowDefault ? 1 : 0;
    K.Fonts.groups.forEach(function (g) {
      K.Fonts.list.filter(function (f) { return f.group === g; }).forEach(function (f) {
        if (rows[k]) { rows[k].style.fontFamily = K.Fonts.stack(f.id); }
        k++;
      });
    });
  };
})(window.Kagoj = window.Kagoj || {});
