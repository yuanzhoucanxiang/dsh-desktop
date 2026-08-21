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

# 2. pack the kernel runtime as a SINGLE archive + a version marker. The app unpacks
#    this to %LOCALAPPDATA% on first launch; the install dir then stays a thin shell,
#    so updates can directly overwrite it (no giant runtime tree to uninstall).
# NOTE: call System32\tar.exe by full path. Plain `tar` can resolve to Git Bash's
# /usr/bin/tar under npm's PATH, and that tar does not understand "E:\..." paths
# ("Cannot connect to E: resolve failed"). This bit the build once.
Write-Host "packing runtime -> dist/runtime.tar.gz ..."
if (Test-Path "$proj\dist\runtime.tar.gz") { Remove-Item "$proj\dist\runtime.tar.gz" -Force }
$sysTar = "$env:SystemRoot\System32\tar.exe"
if (-not (Test-Path $sysTar)) { throw "System32\tar.exe not found" }
& $sysTar -czf "$proj\dist\runtime.tar.gz" -C "$proj" runtime
if ($LASTEXITCODE -ne 0) { throw "tar pack failed (exit $LASTEXITCODE)" }
Copy-Item "$proj\runtime\runtime.json" "$proj\dist\runtime-marker.json" -Force
Write-Host "runtime packed ($(([math]::Round((Get-Item "$proj\dist\runtime.tar.gz").Length/1MB,1))) MB)"

# 3. package app (dir only -> dist/win-unpacked; no implicit publishing)
# NOTE: PowerShell does NOT stop on a native command's non-zero exit
# ($ErrorActionPreference does not cover native exes), so every step below checks
# $LASTEXITCODE explicitly. Without this the script kept going after a failed
# NSIS step, printed BUILD_DONE, and left the PREVIOUS installer in dist/ --
# which looked like a successful build. That really happened; do not remove.
& "$proj\node_modules\.bin\electron-builder.cmd" --dir --publish never
if ($LASTEXITCODE -ne 0) { throw "electron-builder --dir failed (exit $LASTEXITCODE)" }

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
