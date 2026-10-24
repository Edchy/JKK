# Kung Fu Fitness – PWA

Static web app, no build step. Everything deployable is in `app/`.

```sh
node server.mjs            # http://localhost:4174 – the app, plus the live coach's /api/token (needs .env)
```

Online it runs on Cloudflare Workers (https://kungfu-fitness.thinksmall.workers.dev): `worker.js` serves `app/` and `/api/token`.

```sh
npx wrangler@4 deploy      # publish app/ + worker.js
```

If the address ever changes, update `og:image` in `app/index.html` too (link previews need the full URL).

## How content is organised

- **`app/content/exercises.json`** – the library. Every exercise lives here once.
- **`app/content/ordbok.json`** – the glossary ("Ordbok"). Add `{ "term": …, "text": … }` (optional `"native": "馬步"`); it is sorted alphabetically automatically.
- **`app/content/index.json`** – the filter tags, the ready-made passes, and the "Innan du börjar" text. Also the three animals (Apa = rörlighet, Björn = styrka, Tiger = färdighet), hidden in the app for now but kept for later. Also the small texts around the app:
  - `members` – the line at the bottom of Hem ("Appen är till för medlemmar …") with a link to the club's site.
  - `privacy` – the Integritet page. A section with `"liveOnly": true` shows only when the live coach is unlocked; a section can have a `link: { text, url }` shown under its text.
  - `feedback` – the "Fel eller förslag?" row in Inställningar: opens the student's mail app to `email` with `subject` and `body` filled in.
- **`app/img/<exercise-id>-<n>.webp`** – the illustrations, exactly as in the PDFs.

Students browse the library (filtered by tag) or open a pass and go through it in order.

Exercise names and tag names are in English; everything that teaches – subtitle, steps, notes – is in Swedish.

### Exercise fields

| field | |
|---|---|
| `id` | must match image names (`<id>-1.webp`, `<id>-2.webp`…) |
| `name`, `subtitle` | |
| `animals` | one or more of `apa`, `bjorn`, `tiger` – not shown in the app for now |
| `tags` | ids from `tags` in index.json (`stretch`, `mobility`, `core`, `strength`, `stance`, `kick`, `punch`, `combo`, `staff`) |
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

"Starta pass" on a pass page opens `#/kor/<pass>`: one exercise at a time, guided by a recorded coach voice (ElevenLabs clips; lines that aren't recorded yet are silent). The student moves on with the on-screen buttons: Färdig, back, listen again, pause.

- `app/speech.js` – every sentence the session says (shared by the app and the recorder).
- **Coach scripts:** an exercise with a `coach` block in `exercises.json` is taught like a sensei – `intro`, `guide` (each line can light up a step card with `"step": n`) and `cues` (encouragement while you work, first after 20 s, then every 25 s). Session framing (welcome, transitions, how "färdig" works, finish) lives under `coach` in `index.json` and per pass. Exercises without a script fall back to reading their steps.
- `app/voice.js` – the speaker: plays recorded clips from `app/audio/`; lines without a clip are skipped.
- **Recording the voice with ElevenLabs:** copy `.env.example` to `.env`, add your API key and voice id, then
  ```sh
  node tools/generate-voice.mjs --voices    # list voices
  node tools/generate-voice.mjs --dry-run   # what will be recorded
  node tools/generate-voice.mjs             # record, then bump VERSION in app/sw.js
  ```
  Re-run after changing any exercise text – only changed sentences are re-recorded.
- The screen is kept awake during a session.
- **Background music:** a pass can have a `music` block in `index.json`:
  ```json
  "music": { "file": "music/<name>.mp3", "delay": 8,
             "credit": { "by": "…", "byUrl": "…", "from": "Pixabay", "fromUrl": "…" } }
  ```
  It starts `delay` seconds after Starta pass, loops, and stops with a fade at the end. It plays in Tyst and Inspelad röst, never with the live coach (the microphone would hear it). Students turn it off with the Musik switch (saved as `music` in `localStorage["jkk-voice"]`). The credit is listed at the bottom of Inställningar.
  Prepare a track at a quiet, fixed level, because iPhones ignore volume set from code:
  ```sh
  ffmpeg -i track.mp3 -map 0:a -map_metadata -1 -af volume=-24dB -b:a 64k app/music/<name>.mp3
  ```
  Keep it stereo: 64 kbps is plenty under a voice, but mono can make wide-mixed tracks lose whole layers. The service worker caches it offline automatically. Bump `VERSION` in `app/sw.js`.

## Design

Warm paper and dark ink, rounded cards, Fraunces for headings and DM Sans for text. All tokens are at the top of `app/style.css`.

- **Four themes** (Inställningar → Utseende): **Papper** (default, `:root`), **Siden** (`:root[data-theme="siden"]`, the colours of Ming-era silk coats: ivory page, mauve cards, lacquer-red actions, a jade tab bar with a gold pill, the logo as a red seal), **Lotus** (`[data-theme="lotus"]`, a lotus pond: misty page, leaf-green cards, lotus-pink actions, a pond-green tab bar with a petal pill, a green logo) and **Wudang** (`[data-theme="wudang"]`, dark: the mountain of tai chi, and of the Wu-Tang Clan's name, at night, with lantern-yellow actions and a yellow seal logo). A dark theme also sets `--shadow` (black), `--raised` (the chosen option, lighter than the cards) and `--field`; the illustrations are black ink, so `--paper` stays light (parchment). A new theme needs its token block in `style.css`, an entry in `THEMES` in `app.js`, its preview colours (`[data-theme-choice="<id>"]` in `style.css`) and its id in the script in `index.html`. A theme only remaps tokens (`--bg`, `--surface`, `--ink`, `--accent`, `--muted`, the `--chrome*` set for the tab bar/banner, `--logo`, `--emblem`), so style new components with tokens and both themes follow. Check text contrast (≥4.5:1) when changing a value. The choice is saved in `localStorage["jkk-theme"]`; a one-line script in `index.html` applies it before the first paint.
- **Navigation:** floating bottom tab bar – Hem, Pass, Övningar, Ordbok.
- **Glossary words** (`match` in `ordbok.json`) are underlined in exercise text; tapping one opens a small sheet with the definition.
- `app/icons/ui/regular/` – Phosphor Regular icons (MIT), drawn as CSS masks so they take the text colour. `app/icons/ui/nav/` – solid Noun Project icons for the tab bar and Hem's rows.
- `app/fonts/` – Fraunces and DM Sans, self-hosted (SIL Open Font License).
