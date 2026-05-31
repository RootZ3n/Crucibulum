# Pehverse World Engine — single-product world-shell

The Pehverse world engine is a reusable, **data-driven, single-product**
navigation shell that wraps a product's functional UI. It replaces the
SaaS-dashboard feel with a sense of *visiting a place*: the world is
navigation, the windows are work.

## Pehverse is an ecosystem pattern, not a runtime router

**Pehverse is the shared ecosystem — naming, design language, UX philosophy,
and mythology — NOT a runtime that routes between products.** Each product
**owns its own world-shell**: it instantiates this engine with its own
products-of-one config, scenes, and workspaces, and ships standalone.

- **Each product is a completely standalone app.** Luak and Howa launch
  together, but they are still **separate products** — separate shells,
  separate deployments.
- **No cross-product navigation in release.** Exactly **one** product is live
  per runtime. Luak cannot open Howa's workspaces and vice versa; Fast Travel
  jumps only between *areas (scenes) inside the active product*.
- **The dev switcher is not a public feature.** It exists purely for local
  development/demo convenience and is hidden whenever dev mode is off.
- **Future products copy/instantiate the pattern** — they are **not** plugged
  into one shared public shell. The terms below define the vocabulary:
  - **product** — a standalone app / the product boundary.
  - **scene / area** — a place *inside* the current product.
  - **workspace** — a functional panel opened *inside* the current product.
  - **Pehverse** — the ecosystem & design language (lore/branding), never a
    runtime router. The word *realm* belongs to lore/branding copy, never to
    routing architecture.

> **Public release / build order** (informational — each ships as its own
> standalone product, instantiating this pattern, never plugged into one
> shared app):
> Luak + Howa (`howa`) → Kokuli → Toba → Nusika → Aiiska +
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

A product's public `displayName` (e.g. `Howa`) may change without touching its
stable internal `id` (e.g. **`howa`**). Hotspots, saved links, and
`localStorage` all reference ids, so a display-name change is a one-field data
edit that breaks nothing.

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

Each product is its own standalone app. The right model is to **copy /
instantiate the pattern** for the new product (its own world-shell, ideally
its own deployment) — **never plug it into one shared public shell**. Adding
a product to the registries is config; it does **not** make it reachable from
inside another product at runtime.

> The steps below show how the registries hold a product's data. In a
> standalone deployment that product would be the one selected by
> `window.PEHVERSE_PRODUCT` / `PEH_DEFAULT_PRODUCT`; the others remain
> `future` config examples. Co-registering Luak and Howa here is the
> launch-together pair plus dev convenience — not a shared public runtime.

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
