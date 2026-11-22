// What every browser test stands on: a static server over the repository,
// Chromium, and openApp(), which opens index.html signed in against the
// in-memory database in tests/stub-supabase.js.
//
// Nothing leaves the machine. supabase-js is replaced by the stub, Google
// Fonts are refused, and so is every other outside request (the docx and PDF
// libraries on jsdelivr among them) — a test that needs one of those has to
// let it through in openApp first.

const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STUB = fs.readFileSync(path.join(__dirname, "stub-supabase.js"), "utf8");
// the browser a cloud session comes with, for when the Playwright from npm
// is not the version it was installed for
const PREINSTALLED = "/opt/pw-browsers/chromium";

function playwright() {
  try {
    return require("playwright");
  } catch {
    console.error("Playwright is not installed. Run:\n  npm install\n  npx playwright install chromium");
    process.exit(1);
  }
}

async function launch() {
  const { chromium } = playwright();
  try {
    return await chromium.launch();
  } catch (e) {
    if (fs.existsSync(PREINSTALLED)) return chromium.launch({ executablePath: PREINSTALLED });
    throw e;
  }
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

// the repository root, as the app is hosted: http://127.0.0.1:<port>/index.html
function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => server.close(done)),
  })));
}

const OWNER = { user_id: "u1", role: "owner", hide_tabs: [] };
// where the business is, so "today" is the same day for the app and the seed
const TIMEZONE = "Europe/Skopje";

// Opens the app and waits until its first load is done.
//   db       tables to start with: { clients: [...], ... }. user_roles holds
//            the owner unless given.
//   missing  tables that answer "does not exist" (a migration not run yet)
//   user     who is signed in, default { id: "u1" } — the seeded owner. To
//            test an employee, give their id here and their row in user_roles.
//   lang     "en" (default) or "mk"
//   storage  more localStorage to set before the app starts
//   viewport defaults to a phone, 412 × 915
// A reload starts again from this seed.
//
// Returns { page, context, errors, table(name) }. `errors` collects page
// errors and console errors; the runner fails the test if any were seen.
async function openApp(browser, base, opts = {}) {
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: opts.viewport || { width: 412, height: 915 },
    timezoneId: TIMEZONE,
  });
  // registered first, so it runs last: whatever the two below do not answer
  await context.route((url) => !url.href.startsWith(base), (r) => r.abort());
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await context.route(/supabase-js@2/, (r) => r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: STUB }));

  const seed = { user_roles: [OWNER], ...(opts.db || {}) };
  await context.addInitScript((s) => {
    window.__db = s.db;
    window.__missing = s.missing;
    if (s.user) window.__user = s.user;
    try {
      localStorage.setItem("centrala_lang", s.lang);
      localStorage.setItem("centrala_seen_build", "99999999");   // no "What's new" sheet over the test
      for (const [k, v] of Object.entries(s.storage)) localStorage.setItem(k, v);
    } catch { /* no storage: the app falls back to English */ }
  }, { db: seed, missing: opts.missing || [], user: opts.user || null, lang: opts.lang || "en", storage: opts.storage || {} });

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("page error: " + (e.stack || e.message)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console.error: " + m.text());
  });

  await page.goto(base + "/index.html");
  // `state` is a top-level let in the app's script, not a property of window
  await page.waitForFunction(() => typeof state !== "undefined" && state.loading === false);

  return {
    page, context, errors,
    table: (name) => page.evaluate((n) => (window.__db || {})[n] || [], name),
  };
}

module.exports = { ROOT, TIMEZONE, launch, serve, openApp, OWNER };
