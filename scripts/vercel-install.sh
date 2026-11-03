#!/usr/bin/env bash
# Install step for Vercel builds (see vercel.json).
#
# Vercel's build image has Node and pnpm but no Rust, so this installs the
# Rust toolchain and wasm-pack, builds the WASM engine (which the web app's
# `@framewright/engine` dependency links to), then installs JS dependencies.
# Versions are pinned so deploys are reproducible.
set -euo pipefail

WASM_PACK_VERSION="0.15.1"
export PATH="$HOME/.cargo/bin:$PATH"

if ! command -v cargo >/dev/null 2>&1; then
  echo "Installing Rust (minimal profile)…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    sh -s -- -y --profile minimal --default-toolchain stable --no-modify-path
fi
rustup target add wasm32-unknown-unknown

if ! wasm-pack --version 2>/dev/null | grep -q "$WASM_PACK_VERSION"; then
  echo "Installing wasm-pack $WASM_PACK_VERSION…"
  cargo install wasm-pack --locked --version "$WASM_PACK_VERSION"
fi

echo "Building the engine (release, optimised)…"
wasm-pack build crates/engine --target web --release --out-dir pkg --out-name engine

echo "Installing JS dependencies…"
pnpm install --frozen-lockfile
