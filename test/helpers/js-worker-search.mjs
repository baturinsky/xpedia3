// `js-worker-search` is CommonJS shipped as `{ default: class, INDEX_MODES }`.
// Node's ESM loader hands that whole object over as the default export, so the
// bare `import SearchApi from 'js-worker-search'` in Ruleset.ts would bind an
// object rather than the class and `new SearchApi()` would throw. The browser
// build never hits this because Vite unwraps it.
//
// Loaded through `createRequire` rather than a bare import: esbuild rewrites a
// bare specifier into its own interop wrapper, and pointing the alias at a file
// that imports the very module being aliased loops back on itself.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const mod = require("js-worker-search");

export default mod?.default ?? mod;
