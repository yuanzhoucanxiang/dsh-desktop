# Full build: self-contained runtime + NSIS installer
# Usage: powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
$proj = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $proj

# 1. prepare self-contained runtime (global dsh tree + node.exe) if missing
if (-not (Test-Path "$proj\runtime\node.exe")) {
  & powershell -ExecutionPolicy Bypass -File "$proj\prepare-runtime.ps1"
}

# 2. package app (dir only -> dist/win-unpacked; 禁用隐式发布)
& "$proj\node_modules\.bin\electron-builder.cmd" --dir --publish never

# 3. complete the runtime: electron-builder's extraResources silently skips
#    any directory named "node_modules", so copy it in manually.
$src = "$proj\runtime\node_modules"
$dst = "$proj\dist\win-unpacked\resources\runtime\node_modules"
Write-Host "copying runtime node_modules into win-unpacked..."
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
Copy-Item $src $dst -Recurse -Force

# 3b. app-update.yml：electron-updater 下载/安装阶段必需，而 --dir 两步法不会生成它
$updYml = @"
provider: github
owner: yuanzhoucanxiang
repo: dsh-desktop
updaterCacheDirName: dsh-desktop-updater
"@
[System.IO.File]::WriteAllText("$proj\dist\win-unpacked\resources\app-update.yml", $updYml)
Write-Host "app-update.yml written"

# 4. build NSIS installer from the now-complete prepackaged dir
& "$proj\node_modules\.bin\electron-builder.cmd" --win nsis --prepackaged "$proj\dist\win-unpacked" --publish never

# 5. latest.yml（Windows 自动更新清单）——`--publish never` 不会生成它，这里手动补齐，
#    否则 electron-updater 检查更新时会报 "Cannot find latest.yml ... 404"。
$ver = (Get-Content "$proj\package.json" | ConvertFrom-Json).version
$setup = Join-Path $proj "dist\dsh-desktop-$ver-setup.exe"
if (-not (Test-Path $setup)) { throw "installer not found: $setup" }
& node "$proj\gen-update-manifest.js" $setup

Write-Host "BUILD_DONE"
