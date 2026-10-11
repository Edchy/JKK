// Kung Fu Fitness – tiny hash-routed PWA. Content lives in content/*.json.
//
// Routes:
//   #/                       home: animals + passes
//   #/<animal>               exercises for one animal (Apa / Björn / Tiger)
//   #/<animal>/<exercise>    exercise, prev/next within that animal
//   #/pass/<pass>            a ready-made session
//   #/pass/<pass>/<exercise> exercise, prev/next within that pass
//   #/kor/<pass>/<n>         guided session with voice (see voice.js)

import { createSpeaker, createListener } from "./voice.js";
import { exerciseLines, cueLines, finished } from "./speech.js";

const view = document.getElementById("view");

let site;
let glossary = [];
const exercises = new Map();
const animals = new Map();
const passes = new Map();
const tagNames = new Map();
const activeTag = {};   // remembered filter per animal page

// ---------- data ----------
async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}
async function loadSite() {
  const [index, lib, ordbok] = await Promise.all([
    getJSON("content/index.json"),
    getJSON("content/exercises.json"),
    getJSON("content/ordbok.json"),
  ]);
  glossary = ordbok.terms.slice().sort((a, b) => a.term.localeCompare(b.term, "sv"));
  const words = glossary.flatMap((t) => t.match || []).sort((a, b) => b.length - a.length);
  if (words.length) glossRe = new RegExp(`(?<!\\p{L})(${words.join("|")})(?!\\p{L})`, "giu");
  site = index;
  lib.exercises.forEach((e) => exercises.set(e.id, e));
  site.animals.forEach((a) => animals.set(a.id, a));
  site.passes.forEach((p) => passes.set(p.id, p));
  site.tags.forEach((t) => tagNames.set(t.id, t.name));
}
const imgSrc = (ex, n) => `img/${ex.id}-${n}.webp`;
const byAnimal = (id) => [...exercises.values()].filter((e) => e.animals.includes(id));
const passList = (p) => p.exercises.map((id) => exercises.get(id)).filter(Boolean);

// ---------- helpers ----------
const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const paras = (arr = [], f = esc) => arr.map((t) => `<p>${f(t)}</p>`).join("");

// Glossary words in exercise text become tappable. Only the first
// occurrence of each term per page is marked, to keep the text calm.
let glossRe = null;
function glossifier() {
  const seen = new Set();
  return (text) => {
    const html = esc(text);
    if (!glossRe) return html;
    return html.replace(glossRe, (m) => {
      const t = glossary.find((g) => g.match?.includes(m.toLowerCase()));
      if (!t || seen.has(t.term)) return m;
      seen.add(t.term);
      return `<button class="gloss" data-term="${esc(t.term)}" aria-haspopup="dialog">${m}</button>`;
    });
  };
}
const ic = (name) => `<span class="i i-${name}" aria-hidden="true"></span>`;
const arrow = `<span class="arrow">${ic("arrow-right")}</span>`;

function meta(ex) {
  const parts = [
    ex.dose && `${ic("clock")}${esc(ex.dose)}`,
    esc(ex.animals.map((id) => animals.get(id)?.name).filter(Boolean).join(" + ")),
    ...ex.tags.map((t) => esc(tagNames.get(t) || t)),
  ].filter(Boolean);
  return parts.length ? `<p class="meta">${parts.map((p) => `<span>${p}</span>`).join("")}</p>` : "";
}

function thumb(ex) {
  if (ex.images) return `<span class="thumb-frame"><img class="thumb art" src="${imgSrc(ex, 1)}" alt="" loading="lazy"></span>`;
  return `<span class="thumb-video">${ic("play")}</span>`;
}

function exerciseRows(list, base, numbered) {
  return `<ul class="list">${list
    .map(
      (ex, i) => `<li><a class="row" href="${base}/${ex.id}">
        ${numbered ? `<span class="num">${i + 1}</span>` : ""}
        ${thumb(ex)}
        <div><div class="name">${esc(ex.name)}</div>
          <div class="sub">${esc([ex.subtitle, ex.dose, ex.images ? "" : "Video"].filter(Boolean).join(" · "))}</div></div>
        ${arrow}</a></li>`
    )
    .join("")}</ul>`;
}

