import type { VideoSample } from 'mediabunny';
import {
  IDENTITY_TRANSFORM,
  type ColorAdjust,
  type TextContent,
  type Transform,
} from '../engine/types';
import {
  adjustPixels,
  adjustRgb,
  colorParams,
  cssFilter,
  hasToneAdjustment,
  hasWhiteBalance,
  NEUTRAL_COLOR,
  whiteBalanceGains,
  whiteBalancePixels,
  whiteBalanceRgb,
} from './color';
import { applyLutRgb, lutPixels, makeLut, toHalf, type Lut } from './lut';
import type { RendererBackend } from './protocol';
import { drawText } from './text';
import { layerMatrix, toClipSpace, type Affine } from './transform';
import { NO_EFFECT, type TransitionEffect } from './transition';

/**
 * Draws a stack of frames (bottom first) into the output canvas.
 * Effects, transforms and transitions in later phases hook in here.
 */
/** One layer to draw, bottom first: a decoded video frame or a text overlay. */
export type DrawItem =
  | {
      kind: 'video';
      sample: VideoSample;
      transform: Transform;
      color: ColorAdjust;
      /** Applied before `color`; null for none. */
      lut: { lut: Lut; intensity: number } | null;
      effect: TransitionEffect;
    }
  | { kind: 'text'; content: TextContent; clipTime: number; clipDuration: number };

export interface Compositor {
  readonly backend: RendererBackend;
  draw(items: DrawItem[]): void;
}

export interface CompositorOptions {
  /**
   * 'auto' tries WebGPU (verified by a self-test) and falls back to Canvas 2D.
   * 'canvas2d' skips WebGPU, e.g. for export, where frames are read back from
   * the canvas by the encoder and the 2D path is the most widely verified.
   */
  backend?: 'auto' | 'canvas2d';
}

export async function createCompositor(
  canvas: OffscreenCanvas,
  { backend = 'auto' }: CompositorOptions = {},
): Promise<Compositor> {
  if (backend === 'canvas2d') return new Canvas2dCompositor(canvas);
  try {
    const gpu = await WebGpuCompositor.create(canvas);
    if (gpu) return gpu;
  } catch (error) {
    console.warn('WebGPU unavailable, falling back to Canvas 2D', error);
  }
  return new Canvas2dCompositor(canvas);
}

/** Fallback for browsers without WebGPU. Still GPU-accelerated in most browsers. */
class Canvas2dCompositor implements Compositor {
  readonly backend = 'canvas2d' as const;
  private readonly ctx: OffscreenCanvasRenderingContext2D;
  /**
   * Whether `ctx.filter` works (checked before ever setting it: assigning an
   * unsupported property would just create a plain one).
   */
  private readonly canvasFilters: boolean;
  /** Scratch canvas for adjusting pixels by hand where `ctx.filter` is missing. */
  private scratch: OffscreenCanvas | null = null;

