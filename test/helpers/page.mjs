/**
 * The little of a browser the ruleset engine touches, for the checks.
 *
 * Nothing here loads a page: the engine only reads a `<meta>` tag to print the
 * build number, and the module set expects the build-time constants to exist.
 * Both are supplied so a check can import the real engine rather than a stub of
 * it.
 */
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.__XPEDIA_VERSION__ = "0-test";
globalThis.__XPEDIA_BUILD__ = "";
globalThis.__XPEDIA_STAMP__ = "";

globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => { },
};

globalThis.addEventListener = () => { };

export { };
