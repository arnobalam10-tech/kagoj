(function (K) {
  'use strict';

  // Small formula language for database properties (Notion-like).
  //   prop("Price") * 2      if(prop("Done"), "✓", "")      dateBetween(prop("Due"), now(), "days")
  // Values: number, string, boolean, date ({d: ms}), list (array), null.
  var F = {};

  // ---------- tokenizer ----------
  function tokenize(src) {
    var t = [], i = 0, c, m;
    while (i < src.length) {
      c = src.charAt(i);
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"' || c === '\'') {
        var q = c, j = i + 1, s = '';
        while (j < src.length && src.charAt(j) !== q) {
          if (src.charAt(j) === '\\' && j + 1 < src.length) { j++; }
          s += src.charAt(j); j++;
        }
        if (j >= src.length) { throw new Error('A text value is missing its closing quote'); }
        t.push({ t: 'str', v: s });
        i = j + 1;
        continue;
      }
      m = /^\d+(\.\d+)?/.exec(src.substr(i));
      if (m) { t.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
      m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.substr(i));
      if (m) { t.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      m = /^(==|!=|>=|<=|&&|\|\||[-+*\/%^(),<>!?:])/.exec(src.substr(i));
      if (m) { t.push({ t: 'op', v: m[0] }); i += m[0].length; continue; }
      throw new Error('Unexpected character “' + c + '”');
    }
    return t;
  }

  // ---------- parser (precedence climbing) ----------
  function Parser(tokens) { this.t = tokens; this.i = 0; }
  Parser.prototype.peek = function () { return this.t[this.i]; };
  Parser.prototype.next = function () { return this.t[this.i++]; };
  Parser.prototype.is = function (v) { var p = this.peek(); return p && (p.t === 'op' || p.t === 'id') && p.v === v; };
  Parser.prototype.expect = function (v) { if (!this.is(v)) { throw new Error('Expected “' + v + '”'); } this.i++; };

  var BIN = [
    [['or', '||'], 1], [['and', '&&'], 2], [['==', '!='], 3], [['>', '<', '>=', '<='], 4],
    [['+', '-'], 5], [['*', '/', '%'], 6], [['^'], 7]
  ];
  function precOf(v) { for (var i = 0; i < BIN.length; i++) { if (BIN[i][0].indexOf(v) >= 0) { return BIN[i][1]; } } return 0; }

  Parser.prototype.expr = function (minPrec) {
    var left = this.unary();
    for (;;) {
      var p = this.peek();
      if (!p) { break; }
      if (p.v === '?' && minPrec <= 0) {          // ternary a ? b : c
        this.next();
        var a = this.expr(0); this.expect(':'); var b = this.expr(0);
        left = { k: 'call', n: 'if', a: [left, a, b] };
        continue;
      }
      var pr = (p.t === 'op' || p.t === 'id') ? precOf(p.v) : 0;
      if (!pr || pr < minPrec) { break; }
      this.next();
      var right = this.expr(p.v === '^' ? pr : pr + 1);
      left = { k: 'bin', o: p.v === '&&' ? 'and' : p.v === '||' ? 'or' : p.v, l: left, r: right };
    }
    return left;
  };

  Parser.prototype.unary = function () {
    if (this.is('-')) { this.next(); return { k: 'neg', e: this.unary() }; }
    if (this.is('!') || this.is('not')) { this.next(); return { k: 'not', e: this.unary() }; }
    return this.primary();
  };

  Parser.prototype.primary = function () {
    var p = this.next();
    if (!p) { throw new Error('The formula ends too early'); }
    if (p.t === 'num') { return { k: 'lit', v: p.v }; }
    if (p.t === 'str') { return { k: 'lit', v: p.v }; }
    if (p.t === 'op' && p.v === '(') { var e = this.expr(0); this.expect(')'); return e; }
    if (p.t === 'id') {
      if (p.v === 'true') { return { k: 'lit', v: true }; }
      if (p.v === 'false') { return { k: 'lit', v: false }; }
      if (p.v === 'null' || p.v === 'empty' && !this.is('(')) { return { k: 'lit', v: null }; }
      if (this.is('(')) {
        this.next();
        var args = [];
        if (!this.is(')')) {
          args.push(this.expr(0));
          while (this.is(',')) { this.next(); args.push(this.expr(0)); }
        }
        this.expect(')');
        return { k: 'call', n: p.v.toLowerCase(), a: args };
      }
      throw new Error('Unknown name “' + p.v + '” (use prop("' + p.v + '") for a property)');
    }
    throw new Error('Unexpected “' + p.v + '”');
  };

  F.parse = function (src) {
    var p = new Parser(tokenize(String(src || '')));
    if (!p.t.length) { return { k: 'lit', v: null }; }
    var e = p.expr(0);
    if (p.i < p.t.length) { throw new Error('Unexpected “' + p.t[p.i].v + '”'); }
    return e;
  };

  // ---------- values ----------
  function isDate(v) { return v && typeof v === 'object' && typeof v.d === 'number'; }
  function num(v) {
    if (typeof v === 'number') { return v; }
    if (typeof v === 'boolean') { return v ? 1 : 0; }
    if (isDate(v)) { return v.d; }
    if (typeof v === 'string' && v.replace(/\s/g, '') !== '' && !isNaN(+v)) { return +v; }
    return v === null || v === undefined ? 0 : NaN;
  }
  function str(v) {
    if (v === null || v === undefined) { return ''; }
    if (isDate(v)) { return K.DB ? K.DB.fmtDate(v.d, v.t) : new Date(v.d).toDateString(); }
    if (v instanceof Array) { return v.map(str).join(', '); }
    if (typeof v === 'number') { return String(Math.round(v * 1e10) / 1e10); }
    return String(v);
  }
  function truthy(v) {
    if (v instanceof Array) { return v.length > 0; }
    return !!v && v !== '' && !(typeof v === 'number' && isNaN(v));
  }
  function isEmpty(v) { return v === null || v === undefined || v === '' || (v instanceof Array && !v.length) || (typeof v === 'number' && isNaN(v)); }
  F.str = str;
  F.isEmpty = isEmpty;

  var UNIT = { years: 'y', year: 'y', months: 'M', month: 'M', weeks: 'w', week: 'w', days: 'd', day: 'd', hours: 'h', hour: 'h', minutes: 'm', minute: 'm' };
  function addTo(ms, n, unit) {
    var d = new Date(ms), u = UNIT[String(unit).toLowerCase()] || 'd';
    if (u === 'y') { d.setFullYear(d.getFullYear() + n); }
    else if (u === 'M') { d.setMonth(d.getMonth() + n); }
    else { d = new Date(ms + n * { w: 604800000, d: 86400000, h: 3600000, m: 60000 }[u]); }
    return d.getTime();
  }
  function between(a, b, unit) {
    var u = UNIT[String(unit).toLowerCase()] || 'd', diff = a - b;
    if (u === 'y') { return new Date(a).getFullYear() - new Date(b).getFullYear(); }
    if (u === 'M') { var A = new Date(a), B = new Date(b); return (A.getFullYear() - B.getFullYear()) * 12 + A.getMonth() - B.getMonth(); }
    return Math.trunc ? Math.trunc(diff / { w: 604800000, d: 86400000, h: 3600000, m: 60000 }[u]) : (diff < 0 ? Math.ceil : Math.floor)(diff / { w: 604800000, d: 86400000, h: 3600000, m: 60000 }[u]);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(ms, f) {
    var d = new Date(ms);
    if (!f) { return K.DB ? K.DB.fmtDate(ms) : d.toDateString(); }
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return f.replace(/YYYY|MMM|MM|DD|ddd|HH|mm|D|M/g, function (t) {
      return { YYYY: d.getFullYear(), MMM: MON[d.getMonth()], MM: pad(d.getMonth() + 1), DD: pad(d.getDate()), ddd: DAY[d.getDay()],
        HH: pad(d.getHours()), mm: pad(d.getMinutes()), D: d.getDate(), M: d.getMonth() + 1 }[t];
    });
  }

  var FN = {
    'if': function (a) { return truthy(a[0]) ? a[1] : a[2]; },
    ifs: function (a) { for (var i = 0; i + 1 < a.length; i += 2) { if (truthy(a[i])) { return a[i + 1]; } } return a.length % 2 ? a[a.length - 1] : null; },
    and: function (a) { return a.every(truthy); },
    or: function (a) { return a.some(truthy); },
    not: function (a) { return !truthy(a[0]); },
    empty: function (a) { return isEmpty(a[0]); },
    length: function (a) { return a[0] instanceof Array ? a[0].length : str(a[0]).length; },
    concat: function (a) { return a.map(str).join(''); },
    join: function (a) { return (a[0] instanceof Array ? a[0] : [a[0]]).map(str).join(a.length > 1 ? str(a[1]) : ', '); },
    contains: function (a) { return a[0] instanceof Array ? a[0].map(str).indexOf(str(a[1])) >= 0 : str(a[0]).toLowerCase().indexOf(str(a[1]).toLowerCase()) >= 0; },
    lower: function (a) { return str(a[0]).toLowerCase(); },
    upper: function (a) { return str(a[0]).toUpperCase(); },
    trim: function (a) { return str(a[0]).replace(/^\s+|\s+$/g, ''); },
    replace: function (a) { return str(a[0]).split(str(a[1])).join(str(a[2])); },
    substring: function (a) { return str(a[0]).substring(num(a[1]), a.length > 2 ? num(a[2]) : undefined); },
    format: function (a) { return str(a[0]); },
    tonumber: function (a) { return num(a[0]); },
    round: function (a) { var p = Math.pow(10, a.length > 1 ? num(a[1]) : 0); return Math.round(num(a[0]) * p) / p; },
    floor: function (a) { return Math.floor(num(a[0])); },
    ceil: function (a) { return Math.ceil(num(a[0])); },
    abs: function (a) { return Math.abs(num(a[0])); },
    sqrt: function (a) { return Math.sqrt(num(a[0])); },
    pow: function (a) { return Math.pow(num(a[0]), num(a[1])); },
    min: function (a) { var l = flat(a).map(num).filter(function (x) { return !isNaN(x); }); return l.length ? Math.min.apply(null, l) : null; },
    max: function (a) { var l = flat(a).map(num).filter(function (x) { return !isNaN(x); }); return l.length ? Math.max.apply(null, l) : null; },
    sum: function (a) { return flat(a).map(num).filter(function (x) { return !isNaN(x); }).reduce(function (s, x) { return s + x; }, 0); },
    average: function (a) { var l = flat(a).map(num).filter(function (x) { return !isNaN(x); }); return l.length ? l.reduce(function (s, x) { return s + x; }, 0) / l.length : null; },
    now: function () { return { d: Date.now(), t: 1 }; },
    today: function () { var d = new Date(); d.setHours(0, 0, 0, 0); return { d: d.getTime() }; },
    dateadd: function (a) { return isDate(a[0]) ? { d: addTo(a[0].d, num(a[1]), a[2] || 'days'), t: a[0].t } : null; },
    datesubtract: function (a) { return isDate(a[0]) ? { d: addTo(a[0].d, -num(a[1]), a[2] || 'days'), t: a[0].t } : null; },
    datebetween: function (a) { return isDate(a[0]) && isDate(a[1]) ? between(a[0].d, a[1].d, a[2] || 'days') : null; },
    formatdate: function (a) { return isDate(a[0]) ? fmtDate(a[0].d, a.length > 1 ? str(a[1]) : null) : ''; },
    year: function (a) { return isDate(a[0]) ? new Date(a[0].d).getFullYear() : null; },
    month: function (a) { return isDate(a[0]) ? new Date(a[0].d).getMonth() + 1 : null; },
    day: function (a) { return isDate(a[0]) ? new Date(a[0].d).getDate() : null; },
    weekday: function (a) { return isDate(a[0]) ? new Date(a[0].d).getDay() : null; },
    start: function (a) { return isDate(a[0]) ? { d: a[0].d, t: a[0].t } : null; },
    end: function (a) { return isDate(a[0]) ? { d: typeof a[0].e === 'number' ? a[0].e : a[0].d, t: a[0].t } : null; }
  };
  function flat(a) { var out = []; a.forEach(function (x) { if (x instanceof Array) { out = out.concat(x); } else { out.push(x); } }); return out; }
  F.functions = Object.keys(FN).concat(['prop']);

  // getProp(name) -> value
  function evaluate(e, getProp) {
    switch (e.k) {
      case 'lit': return e.v;
      case 'neg': return -num(evaluate(e.e, getProp));
      case 'not': return !truthy(evaluate(e.e, getProp));
      case 'call':
        if (e.n === 'prop') { return getProp(str(evaluate(e.a[0], getProp))); }
        if (e.n === 'if') { return truthy(evaluate(e.a[0], getProp)) ? evaluate(e.a[1], getProp) : (e.a.length > 2 ? evaluate(e.a[2], getProp) : null); }
        var f = FN[e.n];
        if (!f) { throw new Error('Unknown function ' + e.n + '()'); }
        return f(e.a.map(function (x) { return evaluate(x, getProp); }));
      case 'bin':
        var l = evaluate(e.l, getProp);
        if (e.o === 'and') { return truthy(l) && truthy(evaluate(e.r, getProp)); }
        if (e.o === 'or') { return truthy(l) || truthy(evaluate(e.r, getProp)); }
        var r = evaluate(e.r, getProp);
        switch (e.o) {
          case '+':
            if (typeof l === 'string' || typeof r === 'string') { return str(l) + str(r); }
            return num(l) + num(r);
          case '-': return isDate(l) && isDate(r) ? l.d - r.d : num(l) - num(r);
          case '*': return num(l) * num(r);
          case '/': return num(r) === 0 ? null : num(l) / num(r);
          case '%': return num(l) % num(r);
          case '^': return Math.pow(num(l), num(r));
          case '==': return isDate(l) || isDate(r) ? num(l) === num(r) : (typeof l === 'number' || typeof r === 'number') ? num(l) === num(r) : str(l) === str(r);
          case '!=': return !(isDate(l) || isDate(r) ? num(l) === num(r) : (typeof l === 'number' || typeof r === 'number') ? num(l) === num(r) : str(l) === str(r));
          case '>': return num(l) > num(r);
          case '<': return num(l) < num(r);
          case '>=': return num(l) >= num(r);
          case '<=': return num(l) <= num(r);
        }
    }
    return null;
  }

  var cache = {};
  // run(src, getProp) -> {v} or {err}
  F.run = function (src, getProp) {
    try {
      var ast = cache[src] || (cache[src] = F.parse(src));
      var v = evaluate(ast, getProp);
      if (typeof v === 'number' && !isFinite(v)) { v = null; }
      return { v: v };
    } catch (e) { return { err: e.message || String(e) }; }
  };

  F.isDate = isDate;
  K.Formula = F;
})(window.Kagoj = window.Kagoj || {});
