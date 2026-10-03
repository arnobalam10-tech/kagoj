(function (K) {
  'use strict';

  var D = {};
  var SVGNS = 'http://www.w3.org/2000/svg';
  var XLINK = 'http://www.w3.org/1999/xlink';

  var passiveOk = false;
  try {
    var opts = Object.defineProperty({}, 'passive', { get: function () { passiveOk = true; return true; } });
    window.addEventListener('kagojtest', null, opts);
    window.removeEventListener('kagojtest', null, opts);
  } catch (e) { passiveOk = false; }

  // el('div.cls1.cls2', {attrs}, [children|string])
  D.el = function (spec, attrs, children) {
    var parts = spec.split('.');
    var node = document.createElement(parts[0] || 'div');
    var i, k;
    for (i = 1; i < parts.length; i++) { node.classList.add(parts[i]); }
    if (attrs) {
      for (k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) { continue; }
        var v = attrs[k];
        if (v === null || v === undefined || v === false) { continue; }
        if (k === 'text') { node.textContent = v; }
        else if (k === 'style' && typeof v === 'object') { D.css(node, v); }
        else if (k.indexOf('on') === 0 && typeof v === 'function') { D.on(node, k.substr(2), v); }
        else if (k === 'value') { node.value = v; }
        else if (k === 'checked') { node.checked = !!v; }
        else { node.setAttribute(k, v === true ? '' : v); }
      }
    }
    if (children !== undefined && children !== null) { D.append(node, children); }
    return node;
  };

  D.append = function (node, children) {
    if (!(children instanceof Array)) { children = [children]; }
    for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c === null || c === undefined || c === false) { continue; }
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  };

  D.css = function (node, styles) {
    for (var k in styles) {
      if (Object.prototype.hasOwnProperty.call(styles, k)) { node.style[k] = styles[k]; }
    }
  };

  D.empty = function (node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
    return node;
  };

  D.remove = function (node) {
    if (node && node.parentNode) { node.parentNode.removeChild(node); }
  };

  D.$ = function (sel, root) { return (root || document).querySelector(sel); };

  // Returns an unbind function.
  D.on = function (node, ev, fn, opt) {
    var o = false;
    if (opt && passiveOk) { o = opt; }
    else if (opt && opt.capture) { o = true; }
    node.addEventListener(ev, fn, o);
    return function () { node.removeEventListener(ev, fn, o); };
  };

  D.passiveFalse = { passive: false };

  D.icon = function (name, cls) {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(SVGNS, 'use');
    use.setAttributeNS(XLINK, 'xlink:href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  };

  // Button that fires on tap without the 300ms delay and without
  // triggering twice (touchend + click).
  D.tap = function (node, fn) {
    var startX = 0, startY = 0, moved = false, lastTouch = 0;
    D.on(node, 'touchstart', function (e) {
      var t = e.touches[0];
      startX = t.clientX; startY = t.clientY; moved = false;
      node.classList.add('pressed');
    }, { passive: true });
    D.on(node, 'touchmove', function (e) {
      var t = e.touches[0];
      if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
        moved = true; node.classList.remove('pressed');
      }
    }, { passive: true });
    D.on(node, 'touchend', function (e) {
      node.classList.remove('pressed');
      if (moved) { return; }
      lastTouch = Date.now();
      if (e.cancelable) { e.preventDefault(); }
      fn.call(node, e);
    }, D.passiveFalse);
    D.on(node, 'touchcancel', function () { node.classList.remove('pressed'); });
    D.on(node, 'click', function (e) {
      if (Date.now() - lastTouch < 800) { return; }
      fn.call(node, e);
    });
    return node;
  };

  D.button = function (opts) {
    var b = D.el('button.btn' + (opts.cls ? '.' + opts.cls.split(' ').join('.') : ''), {
      type: 'button', title: opts.title || null, 'aria-label': opts.title || opts.label || null
    });
    if (opts.icon) { b.appendChild(D.icon(opts.icon)); }
    if (opts.label) { b.appendChild(D.el('span.btn-label', { text: opts.label })); }
    if (opts.onTap) { D.tap(b, opts.onTap); }
    return b;
  };

  K.dom = D;
})(window.Kagoj = window.Kagoj || {});
