/**
 * Pehverse Phase 1.1 — product isolation boundary.
 *
 * The Phase 1 world engine treated products as "realms" inside one shared
 * runtime, which allowed cross-product navigation. Phase 1.1 converts it to
 * a reusable SINGLE-PRODUCT world-shell: each public product is standalone,
 * with no cross-product fast travel and no cross-product workspace opening.
 *
 * These tests pin that boundary two ways:
 *  - DATA level: parse the inline registries from ui/index.html and prove no
 *    scene/hotspot of one product references another product's workspace,
 *    and that workspaces carry product ownership.
 *  - SOURCE level: prove the runtime guards exist (open-workspace isolation
 *    check, product-local fast travel, release-hidden dev switcher).
 *
 * Luak's UI is server-rendered from inline JS strings (no JSDOM/browser in
 * CI), so the registries are pure-data object literals we can safely eval.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HTML = readFileSync(join(process.cwd(), 'ui', 'index.html'), 'utf-8');

// Extract the balanced [...] / {...} literal that follows `const NAME=`.
// Scans char-by-char while tracking string ('/"/`) and comment (// , /* */)
// state so brackets inside strings/comments don't unbalance the count.
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
    if (str) {
      if (c === '\\') { i++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return HTML.slice(start, i + 1);
    }
  }
  throw new Error(`could not balance literal for ${name}`);
}

function evalLiteral(name: string): any {
  const text = extractLiteral(name);
  // eslint-disable-next-line no-eval
  return (0, eval)('(' + text + ')');
}

const PRODUCTS: any[] = evalLiteral('PRODUCT_REGISTRY');
const SCENES: Record<string, any[]> = evalLiteral('SCENE_REGISTRY');
const WORKSPACES: Record<string, any> = evalLiteral('WORKSPACE_REGISTRY');

const productIds = new Set(PRODUCTS.map((p) => p.id));
const publicIds = PRODUCTS.filter((p) => p.status === 'public').map((p) => p.id).sort();

describe('Pehverse product isolation — data model', () => {
  it('registries parsed and non-empty', () => {
    assert.ok(PRODUCTS.length >= 2, 'expected at least Luak + trials products');
    assert.ok(Object.keys(SCENES).length >= 2, 'expected scenes for at least two products');
    assert.ok(Object.keys(WORKSPACES).length >= 10, 'expected the full workspace set');
  });

  it('public products are exactly luak + trials (Kobli)', () => {
    assert.deepEqual(publicIds, ['luak', 'trials']);
    const kobli = PRODUCTS.find((p) => p.id === 'trials');
    assert.ok(kobli, 'trials product missing');
    // displayName stays configurable (Kobli / Colosseum) — internal id stable.
    assert.equal(typeof kobli.displayName, 'string');
    assert.ok(kobli.displayName.length > 0);
  });

  it('Symposium is private + hidden (no Pehverse-runtime dependency on it)', () => {
    const sym = PRODUCTS.find((p) => p.id === 'symposium');
    assert.ok(sym, 'symposium product missing');
    assert.equal(sym.status, 'private');
    assert.equal(sym.hidden, true);
    assert.notEqual(sym.status, 'public');
    assert.notEqual(sym.status, 'future');
  });

  it('future products are config-only placeholders (not public, no scenes)', () => {
    const future = PRODUCTS.filter((p) => p.status === 'future').map((p) => p.id);
    for (const id of ['kokuli', 'toba', 'nusika', 'aiiska', 'peh-pub']) {
      assert.ok(future.includes(id), `${id} should be a future placeholder`);
      assert.ok(!SCENES[id] || SCENES[id].length === 0, `${id} must not have active scenes`);
    }
  });

  it('every workspace declares product ownership (id or null), never legacy `realm`', () => {
    for (const [id, def] of Object.entries(WORKSPACES)) {
      assert.ok('product' in def, `workspace ${id} missing product ownership`);
      assert.ok(!('realm' in def), `workspace ${id} still uses legacy realm field`);
      if (def.product !== null) {
        assert.ok(productIds.has(def.product), `workspace ${id} owned by unknown product ${def.product}`);
      }
    }
  });

  it('SCENE_REGISTRY only keys known products', () => {
    for (const key of Object.keys(SCENES)) {
      assert.ok(productIds.has(key), `SCENE_REGISTRY has scenes for unknown product ${key}`);
    }
  });

  it('NO hotspot opens another product\'s workspace (the core boundary)', () => {
    for (const [productId, scenes] of Object.entries(SCENES)) {
      for (const scene of scenes) {
        for (const h of scene.hotspots || []) {
          if (h.workspace) {
            const def = WORKSPACES[h.workspace];
            assert.ok(def, `hotspot ${h.id} → unknown workspace ${h.workspace}`);
            // product:null (legacy console) is allowed; otherwise must match.
            if (def.product !== null) {
              assert.equal(
                def.product, productId,
                `ISOLATION VIOLATION: ${productId} scene "${scene.id}" hotspot "${h.id}" opens "${h.workspace}" owned by ${def.product}`,
              );
            }
          }
          if (h.scene) {
            assert.ok(
              (scenes as any[]).some((s) => s.id === h.scene),
              `hotspot ${h.id} travels to "${h.scene}" outside product ${productId}`,
            );
          }
        }
      }
    }
  });

  it('Luak owns Luak workspaces; Kobli/trials owns trials workspaces', () => {
    const luak = Object.entries(WORKSPACES).filter(([, d]) => d.product === 'luak').map(([id]) => id);
    const trials = Object.entries(WORKSPACES).filter(([, d]) => d.product === 'trials').map(([id]) => id);
    assert.ok(luak.includes('benchmark-runs'));
    assert.ok(trials.includes('adversarial-trials'));
    // The two products share NO workspace ids.
    assert.equal(luak.filter((id) => trials.includes(id)).length, 0);
  });
});

