import type { Caption } from './segments';

/** What a captions file needs: the text and when it shows. */
export type CaptionCue = Pick<Caption, 'text' | 'startUs' | 'endUs'>;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (WebVTT). */
export function formatCaptionTime(us: number, separator: ',' | '.'): string {
  const ms = Math.max(0, Math.round(us / 1000));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(ms % 1000, 3)}`;
}

/** SubRip (.srt): numbered cues, the format most players and platforms accept. */
export function toSrt(captions: readonly CaptionCue[]): string {
  return captions
    .map(
      (c, i) =>
        `${i + 1}\n${formatCaptionTime(c.startUs, ',')} --> ${formatCaptionTime(c.endUs, ',')}\n${c.text}\n`,
    )
    .join('\n');
}

/** WebVTT (.vtt): the format the web's <track> element uses. */
export function toVtt(captions: readonly CaptionCue[]): string {
  const cues = captions.map(
    (c) =>
      `${formatCaptionTime(c.startUs, '.')} --> ${formatCaptionTime(c.endUs, '.')}\n${c.text}\n`,
  );
  return ['WEBVTT\n', ...cues].join('\n');
}
