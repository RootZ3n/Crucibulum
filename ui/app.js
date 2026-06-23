/* Luak — Peh-guide concourse (additive HUD).
 *
 * Mounts a fixed dock over the existing speedway shell: a backend status dot, a
 * natural-language command bar, a scene launcher, a result panel Peh fills with
 * REAL backend data, and "Peh's Journal" of recent activity. Everything is
 * additive and namespaced (pc-*) — it reuses LuakAPI / LuakScenes / PehGuide and
 * never touches the existing world-map machinery.
 *
 * Backend data is same-origin: it only resolves when this page is served by the
 * Luak Node server (where /api/* lives). Static-only hosts show the offline dot.
 */
(function () {
  'use strict';
  if (window.__luakConcourse) return; // idempotent
  window.__luakConcourse = true;

  var API = window.LuakAPI, SC = window.LuakScenes, PG = window.PehGuide;
  if (!API || !SC || !PG) { console.warn('[concourse] missing api/scenes/peh modules'); return; }

  // ── Journal (ring buffer, persisted) ───────────────────────────────────
  var JKEY = 'luak-peh-journal', JMAX = 40;
  function journalLoad() { try { return JSON.parse(localStorage.getItem(JKEY)) || []; } catch (e) { return []; } }
  var journal = journalLoad();
  function jot(icon, text) {
    journal.unshift({ t: new Date().toISOString(), icon: icon, text: text });
    if (journal.length > JMAX) journal.length = JMAX;
    try { localStorage.setItem(JKEY, JSON.stringify(journal)); } catch (e) {}
    if (journalOpen) renderJournal();
  }

  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; return n; }
  function timeAgo(iso) {
    var s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return s + 's ago'; if (s < 3600) return Math.round(s / 60) + 'm ago'; return Math.round(s / 3600) + 'h ago';
  }

  // ── Styles ─────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('pc-styles')) return;
    var css = [
      '.pc-dock{position:fixed;left:0;right:0;bottom:0;z-index:9000;display:flex;gap:10px;align-items:center;padding:8px 12px;background:rgba(12,10,26,.92);backdrop-filter:blur(10px);border-top:1px solid rgba(139,92,246,.35);font-family:var(--body,system-ui)}',
      '.pc-status{display:flex;align-items:center;gap:7px;flex-shrink:0;font-size:var(--text-xs,11px);text-transform:uppercase;letter-spacing:.06em;font-weight:700;color:var(--ink-dim,#9b8ec4)}',
      '.pc-dot{width:9px;height:9px;border-radius:50%;background:var(--ink-dim,#9b8ec4)}',
      '.pc-online .pc-dot{background:var(--cyan,#22d3ee);box-shadow:0 0 8px rgba(34,211,238,.7)}.pc-online{color:var(--cyan,#22d3ee)}',
      '.pc-offline .pc-dot{background:var(--red,#ef4444);box-shadow:0 0 8px rgba(239,68,68,.7);animation:pcPulse 1.2s ease-in-out infinite}.pc-offline{color:var(--red,#ef4444)}',
      '.pc-degraded .pc-dot{background:var(--amber,#f59e0b)}.pc-degraded{color:var(--amber,#f59e0b)}',
      '@keyframes pcPulse{0%,100%{opacity:1}50%{opacity:.35}}',
      '.pc-cmd{flex:1 1 auto;display:flex;gap:6px;min-width:0}',
      '.pc-cmd input{flex:1 1 auto;min-width:0;background:rgba(34,28,72,.6);border:1px solid rgba(139,92,246,.3);color:var(--ink,#f0eaff);border-radius:12px;padding:8px 12px;font-size:var(--text-sm,13px);font-family:inherit}',
      '.pc-cmd input:focus{outline:none;border-color:var(--cyan,#22d3ee)}',
      '.pc-btn{background:rgba(139,92,246,.18);border:1px solid rgba(139,92,246,.4);color:var(--ink,#f0eaff);border-radius:12px;padding:8px 12px;font-size:var(--text-xs,11px);font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit}',
      '.pc-btn:hover{background:rgba(139,92,246,.32);border-color:var(--violet-hot,#a78bfa)}',
      '.pc-panel{position:fixed;right:12px;bottom:60px;width:min(420px,calc(100vw - 24px));max-height:62vh;overflow:auto;z-index:9000;background:rgba(19,15,40,.97);border:1px solid rgba(139,92,246,.4);border-radius:var(--radius-lg,20px);box-shadow:0 18px 60px rgba(0,0,0,.55);padding:14px;display:none}',
      '.pc-panel.pc-show{display:block}',
      '.pc-peh{display:flex;gap:12px;align-items:flex-start}.pc-hidden{display:none}',
      '.pc-peh-fig{width:64px;height:64px;flex-shrink:0;border-radius:50%;overflow:hidden;background:rgba(139,92,246,.15);display:flex;align-items:center;justify-content:center;font-size:30px;border:2px solid rgba(139,92,246,.5)}',
      '.pc-peh-img{width:100%;height:100%;object-fit:cover}.pc-peh-fallback{font-size:32px}',
      '.pc-peh-col{flex:1 1 auto;min-width:0}',
      '.pc-peh-name{font-weight:800;color:var(--violet-hot,#a78bfa);font-size:var(--text-xs,11px);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px}',
      '.pc-bubble{background:rgba(34,28,72,.7);border:1px solid rgba(139,92,246,.3);border-radius:12px;padding:8px 11px;color:var(--ink,#f0eaff);font-size:var(--text-sm,13px);line-height:1.4}',
      '.pc-busy .pc-bubble{opacity:.7}',
      '.pc-peh-blurb{color:var(--ink-dim,#9b8ec4);font-size:var(--text-xs,11px);margin:6px 0 8px;line-height:1.4}',
      '.pc-peh-dim{color:var(--ink-dim,#9b8ec4);font-size:var(--text-xs,11px);font-style:italic}',
      '.pc-actions{display:flex;flex-wrap:wrap;gap:6px}',
      '.pc-act-btn{background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.35);color:var(--cyan-hot,#67e8f9);border-radius:10px;padding:6px 10px;font-size:var(--text-xs,11px);font-weight:600;cursor:pointer;font-family:inherit}',
      '.pc-act-btn:hover{background:rgba(34,211,238,.2)}',
      '.pc-result{margin-top:12px;border-top:1px solid rgba(139,92,246,.2);padding-top:10px}',
      '.pc-note{color:var(--ink-soft,#d4cafe);font-size:var(--text-xs,11px);margin-bottom:6px;font-weight:600}',
      '.pc-row{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid rgba(139,92,246,.1);font-size:var(--text-sm,13px)}',
      '.pc-row .pc-k{color:var(--ink-soft,#d4cafe);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.pc-row .pc-v{color:var(--ink,#f0eaff);font-weight:600;flex-shrink:0}',
      '.pc-row .ok{color:var(--teal,#34d399)}.pc-row .bad{color:var(--red,#ef4444)}',
      '.pc-msg{color:var(--ink-dim,#9b8ec4);font-size:var(--text-sm,13px);font-style:italic}',
      '.pc-msg.bad{color:var(--amber,#f59e0b);font-style:normal}',
      '.pc-jrow{display:flex;gap:8px;padding:7px 0;border-bottom:1px solid rgba(139,92,246,.12);font-size:var(--text-xs,11px)}',
      '.pc-jrow .pc-jt{color:var(--ink-dim,#9b8ec4);flex-shrink:0;width:62px}',
      '.pc-ph{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}',
      '.pc-ph h3{margin:0;font-size:var(--text-sm,13px);color:var(--ink,#f0eaff);font-weight:800;text-transform:uppercase;letter-spacing:.05em}',
      '.pc-x{background:none;border:none;color:var(--ink-dim,#9b8ec4);cursor:pointer;font-size:18px;line-height:1;padding:0 4px}',
      // Results table — the panel widens (.pc-wide) so the grid has room.
      '.pc-panel.pc-wide{width:min(880px,calc(100vw - 24px))}',
      '.pc-tfbar{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:10px}',
      '.pc-tf{display:flex;flex-direction:column;gap:3px;font-size:var(--text-xs,11px);color:var(--ink-dim,#9b8ec4);text-transform:uppercase;letter-spacing:.04em;font-weight:700}',
      '.pc-tf select,.pc-tf input{background:rgba(34,28,72,.6);border:1px solid rgba(139,92,246,.3);color:var(--ink,#f0eaff);border-radius:8px;padding:5px 8px;font-size:var(--text-sm,13px);font-family:inherit;min-width:92px}',
      '.pc-tf input{width:84px}',
      '.pc-treset{align-self:flex-end;padding:6px 10px}',
      '.pc-tscroll{overflow:auto;max-height:42vh;border:1px solid rgba(139,92,246,.18);border-radius:10px}',
      '.pc-table{border-collapse:collapse;width:100%;font-size:var(--text-xs,12px)}',
      '.pc-table th,.pc-table td{padding:6px 9px;text-align:left;white-space:nowrap;border-bottom:1px solid rgba(139,92,246,.12)}',
      '.pc-th{position:sticky;top:0;background:rgba(24,18,52,.98);color:var(--ink-soft,#d4cafe);cursor:pointer;user-select:none;font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:var(--text-xs,11px)}',
      '.pc-th:hover{color:var(--cyan,#22d3ee)}.pc-th.pc-sorted{color:var(--violet-hot,#a78bfa)}',
      '.pc-table td{color:var(--ink,#f0eaff)}',
      '.pc-trbad td{opacity:.85}',
      '.pc-vok{color:var(--teal,#34d399);font-weight:700}.pc-vbad{color:var(--red,#ef4444);font-weight:700}',
      '.pc-tempty{color:var(--ink-dim,#9b8ec4);font-style:italic;text-align:center;padding:14px}',
      '@media(max-width:640px){.pc-status .pc-word{display:none}.pc-panel{right:6px;left:6px;width:auto}.pc-panel.pc-wide{width:auto}}',
    ].join('\n');
    var style = el('style'); style.id = 'pc-styles'; style.textContent = css; document.head.appendChild(style);
  }

  // ── DOM ────────────────────────────────────────────────────────────────
  var dock, statusEl, wordEl, input, panel, pehHost, resultEl, journalEl, peh;
  var journalOpen = false;

  function build() {
    injectStyles();
    dock = el('div', 'pc-dock');
    statusEl = el('div', 'pc-status pc-degraded');
    statusEl.appendChild(el('span', 'pc-dot'));
    wordEl = el('span', 'pc-word', 'Checking');
    statusEl.appendChild(wordEl);
    statusEl.title = 'Luak backend connectivity';

    var cmd = el('div', 'pc-cmd');
    input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Ask Peh… e.g. "show recent runs", "list models", "leaderboard"';
    input.setAttribute('aria-label', 'Command bar');
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') runCommand(input.value); });
    var go = el('button', 'pc-btn', 'Ask'); go.onclick = function () { runCommand(input.value); };
    cmd.appendChild(input); cmd.appendChild(go);

    var jbtn = el('button', 'pc-btn', "Peh's Journal"); jbtn.onclick = toggleJournal;
    var hbtn = el('button', 'pc-btn', 'Scenes'); hbtn.onclick = function () { openScene(SC.get('speedway')); };

    dock.appendChild(statusEl); dock.appendChild(cmd); dock.appendChild(hbtn); dock.appendChild(jbtn);
    document.body.appendChild(dock);

    panel = el('div', 'pc-panel');
    pehHost = el('div'); panel.appendChild(pehHost);
    resultEl = el('div', 'pc-result'); panel.appendChild(resultEl);
    document.body.appendChild(panel);

    journalEl = el('div', 'pc-panel'); document.body.appendChild(journalEl);

    peh = PG.create(pehHost);
    peh.onAction(onAction);

    // keep page content clear of the fixed dock
    document.body.style.paddingBottom = '64px';
  }

  // ── Behaviour ──────────────────────────────────────────────────────────
  function showPanel() { panel.classList.add('pc-show'); }
  function openScene(scene) {
    if (!scene) return;
    journalEl.classList.remove('pc-show'); journalOpen = false;
    panel.classList.remove('pc-wide');
    resultEl.innerHTML = '';
    peh.greet(scene);
    showPanel();
    jot('🗺️', 'Visited ' + scene.title);
  }

  function onAction(scene, action) {
    peh.setBusyHint(action.label);
    resultEl.innerHTML = '';
    Promise.resolve(action.run(API)).then(function (res) {
      res = res || {};
      if (res.error) { peh.error(); panel.classList.remove('pc-wide'); renderMessage(res.error, true); jot('⚠️', scene.title + ': ' + action.label + ' failed'); return; }
      if (res.empty) { peh.done(0); panel.classList.remove('pc-wide'); renderMessage(res.empty, false); jot('📋', scene.title + ': ' + action.label + ' (empty)'); return; }
      if (res.table) {
        var n = (res.table.runs || []).length;
        peh.done(n);
        renderTable(res.table);
        jot('📊', scene.title + ': ' + action.label + ' (' + n + ' runs)');
        return;
      }
      panel.classList.remove('pc-wide');
      var rows = res.rows || [];
      peh.done(rows.length);
      renderResult(res);
      jot('✅', scene.title + ': ' + action.label + ' (' + rows.length + ')');
    }).catch(function (err) {
      peh.error(); renderMessage('Something went sideways: ' + String(err), true);
    });
  }

  function renderResult(res) {
    resultEl.innerHTML = '';
    if (res.note) resultEl.appendChild(el('div', 'pc-note', res.note));
    (res.rows || []).forEach(function (r) {
      var row = el('div', 'pc-row');
      row.appendChild(el('span', 'pc-k', escapeHtml(String(r.k))));
      row.appendChild(el('span', 'pc-v ' + (r.cls || ''), escapeHtml(String(r.v))));
      resultEl.appendChild(row);
    });
  }
  function renderMessage(msg, bad) { resultEl.innerHTML = ''; resultEl.appendChild(el('div', 'pc-msg ' + (bad ? 'bad' : ''), escapeHtml(msg))); }
  function escapeHtml(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ── Results table (filterable / sortable) ───────────────────────────────
  // Derive a coarse "model family" from a model id so runs can be grouped:
  //   openai/gpt-4o-mini -> gpt   ·  gemma3:27b -> gemma  ·  claude-3.5 -> claude
  function modelFamily(model) {
    var m = String(model || '').toLowerCase();
    if (!m || m === '?') return 'unknown';
    var tail = m.indexOf('/') !== -1 ? m.slice(m.lastIndexOf('/') + 1) : m;
    var token = tail.split(/[:@]/)[0];          // drop ":tag" / "@ver"
    token = token.replace(/[-_.]?v?\d.*$/, ''); // drop trailing version/size
    token = token.replace(/[-_].*$/, '');       // keep first word of remainder
    return token || tail || 'unknown';
  }
  function provOf(r) { return r.provider || r.adapter || '?'; }
  function num(v, d) { return (v === null || v === undefined || isNaN(v)) ? d : Number(v); }
  function distinct(arr) { var seen = {}; var out = []; arr.forEach(function (v) { if (v && !seen[v]) { seen[v] = 1; out.push(v); } }); out.sort(); return out; }

  function renderTable(table) {
    panel.classList.add('pc-wide');
    var runs = (table.runs || []).map(function (r) {
      return {
        model: r.model || '?', family: modelFamily(r.model), prov: provOf(r),
        lane: r.family || r.task_id || '?', verdict: r.verdict || (r.pass ? 'pass' : 'fail'),
        pass: !!r.pass, score: num(r.score, 0),
        cost: num(r.total_cost_usd != null ? r.total_cost_usd : r.cost_usd, 0),
        latency: num(r.duration_sec, 0), ts: r.timestamp || '',
        task: r.task_id || '', disagree: !!(r.disagreement || r.howa_disagreement),
      };
    });

    var st = { mFam: '', prov: '', lane: '', verdict: '', maxCost: '', maxLat: '', sortKey: 'ts', sortDir: -1 };

    function apply() {
      var rows = runs.filter(function (r) {
        if (st.mFam && r.family !== st.mFam) return false;
        if (st.prov && r.prov !== st.prov) return false;
        if (st.lane && r.lane !== st.lane) return false;
        if (st.verdict && r.verdict !== st.verdict) return false;
        if (st.maxCost !== '' && r.cost > Number(st.maxCost)) return false;
        if (st.maxLat !== '' && r.latency > Number(st.maxLat)) return false;
        return true;
      });
      rows.sort(function (a, b) {
        var k = st.sortKey, av = a[k], bv = b[k];
        if (k === 'ts') { av = new Date(a.ts || 0).getTime(); bv = new Date(b.ts || 0).getTime(); }
        if (typeof av === 'string') { return st.sortDir * String(av).localeCompare(String(bv)); }
        return st.sortDir * ((av || 0) - (bv || 0));
      });
      return rows;
    }

    function selOf(label, key, opts) {
      var wrap = el('label', 'pc-tf');
      wrap.appendChild(el('span', null, label));
      var sel = document.createElement('select');
      sel.appendChild(new Option('all', ''));
      opts.forEach(function (o) { sel.appendChild(new Option(o, o)); });
      sel.value = st[key];
      sel.onchange = function () { st[key] = sel.value; draw(); };
      wrap.appendChild(sel);
      return wrap;
    }
    function numOf(label, key, ph) {
      var wrap = el('label', 'pc-tf');
      wrap.appendChild(el('span', null, label));
      var inp = document.createElement('input');
      inp.type = 'number'; inp.min = '0'; inp.step = 'any'; inp.placeholder = ph; inp.value = st[key];
      inp.oninput = function () { st[key] = inp.value; draw(); };
      wrap.appendChild(inp);
      return wrap;
    }

    var COLS = [
      { k: 'model', t: 'Model' }, { k: 'family', t: 'Family' }, { k: 'prov', t: 'Provider' },
      { k: 'lane', t: 'Lane' }, { k: 'verdict', t: 'Verdict' }, { k: 'score', t: 'Score' },
      { k: 'cost', t: 'Cost' }, { k: 'latency', t: 'Latency' }, { k: 'ts', t: 'When' },
    ];

    function draw() {
      var rows = apply();
      resultEl.innerHTML = '';

      var bar = el('div', 'pc-tfbar');
      bar.appendChild(selOf('Model family', 'mFam', distinct(runs.map(function (r) { return r.family; }))));
      bar.appendChild(selOf('Provider', 'prov', distinct(runs.map(function (r) { return r.prov; }))));
      bar.appendChild(selOf('Lane', 'lane', distinct(runs.map(function (r) { return r.lane; }))));
      bar.appendChild(selOf('Verdict', 'verdict', distinct(runs.map(function (r) { return r.verdict; }))));
      bar.appendChild(numOf('Max cost $', 'maxCost', 'any'));
      bar.appendChild(numOf('Max latency s', 'maxLat', 'any'));
      var reset = el('button', 'pc-btn pc-treset', 'Reset');
      reset.onclick = function () { st.mFam = st.prov = st.lane = st.verdict = ''; st.maxCost = st.maxLat = ''; draw(); };
      bar.appendChild(reset);
      resultEl.appendChild(bar);

      resultEl.appendChild(el('div', 'pc-note', rows.length + ' of ' + runs.length + ' runs'));

      var scroll = el('div', 'pc-tscroll');
      var tbl = el('table', 'pc-table');
      var thead = el('thead'); var htr = el('tr');
      COLS.forEach(function (c) {
        var th = el('th', 'pc-th' + (st.sortKey === c.k ? ' pc-sorted' : ''));
        th.textContent = c.t + (st.sortKey === c.k ? (st.sortDir === 1 ? ' ▲' : ' ▼') : '');
        th.onclick = function () {
          if (st.sortKey === c.k) st.sortDir = -st.sortDir; else { st.sortKey = c.k; st.sortDir = (c.k === 'ts' || c.k === 'score') ? -1 : 1; }
          draw();
        };
        htr.appendChild(th);
      });
      thead.appendChild(htr); tbl.appendChild(thead);

      var tb = el('tbody');
      if (!rows.length) {
        var er = el('tr'); var ec = el('td'); ec.colSpan = COLS.length; ec.className = 'pc-tempty';
        ec.textContent = 'No runs match these filters.'; er.appendChild(ec); tb.appendChild(er);
      }
      rows.forEach(function (r) {
        var tr = el('tr', r.pass ? '' : 'pc-trbad');
        function td(txt, cls) { var c = el('td', cls || ''); c.textContent = txt; tr.appendChild(c); }
        td(r.model); td(r.family); td(r.prov); td(r.lane);
        var vtxt = (r.verdict || '').toUpperCase() + (r.disagree ? ' ⚑' : '');
        td(vtxt, r.pass ? 'pc-vok' : 'pc-vbad');
        td(Math.round(r.score) + '%');
        td(r.cost ? ('$' + (r.cost < 0.01 ? r.cost.toFixed(4) : r.cost.toFixed(2))) : 'free');
        td(r.latency ? (r.latency + 's') : '—');
        td(r.ts ? timeAgo(r.ts) : '—');
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      scroll.appendChild(tbl);
      resultEl.appendChild(scroll);
    }

    draw();
  }

  function runCommand(text) {
    text = (text || '').trim();
    if (!text) return;
    input.value = '';
    jot('💬', 'You: ' + text);
    var low = text.toLowerCase();
    if (low === 'help' || low === '?') {
      openScene(SC.get('speedway'));
      peh.say("Tell me where to go: speedway, racetrack, grandstand, timing tower, pit lane, victory circle, or workshop. Or ask for runs, models, leaderboard, metrics, or health.");
      return;
    }
    if (low.indexOf('journal') !== -1) { toggleJournal(); return; }
    var sceneId = SC.match(text);
    if (!sceneId) {
      openScene(SC.get('speedway'));
      peh.say("Didn't quite catch that — try \"" + ['recent runs', 'list models', 'leaderboard', 'metrics', 'adapter health'][text.length % 5] + "\", or a place like the Pit Lane.");
      return;
    }
    var scene = SC.get(sceneId);
    openScene(scene);
    // If the phrasing also points at a specific action, run it straight away.
    var act = bestAction(scene, low);
    if (act) setTimeout(function () { onAction(scene, act); }, 150);
  }

  function bestAction(scene, low) {
    var hits = (scene.actions || []).filter(function (a) {
      return a.label.toLowerCase().split(/\s+/).some(function (w) { return w.length > 3 && low.indexOf(w) !== -1; });
    });
    return hits[0] || null;
  }

  // ── Journal panel ──────────────────────────────────────────────────────
  function toggleJournal() {
    journalOpen = !journalOpen;
    if (journalOpen) { panel.classList.remove('pc-show'); renderJournal(); journalEl.classList.add('pc-show'); }
    else journalEl.classList.remove('pc-show');
  }
  function renderJournal() {
    journalEl.innerHTML = '';
    var head = el('div', 'pc-ph');
    head.appendChild(el('h3', null, "Peh's Journal"));
    var x = el('button', 'pc-x', '×'); x.onclick = toggleJournal; head.appendChild(x);
    journalEl.appendChild(head);
    if (!journal.length) { journalEl.appendChild(el('div', 'pc-msg', 'Nothing logged yet. Go explore a scene!')); return; }
    journal.forEach(function (e) {
      var row = el('div', 'pc-jrow');
      row.appendChild(el('span', 'pc-jt', timeAgo(e.t)));
      row.appendChild(el('span', null, (e.icon || '•') + ' ' + escapeHtml(e.text)));
      journalEl.appendChild(row);
    });
  }

  // ── Status polling ─────────────────────────────────────────────────────
  var lastState = null;
  function poll() {
    API.probe().then(function (p) {
      statusEl.className = 'pc-status pc-' + p.state;
      wordEl.textContent = p.state === 'online' ? 'Connected' : p.state === 'offline' ? 'Offline' : 'Degraded';
      if (p.state !== lastState) {
        if (lastState !== null) jot(p.state === 'online' ? '🟢' : '🔴', 'Backend ' + p.state);
        lastState = p.state;
      }
    });
  }

  function start() {
    build();
    poll();
    setInterval(poll, 15000);
    window.addEventListener('online', poll);
    window.addEventListener('offline', poll);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.LuakConcourse = { open: function (id) { openScene(SC.get(id)); }, command: runCommand };
})();
