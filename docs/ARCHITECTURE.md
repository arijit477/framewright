# Architecture

Framewright is a browser-based, multi-track video editor. This document explains
how it is put together and why. Decisions with real trade-offs are recorded as
ADRs in [`docs/adr`](./adr).

## Goals

1. **Fast**: 60 fps scrubbing and playback on a mid-range laptop at 1080p.
2. **Private**: media never leaves the user's device unless they choose to upload it.
3. **Portable core**: the same engine runs in the browser (WASM) and natively (desktop, later).
4. **Approachable codebase**: clear module boundaries so contributors can add an effect
   without understanding the whole system.

## System overview

```
 Main thread (UI only)                Render worker                         GPU
┌───────────────────────────┐   ┌─────────────────────────────────┐   ┌──────────────┐
│ React UI (toolbar, panels)│   │ Asset registry (mediabunny)     │   │ WebGPU       │
│ Canvas timeline           │   │  demux MP4/WebM/MOV/MKV         │   │  compositing │
│ Zustand store             │   │ FrameReader per asset           │   │  effects     │
│ TimelineEngine (Rust/WASM)│──▶│  WebCodecs hardware decode      │──▶│  (Canvas 2D  │
│  - project model          │   │ Compositor                      │   │   fallback)  │
│  - edits + validation     │◀──│  draws layers bottom→top        │   └──────────────┘
│  - resolve(t) → layers    │   └─────────────────────────────────┘
└───────────────────────────┘
        │                        ┌─────────────────────────────────┐   ┌──────────────┐
        │ audio segments         │ Audio worker                    │   │ AudioWorklet │
        └───────────────────────▶│  decode (WebCodecs) per clip    │──▶│  plays ring  │
                                 │  resample → mix → ring buffer   │   │  buffer; its │
          master clock ◀─────────│  waveform peaks                 │   │  READ index  │
          (SharedArrayBuffer)    └─────────────────────────────────┘   │  is the clock│
                                                                       └──────────────┘
```

### Data flow for one frame

1. The playhead moves (playback tick, scrub, or keyboard step).
2. The store calls `engine.resolve(t)`. The Rust engine binary-searches each track and
   returns the visible **layers**: `{ assetId, sourceTime, trackIndex }`.
3. The layers are posted to the render worker. **Only the newest request is kept**: if the
   worker is busy, older requests are dropped. This makes scrubbing feel instant and lets
   playback skip frames instead of drifting behind.
4. The worker asks each asset's `FrameReader` for the frame at `sourceTime`.
5. The compositor draws the frames into the `OffscreenCanvas`, which the browser displays
   without a copy back to the main thread.

## Modules

| Path                    | Responsibility                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `crates/engine`         | Rust. Project model (tracks, clips), edit operations with invariants, `resolve(t)`, JSON (de)serialisation. No browser APIs outside `wasm.rs`. |
| `apps/web/src/engine`   | Typed TS facade over the WASM bindings, plus TS mirrors of the Rust types.                                                                     |
| `apps/web/src/store`    | Zustand store: UI state, the undo/redo history, playback clock, and editing commands.                                                          |
| `apps/web/src/render`   | Worker protocol, render worker, `FrameReader`, compositors.                                                                                    |
| `apps/web/src/timeline` | Canvas timeline component and pure geometry (hit testing, snapping, time↔pixel).                                                               |
| `apps/web/src/app`      | Top-level layout: preview, toolbar, keyboard shortcuts, drag-and-drop import.                                                                  |
| `apps/web/src/lib`      | Small shared utilities (time/timecode maths).                                                                                                  |

## Key design decisions

### Time is integer microseconds

WebCodecs timestamps are microseconds, and integers don't accumulate float error over long
edits. Frame-based UI operations convert through `framesToMicros(n)` so repeated stepping
never drifts. See [ADR 0001](./adr/0001-time-in-microseconds.md).

### The engine owns the truth, in Rust

All edits go through the engine, which enforces the invariants: no overlaps, a minimum clip
length, and never referencing media outside the source. The UI can't put the project into an
invalid state, and the rules are unit-tested once in Rust. See [ADR 0002](./adr/0002-rust-wasm-engine.md).

### Decode with WebCodecs, not FFmpeg.wasm

