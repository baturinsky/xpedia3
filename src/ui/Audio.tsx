import React, { useCallback, useEffect, useState } from 'react';
import { audioExtensions, rul, soundCat } from '../rul/Ruleset';
import { Tr } from './Val';

/**
 * Music and sound references.
 *
 * A pack never stores the audio itself in a form the pedia keeps: the loader
 * drops every `.ogg`, `.wav` and `.cat`, so the exported page has neither the
 * track nor its bytes. What the ruleset does give is enough to name the file,
 * and that is often all a reader wants — a bare slot number tells nothing.
 *
 * So a reference reads as a name, and clicking it opens a small window with the
 * relative path and a player. Playback is best effort: opened from the game
 * root, `SOUND/gmgeo1.ogg` is a real relative path and the browser can fetch it;
 * opened from anywhere else the request fails, and the window says which file to
 * look for instead of pretending to have played it.
 */

/** What the window was opened for */
type AudioTarget = {
  /** The name to show as the window's title */
  title: string;
  /** The id the pack uses, when it differs from the title */
  id?: string;
  /** Paths to try, most likely first, relative to the game root */
  paths: string[];
  /** Where the reader may find the file, for the "not found" note */
  hint?: string;
};

/** The path a music track lives at, for one of its possible extensions */
function trackPath(fileName: string, ext = audioExtensions[0]) {
  return `SOUND/${fileName.toLowerCase()}${ext}`;
}

/**
 * The paths a music track may live at.
 *
 * The engine picks the extension from the player's `preferredMusic`, which is a
 * user setting rather than ruleset data, so the pedia cannot know it. All the
 * ones the engine accepts are offered instead.
 */
export function musicPaths(fileName: string) {
  return audioExtensions.map(ext => trackPath(fileName, ext));
}

/** One shared window, so a list of sounds opens one at a time */
let openAudio: (target: AudioTarget) => void = () => { };

/** Opens the audio window for a track or a sound slot */
export function showAudio(target: AudioTarget) {
  openAudio(target);
}

/** The path of a sound slot, or null when the pack does not replace that slot */
export function soundPath(slot: unknown, field: string, collection?: string) {
  if (slot == null || slot === "" || String(slot) == "-1")
    return null;
  let cat = soundCat(field, collection);
  return rul.sound(Number(slot), cat);
}

/** A clickable audio reference: the name in the page, the detail in the window */
const AudioLink = ({ target, children }: { target: AudioTarget, children: React.ReactNode }) =>
  <button type="button" className="audio-link" title={target.paths[0]}
    onClick={() => showAudio(target)}>
    {children}
  </button>;

/**
 * One music track: the pack's name for it, or the derived file name.
 *
 * A music field holds the id, though older data may hold the whole entry, so the
 * prop takes either.
 */
export const MusicRef = ({ entry }: { entry: string | { id?: string } }) => {
  // A music field holds the id; older data may hold the whole entry
  let id = typeof entry == "string" ? entry : entry?.id;
  if (id == null)
    return null;

  let fileName = rul.musics?.[id]?.fileName ?? id;
  // A pack's language file may name the track. The derived file name is the
  // fallback, and it is what the engine itself would use
  let name = rul.lang[id] ? (rul.tr(id) ?? id) : fileName;

  return <AudioLink target={{
    title: name,
    id: name == id ? undefined : id,
    paths: musicPaths(fileName),
    hint: rul.tr("xpediaAudioMusicHint") ?? undefined
  }}>
    {name}
  </AudioLink>;
};

/**
 * A sound slot field.
 *
 * A slot only has a path when a mod replaced it with `extraSounds`; the rest
 * still live inside the game's `.CAT` archive, which the pedia does not unpack,
 * so those keep their number and say which CAT they belong to.
 */
export const SoundRef = ({ value, field, collection }: {
  value: unknown, field: string, collection?: string
}) => {
  let slots = (Array.isArray(value) ? value : [value]).filter(s => s != null && s !== "");
  // The field name is a ruleset key such as `meleeHitSound`; the page shows the
  // translated label, so the window has to use the same one
  let label = rul.tr(field) ?? field;

  return <>{slots.map((slot, i) => {
    let path = soundPath(slot, field, collection);
    let cat = soundCat(field, collection);
    return <span className="audio-slot" key={i}>
      {i > 0 && <span className="list-divider">&nbsp;· </span>}
      {path
        ? <AudioLink target={{ title: `${label} ${slot}`, paths: [path], hint: rul.tr(cat) ?? cat }}>
          <Tr text={field} />&nbsp;<em className="num">{String(slot)}</em>
        </AudioLink>
        : <>
          <Tr text={field} />&nbsp;<em className="num">{String(slot)}</em>
        </>}
    </span>;
  })}</>;
};

/**
 * The audio window: the path a reference resolves to, and a player to try it.
 *
 * Clicking the path copies it, because the usual outcome is that the browser
 * cannot reach the file and the reader wants to find it themselves.
 */
export function AudioDialog() {
  let [target, setTarget] = useState<AudioTarget>();
  let [status, setStatus] = useState<"idle" | "loading" | "failed" | "ok">("idle");
  let [copied, setCopied] = useState(false);

  openAudio = useCallback((next: AudioTarget) => {
    setTarget(next);
    // The first path is tried as soon as the window opens, so the reader learns
    // straight away whether this page can reach the file
    setStatus("loading");
    setCopied(false);
  }, []);

  // Escape closes the window, as in the other modals
  useEffect(() => {
    if (!target)
      return;
    function onKey(e: KeyboardEvent) {
      if (e.key == "Escape") {
        e.preventDefault();
        setTarget(undefined);
      }
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [!!target]);

  if (!target)
    return null;

  let path = target.paths[0];

  let copy = () => {
    navigator.clipboard?.writeText(path).then(() => {
      setCopied(true);
    }).catch(() => { });
  };

  return <div className="full-screen-centered status-overlay"
    onClick={e => { if (e.target == e.currentTarget) setTarget(undefined); }}>
    <div className="audio-dialog" role="dialog" aria-modal="true" aria-label={target.title}>
      <div className="audio-dialog-title">{target.title}</div>
      {target.id && <div className="audio-dialog-id">{target.id}</div>}

      <div className="audio-dialog-path">
        <code onClick={copy} title={rul.tr("xpediaAudioCopyTip") ?? undefined}>{path}</code>
        <button type="button" onClick={copy}>
          <Tr text={copied ? "xpediaAudioCopied" : "xpediaAudioCopy"} />
        </button>
      </div>

      {/* `metadata` rather than `none`: the player has to make the request to
          know whether the file is there at all, and that answer is the whole
          point of the window. It reads only the header, not the audio. */}
      <audio controls preload="metadata" src={path}
        onLoadedMetadata={() => setStatus("ok")}
        onError={() => setStatus("failed")} />

      {/* A track may be stored under another accepted extension, so those are
          offered before giving up on playback */}
      {status == "failed" && <div className="audio-dialog-missing">
        <Tr text="xpediaAudioNotFound" />
        {target.hint && <span className="audio-dialog-hint"> ({target.hint})</span>}
        {target.paths.length > 1 &&
          <ul className="audio-dialog-paths">
            {target.paths.map(other => <li key={other}><code>{other}</code></li>)}
          </ul>}
      </div>}

      <div className="audio-dialog-note"><Tr text="xpediaAudioNote" /></div>

      <div className="audio-dialog-buttons">
        <button type="button" autoFocus onClick={() => setTarget(undefined)}>
          <Tr text="xpediaClose" />
        </button>
      </div>
    </div>
  </div>;
}
