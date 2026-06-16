/* Luak — app glue (status dot · journal · command bar).
 *
 * Mounts fixed chrome over the peh-shell using engine classes from
 * crucibulum.css (.peh-status, .peh-jrnl-*, .peh-cmd). Wires:
 *   - Backend status dot: polls LuakAPI.probe() every 15 s
 *   - Journal drawer: surfaces PehGuide.entries() in a slide-over panel
 *   - Command bar: translates free text → scene navigation + lane opening
 *
 * Depends on (loaded before this script): api.js → LuakAPI,
 * scenes.js → LuakScenes / LuakLanes, peh-guide.js → PehGuide.
 */
(function () {
  'use strict';
  if (window.__luakApp) return;
  window.__luakApp = true;

  var API = window.LuakAPI, SC = window.LuakScenes, PG = window.PehGuide;
  if (!API) { console.warn('[luak/app] LuakAPI not loaded'); return; }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function timeAgo(iso) {
    var s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    return Math.round(s / 3600) + 'h ago';
  }

  // ── Status dot ──────────────────────────────────────────────────────────
  var statusEl, statusDot, statusWord, lastConnState = null;

  function buildStatus() {
    statusEl = el('div', 'peh-status peh-status-degraded');
    statusDot = el('span', 'peh-status-dot');
    statusWord = el('span', 'peh-status-word', 'Checking');
    statusEl.appendChild(statusDot);
    statusEl.appendChild(statusWord);
    statusEl.title = 'Luak backend connectivity — port 18795';
    document.body.appendChild(statusEl);
  }

  function applyConnState(state) {
    statusEl.className = 'peh-status peh-status-' + state;
    statusWord.textContent = state === 'online' ? 'Connected'
      : state === 'offline' ? 'Offline' : 'Degraded';
    if (state !== lastConnState && lastConnState !== null && PG) {
      PG.jot('k-ok', 'Backend ' + state);
    }
    lastConnState = state;
  }

  function poll() {
    API.probe().then(function (p) { applyConnState(p.state); });
  }

  // ── Journal drawer ──────────────────────────────────────────────────────
  var jrnlBtn, jrnlDrawer, jrnlOpen = false;

  function buildJournal() {
    jrnlBtn = el('button', 'peh-jrnl-btn', 'Journal');
    jrnlBtn.type = 'button';
    jrnlBtn.title = "Peh's race engineer journal";
    jrnlBtn.setAttribute('aria-label', "Open Peh's journal");
    jrnlBtn.onclick = toggleJournal;
    document.body.appendChild(jrnlBtn);

    jrnlDrawer = el('div', 'peh-jrnl-drawer');
    jrnlDrawer.setAttribute('role', 'dialog');
    jrnlDrawer.setAttribute('aria-label', "Peh's journal");
    jrnlDrawer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(jrnlDrawer);
  }

  function toggleJournal() {
    jrnlOpen = !jrnlOpen;
    jrnlDrawer.setAttribute('aria-hidden', jrnlOpen ? 'false' : 'true');
    jrnlDrawer.classList.toggle('peh-jrnl-open', jrnlOpen);
    if (jrnlOpen) renderJournal();
  }

  function renderJournal() {
    var entries = PG ? PG.entries() : [];
    var rows = entries.map(function (e) {
      return '<div class="peh-jrnl-item ' + esc(e.kind || 'k-peh') + '">' +
        '<span class="peh-jrnl-t">' + esc(timeAgo(e.t)) + '</span>' +
        '<span class="peh-jrnl-text">' + esc(e.text) + '</span>' +
        '</div>';
    }).join('');

    jrnlDrawer.innerHTML =
      '<div class="peh-jrnl-head">' +
        '<span class="peh-jrnl-title">Peh\'s Journal</span>' +
        '<button class="peh-jrnl-close" type="button" aria-label="Close journal">×</button>' +
      '</div>' +
      '<div class="peh-jrnl-body">' +
        (rows || '<p class="peh-jrnl-empty">Nothing logged yet. Go explore a scene!</p>') +
      '</div>' +
      '<div class="peh-jrnl-foot"><span>1920s race engineer voice · ' + entries.length + ' entries</span></div>';

    jrnlDrawer.querySelector('.peh-jrnl-close').onclick = toggleJournal;
  }

  // Called by peh-guide.js when a new entry is added
  window.LuakJournalUpdate = function () { if (jrnlOpen) renderJournal(); };

  // ── Command bar ─────────────────────────────────────────────────────────
  var cmdWrap, cmdInput;

  function buildCmd() {
    cmdWrap = el('div', 'peh-cmd');
    cmdInput = document.createElement('input');
    cmdInput.type = 'text';
    cmdInput.className = 'peh-cmd-input';
    cmdInput.placeholder = 'Go to a scene or open a lane — e.g. "pit lane", "show benchmark", "racetrack"';
    cmdInput.setAttribute('aria-label', 'Command bar — navigate or query');
    var submitBtn = el('button', 'peh-cmd-submit', 'Go');
    submitBtn.type = 'button';
    submitBtn.onclick = function () { runCommand(cmdInput.value); };
    cmdInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { runCommand(cmdInput.value); }
      if (e.key === 'Escape') { cmdInput.value = ''; cmdInput.blur(); }
    });
    cmdWrap.appendChild(cmdInput);
    cmdWrap.appendChild(submitBtn);
    document.body.appendChild(cmdWrap);
  }

  // Map command text → scene id or lane tab
  function runCommand(text) {
    text = (text || '').trim();
    if (!text) return;
    cmdInput.value = '';
    if (PG) PG.jot('k-you', text);

    var low = text.toLowerCase();

    // Fast travel toggle
    if (low === 'fast travel' || low === 'travel' || low === 'ft') {
      if (window.pehToggleFastTravel) pehToggleFastTravel();
      return;
    }
    // Dashboard mode
    if (low === 'dashboard') {
      if (window.pehSetMode) pehSetMode('dashboard');
      return;
    }
    // Immersive mode
    if (low === 'immersive' || low === 'map') {
      if (window.pehSetMode) pehSetMode('immersive');
      return;
    }
    // Try to match a workspace
    var wsId = matchWorkspace(low);
    if (wsId) {
      if (window.pehOpenWorkspace) pehOpenWorkspace(wsId);
      if (PG) PG.jot('k-data', 'Opened workspace: ' + wsId);
      return;
    }
    // Try to match a scene from LuakScenes
    var sceneId = SC ? SC.match(text) : null;
    if (sceneId) {
      if (window.pehGoScene) pehGoScene(sceneId);
      if (PG) PG.jot('k-move', 'Navigated to ' + sceneId);
      return;
    }
    // Unknown
    if (PG) PG.jot('k-warn', 'Didn\'t recognise: "' + text + '" — try a scene name or lane');
  }

  var WORKSPACE_KEYWORDS = {
    'console':        ['dashboard', 'overview', 'console', 'all windows'],
    'launch-control': ['launch', 'pit', 'run', 'start', 'model', 'select'],
    'leaderboard-ws': ['leaderboard', 'grandstand', 'ranking', 'standings', 'board'],
    'race-results':   ['race results', 'racetrack', 'results', 'runs', 'history'],
    'records-ws':     ['records', 'victory', 'best', 'achievements', 'top scores'],
    'diagnostics-ws': ['diagnostics', 'workshop', 'health', 'provider', 'adapter', 'diagnose'],
    'timing-ws':      ['timing', 'performance', 'latency', 'score breakdown', 'metrics']
  };

  function matchWorkspace(low) {
    var ids = Object.keys(WORKSPACE_KEYWORDS);
    for (var i = 0; i < ids.length; i++) {
      var kws = WORKSPACE_KEYWORDS[ids[i]];
      for (var j = 0; j < kws.length; j++) {
        if (low.indexOf(kws[j]) !== -1) return ids[i];
      }
    }
    return null;
  }

  // ── Boot ────────────────────────────────────────────────────────────────
  function start() {
    buildStatus();
    buildJournal();
    buildCmd();
    poll();
    setInterval(poll, 15000);
    window.addEventListener('online', poll);
    window.addEventListener('offline', poll);
    // Load the full dashboard data now that all scripts are available
    if (window.loadDashboard) {
      setTimeout(function () { loadDashboard(); }, 200);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.LuakConcourse = { command: runCommand };
})();
