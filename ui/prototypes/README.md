# UI prototypes — Speedway / Voltron dashboard

Throwaway, self-contained design prototypes for the Luak speedway UI, built
interactively with Zen (2026-06-29). Each is a single HTML file wired to the
**live** API at `http://localhost:18795`; serve them from any localhost port
(CORS allows `localhost:*`) e.g. `python3 -m http.server 18888 --directory ui/prototypes`.

- **speedway.html** — the Voltron transformation: draggable hotspot windows that
  fly into a seamless borderless dashboard wall (FLIP), and break apart when you
  pull a tile out. Console is forced off in dashboard mode.
- **garage.html** — the Pit Lane registry console (Card ⇄ Console): add/test
  providers, add/bulk models, local-vs-local. Real registry CRUD.
- **workshop.html** — Test Library & Evidence Room: disciplines → tests (what each
  checks) → results → readable pass/fail receipt. Real /api/tasks + /api/runs.
- **grandstand.html** — per-discipline leaderboards + bar graph ("pick Coding →
  meet the boss"). Mock adapters hidden.

These are the agreed look/feel/behavior to fold into `ui/index.html`. Not production.
