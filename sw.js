// Lines service worker
//
// Network first, like Edition: a release shows up on the next launch, and the
// saved copy is used when there's no signal (at the rink). Each release gets
// its own cache, named after the version; install saves the whole shell fresh
// so a release is never half old and half new. Calls to the relay are never
// cached (votes must be current).
const CACHE = "lines-v0.1.0";
const SHELL = ["./", "index.html", "styles.css", "app.js", "core.js", "ui.js", "store.js", "api.js", "card.js", "manifest.webmanifest", "sample/sample.ics", "fonts/geist-latin.woff2", "fonts/instrument-serif-latin.woff2", "icons/logo-256.png", "icons/logo-512.png", "icons/icon-192.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith("lines-v") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the relay and other sites go straight to the network
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(async () => (await caches.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))
  );
});
