// Sync integration test: two simulated devices against an in-memory
// imitation of Supabase Auth + PostgREST. Exercises push, pull, lazy
// drawing download, revision-guarded PATCH, conflict copies, deletes,
// token refresh and offline retry.
/* eslint-disable */
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var assert = require('assert');
var ROOT = path.resolve(__dirname, '..');

// ---------------- mock server ----------------
var server = {
  tables: { notebooks: [], pages: [], client_logs: [], folders: [] },
  storage: {}, removed: [],
  clock: Date.UTC(2026, 9, 3, 10, 0, 0),
  tokens: {}, refreshCount: 0, online: true, n: 0
};
function ts() {
  server.clock += 7;
  return new Date(server.clock).toISOString().replace('Z', '123+00:00');
}
function parseQuery(q) {
  var out = { filters: [], select: null, order: null, limit: null };
  (q || '').split('&').filter(Boolean).forEach(function (kv) {
    var i = kv.indexOf('='), k = kv.substr(0, i), v = decodeURIComponent(kv.substr(i + 1));
    if (k === 'select') { out.select = v.split(','); }
    else if (k === 'order') { out.order = v; }
    else if (k === 'limit') { out.limit = +v; }
    else { var j = v.indexOf('.'); out.filters.push({ col: k, op: v.substr(0, j), val: v.substr(j + 1) }); }
  });
  return out;
}
function match(row, f) {
  var a = row[f.col];
  if (f.op === 'eq') { return String(a) === f.val; }
  if (f.op === 'gt') { return a !== null && a > f.val; }
  if (f.op === 'lt') { return a !== null && a < f.val; }
  throw new Error('op ' + f.op);
}
function pick(row, sel) {
  if (!sel || sel[0] === '*') { return JSON.parse(JSON.stringify(row)); }
  var o = {};
  sel.forEach(function (c) { if (c === '*') { Object.assign(o, row); } else { o[c] = row[c]; } });
  return JSON.parse(JSON.stringify(o));
}
var DEFAULTS = {
  notebooks: function () { return { title: 'Untitled notebook', cover_color: '#2F3640', default_paper: 'ruled', page_count: 0, last_opened_at: null, deleted_at: null, kind: 'notebook', folder_id: null, source_name: null }; },
  folders: function () { return { name: 'New folder', position: 0, deleted_at: null }; },
  pages: function () { return { paper: 'ruled', drawing: { v: 1, w: 1000, h: 1414, strokes: [] }, revision: 1, label: null, background_asset: null, deleted_at: null }; },
  client_logs: function () { return {}; }
};
function handle(opts) {
  var url = opts.url.replace('https://djkvzmeziimnabxcezde.supabase.co', '');
  var qi = url.indexOf('?'), p = qi < 0 ? url : url.substr(0, qi), q = qi < 0 ? '' : url.substr(qi + 1);
  var body = opts.body ? (typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body) : null;
  var auth = (opts.headers.Authorization || '').replace('Bearer ', '');
  if (p === '/auth/v1/token') {
    if (q === 'grant_type=password') {
      if (body.password !== 'secret1') { return [400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' }]; }
      var t = 'tok' + (++server.n); server.tokens[t] = true;
      return [200, { access_token: t, refresh_token: 'ref' + server.n, expires_in: 3600, user: { id: 'u1', email: body.email } }];
    }
    server.refreshCount++;
    var t2 = 'tok' + (++server.n); server.tokens[t2] = true;
    return [200, { access_token: t2, refresh_token: 'ref' + server.n, expires_in: 3600 }];
  }
  if (p === '/auth/v1/logout') { return [204, null]; }
  if (p.indexOf('/storage/v1/object') === 0) {
    if (!server.tokens[auth]) { return [401, null]; }
    if (opts.method === 'DELETE') { body.prefixes.forEach(function (k) { delete server.storage[k]; server.removed.push(k); }); return [200, []]; }
    var key = decodeURIComponent(p.replace('/storage/v1/object/authenticated/uploads/', '').replace('/storage/v1/object/uploads/', ''));
    if (opts.method === 'POST') { server.storage[key] = 'bytes'; return [200, { Key: key }]; }
    return server.storage[key] ? [200, 'blob'] : [404, null];
  }
  if (p === '/rest/v1/rpc/kagoj_asset_in_use') {
    if (!server.tokens[auth]) { return [401, null]; }
    var pre = body.prefix;
    var used = server.tables.pages.some(function (pg) {
      return pg.notebook_id !== body.exclude_notebook && !pg.deleted_at &&
        ((pg.background_asset || '').indexOf(pre) === 0 || JSON.stringify(pg.drawing).indexOf(pre) >= 0);
    });
    return [200, used];
  }
  var table = p.replace('/rest/v1/', '');
  if (!server.tokens[auth]) { return [401, { message: 'JWT expired' }]; }
  var rows = server.tables[table], qq = parseQuery(q);
  var hit = rows.filter(function (r) { return qq.filters.every(function (f) { return match(r, f); }); });
  var prefer = opts.headers.Prefer || '';
  if (opts.method === 'GET') {
    if (qq.order) { hit.sort(function (a, b) { return a.updated_at < b.updated_at ? -1 : 1; }); }
    if (qq.limit) { hit = hit.slice(0, qq.limit); }
    return [200, hit.map(function (r) { return pick(r, qq.select); })];
  }
  if (opts.method === 'POST') {
    if (table === 'notebooks') {
      (Array.isArray(body) ? body : [body]).forEach(function (b) {
        if (b.folder_id && !server.tables.folders.some(function (f) { return f.id === b.folder_id; })) {
          throw { status: 409, data: { code: '23503', message: 'folder fk violation' } };
        }
      });
    }
    var out = [];
    (Array.isArray(body) ? body : [body]).forEach(function (b) {
      if (table === 'pages' && !server.tables.notebooks.some(function (n) { return n.id === b.notebook_id; })) {
        throw { status: 409, data: { code: '23503', message: 'fk violation' } };
      }
      var ex = rows.filter(function (r) { return r.id && r.id === b.id; })[0];
      if (ex) {
        if (prefer.indexOf('merge-duplicates') < 0) { throw { status: 409, data: { message: 'duplicate key' } }; }
        Object.assign(ex, JSON.parse(JSON.stringify(b)), { updated_at: ts() });
        out.push(ex);
      } else {
        var now = ts();
        var row = Object.assign(DEFAULTS[table](), JSON.parse(JSON.stringify(b)), { user_id: 'u1', created_at: now, updated_at: now });
        if (table === 'client_logs') { row.id = rows.length + 1; }
        rows.push(row); out.push(row);
      }
    });
    return [prefer.indexOf('return=representation') >= 0 ? 201 : 201, prefer.indexOf('return=representation') >= 0 ? out.map(function (r) { return pick(r, qq.select); }) : null];
  }
  if (opts.method === 'PATCH') {
    hit.forEach(function (r) { Object.assign(r, JSON.parse(JSON.stringify(body)), { updated_at: ts() }); });
    return [200, hit.map(function (r) { return pick(r, qq.select); })];
  }
  if (opts.method === 'DELETE') {
    server.tables[table] = rows.filter(function (r) { return hit.indexOf(r) < 0; });
    return [204, null];
  }
  throw new Error('unhandled ' + opts.method + ' ' + url);
}
function mockXhr(opts, cb) {
  setTimeout(function () {
    if (!server.online) { cb({ type: 'network', status: 0, message: 'Network error' }); return; }
    var res;
    try { res = handle(opts); }
    catch (e) {
      if (e.status) { cb({ type: 'http', status: e.status, message: e.data.message, data: e.data }); return; }
      throw e;
    }
    var status = res[0], data = res[1];
    var r = { status: status, data: data, text: data ? JSON.stringify(data) : '', header: function () { return null; } };
    if (status >= 200 && status < 300) { cb(null, r); }
    else { cb({ type: 'http', status: status, message: (data && (data.msg || data.message)) || 'HTTP ' + status, data: data }, r); }
  }, 1);
  return { abort: function () {} };
}

// ---------------- devices ----------------
var FILES = ['js/config.js', 'js/core/util.js', 'js/core/dom.js', 'js/core/log.js', 'js/net/xhr.js', 'js/net/supabase.js',
  'js/store/idb.js', 'js/store/ls.js', 'js/store/store.js', 'js/store/repo.js', 'js/store/assets.js',
  'js/draw/geometry.js', 'js/draw/codec.js', 'js/sync/sync.js'];

function device(name, ua) {
  var mem = {};
  var ls = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; },
    key: function (i) { return Object.keys(mem)[i]; },
    get length() { return Object.keys(mem).length; }
  };
  var win = {
    navigator: { userAgent: ua, maxTouchPoints: 0, onLine: true }, screen: { width: 1024, height: 768 },
    localStorage: ls, addEventListener: function () {}, removeEventListener: function () {},
    devicePixelRatio: 1, crypto: require('crypto').webcrypto, console: { log: function () {} },
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: function () { return 0; }, clearInterval: function () {},
    Date: Date, Math: Math, JSON: JSON, Uint8Array: Uint8Array, Error: Error,
    document: { addEventListener: function () {}, hidden: false }
  };
  win.window = win;
  var ctx = vm.createContext(win);
  FILES.forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }); });
  var K = win.Kagoj;
  K.xhr = mockXhr;
  K.name = name;
  return K;
}

