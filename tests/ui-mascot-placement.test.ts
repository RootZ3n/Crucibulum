/**
 * Crucible — mascot placement pins
 *
 * Squidley was moved out of the dark footer (where the operator could
 * not see it) into the top command rail next to the CRUCIBLE title.
 * This file pins the new placement so a future cleanup cannot re-bury
 * Squidley or re-introduce a giant hero mascot.
 *
 * Six required pins (M1-M6) from the mascot-placement spec.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HTML = readFileSync(join(process.cwd(), 'ui', 'index.html'), 'utf-8');
const CSS = readFileSync(join(process.cwd(), 'ui', 'crucibulum.css'), 'utf-8');

describe('Crucible mascot placement', () => {
  it('M1 · large hero mascot is still absent', () => {
    // Legacy hero mascot hook stays hidden by CSS.
    assert.ok(CSS.includes('.ab-squid{display:none}'), 'legacy .ab-squid hero mascot is no longer suppressed');
    // No oversized mascot class in the markup (e.g. hero-squid,
    // banner-squid, mascot-hero).
    assert.ok(!/class="[^"]*\bhero-squid\b/.test(HTML), 'hero-squid class found in markup');
    assert.ok(!/class="[^"]*\bbanner-squid\b/.test(HTML), 'banner-squid class found in markup');
    assert.ok(!/class="[^"]*\bmascot-hero\b/.test(HTML), 'mascot-hero class found in markup');
    // And no CSS rule giving any mascot huge width (> 80 px).
    const giant = CSS.match(/\.(hero-squid|banner-squid|mascot-hero|cmd-rail-mascot|footer-squid)\{[^}]*width:\s*(\d+)px/g) || [];
    for (const decl of giant) {
      const px = Number(decl.match(/width:\s*(\d+)px/)![1]);
      assert.ok(px <= 80, `mascot rule "${decl}" exceeds 80px cap`);
    }
  });

  it('M2 · header mascot element exists inside the cmd-rail brand cluster', () => {
    assert.ok(HTML.includes('cmd-rail-mascot'), 'missing cmd-rail-mascot in HTML');
    assert.ok(CSS.includes('.cmd-rail-mascot'), 'missing .cmd-rail-mascot CSS');
    // It must be inside the cmd-rail-brand block (not floating
    // somewhere else in the rail).
    const brand = HTML.match(/<div class="cmd-rail-brand">[\s\S]*?<\/div>\s*<div class="cmd-rail-status">/);
    // Actually the brand div closes before cmd-rail-status begins in
    // the source; use a simpler check: the mascot literal appears
    // after `cmd-rail-brand` and before `cmd-rail-status`.
    const brandIdx = HTML.indexOf('cmd-rail-brand');
    const mascotIdx = HTML.indexOf('cmd-rail-mascot');
    const statusIdx = HTML.indexOf('cmd-rail-status');
    assert.ok(brandIdx > 0 && mascotIdx > 0 && statusIdx > 0, 'cmd-rail anatomy missing');
    assert.ok(brandIdx < mascotIdx && mascotIdx < statusIdx, 'cmd-rail-mascot must sit inside the brand cluster (between cmd-rail-brand and cmd-rail-status)');
    // Decorative-only: aria-hidden + empty alt + pointer-events:none.
    assert.ok(/<img[^>]*class="cmd-rail-mascot"[^>]*alt=""[^>]*aria-hidden="true"/.test(HTML) || /<img[^>]*aria-hidden="true"[^>]*class="cmd-rail-mascot"/.test(HTML), 'cmd-rail-mascot must have empty alt + aria-hidden="true"');
    assert.ok(/\.cmd-rail-mascot\{[^}]*pointer-events:\s*none/.test(CSS), 'cmd-rail-mascot must have pointer-events:none');
  });

  it('M3 · header mascot size is capped (≤ 64 px desktop)', () => {
    const m = CSS.match(/\.cmd-rail-mascot\{[^}]*\}/);
    assert.ok(m, '.cmd-rail-mascot rule missing');
    const decl = m![0];
    const widthMatch = decl.match(/width:\s*(\d+)px/);
    assert.ok(widthMatch, 'cmd-rail-mascot missing width');
    const w = Number(widthMatch![1]);
    assert.ok(w >= 40 && w <= 64, `cmd-rail-mascot width ${w}px should be between 40 and 64`);
    // object-fit must be contain so any future image swap stays in proportion
    assert.ok(/object-fit:\s*contain/.test(decl), 'cmd-rail-mascot must use object-fit:contain');
    // Opacity 0.75 - 0.95 — must NOT be the old 0.35 footer fade
    const opMatch = decl.match(/opacity:\s*(0?\.\d+|1)/);
    assert.ok(opMatch, 'cmd-rail-mascot missing opacity');
    const op = Number(opMatch![1]);
    assert.ok(op >= 0.7 && op <= 0.95, `cmd-rail-mascot opacity ${op} should be 0.7-0.95 (not the old 0.35 fade)`);
  });

  it('M4 · footer mascot is absent or secondary (header is primary)', () => {
    // Operator wanted the footer mascot removed since the header is
    // primary. The img tag is gone from the deck-footer; the seal text
    // remains.
    const footerHasImg = /<footer[^>]*deck-footer[^>]*>[\s\S]*?<img[^>]*footer-squid/.test(HTML);
    assert.ok(!footerHasImg, 'footer still contains a redundant Squidley image — should be removed since the header now hosts the primary mascot');
    assert.ok(HTML.includes('Crucible Evaluation Lattice'), 'footer seal text must remain even without the image');
  });

  it('M5 · header card does not use oversized mascot classes', () => {
    // Reject classes that would imply a large hero treatment in the
    // header card.
    const cmdRail = HTML.match(/<header class="cmd-rail"[\s\S]*?<\/header>/);
    assert.ok(cmdRail, 'cmd-rail header not found in render output');
    const block = cmdRail![0];
    for (const bad of ['hero-mascot', 'mascot-big', 'mascot-hero', 'mascot-xl', 'mascot-jumbo', 'hero-squid', 'banner-squid']) {
      assert.ok(!block.includes(bad), `cmd-rail must not use oversized class "${bad}"`);
    }
  });

  it('M6 · mobile breakpoint has safe mascot sizing', () => {
    // There must be a phone-width rule shrinking the mascot below the
    // desktop cap. Either the 899px or 599px block should match.
    const smallBlock = CSS.split('@media').find((b) => /max-width:\s*899px[\s\S]*\.cmd-rail-mascot\{[^}]*width:\s*\d+px/.test(b))
      || CSS.split('@media').find((b) => /max-width:\s*599px[\s\S]*\.cmd-rail-mascot\{[^}]*width:\s*\d+px/.test(b));
    assert.ok(smallBlock, 'no mobile breakpoint reduces .cmd-rail-mascot size');
    const w = Number(smallBlock!.match(/\.cmd-rail-mascot\{[^}]*width:\s*(\d+)px/)![1]);
    assert.ok(w <= 48, `mobile cmd-rail-mascot width ${w}px should be <= 48px`);
  });
});
