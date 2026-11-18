import { useEffect, useState } from "react";
import { state, update } from "../state";
import {
  downloadExport, exportableLanguages, estimatePending, estimateSize, exportedPackName,
  exportPedia, measureArchive, measureLanguages, prepareEstimate, type ExportEstimate
} from "../exportPedia";
import { packSource } from "../packSource";
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
  if (!state.showExportDialog)
    return null;
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
  let parts = [images ? "every image" : "", languagePacks ? `${languagePacks} language pack${languagePacks == 1 ? "" : "s"}` : ""]
    .filter(Boolean);
  return parts.length ? `the page and ${parts.join(" and ")}` : "just the page";
}

function ExportDialogBody() {
  let languages = exportableLanguages();
  // A language with no remembered entry counts as wanted, so the first open
  // offers everything the pack has and a choice made on another pack does not
  // silently drop a language this one is the only one to carry
  let selected = languages.filter(lang => state.exportLanguages[lang] !== false);
  let [images, setImages] = useState(false);
  let [split, setSplit] = useState(false);
  let [busy, setBusy] = useState(false);
  let [status, setStatus] = useState<string>();
  let [progress, setProgress] = useState<number>();
  let [error, setError] = useState<string>();
  // Measured once when the dialog opens: the shell and one gzip are the slow
  // parts, and every later selection only adds their stored sizes up
  let [estimate, setEstimate] = useState<ExportEstimate>();

  let pack = state.packName;
  // A pack whose images are not in the page has none to bundle: either it *is*
  // an exported page, whose images are files beside it, or it is a folder served
  // by `xpedia-cli --serve`, whose images stay in that folder
  let unavailable = packSource(pack)?.imagesUnavailable;
  let bundleable = !unavailable;

  // `images` can only ever mean "bundle the stored sprites", so it is forced off
  // for such a pack rather than silently doing nothing when it is ticked
  let includeImages = images && bundleable;

  // A browser can only save a file, not a folder, so an export that is more than
  // one file has to travel as an archive. That is the container only: what goes
  // inside is decided by `includeImages` and `split` separately, so ticking
  // "Split" gives language packs without dragging every image along.
  let archive = includeImages || split;
  /** The page alone, so no archive and no packs */
  let single = !archive;
  /** Languages that become packs when split is on, i.e. everything but English */
  let languagePacks = selected.filter(lang => lang != "en-US").length;

  // Escape is the normal way out of a modal, but it must not interrupt an
  // export that is already running
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key == "Escape" && !busy)
        update({ showExportDialog: false });
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [busy]);

  useEffect(() => {
    // An exported file has nothing to export, so measuring it would be waste
    if (!pack)
      return;
    let live = true;
    prepareEstimate()
      .then(measured => { if (live) setEstimate(measured); })
      .catch(() => { });
    return () => { live = false; };
  }, [pack]);

  // Languages and the archive details are measured when they are needed, not all
  // at once up front: most exports are a single file with no extra language
  let [ticking, setTicking] = useState(false);
  // The sizes are filled into the measured object, so a redraw is forced with a
  // counter rather than a new copy: the copy would not be kept in the cache, and
  // reopening the dialog would measure the same languages again
  let [, redraw] = useState(0);
  let pending = estimatePending(estimate, selected, archive, includeImages);
  useEffect(() => {
    if (!estimate || !pending) {
      setTicking(false);
      return;
    }
    let live = true;
    setTicking(true);
    (async () => {
      await measureLanguages(estimate, selected);
      // The shell is measured for any archive; the images only when they are
      // going in, so ticking "Split" alone does not wait on sprite sizes
      if (archive)
        await measureArchive(estimate, pack!, includeImages);
    })()
      .then(() => {
        if (!live)
          return;
        setTicking(false);
        redraw(n => n + 1);
      })
      .catch(() => { if (live) setTicking(false); });
    return () => { live = false; };
  }, [estimate, pending, archive]);

  if (!pack)
    return null;

  let name = exportedPackName(pack);

  function close() {
    if (busy)
      return;
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
    let wanted = new Set(next);
    let stored = { ...state.exportLanguages };
    for (let lang of languages) {
      if (wanted.has(lang))
        delete stored[lang];
      else
        stored[lang] = false;
    }
    update({ exportLanguages: stored });
  }

  function toggle(lang: string) {
    choose(selected.includes(lang) ? selected.filter(n => n != lang) : [...selected, lang]);
  }

  async function run() {
    setBusy(true);
    setError(undefined);
    setStatus("Preparing...");
    setProgress(0);
    try {
      let result = await exportPedia({
        languages: selected, images: includeImages, split, archive,
        onProgress: (text, value) => { setStatus(text); setProgress(value); }
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

  return <div className="full-screen-centered status-overlay"
    onMouseDown={e => { if (e.target == e.currentTarget) close(); }}>
    <div className="export-dialog" role="dialog" aria-modal="true" aria-label="Export">
      <h3><Tr text="Export" /></h3>

      <p className="export-note">
        The exported pedia shows itself as <b>{name}</b> in the modpack list.
      </p>

      <h4><Tr text="Translations" /></h4>
      <p className="export-note">English is always included.</p>
      <div className="export-languages">
        <label>
          <input type="checkbox" checked readOnly /> en-US
        </label>
        {languages.map(lang =>
          <label key={lang}>
            <input type="checkbox" checked={selected.includes(lang)}
              onChange={() => toggle(lang)} /> {lang}
          </label>
        )}
      </div>
      {languages.length > 0 &&
        <div className="export-language-buttons">
          <button onClick={() => choose([...languages])}><Tr text="Select all" /></button>
          <button onClick={() => choose([])}><Tr text="Unselect all" /></button>
          {/* The language the user reads is the one they usually export; when
              that is English there is nothing extra to pick */}
          <button onClick={() => choose(state.lang && languages.includes(state.lang) ? [state.lang] : [])}>
            <Tr text="Select current" />
          </button>
        </div>
      }

      <h4><Tr text="Format" /></h4>
      <label className="export-format">
        <input type="checkbox" checked={includeImages} disabled={!bundleable}
          onChange={() => setImages(!images)} />
        <span>
          <b>Include images</b><br />
          <small>
            {bundleable
              ? <>Every image the pedia can show, so the game is not needed at all.
                Without it, images are read from the game's{" "}
                <code>user/mods</code> folder next to the file.</>
              : unavailable == "served"
                ? <>Not available here: this page previews a folder served by{" "}
                  <code>xpedia-cli --serve</code>, so its images stay in that folder
                  and are never part of the page. To get a pack that carries them,
                  run <code>xpedia-cli</code> on the folder itself with{" "}
                  <code>--assets</code>, which writes them straight from disk. A page
                  exported from here has no images of its own, so it only shows them
                  while it sits in that folder.</>
                : <>Not available here: this pedia is itself an exported file, so its
                  images are already real files beside it. Bundling them would copy
                  every one of them through the browser only to write out the same
                  bytes again.</>}
          </small>
        </span>
      </label>
      <label className="export-format">
        <input type="checkbox" checked={split} onChange={() => setSplit(!split)}
          disabled={languages.length == 0} />
        <span>
          <b>Split into language packs</b><br />
          <small>
            The page keeps English and each other language becomes a small
            script under <code>xpedia-lang/</code>, loaded only when that
            language is picked. Makes the page smaller, and a translation can
            be fixed by replacing one file.
            {languages.length == 0 && " The pack has no other translation."}
          </small>
        </span>
      </label>
      {/* The output shape follows from the two above, so it is stated rather
          than chosen: a browser download cannot create a folder. What the
          archive holds is named too, so a pack with images off is never
          mistaken for one carrying them. */}
      <p className="export-note">
        {single
          ? <>Exported as <b>a single HTML file</b>.</>
          : <>Exported as <b>a ZIP archive</b> with {describeContents(includeImages, split ? languagePacks : 0)}.</>}
      </p>

      {/* Cheap enough to recompute on every render: the measuring is what
          costs, and it happened when the dialog opened or when the
          checkboxes changed */}
      <p className={"export-size" + (estimate && !ticking ? "" : " export-size-pending")}>
        {estimate && !ticking
          ? <>Estimated file size: <b>{asMB(estimateSize(estimate, selected, archive, includeImages))}</b></>
          : "Estimating file size..."}
      </p>

      {status &&
        <div className="export-progress">
          <div className="export-progress-text">{status}</div>
          {progress != null && <div className="slow-process-bar" role="progressbar"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div className="slow-process-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>}
        </div>
      }

      {error && <p className="export-error">{error}</p>}

      <div className="export-buttons">
        <button onClick={run} disabled={busy}><Tr text="Export" /></button>
        <button onClick={close} disabled={busy}><Tr text="Cancel" /></button>
      </div>
    </div>
  </div>;
}