function setPage({ title }) {
  document.title = title ? `${title} · Kung Fu Fitness` : "Kung Fu Fitness";
}

// ---------- views ----------
function homeView() {
  setPage({});
  view.innerHTML = `
    <div class="page-head home-head">
      <h1><img class="home-logo" src="img/jarna-shaolin-logo.webp" width="800" height="800" alt="${esc(site.school)} – ${esc(site.program)}" fetchpriority="high"></h1>
    </div>

    <ul class="list">
      ${site.animals
        .map(
          (a) => `<li><a class="row animal-row" href="#/${a.id}">
            <span class="glyph" aria-hidden="true">${esc(a.glyph)}</span>
            <div><div class="name">${esc(a.name)}</div>
              <div class="sub">${esc(a.theme)} · ${byAnimal(a.id).length} övningar</div></div>
            ${arrow}</a></li>`
        )
        .join("")}
    </ul>

    <div id="install"></div>`;
  renderInstallHint();
}

function animalView(a) {
  setPage({ back: "#/", title: a.name });
  const all = byAnimal(a.id);
  const used = site.tags.filter((t) => all.some((e) => e.tags.includes(t.id)));
  const render = () => {
    const tag = activeTag[a.id];
    const list = tag ? all.filter((e) => e.tags.includes(tag)) : all;
    view.querySelector("#ex-list").innerHTML = exerciseRows(list, `#/${a.id}`, false);
    view.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", (c.dataset.tag || "") === (tag || "")));
  };
  view.innerHTML = `
    <div class="page-head animal-head">
      <h1 class="page-title">${esc(a.name)}</h1>
      <p class="lead">${esc(a.description)}</p>
    </div>
    ${
      used.length > 1
        ? `<div class="chips" role="group" aria-label="Filtrera">
            <button class="chip" data-tag="">Alla</button>
            ${used.map((t) => `<button class="chip" data-tag="${t.id}">${esc(t.name)}</button>`).join("")}
          </div>`
        : ""
    }
    <div id="ex-list"></div>`;
  view.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => {
      activeTag[a.id] = c.dataset.tag || undefined;
      render();
    })
  );
  render();
}

function passView(p) {
  setPage({ back: "#/pass", title: p.title });
  const list = passList(p);
  view.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">Färdigt pass</div>
      <h1 class="page-title">${esc(p.title)}</h1>
      <p class="lead">${list.length} övningar. Gör dem i ordning.</p>
      <button class="btn start-btn" data-start="${p.id}">${ic("play")}Starta pass</button>
    </div>
    ${exerciseRows(list, `#/pass/${p.id}`, true)}`;
}

// ---------- Tab pages: Pass, Ordbok, Info ----------
function passesView() {
  setPage({ title: "Pass" });
  view.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Färdiga pass</h1>
      <p class="lead">Hela träningspass. Gör övningarna i ordning.</p>
    </div>
    <ul class="list">
      ${site.passes
        .map(
          (p) => `<li><a class="row" href="#/pass/${p.id}">
            <div><div class="name">${esc(p.title)}</div>
            <div class="sub">${passList(p).length} övningar</div></div>
            ${arrow}</a></li>`
        )
        .join("")}
    </ul>`;
}

function ordbokView() {
  setPage({ title: "Ordbok" });
  view.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Ordbok</h1>
      <p class="lead">Ord som dyker upp i övningarna.</p>
    </div>
    <dl class="glossary">${glossary
      .map(
        (t) => `<div class="term"><dt>${esc(t.term)}${t.native ? ` <span class="native" lang="zh">${esc(t.native)}</span>` : ""}</dt>
          <dd>${esc(t.text)}</dd></div>`
      )
      .join("")}</dl>`;
}

function infoView() {
  setPage({ title: "Innan du börjar" });
  view.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Innan du börjar</h1>
    </div>
    ${site.principles
      .map(
        (p) => `<section class="principle"><h3>${esc(p.title)}</h3><ol class="instructions">${p.steps
          .map((st) =>
            typeof st === "string"
              ? `<li><div><p>${esc(st)}</p></div></li>`
              : `<li><div><h3>${esc(st.title)}</h3><p>${esc(st.text)}</p></div></li>`
          )
          .join("")}</ol></section>`
      )
      .join("")}`;
}

