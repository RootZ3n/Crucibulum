#!/usr/bin/env python3
"""
Luak — synthetic vision fixture generator.

Deterministic, reproducible, no external assets, no PII. Produces the
5 PNG fixtures referenced by tasks/vision/<id>/manifest.json:

  fixtures/vision/vision-ocr-001.png
  fixtures/vision/vision-ui-001.png
  fixtures/vision/vision-chart-001.png
  fixtures/vision/vision-object-count-001.png
  fixtures/vision/vision-uncertainty-001.png

Usage:
  python3 scripts/generate-vision-fixtures.py

Re-running this script must produce byte-identical PNGs (so sha256
hashes pinned in the manifests stay stable). All PNGs:
  - are under 50 KB
  - use only colour + simple shapes / text drawn with PIL's default font
  - encode no PII, no copyrighted material, no real screenshots

To produce different fixture content, bump the VERSION constant below
AND re-run sha256 on the produced files; update the matching manifest.
"""

from __future__ import annotations
import hashlib
import os
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
except ImportError:
    print("PIL/Pillow is required: pip install Pillow", file=sys.stderr)
    sys.exit(2)

# Bump if fixture content changes intentionally; lets the operator
# detect drift if re-running this script silently changes the bytes.
VERSION = "2026-05-25.v1"

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "fixtures" / "vision"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Use the bundled default font so this generator works with no font
# install. The default is monospace-ish and renders deterministically.
FONT = ImageFont.load_default()


def save_png(img: Image.Image, name: str) -> Path:
    p = OUT_DIR / name
    # optimize=True + a fixed pnginfo would normally make this perfectly
    # deterministic; PIL's save is already deterministic for a given
    # version + image bytes.
    img.save(p, format="PNG", optimize=True)
    return p


def make_ocr() -> Path:
    """OCR fixture: large readable text "CRUCIBLE 425"."""
    img = Image.new("RGB", (600, 240), color=(245, 245, 250))
    d = ImageDraw.Draw(img)
    # Title bar
    d.rectangle([(0, 0), (600, 60)], fill=(28, 28, 64))
    # Drawn-text content is intentionally pinned to the original "Crucible"
    # branding to keep the manifest sha256 hashes stable across the rebrand.
    # Do NOT change this string without also re-pinning the fixture hashes.
    d.text((20, 22), "Crucible POC receipt — synthetic fixture", fill=(255, 255, 255), font=FONT)
    # Large body text — the OCR target.
    d.text((40, 100), "CRUCIBLE 425", fill=(20, 20, 28), font=FONT)
    # A footer note that should NOT match the OCR regex (extra prose).
    d.text((40, 200), "fixture version " + VERSION, fill=(120, 120, 130), font=FONT)
    return save_png(img, "vision-ocr-001.png")


def make_ui() -> Path:
    """UI mock: a button labelled RUN BENCHMARK whose right edge is
    visibly clipped by the panel boundary (the operator's expected
    diagnosis)."""
    img = Image.new("RGB", (800, 400), color=(18, 22, 40))
    d = ImageDraw.Draw(img)
    # Side panel that does the clipping.
    d.rectangle([(540, 0), (800, 400)], fill=(8, 10, 22))
    d.text((560, 20), "Provider Bay", fill=(180, 200, 230), font=FONT)
    # Card with the clipped button.
    d.rectangle([(40, 40), (560, 360)], outline=(80, 100, 140), width=2, fill=(28, 32, 56))
    d.text((60, 60), "Active Arena", fill=(180, 200, 230), font=FONT)
    # The big primary button — extends past the card edge on purpose.
    # Drawn with a bright colour so the clip is obvious.
    d.rectangle([(60, 200), (640, 260)], fill=(255, 90, 100))
    d.text((180, 220), "RUN BENCHMARK >>", fill=(255, 255, 255), font=FONT)
    # Tag the clip with a label that the operator (or judge) can
    # cross-reference, but NOT the target answer string.
    d.text((60, 280), "primary action overflows card boundary -->", fill=(220, 220, 230), font=FONT)
    return save_png(img, "vision-ui-001.png")


