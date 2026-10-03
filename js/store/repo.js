(function (K) {
  'use strict';

  // K.Repo: notebooks/pages domain layer on top of K.Store.
  // Metadata for every notebook and page is kept in memory (it is small);
  // drawings are loaded per page on demand.
  var U = K.util;
  var S = K.Store;
  var R = U.emitter({});
  var GAP = 1000;
  var EMPTY = function (w, h) { return { v: 1, w: w || K.config.pageW, h: h || K.config.pageH, strokes: [] }; };

  R.nbs = {};
  R.fds = {};
  R.pages = {};
  R.metaVals = {};
  R.writes = 0;
  var drawCache = {}; // pageId -> drawing (max 3)
  var cacheOrder = [];

  function cachePut(id, d) {
    drawCache[id] = d;
    var i = cacheOrder.indexOf(id);
    if (i >= 0) { cacheOrder.splice(i, 1); }
    cacheOrder.push(id);
    while (cacheOrder.length > 3) { delete drawCache[cacheOrder.shift()]; }
  }

  function beginWrite() {
    R.writes++;
    if (R.writes === 1) { R.emit('saving'); }
  }
  function endWrite(err) {
    R.writes--;
    if (err) {
      K.log.error('local save failed', err);
      R.emit('saveerror', err);
    }
    if (R.writes === 0) { R.emit('saved'); }
  }

  function write(store, obj, cb) {
    beginWrite();
    S.put(store, obj, function (err) {
      endWrite(err);
      if (cb) { cb(err); }
    });
  }

  R.init = function (cb) {
    U.series([
      function (next) {
        S.getAll('notebooks', function (err, list) {
          if (err) { next(err); return; }
          for (var i = 0; i < list.length; i++) { R.nbs[list[i].id] = list[i]; }
          next();
        });
      },
      function (next) {
        S.getAll('pages', function (err, list) {
          if (err) { next(err); return; }
          for (var i = 0; i < list.length; i++) { R.pages[list[i].id] = list[i]; }
          next();
        });
      },
      function (next) {
        S.getAll('folders', function (err, list) {
          if (err) { next(err); return; }
          for (var i = 0; i < list.length; i++) { R.fds[list[i].id] = list[i]; }
          next();
        });
      },
      function (next) {
        S.getAll('meta', function (err, list) {
          if (err) { next(err); return; }
          for (var i = 0; i < list.length; i++) { R.metaVals[list[i].id] = list[i].value; }
          next();
        });
      }
    ], cb);
  };

  R.meta = function (key, def) {
    return Object.prototype.hasOwnProperty.call(R.metaVals, key) ? R.metaVals[key] : def;
  };
  R.setMeta = function (key, val, cb) {
    R.metaVals[key] = val;
    S.put('meta', { id: key, value: val }, cb || function () {});
  };

  R.hasData = function () { return U.values(R.nbs).length > 0 || U.values(R.fds).length > 0; };

  // ---------- notebooks ----------

  // Notebooks tab: real notebooks only (documents live in Uploads)
  R.notebooks = function () {
    return U.values(R.nbs).filter(function (n) { return !n.deleted_at && n.kind !== 'document'; });
  };

  R.isDocument = function (nb) { return !!(nb && nb.kind === 'document'); };

  // ---------- folders & documents (Uploads) ----------

  R.folders = function () {
    return U.values(R.fds).filter(function (f) { return !f.deleted_at; })
      .sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
  };
  R.folder = function (id) { return R.fds[id] || null; };

  R.saveFolder = function (f, opts) {
    if (!opts || !opts.remote) {
      f.dirty = true; f.failed = null;
      f.lv = (f.lv || 0) + 1;
      f.updated_at = U.isoNow();
    }
    write('folders', f);
    R.emit('change', 'folder', f.id);
    if (!opts || !opts.remote) { R.emit('dirty'); }
  };

  R.createFolder = function (name) {
    var now = U.isoNow();
    var f = { id: U.uuid(), name: (name || 'New folder').substr(0, 120), position: 0, created_at: now, updated_at: now, deleted_at: null };
    R.fds[f.id] = f;
    R.saveFolder(f);
    return f;
  };

  R.updateFolder = function (id, changes) {
    var f = R.fds[id];
    if (!f) { return null; }
    U.extend(f, changes);
    if (f.name) { f.name = f.name.substr(0, 120); }
    R.saveFolder(f);
    return f;
  };

  // Deleting a folder soft-deletes the documents in it too (restorable together).
  R.deleteFolder = function (id) {
    var now = U.isoNow();
    R.documents(id).forEach(function (d) { R.updateNotebook(d.id, { deleted_at: now }); });
    return R.updateFolder(id, { deleted_at: now });
  };

  R.restoreFolder = function (id) {
    var f = R.fds[id];
    if (!f) { return null; }
    var stamp = f.deleted_at;
    U.values(R.nbs).forEach(function (d) {
      if (d.folder_id === id && d.deleted_at && d.deleted_at === stamp) { R.updateNotebook(d.id, { deleted_at: null }); }
    });
    return R.updateFolder(id, { deleted_at: null });
  };

  R.documents = function (folderId) {
    return U.values(R.nbs).filter(function (n) {
      return n.kind === 'document' && !n.deleted_at && (folderId === undefined || n.folder_id === folderId);
    }).sort(function (a, b) { return U.parseTime(b.created_at) - U.parseTime(a.created_at); });
  };

  // pages: [{asset, w, h}] already uploaded to Storage
  R.createDocument = function (o) {
    var now = U.isoNow();
    var nb = {
      id: o.id || U.uuid(), kind: 'document', folder_id: o.folderId || null,
      title: (o.title || 'Document').substr(0, 120), source_name: (o.sourceName || '').substr(0, 300) || null,
      cover_color: '#5B6470', default_paper: 'blank', page_count: 0,
      last_opened_at: null, created_at: now, updated_at: now, deleted_at: null
    };
    R.nbs[nb.id] = nb;
    R.saveNotebook(nb);
    var prev = null;
    for (var i = 0; i < o.pages.length; i++) {
      var pg = o.pages[i];
      prev = R.addPage(nb.id, prev ? prev.id : null, 'blank', { background_asset: pg.asset, w: pg.w, h: pg.h });
    }
    return nb;
  };
  R.notebook = function (id) { return R.nbs[id] || null; };

  R.saveNotebook = function (nb, opts) {
    if (!opts || !opts.remote) {
      nb.dirty = true;
      nb.failed = null;
      nb.lv = (nb.lv || 0) + 1;
      nb.updated_at = U.isoNow();
    }
    write('notebooks', nb);
    R.emit('change', 'notebook', nb.id);
    if (!opts || !opts.remote) { R.emit('dirty'); }
  };

  R.createNotebook = function (o) {
    var now = U.isoNow();
    var nb = {
      id: U.uuid(),
      title: (o.title || 'Untitled notebook').substr(0, 120),
      cover_color: o.cover_color || '#2F3640',
      default_paper: o.default_paper || 'ruled',
      page_count: 0,
      last_opened_at: now,
      created_at: now,
      updated_at: now,
      deleted_at: null
    };
    R.nbs[nb.id] = nb;
    R.saveNotebook(nb);
    var page = o.noPage ? null : R.addPage(nb.id, null, nb.default_paper);
    return { notebook: nb, page: page };
  };

  R.updateNotebook = function (id, changes) {
    var nb = R.nbs[id];
    if (!nb) { return null; }
    U.extend(nb, changes);
    if (nb.title) { nb.title = nb.title.substr(0, 120); }
    R.saveNotebook(nb);
    return nb;
  };

  R.markOpened = function (id) {
    var nb = R.nbs[id];
    if (!nb) { return; }
    nb.last_opened_at = U.isoNow();
    nb.dirty = true;
    nb.lv = (nb.lv || 0) + 1;
    write('notebooks', nb);
    R.emit('dirty');
  };

  R.deleteNotebook = function (id) { return R.updateNotebook(id, { deleted_at: U.isoNow() }); };
  R.restoreNotebook = function (id) { return R.updateNotebook(id, { deleted_at: null }); };

  R.duplicateNotebook = function (id, cb) {
    var src = R.nbs[id];
    if (!src) { cb(new Error('not found')); return; }
    var srcPages = R.pagesOf(id);
    var drawings = {};
    U.eachSeries(srcPages, function (p, next) {
      R.loadDrawing(p.id, function (err, d) {
        if (err) { next(err); return; }
        drawings[p.id] = d;
        next();
      });
    }, function (err) {
      if (err) { cb(err); return; }
      var now = U.isoNow();
      var nb = U.extend(U.copy(src), {
        id: U.uuid(), title: (src.title + ' (copy)').substr(0, 120),
        created_at: now, updated_at: now, last_opened_at: now, deleted_at: null
      });
      R.nbs[nb.id] = nb;
      R.saveNotebook(nb);
      for (var i = 0; i < srcPages.length; i++) {
        var sp = srcPages[i];
        var np = newPageRecord(nb.id, sp.position, sp.paper);
        np.label = sp.label || null;
        np.background_asset = sp.background_asset || null;
        R.pages[np.id] = np;
        R.saveDrawing(np.id, drawings[sp.id] || EMPTY());
      }
      R.recount(nb.id);
      cb(null, nb);
    });
  };

  // ---------- pages ----------

  function newPageRecord(nbId, position, paper) {
    var now = U.isoNow();
    return {
      id: U.uuid(), notebook_id: nbId, position: position, paper: paper || 'ruled',
      label: null, revision: 0, baseRevision: 0, dirty: true, needsDrawing: false,
      size: 0, created_at: now, updated_at: now, deleted_at: null
    };
  }

  R.page = function (id) { return R.pages[id] || null; };

  R.pagesOf = function (nbId, includeDeleted) {
    return U.values(R.pages).filter(function (p) {
      return p.notebook_id === nbId && (includeDeleted || !p.deleted_at);
    }).sort(function (a, b) { return a.position - b.position || (a.created_at < b.created_at ? -1 : 1); });
  };

  R.savePage = function (p, opts) {
    if (!opts || !opts.remote) {
      p.dirty = true;
      p.failed = null;
      p.revision = (p.revision || 0) + 1;
      p.updated_at = U.isoNow();
    }
    write('pages', p);
    R.emit('change', 'page', p.id);
    if (!opts || !opts.remote) { R.emit('dirty'); }
  };

  // Position strictly between `after` and the next page. Renumbers the
  // notebook (gaps of 1000) when there is no room left.
  R.positionAfter = function (nbId, afterId) {
    var list = R.pagesOf(nbId, true);
    if (!afterId) {
      return list.length ? list[list.length - 1].position + GAP : GAP;
    }
    var i, idx = -1;
    for (i = 0; i < list.length; i++) { if (list[i].id === afterId) { idx = i; break; } }
    if (idx < 0) { return list.length ? list[list.length - 1].position + GAP : GAP; }
    var a = list[idx].position;
    if (idx === list.length - 1) { return a + GAP; }
    var b = list[idx + 1].position;
    if (b - a >= 2) { return Math.floor((a + b) / 2); }
    // renumber everything
    for (i = 0; i < list.length; i++) {
      if (list[i].position !== (i + 1) * GAP * 2) {
        list[i].position = (i + 1) * GAP * 2;
        R.savePage(list[i]);
      }
    }
    return list[idx].position + GAP;
  };

  // opts: { background_asset, w, h }
  R.addPage = function (nbId, afterId, paper, opts) {
    var nb = R.nbs[nbId];
    var pos = R.positionAfter(nbId, afterId);
    var p = newPageRecord(nbId, pos, paper || (nb && nb.default_paper) || 'ruled');
    if (opts && opts.background_asset) { p.background_asset = opts.background_asset; }
    R.pages[p.id] = p;
    R.saveDrawing(p.id, EMPTY(opts && opts.w, opts && opts.h));
    R.recount(nbId);
    return p;
  };

  R.updatePage = function (id, changes) {
    var p = R.pages[id];
    if (!p) { return null; }
    U.extend(p, changes);
    R.savePage(p);
    return p;
  };

  R.deletePage = function (id) {
    var p = R.updatePage(id, { deleted_at: U.isoNow() });
    if (p) { R.recount(p.notebook_id); }
    return p;
  };

  R.restorePage = function (id) {
    var p = R.updatePage(id, { deleted_at: null });
    if (p) {
      var nb = R.nbs[p.notebook_id];
      if (nb && nb.deleted_at) { R.restoreNotebook(nb.id); }
      R.recount(p.notebook_id);
    }
    return p;
  };

  R.recount = function (nbId) {
    var nb = R.nbs[nbId];
    if (!nb) { return; }
    var n = R.pagesOf(nbId).length;
    if (nb.page_count !== n) { nb.page_count = n; }
    R.saveNotebook(nb);
  };

  // ---------- drawings ----------

  R.hasLocalDrawing = function (id) {
    var p = R.pages[id];
    return !!(p && !p.needsDrawing);
  };

  R.loadDrawing = function (id, cb) {
    if (drawCache[id]) { cb(null, drawCache[id]); return; }
    var p = R.pages[id];
    if (p && p.needsDrawing) {
      if (!K.Sync) { cb(new Error('Page not on this device')); return; }
      K.Sync.fetchDrawing(id, function (err, d) {
        if (err) { cb(err); return; }
        cachePut(id, d);
        cb(null, d);
      });
      return;
    }
    S.get('drawings', id, function (err, rec) {
      if (err) { cb(err); return; }
      var d = rec ? rec.d : EMPTY();
      cachePut(id, d);
      cb(null, d);
    });
  };

  R.preload = function (id) {
    if (!id || drawCache[id]) { return; }
    var p = R.pages[id];
    if (!p || p.needsDrawing) { return; }
    R.loadDrawing(id, function () {});
  };

  R.saveDrawing = function (id, drawing, cb) {
    var p = R.pages[id];
    cachePut(id, drawing);
    beginWrite();
    var json = JSON.stringify(drawing);
    S.put('drawings', { id: id, d: drawing }, function (err) {
      endWrite(err);
      if (!err) { R.evictIfNeeded(id); }
      if (cb) { cb(err); }
    });
    if (p) {
      p.size = json.length;
      p.needsDrawing = false;
      R.savePage(p);
      var nb = R.nbs[p.notebook_id];
      if (nb) { R.saveNotebook(nb); }
    }
  };

  // Remote drawing arrived (pull / fetch): store without marking dirty.
  R.storeRemoteDrawing = function (id, drawing, cb) {
    cachePut(id, drawing);
    S.put('drawings', { id: id, d: drawing }, function (err) {
      var p = R.pages[id];
      if (!err && p) {
        p.needsDrawing = false;
        p.size = JSON.stringify(drawing).length;
        write('pages', p);
        R.evictIfNeeded(id);
      }
      if (cb) { cb(err); }
    });
  };

  // localStorage fallback only: drop synced drawings when over 80% full.
  R.evictIfNeeded = function (keepId) {
    if (!S.isLimited()) { return; }
    var u = S.usage();
    if (!u || u.fraction < 0.8) { return; }
    var cands = U.values(R.pages).filter(function (p) {
      return !p.dirty && !p.needsDrawing && p.baseRevision > 0 && p.id !== keepId;
    }).sort(function (a, b) { return a.updated_at < b.updated_at ? -1 : 1; });
    var i = 0;
    while (i < cands.length && S.usage().fraction > 0.6) {
      var p = cands[i++];
      p.needsDrawing = true;
      delete drawCache[p.id];
      S.del('drawings', p.id);
      S.put('pages', p);
    }
    K.log('evicted ' + i + ' drawings from local storage');
  };

  // ---------- recently deleted / purge ----------

  var DAY = 86400000;

  R.deletedItems = function () {
    var cutoff = Date.now() - 30 * DAY;
    var nbs = U.values(R.nbs).filter(function (n) { return n.deleted_at && U.parseTime(n.deleted_at) > cutoff; });
    var pages = U.values(R.pages).filter(function (p) {
      var nb = R.nbs[p.notebook_id];
      return p.deleted_at && U.parseTime(p.deleted_at) > cutoff && nb && !nb.deleted_at;
    });
    var fds = U.values(R.fds).filter(function (f) { return f.deleted_at && U.parseTime(f.deleted_at) > cutoff; });
    // documents inside a deleted folder are restored with the folder
    nbs = nbs.filter(function (n) { var f = n.folder_id && R.fds[n.folder_id]; return !(f && f.deleted_at); });
    return { notebooks: nbs, pages: pages, folders: fds };
  };

  // Hard-delete locally anything deleted more than 30 days ago.
  R.purgeOld = function () {
    var cutoff = Date.now() - 30 * DAY;
    var removed = 0;
    U.values(R.fds).forEach(function (f) {
      if (f.deleted_at && U.parseTime(f.deleted_at) < cutoff && !f.dirty) {
        delete R.fds[f.id]; S.del('folders', f.id); removed++;
      }
    });
    U.values(R.nbs).forEach(function (n) {
      if (n.deleted_at && U.parseTime(n.deleted_at) < cutoff && !n.dirty) {
        R.pagesOf(n.id, true).forEach(function (p) { R.forget(p.id); });
        delete R.nbs[n.id];
        S.del('notebooks', n.id);
        removed++;
      }
    });
    U.values(R.pages).forEach(function (p) {
      if (p.deleted_at && U.parseTime(p.deleted_at) < cutoff && !p.dirty) { R.forget(p.id); removed++; }
    });
    if (removed) { R.emit('change', 'purge'); }
  };

  R.forget = function (pageId) {
    delete R.pages[pageId];
    delete drawCache[pageId];
    S.del('pages', pageId);
    S.del('drawings', pageId);
  };

  R.dirtyCount = function () {
    var n = 0;
    U.values(R.nbs).forEach(function (x) { if (x.dirty) { n++; } });
    U.values(R.fds).forEach(function (x) { if (x.dirty) { n++; } });
    U.values(R.pages).forEach(function (x) { if (x.dirty) { n++; } });
    return n;
  };

  R.clearDevice = function (cb) {
    R.nbs = {}; R.pages = {}; R.fds = {}; R.metaVals = {}; drawCache = {}; cacheOrder = [];
    S.clearAll(function (err) { R.emit('change', 'clear'); cb(err); });
  };

  R.emptyDrawing = EMPTY;

  K.Repo = R;
})(window.Kagoj = window.Kagoj || {});
