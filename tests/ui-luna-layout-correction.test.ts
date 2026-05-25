/**
 * Crucible — Luna deck LAYOUT-CORRECTION pins
 *
 * The first Luna pass produced the right colors/panels but laid them
 * out as a narrow centered scroll column. This file pins the corrected
 * desktop command-deck grid so a future cleanup cannot silently revert
 * to mobile-first column thinking.
 *
 * Eight required pins (section J of the layout-correction spec) plus
 * tactical guards.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HTML = readFileSync(join(process.cwd(), 'ui', 'index.html'), 'utf-8');
const CSS = readFileSync(join(process.cwd(), 'ui', 'crucibulum.css'), 'utf-8');

describe('Luna deck layout correction', () => {
  it('L1 · desktop command-deck grid class exists', () => {
    assert.ok(CSS.includes('.deck-grid'), 'missing .deck-grid CSS class');
    assert.ok(CSS.includes('grid-template-columns'), 'deck-grid missing grid-template-columns');
    assert.ok(HTML.includes('class="deck-grid"') || HTML.includes('deck-grid'), 'deck-grid not used in render output');
  });

  it('L2 · desktop layout has left rail + active arena + right rail', () => {
    // The grid uses named areas so the rails are addressable by name,
    // not by source order. All three must exist for the deck to feel
    // like a command deck instead of a centered column.
    assert.ok(/grid-template-areas:\s*"left center right"/.test(CSS), 'desktop grid does not declare left/center/right areas');
    assert.ok(CSS.includes('.deck-rail-left'), 'missing .deck-rail-left');
    assert.ok(CSS.includes('.deck-rail-center'), 'missing .deck-rail-center');
    assert.ok(CSS.includes('.deck-rail-right'), 'missing .deck-rail-right');
  });

  it('L3 · Failure Board, Provider Bay, Evidence Vault, Release Gate are emitted into the right rail', () => {
    // renderEvidenceDeck() composes all four — verify the chain.
    const evDeck = HTML.match(/function renderEvidenceDeck\(\)\s*\{[\s\S]*?return\s*`([^`]+)`/);
    assert.ok(evDeck, 'renderEvidenceDeck composer not found');
    const body = evDeck![1];
    assert.ok(body.includes('renderFailureBoardDeck'), 'Failure Board missing from right rail composer');
    assert.ok(body.includes('renderProviderBayDeck'), 'Provider Bay missing from right rail composer');
    assert.ok(body.includes('renderEvidenceVaultDeck'), 'Evidence Vault missing from right rail composer');
    assert.ok(body.includes('renderReleaseGateDeck'), 'Release Gate missing from right rail composer');
    // And render() mounts the composer into deck-rail-right
    assert.ok(/deck-rail-right[\s\S]*renderEvidenceDeck/.test(HTML), 'right rail does not mount renderEvidenceDeck');
  });

  it('L4 · Evaluation Rooms are emitted into the left rail', () => {
    assert.ok(/deck-rail-left[\s\S]*renderEvaluationRoomsDeck/.test(HTML), 'left rail does not mount renderEvaluationRoomsDeck');
  });

  it('L5 · single-column mobile breakpoint exists', () => {
    // Below 900 px the grid MUST collapse to one column. There are
    // multiple @media (max-width:899px) blocks in the cascade
    // (different concerns); scan ALL of them for a 1fr rule so this
    // test does not break when a new 899px block is added.
    assert.ok(CSS.includes('@media (max-width:899px)') || CSS.includes('@media(max-width:899px)'), 'missing 899px mobile breakpoint');
    const blocks = CSS.split('@media').filter((b) => /max-width:\s*899px/.test(b));
    assert.ok(blocks.length > 0, 'no @media block matching 899px');
    const hasSingleCol = blocks.some((b) => /grid-template-columns:\s*1fr/.test(b));
    assert.ok(hasSingleCol, 'no 899px breakpoint forces single column');
  });

  it('L6 · wide desktop max width uses ≥1500 px or 96vw/1760px formula', () => {
    // Look at the deck-shell width declaration specifically — the
    // legacy .app-shell{max-width:1100px} alone must not apply.
    const m = CSS.match(/\.app-shell\.deck-shell\{[^}]*\}/);
    assert.ok(m, '.app-shell.deck-shell rule missing');
    const decl = m![0];
    const hasWideWidth = /width:\s*min\(\s*96vw\s*,\s*1760px\s*\)/.test(decl)
      || /max-width:\s*(\d+)px/.test(decl) && Number((decl.match(/max-width:\s*(\d+)px/) || [])[1] || 0) >= 1500;
    assert.ok(hasWideWidth, 'deck-shell is not wide (need min(96vw,1760px) or max-width >= 1500px)');
  });

  it('L7 · long provider/model/bundle text has wrapping/ellipsis safety', () => {
    // The corrective rules apply overflow-wrap:anywhere to the value
    // cells so long ids wrap inside the card instead of clipping.
    assert.ok(CSS.includes('overflow-wrap:anywhere'), 'missing overflow-wrap:anywhere safety');
    // Grid children get min-width:0 so they can shrink.
    assert.ok(/\.deck-rail-left\s*>\s*\*[\s\S]*min-width:\s*0/.test(CSS) || /\.deck-rail-right\s*>\s*\*[\s\S]*min-width:\s*0/.test(CSS) || /\.deck-grid\s*>\s*\*[\s\S]*min-width:\s*0/.test(CSS), 'deck rail children missing min-width:0');
    // Cmd-rail chips wrap instead of clipping
    assert.ok(/\.cmd-rail-chips\s*\.chip\{[^}]*white-space:\s*normal/.test(CSS), 'cmd-rail chips do not wrap');
  });

  it('L8 · no primary layout wrapper uses narrow max-width around 900-1000 px for desktop command view', () => {
    // The .app-shell.deck-shell rule must override the legacy
    // .app-shell{max-width:1100px} so the deck view is not constrained.
    const deckRule = CSS.match(/\.app-shell\.deck-shell\{[^}]*\}/)![0];
    assert.ok(/max-width:\s*none/.test(deckRule) || /width:\s*min\(/.test(deckRule), '.app-shell.deck-shell must use width:min(...) or max-width:none to escape the narrow legacy ceiling');
    // And the render() output must apply the deck-shell class.
    assert.ok(HTML.includes('class="app-shell deck-shell"') || HTML.includes('app-shell deck-shell'), 'render() does not apply deck-shell class to the wrapper');
  });

  describe('layout-correction tactical guards', () => {
    it('rails extend to natural content height (uncapped, no internal scroll)', () => {
      // Earlier passes used position:sticky + max-height:calc(100vh-…)
      // to keep rails visible. With Focused Run added to the right
      // rail the cap forced internal rail scrolling — operator
      // complained. Rails now flow with the page; pin that the cap is
      // GONE rather than that sticky is present.
      const wideBlock = CSS.split('@media').find((b) => /min-width:\s*1200px/.test(b));
      assert.ok(wideBlock, 'no @media (min-width:1200px) block found');
      const railRule = wideBlock!.match(/\.deck-rail-left[\s\S]*?\}/);
      assert.ok(railRule, 'no rail rule under @media min-width:1200px');
      assert.ok(!/max-height:\s*calc\(100vh/.test(railRule![0]), 'rails must NOT cap at calc(100vh-…) — caused internal scroll');
      assert.ok(/max-height:\s*none/.test(railRule![0]) || !/max-height:/.test(railRule![0]), 'rails must declare max-height:none (or omit it) so content flows');
    });

    it('arena hides the redundant in-arena hero to stop double-rendering', () => {
      assert.ok(/\.arena-shell\s+\.deck-body\s*>\s*\.abyss-banner\s*[\s\S]*display:\s*none/.test(CSS), 'in-arena .abyss-banner is not hidden — operator sees the giant Crucible card twice');
    });

    it('arena header strip provides per-tab info above the fold', () => {
      assert.ok(HTML.includes('function renderArenaHeaderStrip'), 'missing renderArenaHeaderStrip function');
      assert.ok(CSS.includes('.arena-header-strip'), 'missing .arena-header-strip CSS');
    });

    it('verdict + mission banners are hoisted out of the arena into a global stripe', () => {
      // After the correction, render() should hold these in a
      // .deck-banners wrapper between cmd-rail and deck-grid — not
      // inside renderActiveArenaShell.
      assert.ok(HTML.includes('class="deck-banners"') || HTML.includes('deck-banners'), 'missing deck-banners wrapper');
      // And the arena shell composer must NOT call them inline anymore.
      const arena = HTML.match(/function renderActiveArenaShell\(\)\s*\{[\s\S]*?return\s*`([^`]+)`/);
      assert.ok(arena, 'renderActiveArenaShell not found');
      assert.ok(!arena![1].includes('renderVerdictBanner'), 'arena still emits renderVerdictBanner inline — should be hoisted');
      assert.ok(!arena![1].includes('renderMissionBanner'), 'arena still emits renderMissionBanner inline — should be hoisted');
    });

    it('responsive cascade declares 1499 / 1199 / 899 / 599 breakpoints', () => {
      assert.ok(CSS.includes('@media (max-width:1499px)') || CSS.includes('@media(max-width:1499px)'), 'missing 1499px breakpoint');
      assert.ok(CSS.includes('@media (max-width:1199px)') || CSS.includes('@media(max-width:1199px)'), 'missing 1199px breakpoint');
      assert.ok(CSS.includes('@media (max-width:899px)') || CSS.includes('@media(max-width:899px)'), 'missing 899px breakpoint');
      assert.ok(CSS.includes('@media (max-width:599px)') || CSS.includes('@media(max-width:599px)'), 'missing 599px breakpoint');
    });
  });
});