def make_chart() -> Path:
    """Bar chart with three labelled bars. Peak is "Wed" at 87."""
    img = Image.new("RGB", (640, 360), color=(252, 252, 252))
    d = ImageDraw.Draw(img)
    # Title
    d.text((20, 16), "Weekly volume (synthetic)", fill=(20, 20, 30), font=FONT)
    # Axes
    d.line([(60, 60), (60, 300)], fill=(40, 40, 40), width=2)
    d.line([(60, 300), (600, 300)], fill=(40, 40, 40), width=2)
    # 5 bars; the peak is Wed at 87 (per manifest expected pattern).
    bars = [("Mon", 35), ("Tue", 52), ("Wed", 87), ("Thu", 41), ("Fri", 60)]
    x = 100
    width = 80
    gap = 20
    for label, value in bars:
        # Scale: 87 -> 230 px high
        h = int((value / 100) * 230)
        top = 300 - h
        colour = (220, 60, 80) if label == "Wed" else (60, 120, 180)
        d.rectangle([(x, top), (x + width, 300)], fill=colour)
        d.text((x + 16, top - 18), str(value), fill=(20, 20, 30), font=FONT)
        d.text((x + 24, 308), label, fill=(20, 20, 30), font=FONT)
        x += width + gap
    return save_png(img, "vision-chart-001.png")


def make_object_count() -> Path:
    """Seven red dots on a white background, non-overlapping, large enough
    to be unambiguously countable (radius ~24 px)."""
    img = Image.new("RGB", (400, 400), color=(255, 255, 255))
    d = ImageDraw.Draw(img)
    centers = [
        ( 80,  80),
        (200,  60),
        (320,  90),
        (110, 200),
        (280, 200),
        (180, 320),
        (310, 330),
    ]
    r = 28
    for (cx, cy) in centers:
        d.ellipse([(cx - r, cy - r), (cx + r, cy + r)], fill=(225, 35, 55))
    # Watermark so the operator can identify the fixture origin without
    # leaking any answer.
    d.text((10, 380), f"fixture {VERSION}", fill=(180, 180, 180), font=FONT)
    return save_png(img, "vision-object-count-001.png")


def make_uncertainty() -> Path:
    """Heavily-blurred text that should be unreadable. The model's
    correct answer is "I cannot read this clearly" or similar uncertainty
    admission.

    Phase 10 calibration (UNCERTAINTY_VERSION = 2026-05-26.v2):
      v1 (2026-05-25.v1) added a readable header label
      "UNCERTAINTY POC — answer: 'unreadable'" at the TOP of the image
      in plain text on a dark stripe. The intent was a hint to the
      model that the body was meant to be illegible text. In practice
      both Phase 9 models (xiaomi/mimo-v2-omni AND openai/gpt-5.4-mini)
      OCR'd the readable header and were marked as 'hallucinating' for
      transcribing what was actually visible. That was a fixture
      mistake, not a model failure. See
      reports/test-validity/cards/vision/vision-uncertainty-001-phase10-audit.md.

      v2 removes the readable header and combines a heavy gaussian
      blur with a moderate pixelation pass so the body has visible
      text-shaped horizontal bands but no recognisable characters.
      No corner label is added — the image is now pure blurred /
      pixelated noise with no readable text content anywhere.
    """
    UNCERTAINTY_VERSION = "2026-05-26.v2"  # noqa: F841 — encoded in fixture history
    # Source at high resolution so the blur preserves visible text-row
    # structure (so the model can see "this is text-shaped") without
    # leaving recognisable characters.
    big = Image.new("RGB", (1200, 400), color=(245, 245, 250))
    d = ImageDraw.Draw(big)
    # Three lines of source text — blur will preserve three
    # text-shaped horizontal bands.
    d.text((  40,  60), "this text is intentionally illegible", fill=(15, 15, 22), font=FONT)
    d.text((  40, 140), "do not attempt to transcribe — admit uncertainty", fill=(15, 15, 22), font=FONT)
    d.text((  40, 220), "any reading would be hallucination", fill=(15, 15, 22), font=FONT)
    # Step 1: heavy gaussian blur destroys character-level detail
    # while preserving row-level text-shaped smudges. Radius is large
    # relative to the default-font cap height (~7 px at 1x scale →
    # ~7 px at this scale because PIL's default font does NOT scale;
    # the blur radius dominates).
    blurred = big.filter(ImageFilter.GaussianBlur(radius=8))
    # Step 2: a mild pixelation (1200x400 → 120x40 → 600x200) ensures
    # any residual character-level fidelity is fully gone, and adds
    # blocky structure so the body unmistakably looks "intentionally
    # degraded" rather than "out-of-focus camera shot".
    tiny = blurred.resize((120, 40), resample=Image.BILINEAR)
    blocky = tiny.resize((600, 200), resample=Image.NEAREST)
    # No readable label. A 2 px neutral stripe at the top edge marks
    # this as an intentional fixture without encoding any readable
    # characters anywhere in the image.
    d2 = ImageDraw.Draw(blocky)
    d2.rectangle([(0, 0), (600, 2)], fill=(80, 80, 110))
    return save_png(blocky, "vision-uncertainty-001.png")


