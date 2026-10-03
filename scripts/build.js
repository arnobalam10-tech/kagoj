// Kagoj build: lint (ES5 rules) -> tests -> concat JS/CSS in index.html order ->
// minify (ES5 output) -> content-hash file names -> dist/
// A build that fails lint or tests is not deployed (PRD §3.1).
//
// Two bundles keep start-up small on the iPad 2:
//   app.<hash>.js   everything needed to open notebooks and write (budget 120 KB)
//   extra.<hash>.js Uploads, page picker, PDF import, Settings, debug console,
//                   plus their CSS; loaded in the background after start (budget 60 KB)
/* eslint-disable */
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var DIST = path.join(ROOT, 'dist');
var budgets = { js: 120 * 1024, extra: 60 * 1024, css: 20 * 1024 };

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

// 2. collect files from index.html build blocks
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function block(name) {
  var re = new RegExp('<!-- build:' + name + ' -->([\\s\\S]*?)<!-- endbuild -->');
  var m = re.exec(html);
  if (!m) { fail('missing build:' + name + ' block'); }
  return m;
}
function attrs(text, attr) {
  var re = new RegExp(attr + '="([^"]+)"', 'g'), out = [], m;
  while ((m = re.exec(text))) { out.push(m[1]); }
  return out;
}
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
function cat(files) { return files.map(function (f) { return '/* ' + f + ' */\n' + read(f); }).join('\n;\n'); }

var jsBlock = block('js'), cssBlock = block('css'), extraBlock = block('extra'), extraCssBlock = block('extracss');
var js = cat(attrs(jsBlock[1], 'src'));
var css = attrs(cssBlock[1], 'href').map(read).join('\n');
var extraCss = attrs(extraCssBlock[1], 'href').map(read).join('\n');
var extraJs = cat(attrs(extraBlock[1], 'src'));

// 3. minify
var terser = require('terser');
function minifyCss(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}
var minCss = minifyCss(css);
// the extra bundle injects its own stylesheet when it loads
extraJs = '(function(){var s=document.createElement("style");s.textContent=' + JSON.stringify(minifyCss(extraCss)) +
  ';document.getElementsByTagName("head")[0].appendChild(s);})();\n' + extraJs;

var TERSER = {
  ecma: 5,
  ie8: false,
  safari10: true,
  compress: { ecma: 5, passes: 2, drop_debugger: true },
  mangle: { safari10: true },
  format: { ecma: 5, comments: false }
};

Promise.all([terser.minify(js, TERSER), terser.minify(extraJs, TERSER)]).then(function (outs) {
  var minJs = outs[0].code, minExtra = outs[1].code;
  if (!minJs || !minExtra) { fail('terser produced no output'); }

  // safety: make sure the minifier did not introduce ES2015+ syntax
  try {
    var espree = require('espree');
    espree.parse(minJs, { ecmaVersion: 5, sourceType: 'script' });
    espree.parse(minExtra, { ecmaVersion: 5, sourceType: 'script' });
  } catch (e) { fail('minified JS is not valid ES5: ' + e.message); }

  if (minJs.length > budgets.js) { fail('JS budget exceeded: ' + minJs.length + ' > ' + budgets.js); }
  if (minExtra.length > budgets.extra) { fail('extra JS budget exceeded: ' + minExtra.length + ' > ' + budgets.extra); }
  if (minCss.length > budgets.css) { fail('CSS budget exceeded: ' + minCss.length + ' > ' + budgets.css); }

  var hash = function (s) { return crypto.createHash('sha1').update(s).digest('hex').substr(0, 10); };
  var jsName = 'app.' + hash(minJs) + '.js';
  var cssName = 'app.' + hash(minCss) + '.css';
  var extraName = 'extra.' + hash(minExtra) + '.js';

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'assets', jsName), minJs);
  fs.writeFileSync(path.join(DIST, 'assets', cssName), minCss);
  fs.writeFileSync(path.join(DIST, 'assets', extraName), minExtra);

  var outHtml = html
    .replace(cssBlock[0], '<link rel="stylesheet" href="/assets/' + cssName + '">')
    .replace(extraCssBlock[0], '')
    .replace(jsBlock[0], '<script src="/assets/' + jsName + '"></script>')
    .replace(extraBlock[0], '<script>window.KAGOJ_EXTRAS = "/assets/' + extraName + '";</script>')
    .replace('<html lang="en">', '<html lang="en" manifest="/kagoj.appcache">');
  fs.writeFileSync(path.join(DIST, 'index.html'), outHtml);

  // pdf.js (legacy build) for PDF uploads on PC/phone; loaded on demand only
  var pdfSrc = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
  var pdfDst = path.join(DIST, 'vendor', 'pdfjs');
  fs.mkdirSync(pdfDst, { recursive: true });
  ['pdf.min.js', 'pdf.worker.min.js'].forEach(function (f) {
    if (!fs.existsSync(path.join(pdfSrc, f))) { fail('missing ' + f + ' (npm install)'); }
    fs.copyFileSync(path.join(pdfSrc, f), path.join(pdfDst, f));
  });

  // static folders
  ['icons', 'spike'].forEach(function (dir) {
    var src = path.join(ROOT, dir);
    if (fs.existsSync(src)) { fs.cpSync(src, path.join(DIST, dir), { recursive: true }); }
  });

  // Application Cache manifest: lets the iOS 9 home-screen app start offline.
  var icons = fs.readdirSync(path.join(ROOT, 'icons')).map(function (f) { return '/icons/' + f; });
  var manifest = ['CACHE MANIFEST', '# ' + hash(minJs + minExtra + minCss + outHtml), '', 'CACHE:',
    '/assets/' + jsName, '/assets/' + cssName, '/assets/' + extraName].concat(icons, ['', 'NETWORK:', '*', '']).join('\n');
  fs.writeFileSync(path.join(DIST, 'kagoj.appcache'), manifest);

  log('> dist/assets/' + jsName + '   ' + (minJs.length / 1024).toFixed(1) + ' KB (budget 120 KB)');
  log('> dist/assets/' + extraName + ' ' + (minExtra.length / 1024).toFixed(1) + ' KB (after start, budget 60 KB)');
  log('> dist/assets/' + cssName + '  ' + (minCss.length / 1024).toFixed(1) + ' KB (budget 20 KB)');
  log('BUILD OK');
}).catch(function (e) { fail(e.message); });
