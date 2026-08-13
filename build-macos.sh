#!/usr/bin/env bash
# One-shot macOS build: prepare runtime + build dmg installer.
# Run ON a Mac:  bash build-macos.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

# 本地/CI 默认不签名（无证书时 electron-builder 会报错）；正式分发再配 Apple 证书
export CSC_IDENTITY_AUTO_DISCOVERY=false

# 0. prerequisites
for c in node npm; do
  command -v "$c" >/dev/null || { echo "ERROR: $c not found (install Node.js first)" >&2; exit 1; }
done

# 1. self-contained runtime (darwin dsh + node binary)
if [ ! -x "$HERE/runtime/bin/node" ]; then
  echo "==> preparing runtime..."
  bash prepare-runtime-macos.sh
fi

# 2. dependencies (Electron darwin + electron-builder)
if [ ! -d node_modules/electron ]; then
  echo "==> installing deps..."
  npm install --no-audit --no-fund
fi

# 3. package the app (dir only)
echo "==> packaging app..."
npx electron-builder --mac dmg --dir

# 4. electron-builder's extraResources silently skips "node_modules";
#    copy the kernel tree into the .app manually.
APP="$(find "$HERE/dist" -maxdepth 2 -name "*.app" -type d | head -1)"
if [ -z "$APP" ]; then
  echo "ERROR: packaged .app not found under dist/" >&2
  exit 1
fi
RES="$APP/Contents/Resources"
SRC="$HERE/runtime/node_modules"
DST="$RES/runtime/node_modules"
echo "==> copying runtime node_modules into $APP ..."
rm -rf "$DST"
cp -R "$SRC" "$DST"

# 5. build dmg from the prepackaged .app
echo "==> building dmg..."
npx electron-builder --mac dmg --prepackaged "$APP"

echo ""
echo "BUILD_DONE"
echo "Installer: $HERE/dist/"$(ls dist | grep -i dmg)
echo "Update meta (if any): dist/latest-mac.yml"
