# Full build: self-contained runtime + NSIS installer
# Usage: powershell -ExecutionPolicy Bypass -File build.ps1
#
# IMPORTANT - keep this file ASCII-only.
# Windows PowerShell 5.1 reads a .ps1 without a UTF-8 BOM as ANSI/GBK. Non-ASCII
# comments then decode as double-byte chars that can swallow the line ending and
# break the parser. Editors/agents routinely rewrite files without a BOM, so the
# only durable fix is: no non-ASCII bytes in this script. (This actually bit us:
# adding Chinese comments here produced "Unexpected token" and the build died.)
$ErrorActionPreference = 'Stop'
$proj = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $proj

# 1. prepare self-contained runtime (global dsh tree + node.exe) if missing
if (-not (Test-Path "$proj\runtime\node.exe")) {
  & powershell -ExecutionPolicy Bypass -File "$proj\prepare-runtime.ps1"
  if ($LASTEXITCODE -ne 0) { throw "prepare-runtime.ps1 failed (exit $LASTEXITCODE)" }
}

# 2. package app (dir only -> dist/win-unpacked; no implicit publishing)
# NOTE: PowerShell does NOT stop on a native command's non-zero exit
# ($ErrorActionPreference does not cover native exes), so every step below checks
# $LASTEXITCODE explicitly. Without this the script kept going after a failed
# NSIS step, printed BUILD_DONE, and left the PREVIOUS installer in dist/ --
# which looked like a successful build. That really happened; do not remove.
& "$proj\node_modules\.bin\electron-builder.cmd" --dir --publish never
if ($LASTEXITCODE -ne 0) { throw "electron-builder --dir failed (exit $LASTEXITCODE)" }

# 3. complete the runtime: electron-builder's extraResources silently skips
#    any directory named "node_modules", so copy it in manually.
$src = "$proj\runtime\node_modules"
$dst = "$proj\dist\win-unpacked\resources\runtime\node_modules"
Write-Host "copying runtime node_modules into win-unpacked..."
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
Copy-Item $src $dst -Recurse -Force

# 3b. app-update.yml: required by electron-updater at download/install time;
#     the two-step (--dir then --prepackaged) flow does not generate it.
$updYml = @"
provider: github
owner: yuanzhoucanxiang
repo: dsh-desktop
updaterCacheDirName: dsh-desktop-updater
"@
[System.IO.File]::WriteAllText("$proj\dist\win-unpacked\resources\app-update.yml", $updYml)
Write-Host "app-update.yml written"

# 4. build NSIS installer from the now-complete prepackaged dir.
#    Delete any same-version installer first: if the NSIS step fails, a stale
#    artifact left behind can fool later verification into "it built fine".
#    Read the version with node, never with PowerShell's ConvertFrom-Json --
#    PS 5.1 fails to parse package.json because of its non-ASCII description.
$ver = (& node -p "require('./package.json').version").Trim()
if (-not $ver) { throw "cannot read version from package.json" }
$setup = "$proj\dist\dsh-desktop-$ver-setup.exe"
if (Test-Path $setup) { Remove-Item $setup -Force }
& "$proj\node_modules\.bin\electron-builder.cmd" --win nsis --prepackaged "$proj\dist\win-unpacked" --publish never
if ($LASTEXITCODE -ne 0) { throw "electron-builder --win nsis failed (exit $LASTEXITCODE)" }
if (-not (Test-Path $setup)) { throw "NSIS step produced no installer at $setup" }

# 5. latest.yml (Windows auto-update manifest): --publish never does not emit it,
#    so generate it here, otherwise electron-updater reports
#    "Cannot find latest.yml ... 404" when checking for updates.
#    The node script derives the version from package.json itself.
& node "$proj\gen-update-manifest.js"
if ($LASTEXITCODE -ne 0) { throw "gen-update-manifest.js failed (exit $LASTEXITCODE)" }

Write-Host "BUILD_OK version=$ver installer=$setup"
Write-Host "BUILD_DONE"
