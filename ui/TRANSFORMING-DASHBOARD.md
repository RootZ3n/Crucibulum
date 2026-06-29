# Transforming Dashboard Panel System

A reusable "Voltron / pop-up book" panel system for Pehverse product UIs. Every
hotspot panel renders through **one shell** in one of three modes:

| Mode | What it is | Scroll |
|------|------------|--------|
| **solo** | One rich panel pops up **next to its hotspot** on the map. Peh appears at the hotspot. At-a-glance. | avoid (panel is sized to fit) |
| **dashboard** | All panels **merge** into one parent surface laid out by a saved preset — a seamless cockpit wall, not separate windows. | **never per-tile** (summarise instead) |
| **detail** | A single panel expanded full-screen. | allowed |

Dashboard mode is **"activate a saved layout preset inside one parent surface"**,
**not** "open every panel as its own window".

## The three data layers (all inline in `ui/index.html`)

1. **`PANEL_META`** — per-panel template metadata: `{role, priority, solo:{w,h}}`.
   Augments `WORKSPACE_REGISTRY` (the single source of title/icon/route/grid),
   it does not fork it.
2. **`LAYOUT_PRESETS`** — per-**product** merged-dashboard preset:
   `{id, label, columns, rows, areas, slots}` where `areas` is a CSS
   `grid-template-areas` string and `slots` maps each panel id → grid area.
3. **`PANEL_CONTENT`** — per-panel `{ dashboard() }` (and optional `solo`/`detail`).
   `dashboard()` MUST summarise (meters/stats/badges/ranks/`pehOpenDetailBtn`)
   so a tile never needs a scrollbar.

## The primitives

- `renderDashboardSurface(product, scene)` — the **DashboardSurface**: one
  `.peh-dash-surface` → `.peh-dash-wall` (the preset grid) → seamless
  `.peh-dash-tile` children. Falls back to the map if a product has no preset.
- `renderTransformingPanel(defId, mode, preset)` — the **PanelShell**.
- `pehPanelDashboardBody(defId, def)` — picks `PANEL_CONTENT[id].dashboard()`,
  else a generic compact fallback.
- `pehOpenSolo(defId)` — from a dashboard tile, drop back to the map and pop the
  panel up at its hotspot.
- `renderPehStage()` branches on `state.pehverse.mode`:
  `dashboard → renderDashboardSurface`, else `renderPehMap` (map + solo windows).

## Seamless / scrollless styling (`ui/crucibulum.css`)

- `.peh-dash-wall` is **one** `display:grid` with `gap:1px` over a
  divider-coloured background → adjacent tiles touch as a hairline-joined wall;
  only the **outer** wall is rounded and shadowed.
- `.peh-dash-tile` has `border-radius:0; box-shadow:none` (no individual chrome).
- `.peh-dash-tile-body` is `overflow:hidden` — **the cockpit invariant**: a tile
  never gets its own scrollbar.

## Reusing for another product (Howa, Kokuli, Toba, Nusika, Pehlichi …)

1. Add the product's panels to `WORKSPACE_REGISTRY` (already required today).
2. Add a `PANEL_META` entry per panel (`role`, `priority`, `solo` size).
3. Add **one** `LAYOUT_PRESETS[<productId>]` entry — design that product's wall
   with `columns`/`rows`/`areas` and a `slots` map. (e.g. Howa = an "Arena
   Control" wall: stress / adversarial / failure / endurance regions.)
4. Add `PANEL_CONTENT[<panelId>].dashboard()` compact summaries.

No new files, no shell/surface changes — the template reads the data. A product
without a preset still works: dashboard mode falls back to its map view.

## Tests

`tests/luak-transforming-dashboard.test.ts` pins the data (PANEL_META +
preset coverage), the source wiring (surface/shell/preset-not-open-all), and the
style invariants (seamless tiles, no per-tile scroll). Run `npm run build && npm test`.
