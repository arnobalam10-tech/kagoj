(function (K) {
  'use strict';

  // Rich text inside blocks: a small, safe HTML subset.
  //   b i u s code a[href] br, span.c-<colour> / span.bg-<colour>,
  //   span.mention[data-page], span.mdate[data-date][data-remind]
  // Everything else is unwrapped to its text. Parsing happens in an inert
  // document, so pasted HTML can never run scripts.
  var R = {};
  R.COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

  var TAGMAP = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', STRIKE: 's', DEL: 's', CODE: 'code', A: 'a', BR: 'br', SPAN: 'span', FONT: 'span' };
  var BLOCKISH = { DIV: 1, P: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, BLOCKQUOTE: 1, PRE: 1, TR: 1 };

  var inert = null;
  function doc() {
    if (!inert) { inert = document.implementation.createHTMLDocument(''); }
    return inert;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  R.esc = esc;

  function safeHref(h) {
    h = String(h || '').replace(/^\s+|\s+$/g, '');
    if (/^(https?:|mailto:|tel:|#\/)/i.test(h)) { return h; }
    if (/^www\./i.test(h)) { return 'http://' + h; }
    return null;
  }

  function colorClass(node) {
    var cls = (node.getAttribute && node.getAttribute('class')) || '', m;
    var out = [];
    if ((m = /(?:^|\s)(c-[a-z]+)(?:\s|$)/.exec(cls)) && R.COLORS.indexOf(m[1].substr(2)) >= 0) { out.push(m[1]); }
    if ((m = /(?:^|\s)(bg-[a-z]+)(?:\s|$)/.exec(cls)) && R.COLORS.indexOf(m[1].substr(3)) >= 0) { out.push(m[1]); }
    return out.join(' ');
  }

  function walk(node, out) {
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { out.push(esc(c.nodeValue)); continue; }
      if (c.nodeType !== 1) { continue; }
      var tag = c.tagName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TITLE' || tag === 'META') { continue; }
      var cls = c.getAttribute('class') || '';
      if (tag === 'SPAN' && /(^|\s)mention(\s|$)/.test(cls) && c.getAttribute('data-page')) {
        var pid = String(c.getAttribute('data-page')).replace(/[^a-z0-9\-]/gi, '');
        out.push('<span class="mention" data-page="' + pid + '" contenteditable="false">' + esc(c.textContent) + '</span>');
        continue;
      }
      if (tag === 'SPAN' && /(^|\s)mdate(\s|$)/.test(cls) && c.getAttribute('data-date')) {
        var dt = String(c.getAttribute('data-date')).replace(/[^0-9T:\-]/g, '');
        var rem = c.getAttribute('data-remind') ? ' data-remind="1"' : '';
        out.push('<span class="mdate' + (rem ? ' remind' : '') + '" data-date="' + dt + '"' + rem + ' contenteditable="false">' + esc(c.textContent) + '</span>');
        continue;
      }
      var t = TAGMAP[tag];
      if (t === 'br') { out.push('<br>'); continue; }
      if (!t) {
        walk(c, out);
        if (BLOCKISH[tag] && c.nextSibling) { out.push('<br>'); }
        continue;
      }
      if (t === 'a') {
        var href = safeHref(c.getAttribute('href'));
        if (!href) { walk(c, out); continue; }
        out.push('<a href="' + esc(href) + '">');
        walk(c, out);
        out.push('</a>');
        continue;
      }
      if (t === 'span') {
        var cc = colorClass(c);
        // execCommand/foreColor and pasted styles become our colour classes
        var style = (c.getAttribute('style') || '') + (tag === 'FONT' && c.getAttribute('color') ? ';color:' + c.getAttribute('color') : '');
        var bold = /font-weight:\s*(bold|[6-9]00)/i.test(style), ital = /font-style:\s*italic/i.test(style);
        if (bold) { out.push('<b>'); }
        if (ital) { out.push('<i>'); }
        if (cc) { out.push('<span class="' + cc + '">'); }
        walk(c, out);
        if (cc) { out.push('</span>'); }
        if (ital) { out.push('</i>'); }
        if (bold) { out.push('</b>'); }
        continue;
      }
      out.push('<' + t + '>');
      walk(c, out);
      out.push('</' + t + '>');
    }
  }

  R.clean = function (html) {
    var d = doc().createElement('div');
    d.innerHTML = String(html || '');
    var out = [];
    walk(d, out);
    var s = out.join('');
    // tidy: no trailing <br>, no empty tags
    s = s.replace(/\u200b/g, '').replace(/(<br>)+$/, '').replace(/<(b|i|u|s|code)><\/\1>/g, '');
    return s;
  };

  R.text = function (s) { return esc(s).replace(/\n/g, '<br>'); };

  // ---------- caret helpers (work on a contenteditable element) ----------

  R.sel = function () { return window.getSelection ? window.getSelection() : null; };

  R.within = function (el) {
    var s = R.sel();
    if (!s || !s.rangeCount) { return false; }
    var n = s.getRangeAt(0).startContainer;
    return n === el || el.contains(n);
  };

  // Character offset of the caret from the start of el
  R.caret = function (el) {
    var s = R.sel();
    if (!s || !s.rangeCount || !R.within(el)) { return -1; }
    var r = s.getRangeAt(0).cloneRange();
    r.selectNodeContents(el);
    r.setEnd(s.getRangeAt(0).startContainer, s.getRangeAt(0).startOffset);
    return r.toString().length;
  };

  R.length = function (el) { return (el.textContent || '').length; };
  R.atStart = function (el) { var s = R.sel(); return R.caret(el) === 0 && s && s.isCollapsed; };
  R.atEnd = function (el) { var s = R.sel(); return s && s.isCollapsed && R.caret(el) >= R.length(el); };

  // Put the caret at a character offset (or at the end with -1)
  R.place = function (el, offset) {
    el.focus();
    var s = R.sel();
    if (!s) { return; }
    var r = document.createRange();
    if (offset === undefined || offset < 0) {
      r.selectNodeContents(el);
      r.collapse(false);
    } else {
      var left = offset, found = false;
      var walker = document.createTreeWalker(el, 4, null, false); // text nodes
      var n;
      while ((n = walker.nextNode())) {
        if (left <= n.nodeValue.length) { r.setStart(n, left); found = true; break; }
        left -= n.nodeValue.length;
      }
      if (!found) { r.selectNodeContents(el); r.collapse(offset === 0); }
      else { r.collapse(true); }
    }
    s.removeAllRanges();
    s.addRange(r);
  };

  // Cut everything after the caret out of el; returns its HTML.
  R.splitAfterCaret = function (el) {
    var s = R.sel();
    if (!s || !s.rangeCount) { return ''; }
    var r = s.getRangeAt(0).cloneRange();
    if (!s.isCollapsed) { s.getRangeAt(0).deleteContents(); r = s.getRangeAt(0).cloneRange(); }
    var end = document.createRange();
    end.selectNodeContents(el);
    r.setEnd(end.endContainer, end.endOffset);
    var frag = r.extractContents();
    var box = document.createElement('div');
    box.appendChild(frag);
    return R.clean(box.innerHTML);
  };

  // Screen rect of the caret / selection (Safari 9 gives empty rects for
  // collapsed ranges, so a temporary marker is used then).
  R.caretRect = function () {
    var s = R.sel();
    if (!s || !s.rangeCount) { return null; }
    var r = s.getRangeAt(0);
    var rects = r.getClientRects();
    if (rects.length && rects[0].height) { return rects[rects.length - 1]; }
    var mark = document.createElement('span');
    mark.appendChild(document.createTextNode('\u200b'));
    var c = r.cloneRange();
    c.collapse(true);
    c.insertNode(mark);
    var rect = mark.getBoundingClientRect();
    var parent = mark.parentNode;
    parent.removeChild(mark);
    if (parent.normalize) { parent.normalize(); }
    return rect;
  };

  // Is the caret on the first / last visual line of el?
  R.onFirstLine = function (el) {
    var c = R.caretRect(), r = el.getBoundingClientRect();
    return !c || c.top - r.top < Math.max(14, c.height * 0.8);
  };
  R.onLastLine = function (el) {
    var c = R.caretRect(), r = el.getBoundingClientRect();
    return !c || r.bottom - c.bottom < Math.max(14, c.height * 0.8);
  };

  // Text typed just before the caret inside its text node
  R.textBefore = function () {
    var s = R.sel();
    if (!s || !s.rangeCount || !s.isCollapsed) { return ''; }
    var r = s.getRangeAt(0);
    if (r.startContainer.nodeType !== 3) { return ''; }
    return r.startContainer.nodeValue.substr(0, r.startOffset);
  };

  // Delete n characters before the caret (same text node)
  R.deleteBefore = function (n) {
    var s = R.sel();
    if (!s || !s.rangeCount) { return; }
    var r = s.getRangeAt(0), node = r.startContainer;
    if (node.nodeType !== 3) { return; }
    var at = r.startOffset;
    node.nodeValue = node.nodeValue.substr(0, Math.max(0, at - n)) + node.nodeValue.substr(at);
    var nr = document.createRange();
    nr.setStart(node, Math.max(0, at - n));
    nr.collapse(true);
    s.removeAllRanges();
    s.addRange(nr);
  };

  // Insert a node at the caret and put the caret after it
  R.insertNode = function (node, after) {
    var s = R.sel();
    if (!s || !s.rangeCount) { return; }
    var r = s.getRangeAt(0);
    r.deleteContents();
    r.insertNode(node);
    var tail = document.createTextNode(after === undefined ? '\u00a0' : after);
    if (node.nextSibling) { node.parentNode.insertBefore(tail, node.nextSibling); } else { node.parentNode.appendChild(tail); }
    var nr = document.createRange();
    nr.setStart(tail, tail.nodeValue.length);
    nr.collapse(true);
    s.removeAllRanges();
    s.addRange(nr);
  };

  // Wrap the current selection in <tag class=cls>
  R.wrap = function (tag, cls) {
    var s = R.sel();
    if (!s || !s.rangeCount || s.isCollapsed) { return false; }
    var r = s.getRangeAt(0);
    var frag = r.extractContents();
    // remove an existing colour of the same kind inside the selection
    if (cls) {
      var kind = cls.indexOf('bg-') === 0 ? 'bg-' : 'c-';
      var spans = frag.querySelectorAll ? frag.querySelectorAll('span') : [];
      for (var i = 0; i < spans.length; i++) {
        var c = spans[i].getAttribute('class') || '';
        if (c.indexOf(kind) === 0 || c.indexOf(' ' + kind) >= 0) {
          while (spans[i].firstChild) { spans[i].parentNode.insertBefore(spans[i].firstChild, spans[i]); }
          spans[i].parentNode.removeChild(spans[i]);
        }
      }
    }
    var range = document.createRange();
    if (cls && /-default$/.test(cls)) {
      // "default" colour: put the plain contents back without a wrapper
      var first = frag.firstChild, last = frag.lastChild;
      r.insertNode(frag);
      if (first && last) { range.setStartBefore(first); range.setEndAfter(last); }
    } else {
      var w = document.createElement(tag);
      if (cls) { w.className = cls; }
      w.appendChild(frag);
      r.insertNode(w);
      range.selectNodeContents(w);
    }
    s.removeAllRanges();
    s.addRange(range);
    return true;
  };

  // Inline Markdown as you type: **bold**, *italic*, ~strike~, `code`
  var INLINE = [
    [/\*\*([^*]+)\*\*$/, 'b'], [/__([^_]+)__$/, 'b'],
    [/(^|[^*])\*([^*\s][^*]*)\*$/, 'i'], [/(^|[^_])_([^_\s][^_]*)_$/, 'i'],
    [/~~?([^~]+)~~?$/, 's'], [/`([^`]+)`$/, 'code']
  ];
  R.inlineMarkdown = function () {
    var s = R.sel();
    if (!s || !s.rangeCount || !s.isCollapsed) { return false; }
    var r = s.getRangeAt(0), node = r.startContainer;
    if (node.nodeType !== 3) { return false; }
    var before = node.nodeValue.substr(0, r.startOffset);
    for (var i = 0; i < INLINE.length; i++) {
      var m = INLINE[i][0].exec(before);
      if (!m) { continue; }
      var inner = m[m.length - 1];
      var lead = m.length > 2 ? m[1] : '';
      var start = m.index + lead.length;
      var after = node.nodeValue.substr(r.startOffset);
      node.nodeValue = before.substr(0, start);
      var el = document.createElement(INLINE[i][1]);
      el.appendChild(document.createTextNode(inner));
      var tail = document.createTextNode('\u200b' + after);
      var parent = node.parentNode;
      parent.insertBefore(el, node.nextSibling);
      parent.insertBefore(tail, el.nextSibling);
      var nr = document.createRange();
      nr.setStart(tail, 1);
      nr.collapse(true);
      s.removeAllRanges();
      s.addRange(nr);
      return true;
    }
    return false;
  };

  K.rich = R;
})(window.Kagoj = window.Kagoj || {});
