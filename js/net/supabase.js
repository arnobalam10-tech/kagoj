(function (K) {
  'use strict';

  // All Supabase traffic goes through this file (PRD §23: isolate API changes).
  var U = K.util;
  var SESSION_KEY = 'kagoj.session';
  var sb = U.emitter({});
  var session = U.lsGet(SESSION_KEY, null);
  var refreshing = false;
  var waiters = [];

  function base() { return K.config.supabaseUrl; }

  function authHeaders() {
    return { apikey: K.config.anonKey, 'Content-Type': 'application/json' };
  }

  function nowSec() { return Math.floor(Date.now() / 1000); }

  function saveSession(data, email) {
    // expires_at is computed from expires_in and the device clock so a wrong
    // iPad clock cannot make every token look expired (or never expired).
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: nowSec() + (data.expires_in || 3600),
      email: email || (data.user && data.user.email) || (session && session.email) || '',
      user_id: (data.user && data.user.id) || (session && session.user_id) || ''
    };
    U.lsSet(SESSION_KEY, session);
  }

  function clearSession() {
    session = null;
    U.lsDel(SESSION_KEY);
  }

  sb.isLoggedIn = function () { return !!(session && session.refresh_token); };
  sb.email = function () { return session ? session.email : ''; };
  sb.userId = function () { return session ? session.user_id : ''; };

  sb.normalizeLogin = function (name) {
    name = String(name || '').replace(/^\s+|\s+$/g, '').toLowerCase();
    if (name && name.indexOf('@') < 0) { name = name + '@' + K.config.usernameDomain; }
    return name;
  };

  sb.describeError = function (err) {
    if (!err) { return ''; }
    if (err.type === 'network' || err.type === 'timeout') {
      if (navigator.onLine === false) { return 'No internet connection'; }
      return 'Can’t reach server (certificate or network problem)';
    }
    if (err.status === 400 || err.status === 401) {
      var code = err.data && (err.data.error_code || err.data.error);
      if (code === 'invalid_credentials' || code === 'invalid_grant' || /invalid login/i.test(err.message)) {
        return 'Wrong email or password';
      }
      if (code === 'email_not_confirmed') { return 'This account’s email is not confirmed yet'; }
    }
    if (err.status === 429) { return 'Too many attempts. Wait a minute and try again.'; }
    if (err.status >= 500) { return 'The server had a problem (' + err.status + '). Try again later.'; }
    return err.message || 'Something went wrong';
  };

  sb.login = function (login, password, cb) {
    var email = sb.normalizeLogin(login);
    K.xhr({
      method: 'POST',
      url: base() + '/auth/v1/token?grant_type=password',
      headers: authHeaders(),
      body: { email: email, password: password },
      timeout: 20000
    }, function (err, res) {
      if (err) { cb(err); return; }
      saveSession(res.data, email);
      K.log('login ok');
      sb.emit('login');
      cb(null);
    });
  };

  function flushWaiters(err) {
    var list = waiters;
    waiters = [];
    for (var i = 0; i < list.length; i++) { list[i](err, session ? session.access_token : null); }
  }

  // Single in-flight refresh; concurrent callers wait in line.
  sb.refresh = function (cb) {
    if (!session || !session.refresh_token) {
      cb({ type: 'auth', status: 401, message: 'Not logged in' });
      return;
    }
    waiters.push(cb);
    if (refreshing) { return; }
    refreshing = true;
    K.xhr({
      method: 'POST',
      url: base() + '/auth/v1/token?grant_type=refresh_token',
      headers: authHeaders(),
      body: { refresh_token: session.refresh_token },
      timeout: 20000
    }, function (err, res) {
      refreshing = false;
      if (err) {
        if (err.status === 400 || err.status === 401 || err.status === 403) {
          K.log.warn('refresh rejected: ' + err.message);
          clearSession();
          sb.emit('authlost');
          flushWaiters({ type: 'auth', status: 401, message: 'Session expired' });
        } else {
          flushWaiters(err);
        }
        return;
      }
      saveSession(res.data);
      flushWaiters(null);
    });
  };

  sb.getToken = function (cb) {
    if (!session) { cb({ type: 'auth', status: 401, message: 'Not logged in' }); return; }
    if (session.expires_at - nowSec() > 60) { cb(null, session.access_token); return; }
    sb.refresh(cb);
  };

  // rest(method, pathAndQuery, {body, prefer, timeout}, cb(err, data, res))
  sb.rest = function (method, path, opts, cb) {
    opts = opts || {};
    var retried = false;
    function attempt() {
      sb.getToken(function (err, token) {
        if (err) { cb(err); return; }
        var h = {
          apikey: K.config.anonKey,
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        };
        if (opts.prefer) { h.Prefer = opts.prefer; }
        K.xhr({
          method: method,
          url: base() + '/rest/v1/' + path,
          headers: h,
          body: opts.body,
          timeout: opts.timeout || 15000
        }, function (err2, res) {
          if (err2 && err2.status === 401 && !retried) {
            retried = true;
            sb.refresh(function (e3) {
              if (e3) { cb(e3); return; }
              attempt();
            });
            return;
          }
          if (err2) { cb(err2, null, res); return; }
          cb(null, res.data, res);
        });
      });
    }
    attempt();
  };

  // ---------- Storage (bucket "uploads") ----------

  function encPath(p) { return p.split('/').map(encodeURIComponent).join('/'); }

  function withToken(cb, fn) {
    sb.getToken(function (err, token) {
      if (err) { cb(err); return; }
      fn(token);
    });
  }

  sb.storageUpload = function (path, blob, contentType, cb, onProgress) {
    withToken(cb, function (token) {
      K.xhr({
        method: 'POST',
        url: base() + '/storage/v1/object/uploads/' + encPath(path),
        headers: {
          apikey: K.config.anonKey, Authorization: 'Bearer ' + token,
          'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000'
        },
        body: blob, raw: true, timeout: 120000, onProgress: onProgress
      }, function (err) { cb(err || null); });
    });
  };

  // cb(err, blob)
  sb.storageDownload = function (path, cb) {
    withToken(cb, function (token) {
      K.xhr({
        method: 'GET',
        url: base() + '/storage/v1/object/authenticated/uploads/' + encPath(path),
        headers: { apikey: K.config.anonKey, Authorization: 'Bearer ' + token },
        responseType: 'blob', timeout: 60000
      }, function (err, res) {
        if (err) { cb(err); return; }
        cb(null, res.data);
      });
    });
  };

  sb.storageRemove = function (paths, cb) {
    if (!paths.length) { cb(null); return; }
    withToken(cb, function (token) {
      K.xhr({
        method: 'DELETE',
        url: base() + '/storage/v1/object/uploads',
        headers: { apikey: K.config.anonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: { prefixes: paths }, timeout: 30000
      }, function (err) { cb(err || null); });
    });
  };

  // Temporary link to a private file (opens in a new tab)
  sb.storageSign = function (path, cb) {
    withToken(cb, function (token) {
      K.xhr({
        method: 'POST',
        url: base() + '/storage/v1/object/sign/uploads/' + encPath(path),
        headers: { apikey: K.config.anonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: { expiresIn: 3600 }, timeout: 20000
      }, function (err, res) {
        if (err) { cb(err); return; }
        var u = res.data && (res.data.signedURL || res.data.signedUrl);
        if (!u) { cb({ type: 'http', status: 500, message: 'No link' }); return; }
        cb(null, base() + '/storage/v1' + (u.charAt(0) === '/' ? u : '/' + u));
      });
    });
  };

  // Call one of Kagoj's Supabase Edge Functions as the logged-in user
  sb.fn = function (name, body, cb) {
    withToken(cb, function (token) {
      K.xhr({
        method: 'POST',
        url: base() + '/functions/v1/' + name,
        headers: { apikey: K.config.anonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: body, timeout: 25000
      }, function (err, res) { cb(err || null, res ? res.data : null); });
    });
  };

  sb.rpc = function (name, args, cb) {
    sb.rest('POST', 'rpc/' + name, { body: args }, cb);
  };

  sb.logout = function (cb) {
    var token = session && session.access_token;
    clearSession();
    sb.emit('logout');
    if (!token) { if (cb) { cb(null); } return; }
    K.xhr({
      method: 'POST',
      url: base() + '/auth/v1/logout',
      headers: { apikey: K.config.anonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: '{}',
      timeout: 10000
    }, function () { if (cb) { cb(null); } });
  };

  K.sb = sb;
})(window.Kagoj = window.Kagoj || {});
