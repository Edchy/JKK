# Voice architecture

How the guided session ("Starta pass", route `#/kor/<pass>/<n>`) talks to the student. Read this before changing anything in `app/live-coach.js`, `app/coach-context.js`, `app/voice.js`, `app/speech.js`, `server.mjs`, `agent/prompt.md` or the ElevenLabs agent.

## Contents

1. [Overview: three voice modes](#1-overview-three-voice-modes)
2. [Files](#2-files)
3. [Mode selection and switching](#3-mode-selection-and-switching)
4. [Live coach](#4-live-coach-elevenlabs-agent)
5. [Recorded voice](#5-recorded-voice-offline-fallback)
6. [Keys, server and deployment](#6-keys-server-and-deployment)
7. [Testing](#7-testing)
8. [Pitfalls we hit](#8-pitfalls-we-hit)
9. [Status and open items](#9-status-and-open-items)

---

## 1. Overview: three voice modes

The student picks a mode on the pass page (or mid-session via the mode button). The choice is saved per device.

| Mode | What happens | Needs |
|---|---|---|
| `silent` – **Tyst** | Images and text only. | – |
| `recorded` – **Inspelad röst** | A pre-recorded coach (ElevenLabs clips) explains each exercise and encourages now and then. Student taps **Nästa**. | Nothing – works offline |
| `live` – **Live-coach** (default) | A live voice conversation with an ElevenLabs agent. The student can talk ("nu har jag gjort 30", "jag orkar inte", "kör nästa"); the coach answers and can switch exercises itself. | Internet, microphone, our token server |

If live can't connect (offline, token error, dropped connection), the session **falls back to `recorded`** for the rest of that session. The saved choice stays `live`.

There is **no microphone in `recorded` mode** (removed on purpose): the student moves on with the on-screen buttons. Only the live coach listens.

```
                         ┌──────────── live ────────────┐
Starta pass ─► mode? ────┤ live-coach.js ⇄ ElevenLabs   │── fails ──► recorded
                         └──────────────────────────────┘
                  ├──── recorded ── speech.js → voice.js → app/audio/*.mp3
                  └──── silent ──── (nothing)
```

## 2. Files

| File | Role |
|---|---|
| `app/app.js` – section "Guided session" | Session screen, mode picker (`MODES`, `prefs.mode`), buttons (`command()`), live wiring (`startLive`, `stopLive`, `liveFallback`, `liveTools`), recorded playback (`speak`, `working`). |
| `app/live-coach.js` | Everything about the live connection: ticket, SDK, pause/hang-up, limits. Exposes `createLiveCoach()`. |
| `app/coach-context.js` | The `[Appen]` messages the app sends the live coach, built from `content/*.json`. Also `asToolResult()`. |
| `app/speech.js` | Every sentence the **recorded** coach says. Shared by the app and the recorder. |
| `app/voice.js` | The **recorded** speaker: plays clips from `app/audio/`, falls back to device TTS. |
| `app/audio/` | Recorded clips (`<hash>.mp3`) + `index.json` manifest (text → file). |
| `agent/prompt.md` | **Source of truth** for the live agent's system prompt. The dashboard is updated by copying this whole file. |
| `server.mjs` | Local dev server: serves `app/` and `GET /api/token`. |
| `tools/generate-voice.mjs` | Records the recorded coach's lines with ElevenLabs. |
| `app/coach-test.html` | Text-only playground for the live agent (no app around it). |

## 3. Mode selection and switching

- `MODES` in `app.js` lists the three modes (id, label, subtitle, icon). `modePicker()` renders them; the same markup is used on the pass page and in the in-session sheet (`SHEETS.mode`).
- `prefs.mode` is stored in `localStorage["jkk-voice"]` as `{ "mode": "silent" | "recorded" | "live" }`. Old `{ "sound": false }` migrates to `silent`. New users default to `live`.
- `mode()` is the **effective** mode: `live` becomes `recorded` when `liveFailed` is set for this session.
- One document-level click handler catches every `[data-mode]` card, saves the choice and, mid-session, calls `applyMode()`, which stops whatever is playing and starts the new mode (`startLive()` / `stopLive()` / `speak()`).

## 4. Live coach (ElevenLabs agent)

### 4.1 Pieces

```
phone (app)                         our server (server.mjs)          ElevenLabs
───────────                         ───────────────────────          ──────────
live-coach.js ── GET /api/token ──►  holds ELEVENLABS_SERVER_KEY ──►  get-signed-url
              ◄── { signedUrl } ───                              ◄──  wss://… (15 min)
              ══════════════ WebSocket conversation (signed URL) ══════════════►  agent
                 mic audio / typed text ─►        ◄─ agent audio + text, tool calls
```

- **The agent** lives at ElevenLabs (see 4.7). It does speech-to-text (ears), the LLM (brain) and text-to-speech (voice) in one service.
- **The API key never reaches the phone.** `server.mjs` asks ElevenLabs for a **signed URL**, a one-time ticket valid 15 minutes to *start* a conversation, and returns only that. The agent has authentication on, so it refuses conversations without one.
- **The SDK** (`@elevenlabs/client`, pinned `1.27.0`) is **self-hosted** in `app/vendor/` (built by `tools/vendor-sdk.sh`: one esbuild bundle incl. livekit, ~600 kB) and loaded with a dynamic `import()` **only when a live session starts**, so the app itself stays small. Self-hosted so no CDN sees the student's IP (GDPR). The SDK also wants an audio resampler worklet from jsDelivr on some browsers (mainly Firefox): we pass `libsampleratePath` pointing at `app/vendor/libsamplerate.worklet.js` (2 MB, only fetched when needed). Not in the service worker's SHELL (live needs internet anyway); cached at runtime once fetched.
- **Pause:** muting isn't enough – the conversation keeps running and the turn timeout gives the coach turns it speaks into the muted speaker. `pause()` sends `pauseNote` and then `sendUserActivity()` every 1.5 s (each holds the agent ~2 s); `resume()` sends `unpauseNote` so it picks up. After 2 min it still hangs up.
- **Test mode:** all voice (Inspelad röst and Live-coach) is only on for a phone with the test code (`TESTER` / `VOICE` in `app.js`: `?tester=<code>` or Inställningar → Testkod), or on localhost. Everyone else: `mode()` is always `"silent"`; the voice choice, ⟲ and pause are hidden. Online, `worker.js` refuses live tickets without a matching `X-Tester` header (`TESTER_KEY` secret); `live-coach.js` sends it.
- **Consent (GDPR):** before the first live session on a phone, `startLive()` shows the `consent` sheet (texts in `index.json` → `privacy.live`). `prefs.liveOk` remembers the answer in localStorage. "Inte nu" / closing → `sessionMode = "recorded"` for this session. Withdraw under Inställningar (cog on Hem, `#/installningar`); the privacy page is `#/installningar/integritet` (`privacy.sections`). `privacy.days` must match the agent's *Conversations Retention Period*.

### 4.2 `createLiveCoach()` API (`app/live-coach.js`)

```js
const coach = createLiveCoach({ tools, onState, onLine, onEnd });
await coach.start(openingNote, context) // mic permission → ticket → connect → silent context → opening message
coach.note(text)    // sendContextualUpdate: background info, the coach does NOT answer
coach.say(text)     // sendUserMessage: the coach answers
coach.pause()       // mic + voice muted at once; hangs up after PAUSE_HANGUP
await coach.resume(resumeNote) // unmute, or reconnect with resumeNote if it had hung up
coach.end()         // hang up (our decision – no onEnd)
coach.state         // off | connecting | listening | speaking | paused | ended
```

- `onState(state)` drives the status pill ("Ansluter…", "Coachen lyssnar", "Coachen pratar", "Pausad").
- `onLine(text)` receives each agent reply (voice tags like `[warmly]` stripped) and is shown as a caption (`.run-say`).
- `onEnd(details)` fires only when the conversation ends **without** us asking (dropped, or our 30-min limit). `app.js` treats it as a fallback trigger.

Constants: `PAUSE_HANGUP` = 2 min, `MAX_LENGTH` = 30 min (our own cost guard; we found no max-duration setting in the dashboard).

### 4.3 The `[Appen]` protocol: how the coach knows what's on screen

The agent can't see the screen. The app tells it, using messages that start with `[Appen]` (the prompt explains the convention). All built in `coach-context.js` from `content/*.json`, so content changes reach the coach automatically.

| Moment | Function | Sent as | Coach should |
|---|---|---|---|
| Session start | `exerciseContext(pass, list, i)` | `note` (silent), **before** the opening | know exercise 1, not talk about it yet |
| Session start | `openingNote(pass, list)` = `passContext` | `say` | greet, ask how the body feels |
| Student taps **Nästa / ◀** | `exerciseContext(…, newI)` | `say` | introduce the new exercise (2 short sentences) |
| Coach switched via a tool | `asToolResult(exerciseContext(…))` | the **tool's return value** | introduce the new exercise |
| Student taps **Lyssna igen** | `repeatNote()` | `say` | explain the exercise again |
| Resume after hang-up | `resumeNote(pass, list, i)` | opening `say` of the new conversation | welcome back |
| Last **Avsluta** | `finishNote(pass)` | `say` (we hang up 15 s later) | short warm goodbye |

`exerciseContext` includes name, subtitle, dose (`Mängd`), focus, numbered instructions and variations (`Enklare` / `Avancerat`). The "Enklare" variant is what the coach offers when the student wants to give up.

**Why the opening is split:** when the opening message contained the full exercise, the coach greeted *and* lectured in one go. With the exercise silent and only "the pass has started" as the message, it says hello first.

**Why tool results are not `[Appen]` messages:** with `[Appen]` in tool results, the model (DeepSeek) began *writing fake `[Appen]` notes itself*, with invented doses. `asToolResult` strips the label and prefixes "Klart, appen visar nu den nya övningen."

### 4.4 Tools: the coach changing the screen

Two **client tools** (they run in the browser, because only the phone can change its screen):

| Tool | `liveTools` in `app.js` does | Returns |
|---|---|---|
| `next_exercise` | `goTo(i + 1)` | `asToolResult(exerciseContext(…, i + 1))`, or "Det här är redan passets sista övning." |
| `previous_exercise` | `goTo(i - 1)` | same for `i - 1`, or "…första övning." |
| `go_to_exercise` | `{number}` (1-based, checked) → `goTo(number - 1)` | `asToolResult(…)`, or "Det finns ingen övning N…" / "redan på övning N" |
| `end_workout` | after the goodbye: go home (`#/`) | "Klart. Säg hejdå…" |
| `stop_coach` | after the goodbye: `sessionMode = "silent"`, hang up, re-render; the pass continues without voice. The saved choice stays live. | "Klart. Säg hejdå…" |

- **Goodbye first:** `afterGoodbye()` waits until the coach has spoken and gone quiet again (state speaking → listening), at most 10 s, before acting. Cancelled if the call ends some other way.
- **`sessionMode`** replaces live mode for this session only: `"recorded"` after a failed connection, `"silent"` after `stop_coach`. Picking a mode in the sheet clears it (so the student can turn the coach back on).

- The AI only *asks*; our code decides. It can't move past the ends.
- **Tool path vs button path:** when the coach switches, it already knows, so the tool result carries the new exercise and we do **not** also `say()` it. When the student taps a button, `command()` sets `liveAnnounce`; `renderStep()` then `say()`s the new exercise once.
- `goTo` uses `location.replace` (no history spam). `renderStep()` re-renders; the live connection lives at module level (`live`), so it survives exercise changes.

### 4.5 Buttons in live mode (`command()`)

| Button | Live behaviour |
|---|---|
| **Nästa / Avsluta** | switch + announce (see above); on the last exercise `finish()` sends `finishNote` and hangs up after 15 s |
| **◀** | switch back + announce |
| **Lyssna igen** | `say(repeatNote())` |
| **Pause / Fortsätt** | `pause()` → muted, state `paused`; after 2 min it hangs up (paused minutes would be billed). `resume()` unmutes, or reconnects with `resumeNote` |
| **✕** | leave the session → `leaveSession()` → `stopLive()` |
| **Mode button** | sheet with the three modes; `applyMode()` switches live on/off mid-session |

### 4.6 Failure and fallback

`liveFallback(why)` runs when: `start()` throws (offline, mic denied, token error, SDK load error), `resume()` reconnect fails, or the connection ends on its own (`onEnd`). It stops live, sets `liveFailed`, shows "Live-coachen gick inte att nå – inspelad röst istället" and starts the recorded voice for the current exercise.

### 4.7 Agent configuration (dashboard, not in code)

Only the prompt is versioned (`agent/prompt.md`). The rest lives in the ElevenLabs dashboard. Keep this list in sync when you change it there.

- **Agent id:** `agent_5601m4qqm07deb4aytxr7xsfpfps` (also `ELEVENLABS_AGENT_ID` in `.env`)
- **System prompt:** the full content of `agent/prompt.md`
- **First message:** empty. The app opens every conversation with `openingNote`; empty means a reconnect after a pause doesn't replay a greeting. Initial wait before the agent speaks unprompted: default (7 s); the app's message arrives well before.
- **Language:** Swedish
- **Voice:** "Brage – Nordic Storyteller"; TTS model **V4 Turbo** (fastest). Recordings use `nEJYXtiAMFuP7hh9yoi4` / `eleven_v4`; verify they're the same voice if the live coach and recordings sound different.
- **LLM:** Claude Haiku 4.5, reasoning effort Low, temperature lower-middle, backup LLM Default, token limit −1. DeepSeek was tried first: it imitated `[Appen]` notes and invented content.
- **Agent behavior:** default personality off
- **Tools:** `next_exercise`, `previous_exercise`, `go_to_exercise` (one required integer parameter `number`), `end_workout`, `stop_coach`. Type Client, no parameters (except go_to_exercise), wait for response **on**, pre-tool speech **off** (otherwise the coach introduced the next exercise *before* the tool answered and guessed wrong instructions), execution Immediate, interruptions Allow, sound None, response timeout **3 s**. The built-in system tool **End conversation** is **off**: the coach may only end through `end_workout` (otherwise it hung up on its own and the app showed the "couldn't reach" fallback). Descriptions (Swedish) tell the model when to use them; the "orkar inte → offer easier variant first" rule is in both the description and the prompt.
- **Privacy:** Store Call Audio **off**, Conversations Retention Period **30** days (= `privacy.days`), Zero Retention Mode off (we need transcripts to improve the prompt).
- **Security:** authentication **on**. Overrides: only **Text only** enabled (used by `?textonly` and `coach-test.html`). Allowlist not set yet: add the production domain when the app is online.
- **Limits:** daily call limit 50 (raise for students), concurrency = subscription, bursting **off** (it bills double), call queuing **off** (meant for phone lines).

### 4.8 The prompt (`agent/prompt.md`)

Sections: Roll · Så pratar du · Så guidar du en övning (whole guidance in one go, then sparse cues on the turn timeout) · När det är tyst · Skolans principer · Ansträngning och smärta (muscle burn is good; sharp/joint pain, dizziness = stop) · När eleven är klar · När eleven vill ge upp · När eleven vill avsluta passet i förtid (ask once, then `end_workout`) · När eleven vill träna utan dig · Meddelanden från appen · Verktyg · Start, paus och slut.

Rules that exist because of observed failures:
- "Normalt högst två–tre meningar" + concrete examples for introducing an exercise: without examples, intros were 5–6 sentences.
- "Säg ingenting om nästa övning förrän verktyget har svarat": paired with pre-tool speech off.
- "Skriv aldrig själv meddelanden som börjar med [Appen]…": against imitation.
- Tone: "avslappnad, klok, torr humor" + banned phrases ("vad kul att du är här", "välkommen!"): the greeting sounded fake and salesy.
- "Inte en kundtjänst… Kan jag hjälpa dig med något?": the coach answered a plain "hej" like a support bot.
- "När det är tyst": the turn timeout makes the coach talk after silence; it asked "är du där?" instead of coaching.
- **Guiding relies on the turn timeout:** the agent only speaks when it gets a turn. In silence, the *turn timeout* (dashboard, ~10 s) is what gives it the next turn, used only for sparse cues. The steps themselves are said in one go at the start (one step per turn left 10 s gaps between steps). Too short a timeout → chatty and more LLM calls.
- "Använd aldrig ordet 'kör'": non-native voices say it with a hard k (the *choir* word) instead of "sjör". The other "kör" in the prompt are things the *student* says, which is fine.
- Greeting: `openingNote` adds "Tid hos eleven: tisdag 10:47". With a single example greeting in the prompt and nothing else to vary on, every pass opened with "Tja, hur känns kroppen idag?". The agent has no memory between conversations, so variety has to come from the input (and temperature).
- "nästa" is the spoken word for moving on (same as the button). The coach teaches it once, at the end of the first exercise's run-through; "klar"/"färdig" also count.
- "När eleven är klar" only on *clear* signals; "känns bra" / "okej" / "det bränner" are comments: the coach heard "känns bra" as done, said "bra gjort" and moved on after the first instructions. If unsure: stay. Never switch on its own because it thinks time has passed.
- "Övningar kvar efter den här: N" is counted in `exerciseContext` – the model said "två kvar" on exercise 2 of 8 when it had to count itself.
- Captions: `onMessage` text arrives before the audio, so `live-coach.js` holds it until the mode turns "speaking", and drops it while paused.
- "kör nästa" counts as *done*, not *giving up*: otherwise the coach argued with students who had finished.
- Pain always means stop, never an easier variant.

Workflow: edit `agent/prompt.md` → copy the **whole file** into the dashboard → Publish → start a **new** conversation (running ones keep the old prompt).

## 5. Recorded voice (offline fallback)

- **What it says:** `speech.js` builds lines per exercise: a welcome (first exercise) or a transition, then the exercise's `coach` script from `exercises.json` (`intro`, `guide` with `step` = which instruction card to highlight, `cues`), or the plain steps when there's no script, then once "Kör i din egen takt… trycker du på nästa". `cueLines` are spoken while the student works (`CUE_FIRST` = 20 s, then every `CUE_EVERY` = 25 s).
- **Session framing** text (`howTo`, `transitions`, `last`) is in `index.json → coach`; welcome/finish per pass in `passes[].coach`.
- **Playback** (`voice.js`): `createSpeaker()` plays the clip listed for the exact text in `app/audio/index.json`, or falls back to device TTS (`speechSynthesis`, best Swedish voice). Clips are fetched as blobs and preloaded per exercise.
- **Recording** (`tools/generate-voice.mjs`, uses `ELEVENLABS_API_KEY`): `--dry-run` shows what's missing and the character count, `--sample` records only the first exercise of the first pass, and no flag records everything missing. Clips are named by a hash of voice + model + settings + text, so only changed lines are re-recorded, and unused clips are deleted. Defaults: voice `nEJYXtiAMFuP7hh9yoi4`, model `eleven_v4`, speed 0.9. **Always test with `--sample` before a full run**: it costs money.
- **State:** only Pass 1 / Wide stance has a coach script and clips. The other 14 exercises have no script and are effectively silent (the device-TTS fallback doesn't work reliably in Chrome; the owner doesn't want it anyway).

## 6. Keys, server and deployment

`.env` (gitignored, **never read or print it**; ask the owner to edit):

| Variable | Used by | ElevenLabs permissions |
|---|---|---|
| `ELEVENLABS_API_KEY` ("jkk-mac") | `tools/generate-voice.mjs`, other Mac scripts | Text to speech, Voices read, Models read, Agents read + write |
| `ELEVENLABS_SERVER_KEY` ("jkk-server") | `server.mjs` | Agents **write** (needed for signed URLs, `convai_write`), nothing else |
| `ELEVENLABS_AGENT_ID` | `server.mjs` | not a secret |
| `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` | optional overrides for the recorder | |

`server.mjs` (port 4174) serves `app/` with a path-traversal guard (`/../.env` → 404) and `GET /api/token` with `Cache-Control: no-store`.

**Production:** not deployed yet. The host needs the same `/api/token` endpoint (e.g. a Vercel function with the same ~15 lines), `ELEVENLABS_SERVER_KEY` and `ELEVENLABS_AGENT_ID` as host secrets, and the agent's allowlist set to the production domain.

**Service worker** (`app/sw.js`): `/api/*` is never cached, since a cached ticket would be expired. Navigations only map to `index.html` for the app shell (`/`, `/index.html`); other pages like `coach-test.html` are cached under their own URL. The live SDK (cross-origin) is not cached. Bump `VERSION` after changing any app file.

### Billing (ElevenLabs Starter plan, Oct 2026)

**What the agent dashboard actually shows** (Agents → Dashboards → General, week of 9–15 Oct 2026, owner testing): 28 conversations, average 2:21, **total cost 14.4K credits** (≈ 513 per conversation, ≈ 220 credits per minute), plus **"Total LLM cost $1.01"** (≈ $0.036 per conversation) shown separately in dollars.

| What | Billed as |
|---|---|
| Recordings (`generate-voice.mjs`) | ~1 credit per character, from the 30,000 monthly credits |
| Live voice conversations | **credits from the same 30,000 pool**, ≈ 220 credits/min (the support chatbot's "75 included minutes, then $0.08/min" did not match the dashboard) |
| Live text messages (`?textonly`, `coach-test.html`) | small per message (chatbot: $0.003) |
| The agent's LLM (Claude Haiku 4.5) | shown separately in dollars ("Total LLM cost"). **Unclear** whether it's charged, deducted from credits or covered by ElevenLabs – check Subscription (credits used) and Billing (invoices), and ask support |
| Silence > 10 s in a voice call | discounted (chatbot: 95%) |
| Burst (over the concurrency limit) | 2× price; bursting is **off** |

30,000 credits ≈ 2 hours of live coach per month in total, shared with recordings. Students therefore don't get the live coach (test mode, see above); the recorded voice costs nothing per play. Cost guards: test code required for tickets, rate limit, daily call limit, `MAX_LENGTH` 30 min, `PAUSE_HANGUP` 2 min, silence hold while paused. Before opening live to students: a bigger plan and/or a server-side monthly budget (`/api/token` refusing tickets once used up).

## 7. Testing

- **Without voice:** `http://localhost:4174/?textonly#/pass/pass-1` → choose Live-coach → Starta pass. The live session runs in text mode with a small text field (`.run-type`) for typing to the coach. Pause can't mute in text mode; that's handled.
- **Agent only:** `http://localhost:4174/coach-test.html` has a pass picker, ◀ ▶ buttons, tool calls shown as "🔧" lines, and "Visa vad appen skickar" to show the `[Appen]` notes.
- **Fallback:** make `/api/token` fail (stop `server.mjs`, or open the app via another server); the session should switch to recorded.
- **Automated browser tests:** long conversations exceed a single tool call's time limit. Start the script without awaiting and poll a `window.__done` flag. Background tabs throttle timers and don't load media. Always unregister the service worker and clear caches first, or you test stale code.
- **Student view:** open `http://[::1]:4174` (not `localhost`, where voice is always on) to see the app without voice.
- **Online as the owner:** `https://kungfu-fitness.thinksmall.workers.dev/?tester=<code>`, or Inställningar → Testkod in the installed app.
- **Costs:** every live test uses credits (≈ 500 per conversation, see Billing). Hang up (✕ / Avsluta) when done.

## 8. Pitfalls we hit

- `onConnect` fires **inside** `startSession`, before its return value is assigned. Don't use the conversation object there; do post-connect work after `await startSession()`.
- In text conversations, `setMicMuted` / `setVolume` **throw**. `live-coach.js` wraps them in `quiet()`.
- Voice tags like `[warmly]` appear in agent text; strip them before display.
- The dashboard's prompt editor has mangled pastes; paste the file with Cmd+Shift+V, or into the expanded editor.
- Recorded mode, historical: Chrome drops `speechSynthesis.speak()` right after `cancel()`; Safari needs clips played from blobs (range requests vs SW cache); starting the mic during audio delays it (Bluetooth headset profile switch) or routes iOS audio to the earpiece. That's why recorded mode has no mic.

## 9. Status and open items

Verified in text mode: start/greeting, coach-initiated switching (tools), button switching + announce, "listen again", pause/resume, ✕, fallback on token failure, giving-up flow with the school's easier variant.

Not yet verified:
- real voice: mic permission, turn-taking, interruptions, speaking/listening states
- the 2-min pause hang-up + reconnect, and the 30-min limit
- iPhone/Android, especially the installed PWA (mic quirks)
- production deployment of `/api/token`

Content to-dos (instructor): coach scripts for the other 14 exercises (recorded mode), "Enklare" variants for most exercises (only Bear Walk and Kung Fu Pushups have one), review of glossary and prompt wording.

Before students use it: a hard spending cap (support ticket and/or a server-side budget, see Billing), decide on data retention in ElevenLabs (transcripts and audio are stored by default; students may be minors, so GDPR consent applies), raise the daily call limit, and set the allowlist.
