import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Cross-origin isolation unlocks SharedArrayBuffer and high-resolution timers,
 * which the render and audio threads rely on. Every host must send these
 * headers too (see the root vercel.json and public/_headers).
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: 'es' },
  optimizeDeps: {
    // The engine loads its .wasm via import.meta.url; pre-bundling would break that path.
    exclude: ['@framewright/engine'],
  },
  build: {
    target: 'es2023',
    sourcemap: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
