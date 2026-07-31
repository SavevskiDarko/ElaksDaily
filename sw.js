const CACHE = "centrala-v5";
const SHELL = ["./", "./index.html", "./manifest.json", "./Ponuda_TEMPLATE.docx", "./brand-logo.png", "./brand-banner.png", "./brand-footer.png", "./icon-192.png?v=3", "./icon-512.png?v=3"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for the app shell (so updates arrive), cache fallback offline.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});

self.addEventListener("push", (e) => {
  let data = { title: "Centrala", body: "", tag: "general" };
  try { data = e.data.json(); } catch (_) {}
  const opts = {
    body: data.body,
    tag: data.tag,
    icon: "./icon-192.png?v=3",
    badge: "./icon-192.png?v=3",
    vibrate: [100, 50, 100],
    data: { taskId: data.taskId || null },
  };
  if (data.taskId) opts.actions = [
    { action: "done", title: "\u2713 Done" },
    { action: "snooze", title: "Snooze 1h" },
  ];
  e.waitUntil(self.registration.showNotification(data.title, opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const id = (e.notification.data || {}).taskId;
  // The session lives in the page, not here, so the action is handed to the
  // app through the URL and carried out the moment it opens or focuses.
  const url = id ? `./?task=${id}${e.action ? "&do=" + e.action : ""}` : "./";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.postMessage({ centrala: true, taskId: id || null, action: e.action || "open" });
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
