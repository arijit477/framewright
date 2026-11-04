import { clipEnd, clipSpeed } from '../engine/types';
import { visibleKeyframes } from '../lib/keyframes';
import { formatTimecode } from '../lib/time';
import { useEditor } from '../store/editor';
import { trackNames, trackRows, transitionWindow } from './geometry';

/**
 * The canvas timeline is invisible to screen readers, so this visually hidden
 * list describes the same tracks and clips in text, top row first.
 */
export function TrackList() {
  const timeline = useEditor((s) => s.timeline);
  const assets = useEditor((s) => s.assets);
  const selected = useEditor((s) => s.selectedClipIds);
  const rows = trackRows(timeline);
  const names = trackNames(timeline);

  return (
    <ul className="visually-hidden" aria-label="Timeline tracks">
      {rows.map((track) => {
        const name = names.get(track.id)!;
        const clips = track.clips.map((c, i) => {
          const name = c.text ? `text “${c.text.text}”` : (assets[c.assetId]?.name ?? 'clip');
          const transition = transitionWindow(track.clips[i - 1], c)
            ? `${c.transitionIn!.kind} into `
            : '';
          const speed = clipSpeed(c) !== 1 ? ` at ${clipSpeed(c)}× speed` : '';
          const count = visibleKeyframes(c).length;
          const keys = count > 0 ? `, ${count} keyframe${count === 1 ? '' : 's'}` : '';
          return `${transition}${name} from ${formatTimecode(c.start)} to ${formatTimecode(clipEnd(c))}${speed}${keys}${selected.includes(c.id) ? ' (selected)' : ''}`;
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
