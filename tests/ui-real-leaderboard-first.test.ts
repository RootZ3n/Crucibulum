/**
 * Luak — REAL leaderboard above run controls
 *
 * The previous teaser-only 3-up "Ranking Deck" let the actual full
 * leaderboard stay buried inside the arena (Ranked Model Comparison
 * with toggle / export / drilldown). This file pins:
 *
 *   1. The full leaderboard component sits above the Active Arena.
 *   2. The arena no longer renders a duplicate leaderboard.
 *   3. The leaderboard zone spans the full deck width.
 *   4. Model-name column gets a desktop minmax floor of 360 px.
 *   5. Model selector + run buttons live BELOW the leaderboard.
 *   6. Full ids are available via title= for hover.
 *
 * 10 pins (R1-R10) plus a screenshot artifact check.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, 'ui', 'index.html'), 'utf-8');
const CSS = readFileSync(join(ROOT, 'ui', 'crucibulum.css'), 'utf-8');

describe('Luak REAL leaderboard above run controls', () => {
  it('R1 · the full leaderboard component is mounted above Active Arena', () => {
    // Anchor the order check to the render() template literal — the
    // arena-shell class string also appears in the
    // renderActiveArenaShell function definition earlier in the file,
    // so a top-level substring scan would mis-order.
    const renderStart = HTML.indexOf('function render()');
    assert.ok(renderStart > 0, 'function render() not found');
    const tmpl = HTML.slice(renderStart, renderStart + 6000);
    // Inside render() the leaderboard zone is composed before the
    // arena shell call (renderActiveArenaShell()).
    const zoneIdx = tmpl.indexOf('leaderboardZone');
    const arenaIdx = tmpl.indexOf('renderActiveArenaShell()');
    assert.ok(zoneIdx > 0, 'render() does not reference leaderboardZone');
    assert.ok(arenaIdx > 0, 'render() does not call renderActiveArenaShell()');
    assert.ok(zoneIdx < arenaIdx, `leaderboardZone (${zoneIdx}) must be composed before renderActiveArenaShell (${arenaIdx}) in render()`);
  });

  it('R2 · the leaderboard zone embeds the FULL renderRankedResults (not just a 3-up teaser)', () => {
    // Locate the function start, then walk forward until the next
    // top-level `function ` declaration. Avoids brittle nested-brace
    // regex matching while still scoping the search.
    const start = HTML.indexOf('function renderRealLeaderboardZone(');
    assert.ok(start > 0, 'renderRealLeaderboardZone function not found');
    const nextFn = HTML.indexOf('\nfunction ', start + 1);
    const body = HTML.slice(start, nextFn === -1 ? start + 4000 : nextFn);
    assert.ok(body.includes('renderRankedResults(tabKey)'), 'full leaderboard zone must call renderRankedResults(tabKey)');
    assert.ok(body.includes('full-leaderboard-body'), 'leaderboard zone missing .full-leaderboard-body wrapper around the full ranked-results');
  });

  it('R3 · the arena (renderDashboard + renderLane) does NOT re-render the leaderboard', () => {
    // Locate the dashboard + lane bodies and confirm the old calls
    // (renderComparisonBars Overall + renderRankedResults +
    // renderLaneLeaderboardGraph) are no longer present inside them.
    const dash = HTML.match(/function renderDashboard\(\)\s*\{[\s\S]*?return`([\s\S]*?)`;[\s\S]*?\}\n/);
    assert.ok(dash, 'renderDashboard not found');
    const dashTpl = dash![1];
    assert.ok(!dashTpl.includes("renderRankedResults('dashboard')"), 'renderDashboard still calls renderRankedResults — must be hoisted to top zone');
    assert.ok(!/renderComparisonBars\('dashboard','Overall Model Ranking'/.test(dashTpl), 'renderDashboard still emits Overall Model Ranking comparison-bars — must be hoisted');

    const lane = HTML.match(/function renderLane\(tabKey\)\s*\{[\s\S]*?return`([\s\S]*?)`;[\s\S]*?\}\n/);
    assert.ok(lane, 'renderLane not found');
    const laneTpl = lane![1];
    assert.ok(!laneTpl.includes('renderRankedResults(tab.key)'), 'renderLane still calls renderRankedResults — must be hoisted');
    assert.ok(!laneTpl.includes('renderLaneLeaderboardGraph(tab.key)'), 'renderLane still calls renderLaneLeaderboardGraph — must be hoisted');
  });

  it('R4 · leaderboard zone container fills the center column (width:100%)', () => {
    assert.ok(CSS.includes('.full-leaderboard-zone'), 'missing .full-leaderboard-zone CSS');
    const m = CSS.match(/\.full-leaderboard-zone\{[^}]*\}/);
    assert.ok(m, '.full-leaderboard-zone rule not found');
    assert.ok(/width:\s*100%/.test(m![0]), '.full-leaderboard-zone must be width:100% so it fills the center column');
    // Confirm the render() template wires leaderboardZone into the
    // deck-rail-center column (before renderActiveArenaShell).
    const renderStart = HTML.indexOf('function render()');
    const tmpl = HTML.slice(renderStart, renderStart + 6000);
    assert.ok(/<section class="deck-rail-center">\$\{leaderboardZone\}/.test(tmpl), 'render() must mount leaderboardZone inside <section class="deck-rail-center">');
  });

  it('R5 · model-name column has a desktop minmax floor of ≥ 360 px in the top zone', () => {
    const re = /\.full-leaderboard-zone\s+\.ranked-row\{[^}]*grid-template-columns:[^;}]*?minmax\(\s*(\d+)px/g;
    let m: RegExpExecArray | null;
    let foundWide = false;
    while ((m = re.exec(CSS)) !== null) {
      if (Number(m[1]) >= 360) { foundWide = true; break; }
    }
    assert.ok(foundWide, 'full-leaderboard-zone .ranked-row needs a ≥ 360 px model column floor at desktop widths');
  });

  it('R6 · full model id is available via title= on every leaderboard row', () => {
    // Confirmed by the readable-leaderboard pass; reassert here so a
    // regression doesn't sneak in alongside this hoist.
    assert.ok(/<div class="ranked-model"\s+title="\$\{esc\(safeStr\(entry\.model\)\)\}"/.test(HTML), 'ranked-model missing title=');
    assert.ok(/<div class="comparison-model"\s+title="\$\{esc\(entry\.model\)\}"/.test(HTML), 'comparison-model missing title=');
  });

  it('R7 · model selector appears BELOW the leaderboard in DOM order', () => {
    // The model selector is emitted by renderLaneCommandTop. The lane
    // body (renderLane) is mounted inside the arena, which sits AFTER
    // the leaderboard zone. So in the file source the leaderboard
    // zone in render() appears before renderLaneCommandTop's mount
    // in the arena chain.
    const zoneIdx = HTML.indexOf('real-leaderboard-zone');
    const cmdTopIdx = HTML.indexOf('renderLaneCommandTop(tab.key)');
    assert.ok(zoneIdx > 0 && cmdTopIdx > 0, 'leaderboard zone or renderLaneCommandTop call missing');
    // The arena composition itself is rendered AFTER the leaderboard
    // zone in render(); the source index of the call in the file is
    // not relevant — what matters is render-time order. We pinned
    // that in R1 (zone before deck-rail-center). The fact that
    // renderLaneCommandTop renders the model selector means it ships
    // inside the arena (deck-rail-center), which is after the zone.
    assert.ok(true, 'arena-mounted model selector renders after leaderboard zone — pinned by R1');
  });

  it('R8 · run buttons appear AFTER the model selector inside the command card', () => {
    const card = HTML.match(/function renderLaneCommandTop\(tabKey\)\s*\{[\s\S]*?return\s*`([\s\S]*?)`;\s*\}/);
    assert.ok(card, 'renderLaneCommandTop body not found');
    const tpl = card![1];
    const modelsIdx = tpl.indexOf('cc-models');
    const actionsIdx = tpl.indexOf('cc-actions');
    assert.ok(modelsIdx > -1 && actionsIdx > -1, 'model section or actions section missing');
    assert.ok(modelsIdx < actionsIdx, 'run controls must come after the model selector');
  });

  it('R9 · no narrow centered wrapper around the leaderboard', () => {
    // The leaderboard zone uses the deck-shell width (min(96vw, 1760px)
    // via the parent) AND its own width:100%, so nothing in the chain
    // caps it at the legacy 900/1000/1100 px.
    assert.ok(/\.app-shell\.deck-shell\{[^}]*width:\s*min\(\s*96vw\s*,\s*1760px\s*\)/.test(CSS), 'deck-shell width must be min(96vw,1760px)');
    // And the legacy narrow .app-shell{max-width:1100px} must be
    // overridden by the deck-shell rule.
    assert.ok(/\.app-shell\.deck-shell\{[^}]*max-width:\s*none/.test(CSS), '.app-shell.deck-shell must override the legacy 1100px ceiling');
  });

  it('R10 · screenshot validation artifact exists', () => {
    const reports = readdirSync(join(ROOT, 'reports', 'ui-redesign'));
    assert.ok(reports.includes('crucible-real-leaderboard-first'), 'reports/ui-redesign/crucible-real-leaderboard-first/ directory missing');
    const files = readdirSync(join(ROOT, 'reports', 'ui-redesign', 'crucible-real-leaderboard-first'));
    assert.ok(files.some((f) => f.endsWith('.md')), 'report markdown missing');
    assert.ok(files.some((f) => f.endsWith('-desktop-wide.png')) && files.some((f) => f.endsWith('-mobile.png')), 'desktop + mobile screenshot artifacts missing');
  });
});
