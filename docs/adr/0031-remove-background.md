# 0031: Removing the background (live, on the device)

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

Cutting a person out of their background (to put them over other footage, a colour or a title
card) is a staple of short-form editing. It has to run on the device, under a permissive licence,
and the preview must match the export (ADR 0006).

## Decision

- **Model: MediaPipe selfie segmentation** (`onnx-community/mediapipe_selfie_segmentation`,
  Apache-2.0), 0.5 MB, full precision, pinned and kept in the browser's cache (`lib/model-cache.ts`).
  - Measured per frame, warm, on a 4-core processor:

    | Model                     | Input   | Time       |
    | ------------------------- | ------- | ---------- |
    | MediaPipe (full)          | 256×256 | 3–19 ms    |
    | MediaPipe (8-bit)         | 256×256 | 18–100 ms  |
    | MODNet (Apache-2.0, full) | 512×288 | 480–990 ms |

    Only MediaPipe can keep up with live preview, so it is used everywhere (chosen with the
    user). MODNet's edges are cleaner, but it's around 50× slower: a possible "high quality"
    pre-processing pass later.

  - Rejected:
    - RMBG-1.4 and RMBG-2.0: BRIA's non-commercial licence.
    - ISNet: AGPL-3.0.
    - BiRefNet: MIT, but 114–224 MB and slow.
- **A per-clip switch** (`removeBackground` on media clips): saved, undoable, kept by split and
  copy, and carried on every layer the engine resolves.
- **Computed per frame, at render time** (`segment/matter.ts`):
  - The preview and export workers stretch the frame to 256×256, run the model and turn its
    output into a 256×256 mask (`segment/matte.ts`).
  - The mask's alpha is shaped with a smoothstep between 0.3 and 0.7, which drops the faint halo
    the model leaves and keeps a soft edge.
  - The mask is stretched back over the frame, so it lines up whatever the frame's shape.
  - No smoothing between frames: a paused preview frame and the same frame in an export must be
    identical.
  - The model and ONNX Runtime load on first use, so projects without background removal never
    fetch them.
- **Both compositors apply it:**
  - Canvas 2D (export and fallback): `destination-in` on the processed frame.
  - WebGPU (preview): a mask texture multiplies the alpha in the shader.
  - The WebGPU self-test gains a masked layer: a white frame through a 50% mask over black must
    read back mid-grey, or the preview falls back to Canvas 2D. A GPU that gets masks wrong
    therefore never shows them. (The shader is checked to compile on Chromium's software
    adapter, but WebGPU drawing can't run in our test browser, which already falls back.)
- **If the model can't load:**
  - The preview draws the whole frame and says so once.
  - An export fails with the reason, rather than producing a video that ignores the setting.

## Consequences

- It's a selfie model: it works best when the person fills much of the frame (talking heads).
  Small or distant people get coarse edges. In tests, a portrait at full frame height is cut out
  cleanly, hair included; one at a fifth of the frame width is not.
- Every frame of a clip with background removal costs a model run, in preview and export.
