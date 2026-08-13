# Build installer and print GitHub Release upload commands.
# Usage: powershell -ExecutionPolicy Bypass -File release.ps1
$ErrorActionPreference = 'Stop'
$proj = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $proj

$owner = 'yuanzhoucanxiang'
$repo = 'dsh-desktop'
$ver = (Get-Content "$proj\package.json" | ConvertFrom-Json).version
$tag = "v$ver"

# 1. build (self-contained runtime + NSIS installer)
& powershell -ExecutionPolicy Bypass -File "$proj\build.ps1"

# 2. print upload commands
Write-Host ""
Write-Host "=== GitHub Release: upload these dist/ files as tag $tag ==="
Write-Host "1) installer : dist\DeepSeek Harness Desktop Setup $ver.exe"
Write-Host "2) metadata  : dist\latest.yml"
Write-Host "3) blockmap  : dist\DeepSeek Harness Desktop Setup $ver.exe.blockmap"
Write-Host ""
Write-Host "--- via gh CLI ---"
Write-Host "gh release create $tag --repo $owner/$repo --title `"DeepSeek Harness Desktop $ver`" --notes `"Release $ver`" `"dist\DeepSeek Harness Desktop Setup $ver.exe`" `"dist\latest.yml`" `"dist\DeepSeek Harness Desktop Setup $ver.exe.blockmap`""
Write-Host ""
Write-Host "--- or via web ---"
Write-Host "https://github.com/$owner/$repo/releases/new?tag=$tag"
Write-Host ""
Write-Host "NOTE: version must match package.json; bump it before each release."
