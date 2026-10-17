// Lint for the app scripts: catches names used but never defined or imported.
// Run: npx eslint .
const browser = ["window","document","navigator","location","history","localStorage","sessionStorage","fetch","Response","Request","Headers","Blob","File","URL","URLSearchParams","addEventListener","setTimeout","clearTimeout","requestAnimationFrame","console","Image","FormData","matchMedia","Intl","crypto","TextEncoder","TextDecoder","btoa","atob","caches","self","Map","Set","Promise","Math","Date","JSON","Object","Array","String","Number","Boolean","RegExp","Error","Uint8Array","isNaN","parseInt","parseFloat","encodeURIComponent","decodeURIComponent","structuredClone","Infinity"];
export default [
  { ignores: ["tests/**", "node_modules/**", "sw.js"] },
  { files: ["*.js", "worker/*.js"], languageOptions: { sourceType: "module", ecmaVersion: 2024, globals: Object.fromEntries(browser.map(g => [g, "readonly"])) }, rules: { "no-undef": "error", "no-import-assign": "error", "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_" }] } },
];
