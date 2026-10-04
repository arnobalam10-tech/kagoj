// Kagoj build: lint (ES5 rules) -> tests -> bundle -> minify (ES5 output) ->
// content-hash file names -> dist/
// A build that fails lint or tests is not deployed (PRD §3.1).
//
// index.html declares bundles as <!-- bundle:NAME --> ... <!-- endbundle -->.
//   core     loaded by a <script> tag at start (budget 120 KB)
//   others   loaded on demand by Kagoj.app.need(NAME); their CSS (<link> tags
//            inside the block) is injected when the bundle loads.
// Every bundle is listed in the Application Cache manifest so the iPad 2
// home-screen app also works offline.
/* eslint-disable */
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var DIST = path.join(ROOT, 'dist');
var BUDGET = { core: 120 * 1024, other: 110 * 1024, css: 20 * 1024 };

function log(m) { process.stdout.write(m + '\n'); }
function fail(m) { process.stderr.write('BUILD FAILED: ' + m + '\n'); process.exit(1); }

// 1. lint + tests
log('> eslint (ES5)');
try {
  cp.execSync('npx eslint js spike/spike.js --max-warnings 0', { cwd: ROOT, stdio: 'inherit' });
} catch (e) { fail('lint errors'); }

log('> tests');
try {
  cp.execSync('node scripts/test.js && node scripts/sync-test.js', { cwd: ROOT, stdio: 'pipe' });
} catch (e) { process.stdout.write(String(e.stdout || '')); fail('tests failed'); }

