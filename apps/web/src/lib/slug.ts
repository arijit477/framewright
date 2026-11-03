/**
 * A safe, readable file-name stem: drops a file extension, accents and
 * anything but letters, digits, spaces and dashes; lower-case, dash-separated.
 * Returns `fallback` if nothing usable is left.
 */
export function slugify(text: string, fallback: string, maxLength = 60): string {
  return (
    text
      .replace(/\.[a-z0-9]{1,5}$/i, '') // drop a file extension
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .toLowerCase()
      .slice(0, maxLength)
      .replace(/^-+|-+$/g, '') || fallback
  );
}
