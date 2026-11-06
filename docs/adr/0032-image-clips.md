# 0032: Image clips

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Logos, photos, screenshots and backgrounds (for example behind a cut-out person, ADR 0031) are
everyday material in an editor, but only video and audio files could be imported.

## Decision

- **Formats:** PNG, JPEG, WebP, GIF (first frame), AVIF and BMP, recognised by type or extension
  (`media/still.ts`). SVG is left out: it needs a size chosen before it can be rasterised.
- **An image is a media clip whose every source time shows the same picture.**
  - The engine gives it a 24-hour source, like a title, so it can be stretched to any length
    (`append_still_clip`). It starts at 5 s.
  - It goes on video tracks only.
  - Splitting, trimming, transforms, keyframes, colour, LUTs, background removal and frame
    shapes all apply unchanged.
- **Decoded once.** `openAsset` recognises images and decodes them with `createImageBitmap`,
  applying the EXIF orientation as cameras intend. It returns the picture as `still`, with no
  video or audio track, so the workers that only want sound (audio, captions, silence) skip
  images naturally.
- **Drawn through the same paths as video.** A `StillReader` wraps the bitmap in a
  `VideoSample` and returns it for every time, behind the same `SampleReader` interface as the
  video `FrameReader`. The compositors, background removal and export need no image-specific
  code. mediabunny copies the bitmap into its own frame, so readers can share one bitmap.
- **Saved as `still: true`** on the project's media entry (absent for video and audio, so older
  projects are unchanged).
  - A still gets one thumbnail, shown along the whole clip.
  - Relinking checks that an image is replaced by an image.
  - "Fill and follow faces" isn't offered for stills; "Fill frame" is.
- **Fix found on the way:** stored media files come back under their original name and type.
  They are stored under the asset's id with no type. Video worked anyway, because the decoder
  sniffs the container, but an image would not be recognised after a reload or a backup import.

## Consequences

- An animated GIF shows its first frame.
- Images are kept at their own resolution in memory while a project is open (decoded once,
  rather than per frame).
