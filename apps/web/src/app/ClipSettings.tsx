import { useState } from 'react';
import { MAX_VOLUME_PERCENT, type Clip } from '../engine/types';
import { allSame } from '../lib/collections';
import { setClipsSpeed, setClipsVolume, toggleMuteClips } from '../store/editor';
import { Slider } from './TransformInspector';

/** Speeds offered in the menu (percent). Any 25–400 is valid in a project. */
const SPEEDS = [25, 50, 75, 100, 125, 150, 200, 300, 400];

/**
 * Speed, volume and mute of the selected media clips (the last one is the
 * main clip, whose values are shown where they differ): the first section of
 * the clip panel.
 */
export function ClipSettings({ clips }: { clips: readonly Clip[] }) {
  const main = clips.at(-1)!;
  const ids = clips.map((c) => c.id);
  const speed = (c: Clip) => c.speedPercent ?? 100;
  const mixedSpeed = !allSame(clips, speed);
  const current = speed(main);
  const options = SPEEDS.includes(current) ? SPEEDS : [...SPEEDS, current].sort((a, b) => a - b);
  return (
    <section className="inspector-section" aria-label="Speed and volume">
      <h2>{clips.length === 1 ? 'Clip' : `Clip (${clips.length} clips)`}</h2>
      <label className="field" title="Playback speed (the pitch of the sound is kept)">
        Speed
        <select
          aria-label="Speed"
          value={mixedSpeed ? '' : current}
          onChange={(e) => setClipsSpeed(ids, Number(e.target.value))}
        >
          {mixedSpeed && (
            <option value="" disabled>
              Mixed
            </option>
          )}
          {options.map((percent) => (
            <option key={percent} value={percent}>
              {percent / 100}×
            </option>
          ))}
        </select>
      </label>
      {/* Remount when the clips or committed values change, so the draft resets. */}
      <Volume key={clips.map((c) => `${c.id}:${c.volumePercent}`).join()} clips={clips} />
    </section>
  );
}

function Volume({ clips }: { clips: readonly Clip[] }) {
  const main = clips.at(-1)!;
  const ids = clips.map((c) => c.id);
  const [draft, setDraft] = useState(main.volumePercent);
  const [touched, setTouched] = useState(false);
  const mixed = !touched && !allSame(clips, (c) => c.volumePercent);
  // Commit once when the user lets go, so a drag is one undo step.
  const commit = () => {
    if (touched && (mixed || clips.some((c) => c.volumePercent !== draft))) {
      setClipsVolume(ids, draft);
    }
  };
  const allMuted = clips.every((c) => c.muted);
  const someMuted = clips.some((c) => c.muted);
  return (
    <>
      <Slider
        label="Volume"
        unit="%"
        value={draft}
        min={0}
        max={MAX_VOLUME_PERCENT}
        mixed={mixed}
        disabled={allMuted}
        onChange={(v) => {
          setTouched(true);
          setDraft(v);
        }}
        onCommit={commit}
      />
      <button
        onClick={() => toggleMuteClips(ids)}
        aria-pressed={allMuted ? true : someMuted ? 'mixed' : false}
        title="Mute (M)"
        className={allMuted ? 'active' : ''}
      >
        {allMuted ? 'Unmute' : 'Mute'}
      </button>
    </>
  );
}
