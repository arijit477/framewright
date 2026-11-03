# Dependencies

Every runtime dependency must have a licence compatible with MIT. **No GPL code ships in
the app.** Check this table before adding a package, and add a row in the same PR.

## Runtime (shipped to users)

| Package              | Version   | Licence | Why                                                                                                                                                                            |
| -------------------- | --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `react`, `react-dom` | 19.3      | MIT     | UI framework. Familiar to contributors; the hot paths (timeline, preview) bypass React and draw on canvases.                                                                   |
| `zustand`            | 5.0       | MIT     | Small store that can be read and subscribed to outside React (playback loop, canvas timeline) without re-rendering.                                                            |
| `mediabunny`         | 1.65      | MPL-2.0 | Pure-TS demuxing/muxing for MP4, WebM, MOV and MKV, and a WebCodecs-backed decoder API. MPL-2.0 is file-level copyleft: using it unmodified places no obligations on our code. |
| `client-zip`         | 2.5       | MIT     | Streams project backups as ZIP (with ZIP64 for files over 4 GB) without holding them in memory. Writing only; reading uses our own `zip-reader.ts`.                            |
| `framewright-engine` | workspace | MIT     | Our Rust engine, compiled to WASM.                                                                                                                                             |

### Rust crates (`crates/engine`)

| Crate                                       | Licence        | Why                                                                  |
| ------------------------------------------- | -------------- | -------------------------------------------------------------------- |
| `wasm-bindgen`                              | MIT/Apache-2.0 | JS ↔ Rust bindings.                                                  |
| `serde`, `serde_json`, `serde-wasm-bindgen` | MIT/Apache-2.0 | Project (de)serialisation; passing snapshots to JS as plain objects. |
| `thiserror`                                 | MIT/Apache-2.0 | Typed edit errors.                                                   |

## Development only

| Package                                                                                       | Why                                                                               |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `vite` 8                                                                                      | Dev server and bundler; native worker and WASM URL handling.                      |
| `typescript` 6.0                                                                              | Type checking. Pinned to 6.0 because `typescript-eslint` doesn't support 7.x yet. |
| `@playwright/test` 1.63 (pinned exactly)                                                      | Browser end-to-end tests. Pinned so the test runner and CI browser always match.  |
| `vitest` 5                                                                                    | Unit tests (shares the Vite config).                                              |
| `eslint` 10 + `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` | Linting.                                                                          |
| `prettier` 3                                                                                  | Formatting.                                                                       |
| `@webgpu/types`                                                                               | WebGPU type definitions.                                                          |
| `wasm-pack` (cargo install)                                                                   | Builds the engine to WASM and generates TS bindings.                              |
| `pretty_assertions` (Rust)                                                                    | Readable test diffs.                                                              |

## Platform APIs used

| API                       | Used for                                         | Support                                                                        |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| WebCodecs                 | Hardware video/audio decode and (Phase 1) encode | Chrome/Edge 94+, Safari 16.4+ (video), Firefox 130+                            |
| WebGPU                    | Compositing and effects                          | Chrome/Edge 113+, Safari 26+, Firefox 141+ (Windows). Falls back to Canvas 2D. |
| OffscreenCanvas + Workers | Rendering off the main thread                    | All modern browsers                                                            |
| SharedArrayBuffer         | Audio ring buffer, zero-copy messaging (Phase 1) | Requires cross-origin isolation headers                                        |
| OPFS                      | Project storage and caches (Phase 1)             | All modern browsers                                                            |

## Deliberately not used

| Option                       | Reason                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| FFmpeg.wasm (default build)  | CPU-only and slow; its default build includes GPL x264, which would make the whole app GPL. |
| Electron                     | Large download and memory footprint. The desktop build will use Tauri.                      |
| A DOM-based timeline library | Doesn't scale to thousands of clips; we need full control over drawing and hit testing.     |
