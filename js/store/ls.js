(function (K) {
  'use strict';

  // localStorage adapter with the same callback API as IdbAdapter.
  // Keys: kagoj.db.<store>.<id>; an index of ids per store.
  var PREFIX = 'kagoj.db.';
  var QUOTA = 5 * 1024 * 1024; // ~5 MB (characters are what count, roughly)

  function LsAdapter() { this.name = 'localstorage'; this.index = {}; }

  function async(fn) { setTimeout(fn, 0); }

  LsAdapter.prototype.open = function (cb) {
    try {
      var k = PREFIX + '__probe';
      window.localStorage.setItem(k, '1');
      var ok = window.localStorage.getItem(k) === '1';
      window.localStorage.removeItem(k);
      if (!ok) { throw new Error('localStorage mismatch'); }
    } catch (e) { async(function () { cb(e); }); return; }
    async(function () { cb(null); });
  };

  LsAdapter.prototype.ids = function (store) {
    if (!this.index[store]) {
      var raw = window.localStorage.getItem(PREFIX + store + '.__ids');
      this.index[store] = raw ? JSON.parse(raw) : [];
    }
    return this.index[store];
  };

  LsAdapter.prototype.saveIds = function (store) {
    window.localStorage.setItem(PREFIX + store + '.__ids', JSON.stringify(this.ids(store)));
  };

  LsAdapter.prototype.get = function (store, id, cb) {
    var v = null, err = null;
    try {
      var raw = window.localStorage.getItem(PREFIX + store + '.' + id);
      v = raw ? JSON.parse(raw) : null;
    } catch (e) { err = e; }
    async(function () { cb(err, v); });
  };

  LsAdapter.prototype.getAll = function (store, cb) {
    var out = [], err = null;
    try {
      var ids = this.ids(store);
      for (var i = 0; i < ids.length; i++) {
        var raw = window.localStorage.getItem(PREFIX + store + '.' + ids[i]);
        if (raw) { out.push(JSON.parse(raw)); }
      }
    } catch (e) { err = e; }
    async(function () { cb(err, out); });
  };

  LsAdapter.prototype.putSync = function (store, obj) {
    window.localStorage.setItem(PREFIX + store + '.' + obj.id, JSON.stringify(obj));
    var ids = this.ids(store);
    if (ids.indexOf(obj.id) < 0) { ids.push(obj.id); this.saveIds(store); }
  };

  LsAdapter.prototype.put = function (store, obj, cb) {
    var err = null;
    try { this.putSync(store, obj); } catch (e) { err = e; }
    async(function () { cb(err); });
  };

  LsAdapter.prototype.putMany = function (store, list, cb) {
    var err = null;
    try { for (var i = 0; i < list.length; i++) { this.putSync(store, list[i]); } } catch (e) { err = e; }
    async(function () { cb(err); });
  };

  LsAdapter.prototype.del = function (store, id, cb) {
    var err = null;
    try {
      window.localStorage.removeItem(PREFIX + store + '.' + id);
      var ids = this.ids(store), i = ids.indexOf(id);
      if (i >= 0) { ids.splice(i, 1); this.saveIds(store); }
    } catch (e) { err = e; }
    async(function () { cb(err); });
  };

  LsAdapter.prototype.clearAll = function (cb) {
    try {
      var keys = [], i;
      for (i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) { keys.push(k); }
      }
      for (i = 0; i < keys.length; i++) { window.localStorage.removeItem(keys[i]); }
      this.index = {};
    } catch (e) { /* ignore */ }
    async(function () { cb(null); });
  };

  // Fraction of the ~5 MB budget used by everything in localStorage.
  LsAdapter.prototype.usage = function () {
    var total = 0;
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        var v = window.localStorage.getItem(k) || '';
        total += k.length + v.length;
      }
    } catch (e) { /* ignore */ }
    return { bytes: total * 2, fraction: (total * 2) / (QUOTA * 2) };
  };

  K.LsAdapter = LsAdapter;
})(window.Kagoj = window.Kagoj || {});
