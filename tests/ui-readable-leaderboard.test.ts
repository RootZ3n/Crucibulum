/**
 * Crucible — readable-leaderboard pins
 *
 * Crucible IS a model-ranking product. The leaderboard rows must show
 * the full model id (or wrap it) — never collapse `deepseek/deepseek-
 * v4-pro` into `deepseek/de…`. These pins enforce minimum column
 * widths, kill single-line ellipsis on desktop, and require the full
 * id to be available via the `title` attribute (operator hover).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HTML = readFileSync(join(process.cwd(), 'ui', 'index.html'), 'utf-8');
const CSS = readFileSync(join(process.cwd(), 'ui', 'crucibulum.css'), 'utf-8');

// Returns true if CSS contains a desktop-context rule for `selector`
// whose model column uses `minmax(Npx, …)` with N ≥ minPx. We accept
// any pixel value ≥ minPx; @media blocks (mobile collapses) don't
// invalidate the test as long as at least one non-@media block has the
// wide floor.
function hasDesktopMinmaxFloor(selector: string, minPx: number): boolean {
  // Allow a fixed width or any non-`}` content before the FIRST
  // minmax — some rows start with a 32-36 px rank/pos column before
  // the model column. The first minmax(Npx, …) is always the model
  // column in our markup, so capturing N gives the model floor.
  const re = new RegExp(`${selector}\\{[^}]*grid-template-columns:[^;}]*?minmax\\(\\s*(\\d+)px`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS)) !== null) {
    if (Number(m[1]) >= minPx) return true;
  }
  return false;
}

describe('Crucible readable leaderboard', () => {
  it('R1 · ranking deck spans full content width (no narrow wrapper)', () => {
    // The deck-ranking-zone sits outside <main class="deck-grid"> and
    // inherits the wide .app-shell.deck-shell width. Confirm the deck
    // CSS does not constrain it to a narrow inner max-width.
    assert.ok(CSS.includes('.deck-ranking-zone'), 'missing .deck-ranking-zone CSS');
    const m = CSS.match(/\.deck-ranking-zone\{[^}]*\}/);
    assert.ok(m, '.deck-ranking-zone rule missing');
    assert.ok(/width:\s*100%/.test(m![0]), '.deck-ranking-zone must be width:100%');
    // And the shell itself is wide
    assert.ok(/\.app-shell\.deck-shell\{[^}]*width:\s*min\(\s*96vw\s*,\s*1760px\s*\)/.test(CSS), 'deck-shell must be wide');
  });

  it('R2 · leaderboard row model name columns have ≥ 260 px minmax floor', () => {
    // Comparison rows (main leaderboard inside renderComparisonBars)
    assert.ok(hasDesktopMinmaxFloor('\\.comparison-row', 260), 'comparison-row model column must have ≥ 260px floor');
    // Ranked rows (Ranked Model Comparison)
    assert.ok(hasDesktopMinmaxFloor('\\.ranked-row', 280), 'ranked-row model column must have ≥ 280px floor');
    // Leader strip (compact variant) — slightly smaller threshold OK,
    // but the second column is a minmax(220px, …) so check that too.
    assert.ok(/\.leader-strip\{[^}]*minmax\(\s*220px/.test(CSS) || hasDesktopMinmaxFloor('\\.leader-strip', 200), 'leader-strip model column must have ≥ 200px floor');
  });

  it('R3 · model name cells are NOT forced into single-line ellipsis on desktop', () => {
    // The override block must allow wrapping; specifically, the last
    // rule for each model-name class must set white-space:normal.
    const checkNormal = (selector: string) => {
      const matches = [...CSS.matchAll(new RegExp(`${selector}\\{[^}]*\\}`, 'g'))];
      assert.ok(matches.length >= 1, `${selector} not found`);
      const lastDecl = matches[matches.length - 1][0];
      assert.ok(/white-space:\s*normal/.test(lastDecl), `${selector} final rule must include white-space:normal`);
      assert.ok(/overflow-wrap:\s*anywhere/.test(lastDecl), `${selector} final rule must include overflow-wrap:anywhere`);
    };
    checkNormal('\\.comparison-model');
    checkNormal('\\.ranked-model');
    checkNormal('\\.ls-model');
  });

  it('R4 · top rank cards (Ranking Deck) wrap to 2-up when names are long', () => {
    // rank-cards must use auto-fit with a generous minmax floor, not
    // a fixed repeat(3, ...) that crushes ids.
    const decls = [...CSS.matchAll(/\.rank-cards\{[^}]*grid-template-columns:\s*([^;}]+)/g)].map(m => m[1]);
    assert.ok(decls.length >= 1, 'rank-cards rule missing');
    const anyOk = decls.some(d => /auto-fit/.test(d) || /minmax\(\s*[2-9]\d\dpx/.test(d));
    assert.ok(anyOk, 'rank-cards must use auto-fit or a ≥ 200px minmax floor');
  });

  it('R5 · score-distribution / side column does NOT shrink leaderboard below readable width', () => {
    // .stage-grid (dashboard) — leaderboard center vs side column.
    // The side column must have a small enough min so it cannot
    // monopolize the row when the leaderboard needs the width.
    // Accept either the desktop block OR the mobile single-column
    // collapse as long as at least one .stage-grid rule biases the
    // leaderboard wider than the side panel.
    const decls = [...CSS.matchAll(/\.stage-grid\{[^}]*grid-template-columns:\s*([^;}]+)/g)].map(m => m[1]);
    assert.ok(decls.length >= 1, 'stage-grid rule missing');
    const hasWideLeader = decls.some(d => /minmax\(0,\s*[2-9](?:\.\d+)?fr\)/.test(d) || /minmax\(0,\s*1\.[5-9]fr\)/.test(d));
    assert.ok(hasWideLeader, 'stage-grid center column must be ≥ 1.5fr so leaderboard wins width over side column');
  });

  it('R6 · full model id is available via title=… attr on leaderboard rows', () => {
    // The renderers wrap each model name in a node that carries
    // title="${esc(model)}", so even a visually shortened cell can
    // be hovered for the full id.
    assert.ok(/<div class="comparison-model"\s+title="\$\{esc\(entry\.model\)\}"/.test(HTML), 'comparison-model missing title= for full id tooltip');
    assert.ok(/<div class="ranked-model"\s+title="\$\{esc\(safeStr\(entry\.model\)\)\}"/.test(HTML), 'ranked-model missing title= for full id tooltip');
    assert.ok(/<span class="winner-model"\s+title="\$\{esc\(winner\.model\)\}"/.test(HTML), 'winner-model (chip) missing title=');
    assert.ok(/<div class="winner-row"\s+title="\$\{esc\(winner\.model\)\}"/.test(HTML), 'winner-row missing title=');
  });

  it('R7 · mobile (≤ 599 px) safely stacks leaderboard rows', () => {
    // The mobile block must collapse comparison-row to a single
    // column so model name gets a full row.
    const phoneBlocks = CSS.split('@media').filter((b) => /max-width:\s*599px/.test(b));
    assert.ok(phoneBlocks.length > 0, 'missing 599px breakpoint');
    const hasStack = phoneBlocks.some((b) => /\.comparison-row\{[^}]*grid-template-columns:\s*1fr/.test(b));
    assert.ok(hasStack, 'no 599px block stacks comparison-row to single column');
    const hasRankedStack = phoneBlocks.some((b) => /\.ranked-row\{[^}]*grid-template-(?:columns|areas)/.test(b));
    assert.ok(hasRankedStack, 'no 599px block restacks ranked-row for phones');
  });
});
