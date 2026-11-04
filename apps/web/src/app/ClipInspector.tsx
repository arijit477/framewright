import { selectedClip, useEditor } from '../store/editor';
import { TextInspector } from './TextInspector';
import { TransformInspector } from './TransformInspector';

/** The panel for the selected clip: text style for titles, transform for video. */
export function ClipInspector() {
  const clip = useEditor(selectedClip);
  const hasVideo = useEditor((s) => (clip ? (s.assets[clip.assetId]?.hasVideo ?? false) : false));
  if (!clip) return null;
  if (clip.text) return <TextInspector />;
  if (hasVideo) return <TransformInspector key={clip.id} clip={clip} />;
  return null;
}
