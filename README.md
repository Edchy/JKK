# Kung Fu Fitness – PWA

Static web app, no build step. Everything deployable is in `app/`.

```sh
cd app && python3 -m http.server 4173   # http://localhost:4173
```

Deploy by uploading `app/` to any static host (Vercel, Netlify, GitHub Pages…). Must be served over HTTPS for install/offline to work.

## How content is organised

- **`app/content/exercises.json`** – the library. Every exercise lives here once.
- **`app/content/ordbok.json`** – the glossary ("Ordbok"). Add `{ "term": …, "text": … }` (optional `"native": "馬步"`); it is sorted alphabetically automatically.
- **`app/content/index.json`** – the three animals (Apa = rörlighet, Björn = styrka, Tiger = färdighet), the filter tags, the ready-made passes, and the "Innan du börjar" text.
- **`app/img/<exercise-id>-<n>.webp`** – the illustrations, exactly as in the PDFs.

Students browse by animal (with tag filters) or open a pass and go through it in order.

### Exercise fields

| field | |
|---|---|
| `id` | must match image names (`<id>-1.webp`, `<id>-2.webp`…) |
| `name`, `subtitle` | |
| `animals` | one or more of `apa`, `bjorn`, `tiger` |
| `tags` | ids from `tags` in index.json (`stretch`, `bal`, `mabu`, `sparkar`, `slag`, `stav`) |
| `images` | number of illustrations; `0` = video-only exercise |
| `video`, `extraVideos` | YouTube ids |
| `steps` | optional; text per numbered picture in the illustration, e.g. `{ "bild": [3, 4], "title": …, "text": … }` |
| `text`, `focus`, `variations`, `dose` | optional |

## Adding exercises from a new PDF

1. **Extract the illustrations** from the PDF and add them to `app/img/` as
   `<exercise-id>-1.webp` (and `-2`, `-3`… if an exercise has several):

   ```sh
   mkdir -p /tmp/kf && pdfimages -png "Ny.pdf" /tmp/kf/p      # one PNG per illustration
   python tools/add-illustration.py /tmp/kf/p-000.png app/img/<exercise-id>-1.webp
   ```

   The script turns the paper pure white so the drawing blends into the page
   (needs `pip install pillow numpy`).

2. **Add the exercise(s) to `exercises.json`.** For an exercise that already exists as video-only, just set `images` and add the text.
3. **Optionally add a pass** to `passes` in `index.json` (an ordered list of exercise ids).

Installed apps pick up new content on their next launch (one extra launch at most, since the service worker refreshes in the background).

When you change `app.js`, `style.css` or `index.html`, bump `VERSION` in `app/sw.js`.

## Guided sessions (voice)

"Starta pass" on a pass page opens `#/kor/<pass>`: one exercise at a time, read aloud by the device's Swedish voice. Commands (or the on-screen buttons):

| Say | Does |
|---|---|
| färdig / klar / nästa | next exercise |
| tillbaka / föregående | previous exercise |
| igen / upprepa | read the exercise again |
| paus / stopp · fortsätt | pause / resume the voice |
| avsluta | end the session |

- `app/speech.js` – every sentence the session says (shared by the app and the recorder).
- `app/voice.js` – speaker and command listener. The speaker plays recorded clips from `app/audio/` and falls back to the device's own voice. Command words live in `COMMANDS`.
- **Recording the voice with ElevenLabs:** copy `.env.example` to `.env`, add your API key and voice id, then
  ```sh
  node tools/generate-voice.mjs --voices    # list voices
  node tools/generate-voice.mjs --dry-run   # what will be recorded
  node tools/generate-voice.mjs             # record, then bump VERSION in app/sw.js
  ```
  Re-run after changing any exercise text – only changed sentences are re-recorded.
- The app ignores command words it is saying itself (e.g. a step that starts with "Upprepa…").
- Speech recognition: Chrome (needs internet) and Safari. Elsewhere the buttons still work. The screen is kept awake during a session.

## Design

Direction "Mjuk": rounded cards on pale sage (`#eceee8`), moss accent (`#3f5b43`), Fraunces for headings and DM Sans for text. All tokens are at the top of `app/style.css`.

- **Navigation:** floating bottom tab bar – Hem (animals), Pass, Ordbok, Info ("Innan du börjar").
- **Glossary words** (`match` in `ordbok.json`) are underlined in exercise text; tapping one opens a small sheet with the definition.
- `app/icons/ui/duotone/` – Phosphor Duotone icons (MIT). Swap in your own SVGs with the same file names.
- `app/fonts/` – Fraunces and DM Sans, self-hosted (SIL Open Font License).
