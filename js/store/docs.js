(function (K) {
  'use strict';

  // K.Docs: typed pages, databases and database rows (V2).
  // Every doc is kept in memory (text is small) and persisted in the 'docs' store.
  // Tree: parent_id; order: gapped `position`. Soft delete -> Trash.
  // `base` is the content as last synced, used for 3-way merges on conflict.
  var U = K.util, S = K.Store;
  var Docs = U.emitter({});
  var GAP = 1024;

  Docs.map = {};

  function write(doc) {
    S.put('docs', doc, function (err) {
      if (err) { K.log.error('could not save page', err); Docs.emit('saveerror', err); }
    });
  }

  Docs.init = function (cb) {
    S.getAll('docs', function (err, list) {
      if (err) { cb(err); return; }
      for (var i = 0; i < list.length; i++) { Docs.map[list[i].id] = list[i]; }
      cb(null);
    });
  };

  Docs.get = function (id) { return Docs.map[id] || null; };
  Docs.all = function () { return U.values(Docs.map); };

  // Visible = not deleted and no deleted ancestor
  Docs.isLive = function (d) {
    var guard = 0;
    while (d && guard++ < 200) {
      if (d.deleted_at) { return false; }
      if (!d.parent_id) { return true; }
      d = Docs.map[d.parent_id];
    }
    return !!d;
  };

  function byPos(a, b) { return (a.position - b.position) || (a.created_at < b.created_at ? -1 : 1); }

  Docs.children = function (parentId, kinds) {
    return U.values(Docs.map).filter(function (d) {
      return (d.parent_id || null) === (parentId || null) && !d.deleted_at &&
        (!kinds || kinds.indexOf(d.kind) >= 0);
    }).sort(byPos);
  };

  // Sidebar pages: everything except database rows
  Docs.treeChildren = function (parentId) { return Docs.children(parentId, ['page', 'database', 'canvas']); };

  Docs.favorites = function () {
    return U.values(Docs.map).filter(function (d) { return d.favorite && Docs.isLive(d); })
      .sort(function (a, b) { return a.title < b.title ? -1 : 1; });
  };

  Docs.path = function (id) {
    var out = [], d = Docs.map[id], guard = 0;
    while (d && guard++ < 200) { out.unshift(d); d = d.parent_id ? Docs.map[d.parent_id] : null; }
    return out;
  };

  Docs.isAncestor = function (ancestorId, id) {
    var d = Docs.map[id], guard = 0;
    while (d && guard++ < 200) {
      if (d.parent_id === ancestorId) { return true; }
      d = d.parent_id ? Docs.map[d.parent_id] : null;
    }
    return false;
  };

  Docs.titleOf = function (d) {
    if (!d) { return 'Missing page'; }
    return d.title || (d.kind === 'database' ? 'Untitled database' : 'Untitled');
  };

  // ---------- blocks ----------

  Docs.blockId = function () { return 'b' + U.strokeId().substr(2); };

  Docs.newBlock = function (type, extra) {
    var b = { id: Docs.blockId(), type: type || 'p', d: 0, html: '' };
    if (extra) { U.extend(b, extra); }
    return b;
  };

  // Plain text of rich-text HTML (search, previews)
  var TAGS = /<[^>]+>/g;
  Docs.plain = function (html) {
    return String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(TAGS, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  };

  function eachBlock(blocks, fn) {
    for (var i = 0; i < (blocks || []).length; i++) {
      var b = blocks[i];
      fn(b);
      if (b.cols) { for (var c = 0; c < b.cols.length; c++) { eachBlock(b.cols[c], fn); } }
    }
  }
  Docs.eachBlock = eachBlock;

  Docs.textOf = function (doc) {
    var parts = [];
    eachBlock(doc.content, function (b) {
      if (b.html) { parts.push(Docs.plain(b.html)); }
      if (b.text) { parts.push(b.text); }
      if (b.rows) { b.rows.forEach(function (r) { r.forEach(function (c) { parts.push(Docs.plain(c)); }); }); }
      if (b.title) { parts.push(b.title); }
    });
    return parts.join('\n');
  };

  // ---------- create / save ----------

  Docs.positionAt = function (parentId, afterId) {
    var sibs = U.values(Docs.map).filter(function (d) { return (d.parent_id || null) === (parentId || null); }).sort(byPos);
    if (!afterId) { return sibs.length ? sibs[sibs.length - 1].position + GAP : GAP; }
    for (var i = 0; i < sibs.length; i++) {
      if (sibs[i].id !== afterId) { continue; }
      var a = sibs[i].position;
      if (i === sibs.length - 1) { return a + GAP; }
      var b = sibs[i + 1].position;
      if (b - a >= 2) { return Math.floor((a + b) / 2); }
      // renumber siblings
      for (var k = 0; k < sibs.length; k++) { sibs[k].position = (k + 1) * GAP * 2; Docs.save(sibs[k], { meta: true }); }
      return sibs[i].position + GAP;
    }
    return sibs.length ? sibs[sibs.length - 1].position + GAP : GAP;
  };

  Docs.create = function (o) {
    o = o || {};
    var now = U.isoNow();
    var d = {
      id: o.id || U.uuid(), parent_id: o.parent_id || null, kind: o.kind || 'page',
      title: o.title || '', icon: o.icon || null, cover: o.cover || null,
      position: o.position || Docs.positionAt(o.parent_id || null, o.after || null),
      favorite: false, content: o.content || [Docs.newBlock('p')], props: o.props || {},
      schema: o.schema || null, settings: o.settings || {}, revision: 0, baseRevision: 0,
      created_at: now, updated_at: now, deleted_at: null
    };
    Docs.map[d.id] = d;
    Docs.save(d);
    return d;
  };

  // opts.meta: only metadata changed (no version snapshot needed)
  Docs.save = function (d, opts) {
    if (!(opts && opts.remote)) {
      d.dirty = true;
      d.failed = null;
      d.revision = (d.revision || 0) + 1;
      d.updated_at = U.isoNow();
      if (!(opts && opts.meta)) { d.contentChanged = true; }
    }
    write(d);
    Docs.emit('change', d.id);
    if (!(opts && opts.remote)) { Docs.emit('dirty'); K.Repo.emit('dirty'); }
  };

  Docs.update = function (id, changes, opts) {
    var d = Docs.map[id];
    if (!d) { return null; }
    U.extend(d, changes);
    Docs.save(d, opts);
    return d;
  };

  Docs.remove = function (id) { return Docs.update(id, { deleted_at: U.isoNow(), favorite: false }, { meta: true }); };
  Docs.restore = function (id) {
    var d = Docs.update(id, { deleted_at: null }, { meta: true });
    // a restored page whose parent is gone moves to the top level
    if (d && d.parent_id && !Docs.isLive(Docs.map[d.parent_id] || null)) {
      Docs.update(id, { parent_id: null, position: Docs.positionAt(null) }, { meta: true });
    }
    return d;
  };

  Docs.move = function (id, parentId, afterId) {
    if (id === parentId || (parentId && Docs.isAncestor(id, parentId))) { return false; }
    Docs.update(id, { parent_id: parentId || null, position: Docs.positionAt(parentId || null, afterId || null) }, { meta: true });
    return true;
  };

  function cloneBlocks(blocks) { return JSON.parse(JSON.stringify(blocks || [])); }

  Docs.duplicate = function (id, parentId, depth) {
    var src = Docs.map[id];
    if (!src) { return null; }
    var copy = Docs.create({
      parent_id: parentId === undefined ? src.parent_id : parentId, kind: src.kind,
      title: depth ? src.title : (src.title ? src.title + ' (copy)' : ''), icon: src.icon, cover: src.cover,
      content: cloneBlocks(src.content), props: JSON.parse(JSON.stringify(src.props || {})),
      schema: src.schema ? JSON.parse(JSON.stringify(src.schema)) : null,
      settings: JSON.parse(JSON.stringify(src.settings || {})), after: depth ? null : src.id
    });
    // sub-pages and database rows come along, and links to them are rewritten
    var map = {};
    Docs.children(src.id).forEach(function (c) {
      var cc = Docs.duplicate(c.id, copy.id, (depth || 0) + 1);
      if (cc) { map[c.id] = cc.id; }
    });
    if (Object.keys(map).length) {
      eachBlock(copy.content, function (b) { if (b.ref && map[b.ref]) { b.ref = map[b.ref]; } });
      Docs.save(copy);
    }
    return copy;
  };

  // Hard delete locally (after purge)
  Docs.forget = function (id) {
    delete Docs.map[id];
    S.del('docs', id);
  };

  Docs.trash = function () {
    var cutoff = Date.now() - 30 * 86400000;
    return U.values(Docs.map).filter(function (d) {
      if (!d.deleted_at || U.parseTime(d.deleted_at) < cutoff) { return false; }
      var p = d.parent_id ? Docs.map[d.parent_id] : null;
      return !p || Docs.isLive(p);   // only the top-most deleted item is listed
    }).sort(function (a, b) { return a.deleted_at < b.deleted_at ? 1 : -1; });
  };

  Docs.purgeOld = function () {
    var cutoff = Date.now() - 30 * 86400000;
    U.values(Docs.map).forEach(function (d) {
      if (d.deleted_at && U.parseTime(d.deleted_at) < cutoff && !d.dirty) { Docs.forget(d.id); }
    });
  };

  // ---------- recent, search, backlinks ----------

  Docs.visit = function (id) {
    var r = K.Repo.meta('recentDocs', []) || [];
    r = [id].concat(r.filter(function (x) { return x !== id; })).slice(0, 20);
    K.Repo.setMeta('recentDocs', r);
  };
  Docs.recent = function (n) {
    return (K.Repo.meta('recentDocs', []) || []).map(function (id) { return Docs.map[id]; })
      .filter(function (d) { return d && Docs.isLive(d); }).slice(0, n || 8);
  };

  // Results: [{doc, title, snippet, score}]
  Docs.search = function (q, opts) {
    q = String(q || '').toLowerCase().replace(/^\s+|\s+$/g, '');
    if (!q) { return []; }
    var words = q.split(/\s+/), out = [];
    U.values(Docs.map).forEach(function (d) {
      if (!Docs.isLive(d)) { return; }
      var title = Docs.titleOf(d).toLowerCase();
      var text = opts && opts.titleOnly ? '' : Docs.textOf(d).toLowerCase();
      var score = 0, ok = true;
      for (var i = 0; i < words.length; i++) {
        var inT = title.indexOf(words[i]) >= 0, inB = text.indexOf(words[i]) >= 0;
        if (!inT && !inB) { ok = false; break; }
        score += inT ? 10 : 1;
      }
      if (!ok) { return; }
      if (title.indexOf(q) === 0) { score += 20; }
      var snippet = '';
      var at = text.indexOf(words[0]);
      if (at >= 0) {
        var raw = Docs.textOf(d);
        snippet = (at > 30 ? '…' : '') + raw.substr(Math.max(0, at - 30), 110).replace(/\s+/g, ' ');
      }
      out.push({ doc: d, score: score, snippet: snippet });
    });
    return out.sort(function (a, b) { return b.score - a.score; }).slice(0, 50);
  };

  Docs.backlinks = function (id) {
    var needle = 'data-page="' + id + '"';
    return U.values(Docs.map).filter(function (d) {
      if (d.id === id || !Docs.isLive(d)) { return false; }
      var hit = false;
      eachBlock(d.content, function (b) {
        if ((b.html && b.html.indexOf(needle) >= 0) || (b.type === 'link' && b.ref === id)) { hit = true; }
      });
      return hit;
    });
  };

  // ---------- 3-way merge (conflicts) ----------

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function index(list) { var m = {}; (list || []).forEach(function (b) { m[b.id] = b; }); return m; }

  // base: content when both sides last agreed; local/remote: the two edited versions.
  // Blocks changed on only one side take that side; changed on both: keep both.
  Docs.mergeBlocks = function (base, local, remote) {
    var B = index(base), L = index(local);
    var out = [], used = {};
    (remote || []).forEach(function (rb) {
      var lb = L[rb.id], bb = B[rb.id];
      if (!lb) {
        // deleted locally: keep only if the other device changed it meanwhile
        if (!bb || !same(rb, bb)) { out.push(rb); used[rb.id] = 1; }
        return;
      }
      used[rb.id] = 1;
      var lc = !bb || !same(lb, bb), rc = !bb || !same(rb, bb);
      if (lc && rc && !same(lb, rb)) {
        out.push(lb);
        var copy = JSON.parse(JSON.stringify(rb));
        copy.id = Docs.blockId();
        copy.conflict = 1;
        out.push(copy);
      } else {
        out.push(lc ? lb : rb);
      }
    });
    // blocks only on this device: new ones, or deleted remotely but edited here
    (local || []).forEach(function (lb, i) {
      if (used[lb.id]) { return; }
      var bb = B[lb.id];
      if (bb && same(lb, bb)) { return; }  // remote deleted it and we did not touch it
      // insert after the nearest preceding local block that is already placed
      var at = out.length;
      for (var k = i - 1; k >= 0; k--) {
        var prevId = local[k].id, pos = -1;
        for (var m = 0; m < out.length; m++) { if (out[m].id === prevId) { pos = m; break; } }
        if (pos >= 0) { at = pos + 1; break; }
        if (k === 0) { at = 0; }
      }
      if (i === 0) { at = 0; }
      out.splice(at, 0, lb);
    });
    return out;
  };

  Docs.mergeDoc = function (local, remote) {
    var base = local.base ? JSON.parse(local.base) : { content: [], title: '', props: {} };
    var merged = {
      content: Docs.mergeBlocks(base.content, local.content, remote.content),
      title: local.title !== base.title ? local.title : remote.title,
      props: {}
    };
    var keys = {}, k;
    [base.props, local.props, remote.props].forEach(function (p) { for (k in (p || {})) { if (Object.prototype.hasOwnProperty.call(p, k)) { keys[k] = 1; } } });
    for (k in keys) {
      if (!Object.prototype.hasOwnProperty.call(keys, k)) { continue; }
      var lv = (local.props || {})[k], bv = (base.props || {})[k], rv = (remote.props || {})[k];
      merged.props[k] = !same(lv, bv) ? lv : rv;
      if (merged.props[k] === undefined) { delete merged.props[k]; }
    }
    return merged;
  };

  Docs.snapshotBase = function (d) {
    d.base = JSON.stringify({ content: d.content, title: d.title, props: d.props });
  };

  Docs.dirtyCount = function () {
    var n = 0;
    U.values(Docs.map).forEach(function (d) { if (d.dirty && !d.failed) { n++; } });
    return n;
  };

  K.Docs = Docs;
})(window.Kagoj = window.Kagoj || {});
