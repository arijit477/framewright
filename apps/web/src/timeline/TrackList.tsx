import { clipEnd, clipSpeed } from '../engine/types';
import { visibleKeyframes } from '../lib/keyframes';
import { formatTimecode } from '../lib/time';
import { useEditor } from '../store/editor';
import { trackRows, transitionWindow } from './geometry';

/**
 * The canvas timeline is invisible to screen readers, so this visually hidden
 * list describes the same tracks and clips in text, top row first.
 */
export function TrackList() {
  const timeline = useEditor((s) => s.timeline);
  const assets = useEditor((s) => s.assets);
  const rows = trackRows(timeline);
  const videoCount = rows.filter((t) => t.kind === 'video').length;
  let videoSeen = 0;
  let audioSeen = 0;

  return (
    <ul className="visually-hidden" aria-label="Timeline tracks">
      {rows.map((track) => {
        // Number like other editors: Video 1 is the bottom layer, Audio 1 the first audio track.
        const name =
          track.kind === 'video' ? `Video ${videoCount - videoSeen++}` : `Audio ${++audioSeen}`;
        const clips = track.clips.map((c, i) => {
          const name = c.text ? `text “${c.text.text}”` : (assets[c.assetId]?.name ?? 'clip');
          const transition = transitionWindow(track.clips[i - 1], c)
            ? `${c.transitionIn!.kind} into `
            : '';
          const speed = clipSpeed(c) !== 1 ? ` at ${clipSpeed(c)}× speed` : '';
          const count = visibleKeyframes(c).length;
          const keys = count > 0 ? `, ${count} keyframe${count === 1 ? '' : 's'}` : '';
          return `${transition}${name} from ${formatTimecode(c.start)} to ${formatTimecode(clipEnd(c))}${speed}${keys}`;
        });
        return (
          <li key={track.id} aria-label={name}>
            {name}: {clips.length > 0 ? clips.join('; ') : 'empty'}
          </li>
        );
      })}
    </ul>
  );
}
