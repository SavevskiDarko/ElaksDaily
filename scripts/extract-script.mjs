#!/usr/bin/env node
// Pulls the inline <script> out of index.html so a linter can see it, padded
// with blank lines so every line number the linter reports is the line number
// in index.html itself.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { inlineHandlers, declaredNames } from "./inline-handlers.mjs";

const [, , input = "index.html", output = "build/app.js"] = process.argv;
const src = readFileSync(input, "utf8");
const open = src.indexOf("\n<script>\n");
const close = src.lastIndexOf("\n</script>");
if (open === -1 || close === -1) {
  console.error(`${input}: could not find the inline <script> block`);
  process.exit(2);
}
const startLine = src.slice(0, open + "\n<script>\n".length).split("\n").length - 1;
const body = src.slice(open + "\n<script>\n".length, close);

// Almost every function here is called from an inline onclick, which the
// linter never sees — without this it reports 200 live functions as unused and
// the real ones drown. Naming them in a trailing expression makes them used.
// It goes after the script, so every reported line number still matches
// index.html. (That a handler names a function which exists at all is
// check-html.mjs's job, not the linter's.)
const handlers = inlineHandlers(src);
const declared = declaredNames(body);
const used = [...handlers.keys()].filter((h) => declared.has(h)).sort();

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output,
  "\n".repeat(startLine - 1) + body +
  `\n/* called from inline handlers in ${input} */\nvoid [${used.join(", ")}];\n`);
console.log(`${input} → ${output} (script starts at line ${startLine}, ${used.length} inline handlers)`);
