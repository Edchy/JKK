"""Remove the paper from a monochrome ink drawing, keeping soft brush edges.

Usage: python tools/ink-to-alpha.py <in.png> <out.webp> [size]

The paper colour (sampled from the image border) becomes fully
transparent. The drawing becomes a single ink colour whose opacity
carries all the tone, so washes and dry-brush edges stay soft and the
result sits cleanly on any background. A flat colour channel also
compresses far better than the original.  Needs: pip install pillow numpy
"""
import sys
import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 800

im = Image.open(src).convert("RGB")
im = im.resize((size, round(im.height * size / im.width)), Image.LANCZOS)
rgb = np.array(im).astype(float)
lum = rgb @ [0.299, 0.587, 0.114]

b = 12
border = np.concatenate([lum[:b].ravel(), lum[-b:].ravel(), lum[:, :b].ravel(), lum[:, -b:].ravel()])
paper = np.median(border)
inkmask = lum < np.percentile(lum, 1)
ink = np.median(rgb[inkmask], axis=0)          # the darkest strokes' colour
ink_lum = ink @ [0.299, 0.587, 0.114]

# opacity of the ink needed to darken the paper to this pixel's lightness
alpha = np.clip((paper - lum) / (paper - ink_lum), 0, 1)

# paper grain -> fully transparent, then stretch the rest back to 0..1
floor = 0.06
alpha = np.clip((alpha - floor) / (1 - floor), 0, 1)

out = np.zeros((*alpha.shape, 4), np.uint8)
out[..., :3] = ink.round().astype(np.uint8)
out[..., 3] = (alpha * 255).round().astype(np.uint8)
img = Image.fromarray(out, "RGBA")
img.save(dst, "WEBP", quality=90, alpha_quality=85, method=6)
print(dst, img.size, "paper L%.0f" % paper, "ink #%02x%02x%02x" % tuple(ink.round().astype(int)),
      f"{(alpha == 0).mean():.0%} fully transparent")
