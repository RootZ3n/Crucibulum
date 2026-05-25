/**
 * Crucible — side-rail detail decks
 *
 * Focused Run (which contains Provenance + Methodology subpanels) and
 * Best Model Recommendations (Quick Picks) were hoisted out of the
 * scrolling arena into the side rails so the operator no longer
 * scrolls past run controls to reach them. The rails were also
 * un-capped so the triage decks + Focused Run flow naturally without
 * internal rail scrolling.
 *
 * 8 pins (S1-S8) plus screenshot artifact check.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, 'ui', 'index.html'), 'utf-8');
const CSS = readFileSync(join(ROOT, 'ui', 'crucibulum.css'), 'utf-8');

describe('Crucible side-rail detail decks', () => {
  it('S1 · Focused Run rail deck exists and wraps renderFocusedRun', () => {
    assert.ok(HTML.includes('function renderFocusedRunRailDeck'), 'missing renderFocusedRunRailDeck function');
    const start = HTML.indexOf('function renderFocusedRunRailDeck(');
    const nextFn = HTML.indexOf('\nfunction ', start + 1);
    const body = HTML.slice(start, nextFn === -1 ? start + 2000 : nextFn);
    assert.ok(body.includes('renderFocusedRun(tabKey)'), 'focused-run rail deck must call renderFocusedRun(tabKey)');
    assert.ok(CSS.includes('.focused-run-rail-deck'), 'missing .focused-run-rail-deck CSS');
  });

  it('S2 · Quick Picks rail deck exists and pulls from reviewSummary', () => {
    assert.ok(HTML.includes('function renderQuickPicksRailDeck'), 'missing renderQuickPicksRailDeck function');
    const start = HTML.indexOf('function renderQuickPicksRailDeck(');
    const nextFn = HTML.indexOf('\nfunction ', start + 1);
    const body = HTML.slice(start, nextFn === -1 ? start + 2000 : nextFn);
    assert.ok(body.includes('reviewSummary(tabKey)'), 'quick-picks rail deck must read from reviewSummary');
    assert.ok(CSS.includes('.quick-picks-rail-deck'), 'missing .quick-picks-rail-deck CSS');
  });

  it('S3 · arena (renderDashboard + renderLane) no longer renders Focused Run inline', () => {
    const dash = HTML.match(/function renderDashboard\(\)\s*\{[\s\S]*?return`([\s\S]*?)`;[\s\S]*?\}\n/);
    assert.ok(dash, 'renderDashboard not found');
    const dashTpl = dash![1];
    assert.ok(!dashTpl.includes("renderFocusedRun('dashboard')"), 'renderDashboard still renders Focused Run inline — must be in side rail');

    const lane = HTML.match(/function renderLane\(tabKey\)\s*\{[\s\S]*?return`([\s\S]*?)`;[\s\S]*?\}\n/);
    assert.ok(lane, 'renderLane not found');
    const laneTpl = lane![1];
    assert.ok(!laneTpl.includes('renderFocusedRun(tab.key)'), 'renderLane still renders Focused Run inline — must be in side rail');
  });

  it('S4 · arena no longer hosts the Quick Picks winner stack', () => {
    const dash = HTML.match(/function renderDashboard\(\)\s*\{[\s\S]*?return`([\s\S]*?)`;[\s\S]*?\}\n/);
    assert.ok(dash, 'renderDashboard not found');
    const dashTpl = dash![1];
    // The original side-column Quick Picks block was a winner-stack
    // built inline from overview.winners. The new approach calls the
    // rail deck helper. The inline block must be gone.
    assert.ok(!/overview\.winners\.length\?`<div class="winner-stack">/.test(dashTpl), 'renderDashboard still emits the inline Quick Picks winner-stack — must be in left-rail deck');
  });

  it('S5 · side rails are NOT internally scroll-capped (no max-height:calc(100vh…))', () => {
    // The previous sticky+max-height rule capped the rail at viewport
    // height, forcing the operator to scroll inside the rail when
    // Focused Run was added. The rail must be uncapped so all
    // triage + detail decks render naturally.
    const wideBlock = CSS.split('@media').find((b) => /min-width:\s*1200px/.test(b));
    assert.ok(wideBlock, 'no @media (min-width:1200px) block');
    // Capped-style rules must be absent or explicitly cleared.
    const stillCapped = /\.deck-rail-(left|right)[\s\S]*?max-height:\s*calc\(100vh/.test(wideBlock!);
    assert.ok(!stillCapped, 'rails are still capped at calc(100vh-…) — operator gets internal rail scrolling');
    const stillSticky = /\.deck-rail-(left|right)[\s\S]*?position:\s*sticky/.test(wideBlock!);
    assert.ok(!stillSticky, 'rails are still position:sticky — pair with no cap = wasted screen space; un-stick');
  });

  it('S6 · Focused Run is mounted into the right rail (renderEvidenceDeck composer)', () => {
    const start = HTML.indexOf('function renderEvidenceDeck(');
    const nextFn = HTML.indexOf('\nfunction ', start + 1);
    const body = HTML.slice(start, nextFn === -1 ? start + 1000 : nextFn);
    assert.ok(body.includes('renderFocusedRunRailDeck'), 'renderEvidenceDeck must mount renderFocusedRunRailDeck');
    // And the four triage decks remain.
    for (const need of ['renderFailureBoardDeck', 'renderProviderBayDeck', 'renderEvidenceVaultDeck', 'renderReleaseGateDeck']) {
      assert.ok(body.includes(need), `renderEvidenceDeck must still mount ${need}`);
    }
  });

  it('S7 · Quick Picks is mounted into the left rail under Evaluation Rooms', () => {
    // render() should compose left rail with rooms deck followed by
    // quick-picks rail deck.
    const left = HTML.match(/<aside class="deck-rail-left"[^>]*>\$\{[^}]*\}\$\{[^}]*\}<\/aside>/);
    assert.ok(left, 'left rail must include two helpers (rooms + quick picks)');
    assert.ok(left![0].includes('renderEvaluationRoomsDeck'), 'left rail missing renderEvaluationRoomsDeck');
    assert.ok(left![0].includes('renderQuickPicksRailDeck'), 'left rail missing renderQuickPicksRailDeck');
  });

  it('S8 · Provenance + Methodology stay inside Focused Run (so they ride along into the rail)', () => {
    // The PROVENANCE / METHODOLOGY mini-labels live inside
    // renderFocusedRun's body. Since we hoist the whole renderFocusedRun
    // output into the rail deck, the operator gets all of:
    //   Focused Run · Provenance · Methodology · Best Models
    // in the side rails. Pin the labels' presence inside
    // renderFocusedRun source.
    const start = HTML.indexOf('function renderFocusedRun(tabKey){');
    assert.ok(start > 0, 'renderFocusedRun not found');
    const nextFn = HTML.indexOf('\nfunction ', start + 1);
    const body = HTML.slice(start, nextFn === -1 ? start + 12000 : nextFn);
    assert.ok(/PROVENANCE[\s\S]{0,200}Bundle Trace/.test(body) || body.includes('PROVENANCE'), 'PROVENANCE mini-label missing from renderFocusedRun');
    assert.ok(/METHODOLOGY[\s\S]{0,200}Judge Stack/.test(body) || body.includes('METHODOLOGY'), 'METHODOLOGY mini-label missing from renderFocusedRun');
  });

  it('S9 · screenshot artifact exists', () => {
    const reports = readdirSync(join(ROOT, 'reports', 'ui-redesign'));
    assert.ok(reports.includes('crucible-side-rail-details'), 'reports/ui-redesign/crucible-side-rail-details/ directory missing');
    const files = readdirSync(join(ROOT, 'reports', 'ui-redesign', 'crucible-side-rail-details'));
    assert.ok(files.some((f) => f.endsWith('.md')), 'report markdown missing');
    assert.ok(files.some((f) => f.endsWith('-desktop-wide.png')) && files.some((f) => f.endsWith('-mobile.png')), 'desktop + mobile screenshot artifacts missing');
  });
});
