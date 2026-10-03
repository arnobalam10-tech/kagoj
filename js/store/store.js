(function (K) {
  'use strict';

  // K.Store: the single storage interface. Picks IndexedDB if it passes a
  // write/read/delete self-test, otherwise falls back to localStorage.
  var Store = { adapter: null, backend: 'none' };

  Store.init = function (cb) {
    var forced = K.util.lsGet('kagoj.forceLs', false);
    function useLs(reason) {
      if (reason) { K.log.warn('IndexedDB unavailable, using localStorage: ' + (reason.message || reason)); }
      var ls = new K.LsAdapter();
      ls.open(function (err) {
        if (err) { K.log.error('localStorage unavailable', err); cb(err); return; }
        Store.adapter = ls;
        Store.backend = 'localstorage';
        cb(null);
      });
    }
    if (forced) { useLs('forced by setting'); return; }
    var idb = new K.IdbAdapter();
    idb.open(function (err) {
      if (err) { useLs(err); return; }
      Store.adapter = idb;
      Store.backend = 'indexeddb';
      cb(null);
    });
  };

  Store.get = function (s, id, cb) { Store.adapter.get(s, id, cb); };
  Store.getAll = function (s, cb) { Store.adapter.getAll(s, cb); };
  Store.put = function (s, obj, cb) { Store.adapter.put(s, obj, cb || function () {}); };
  Store.putMany = function (s, list, cb) { Store.adapter.putMany(s, list, cb || function () {}); };
  Store.del = function (s, id, cb) { Store.adapter.del(s, id, cb || function () {}); };
  Store.clearAll = function (cb) { Store.adapter.clearAll(cb); };
  Store.usage = function () { return Store.adapter ? Store.adapter.usage() : null; };
  Store.isLimited = function () { return Store.backend === 'localstorage'; };

  K.Store = Store;
})(window.Kagoj = window.Kagoj || {});
