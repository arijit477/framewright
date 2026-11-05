/**
 * Small ONNX models (face detection, background removal) are downloaded once
 * from their pinned URL and kept in the browser's cache, so later uses work
 * offline.
 */
export async function cachedModel(url: string, what: string): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open('framewright-models');
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch {
    // No cache storage (e.g. private browsing): download each time.
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The ${what} couldn’t be downloaded (${response.status}).`);
  if (cache) await cache.put(url, response.clone()).catch(() => {});
  return await response.arrayBuffer();
}
