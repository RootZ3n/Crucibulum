# Pehverse World Engine — single-product world-shell

The Pehverse world engine is a reusable, **data-driven, single-product**
navigation shell that wraps a product's functional UI. It replaces the
SaaS-dashboard feel with a sense of *visiting a place*: the world is
navigation, the windows are work.

> **Product isolation (Phase 1.1).** Each public product (Luak, Kobli, …) is a
> **completely standalone app**. Products belong to the Pehverse ecosystem by
> name, theme, design language, and purpose **only** — there is **no
> cross-product runtime navigation**. Exactly **one** product is live per
> runtime. Luak cannot open Kobli's workspaces and vice versa; Fast Travel
> jumps between *areas (scenes) inside the active product* only.
>
> This is a reusable *pattern*, not a global multi-product runtime. Future
> products are **config/doc examples**, not runtime destinations, until each
> ships as its own product.

> **Public release / build order** (informational — each ships as its own
> standalone product, not as a realm added to one shared app):
> Luak + Kobli/Colosseum (`trials`) → Kokuli → Toba → Nusika → Aiiska +
> Peh-pub → **Symposium / name TBD** (lab-only, `private`, built last; must
> **reuse this engine, never define it**, and is absent from all navigation).

All of this lives inline in `ui/index.html` (JS) and `ui/crucibulum.css`
(styles), under the `PEHVERSE WORLD ENGINE` banner.

---

## Modules

| Module | What it owns | Where |
| --- | --- | --- |
| **PehverseShell** | the **active product**, current scene, open workspaces, immersive vs dashboard mode, mobile vs desktop layout, fast travel. No Symposium dependency. | `renderPehverse()` + `state.pehverse` |
| **ProductRegistry** | standalone products (`public` / `future` / `private`). `displayName` configurable; internal `id` is the stable key. | `PRODUCT_REGISTRY` |
| **SceneRegistry** | scenes (areas) **per product** — title, description, Peh variant, hotspots. | `SCENE_REGISTRY` |
| **HotspotLayer** | % positioned hotspots that open **this product's** workspaces and/or travel to **this product's** scenes. | `renderHotspotLayer()` |
| **WorkspaceManager** | open/close/dock/minimize/focus, **product-scoped ownership** (the isolation boundary). dock-right/bottom/fullscreen, dashboard tile, mobile sheet. | `pehOpenWorkspace()` + `WORKSPACE_REGISTRY` |
| **FastTravelMenu** | instant jump between the **active product's** scenes only. | `renderFastTravelMenu()` |
| **Dashboard / Immersive mode** | immersive = scene-first; dashboard = workspace-first. | `pehSetMode()` / `pehToggleMode()` |

### The isolation boundary

- **Active product** is resolved once at load by `pehResolveActiveProduct()`:
  **Option A** — a build/deploy flag `window.PEHVERSE_PRODUCT` (highest
  priority); **Option B** — a `localStorage` override honored **only in dev
  mode**; otherwise `PEH_DEFAULT_PRODUCT` (`'luak'`). It never resolves to a
  `future`/`private` product.
- **Workspaces** carry a `product` owner. `pehWorkspaceBelongsToActive(def)`
  gates `pehOpenWorkspace()` — opening another product's workspace is a
  no-op (logged). `product:null` is the **per-product legacy console**,
  available to whichever product is active.
- **Scene travel** (`pehSetScene` / `pehGoScene`) only honors a scene id that
  belongs to the active product.
- **Fast Travel** lists the active product's scenes only — no cross-product
  list.

### Dev-only product switcher (Option B)

A product switcher exists **only for dev/demo** and is **hidden in
public/release**. It is gated entirely by `pehDevMode()`, which is `false`
unless explicitly enabled:

- `?peh-dev=1` in the URL (persists to `localStorage 'pehverse-dev'`), or
- `window.PEHVERSE_DEV = true` set before the script.

When enabled, the switcher appears inside the Fast Travel sheet, lets you flip
between **public** products, and **clears the open workspaces** on switch
(they are product-local). Future products show as inert “config only” chips.
Showing multiple products together is **dev/demo behaviour, not public
runtime**.

