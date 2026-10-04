(function (K) {
  'use strict';

  // Per-device preferences (localStorage). Defaults merge with saved values.
  var U = K.util;

  var PREFS_KEY = 'kagoj.prefs';
  var DEFAULTS = {
    tool: 'pen',
    pen: { color: '#1F1F1F', size: 3.5 },
    highlighter: { color: '#FFE34D', size: 20 },
    eraser: { size: 18, mode: 'partial' },
    reopenLast: false,
    fitMode: 'auto',
    toolbarsHidden: false,
    pencilOnly: false,
    pencilAsked: false,
    wristGuard: 0,
    band: false,
    bandLines: 4,
    paletteOpen: false,
    palettePos: null,
    theme: 'light',
    docFont: 'default',
    docHeadFont: 'default',
    docSize: 16,
    docLine: 1.5,
    sbOpen: {},
    sbCollapsed: false,
    sbFavOpen: true,
    sbPagesOpen: true,
    sbSecClosed: {},
    sbLastSection: ''
  };

  K.prefs = {
    all: function () {
      var p = U.lsGet(PREFS_KEY, {}) || {};
      var out = {};
      for (var k in DEFAULTS) {
        if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) {
          var d = DEFAULTS[k];
          out[k] = (typeof d === 'object') ? U.extend({}, d, p[k] || {}) : (p[k] === undefined ? d : p[k]);
        }
      }
      return out;
    },
    get: function (k) { return K.prefs.all()[k]; },
    set: function (k, v) {
      var p = U.lsGet(PREFS_KEY, {}) || {};
      p[k] = v;
      U.lsSet(PREFS_KEY, p);
    }
  };
})(window.Kagoj = window.Kagoj || {});
