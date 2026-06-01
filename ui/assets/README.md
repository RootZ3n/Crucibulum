# Luak UI assets — 1920s Racetrack Speedway

Drop-in art for the Luak (`peh-product-luak`) world shell. The world-engine
already references these stable, descriptive filenames, so adding a file here
is the *only* step needed — no code change — to light up the real art.

| Filename | Role | Wired by |
| --- | --- | --- |
| `luak-vintage-racing-map.png` | Central track-board / world map art for the Speedway hub (desktop + mobile share it). | `.peh-product-luak .peh-scene-atmos` background (top layer; CSS track-board renders underneath as a fallback). |
| `luak-responsive-racing-map.png` | Optional narrow/portrait crop of the map for small screens. | `@media (max-width:599px) .peh-product-luak .peh-scene-atmos`. |
| `peh-vintage-racer-squirrel.png` | Peh as a 1920s race-driver / mechanic squirrel — the in-world guide. | Swap into the per-location `pehSlot` medallion (`pehSquirrelSilhouette()` is the placeholder until then). |

## Status on this machine (2026-06-01)

The documented `/mnt/data/*.png` source paths were **absent**, but the generated
art was found at the repo root (ChatGPT default filenames) and **copied here**:

| Copied to | Source (repo root) | Depicts |
| --- | --- | --- |
| `luak-vintage-racing-map.png` | `ChatGPT Image May 31, 2026, 12_46_24 PM.png` (1672×941) | The Luak 1920s racing world map — Speedway hub, Grandstand, Timing Tower, Pit Lane, Victory Circle, Workshop + Peh placeholders, with desktop & mobile views. |
| `peh-vintage-racer-squirrel.png` | `ChatGPT Image May 31, 2026, 12_55_28 PM.png` (1122×1402) | Peh as a 1920s race-driver squirrel — leather cap, goggles, LUAK suit, #32 helmet. |

Later replaced (2026-06-01) by purpose-built full-screen comps:

| Asset | Used as | Source |
| --- | --- | --- |
| `luak-vintage-racing-map.png` | **Desktop** scene background (`cover`, ≥880px). | `ChatGPT Image Jun 1, 2026, 06_20_14 AM (1).png` (landscape comp). |
| `luak-responsive-racing-map.png` | **Mobile/portrait** scene background (`cover`, ≤879px). | `ChatGPT Image Jun 1, 2026, 06_20_14 AM (2).png` (portrait comp w/ bottom nav). |

These comps already paint the seven location labels and empty brass ring
"sockets", so the live shell hides its own hotspot labels, Peh slot medallion,
and guide portrait for Luak (`.peh-product-luak` rules) and seats the
interactive brass pins into the painted sockets. All of that is **reversible**:
drop a clean, label-free map back in and re-show those rules to return to the
fully engine-drawn markers. The parchment wash remains the fallback if a PNG is
removed.

Known first-pass limitation: one hotspot coordinate set serves both comps
(doctrine forbids a separate mobile registry), and `cover` crops differently
per viewport, so pin↔socket alignment is exact on the layout the coords target
(desktop) and approximate on the other. A clean label-free map would let the
engine draw aligned markers on both.
