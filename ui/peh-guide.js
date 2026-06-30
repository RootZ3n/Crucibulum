/* Luak — Peh the guide.
 *
 * Peh is the racing-squirrel host of the concourse (he/him). This module owns
 * his figure, his speech bubble, and the row of action buttons he offers at
 * each scene. It knows nothing about the network — app.js feeds it a scene and
 * a callback; Peh greets, describes the place, and surfaces the actions.
 *
 * Visual classes (pc-*) are defined once in app.js's injected stylesheet.
 */
(function () {
  'use strict';

  // A few stock lines so Peh feels alive between scripted greetings. He/him.
  var THINKING = [
    "Let me go grab that for you…",
    "One sec — checking the board…",
    "Hold tight, I'll run and look…",
  ];
  var DONE = [
    "Here's what I found.",
    "There you go.",
    "Fresh off the wire.",
  ];
  var EMPTY_LINES = [
    "Nothing on the board for that one yet.",
    "Hm — that shelf's empty right now.",
  ];
  var ERROR_LINES = [
    "Engine trouble — I couldn't reach the back room for that.",
    "That line's down right now; the backend didn't answer.",
  ];

  function pick(arr, seed) { return arr[Math.abs(seed || 0) % arr.length]; }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function create(host) {
    var root = el('div', 'pc-peh');
    var fig = el('div', 'pc-peh-fig');
    var img = document.createElement('img');
    img.src = (typeof window !== 'undefined' && typeof window.pehMascotSrc === 'function')
      ? window.pehMascotSrc()
      : 'assets/peh-vintage-racer-squirrel.png';
    img.alt = 'Peh, your guide';
    img.className = 'pc-peh-img';
    img.onerror = function () { fig.classList.add('pc-peh-fallback'); fig.textContent = '🐿️'; };
    fig.appendChild(img);

    var col = el('div', 'pc-peh-col');
    var bubble = el('div', 'pc-bubble');
    var name = el('div', 'pc-peh-name', 'Peh');
    var blurb = el('div', 'pc-peh-blurb');
    var actions = el('div', 'pc-actions');

    col.appendChild(name);
    col.appendChild(bubble);
    col.appendChild(blurb);
    col.appendChild(actions);
    root.appendChild(fig);
    root.appendChild(col);
    host.appendChild(root);

    var actionCb = null;
    var seed = 0;

    function say(text) { bubble.textContent = text; }

    function greet(scene) {
      seed++;
      root.classList.remove('pc-hidden');
      say(scene.greeting || ("Welcome to " + scene.title + "."));
      blurb.textContent = scene.blurb || scene.purpose || '';
      actions.innerHTML = '';
      (scene.actions || []).forEach(function (a) {
        var btn = el('button', 'pc-act-btn', a.label);
        btn.type = 'button';
        btn.onclick = function () { if (actionCb) actionCb(scene, a); };
        actions.appendChild(btn);
      });
      if (!(scene.actions || []).length) {
        actions.appendChild(el('div', 'pc-peh-dim', 'Just passing through — nothing to fetch here.'));
      }
    }

    return {
      root: root,
      greet: greet,
      say: say,
      thinking: function () { root.classList.add('pc-busy'); say(pick(THINKING, ++seed)); },
      done: function (n) {
        root.classList.remove('pc-busy');
        if (n === 0) say(pick(EMPTY_LINES, ++seed));
        else say(pick(DONE, ++seed));
      },
      error: function () { root.classList.remove('pc-busy'); say(pick(ERROR_LINES, ++seed)); },
      onAction: function (cb) { actionCb = cb; },
      setBusyHint: function (label) { root.classList.add('pc-busy'); say("Fetching " + label.toLowerCase() + "…"); },
      hide: function () { root.classList.add('pc-hidden'); },
    };
  }

  window.PehGuide = { create: create };
})();
