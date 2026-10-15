// Offline support. On install, caches the app shell plus every exercise's
// content and images. Afterwards serves from cache and refreshes in the
// background, so new exercises show up on the next visit.
// Bump VERSION when app.js / style.css / index.html change.
const VERSION = "v55";
const CACHE = `jkk-${VERSION}`;
const SHELL = ["./", "style.css", "app.js", "voice.js", "speech.js", "live-coach.js", "coach-context.js", "manifest.webmanifest", "icons/noun-tiger-icon-192.png", "icons/noun-tiger-icon-512.png", "icons/noun-tiger-icon-maskable-512.png", "icons/noun-tiger-apple-touch-icon.png", "icons/noun-tiger-favicon.ico", "icons/noun-tiger-favicon.svg", "img/jarna-round-logo.svg", "img/og-image.png",
  "fonts/fraunces-latin-full-normal.woff2", "fonts/dm-sans-latin-wght-normal.woff2"];

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