// ---------- Glossary word sheet ----------
const SHEETS = {
  term: {
    title: () => currentTerm.term,
    body: () => `
      ${currentTerm.native ? `<p class="native" lang="zh">${esc(currentTerm.native)}</p>` : ""}
      <p>${esc(currentTerm.text)}</p>
      <a class="sheet-link" href="#/ordbok">${ic("book-open")}Hela ordboken</a>`,
  },
};

function sheet(id) {
  let d = document.getElementById(id);
  if (d) return d;
  d = document.createElement("dialog");
  d.id = id;
  d.className = "sheet";
  d.setAttribute("aria-labelledby", `${id}-title`);
  d.innerHTML = `<div class="sheet-inner">
      <div class="sheet-grab" aria-hidden="true"></div>
      <div class="sheet-head">
        <h2 id="${id}-title" tabindex="-1" autofocus>${esc(SHEETS[id].title())}</h2>
        <button class="sheet-close" aria-label="Stäng">${ic("x")}</button>
      </div>
      ${SHEETS[id].body()}
    </div>`;
  d.querySelector(".sheet-close").addEventListener("click", () => d.close());
  // tap on the dimmed backdrop closes
  d.addEventListener("click", (e) => e.target === d && d.close());
  // drag the handle/header down to close (phone bottom-sheet behaviour)
  let y0 = null;
  const drag = d.querySelector(".sheet-inner");
  drag.addEventListener("touchstart", (e) => {
    if (d.scrollTop > 0 || !e.target.closest(".sheet-grab, .sheet-head")) return;
    y0 = e.touches[0].clientY;
  }, { passive: true });
  drag.addEventListener("touchmove", (e) => {
    if (y0 === null) return;
    d.style.transform = `translateY(${Math.max(0, e.touches[0].clientY - y0)}px)`;
  }, { passive: true });
  drag.addEventListener("touchend", (e) => {
    if (y0 === null) return;
    const dy = e.changedTouches[0].clientY - y0;
    y0 = null;
    d.style.transform = "";
    if (dy > 90) d.close();
  });
  document.body.append(d);
  return d;
}

let currentTerm = null;
view.addEventListener("click", (e) => {
  const g = e.target.closest("[data-term]");
  if (!g) return;
  currentTerm = glossary.find((t) => t.term === g.dataset.term);
  document.getElementById("term")?.remove(); // content changes per word
  sheet("term").showModal();
});

// ctx: { base, label, list, back, numbered }
function exerciseView(ex, ctx) {
  const i = ctx.list.indexOf(ex);
  const prev = ctx.list[i - 1];
  const next = ctx.list[i + 1];
  setPage({ back: ctx.back, title: ex.name });

  const steps = ex.steps || [];
  const figure = ex.images
    ? `<figure class="figure">${Array.from({ length: ex.images }, (_, k) =>
        `<img class="art" src="${imgSrc(ex, k + 1)}" alt="${esc(ex.name)}${ex.images > 1 ? `, del ${k + 1}` : ""}" decoding="async">`
      ).join("")}</figure>`
    : "";

  // Instructions are always an ordered list. Step-by-step exercises number
  // by the picture numbers printed in the illustration ("3–4").
  const g = glossifier();
  const instructions = steps.length
    ? `<ol class="instructions">${steps
        .map((s) => `<li data-n="${bildNum(s.bild)}"><div><h3>${esc(s.title)}</h3><p>${g(s.text)}</p></div></li>`)
        .join("")}</ol>`
    : `<ol class="instructions">${(ex.text || []).map((t) => `<li><div><p>${g(t)}</p></div></li>`).join("")}</ol>`;
  const notes = steps.length && ex.text ? `<div class="notes">${paras(ex.text, g)}</div>` : "";

  view.innerHTML = `
    <div class="page-head">
      <div class="eyebrow">${esc(ctx.label)}${ctx.numbered ? ` · ${i + 1} av ${ctx.list.length}` : ""}</div>
      <h1 class="page-title">${esc(ex.name)}</h1>
      ${ex.subtitle ? `<p class="lead">${esc(ex.subtitle)}</p>` : ""}
      ${meta(ex)}
      ${videoBlock(ex)}
    </div>

    ${figure}

    <section class="section">
      <h2 class="section-title">Så gör du</h2>
      ${ex.focus ? `<p class="focus">${g(ex.focus)}</p>` : ""}
      ${instructions}
      ${notes}
    </section>

    ${
      ex.variations?.length
        ? `<section class="section"><h2 class="section-title">Anpassa</h2>${ex.variations
            .map((v) => `<div class="variation"><span class="label">${esc(v.label)}</span><p>${g(v.text)}</p></div>`)
            .join("")}</section>`
        : ""
    }

    <nav class="pager" aria-label="Övningar">
      ${prev ? `<a class="prev" href="${ctx.base}/${prev.id}"><span class="k">${ic("arrow-left")}Föregående</span><span class="n">${esc(prev.name)}</span></a>` : ""}
      ${next ? `<a class="next" href="${ctx.base}/${next.id}"><span class="k">Nästa${ic("arrow-right")}</span><span class="n">${esc(next.name)}</span></a>` : ""}
    </nav>`;

  wireVideos();
}

