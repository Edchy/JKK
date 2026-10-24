// Offline support. On install, caches the app shell plus every exercise's
// content and images. Afterwards serves from cache and refreshes in the
// background, so new exercises show up on the next visit.
// Bump VERSION when app.js / style.css / index.html change.
const VERSION = "v81";
const CACHE = `jkk-${VERSION}`;
// Students have no sound in the first release (VOICE_OPEN / MUSIC_OPEN in app.js), so
// the ~3 MB of voice clips and music isn't downloaded up front. The test phone still
// gets each clip from the network as it plays. Set to true when either comes back.
const SOUND_CACHE = false;
// The UI icons are only referenced from style.css (--i-*), so the cache can't
// discover them: without this list, offline shows only the ones a page
// happened to load while online (e.g. no cog on Hem).
const ICONS = ["arrow-counter-clockwise", "arrow-left", "arrow-right", "book-open", "check", "clock", "device-mobile", "dots-three-circle", "dots-three-vertical", "download-simple", "export", "gear-six", "house", "info", "list-checks", "music-notes", "pause", "person-simple-tai-chi", "play", "plus-square", "speaker-high", "speaker-slash", "waveform", "x"];
const SHELL = ["./", "style.css", "app.js", "voice.js", "speech.js", "music.js", "live-coach.js", "coach-context.js", "manifest.webmanifest", "icons/noun-tiger-icon-192.png", "icons/noun-tiger-icon-512.png", "icons/noun-tiger-icon-maskable-512.png", "icons/noun-tiger-apple-touch-icon.png", "icons/noun-tiger-favicon.ico", "icons/noun-tiger-favicon.svg", "img/jarna-round-logo.svg", "img/og-image.png",
  "fonts/fraunces-latin-full-normal.woff2", "fonts/dm-sans-latin-wght-normal.woff2",
  ...ICONS.map((name) => `icons/ui/regular/${name}.svg`),
  ...["hem", "pass", "ovningar", "ordbok", "info"].map((name) => `icons/ui/nav/${name}.svg`)];

// Cloudflare redirects /index.html → /. A response that went through a redirect
// may not answer a page load (Safari: "Response served by service worker has
// redirections"), so we only ever store and serve clean copies.
async function clean(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}
async function addAll(cache, urls) {
  await Promise.all(
    urls.map(async (url) => {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      await cache.put(url, await clean(res));
    })
  );
}

async function contentUrls() {
  const lib = await (await fetch("content/exercises.json", { cache: "no-store" })).json();
  const urls = ["content/index.json", "content/exercises.json", "content/ordbok.json"];
  for (const ex of lib.exercises) {
    for (let n = 1; n <= (ex.images || 0); n++) urls.push(`img/${ex.id}-${n}.webp`);
  }
  if (!SOUND_CACHE) return urls;
  // background music (passes[].music in index.json) – optional
  try {
    const { passes = [] } = await (await fetch("content/index.json", { cache: "no-store" })).json();
    for (const p of passes) if (p.music?.file) urls.push(p.music.file);
  } catch {}
  // recorded voice (tools/generate-voice.mjs) – optional
  try {
    const res = await fetch("audio/index.json", { cache: "no-store" });
    if (res.ok) {
      urls.push("audio/index.json");
      for (const file of new Set(Object.values((await res.json()).clips || {}))) urls.push(`audio/${file}`);
    }
  } catch {}
  return urls;
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await addAll(cache, SHELL);
      await addAll(cache, await contentUrls());
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // never cache the API: a ticket (/api/token) is single-use and expires
  if (url.pathname.startsWith("/api/")) return;

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // the app itself is one page (index.html, hash routes); other pages
      // like coach-test.html are cached under their own address
      const appShell = e.request.mode === "navigate" && (url.pathname.endsWith("/") || url.pathname.endsWith("/index.html"));
      const key = appShell ? "./" : e.request;
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(e.request)
        .then(async (raw) => {
          const res = await clean(raw);
          if (res.ok) cache.put(key, res.clone());
          // new exercises were published: cache their images too
          if (res.ok && url.pathname.endsWith("/content/exercises.json")) {
            contentUrls().then((urls) => addAll(cache, urls)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })()
  );
});
