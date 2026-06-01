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

The map is now the immersive scene background (`contain`, on a parchment
workbench); the racer art is the framed "pit guide" portrait
(`renderPehGuide`). The parchment wash, brass course-marker hotspots, and Peh's
pit-badge silhouette remain the graceful fallback if a PNG is ever removed.

A dedicated narrow-crop `luak-responsive-racing-map.png` is still an optional
future drop-in; until then the single map serves both layouts (`contain` keeps
the whole circuit visible on phones).
