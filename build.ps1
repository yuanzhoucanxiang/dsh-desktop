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

# 4. build NSIS installer from the now-complete prepackaged dir
& "$proj\node_modules\.bin\electron-builder.cmd" --win nsis --prepackaged "$proj\dist\win-unpacked" --publish never

Write-Host "BUILD_DONE"
