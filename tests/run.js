#!/usr/bin/env node
// npm test — runs every tests/*.test.js in Chromium, against index.html and
// the in-memory database in tests/stub-supabase.js.
//
//   npm test                 all of them
//   npm test -- camera       only tests whose file or name contains "camera"
//
// A test file exports { "what it checks": async (t) => { ... } }. In a test,
// `await t.open(opts)` opens the app (opts as for openApp in harness.js) and
// returns { page, table, errors }. A test fails if it throws, takes longer
// than two minutes, or if any page it opened logged an error. On a failure
// each open page is saved as a screenshot in build/test-failures/.

const fs = require("fs");
const path = require("path");
const { launch, serve, openApp, ROOT } = require("./harness");

const LIMIT = 120000;
const SHOTS = path.join(ROOT, "build", "test-failures");

const within = (ms, p) => {
  let timer;
  return Promise.race([p, new Promise((_, no) => { timer = setTimeout(() => no(new Error(`took longer than ${ms / 1000} s`)), ms); })])
    .finally(() => clearTimeout(timer));
};

async function main() {
  const only = process.argv.slice(2).join(" ").toLowerCase();
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.js")).sort();
  const todo = [];
  for (const f of files) {
    for (const [name, fn] of Object.entries(require(path.join(__dirname, f)))) {
      if (!only || (f + " " + name).toLowerCase().includes(only)) todo.push({ f, name, fn });
    }
  }
  if (!todo.length) { console.error(`No test matches "${only}".`); process.exit(1); }

  const server = await serve();
  const browser = await launch();
  let failed = 0;
  const t0 = Date.now();
  try {
    for (const { f, name, fn } of todo) {
      const apps = [];
      const t = { open: async (opts) => { const app = await openApp(browser, server.url, opts); apps.push(app); return app; } };
      const start = Date.now();
      try {
        await within(LIMIT, fn(t));
        const errs = apps.flatMap((a) => a.errors);
        if (errs.length) throw new Error("the page reported errors:\n    " + errs.join("\n    "));
        console.log(`  ✓ ${f.replace(/\.test\.js$/, "")} › ${name}  (${((Date.now() - start) / 1000).toFixed(1)} s)`);
      } catch (e) {
        failed++;
        console.log(`  ✗ ${f.replace(/\.test\.js$/, "")} › ${name}`);
        console.log("    " + String((e && e.stack) || e).split("\n").slice(0, 12).join("\n    "));
        fs.mkdirSync(SHOTS, { recursive: true });
        for (const [i, a] of apps.entries()) {
          const file = path.join(SHOTS, `${name.replace(/[^\w-]+/g, "_").slice(0, 80)}${apps.length > 1 ? "-" + (i + 1) : ""}.png`);
          try { await a.page.screenshot({ path: file }); console.log("    screenshot: " + path.relative(ROOT, file)); } catch { /* page already gone */ }
        }
      } finally {
        for (const a of apps) await a.context.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(failed ? `\n${failed} of ${todo.length} failed (${secs} s)` : `\n${todo.length} passed (${secs} s)`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
