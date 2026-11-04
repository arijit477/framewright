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
  time in the background, with progress, ETA and cancel; streamed straight to disk, so even long
  4K exports don't need to fit in memory
- Canvas timeline: scrub, drag clips, trim edges, split, delete, snapping, zoom, with video
  thumbnails (filmstrip) on every clip
- Text overlays: titles and captions with font, size, colour, background box, alignment,
  position and fade/slide/pop animations, rendered identically in preview and export
- Transforms: position, scale, rotation and opacity for any video clip, picture-in-picture
  presets, and dragging clips or titles directly on the preview
- Filters: temperature, tint, brightness, contrast and saturation per clip, with one-click looks
  (black & white, warm, cool, moody…), identical in preview and export
- LUTs: load `.cube` looks (from DaVinci Resolve, Premiere and others), with adjustable intensity;
  rename them and remove unused ones
- Speed: 0.25× to 4× per clip, with the sound's pitch preserved
- Ripple editing: delete, trim or change speed and the rest of the track moves up (or along)
- Keyframes: animate a clip's transform (zooms, pans, moving picture-in-picture, fades) with
  easing; keyframes stay with the footage when you trim or split
- Transitions between clips: crossfade, dip, slide and wipe, with adjustable length; the
  sound crossfades along with the picture
- Multiple video and audio tracks: drag a clip above the top track for a new layer (B-roll,
  cutaways); higher tracks cover lower ones
- Frame-accurate preview, rendered off the main thread
- Projects saved automatically in the browser, media included; reopen, rename, delete and relink
  missing media
- Backups: download any project as a `.framewright` file (a standard ZIP with your original
  media) and import it in any browser or on another computer
- Multi-select (Ctrl/⌘-click, Ctrl/⌘+A, or drag a box on empty track space): move or delete
  several clips at once, or change their speed, volume and colour together; copy, cut and paste
  clips at the playhead, or duplicate them in place
- Undo/redo for every edit
- Keyboard shortcuts: <kbd>Space</kbd> play/pause, <kbd>S</kbd> split,
  <kbd>T</kbd> add text, <kbd>M</kbd> mute clip, <kbd>Delete</kbd> remove (<kbd>Shift</kbd>+<kbd>Delete</kbd> closes the gap), <kbd>←</kbd>/<kbd>→</kbd> step a frame (<kbd>Shift</kbd> for 10),
  <kbd>Ctrl/⌘</kbd>+<kbd>S</kbd> save, <kbd>Ctrl/⌘</kbd>+<kbd>E</kbd> export, <kbd>Ctrl/⌘</kbd>+<kbd>C</kbd>/<kbd>X</kbd>/<kbd>V</kbd> copy/cut/paste, <kbd>Ctrl/⌘</kbd>+<kbd>D</kbd> duplicate, <kbd>Ctrl/⌘</kbd>+<kbd>A</kbd> select all, <kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd> undo, <kbd>Ctrl/⌘</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> redo,
  <kbd>Ctrl/⌘</kbd>+scroll to zoom

Coming next: local AI auto-captions, and keyboard selection of clips.

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

## Deployment

The app is a static site. It's deployed on **Vercel** from Git: `main` deploys to production and
pull requests get preview deployments. All settings live in the repo:

- `vercel.json`: install and build commands, output directory, and the required headers
  (cross-origin isolation for `SharedArrayBuffer`, plus caching and security headers).
- `scripts/vercel-install.sh`: installs pinned Rust and wasm-pack on Vercel's build machines, builds the
  optimised WASM engine, then installs JS dependencies.

To deploy your own copy, import the repository in Vercel (**Add New → Project**) and keep the
default settings; `vercel.json` provides the rest. Any static host works if it can send the
`Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers (see
`apps/web/public/_headers` for Netlify and Cloudflare Pages).

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
