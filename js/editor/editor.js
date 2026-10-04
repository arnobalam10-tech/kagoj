(function (K) {
  'use strict';

  // Block editor: edits one flat list of blocks (depth `d` gives nesting).
  // Columns hold their own lists, each edited by a nested Editor.
  var D = K.dom, U = K.util, R = K.rich, Docs = K.Docs;
  var uid = 0;

  var TEXT = { p: 1, h1: 1, h2: 1, h3: 1, bul: 1, num: 1, todo: 1, toggle: 1, quote: 1, callout: 1 };
  var LISTY = { bul: 1, num: 1, todo: 1, toggle: 1 };
  var PH = {
    p: 'Type ‘/’ for commands', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', bul: 'List', num: 'List',
    todo: 'To-do', toggle: 'Toggle', quote: 'Quote', callout: 'Callout'
  };
  var BULLETS = ['•', '◦', '▪'];

  K.isTextBlock = function (b) { return !!(b && TEXT[b.type]); };

  function Editor(page, blocks, container, nested) {
    this.page = page;
    this.blocks = blocks;
    this.el = container;
    this.nested = !!nested;
    this.uid = 'e' + (++uid);
    Editor.byUid[this.uid] = this;
    this.els = {};
    this.children = [];
    var self = this;
    container.classList.add('blocks');
    D.on(container, 'keydown', function (e) { self.onKey(e); });
    D.on(container, 'input', function (e) { self.onInput(e); });
    D.on(container, 'paste', function (e) { self.onPaste(e); });
    D.on(container, 'focusin', function (e) { self.onFocus(e); });
    D.on(container, 'click', function (e) { self.onClick(e); });
  }
  var P = Editor.prototype;

  // ---------- lookup ----------

  P.own = function (target) {
    var n = target;
    while (n && n !== this.el) {
      if (n.classList && n.classList.contains('blk')) { return n.getAttribute('data-ed') === this.uid ? n : null; }
      n = n.parentNode;
    }
    return null;
  };
  P.index = function (id) {
    for (var i = 0; i < this.blocks.length; i++) { if (this.blocks[i].id === id) { return i; } }
    return -1;
  };
  P.block = function (id) { var i = this.index(id); return i >= 0 ? this.blocks[i] : null; };
  P.rt = function (id) { var e = this.els[id]; return e ? e.rt : null; };
  P.locked = function () { return !!this.page.locked(); };

  // ---------- rendering ----------

  P.render = function () {
    var self = this;
    this.children.forEach(function (c) { c.destroy(); });
    this.children = [];
    D.empty(this.el);
    this.els = {};
    this.blocks.forEach(function (b) { self.el.appendChild(self.buildBlock(b)); });
    if (!this.blocks.length && !this.nested) {
      // a page always has at least one block to type into
      var b = Docs.newBlock('p');
      this.blocks.push(b);
      this.el.appendChild(this.buildBlock(b));
    }
    this.refreshDerived();
  };

  P.destroy = function () {
    this.children.forEach(function (c) { c.destroy(); });
    this.children = [];
    delete Editor.byUid[this.uid];
  };

  P.buildBlock = function (b) {
    var self = this;
    var wrap = D.el('div.blk.t-' + b.type, { 'data-id': b.id, 'data-ed': this.uid });
    if (b.d) { wrap.style.paddingLeft = (b.d * 26) + 'px'; }
    if (b.conflict) { wrap.classList.add('conflict'); }
    var gut = D.el('div.blk-gut');
    var add = D.el('button.g-btn.g-add', { type: 'button', 'aria-label': 'Add a block below', tabindex: '-1' }, D.icon('plus'));
    var handle = D.el('button.g-btn.g-drag', { type: 'button', 'aria-label': 'Block menu (drag to move)', tabindex: '-1' }, D.icon('grip'));
    D.tap(add, function () { self.addBelow(b.id); });
    K.blockDrag(this, handle, b);
    D.append(gut, [add, handle]);
    var body = D.el('div.blk-body' + (b.color ? '.' + b.color : ''));
    var entry = { wrap: wrap, body: body, rt: null };
    this.els[b.id] = entry;
    if (TEXT[b.type]) {
      body.appendChild(this.textBody(b, entry));
    } else if (K.BlockViews[b.type]) {
      var v = K.BlockViews[b.type](b, this, entry);
      if (v) { body.appendChild(v); }
    } else {
      body.appendChild(D.el('div.blk-unknown', { text: 'Unsupported block (' + b.type + ')' }));
    }
    if (b.conflict) {
      var note = D.el('div.conflict-note', null, [D.el('span', { text: 'Edited on another device at the same time. Keep both, or delete one.' })]);
      var ok = D.el('button.small-btn', { type: 'button', text: 'Keep' });
      D.tap(ok, function () { delete b.conflict; self.changed(true); wrap.classList.remove('conflict'); D.remove(note); });
      note.appendChild(ok);
      body.appendChild(note);
    }
    D.append(wrap, [gut, body]);
    return wrap;
  };

  P.textBody = function (b, entry) {
    var self = this;
    var row = D.el('div.tb-row');
    if (b.type === 'bul') { row.appendChild(D.el('span.bul-dot', { text: BULLETS[(b.d || 0) % 3] })); }
    if (b.type === 'num') { row.appendChild(D.el('span.num-n')); }
    if (b.type === 'todo') {
      var cb = D.el('button.todo-box' + (b.checked ? '.on' : ''), { type: 'button', role: 'checkbox', 'aria-checked': b.checked ? 'true' : 'false' }, D.icon('check'));
      D.tap(cb, function () {
        if (self.locked()) { return; }
        self.snapshot();
        b.checked = !b.checked;
        cb.classList.toggle('on', b.checked);
        entry.wrap.classList.toggle('done', b.checked);
        self.changed(true);
      });
      row.appendChild(cb);
      if (b.checked) { entry.wrap.classList.add('done'); }
    }
    if (b.type === 'toggle' || (b.tg && /^h[123]$/.test(b.type))) {
      var arrow = D.el('button.tg-arrow' + (b.open ? '.open' : ''), { type: 'button', 'aria-label': b.open ? 'Collapse' : 'Expand' }, D.icon('chevron-right'));
      D.tap(arrow, function () {
        b.open = !b.open;
        arrow.classList.toggle('open', b.open);
        self.refreshDerived();
        self.changed(true);
        if (b.open && !self.hasChildren(b)) { self.insertAfter(b.id, Docs.newBlock('p', { d: (b.d || 0) + 1 }), true); }
      });
      row.appendChild(arrow);
    }
    if (b.type === 'callout') {
      var ic = D.el('button.co-icon', { type: 'button', text: b.icon || '💡' });
      D.tap(ic, function () {
        if (self.locked()) { return; }
        K.emojiPicker(ic, function (e) { b.icon = e; ic.textContent = e; self.changed(true); });
      });
      row.appendChild(ic);
    }
    var rt = D.el('div.rt', { 'data-ph': PH[b.type] || '' });
    rt.innerHTML = R.clean(b.html || '');
    this.refreshMentions(rt);
    if (!this.locked()) { rt.setAttribute('contenteditable', 'true'); }
    if (b.font) { rt.style.fontFamily = K.Fonts.stack(b.font); }
    entry.rt = rt;
    row.appendChild(rt);
    return row;
  };

  // Page mentions show the current title of the page
  P.refreshMentions = function (rt) {
    var ms = rt.querySelectorAll('.mention');
    for (var i = 0; i < ms.length; i++) {
      var d = Docs.get(ms[i].getAttribute('data-page'));
      ms[i].textContent = d && Docs.isLive(d) ? Docs.titleOf(d) : 'Deleted page';
      ms[i].classList.toggle('gone', !(d && Docs.isLive(d)));
    }
  };

  P.rerender = function (id) {
    var e = this.els[id], b = this.block(id);
    if (!e || !b) { return null; }
    var fresh = this.buildBlock(b);
    e.wrap.parentNode.replaceChild(fresh, e.wrap);
    this.refreshDerived();
    return this.els[id];
  };

  P.hasChildren = function (b) {
    var i = this.index(b.id), n = this.blocks[i + 1];
    return !!(n && (n.d || 0) > (b.d || 0));
  };

  // Hide blocks inside closed toggles; number lists; empty-page placeholder
  P.refreshDerived = function () {
    var closed = [], counters = [], self = this;
    this.blocks.forEach(function (b, i) {
      var d = b.d || 0;
      while (closed.length && d <= closed[closed.length - 1]) { closed.pop(); }
      var e = self.els[b.id];
      if (!e) { return; }
      var hidden = closed.length > 0;
      e.wrap.style.display = hidden ? 'none' : '';
      if (!hidden && (b.type === 'toggle' || (b.tg && /^h[123]$/.test(b.type))) && !b.open) { closed.push(d); }
      // numbering: restart when something else interrupts at the same depth
      counters.length = d + 1;
      if (b.type === 'num') {
        var cont = false;
        for (var k = i - 1; k >= 0; k--) {
          var pk = self.blocks[k];
          if ((pk.d || 0) < d) { break; }
          if ((pk.d || 0) === d) { cont = pk.type === 'num'; break; }
        }
        counters[d] = cont ? (counters[d] || 0) + 1 : 1;
        var n = e.wrap.querySelector('.num-n');
        if (n) { n.textContent = numberLabel(counters[d], d) + '.'; }
      } else if ((b.d || 0) === d) {
        counters[d] = 0;
      }
    });
    if (!this.nested) {
      var only = this.blocks.length === 1 && this.blocks[0].type === 'p' && !Docs.plain(this.blocks[0].html);
      this.el.classList.toggle('empty-page', only);
    }
    if (this.page.onDerived) { this.page.onDerived(); }
  };

  function numberLabel(n, d) {
    if (d % 3 === 1) { return String.fromCharCode(96 + ((n - 1) % 26) + 1); }
    if (d % 3 === 2) { return roman(n); }
    return String(n);
  }
  function roman(n) {
    var v = [10, 9, 5, 4, 1], s = ['x', 'ix', 'v', 'iv', 'i'], out = '';
    for (var i = 0; i < v.length; i++) { while (n >= v[i]) { out += s[i]; n -= v[i]; } }
    return out;
  }

  // ---------- changes / history ----------

  P.snapshot = function () { this.page.snapshot(); };
  P.changed = function (structural) {
    if (structural) { this.refreshDerived(); }
    this.page.changed(structural);
  };

  P.syncFromDom = function (id) {
    var b = this.block(id), rt = this.rt(id);
    if (b && rt) { b.html = rt.innerHTML; }
  };

  // ---------- focus ----------

  P.focus = function (id, offset) {
    var self = this, b = this.block(id);
    if (!b) { return; }
    var rt = this.rt(id);
    if (!rt) {
      var e = this.els[id];
      if (e && e.focusEl) { e.focusEl.focus(); }
      return;
    }
    R.place(rt, offset === undefined ? -1 : offset);
    setTimeout(function () { if (document.activeElement === rt) { self.scrollIntoView(rt); } }, 30);
  };

  P.scrollIntoView = function (el) {
    var sc = this.page.scroller;
    if (!sc) { return; }
    var r = el.getBoundingClientRect(), s = sc.getBoundingClientRect();
    if (r.bottom > s.bottom - 60) { sc.scrollTop += r.bottom - s.bottom + 80; }
    else if (r.top < s.top + 10) { sc.scrollTop -= s.top - r.top + 40; }
  };

  // nearest visible text block before/after index
  P.textNeighbour = function (i, dir) {
    for (var k = i + dir; k >= 0 && k < this.blocks.length; k += dir) {
      var b = this.blocks[k], e = this.els[b.id];
      if (e && e.wrap.style.display !== 'none' && TEXT[b.type]) { return b; }
    }
    return null;
  };

  P.onFocus = function (e) {
    var w = this.own(e.target);
    if (!w) { return; }
    this.page.current = { ed: this, id: w.getAttribute('data-id') };
  };

  P.onClick = function (e) {
    // clicking an empty area below the last block focuses / adds a block
    if (e.target === this.el && !this.locked()) {
      var last = this.blocks[this.blocks.length - 1];
      if (last && TEXT[last.type] && !Docs.plain(last.html)) { this.focus(last.id); return; }
      if (!last || !TEXT[last.type] || Docs.plain(last.html)) { this.insertAfter(last ? last.id : null, Docs.newBlock('p'), true); }
    }
  };

  // ---------- structure ops ----------

  P.insertAfter = function (afterId, nb, focus) {
    this.snapshot();
    var i = afterId ? this.index(afterId) : this.blocks.length - 1;
    // skip the hidden children of a closed toggle
    if (i >= 0) {
      var a = this.blocks[i];
      if ((a.type === 'toggle' || a.tg) && !a.open && nb.d <= (a.d || 0)) {
        while (i + 1 < this.blocks.length && (this.blocks[i + 1].d || 0) > (a.d || 0)) { i++; }
      }
    }
    this.blocks.splice(i + 1, 0, nb);
    var el = this.buildBlock(nb);
    var ref = i >= 0 && this.els[this.blocks[i].id] ? this.els[this.blocks[i].id].wrap.nextSibling : this.el.firstChild;
    this.el.insertBefore(el, ref || null);
    this.changed(true);
    if (focus) { this.focus(nb.id, 0); }
    return nb;
  };

  P.removeBlock = function (id, keepFocus) {
    var i = this.index(id);
    if (i < 0) { return; }
    var e = this.els[id];
    this.blocks.splice(i, 1);
    if (e) { D.remove(e.wrap); delete this.els[id]; }
    if (!this.blocks.length && !this.nested) { this.insertAfter(null, Docs.newBlock('p'), !keepFocus); }
    this.changed(true);
  };

  // Turn a block into another type, keeping its text where possible
  P.turnInto = function (id, type, extra) {
    var b = this.block(id);
    if (!b) { return; }
    this.snapshot();
    this.syncFromDom(id);
    var text = Docs.plain(b.html);
    if (TEXT[type] || !TEXT[b.type]) {
      if (type === 'code') { b.text = text; }
    }
    if (type === 'code') { b.text = b.text || text; b.lang = b.lang || 'plain'; delete b.html; }
    else if (b.type === 'code' && TEXT[type]) { b.html = R.text(b.text || ''); delete b.text; }
    b.type = type;
    if (type !== 'todo') { delete b.checked; }
    if (!/^h[123]$/.test(type)) { delete b.tg; }
    if (extra) { U.extend(b, extra); }
    this.rerender(id);
    this.changed(true);
    this.focus(id);
  };

  // Move a block with everything nested under it
  P.span = function (i) {
    var d = this.blocks[i].d || 0, j = i + 1;
    while (j < this.blocks.length && (this.blocks[j].d || 0) > d) { j++; }
    return j - i;
  };

  P.indent = function (id, dir) {
    var i = this.index(id);
    if (i < 0) { return; }
    var b = this.blocks[i], d = b.d || 0;
    var max = i > 0 ? (this.blocks[i - 1].d || 0) + 1 : 0;
    var nd = U.clamp(d + dir, 0, Math.min(max, 8));
    if (nd === d) { return; }
    this.snapshot();
    this.syncFromDom(id);
    var n = this.span(i), delta = nd - d;
    for (var k = i; k < i + n; k++) {
      this.blocks[k].d = Math.max(0, (this.blocks[k].d || 0) + delta);
      this.syncFromDom(this.blocks[k].id);
      this.rerender(this.blocks[k].id);
    }
    this.changed(true);
    this.focus(id, R.caret(this.rt(id) || document.body));
  };

  P.duplicate = function (id) {
    var i = this.index(id);
    if (i < 0) { return; }
    this.syncFromDom(id);
    var n = this.span(i), copies = [];
    for (var k = i; k < i + n; k++) {
      var c = JSON.parse(JSON.stringify(this.blocks[k]));
      c.id = Docs.newBlock().id;
      delete c.conflict;
      copies.push(c);
    }
    this.snapshot();
    Array.prototype.splice.apply(this.blocks, [i + n, 0].concat(copies));
    this.render();
    this.changed(true);
    this.focus(copies[0].id);
  };

  P.moveBlock = function (id, toIndex) {
    var i = this.index(id);
    if (i < 0) { return; }
    var n = this.span(i);
    if (toIndex > i && toIndex <= i + n) { return; }
    this.snapshot();
    var moving = this.blocks.splice(i, n);
    if (toIndex > i) { toIndex -= n; }
    // the moved block takes the depth of its new neighbourhood
    var prev = this.blocks[toIndex - 1];
    var maxD = prev ? (prev.d || 0) + 1 : 0, base = moving[0].d || 0;
    var nd = Math.min(base, maxD), delta = nd - base;
    moving.forEach(function (m) { m.d = Math.max(0, (m.d || 0) + delta); });
    Array.prototype.splice.apply(this.blocks, [toIndex, 0].concat(moving));
    this.render();
    this.changed(true);
  };

  P.addBelow = function (id) {
    if (this.locked()) { return; }
    var b = this.block(id);
    var target = b;
    if (!(b && TEXT[b.type] && b.type === 'p' && !Docs.plain(b.html))) {
      target = this.insertAfter(id, Docs.newBlock('p', { d: b ? b.d || 0 : 0 }), true);
    } else {
      this.focus(id);
    }
    var self = this;
    setTimeout(function () { K.slashMenu.open(self, target.id, true); }, 50);
  };

  // ---------- keyboard ----------

  P.onKey = function (e) {
    var w = this.own(e.target);
    if (!w || this.locked()) { return; }
    var id = w.getAttribute('data-id'), b = this.block(id);
    if (!b) { return; }
    if (K.menuKey && K.menuKey(e)) { return; }
    var rt = this.rt(id);
    var mod = e.ctrlKey || e.metaKey, k = e.keyCode;
    if (!rt || e.target !== rt) { return; }

    if (mod && e.altKey && (k === 49 || k === 50 || k === 51 || k === 48)) {
      e.preventDefault();
      this.turnInto(id, k === 48 ? 'p' : 'h' + (k - 48));
      return;
    }
    if (mod && k === 13) { // Ctrl+Enter: tick a to-do / open a toggle
      e.preventDefault();
      if (b.type === 'todo') { b.checked = !b.checked; this.rerender(id); this.focus(id); this.changed(true); }
      else if (b.type === 'toggle' || b.tg) { b.open = !b.open; this.rerender(id); this.focus(id); this.changed(true); }
      return;
    }
    if (mod && k === 68) { e.preventDefault(); this.duplicate(id); return; }
    if (mod && k === 69) { e.preventDefault(); if (R.wrap('code')) { this.syncFromDom(id); this.changed(); } return; }
    if (mod && k === 75) { e.preventDefault(); K.selectionLink(this, id); return; }
    if (mod && e.shiftKey && k === 83) { e.preventDefault(); document.execCommand('strikeThrough', false, null); this.syncFromDom(id); this.changed(); return; }

    if (k === 13 && !e.shiftKey) { e.preventDefault(); this.enter(b, rt); return; }
    if (k === 13 && e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertHTML', false, R.atEnd(rt) ? '<br><br>' : '<br>');
      this.syncFromDom(id);
      this.changed();
      return;
    }
    if (k === 8 && R.atStart(rt)) { e.preventDefault(); this.backspaceAtStart(b, rt); return; }
    if (k === 46 && R.atEnd(rt)) { e.preventDefault(); this.deleteAtEnd(b, rt); return; }
    if (k === 9) { e.preventDefault(); this.indent(id, e.shiftKey ? -1 : 1); return; }
    if (k === 38 && !e.shiftKey && R.onFirstLine(rt)) {
      var up = this.textNeighbour(this.index(id), -1);
      if (up) { e.preventDefault(); this.focus(up.id); } else if (this.page.focusTitle && !this.nested) { e.preventDefault(); this.page.focusTitle(); }
      return;
    }
    if (k === 40 && !e.shiftKey && R.onLastLine(rt)) {
      var dn = this.textNeighbour(this.index(id), 1);
      if (dn) { e.preventDefault(); this.focus(dn.id, 0); }
    }
  };

  P.enter = function (b, rt) {
    this.syncFromDom(b.id);
    var empty = !Docs.plain(b.html).replace(/\s+/g, '') && !/mention|mdate/.test(b.html || '');
    if (empty && (LISTY[b.type] || b.type === 'quote' || b.type === 'callout')) {
      if (b.d) { this.indent(b.id, -1); } else { this.turnInto(b.id, 'p'); }
      return;
    }
    this.snapshot();
    var caretAtStart = R.atStart(rt) && !empty;
    if (caretAtStart) {
      // Enter at the start: open an empty line above, keep this block
      var above = Docs.newBlock(LISTY[b.type] ? b.type : 'p', { d: b.d || 0 });
      var i = this.index(b.id);
      this.blocks.splice(i, 0, above);
      this.els[b.id].wrap.parentNode.insertBefore(this.buildBlock(above), this.els[b.id].wrap);
      this.changed(true);
      this.focus(b.id, 0);
      return;
    }
    var after = R.splitAfterCaret(rt);
    b.html = R.clean(rt.innerHTML);
    rt.innerHTML = b.html;
    this.refreshMentions(rt);
    var type = LISTY[b.type] ? b.type : 'p', d = b.d || 0;
    if ((b.type === 'toggle' || b.tg) && b.open) { type = 'p'; d = d + 1; }
    var nb = Docs.newBlock(type, { d: d, html: after });
    this.insertAfter(b.id, nb, false);
    this.focus(nb.id, 0);
  };

  P.backspaceAtStart = function (b, rt) {
    if (b.type !== 'p') { this.turnInto(b.id, 'p'); this.focus(b.id, 0); return; }
    if (b.d) { this.indent(b.id, -1); this.focus(b.id, 0); return; }
    var i = this.index(b.id);
    var prev = i > 0 ? this.blocks[i - 1] : null;
    if (!prev) { return; }
    this.syncFromDom(b.id);
    if (!TEXT[prev.type]) {
      if (!Docs.plain(b.html)) {
        this.removeBlock(b.id);
        var t = this.textNeighbour(i, -1);
        if (t) { this.focus(t.id); }
      }
      return;
    }
    if (this.els[prev.id].wrap.style.display === 'none') { return; }
    this.snapshot();
    this.syncFromDom(prev.id);
    var prt = this.rt(prev.id);
    var at = R.length(prt);
    prev.html = R.clean((prev.html || '') + (b.html || ''));
    this.blocks.splice(i, 1);
    D.remove(this.els[b.id].wrap);
    delete this.els[b.id];
    var e = this.rerender(prev.id);
    this.changed(true);
    R.place(e.rt, at);
  };

  P.deleteAtEnd = function (b, rt) {
    var i = this.index(b.id), next = this.blocks[i + 1];
    if (!next || !TEXT[next.type]) { return; }
    this.snapshot();
    this.syncFromDom(b.id);
    this.syncFromDom(next.id);
    var at = R.length(rt);
    b.html = R.clean((b.html || '') + (next.html || ''));
    this.blocks.splice(i + 1, 1);
    D.remove(this.els[next.id].wrap);
    delete this.els[next.id];
    var e = this.rerender(b.id);
    this.changed(true);
    R.place(e.rt, at);
  };

  // ---------- typing ----------

  var SHORTCUTS = [
    [/^#\s$/, 'h1'], [/^##\s$/, 'h2'], [/^###\s$/, 'h3'],
    [/^[-*+]\s$/, 'bul'], [/^1[.)]\s$/, 'num'], [/^\[\s?\]\s$/, 'todo'], [/^\[x\]\s$/i, 'todo', { checked: true }],
    [/^>\s$/, 'toggle'], [/^"\s$/, 'quote'], [/^!\s$/, 'callout']
  ];

  P.onInput = function (e) {
    var w = this.own(e.target);
    if (!w) { return; }
    var id = w.getAttribute('data-id'), b = this.block(id), rt = this.rt(id);
    if (!b || !rt || e.target !== rt) { return; }
    var before = R.textBefore().replace(/ /g, ' ');
    var full = (rt.textContent || '').replace(/ /g, ' ');
    // block shortcuts typed at the very start of a block
    if (b.type === 'p' || b.type === 'bul' || b.type === 'num' || b.type === 'todo') {
      for (var i = 0; i < SHORTCUTS.length; i++) {
        if (SHORTCUTS[i][0].test(before) && full.indexOf(before) === 0 && (b.type === 'p' || /^#/.test(before))) {
          R.deleteBefore(before.length);
          this.syncFromDom(id);
          this.turnInto(id, SHORTCUTS[i][1], SHORTCUTS[i][2]);
          this.focus(id, 0);
          return;
        }
      }
      if (b.type === 'p' && full === '---') { this.syncFromDom(id); b.html = ''; this.turnInto(id, 'div'); this.insertAfter(id, Docs.newBlock('p'), true); return; }
      if (b.type === 'p' && full === '```') { b.html = ''; this.turnInto(id, 'code', { text: '', lang: 'plain' }); return; }
    }
    if (/[*_~`]$/.test(before) && R.inlineMarkdown()) { /* converted */ }
    this.syncFromDom(id);
    this.changed();
    // menus
    if (/(^|\s)\/[^\s/]{0,24}$/.test(before)) { K.slashMenu.track(this, id, before); }
    else if (K.slashMenu.isOpenFor(this, id)) { K.slashMenu.close(); }
    if (/(^|\s)@[^@]{0,30}$/.test(before)) { K.mentionMenu.track(this, id, before, '@'); }
    else if (/\[\[[^\]]{0,30}$/.test(before)) { K.mentionMenu.track(this, id, before, '[['); }
    else if (K.mentionMenu.isOpenFor(this, id)) { K.mentionMenu.close(); }
  };

  P.onPaste = function (e) {
    var w = this.own(e.target);
    if (!w || this.locked()) { return; }
    var id = w.getAttribute('data-id'), b = this.block(id), rt = this.rt(id);
    if (!b || !rt || e.target !== rt && !rt.contains(e.target)) { return; }
    var cd = e.clipboardData || window.clipboardData;
    if (!cd) { return; }
    var text = cd.getData('text/plain') || cd.getData('Text') || '';
    var html = cd.getData && cd.getData('text/html');
    e.preventDefault();
    this.snapshot();
    var lines = text.replace(/\r/g, '').split('\n');
    if (lines.length <= 1) {
      var s = R.sel();
      if (/^https?:\/\/\S+$/.test(text) && s && !s.isCollapsed) { document.execCommand('createLink', false, text); }
      else { document.execCommand('insertHTML', false, html ? R.clean(html) : R.text(text)); }
      this.syncFromDom(id);
      this.changed();
      return;
    }
    // several lines: each becomes a block (Markdown list/heading prefixes understood)
    var after = R.splitAfterCaret(rt);
    document.execCommand('insertHTML', false, R.text(lines[0]));
    this.syncFromDom(id);
    var last = b, self = this;
    lines.slice(1).forEach(function (line) {
      var nb = K.blockFromMarkdownLine(line);
      self.blocks.splice(self.index(last.id) + 1, 0, nb);
      last = nb;
    });
    if (after) { last.html = (last.html || '') + after; }
    this.render();
    this.changed(true);
    this.focus(last.id);
  };

  // One line of Markdown -> a block
  K.blockFromMarkdownLine = function (line) {
    var m, d = 0;
    var lead = /^(\s*)/.exec(line)[1].replace(/\t/g, '    ').length;
    d = Math.min(6, Math.floor(lead / 2));
    var t = line.replace(/^\s+/, '');
    if ((m = /^(#{1,3})\s+(.*)$/.exec(t))) { return Docs.newBlock('h' + m[1].length, { html: R.text(m[2]) }); }
    if ((m = /^[-*+]\s+\[( |x)\]\s+(.*)$/i.exec(t))) { return Docs.newBlock('todo', { d: d, checked: m[1].toLowerCase() === 'x', html: R.text(m[2]) }); }
    if ((m = /^[-*+]\s+(.*)$/.exec(t))) { return Docs.newBlock('bul', { d: d, html: R.text(m[1]) }); }
    if ((m = /^\d+[.)]\s+(.*)$/.exec(t))) { return Docs.newBlock('num', { d: d, html: R.text(m[1]) }); }
    if ((m = /^>\s?(.*)$/.exec(t))) { return Docs.newBlock('quote', { html: R.text(m[1]) }); }
    if (/^(-{3,}|\*{3,})$/.test(t)) { return Docs.newBlock('div'); }
    return Docs.newBlock('p', { d: d, html: R.text(t) });
  };

  Editor.byUid = {};
  K.Editor = Editor;
  K.BlockViews = K.BlockViews || {};
})(window.Kagoj = window.Kagoj || {});
