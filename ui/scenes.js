/* Luak — scene → backend wiring for the Peh-guide concourse.
 *
 * The seven scenes here mirror SCENE_REGISTRY.luak in index.html EXACTLY (same
 * ids, titles and Peh greetings — the 1920s speedway doctrine). Each scene adds
 * a small set of actions; an action pulls REAL data from LuakAPI and returns a
 * normalized result the HUD renders:
 *   { note?:string, rows?:[{k,v,cls?}], empty?:string, error?:string }
 *
 * Run-backed scenes (racetrack / grandstand / timing / victory) depend on
 * /api/runs; when that endpoint errors the action returns {error} and the HUD
 * shows it plainly rather than pretending there's data.
 */
(function () {
  'use strict';

  function pct(n) { return (n === null || n === undefined) ? '—' : Math.round(n) + '%'; }
  function num(n) { return (n === null || n === undefined) ? '—' : String(n); }
  function fail(r) { return r.offline ? 'Backend offline — ' + (r.error || 'unreachable') : (r.error || ('HTTP ' + r.status)); }

  // Pull the run list once; shared by several scenes. Returns {runs} or {error}.
  function loadRuns(api, limit) {
    return api.benchmarks({ limit: limit || 25 }).then(function (r) {
      if (!r.ok) return { error: fail(r) };
      var runs = (r.data && r.data.runs) || [];
      return { runs: runs };
    });
  }

  var SCENES = [
    {
      id: 'speedway', title: 'The Speedway', purpose: 'Dashboard / overview',
      greeting: "Welcome to the Speedway! This is where we keep an eye on everything at a glance.",
      blurb: "The heart of Luak — a bird's-eye view of the whole operation: what's reachable, what's loaded, what's running.",
      actions: [
        { id: 'pulse', label: 'Check the pulse', run: function (api) {
          return Promise.all([api.health(), api.models(), api.adapters()]).then(function (res) {
            var h = res[0], m = res[1], a = res[2];
            var rows = [];
            rows.push({ k: 'Backend', v: h.ok ? 'online' : fail(h), cls: h.ok ? 'ok' : 'bad' });
            if (h.ok && h.data) rows.push({ k: 'Uptime', v: Math.round(h.data.uptime || 0) + 's' });
            if (m.ok) rows.push({ k: 'Models', v: num((m.data.models || []).length) });
            if (a.ok) {
              var ad = a.data.adapters || [];
              var up = ad.filter(function (x) { return x.available; }).length;
              rows.push({ k: 'Adapters', v: up + ' / ' + ad.length + ' available' });
            }
            return { rows: rows };
          });
        } },
      ],
    },
    {
      id: 'racetrack', title: 'The Racetrack', purpose: 'Active benchmarks',
      greeting: "Right this way — the track's where models get put through their paces!",
      blurb: "Where the cars race. Active and recent benchmark runs, lap after lap, with their live scores.",
      actions: [
        { id: 'runs', label: 'Show recent runs', run: function (api) {
          return loadRuns(api, 12).then(function (r) {
            if (r.error) return { error: r.error };
            if (!r.runs.length) return { empty: 'No benchmark runs recorded yet.' };
            return { note: r.runs.length + ' recent runs', rows: r.runs.slice(0, 10).map(function (run) {
              return { k: (run.model || '?') + ' · ' + (run.task_id || run.family || '?'),
                v: pct(run.score) + (run.pass ? ' ✓' : ' ✗'), cls: run.pass ? 'ok' : 'bad' };
            }) };
          });
        } },
        { id: 'tasks', label: 'What can we run?', run: function (api) {
          return api.tasks().then(function (r) {
            if (!r.ok) return { error: fail(r) };
            var tasks = (r.data.tasks || []);
            return { note: tasks.length + ' tasks available', rows: tasks.slice(0, 10).map(function (t) {
              return { k: t.display_name || t.title || t.id, v: t.difficulty || '—' };
            }) };
          });
        } },
      ],
    },
    {
      id: 'results-table', title: 'The Results Table', purpose: 'Filterable / sortable runs',
      greeting: "Want the whole board at once? Here's every run — slice it however you like.",
      blurb: "Every recorded run in one table. Filter by model family, adapter/provider, task lane or verdict, set cost and latency thresholds, and sort any column.",
      actions: [
        { id: 'open-table', label: 'Open results table', run: function (api) {
          // Pull a deep slice (server returns all; the cap is just a ceiling)
          // and hand the raw rows to the interactive table renderer in app.js.
          // No client-side .slice cap here — filtering/sorting/paging all happen
          // live in the table, over the full set.
          return loadRuns(api, 1000).then(function (r) {
            if (r.error) return { error: r.error };
            if (!r.runs.length) return { empty: 'No runs to tabulate yet.' };
            return { table: { runs: r.runs } };
          });
        } },
      ],
    },
    {
      id: 'grandstand', title: 'The Grandstand', purpose: 'Results & rankings',
      greeting: "Take a seat up here — best view in the house for the results.",
      blurb: "Where the spectators watch. Final standings and who took the flag.",
      actions: [
        { id: 'board', label: 'View the leaderboard', run: function (api) {
          return api.leaderboard({ limit: 10 }).then(function (r) {
            if (!r.ok) return { error: fail(r) };
            var rows = (r.data.leaderboard || r.data.rows || r.data.entries || []);
            if (!rows.length) return { empty: 'No ranked results yet.' };
            return { note: 'Top ' + Math.min(rows.length, 10), rows: rows.slice(0, 10).map(function (e, i) {
              return { k: (i + 1) + '. ' + (e.model || e.model_id || e.name || '?'),
                v: pct(e.score != null ? e.score : e.avg_score) };
            }) };
          });
        } },
        { id: 'recent', label: 'Latest finishes', run: function (api) {
          return loadRuns(api, 8).then(function (r) {
            if (r.error) return { error: r.error };
            if (!r.runs.length) return { empty: 'No finishes recorded.' };
            return { rows: r.runs.slice(0, 8).map(function (run) {
              return { k: run.model || '?', v: pct(run.score), cls: run.pass ? 'ok' : 'bad' };
            }) };
          });
        } },
      ],
    },
    {
      id: 'timing-tower', title: 'The Timing Tower', purpose: 'Performance metrics',
      greeting: "Up in the tower, we measure every tenth of a second. Precision wins races.",
      blurb: "Where the times are recorded — throughput, tokens, cost. The clock never lies.",
      actions: [
        { id: 'stats', label: 'Read the metrics', run: function (api) {
          return api.stats().then(function (r) {
            if (!r.ok) return { error: fail(r) };
            var s = r.data || {};
            var rows = [];
            if (s.total_runs != null) rows.push({ k: 'Total runs', v: num(s.total_runs) });
            if (s.pass_rate != null) rows.push({ k: 'Pass rate', v: pct(s.pass_rate) });
            if (s.avg_score != null) rows.push({ k: 'Avg score', v: pct(s.avg_score) });
            if (s.total_tokens != null) rows.push({ k: 'Total tokens', v: num(s.total_tokens) });
            if (s.total_cost_usd != null) rows.push({ k: 'Total cost', v: '$' + Number(s.total_cost_usd).toFixed(2) });
            if (!rows.length) return { empty: 'No metrics aggregated yet.' };
            return { rows: rows };
          });
        } },
      ],
    },
    {
      id: 'pit-lane', title: 'The Pit Lane', purpose: 'Configuration & tuning',
      greeting: "The pit's where we tune the machine. Every adjustment counts.",
      blurb: "Where the cars are serviced. Providers, models and the knobs behind a run.",
      actions: [
        { id: 'providers', label: 'List providers', run: function (api) {
          return api.providers().then(function (r) {
            if (!r.ok) return { error: fail(r) };
            var provs = (r.data.providers || r.data || []);
            if (!Array.isArray(provs)) provs = provs.providers || [];
            if (!provs.length) return { empty: 'No providers configured.' };
            return { note: provs.length + ' providers', rows: provs.slice(0, 12).map(function (p) {
              return { k: p.name || p.id, v: (p.kind || p.type || '') + (p.available === false ? ' · offline' : ''),
                cls: p.available === false ? 'bad' : 'ok' };
            }) };
          });
        } },
        { id: 'models', label: 'Available models', run: function (api) {
          return api.models().then(function (r) {
            if (!r.ok) return { error: fail(r) };
            var models = (r.data.models || []);
            return { note: models.length + ' models', rows: models.slice(0, 12).map(function (m) {
              return { k: m.name || m.id, v: (m.provider || '') + (m.available ? '' : ' · offline'),
                cls: m.available ? 'ok' : 'bad' };
            }) };
          });
        } },
      ],
    },
    {
      id: 'victory-circle', title: 'The Victory Circle', purpose: 'Achievement tracking',
      greeting: "This is what it's all about. Every win, every record — right here.",
      blurb: "Where the winners celebrate — the passing runs and records that held up under trial.",
      actions: [
        { id: 'wins', label: 'Show the winners', run: function (api) {
          return loadRuns(api, 40).then(function (r) {
            if (r.error) return { error: r.error };
            var wins = r.runs.filter(function (x) { return x.pass; });
            if (!wins.length) return { empty: 'No passing runs to celebrate yet.' };
            return { note: wins.length + ' passing runs', rows: wins.slice(0, 10).map(function (run) {
              return { k: run.model || '?', v: pct(run.score) + ' ✓', cls: 'ok' };
            }) };
          });
        } },
      ],
    },
    {
      id: 'workshop', title: 'The Workshop', purpose: 'Tools & diagnostics',
      greeting: "My workshop. Tools, diagnostics, and a lot of elbow grease.",
      blurb: "Where the mechanics work — scorers, the judge, and adapter health for the whole fleet.",
      actions: [
        { id: 'scorers', label: 'Inspect the tools', run: function (api) {
          return api.scorers().then(function (r) {
            if (!r.ok) return { error: fail(r) };
            var sc = (r.data.scorers || []);
            return { note: sc.length + ' scorers loaded', rows: sc.slice(0, 12).map(function (s) {
              return { k: s.id || s.name, v: s.kind || s.type || 'scorer' };
            }) };
          });
        } },
        { id: 'fleet', label: 'Adapter health', run: function (api) {
          return api.adaptersHealth().then(function (r) {
            if (!r.ok) return { error: fail(r) };
            var ad = (r.data.adapters || []);
            return { rows: ad.slice(0, 12).map(function (a) {
              var circuit = a.circuit && a.circuit.state ? a.circuit.state : (a.available ? 'closed' : 'open');
              return { k: a.name || a.id, v: a.available ? circuit : 'unavailable',
                cls: a.available && circuit !== 'open' ? 'ok' : 'bad' };
            }) };
          });
        } },
      ],
    },
  ];

  var byId = {};
  SCENES.forEach(function (s) { byId[s.id] = s; });

  window.LuakScenes = {
    all: SCENES,
    get: function (id) { return byId[id] || null; },
    // keyword → scene id, for the natural-language command bar.
    match: function (text) {
      var t = (text || '').toLowerCase();
      var table = [
        ['results-table', ['results table', 'result table', 'table', 'filter', 'sortable', 'browse runs', 'all runs', 'grid']],
        ['speedway', ['speedway', 'dashboard', 'overview', 'pulse', 'home']],
        ['racetrack', ['racetrack', 'race', 'track', 'run', 'benchmark', 'active']],
        ['grandstand', ['grandstand', 'result', 'ranking', 'leaderboard', 'standing']],
        ['timing-tower', ['timing', 'tower', 'metric', 'performance', 'stat', 'token', 'cost']],
        ['pit-lane', ['pit', 'config', 'tune', 'provider', 'model']],
        ['victory-circle', ['victory', 'circle', 'win', 'achievement', 'record']],
        ['workshop', ['workshop', 'tool', 'diagnostic', 'scorer', 'judge', 'adapter', 'health']],
      ];
      for (var i = 0; i < table.length; i++) {
        var kws = table[i][1];
        for (var j = 0; j < kws.length; j++) { if (t.indexOf(kws[j]) !== -1) return table[i][0]; }
      }
      return null;
    },
  };
})();
