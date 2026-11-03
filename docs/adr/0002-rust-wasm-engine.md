# 0002: Timeline engine in Rust, compiled to WebAssembly

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

The project model has rules (no overlaps, trim limits, source bounds) that every feature
depends on. Code that resolves a frame runs on every playback tick. We also plan a native
desktop build.

## Decision

The project model, all edit operations and `resolve(t)` live in `crates/engine` (Rust). The
web app calls it through a thin typed facade (`TimelineEngine`). Browser-specific code is
confined to `wasm.rs`.

## Consequences

- Invariants are enforced and tested in one place; the UI can't corrupt a project.
- No GC pauses in the per-frame path; predictable performance.
- The same crate compiles natively for the Tauri desktop app.
- Contributors need a Rust toolchain and `wasm-pack`. The WASM must be built before
  `pnpm dev`, which the script does automatically.
- Snapshots cross the boundary as plain JS objects. That is cheap for typical timelines;
  if it ever shows up in profiles, we can expose finer-grained queries.

## Alternatives considered

- **TypeScript only:** simpler toolchain, but no native reuse and GC jitter in hot paths.
- **C++ via Emscripten:** larger output, weaker safety guarantees, and a less pleasant
  toolchain for contributors.
