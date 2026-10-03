(function (K) {
  'use strict';

  // request({method, url, headers, body, timeout}, cb(err, res))
  // err: null | { type: 'network'|'timeout'|'http', status, message, data }
  // res: { status, data, text, header(name) }
  function request(opts, cb) {
    var xhr = new XMLHttpRequest();
    var done = false;
    var timer = null;
    var timeout = opts.timeout || 15000;

    function finish(err, res) {
      if (done) { return; }
      done = true;
      if (timer) { clearTimeout(timer); }
      cb(err, res);
    }

    try {
      xhr.open(opts.method || 'GET', opts.url, true);
    } catch (e) {
      finish({ type: 'network', status: 0, message: String(e.message || e) });
      return { abort: function () {} };
    }

    var headers = opts.headers || {};
    for (var k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k)) { xhr.setRequestHeader(k, headers[k]); }
    }

    // Own timer: xhr.timeout is unreliable on old WebKit.
    timer = setTimeout(function () {
      try { xhr.abort(); } catch (e) { /* ignore */ }
      finish({ type: 'timeout', status: 0, message: 'Request timed out' });
    }, timeout);

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || done) { return; }
      var status = xhr.status;
      var text = xhr.responseText || '';
      var data = null;
      if (text) {
        try { data = JSON.parse(text); } catch (e) { data = null; }
      }
      var res = {
        status: status,
        text: text,
        data: data,
        header: function (name) { try { return xhr.getResponseHeader(name); } catch (e) { return null; } }
      };
      if (status === 0) {
        finish({ type: 'network', status: 0, message: 'Network error' }, res);
      } else if (status >= 200 && status < 300) {
        finish(null, res);
      } else {
        var msg = (data && (data.msg || data.message || data.error_description || data.error)) || ('HTTP ' + status);
        finish({ type: 'http', status: status, message: String(msg), data: data }, res);
      }
    };

    try {
      if (opts.body !== undefined && opts.body !== null) {
        xhr.send(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
      } else {
        xhr.send();
      }
    } catch (e2) {
      finish({ type: 'network', status: 0, message: String(e2.message || e2) });
    }

    return { abort: function () { try { xhr.abort(); } catch (e) { /* ignore */ } finish({ type: 'abort', status: 0, message: 'aborted' }); } };
  }

  K.xhr = request;
})(window.Kagoj = window.Kagoj || {});
