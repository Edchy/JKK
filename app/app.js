// Kung Fu Fitness – tiny hash-routed PWA. Content lives in content/*.json.
//
// Routes:
//   #/                       home: animals + passes
//   #/<animal>               exercises for one animal (Apa / Björn / Tiger)
//   #/<animal>/<exercise>    exercise, prev/next within that animal
//   #/pass/<pass>            a ready-made session
//   #/pass/<pass>/<exercise> exercise, prev/next within that pass
//   #/kor/<pass>/<n>         guided session with voice (see voice.js)

import { createSpeaker } from "./voice.js";
import { exerciseLines, cueLines, finished } from "./speech.js";
import { createLiveCoach, TEXT_ONLY } from "./live-coach.js";
import { exerciseContext, openingNote, resumeNote, pauseNote, unpauseNote, repeatNote, finishNote, asToolResult } from "./coach-context.js";

const view = document.getElementById("view");

let site;
let glossary = [];
const exercises = new Map();
const animals = new Map();
const passes = new Map();
const tagNames = new Map();
const libFilter = { animal: "", tag: "" };   // the Övningar page's filters

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
// An overview: the passes first (that's what most visits are for), then the
// ways into everything else. Settings sit behind the cog, out of the tab bar.
function homeView() {
  setPage({});
  view.innerHTML = `
    <div class="home-top">
      <h1 class="home-brand"><img class="home-logo" src="img/jarna-round-logo.svg" width="800" height="800" alt="${esc(site.school)} – ${esc(site.program)}" fetchpriority="high"></h1>
      <a class="icon-btn" href="#/installningar" aria-label="Inställningar">${ic("gear")}</a>
    </div>
    ${installBanner()}

    <h2 class="section-title">Träna</h2>
    <ul class="list">
      ${site.passes
        .map(
          (p) => `<li class="pass-item">
            <a class="row" href="#/pass/${p.id}">
              <div><div class="name">${esc(p.title)}</div>
                <div class="sub">${passList(p).length} övningar</div></div></a>
            <button class="btn" data-start="${p.id}">${ic("play")}Starta</button>
          </li>`
        )
        .join("")}
    </ul>

    <h2 class="section-title">Utforska</h2>
    <ul class="list">
      ${[
        ["#/ovningar", "taichi", "Övningar", `${exercises.size} övningar · ${site.animals.map((a) => a.name).join(", ")}`],
        ["#/ordbok", "book-open", "Ordbok", `${glossary.length} ord`],
        ["#/info", "info", "Innan du börjar", "Läs det här först"],
      ]
        .map(
          ([href, icon, name, sub]) => `<li><a class="row" href="${href}">
            <span class="row-icon">${ic(icon)}</span>
            <div><div class="name">${esc(name)}</div><div class="sub">${esc(sub)}</div></div>
            ${arrow}</a></li>`
        )
        .join("")}
    </ul>`;
  wireInstallBanner();
}

// ---------- Övningar: the whole library, filtered by animal and/or type ----------
const libList = () =>
  [...exercises.values()].filter(
    (e) => (!libFilter.animal || e.animals.includes(libFilter.animal)) && (!libFilter.tag || e.tags.includes(libFilter.tag))
  );

