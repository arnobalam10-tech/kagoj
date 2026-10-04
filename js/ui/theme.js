(function (K) {
  'use strict';

  // Fonts and light/dark theme.
  // System fonts need nothing; web fonts (OFL, in /fonts as .woff, which iOS 9
  // supports) are registered the first time they are used.
  var U = K.util;

  var SYS = '-apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';
  var F = [
    // id, name, group, css stack, web font file stem (optional), has bold file
    ['default', 'Default', 'Sans-serif', SYS],
    ['serif', 'Serif', 'Serif', 'Georgia, "Times New Roman", serif'],
    ['mono', 'Mono', 'Monospace', 'Menlo, Consolas, "Courier New", monospace'],
    ['times', 'Times New Roman', 'Serif', '"Times New Roman", Times, serif'],
    ['georgia', 'Georgia', 'Serif', 'Georgia, "Times New Roman", serif'],
    ['garamond', 'Garamond', 'Serif', '"KG EB Garamond", Garamond, "Times New Roman", serif', 'eb-garamond', true],
    ['baskerville', 'Baskerville', 'Serif', 'Baskerville, "Baskerville Old Face", "Times New Roman", serif'],
    ['palatino', 'Palatino', 'Serif', 'Palatino, "Palatino Linotype", "Book Antiqua", serif'],
    ['cambria', 'Cambria', 'Serif', 'Cambria, Georgia, serif'],
    ['bookantiqua', 'Book Antiqua', 'Serif', '"Book Antiqua", Palatino, "Palatino Linotype", serif'],
    ['merriweather', 'Merriweather', 'Serif', '"KG Merriweather", Georgia, serif', 'merriweather', true],
    ['arial', 'Arial', 'Sans-serif', 'Arial, Helvetica, sans-serif'],
    ['helvetica', 'Helvetica', 'Sans-serif', '"Helvetica Neue", Helvetica, Arial, sans-serif'],
    ['calibri', 'Calibri', 'Sans-serif', 'Calibri, "Gill Sans", "Helvetica Neue", Arial, sans-serif'],
    ['verdana', 'Verdana', 'Sans-serif', 'Verdana, Geneva, sans-serif'],
    ['tahoma', 'Tahoma', 'Sans-serif', 'Tahoma, Verdana, Geneva, sans-serif'],
    ['inter', 'Inter', 'Sans-serif', '"KG Inter", ' + SYS, 'inter', true],
    ['roboto', 'Roboto', 'Sans-serif', '"KG Roboto", ' + SYS, 'roboto', true],
    ['opensans', 'Open Sans', 'Sans-serif', '"KG Open Sans", ' + SYS, 'open-sans', true],
    ['courier', 'Courier New', 'Monospace', '"Courier New", Courier, monospace'],
    ['consolas', 'Consolas', 'Monospace', 'Consolas, Menlo, "Courier New", monospace'],
    ['jetbrains', 'JetBrains Mono', 'Monospace', '"KG JetBrains Mono", Menlo, Consolas, monospace', 'jetbrains-mono', true],
    ['comic', 'Comic Sans MS', 'Handwriting', '"Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive'],
    ['caveat', 'Caveat', 'Handwriting', '"KG Caveat", "Chalkboard SE", cursive', 'caveat', true],
    ['patrick', 'Patrick Hand', 'Handwriting', '"KG Patrick Hand", "Chalkboard SE", cursive', 'patrick-hand', false]
  ];

  var Fonts = { list: [], byId: {} };
  F.forEach(function (f) {
    var o = { id: f[0], name: f[1], group: f[2], stack: f[3], file: f[4] || null, bold: !!f[5] };
    Fonts.list.push(o);
    Fonts.byId[o.id] = o;
  });

  var loaded = {};
  function family(stack) { var m = /^"(KG [^"]+)"/.exec(stack); return m ? m[1] : null; }

  // Register the @font-face for a web font the first time it is used.
  Fonts.use = function (id) {
    var f = Fonts.byId[id];
    if (!f || !f.file || loaded[id]) { return; }
    loaded[id] = true;
    var fam = family(f.stack);
    var css = '@font-face{font-family:"' + fam + '";font-weight:400;font-style:normal;src:url(/fonts/' + f.file + '-latin-400-normal.woff) format("woff");}';
    css += '@font-face{font-family:"' + fam + '";font-weight:700;font-style:normal;src:url(/fonts/' + f.file + '-latin-' + (f.bold ? 700 : 400) + '-normal.woff) format("woff");}';
    var s = document.createElement('style');
    s.textContent = css;
    document.getElementsByTagName('head')[0].appendChild(s);
  };

  Fonts.stack = function (id) {
    var f = Fonts.byId[id] || Fonts.byId['default'];
    Fonts.use(f.id);
    return f.stack;
  };

  Fonts.groups = ['Sans-serif', 'Serif', 'Monospace', 'Handwriting'];

  // ---------- theme ----------

  var Theme = {};
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  Theme.mode = function () { return K.prefs.get('theme') || 'light'; };
  Theme.isDark = function () {
    var m = Theme.mode();
    return m === 'dark' || (m === 'system' && !!(mq && mq.matches));
  };
  Theme.apply = function () {
    var on = Theme.isDark();
    document.body.classList.toggle('dark', on);
    document.documentElement.classList.toggle('dark', on);
  };
  Theme.set = function (m) { K.prefs.set('theme', m); Theme.apply(); };
  Theme.toggle = function () { Theme.set(Theme.isDark() ? 'light' : 'dark'); };
  if (mq && mq.addListener) { mq.addListener(function () { Theme.apply(); }); }

  K.Fonts = Fonts;
  K.Theme = Theme;
  U.noop = function () {};
})(window.Kagoj = window.Kagoj || {});