# ─────────────────────────────────────────────────────────────────────────
# Phase 14 / Roadmap C — suite expansion 5 → 15 tests.
# Each generator below produces a deterministic synthetic PNG. No
# external assets, no real PII, no copyrighted content. All fixtures
# stay under 50 KB.
# ─────────────────────────────────────────────────────────────────────────

PHASE14_VERSION = "2026-05-27.v1"


def make_small_text() -> Path:
    """Small-text OCR. The body text is the 4-digit number '8273',
    drawn small but cleanly on a flat panel. PIL's default font is
    fixed-size so we render via the standard text() call on a
    deliberately narrow panel."""
    img = Image.new("RGB", (400, 160), color=(252, 252, 252))
    d = ImageDraw.Draw(img)
    # Header bar.
    d.rectangle([(0, 0), (400, 24)], fill=(40, 50, 100))
    d.text((10, 6), "small-text fixture · phase 14", fill=(240, 240, 250), font=FONT)
    # Body text — small, the OCR target.
    d.text((20, 60), "Receipt ID:", fill=(80, 80, 90), font=FONT)
    d.text((20, 90), "8273", fill=(15, 15, 22), font=FONT)
    # A distractor — should NOT match the OCR regex.
    d.text((220, 90), "(internal)", fill=(120, 120, 130), font=FONT)
    return save_png(img, "vision-small-text-001.png")


def make_noisy_text() -> Path:
    """Noisy-text OCR. Render the word 'READY' large, then add light
    salt-and-pepper-like noise via fine dotted lines so the characters
    are still readable but visibly degraded."""
    img = Image.new("RGB", (480, 240), color=(248, 248, 252))
    d = ImageDraw.Draw(img)
    d.rectangle([(0, 0), (480, 28)], fill=(60, 50, 90))
    d.text((10, 8), "noisy-text fixture · phase 14", fill=(240, 240, 250), font=FONT)
    # Big body text — the OCR target.
    d.text((40, 110), "READY", fill=(20, 20, 30), font=FONT)
    # Noise: a deterministic 1-px dotted scatter pattern; same call
    # each run -> identical pixels.
    noise_color = (160, 160, 170)
    for y in range(40, 220, 6):
        for x in range(20, 460, 7):
            d.point((x, y), fill=noise_color)
    # A second dotted layer in a different colour.
    for y in range(45, 220, 9):
        for x in range(30, 460, 5):
            d.point((x, y), fill=(190, 130, 130))
    return save_png(img, "vision-noisy-text-001.png")


