// The inline event attributes the app actually uses. Kept in one place so the
// checker and the linter's extractor agree on what counts as a call site —
// a handler missing from this list looks dead to both of them.
//
// Named explicitly rather than matched as /on[a-z]+=/, because that also hits
// the tail of ordinary attributes: zone=, content=, month=. The lookbehind
// does the same job from the other side, and still finds a handler that opens
// a JavaScript string rather than following a space:
//   '<div ontouchstart="…" ' + 'ontouchmove="sheetDragMove(event)">' 
export const HANDLER_ATTRS = [
  "click", "change", "input", "submit", "blur", "focus",
  "touchstart", "touchmove", "touchend", "keydown", "keyup",
];

const ATTR = new RegExp(`(?<![\\w-])on(?:${HANDLER_ATTRS.join("|")})=(["'])(.*?)\\1`, "gs");
// a bare call: anything after a dot is a method on a value we cannot resolve
const CALL = /(?<![.\w$])([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;

// every function named by an inline handler, as name -> character offset of
// the attribute it first appeared in
export function inlineHandlers(src) {
  const found = new Map();
  for (const m of src.matchAll(ATTR)) {
    for (const call of m[2].matchAll(CALL)) {
      if (!found.has(call[1])) found.set(call[1], m.index);
    }
  }
  return found;
}

// top-level names the script declares
export function declaredNames(script) {
  const names = new Set();
  for (const m of script.matchAll(/^(?:async )?function ([a-zA-Z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of script.matchAll(/^(?:const|let|var) ([a-zA-Z0-9_$]+)\s*=/gm)) names.add(m[1]);
  return names;
}
