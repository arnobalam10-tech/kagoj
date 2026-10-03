(function (K) {
  'use strict';

  // IndexedDB adapter. Every store is keyed by `id`.
  // One object store per transaction: multi-store transactions were buggy on
  // early iOS IndexedDB, so we avoid them entirely.
  var STORES = ['notebooks', 'pages', 'drawings', 'meta'];

  function IdbAdapter() { this.db = null; this.name = 'indexeddb'; }

  IdbAdapter.prototype.open = function (cb) {
    var self = this;
    var idb = window.indexedDB || window.webkitIndexedDB;
    if (!idb) { cb(new Error('no indexedDB')); return; }
    var req, called = false;
    function once(err) { if (called) { return; } called = true; cb(err); }
    var guard = setTimeout(function () { once(new Error('indexedDB open timeout')); }, 4000);
    try {
      req = idb.open('kagoj', 1);
    } catch (e) { clearTimeout(guard); once(e); return; }
    req.onupgradeneeded = function () {
      var db = req.result;
      for (var i = 0; i < STORES.length; i++) {
        if (!db.objectStoreNames.contains(STORES[i])) { db.createObjectStore(STORES[i], { keyPath: 'id' }); }
      }
    };
    req.onsuccess = function () {
      clearTimeout(guard);
      self.db = req.result;
      self.selfTest(once);
    };
    req.onerror = function () { clearTimeout(guard); once(req.error || new Error('indexedDB open failed')); };
    req.onblocked = function () { clearTimeout(guard); once(new Error('indexedDB blocked')); };
  };

  // write -> read -> delete round trip (PRD §13.3)
  IdbAdapter.prototype.selfTest = function (cb) {
    var self = this;
    var probe = { id: '__probe', value: 'ok' + Date.now() };
    self.put('meta', probe, function (err) {
      if (err) { cb(err); return; }
      self.get('meta', '__probe', function (err2, v) {
        if (err2 || !v || v.value !== probe.value) { cb(err2 || new Error('indexedDB read mismatch')); return; }
        self.del('meta', '__probe', function (err3) { cb(err3 || null); });
      });
    });
  };

  IdbAdapter.prototype.tx = function (store, mode, work, cb) {
    var t;
    try {
      t = this.db.transaction(store, mode);
    } catch (e) { cb(e); return; }
    var result;
    var os = t.objectStore(store);
    work(os, function (r) { result = r; });
    t.oncomplete = function () { cb(null, result); };
    t.onerror = function () { cb(t.error || new Error('tx error')); };
    t.onabort = function () { cb(t.error || new Error('tx aborted')); };
  };

  IdbAdapter.prototype.get = function (store, id, cb) {
    this.tx(store, 'readonly', function (os, set) {
      var r = os.get(id);
      r.onsuccess = function () { set(r.result === undefined ? null : r.result); };
    }, cb);
  };

  IdbAdapter.prototype.getAll = function (store, cb) {
    this.tx(store, 'readonly', function (os, set) {
      var out = [];
      set(out);
      var r = os.openCursor();
      r.onsuccess = function () {
        var c = r.result;
        if (c) { out.push(c.value); c['continue'](); }
      };
    }, cb);
  };

  IdbAdapter.prototype.put = function (store, obj, cb) {
    this.tx(store, 'readwrite', function (os) { os.put(obj); }, function (err) { cb(err || null); });
  };

  IdbAdapter.prototype.putMany = function (store, list, cb) {
    if (!list.length) { cb(null); return; }
    this.tx(store, 'readwrite', function (os) {
      for (var i = 0; i < list.length; i++) { os.put(list[i]); }
    }, function (err) { cb(err || null); });
  };

  IdbAdapter.prototype.del = function (store, id, cb) {
    this.tx(store, 'readwrite', function (os) { os['delete'](id); }, function (err) { cb(err || null); });
  };

  IdbAdapter.prototype.clearAll = function (cb) {
    var self = this;
    K.util.eachSeries(STORES, function (s, next) {
      self.tx(s, 'readwrite', function (os) { os.clear(); }, function (err) { next(err || null); });
    }, cb);
  };

  IdbAdapter.prototype.usage = function () { return null; };

  K.IdbAdapter = IdbAdapter;
})(window.Kagoj = window.Kagoj || {});
