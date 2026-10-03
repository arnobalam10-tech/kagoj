(function (K) {
  'use strict';

  // Turns uploaded PDFs / photos into page JPEGs + thumbnails in Supabase
  // Storage, then creates a document (kind 'document') in a folder.
  // PDF rendering uses pdf.js and only runs on modern browsers (PC / phone);
  // the iPad 2 can upload photos.
  var U = K.util;
  var I = {};
  var PAGE_W = 1400;      // px width of page images
  var MAX_H = 2800;       // px cap for very tall pages
  var THUMB_W = 240;
  var QUALITY = 0.8;
  var pdfLoading = null;

  I.canPdf = function () {
    // Safari 9 has no fetch; pdf.js needs a modern engine anyway.
    return ('fetch' in window) && !!window.Worker;
  };

  I.accept = function () {
    return I.canPdf() ? 'application/pdf,image/jpeg,image/png,.pdf' : 'image/*';
  };

  function pad3(n) { return n < 10 ? '00' + n : (n < 100 ? '0' + n : String(n)); }

  function loadPdfJs(cb) {
    if (window.pdfjsLib) { cb(null, window.pdfjsLib); return; }
    if (pdfLoading) { pdfLoading.push(cb); return; }
    pdfLoading = [cb];
    var s = document.createElement('script');
    s.src = '/vendor/pdfjs/pdf.min.js';
    s.onload = function () {
      var lib = window.pdfjsLib;
      var list = pdfLoading; pdfLoading = null;
      if (!lib) { list.forEach(function (f) { f(new Error('PDF reader failed to load')); }); return; }
      lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
      list.forEach(function (f) { f(null, lib); });
    };
    s.onerror = function () {
      var list = pdfLoading; pdfLoading = null;
      list.forEach(function (f) { f(new Error('PDF reader could not be downloaded')); });
    };
    document.head.appendChild(s);
  }

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(','), mime = /:(.*?);/.exec(parts[0])[1];
    var bin = window.atob(parts[1]), n = bin.length, u8 = new Uint8Array(n);
    for (var i = 0; i < n; i++) { u8[i] = bin.charCodeAt(i); }
    return new window.Blob([u8], { type: mime });
  }

  // cb(err, {blob, dataUrl})
  function canvasJpeg(canvas, cb) {
    var dataUrl;
    try { dataUrl = canvas.toDataURL('image/jpeg', QUALITY); } catch (e) { cb(e); return; }
    cb(null, { blob: dataUrlToBlob(dataUrl), dataUrl: dataUrl });
  }

  function scaledCanvas(src, sw, sh, w) {
    var h = Math.round(sh * w / sw);
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.fillStyle = '#FFFFFF';
    x.fillRect(0, 0, w, h);
    x.drawImage(src, 0, 0, w, h);
    return c;
  }

  // Uploads page i (1-based) from a rendered canvas; cb(err, {asset, w, h})
  function uploadPage(base, i, canvas, onProgress, cb, sent) {
    var pagePath = base + 'p' + pad3(i) + '.jpg';
    var thumbPath = base + 't' + pad3(i) + '.jpg';
    var cw = canvas.width, ch = canvas.height;
    canvasJpeg(canvas, function (err, page) {
      if (err) { cb(err); return; }
      var thumbCanvas = scaledCanvas(canvas, cw, ch, THUMB_W);
      canvasJpeg(thumbCanvas, function (err2, thumb) {
        thumbCanvas.width = 0; thumbCanvas.height = 0;
        if (err2) { cb(err2); return; }
        K.sb.storageUpload(pagePath, page.blob, 'image/jpeg', function (e3) {
          if (e3) { cb(e3); return; }
          sent.push(pagePath);
          K.sb.storageUpload(thumbPath, thumb.blob, 'image/jpeg', function (e4) {
            if (e4) { cb(e4); return; }
            sent.push(thumbPath);
            K.Assets.putDataUrl(thumbPath, thumb.dataUrl);
            if (i <= 3) { K.Assets.putDataUrl(pagePath, page.dataUrl); }
            cb(null, { asset: pagePath, w: 1000, h: Math.round(1000 * ch / cw) });
          });
        }, onProgress);
      });
    });
  }

  function importPdf(file, base, ev, cb, sent) {
    ev({ phase: 'load' });
    loadPdfJs(function (err, lib) {
      if (err) { cb(err); return; }
      var fr = new window.FileReader();
      fr.onerror = function () { cb(new Error('Could not read the file')); };
      fr.onload = function () {
        // isEvalSupported:false closes the pdf.js 3.x font-eval hole (CVE-2024-4367)
        var task = lib.getDocument({ data: new Uint8Array(fr.result), isEvalSupported: false });
        task.promise.then(function (pdf) {
          var n = pdf.numPages, pages = [], i = 0;
          function next() {
            i++;
            if (i > n) { pdf.destroy(); cb(null, pages); return; }
            ev({ phase: 'render', i: i, n: n });
            pdf.getPage(i).then(function (page) {
              var vp1 = page.getViewport({ scale: 1 });
              var scale = PAGE_W / vp1.width;
              if (vp1.height * scale > MAX_H) { scale = MAX_H / vp1.height; }
              var vp = page.getViewport({ scale: scale });
              var c = document.createElement('canvas');
              c.width = Math.round(vp.width); c.height = Math.round(vp.height);
              var ctx = c.getContext('2d');
              ctx.fillStyle = '#FFFFFF';
              ctx.fillRect(0, 0, c.width, c.height);
              page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
                ev({ phase: 'upload', i: i, n: n });
                uploadPage(base, i, c, function (f) { ev({ phase: 'upload', i: i, n: n, f: f }); }, function (e2, rec) {
                  c.width = 0; c.height = 0;
                  page.cleanup();
                  if (e2) { pdf.destroy(); cb(e2); return; }
                  pages.push(rec);
                  next();
                }, sent);
              }, function (e3) { pdf.destroy(); cb(e3); });
            }, function (e4) { pdf.destroy(); cb(e4); });
          }
          next();
        }, function (e5) {
          cb(new Error(e5 && e5.name === 'PasswordException' ? 'This PDF is password protected' : 'This PDF could not be opened'));
        });
      };
      fr.readAsArrayBuffer(file);
    });
  }

  function importImage(file, base, ev, cb, sent) {
    ev({ phase: 'render', i: 1, n: 1 });
    var fr = new window.FileReader();
    fr.onerror = function () { cb(new Error('Could not read the photo')); };
    fr.onload = function () {
      var img = new Image();
      img.onerror = function () { cb(new Error('This image format is not supported')); };
      img.onload = function () {
        var w = Math.min(PAGE_W, img.naturalWidth || img.width);
        var sh = img.naturalHeight || img.height, sw = img.naturalWidth || img.width;
        if (sh * w / sw > MAX_H) { w = Math.round(MAX_H * sw / sh); }
        var c = scaledCanvas(img, sw, sh, w);
        img.onload = img.onerror = null;
        img.src = '';
        ev({ phase: 'upload', i: 1, n: 1 });
        uploadPage(base, 1, c, function (f) { ev({ phase: 'upload', i: 1, n: 1, f: f }); }, function (err, rec) {
          c.width = 0; c.height = 0;
          if (err) { cb(err); return; }
          cb(null, [rec]);
        }, sent);
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  function titleFrom(name) {
    return String(name || 'Document').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').substr(0, 120) || 'Document';
  }

  // importFile(file, folderId, onEvent, cb(err, doc))
  I.importFile = function (file, folderId, onEvent, cb) {
    var uid = K.sb.userId();
    if (!K.sb.isLoggedIn() || !uid) { cb(new Error('Log in to upload files')); return; }
    if (navigator.onLine === false) { cb(new Error('No internet connection')); return; }
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    var isImg = /^image\/(jpeg|png|gif|webp)$/.test(file.type || '') || /\.(jpe?g|png)$/i.test(file.name || '');
    if (!isPdf && !isImg) { cb(new Error('Only PDF files and photos can be uploaded')); return; }
    if (isPdf && !I.canPdf()) { cb(new Error('PDFs can be uploaded from a PC or phone')); return; }
    var docId = U.uuid();
    var base = uid + '/' + docId + '/';
    var run = isPdf ? importPdf : importImage;
    var started = Date.now();
    var sent = [];
    run(file, base, onEvent, function (err, pages) {
      if (err) {
        K.log.warn('upload failed for ' + file.name + ': ' + (err.message || err));
        // best effort: remove what was uploaded
        K.sb.storageRemove(sent, function () {});
        cb(err);
        return;
      }
      var doc = K.Repo.createDocument({ id: docId, folderId: folderId, title: titleFrom(file.name), sourceName: file.name, pages: pages });
      K.log('uploaded ' + file.name + ' (' + pages.length + ' pages) in ' + Math.round((Date.now() - started) / 1000) + 's');
      cb(null, doc);
    }, sent);
  };

  K.Importer = I;
})(window.Kagoj = window.Kagoj || {});
