/**
 * The link-preview (Open Graph) tags of an exported page.
 *
 * A message board fetches a pasted link's page and reads those tags without
 * running the app, so they have to be in the static head, with the pack's own
 * name and description. The tags that need an address exist only when the
 * exporter was given a public URL and — for the image — a preview file.
 */
import "./../helpers/page.mjs";
import { ensureBuilt } from "../build.mjs";
import { ok, report } from "../helpers/check.mjs";

await ensureBuilt();
const { renderPage } = await import("../.gen/exportcore.mjs");

const shell = { scripts: [], styles: [] };
const processed = {
  mods: [
    {
      meta: { name: "Test Pack", version: "1.0", description: "A test pack." },
      dir: "MyMod",
      lng: {},
      rul: [],
    },
  ],
  langs: { "en-US": {} },
  resources: {},
};

// With a public address the card carries the URL and the image, and the
// card is the large-image kind because there is an image to enlarge
{
  const html = await renderPage("Pack.zip", processed, "", shell, undefined, undefined, false, {
    url: "https://example.io/pack/",
    image: "https://example.io/pack/og-image.png",
  });
  ok(
    html.includes('<meta property="og:title" content="Test Pack 1.0" />'),
    "the preview carries the pack name",
  );
  ok(
    html.includes('<meta property="og:description" content="A test pack." />'),
    "the preview carries the pack description",
  );
  ok(
    html.includes('<meta property="og:url" content="https://example.io/pack/" />'),
    "the preview carries the page URL",
  );
  ok(
    html.includes('<meta property="og:image" content="https://example.io/pack/og-image.png" />'),
    "the preview carries the image",
  );
  ok(
    html.includes('<meta name="twitter:card" content="summary_large_image" />'),
    "the card is the large-image kind",
  );
  ok(
    html.includes('<meta name="description" content="A test pack." />'),
    "the search excerpt is the pack description",
  );
}

// Without a public address the title and description still travel — boards
// fall back to them — but nothing that needs an address is written
{
  const html = await renderPage("Pack.zip", processed, "", shell);
  ok(html.includes('<meta property="og:title" content="Test Pack 1.0" />'), "title without URL");
  ok(!html.includes("og:url"), "no URL without an address");
  ok(!html.includes("og:image"), "no image without an address");
  ok(html.includes('<meta name="twitter:card" content="summary" />'), "the card is the small kind");
}

// A pack that wrote no description keeps the generic one
{
  const bare = {
    mods: [],
    langs: { "en-US": {} },
    resources: {},
  };
  const html = await renderPage("Pack.zip", bare, "", shell);
  ok(
    html.includes(
      '<meta property="og:description" content="Offline reference for an OpenXCom modpack" />',
    ),
    "the generic description is the fallback",
  );
}

report();
