# 0030: Smart reframing (following faces)

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

With frame shapes (ADR 0029), widescreen footage in a vertical project shows a third of its
width once filled. A static centre crop loses anyone not in the middle. Editors offer
"auto-reframe": keep the subject in frame as it moves.

## Decision

- **Follow faces.** Talking heads and presenters are what people reframe for vertical video.
  A whole-body detector would track more kinds of subject, but we measured it as about 100×
  slower (below).
- **Model: UltraFace RFB-320.** It's from the ONNX Model Zoo on Hugging Face (Apache-2.0 there;
  the original project is MIT), 1.3 MB, pinned by revision, and downloaded once into the
  browser's cache. It runs on ONNX Runtime Web, the engine the app already bundles, on the
  processor.

  Measured in Node on this container's processor, per frame, warm:

  | Model                            | Time         | Notes                                 |
  | -------------------------------- | ------------ | ------------------------------------- |
  | UltraFace RFB-320 (faces)        | 6–40 ms      | found the face in all 4 sample photos |
  | RT-DETR r18 (people, Apache-2.0) | 1.2–2.9 s    | accurate, too slow to sample video    |
  | YOLOS-tiny (people, Apache-2.0)  | slower still | duplicate boxes on a crowded photo    |

  Rejected:
  - **YOLOv10:** AGPL-3.0.
  - **SCRFD:** non-commercial model licence.
  - **D-FINE:** no licence declared on Hugging Face.

- **Analysis** (`reframe/reframe.worker.ts`):
  - Frames of the clip's source range are sampled every 0.25 s.
  - Each frame is letterboxed into the 320×240 input, so faces keep their shape.
  - Confident boxes (score ≥ 0.7) are kept, with overlapping duplicates merged.
- **From faces to a calm camera** (`reframe/path.ts`, pure and unit-tested):
  1. Pick the subject: the biggest face. The previous subject is kept while their face is at
     least half the size of the biggest, so the camera doesn't flick between two people.
  2. Frames without a face hold the last position.
  3. A 5-sample median filter drops one-frame glitches.
  4. The camera ignores movement under 3% of the picture, and otherwise eases towards the
     subject (time constant 0.6 s).
  5. A jump of more than 25% (a new shot, another person) is cut to at once.
  6. The path becomes keyframes where it bends by more than 1% (Ramer–Douglas–Peucker). A cut
     is a pair of keyframes 1 ms apart. The tolerance grows until the clip's 100-keyframe limit
     fits.
- **Output: transform keyframes in source time.** The clip is scaled to fill the frame, and each
  keyframe places the camera point at the frame's centre, but never so far that the frame is
  uncovered. The keyframes stay right when the clip is trimmed or split, and can be edited like
  any others. Applying them replaces the clip's animation, as one undo step.

## Consequences

- Subjects without a visible face (from behind, objects, animals) aren't followed. The clip is
  left as it was, with a message suggesting "Fill frame" and dragging.
- Analysis is on the processor, sampling four frames a second, with progress shown and a way
  to cancel.
- Tests use a generated video: a sample portrait photo sliding across a green background. The
  photo is downloaded at test time and never committed or shipped.
