# Roadmap

Each phase ends with a tagged release, a demo GIF in the README, and measured performance
numbers. Tick items off in PRs; bigger items get a GitHub issue.

## Phase 0: Foundation ✅ (v0.0.1)

- [x] Monorepo: Rust engine crate + Vite/React/TS web app, pnpm workspaces
- [x] Timeline engine in Rust: tracks, clips, add/move/trim/split/remove, `resolve(t)`, JSON
- [x] Unit tests for every edit invariant (Rust) and timeline geometry/timecode (Vitest)
- [x] Render worker with OffscreenCanvas; WebCodecs decoding through mediabunny
- [x] WebGPU compositor (zero-copy external textures) with self-test and Canvas 2D fallback
- [x] Canvas timeline: scrub, select, drag to move, edge trimming, snapping, zoom, scroll
- [x] Playback, frame stepping, split, delete, undo/redo, keyboard shortcuts, drag-and-drop import
- [x] Cross-origin isolation headers; CI (fmt, clippy, tests, lint, typecheck, build)
- [x] Architecture docs, ADRs, contributing guide, issue/PR templates

## Phase 1: Usable MVP (v0.1.0)

- [x] **Audio**: decode, AudioWorklet mixer, waveform drawing, per-clip volume and mute
- [x] **Audio master clock** for A/V sync during playback
- [x] Audio-only files (MP3, WAV, M4A, OGG, FLAC) on an audio track; output level meter
- [ ] Short fades at clip edges to avoid clicks on hard cuts
- [ ] Higher-quality resampling for export (windowed sinc)
- [x] **Export** to MP4 (H.264 + AAC/Opus) and WebM (VP9/Opus): 480p–4K, 24–60 fps, progress, ETA, cancel
- [x] Stream exports straight to disk (Save dialog on Chrome/Edge, browser storage elsewhere)
- [ ] Export benchmark vs FFmpeg.wasm in the README
- [ ] WebGPU compositing for export (currently Canvas 2D; see ADR 0006)
- [x] Multiple video tracks: drag clips between tracks or onto a new track; empty tracks removed automatically
- [x] Same file on several tracks decodes smoothly (decoder per file and track)
- [x] Screen-reader description of the timeline (tracks and clips as text)
- [x] Clip thumbnails on the timeline (filmstrip generated in a dedicated worker)
- [ ] Cache thumbnails in project storage so reloads don't regenerate them
- [ ] Finer thumbnail levels when zoomed far in
- [x] Save/load projects (OPFS); autosave; relink missing media
- [x] Projects dialog: new, open, rename, delete; one tab per project (Web Locks)
- [x] Project backups (`.framewright` = standard ZIP with media): download, import, drag-and-drop
- [ ] Undo history that survives a reload
- [ ] Image clips (PNG/JPG) with a default duration
- [x] Playwright end-to-end tests in CI with generated fixtures, exports validated by ffprobe
- [ ] Deploy to Vercel; live demo link in README

## Phase 2: Real editing (v0.2.0)

- [x] Text layers: font, size, colour, box, bold/italic, alignment, position, fade/slide/pop in and out
- [ ] Custom fonts (bundled web fonts available to the export worker)
- [x] Drag text directly on the preview to position it
- [x] Transform: position, scale, rotation, opacity; picture-in-picture presets; drag on the preview
- [x] Keyframes for transforms (animate position, scale, rotation, opacity; easing)
- [ ] Drag keyframes on the timeline; per-property keyframes; keyframed text
- [ ] Resize and rotate handles on the preview
- [x] Transitions: crossfade, dip, slide, wipe (centred on the cut, both renderers)
- [x] Audio crossfades under video transitions (equal power; dips fade to the cut)
- [x] Filters: brightness, contrast, saturation and one-click looks (all renderers)
- [x] LUTs: load `.cube` files, per-clip intensity, saved with the project
- [x] Temperature and tint (white balance), with Warm and Cool looks
- [x] Managing project LUTs: rename, see usage, remove unused
- [ ] Plugin API for effects
- [x] Speed control (0.25×–4×) with audio pitch preservation
- [ ] Speed ramps, reverse playback
- [x] Ripple editing: delete, trim and speed changes close or open space on the track
- [ ] Sync-lock (ripple linked clips on other tracks), close a selected gap
- [x] Multi-select (Ctrl/⌘/Shift-click, Ctrl/⌘+A), group move and delete, copy/cut/paste
- [x] Selection box (drag on empty track space)
- [x] Duplicate (Ctrl/⌘+D), inserting when ripple editing is on
- [x] Editing several clips at once (speed, volume, mute, colour), with mixed values shown
- [x] Keyboard selection of clips (Tab into the timeline; arrows, Home/End, Shift, Escape)
- [x] Keyboard moving and trimming of clips (Alt+arrows, `[`/`]`, `,`/`.`)
- [ ] Transforms for several clips
- [ ] Proxy media for 4K sources

## Phase 3: Smart features (v0.3.0)

- [ ] Auto-captions with local Whisper (WebGPU), word highlighting, SRT export
- [ ] Silence detection and one-click removal
- [ ] Aspect-ratio presets (9:16, 1:1, 16:9) with smart reframing
- [ ] Background removal (segmentation model, permissive licence only)
- [ ] Templates

## Phase 4: Desktop and polish (v1.0.0)

- [ ] Tauri 2 desktop app reusing the UI; native engine; `wgpu` renderer
- [ ] Native FFmpeg (LGPL build) for ProRes and other codecs browsers lack
- [ ] Accessibility pass (keyboard-only editing, screen-reader labels)
- [ ] Docs site with contributor guides for writing effects

## Performance budget (tracked from Phase 1)

| Metric                                       | Target                                |
| -------------------------------------------- | ------------------------------------- |
| Scrub latency (1080p H.264, hardware decode) | < 50 ms                               |
| Playback                                     | 60 fps with 2 video layers at 1080p   |
| Export 60 s of 1080p                         | < 15 s on a mid-range laptop          |
| Initial JS (gzip)                            | < 150 kB, excluding the render worker |
