import { useEffect, useRef, useState } from 'react';
import { MAX_VOLUME_PERCENT, type Clip } from '../engine/types';
import { audio, selectedClip, setClipVolume, toggleMute, useEditor } from '../store/editor';

/** Volume and mute for the selected clip. */
export function ClipAudio() {
  const clip = useEditor(selectedClip);
  if (!clip) return null;
  // Remount per clip (and per committed value) so the draft resets.
  return <VolumeControl key={`${clip.id}:${clip.volumePercent}`} clip={clip} />;
}

function VolumeControl({ clip }: { clip: Clip }) {
  const [draft, setDraft] = useState(clip.volumePercent);
  // Commit once when the user lets go, so a drag is one undo step.
  const commit = () => {
    if (draft !== clip.volumePercent) setClipVolume(clip.id, draft);
  };
  return (
    <div className="group clip-audio" aria-label="Clip audio">
      <button
        onClick={() => toggleMute(clip.id)}
        aria-pressed={clip.muted}
        title="Mute clip (M)"
        className={clip.muted ? 'active' : ''}
      >
        {clip.muted ? 'Unmute' : 'Mute'}
      </button>
      <label className="volume">
        Volume
        <input
          type="range"
          min={0}
          max={MAX_VOLUME_PERCENT}
          step={1}
          value={draft}
          disabled={clip.muted}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <span className="volume-value">{draft}%</span>
      </label>
    </div>
  );
}

/** Stereo peak meter, updated outside React for smoothness. */
export function LevelMeter() {
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const playing = useEditor((s) => s.playing);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const [l, r] = audio.levels();
      if (left.current) left.current.style.transform = `scaleX(${Math.min(1, l)})`;
      if (right.current) right.current.style.transform = `scaleX(${Math.min(1, r)})`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  return (
    <div className="meter" title="Output level" aria-hidden="true">
      <div className="meter-bar">
        <div ref={left} className="meter-fill" />
      </div>
      <div className="meter-bar">
        <div ref={right} className="meter-fill" />
      </div>
    </div>
  );
}
