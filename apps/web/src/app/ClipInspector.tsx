import { selectedClip, useEditor } from '../store/editor';
import { ClipSettings } from './ClipSettings';
import { TextInspector } from './TextInspector';
import { TransformInspector } from './TransformInspector';

/**
 * The panel for the selected clip: text style for titles; speed and volume
 * for media clips, plus transform and colour when they have a picture.
 */
export function ClipInspector() {
  const clip = useEditor(selectedClip);
  const hasVideo = useEditor((s) => (clip ? (s.assets[clip.assetId]?.hasVideo ?? false) : false));
  if (!clip) return null;
  if (clip.text) return <TextInspector />;
  return (
    <aside key={clip.id} className="inspector" aria-label="Clip settings">
      <ClipSettings clip={clip} />
      {hasVideo && <TransformInspector clip={clip} />}
    </aside>
  );
}
