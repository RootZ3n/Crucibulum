#!/usr/bin/env python3
"""
Crucible — synthetic vision fixture generator.

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
    from PIL import Image, ImageDraw, ImageFont
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
    admission."""
    # Start with normal text...
    big = Image.new("RGB", (600, 200), color=(252, 252, 252))
    d = ImageDraw.Draw(big)
    d.text((40, 80), "this text is intentionally illegible", fill=(20, 20, 30), font=FONT)
    # ...then downsample + upsample with NEAREST to produce hard-to-read
    # blocky noise. Deterministic across PIL versions.
    tiny = big.resize((30, 10), resample=Image.NEAREST)
    blurred = tiny.resize((600, 200), resample=Image.NEAREST)
    # Add a faint hint that this IS supposed to be unreadable text so a
    # vision model can recognise "this looks like text I can't decode"
    # rather than think the image is empty.
    d2 = ImageDraw.Draw(blurred)
    d2.rectangle([(0, 0), (600, 24)], fill=(50, 50, 80))
    d2.text((10, 4), "UNCERTAINTY POC — answer: 'unreadable'", fill=(220, 220, 230), font=FONT)
    return save_png(blurred, "vision-uncertainty-001.png")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    print(f"Crucible vision fixture generator · version={VERSION}")
    print(f"  out dir: {OUT_DIR.relative_to(ROOT)}")
    fixtures = [
        ("vision-ocr-001",          make_ocr),
        ("vision-ui-001",           make_ui),
        ("vision-chart-001",        make_chart),
        ("vision-object-count-001", make_object_count),
        ("vision-uncertainty-001",  make_uncertainty),
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
