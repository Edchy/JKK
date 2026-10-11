// Voice: a calm Swedish speaker and a command listener (SpeechRecognition).
// The speaker plays pre-recorded ElevenLabs clips (audio/index.json, made by
// tools/generate-voice.mjs) and falls back to the device's own voice
// (speechSynthesis) for any line without a clip. Everything is optional –
// the session works with buttons alone.

const LANG = "sv-SE";

// ---------- Speaker ----------
// Speaks a list of lines one at a time with pauses in between, and reports
// which line is being spoken. A new say() or stop() cancels the previous run.

// 0.1 s of silence, used to unlock <audio> inside a tap (iOS)
const SILENCE = "data:audio/wav;base64,UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export function createSpeaker({ rate = 0.92, sentenceGap = 450, defaultGap = 1100 } = {}) {
  const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
  const audio = new Audio();
  audio.preload = "auto";
  let clips = {};         // text -> file, from audio/index.json
  let voice = null;
  let run = 0;            // increments on every say()/stop(); stale callbacks compare against it
  let current = "";       // text being spoken right now (used to ignore our own echo)
  let keep = null;        // keep a reference: Chrome drops onend for garbage-collected utterances
  let recent = "";        // what we just said – recognition results arrive late, so ignore it a bit longer
  let recentUntil = 0;

  fetch("audio/index.json")
    .then((r) => (r.ok ? r.json() : { clips: {} }))
    .then((m) => (clips = m.clips || {}))
    .catch(() => {});

  function pickVoice() {
    if (!synth) return;
    const sv = synth.getVoices().filter((v) => v.lang?.replace("_", "-").toLowerCase().startsWith("sv"));
    // prefer higher quality voices when the device has them
    const score = (v) =>
      (/premium|enhanced|förbättrad|neural|natural/i.test(v.name) ? 4 : 0) +
      (/alva|klara|google/i.test(v.name) ? 2 : 0) +
      (v.localService ? 1 : 0);
    voice = sv.sort((a, b) => score(b) - score(a))[0] || null;
  }
  if (synth) {
    pickVoice();
    synth.addEventListener?.("voiceschanged", pickVoice);
  }

  const wait = (ms, id) => new Promise((r) => setTimeout(() => r(id === run), ms));

  // Clips are fetched whole and played from memory: no range requests, so it
  // works the same from the network and from the offline cache (Safari is picky).
  const blobs = new Map(); // file -> Promise<object URL>
  function load(file) {
    if (!blobs.has(file)) {
      blobs.set(
        file,
        fetch(`audio/${file}`)
          .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
          .then((b) => URL.createObjectURL(b))
          .catch((e) => { blobs.delete(file); throw e; })
      );
    }
    return blobs.get(file);
  }

  function begin(text) { current = text; }
  function end(text) {
    if (current === text) current = "";
    recent = text;
    recentUntil = Date.now() + 2500;
  }

  async function playClip(text, file, id) {
    let url;
    try { url = await load(file); } catch { return false; }
    return new Promise((resolve) => {
      if (id !== run) return resolve(false);
      begin(text);
      const done = (ok) => {
        audio.onended = audio.onerror = audio.onplaying = null;
        end(text);
        resolve(ok && id === run);
      };
      audio.onplaying = () => console.debug(`[voice] clip playing at ${(performance.now() / 1000).toFixed(2)}s:`, text.slice(0, 40));
      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      audio.src = url;
      audio.play().catch(() => done(false));
    });
  }

  function speakOne(text, id) {
    return new Promise((resolve) => {
      if (!synth || id !== run) return resolve(false);
      const u = new SpeechSynthesisUtterance(text);
      u.lang = LANG;
      if (voice) u.voice = voice;
      u.rate = rate;
      keep = u;
      begin(text);
      const done = () => { end(text); resolve(id === run); };
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    });
  }

  const sentences = (line) => line.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) || [line];

  async function speakLine(text, id) {
    if (clips[text]) {
      if (await playClip(text, clips[text], id)) return true;
      if (id !== run) return false; // stopped – otherwise the clip failed, fall back to the device voice
    }
    if (!synth) return id === run;
    for (const s of sentences(text)) {
      if (!(await speakOne(s, id))) return false;
      if (!(await wait(sentenceGap, id))) return false;
    }
    return true;
  }

  return {
    supported: !!synth || typeof audio.play === "function",
    get speaking() { return !!current; },
    // text the listener should not react to: what we're saying now, and what we said a moment ago
    get echoText() { return current + " " + (Date.now() < recentUntil ? recent : ""); },

    // Browsers only allow sound that starts inside a user gesture; call this from a tap.
    unlock() {
      audio.src = SILENCE;
      audio.play().catch(() => {});
      // iOS also needs speechSynthesis started in a gesture. Not on other
      // browsers: Chrome drops speech queued right after a cancel().
      if (synth && /iP(hone|ad|od)/.test(navigator.userAgent)) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        synth.speak(u);
      }
    },

    // lines: [{ text, gap?, onStart? }]. Resolves true when all lines were spoken.
    async say(lines, startAt = 0) {
      const busy = synth && (synth.speaking || synth.pending);
      this.stop();
      const id = run;
      if (busy && !(await wait(150, id))) return false; // let Chrome finish cancelling
      // start downloading every clip of this run now, so there are no gaps
      lines.slice(startAt).forEach((l) => clips[l.text] && load(clips[l.text]).catch(() => {}));
      for (let i = startAt; i < lines.length; i++) {
        lines[i].onStart?.(i);
        if (!(await speakLine(lines[i].text, id))) return false;
        if (i < lines.length - 1 && !(await wait(lines[i].gap ?? defaultGap, id))) return false;
      }
      return id === run;
    },

    stop() {
      run++;
      current = "";
      audio.pause();
      if (synth && (synth.speaking || synth.pending)) synth.cancel();
    },
  };
}

