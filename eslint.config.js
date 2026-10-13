// Lint rules for Kagoj frontend code. The house style is still plain
// var/function code on window.Kagoj, but modern browsers are the target now
// (iPad mini 6, desktop), so newer syntax and APIs are allowed.
var browserGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
  localStorage: 'readonly', indexedDB: 'readonly', XMLHttpRequest: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  console: 'readonly', screen: 'readonly', Image: 'readonly', JSON: 'readonly', Math: 'readonly',
  Date: 'readonly', encodeURIComponent: 'readonly', decodeURIComponent: 'readonly',
  parseInt: 'readonly', parseFloat: 'readonly', isNaN: 'readonly', isFinite: 'readonly',
  Error: 'readonly', Object: 'readonly', Array: 'readonly', String: 'readonly', Number: 'readonly',
  Boolean: 'readonly', RegExp: 'readonly', Uint8Array: 'readonly', Float32Array: 'readonly',
  fetch: 'readonly', Promise: 'readonly', Map: 'readonly', Set: 'readonly', URL: 'readonly', caches: 'readonly', self: 'readonly'
};

module.exports = [
  {
    files: ['js/**/*.js', 'spike/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: browserGlobals
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-restricted-properties': ['error',
        { property: 'requestFullscreen', message: 'Fullscreen API is forbidden.' }
      ]
    }
  }
];