WebCodecs uses the device's hardware decoders and is far faster than FFmpeg compiled to
WASM. It also avoids FFmpeg's GPL-licensed encoders, which keeps the project MIT. See
[ADR 0003](./adr/0003-webcodecs-and-mediabunny.md).

### Rendering happens in a worker

Decoding and compositing never block input handling. The preview canvas is transferred to
the worker (`transferControlToOffscreen`), so frames go decoder → GPU → screen with no
main-thread involvement. See [ADR 0004](./adr/0004-render-in-worker.md).

### WebGPU with a verified fallback

On startup the WebGPU compositor draws a known red frame through the production shader and
reads it back. If anything fails (no adapter, a driver that can't import video frames, a
wrong colour), it falls back to Canvas 2D _before_ claiming the canvas, because a canvas with
a `webgpu` context can never switch to `2d`.

### Sequential decoding for playback, seeking for jumps

`FrameReader` keeps one decoder iterator open while time moves forward (playback), and only
restarts it (seeking to the nearest keyframe) on backward or large jumps. Decoders are
expensive to seek and cheap to run forward.

### Undo/redo by snapshots

Each edit pushes the serialised timeline (`engine.save()`) onto a bounded stack. Timelines
are small JSON documents, so this is simple and robust. If projects grow large, it can be
swapped for a command log without touching UI code, because all edits go through `edit()`.

### The timeline is a canvas

DOM-based timelines slow down with thousands of clips and thumbnails. The canvas timeline
draws only the visible range, and all hit testing is pure functions in `geometry.ts`, which
makes it easy to unit-test.

## Audio and the master clock

Audio uses three threads that share memory through `SharedArrayBuffer`s
(`apps/web/src/audio`). See [ADR 0005](./adr/0005-audio-master-clock.md) for the reasoning.

1. **Engine:** `audioSegments(from, to)` returns every audible clip: video clips (their
   embedded audio) and audio-track clips, skipping muted or 0% clips, each with its linear gain.
2. **Audio worker:** keeps one decoder stream per audible clip, resamples each to 48 kHz
   (`Resampler`, linear interpolation with a fractional position carried across chunks), mixes
   them with their gain, and writes 1024-frame chunks into a lock-free ring buffer. It keeps
   about 250 ms buffered, which is enough to absorb decode jitter but short enough that edits
   are heard almost immediately.
3. **AudioWorklet (`ring-player`):** on the real-time audio thread, copies 128 frames per
   render quantum from the ring to the speakers. It never allocates, decodes or posts messages,
   so it can't glitch. It also writes a decaying peak level for the level meter.

**Ring buffer protocol** (`ring-buffer.ts`): the writer owns WRITE and the reader owns READ.
Both only ever increase, so no locks are needed. To flush (seek, edit, stop), the writer
publishes `SKIP_TO` plus a flag and the _reader_ jumps forward. That avoids two threads
writing READ.

**Master clock:** the writer anchors "frame index N = timeline time T" on every start and edit.
The current time is `T + (READ − N) / sampleRate`, minus the output latency. The playback
loop reads this clock on every animation frame and shows the matching video frame. Video
therefore follows audio: if audio underruns, the clock pauses rather than letting picture and
sound drift apart.

**Edits during playback** send new segments; the worker re-anchors at the currently audible
time and re-mixes, so a mute or volume change is heard within about 250 ms.