### Why ids, not names

`Colosseum` may be renamed `Kobli` (or back). The product is registered under
the stable internal id **`trials`** with a configurable `displayName`.
Hotspots, saved links, and `localStorage` all reference ids, so a rename is a
one-field data edit that breaks nothing.

### Mode & responsive behaviour

- **Immersive** docks exactly one focused workspace over the scene; the bottom
  taskbar is the switcher (avoids overlapping-window chaos). **Dashboard**
  tiles all open workspaces; with none open it shows a chooser of the active
  product's spaces. Keyboard: **Alt+T** fast travel, **Alt+M** mode, **Esc**
  close.
- **Mobile-first:** the scene is a world-map / theme-park hub (pin hotspots,
  bottom-sheet workspaces, thumb-reach fast travel). **Desktop (≥880px):**
  docked side/bottom/fullscreen panels and a multi-tile dashboard grid.

---

## How to add the next product (e.g. Kokuli) — as a STANDALONE product

Each product is its own standalone app. Adding one is data; it does **not**
make it reachable from inside another product at runtime.

### 1. Flip the product from `future` to `public` in `PRODUCT_REGISTRY`

```js
{id:'kokuli', displayName:'Kokuli', status:'public', order:2,
 tagline:'…', blurb:'…',
 accent:'#34d399', accent2:'#22d3ee', peh:'seed', defaultScene:'<first-scene-id>'},
```

`status`: `public` (a shippable standalone product), `future` (config
example only — never a runtime destination), `private` (lab-only; also set
`hidden:true` — used only by Symposium).

### 2. Add the product's scenes to `SCENE_REGISTRY`

```js
kokuli:[
  {id:'…', title:'…', desc:'…', peh:'seed', hotspots:[
    {id:'…', label:'…', x:30, y:60, workspace:'<a kokuli workspace>'}, // opens THIS product's workspace
    {id:'…', label:'…', x:80, y:66, scene:'<another kokuli scene>'},   // travels within THIS product
  ]}
]
```

A hotspot may only open a workspace **owned by the same product** (or the
`null` console) and only travel to a scene **in the same product**. The test
suite (`tests/pehverse-product-isolation.test.ts`) fails the build if a
hotspot crosses the boundary.

### 3. Register the product's workspaces in `WORKSPACE_REGISTRY`

```js
'<workspace-id>':{product:'kokuli', title:'…', dock:'right',
  kind:'lane',  tab:'<TAB_CONFIG key>',          // wraps a live functional lane
  // kind:'placeholder', blurb:'…', relatedTab:'<tab>',  // atmospheric stub
  // kind:'deck',                                  // full classic console
  peh:'seed'},
```

- `product` is the ownership/isolation field — **required**.
- `kind:'lane'` reuses a real lane (`renderLane`/`renderDashboard`/
  `renderProvidersView`). `kind:'placeholder'` is a stub (give it a
  `relatedTab` so the legacy lane stays reachable). `kind:'deck'` /
  `product:null` is the per-product legacy console.

### 4. Selecting which product is live

- **Production:** set `window.PEHVERSE_PRODUCT='kokuli'` at deploy/build time
  (Option A), or change `PEH_DEFAULT_PRODUCT`. One product per runtime.
- **Dev/demo:** enable dev mode (`?peh-dev=1`) and use the switcher.

There is intentionally **no public cross-product launcher**. If an external
ecosystem launcher is ever wanted, it would be a separate, deliberate feature
(e.g. external links between independently-deployed products) — not the
internal runtime navigation.

---

## Lab-only Symposium (built last)

Symposium is registered as a product you cannot reach:

```js
{id:'symposium', displayName:'Symposium', status:'private', …, hidden:true}
```

`status:'private'` keeps it out of `pehPublicProducts()` /
`pehFutureProducts()` and out of `pehResolveActiveProduct()`, so it can never
become the active product through normal config. Built last, it **consumes**
this engine and must never be the thing the public architecture is anchored
around.
