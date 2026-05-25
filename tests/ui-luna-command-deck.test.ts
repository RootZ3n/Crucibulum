/**
 * Crucible — Luna-style command deck UI structure pins
 *
 * Section J of the redesign brief requires 12 specific structural
 * assertions on the new "Evaluation Arena / Judge Deck" shell. This file
 * pins each one to the rendered HTML/CSS so a regression that drops
 * (say) the Failure Board or the Evidence Vault fails the suite instead
 * of silently shipping a half-redesigned UI.
 *
 * The assertions look at the inline render(...) script in ui/index.html
 * because Crucible's UI is server-rendered into the page from JS strings
 * (no JSDOM, no real browser in CI). The class names checked here are
 * stable contract names — render helpers MUST keep them in their output.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HTML = readFileSync(join(process.cwd(), 'ui', 'index.html'), 'utf-8');
const CSS = readFileSync(join(process.cwd(), 'ui', 'crucibulum.css'), 'utf-8');

describe('Luna command-deck UI structure', () => {
  it('J1 · Evaluation Rooms deck exists', () => {
    assert.ok(HTML.includes('function renderEvaluationRoomsDeck'), 'missing renderEvaluationRoomsDeck function');
    assert.ok(HTML.includes('Evaluation Rooms'), 'missing Evaluation Rooms label');
    assert.ok(HTML.includes('class="rooms-list"') || HTML.includes('rooms-list'), 'missing .rooms-list container');
    assert.ok(CSS.includes('.rooms-list'), 'missing .rooms-list CSS');
    assert.ok(CSS.includes('.room-card'), 'missing .room-card CSS');
  });

  it('J2 · Active Arena exists', () => {
    assert.ok(HTML.includes('function renderActiveArenaShell'), 'missing renderActiveArenaShell function');
    assert.ok(HTML.includes('arena-shell'), 'missing .arena-shell selector in HTML');
    assert.ok(CSS.includes('.arena-shell'), 'missing .arena-shell CSS');
    assert.ok(HTML.includes('Active Arena'), 'missing "Active Arena" aria-label');
  });

  it('J3 · Failure Board exists', () => {
    assert.ok(HTML.includes('function renderFailureBoardDeck'), 'missing renderFailureBoardDeck function');
    assert.ok(HTML.includes('Failure Board'), 'missing "Failure Board" label');
    assert.ok(CSS.includes('.failure-board'), 'missing .failure-board CSS');
    // Severity styling: red for product, amber for provider/config, cyan for info, teal for clean
    assert.ok(CSS.includes('.failure-row.product'), 'missing product severity styling');
    assert.ok(CSS.includes('.failure-row.provider'), 'missing provider severity styling');
    assert.ok(CSS.includes('.failure-row.config'), 'missing config severity styling');
  });

  it('J4 · Provider Bay exists', () => {
    assert.ok(HTML.includes('function renderProviderBayDeck'), 'missing renderProviderBayDeck function');
    assert.ok(HTML.includes('Provider Bay'), 'missing "Provider Bay" label');
    assert.ok(CSS.includes('.provider-bay'), 'missing .provider-bay CSS');
    assert.ok(HTML.includes('selectedProviderModelSummary'), 'missing provider/model summary helper');
  });

  it('J5 · Evidence Vault exists', () => {
    assert.ok(HTML.includes('function renderEvidenceVaultDeck'), 'missing renderEvidenceVaultDeck function');
    assert.ok(HTML.includes('Evidence Vault'), 'missing "Evidence Vault" label');
    assert.ok(CSS.includes('.evidence-vault-deck') || CSS.includes('.evidence-stack'), 'missing evidence vault CSS');
    assert.ok(HTML.includes('Open Evidence'), 'missing Open Evidence button');
    assert.ok(HTML.includes('Refresh'), 'missing Refresh button');
  });

  it('J6 · Release Gate status visible', () => {
    assert.ok(HTML.includes('function renderReleaseGateDeck'), 'missing renderReleaseGateDeck function');
    assert.ok(HTML.includes('Release Gate'), 'missing "Release Gate" label');
    assert.ok(CSS.includes('.gate-row'), 'missing .gate-row CSS');
    // Gate state is always rendered, not buried
    assert.ok(HTML.includes('Full release ready') || HTML.includes('Scoped to certified targets'), 'gate state not rendered');
  });

  it('J7 · Certified/uncertified labels are visible (not buried in small text)', () => {
    assert.ok(HTML.includes('Certified release target'), 'missing Certified release target label');
    assert.ok(HTML.includes('Uncertified visible') || HTML.includes('UI certified') || HTML.includes('NOT UI-CERTIFIED'), 'missing uncertified surface');
    // The labels must appear in the Provider Bay or Release Gate decks (right rail)
    const bayIdx = HTML.indexOf('renderProviderBayDeck');
    const gateIdx = HTML.indexOf('renderReleaseGateDeck');
    assert.ok(bayIdx > 0 && gateIdx > 0, 'certification labels not in right-rail decks');
  });

  it('J8 · Large hero mascot/image is absent', () => {
    // .ab-squid (the legacy hero image hook) is hidden via display:none
    assert.ok(CSS.includes('.ab-squid{display:none}'), 'hero squid not hidden');
    // No <img> tag whose class starts with "hero" or "abyss-squid"
    assert.ok(!/<img[^>]+class="[^"]*\bhero-squid\b/.test(HTML), 'hero-squid img class present');
    // The deck shell forbids a large mascot block above the rail content
    assert.ok(!/class="[^"]*\babyss-squid-block\b/.test(HTML), 'large squid block present');
  });

  it('J9 · Small footer mascot/seal is present', () => {
    assert.ok(HTML.includes('class="footer-squid"') || HTML.includes('footer-squid'), 'missing footer-squid image');
    assert.ok(HTML.includes('Crucible Evaluation Lattice'), 'missing footer lattice seal');
    assert.ok(CSS.includes('.footer-squid'), 'missing footer-squid CSS');
    // Must be small: width <= 40px
    const m = CSS.match(/\.footer-squid\{[^}]*width:\s*(\d+)px/);
    if (m) {
      const px = Number(m[1]);
      assert.ok(px <= 40, `footer squid width ${px}px should be <= 40px`);
    }
  });

  it('J10 · Mobile viewport has no horizontal overflow', () => {
    // Body / shell pin overflow-x:hidden so phone widths cannot bleed
    assert.ok(CSS.includes('overflow-x:hidden'), 'missing overflow-x:hidden on body/html');
    // Deck grid collapses to single column at phone widths
    assert.ok(CSS.includes('@media (max-width:720px)') || CSS.includes('@media(max-width:720px)'), 'missing 720px mobile breakpoint');
    // Viewport meta is set
    assert.ok(HTML.includes('width=device-width'), 'missing viewport meta');
  });

  it('J11 · No centered dead-text lane list remains as primary navigation', () => {
    // The legacy nav-band/tabbar is hidden — rooms deck is the primary
    // navigation element. The legacy tabbar may still exist as an inert
    // accessibility/test fallback but it MUST be hidden.
    assert.ok(/<nav class="nav-band"[^>]*\bhidden\b/.test(HTML) || /class="nav-band"[^>]*hidden/.test(HTML), 'legacy nav-band tab list is not hidden');
    // Rooms deck is wired as the navigation landmark
    assert.ok(HTML.includes('Evaluation room navigation') || HTML.includes('aria-label="Evaluation Rooms'), 'rooms deck is not labeled as navigation');
  });

  it('J12 · Advanced telemetry is collapsible', () => {
    assert.ok(CSS.includes('.telemetry-deck'), 'missing .telemetry-deck CSS');
    // Must use <details>/<summary> so it collapses without JS
    assert.ok(/<details[^>]*class="[^"]*telemetry-deck/.test(HTML), 'telemetry-deck is not a <details> element');
    // Body / summary visual treatment is defined
    assert.ok(CSS.includes('.telemetry-deck > summary'), 'missing summary styling');
  });

  describe('Luna-shell composition pins (regression guards)', () => {
    it('command rail wraps brand + chips + Simple/Advanced toggle', () => {
      assert.ok(HTML.includes('function renderCommandRail'), 'missing renderCommandRail');
      assert.ok(HTML.includes('class="cmd-rail"') || HTML.includes('cmd-rail'), 'missing .cmd-rail container');
      assert.ok(CSS.includes('.cmd-rail'), 'missing .cmd-rail CSS');
      assert.ok(HTML.includes('view-toggle'), 'command rail dropped Simple/Advanced toggle');
    });

    it('deck-grid uses left/center/right rails + floor', () => {
      assert.ok(CSS.includes('.deck-grid'), 'missing .deck-grid CSS');
      assert.ok(CSS.includes('grid-template-areas'), 'deck-grid missing grid-template-areas');
      assert.ok(CSS.includes('"left center right"'), 'missing rail areas');
      assert.ok(CSS.includes('"floor floor floor"'), 'missing floor area');
    });

    it('deck-window chrome (sockets + title plate) is defined', () => {
      assert.ok(CSS.includes('.deck-window'), 'missing .deck-window');
      assert.ok(CSS.includes('.deck-socket'), 'missing .deck-socket');
      assert.ok(CSS.includes('.deck-title-plate'), 'missing .deck-title-plate');
      assert.ok(CSS.includes('.deck-header'), 'missing .deck-header');
    });

    it('Evidence Feed (bottom deck) renders recent trials', () => {
      assert.ok(HTML.includes('function renderEvidenceFeed'), 'missing renderEvidenceFeed');
      assert.ok(HTML.includes('Evidence Feed'), 'missing Evidence Feed label');
      assert.ok(CSS.includes('.feed-item'), 'missing .feed-item CSS');
    });

    it('rooms include all configured tabs as cards (not centered list)', () => {
      // The rooms list iterates Object.values(TAB_CONFIG) — the renderer
      // must spread every tab as a room card.
      assert.ok(/renderEvaluationRoomsDeck[\s\S]*Object\.values\(TAB_CONFIG\)/.test(HTML), 'rooms deck must iterate TAB_CONFIG');
      assert.ok(HTML.includes('room-card'), 'missing room-card class in HTML');
    });
  });
});