**Fallbacks:** without cross-origin isolation, or if the audio output never starts (for example,
autoplay is blocked or there's no output device), a watchdog switches to a wall clock after 1 s
and tells the user that playback continues without sound.

**Waveforms:** the audio worker decodes each asset once in the background and stores the peak
amplitude per 10 ms. The timeline draws one bar per pixel on a decibel scale (−48 dB floor), so
quiet recordings stay visible.

## Export

Export renders a **snapshot** of the project in a dedicated worker, using the same building
blocks as the live preview, so the file matches what you saw (`apps/web/src/export`). See
[ADR 0006](./adr/0006-export-pipeline.md).

```
project JSON ─▶ TimelineEngine (own WASM instance in the worker)
                 ├─ resolve(t) per output frame ─▶ FrameReader ─▶ Compositor ─▶ CanvasSource ─┐
                 └─ audioSegments() ─▶ Mixer (4096-frame chunks) ─▶ AudioSampleSource ────────┤
                                                                     mediabunny muxer ◀──────┘
                                                                     ─▶ MP4 / WebM buffer ─▶ download
```

- **Snapshot isolation:** the worker loads its own engine from `engine.save()` JSON. The user can
  keep editing while it renders, and nothing they do can corrupt the export.
- **One worker per export,** terminated when the job ends (done, error or cancel), so decoder and
  encoder memory are always released.
- **Codec selection:** `getFirstEncodableVideoCodec`/`AudioCodec` pick the first codec the
  browser can actually encode at the chosen size and bitrate: H.264 then HEVC/AV1 for MP4,
  VP9 then VP8/AV1 for WebM; AAC then Opus for MP4 audio. If no audio codec works, the
  export is silent and the dialog warns.
- **Timing:** frame _i_ is at `round(i × 10⁶ / fps)` µs, computed from the index; audio is mixed
  up to the end of each video frame, so the muxer interleaves without buffering much.
- **MP4 fast start:** the index (`moov`) is written before the media data, so files start
  playing before they have fully downloaded.
- **Streaming to disk** (`export/sink.ts`, [ADR 0009](./adr/0009-stream-exports-to-disk.md)):
  the encoded file is written chunk by chunk at its final position, so even long 4K exports
  never have to fit in memory:
  - **Chrome and Edge:** the Save dialog comes first, and the export streams into the chosen file
    (`FileSystemWritableFileStream`; a cancel discards the temporary swap file);
  - **other browsers:** it streams into browser storage (OPFS, through a synchronous access handle
    in the worker) and is downloaded from there as a disk-backed `File`;
  - **memory** only as a last resort, for browsers without OPFS.
    Streamed MP4s use `fastStart: 'reserve'` with packet-count upper bounds
    (`maximumPacketCounts`), so they keep the index at the front. Partial files are deleted on
    cancel or error, and stored exports are removed before the next export starts.
- Export composites with Canvas 2D (see ADR 0006 for why).

## Multiple tracks

See [ADR 0008](./adr/0008-track-order-and-lifecycle.md).

- **Order:** the engine composites video tracks with higher indices on top. The timeline shows
  video tracks in reverse (`trackRows()`), so the **top row is the top layer**, as in other
  editors, followed by the audio tracks. Hit testing, drop targets and the accessible track list
  all use this same order.
- **Creating and removing tracks:** dragging a video clip above the top video row (or an audio
  clip below the last audio row) creates a track for it (`dropTarget()`, unit-tested). Moves
  and deletes call `pruneEmptyTracks()` (Rust, tested) in the same edit, which removes empty
  tracks but keeps at least one of each kind. One undo restores both the clip and the track.
- **Atomic edits:** `edit()` restores the snapshot taken before the operation if any step
  throws, so multi-step edits (add track, move clip, prune) can't leave a half-applied
  timeline.
- **Decoding:** `ReaderPool` keeps one decoder per (file, track), created on demand and evicted
  least-recently-used beyond 16. A file visible on two tracks at once (a clip and its own
  B-roll copy) gets two decoders, each moving forward, instead of one seeking back and forth
  every frame. Used by both the preview and the export worker.
- **Scrolling:** the wheel scrolls the track area vertically when tracks overflow the panel
  (the ruler stays fixed); horizontal wheel/trackpad gestures, or Shift+wheel, scroll time.
- **Accessibility:** a visually hidden list (`TrackList.tsx`) describes every track and clip
  with times for screen readers; the browser tests use it too.

## Text overlays

See [ADR 0010](./adr/0010-text-overlays.md).

- **Model (Rust, `text.rs`):** a text clip is an ordinary clip with `text: { text, style }`
  and no media (`assetId` empty, effectively unlimited source length), so moving, trimming,
  splitting, layering and undo all work unchanged. The style is validated by the engine:
  non-empty text up to 500 characters, sizes 12–300, `#rrggbb` colours and `#rrggbbaa` boxes,
  positions 0–1000 and animations up to 3 s. Old projects load unchanged (the field is
  optional).
- **Resolution independence:** sizes are pixels on a 1080p frame and positions are thousandths
  of the frame, so a title is laid out identically at every export resolution.
- **One renderer:** `render/text.ts` lays out and draws text (word wrap at 90% width, alignment
  anchor, background box or legibility shadow, eased fade/slide/pop). The layout and animation
  maths are pure and unit-tested. The engine's `resolve()` returns text layers with the clip's
  local time, and `render/compose.ts` turns layers into draw items for both the preview and
  export workers.
- **WebGPU:** text is drawn onto a transparent canvas and imported as a `VideoFrame`, so it goes
  through the same self-tested pipeline as video. The self-test also draws a transparent
  frame over red and checks the result stays red; if transparency is lost on a device, the app
  falls back to Canvas 2D instead of showing black boxes.
- **Editing:** the inspector commits discrete choices at once and typing or slider drags after
  a pause, so undo steps stay meaningful. No-op edits are ignored by `edit()`. Keyboard
  shortcuts are ignored in any editable field, and undo/redo keep the selected clip when it
  still exists.
- **Fonts:** generic system font stacks, which are available inside workers (and so in
  export). Bundled custom fonts are on the roadmap.

## Transforms and gestures

See [ADR 0011](./adr/0011-transforms-and-gestures.md).

- **Model (Rust, `transform.rs`):** every media clip has a validated `transform` (centre in
  thousandths of the frame, which may go off-frame; scale %; clockwise rotation in degrees;
  opacity %). It's omitted from saved projects when unchanged. Text clips keep their own style
  position (`TransformOnText` is rejected).
- **One placement function:** `render/transform.ts` `layerMatrix()` maps the source frame (a
  unit square) to canvas pixels: fit (letterbox), scale about the centre, rotate, move.
  Canvas 2D applies it with `setTransform`. WebGPU converts it with `toClipSpace()` into an
  8-float uniform (matrix plus opacity) used by the same shader for video, text and the
  self-test. Both functions are unit-tested, so the backends can't disagree, even though CI
  can't run the GPU path.
- **Gestures:** `beginGesture` / `updateGesture` / `endGesture` / `cancelGesture` in the store
  apply changes live, validate each update, and record **one** undo step per drag; Escape or
  a pointer cancel restores the start. Dragging on the preview moves the selected clip (or the
  topmost visible one): titles via their style position, video via the transform.
- **Pending edits:** inspectors debounce typing and slider drags, and register their debouncers
  in `lib/pending-edits.ts`. Save (Ctrl+S, which works even while typing), backup, export and
  page hide/unload flush them first, so a change made a moment ago is never left out.

## Selection and clipboard

See [ADR 0018](./adr/0018-multi-select-and-clipboard.md).

- **Selection (`store/editor.ts`):** `selectedClipIds` (all) and `selectedClipId` (the one the
  panel edits). Ctrl/⌘/Shift-click toggles, Ctrl/⌘+A selects all, and dragging on empty track
  space draws a selection box (`clipsInRect`; additive with a modifier). The ruler scrubs.
- **Engine:** `move_clips` (one time shift for many clips, all or nothing), `copy_clips` /
  `paste_clips` (clips with their tracks, relative times; paste reuses the original tracks if
  there's room, otherwise adds tracks, never overwrites).
- **UI:** dragging a selected clip moves the group (previewed live). Delete, cut, copy, paste
  and duplicate (Ctrl/⌘+D: right after the selection, inserting with `insert_space` when ripple is
  on) work on the selection; pasted and duplicated clips are selected.
- **Editing several clips:** the clip panel edits the selection's shared settings (speed, volume,
  mute, colour). Each change patches only that setting on every clip in one undo step; values that
  differ read "Mixed".

## Auto captions

See [ADR 0021](./adr/0021-auto-captions.md).

- **Worker (`captions/captions.worker.ts`):** mixes the project's sound to 16 kHz mono (the
  shared `Mixer`), skips silent blocks, and runs Whisper with Transformers.js on ONNX Runtime Web
  (the engine is bundled). The model (pinned revisions in `captions/protocol.ts`) downloads from
  Hugging Face once and is cached by the browser. One worker per run, terminated after.
