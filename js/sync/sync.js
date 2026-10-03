(function (K) {
  'use strict';

  var U = K.util, Repo = K.Repo, sb = K.sb;
  var S = U.emitter({});
  var BACKOFF = [5, 15, 30, 60, 120];
  var NB_COLS = 'id,title,cover_color,default_paper,page_count,last_opened_at,created_at,updated_at,deleted_at,kind,folder_id,source_name';
  var FD_COLS = 'id,name,position,created_at,updated_at,deleted_at';
  var PG_COLS = 'id,notebook_id,position,paper,revision,label,background_asset,created_at,updated_at,deleted_at';
  var LIMIT = 500;

  var running = false, rerun = false, timer = null;
  var failures = 0, nextAllowed = 0;
  S.offline = false;
  S.error = null;          // last error text (non-network)
  S.lastOkAt = U.lsGet('kagoj.lastSyncOk', 0);

  // ---------- status ----------

  S.status = function () {
    var dev = U.deviceName();
    var where = dev === 'PC' ? 'this device' : dev;
    if (Repo.writes > 0) { return { code: 'saving', text: 'Saving…' }; }
    if (!sb.isLoggedIn()) { return { code: 'loggedout', text: 'Logged out · tap to log in' }; }
    if (S.offline) { return { code: 'offline', text: 'Offline · saved on ' + where }; }
    if (S.error) { return { code: 'error', text: 'Sync failed · tap to retry', detail: S.error }; }
    if (pendingCount() > 0 || running) {
      if (pendingCount() > 0) { return { code: 'pending', text: 'Saved on ' + where + ' · syncing…' }; }
    }
    return { code: 'saved', text: 'Saved ✓' };
  };

  function emitStatus() { S.emit('status', S.status()); }

  function pendingCount() {
    var n = 0;
    U.values(Repo.fds).forEach(function (x) { if (x.dirty && !x.failed) { n++; } });
    U.values(Repo.nbs).forEach(function (x) { if (x.dirty && !x.failed) { n++; } });
    U.values(Repo.pages).forEach(function (x) { if (x.dirty && !x.failed) { n++; } });
    return n;
  }
  S.pendingCount = pendingCount;

  // ---------- scheduling ----------

  S.schedule = function (ms) {
    var wait = Math.max(ms, nextAllowed - Date.now());
    if (timer) { clearTimeout(timer); }
    timer = setTimeout(function () { timer = null; S.run(); }, Math.max(0, wait));
  };

  S.now = function () {
    failures = 0; nextAllowed = 0;
    if (timer) { clearTimeout(timer); timer = null; }
    S.run();
  };

  S.start = function () {
    Repo.on('dirty', function () { S.schedule(3000); emitStatus(); });
    Repo.on('saving', emitStatus);
    Repo.on('saved', emitStatus);
    sb.on('login', function () { S.error = null; S.now(); });
    sb.on('authlost', emitStatus);
    sb.on('logout', emitStatus);
    K.dom.on(window, 'online', function () { S.offline = false; S.now(); });
    K.dom.on(window, 'offline', function () { S.offline = true; emitStatus(); });
    K.dom.on(document, 'visibilitychange', function () {
      if (!document.hidden) { S.schedule(500); }
    });
    K.dom.on(window, 'pageshow', function () { S.schedule(500); });
    setInterval(function () { if (!running && Date.now() >= nextAllowed) { S.run(); } }, 60000);
    S.schedule(800);
    emitStatus();
  };

  // ---------- main run ----------

  S.run = function () {
    if (running) { rerun = true; return; }
    if (!sb.isLoggedIn()) { emitStatus(); return; }
    running = true;
    rerun = false;
    emitStatus();
    var t0 = Date.now();
    U.series([pushFolders, pushNotebooks, pushPages, pull, flushLogs, purgeRemote], function (err) {
      running = false;
      if (err) {
        failures++;
        var wait = BACKOFF[Math.min(failures - 1, BACKOFF.length - 1)] * 1000;
        nextAllowed = Date.now() + wait;
        if (err.type === 'network' || err.type === 'timeout') {
          S.offline = true;
        } else if (err.type === 'auth') {
          S.offline = false;
        } else {
          S.offline = false;
          S.error = sb.describeError(err);
        }
        K.log.warn('sync failed (' + (err.type || '') + ' ' + (err.status || '') + '): ' + err.message);
        S.schedule(wait);
      } else {
        failures = 0; nextAllowed = 0;
        S.offline = false;
        S.error = failedItemsText();
        S.lastOkAt = Date.now();
        U.lsSet('kagoj.lastSyncOk', S.lastOkAt);
        K.log('sync ok in ' + (Date.now() - t0) + 'ms');
        if (rerun || pendingCount() > 0) { S.schedule(1000); }
      }
      emitStatus();
      S.emit('done', err || null);
    });
  };

  function failedItemsText() {
    var f = null;
    U.values(Repo.fds).forEach(function (x) { if (x.dirty && x.failed) { f = x.failed; } });
    U.values(Repo.nbs).forEach(function (x) { if (x.dirty && x.failed) { f = x.failed; } });
    U.values(Repo.pages).forEach(function (x) { if (x.dirty && x.failed) { f = x.failed; } });
    return f;
  }

  function isFatal(err) {
    // stop the whole run: network, timeout, auth, server errors
    return err.type !== 'http' || err.status === 401 || err.status >= 500 || err.status === 429;
  }

  // ---------- push ----------

  function pushFolders(cb) {
    var list = U.values(Repo.fds).filter(function (f) { return f.dirty && !f.failed; });
    if (!list.length) { cb(); return; }
    U.eachSeries(list, function (f, next) {
      var v = f.lv;
      sb.rest('POST', 'folders', {
        body: [{ id: f.id, name: f.name, position: f.position || 0, deleted_at: f.deleted_at || null }],
        prefer: 'resolution=merge-duplicates,return=minimal'
      }, function (err) {
        if (err) {
          if (isFatal(err)) { next(err); return; }
          markFailed(f, err, 'folders'); next(); return;
        }
        f.synced = true;
        if (f.lv === v) { f.dirty = false; }
        K.Store.put('folders', f);
        next();
      });
    }, cb);
  }

  function nbBody(nb) {
    var f = nb.folder_id && Repo.fds[nb.folder_id];
    return {
      id: nb.id, title: nb.title, cover_color: nb.cover_color, default_paper: nb.default_paper,
      page_count: nb.page_count, last_opened_at: nb.last_opened_at, deleted_at: nb.deleted_at || null,
      kind: nb.kind || 'notebook', source_name: nb.source_name || null,
      // never reference a folder the server does not have yet
      folder_id: f && (f.synced || !f.dirty) ? nb.folder_id : null
    };
  }

  function pushNotebooks(cb) {
    var list = U.values(Repo.nbs).filter(function (n) {
      if (!n.dirty || n.failed) { return false; }
      var f = n.folder_id && Repo.fds[n.folder_id];
      return !f || f.synced || !f.dirty;
    });
    if (!list.length) { cb(); return; }
    var versions = list.map(function (n) { return n.lv; });
    sb.rest('POST', 'notebooks', {
      body: list.map(nbBody),
      prefer: 'resolution=merge-duplicates,return=minimal'
    }, function (err) {
      if (err) {
        if (isFatal(err) || list.length === 1) {
          if (!isFatal(err)) { markFailed(list[0], err, 'notebooks'); cb(); return; }
          cb(err); return;
        }
        // one bad row: retry individually
        U.eachSeries(list, function (nb, next) {
          var v = nb.lv;
          sb.rest('POST', 'notebooks', { body: [nbBody(nb)], prefer: 'resolution=merge-duplicates,return=minimal' }, function (e2) {
            if (e2) {
              if (isFatal(e2)) { next(e2); return; }
              markFailed(nb, e2, 'notebooks'); next(); return;
            }
            nbPushed(nb, v);
            next();
          });
        }, cb);
        return;
      }
      for (var i = 0; i < list.length; i++) { nbPushed(list[i], versions[i]); }
      cb();
    });
  }

  function nbPushed(nb, v) {
    nb.synced = true;
    if (nb.lv === v) { nb.dirty = false; }
    K.Store.put('notebooks', nb);
  }

  function markFailed(item, err, store) {
    item.failed = sb.describeError(err);
    K.log.error('sync item failed (' + store + ' ' + item.id + '): ' + err.status + ' ' + err.message);
    K.Store.put(store, item);
  }

  function pageBody(p, drawing) {
    return {
      id: p.id, notebook_id: p.notebook_id, position: p.position, paper: p.paper,
      label: p.label || null, deleted_at: p.deleted_at || null, drawing: drawing,
      background_asset: p.background_asset || null
    };
  }

  function pushPages(cb) {
    var list = U.values(Repo.pages).filter(function (p) {
      if (!p.dirty || p.failed || p.needsDrawing) { return false; }
      var nb = Repo.nbs[p.notebook_id];
      return nb && (nb.synced || !nb.dirty);
    }).sort(function (a, b) { return (a.size || 0) - (b.size || 0); });
    U.eachSeries(list, function (p, next) {
      if (!Repo.pages[p.id] || !p.dirty) { next(); return; }
      pushPage(p, false, function (err) {
        if (err && isFatal(err)) { next(err); return; }
        if (err) {
          if (err.status === 409) {
            // probably the notebook is missing on the server: re-push it
            var nb = Repo.nbs[p.notebook_id];
            if (nb) { nb.dirty = true; nb.synced = false; }
          }
          markFailed(p, err, 'pages');
        }
        next();
      });
    }, cb);
  }

  function pushPage(p, retried, cb) {
    K.Store.get('drawings', p.id, function (e0, rec) {
      if (e0) { cb({ type: 'local', message: String(e0) }); return; }
      var drawing = rec ? rec.d : Repo.emptyDrawing();
      var rev = p.revision;
      var body = pageBody(p, drawing);
      if (!p.baseRevision) {
        body.revision = 1;
        sb.rest('POST', 'pages?select=id,revision', {
          body: [body], prefer: 'resolution=merge-duplicates,return=representation', timeout: 45000
        }, function (err, data) {
          if (err) { cb(err); return; }
          pagePushed(p, rev, data && data[0] ? data[0].revision : 1);
          cb();
        });
        return;
      }
      body.revision = p.baseRevision + 1;
      sb.rest('PATCH', 'pages?id=eq.' + p.id + '&revision=eq.' + p.baseRevision + '&select=id,revision', {
        body: body, prefer: 'return=representation', timeout: 45000
      }, function (err, data) {
        if (err) { cb(err); return; }
        if (data && data.length) {
          pagePushed(p, rev, data[0].revision);
          cb();
          return;
        }
        if (retried) { cb({ type: 'http', status: 409, message: 'conflict loop' }); return; }
        resolveConflict(p, drawing, cb);
      });
    });
  }

  function pagePushed(p, rev, serverRev) {
    p.baseRevision = serverRev;
    if (p.revision === rev) { p.dirty = false; }
    K.Store.put('pages', p);
  }

  // PRD §14.3: the cloud version stays; the local one becomes a copy after it.
  function resolveConflict(p, localDrawing, cb) {
    sb.rest('GET', 'pages?id=eq.' + p.id + '&select=' + PG_COLS + ',drawing', { timeout: 45000 }, function (err, rows) {
      if (err) { cb(err); return; }
      if (!rows || !rows.length) {
        // gone from the server (purged): push again as new
        p.baseRevision = 0;
        pushPage(p, true, cb);
        return;
      }
      var row = rows[0];
      var hasLocalInk = localDrawing && localDrawing.strokes && localDrawing.strokes.length;
      if (!p.deleted_at && hasLocalInk) {
        var copy = Repo.addPage(p.notebook_id, p.id, p.paper);
        copy.label = 'conflict copy (' + U.deviceName() + ', ' + U.stampLabel(Date.now()) + ')';
        Repo.saveDrawing(copy.id, localDrawing);
      }
      applyRemotePage(p, row);
      p.dirty = false;
      p.failed = null;
      Repo.storeRemoteDrawing(p.id, row.drawing, function () {
        Repo.recount(p.notebook_id);
        K.log.warn('conflict on page ' + p.id + ': kept both versions');
        S.emit('conflict', p.id);
        S.emit('remotePage', p.id);
        cb();
      });
    });
  }

  function applyRemotePage(p, row) {
    p.notebook_id = row.notebook_id;
    p.position = row.position;
    p.paper = row.paper;
    p.label = row.label || null;
    p.background_asset = row.background_asset || null;
    p.deleted_at = row.deleted_at || null;
    p.created_at = row.created_at;
    p.updated_at = row.updated_at;
    p.baseRevision = row.revision;
    K.Store.put('pages', p);
  }

  // ---------- pull ----------

  function pullTable(table, cols, metaKey, apply, cb) {
    var since = Repo.meta(metaKey, null);
    function page() {
      var q = table + '?select=' + cols + '&order=updated_at.asc&limit=' + LIMIT;
      if (since) { q += '&updated_at=gt.' + encodeURIComponent(since); }
      sb.rest('GET', q, {}, function (err, rows) {
        if (err) { cb(err); return; }
        rows = rows || [];
        for (var i = 0; i < rows.length; i++) { apply(rows[i]); }
        if (rows.length) {
          since = rows[rows.length - 1].updated_at; // server clock, never the device's
          Repo.setMeta(metaKey, since);
        }
        if (rows.length === LIMIT) { page(); } else { cb(); }
      });
    }
    page();
  }

  function pull(cb) {
    var changed = false, toFetch = [];
    U.series([
      function (next) {
        pullTable('folders', FD_COLS, 'pullFd', function (row) {
          var f = Repo.fds[row.id];
          if (f && f.dirty) { return; }
          f = f || { id: row.id };
          U.extend(f, row);
          f.synced = true;
          f.dirty = false;
          Repo.fds[f.id] = f;
          K.Store.put('folders', f);
          changed = true;
        }, next);
      },
      function (next) {
        pullTable('notebooks', NB_COLS, 'pullNb', function (row) {
          var nb = Repo.nbs[row.id];
          if (nb && nb.dirty) { return; }
          nb = nb || { id: row.id };
          U.extend(nb, row);
          nb.synced = true;
          nb.dirty = false;
          Repo.nbs[nb.id] = nb;
          K.Store.put('notebooks', nb);
          changed = true;
        }, next);
      },
      function (next) {
        pullTable('pages', PG_COLS, 'pullPg', function (row) {
          var p = Repo.pages[row.id];
          if (p && p.dirty) { return; }
          if (!p) {
            p = { id: row.id, revision: 0, dirty: false, needsDrawing: true, size: 0 };
            Repo.pages[p.id] = p;
            applyRemotePage(p, row);
            changed = true;
            return;
          }
          if (row.revision === p.baseRevision) { return; }
          applyRemotePage(p, row);
          if (!p.needsDrawing) { toFetch.push(p.id); }
          changed = true;
        }, next);
      },
      function (next) {
        U.eachSeries(toFetch, function (id, n2) {
          S.fetchDrawing(id, function (err) {
            if (err && isFatal(err)) { n2(err); return; }
            S.emit('remotePage', id);
            n2();
          });
        }, next);
      }
    ], function (err) {
      if (changed) { Repo.emit('change', 'pull'); }
      cb(err);
    });
  }

  // Download one page's drawing (lazy load on first open, or after pull).
  S.fetchDrawing = function (id, cb) {
    if (!sb.isLoggedIn()) { cb({ type: 'auth', message: 'This page is not on this device yet. Log in to download it.' }); return; }
    sb.rest('GET', 'pages?id=eq.' + id + '&select=drawing,revision', { timeout: 45000 }, function (err, rows) {
      if (err) { cb(err); return; }
      if (!rows || !rows.length) { cb({ type: 'http', status: 404, message: 'Page not found on server' }); return; }
      var p = Repo.pages[id];
      if (p && p.dirty) { cb(null, null); return; }
      var d = rows[0].drawing || Repo.emptyDrawing();
      if (p) { p.baseRevision = rows[0].revision; }
      Repo.storeRemoteDrawing(id, d, function (e2) { cb(e2 || null, d); });
    });
  };

  // ---------- remote logs & purge ----------

  function flushLogs(cb) {
    var items = K.log.takeRemote(20);
    if (!items.length) { cb(); return; }
    var dev = U.deviceName() + ' | ' + (navigator.userAgent || '').substr(0, 200);
    sb.rest('POST', 'client_logs', {
      body: items.map(function (it) { return { device: dev, level: it.level, message: it.message }; }),
      prefer: 'return=minimal'
    }, function (err) {
      if (err) { K.log.requeueRemote(items); }
      cb(); // never fail the sync because of logs
    });
  }

  function purgeRemote(cb) {
    var last = Repo.meta('purgeAt', 0);
    if (Date.now() - last < 86400000) { cb(); return; }
    var cutoffMs = Date.now() - 30 * 86400000;
    var cutoff = new Date(cutoffMs).toISOString();
    var q = '?deleted_at=lt.' + encodeURIComponent(cutoff);
    var docs = U.values(Repo.nbs).filter(function (n) {
      return n.kind === 'document' && n.deleted_at && U.parseTime(n.deleted_at) < cutoffMs;
    });
    // Delete a purged document's images unless another page still uses them.
    U.eachSeries(docs, function (d, next) {
      var prefix = sb.userId() + '/' + d.id + '/';
      sb.rpc('kagoj_asset_in_use', { prefix: prefix, exclude_notebook: d.id }, function (err, inUse) {
        if (err || inUse) { next(); return; }
        var paths = [];
        Repo.pagesOf(d.id, true).forEach(function (p) {
          if (p.background_asset && p.background_asset.indexOf(prefix) === 0) {
            paths.push(p.background_asset, K.Assets.thumbOf(p.background_asset));
          }
        });
        sb.storageRemove(paths, function () { next(); });
      });
    }, function () {
      sb.rest('DELETE', 'pages' + q, { prefer: 'return=minimal' }, function () {
        sb.rest('DELETE', 'notebooks' + q, { prefer: 'return=minimal' }, function () {
          sb.rest('DELETE', 'folders' + q, { prefer: 'return=minimal' }, function () {
            Repo.setMeta('purgeAt', Date.now());
            Repo.purgeOld();
            cb();
          });
        });
      });
    });
  }

  // Re-try items that failed with a 4xx after the user taps "retry".
  S.retryFailed = function () {
    U.values(Repo.fds).forEach(function (x) { x.failed = null; });
    U.values(Repo.nbs).forEach(function (x) { x.failed = null; });
    U.values(Repo.pages).forEach(function (x) { x.failed = null; });
    S.error = null;
    S.now();
  };

  S.isRunning = function () { return running; };

  K.Sync = S;
})(window.Kagoj = window.Kagoj || {});
