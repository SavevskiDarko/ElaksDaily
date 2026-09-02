#!/usr/bin/env node
// Structural checks for the single-file app. No dependencies, no build step —
// it reads index.html the same way the browser does.
//
//  1. Duplicate id= in the persistent markup. Two elements with one id means
//     getElementById returns the first, and whatever renders into the second
//     silently paints the wrong screen. This is what hid the invoice list
//     inside the stock list, and what left the Apts expenses blank before it.
//  2. Every $("...") names an id that exists somewhere — in the markup or in
//     a sheet template. A typo here is a null and a dead button.
//  3. Every onclick="fn(" names a function the script declares.
//
// Ids inside <script> are template markup for sheets. Only one sheet is open
// at a time, so the same id in two different sheets is fine and is not
// reported; the same id twice in the page itself never is.
import { readFileSync } from "node:fs";
import { inlineHandlers, declaredNames } from "./inline-handlers.mjs";

const FILE = process.argv[2] ?? "index.html";
const src = readFileSync(FILE, "utf8");

const scriptOpen = src.indexOf("\n<script>\n");
const scriptClose = src.lastIndexOf("\n</script>");
if (scriptOpen === -1 || scriptClose === -1) {
  console.error(`${FILE}: could not find the inline <script> block`);
  process.exit(2);
}
const markup = src.slice(0, scriptOpen);
const script = src.slice(scriptOpen, scriptClose);

const lineOf = (index) => src.slice(0, index).split("\n").length;
const problems = [];

// ---- 1. duplicate ids in the page itself ----
const seen = new Map();
for (const m of markup.matchAll(/\sid="([^"]+)"/g)) {
  const line = lineOf(m.index);
  if (seen.has(m[1])) {
    problems.push(`${FILE}:${line}  duplicate id="${m[1]}" — already used on line ${seen.get(m[1])}`);
  } else {
    seen.set(m[1], line);
  }
}

// ---- 2. $("id") that names nothing ----
const declaredIds = new Set(seen.keys());
for (const m of script.matchAll(/\sid="([a-zA-Z0-9_-]+)"/g)) declaredIds.add(m[1]);
// ids built at runtime: id="cm-${key}" keeps its prefix, id="${id}" has none
// and is filled from a string literal at the call site — supplierSelect("ar-sup")
// and friends — so those literals count as declarations too.
const dynamicIds = [...script.matchAll(/\sid="([a-zA-Z0-9_-]*)\$\{/g)].map((m) => m[1]);
const anonymousId = dynamicIds.some((prefix) => prefix === "");
if (anonymousId) {
  // A literal only counts as a declaration where it is handed to something
  // that builds the element. Literals inside $("…") are the lookups we are
  // checking, so they must not vouch for themselves.
  for (const m of script.matchAll(/(.{2})"([a-z][a-zA-Z0-9_-]*)"/g)) {
    if (m[1] !== '$(') declaredIds.add(m[2]);
  }
}

const looked = new Map();
for (const m of script.matchAll(/\$\("([a-zA-Z0-9_-]+)"\)/g)) {
  if (!looked.has(m[1])) looked.set(m[1], lineOf(scriptOpen + m.index));
}
for (const [id, line] of looked) {
  if (declaredIds.has(id)) continue;
  if (dynamicIds.some((prefix) => prefix && id.startsWith(prefix))) continue;
  problems.push(`${FILE}:${line}  $("${id}") — no element anywhere has that id`);
}

// ---- 3. an inline handler that names nothing ----
const declaredFns = declaredNames(script);
const BROWSER_GLOBALS = new Set(["location", "history", "window", "document", "console", "alert"]);

for (const [fn, at] of inlineHandlers(src)) {
  if (declaredFns.has(fn) || BROWSER_GLOBALS.has(fn) || fn in globalThis) continue;
  problems.push(`${FILE}:${lineOf(at)}  on\u2026="${fn}(\u2026)" — no such function`);
}
const handlerCount = inlineHandlers(src).size;

if (problems.length) {
  console.error(`\n${problems.length} problem(s) in ${FILE}:\n`);
  for (const p of problems) console.error("  " + p);
  console.error("");
  process.exit(1);
}
console.log(`${FILE}: ${seen.size} ids, ${looked.size} lookups, ${handlerCount} handlers — all resolve.`);