function libraryView() {
  setPage({ title: "Övningar" });
  const used = site.tags.filter((t) => [...exercises.values()].some((e) => e.tags.includes(t.id)));
  view.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">Övningar</h1>
      <p class="lead" id="lib-lead"></p>
    </div>
    <div class="chips" role="group" aria-label="Djur">
      <button class="chip" data-animal="">Alla</button>
      ${site.animals.map((a) => `<button class="chip" data-animal="${a.id}"><span class="chip-glyph" aria-hidden="true">${esc(a.glyph)}</span>${esc(a.name)}</button>`).join("")}
    </div>
    <div class="chips" role="group" aria-label="Typ">
      ${used.map((t) => `<button class="chip" data-tag="${t.id}">${esc(t.name)}</button>`).join("")}
    </div>
    <div id="ex-list"></div>`;
  const render = () => {
    const list = libList();
    const a = animals.get(libFilter.animal);
    view.querySelector("#lib-lead").textContent = a ? `${a.theme}. ${a.description}` : `${exercises.size} övningar. Filtrera på djur eller typ.`;
    view.querySelector("#ex-list").innerHTML = list.length
      ? exerciseRows(list, "#/ovningar", false)
      : `<p class="empty">Inga övningar med den kombinationen.</p>`;
    view.querySelectorAll("[data-animal]").forEach((c) => c.setAttribute("aria-pressed", c.dataset.animal === libFilter.animal));
    view.querySelectorAll("[data-tag]").forEach((c) => c.setAttribute("aria-pressed", c.dataset.tag === libFilter.tag));
  };
  view.querySelectorAll("[data-animal]").forEach((c) =>
    c.addEventListener("click", () => { libFilter.animal = c.dataset.animal; render(); })
  );
  // a type chip toggles: tap the active one again to show all types
  view.querySelectorAll("[data-tag]").forEach((c) =>
    c.addEventListener("click", () => { libFilter.tag = libFilter.tag === c.dataset.tag ? "" : c.dataset.tag; render(); })
  );
  render();
}

// ---------- Inställningar (behind the cog on Hem) ----------
function settingsView() {
  setPage({ title: "Inställningar" });
  view.innerHTML = `
    <div class="page-head"><h1 class="page-title">Inställningar</h1></div>
    ${
      VOICE
        ? `<section class="settings-group">
            <h2 class="section-title">Röst under passet</h2>
            ${voiceChoice()}
          </section>`
        : ""
    }
    ${
      VOICE && prefs.liveOk
        ? `<section class="settings-group">
            <h2 class="section-title">Live-coachen</h2>
            <p class="lead">Du har godkänt att prata med live-coachen.</p>
            <button class="sheet-link" data-withdraw>${ic("x")}${esc(site.privacy.withdraw)}</button>
          </section>`
        : ""
    }
    <ul class="list settings-links">
      <li><a class="row" href="#/installera"><div><div class="name">${esc(site.install.title)}</div></div>${arrow}</a></li>
      <li><a class="row" href="#/installningar/integritet"><div><div class="name">${esc(site.privacy.link)}</div></div>${arrow}</a></li>
    </ul>
    ${
      TESTER
        ? `<p class="tester-note">Testläge: rösten är på för den här telefonen. <a href="?tester=off#/installningar">Stäng av</a></p>`
        : // an app saved to the iPhone home screen has its own storage and no address bar,
          // so ?tester=… can't reach it – the code can be typed here instead
          `<details class="tester-note"><summary>Testkod</summary>
            <form class="tester-form"><input name="code" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Testkod">
              <button class="btn">Spara</button></form></details>`
    }`;
  view.querySelector(".tester-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = e.target.code.value.trim();
    if (!code) return;
    try { localStorage.setItem("jkk-tester", code); } catch {}
    location.reload(); // TESTER is read once at start
  });
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
      ${voiceChoice()}
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

// {days} and {contact} in the privacy texts
const privacyText = (t) =>
  t.replaceAll("{days}", site.privacy.days)
    .replaceAll("{owner}", site.privacy.owner || "appens ägare")
    .replaceAll("{contact}", site.privacy.contact || "appens ägare");

// Its own page under Info, so "Innan du börjar" stays about training.
function privacyView() {
  const pr = site.privacy;
  setPage({ title: pr.title });
  view.innerHTML = `
    <div class="page-head"><h1 class="page-title">${esc(pr.title)}</h1></div>
    <section class="privacy" id="integritet">
      <dl class="glossary">${pr.sections
        .filter((s) => VOICE || !s.liveOnly)
        .map((s) => `<div class="term"><dt>${esc(s.title)}</dt><dd>${esc(privacyText(s.text))}</dd></div>`)
        .join("")}</dl>
    </section>`;
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
      .join("")}
`;
}

// withdraw consent: the next live session asks again
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-withdraw]");
  if (!b) return;
  prefs.liveOk = false;
  savePrefs();
  b.replaceWith(htmlToNode(`<p class="lead">Klart. Coachen frågar igen nästa gång du väljer live.</p>`));
});

