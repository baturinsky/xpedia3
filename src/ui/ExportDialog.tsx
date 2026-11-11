import { useEffect, useState } from "react";
import { state, update } from "../state";
import {
  downloadExport, exportableLanguages, estimatePending, estimateSize, exportedPackName,
  exportPedia, measureArchive, measureLanguages, prepareEstimate, type ExportEstimate
} from "../exportPedia";
import { isPermanentPack } from "../packSource";
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

function ExportDialogBody() {
  let languages = exportableLanguages();
  // The language the user is reading is on by default, as they expect it
  let [selected, setSelected] = useState<string[]>(() =>
    state.lang && state.lang != "en-US" && languages.includes(state.lang) ? [state.lang] : []);
  let [archive, setArchive] = useState(false);
  let [busy, setBusy] = useState(false);
  let [status, setStatus] = useState<string>();
  let [progress, setProgress] = useState<number>();
  let [error, setError] = useState<string>();
  // Measured once when the dialog opens: the shell and one gzip are the slow
  // parts, and every later selection only adds their stored sizes up
  let [estimate, setEstimate] = useState<ExportEstimate>();

  let pack = state.packName;

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
    if (!pack || isPermanentPack(pack))
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
  let pending = estimatePending(estimate, selected, archive);
  useEffect(() => {
    if (!estimate || !pending) {
      setTicking(false);
      return;
    }
    let live = true;
    setTicking(true);
    (async () => {
      await measureLanguages(estimate, selected);
      if (archive)
        await measureArchive(estimate, pack!);
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

  let permanent = isPermanentPack(pack);
  let name = exportedPackName(pack);

  function close() {
    if (busy)
      return;
    update({ showExportDialog: false });
  }

  function toggle(lang: string) {
    setSelected(selected.includes(lang)
      ? selected.filter(n => n != lang)
      : [...selected, lang]);
  }

  async function run() {
    setBusy(true);
    setError(undefined);
    setStatus("Preparing...");
    setProgress(0);
    try {
      let result = await exportPedia({
        languages: selected, archive,
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

      {permanent
        ? <>
          <p className="export-note">
            This pedia is already an exported file, so there is nothing left to export.
          </p>
          <div className="export-buttons">
            <button onClick={close}><Tr text="OK" /></button>
          </div>
        </>
        : <>
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
              <button onClick={() => setSelected([...languages])}><Tr text="Select all" /></button>
              <button onClick={() => setSelected([])}><Tr text="Unselect all" /></button>
              {/* The language the user reads is the one they usually export; when
                  that is English there is nothing extra to pick */}
              <button onClick={() => setSelected(state.lang && languages.includes(state.lang) ? [state.lang] : [])}>
                <Tr text="Select current" />
              </button>
            </div>
          }

          <h4><Tr text="Format" /></h4>
          <label className="export-format">
            <input type="radio" checked={!archive} onChange={() => setArchive(false)} />
            <span>
              <b>Single HTML file</b><br />
              <small>
                Images are read from the game's <code>user/mods</code> folder next to
                the file, so the file stays small.
              </small>
            </span>
          </label>
          <label className="export-format">
            <input type="radio" checked={archive} onChange={() => setArchive(true)} />
            <span>
              <b>Archive with images</b><br />
              <small>
                A ZIP with the HTML file and every image it uses, so the game is not
                needed at all.
              </small>
            </span>
          </label>

          {/* Cheap enough to recompute on every render: the measuring is what
              costs, and it happened when the dialog opened or when the
              checkboxes changed */}
          <p className={"export-size" + (estimate && !ticking ? "" : " export-size-pending")}>
            {estimate && !ticking
              ? <>Estimated file size: <b>{asMB(estimateSize(estimate, selected, archive))}</b></>
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
        </>
      }
    </div>
  </div>;
}
