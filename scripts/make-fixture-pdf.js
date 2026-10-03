// Writes test/fixtures/sample.pdf: 3 pages (A4 portrait, 16:9 slide, A4 portrait)
// used to test PDF uploads in the browser. No dependencies.
/* eslint-disable */
var fs = require('fs');
var path = require('path');

var pages = [
  { w: 595, h: 842, title: 'Lecture 1 - Page 1', color: '0.18 0.36 0.66' },
  { w: 960, h: 540, title: 'Slide 2 (16:9)', color: '0.82 0.19 0.18' },
  { w: 595, h: 842, title: 'Page 3', color: '0.12 0.54 0.27' }
];

var objs = [];
function add(s) { objs.push(s); return objs.length; }

var font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
var pagesId = objs.length + 1 + pages.length * 2; // reserved later
var kids = [];
pages.forEach(function (p) {
  var content = [
    'BT /F1 28 Tf 50 ' + (p.h - 80) + ' Td (' + p.title + ') Tj ET',
    p.color + ' rg 50 ' + (p.h / 2 - 60) + ' ' + (p.w - 100) + ' 120 re f',
    '0 0 0 RG 2 w 50 80 m ' + (p.w - 50) + ' 80 l S',
    'BT /F1 14 Tf 50 50 Td (Kagoj upload test) Tj ET'
  ].join('\n');
  var c = add('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
  var pg = add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + p.w + ' ' + p.h + '] /Contents ' + c + ' 0 R /Resources << /Font << /F1 ' + font + ' 0 R >> >> >>');
  kids.push(pg + ' 0 R');
});
var pagesObj = add('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>');
if (pagesObj !== pagesId) { throw new Error('object numbering'); }
var catalog = add('<< /Type /Catalog /Pages ' + pagesObj + ' 0 R >>');

var out = '%PDF-1.4\n';
var offsets = [];
objs.forEach(function (o, i) {
  offsets.push(Buffer.byteLength(out));
  out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n';
});
var xref = Buffer.byteLength(out);
out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
offsets.forEach(function (off) { out += ('0000000000' + off).slice(-10) + ' 00000 n \n'; });
out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';

var dir = path.join(__dirname, '..', 'test', 'fixtures');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'sample.pdf'), out);
console.log('test/fixtures/sample.pdf', Buffer.byteLength(out), 'bytes');