// ---------- Glossary word sheet ----------
const SHEETS = {
  mode: {
    title: () => "Röst under passet",
    body: () => modePicker(),
  },
  consent: {
    title: () => site.privacy.live.title,
    body: () => `
      <ul class="consent-points">${site.privacy.live.points.map((t) => `<li>${esc(privacyText(t))}</li>`).join("")}</ul>
      <button class="btn consent-yes" data-consent="yes">${ic("waveform")}${esc(site.privacy.live.accept)}</button>
      <p class="consent-or">${esc(site.privacy.live.or)}</p>
      <div class="consent-actions">${MODES.filter((m) => m.id !== "live")
        .map((m) => `<button class="sheet-link" data-consent="${m.id}">${ic(m.icon)}${esc(m.label)}</button>`)
        .join("")}</div>
      <a class="sheet-link" href="#/installningar/integritet">${ic("info")}Läs mer om integritet</a>`,
  },
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

// ---------- Installera appen ----------
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// phones and tablets – where "add to home screen" means something
const isMobile = () => isIOS() || /android/i.test(navigator.userAgent) || matchMedia("(pointer: coarse)").matches;
let installTab = null; // "ios" | "android" – starts as the visitor's own platform

// **bold** and {icon} in the guide's texts (everything else is escaped)
const rich = (t) =>
  esc(t)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\{([a-z-]+)\}/g, (_, name) => `<span class="key-icon">${ic(name)}</span>`);