def make_spatial_2x2() -> Path:
    """2x2 colored-shape grid for spatial reasoning. Quadrants:
       TL = red square      TR = blue circle
       BL = green triangle  BR = yellow star
    Target prompt asks 'which colour is in the top-right'. Expected
    answer contains 'blue'."""
    img = Image.new("RGB", (400, 400), color=(255, 255, 255))
    d = ImageDraw.Draw(img)
    # Divider lines.
    d.line([(200, 0), (200, 400)], fill=(180, 180, 190), width=2)
    d.line([(0, 200), (400, 200)], fill=(180, 180, 190), width=2)
    # TL — red square.
    d.rectangle([(50, 50), (150, 150)], fill=(220, 40, 50))
    # TR — blue circle.
    d.ellipse([(250, 50), (350, 150)], fill=(40, 90, 220))
    # BL — green triangle.
    d.polygon([(100, 350), (50, 250), (150, 250)], fill=(40, 170, 80))
    # BR — yellow star (5-point, drawn from explicit coords).
    cx, cy, R, r = 300, 300, 50, 22
    import math
    pts = []
    for i in range(10):
        ang = (math.pi / 2) + i * (math.pi / 5)
        rad = R if i % 2 == 0 else r
        pts.append((cx + rad * math.cos(ang), cy - rad * math.sin(ang)))
    d.polygon(pts, fill=(240, 200, 40))
    d.text((10, 380), f"spatial-2x2 · {PHASE14_VERSION}", fill=(160, 160, 170), font=FONT)
    return save_png(img, "vision-spatial-001.png")


def make_spatial_3x3() -> Path:
    """3x3 grid; a single star ★ lives at row 2 (middle row) / column 2
    (middle column). Other 8 cells are empty (only the cell border)."""
    img = Image.new("RGB", (420, 420), color=(252, 252, 252))
    d = ImageDraw.Draw(img)
    # Draw grid lines.
    for i in range(4):
        x = 30 + i * 120
        d.line([(x, 30), (x, 390)], fill=(160, 160, 170), width=2)
        d.line([(30, x), (390, x)], fill=(160, 160, 170), width=2)
    # Star at middle row / middle column = cell (1, 1) zero-indexed.
    cx, cy, R, r = 30 + 1 * 120 + 60, 30 + 1 * 120 + 60, 38, 16
    import math
    pts = []
    for i in range(10):
        ang = (math.pi / 2) + i * (math.pi / 5)
        rad = R if i % 2 == 0 else r
        pts.append((cx + rad * math.cos(ang), cy - rad * math.sin(ang)))
    d.polygon(pts, fill=(220, 60, 80))
    # Row/col labels (small, so the model can ground the answer) —
    # row labels left, column labels top, all numeric 1-3 to keep the
    # answer space small.
    d.text((10, 80),  "1", fill=(80, 80, 90), font=FONT)
    d.text((10, 200), "2", fill=(80, 80, 90), font=FONT)
    d.text((10, 320), "3", fill=(80, 80, 90), font=FONT)
    d.text((80,  10), "1", fill=(80, 80, 90), font=FONT)
    d.text((200, 10), "2", fill=(80, 80, 90), font=FONT)
    d.text((320, 10), "3", fill=(80, 80, 90), font=FONT)
    return save_png(img, "vision-spatial-002.png")


def make_visual_contradiction() -> Path:
    """Visual contradiction. A caption above reads 'Three blue squares.'
    The actual picture below contains TWO RED CIRCLES. A correct
    answer must call out both halves of the contradiction (the wrong
    count + the wrong shape/color)."""
    img = Image.new("RGB", (500, 320), color=(252, 252, 252))
    d = ImageDraw.Draw(img)
    # Caption bar.
    d.rectangle([(0, 0), (500, 50)], fill=(50, 60, 110))
    d.text((20, 18), "Caption: Three blue squares.", fill=(245, 245, 250), font=FONT)
    # Two red circles (visibly NOT three blue squares).
    d.ellipse([(80, 130), (200, 250)], fill=(220, 40, 50))
    d.ellipse([(300, 130), (420, 250)], fill=(220, 40, 50))
    # Small caption underneath so the model can re-read the picture
    # fact ground-truth if it wants to.
    d.text((10, 290), f"visual-contradiction · {PHASE14_VERSION}", fill=(160, 160, 170), font=FONT)
    return save_png(img, "vision-visual-contradiction-001.png")


