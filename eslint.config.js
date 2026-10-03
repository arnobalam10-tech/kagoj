// ES5 contract for Kagoj frontend code (PRD §3.1).
// Parsing with ecmaVersion 5 rejects let/const, arrows, classes, template
// literals, destructuring, spread, for...of, async, generators and modules.
// The restricted globals/properties below catch the forbidden APIs.
var browserGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
  localStorage: 'readonly', indexedDB: 'readonly', XMLHttpRequest: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  console: 'readonly', screen: 'readonly', Image: 'readonly', JSON: 'readonly', Math: 'readonly',
  Date: 'readonly', encodeURIComponent: 'readonly', decodeURIComponent: 'readonly',
  parseInt: 'readonly', parseFloat: 'readonly', isNaN: 'readonly', isFinite: 'readonly',
  Error: 'readonly', Object: 'readonly', Array: 'readonly', String: 'readonly', Number: 'readonly',
  Boolean: 'readonly', RegExp: 'readonly', Uint8Array: 'readonly', Float32Array: 'readonly'
};

module.exports = [
  {
    files: ['js/**/*.js', 'spike/**/*.js'],
    languageOptions: {
      ecmaVersion: 5,
      sourceType: 'script',
      globals: browserGlobals
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-restricted-globals': ['error',
        'fetch', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Proxy', 'Reflect',
        'ResizeObserver', 'IntersectionObserver', 'CompressionStream', 'WebAssembly'],
      'no-restricted-properties': ['error',
        { object: 'Array', property: 'from' },
        { object: 'Array', property: 'of' },
        { object: 'Object', property: 'assign' },
        { object: 'Object', property: 'entries' },
        { object: 'Object', property: 'values' },
        { object: 'navigator', property: 'serviceWorker' },
        { property: 'includes', message: 'Array/String#includes is not in Safari 9. Use indexOf.' },
        { property: 'find', message: 'Array#find is not in Safari 9. Loop instead.' },
        { property: 'findIndex', message: 'Array#findIndex is not in Safari 9.' },
        { property: 'padStart', message: 'Not in Safari 9.' },
        { property: 'padEnd', message: 'Not in Safari 9.' },
        { property: 'startsWith', message: 'Use indexOf === 0 for consistency.' },
        { property: 'requestFullscreen', message: 'Fullscreen API is forbidden.' }
      ]
    }
  }
];