  constructor(private readonly canvas: OffscreenCanvas) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
    this.canvasFilters = typeof ctx.filter === 'string';
  }

  draw(items: DrawItem[]): void {
    const { width, height } = this.canvas;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, width, height);
    for (const item of items) {
      if (item.kind === 'text') {
        drawText(this.ctx, item.content, item.clipTime, item.clipDuration, width, height);
        continue;
      }
      const { sample, transform, color, lut, effect } = item;
      const opacity = (transform.opacityPercent / 100) * effect.opacity;
      const [revealFrom, revealTo] = effect.reveal;
      if (opacity === 0 || revealTo <= revealFrom) continue;
      const m = shifted(
        layerMatrix(sample.displayWidth, sample.displayHeight, width, height, transform),
        effect.offsetX * width,
      );
      this.ctx.save();
      if (revealFrom > 0 || revealTo < 1) {
        // Wipe: only the revealed band of the canvas is drawn.
        this.ctx.beginPath();
        this.ctx.rect(revealFrom * width, 0, (revealTo - revealFrom) * width, height);
        this.ctx.clip();
      }
      this.ctx.globalAlpha = opacity;
      this.ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      // White balance and LUT by hand, then brightness/contrast/saturation (by the
      // browser where it can): the order every renderer uses (render/color.ts).
      const tone = hasToneAdjustment(color);
      const filterByBrowser = this.canvasFilters && tone;
      if (filterByBrowser) this.ctx.filter = cssFilter(color); // reset by restore()
      const toneByHand = tone && !filterByBrowser ? color : null;
      if (!lut && !hasWhiteBalance(color) && !toneByHand) {
        sample.draw(this.ctx, 0, 0, 1, 1); // the unit square, mapped by the matrix
      } else {
        const gains = hasWhiteBalance(color) ? whiteBalanceGains(color) : null;
        this.ctx.drawImage(this.processed(sample, gains, lut, toneByHand), 0, 0, 1, 1);
      }
      this.ctx.restore();
    }
  }

  /**
   * The frame with its pixels processed in JavaScript: white balance, the LUT,
   * and brightness/contrast/saturation where the browser has no canvas
   * filters, in that order. Done at the frame's
   * size, but never above the output canvas (a 4K source in a 1080p export is
   * processed at 1080p).
   */
  private processed(
    sample: VideoSample,
    gains: [number, number, number] | null,
    lut: { lut: Lut; intensity: number } | null,
    color: ColorAdjust | null,
  ): OffscreenCanvas {
    const scale = Math.min(
      1,
      this.canvas.width / sample.displayWidth,
      this.canvas.height / sample.displayHeight,
    );
    const width = Math.max(1, Math.round(sample.displayWidth * scale));
    const height = Math.max(1, Math.round(sample.displayHeight * scale));
    if (!this.scratch || this.scratch.width !== width || this.scratch.height !== height) {
      this.scratch = new OffscreenCanvas(width, height);
    }
    const ctx = this.scratch.getContext('2d', { willReadFrequently: true })!;
    sample.draw(ctx, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    if (gains) whiteBalancePixels(pixels.data, gains);
    if (lut) lutPixels(pixels.data, lut.lut, lut.intensity);
    if (color) adjustPixels(pixels.data, color);
    ctx.putImageData(pixels, 0, 0);
    return this.scratch;
  }
}

const SHADER = /* wgsl */ `
// Affine transform from the unit square (the source frame, y down) to clip space:
// position = (m.x·u + m.z·v + t.x, m.y·u + m.w·v + t.y); t.z is the layer opacity.
// Computed by layerMatrix() + toClipSpace() in transform.ts (shared with Canvas 2D).
// c = (brightness, contrast, saturation, LUT intensity); w = white-balance gains (r, g, b, unused):
// render/color.ts and render/lut.ts.
struct Quad { m: vec4f, t: vec4f, c: vec4f, w: vec4f };
@group(0) @binding(0) var<uniform> quad: Quad;
@group(0) @binding(1) var frameSampler: sampler;
@group(0) @binding(2) var frame: texture_external;
// The layer's LUT (an identity LUT, at intensity 0, for layers without one).
@group(0) @binding(3) var lut: texture_3d<f32>;
@group(0) @binding(4) var lutSampler: sampler;

struct VsOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  let corners = array(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(1, 1));
  let c = corners[i];
  var out: VsOut;
  out.position = vec4f(
    quad.m.x * c.x + quad.m.z * c.y + quad.t.x,
    quad.m.y * c.x + quad.m.w * c.y + quad.t.y,
    0,
    1,
  );
  out.uv = c;
  return out;
}

// brightness(), contrast(), then saturate(), clamping after each step like CSS.
fn adjust(rgb: vec3f) -> vec3f {
  let lit = clamp(rgb * quad.c.x, vec3f(0), vec3f(1));
  let contrasted = clamp((lit - 0.5) * quad.c.y + 0.5, vec3f(0), vec3f(1));
  let luma = dot(contrasted, vec3f(0.213, 0.715, 0.072));
  return clamp(luma + (contrasted - luma) * quad.c.z, vec3f(0), vec3f(1));
}

// Trilinear lookup (the hardware filter), sampling entry centres, blended by intensity.
fn graded(rgb: vec3f) -> vec3f {
  let n = f32(textureDimensions(lut).x);
  let uvw = (clamp(rgb, vec3f(0), vec3f(1)) * (n - 1.0) + 0.5) / n;
  return mix(rgb, textureSampleLevel(lut, lutSampler, uvw, 0.0).rgb, quad.c.w);
}

@fragment fn fs(in: VsOut) -> @location(0) vec4f {
  let colour = textureSampleBaseClampToEdge(frame, frameSampler, in.uv);
  // White balance, then the LUT, then brightness/contrast/saturation.
  let balanced = clamp(colour.rgb * quad.w.xyz, vec3f(0), vec3f(1));
  return vec4f(adjust(graded(balanced)), colour.a * quad.t.z);
}
`;

