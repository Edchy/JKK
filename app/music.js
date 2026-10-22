// Background music during a pass (content/index.json → passes[].music): one
// track on loop, under the coach's voice.
//
// The quiet level is baked into the file (iPhones ignore audio.volume, it's
// always 1), so volume is only used for a short fade-out where the browser
// allows it; on iPhone the music simply stops.

import { SILENCE } from "./voice.js";

export function createMusic() {
  const audio = new Audio();
  audio.loop = true;
  audio.preload = "auto";
  let file = "";        // the track that's playing or about to ("" = none)
  let started = false;  // audio.src is the track (not just the unlock silence)
  let paused = false;
  let run = 0;          // increments on every start/stop; stale callbacks compare against it
  let timer = 0;        // pending start
  let fader = 0;

  // fetched whole and played from memory, like the voice clips: no range
  // requests, so it works the same from the network and the offline cache
  const blobs = new Map(); // file -> Promise<object URL>
  function load(f) {
    if (!blobs.has(f)) {
      blobs.set(
        f,
        fetch(f)
          .then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
          .then((b) => URL.createObjectURL(b))
          .catch((e) => { blobs.delete(f); throw e; })
      );
    }
    return blobs.get(f);
  }

  function play(id) {
    load(file)
      .then((url) => {
        if (id !== run || paused) return;
        clearInterval(fader);
        audio.src = url;
        audio.volume = 1;
        started = true;
        audio.play().catch(() => {});
      })
      .catch(() => {}); // no file (offline and not cached): stay quiet
  }

  return {
    get playing() { return !!file; },

    // Browsers only allow sound that starts inside a user gesture; call this from a tap.
    unlock() {
      if (started) return;
      audio.src = SILENCE;
      audio.play().catch(() => {});
    },

    // play f from the top after delay ms
    start(f, delay = 0) {
      this.stop(0);
      const id = run;
      file = f;
      load(f).catch(() => {}); // download during the delay
      timer = setTimeout(() => play(id), delay);
    },

    pause() {
      if (!file || paused) return;
      paused = true;
      clearTimeout(timer);
      if (started) audio.pause();
    },

    resume() {
      if (!file || !paused) return;
      paused = false;
      if (started) audio.play().catch(() => {});
      else timer = setTimeout(() => play(run), 1000); // it was still waiting to start
    },

    // fade out over ms (where volume works), then stop
    // (a start() during the fade cuts it short: it calls stop(0) first)
    stop(ms = 1500) {
      const id = ++run;
      clearTimeout(timer);
      clearInterval(fader);
      file = "";
      paused = false;
      if (!started) return;
      const from = audio.volume, t0 = performance.now();
      const done = () => { clearInterval(fader); if (id !== run) return; started = false; audio.pause(); };
      if (!ms) return done();
      fader = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        audio.volume = from * (1 - k);
        if (k === 1) done();
      }, 50);
    },
  };
}
