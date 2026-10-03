// Kagoj build: lint (ES5 rules) -> concat JS/CSS in index.html order ->
// minify (ES5 output) -> content-hash file names -> dist/
// A build that fails lint is not deployed (PRD §3.1).
/* eslint-disable */
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var DIST = path.join(ROOT, 'dist');
var budgets = { js: 120 * 1024, css: 20 * 1024 };

function log(m) { process.stdout.write(m + '\n'); }
function fail(m) { process.stderr.write('BUILD FAILED: ' + m + '\n'); process.exit(1); }

// 1. lint
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
var jsBlock = block('js'), cssBlock = block('css');
var jsFiles = [], cssFiles = [], m;
var reSrc = /src="([^"]+)"/g;
while ((m = reSrc.exec(jsBlock[1]))) { jsFiles.push(m[1]); }
var reHref = /href="([^"]+)"/g;
while ((m = reHref.exec(cssBlock[1]))) { cssFiles.push(m[1]); }

var js = jsFiles.map(function (f) { return '/* ' + f + ' */\n' + fs.readFileSync(path.join(ROOT, f), 'utf8'); }).join('\n;\n');
var css = cssFiles.map(function (f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }).join('\n');

// 3. minify
var terser = require('terser');
function minifyCss(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

terser.minify(js, {
  ecma: 5,
  ie8: false,
  safari10: true,
  compress: { ecma: 5, passes: 2, drop_debugger: true },
  mangle: { safari10: true },
  format: { ecma: 5, comments: false }
}).then(function (out) {
  if (!out.code) { fail('terser produced no output'); }
  var minJs = out.code;
  var minCss = minifyCss(css);

  // safety: make sure the minifier did not introduce ES2015+ syntax
  try {
    var espree = require('espree');
    espree.parse(minJs, { ecmaVersion: 5, sourceType: 'script' });
  } catch (e) { fail('minified JS is not valid ES5: ' + e.message); }

  if (minJs.length > budgets.js) { fail('JS budget exceeded: ' + minJs.length + ' > ' + budgets.js); }
  if (minCss.length > budgets.css) { fail('CSS budget exceeded: ' + minCss.length + ' > ' + budgets.css); }

  var hash = function (s) { return crypto.createHash('sha1').update(s).digest('hex').substr(0, 10); };
  var jsName = 'app.' + hash(minJs) + '.js';
  var cssName = 'app.' + hash(minCss) + '.css';

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'assets', jsName), minJs);
  fs.writeFileSync(path.join(DIST, 'assets', cssName), minCss);

  var outHtml = html
    .replace(cssBlock[0], '<link rel="stylesheet" href="/assets/' + cssName + '">')
    .replace(jsBlock[0], '<script src="/assets/' + jsName + '"></script>');
  fs.writeFileSync(path.join(DIST, 'index.html'), outHtml);

  // static folders
  ['icons', 'spike'].forEach(function (dir) {
    var src = path.join(ROOT, dir);
    if (fs.existsSync(src)) { fs.cpSync(src, path.join(DIST, dir), { recursive: true }); }
  });

  log('> dist/assets/' + jsName + '  ' + (minJs.length / 1024).toFixed(1) + ' KB (budget 120 KB)');
  log('> dist/assets/' + cssName + ' ' + (minCss.length / 1024).toFixed(1) + ' KB (budget 20 KB)');
  log('BUILD OK');
}).catch(function (e) { fail(e.message); });