/** LUT textures kept around when unused (a few MB each at most). */
const MAX_CACHED_LUTS = 8;

/** Max layers drawn in one pass; each needs its own uniform slot. */
const MAX_LAYERS = 16;

/**
 * Zero-copy path: each decoded VideoFrame is imported as an external texture,
 * so pixels go decoder -> GPU -> screen without touching the CPU.
 */
class WebGpuCompositor implements Compositor {
  readonly backend = 'webgpu' as const;

  private constructor(
    private readonly canvas: OffscreenCanvas,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly pipeline: GPURenderPipeline,
    private readonly sampler: GPUSampler,
    private readonly uniforms: GPUBuffer[],
    private readonly identityLut: GPUTexture,
  ) {}

  /** GPU copies of the LUTs in use, created on first use. */
  private readonly lutTextures = new Map<Lut, GPUTexture>();

  private lutTexture(lut: Lut): GPUTexture {
    let texture = this.lutTextures.get(lut);
    if (!texture) {
      texture = createLutTexture(this.device, lut);
      this.lutTextures.set(lut, texture);
    }
    return texture;
  }

  static async create(canvas: OffscreenCanvas): Promise<WebGpuCompositor | null> {
    if (!('gpu' in navigator) || !navigator.gpu) return null;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const format = navigator.gpu.getPreferredCanvasFormat();

    const module = device.createShaderModule({ code: SHADER });
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-strip' },
    });
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    const uniforms = Array.from({ length: MAX_LAYERS }, () =>
      device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    );

    // Some drivers expose WebGPU but cannot import video frames correctly.
    // Prove the real pipeline works before claiming the canvas: once a canvas
    // has a 'webgpu' context it can never fall back to '2d'.
    if (!(await selfTest(device, pipeline, sampler, uniforms[0]!, format))) {
      device.destroy();
      return null;
    }

    const context = canvas.getContext('webgpu');
    if (!context) return null;
    context.configure({ device, format, alphaMode: 'opaque' });
    const identity = createLutTexture(device, makeLut(2));
    return new WebGpuCompositor(canvas, device, context, pipeline, sampler, uniforms, identity);
  }

  /** Text is drawn here, then uploaded like a video frame (same, self-tested pipeline). */
  private textCanvas: OffscreenCanvas | null = null;

  draw(items: DrawItem[]): void {
    const { width, height } = this.canvas;
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.pipeline);

    const videoFrames: VideoFrame[] = [];
    const used = new Set<Lut>();
    items.slice(0, MAX_LAYERS).forEach((item, i) => {
      const videoFrame = item.kind === 'video' ? item.sample.toVideoFrame() : this.textFrame(item);
      if (!videoFrame) return;
      videoFrames.push(videoFrame);
      // Text frames are full-canvas; video frames use the clip's transform.
      const transform = item.kind === 'video' ? item.transform : IDENTITY_TRANSFORM;
      const effect = item.kind === 'video' ? item.effect : NO_EFFECT;
      const matrix = shifted(
        item.kind === 'video'
          ? layerMatrix(
              item.sample.displayWidth,
              item.sample.displayHeight,
              width,
              height,
              transform,
            )
          : layerMatrix(width, height, width, height, transform),
        effect.offsetX * width,
      );
      const uniform = this.uniforms[i]!;
      this.device.queue.writeBuffer(
        uniform,
        0,
        quadUniform(
          matrix,
          width,
          height,
          (transform.opacityPercent / 100) * effect.opacity,
          item.kind === 'video' ? item.color : NEUTRAL_COLOR,
          item.kind === 'video' ? (item.lut?.intensity ?? 0) : 0,
        ),
      );
      const lut =
        item.kind === 'video' && item.lut ? this.lutTexture(item.lut.lut) : this.identityLut;
      if (item.kind === 'video' && item.lut) used.add(item.lut.lut);
      // Wipe: limit drawing to the revealed band (whole pixels, at least one wide).
      const from = Math.floor(effect.reveal[0] * width);
      const to = Math.ceil(effect.reveal[1] * width);
      if (to <= from) return;
      pass.setScissorRect(from, 0, to - from, height);

      const bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: this.device.importExternalTexture({ source: videoFrame }) },
          { binding: 3, resource: lut.createView() },
          { binding: 4, resource: this.sampler },
        ],
      });
      pass.setBindGroup(0, bindGroup);
      pass.draw(4);
      // The scissor persists for later draws in this pass: restore the full canvas.
      pass.setScissorRect(0, 0, width, height);
    });

    pass.end();
    this.device.queue.submit([encoder.finish()]);
    // Close frames once the GPU has finished sampling them. Closing right after
    // submit() can release the texture before the queued draw runs.
    void this.device.queue.onSubmittedWorkDone().then(() => {
      for (const frame of videoFrames) frame.close();
      // Free the GPU copies of LUTs no longer in use (the project replaced or dropped them).
      if (this.lutTextures.size > MAX_CACHED_LUTS) {
        for (const [lut, texture] of this.lutTextures) {
          if (used.has(lut)) continue;
          texture.destroy();
          this.lutTextures.delete(lut);
        }
      }
    });
  }

  /** Render a text layer onto a transparent full-size canvas and snapshot it as a frame. */
  private textFrame(item: Extract<DrawItem, { kind: 'text' }>): VideoFrame | null {
    const { width, height } = this.canvas;
    if (!this.textCanvas || this.textCanvas.width !== width || this.textCanvas.height !== height) {
      this.textCanvas = new OffscreenCanvas(width, height);
    }
    const ctx = this.textCanvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, width, height);
    drawText(ctx, item.content, item.clipTime, item.clipDuration, width, height);
    // The VideoFrame copies the pixels, so the canvas can be reused for the next layer.
    return new VideoFrame(this.textCanvas, { timestamp: 0, alpha: 'keep' });
  }
}