function installView() {
  const g = site.install;
  setPage({ title: g.title });
  installTab ??= isIOS() ? "ios" : "android";
  const steps = g[installTab];
  view.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">${esc(g.title)}</h1>
      <p class="lead">${esc(standalone() ? g.installed : g.lead)}</p>
      <div id="install"></div>
    </div>
    <div class="segmented install-tabs" role="tablist" aria-label="Telefon">
      ${[["ios", "iPhone"], ["android", "Android"]]
        .map(([id, label]) => `<button role="tab" data-install-tab="${id}" aria-selected="${id === installTab}" aria-checked="${id === installTab}">${esc(label)}</button>`)
        .join("")}
    </div>
    <ol class="instructions install-steps">${steps
      .map(
        (st) => `<li><div>
          <p>${rich(st.text)}</p>
          ${st.img ? `<img class="install-shot" src="img/${esc(st.img)}" alt="" loading="lazy">` : ""}
        </div></li>`
      )
      .join("")}</ol>`;
  view.querySelectorAll("[data-install-tab]").forEach((b) =>
    b.addEventListener("click", () => { installTab = b.dataset.installTab; installView(); })
  );
  renderInstallHint();
}

// The banner on Hem: shown in a phone's browser until the app is installed (or dismissed).
const BANNER_KEY = "jkk-install-banner";
function installBanner() {
  let hidden = false;
  try { hidden = localStorage.getItem(BANNER_KEY) === "hidden"; } catch {}
  if (standalone() || hidden || !isMobile()) return "";
  const b = site.install.banner;
  return `<section class="install-banner" aria-label="${esc(site.install.title)}">
      <span class="row-icon">${ic("download")}</span>
      <div class="install-banner-body">
        <h2 class="install-banner-title">${esc(site.install.title)}</h2>
        <p>${esc(b.text)}</p>
        <div class="install-banner-actions">
          <button class="btn" data-install-now hidden>${ic("download")}${esc(b.install)}</button>
          <a class="btn" href="#/installera">${esc(b.how)}</a>
        </div>
      </div>
      <button class="banner-close" data-banner-close aria-label="Dölj">${ic("x")}</button>
    </section>`;
}
function wireInstallBanner() {
  const banner = view.querySelector(".install-banner");
  if (!banner) return;
  banner.querySelector("[data-banner-close]").addEventListener("click", () => {
    try { localStorage.setItem(BANNER_KEY, "hidden"); } catch {}
    banner.remove();
  });
  // Android/Chrome: install with one tap; the guide link becomes the secondary option
  const now = banner.querySelector("[data-install-now]");
  const how = banner.querySelector('a[href="#/installera"]');
  now.hidden = !deferredPrompt;
  how.classList.toggle("ghost", !!deferredPrompt);
  now.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === "accepted") banner.remove();
    else wireInstallBanner();
  };
}

let deferredPrompt = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  renderInstallHint();
  wireInstallBanner(); // Chrome's offer often arrives after the page has rendered
});

// Chrome on Android (and desktop) can install directly – then one button is enough.
function renderInstallHint() {
  const slot = document.getElementById("install");
  if (!slot) return;
  if (!deferredPrompt || standalone()) return (slot.innerHTML = "");
  slot.innerHTML = `<button class="btn install-now">${ic("download")}${esc(site.install.now)}</button>`;
  slot.querySelector("button").addEventListener("click", async () => {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    slot.innerHTML = "";
  });
}

// ---------- Guided session: "Starta pass" ----------
// #/kor/<pass>/<n>  – full-screen, one exercise at a time, in the student's
// chosen voice mode:
//   silent    – images and text only
//   recorded  – recorded coach (speech.js + voice.js), cues while you work
//   live      – a conversation with the ElevenLabs agent (live-coach.js);
//               falls back to "recorded" if it can't connect
// Nästa (or the live coach's next_exercise tool) moves on.

const CUE_FIRST = 20000;   // first encouragement this long after the explanation
const CUE_EVERY = 25000;   // then this often, until the exercise's cues run out
let t0 = 0;
const log = (...a) => console.debug(`[voice] ${((performance.now() - t0) / 1000).toFixed(2)}s`, ...a);

// ---- Test mode: all voice is only for the owner while it's being tested ----
// Open the app once with ?tester=<code> (or type it under Inställningar → Testkod)
// and this phone remembers the code. Without it there is no voice at all: no
// choice, no recorded voice, no live coach – just the exercises. The real lock
// for the live coach is on the server: worker.js only hands out tickets when the
// code (sent as X-Tester) matches its TESTER_KEY secret. Locally, voice is on.
const TESTER = (() => {
  const fromUrl = new URLSearchParams(location.search).get("tester");
  try {
    if (fromUrl === "off") localStorage.removeItem("jkk-tester");
    else if (fromUrl) localStorage.setItem("jkk-tester", fromUrl);
    if (fromUrl) history.replaceState(null, "", location.pathname + location.hash); // keep the code out of the address bar
    return localStorage.getItem("jkk-tester") || "";
  } catch {
    return fromUrl && fromUrl !== "off" ? fromUrl : "";
  }
})();
const VOICE = !!TESTER || ["localhost", "127.0.0.1"].includes(location.hostname);

// ---- Voice mode: the student's choice, remembered on this phone ----
const MODES = [
  { id: "silent", label: "Tyst", sub: "Bara bilder och text", icon: "sound-off" },
  { id: "recorded", label: "Inspelad röst", sub: "Fungerar utan internet", icon: "sound" },
  { id: "live", label: "Live-coach", sub: "Prata med coachen · kräver internet", icon: "waveform" },
];
const prefs = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("jkk-voice") || "{}"); } catch {}
  // earlier versions only had sound on/off
  const mode = MODES.some((m) => m.id === saved.mode) ? saved.mode : saved.sound === false ? "silent" : "live";
  // liveOk: the student has read what the live coach sends where (GDPR consent)
  return { mode, liveOk: saved.liveOk === true };
})();
const savePrefs = () => { try { localStorage.setItem("jkk-voice", JSON.stringify(prefs)); } catch {} };
// Live mode can be replaced for this session only (the saved choice stays):
// "recorded" when the coach couldn't connect, "silent" when the student closed the consent sheet.
let sessionMode = null;
const mode = () => (!VOICE ? "silent" : (prefs.mode === "live" && sessionMode) || prefs.mode);
const currentMode = () => MODES.find((m) => m.id === mode());
const voiceOn = () => mode() === "recorded";   // the recorded voice (the live coach has its own)

function modePicker() {
  return `<div class="mode-picker" role="radiogroup" aria-label="Röst under passet">${MODES.map(
    (m) => `<button class="mode" role="radio" data-mode="${m.id}" aria-checked="${m.id === mode()}">
        ${ic(m.icon)}<span class="mode-label">${esc(m.label)}</span><span class="mode-sub">${esc(m.sub)}</span>
      </button>`
  ).join("")}</div>`;
}
// The pass page's small version: a segmented control under Starta pass,
// with the chosen mode's one-line description below it.
function voiceChoice() {
  if (!VOICE) return "";
  return `<div class="voice-choice">
      <div class="segmented" role="radiogroup" aria-label="Röst under passet">${MODES.map(
        (m) => `<button role="radio" data-mode="${m.id}" aria-checked="${m.id === mode()}">${ic(m.icon)}${esc(m.label)}</button>`
      ).join("")}</div>
      <p class="mode-hint">${esc(currentMode().sub)}</p>
    </div>`;
}
const modeButton = () => !VOICE ? "" :
  `<button class="icon-btn" data-act="mode" aria-haspopup="dialog" aria-label="Röst: ${esc(currentMode().label)}. Byt">${ic(currentMode().icon)}</button>`;

// choose a mode – from the pass page or from the sheet during a session
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b) return;
  if (b.dataset.mode === mode()) return document.getElementById("mode")?.close();
  prefs.mode = b.dataset.mode;
  sessionMode = null; // a choice made now replaces any stand-in for this session
  savePrefs();
  document.querySelectorAll("[data-mode]").forEach((el) => el.setAttribute("aria-checked", el.dataset.mode === mode()));
  document.querySelectorAll(".mode-hint").forEach((el) => (el.textContent = currentMode().sub));
  document.getElementById("mode")?.close();
  if (run && armed) applyMode();
});

// switching mid-session: stop what's playing and continue in the new mode
function applyMode() {
  view.querySelector('[data-act="mode"]')?.replaceWith(htmlToNode(modeButton()));
  speaker.stop();
  clearTimeout(run.cueTimer);
  if (mode() === "live") return startLive();
  stopLive();
  if (voiceOn()) { speaker.unlock(); speak(Math.max(0, run.line)); }
  else highlight(-1);
}
const htmlToNode = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };

const speaker = createSpeaker();
let run = null;        // { pass, list, i, paused, lines, line, cues, cue, cueTimer }
let armed = false;     // true once a tap has unlocked audio for this session
let wakeLock = null;

// ---- the live coach (only in "live" mode) ----
let live = null;            // createLiveCoach() instance while connected
let liveAnnounce = false;   // the student tapped Nästa/back → tell the coach once the new exercise shows
let liveLine = "";          // the coach's latest words, shown as a caption

const LIVE_TEXT = {
  connecting: "Ansluter till coachen…",
  listening: "Coachen lyssnar",
  speaking: "Coachen pratar",
  paused: "Pausad",
  fallback: "Live-coachen gick inte att nå – inspelad röst istället",
};
function liveStatus(state) {
  const el = view.querySelector(".run-live");
  if (!el) return;
  el.dataset.state = state;
  el.querySelector(".t").textContent = LIVE_TEXT[state] || "";
  el.hidden = !LIVE_TEXT[state];
}
function liveCaption(text) {
  liveLine = text;
  const el = view.querySelector(".run-say");
  if (el) { el.textContent = text; el.hidden = !text; }
}

// The coach's buttons. Names match the tools in the ElevenLabs dashboard.
// It can only switch exercises: ending the pass or turning the coach off takes
// a tap (✕, Avsluta, the voice button), so a misheard word can't end anything.
const liveTools = {
  next_exercise: () => {
    if (!run) return "Inget pass pågår.";
    if (run.i === run.list.length - 1) return "Det här är redan passets sista övning. Eleven avslutar passet med knappen Avsluta.";
    goTo(run.i + 1);
    return asToolResult(exerciseContext(run.pass, run.list, run.i + 1));
  },
  previous_exercise: () => {
    if (!run) return "Inget pass pågår.";
    if (run.i === 0) return "Det här är redan passets första övning.";
    goTo(run.i - 1);
    return asToolResult(exerciseContext(run.pass, run.list, run.i - 1));
  },
  // Jump by number ("tillbaka till första"). The AI fills in `number`
  // (1 = first); we check it, since a model can ask for exercise 0 or 12.
  go_to_exercise: ({ number } = {}) => {
    if (!run) return "Inget pass pågår.";
    const k = Math.round(Number(number)) - 1;
    const n = run.list.length;
    if (!(k >= 0 && k < n)) return `Det finns ingen övning ${number}. Passet har övning 1 till ${n}.`;
    if (k === run.i) return `Eleven är redan på övning ${k + 1}.`;
    goTo(k);
    return asToolResult(exerciseContext(run.pass, run.list, k));
  },
};

async function startLive() {
  if (live || !run) return;
  if (!prefs.liveOk) return askConsent();
  const r = run;
  live = createLiveCoach({ tools: liveTools, tester: TESTER, onState: liveStatus, onLine: liveCaption, onEnd: () => liveFallback("ended") });
  try {
    if (!navigator.onLine) throw new Error("offline");
    await live.start(openingNote(r.pass, r.list), exerciseContext(r.pass, r.list, r.i));
  } catch (e) {
    liveFallback(e);
  }
}
function stopLive() {
  live?.end();
  live = null;
  liveLine = "";
}
// First live session on this phone: explain what is sent where, then start.
// Choosing Inspelad röst / Tyst instead saves that as the student's choice;
// just closing the sheet continues silently for this session only.
function askConsent() {
  document.getElementById("consent")?.remove();
  const d = sheet("consent");
  let answered = false;
  d.addEventListener("click", (e) => {
    const b = e.target.closest("[data-consent]");
    if (!b) return;
    answered = true;
    if (b.dataset.consent === "yes") {
      prefs.liveOk = true;
      savePrefs();
      d.close();
      return startLive();
    }
    prefs.mode = b.dataset.consent;
    savePrefs();
    d.close();
    declineLive();
  });
  d.addEventListener("close", () => answered || declineLive("silent"));
  d.showModal();
}
function declineLive(standIn) {
  if (!run || !armed) return;
  if (standIn && mode() === "live") sessionMode = standIn;
  view.querySelector('[data-act="mode"]')?.replaceWith(htmlToNode(modeButton()));
  speaker.unlock();
  speak(0);
}

// Couldn't connect, or the connection dropped: carry on with the recorded voice.
function liveFallback(why) {
  console.warn("[live] falling back to recorded voice:", why);
  stopLive();
  if (!run || !armed || prefs.mode !== "live") return;
  sessionMode = "recorded";
  liveStatus("fallback");
  speaker.unlock();
  speak(0);
}

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

// called from a tap: browsers only allow sound that starts inside a user gesture
function arm() {
  t0 = performance.now();
  log("tap");
  armed = true;
  if (voiceOn()) speaker.unlock();
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
        <p class="lead">${list.length} övningar. ${VOICE ? "En röst guidar dig – tryck" : "Tryck"} på Nästa när du vill gå vidare.</p>
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
        ${modeButton()}
        <button class="icon-btn" data-act="end" aria-label="Avsluta passet">${ic("x")}</button>
      </div>
      <div class="run-progress" aria-hidden="true">${list.map((_, k) => `<span class="${k < i ? "done" : k === i ? "now" : ""}"></span>`).join("")}</div>
      ${figure}
      <h1 class="page-title run-name">${esc(ex.name)}</h1>
      ${ex.dose ? `<p class="run-dose">${ic("clock")}${esc(ex.dose)}</p>` : ""}
      <p class="run-say" aria-live="polite" ${liveLine && mode() === "live" ? "" : "hidden"}>${esc(liveLine)}</p>
      ${TEXT_ONLY && mode() === "live" ? `<form class="run-type"><input placeholder="Skriv till coachen (test)…" autocomplete="off"><button class="btn">Skicka</button></form>` : ""}
      <ol class="instructions run-lines">${steps
        .map((h, k) => `<li data-li="${k}"${ex.steps?.[k] ? ` data-n="${bildNum(ex.steps[k].bild)}"` : ""}><div>${h}</div></li>`)
        .join("")}</ol>
    </div>
    <div class="run-live" data-state="${live?.state || ""}" ${mode() === "live" && live ? "" : "hidden"}><span class="dot" aria-hidden="true"></span><span class="t">${esc(LIVE_TEXT[live?.state] || "")}</span></div>
    <div class="run-controls" role="toolbar" aria-label="Styr passet">
      <button data-act="prev" aria-label="Föregående övning" ${i === 0 ? "disabled" : ""}>${ic("arrow-left")}</button>
      ${VOICE ? `<button data-act="repeat" aria-label="${mode() === "live" ? "Be coachen förklara igen" : "Lyssna igen"}">${ic("repeat")}</button>` : ""}
      <button class="done-btn" data-act="next">${i === n - 1 ? `${ic("check")}Avsluta` : `Nästa${ic("arrow-right")}`}</button>
      ${VOICE ? `<button data-act="pause" aria-label="Pausa rösten">${ic("pause")}</button>` : ""}
    </div>`;

  run.lines = exerciseLines({ pass: p, coach: site.coach, ex, i, n, first: run.first });
  run.cues = cueLines(ex);
  run.first = false;

  if (mode() !== "live") return speak(0);
  if (!live) return startLive();
  if (liveAnnounce) live.say(exerciseContext(p, list, i)); // the student tapped – tell the coach
  liveAnnounce = false;
}

