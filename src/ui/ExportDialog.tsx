import { useEffect, useState } from "react";
import {
  downloadExport,
  type ExportEstimate,
  estimatePending,
  estimateSize,
  exportableLanguages,
  exportedPackName,
  exportPedia,
  measureArchive,
  measureLanguages,
  prepareEstimate,
} from "../exportPedia";
import { packSource } from "../packSource";
import { state, update } from "../state";
import { asMB } from "../util";
import { Tr } from "./Val";

/**
 * Export settings for the currently shown modpack.
 *
 * Languages are picked here because an exported file is meant to be shared: a
 * pack can carry dozens of translations, and they are most of the ruleset size.
 * Images are never inlined into the HTML; the archive option bundles them next
 * to it instead.
 */
export default function ExportDialog() {
  if (!state.showExportDialog) return null;
  return <ExportDialogBody />;
}

/**
 * Names what an archive holds, for the note under the two checkboxes.
 *
 * The page is always in it, so only the parts that could be left out are named;
 * "images off" is then visibly a different claim from "images on", which is the
 * whole point of spelling it out.
 */
function describeContents(images: boolean, languagePacks: number) {
  const parts = [
    images ? "every image" : "",
    languagePacks ? `${languagePacks} language pack${languagePacks === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? `the page and ${parts.join(" and ")}` : "just the page";
}

function ExportDialogBody() {
  const languages = exportableLanguages();
  // A language with no remembered entry counts as wanted, so the first open
  // offers everything the pack has and a choice made on another pack does not
  // silently drop a language this one is the only one to carry
  const selected = languages.filter((lang) => state.exportLanguages[lang] !== false);
  // Content of `selected`, so an effect can depend on what the list holds
  // rather than on a fresh array identity on every render
  const selectedKey = selected.join(",");
  const [images, setImages] = useState(false);
  const [split, setSplit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();
  // Measured once when the dialog opens: the shell and one gzip are the slow
  // parts, and every later selection only adds their stored sizes up
  const [estimate, setEstimate] = useState<ExportEstimate>();

  const pack = state.packName;
  // A pack whose images the browser does not have is normally unable to bundle
  // them: an exported page keeps them beside itself. A served pack is different
  // — the server behind it owns the folder and can export it whole, so the
  // choice is offered and handed to that server.
  const source = packSource(pack);
  const serverExport = source?.serveExport;
  const unavailable = serverExport ? undefined : source?.imagesUnavailable;
  const bundleable = !unavailable;

  // `images` can only ever mean "bundle the stored sprites", so it is forced off
  // for such a pack rather than silently doing nothing when it is ticked
  const includeImages = images && bundleable;

  // A browser can only save a file, not a folder, so an export that is more than
  // one file has to travel as an archive. That is the container only: what goes
  // inside is decided by `includeImages` and `split` separately, so ticking
  // "Split" gives language packs without dragging every image along.
  const archive = includeImages || split;
  /** The page alone, so no archive and no packs */
  const single = !archive;
  /** Languages that become packs when split is on, i.e. everything but English */
  const languagePacks = selected.filter((lang) => lang !== "en-US").length;

  // Escape is the normal way out of a modal, but it must not interrupt an
  // export that is already running
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) update({ showExportDialog: false });
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [busy]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `pack` is a module value, listed only as the trigger; the dialog remounts on every open.
  useEffect(() => {
    // An exported file has nothing to export, so measuring it would be waste
    if (!pack) return;
    let live = true;
    prepareEstimate()
      .then((measured) => {
        if (live) setEstimate(measured);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pack]);

  // Languages and the archive details are measured when they are needed, not all
  // at once up front: most exports are a single file with no extra language
  const [ticking, setTicking] = useState(false);
  // The sizes are filled into the measured object, so a redraw is forced with a
  // counter rather than a new copy: the copy would not be kept in the cache, and
  // reopening the dialog would measure the same languages again
  const [, redraw] = useState(0);
  const pending = estimatePending(estimate, selected, archive, includeImages);
  // Only an export that carries images is built on the server, so only that one
  // has a size the browser cannot measure: the sprites never reach the page.
  // A page-only export of the same pack is built here as usual, and its own
  // measurement is both correct and instant.
  const serverSized = serverExport && includeImages;
  // `undefined` while the server is still answering, `null` when it did not:
  // the two are different, because one is worth waiting for and the other is an
  // answer the dialog has to give rather than spin on forever
  const [servedBytes, setServedBytes] = useState<number | null>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the url and the joined languages are content keys on purpose; object and array identities change on unrelated renders.
  useEffect(() => {
    if (!serverExport) return;
    if (!includeImages) {
      setServedBytes(undefined);
      return;
    }
    let live = true;
    setServedBytes(undefined);
    const query = new URLSearchParams();
    query.set("estimate", "1");
    if (selected.length) query.set("lang", selected.join(","));
    if (split) query.set("split", "1");
    query.set("images", "1");
    fetch(`${serverExport.url}?${query}`)
      .then((r) => (r.ok ? r.json() : undefined))
      .then((data) => {
        if (!live) return;
        setServedBytes(typeof data?.bytes === "number" ? data.bytes : null);
      })
      .catch(() => {
        if (live) setServedBytes(null);
      });
    return () => {
      live = false;
    };
  }, [serverExport?.url, selected.join(","), split, includeImages]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `selectedKey` stands in for `selected`, a fresh array per render; its contents are what the measurement needs.
  useEffect(() => {
    // The server's archive is not measured here, so the local one is not either
    if (!pack || !estimate || !pending || serverSized) {
      setTicking(false);
      return;
    }
    let live = true;
    setTicking(true);
    (async () => {
      await measureLanguages(estimate, selected);
      // The shell is measured for any archive; the images only when they are
      // going in, so ticking "Split" alone does not wait on sprite sizes
      if (archive) await measureArchive(estimate, pack, includeImages);
    })()
      .then(() => {
        if (!live) return;
        setTicking(false);
        redraw((n) => n + 1);
      })
      .catch(() => {
        if (live) setTicking(false);
      });
    return () => {
      live = false;
    };
  }, [estimate, pending, archive, includeImages, serverSized, selectedKey]);

  if (!pack) return null;

  const name = exportedPackName(pack);

  // The size to show: the server's own answer when it builds the archive,
  // otherwise the browser's measurement once it has finished measuring
  const showSize = serverSized
    ? (servedBytes ?? undefined)
    : estimate && !ticking
      ? estimateSize(estimate, selected, archive, includeImages)
      : undefined;
  // The server was asked and gave no size: an endpoint that predates the request
  // or a reply that failed. Saying so is better than "Estimating..." forever.
  const sizeUnknown = serverSized && servedBytes === null;

  function close() {
    if (busy) return;
    update({ showExportDialog: false });
  }

  /**
   * Remembers which of the pack's languages this export carries.
   *
   * Only the languages the dialog is showing are written, so a choice made on
   * one pack cannot turn off a translation that only another pack has. "On" is
   * stored as the absence of an entry, because that is already the default:
   * only the languages turned off need remembering, which keeps the blob from
   * growing by one key per language per pack.
   */
  function choose(next: string[]) {
    const wanted = new Set(next);
    const stored = { ...state.exportLanguages };
    for (const lang of languages) {
      if (wanted.has(lang)) delete stored[lang];
      else stored[lang] = false;
    }
    update({ exportLanguages: stored });
  }

  function toggle(lang: string) {
    choose(selected.includes(lang) ? selected.filter((n) => n !== lang) : [...selected, lang]);
  }

  async function run() {
    setBusy(true);
    setError(undefined);
    setStatus("Preparing...");
    setProgress(0);
    try {
      const result = await exportPedia({
        languages: selected,
        images: includeImages,
        split,
        archive,
        onProgress: (text, value) => {
          setStatus(text);
          setProgress(value);
        },
      });
      downloadExport(result);
      // Give the browser a moment to start the download before the modal closes
      setStatus(`Downloaded ${result.name}`);
      setProgress(1);
      setTimeout(() => update({ showExportDialog: false }), 400);
    } catch (e) {
      setError(e?.message ?? String(e));
      setStatus(undefined);
      setProgress(undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="full-screen-centered status-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="export-dialog" role="dialog" aria-modal="true" aria-label="Export">
        <h3>
          <Tr text="Export" />
        </h3>

        <p className="export-note">
          The exported pedia shows itself as <b>{name}</b> in the modpack list.
        </p>

        <h4>
          <Tr text="Translations" />
        </h4>
        <p className="export-note">English is always included.</p>
        <div className="export-languages">
          <label>
            <input type="checkbox" checked readOnly /> en-US
          </label>
          {languages.map((lang) => (
            <label key={lang}>
              <input
                type="checkbox"
                checked={selected.includes(lang)}
                onChange={() => toggle(lang)}
              />{" "}
              {lang}
            </label>
          ))}
        </div>
        {languages.length > 0 && (
          <div className="export-language-buttons">
            <button type="button" onClick={() => choose([...languages])}>
              <Tr text="Select all" />
            </button>
            <button type="button" onClick={() => choose([])}>
              <Tr text="Unselect all" />
            </button>
            {/* The language the user reads is the one they usually export; when
              that is English there is nothing extra to pick */}
            <button
              type="button"
              onClick={() =>
                choose(state.lang && languages.includes(state.lang) ? [state.lang] : [])
              }
            >
              <Tr text="Select current" />
            </button>
          </div>
        )}

        <h4>
          <Tr text="Format" />
        </h4>
        <label className="export-format">
          <input
            type="checkbox"
            checked={includeImages}
            disabled={!bundleable}
            onChange={() => setImages(!images)}
          />
          <span>
            <b>Include images</b>
            <br />
            <small>
              {bundleable ? (
                serverExport ? (
                  <>
                    Every image the folder has, so the result runs without the game. The export is
                    built by the <code>xpedia-cli --serve</code> that is serving this page and
                    downloaded as a ZIP, which is faster than the browser could do it and needs no
                    repacking.
                  </>
                ) : (
                  <>
                    Every image the pedia can show, so the game is not needed at all. Without it,
                    images are read from the game's <code>user/mods</code> folder next to the file.
                  </>
                )
              ) : (
                <>
                  Not available here: this pedia is itself an exported file, so its images are
                  already real files beside it. Bundling them would copy every one of them through
                  the browser only to write out the same bytes again.
                </>
              )}
            </small>
          </span>
        </label>
        <label className="export-format">
          <input
            type="checkbox"
            checked={split}
            onChange={() => setSplit(!split)}
            disabled={languages.length === 0}
          />
          <span>
            <b>Split into language packs</b>
            <br />
            <small>
              The page keeps English and each other language becomes a small script under{" "}
              <code>xpedia-lang/</code>, loaded only when that language is picked. Makes the page
              smaller, and a translation can be fixed by replacing one file.
              {languages.length === 0 && " The pack has no other translation."}
            </small>
          </span>
        </label>
        {/* The output shape follows from the two above, so it is stated rather
          than chosen: a browser download cannot create a folder. What the
          archive holds is named too, so a pack with images off is never
          mistaken for one carrying them. */}
        <p className="export-note">
          {single ? (
            <>
              Exported as <b>a single HTML file</b>.
            </>
          ) : (
            <>
              Exported as <b>a ZIP archive</b> with{" "}
              {describeContents(includeImages, split ? languagePacks : 0)}.
            </>
          )}
        </p>

        {/* Cheap enough to recompute on every render: the measuring is what
          costs, and it happened when the dialog opened or when the
          checkboxes changed */}
        <p
          className={`export-size${showSize != null || sizeUnknown ? "" : " export-size-pending"}`}
        >
          {showSize != null ? (
            <>
              Estimated file size: <b>{asMB(showSize)}</b>
            </>
          ) : sizeUnknown ? (
            "The server did not report a size; the export will still be built there."
          ) : (
            "Estimating file size..."
          )}
        </p>

        {status && (
          <div className="export-progress">
            <div className="export-progress-text">{status}</div>
            {progress != null && (
              <div
                className="slow-process-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
              >
                <div
                  className="slow-process-fill"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {error && <p className="export-error">{error}</p>}

        <div className="export-buttons">
          <button type="button" onClick={run} disabled={busy}>
            <Tr text="Export" />
          </button>
          <button type="button" onClick={close} disabled={busy}>
            <Tr text="Cancel" />
          </button>
        </div>
      </div>
    </div>
  );
}
