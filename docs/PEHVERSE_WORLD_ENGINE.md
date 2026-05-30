# Pehverse World Engine

The Pehverse world engine is the reusable, **data-driven** navigation shell
that wraps the existing functional UI. It replaces the SaaS-dashboard feel
with a sense of *visiting places*: the world is navigation, the windows are
work.

> **Build order = public release order.** The engine is built so each realm
> launches in turn by adding registry data — never by forking the shell.
>
> 1. **Luak** + **Kobli/Colosseum (`trials`)** — launch together (prototype, shipped here)
> 2. **Kokuli**
> 3. **Toba**
> 4. **Nusika**
> 5. **Aiiska** + **Peh-pub**
> 6. **Symposium / name TBD** — *lab-only, private, built last.* It must
>    **reuse this engine, not define it**, and is absent from public navigation.

All of this lives inline in `ui/index.html` (JS) and `ui/crucibulum.css`
(styles), under the `PEHVERSE WORLD ENGINE` banners.

---

## Modules

| Module | What it owns | Where |
| --- | --- | --- |
| **PehverseShell** | current realm/scene, open workspaces, immersive vs dashboard mode, mobile vs desktop layout, fast-travel access. Does **not** depend on Symposium. | `renderPehverse()` + `state.pehverse` |
| **RealmRegistry** | the list of realms (public / future / private). `displayName` is configurable; internal `id` is the stable routing key. | `REALM_REGISTRY` |
| **SceneRegistry** | scenes per realm — title, description, Peh variant, hotspots. | `SCENE_REGISTRY` |
| **HotspotLayer** | % positioned tappable hotspots that open workspaces and/or travel to scenes. | `renderHotspotLayer()` |
| **WorkspaceManager** | open / close / dock / minimize / focus workspace panels; dock-right, dock-bottom, fullscreen, dashboard tile, mobile sheet. | `pehOpenWorkspace()` etc. + `WORKSPACE_REGISTRY` |
| **FastTravelMenu** | instant jump to any public realm/scene, from anywhere. | `renderFastTravelMenu()` |
| **Dashboard / Immersive mode** | immersive = scene-first; dashboard = workspace-first. | `pehSetMode()` / `pehToggleMode()` |

### Why ids, not names

`Colosseum` may be renamed `Kobli` (or back). The realm is therefore
registered under the stable internal id **`trials`** with a configurable
`displayName`. Hotspots, saved links, and `localStorage` all reference ids,
so a rename is a one-field data edit that breaks nothing.

### Mode behaviour

- **Immersive** docks exactly **one** workspace (the focused one) over the
  scene and uses the bottom taskbar as the switcher — deliberately avoiding
  overlapping-window chaos. Multiple workspaces stay open (visible as taskbar
  chips); minimizing one reveals the scene again.
- **Dashboard** tiles **all** open workspaces in a responsive grid (1 col
  mobile → 2–3 cols desktop). With nothing open it shows a chooser of the
  realm's spaces.

### Responsive behaviour

- **Mobile-first (base CSS):** the scene is a world-map / theme-park hub with
  pulsing hotspot pins; workspaces open as full-bleed bottom sheets; the
  taskbar and a Fast-Travel button are always within thumb reach.
- **Desktop (≥880px):** docked side / bottom / fullscreen panels and the
  multi-tile dashboard grid — workspace-style panels akin to Debian
  workspaces.
- Fast travel reaches anything in 2–3 seconds. Keyboard: **Alt+T** = fast
  travel, **Alt+M** = toggle mode, **Esc** = close the fast-travel overlay.

---

## How to add the next realm (e.g. Kokuli)

Everything is data. No new shell code, no per-realm page.

### 1. Flip the realm from `future` to `public` in `REALM_REGISTRY`

```js
{id:'kokuli', displayName:'Kokuli', status:'public', order:2,
 tagline:'…', blurb:'…',
 accent:'#34d399', accent2:'#22d3ee', peh:'seed', defaultScene:'<first-scene-id>'},
```

`status` values: `public` (travelable, in Fast Travel), `future` (shown as a
greyed "Opening later" chip, not travelable), `private` (absent from public
navigation — used only by lab-only Symposium; also set `hidden:true`).

### 2. Add the realm's scenes to `SCENE_REGISTRY`

```js
kokuli:[
  {id:'…', title:'…', desc:'…', peh:'seed', hotspots:[
    {id:'…', label:'…', x:30, y:60, workspace:'<workspace-id>'},   // opens a workspace
    {id:'…', label:'…', x:80, y:66, scene:'<other-scene-id>'},     // travels within the realm
    {id:'…', label:'…', x:50, y:48, workspace:'<id>', scene:'<id>'} // travel + open
  ]}
]
```

`x`/`y` are percentages (responsive). A hotspot may open a workspace, travel
to a sibling scene, or both.

### 3. Register the realm's workspaces in `WORKSPACE_REGISTRY`

```js
'<workspace-id>':{realm:'kokuli', title:'…', dock:'right',
  // pick ONE kind:
  kind:'lane',  tab:'<TAB_CONFIG key>',          // wraps an existing functional lane (live, interactive)
  // kind:'placeholder', blurb:'…', relatedTab:'<tab>',  // atmospheric stub + "open console" affordance
  // kind:'deck',                                  // the full classic console
  peh:'seed'},
```

- `kind:'lane'` reuses a real, working lane (`renderLane`, `renderDashboard`,
  `renderProvidersView`) — this is how existing functionality is preserved as
  workspaces. The focused lane workspace owns `state.activeTab`.
- `kind:'placeholder'` is an atmospheric stub (no final art). Give it a
  `relatedTab` so the legacy lane stays reachable via an "open console"
  button.
- `kind:'deck'` embeds the entire classic command deck (the `console`
  workspace), which preserves **every** legacy access path.
- `dock` is the default desktop placement (`right` / `bottom` / `fullscreen`);
  mobile always forces a bottom sheet.

That is the whole checklist — no shell edits.

---

## Lab-only Symposium (built last)

Symposium is already registered as a **placeholder you cannot reach**:

```js
{id:'symposium', displayName:'Symposium', status:'private', order:99,
 …, hidden:true}
```

`status:'private'` keeps it out of `pehPublicRealms()` / `pehFutureRealms()`,
so it never appears in Fast Travel or the public world. When the lab UI is
built last, it gets its scenes/workspaces exactly like any other realm — it
**consumes** this engine and must never become the thing the public
architecture is anchored around.