function highlight(li) {
  const ol = view.querySelector(".run-lines");
  if (!ol) return;
  ol.classList.toggle("speaking", li >= 0);
  ol.querySelectorAll("li").forEach((el) => el.classList.toggle("now", +el.dataset.li === li));
  // no scrolling: the illustration at the top should stay in view while the voice talks
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
  if (!voiceOn() || !speaker.supported) { highlight(-1); return working(r); }
  const lines = r.lines.map((l, k) => ({
    ...l,
    onStart: () => { r.line = k; highlight(l.step); if (k === from) log("speaking:", l.text.slice(0, 40)); },
  }));
  const done = await speaker.say(lines, from);
  if (done && run === r) { highlight(-1); working(r); }
}

// The explanation is over: encourage now and then while the student works.
function working(r) {
  if (run !== r || r.paused) return;
  const next = (delay) => {
    clearTimeout(r.cueTimer);
    if (!voiceOn() || r.cue >= r.cues.length) return;
    r.cueTimer = setTimeout(async () => {
      if (run !== r || r.paused) return;
      const ok = await speaker.say([{ text: r.cues[r.cue++] }]);
      if (ok && run === r) next(CUE_EVERY);
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
  if (voiceOn()) speaker.say(finished(p, site.coach).map((text) => ({ text, gap: 600 })));
  if (mode() === "live" && live) {
    const coach = live;
    coach.say(finishNote(p));
    setTimeout(() => { if (live === coach) stopLive(); }, 15000); // time to say goodbye
  }
  keepAwake(false);
  armed = false;
}

// show exercise k (replace: Back in the browser shouldn't step through every exercise)
const goTo = (k) => location.replace(`${location.pathname}${location.search}#/kor/${run.pass.id}/${k}`);

// The session's buttons. In live mode they also keep the coach in the loop.
function command(cmd) {
  if (!run || !armed) return;
  const { pass: p, list, i } = run;
  const isLive = mode() === "live" && live;
  switch (cmd) {
    case "next":
      if (i === list.length - 1) return finish();
      liveAnnounce = !!isLive;
      return goTo(i + 1);
    case "prev":
      if (i === 0) return;
      liveAnnounce = !!isLive;
      return goTo(i - 1);
    case "repeat": return isLive ? live.say(repeatNote()) : speak(0);
    case "pause":
      run.paused = true;
      setPauseButton();
      if (isLive) return live.pause(pauseNote());
      speaker.stop();
      return clearTimeout(run.cueTimer);
    case "resume":
      if (isLive) {
        run.paused = false;
        setPauseButton();
        return live.resume(unpauseNote(), resumeNote(p, list, i)).catch(liveFallback);
      }
      return speak(Math.max(0, run.line));
    case "end": return (location.hash = `#/pass/${p.id}`);
  }
}

view.addEventListener("submit", (e) => {
  if (!e.target.matches(".run-type")) return;
  e.preventDefault();
  const input = e.target.querySelector("input");
  if (input.value.trim()) live?.say(input.value.trim());
  input.value = "";
});

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
    case "mode":
      document.getElementById("mode")?.remove(); // rebuilt so it shows the current choice
      return sheet("mode").showModal();
    case "pause": return command(run.paused ? "resume" : "pause");
    default: return command(b.dataset.act);
  }
});

