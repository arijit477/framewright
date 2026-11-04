# 0009: Stream exports to disk

- **Status:** Accepted (supersedes the output part of ADR 0006)
- **Date:** 2026-11-04

## Context

Exports were assembled in memory (`BufferTarget`) and handed to the page as one `ArrayBuffer`.
A 10-minute 4K export at high quality is several gigabytes, which can crash the tab, and the
whole file briefly existed twice (in the worker and as a Blob).

## Decision

The export worker writes through an `ExportSink` (`export/sink.ts`) that streams each encoded
chunk to its final position on disk (mediabunny `StreamTarget`, chunked to 16 MiB writes):

1. **`FileSink`:** where `showSaveFilePicker` exists (Chrome, Edge), the Save dialog is shown
   _first_ (it needs the click) and the export streams into the chosen file. Writes go to the
   browser's swap file, so cancelling never leaves a half-written file in place.
2. **`StorageSink`:** elsewhere, the worker writes into OPFS through a synchronous access handle
   (available in workers in every browser with OPFS). The page then offers the file for
   download as a disk-backed `File`, so it is never read into memory.
3. **`MemorySink`:** the original in-memory behaviour, only when OPFS is unavailable (e.g.
   some private-browsing modes).

Streamed MP4s use `fastStart: 'reserve'`, with upper bounds on packet counts (one per video
frame, audio at ~10 ms per packet, plus a 33% margin), so they keep the index at the front of
the file. Partial files are deleted on cancel or error. Stored exports are removed before the
next export, not right after the download starts, so a download that's still reading is never
cut short.

## Consequences

- Memory use during export no longer grows with the output size.
- On Chrome and Edge the file lands where the user chose, with no separate download step.
- Exports kept in browser storage use disk space until the next export.
- The reserved index space is slightly larger than needed (a few KB of padding).
- The native Save dialog can't be automated, so the browser tests replace it with a fake picker
  that returns a real writable file handle, which exercises the same streaming code.

## Alternatives considered

- **Keep `BufferTarget`, warn above a size:** simple, but long exports would still fail.
- **Fragmented MP4 (`fastStart: 'fragmented'`):** streams without size estimates, but is less
  widely supported by players and editors than regular MP4.
- **Stream through a Service Worker download:** no Save dialog needed, but complex,
  browser-specific, and fragile under backpressure.
