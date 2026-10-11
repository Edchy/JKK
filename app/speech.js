// Everything the guided session says, in one place. Used by the app (to play
// the lines) and by tools/generate-voice.mjs (to record them with ElevenLabs),
// so the recorded clips always match the text exactly.
//
// Exercises with a `coach` script (exercises.json) are taught the way a sensei
// would: an intro, guidance that follows the steps, and encouraging cues while
// you work. Exercises without one fall back to reading their steps.
//
//   "coach": {
//     "intro": ["Vi börjar mjukt med wide stance."],
//     "guide": [{ "text": "...", "step": 0 }, ...],   // step = which card to highlight
//     "cues":  ["Andas lugnt.", ...]                   // spoken now and then while you work
//   }

// read numbers and dashes the way a person would
export const spoken = (t) =>
  t.replace(/(\d+)\s*[-–]\s*(\d+)/g, "$1 till $2").replace(/\s*%/g, " procent").replace(/\s[-–]\s/g, ", ").trim();

const pick = (arr, i) => (arr?.length ? arr[i % arr.length] : null);

// ---- fallback: read the steps ----
const stepsAsLines = (ex) =>
  (ex.steps?.length ? ex.steps.map((s) => `${s.title}. ${s.text}`) : ex.text || []).map(spoken);
const titleLine = (ex) => spoken([`${ex.name}.`, ex.dose && `${ex.dose}.`].filter(Boolean).join(" "));

// ---- session framing (index.json → "coach") ----
export const welcome = (pass, coach) =>
  pass.coach?.welcome || [`Välkommen. Idag kör vi ${pass.title}. Vi tar det lugnt och lyssnar på kroppen.`];
export const howTo = (coach, canListen) =>
  canListen ? coach?.howToVoice || "Säg färdig när du är klar, så går vi vidare." : coach?.howToTap || "Tryck på färdig när du är klar, så går vi vidare.";
export const transition = (coach, i) => pick(coach?.transitions, i) || "Bra.";
export const lastUp = (coach) => coach?.last || "Sista övningen nu.";
export const finished = (pass, coach) => pass.coach?.finish || [`Bra jobbat. ${pass.title} är klart.`];

// Lines when an exercise starts. step = instruction card to highlight (-1 = none);
// gap = pause after the line, in ms.
export function exerciseLines({ pass, coach, ex, i, n, first, canListen }) {
  const lines = [];
  const say = (text, step = -1, gap = 700) => lines.push({ text: spoken(text), step, gap });

  if (first) welcome(pass, coach).forEach((t) => say(t, -1, 900));
  else say(transition(coach, i), -1, 500);
  if (i === n - 1 && n > 1) say(lastUp(coach), -1, 500);

  if (ex.coach) {
    ex.coach.intro?.forEach((t) => say(t, -1, 700));
    ex.coach.guide?.forEach((g) => say(g.text, g.step ?? -1, g.pause ?? 1200));
  } else {
    say(titleLine(ex), -1, 900);
    stepsAsLines(ex).forEach((t, k) => say(t, k, 1100));
  }
  if (first) say(howTo(coach, canListen), -1, 0);
  return lines;
}

// Encouragement while the student works, one at a time.
export const cueLines = (ex) => (ex.coach?.cues || []).map(spoken);

// Every distinct line the app can say, given the content. For the recorder.
export function allLines({ passes, exercises, coach }) {
  const set = new Set();
  const add = (t) => t && set.add(spoken(t));
  for (const pass of passes) {
    const list = pass.exercises.map((id) => exercises.find((e) => e.id === id)).filter(Boolean);
    const n = list.length;
    list.forEach((ex, i) =>
      exerciseLines({ pass, coach, ex, i, n, first: i === 0, canListen: true }).forEach((l) => add(l.text))
    );
    list.forEach((ex, i) =>
      exerciseLines({ pass, coach, ex, i, n, first: i === 0, canListen: false }).forEach((l) => add(l.text))
    );
    list.forEach((ex) => cueLines(ex).forEach(add));
    finished(pass, coach).forEach(add);
  }
  return [...set];
}