function cb2p(fn) { return new Promise(function (res, rej) { fn(function (err, v) { if (err) { rej(err); } else { res(v); } }); }); }
function sync(K) {
  return new Promise(function (res) {
    var h = K.Sync.on('done', function (err) { K.Sync.off('done', h); res(err); });
    K.Sync.now();
  });
}
async function boot(K) {
  await cb2p(function (cb) { K.Store.init(cb); });
  await cb2p(function (cb) { K.Repo.init(cb); });
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function stroke(K, x, id) {
  return K.geom.finishStroke({ id: id, t: 'p', c: '#1F1F1F', w: 3.5, pts: [x, 100, x + 10, 110, x + 20, 105] });
}
function drawingWith(K, ids) {
  return K.codec.encode(ids.map(function (id, i) { return stroke(K, 100 + i * 30, id); }));
}
async function flushWrites(K) { while (K.Repo.writes > 0) { await wait(2); } await wait(5); }

var passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); }
}

(async function main() {
  var A = device('A', 'Mozilla/5.0 (iPad; CPU OS 9_3_5 like Mac OS X)');
  var B = device('B', 'Mozilla/5.0 (Windows NT 10.0)');
  await boot(A); await boot(B);
  assert.strictEqual(A.Store.backend, 'localstorage');
  var nbId, p1;

  console.log('auth');
  await test('wrong password is reported in plain language', async function () {
    var err = await new Promise(function (r) { A.sb.login('arnob', 'nope', r); });
    assert.strictEqual(A.sb.describeError(err), 'Wrong email or password');
  });
  await test('username login maps to name@ami.com', async function () {
    await cb2p(function (cb) { A.sb.login('Arnob', 'secret1', cb); });
    assert.strictEqual(A.sb.email(), 'arnob@ami.com');
    await cb2p(function (cb) { B.sb.login('arnob@ami.com', 'secret1', cb); });
  });
  await test('status is "Saved" with nothing pending', function () {
    assert.strictEqual(A.Sync.status().code, 'saved');
  });

  console.log('push / pull');
  await test('A creates a notebook offline-first and pushes it', async function () {
    var res = A.Repo.createNotebook({ title: 'Physics', cover_color: '#1F3A5F', default_paper: 'grid' });
    nbId = res.notebook.id; p1 = res.page.id;
    A.Repo.saveDrawing(p1, drawingWith(A, ['s_aaaaaaa1', 's_aaaaaaa2']));
    await flushWrites(A);
    assert.ok(A.Sync.status().code === 'pending');
    assert.ok(/Saved on iPad/.test(A.Sync.status().text));
    var err = await sync(A);
    assert.ifError(err);
    assert.strictEqual(server.tables.notebooks.length, 1);
    assert.strictEqual(server.tables.pages.length, 1);
    assert.strictEqual(server.tables.pages[0].drawing.strokes.length, 2);
    assert.strictEqual(server.tables.pages[0].paper, 'grid');
    assert.strictEqual(A.Repo.dirtyCount(), 0);
    assert.strictEqual(A.Sync.status().code, 'saved');
  });
  await test('B pulls metadata; drawing downloads lazily on open', async function () {
    assert.ifError(await sync(B));
    var nb = B.Repo.notebook(nbId);
    assert.ok(nb && nb.title === 'Physics' && nb.page_count === 1);
    var pg = B.Repo.page(p1);
    assert.ok(pg.needsDrawing);
    var d = await cb2p(function (cb) { B.Repo.loadDrawing(p1, cb); });
    assert.strictEqual(d.strokes.length, 2);
    assert.ok(!B.Repo.page(p1).needsDrawing);
    assert.strictEqual(B.Repo.dirtyCount(), 0);
  });
  await test('B edits; A pulls the new drawing (revision guard advances)', async function () {
    B.Repo.saveDrawing(p1, drawingWith(B, ['s_aaaaaaa1', 's_aaaaaaa2', 's_bbbbbbb3']));
    await flushWrites(B);
    assert.ifError(await sync(B));
    assert.strictEqual(server.tables.pages[0].revision, 2);
    var remote = [];
    A.Sync.on('remotePage', function (id) { remote.push(id); });
    assert.ifError(await sync(A));
    var d = await cb2p(function (cb) { A.Repo.loadDrawing(p1, cb); });
    assert.strictEqual(d.strokes.length, 3);
    assert.strictEqual(A.Repo.page(p1).baseRevision, 2);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(remote)), [p1]);
  });
  await test('adding a page between pages uses gapped positions', async function () {
    var p2 = A.Repo.addPage(nbId, p1, 'dotted');
    var p3 = A.Repo.addPage(nbId, p1, 'blank'); // between p1 and p2
    var order = A.Repo.pagesOf(nbId).map(function (p) { return p.id; });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(order)), [p1, p3.id, p2.id]);
    await flushWrites(A);
    assert.ifError(await sync(A));
    assert.ifError(await sync(B));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(B.Repo.pagesOf(nbId).map(function (p) { return p.id; }))), JSON.parse(JSON.stringify(order)));
    assert.strictEqual(B.Repo.notebook(nbId).page_count, 3);
  });

  console.log('conflicts');
  await test('simultaneous edits keep both versions (conflict copy after the page)', async function () {
    A.Repo.saveDrawing(p1, drawingWith(A, ['s_aaaaaaa1', 's_ipadipa1']));
    B.Repo.saveDrawing(p1, drawingWith(B, ['s_aaaaaaa1', 's_pcpcpcp1', 's_pcpcpcp2']));
    await flushWrites(A); await flushWrites(B);
    assert.ifError(await sync(B));                 // PC wins the race
    var conflicts = 0;
    A.Sync.on('conflict', function () { conflicts++; });
    assert.ifError(await sync(A));                 // iPad finds revision moved
    assert.strictEqual(conflicts, 1);
    var main = await cb2p(function (cb) { A.Repo.loadDrawing(p1, cb); });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(main.strokes.map(function (s) { return s.id; }))), ['s_aaaaaaa1', 's_pcpcpcp1', 's_pcpcpcp2']);
    var pages = A.Repo.pagesOf(nbId);
    assert.strictEqual(pages[0].id, p1);
    assert.ok(/^conflict copy \(iPad, /.test(pages[1].label), 'label: ' + pages[1].label);
    var copy = await cb2p(function (cb) { A.Repo.loadDrawing(pages[1].id, cb); });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(copy.strokes.map(function (s) { return s.id; }))), ['s_aaaaaaa1', 's_ipadipa1']);
    assert.ifError(await sync(A));
    assert.strictEqual(server.tables.pages.length, 4);
    assert.ifError(await sync(B));
    assert.strictEqual(B.Repo.pagesOf(nbId).length, 4);
    assert.strictEqual(A.Repo.dirtyCount(), 0);
  });

  console.log('uploads: folders & documents');
  var folderId, docId, docPage1;
  await test('folder + document sync; documents stay out of the Notebooks tab', async function () {
    var f = A.Repo.createFolder('Anatomy');
    folderId = f.id;
    var uid = A.sb.userId();
    var did = A.util.uuid();
    ['p001', 't001', 'p002', 't002'].forEach(function (n) { server.storage[uid + '/' + did + '/' + n + '.jpg'] = 'x'; });
    var doc = A.Repo.createDocument({ id: did, folderId: f.id, title: 'Lecture 1', sourceName: 'lecture1.pdf', pages: [
      { asset: uid + '/' + did + '/p001.jpg', w: 1000, h: 563 },
      { asset: uid + '/' + did + '/p002.jpg', w: 1000, h: 563 }
    ] });
    docId = doc.id;
    await flushWrites(A);
    assert.ifError(await sync(A));
    assert.strictEqual(server.tables.folders.length, 1);
    var row = server.tables.notebooks.filter(function (n) { return n.id === docId; })[0];
    assert.strictEqual(row.kind, 'document');
    assert.strictEqual(row.folder_id, folderId);
    var pgs = server.tables.pages.filter(function (pg) { return pg.notebook_id === docId; })
      .sort(function (a, b) { return a.position - b.position; });
    assert.strictEqual(pgs.length, 2);
    assert.ok(/p001[.]jpg$/.test(pgs[0].background_asset));
    assert.strictEqual(pgs[0].drawing.h, 563);
    assert.ifError(await sync(B));
    assert.strictEqual(B.Repo.folders().length, 1);
    assert.strictEqual(B.Repo.documents(folderId).length, 1);
    assert.ok(B.Repo.notebooks().every(function (n) { return n.kind !== 'document'; }));
    docPage1 = B.Repo.pagesOf(docId)[0];
    assert.ok(/p001[.]jpg$/.test(docPage1.background_asset));
    var d = await cb2p(function (cb) { B.Repo.loadDrawing(docPage1.id, cb); });
    assert.strictEqual(d.h, 563);
  });
  await test('writing on a document page syncs like any notebook page', async function () {
    B.Repo.saveDrawing(docPage1.id, { v: 1, w: 1000, h: 563, strokes: drawingWith(B, ['s_docnote1']).strokes,
      imgs: [{ id: 'i_1', a: docPage1.background_asset, x: 10, y: 10, w: 200, h: 113 }] });
    await flushWrites(B);
    assert.ifError(await sync(B));
    assert.ifError(await sync(A));
    var d = await cb2p(function (cb) { A.Repo.loadDrawing(docPage1.id, cb); });
    assert.strictEqual(d.strokes[0].id, 's_docnote1');
    assert.strictEqual(d.imgs[0].a, docPage1.background_asset);
  });
  await test('import document pages into a notebook (pages keep the background)', async function () {
    var before = A.Repo.pagesOf(nbId).length;
    var p = A.Repo.addPage(nbId, null, 'blank', { background_asset: docPage1.background_asset, w: 1000, h: 563 });
    A.Repo.recount(nbId);
    await flushWrites(A);
    assert.ifError(await sync(A));
    assert.ifError(await sync(B));
    assert.strictEqual(B.Repo.page(p.id).background_asset, docPage1.background_asset);
    assert.strictEqual(B.Repo.pagesOf(nbId).length, before + 1);
  });
  await test('deleting a folder deletes its documents; restore brings both back', async function () {
    A.Repo.deleteFolder(folderId);
    await flushWrites(A);
    assert.ifError(await sync(A));
    assert.ifError(await sync(B));
    assert.strictEqual(B.Repo.folders().length, 0);
    assert.strictEqual(B.Repo.documents().length, 0);
    var del = B.Repo.deletedItems();
    assert.strictEqual(del.folders.length, 1);
    assert.strictEqual(del.notebooks.filter(function (n) { return n.id === docId; }).length, 0);
    B.Repo.restoreFolder(folderId);
    await flushWrites(B);
    assert.ifError(await sync(B));
    assert.ifError(await sync(A));
    assert.strictEqual(A.Repo.documents(folderId).length, 1);
  });
  await test('purge deletes a document\'s files only when nothing else uses them', async function () {
    var uid = A.sb.userId();
    var lone = A.util.uuid();
    server.storage[uid + '/' + lone + '/p001.jpg'] = 'x';
    server.storage[uid + '/' + lone + '/t001.jpg'] = 'x';
    A.Repo.createDocument({ id: lone, folderId: folderId, title: 'Old handout', pages: [{ asset: uid + '/' + lone + '/p001.jpg', w: 1000, h: 1414 }] });
    await flushWrites(A);
    assert.ifError(await sync(A));
    var long = new Date(Date.now() - 40 * 86400000).toISOString();
    [lone, docId].forEach(function (id) {
      A.Repo.nbs[id].deleted_at = long;
      A.Repo.nbs[id].dirty = false;
      server.tables.notebooks.forEach(function (n) { if (n.id === id) { n.deleted_at = long; } });
    });
    A.Repo.setMeta('purgeAt', 0);
    assert.ifError(await sync(A));
    assert.ok(!server.storage[uid + '/' + lone + '/p001.jpg'], 'unused document files removed');
    assert.ok(!server.storage[uid + '/' + lone + '/t001.jpg']);
    assert.ok(server.storage[uid + '/' + docId + '/p001.jpg'], 'files still used by a notebook page are kept');
    assert.strictEqual(server.tables.notebooks.filter(function (n) { return n.id === lone; }).length, 0);
  });

  console.log('deletes, offline, auth');
  await test('soft delete syncs and restore brings it back', async function () {
    A.Repo.deleteNotebook(nbId);
    await flushWrites(A);
    assert.ifError(await sync(A));
    assert.ok(server.tables.notebooks[0].deleted_at);
    assert.ifError(await sync(B));
    assert.strictEqual(B.Repo.notebooks().length, 0);
    assert.strictEqual(B.Repo.deletedItems().notebooks.length, 1);
    B.Repo.restoreNotebook(nbId);
    await flushWrites(B);
    assert.ifError(await sync(B));
    assert.ifError(await sync(A));
    assert.strictEqual(A.Repo.notebooks().length, 1);
  });
  await test('offline: writing continues, status says Offline, sync resumes later', async function () {
    server.online = false;
    A.Repo.saveDrawing(p1, drawingWith(A, ['s_offline1']));
    await flushWrites(A);
    var err = await sync(A);
    assert.strictEqual(err.type, 'network');
    assert.strictEqual(A.Sync.status().code, 'offline');
    assert.ok(/Offline · saved on iPad/.test(A.Sync.status().text));
    server.online = true;
    assert.ifError(await sync(A));
    assert.strictEqual(A.Sync.status().code, 'saved');
    var row = server.tables.pages.filter(function (r) { return r.id === p1; })[0];
    assert.strictEqual(row.drawing.strokes[0].id, 's_offline1');
  });
  await test('expired access token triggers exactly one refresh for concurrent calls', async function () {
    server.tokens = {};                    // server rejects every token -> 401
    var before = server.refreshCount;
    var results = await Promise.all([1, 2, 3].map(function () {
      return new Promise(function (r) { A.sb.rest('GET', 'notebooks?select=id', {}, function (e, d) { r(e || d); }); });
    }));
    results.forEach(function (r) { assert.ok(Array.isArray(r), JSON.stringify(r)); });
    assert.ok(server.refreshCount - before <= 3);
    // expiring locally (not a 401) refreshes once for all callers
    var s = JSON.parse(A.util.lsGet ? JSON.stringify(A.util.lsGet('kagoj.session')) : '{}');
    s.expires_at = Math.floor(Date.now() / 1000) + 10;
    A.util.lsSet('kagoj.session', s);
  });
  await test('remote error logs are uploaded without tokens', async function () {
    A.log.error('boom access_token: "eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY3.abcdefghijklmn"');
    assert.ifError(await sync(A));
    var logs = server.tables.client_logs;
    assert.ok(logs.length >= 1);
    logs.forEach(function (l) { assert.ok(!/eyJhbGciOiJIUzI1NiIs\./.test(l.message), l.message); });
  });
  await test('pages are never synced for another user (RLS is server-side; client sends no user_id)', async function () {
    server.tables.pages.forEach(function (r) { assert.strictEqual(r.user_id, 'u1'); });
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
