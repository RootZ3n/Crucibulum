/* Luak — Peh's race engineer journal.
 *
 * Voice: 1920s race engineer. Terse, precise, confident.
 * Owns the journal ring-buffer (localStorage, 50 entries max).
 * app.js creates the drawer UI; this module owns the data and vocabulary.
 *
 *   PehGuide.jot(kind, text)   — add an entry
 *   PehGuide.entries()         — read all entries (newest first)
 *   PehGuide.thinking(n)       — a "hold on" line keyed by integer n
 *   PehGuide.done(n)           — a "here's the result" line
 *   PehGuide.empty(n)          — a "nothing yet" line
 *   PehGuide.fail(n)           — an "engine trouble" line
 */
(function () {
  'use strict';

  var JKEY = 'luak-peh-journal';
  var JMAX = 50;

  var entries = [];
  try { entries = JSON.parse(localStorage.getItem(JKEY) || '[]') || []; } catch (e) { entries = []; }

  function pick(arr, n) { return arr[Math.abs(n || 0) % arr.length]; }

  function jot(kind, text) {
    var entry = { t: new Date().toISOString(), kind: kind, text: text };
    entries.unshift(entry);
    if (entries.length > JMAX) entries.length = JMAX;
    try { localStorage.setItem(JKEY, JSON.stringify(entries)); } catch (e) {}
    if (typeof window.LuakJournalUpdate === 'function') window.LuakJournalUpdate();
  }

  var THINKING = [
    "Hold tight — checking the timing board…",
    "One moment — let me consult the lap charts…",
    "Stand by — I'll run up to the tower…",
    "Just a tick — cross-checking the data…",
  ];
  var DONE = [
    "Here's what the board shows.",
    "Fresh off the timing wire.",
    "The data's come in.",
    "Off the lap sheet — there you are.",
  ];
  var EMPTY = [
    "Nothing on the board for that lane yet.",
    "Clean slate — no data recorded there.",
    "That section of the board is still blank.",
  ];
  var FAIL = [
    "Engine trouble — couldn't reach the back room for that.",
    "That line's down; the backend didn't answer.",
    "Blown a seal somewhere — the server's not responding.",
  ];

  // Seed entries with a boot welcome so the journal isn't empty on first open.
  if (!entries.length) {
    jot('k-peh', "Welcome to the Speedway. I'm Peh — your race engineer. Tap a hotspot on the map to get started, or use Fast Travel (Alt+T) to jump between areas.");
  }

  window.PehGuide = {
    jot:     jot,
    entries: function () { return entries.slice(); },
    thinking: function (n) { return pick(THINKING, n); },
    done:     function (n) { return pick(DONE, n); },
    empty:    function (n) { return pick(EMPTY, n); },
    fail:     function (n) { return pick(FAIL, n); },
  };
})();
