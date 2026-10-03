(function (K) {
  'use strict';

  // Page images and thumbnails from Supabase Storage.
  // Lookup order: decoded image in memory -> data URL on the device -> download.
  // iOS 9 IndexedDB cannot store Blobs, so images are kept as data URL strings.
  var U = K.util;
  var A = {};
  var MEM_MAX = 8;
  var INDEX_KEY = 'kagoj.assetIndex';  // path -> [bytes, lastUsedMs]
  var mem = {}, memOrder = [];
  var waiting = {};

  function limitBytes() {
    // iOS 9 asks for permission past ~50 MB; stay well under it there.
    return (U.isIOS && !('fetch' in window)) ? 40 * 1024 * 1024 : 250 * 1024 * 1024;
  }

  function index() { return U.lsGet(INDEX_KEY, {}) || {}; }
  function saveIndex(ix) { U.lsSet(INDEX_KEY, ix); }

  function memPut(path, img) {
    mem[path] = img;
    var i = memOrder.indexOf(path);
    if (i >= 0) { memOrder.splice(i, 1); }
    memOrder.push(path);
    while (memOrder.length > MEM_MAX) {
      var old = memOrder.shift();
      if (mem[old]) { mem[old].src = ''; }
      delete mem[old];
    }
  }

  function canCache() { return K.Store.backend === 'indexeddb'; }

  function decode(dataUrl, cb) {
    var img = new Image();
    img.onload = function () { img.onload = img.onerror = null; cb(null, img); };
    img.onerror = function () { img.onload = img.onerror = null; cb(new Error('Image could not be decoded')); };
    img.src = dataUrl;
  }

  A.blobToDataUrl = function (blob, cb) {
    var fr = new window.FileReader();
    fr.onload = function () { cb(null, fr.result); };
    fr.onerror = function () { cb(fr.error || new Error('read failed')); };
    fr.readAsDataURL(blob);
  };

  function storeLocal(path, dataUrl) {
    if (!canCache()) { return; }
    var bytes = dataUrl.length;
    K.Store.put('assets', { id: path, d: dataUrl }, function (err) {
      if (err) { K.log.warn('asset cache write failed: ' + (err.message || err)); return; }
      var ix = index();
      ix[path] = [bytes, Date.now()];
      saveIndex(ix);
      A.evict();
    });
  }

  function touch(path) {
    var ix = index();
    if (ix[path]) { ix[path][1] = Date.now(); saveIndex(ix); }
  }

  // Remove least-recently-used images until under the cap.
  A.evict = function () {
    var ix = index(), keys = Object.keys(ix), total = 0, i;
    for (i = 0; i < keys.length; i++) { total += ix[keys[i]][0]; }
    if (total <= limitBytes()) { return; }
    keys.sort(function (a, b) { return ix[a][1] - ix[b][1]; });
    i = 0;
    while (total > limitBytes() * 0.8 && i < keys.length) {
      var k = keys[i++];
      if (mem[k]) { continue; }
      total -= ix[k][0];
      delete ix[k];
      K.Store.del('assets', k);
    }
    saveIndex(ix);
  };

  A.usage = function () {
    var ix = index(), keys = Object.keys(ix), total = 0;
    for (var i = 0; i < keys.length; i++) { total += ix[keys[i]][0]; }
    return { bytes: total, count: keys.length, limit: limitBytes() };
  };

  A.clear = function (cb) {
    var ix = index();
    var keys = Object.keys(ix);
    U.eachSeries(keys, function (k, next) { K.Store.del('assets', k, function () { next(); }); }, function () {
      saveIndex({});
      if (cb) { cb(); }
    });
  };

  // get(path, cb(err, HTMLImageElement))
  A.get = function (path, cb) {
    if (!path) { cb(new Error('no path')); return; }
    if (mem[path]) { memPut(path, mem[path]); cb(null, mem[path]); return; }
    if (waiting[path]) { waiting[path].push(cb); return; }
    waiting[path] = [cb];
    function done(err, img) {
      var list = waiting[path] || [];
      delete waiting[path];
      if (!err) { memPut(path, img); }
      for (var i = 0; i < list.length; i++) { list[i](err, img); }
    }
    function download() {
      if (!K.sb.isLoggedIn()) { done({ type: 'auth', message: 'Log in to download this image' }); return; }
      K.sb.storageDownload(path, function (err, blob) {
        if (err) { done(err); return; }
        A.blobToDataUrl(blob, function (e2, dataUrl) {
          if (e2) { done(e2); return; }
          storeLocal(path, dataUrl);
          decode(dataUrl, done);
        });
      });
    }
    if (!canCache()) { download(); return; }
    K.Store.get('assets', path, function (err, rec) {
      if (!err && rec && rec.d) { touch(path); decode(rec.d, done); return; }
      download();
    });
  };

  // Make an image available locally right after uploading it (no re-download).
  A.putDataUrl = function (path, dataUrl) { storeLocal(path, dataUrl); };

  A.prefetch = function (path) { if (path && !mem[path]) { A.get(path, function () {}); } };

  A.thumbOf = function (pagePath) {
    return pagePath ? pagePath.replace(/\/p(\d+)\.jpg$/, '/t$1.jpg') : null;
  };

  K.Assets = A;
})(window.Kagoj = window.Kagoj || {});