describe('Pehverse product isolation — runtime guards (source)', () => {
  it('pehOpenWorkspace refuses cross-product workspaces', () => {
    const fn = HTML.match(/function pehOpenWorkspace\([\s\S]*?\n\}/);
    assert.ok(fn, 'pehOpenWorkspace not found');
    const body = fn![0];
    assert.ok(body.includes('pehWorkspaceBelongsToActive'), 'open must consult the isolation guard');
    assert.ok(/if\s*\(\s*!pehWorkspaceBelongsToActive\(def\)\)/.test(body), 'must early-return on cross-product');
    assert.ok(body.includes('return'), 'must return without opening');
  });

  it('pehWorkspaceBelongsToActive checks product against the active product', () => {
    const fn = HTML.match(/function pehWorkspaceBelongsToActive\([\s\S]*?\n\}/);
    assert.ok(fn, 'pehWorkspaceBelongsToActive not found');
    assert.ok(/def\.product\s*===\s*pehActiveProductId\(\)/.test(fn![0]), 'must compare def.product to active product');
  });

  it('fast travel is product-local (no cross-product realm list)', () => {
    const fn = HTML.match(/function renderFastTravelMenu\([\s\S]*?\n\}/);
    assert.ok(fn, 'renderFastTravelMenu not found');
    const body = fn![0];
    assert.ok(body.includes('pehScenes(product.id)'), 'must list the active product\'s scenes');
    assert.ok(body.includes('pehGoScene('), 'scene chips must use product-local pehGoScene');
    // The only product enumeration in fast travel is the dev switcher, and it
    // is gated by pehDevMode().
    assert.ok(!body.includes('pehPublicProducts('), 'fast travel main list must not enumerate products');
    assert.ok(/pehDevMode\(\)\s*\?\s*renderPehDevSwitcher/.test(body), 'dev switcher must be gated by pehDevMode()');
  });

  it('dev product switcher is hidden in release and never auto-enables', () => {
    const dev = HTML.match(/function pehDevMode\([\s\S]*?\n\}/);
    assert.ok(dev, 'pehDevMode not found');
    const body = dev![0];
    assert.ok(body.includes("localStorage.getItem('pehverse-dev')==='1'"), 'dev mode opt-in via localStorage flag');
    assert.ok(body.includes('window.PEHVERSE_DEV'), 'dev mode honors explicit window flag');
    // Default (no flag) → false: the function returns false on the catch and
    // the localStorage check is a strict === '1', so it cannot default-on.
    assert.ok(/return false/.test(body), 'must default to false');

    const sw = HTML.match(/function pehDevSwitchProduct\([\s\S]*?\n\}/);
    assert.ok(sw, 'pehDevSwitchProduct not found');
    assert.ok(/if\s*\(\s*!pehDevMode\(\)\s*\)\s*return/.test(sw![0]), 'product switch must no-op outside dev mode');
    assert.ok(sw![0].includes('state.pehverse.workspaces=[]'), 'switching product must clear product-local workspaces');
  });

  it('active product resolves to a single public product (build flag → dev → default)', () => {
    const fn = HTML.match(/function pehResolveActiveProduct\([\s\S]*?\n\}/);
    assert.ok(fn, 'pehResolveActiveProduct not found');
    const body = fn![0];
    assert.ok(body.includes('window.PEHVERSE_PRODUCT'), 'Option A: build/deploy flag');
    assert.ok(body.includes('PEH_DEFAULT_PRODUCT'), 'falls back to the configured default');
    assert.ok(/status\s*===\s*'public'/.test(body), 'never resolves to a future/private product');
  });

  it('no legacy cross-product pehTravel(realm, scene) function remains', () => {
    assert.ok(!/function pehTravel\(/.test(HTML), 'legacy cross-product pehTravel must be removed');
    assert.ok(!HTML.includes('REALM_REGISTRY'), 'legacy REALM_REGISTRY must be renamed to PRODUCT_REGISTRY');
  });

  it('"realm" is gone from the engine as routing architecture', () => {
    // Phase 1.2 terminology cleanup: the engine block must not use "realm".
    const engine = HTML.slice(HTML.indexOf('PEHVERSE WORLD ENGINE'));
    assert.ok(!/\brealm\b/i.test(engine.replace(/\.peh-ft-realm/g, '')),
      'engine code/comments must not use "realm" as routing architecture');
  });
});

// ── Behavioural sandbox ────────────────────────────────────────────────
// Extract the pure isolation functions + registries and execute them with
// stubbed globals, so we prove the actual runtime guarantees (not just that
// the source mentions a guard). The functions reference `state`, `window`,
// `location`, `localStorage` — we supply those as constructor params (their
// names are not reserved), giving each scenario fresh closures.
function extractFn(name: string): string {
  const anchor = HTML.indexOf('function ' + name + '(');
  assert.ok(anchor > -1, `function ${name} not found`);
  let i = anchor;
  while (i < HTML.length && HTML[i] !== '{') i++;
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
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return HTML.slice(anchor, i + 1); }
  }
  throw new Error(`could not balance function ${name}`);
}

