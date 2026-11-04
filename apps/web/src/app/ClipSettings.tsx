import { useState } from 'react';
import { MAX_VOLUME_PERCENT, type Clip } from '../engine/types';
import { setClipSpeed, setClipVolume, toggleMute } from '../store/editor';
import { Slider } from './TransformInspector';

/** Speeds offered in the menu (percent). Any 25–400 is valid in a project. */
const SPEEDS = [25, 50, 75, 100, 125, 150, 200, 300, 400];

/** Speed, volume and mute of a media clip: the first section of the clip panel. */
export function ClipSettings({ clip }: { clip: Clip }) {
  const current = clip.speedPercent ?? 100;
  const options = SPEEDS.includes(current) ? SPEEDS : [...SPEEDS, current].sort((a, b) => a - b);
  return (
    <section className="inspector-section" aria-label="Speed and volume">
      <h2>Clip</h2>
      <label className="field" title="Playback speed (the pitch of the sound is kept)">
        Speed
        <select
          aria-label="Speed"
          value={current}
          onChange={(e) => setClipSpeed(clip.id, Number(e.target.value))}
        >
          {options.map((percent) => (
            <option key={percent} value={percent}>
              {percent / 100}×
            </option>
          ))}
        </select>
      </label>
      {/* Remount per clip (and per committed value) so the draft resets. */}
      <Volume key={`${clip.id}:${clip.volumePercent}`} clip={clip} />
    </section>
  );
}

function Volume({ clip }: { clip: Clip }) {
  const [draft, setDraft] = useState(clip.volumePercent);
  // Commit once when the user lets go, so a drag is one undo step.
  const commit = () => {
    if (draft !== clip.volumePercent) setClipVolume(clip.id, draft);
  };
  return (
    <>
      <Slider
        label="Volume"
        unit="%"
        value={draft}
        min={0}
        max={MAX_VOLUME_PERCENT}
        disabled={clip.muted}
        onChange={setDraft}
        onCommit={commit}
      />
      <button
        onClick={() => toggleMute(clip.id)}
        aria-pressed={clip.muted}
        title="Mute clip (M)"
        className={clip.muted ? 'active' : ''}
      >
        {clip.muted ? 'Unmute' : 'Mute'}
      </button>
    </>
  );
}
