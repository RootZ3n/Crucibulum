/* Luak — API client for the Peh-guide concourse.
 *
 * Talks to Luak's own backend (the Node server that serves this page, default
 * port 18795). Same-origin by default so it works wherever the shell is hosted;
 * override with window.LUAK_API_BASE if the API lives elsewhere.
 *
 * Every call resolves to a plain object — never throws to the caller. Network
 * failures, timeouts and non-2xx responses come back as {ok:false, ...} so the
 * UI can render an honest offline / degraded state instead of crashing. The
 * canonical endpoints here are the REAL ones (/api/models, /api/runs, ...), not
 * the /api/v1/* paths some older docs reference.
 */
(function () {
  'use strict';

  var BASE = (typeof window !== 'undefined' && window.LUAK_API_BASE) || '';
  var TIMEOUT_MS = 8000;

  function request(path, opts) {
    opts = opts || {};
    var url = BASE + path;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || TIMEOUT_MS) : null;
    var init = {
      method: opts.method || 'GET',
      headers: Object.assign({ Accept: 'application/json' }, opts.headers || {}),
      signal: ctrl ? ctrl.signal : undefined,
    };
    if (opts.body !== undefined) {
      init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      init.headers['Content-Type'] = 'application/json';
    }
    var started = Date.now();
    return fetch(url, init).then(function (res) {
      if (timer) clearTimeout(timer);
      var latency = Date.now() - started;
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var msg = (data && (data.error || data.message)) || ('HTTP ' + res.status);
          return { ok: false, status: res.status, error: msg, data: data, latency: latency };
        }
        return { ok: true, status: res.status, data: data, latency: latency };
      });
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      var aborted = err && err.name === 'AbortError';
      return {
        ok: false,
        status: 0,
        offline: true,
        error: aborted ? 'request timed out' : 'cannot reach Luak backend',
        latency: Date.now() - started,
      };
    });
  }

  // ── Endpoint wrappers ──────────────────────────────────────────────────
  // Each returns the request envelope {ok, data, ...}. Callers read `.data`
  // on success and surface `.error` / `.offline` otherwise.

  function qs(params) {
    if (!params) return '';
    var parts = [];
    Object.keys(params).forEach(function (k) {
      if (params[k] === undefined || params[k] === null || params[k] === '') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  var API = {
    base: BASE,
    request: request,

    // Health check — backend reachable + service ok.
    health: function () { return request('/health'); },

    // Certified / available models across all providers.
    models: function () { return request('/api/models'); },
    providers: function () { return request('/api/providers'); },

    // Benchmark results live under /api/runs (a "benchmark" is a run bundle).
    benchmarks: function (params) { return request('/api/runs' + qs(params)); },
    benchmark: function (id) { return request('/api/runs/' + encodeURIComponent(id)); },
    benchmarkSummary: function (id) { return request('/api/runs/' + encodeURIComponent(id) + '/summary'); },

    // Test catalogue + difficulty.
    tasks: function () { return request('/api/tasks'); },
    suites: function () { return request('/api/suites'); },

    // Rankings + aggregate stats (provider/model comparison).
    leaderboard: function (params) { return request('/api/leaderboard' + qs(params)); },
    stats: function (params) { return request('/api/stats' + qs(params)); },

    // Tooling surface.
    scorers: function () { return request('/api/scorers'); },
    judge: function () { return request('/api/judge'); },

    // Agent / adapter status + trust tiers.
    adapters: function () { return request('/api/adapters'); },
    adaptersHealth: function () { return request('/api/health/adapters'); },

    // Launch a benchmark run. Returns the run envelope {id, status, ...}.
    startRun: function (params) {
      return request('/api/runs', { method: 'POST', body: params });
    },

    // Launch a full suite run against a model.
    startSuite: function (params) {
      return request('/api/run-suite', { method: 'POST', body: params });
    },

    // Convenience: resolve a simple connectivity verdict for the status dot.
    probe: function () {
      return API.health().then(function (r) {
        if (r.ok && r.data && (r.data.status === 'ok' || r.data.service)) {
          return { state: 'online', latency: r.latency };
        }
        if (r.offline) return { state: 'offline', error: r.error };
        return { state: 'degraded', error: r.error, status: r.status };
      });
    },
  };

  window.LuakAPI = API;
})();
