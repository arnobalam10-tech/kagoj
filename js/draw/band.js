(function (K) {
  'use strict';

  // Writing band: a strip a few ruled lines tall. Only touches that start
  // inside it can write, so a resting palm anywhere else is ignored.
  // Positions are in page units and snap to the ruled-line rows
  // (ruled paper: first line at 110, lines every 36).
  var B = {};
  B.LINE = 36;
  B.BASE = 110 - 36;   // top of the first writing row
  B.PAD = 6;           // a little room above the first row of the band

  B.height = function (n) { return n * B.LINE + 2 * B.PAD; };

  // Snap a band top to the nearest row and keep it on the page.
  B.snap = function (y, n, ph) {
    var k = Math.round((y + B.PAD - B.BASE) / B.LINE);
    var top = B.BASE + k * B.LINE - B.PAD;
    var max = Math.max(0, ph - B.height(n));
    return Math.max(0, Math.min(max, top));
  };

  B.initial = function (n, ph) { return B.snap(B.BASE - B.PAD, n, ph); };

  // Move by one band height (dir = +1 down, -1 up).
  B.step = function (y, n, ph, dir) { return B.snap(y + dir * n * B.LINE, n, ph); };

  // Is page point y inside the band (with tolerance in page units)?
  B.contains = function (y0, n, py, tol) {
    return py >= y0 - tol && py <= y0 + B.height(n) + tol;
  };

  K.band = B;
})(window.Kagoj = window.Kagoj || {});
