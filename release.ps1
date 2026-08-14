# Build installer and print GitHub Release upload commands.
# Usage: powershell -ExecutionPolicy Bypass -File release.ps1
$ErrorActionPreference = 'Stop'
$proj = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $proj

$owner = 'yuanzhoucanxiang'
$repo = 'dsh-desktop'
$ver = (Get-Content "$proj\package.json" | ConvertFrom-Json).version
$tag = "v$ver"
$exe = "dsh-desktop-$ver-setup.exe"

# 1. build (self-contained runtime + NSIS installer + latest.yml)
& powershell -ExecutionPolicy Bypass -File "$proj\build.ps1"

# 2. print upload commands (mac dmg 由 GitHub Actions build-macos 在打 tag 后自动构建并上传)
Write-Host ""
Write-Host "=== GitHub Release: 上传以下 dist/ 文件到 tag $tag ==="
Write-Host ""
Write-Host "--- via gh CLI ---"
Write-Host "gh release create $tag --repo $owner/$repo --title `"DeepSeek Harness Desktop $ver`" --notes `"Release $ver`""
Write-Host "gh release upload $tag --repo $owner/$repo --clobber `"dist\$exe`" `"dist\latest.yml`" `"dist\$exe.blockmap`""
Write-Host ""
Write-Host "--- 或网页手动 ---"
Write-Host "https://github.com/$owner/$repo/releases/new?tag=$tag"
Write-Host ""
Write-Host "NOTE: 版本号必须与 package.json 一致；发版前先 bump。latest.yml 已由 build.ps1 生成。"
