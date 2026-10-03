(function (K) {
  'use strict';

  var D = K.dom;
  var S = {};
  var stack = [];

  function overlay(onBackdrop, cls) {
    var ov = D.el('div.overlay' + (cls ? '.' + cls : ''));
    var back = D.el('div.backdrop');
    ov.appendChild(back);
    D.tap(back, function () { if (onBackdrop) { onBackdrop(); } });
    // keep the page underneath from scrolling
    D.on(ov, 'touchmove', function (e) {
      var t = e.target;
      while (t && t !== ov) {
        if (t.classList && t.classList.contains('scrolls')) { return; }
        t = t.parentNode;
      }
      if (e.cancelable) { e.preventDefault(); }
    }, D.passiveFalse);
    document.body.appendChild(ov);
    // next frame -> fade in
    setTimeout(function () { ov.classList.add('open'); }, 10);
    return ov;
  }

  function closeOverlay(ov, after) {
    ov.classList.remove('open');
    var i = stack.indexOf(ov);
    if (i >= 0) { stack.splice(i, 1); }
    setTimeout(function () { D.remove(ov); if (after) { after(); } }, 160);
  }

  S.closeAll = function () {
    var list = stack.slice();
    for (var i = 0; i < list.length; i++) { closeOverlay(list[i]); }
  };

  S.isOpen = function () { return stack.length > 0; };

  // modal({title, body: el, actions: [{label, primary, danger, onTap(close)}], onClose, cls})
  S.modal = function (o) {
    var closed = false;
    var ov = overlay(function () { close(); }, 'overlay-modal');
    function close() {
      if (closed) { return; }
      closed = true;
      if (document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }
      closeOverlay(ov, o.onClose);
    }
    var panel = D.el('div.sheet' + (o.cls ? '.' + o.cls : ''));
    if (o.title) { panel.appendChild(D.el('div.sheet-title', { text: o.title })); }
    if (o.body) { var b = D.el('div.sheet-body.scrolls', null, o.body); panel.appendChild(b); }
    if (o.actions && o.actions.length) {
      var row = D.el('div.sheet-actions');
      o.actions.forEach(function (a) {
        var btn = D.button({ label: a.label, cls: 'sheet-btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '') });
        D.tap(btn, function () {
          if (a.onTap) { if (a.onTap(close) === false) { return; } }
          close();
        });
        row.appendChild(btn);
      });
      panel.appendChild(row);
    }
    ov.appendChild(panel);
    stack.push(ov);
    return { close: close, panel: panel };
  };

  // actionSheet({title, items: [{label, icon, danger, checked, onTap}]})
  S.actionSheet = function (o) {
    var list = D.el('div.action-list');
    var m;
    o.items.forEach(function (it) {
      if (!it) { return; }
      var row = D.el('button.action-item' + (it.danger ? '.danger' : '') + (it.checked ? '.checked' : ''), { type: 'button' });
      if (it.icon) { row.appendChild(D.icon(it.icon)); }
      row.appendChild(D.el('span', { text: it.label }));
      if (it.checked) { row.appendChild(D.icon('check', 'check')); }
      D.tap(row, function () {
        m.close();
        if (it.onTap) { setTimeout(it.onTap, 170); }
      });
      list.appendChild(row);
    });
    m = S.modal({ title: o.title, body: list, actions: [{ label: 'Cancel' }], cls: 'sheet-actions-only' });
    return m;
  };

  S.confirm = function (o, cb) {
    var answered = false;
    S.modal({
      title: o.title,
      body: o.message ? D.el('p.sheet-text', { text: o.message }) : null,
      actions: [
        { label: o.cancel || 'Cancel', onTap: function () { answered = true; cb(false); } },
        { label: o.ok || 'OK', primary: !o.danger, danger: !!o.danger, onTap: function () { answered = true; cb(true); } }
      ],
      onClose: function () { if (!answered) { cb(false); } }
    });
  };

  S.prompt = function (o, cb) {
    var input = D.el('input.text-input', {
      type: 'text', value: o.value || '', maxlength: o.max || 120,
      autocapitalize: 'sentences', autocorrect: 'off', spellcheck: 'false'
    });
    var answered = false;
    var m = S.modal({
      title: o.title,
      body: input,
      actions: [
        { label: 'Cancel', onTap: function () { answered = true; cb(null); } },
        { label: o.ok || 'Save', primary: true, onTap: function () { answered = true; cb(input.value); } }
      ],
      onClose: function () { if (!answered) { cb(null); } }
    });
    D.on(input, 'keydown', function (e) {
      if (e.keyCode === 13) { answered = true; m.close(); cb(input.value); }
    });
    input.focus();
    try { input.setSelectionRange(0, input.value.length); } catch (e) { /* ignore */ }
    return m;
  };

  var toastEl = null, toastTimer = null;
  S.toast = function (text, ms) {
    if (!toastEl) {
      toastEl = D.el('div.toast');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add('show');
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 3000);
  };

  // popover(anchor, contentEl, {onClose}) — small panel next to a button
  S.popover = function (anchor, content, o) {
    o = o || {};
    var closed = false;
    var ov = overlay(function () { close(); }, 'overlay-pop');
    function close() {
      if (closed) { return; }
      closed = true;
      closeOverlay(ov, o.onClose);
    }
    var pop = D.el('div.popover', null, content);
    ov.appendChild(pop);
    stack.push(ov);
    var r = anchor.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    var left = Math.max(8, Math.min(vw - pw - 8, r.left + r.width / 2 - pw / 2));
    var top = r.top - ph - 8;
    if (top < 8) { top = Math.min(vh - ph - 8, r.bottom + 8); }
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    return { close: close, el: pop };
  };

  K.sheets = S;
})(window.Kagoj = window.Kagoj || {});
