# 0003: Decode and encode with WebCodecs; demux and mux with mediabunny

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

We need to read common containers (MP4, MOV, WebM, MKV), decode quickly, and later encode
for export, all in the browser, while staying MIT-licensed.

## Decision

- Use **WebCodecs** (`VideoDecoder`/`VideoEncoder`/`AudioDecoder`/`AudioEncoder`) for
  codecs. The browser uses hardware acceleration where it exists.
- Use **mediabunny** (pure TypeScript, MPL-2.0) for container parsing and writing. Its
  `VideoSampleSink` wraps WebCodecs with efficient seeking and sequential iteration.

## Consequences

- Decode and encode are typically several times faster than FFmpeg.wasm, with no large
  WASM download.
- Codec support depends on the browser (for example, no ProRes). We check
  `track.canDecode()` on import and show a clear error. The desktop build can add native
  FFmpeg (LGPL) for the gaps.
- No GPL code in the bundle.

## Alternatives considered

- **FFmpeg.wasm:** universal codec support, but CPU-only, slow, a ~30 MB download, and its
  default build is GPL.
- **mp4box.js + hand-written WebCodecs plumbing:** viable, but MP4-only for demuxing and a lot
  more code to maintain.
