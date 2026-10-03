// Tiny static server for local testing: node scripts/serve.js [dir] [port]
var http = require('http'), fs = require('fs'), path = require('path');
var root = path.resolve(process.argv[2] || '.');
var port = +(process.argv[3] || 5173);
var types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.der': 'application/x-x509-ca-cert' };
http.createServer(function (req, res) {
  var p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  var f = path.join(root, p);
  if (p.indexOf('/vendor/pdfjs/') === 0 && !fs.existsSync(f)) {
    f = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', path.basename(p));
  }
  if (f.indexOf(root) !== 0 && f.indexOf('pdfjs-dist') < 0) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, function (err, data) {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(port, function () { console.log('serving ' + root + ' on http://localhost:' + port); });
