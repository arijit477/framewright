import { FONT_FILES } from './font-files';
import { FontLoader } from './fonts';

/**
 * A loader for the bundled fonts in this thread: a worker's own font set
 * (`self.fonts`), or the document's. Null where neither exists; text then
 * draws in the system fonts of each stack.
 */
export function threadFonts(): FontLoader | null {
  const set =
    (self as unknown as { fonts?: FontFaceSet }).fonts ??
    (typeof document !== 'undefined' ? document.fonts : undefined);
  return set ? new FontLoader(set, FONT_FILES) : null;
}