// 2. read index.html blocks
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function attrs(text, tag, attr) {
  var re = new RegExp('<' + tag + '[^>]*' + attr + '="([^"]+)"', 'g'), out = [], m;
  while ((m = re.exec(text))) { out.push(m[1]); }
  return out;
}
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
function cat(files) { return files.map(function (f) { return '/* ' + f + ' */\n' + read(f); }).join('\n;\n'); }
function minifyCss(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

var cssBlock = /<!-- build:css -->([\s\S]*?)<!-- endbuild -->/.exec(html);
if (!cssBlock) { fail('missing build:css block'); }
var coreCss = minifyCss(attrs(cssBlock[1], 'link', 'href').map(read).join('\n'));

var bundles = [], reB = /<!-- bundle:([a-z0-9]+) -->([\s\S]*?)<!-- endbundle -->/g, mb;
while ((mb = reB.exec(html))) {
  bundles.push({ name: mb[1], block: mb[0], js: attrs(mb[2], 'script', 'src'), css: attrs(mb[2], 'link', 'href') });
}
if (!bundles.length || bundles[0].name !== 'core') { fail('the first bundle must be "core"'); }

// 3. minify
var terser = require('terser');
var TERSER = {
  ecma: 5, ie8: false, safari10: true,
  compress: { ecma: 5, passes: 2, drop_debugger: true },
  mangle: { safari10: true },
  format: { ecma: 5, comments: false }
};

function source(b) {
  var src = cat(b.js);
  if (b.name !== 'core') {
    if (b.css.length) {
      var css = minifyCss(b.css.map(read).join('\n'));
      src = '(function(){var s=document.createElement("style");s.textContent=' + JSON.stringify(css) +
        ';document.getElementsByTagName("head")[0].appendChild(s);})();\n' + src;
    }
    src += '\n;window.Kagoj.loaded=window.Kagoj.loaded||{};window.Kagoj.loaded[' + JSON.stringify(b.name) + ']=1;';
  }
  return src;
}

Promise.all(bundles.map(function (b) { return terser.minify(source(b), TERSER); })).then(function (outs) {
  var espree = require('espree');
  var hash = function (s) { return crypto.createHash('sha1').update(s).digest('hex').substr(0, 10); };
  outs.forEach(function (o, i) {
    var b = bundles[i];
    if (!o.code) { fail('terser produced no output for ' + b.name); }
    try { espree.parse(o.code, { ecmaVersion: 5, sourceType: 'script' }); }
    catch (e) { fail(b.name + ' bundle is not valid ES5: ' + e.message); }
    var limit = b.name === 'core' ? BUDGET.core : BUDGET.other;
    if (o.code.length > limit) { fail(b.name + ' bundle over budget: ' + o.code.length + ' > ' + limit); }
    b.code = o.code;
    b.file = b.name + '.' + hash(o.code) + '.js';
  });
  if (coreCss.length > BUDGET.css) { fail('CSS budget exceeded: ' + coreCss.length + ' > ' + BUDGET.css); }
  var cssName = 'app.' + hash(coreCss) + '.css';

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'assets', cssName), coreCss);
  bundles.forEach(function (b) { fs.writeFileSync(path.join(DIST, 'assets', b.file), b.code); });

  var map = {};
  bundles.slice(1).forEach(function (b) { map[b.name] = '/assets/' + b.file; });
  var outHtml = html.replace(cssBlock[0], '<link rel="stylesheet" href="/assets/' + cssName + '">');
  bundles.forEach(function (b, i) {
    outHtml = outHtml.replace(b.block, i === 0
      ? '<script>window.KAGOJ_BUNDLES = ' + JSON.stringify(map) + ';</script>\n<script src="/assets/' + b.file + '"></script>'
      : '');
  });
  outHtml = outHtml.replace('<html lang="en">', '<html lang="en" manifest="/kagoj.appcache">');
  fs.writeFileSync(path.join(DIST, 'index.html'), outHtml);

  // vendored libraries loaded on demand (PC/phone features)
  var vendor = [
    ['pdfjs-dist/legacy/build', 'pdfjs', ['pdf.min.js', 'pdf.worker.min.js']],
    ['katex/dist', 'katex', ['katex.min.js', 'katex.min.css']],
    ['mermaid/dist', 'mermaid', ['mermaid.min.js']]
  ];
  fs.cpSync(path.join(ROOT, 'node_modules', 'katex', 'dist', 'fonts'), path.join(DIST, 'vendor', 'katex', 'fonts'), { recursive: true });
  vendor.forEach(function (v) {
    var src = path.join(ROOT, 'node_modules', v[0]), dst = path.join(DIST, 'vendor', v[1]);
    fs.mkdirSync(dst, { recursive: true });
    v[2].forEach(function (f) {
      if (!fs.existsSync(path.join(src, f))) { fail('missing ' + v[0] + '/' + f + ' (npm install)'); }
      fs.copyFileSync(path.join(src, f), path.join(dst, f));
    });
  });

  ['icons', 'spike', 'fonts'].forEach(function (dir) {
    var src = path.join(ROOT, dir);
    if (fs.existsSync(src)) { fs.cpSync(src, path.join(DIST, dir), { recursive: true }); }
  });

  // Application Cache manifest: lets the iOS 9 home-screen app start offline.
  var icons = fs.readdirSync(path.join(ROOT, 'icons')).map(function (f) { return '/icons/' + f; });
  var assets = ['/assets/' + cssName].concat(bundles.map(function (b) { return '/assets/' + b.file; }));
  var manifest = ['CACHE MANIFEST', '# ' + hash(assets.join() + outHtml), '', 'CACHE:'].concat(assets, icons, ['', 'NETWORK:', '*', '']).join('\n');
  fs.writeFileSync(path.join(DIST, 'kagoj.appcache'), manifest);

  bundles.forEach(function (b) {
    log('> ' + b.file + '  ' + (b.code.length / 1024).toFixed(1) + ' KB (budget ' + ((b.name === 'core' ? BUDGET.core : BUDGET.other) / 1024) + ' KB)');
  });
  log('> ' + cssName + '  ' + (coreCss.length / 1024).toFixed(1) + ' KB (budget 20 KB)');
  log('BUILD OK');
}).catch(function (e) { fail(e.message); });