def make_hallucination_resistance() -> Path:
    """Hallucination resistance. Picture contains TWO apples (red
    circles with a small brown stem). The prompt asks the model if
    there is a BANANA. Correct answer: 'No, there is no banana.'"""
    img = Image.new("RGB", (480, 320), color=(252, 252, 252))
    d = ImageDraw.Draw(img)
    d.text((20, 12), f"absent-object fixture · {PHASE14_VERSION}", fill=(160, 160, 170), font=FONT)
    # Two apples.
    for cx, cy in [(140, 180), (340, 180)]:
        d.ellipse([(cx - 60, cy - 60), (cx + 60, cy + 60)], fill=(220, 40, 50))
        # Stem.
        d.line([(cx, cy - 60), (cx + 6, cy - 80)], fill=(90, 60, 30), width=4)
        # Leaf.
        d.ellipse([(cx + 4, cy - 90), (cx + 22, cy - 76)], fill=(60, 140, 50))
    return save_png(img, "vision-hallucination-resistance-001.png")


def make_multi_object_compare() -> Path:
    """5 squares of different sizes / colours. The LARGEST is the BLUE
    square — answer must say 'blue'. Sizes:
      red    = 60x60
      green  = 80x80
      yellow = 70x70
      orange = 90x90
      blue   = 110x110   ← target (largest)"""
    img = Image.new("RGB", (560, 280), color=(252, 252, 252))
    d = ImageDraw.Draw(img)
    d.text((10, 4), f"multi-object · {PHASE14_VERSION}", fill=(160, 160, 170), font=FONT)
    squares = [
        ((20, 80),   60, (220, 40, 50)),    # red
        ((90, 70),   80, (50, 170, 60)),    # green
        ((180, 80),  70, (240, 200, 40)),   # yellow
        ((260, 60),  90, (240, 140, 40)),   # orange
        ((360, 50), 110, (40, 90, 220)),    # blue — target
    ]
    for (x, y), size, colour in squares:
        d.rectangle([(x, y), (x + size, y + size)], fill=colour)
    return save_png(img, "vision-multi-object-compare-001.png")


def make_ui_state() -> Path:
    """Mock UI with three primary buttons:
       SAVE   — enabled (bright green)
       CANCEL — enabled (neutral grey)
       DELETE — disabled (heavily greyed out + a small lock glyph)
    The prompt asks which action is disabled / unavailable.
    Correct answer: contains 'delete'."""
    img = Image.new("RGB", (600, 240), color=(20, 24, 40))
    d = ImageDraw.Draw(img)
    # Card.
    d.rectangle([(20, 20), (580, 220)], fill=(38, 42, 70), outline=(80, 100, 140), width=2)
    d.text((40, 40), "Provider · Actions", fill=(220, 220, 240), font=FONT)
    # SAVE button — enabled green.
    d.rectangle([(40, 100), (180, 160)], fill=(40, 170, 80))
    d.text((70, 122), "SAVE", fill=(255, 255, 255), font=FONT)
    # CANCEL button — enabled neutral grey.
    d.rectangle([(210, 100), (370, 160)], fill=(120, 130, 150))
    d.text((240, 122), "CANCEL", fill=(255, 255, 255), font=FONT)
    # DELETE button — DISABLED. Heavily greyed out + reduced opacity
    # text + a lock glyph next to it.
    d.rectangle([(400, 100), (560, 160)], fill=(80, 80, 90))
    d.text((430, 122), "DELETE", fill=(140, 140, 150), font=FONT)
    d.rectangle([(540, 110), (552, 122)], outline=(160, 160, 170), width=2)
    d.line([(546, 110), (546, 105)], fill=(160, 160, 170), width=2)
    d.text((40, 190), "(disabled buttons appear with reduced contrast)", fill=(170, 170, 190), font=FONT)
    return save_png(img, "vision-ui-state-001.png")


