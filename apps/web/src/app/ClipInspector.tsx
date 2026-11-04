import { useShallow } from 'zustand/react/shallow';
import type { Clip } from '../engine/types';
import { useEditor, type EditorState } from '../store/editor';
import { ClipSettings } from './ClipSettings';
import { ColorField } from './ColorField';
import { TextInspector } from './TextInspector';
import { TransformInspector } from './TransformInspector';

/** The selected clips, with the main one (the panel's clip) last. */
function selectedClips(s: EditorState): Clip[] {
  const wanted = new Set(s.selectedClipIds);
  const clips = s.timeline.tracks.flatMap((t) => t.clips.filter((c) => wanted.has(c.id)));
  return [
    ...clips.filter((c) => c.id !== s.selectedClipId),
    ...clips.filter((c) => c.id === s.selectedClipId),
  ];
}

/**
 * The panel for the selection. One clip: text style for a title; speed,
 * volume, transform and colour for media. Several clips: the settings they
 * share (speed, volume, mute and colour), applied to all of them at once.
 */
export function ClipInspector() {
  const clips = useEditor(useShallow(selectedClips));
  const hasVideo = useEditor(
    useShallow((s) => clips.map((c) => s.assets[c.assetId]?.hasVideo ?? false)),
  );
  if (clips.length === 0) return null;
  const media = clips.filter((c) => !c.text);
  const video = clips.filter((c, i) => !c.text && hasVideo[i]);

  if (clips.length === 1) {
    const clip = clips[0]!;
    if (clip.text) return <TextInspector />;
    return (
      <aside key={clip.id} className="inspector" aria-label="Clip settings">
        <ClipSettings clips={[clip]} />
        {hasVideo[0] && <TransformInspector clip={clip} />}
        {hasVideo[0] && <ColorField clips={[clip]} />}
      </aside>
    );
  }

  const titles = clips.length - media.length;
  return (
    <aside className="inspector" aria-label="Clip settings">
      <p className="muted inspector-tip">
        {clips.length} clips selected
        {titles > 0 &&
          media.length > 0 &&
          ` (${titles} title${titles === 1 ? '' : 's'} not affected)`}
        . Changes apply to all of them. Select a single clip for its transform, keyframes,
        transition{titles > 0 ? ' or text' : ''}.
      </p>
      {media.length > 0 && <ClipSettings clips={media} />}
      {video.length > 0 && <ColorField clips={video} />}
    </aside>
  );
}
