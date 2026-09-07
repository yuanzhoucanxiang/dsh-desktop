#!/usr/bin/env bash
# One-shot macOS build: prepare runtime + pack runtime archive + build dmg installer.
# Run ON a Mac:  bash build-macos.sh
#
# Architecture note (thin shell since v0.1.17, mirror of build.ps1):
#   the install dir carries ONLY the shell; the kernel runtime travels as
#   resources/runtime.tar.gz (extraResources from dist/), which main.js
#   extracts to ~/Library/Application Support on first launch
#   (see ensureExternalRuntime). Do NOT inline-copy the node_modules tree
#   into the .app - that was the pre-v0.1.17 layout and is obsolete.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

# 本地/CI 默认不签名（无证书时 electron-builder 会报错）；正式分发再配 Apple 证书
export CSC_IDENTITY_AUTO_DISCOVERY=false

# 0. prerequisites
for c in node npm; do
  command -v "$c" >/dev/null || { echo "ERROR: $c not found (install Node.js first)" >&2; exit 1; }
done

# 1. self-contained runtime (darwin dsh + node binary + runtime.json)
if [ ! -x "$HERE/runtime/bin/node" ]; then
  echo "==> preparing runtime..."
  bash prepare-runtime-macos.sh
fi

# 1b. runtime archive (darwin content): electron-builder picks it via
#     extraResources from="dist/runtime.tar.gz". Without it the .app packs
#     without a kernel and first launch has nothing to extract.
echo "==> packing runtime -> dist/runtime.tar.gz ..."
mkdir -p "$HERE/dist"
tar -czf "$HERE/dist/runtime.tar.gz" -C "$HERE" runtime
cp "$HERE/runtime/runtime.json" "$HERE/dist/runtime-marker.json"
echo "==> runtime packed ($(du -sh "$HERE/dist/runtime.tar.gz" | cut -f1))"

# 2. dependencies (Electron darwin + electron-builder)
if [ ! -d node_modules/electron ]; then
  echo "==> installing deps..."
  npm install --no-audit --no-fund
fi

# 3. package the app (dir only; do NOT pass a dmg target here - this step must
#    not produce an installer, the dmg is built from the complete prepackaged
#    app in step 5)
echo "==> packaging app..."
npx electron-builder --dir --publish never

# 4. app-update.yml: electron-updater 下载/安装阶段必需，--dir 两步法不会生成它
APP="$(find "$HERE/dist" -maxdepth 2 -name "*.app" -type d | head -1)"
if [ -z "$APP" ]; then
  echo "ERROR: packaged .app not found under dist/" >&2
  exit 1
fi
RES="$APP/Contents/Resources"
cat > "$RES/app-update.yml" <<'EOF'
provider: github
owner: yuanzhoucanxiang
repo: dsh-desktop
updaterCacheDirName: dsh-desktop-updater
EOF
echo "==> app-update.yml written"

# 5. build dmg from the complete prepackaged .app
echo "==> building dmg..."
npx electron-builder --mac dmg --prepackaged "$APP" --publish never

# 5b. mac 更新清单：--publish never 不产出 latest-mac.yml，但 electron-updater
#     在 mac 上按 latest-mac.yml 检查/下载更新（缺它 = 检查更新 404）
echo "==> generating latest-mac.yml ..."
DMG="$(find "$HERE/dist" -maxdepth 1 -name '*.dmg' | head -1)"
if [ -n "$DMG" ]; then
  node "$HERE/gen-update-manifest.js" "$DMG" "" latest-mac.yml
fi

echo ""
echo "BUILD_DONE"
echo "Installer: $HERE/dist/"$(ls dist | grep -i dmg)
echo "Update meta (if any): dist/latest-mac.yml"
