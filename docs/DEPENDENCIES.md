# Dependencies

Every runtime dependency must have a licence compatible with MIT. **No GPL code ships in
the app.** Check this table before adding a package, and add a row in the same PR.

## Runtime (shipped to users)

| Package                     | Version                                          | Licence    | Why                                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `react`, `react-dom`        | 19.3                                             | MIT        | UI framework. Familiar to contributors; the hot paths (timeline, preview) bypass React and draw on canvases.                                                                                                                               |
| `zustand`                   | 5.0                                              | MIT        | Small store that can be read and subscribed to outside React (playback loop, canvas timeline) without re-rendering.                                                                                                                        |
| `mediabunny`                | 1.65                                             | MPL-2.0    | Pure-TS demuxing/muxing for MP4, WebM, MOV and MKV, and a WebCodecs-backed decoder API. MPL-2.0 is file-level copyleft: using it unmodified places no obligations on our code.                                                             |
| `client-zip`                | 2.5                                              | MIT        | Streams project backups as ZIP (with ZIP64 for files over 4 GB) without holding them in memory. Writing only; reading uses our own `zip-reader.ts`.                                                                                        |
| `framewright-engine`        | workspace                                        | MIT        | Our Rust engine, compiled to WASM.                                                                                                                                                                                                         |
| `@huggingface/transformers` | 4.3                                              | Apache-2.0 | Runs the Whisper speech model in the browser for auto captions. Loaded only in the captions worker. Its Node-only dependencies (`sharp`, `onnxruntime-node`) are installed but never bundled, and their install scripts don't run.         |
| `onnxruntime-web`           | 1.31.0-dev (pinned to what Transformers.js uses) | MIT        | The engine that executes the model, on the processor (WebAssembly) or the graphics card (WebGPU), from its `asyncify` build. A direct dependency only so the app bundles its engine files instead of fetching them from a CDN at run time. |

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

## Models and data downloaded at run time

| What                                                                                                                                                                                                                                                                                                | Licence                                                                                                                                                                                                                                            | When                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whisper speech models, `onnx-community/whisper-tiny_timestamped` and `onnx-community/whisper-base_timestamped` (ONNX conversions of OpenAI's Whisper with word-timestamp alignment heads: 8-bit, plus the full-precision encoder for the graphics card, revisions pinned in `captions/protocol.ts`) | Apache-2.0, via their declared base models `openai/whisper-tiny` / `openai/whisper-base` (OpenAI's original weights: MIT). The conversions don't state a licence of their own; a format conversion doesn't change the weights' licence (ADR 0022). | Downloaded from Hugging Face the first time someone creates captions (about 41 or 77 MB; 64 or 136 MB when using the graphics card), then cached by the browser. Audio is processed on the device and never uploaded. |
| Translation models, `Xenova/opus-mt-<from>-<to>` (ONNX conversions of Helsinki-NLP's OPUS-MT, one per language pair, revisions pinned in `captions/translation.ts`)                                                                                                                                 | Apache-2.0, except `ru-en`, `zh-en` and `en-de`: CC BY 4.0 (credit: OPUS-MT by Helsinki-NLP, shown in the translation dialog). Licences follow the declared Helsinki-NLP base models.                                                              | Downloaded from Hugging Face the first time a pair is used (about 110 MB each; two when translating through English), then cached by the browser. Text is translated on the device and never uploaded.                |
| Face detector, UltraFace RFB-320 (`onnxmodelzoo/version-RFB-320`, revision pinned in `reframe/protocol.ts`)                                                                                                                                                                                         | Apache-2.0 (ONNX Model Zoo); the original UltraFace project is MIT                                                                                                                                                                                 | Downloaded from Hugging Face the first time a clip is reframed (1.3 MB), then kept in the browser's cache. Frames are analysed on the device and never uploaded.                                                      |
| `portrait-of-woman_small.jpg` (tests only), from the Transformers.js documentation samples                                                                                                                                                                                                          | Not stated by the sample set                                                                                                                                                                                                                       | Downloaded at test time to make a video with a moving face; never committed or shipped.                                                                                                                               |
| `jfk.wav` (tests only): John F. Kennedy's 1961 inaugural address, 11 s                                                                                                                                                                                                                              | Public domain (US government work)                                                                                                                                                                                                                 | Downloaded by the end-to-end test setup, from the Transformers.js documentation dataset.                                                                                                                              |

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
