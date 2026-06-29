/**
 * Transforming Dashboard Panel System — Luak "Race Control" wall.
 *
 * Pins the reusable Voltron/pop-up-book template:
 *  - DATA: every Luak doctrine page is a panel with template metadata
 *    (PANEL_META) and a saved dashboard slot (LAYOUT_PRESETS.luak).
 *  - SOURCE: dashboard mode renders ONE merged surface (renderDashboardSurface)
 *    driven by a preset — NOT "open all windows".
 *  - STYLE: dashboard tiles merge seamlessly (no per-tile radius/shadow) and
 *    NEVER carry their own scrollbar (the cockpit invariant).
 *
 * Same eval-the-inline-literal approach as luak-world-map.test.ts: Luak's UI
 * is server-rendered from inline JS object literals in ui/index.html.
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

// The seven Luak doctrine pages that compose the dashboard wall.
const LUAK_PANELS = [
  'speedway-overview',
  'benchmark-runs',
  'grandstand-results',
  'timing-metrics',
  'pit-lane-config',
  'victory-achievements',
  'workshop-diagnostics',
];

const PANEL_META = evalLiteral('PANEL_META');
const PRESETS = evalLiteral('LAYOUT_PRESETS');

describe('Transforming Dashboard — panel metadata (PANEL_META)', () => {
  it('every Luak panel has a role, a priority, and a solo size {w,h}', () => {
    for (const id of LUAK_PANELS) {
      const m = PANEL_META[id];
      assert.ok(m && typeof m === 'object', `${id} missing PANEL_META entry`);
      assert.equal(typeof m.role, 'string', `${id} missing role`);
      assert.ok(m.role.length > 0, `${id} empty role`);
      assert.equal(typeof m.priority, 'number', `${id} missing numeric priority`);
      assert.ok(m.solo && typeof m.solo.w === 'string' && typeof m.solo.h === 'string',
        `${id} must declare a solo {w,h} size for hotspot placement`);
    }
  });
});

describe('Transforming Dashboard — Luak race-control preset (LAYOUT_PRESETS)', () => {
  const preset = PRESETS.luak;

  it('Luak has a named preset with grid tracks + areas + slots', () => {
    assert.ok(preset, 'LAYOUT_PRESETS.luak missing');
    assert.equal(preset.id, 'race-control', 'Luak preset id should be race-control');
    assert.equal(typeof preset.label, 'string');
    assert.equal(typeof preset.columns, 'string', 'preset needs grid-template-columns');
    assert.equal(typeof preset.rows, 'string', 'preset needs grid-template-rows');
    assert.equal(typeof preset.areas, 'string', 'preset needs grid-template-areas');
    assert.ok(preset.slots && typeof preset.slots === 'object', 'preset needs a slots map');
  });

  it('every Luak panel is assigned to a dashboard slot, and no orphan slots', () => {
    const slotted = Object.keys(preset.slots);
    for (const id of LUAK_PANELS) {
      assert.ok(slotted.includes(id), `${id} is not placed in the dashboard preset`);
    }
    assert.equal(slotted.length, LUAK_PANELS.length, 'preset slots must match the panel set exactly');
  });

  it('every slot maps to a grid-area that exists in the areas template (race-control wall)', () => {
    for (const [id, area] of Object.entries(preset.slots) as [string, string][]) {
      assert.ok(preset.areas.includes(area), `slot "${id}" -> area "${area}" not present in grid-template-areas`);
    }
    // The wall is a real race-control layout: top status strip, a results
    // centre, and a bottom achievements strip.
    for (const area of ['status', 'results', 'achievements', 'benchmark', 'metrics', 'config', 'diagnostics']) {
      assert.ok(preset.areas.includes(area), `race-control wall is missing the "${area}" region`);
    }
  });
});

describe('Transforming Dashboard — source wiring', () => {
  it('the template primitives exist (DashboardSurface, PanelShell, content)', () => {
    assert.ok(/function renderDashboardSurface\(/.test(HTML), 'renderDashboardSurface() must exist');
    assert.ok(/function renderTransformingPanel\(/.test(HTML), 'renderTransformingPanel() must exist');
    assert.ok(/function pehPanelDashboardBody\(/.test(HTML), 'pehPanelDashboardBody() must exist');
    assert.ok(/function pehOpenSolo\(/.test(HTML), 'pehOpenSolo() must exist');
    assert.ok(/const PANEL_CONTENT=/.test(HTML), 'PANEL_CONTENT registry must exist');
  });

  it('dashboard mode renders the MERGED surface, not the map', () => {
    const stage = HTML.match(/function renderPehStage\([\s\S]*?\n\}/);
    assert.ok(stage, 'renderPehStage() must exist');
    assert.ok(stage![0].includes("mode==='dashboard'") && stage![0].includes('renderDashboardSurface('),
      'renderPehStage must hand dashboard mode to renderDashboardSurface');
  });

  it('every Luak panel has a compact dashboard() renderer in PANEL_CONTENT', () => {
    const block = extractLiteral('PANEL_CONTENT');
    for (const id of LUAK_PANELS) {
      assert.ok(block.includes(`'${id}':{dashboard`), `${id} needs a compact dashboard() summary in PANEL_CONTENT`);
    }
  });

  it('Dashboard is a preset surface, NOT "open all windows"', () => {
    const setMode = HTML.match(/function pehSetMode\([\s\S]*?\n\}/);
    assert.ok(setMode, 'pehSetMode() must exist');
    assert.ok(!/Object\.entries\(WORKSPACE_REGISTRY\)/.test(setMode![0]),
      'pehSetMode must NOT iterate WORKSPACE_REGISTRY to open every panel as a window');
    const openAll = HTML.match(/function pehOpenAllDashboard\([\s\S]*?\n\}/);
    assert.ok(openAll, 'pehOpenAllDashboard() must exist');
    assert.ok(/pehSetMode\('dashboard'\)/.test(openAll![0]),
      'the Dashboard button must activate the merged surface via pehSetMode');
  });

  it('solo panels size from PANEL_META and stay bounded inside the map stage', () => {
    assert.ok(/pehPanelMeta\(/.test(HTML), 'renderWorkspaceWindows must read PANEL_META for solo size');
    const win = HTML.match(/function renderWorkspaceWindows\([\s\S]*?\n\}/);
    assert.ok(win, 'renderWorkspaceWindows() must exist');
    assert.ok(win![0].includes('solo.w'), 'solo windows must take their width from PANEL_META.solo');
    // The panel must be capped to the stage so it can never clip under the
    // header or overflow the bottom — and must NOT use the old upward-flip
    // transform that pushed tall panels above the stage.
    assert.ok(win![0].includes('max-height:calc(100% -'),
      'solo panel height must be capped to the stage (no header clipping / overflow)');
    assert.ok(!win![0].includes('calc(-100% -'),
      'solo panel must not use the upward-flip transform that clipped under the header');
  });
});

describe('Transforming Dashboard — seamless, scrollless styling', () => {
  function rule(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    assert.ok(m, `expected CSS rule for "${selector}"`);
    return m![1]!;
  }

  it('the merged surface and wall exist; the wall is one framed grid', () => {
    assert.ok(/\.peh-dash-surface\s*\{/.test(CSS), '.peh-dash-surface must exist');
    const wall = rule('.peh-dash-wall');
    assert.match(wall, /display\s*:\s*grid/, 'the wall is a single grid');
    assert.match(wall, /gap\s*:\s*1px/, 'tiles touch via a 1px hairline gap (seamless join)');
    assert.match(wall, /border-radius/, 'only the outer wall is rounded');
  });

  it('tiles have NO individual border-radius or shadow (they merge)', () => {
    const tile = rule('.peh-dash-tile');
    assert.match(tile, /border-radius\s*:\s*0/, 'tiles must not round their own corners');
    assert.match(tile, /box-shadow\s*:\s*none/, 'tiles must not cast their own shadow');
  });

  it('NO dashboard tile has its own scrollbar (the cockpit invariant)', () => {
    const body = rule('.peh-dash-tile-body');
    assert.match(body, /overflow\s*:\s*hidden/, 'tile body must clip, not scroll');
    assert.doesNotMatch(body, /overflow(-[xy])?\s*:\s*(auto|scroll)/,
      'a dashboard tile must never get its own scrollbar — summarise content instead');
  });
});
