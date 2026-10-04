(function (K) {
  'use strict';

  // Databases: a doc of kind 'database' holds the schema (properties + views);
  // each row is a doc of kind 'row' whose parent is the database.
  var U = K.util, Docs = K.Docs;
  var DB = {};

  DB.COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
  DB.TYPES = [
    ['text', 'Text', 'text'], ['number', 'Number', 'hash'], ['select', 'Select', 'chevron-down'], ['multi', 'Multi-select', 'list'],
    ['status', 'Status', 'loader'], ['date', 'Date', 'calendar'], ['check', 'Checkbox', 'checkbox'], ['url', 'URL', 'link'],
    ['email', 'Email', 'mail'], ['phone', 'Phone', 'phone'], ['relation', 'Relation', 'arrow-up-right'], ['rollup', 'Rollup', 'search'],
    ['formula', 'Formula', 'function'], ['created', 'Created time', 'clock'], ['edited', 'Last edited time', 'clock'], ['uid', 'ID', 'hash']
  ];
  DB.typeName = function (t) { for (var i = 0; i < DB.TYPES.length; i++) { if (DB.TYPES[i][0] === t) { return DB.TYPES[i][1]; } } return t === 'title' ? 'Title' : t; };
  DB.typeIcon = function (t) { for (var i = 0; i < DB.TYPES.length; i++) { if (DB.TYPES[i][0] === t) { return DB.TYPES[i][2]; } } return 'text'; };

  function pid() { return 'p' + U.strokeId().substr(2, 6); }
  function oid() { return 'o' + U.strokeId().substr(2, 6); }
  DB.pid = pid; DB.oid = oid;
  DB.vid = function () { return 'v' + U.strokeId().substr(2, 6); };

  DB.newView = function (type, name, extra) {
    return U.extend({ id: DB.vid(), type: type, name: name || viewName(type), filter: { op: 'and', rules: [] }, sorts: [], hidden: [], order: [] }, extra || {});
  };
  function viewName(t) { return { table: 'Table', board: 'Board', list: 'List', gallery: 'Gallery', calendar: 'Calendar', timeline: 'Timeline', chart: 'Chart' }[t] || 'View'; }
  DB.VIEW_TYPES = [['table', 'Table', 'table'], ['board', 'Board', 'columns'], ['list', 'List', 'list'], ['gallery', 'Gallery', 'image'],
    ['calendar', 'Calendar', 'calendar'], ['timeline', 'Timeline', 'timeline'], ['chart', 'Chart', 'chart']];

  DB.defaultSchema = function () {
    var status = { id: pid(), name: 'Status', type: 'status', options: [
      { id: oid(), name: 'Not started', color: 'gray', g: 'todo' },
      { id: oid(), name: 'In progress', color: 'blue', g: 'doing' },
      { id: oid(), name: 'Done', color: 'green', g: 'done' }
    ] };
    var date = { id: pid(), name: 'Date', type: 'date' };
    var tags = { id: pid(), name: 'Tags', type: 'multi', options: [] };
    var s = {
      props: [{ id: 'title', name: 'Name', type: 'title' }, status, date, tags],
      views: [DB.newView('table', 'Table')], uid: 0, templates: []
    };
    return s;
  };

  // A new database doc (full page, or inside a page for inline databases)
  DB.create = function (parentId, title, inline) {
    var d = Docs.create({ parent_id: parentId || null, kind: 'database', title: title || '', content: [], schema: DB.defaultSchema(), settings: inline ? { inline: true } : {} });
    return d;
  };

  DB.prop = function (db, id) {
    var ps = (db.schema && db.schema.props) || [];
    for (var i = 0; i < ps.length; i++) { if (ps[i].id === id) { return ps[i]; } }
    return null;
  };
  DB.propByName = function (db, name) {
    var ps = (db.schema && db.schema.props) || [], n = String(name).toLowerCase();
    for (var i = 0; i < ps.length; i++) { if (ps[i].name.toLowerCase() === n) { return ps[i]; } }
    return null;
  };
  DB.firstOf = function (db, types) {
    var ps = (db.schema && db.schema.props) || [];
    for (var i = 0; i < ps.length; i++) { if (types.indexOf(ps[i].type) >= 0) { return ps[i]; } }
    return null;
  };
  DB.option = function (p, id) {
    var o = (p && p.options) || [];
    for (var i = 0; i < o.length; i++) { if (o[i].id === id) { return o[i]; } }
    return null;
  };

  DB.rows = function (db) {
    return Docs.children(db.id, ['row']).filter(function (r) { return !(r.settings && r.settings.template); });
  };
  DB.templates = function (db) {
    return Docs.children(db.id, ['row']).filter(function (r) { return r.settings && r.settings.template; });
  };

  DB.saveSchema = function (db) { Docs.update(db.id, { schema: db.schema }, { meta: true }); };

  // ---------- values ----------

  function parseDay(s) {
    var m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?/.exec(s || '');
    if (!m) { return null; }
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0).getTime();
  }
  DB.parseDay = parseDay;

  DB.fmtDate = function (ms, withTime) {
    var d = new Date(ms), MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var s = MON[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    if (withTime) { var h = d.getHours(); s += ' ' + ((h % 12) || 12) + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes() + ' ' + (h < 12 ? 'AM' : 'PM'); }
    return s;
  };

  // Raw stored value of a property on a row
  DB.raw = function (db, row, p) {
    if (p.type === 'title') { return row.title || ''; }
    if (p.type === 'created') { return { d: U.parseTime(row.created_at), t: 1 }; }
    if (p.type === 'edited') { return { d: U.parseTime(row.updated_at), t: 1 }; }
    var v = (row.props || {})[p.id];
    return v === undefined ? null : v;
  };

  // Value usable by sorting, filters and formulas
  DB.value = function (db, row, p, depth) {
    depth = depth || 0;
    var v = DB.raw(db, row, p);
    switch (p.type) {
      case 'date':
        if (!v || !v.s) { return null; }
        return { d: parseDay(v.s), e: v.e ? parseDay(v.e) : null, t: /T/.test(v.s) ? 1 : 0 };
      case 'select': case 'status':
        var o = DB.option(p, v);
        return o ? o.name : null;
      case 'multi':
        return (v || []).map(function (id) { var o2 = DB.option(p, id); return o2 ? o2.name : null; }).filter(function (x) { return x; });
      case 'check': return !!v;
      case 'number': return typeof v === 'number' ? v : (v === null || v === '' ? null : +v);
      case 'uid': return typeof v === 'number' ? (p.prefix ? p.prefix + '-' + v : v) : null;
      case 'relation': return (v || []).map(function (id) { var r = Docs.get(id); return r && Docs.isLive(r) ? Docs.titleOf(r) : null; }).filter(function (x) { return x; });
      case 'rollup': return depth > 3 ? null : DB.rollup(db, row, p, depth);
      case 'formula':
        if (depth > 6 || !p.expr) { return null; }
        var res = K.Formula.run(p.expr, function (name) {
          var q = DB.propByName(db, name);
          if (!q) { throw new Error('No property called “' + name + '”'); }
          return DB.value(db, row, q, depth + 1);
        });
        return res.err ? { err: res.err } : res.v;
      default: return v;
    }
  };

  DB.rollup = function (db, row, p, depth) {
    var rel = DB.prop(db, p.rel);
    if (!rel || rel.type !== 'relation') { return null; }
    var target = Docs.get(rel.db);
    var tp = target ? (p.target === 'title' ? { id: 'title', type: 'title' } : DB.prop(target, p.target)) : null;
    var ids = ((row.props || {})[rel.id] || []).filter(function (id) { var r = Docs.get(id); return r && Docs.isLive(r); });
    var vals = tp ? ids.map(function (id) { return DB.value(target, Docs.get(id), tp, depth + 1); }) : [];
    var nums = vals.map(function (x) { return typeof x === 'number' ? x : (x && x.d) || NaN; }).filter(function (x) { return !isNaN(x); });
    switch (p.fn || 'show') {
      case 'count': return ids.length;
      case 'count_values': return vals.filter(function (x) { return !K.Formula.isEmpty(x); }).length;
      case 'sum': return nums.reduce(function (s, x) { return s + x; }, 0);
      case 'avg': return nums.length ? nums.reduce(function (s, x) { return s + x; }, 0) / nums.length : null;
      case 'min': return nums.length ? Math.min.apply(null, nums) : null;
      case 'max': return nums.length ? Math.max.apply(null, nums) : null;
      case 'checked': return vals.filter(function (x) { return x === true; }).length;
      case 'pct_checked': return vals.length ? Math.round(vals.filter(function (x) { return x === true; }).length / vals.length * 100) : null;
      case 'earliest': return nums.length ? { d: Math.min.apply(null, nums) } : null;
      case 'latest': return nums.length ? { d: Math.max.apply(null, nums) } : null;
      default: return vals.map(function (x) { return K.Formula.str(x); }).filter(function (x) { return x; });
    }
  };

  // Display text of a value (cells, cards)
  DB.text = function (db, row, p) {
    var v = DB.value(db, row, p);
    if (v && v.err) { return '⚠ ' + v.err; }
    if (p.type === 'number' && typeof v === 'number') { return DB.fmtNumber(v, p.fmt); }
    if (p.type === 'check') { return v ? '✓' : ''; }
    if (p.type === 'date' && v) {
      var raw = DB.raw(db, row, p);
      var s = DB.fmtDate(v.d, v.t);
      if (v.e) { s += ' → ' + DB.fmtDate(v.e, /T/.test(raw.e || '')); }
      return s;
    }
    if (p.type === 'rollup' && p.fn === 'pct_checked' && typeof v === 'number') { return v + '%'; }
    return K.Formula.str(v);
  };

  DB.fmtNumber = function (n, fmt) {
    var fixed = Math.round(n * 100) / 100;
    function commas(x) { var parts = String(Math.abs(x)).split('.'); parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (x < 0 ? '-' : '') + parts.join('.'); }
    switch (fmt) {
      case 'comma': return commas(fixed);
      case 'percent': return Math.round(n * 1000) / 10 + '%';
      case 'dollar': return '$' + commas(fixed.toFixed ? +fixed.toFixed(2) : fixed);
      case 'euro': return '€' + commas(fixed);
      case 'pound': return '£' + commas(fixed);
      case 'taka': return '৳' + commas(fixed);
      case 'rupee': return '₹' + commas(fixed);
      default: return String(Math.round(n * 1e8) / 1e8);
    }
  };

  // ---------- writing values ----------

  DB.set = function (row, pidv, v) {
    var props = U.copy(row.props || {});
    if (v === null || v === undefined || v === '' || (v instanceof Array && !v.length)) { delete props[pidv]; } else { props[pidv] = v; }
    Docs.update(row.id, { props: props }, { meta: false });
  };

  DB.newRow = function (db, init, template) {
    var props = {}, title = '';
    if (template) {
      props = JSON.parse(JSON.stringify(template.props || {}));
      title = template.title || '';
    }
    // unique IDs are numbered per database
    (db.schema.props || []).forEach(function (p) {
      if (p.type === 'uid') { db.schema.uid = (db.schema.uid || 0) + 1; props[p.id] = db.schema.uid; DB.saveSchema(db); }
    });
    if (init) { for (var k in init) { if (Object.prototype.hasOwnProperty.call(init, k)) { if (k === 'title') { title = init[k]; } else { props[k] = init[k]; } } } }
    return Docs.create({
      parent_id: db.id, kind: 'row', title: title, props: props,
      content: template ? JSON.parse(JSON.stringify(template.content || [])).map(function (b) { b.id = Docs.blockId(); return b; }) : [],
      icon: template ? template.icon : null
    });
  };

  // ---------- filters ----------

  var DAY = 86400000;
  function today0() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function weekStart(t) { var d = new Date(t); var dow = (d.getDay() + 6) % 7; return t - dow * DAY; }
  DB.relRange = function (key) {
    var t = today0();
    switch (key) {
      case 'today': return [t, t + DAY];
      case 'tomorrow': return [t + DAY, t + 2 * DAY];
      case 'yesterday': return [t - DAY, t];
      case 'this_week': return [weekStart(t), weekStart(t) + 7 * DAY];
      case 'next_week': return [weekStart(t) + 7 * DAY, weekStart(t) + 14 * DAY];
      case 'last_week': return [weekStart(t) - 7 * DAY, weekStart(t)];
      case 'past_7': return [t - 6 * DAY, t + DAY];
      case 'next_7': return [t, t + 7 * DAY];
      case 'this_month': var d = new Date(t); return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()];
      default: return null;
    }
  };

  DB.CONDS = {
    text: [['contains', 'contains'], ['ncontains', 'does not contain'], ['is', 'is'], ['isnot', 'is not'], ['starts', 'starts with'], ['ends', 'ends with'], ['empty', 'is empty'], ['nempty', 'is not empty']],
    number: [['eq', '='], ['ne', '≠'], ['gt', '>'], ['lt', '<'], ['ge', '≥'], ['le', '≤'], ['empty', 'is empty'], ['nempty', 'is not empty']],
    select: [['is', 'is'], ['isnot', 'is not'], ['empty', 'is empty'], ['nempty', 'is not empty']],
    multi: [['has', 'contains'], ['nhas', 'does not contain'], ['empty', 'is empty'], ['nempty', 'is not empty']],
    date: [['on', 'is'], ['before', 'is before'], ['after', 'is after'], ['onbefore', 'is on or before'], ['onafter', 'is on or after'], ['within', 'is within'], ['empty', 'is empty'], ['nempty', 'is not empty']],
    check: [['checked', 'is checked'], ['unchecked', 'is not checked']]
  };
  DB.condKind = function (p) {
    switch (p.type) {
      case 'number': case 'uid': return 'number';
      case 'select': case 'status': return 'select';
      case 'multi': case 'relation': return 'multi';
      case 'date': case 'created': case 'edited': return 'date';
      case 'check': return 'check';
      case 'formula': case 'rollup': return 'text';
      default: return 'text';
    }
  };

  function ruleMatch(db, row, r) {
    var p = r.pid === 'title' ? { id: 'title', type: 'title' } : DB.prop(db, r.pid);
    if (!p) { return true; }
    var kind = DB.condKind(p), v = DB.value(db, row, p), q = r.val;
    var empty = K.Formula.isEmpty(v) || (p.type === 'check' && !v);
    if (r.cond === 'empty') { return empty; }
    if (r.cond === 'nempty') { return !empty; }
    if (r.cond === 'checked') { return v === true; }
    if (r.cond === 'unchecked') { return v !== true; }
    if (q === undefined || q === null || q === '') { return true; }   // incomplete rule: ignore
    if (kind === 'text') {
      var s = K.Formula.str(v).toLowerCase(), t = String(q).toLowerCase();
      switch (r.cond) {
        case 'contains': return s.indexOf(t) >= 0;
        case 'ncontains': return s.indexOf(t) < 0;
        case 'is': return s === t;
        case 'isnot': return s !== t;
        case 'starts': return s.indexOf(t) === 0;
        case 'ends': return s.length >= t.length && s.substr(s.length - t.length) === t;
      }
    }
    if (kind === 'number') {
      if (typeof v !== 'number') { v = parseFloat(v); }
      if (isNaN(v)) { return false; }
      var n = +q;
      return { eq: v === n, ne: v !== n, gt: v > n, lt: v < n, ge: v >= n, le: v <= n }[r.cond];
    }
    if (kind === 'select') {
      var raw = DB.raw(db, row, p);
      return r.cond === 'is' ? raw === q : raw !== q;
    }
    if (kind === 'multi') {
      var arr = DB.raw(db, row, p) || [];
      var has = arr.indexOf(q) >= 0;
      return r.cond === 'has' ? has : !has;
    }
    if (kind === 'date') {
      if (!v || typeof v.d !== 'number') { return false; }
      var day = new Date(v.d); day.setHours(0, 0, 0, 0);
      var dv = day.getTime();
      if (r.cond === 'within') { var rr = DB.relRange(q); return rr ? dv >= rr[0] && dv < rr[1] : true; }
      var rng = DB.relRange(q);
      var qd = rng ? rng[0] : parseDay(q);
      if (qd === null) { return true; }
      switch (r.cond) {
        case 'on': return rng ? dv >= rng[0] && dv < rng[1] : dv === qd;
        case 'before': return dv < qd;
        case 'after': return rng ? dv >= rng[1] : dv > qd;
        case 'onbefore': return rng ? dv < rng[1] : dv <= qd;
        case 'onafter': return dv >= qd;
      }
    }
    return true;
  }

  DB.matches = function (db, row, filter) {
    if (!filter || !filter.rules || !filter.rules.length) { return true; }
    var and = filter.op !== 'or';
    for (var i = 0; i < filter.rules.length; i++) {
      var r = filter.rules[i];
      var ok = r.rules ? DB.matches(db, row, r) : ruleMatch(db, row, r);
      if (and && !ok) { return false; }
      if (!and && ok) { return true; }
    }
    return and;
  };

  // ---------- sorting & grouping ----------

  function sortKey(db, row, p) {
    var v = DB.value(db, row, p);
    if (v === null || v === undefined || v === '') { return null; }
    if (p.type === 'select' || p.type === 'status') {
      var raw = DB.raw(db, row, p), opts = p.options || [];
      for (var i = 0; i < opts.length; i++) { if (opts[i].id === raw) { return i; } }
      return null;
    }
    if (typeof v === 'object' && typeof v.d === 'number') { return v.d; }
    if (v instanceof Array) { return v.join(', ').toLowerCase(); }
    if (typeof v === 'boolean') { return v ? 1 : 0; }
    if (typeof v === 'string') { return v.toLowerCase(); }
    return v;
  }

  DB.query = function (db, view, search) {
    var rows = DB.rows(db);
    if (view && view.filter) { rows = rows.filter(function (r) { return DB.matches(db, r, view.filter); }); }
    if (search) {
      var q = search.toLowerCase();
      rows = rows.filter(function (r) {
        if (Docs.titleOf(r).toLowerCase().indexOf(q) >= 0) { return true; }
        return (db.schema.props || []).some(function (p) { return p.type !== 'title' && DB.text(db, r, p).toLowerCase().indexOf(q) >= 0; });
      });
    }
    var sorts = (view && view.sorts) || [];
    var keyed = rows.map(function (r, i) { return { r: r, i: i, k: sorts.map(function (s) { var p = s.pid === 'title' ? { id: 'title', type: 'title' } : DB.prop(db, s.pid); return p ? sortKey(db, r, p) : null; }) }; });
    keyed.sort(function (a, b) {
      for (var s = 0; s < sorts.length; s++) {
        var x = a.k[s], y = b.k[s], dir = sorts[s].dir === 'desc' ? -1 : 1;
        if (x === y) { continue; }
        if (x === null) { return 1; }
        if (y === null) { return -1; }
        return (x < y ? -1 : 1) * dir;
      }
      return (a.r.position - b.r.position) || (a.i - b.i);
    });
    return keyed.map(function (k) { return k.r; });
  };

  // [{key, label, color, rows}]
  DB.group = function (db, rows, pidv) {
    var p = DB.prop(db, pidv);
    if (!p) { return [{ key: null, label: '', rows: rows }]; }
    var groups = [], map = {};
    function add(key, label, color) { if (!map[key]) { map[key] = { key: key, label: label, color: color, rows: [] }; groups.push(map[key]); } return map[key]; }
    if (p.type === 'select' || p.type === 'status' || p.type === 'multi') {
      add('__none', 'No ' + p.name, 'default');
      (p.options || []).forEach(function (o) { add(o.id, o.name, o.color); });
      rows.forEach(function (r) {
        var raw = DB.raw(db, r, p);
        if (p.type === 'multi') {
          if (!raw || !raw.length) { map.__none.rows.push(r); }
          else { raw.forEach(function (id) { (map[id] || map.__none).rows.push(r); }); }
        } else { (map[raw] || map.__none).rows.push(r); }
      });
      // "No value" goes last, like Notion
      groups.push(groups.shift());
      return groups;
    }
    if (p.type === 'check') {
      add(true, p.name + ' ✓', 'green'); add(false, 'Not ' + p.name, 'gray');
      rows.forEach(function (r) { map[!!DB.raw(db, r, p)].rows.push(r); });
      return groups;
    }
    rows.forEach(function (r) {
      var t = DB.text(db, r, p);
      if (p.type === 'date' || p.type === 'created' || p.type === 'edited') {
        var v = DB.value(db, r, p);
        t = v && v.d ? new Date(v.d).getFullYear() + '-' + ('0' + (new Date(v.d).getMonth() + 1)).slice(-2) : '';
      }
      add(t || '__none', t ? (p.type === 'date' || p.type === 'created' || p.type === 'edited' ? monthLabel(t) : t) : 'No ' + p.name, 'default').rows.push(r);
    });
    return groups;
  };
  function monthLabel(ym) { var m = ym.split('-'); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+m[1] - 1] + ' ' + m[0]; }

  // ---------- column calculations ----------

  DB.CALCS = [['none', 'None'], ['count', 'Count all'], ['values', 'Count values'], ['unique', 'Count unique'], ['empty', 'Count empty'],
    ['nempty', 'Count not empty'], ['pct_empty', 'Percent empty'], ['pct_nempty', 'Percent not empty'],
    ['sum', 'Sum'], ['avg', 'Average'], ['median', 'Median'], ['min', 'Min'], ['max', 'Max'], ['range', 'Range'],
    ['earliest', 'Earliest date'], ['latest', 'Latest date'], ['checked', 'Checked'], ['unchecked', 'Unchecked'], ['pct_checked', 'Percent checked']];

  DB.calc = function (db, rows, p, fn) {
    if (!fn || fn === 'none') { return ''; }
    var vals = rows.map(function (r) { return DB.value(db, r, p); });
    var nonEmpty = vals.filter(function (v) { return !K.Formula.isEmpty(v) && !(p.type === 'check' && !v); });
    var nums = vals.map(function (v) { return typeof v === 'number' ? v : NaN; }).filter(function (x) { return !isNaN(x); });
    var dates = vals.map(function (v) { return v && typeof v.d === 'number' ? v.d : NaN; }).filter(function (x) { return !isNaN(x); });
    function f(n) { return p.type === 'number' ? DB.fmtNumber(n, p.fmt) : String(Math.round(n * 100) / 100); }
    switch (fn) {
      case 'count': return String(rows.length);
      case 'values': return String(nonEmpty.length);
      case 'unique': var seen = {}; nonEmpty.forEach(function (v) { seen[K.Formula.str(v)] = 1; }); return String(Object.keys(seen).length);
      case 'empty': return String(rows.length - nonEmpty.length);
      case 'nempty': return String(nonEmpty.length);
      case 'pct_empty': return rows.length ? Math.round((rows.length - nonEmpty.length) / rows.length * 100) + '%' : '';
      case 'pct_nempty': return rows.length ? Math.round(nonEmpty.length / rows.length * 100) + '%' : '';
      case 'sum': return f(nums.reduce(function (s, x) { return s + x; }, 0));
      case 'avg': return nums.length ? f(nums.reduce(function (s, x) { return s + x; }, 0) / nums.length) : '';
      case 'median': if (!nums.length) { return ''; } nums.sort(function (a, b) { return a - b; }); var m = Math.floor(nums.length / 2); return f(nums.length % 2 ? nums[m] : (nums[m - 1] + nums[m]) / 2);
      case 'min': return nums.length ? f(Math.min.apply(null, nums)) : '';
      case 'max': return nums.length ? f(Math.max.apply(null, nums)) : '';
      case 'range': return nums.length ? f(Math.max.apply(null, nums) - Math.min.apply(null, nums)) : '';
      case 'earliest': return dates.length ? DB.fmtDate(Math.min.apply(null, dates)) : '';
      case 'latest': return dates.length ? DB.fmtDate(Math.max.apply(null, dates)) : '';
      case 'checked': return String(vals.filter(function (v) { return v === true; }).length);
      case 'unchecked': return String(vals.filter(function (v) { return v !== true; }).length);
      case 'pct_checked': return rows.length ? Math.round(vals.filter(function (v) { return v === true; }).length / rows.length * 100) + '%' : '';
    }
    return '';
  };

  DB.calcsFor = function (p) {
    var base = ['none', 'count', 'values', 'unique', 'empty', 'nempty', 'pct_empty', 'pct_nempty'];
    if (p.type === 'number' || p.type === 'formula' || p.type === 'rollup') { base = base.concat(['sum', 'avg', 'median', 'min', 'max', 'range']); }
    if (p.type === 'date' || p.type === 'created' || p.type === 'edited') { base = base.concat(['earliest', 'latest']); }
    if (p.type === 'check') { base = ['none', 'count', 'checked', 'unchecked', 'pct_checked']; }
    return DB.CALCS.filter(function (c) { return base.indexOf(c[0]) >= 0; });
  };

  // ---------- dated items (calendar, home "Upcoming", reminders) ----------

  // Every database row with a date, across all databases: [{doc, db, prop, start, end, time}]
  DB.datedItems = function () {
    var out = [];
    Docs.all().forEach(function (db) {
      if (db.kind !== 'database' || !Docs.isLive(db) || !db.schema) { return; }
      var dp = (db.schema.props || []).filter(function (p) { return p.type === 'date'; });
      if (!dp.length) { return; }
      var main = db.schema.calProp ? DB.prop(db, db.schema.calProp) || dp[0] : dp[0];
      DB.rows(db).forEach(function (r) {
        var v = DB.value(db, r, main);
        if (v && typeof v.d === 'number') { out.push({ doc: r, db: db, prop: main, start: v.d, end: v.e || v.d, time: v.t, remind: (DB.raw(db, r, main) || {}).r }); }
      });
    });
    return out;
  };

  K.DB = DB;
})(window.Kagoj = window.Kagoj || {});
