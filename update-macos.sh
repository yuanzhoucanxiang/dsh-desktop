#!/usr/bin/env bash
# One-command macOS update: check latest release, download dmg, install (覆盖旧版), launch.
# Usage:
#   bash update-macos.sh              # 更新到最新 Release
#   bash update-macos.sh 0.1.1        # 更新到指定版本
# 前提：本机已装 gh 并登录（gh auth login），仓库为私有需有权限。
set -euo pipefail

REPO="yuanzhoucanxiang/dsh-desktop"
APP="/Applications/DeepSeek Harness Desktop.app"

# 1. 确定目标版本
if [ -n "${1:-}" ]; then
  TAG="v${1#v}"
else
  TAG="$(gh release list --repo "$REPO" --limit 1 --json tagName --jq '.[0].tagName')"
fi
LATEST="${TAG#v}"
echo "==> 目标版本: $TAG"

# 2. 已是最新则跳过
INSTALLED="$(defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "0")"
if [ "$INSTALLED" = "$LATEST" ]; then
  echo "==> 已是最新版本 $INSTALLED，无需更新"
  exit 0
fi

# 3. 下载 dmg
DMG="$(gh release view "$TAG" --repo "$REPO" --json assets --jq '.assets[].name' | grep -i '\.dmg$' | head -1)"
if [ -z "$DMG" ]; then
  echo "ERROR: 未在 $TAG 找到 dmg 资产" >&2
  exit 1
fi
echo "==> 下载 $DMG ..."
gh release download "$TAG" --repo "$REPO" --pattern "$DMG" --clobber

# 4. 挂载 + 覆盖安装
MP="/tmp/dsh-dmg"
echo "==> 安装到 /Applications ..."
hdiutil attach "$DMG" -nobrowse -quiet -mountpoint "$MP"
SRC_APP="$(find "$MP" -maxdepth 1 -name '*.app' -type d | head -1)"
if [ -z "$SRC_APP" ]; then
  hdiutil detach "$MP" -quiet || true
  echo "ERROR: dmg 里未找到 .app" >&2
  exit 1
fi
rm -rf "$APP"
cp -R "$SRC_APP" /Applications/
hdiutil detach "$MP" -quiet

# 5. 放行 Gatekeeper（未签名版必需）
xattr -cr "$APP" 2>/dev/null || true

# 6. 启动
echo "==> 已安装 v$LATEST，正在启动..."
open "$APP"
echo "DONE"
