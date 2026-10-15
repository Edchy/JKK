// What the app tells the live coach (ElevenLabs agent) about where the
// student is. Built from the same content/*.json the app shows, so the
// coach always knows exactly what is on screen.
//
// Messages start with "[Appen]" so the coach can tell them apart from the
// student (the system prompt explains this).

const numbered = (items) => items.map((t, k) => `${k + 1}. ${t}`).join("\n");

// Once, when the session starts: the whole pass at a glance.
export function passContext(pass, list) {
  return `[Appen] Eleven har startat ${pass.title}, ${list.length} övningar:\n${numbered(list.map((e) => e.name))}`;
}

// Every time the exercise changes: everything the coach needs to guide it.
export function exerciseContext(pass, list, i) {
  const ex = list[i];
  const steps = ex.steps?.length ? ex.steps.map((s) => `${s.title}: ${s.text}`) : ex.text || [];
  return [
    `[Appen] Eleven är nu på övning ${i + 1} av ${list.length} i ${pass.title}: ${ex.name}${ex.subtitle ? ` (${ex.subtitle})` : ""}.`,
    // counted here – the model got "how many are left" wrong when it had to work it out
    i === list.length - 1 ? "Det är passets sista övning." : `Övningar kvar efter den här: ${list.length - 1 - i}.`,
    ex.dose && `Mängd: ${ex.dose}.`,
    ex.focus && `Fokus: ${ex.focus}`,
    steps.length && `Instruktioner:\n${numbered(steps)}`,
    ...(ex.variations || []).map((v) => `${v.label}: ${v.text}`),
  ]
    .filter(Boolean)
    .join("\n");
}

// ---- the live session's other moments ----

// First message of a conversation (the agent has no fixed first message).
// Only "the pass has started" – the coach answers with a greeting. The current
// exercise goes in silently first (exerciseContext), so the greeting doesn't
// turn into a lecture before the student has even said hello.
// The time of day gives the greeting something new to say each time
// (with nothing to vary, the coach opened every pass with the same line).
export const openingNote = (pass, list) => `${passContext(pass, list)}\nTid hos eleven: ${now()}.`;

const now = () =>
  new Date().toLocaleString("sv-SE", { weekday: "long", hour: "2-digit", minute: "2-digit" });

// After a long pause the conversation was closed; a new one starts with this.
// It's a new conversation, so it gets the pass list again (go_to_exercise needs the numbers).
export const resumeNote = (pass, list, i) =>
  `[Appen] Eleven fortsätter ${pass.title} efter en paus. Passets övningar:\n${numbered(list.map((e) => e.name))}\n\n${exerciseContext(pass, list, i).replace(/^\[Appen\] /, "")}`;

// Pausing keeps the conversation open for a while (see live-coach.js).
export const pauseNote = () => "[Appen] Eleven har pausat. Säg ingenting förrän eleven fortsätter.";
export const unpauseNote = () => "[Appen] Eleven fortsätter efter en kort paus.";

export const repeatNote = () => "[Appen] Eleven vill höra instruktionerna för den här övningen igen.";

export const finishNote = (pass) => `[Appen] Eleven har avslutat ${pass.title}.`;

// A tool's answer shouldn't look like a message the coach could write itself
// (models start imitating "[Appen] …" notes – and inventing their content).
export const asToolResult = (note) => "Klart, appen visar nu den nya övningen.\n" + note.replace(/^\[Appen\] /, "");
