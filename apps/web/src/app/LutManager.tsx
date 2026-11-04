import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '../export/settings';
import { lutUsage, MAX_LUT_NAME_LENGTH, storedLutBytes } from '../lib/luts';
import type { ProjectLut } from '../project/document';
import { removeLuts, removeUnusedLuts, renameLut, useEditor } from '../store/editor';

/**
 * The project's LUTs: rename them, see which are in use, and remove the ones
 * no clip uses (they're saved in the project, so unused ones only take space).
 */
export function LutManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="export-dialog lut-dialog"
      aria-labelledby="luts-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && <LutList onClose={onClose} />}
    </dialog>
  );
}

function LutList({ onClose }: { onClose: () => void }) {
  const luts = useEditor((s) => s.luts);
  const timeline = useEditor((s) => s.timeline);
  const usage = lutUsage(timeline);
  const list = Object.values(luts).sort((a, b) => a.name.localeCompare(b.name));
  const unused = list.filter((l) => !usage.has(l.id)).length;
  const bytes = list.reduce((sum, l) => sum + storedLutBytes(l.data), 0);

  return (
    <div className="export-body">
      <h2 id="luts-title">LUTs in this project</h2>
      <p className="muted">
        {list.length === 0
          ? 'No LUTs yet: load a .cube file from the Color section.'
          : `${list.length} LUT${list.length === 1 ? '' : 's'}, ${formatBytes(bytes)}, saved with the project.`}
      </p>
      {list.length > 0 && (
        <ul className="lut-list" aria-label="Project LUTs">
          {list.map((lut) => (
            <LutRow key={lut.id} lut={lut} uses={usage.get(lut.id) ?? 0} />
          ))}
        </ul>
      )}
      <div className="export-actions">
        <button onClick={() => removeUnusedLuts()} disabled={unused === 0}>
          Remove unused{unused > 0 ? ` (${unused})` : ''}
        </button>
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function LutRow({ lut, uses }: { lut: ProjectLut; uses: number }) {
  const [name, setName] = useState(lut.name);
  // Follow renames made elsewhere (reset during render, keyed on the stored name).
  const [synced, setSynced] = useState(lut.name);
  if (synced !== lut.name) {
    setSynced(lut.name);
    setName(lut.name);
  }
  const commit = () => {
    renameLut(lut.id, name);
    setName(useEditor.getState().luts[lut.id]?.name ?? lut.name); // shows the tidied name
  };

  return (
    <li className="lut-row">
      <input
        aria-label={`Name of LUT ${lut.name}`}
        value={name}
        maxLength={MAX_LUT_NAME_LENGTH}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <span className="muted">
        {lut.size}-point · {uses === 0 ? 'unused' : `used by ${uses} clip${uses === 1 ? '' : 's'}`}
      </span>
      <button
        onClick={() => removeLuts([lut.id])}
        disabled={uses > 0}
        title={uses > 0 ? 'Remove it from the clips that use it first' : undefined}
        aria-label={`Remove ${lut.name}`}
      >
        Remove
      </button>
    </li>
  );
}
