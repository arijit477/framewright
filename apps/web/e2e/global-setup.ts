import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { FIXTURES, fixture } from './media';

/**
 * Generate small, deterministic test media with ffmpeg instead of committing
 * binaries. The test-pattern video burns in its own timestamp and frame number,
 * so frame accuracy can be checked by looking at a single frame.
 */
/**
 * A short public-domain speech recording (John F. Kennedy, 1961: "ask not
 * what your country can do for you…"), the sample the Transformers.js docs
 * use. Downloaded once; the captions tests transcribe it.
 */
const SPEECH_URL =
  'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav';

export default function globalSetup() {
  mkdirSync(fixture(''), { recursive: true });
  // Arguments are split on spaces; none of them contain spaces.
  const make = (name: string, args: string) => {
    if (!existsSync(fixture(name))) {
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args.split(' '), fixture(name)]);
    }
  };
  // 6 s, 30 fps VP9 test pattern with a 440 Hz tone (peak ≈ -18 dBFS).
  make(
    FIXTURES.video,
    '-f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440:sample_rate=44100 ' +
      '-t 6 -c:v libvpx-vp9 -b:v 1M -deadline realtime -c:a libopus -b:a 96k -shortest',
  );
  // 3 s solid red video (no audio): an overlay that's easy to spot in a frame.
  make(
    FIXTURES.overlay,
    '-f lavfi -i color=c=red:size=1280x720:rate=30 -t 3 -c:v libvpx-vp9 -b:v 200k -deadline realtime',
  );
  // 4 s solid blue video with an 880 Hz tone: an octave above tone.webm, so the
  // two can be measured separately where they overlap.
  make(
    FIXTURES.beep,
    '-f lavfi -i color=c=blue:size=1280x720:rate=30 -f lavfi -i sine=frequency=880:sample_rate=48000 ' +
      '-t 4 -c:v libvpx-vp9 -b:v 200k -deadline realtime -c:a libopus -b:a 96k -shortest',
  );
  // 6 s WAV: 440 Hz for 3 s, then 880 Hz for 3 s. Shows whether sound plays at the
  // right speed (when the step comes) and keeps its pitch (which tones there are).
  make(
    FIXTURES.steps,
    '-f lavfi -i sine=frequency=440:sample_rate=48000:duration=3 ' +
      '-f lavfi -i sine=frequency=880:sample_rate=48000:duration=3 ' +
      '-filter_complex concat=n=2:v=0:a=1',
  );
  // A 17-point 3D LUT that swaps red and blue and lifts green: every colour bar changes.
  if (!existsSync(fixture(FIXTURES.lut))) {
    const n = 17;
    const rows: string[] = [];
    for (let b = 0; b < n; b++)
      for (let g = 0; g < n; g++)
        for (let r = 0; r < n; r++) {
          const [rr, gg, bb] = [r / (n - 1), g / (n - 1), b / (n - 1)];
          rows.push(`${bb.toFixed(6)} ${Math.sqrt(gg).toFixed(6)} ${rr.toFixed(6)}`);
        }
    writeFileSync(fixture(FIXTURES.lut), `TITLE "Swap"\nLUT_3D_SIZE ${n}\n${rows.join('\n')}\n`);
  }
  if (!existsSync(fixture(FIXTURES.speech))) {
    // curl rather than fetch(): it honours HTTPS_PROXY where downloads must use one.
    execFileSync('curl', ['-fsSL', '--retry', '3', '-o', fixture(FIXTURES.speech), SPEECH_URL]);
  }
  // 4 s of silence (with an audio track): Whisper must not invent words for it.
  make(FIXTURES.silence, '-f lavfi -i anullsrc=r=16000:cl=mono -t 4');
  // 4 s, 22.05 kHz stereo WAV (exercises resampling), peak ≈ -27 dBFS.
  make(
    FIXTURES.audio,
    '-f lavfi -i sine=frequency=220:sample_rate=22050 -af volume=0.5 -t 4 -ac 2',
  );
}
