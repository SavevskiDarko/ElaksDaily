// The app is one HTML file with one inline <script>. scripts/extract-script.mjs
// writes that script to build/app.js, padded so line numbers still match
// index.html. This config lints that.
//
// The point is no-undef: a typo'd function name in an onclick, or a helper
// that was renamed in one place and not another, is otherwise invisible until
// somebody taps the button.
export default [
  {
    files: ["build/app.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        // browser
        window: "readonly", document: "readonly", navigator: "readonly",
        location: "readonly", history: "readonly", localStorage: "readonly",
        console: "readonly", fetch: "readonly", Blob: "readonly", File: "readonly",
        FileReader: "readonly", Image: "readonly", URL: "readonly", URLSearchParams: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly",
        clearInterval: "readonly", requestAnimationFrame: "readonly",
        Notification: "readonly", NodeFilter: "readonly", SpeechSynthesisUtterance: "readonly",
        speechSynthesis: "readonly", atob: "readonly", btoa: "readonly",
        alert: "readonly", TextEncoder: "readonly", AbortController: "readonly",
        // loaded from the CDN in index.html, before this script
        supabase: "readonly", PizZip: "readonly", docxtemplater: "readonly",
      },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      "no-undef": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-func-assign": "error",
      "no-unreachable": "error",
      "no-cond-assign": "error",
      "no-const-assign": "error",
      "no-self-assign": "error",
      "no-sparse-arrays": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      // an unused variable is usually a rename that missed a spot
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
    },
  },
];
