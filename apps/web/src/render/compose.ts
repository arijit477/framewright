import type { Layer } from '../engine/types';
import type { DrawItem } from './compositor';
import { NEUTRAL_COLOR } from './color';
import { transitionEffect } from './transition';
import type { FrameReader } from './frame-reader';
import type { ReaderPool } from './reader-pool';

/**
 * Turn the engine's layers for one moment into draw items, decoding video
 * frames in parallel. Shared by the preview and export workers, so both draw
 * exactly the same thing. Layers whose media isn't available are skipped.
 */
export async function drawItems(
  layers: Layer[],
  readers: ReaderPool<FrameReader>,
): Promise<DrawItem[]> {
  const items = await Promise.all(
    layers.map(async (layer): Promise<DrawItem | null> => {
      if (layer.text) {
        return {
          kind: 'text',
          content: layer.text,
          clipTime: layer.clipTime,
          clipDuration: layer.clipDuration,
        };
      }
      const sample = await readers
        .get(layer.assetId, layer.trackIndex)
        ?.frameAt(layer.sourceTime / 1_000_000);
      return sample
        ? {
            kind: 'video',
            sample,
            transform: layer.transform,
            color: layer.color ?? NEUTRAL_COLOR,
            effect: transitionEffect(layer.transition),
          }
        : null;
    }),
  );
  return items.filter((item): item is DrawItem => item !== null);
}
