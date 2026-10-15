// The live coach: a voice conversation with the ElevenLabs agent.
//
// The session screen (app.js) only uses the small API returned by
// createLiveCoach(); everything about tickets, the SDK and pausing lives here.
//
//   const coach = createLiveCoach({ tools, tester, onState, onLine, onEnd });
//   await coach.start(opening, context)  // ticket → connect → silent context, then the opening note
//   coach.say(note)                  // a message the coach should answer (e.g. student tapped Nästa)
//   coach.pause(note) / coach.resume(shortNote, newConversationNote)
//   coach.end()
//
// Pause: mutes mic + voice at once. After PAUSE_HANGUP of silence it hangs up so
// the paused minutes aren't billed; resume() then reconnects with a fresh note.

// The ElevenLabs SDK, self-hosted (tools/vendor-sdk.sh) so no CDN sees the student's IP.
const SDK = "./vendor/elevenlabs-client.js";
// audio resampler the SDK needs on some browsers (otherwise fetched from jsDelivr)
const RESAMPLER = new URL("./vendor/libsamplerate.worklet.js", import.meta.url).href;
const PAUSE_HANGUP = 2 * 60 * 1000;   // hang up after 2 min of pause
const HOLD_EVERY = 1500;              // "student is busy" signal while paused (each holds the coach ~2 s)
const MAX_LENGTH = 30 * 60 * 1000;    // our own limit per conversation (cost guard)

// ?textonly in the address: no microphone or audio, for testing by typing (localhost)
export const TEXT_ONLY = new URLSearchParams(location.search).has("textonly");

export function createLiveCoach({ tools, tester, onState, onLine, onEnd }) {
  let conversation = null;
  let state = "off";        // off | connecting | listening | speaking | paused | ended
  let pauseTimer = 0;
  let holdTimer = 0;
  let lengthTimer = 0;
  let endedByUs = false;
  let pendingLine = "";     // the coach's next words, shown once its voice starts

  const set = (s) => { state = s; onState?.(s); };

  // mic + voice off/on. Text conversations have no mic or voice (the SDK throws),
  // and a failed mute must never take the coach down.
  function quiet(on) {
    if (TEXT_ONLY || !conversation) return;
    try {
      conversation.setMicMuted(on);
      conversation.setVolume({ volume: on ? 0 : 1 });
    } catch (e) {
      console.warn("[live] mute failed:", e);
    }
  }

  async function connect() {
    set("connecting");
    // 1. microphone first (shows the permission prompt the first time)
    if (!TEXT_ONLY) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop()); // the SDK opens its own; this was just for permission
    }
    // 2. a ticket from our server – the API key never reaches the phone
    // the tester code: online, the server only gives tickets to the owner's phone
    const res = await fetch("/api/token", { cache: "no-store", headers: tester ? { "X-Tester": tester } : {} });
    if (!res.ok) throw new Error(`token ${res.status}`);
    const { signedUrl } = await res.json();
    // 3. the SDK, loaded only now (it's big, and only live mode needs it)
    const { Conversation } = await import(SDK);
    endedByUs = false;
    conversation = await Conversation.startSession({
      signedUrl,
      libsampleratePath: RESAMPLER,
      ...(TEXT_ONLY && { textOnly: true, overrides: { conversation: { textOnly: true } } }),
      clientTools: tools,
      onModeChange: ({ mode }) => {                                       // "speaking" | "listening"
        if (state === "paused") return;
        set(mode);
        if (mode === "speaking" && pendingLine) { onLine?.(pendingLine); pendingLine = ""; }
      },
      // The text arrives before the audio: hold it until the coach starts speaking.
      // Nothing is shown while paused (the coach is muted then).
      onMessage: ({ message, role }) => {
        if (role !== "agent" || state === "paused") return;
        const text = message.replace(/\[[^\]]*\]\s*/g, "");
        if (TEXT_ONLY || state === "speaking") onLine?.(text);
        else pendingLine = text;
      },
      onError: (msg) => console.warn("[live] error:", msg),
      onDisconnect: (details) => {
        conversation = null;
        clearTimeout(lengthTimer);
        if (state === "paused") return;          // we hung up during a pause – resume() reconnects
        set("ended");
        if (!endedByUs) onEnd?.(details);        // dropped, or ended by ElevenLabs
      },
    });
    lengthTimer = setTimeout(() => { endedByUs = false; conversation?.endSession(); }, MAX_LENGTH);
    if (state === "connecting") set("listening");
  }

  return {
    get state() { return state; },

    // Connect, give the coach the current exercise silently, then the opening
    // note it answers with a greeting (the agent has no fixed first message).
    async start(openingNote, context) {
      await connect();
      if (context) conversation.sendContextualUpdate(context);
      conversation.sendUserMessage(openingNote);
    },

    // Background info the coach shouldn't answer.
    note(text) { conversation?.sendContextualUpdate(text); },

    // A message the coach should answer.
    say(text) { conversation?.sendUserMessage(text); },

    // Muting alone isn't enough: the conversation keeps running, and after the
    // turn timeout the coach takes its turn and talks into the muted speaker.
    // "User activity" holds it back for ~2 s, so we keep sending it while paused.
    pause(note) {
      if (!conversation || state === "paused") return;
      quiet(true);
      set("paused");
      if (note) conversation.sendContextualUpdate(note);
      const hold = () => { try { conversation?.sendUserActivity(); } catch {} };
      hold();
      holdTimer = setInterval(hold, HOLD_EVERY);
      pauseTimer = setTimeout(() => { endedByUs = true; conversation?.endSession(); }, PAUSE_HANGUP);
    },

    // shortNote: same conversation, the coach picks up again.
    // newConversationNote: we had hung up during the pause and start over.
    async resume(shortNote, newConversationNote) {
      clearTimeout(pauseTimer);
      clearInterval(holdTimer);
      if (conversation) {
        quiet(false);
        set("listening");
        if (shortNote) conversation.sendUserMessage(shortNote);
        return;
      }
      set("off");
      await connect();
      conversation.sendUserMessage(newConversationNote);
    },

    end() {
      clearTimeout(pauseTimer);
      clearInterval(holdTimer);
      clearTimeout(lengthTimer);
      endedByUs = true;
      set("ended");
      conversation?.endSession();
      conversation = null;
    },
  };
}
