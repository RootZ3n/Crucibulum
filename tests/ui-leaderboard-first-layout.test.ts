/**
 * Crucible — leaderboard-first layout pins
 *
 * Crucible's product purpose is "which model is winning right now". The
 * Ranking Deck must sit ABOVE the Active Arena (not buried below run
 * controls) and the command card inside the arena must stack
 * vertically so long model names and run buttons cannot clip.
 *
 * Nine required pins (section I of the leaderboard-first spec) plus
 * tactical guards.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, 'ui', 'index.html'), 'utf-8');
const CSS = readFileSync(join(ROOT, 'ui', 'crucibulum.css'), 'utf-8');

function locate(needle: string): number {
  const idx = HTML.indexOf(needle);
  assert.ok(idx > 0, `expected to find "${needle}" in render output`);
  return idx;
}

describe('Crucible leaderboard-first layout', () => {
  it('I1 · Ranking Deck appears before Active Arena in DOM order', () => {
    // Both markers only appear inside render()'s composed innerHTML —
    // substring index ordering proves the DOM order without having to
    // extract the exact template literal (template-literal extraction
    // is fragile across reformat).
    const rankingIdx = HTML.indexOf('deck-ranking-zone');
    const arenaIdx = HTML.indexOf('deck-rail-center');
    assert.ok(rankingIdx > 0, 'HTML does not include deck-ranking-zone');
    assert.ok(arenaIdx > 0, 'HTML does not include deck-rail-center');
    assert.ok(rankingIdx < arenaIdx, `ranking zone (${rankingIdx}) must precede arena (${arenaIdx}) in render output`);
  });

  it('I2 · model selector lives inside the Active Arena command card, not in the right rail', () => {
    // The model multi-select is emitted by renderLaneCommandTop which
    // is invoked from renderLane (the arena center). The right rail
    // composer (renderEvidenceDeck) must not emit a MODELS · ARMED label.
    assert.ok(/function renderLaneCommandTop[\s\S]{0,4000}MODELS\s*·\s*\$\{modelCount\}\s*ARMED/.test(HTML), 'model selector not emitted by command card');
    const evDeck = HTML.match(/function renderEvidenceDeck\(\)\s*\{[\s\S]*?\}/);
    assert.ok(evDeck, 'renderEvidenceDeck not found');
    assert.ok(!/MODELS\s*·\s*\$\{modelCount\}/.test(evDeck![0]), 'right rail must not host the model selector');
    // And the command card uses the new vertical stack class.
    assert.ok(HTML.includes('class="command-card-stack"') || HTML.includes('command-card-stack'), 'missing command-card-stack vertical layout');
  });

  it('I3 · run controls appear AFTER the model selector inside the command card', () => {
    const card = HTML.match(/function renderLaneCommandTop\(tabKey\)\s*\{[\s\S]*?return\s*`([\s\S]*?)`;\s*\}/);
    assert.ok(card, 'renderLaneCommandTop body not found');
    const tpl = card![1];
    const modelsIdx = tpl.indexOf('cc-models');
    const actionsIdx = tpl.indexOf('cc-actions');
    assert.ok(modelsIdx > -1 && actionsIdx > -1, 'cc-models / cc-actions sections missing');
    assert.ok(modelsIdx < actionsIdx, 'run controls must come AFTER the model selector');
  });

  it('I4 · long model/provider/bundle names have wrap safety in ranking + arena chrome', () => {
    // Rank cards
    assert.ok(/\.rank-model\{[^}]*overflow-wrap:\s*anywhere/.test(CSS), 'rank-model missing overflow-wrap:anywhere');
    assert.ok(/\.rank-sub\{[^}]*overflow-wrap:\s*anywhere/.test(CSS), 'rank-sub missing overflow-wrap:anywhere');
    // Model select dropdown wraps
    assert.ok(/\.cc-model-field\s+\.select\.cc-model-select\s+option\{[^}]*white-space:\s*normal/.test(CSS), 'model select options do not wrap');
    // Already-fixed rail values keep wrapping
    assert.ok(CSS.includes('overflow-wrap:anywhere'), 'bay/evidence/gate values lost wrap safety');
  });

  it('I5 · primary action buttons can wrap (no fixed widths, action-grid responsive)', () => {
    assert.ok(CSS.includes('.action-grid'), 'missing .action-grid CSS');
    assert.ok(/\.action-grid\{[^}]*grid-template-columns:\s*repeat\(auto-fit/.test(CSS), 'action-grid must be auto-fit responsive');
    assert.ok(/\.action-grid\s+\.button\{[^}]*white-space:\s*normal/.test(CSS), 'action-grid buttons must wrap');
  });

  it('I6 · desktop layout puts a Model Leaderboard section at the top', () => {
    assert.ok(HTML.includes('function renderRankingDeck'), 'missing renderRankingDeck function');
    assert.ok(HTML.includes('Model Leaderboard'), 'missing "Model Leaderboard" label');
    assert.ok(CSS.includes('.ranking-deck'), 'missing .ranking-deck CSS');
    assert.ok(CSS.includes('.rank-cards'), 'missing .rank-cards CSS');
  });

  it('I7 · mobile keeps Model Leaderboard before deep analytics', () => {
    // The grid is single-column on mobile; the ranking zone is rendered
    // BEFORE the <main class="deck-grid"> block, so it stays above the
    // arena / right rail / evidence feed in mobile flow.
    const rankIdx = HTML.indexOf('deck-ranking-zone');
    const mainIdx = HTML.indexOf('class="deck-grid"');
    const floorIdx = HTML.indexOf('deck-floor');
    assert.ok(rankIdx > -1 && mainIdx > -1 && floorIdx > -1, 'render() missing one of: ranking, main grid, floor');
    assert.ok(rankIdx < mainIdx && rankIdx < floorIdx, 'ranking zone must precede main grid and evidence feed on every viewport');
  });

  it('I8 · the command card does not hide overflow on the model selector or actions', () => {
    // The command card itself must be overflow:visible so the multi-
    // select and the action grid are never clipped.
    assert.ok(/\.command-card\{[^}]*overflow:\s*visible/.test(CSS), 'command-card must use overflow:visible');
    // And the model select fills full width.
    assert.ok(/\.cc-model-field\s+\.select\.cc-model-select\{[\s\S]*width:\s*100%/.test(CSS), 'model select must be width:100%');
  });

  it('I9 · report directory exists for the leaderboard-first layout pass', () => {
    const reports = readdirSync(join(ROOT, 'reports', 'ui-redesign'));
    assert.ok(reports.includes('crucible-leaderboard-first-layout'), 'reports/ui-redesign/crucible-leaderboard-first-layout/ directory missing');
    const files = readdirSync(join(ROOT, 'reports', 'ui-redesign', 'crucible-leaderboard-first-layout'));
    const hasMd = files.some((f) => f.endsWith('.md'));
    const hasShot = files.some((f) => f.endsWith('-desktop-wide.png')) && files.some((f) => f.endsWith('-mobile.png'));
    assert.ok(hasMd, 'report markdown missing');
    assert.ok(hasShot, 'desktop + mobile screenshots missing from report directory');
  });

  describe('tactical guards', () => {
    it('ranking deck shows top 3 cards from aggregateLeaderboard', () => {
      assert.ok(/renderRankingDeck[\s\S]{0,1500}aggregateLeaderboard\(tabKey,\s*3\)/.test(HTML), 'ranking deck must request top 3 from aggregateLeaderboard');
    });

    it('champion card is visually distinct', () => {
      assert.ok(CSS.includes('.rank-card.champion'), 'missing champion variant CSS');
      assert.ok(HTML.includes("rank===1?'champion':''"), 'champion class not applied to rank #1');
    });

    it('Active Arena restacks tests, routing, cert, models, runcount, actions in that order', () => {
      const card = HTML.match(/function renderLaneCommandTop\(tabKey\)\s*\{[\s\S]*?return\s*`([\s\S]*?)`;\s*\}/)![1];
      const order = ['cc-tests','cc-routing','cc-cert','cc-models','cc-runcount','cc-actions'];
      let last = -1;
      for (const cls of order) {
        const idx = card.indexOf(cls);
        assert.ok(idx > last, `${cls} must come after the previous section in the stack`);
        last = idx;
      }
    });

    it('mobile (<900px) collapses ranking to a single column', () => {
      // There are multiple @media (max-width:899px) blocks in the
      // cascade. Confirm at least one of them contains the rank-cards
      // single-column rule by scanning every 899px block, not just the
      // first one .find() returns.
      const blocks = CSS.split('@media').filter((b) => /max-width:\s*899px/.test(b));
      assert.ok(blocks.length > 0, 'no 899px breakpoint block');
      const hasSingleCol = blocks.some((b) => /\.rank-cards\{[^}]*grid-template-columns:\s*1fr/.test(b));
      assert.ok(hasSingleCol, 'rank-cards must collapse to single column in at least one 899px @media block');
    });

    it('Open Full Leaderboard affordance scrolls to existing comparison chart', () => {
      assert.ok(/Open Full Leaderboard[\s\S]{0,200}\.comparison-chart/.test(HTML) || HTML.includes("scrollIntoView"), 'Open Full Leaderboard must scroll to the existing leaderboard');
    });
  });
});
