// The recorded coach's voice. Plays pre-recorded ElevenLabs clips
// (audio/index.json, made by tools/generate-voice.mjs). A line without a clip
// is skipped: silence is better than the device's own voice (speechSynthesis),
// which sounded robotic and was unreliable in Chrome.
// This is the offline fallback; the live coach (ElevenLabs agent) talks and
// listens by itself.

// ---------- Speaker ----------
// Speaks a list of lines one at a time with pauses in between, and reports
// which line is being spoken. A new say() or stop() cancels the previous run.

// 0.1 s of silence, used to unlock <audio> inside a tap (iOS); music.js uses it too
export const SILENCE = "data:audio/wav;base64,UklGRmQGAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export function createSpeaker({ defaultGap = 1100 } = {}) {
  const audio = new Audio();
  audio.preload = "auto";
  let clips = {};         // text -> file, from audio/index.json
  let run = 0;            // increments on every say()/stop(); stale callbacks compare against it
  let current = "";       // text being spoken right now

  // say() waits for this: a line looked up before the list arrives would be
  // skipped as "not recorded"
  const ready = fetch("audio/index.json")
    .then((r) => (r.ok ? r.json() : { clips: {} }))
    .then((m) => (clips = m.clips || {}))
    .catch(() => {});

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

  return {
    supported: typeof audio.play === "function",
    get speaking() { return !!current; },

    // Browsers only allow sound that starts inside a user gesture; call this from a tap.
    unlock() {
      audio.src = SILENCE;
      audio.play().catch(() => {});
    },

    // lines: [{ text, gap?, onStart? }]. Resolves true when all lines were spoken.
    async say(lines, startAt = 0) {
      this.stop();
      const id = run;
      await ready;
      if (id !== run) return false;
      // start downloading every clip of this run now, so there are no gaps
      lines.slice(startAt).forEach((l) => clips[l.text] && load(clips[l.text]).catch(() => {}));
      let gap = null; // pause owed after the last line that played
      for (let i = startAt; i < lines.length; i++) {
        const file = clips[lines[i].text];
        if (!file) continue; // not recorded: skip it – no sound, no pause, no highlight
        if (gap !== null && !(await wait(gap, id))) return false;
        lines[i].onStart?.(i);
        // a clip that won't load (offline and not cached) is skipped the same way
        if (!(await playClip(lines[i].text, file, id)) && id !== run) return false;
        gap = lines[i].gap ?? defaultGap;
      }
      return id === run;
    },

    stop() {
      run++;
      current = "";
      audio.pause();
    },
  };
}