const bildNum = (f) => (f.length > 1 ? `${f[0]}–${f[f.length - 1]}` : `${f[0]}`);

function videoBlock(ex) {
  const vids = [];
  if (ex.video) vids.push({ id: ex.video, title: "Se video" });
  (ex.extraVideos || []).forEach((v) => vids.push(v));
  if (!vids.length) return "";
  return `<div class="videos">${vids
    .map((v) => `<button class="video-link" data-video="${esc(v.id)}">${ic("play")}<span>${esc(v.title)}</span></button>`)
    .join("")}</div><p class="video-note" hidden></p>`;
}

function wireVideos() {
  view.querySelectorAll("[data-video]").forEach((b) =>
    b.addEventListener("click", () => {
      const note = view.querySelector(".video-note");
      if (!navigator.onLine) {
        note.textContent = "Du är offline – videon kan inte visas just nu.";
        note.hidden = false;
        return;
      }
      note.hidden = true;
      view.querySelector(".video-frame")?.remove();
      view.querySelector(".videos").insertAdjacentHTML(
        "afterend",
        `<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(b.dataset.video)}?autoplay=1&rel=0&playsinline=1"
          title="${esc(b.textContent)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
      );
    })
  );
}

// ---------- install hint ----------
let deferredPrompt = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  renderInstallHint();
});

function renderInstallHint() {
  const slot = document.getElementById("install");
  if (!slot) return;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) return (slot.innerHTML = "");
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (deferredPrompt) {
    slot.innerHTML = `<div class="install"><p>Installera appen så finns den på hemskärmen och fungerar utan internet.</p>
      <button class="btn">${ic("download")}Installera</button></div>`;
    slot.querySelector("button").addEventListener("click", async () => {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      slot.innerHTML = "";
    });
  } else if (ios) {
    slot.innerHTML = `<div class="install"><p>Tips: tryck på Dela och välj Lägg till på hemskärmen så finns appen alltid nära till hands.</p></div>`;
  }
}

// ---------- Guided session: "Starta pass" ----------
// #/kor/<pass>/<n>  – full-screen, one exercise at a time. A coach voice
// explains the exercise (speech.js), then encourages you now and then while
// you work. The microphone only listens while the coach is quiet – say
// "färdig" (or tap Färdig) to move on.

const CUE_FIRST = 20000;   // first encouragement this long after the explanation
const CUE_EVERY = 25000;   // then this often, until the exercise's cues run out
let t0 = 0;
const log = (...a) => console.debug(`[voice] ${((performance.now() - t0) / 1000).toFixed(2)}s`, ...a);

const prefs = (() => {
  const d = { sound: true, mic: true };
  try { return { ...d, ...JSON.parse(localStorage.getItem("jkk-voice") || "{}") }; } catch { return d; }
})();
const savePrefs = () => { try { localStorage.setItem("jkk-voice", JSON.stringify(prefs)); } catch {} };

const speaker = createSpeaker();
let listener = null;
let micState = "off";
let run = null;        // { pass, list, i, paused, lines, line, cues, cue, cueTimer }
let armed = false;     // true once a tap has unlocked audio + mic for this session
let wakeLock = null;

const MIC_TEXT = {
  listening: "Lyssnar · säg ”färdig”",
  ready: "Röststyrning på · lyssnar när jag pratat klart",
  off: "Röststyrning av",
  denied: "Mikrofonen är blockerad – använd knapparna",
  offline: "Röststyrning kräver internet",
  unsupported: "Röststyrning stöds inte här – använd knapparna",
  error: "Röststyrningen stannade – tryck för att starta",
};

const SR_SUPPORTED = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
const canListen = () => prefs.mic && SR_SUPPORTED && micState !== "denied";

function micPill() {
  const state = !prefs.mic ? "off" : !SR_SUPPORTED ? "unsupported" : micState === "off" ? "ready" : micState;
  const on = state === "listening";
  return `<button class="run-mic" data-act="mic" data-state="${state}" aria-pressed="${on}">
    <span class="dot" aria-hidden="true"></span>${ic(prefs.mic ? "mic" : "mic-off")}<span>${esc(MIC_TEXT[state] || MIC_TEXT.off)}</span></button>`;
}
const refreshMic = () => {
  const el = view.querySelector(".run-mic");
  if (el) el.outerHTML = micPill();
};

function setListening(on) {
  if (!listener) {
    listener = createListener({
      onCommand: (cmd) => command(cmd),
      onState: (s) => { micState = s; refreshMic(); },
      ignoreText: () => speaker.echoText,
    });
  }
  if (on && listener.supported) {
    if (!listener.on) { listener.start(); log("mic on"); }
  } else if (listener.on) {
    listener.stop();
    log("mic off");
  }
}
// listen only while the coach is quiet and we're waiting for the student
const listen = (on) => setListening(on && canListen() && armed && !!run && !run.paused);

async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    } else if (!on) {
      await wakeLock?.release();
      wakeLock = null;
    }
  } catch { /* not allowed right now – fine */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && run && armed) keepAwake(true);
});

// called from a tap: unlock audio inside the gesture. The mic starts later,
// when the coach has finished talking (starting it now delays the audio,
// e.g. Bluetooth headphones switching to headset mode).
function arm() {
  t0 = performance.now();
  log("tap");
  armed = true;
  if (prefs.sound) speaker.unlock();
  keepAwake(true);
}

function sessionView(p, i) {
  const list = passList(p);
  i = Math.min(Math.max(0, i), list.length - 1);
  const first = !run || run.pass !== p;
  if (run) clearTimeout(run.cueTimer);
  run = { pass: p, list, i, paused: false, lines: [], line: 0, first: first && i === 0, cues: [], cue: 0, cueTimer: 0 };
  setPage({ title: `${p.title} · ${list[i].name}` });
  document.body.classList.add("in-session");

  if (!armed) {
    view.innerHTML = `<div class="run-ready">
        <div class="eyebrow">Guidat pass</div>
        <h1 class="page-title">${esc(p.title)}</h1>
        <p class="lead">${list.length} övningar. En röst guidar dig – säg ”färdig” när du vill gå vidare.</p>
        <button class="btn start-btn" data-act="arm">${ic("play")}Starta</button>
        <a class="sheet-link" href="#/pass/${p.id}">Avbryt</a>
      </div>`;
    return;
  }
  renderStep();
}

function renderStep() {
  const { pass: p, list, i } = run;
  const ex = list[i];
  const n = list.length;
  const steps = ex.steps?.length ? ex.steps.map((s) => `<h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>`) : (ex.text || []).map((t) => `<p>${esc(t)}</p>`);
  const figure = ex.images
    ? Array.from({ length: ex.images }, (_, k) => `<figure class="run-figure"><img class="art" src="${imgSrc(ex, k + 1)}" alt="${esc(ex.name)}"></figure>`).join("")
    : `<figure class="run-figure run-novideo">${ic("play")}<span>Ingen bild – se videon på övningssidan</span></figure>`;

  view.innerHTML = `
    <div class="run">
      <div class="run-top">
        <div class="run-count">${esc(p.title)} · ${i + 1} av ${n}</div>
        <button class="icon-btn" data-act="sound" aria-pressed="${prefs.sound}" aria-label="${prefs.sound ? "Stäng av rösten" : "Slå på rösten"}">${ic(prefs.sound ? "sound" : "sound-off")}</button>
        <button class="icon-btn" data-act="end" aria-label="Avsluta passet">${ic("x")}</button>
      </div>
      <div class="run-progress" aria-hidden="true">${list.map((_, k) => `<span class="${k < i ? "done" : k === i ? "now" : ""}"></span>`).join("")}</div>
      ${figure}
      <h1 class="page-title run-name">${esc(ex.name)}</h1>
      ${ex.dose ? `<p class="run-dose">${ic("clock")}${esc(ex.dose)}</p>` : ""}
      <ol class="instructions run-lines">${steps
        .map((h, k) => `<li data-li="${k}"${ex.steps?.[k] ? ` data-n="${bildNum(ex.steps[k].bild)}"` : ""}><div>${h}</div></li>`)
        .join("")}</ol>
    </div>
    ${micPill()}
    <div class="run-controls" role="toolbar" aria-label="Styr passet">
      <button data-act="prev" aria-label="Föregående övning" ${i === 0 ? "disabled" : ""}>${ic("arrow-left")}</button>
      <button data-act="repeat" aria-label="Lyssna igen">${ic("repeat")}</button>
      <button class="done-btn" data-act="next">${ic("check")}${i === n - 1 ? "Klar" : "Färdig"}</button>
      <button data-act="pause" aria-label="Pausa rösten">${ic("pause")}</button>
    </div>`;

  run.lines = exerciseLines({ pass: p, coach: site.coach, ex, i, n, first: run.first, canListen: canListen() });
  run.cues = cueLines(ex);
  run.first = false;
  speak(0);
}

function highlight(li) {
  const ol = view.querySelector(".run-lines");
  if (!ol) return;
  ol.classList.toggle("speaking", li >= 0);
  ol.querySelectorAll("li").forEach((el) => el.classList.toggle("now", +el.dataset.li === li));
  if (li >= 0) ol.querySelector(`li[data-li="${li}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function setPauseButton() {
  const b = view.querySelector('[data-act="pause"]');
  if (!b) return;
  b.innerHTML = ic(run.paused ? "play" : "pause");
  b.setAttribute("aria-label", run.paused ? "Fortsätt" : "Pausa rösten");
}

async function speak(from) {
  const r = run;
  clearTimeout(r.cueTimer);
  r.paused = false;
  setPauseButton();
  if (!prefs.sound || !speaker.supported) { highlight(-1); return working(r); }
  listen(false);
  const lines = r.lines.map((l, k) => ({
    ...l,
    onStart: () => { r.line = k; highlight(l.step); if (k === from) log("speaking:", l.text.slice(0, 40)); },
  }));
  const done = await speaker.say(lines, from);
  if (done && run === r) { highlight(-1); working(r); }
}

// The explanation is over: listen for "färdig" and encourage now and then.
function working(r) {
  if (run !== r || r.paused) return;
  listen(true);
  const next = (delay) => {
    clearTimeout(r.cueTimer);
    if (!prefs.sound || r.cue >= r.cues.length) return;
    r.cueTimer = setTimeout(async () => {
      if (run !== r || r.paused) return;
      listen(false);
      const ok = await speaker.say([{ text: r.cues[r.cue++] }]);
      if (ok && run === r) { listen(true); next(CUE_EVERY); }
    }, delay);
  };
  next(r.cue === 0 ? CUE_FIRST : CUE_EVERY);
}

function finish() {
  clearTimeout(run.cueTimer);
  speaker.stop();
  const p = run.pass;
  document.body.classList.add("in-session");
  view.innerHTML = `<div class="run-finish">
      <h1 class="page-title">Bra jobbat!</h1>
      <p class="lead">${esc(p.title)} är klart.</p>
      <div class="actions">
        <a class="btn" href="#/">${ic("house")}Hem</a>
        <a class="btn ghost" href="#/pass/${p.id}">Till passet</a>
      </div>
    </div>`;
  if (prefs.sound) speaker.say(finished(p, site.coach).map((text) => ({ text, gap: 600 })));
  setListening(false);
  keepAwake(false);
  armed = false;
}

function command(cmd) {
  if (!run || !armed) return;
  const { pass: p, list, i } = run;
  const go = (k) => location.replace(`${location.pathname}${location.search}#/kor/${p.id}/${k}`);
  switch (cmd) {
    case "next": return i < list.length - 1 ? go(i + 1) : finish();
    case "prev": return i > 0 && go(i - 1);
    case "repeat": return speak(0);
    case "pause":
      speaker.stop();
      clearTimeout(run.cueTimer);
      run.paused = true;
      listen(false);
      return setPauseButton();
    case "resume": return speak(Math.max(0, run.line));
    case "end": return (location.hash = `#/pass/${p.id}`);
  }
}

view.addEventListener("click", (e) => {
  const start = e.target.closest("[data-start]");
  if (start) {
    arm();
    location.hash = `#/kor/${start.dataset.start}`;
    return;
  }
  const b = e.target.closest("[data-act]");
  if (!b || !document.body.classList.contains("in-session")) return;
  switch (b.dataset.act) {
    case "arm": arm(); return renderStep();
    case "mic":
      // a tap is also a gesture, so this can (re)start the mic where browsers require one
      prefs.mic = !prefs.mic || ["error", "offline"].includes(micState); savePrefs();
      if (["error", "offline"].includes(micState)) micState = "off";
      setListening(prefs.mic && !speaker.speaking);
      return refreshMic();
    case "sound":
      prefs.sound = !prefs.sound; savePrefs();
      if (!prefs.sound) speaker.stop();
      b.outerHTML = `<button class="icon-btn" data-act="sound" aria-pressed="${prefs.sound}" aria-label="${prefs.sound ? "Stäng av rösten" : "Slå på rösten"}">${ic(prefs.sound ? "sound" : "sound-off")}</button>`;
      return prefs.sound && speak(Math.max(0, run.line));
    case "pause": return command(run.paused ? "resume" : "pause");
    default: return command(b.dataset.act);
  }
});

function leaveSession() {
  if (!document.body.classList.contains("in-session")) return;
  if (run) clearTimeout(run.cueTimer);
  document.body.classList.remove("in-session");
  speaker.stop();
  listener?.stop();
  keepAwake(false);
  armed = false;
  run = null;
}

// ---------- router ----------
function route() {
  document.querySelectorAll("dialog.sheet[open]").forEach((d) => d.close());
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);

  const tab = { pass: "pass", ordbok: "ordbok", info: "info" }[parts[0]] || "hem";
  document.querySelectorAll(".tab").forEach((t) =>
    t.dataset.tab === tab ? t.setAttribute("aria-current", "page") : t.removeAttribute("aria-current")
  );

  if (parts[0] === "kor" && passes.has(parts[1])) {
    sessionView(passes.get(parts[1]), +parts[2] || 0);
    scrollTo(0, 0);
    return;
  }
  leaveSession();

  if (parts[0] === "pass" && !parts[1]) passesView();
  else if (parts[0] === "ordbok") ordbokView();
  else if (parts[0] === "info") infoView();
  else if (parts[0] === "pass" && passes.has(parts[1])) {
    const p = passes.get(parts[1]);
    const ex = exercises.get(parts[2]);
    if (ex) {
      exerciseView(ex, { base: `#/pass/${p.id}`, back: `#/pass/${p.id}`, label: p.title, list: passList(p), numbered: true });
    } else passView(p);
  } else if (animals.has(parts[0])) {
    const a = animals.get(parts[0]);
    const ex = exercises.get(parts[1]);
    if (ex) {
      const tag = activeTag[a.id];
      const list = byAnimal(a.id).filter((e) => !tag || e.tags.includes(tag));
      exerciseView(ex, { base: `#/${a.id}`, back: `#/${a.id}`, label: a.name, list: list.includes(ex) ? list : byAnimal(a.id) });
    } else animalView(a);
  } else homeView();

  scrollTo(0, 0);
  view.focus({ preventScroll: true });
}

addEventListener("hashchange", route);


loadSite()
  .then(route)
  .catch((err) => {
    console.error(err);
    view.innerHTML = `<div class="page-head"><h1 class="page-title">Kunde inte ladda</h1>
      <p class="lead">Kontrollera internetanslutningen och försök igen.</p></div>`;
  });

if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
}
