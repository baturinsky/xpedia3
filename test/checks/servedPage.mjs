/**
 * The mark that tells a served page from an exported one.
 *
 * `xpedia-cli --serve` writes exactly what an export writes, because it is the
 * same page — which means nothing in the file says that its images are *not*
 * beside it. This pins that the served page says so, and that an ordinary export
 * keeps the payload shape it has always had.
 */
import "./../helpers/page.mjs";
import { ensureBuilt } from "../build.mjs";
import { eq, ok, report } from "../helpers/check.mjs";

await ensureBuilt();
const { renderPage } = await import("../.gen/exportcore.mjs");

const shell = { scripts: [], styles: [] };
const processed = { mods: [], langs: { "en-US": {} }, resources: {} };

/** The payload the page starts with, read back out of the HTML */
function payloadOf(html) {
  const match = /window\.xpedia = (\{.*?\});<\/script>/s.exec(html);
  ok(!!match, "the page carries a payload");
  return JSON.parse(match[1]);
}

// An ordinary export says nothing about being served: a page that was written
// to disk and shipped is an export, and its images do sit beside it
{
  const html = await renderPage("Pack.zip", processed, "", shell);
  const payload = payloadOf(html);
  eq("served" in payload, false, "an export is not marked as served");
  eq(payload.pack, "Pack.inline", "the pack keeps its .inline name");
}

// The served page is marked, which is the only thing the export dialog has to go
// on when it decides that its images cannot be bundled
{
  const html = await renderPage("Pack.zip", processed, "", shell, undefined, undefined, true);
  const payload = payloadOf(html);
  eq(payload.served, true, "a served page is marked as served");
  eq(payload.pack, "Pack.inline", "a served page is named like an export");
}

report();