- **Devices ([ADR 0023](./adr/0023-webgpu-captions.md)):** with WebGPU, the encoder runs on the
  graphics card at full precision and the decoder on the processor at 8-bit (`MODEL_FILES`).
  If the GPU fails, the worker reports `fallback` and the client (`captions/client.ts`) restarts
  the run on the processor in a fresh worker.
- **Shaping (`captions/segments.ts`):** timed words become readable captions (two lines of 42
  characters, 0.7–6 s, broken at pauses and sentence ends, no overlaps), each keeping its words'
  times; `captions/srt.ts` writes .srt and .vtt.
- **Word highlighting ([ADR 0022](./adr/0022-word-highlight.md)):** a text clip's `words` are
  times in its source, so edits keep them aligned; `drawText` (`render/text.ts`) draws the word
  being spoken in `style.highlight`, identically in preview and export. Changing the number of
  words in the text drops the timings (`updateText`).
- **Store (`store/captions.ts`):** runs the job, shows progress, and adds the captions as title
  clips on a new top track in one undo step (`addCaptions`).
- **Translation ([ADR 0024](./adr/0024-caption-translation.md)):** `captions/translation.ts` picks
  the OPUS-MT models for a language pair (direct, or through English); `translate.worker.ts` runs
  them over the track's titles, a whole sentence at a time ([ADR 0025](./adr/0025-sentence-level-translation.md):
  `captions/sentences.ts` groups captions into sentences and shares each translation back over
  them); `store/translation.ts` adds the result as a new track (`addTranslatedCaptions`) with the
  same times and style. Both workers share
  `captions/onnx-env.ts`.