/** What the self-test draws: red, cooled, inverted by a LUT, then made black and white. */
const SELF_TEST_COLOR: ColorAdjust = { ...NEUTRAL_COLOR, temperature: -100, saturation: -100 };
const SELF_TEST_LUT = makeLut(2, (r, g, b) => [1 - r, 1 - g, 1 - b]);

/**
 * Draw a solid red VideoFrame through the whole colour pipeline (white
 * balance, an inverting LUT, desaturation), then a fully transparent frame on
 * top, into a 4x4 texture, and read it back. The result must be the grey the
 * TypeScript reference gives (about 213 of 255; any other order gives a
 * different value or colour). That proves video frames import correctly,
 * transparency survives (text overlays rely on it), and the GPU's colour maths
 * matches Canvas 2D. Returns false on any error or wrong colour, so the
 * caller falls back to Canvas 2D.
 */
async function selfTest(
  device: GPUDevice,
  pipeline: GPURenderPipeline,
  sampler: GPUSampler,
  uniform: GPUBuffer,
  format: GPUTextureFormat,
): Promise<boolean> {
  const size = 4;
  const source = new OffscreenCanvas(size, size);
  const ctx = source.getContext('2d');
  if (!ctx) return false;
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, size, size);
  const frame = new VideoFrame(source, { timestamp: 0 });
  const clear = new OffscreenCanvas(size, size);
  clear.getContext('2d')?.clearRect(0, 0, size, size);
  const transparent = new VideoFrame(clear, { timestamp: 0, alpha: 'keep' });
  let invert: GPUTexture | null = null;
  try {
    device.pushErrorScope('validation');
    invert = createLutTexture(device, SELF_TEST_LUT);
    const target = device.createTexture({
      size: [size, size],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    device.queue.writeBuffer(
      uniform,
      0,
      quadUniform(
        layerMatrix(size, size, size, size, IDENTITY_TRANSFORM),
        size,
        size,
        1,
        SELF_TEST_COLOR,
        1,
      ),
    );
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: target.createView(), clearValue: [0, 0, 1, 1], loadOp: 'clear', storeOp: 'store' },
      ],
    });
    pass.setPipeline(pipeline);
    for (const layer of [frame, transparent]) {
      pass.setBindGroup(
        0,
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: device.importExternalTexture({ source: layer }) },
            { binding: 3, resource: invert.createView() },
            { binding: 4, resource: sampler },
          ],
        }),
      );
      pass.draw(4);
    }
    pass.end();
    const readback = device.createBuffer({
      size: 256 * size, // bytesPerRow must be a multiple of 256
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow: 256 }, [
      size,
      size,
    ]);
    device.queue.submit([encoder.finish()]);
    if (await device.popErrorScope()) return false;

    await readback.mapAsync(GPUMapMode.READ);
    const pixel = [...new Uint8Array(readback.getMappedRange(), 0, 3)];
    readback.unmap();
    target.destroy();
    // Grey, so the channel order (rgba or bgra) doesn't matter.
    const expected = selfTestExpected() * 255;
    return pixel.every((v) => Math.abs(v - expected) < 6);
  } catch (error) {
    console.warn('WebGPU self-test failed', error);
    return false;
  } finally {
    frame.close();
    transparent.close();
    invert?.destroy();
  }
}

