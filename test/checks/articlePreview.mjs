/**
 * The per-article stub a served pedia answers `/a/<id>` with.
 *
 * A board fetches a pasted link without running the app, so the article has
 * to be in static tags — title, an excerpt of its body, its illustration —
 * while the reader's browser is forwarded to the app entry. The excerpt is
 * plain text: markup stripped, whitespace collapsed, cut on a word.
 */
import "./../helpers/page.mjs";
import { ensureBuilt } from "../build.mjs";
import { eq, ok, report } from "../helpers/check.mjs";

await ensureBuilt();
const { articleExcerpt, renderArticlePreview } = await import("../.gen/exportcore.mjs");

// The excerpt strips markup and collapses whitespace
eq(
  articleExcerpt("<h4>Title</h4>\n<p>Some  text<br>here.</p>"),
  "Title Some text here.",
  "markup stripped",
);
eq(articleExcerpt(undefined), "", "no body, no excerpt");
eq(articleExcerpt(""), "", "empty body, no excerpt");
eq(articleExcerpt("Fish &amp; Chips &nbsp; Ltd"), "Fish & Chips Ltd", "entities decoded");

// The cut falls on a word boundary and ends in an ellipsis
{
  const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
  const excerpt = articleExcerpt(words);
  ok(excerpt.length <= 201, "excerpt is about 200 chars", String(excerpt.length));
  ok(excerpt.endsWith("…"), "excerpt ends in an ellipsis");
  ok(/\bword\d+$/.test(excerpt.slice(0, -1)), "excerpt ends on a whole word", excerpt);
  ok(!excerpt.includes("word1word"), "excerpt is not cut mid word");
}

// With an illustration the card is the large-image kind, and the browser is
// forwarded to the app entry three ways: script, refresh, and plain link
{
  const html = renderArticlePreview({
    title: "Laser Rifle",
    description: "A rifle that shoots lasers.",
    url: "https://example.io/a/STR_LASER_RIFLE",
    image: "https://example.io/user/mods/Mod/img.png",
    target: "/##STR_LASER_RIFLE",
  });
  ok(html.includes('<meta property="og:title" content="Laser Rifle" />'), "stub carries the title");
  ok(
    html.includes('<meta property="og:description" content="A rifle that shoots lasers." />'),
    "stub carries the excerpt",
  );
  ok(
    html.includes('<meta property="og:url" content="https://example.io/a/STR_LASER_RIFLE" />'),
    "stub carries its own URL",
  );
  ok(
    html.includes(
      '<meta property="og:image" content="https://example.io/user/mods/Mod/img.png" />',
    ),
    "stub carries the illustration",
  );
  ok(
    html.includes('<meta name="twitter:card" content="summary_large_image" />'),
    "large-image card",
  );
  ok(html.includes('location.replace("/##STR_LASER_RIFLE")'), "script forwards to the app entry");
  ok(
    html.includes('http-equiv="refresh" content="0; url=/##STR_LASER_RIFLE"'),
    "refresh forwards too",
  );
  ok(html.includes('<a href="/##STR_LASER_RIFLE">Laser Rifle</a>'), "a plain link is the fallback");
}

// Without an illustration the card is the small kind and no image is named
{
  const html = renderArticlePreview({
    title: "Laser Rifle",
    description: "A rifle that shoots lasers.",
    url: "https://example.io/a/STR_LASER_RIFLE",
    target: "/##STR_LASER_RIFLE",
  });
  ok(!html.includes("og:image"), "no image tag without an illustration");
  ok(html.includes('<meta name="twitter:card" content="summary" />'), "small card");
}

// Titles and excerpts are escaped, so article text cannot break the head
{
  const html = renderArticlePreview({
    title: 'A "quoted" <title>',
    description: "Fish & Chips",
    url: "https://example.io/a/STR_X",
    target: "/##STR_X",
  });
  ok(html.includes("A &quot;quoted&quot; &lt;title&gt;"), "title is escaped");
  ok(html.includes("Fish &amp; Chips"), "excerpt is escaped");
  ok(!html.includes('content="A "quoted"'), "no raw quote breaks the attribute");
}

report();
