#!/usr/bin/env bash
# Prepare self-contained runtime for macOS: global-install dsh (darwin) + node binary into runtime/
# Usage: bash prepare-runtime-macos.sh   (run ON a Mac)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
RUNTIME="$HERE/runtime"
DSH_VERSION="${DSH_VERSION:-0.1.0-rc.6}"

echo "==> installing global dsh $DSH_VERSION (darwin)..."
npm install -g "@deepseek-ai/dsh@$DSH_VERSION" --no-audit --no-fund

GLOBAL_ROOT="$(npm root -g)"
DSH_SRC="$GLOBAL_ROOT/@deepseek-ai/dsh"
if [ ! -f "$DSH_SRC/lib/bin.js" ]; then
  echo "ERROR: global dsh not found at $DSH_SRC" >&2
  exit 1
fi

echo "==> copying dsh kernel tree into runtime/..."
rm -rf "$RUNTIME"
mkdir -p "$RUNTIME/node_modules/@deepseek-ai"
cp -R "$DSH_SRC" "$RUNTIME/node_modules/@deepseek-ai/dsh"

echo "==> pruning dev artifacts (.d.ts/.map)..."
find "$RUNTIME/node_modules" \( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.map' \) -delete 2>/dev/null || true

echo "==> copying node binary..."
NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: node not found on PATH" >&2
  exit 1
fi
# resolve symlink to the real binary (brew/nvm node is usually a symlink)
NODE_REAL="$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$NODE_BIN" 2>/dev/null || echo "$NODE_BIN")"
mkdir -p "$RUNTIME/bin"
cp "$NODE_REAL" "$RUNTIME/bin/node"
chmod +x "$RUNTIME/bin/node"

echo "==> runtime ready (dsh=$DSH_VERSION, node=$("$RUNTIME/bin/node" --version))"
ls -l "$RUNTIME/bin/node" "$RUNTIME/node_modules/@deepseek-ai/dsh/lib/bin.js"
