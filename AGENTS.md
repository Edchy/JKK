# Kung Fu Fitness – Järna Kung Fu & Kultur

A PWA for students of Järna Kung Fu & Kultur: home-training exercises with illustrations, videos, ready-made passes and a voice-guided session. All content and UI is **Swedish**. `README.md` has the content format and day-to-day workflows – read it before changing content.

## Working with the owner

- They want to **understand every part**: explain what you build and why, step by step, before or while building. Prefer small steps they can try over big batches.
- **Never read or print `.env`** (API keys). Ask the owner to edit it. Scripts may load it at runtime; when debugging, print variable *names* only.
- Anything that **spends money** (ElevenLabs recording, agent conversations) needs a small test first – e.g. `generate-voice.mjs --sample` before a full run.
- Content wording (exercise text, coach lines, glossary) belongs to the instructor. Mark anything you write yourself as a draft to review.

## Layout

| Path | What |
|---|---|
| `app/` | The PWA. Static files, no build step. **Everything here is public** – never put secrets in it. |
| `app/content/*.json` | All content: `exercises.json` (library), `index.json` (animals, tags, passes, principles, session coach framing, `privacy` texts + live consent), `ordbok.json` (glossary). Single source of truth for the app *and* the voice coach. |
| `app/app.js` | Hash router (`route()`), all views, the guided session (`#/kor/<pass>`). |
| `app/speech.js` | What the recorded session coach says (shared by app and recorder). |
| `app/voice.js` | Speaker for the recorded session: plays clips; a line without a clip is silent (no device voice, on purpose). No microphone – the student taps Nästa. |
| `app/music.js`, `app/music/` | Background music during a pass (`passes[].music` in `index.json`): one quiet looping track, own on/off switch, off in live mode. Level baked into the file (iOS ignores `audio.volume`). |
| `app/coach-context.js` | `[Appen]` messages that tell the live ElevenLabs agent which pass/exercise is on screen. |
| `app/live-coach.js` | The live voice conversation (ElevenLabs agent): ticket, pause, limits. See `docs/voice.md`. |
| `app/coach-test.html` | Text-only test page for the live agent. |
| `docs/voice.md` | The whole voice architecture. |
| `app/vendor/` | Self-hosted ElevenLabs SDK + resampler (GDPR: no CDN). Rebuild with `sh tools/vendor-sdk.sh`, don't edit. |
| `app/sw.js` | Service worker: offline cache, cache-first. |
| `agent/prompt.md` | The live agent's system prompt (source of truth; the ElevenLabs dashboard is updated from it). |
| `worker.js`, `wrangler.jsonc` | Production on Cloudflare Workers: serves `app/` (minus `app/.assetsignore`) and `/api/token` (same-origin only, rate limited, test code required). |
| `server.mjs` | Local dev server: serves `app/` and `GET /api/token` (signed URL for the private agent). |
| `tools/` | Mac-only scripts: `generate-voice.mjs` (ElevenLabs clips), `add-illustration.py`, `ink-to-alpha.py`. |
| `design/noun-tiger/` | Source of the round logo, favicons and app icons; `build.py` regenerates them (see its README). Not shipped. |
| `PDFS/` | Gitignored drop folder for the instructor's PDFs while extracting content (README → Adding exercises). Not shipped. |

## Running

```sh
node server.mjs            # http://localhost:4174 – app + /api/token (needs .env)
```

`.env` (gitignored): `ELEVENLABS_API_KEY` (Mac key: TTS, voices, models, agents read+write – scripts only), `ELEVENLABS_SERVER_KEY` (server key: agents write – needed for signed URLs), `ELEVENLABS_AGENT_ID`, optional `ELEVENLABS_VOICE_ID`/`ELEVENLABS_MODEL`.

## Deploy

```sh
npx wrangler@4 deploy      # publishes app/ + worker.js to Cloudflare
```

Secrets live in Cloudflare (`npx wrangler@4 secret put …`): `ELEVENLABS_SERVER_KEY`, `ELEVENLABS_AGENT_ID`, `TESTER_KEY`.

**The live coach is in test mode.** Online, students choose between Tyst (the default) and Inspelad röst; no live coach, no consent sheet. The owner's phone turns the live coach on with the test code: open the app once with `?tester=<TESTER_KEY>`, or type it under Inställningar → Testkod (needed for an app saved to the iPhone home screen, which has its own storage). `?tester=off` removes it. The real lock for the live coach is in `worker.js`: no matching `X-Tester` header, no ticket. On localhost the live coach is always on; open `http://[::1]:4174` to see the student version.

## Gotchas

- **Bump `VERSION` in `app/sw.js`** after changing any app file, or installed apps keep serving the old cache. Browsers also cache HTTP aggressively – test with a hard reload (Cmd+Shift+R).

**Voice (live coach + recorded fallback):** read `docs/voice.md` before touching `live-coach.js`, `coach-context.js`, `voice.js`, `speech.js`, `server.mjs`, `agent/prompt.md` or the ElevenLabs agent. It covers the three voice modes, the `[Appen]` protocol, tools, the dashboard configuration (not in code), testing and known pitfalls.

**Recorded session mode (`voice.js` + `app/audio/`)** – the offline fallback for the live coach. Buttons only, no microphone.
- Clips are named by hash of voice+model+settings+text, listed in `app/audio/index.json`. Changing spoken text means re-running `node tools/generate-voice.mjs` (only changed lines are recorded).
- Clips play from in-memory blobs (not URLs) so Safari works with the service worker cache.
- No device voice (`speechSynthesis`): the owner prefers silence for lines that aren't recorded yet.

## Style

- Plain ES modules, no framework, no build. Match the surrounding code; keep comments explaining *why*.
- Design tokens at the top of `app/style.css` (warm paper + dark gray ink; the themes Siden, Lotus and Wudang (dark) remap them under `:root[data-theme="…"]`, so never hard-code colours; Fraunces + DM Sans, Phosphor Regular icons, solid Noun Project icons in the tab bar and Hem's rows (`icons/ui/nav/`); the logo is `img/jarna-round-logo.svg`, generated by `design/noun-tiger/build.py` – change the script, not the SVG). Use tokens, not hard-coded colours.
- Illustrations are black ink on white; prepare new ones with `tools/add-illustration.py` / `tools/ink-to-alpha.py`.
