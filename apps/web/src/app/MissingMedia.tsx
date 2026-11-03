import { useRef } from 'react';
import { useEditor } from '../store/editor';
import { relinkMissing } from '../store/project';

/** Shown when the project uses media whose data isn't available. */
export function MissingMediaBanner() {
  const input = useRef<HTMLInputElement>(null);
  // Select the stable object; filtering inside the selector would re-render forever.
  const assets = useEditor((s) => s.assets);
  const missing = Object.values(assets).filter((a) => a.missing);
  if (missing.length === 0) return null;

  const names = missing.map((a) => a.name);
  return (
    <div className="banner" role="alert">
      <span>
        {missing.length === 1 ? '1 media file is' : `${missing.length} media files are`} missing:{' '}
        <strong>{names.slice(0, 3).join(', ')}</strong>
        {names.length > 3 ? ` and ${names.length - 3} more` : ''}. Their clips show as black and
        silent.
      </span>
      <button className="primary" onClick={() => input.current?.click()}>
        Relink…
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Choose missing media files"
        onChange={(e) => {
          if (e.target.files) void relinkMissing([...e.target.files]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
