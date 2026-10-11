// Offline support. On install, caches the app shell plus every exercise's
// content and images. Afterwards serves from cache and refreshes in the
// background, so new exercises show up on the next visit.
// Bump VERSION when app.js / style.css / index.html change.
const VERSION = "v25";
const CACHE = `jkk-${VERSION}`;
const SHELL = ["./", "index.html", "style.css", "app.js", "voice.js", "speech.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon.ico", "icons/favicon-32.png", "img/jarna-shaolin-logo.webp", "img/og-image.png",
  "fonts/fraunces-latin-full-normal.woff2", "fonts/dm-sans-latin-wght-normal.woff2"];

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
      await cache.addAll(SHELL);
      await cache.addAll(await contentUrls());
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

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const key = e.request.mode === "navigate" ? "index.html" : e.request;
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          // new exercises were published: cache their images too
          if (res.ok && url.pathname.endsWith("/content/exercises.json")) {
            contentUrls().then((urls) => cache.addAll(urls)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })()
  );
});
