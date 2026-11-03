# Framewright

**A fast, open-source video editor that runs entirely in your browser.**

Framewright decodes with your device's hardware video decoder (WebCodecs), composites on the
GPU (WebGPU), and keeps the timeline engine in Rust compiled to WebAssembly. Your media never
leaves your machine.

> Status: **early development (Phase 0 complete)**. See the [roadmap](docs/ROADMAP.md).

<!-- TODO: replace with a demo GIF and live link once deployed -->

## Features

- Import video (MP4, WebM, MOV, MKV) and audio (MP3, WAV, M4A, OGG, FLAC) by button or drag-and-drop
- Audio playback with mixing, per-clip volume (0–200%) and mute, waveforms and a level meter
- Sample-accurate A/V sync: picture follows the audio clock
- Export to MP4 (H.264) or WebM (VP9) from 480p to 4K at 24–60 fps, rendered faster than real
  time in the background, with progress, ETA and cancel
- Canvas timeline: scrub, drag clips, trim edges, split, delete, snapping, zoom, with video
  thumbnails (filmstrip) on every clip
- Multiple video and audio tracks: drag a clip above the top track for a new layer (B-roll,
  cutaways); higher tracks cover lower ones
- Frame-accurate preview, rendered off the main thread
- Projects saved automatically in the browser, media included; reopen, rename, delete and relink
  missing media
- Backups: download any project as a `.framewright` file (a standard ZIP with your original
  media) and import it in any browser or on another computer
- Undo/redo for every edit
- Keyboard shortcuts: <kbd>Space</kbd> play/pause, <kbd>S</kbd> split,
  <kbd>M</kbd> mute clip, <kbd>Delete</kbd> remove, <kbd>←</kbd>/<kbd>→</kbd> step a frame (<kbd>Shift</kbd> for 10),
  <kbd>Ctrl/⌘</kbd>+<kbd>S</kbd> save, <kbd>Ctrl/⌘</kbd>+<kbd>E</kbd> export, <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd> undo, <kbd>Ctrl/⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo,
  <kbd>Ctrl/⌘</kbd>+scroll to zoom

Coming next: multiple tracks, thumbnails, text, transitions, and local
AI auto-captions.

## Architecture at a glance

```
 UI thread                         Render worker                       GPU
 React + canvas timeline   ──▶     mediabunny demux                ──▶ WebGPU compositor
 Rust/WASM timeline engine         WebCodecs hardware decode           (Canvas 2D fallback)
   resolve(t) → layers     ◀──     latest-request-wins scheduling
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and
[docs/adr](docs/adr) for the reasoning behind key decisions.

## Getting started

**Prerequisites:** Node 22+, pnpm 10+, Rust (stable) and wasm-pack.

```bash
rustup target add wasm32-unknown-unknown
```

```bash
cargo install wasm-pack
```

```bash
pnpm install
```

```bash
pnpm dev
```

Open http://localhost:5173 in Chrome, Edge, Safari 26+ or Firefox.

| Command          | What it does                                               |
| ---------------- | ---------------------------------------------------------- |
| `pnpm dev`       | Builds the engine (debug) and starts the dev server        |
| `pnpm build`     | Optimised engine + production web build in `apps/web/dist` |
| `pnpm test`      | Rust unit tests + Vitest                                   |
| `pnpm test:e2e`  | Browser tests against the production build (needs ffmpeg)  |
| `pnpm lint`      | ESLint + Clippy                                            |
| `pnpm typecheck` | TypeScript                                                 |
| `pnpm format`    | Prettier + rustfmt                                         |

## Project layout

```
crates/engine/      Rust timeline engine (compiled to WASM)
apps/web/           React app: UI, render worker, compositor
docs/               Architecture, roadmap, dependencies, ADRs
.github/            CI, issue and PR templates
```

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) to get started, and look for
issues labelled `good first issue`.

## License

[MIT](LICENSE). Third-party licences are listed in [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md).
