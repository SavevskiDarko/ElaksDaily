const CACHE = "centrala-v6";
const SHELL = ["./", "./index.html", "./manifest.json", "./Ponuda_TEMPLATE.docx", "./brand-logo.png", "./brand-banner.png", "./brand-footer.png", "./icon-192.png?v=3", "./icon-512.png?v=3"];

// The scripts and fonts the app loads from elsewhere, kept too: without the
// database's script the app cannot even open with no signal. The scripts are
// fetched on install, so the first start with no signal already has them.
const CDN = "centrala-cdn-v1";
const CDN_HOSTS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];
const CDN_FILES = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
  "https://cdn.jsdelivr.net/npm/pizzip@3.2.0/dist/pizzip.min.js",
  "https://cdn.jsdelivr.net/npm/docxtemplater@3.69.0/build/docxtemplater.min.js",
];

self.addEventListener("install", (e) => {
  const scripts = caches.open(CDN).then((c) => Promise.all(CDN_FILES.map((u) =>
    fetch(u).then((res) => res.ok && c.put(u, res)).catch(() => {}))));       // best effort: kept on first use otherwise
  e.waitUntil(Promise.all([caches.open(CACHE).then((c) => c.addAll(SHELL)), scripts]).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== CDN).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first, so updates arrive, and the kept copy when there is no
// signal. A weak signal can leave a request hanging for a minute, so after a
// few seconds the kept copy is used instead, and the network's answer, when
// it comes, is kept for next time.
const WAIT = 5000;
function netOrKept(req, cacheName, fallback) {
  const net = fetch(req).then((res) => {
    // the app's own "is there a new version" check asks for no-store: not kept
    if ((res.ok || res.type === "opaque") && req.cache !== "no-store") {
      const copy = res.clone();
      caches.open(cacheName).then((c) => c.put(req, copy));
    }
    return res;
  });
  const kept = () => caches.match(req).then((r) => r || (fallback ? caches.match(fallback) : undefined));
  return new Promise((answer) => {
    let done = false;
    const give = (r) => { if (!done && r) { done = true; answer(r); } };
    const slow = setTimeout(() => kept().then(give), WAIT);
    net.then((r) => { clearTimeout(slow); give(r); })
      .catch(() => { clearTimeout(slow); kept().then((r) => { give(r); if (!done) { done = true; answer(Response.error()); } }); });
  });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin === location.origin) return e.respondWith(netOrKept(e.request, CACHE, "./index.html"));
  if (CDN_HOSTS.includes(url.hostname)) e.respondWith(netOrKept(e.request, CDN));
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
    data: { taskId: data.taskId || null, jobId: data.jobId || null, go: data.go || null },
  };
  // A phone shows two buttons at most on Android: Done, and Snooze 1h during
  // the day or Tomorrow in the evening, when an hour on is no use. Where three
  // fit, all three.
  if (data.taskId) {
    const done = { action: "done", title: "\u2713 Done" };
    const snooze = { action: "snooze", title: "Snooze 1h" };
    const later = { action: "tomorrow", title: "Tomorrow" };
    const max = (self.Notification && Notification.maxActions) || 2;
    opts.actions = max >= 3 ? [done, snooze, later] : [done, new Date().getHours() >= 20 ? later : snooze];
  }
  e.waitUntil(self.registration.showNotification(data.title, opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const id = (e.notification.data || {}).taskId, jobId = (e.notification.data || {}).jobId, go = (e.notification.data || {}).go;
  // The session lives in the page, not here, so the action is handed to the
  // app through the URL and carried out the moment it opens or focuses.
  // A job opens on its card ("list": tomorrow's jobs).
  // Money and stock open where they are about ("go": an invoice, a bill, the order list).
  const url = jobId ? `./?job=${encodeURIComponent(jobId)}` : go ? `./?go=${encodeURIComponent(go)}`
    : id ? `./?task=${id}${e.action ? "&do=" + e.action : ""}` : "./";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.postMessage({ centrala: true, taskId: id || null, jobId: jobId || null, go: go || null, action: e.action || "open" });
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
