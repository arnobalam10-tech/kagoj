// Generates the home-screen icon and launch images (no dependencies).
// Icon: a cream sheet with a single ink line on a charcoal background (PRD §16).
/* eslint-disable */
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var OUT = path.resolve(__dirname, '..', 'icons');
fs.mkdirSync(OUT, { recursive: true });

function hex(c) { return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)]; }

var CRC = (function () {
  var t = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) { c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  var td = Buffer.concat([Buffer.from(type), data]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  var raw = Buffer.alloc((w * 3 + 1) * h);
  for (var y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

function segDist(px, py, ax, ay, bx, by) {
  var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  var qx = ax + t * dx - px, qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

// Scene in unit coords [0,1] relative to an icon square of size s at (ox, oy)
function inkPath() {
  var pts = [];
  for (var i = 0; i <= 60; i++) {
    var t = i / 60;
    pts.push([0.34 + t * 0.34, 0.56 + Math.sin(t * Math.PI * 2.2) * 0.05 - t * 0.04]);
  }
  return pts;
}
var INK = inkPath();

// returns colour at (x, y) in [0,1] icon space, or null for background
function iconColor(x, y, bg) {
  var c = bg;
  // sheet with a soft shadow
  var sx0 = 0.24, sx1 = 0.76, sy0 = 0.16, sy1 = 0.84;
  if (x > sx0 + 0.01 && x < sx1 + 0.01 && y > sy0 + 0.015 && y < sy1 + 0.015) { c = mix(c, [0, 0, 0], 0.25); }
  if (x > sx0 && x < sx1 && y > sy0 && y < sy1) {
    c = hex('#FDFCF8');
    // faint ruled lines
    for (var ly = 0.3; ly < sy1 - 0.04; ly += 0.085) { if (Math.abs(y - ly) < 0.004) { c = hex('#C9D6E8'); } }
    var d = 1;
    for (var i = 0; i < INK.length - 1; i++) {
      d = Math.min(d, segDist(x, y, INK[i][0], INK[i][1], INK[i + 1][0], INK[i + 1][1]));
    }
    if (d < 0.016) { c = hex('#1F1F1F'); }
  }
  return c;
}
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

function render(w, h, bgHex, iconBox) {
  var bg = hex(bgHex);
  var buf = Buffer.alloc(w * h * 3);
  var SS = 4;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var r = 0, g = 0, b = 0;
      for (var sy = 0; sy < SS; sy++) {
        for (var sx = 0; sx < SS; sx++) {
          var px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          var c = bg;
          if (iconBox) {
            var ux = (px - iconBox.x) / iconBox.s, uy = (py - iconBox.y) / iconBox.s;
            if (ux >= 0 && ux <= 1 && uy >= 0 && uy <= 1) {
              // rounded-square icon on the launch screen
              var rx = Math.max(0, Math.abs(ux - 0.5) - 0.32), ry = Math.max(0, Math.abs(uy - 0.5) - 0.32);
              if (Math.sqrt(rx * rx + ry * ry) < 0.18) { c = iconColor(ux, uy, hex('#2F3640')); }
            }
          } else {
            c = iconColor(px / w, py / h, bg);
          }
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      var n = SS * SS, o = (y * w + x) * 3;
      buf[o] = Math.round(r / n); buf[o + 1] = Math.round(g / n); buf[o + 2] = Math.round(b / n);
    }
  }
  return png(w, h, buf);
}

[152, 180, 192].forEach(function (s) {
  fs.writeFileSync(path.join(OUT, 'icon-' + s + '.png'), render(s, s, '#2F3640'));
  console.log('icons/icon-' + s + '.png');
});
[[1024, 748], [768, 1004]].forEach(function (d) {
  var s = 160;
  fs.writeFileSync(path.join(OUT, 'launch-' + d[0] + 'x' + d[1] + '.png'),
    render(d[0], d[1], '#ECEAE4', { x: (d[0] - s) / 2, y: (d[1] - s) / 2 - 20, s: s }));
  console.log('icons/launch-' + d[0] + 'x' + d[1] + '.png');
});
