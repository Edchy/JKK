"""Prepare a PDF illustration for the app.

Usage: python tools/add-illustration.py <extracted.png> app/img/<exercise-id>-1.webp

Converts to grayscale, pushes the off-white paper to pure white (so the
image blends into the page in light and dark mode), limits the size to
1400px and saves as WebP. Needs: pip install pillow numpy
"""
import sys
import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
a = np.array(Image.open(src).convert("L")).astype(float)
a = np.clip(a * 255 / 225, 0, 255).astype(np.uint8)  # >= 225 becomes white
im = Image.fromarray(a)
im.thumbnail((1400, 1400), Image.LANCZOS)
im.save(dst, "WEBP", quality=82, method=6)
print(dst, im.size)