- **Bilingual captions ([ADR 0026](./adr/0026-bilingual-captions.md)):** `captions/bilingual.ts`
  restyles the original to sit above a shared line (`anchorY: 'bottom'`) and the translation below
  it (`anchorY: 'top'`), so they never overlap.

## Keyboard access to the timeline

See [ADR 0020](./adr/0020-keyboard-timeline.md). The timeline canvas is a Tab stop: arrow keys,
Home/End and Shift+arrows move or extend the selection between clips (`stepClip`), Escape clears
it, and a live region announces each move. Clicks don't focus it, so for mouse users the arrows
keep stepping frames; keys it handles are marked so the app-wide shortcuts skip them. Anywhere
(not just in the timeline), Alt+arrows nudge the selection by frames (one undo step per Alt press)
or move a clip to another track, `[`/`]` trim to the playhead, and `,`/`.` step frames.

## Ripple editing

See [ADR 0017](./adr/0017-ripple-editing.md).

- **Engine:** `ripple_delete`, `trim_clip_ripple` and `set_clip_speed_ripple` move the later clips
  on the edited track by exactly how far its end moved (`shift_from`). A ripple trim keeps the
  clip's start in place. Each is one validated, undoable edit.
- **UI:** a Ripple toggle in the toolbar (per browser) applies to delete, trim and speed.
  Shift+Delete always ripples. While trimming, `trimPreview` (`timeline/geometry.ts`) draws the
  later clips following the edge.
- Other tracks don't move (no sync-lock yet).

## Speed

See [ADR 0016](./adr/0016-speed-control.md).

- **Model:** `speedPercent` (25–400) on media clips. `duration` is timeline length, covering
  `duration × speed` of media. Changing speed keeps the media and changes the length, and is
  refused if a slower clip would run into the next one.
- **Mapping:** `Clip::source_at` / `to_source` / `to_timeline` in the engine (mirrored by
  `sourceAt` / `timelineAt` in `engine/types.ts` for drawing). Used by layers, keyframes, trims,
  splits and the audio extensions under transitions.
- **Audio:** segments carry `speed`. `SourceStream` time-stretches with WSOLA
  (`audio/time-stretch.ts`) so the pitch is kept, in both playback and export.
- **UI:** a Speed menu in the clip panel's Clip section (with volume and mute). The timeline label
  and track list show the speed.

## Keyframes

See [ADR 0014](./adr/0014-keyframes.md).

- **Model (Rust, `keyframe.rs`):** a media clip may have `keyframes: [{ sourceTime, transform,
easing }]`, sorted, at times in its _source media_, so trims and splits keep the animation on
  the same picture. While there are any, they decide the transform.
- **Resolve:** the clip's transform at a moment is interpolated between the surrounding
  keyframes (eased by the earlier one) and held outside them. `Layer.transform` is fractional,
  so slow moves are smooth; the renderers need no changes. `clipTransformAt` gives the editor the
  same value for the inspector.
- **Editing (`store/editor.ts`, `lib/keyframes.ts`):** once a clip is animated, slider changes and
  preview drags write into the keyframe at the playhead (within half a frame), adding one if
  needed. The panel adds or removes the keyframe at the playhead, steps between keyframes, sets
  easing and removes them all (keeping the current look). The timeline marks keyframes with
  diamonds; the accessible track list counts them.

## Colour adjustments

See [ADR 0015](./adr/0015-colour-adjustments.md).

