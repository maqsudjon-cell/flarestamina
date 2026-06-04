// Flarestamina service worker — minimal, network-first.
const CACHE = "flarestamina-v1";
const PRECACHE = ["/", "/challenge/", "/manifest.json", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Let Firebase / Google API + auth traffic always hit the network (never cache it).
function isFirebaseOrGoogle(url) {
  return /(^|\.)(googleapis\.com|gstatic\.com|firebaseio\.com|firebaseapp\.com|google\.com|googletagmanager\.com|firebasestorage\.app)$/.test(url.hostname)
    || url.hostname.includes("identitytoolkit")
    || url.hostname.includes("securetoken");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache writes
  const url = new URL(req.url);
  if (isFirebaseOrGoogle(url)) return; // straight to network

  // Network-first, fall back to cache.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/")))
  );
});