function leaveSession() {
  if (!document.body.classList.contains("in-session")) return;
  if (run) clearTimeout(run.cueTimer);
  document.body.classList.remove("in-session");
  speaker.stop();
  stopLive();
  sessionMode = null;
  keepAwake(false);
  armed = false;
  run = null;
}

// ---------- router ----------
function route() {
  document.querySelectorAll("dialog.sheet[open]").forEach((d) => d.close());
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);

  const tab = { pass: "pass", ovningar: "ovningar", ordbok: "ordbok" }[parts[0]] || "hem";
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
  else if (parts[0] === "installningar" && parts[1] === "integritet") privacyView();
  else if (parts[0] === "installningar") settingsView();
  else if (parts[0] === "installera") installView();
  else if (parts[0] === "ovningar") {
    const ex = exercises.get(parts[1]);
    if (ex) {
      const list = libList();
      exerciseView(ex, { base: "#/ovningar", back: "#/ovningar", label: "Övningar", list: list.includes(ex) ? list : [...exercises.values()] });
    } else libraryView();
  }
  else if (parts[0] === "pass" && passes.has(parts[1])) {
    const p = passes.get(parts[1]);
    const ex = exercises.get(parts[2]);
    if (ex) {
      exerciseView(ex, { base: `#/pass/${p.id}`, back: `#/pass/${p.id}`, label: p.title, list: passList(p), numbered: true });
    } else passView(p);
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
