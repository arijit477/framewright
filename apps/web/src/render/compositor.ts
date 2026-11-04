import type { VideoSample } from 'mediabunny';
import { IDENTITY_TRANSFORM, type TextContent, type Transform } from '../engine/types';
import type { RendererBackend } from './protocol';
import { drawText } from './text';
import { layerMatrix, toClipSpace, type Affine } from './transform';

/**
 * Draws a stack of frames (bottom first) into the output canvas.
 * Effects, transforms and transitions in later phases hook in here.
 */
/** One layer to draw, bottom first: a decoded video frame or a text overlay. */
export type DrawItem =
  | { kind: 'video'; sample: VideoSample; transform: Transform }
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

  constructor(private readonly canvas: OffscreenCanvas) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
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
      const { sample, transform } = item;
      if (transform.opacityPercent === 0) continue;
      const m = layerMatrix(sample.displayWidth, sample.displayHeight, width, height, transform);
      this.ctx.save();
      this.ctx.globalAlpha = transform.opacityPercent / 100;
      this.ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      sample.draw(this.ctx, 0, 0, 1, 1); // the unit square, mapped by the matrix
      this.ctx.restore();
    }
  }
}

const SHADER = /* wgsl */ `
// Affine transform from the unit square (the source frame, y down) to clip space:
// position = (m.x·u + m.z·v + t.x, m.y·u + m.w·v + t.y); t.z is the layer opacity.
// Computed by layerMatrix() + toClipSpace() in transform.ts (shared with Canvas 2D).
struct Quad { m: vec4f, t: vec4f };
@group(0) @binding(0) var<uniform> quad: Quad;
@group(0) @binding(1) var frameSampler: sampler;
@group(0) @binding(2) var frame: texture_external;

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

@fragment fn fs(in: VsOut) -> @location(0) vec4f {
  let colour = textureSampleBaseClampToEdge(frame, frameSampler, in.uv);
  return vec4f(colour.rgb, colour.a * quad.t.z);
}
`;

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
  ) {}

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
      device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
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
    return new WebGpuCompositor(canvas, device, context, pipeline, sampler, uniforms);
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
    items.slice(0, MAX_LAYERS).forEach((item, i) => {
      const videoFrame = item.kind === 'video' ? item.sample.toVideoFrame() : this.textFrame(item);
      if (!videoFrame) return;
      videoFrames.push(videoFrame);
      // Text frames are full-canvas; video frames use the clip's transform.
      const transform = item.kind === 'video' ? item.transform : IDENTITY_TRANSFORM;
      const matrix =
        item.kind === 'video'
          ? layerMatrix(
              item.sample.displayWidth,
              item.sample.displayHeight,
              width,
              height,
              transform,
            )
          : layerMatrix(width, height, width, height, transform);
      const uniform = this.uniforms[i]!;
      this.device.queue.writeBuffer(
        uniform,
        0,
        quadUniform(matrix, width, height, transform.opacityPercent / 100),
      );

      const bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: this.device.importExternalTexture({ source: videoFrame }) },
        ],
      });
      pass.setBindGroup(0, bindGroup);
      pass.draw(4);
    });

    pass.end();
    this.device.queue.submit([encoder.finish()]);
    // Close frames once the GPU has finished sampling them. Closing right after
    // submit() can release the texture before the queued draw runs.
    void this.device.queue.onSubmittedWorkDone().then(() => {
      for (const frame of videoFrames) frame.close();
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

/**
 * Draw a solid red VideoFrame, then a fully transparent one on top, through
 * the production pipeline into a 4x4 texture, and read it back. The result
 * must still be red: that proves video frames import correctly *and* that
 * transparency survives (text overlays rely on it). Returns false on any
 * error or wrong colour, so the caller falls back to Canvas 2D.
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
  try {
    device.pushErrorScope('validation');
    const target = device.createTexture({
      size: [size, size],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    device.queue.writeBuffer(
      uniform,
      0,
      quadUniform(layerMatrix(size, size, size, size, IDENTITY_TRANSFORM), size, size, 1),
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
    const pixel = new Uint8Array(readback.getMappedRange(), 0, 4);
    const [red, blue] = format === 'bgra8unorm' ? [pixel[2]!, pixel[0]!] : [pixel[0]!, pixel[2]!];
    readback.unmap();
    target.destroy();
    return red > 200 && blue < 50;
  } catch (error) {
    console.warn('WebGPU self-test failed', error);
    return false;
  } finally {
    frame.close();
    transparent.close();
  }
}

/** The shader's uniform: the clip-space matrix and the layer opacity (8 floats). */
function quadUniform(pixels: Affine, width: number, height: number, opacity: number) {
  const m = toClipSpace(pixels, width, height);
  return new Float32Array([m.a, m.b, m.c, m.d, m.e, m.f, opacity, 0]);
}