// ---------- Listener ----------
// Continuous recognition that maps what you say to a command.

const COMMANDS = {
  next: ["färdig", "klar", "nästa"],
  prev: ["tillbaka", "föregående", "bakåt"],
  repeat: ["igen", "upprepa"],
  pause: ["paus", "pausa", "stopp", "vänta"],
  resume: ["fortsätt", "spela"],
  end: ["avsluta"],
};

const norm = (s) => s.toLowerCase().normalize("NFC");

// Returns { command, word } for the first command word in the text, or null.
// Words that appear in `ignoreText` (what the app is saying right now) are skipped.
export function matchCommand(text, ignoreText = "") {
  const t = norm(text);
  const ignore = norm(ignoreText);
  let best = null;
  for (const [command, words] of Object.entries(COMMANDS)) {
    for (const word of words) {
      const re = new RegExp(`(?<!\\p{L})${word}(?!\\p{L})`, "u");
      const m = re.exec(t);
      if (!m || re.test(ignore)) continue;
      if (!best || m.index < best.index) best = { command, word, index: m.index };
    }
  }
  return best && { command: best.command, word: best.word };
}

export function createListener({ onCommand, onState, ignoreText = () => "" }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let wanted = false;
  let lastFire = 0;
  let fastEnds = 0;
  let startedAt = 0;
  const handled = new Set(); // result indexes already acted on (interim + final)

  let state = "off";
  const set = (next, detail) => { state = next; onState?.(next, detail); };

  function build() {
    rec = new SR();
    rec.lang = LANG;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    rec.onstart = () => { startedAt = Date.now(); set("listening"); };
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const key = `${startedAt}:${i}`;
        if (handled.has(key)) continue;
        const res = e.results[i];
        for (let a = 0; a < res.length; a++) {
          const hit = matchCommand(res[a].transcript, ignoreText());
          if (!hit) continue;
          handled.add(key);
          if (Date.now() - lastFire < 1200) break; // one command per breath
          lastFire = Date.now();
          onCommand(hit.command, hit.word);
          break;
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wanted = false;
        set("denied");
      } else if (e.error === "network") {
        wanted = false;
        set("offline");
      }
      // "no-speech" / "aborted" just end the session; onend restarts it
    };
    rec.onend = () => {
      // keep "denied"/"offline" visible instead of overwriting them with "off"
      if (!wanted) return state === "denied" || state === "offline" ? undefined : set("off");
      // browsers stop recognition after silence – start again, but back off if it keeps dying
      fastEnds = Date.now() - startedAt < 1500 ? fastEnds + 1 : 0;
      if (fastEnds > 4) { wanted = false; return set("error"); }
      setTimeout(() => wanted && safeStart(), 250 * (fastEnds + 1));
    };
  }

  function safeStart() {
    try { rec.start(); } catch { /* already started */ }
  }

  return {
    supported: !!SR,
    get on() { return wanted; },
    start() {
      if (!SR) return set("unsupported");
      if (!rec) build();
      wanted = true;
      if (state === "offline") set("off");
      fastEnds = 0;
      safeStart();
    },
    stop() {
      wanted = false;
      try { rec?.abort(); } catch {}
      set("off");
    },
  };
}
