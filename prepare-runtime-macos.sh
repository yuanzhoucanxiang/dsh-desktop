#!/usr/bin/env bash
# Prepare self-contained runtime for macOS: hoisted npm install (short paths) + node binary
# Usage: bash prepare-runtime-macos.sh   (run ON a Mac)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
RUNTIME="$HERE/runtime"
DSH_VERSION="${DSH_VERSION:-0.1.1-rc.1}"

echo "==> installing dsh (hoisted) into runtime..."
rm -rf "$RUNTIME"
mkdir -p "$RUNTIME"
printf '{"dependencies":{"@deepseek-ai/dsh":"%s"}}\n' "$DSH_VERSION" > "$RUNTIME/package.json"
# 内核运行时有 ~450 个包，npm 在 GitHub macos runner 上会撞 Node 默认 ~2GB 老生代上限：
#   FATAL ERROR: Ineffective mark-compacts near heap limit → Abort trap: 6（exit 134）
# 实测 v0.1.11 的 mac 构建就是这样挂的，所以这里显式抬高堆上限（runner 有 7GB+ 内存）。
NPM_HEAP_MB="${NPM_HEAP_MB:-4096}"
(cd "$RUNTIME" && NODE_OPTIONS="--max-old-space-size=$NPM_HEAP_MB ${NODE_OPTIONS:-}" npm install --no-audit --no-fund)

echo "==> pruning dev artifacts (.d.ts/.map/.ts)..."
find "$RUNTIME/node_modules" \( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.map' -o -name '*.ts' \) -delete 2>/dev/null || true

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