- **Model (Rust, `color.rs`):** a media clip's
  `color: { brightness, contrast, saturation, temperature, tint }`, each -100 to 100, passed
  through on its layers.
- **Order:** white balance (temperature/tint gains that keep white's brightness), then the LUT,
  then brightness/contrast/saturation, in every renderer.
- **Rendering (`render/color.ts`):** the CSS `brightness() contrast() saturate()` maths in sRGB,
  clamped after each step. Canvas 2D sets `ctx.filter`; the WebGPU shader repeats the steps; a
  JavaScript pixel path covers browsers without canvas filters. `adjustRgb()` is the tested
  reference. The export test compares real exports with it, and the WebGPU self-test checks a
  desaturated pixel.
- **UI:** a Color section in the clip panel with three sliders and one-click looks.

## LUTs

See [ADR 0019](./adr/0019-luts.md).

- **Data:** `.cube` files are parsed in `render/lut.ts` and stored in the project document
  (`luts`, format version 2) at 16-bit precision, outside the timeline (undo snapshots stay
  small). The editor store sends them, decoded, to the render worker, and an export sends the
  ones its clips use.
- **Clips:** `lut: { lutId, intensityPercent }` (engine `LutRef`), applied before the colour
  adjustments.
- **Rendering:** trilinear interpolation everywhere (`applyLutRgb` is the reference). WebGPU
  samples a 3D `rgba16float` texture; Canvas 2D runs `lutPixels`. The WebGPU self-test checks a
  LUT plus desaturation.
- **UI:** in the Color section: pick a project LUT or load a `.cube` file, and set its
  intensity. "Manage LUTs" renames them and removes unused ones (LUTs in use can't be removed; a
  removed LUT comes back if undo or a paste needs it, and the clipboard carries LUTs).

## Transitions

See [ADR 0012](./adr/0012-transitions.md).

- **Model (Rust, `transition.rs`):** a transition belongs to the incoming clip
  (`transitionIn: { kind, durationMs }`) and is **centred on the cut**. It's in effect only
  while the clip touches the one before it on the same track and both are media. If the clips
  are moved apart it's kept but inactive; split halves simply cut together. The length is
  validated (0.1–3 s, no longer than either clip) and clamped at render time if a clip is
  trimmed later.
- **Resolve:** in the window `[cut − D/2, cut + D/2)`, a track contributes both clips (outgoing,
  then incoming), each tagged with the kind, its role and the progress (0–1000). The outgoing
  clip plays on past its out-point and the incoming one starts early; where the file has no
  extra media there, the edge frame is held.
- **Rendering:** `render/transition.ts` turns (kind, role, progress) into an effect (opacity,
  horizontal offset, reveal band), unit-tested, and both compositors apply it: opacity
  multiplies the clip's own, the offset shifts the shared placement matrix, and the reveal
  clips Canvas 2D or sets the WebGPU scissor rectangle (reset after each draw).
- **UI:** a Transition field in the clip panel (style and length) and a marker on the
  timeline at each active transition. The accessible track list names it ("crossfade into …").
- **Audio** crossfades under the same window ([ADR 0013](./adr/0013-audio-crossfades.md)): the
  engine gives each audio segment optional `fadeIn`/`fadeOut` ramps (equal power for crossfade,
  slide and wipe, extending each sound past the cut only as far as its media goes; linear ramps
  to and from the cut for a dip), and the shared mixer applies them per frame, so playback and
  export match.

## Timeline thumbnails

Video clips show a filmstrip (`apps/web/src/thumbnails`):

- A **dedicated thumbnail worker** with its own decoders, so generating thumbnails never competes
  with preview scrubbing. It handles one asset at a time, bounding CPU and memory during big
  imports.
- **Plan** (`strip.ts`, unit-tested): one thumbnail per second of source, at most 240 per asset
  (wider intervals for long media). Each is taken from the middle of the span it represents, at
  72 px tall (about 128×72), which is under 9 MB per asset.
- **Progressive:** a coarse pass (every 8th thumbnail) and then the gaps; each pass is ascending,
  so the decoder only moves forward. mediabunny's `CanvasSink` decodes and scales; results reach
  the main thread as transferable `ImageBitmap`s in batches of about 150 ms.
- **Correctness:** every request carries a job number that the worker echoes, and replies from a
  replaced request (e.g. after relinking) are discarded and their bitmaps closed. Bitmaps are
  GPU resources, so they live in `ThumbnailClient` (not React state) and are closed when an
  asset or project goes away; a `thumbsVersion` counter in the store triggers redraws.
- **Drawing:** tiles are laid from each clip's left edge (stable while scrolling), only the visible
  ones are drawn, and each uses the nearest loaded thumbnail while the strip fills in. Gradients
  keep the name and waveform legible, and the label is pinned to the clip's visible edge.

## Projects and persistence

Projects are stored in the browser's **Origin Private File System** (`apps/web/src/project`,
`apps/web/src/store/project.ts`). See [ADR 0007](./adr/0007-project-storage.md).

