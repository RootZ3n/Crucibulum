/* Luak — LuakScenes (scene metadata) + LuakLanes (benchmark lane data).
 *
 * LuakScenes.all / .get(id) / .match(text) — scene registry lookups for the
 * command bar and fast-travel. LuakLanes.loadLane(tab) — fetches real benchmark
 * data into window.state.laneData[tab] then calls window.render().
 * Triggered by pehLaneBody() when a lane workspace is first opened.
 */
(function () {
  'use strict';

  function pct(n) { return (n === null || n === undefined) ? '—' : Math.round(n) + '%'; }
  function num(n) { return (n === null || n === undefined) ? '—' : String(n); }

  // ── Scene registry (complements SCENE_REGISTRY in index.html) ──────────
  var SCENES = [
    {id:'luak-speedway',  route:'/',          purpose:'Hub / overview',       keywords:['speedway','dashboard','overview','pulse','home']},
    {id:'timing-tower',   route:'/timing',    purpose:'Performance metrics',  keywords:['timing','tower','metric','performance','stat','token','cost']},
    {id:'grandstand',     route:'/results',   purpose:'Final standings',      keywords:['grandstand','result','ranking','leaderboard','standing']},
    {id:'pit-lane',       route:'/pit',       purpose:'Config & tuning',      keywords:['pit','config','tune','provider','model']},
    {id:'racetrack',      route:'/track',     purpose:'Active benchmarks',    keywords:['racetrack','race','track','run','benchmark','active']},
    {id:'victory-circle', route:'/victory',   purpose:'Achievement tracking', keywords:['victory','circle','win','achievement','record']},
    {id:'workshop',       route:'/workshop',  purpose:'Tools & diagnostics',  keywords:['workshop','tool','diagnostic','scorer','judge','adapter','health']}
  ];

  var byId = {};
  SCENES.forEach(function (s) { byId[s.id] = s; });

  window.LuakScenes = {
    all: SCENES,
    get: function (id) { return byId[id] || null; },
    match: function (text) {
      var t = (text || '').toLowerCase();
      for (var i = 0; i < SCENES.length; i++) {
        var kws = SCENES[i].keywords || [];
        for (var j = 0; j < kws.length; j++) {
          if (t.indexOf(kws[j]) !== -1) return SCENES[i].id;
        }
      }
      return null;
    }
  };

  // ── Lane data loading ───────────────────────────────────────────────────
  function api() { return window.LuakAPI || null; }

  // Shape rows from a /api/leaderboard or /api/runs response
  function leaderboardRows(data) {
    var entries = Array.isArray(data) ? data : (data && (data.leaderboard || data.entries || data.rows || data.models || []));
    if (!Array.isArray(entries)) entries = [];
    return entries.slice(0, 40).map(function (e, i) {
      var score = e.score != null ? e.score : e.avg_score;
      return {
        k: (i + 1) + '. ' + (e.model || e.model_id || e.name || e.id || 'unknown'),
        v: score != null ? pct(score) : (e.status || ''),
        cls: i === 0 ? 'ok' : ''
      };
    });
  }

  function runsRows(data, cfg) {
    var runs = Array.isArray(data) ? data : (data && (data.runs || data.items || []));
    if (!Array.isArray(runs)) return [];
    var filtered = runs;
    if (cfg && cfg.taskFamilies && cfg.taskFamilies.length) {
      var filt = runs.filter(function (r) {
        return cfg.taskFamilies.some(function (tf) {
          return (r.task_family || r.taskFamily || r.type || r.family || '').indexOf(tf) !== -1;
        });
      });
      if (filt.length) filtered = filt;
    }
    return filtered.slice(0, 40).map(function (r) {
      var v = r.score != null ? ('Score: ' + pct(r.score))
        : r.status ? ('Status: ' + r.status)
        : r.created_at ? r.created_at : '';
      return {
        k: r.model || r.model_id || r.id || 'run',
        v: v,
        cls: (r.pass || r.status === 'ok' || r.status === 'passed') ? 'ok'
           : (r.status === 'failed' || r.status === 'error') ? 'bad' : ''
      };
    });
  }

  function callApi(tab, cfg) {
    var a = api();
    if (!a) return Promise.reject(new Error('LuakAPI not loaded'));
    if (tab === 'dashboard') return a.benchmarks({ limit: 40 });
    var scFamilies = cfg && cfg.scoreFamilies && cfg.scoreFamilies.length ? cfg.scoreFamilies.join(',') : null;
    var tfFamilies = cfg && cfg.taskFamilies && cfg.taskFamilies.length ? cfg.taskFamilies.join(',') : null;
    if (scFamilies) return a.leaderboard({ score_families: scFamilies, limit: 40 });
    if (tfFamilies) return a.benchmarks({ task_family: tfFamilies, limit: 40 });
    return a.benchmarks({ limit: 40 });
  }

  function shapeRows(tab, cfg, data) {
    if (tab === 'dashboard') return runsRows(data, cfg);
    var rows = leaderboardRows(data);
    if (!rows.length) rows = runsRows(data, cfg);
    return rows;
  }

  function loadLane(tab) {
    var s = window.state;
    var r = window.render;
    if (!s || !r) return;
    var cfg = (window.TAB_CONFIG || {})[tab];
    if (!cfg) return;

    s.laneData[tab] = { status: 'loading' };
    r();

    callApi(tab, cfg)
      .then(function (data) {
        var rows = shapeRows(tab, cfg, data);
        s.laneData[tab] = {
          status: 'loaded',
          rows: rows,
          note: rows.length ? null : 'No race data for this lane yet.'
        };
        r();
      })
      .catch(function (err) {
        s.laneData[tab] = { status: 'error', error: String(err && err.message || err) };
        r();
      });
  }

  window.LuakLanes = { loadLane: loadLane };
})();
