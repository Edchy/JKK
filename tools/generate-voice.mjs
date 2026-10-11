// Record everything the guided session says with ElevenLabs.
//
//   node tools/generate-voice.mjs --voices    list voices on your account (pick one)
//   node tools/generate-voice.mjs --models    list text-to-speech models (and whether they speak Swedish)
//   node tools/generate-voice.mjs --dry-run   show what would be recorded, and how many characters
//   node tools/generate-voice.mjs --sample    record only the first exercise of the first pass, its cues and the finish (to test the voice)
//   node tools/generate-voice.mjs             record missing clips, update app/audio/index.json,
//                                             delete clips that are no longer used
//
// Needs a .env file in the project root (never committed, never shipped):
//   ELEVENLABS_API_KEY=...
//   ELEVENLABS_VOICE_ID=...   (optional, defaults to the chosen voice below)
//   ELEVENLABS_MODEL=...      (optional, defaults to eleven_v4)
//
// Clips are named by a hash of voice + model + settings + text, so changing a
// sentence (or the voice) only re-records what actually changed.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allLines, exerciseLines, cueLines, finished } from "../app/speech.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "app");
const outDir = join(app, "audio");
const args = new Set(process.argv.slice(2));

// ---- config ----
function loadEnv() {
  const file = join(root, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();
const KEY = process.env.ELEVENLABS_API_KEY;
// the school's chosen voice and model; .env can override both
const VOICE = process.env.ELEVENLABS_VOICE_ID || "nEJYXtiAMFuP7hh9yoi4";
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_v4";
// calm and steady; speed < 1 slows the delivery slightly
const SETTINGS = { stability: 0.6, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 0.9 };
const FORMAT = "mp3_44100_64";

if (!KEY && !args.has("--dry-run")) {
  console.error("Missing ELEVENLABS_API_KEY. Add it to .env in the project root (see .env.example).");
  process.exit(1);
}

async function api(path, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.elevenlabs.io${path}`, {
      ...init,
      headers: { "xi-api-key": KEY, ...(init.headers || {}) },
    });
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }
}

// ---- --models ----
if (args.has("--models")) {
  const models = await (await api("/v1/models")).json();
  for (const m of models) {
    if (!m.can_do_text_to_speech) continue;
    const sv = (m.languages || []).some((l) => l.language_id === "sv") ? "svenska ✓" : "svenska –";
    console.log(`${m.model_id.padEnd(28)} ${m.name.padEnd(32)} ${sv}`);
  }
  process.exit(0);
}

// ---- --voices ----
if (args.has("--voices")) {
  const { voices } = await (await api("/v1/voices")).json();
  for (const v of voices) {
    const l = v.labels || {};
    console.log(`${v.voice_id}  ${v.name.padEnd(28)} ${[l.language, l.accent, l.gender, l.age, l.descriptive || l.description].filter(Boolean).join(", ")}`);
  }
  console.log(`\nPut the id you like in .env as ELEVENLABS_VOICE_ID. Swedish voices from the Voice Library must be added to "My voices" first.`);
  process.exit(0);
}

if (!VOICE && !args.has("--dry-run")) {
  console.error("Missing ELEVENLABS_VOICE_ID in .env. Run with --voices to list voices.");
  process.exit(1);
}

// ---- what to say ----
const json = (f) => JSON.parse(readFileSync(join(app, "content", f), "utf8"));
const { passes, coach } = json("index.json");
const { exercises } = json("exercises.json");
const sample = args.has("--sample");
// --sample: only what the session says for the first exercise of the first pass
function sampleLines() {
  const pass = passes[0];
  const list = pass.exercises.map((id) => exercises.find((e) => e.id === id)).filter(Boolean);
  const ex = list[0];
  const said = exerciseLines({ pass, coach, ex, i: 0, n: list.length, first: true, canListen: true });
  return [...new Set([...said.map((l) => l.text), ...cueLines(ex), ...finished(pass, coach)])];
}
const lines = sample ? sampleLines() : allLines({ passes, exercises, coach });

const fileFor = (text) =>
  createHash("sha1").update(JSON.stringify([VOICE, MODEL, SETTINGS, text])).digest("hex").slice(0, 16) + ".mp3";

mkdirSync(outDir, { recursive: true });
const clips = Object.fromEntries(lines.map((t) => [t, fileFor(t)]));
// keep clips from earlier runs that are still valid (so --sample doesn't forget them)
const all = Object.fromEntries(allLines({ passes, exercises, coach }).map((t) => [t, fileFor(t)]));
const missing = lines.filter((t) => !existsSync(join(outDir, clips[t])));
const chars = missing.reduce((n, t) => n + t.length, 0);

console.log(`${lines.length} lines · ${missing.length} to record · ${chars} characters`);
if (args.has("--dry-run")) {
  missing.forEach((t) => console.log("  " + t));
  process.exit(0);
}

// ---- record ----
let done = 0;
async function record(text) {
  const res = await api(`/v1/text-to-speech/${VOICE}?output_format=${FORMAT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL, voice_settings: SETTINGS }),
  });
  writeFileSync(join(outDir, clips[text]), Buffer.from(await res.arrayBuffer()));
  console.log(`  [${++done}/${missing.length}] ${text.slice(0, 70)}${text.length > 70 ? "…" : ""}`);
}
const queue = [...missing];
await Promise.all(Array.from({ length: 2 }, async () => { while (queue.length) await record(queue.shift()); }));

// ---- manifest + prune ----
// the manifest only lists clips that exist; the app uses the device voice for the rest
const recorded = Object.fromEntries(Object.entries(all).filter(([, f]) => existsSync(join(outDir, f))));
writeFileSync(join(outDir, "index.json"), JSON.stringify({ voice: VOICE, model: MODEL, clips: recorded }, null, 2) + "\n");
const keep = new Set(Object.values(all));
let removed = 0;
for (const f of readdirSync(outDir)) {
  if (f.endsWith(".mp3") && !keep.has(f)) { unlinkSync(join(outDir, f)); removed++; }
}
console.log(`Done. app/audio/index.json updated${removed ? `, ${removed} old clips removed` : ""}.`);
console.log("Bump VERSION in app/sw.js so installed apps download the new audio.");
