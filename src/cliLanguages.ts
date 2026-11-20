import { UsageError } from "./cliError";
import { defaultLanguage } from "./rul/Ruleset";

/**
 * The languages to carry, in the order they were asked for.
 *
 * `--lang` accepts any spelling of a language name; the pack's own spelling is
 * used from here on. An unknown name is a hard error: silently falling back to
 * English would hand back a page that is not what was asked for, and the usual
 * cause is a typo such as `en-us` or `ru-RU`.
 *
 * English is always part of the result: every page carries its strings as the
 * fallback, so `--lang en-US` is how to ask for English alone rather than a way
 * to leave it out.
 *
 * It lives here rather than in `cliMain` because both the exporter and the live
 * server read the same option and must agree on what it means.
 */
export function resolveLanguages(requested: string[] | undefined, available: string[]) {
  // Omitting `--lang` means every language the pack has, English leading
  if (!requested) return [defaultLanguage, ...available.filter((name) => name !== defaultLanguage)];

  const byLower = new Map(available.map((name) => [name.toLowerCase(), name]));
  const unknown = requested.filter((name) => !byLower.has(name.toLowerCase()));
  if (unknown.length)
    throw new UsageError(
      `The pack has no language ${unknown.map((n) => JSON.stringify(n)).join(", ")}. ` +
        `Available: ${available.join(", ")}`,
    );

  // The same language twice is one language, and a repeat must not move it
  const names = [
    ...new Set(
      requested
        .map((name) => byLower.get(name.toLowerCase()))
        .filter((name): name is string => name !== undefined),
    ),
  ];
  // English goes last when it was not named, so that the first language the
  // user asked for stays the primary one
  if (!names.includes(defaultLanguage)) names.push(defaultLanguage);
  return names;
}
