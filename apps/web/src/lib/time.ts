export const MICROS_PER_SECOND = 1_000_000;

/** Preview frame rate used for stepping and the timecode display. */
export const PREVIEW_FPS = 30;

export const secondsToMicros = (s: number): number => Math.round(s * MICROS_PER_SECOND);
export const microsToSeconds = (us: number): number => us / MICROS_PER_SECOND;

/** Frame index at `us`. Tolerates the sub-microsecond rounding in framesToMicros. */
export const microsToFrames = (us: number): number =>
  Math.floor((Math.max(0, us) * PREVIEW_FPS) / MICROS_PER_SECOND + 1e-3);

/** Start time of frame `n`, computed from the frame index so it never drifts. */
export const framesToMicros = (n: number): number =>
  Math.round((n * MICROS_PER_SECOND) / PREVIEW_FPS);

/** `MM:SS:FF` (frames at PREVIEW_FPS), or `H:MM:SS:FF` past an hour. */
export function formatTimecode(us: number): string {
  const totalFrames = microsToFrames(us);
  const frames = totalFrames % PREVIEW_FPS;
  const totalSeconds = Math.floor(totalFrames / PREVIEW_FPS);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  const body = `${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
  return hours > 0 ? `${hours}:${body}` : body;
}

/** A tidy interval for ruler ticks so labels sit roughly `minPx` apart. */
export function rulerStep(pxPerSecond: number, minPx = 80): number {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const seconds = steps.find((s) => s * pxPerSecond >= minPx) ?? steps[steps.length - 1]!;
  return secondsToMicros(seconds);
}