function makeStorage(seed: Record<string, string> = {}) {
  const m = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

const ENGINE_SRC = [
  'const PRODUCT_REGISTRY=' + extractLiteral('PRODUCT_REGISTRY') + ';',
  'const SCENE_REGISTRY=' + extractLiteral('SCENE_REGISTRY') + ';',
  'const WORKSPACE_REGISTRY=' + extractLiteral('WORKSPACE_REGISTRY') + ';',
  (HTML.match(/const PEH_DEFAULT_PRODUCT='[^']+';/) || ['const PEH_DEFAULT_PRODUCT=\'luak\';'])[0],
  extractFn('pehProduct'),
  extractFn('pehPublicProducts'),
  extractFn('pehFutureProducts'),
  extractFn('pehScenes'),
  extractFn('pehScene'),
  extractFn('pehWorkspaceDef'),
  extractFn('pehDevMode'),
  extractFn('pehResolveActiveProduct'),
  extractFn('pehActiveProduct'),
  extractFn('pehActiveProductId'),
  extractFn('pehWorkspaceBelongsToActive'),
].join('\n');

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const makeEngine = new Function(
  'state', 'window', 'location', 'localStorage',
  ENGINE_SRC + '\nreturn {pehResolveActiveProduct,pehActiveProductId,pehWorkspaceBelongsToActive,pehDevMode};',
) as (state: any, window: any, location: any, localStorage: any) => any;

function engine(opts: { product?: string; win?: any; ls?: Record<string, string> } = {}) {
  const state = { pehverse: { product: opts.product ?? 'luak' } };
  return makeEngine(state, opts.win ?? {}, undefined, makeStorage(opts.ls));
}

describe('Pehverse product isolation — runtime behaviour (sandbox)', () => {
  it('default runtime resolves to the single default product (luak)', () => {
    const e = engine();
    assert.equal(e.pehResolveActiveProduct(), 'luak');
    assert.equal(e.pehDevMode(), false, 'dev mode must be off by default → no switcher in release');
  });

  it('a private product can NEVER become active (build flag ignored)', () => {
    assert.equal(engine({ win: { PEHVERSE_PRODUCT: 'symposium' } }).pehResolveActiveProduct(), 'luak');
    // Even if state is tampered to a private product, the active accessor falls back.
    assert.equal(engine({ product: 'symposium' }).pehActiveProductId(), 'luak');
  });

  it('a future product can NEVER become active (build flag ignored)', () => {
    assert.equal(engine({ win: { PEHVERSE_PRODUCT: 'kokuli' } }).pehResolveActiveProduct(), 'luak');
    assert.equal(engine({ product: 'toba' }).pehActiveProductId(), 'luak');
  });

  it('the dev localStorage override is IGNORED unless dev mode is on', () => {
    // Saved product but no dev flag → stays default.
    assert.equal(engine({ ls: { 'pehverse-product': 'trials' } }).pehResolveActiveProduct(), 'luak');
    // Dev flag on → override honored (dev/demo only).
    const dev = engine({ ls: { 'pehverse-dev': '1', 'pehverse-product': 'trials' } });
    assert.equal(dev.pehDevMode(), true);
    assert.equal(dev.pehResolveActiveProduct(), 'trials');
  });

  it('a valid build flag selects the product (Option A, one per runtime)', () => {
    assert.equal(engine({ win: { PEHVERSE_PRODUCT: 'trials' } }).pehResolveActiveProduct(), 'trials');
  });

  it('cross-product workspace ownership is enforced both directions', () => {
    const luak = engine({ product: 'luak' });
    assert.equal(luak.pehWorkspaceBelongsToActive(WORKSPACES['benchmark-runs']), true);
    assert.equal(luak.pehWorkspaceBelongsToActive(WORKSPACES['adversarial-trials']), false, 'Luak must not open a Kobli workspace');
    assert.equal(luak.pehWorkspaceBelongsToActive(WORKSPACES['console']), true, 'null-product console is per-product');

    const trials = engine({ product: 'trials' });
    assert.equal(trials.pehWorkspaceBelongsToActive(WORKSPACES['adversarial-trials']), true);
    assert.equal(trials.pehWorkspaceBelongsToActive(WORKSPACES['benchmark-runs']), false, 'Kobli must not open a Luak workspace');
  });
});
