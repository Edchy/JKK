# Noun tiger identity

Source: the user-supplied `~/Downloads/noun_Tiger_6119221_FFFFFF.svg`, preserved unchanged as `source.svg`.

The circular logo uses the supplied tiger paths in the app's dark ink, with JÄRNA KUNG FU above and & KULTUR below. Lettering uses the app's self-hosted DM Sans at weight 700, converted to outlines for portable SVG rendering. Original tiger geometry is preserved.

- `logo.svg`: transparent circular logo, all vector outlines.
- `logo-preview.png`: logo on the app's warm-paper background.
- `app-icon.svg`: complete tiger head, no lettering.
- `favicon.svg`: the supplied tiger head without lettering, rendered directly from vector paths.
- `favicon.ico`: individually rendered 16, 32 and 48 px frames.
- PNG exports: browser, 180 px touch, 192/512 px app, and 512 px maskable icons.
- `build.py`: reproducible export script; requires Pillow, fontTools, and cairosvg.

Palette follows the current app: paper #f3efe6, ink #2a2926. App references and offline-cache entries use new noun-tiger filenames. Existing source assets and OG artwork are preserved. Browser/device appearance was not checked because the browser connection was unavailable; SVG structure, raster exports, ICO frames, manifest sizes and offline asset paths were checked locally.