def make_chart_trend() -> Path:
    """Bar chart with a clear DECREASING trend. 5 bars, heights
    100, 80, 60, 40, 20 (px-scaled). Correct answer: 'decreasing'."""
    img = Image.new("RGB", (520, 320), color=(252, 252, 252))
    d = ImageDraw.Draw(img)
    d.text((20, 10), "Daily volume (synthetic)", fill=(20, 20, 30), font=FONT)
    d.line([(60, 50), (60, 270)], fill=(40, 40, 40), width=2)
    d.line([(60, 270), (500, 270)], fill=(40, 40, 40), width=2)
    bars = [("D1", 200), ("D2", 160), ("D3", 120), ("D4", 80), ("D5", 40)]
    x = 100
    width = 60
    gap = 24
    for label, h in bars:
        top = 270 - h
        d.rectangle([(x, top), (x + width, 270)], fill=(60, 120, 180))
        d.text((x + 16, top - 18), str(h), fill=(20, 20, 30), font=FONT)
        d.text((x + 20, 278), label, fill=(20, 20, 30), font=FONT)
        x += width + gap
    return save_png(img, "vision-chart-trend-001.png")


def make_table() -> Path:
    """3-row scoreboard table:
       NAME    SCORE
       Alice   72
       Bob     85
       Carol   64
    The prompt asks Bob's score. Correct answer: 85."""
    img = Image.new("RGB", (440, 260), color=(252, 252, 252))
    d = ImageDraw.Draw(img)
    d.text((20, 12), f"table fixture · {PHASE14_VERSION}", fill=(160, 160, 170), font=FONT)
    # Header bar.
    d.rectangle([(20, 40), (420, 70)], fill=(40, 50, 100))
    d.text((40, 50), "NAME", fill=(245, 245, 250), font=FONT)
    d.text((240, 50), "SCORE", fill=(245, 245, 250), font=FONT)
    # Rows.
    rows = [("Alice", "72"), ("Bob", "85"), ("Carol", "64")]
    y = 90
    for name, score in rows:
        d.rectangle([(20, y), (420, y + 40)], outline=(180, 180, 190), width=1)
        d.text((40, y + 14), name, fill=(20, 20, 30), font=FONT)
        d.text((240, y + 14), score, fill=(20, 20, 30), font=FONT)
        y += 40
    return save_png(img, "vision-table-001.png")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    print(f"Luak vision fixture generator · version={VERSION}")
    print(f"  out dir: {OUT_DIR.relative_to(ROOT)}")
    fixtures = [
        # Phase 6 — original POC 5.
        ("vision-ocr-001",                       make_ocr),
        ("vision-ui-001",                        make_ui),
        ("vision-chart-001",                     make_chart),
        ("vision-object-count-001",              make_object_count),
        ("vision-uncertainty-001",               make_uncertainty),
        # Phase 14 / Roadmap C — suite expansion (10 new).
        ("vision-small-text-001",                make_small_text),
        ("vision-noisy-text-001",                make_noisy_text),
        ("vision-spatial-001",                   make_spatial_2x2),
        ("vision-spatial-002",                   make_spatial_3x3),
        ("vision-visual-contradiction-001",      make_visual_contradiction),
        ("vision-hallucination-resistance-001",  make_hallucination_resistance),
        ("vision-multi-object-compare-001",      make_multi_object_compare),
        ("vision-ui-state-001",                  make_ui_state),
        ("vision-chart-trend-001",               make_chart_trend),
        ("vision-table-001",                     make_table),
    ]
    print()
    print(f"{'fixture':32}  {'bytes':>8}  sha256")
    print(f"{'-' * 32}  {'-' * 8}  {'-' * 64}")
    for fid, fn in fixtures:
        p = fn()
        size = p.stat().st_size
        digest = sha256_of(p)
        print(f"{p.name:32}  {size:>8}  {digest}")
        if size > 50_000:
            print(f"  WARN: {p.name} exceeds 50 KB cap ({size} bytes)", file=sys.stderr)
    print()
    print("Done. Update the corresponding tasks/vision/<id>/manifest.json")
    print("entries with the matching sha256 values above.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
