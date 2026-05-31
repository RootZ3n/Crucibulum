/**
 * Luak world-map doctrine — 1920s Racetrack Speedway.
 *
 * Pins the Luak world map to PEHVERSE_WORLD_MAP.md:
 *  - DATA level: Luak has EXACTLY the seven doctrine locations, each with an
 *    associated page/route AND a data-driven Peh placeholder slot, and NO
 *    game-economy locations (stars / coins / tickets / daily goals /
 *    collection / inventory / XP).
 *  - SOURCE level: the Peh slot is rendered from location data, and the
 *    responsive shell opens a workspace as a full-screen sheet on mobile
 *    (NOT a tiny floating/draggable window) — docked panels are a desktop
 *    (≥880px) treatment only.
 *
 * Luak's UI is server-rendered from inline JS object literals in
 * ui/index.html (no JSDOM/browser in CI), so the registries are pure-data
 * literals we can safely eval — same approach as the isolation suite.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HTML = readFileSync(join(process.cwd(), 'ui', 'index.html'), 'utf-8');
const CSS = readFileSync(join(process.cwd(), 'ui', 'crucibulum.css'), 'utf-8');

// Extract the balanced [...] / {...} literal that follows `const NAME=`,
// tracking string/comment state so brackets inside them don't unbalance it.
function extractLiteral(name: string): string {
  const anchor = HTML.indexOf('const ' + name + '=');
  assert.ok(anchor > -1, `const ${name}= not found in ui/index.html`);
  let i = anchor + ('const ' + name + '=').length;
  while (i < HTML.length && HTML[i] !== '[' && HTML[i] !== '{') i++;
  const start = i;
  let depth = 0;
  let str: string | null = null;
  let line = false;
  let block = false;
  for (; i < HTML.length; i++) {
    const c = HTML[i];
    const n = HTML[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return HTML.slice(start, i + 1); }
  }
  throw new Error(`could not balance literal for ${name}`);
}
function evalLiteral(name: string): any {
  // eslint-disable-next-line no-eval
  return (0, eval)('(' + extractLiteral(name) + ')');
}

const SCENES: Record<string, any[]> = evalLiteral('SCENE_REGISTRY');
const WORKSPACES: Record<string, any> = evalLiteral('WORKSPACE_REGISTRY');

const LUAK = SCENES.luak || [];
const luakIds = LUAK.map((s) => s.id);

// The doctrine's seven Luak locations, in order (PEHVERSE_WORLD_MAP.md §1).
const DOCTRINE = [
  'speedway',
  'racetrack',
  'grandstand',
  'timing-tower',
  'pit-lane',
  'victory-circle',
  'workshop',
];

describe('Luak world map — doctrine locations', () => {
  it('Luak has EXACTLY the seven doctrine locations, in order', () => {
    assert.deepEqual(luakIds, DOCTRINE,
      `Luak locations must be exactly the doctrine set; got ${JSON.stringify(luakIds)}`);
  });

  it('speedway is the hub (overview) and Luak defaults to it', () => {
    assert.equal(luakIds[0], 'speedway', 'speedway is the hub / first location');
    const PRODUCTS: any[] = evalLiteral('PRODUCT_REGISTRY');
    const luak = PRODUCTS.find((p) => p.id === 'luak');
    assert.ok(luak, 'luak product missing');
    assert.equal(luak.defaultScene, 'speedway', 'Luak must open on the speedway hub');
  });

  it('NO game-economy locations (no stars/coins/tickets/daily goals/collection/XP)', () => {
    const banned = /(daily[-\s]?goal|collection|inventory|coins?|tickets?|\bxp\b|\bstars?\b|progression|streak)/i;
    for (const s of LUAK) {
      assert.ok(!banned.test(s.id), `location id "${s.id}" looks like a game-HUD element`);
      assert.ok(!banned.test(s.title || ''), `location "${s.id}" title looks like a game-HUD element`);
      assert.ok(!banned.test(s.purpose || ''), `location "${s.id}" purpose looks like a game-HUD element`);
    }
  });

  it('inspiration-only zones (Trial Floor / Adversarial / Garage Row) are NOT Luak locations', () => {
    for (const ghost of ['trial-floor', 'adversarial-trials', 'garage-row', 'garage']) {
      assert.ok(!luakIds.includes(ghost), `"${ghost}" is concept art only — not an official Luak location`);
    }
  });
});

describe('Luak world map — each location has a page/route', () => {
  it('every location carries a purpose and a route, and opens a Luak-owned page', () => {
    for (const s of LUAK) {
      assert.equal(typeof s.purpose, 'string', `${s.id} missing purpose`);
      assert.ok(s.purpose.length > 0, `${s.id} empty purpose`);
      assert.equal(typeof s.route, 'string', `${s.id} missing route`);
      assert.ok(/^\//.test(s.route), `${s.id} route must be a "/path"; got ${s.route}`);

      // At least one hotspot opens a Luak-owned workspace (the location's page),
      // and that workspace declares a matching route.
      const opener = (s.hotspots || []).find((h: any) => h.workspace);
      assert.ok(opener, `${s.id} has no hotspot that opens a workspace/page`);
      const def = WORKSPACES[opener.workspace];
      assert.ok(def, `${s.id} opens unknown workspace ${opener.workspace}`);
      assert.equal(def.product, 'luak', `${s.id} page must be Luak-owned`);
      assert.equal(typeof def.route, 'string', `workspace ${opener.workspace} missing route`);
    }
  });

  it('the hub exposes every location as a hotspot on the world map', () => {
    const hub = LUAK.find((s) => s.id === 'speedway');
    assert.ok(hub, 'speedway hub missing');
    const reachable = new Set((hub!.hotspots || []).map((h: any) => h.scene).filter(Boolean));
    for (const id of DOCTRINE) {
      assert.ok(reachable.has(id), `hub world map must surface the "${id}" location`);
    }
  });
});

describe('Luak world map — Peh placeholder slot per location', () => {
  it('every location has a data-driven pehSlot {x,y,anchor,variant}', () => {
    for (const s of LUAK) {
      const slot = s.pehSlot;
      assert.ok(slot && typeof slot === 'object', `${s.id} missing pehSlot`);
      assert.equal(typeof slot.x, 'number', `${s.id} pehSlot.x must be a number`);
      assert.equal(typeof slot.y, 'number', `${s.id} pehSlot.y must be a number`);
      assert.ok(slot.x >= 0 && slot.x <= 100, `${s.id} pehSlot.x out of 0..100`);
      assert.ok(slot.y >= 0 && slot.y <= 100, `${s.id} pehSlot.y out of 0..100`);
      assert.equal(typeof slot.anchor, 'string', `${s.id} pehSlot.anchor must be a string`);
      assert.ok(slot.anchor.length > 0, `${s.id} pehSlot.anchor empty`);
      // variant is optional per the spec, but when present must be a string.
      if ('variant' in slot) assert.equal(typeof slot.variant, 'string', `${s.id} pehSlot.variant must be a string`);
    }
  });

  it('the Peh slot is RENDERED from location data (squirrel placeholder)', () => {
    assert.ok(/function renderPehSlot\(/.test(HTML), 'renderPehSlot() must exist');
    assert.ok(/function pehSlotMarkup\(/.test(HTML), 'pehSlotMarkup() must exist');
    // Immersive scene renders the slot, driven by scene.pehSlot.
    const imm = HTML.match(/function renderPehImmersive\([\s\S]*?\n\}/);
    assert.ok(imm && imm[0].includes('renderPehSlot(scene)'), 'immersive scene must render the Peh slot');
    // Placeholder is a squirrel silhouette (swappable for real Peh art later).
    assert.ok(/function pehSquirrelSilhouette\(/.test(HTML), 'squirrel silhouette placeholder must exist');
    assert.ok(/left:\$\{slot\.x\}%;top:\$\{slot\.y\}%/.test(HTML), 'slot must be positioned from pehSlot {x,y}');
    assert.ok(/\.peh-slot/.test(CSS), '.peh-slot styles must exist');
  });
});

describe('Luak world map — responsive (mobile = sheet, desktop = docked)', () => {
  it('mobile base opens a workspace as a full-screen sheet, NOT a floating window', () => {
    // The base (mobile-first) .peh-panel rule pins it to the viewport edges as
    // a sheet — left/right/bottom:0 — not a small absolutely-placed window.
    const base = CSS.match(/\.peh-panel\{[^}]*position:absolute;[^}]*\}/);
    assert.ok(base, 'base .peh-panel sheet rule not found');
    const body = base![0];
    assert.ok(/left:0/.test(body) && /right:0/.test(body) && /bottom:0/.test(body),
      'mobile workspace must be a full-bleed sheet (left/right/bottom:0)');
    assert.ok(/top:\d/.test(body), 'sheet anchors near the top of the viewport (near-fullscreen)');
  });

  it('docked / floating panels are a DESKTOP-only treatment (≥880px)', () => {
    const desktop = CSS.indexOf('@media (min-width:880px)');
    assert.ok(desktop > -1, 'desktop breakpoint must exist');
    const block = CSS.slice(desktop, desktop + 1200);
    assert.ok(/\.peh-panel\.dock-right/.test(block), 'dock-right is gated behind the desktop breakpoint');
    assert.ok(/\.peh-panel\.dock-bottom/.test(block), 'dock-bottom is gated behind the desktop breakpoint');
    // The base (pre-breakpoint) CSS must NOT position docked panels as windows.
    const preDesktop = CSS.slice(0, desktop);
    assert.ok(!/\.peh-panel\.dock-right\{[^}]*width:min/.test(preDesktop),
      'mobile must not float a docked window — that is desktop-only');
  });

  it('there is a persistent way back to the map from a workspace sheet', () => {
    assert.ok(/function pehBackToMap\(/.test(HTML), 'pehBackToMap() must exist');
    assert.ok(/peh-backmap/.test(HTML), 'workspace sheet must show a back-to-map control');
    assert.ok(/\.peh-backmap/.test(CSS), '.peh-backmap styles must exist');
  });

  it('the SAME location registry drives both layouts (no separate mobile data)', () => {
    // SceneRegistry.luak is the single source — desktop immersive/dashboard and
    // the mobile sheet all read it. Guard against a parallel mobile registry.
    assert.ok(!/SCENE_REGISTRY_MOBILE|MOBILE_SCENE|LUAK_MOBILE/.test(HTML),
      'must not fork a separate mobile location registry');
  });
});