/**
 * A LUT as a 3D texture (red along x, green along y, blue along z), in
 * half-float so the hardware filters it trilinearly at good precision.
 */
function createLutTexture(device: GPUDevice, lut: Lut): GPUTexture {
  const n = lut.size;
  const texture = device.createTexture({
    size: [n, n, n],
    dimension: '3d',
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const halves = new Uint16Array(n * n * n * 4);
  for (let i = 0, j = 0; i < lut.data.length; i += 3, j += 4) {
    halves[j] = toHalf(lut.data[i]!);
    halves[j + 1] = toHalf(lut.data[i + 1]!);
    halves[j + 2] = toHalf(lut.data[i + 2]!);
    halves[j + 3] = 0x3c00; // 1.0
  }
  device.queue.writeTexture({ texture }, halves, { bytesPerRow: n * 8, rowsPerImage: n }, [
    n,
    n,
    n,
  ]);
  return texture;
}

/**
 * The shader's uniform (16 floats): clip-space matrix, opacity, colour
 * adjustments, LUT intensity and white-balance gains.
 */
function quadUniform(
  pixels: Affine,
  width: number,
  height: number,
  opacity: number,
  color: ColorAdjust = NEUTRAL_COLOR,
  lutIntensity = 0,
) {
  const m = toClipSpace(pixels, width, height);
  const c = colorParams(color);
  const [gr, gg, gb] = whiteBalanceGains(color);
  return new Float32Array([
    m.a,
    m.b,
    m.c,
    m.d,
    m.e,
    m.f,
    opacity,
    0,
    c.brightness,
    c.contrast,
    c.saturation,
    lutIntensity,
    gr,
    gg,
    gb,
    0,
  ]);
}

/** Move a placement right by `dx` canvas pixels (slide transitions). */
function shifted(m: Affine, dx: number): Affine {
  return dx === 0 ? m : { ...m, e: m.e + dx };
}

/** The grey the self-test must read back, from the reference maths every renderer follows. */
export function selfTestExpected(): number {
  const balanced = whiteBalanceRgb([1, 0, 0], whiteBalanceGains(SELF_TEST_COLOR));
  const graded = applyLutRgb(balanced, SELF_TEST_LUT, 1);
  return adjustRgb(graded, colorParams(SELF_TEST_COLOR))[0];
}
