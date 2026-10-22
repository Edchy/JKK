# Noun tiger identity

Source: the user-supplied `~/Downloads/noun_Tiger_6119221_FFFFFF.svg`, preserved unchanged as `source.svg`.

The circular logo uses the supplied tiger paths in the app's dark ink, with KUNG FU above, JÄRNA and HÖLÖ down the left and right sides, and KULTUR below, a dot on each diagonal between them. Lettering uses the app's self-hosted DM Sans at weight 700, converted to outlines for portable SVG rendering. Original tiger geometry is preserved.

- `logo.svg`: transparent circular logo, all vector outlines.
- `og-image.png`: 1200 × 630 social sharing card (the round logo on paper, "Kung Fu Fitness" in Fraunces, the description in DM Sans), copied to `app/img/`.
- `app-icon.svg`: complete tiger head, no lettering.
- `favicon.svg`: the tiger head alone on a transparent background, cropped square; ink, or paper-coloured when the browser is in dark mode (so it shows on a dark tab bar).
- `favicon.ico`: individually rendered 16, 32 and 48 px frames, transparent, ink only (for browsers without SVG favicons).
- PNG exports: browser, 180 px touch, 192/512 px app, and 512 px maskable icons.
- `build.py`: reproducible export script; requires Pillow, fontTools, and cairosvg.

Palette follows the current app: paper #f3efe6, ink #2a2926. App references and offline-cache entries use new noun-tiger filenames. Existing source assets and OG artwork are preserved. Browser/device appearance was not checked because the browser connection was unavailable; SVG structure, raster exports, ICO frames, manifest sizes and offline asset paths were checked locally.