```
projects/<projectId>/project.json        versioned document (timeline + media metadata)
projects/<projectId>/media/<assetId>     a copy of every imported file
```

- **Document format** (`document.ts`): `{ format, version, id, name, timestamps, durationUs,
timeline, assets }`. Parsing validates every field. Older versions are upgraded by
  step-by-step migrations; documents from a _newer_ app are refused with a clear message instead
  of being misread. The engine validates the timeline again on load, and a bad project never
  replaces the open one.
- **Autosave** (`save-scheduler.ts`): every edit, undo, import and rename marks the project dirty;
  it's written 800 ms after the last change. Saves never overlap, a change during a save causes one
  more save, and failures show "Couldn't save · Retry". It also saves when the tab is hidden and
  warns on close with unsaved changes. <kbd>Ctrl+S</kbd> saves immediately.
- **Atomic writes:** `createWritable()` writes a temporary file and swaps it in on `close()`, so a
  crash mid-save keeps the previous version.
- **Media copies:** imports are streamed into the project folder in the background. If a copy is
  missing (storage evicted, disk full), its clips stay on the timeline, shown red, black and
  silent, and a banner offers **Relink**, which matches chosen files by name and size.
- **One tab per project:** an exclusive Web Lock is held while a project is open. A second tab
  opens a different project instead of overwriting the first one's work.
- **Safety:** project and asset ids become directory names, so they must match
  `[A-Za-z0-9_-]{1,64}`. Persistent storage is requested on the first save so the browser is less
  likely to evict projects.

### Backups

A backup (`apps/web/src/project/backup.ts`) is a **standard ZIP** with the `.framewright`
extension, so any unzip tool can open it and users never lose access to their media:

```
project.json                         the project document (same format as storage)
README.txt                           what this file is and how to restore it
media/<assetId>/<original file name>  the original media, stored uncompressed
```

- **Writing** streams with `client-zip`, reading media lazily from OPFS. On Chrome and Edge it
  pipes straight into a file chosen with the Save dialog; elsewhere it builds a Blob (which
  browsers back with disk) and downloads it.
- **Reading** uses our own `zip-reader.ts`. It loads only the central directory; media entries
  are `Blob.slice()`s of the backup file, streamed into OPFS without being held in memory. It
  supports stored and deflated entries and ZIP64, checks every offset against the real file
  size, verifies the CRC of `project.json`, and refuses encrypted or unknown entries.
- **Import never overwrites:** a backup becomes a new project with a new id, and a numbered name
  if the name is taken. Media is written first and the document last, so the project only
  appears once complete; any failure removes what was written.
- Media whose size doesn't match the document is treated as damaged and imports as missing
  (relinkable) rather than playing corrupt data.

## Testing strategy

Engine rules are tested in Rust, pure TypeScript logic with Vitest, and user flows with
Playwright against the production build. Exported files are validated independently with
ffprobe/ffmpeg (codec, dimensions, exact frame count, clean decode, audio level). CI runs all
three on every pull request. See [CONTRIBUTING.md](../CONTRIBUTING.md#testing).

## Cross-origin isolation

The app is served with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. That enables `SharedArrayBuffer` (needed for the
audio ring buffer and zero-copy worker messaging in later phases). It is configured for the
Vite dev/preview servers, Vercel (root `vercel.json`) and Netlify/Cloudflare Pages (`public/_headers`).

## Planned subsystems

- **Effects (Phase 2)**: WGSL fragment shaders registered as plugins with a typed parameter
  schema, so the UI can generate controls automatically.
- **Desktop (later)**: Tauri 2 shell with the same React UI, the engine compiled natively, and
  `wgpu` rendering, which runs the same WGSL shaders.
