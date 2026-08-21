# Prepare self-contained kernel runtime: hoisted npm install (short paths) + node.exe
# Usage: powershell -ExecutionPolicy Bypass -File prepare-runtime.ps1
$ErrorActionPreference = 'Stop'
$proj = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtime = Join-Path $proj 'runtime'
$nodeExe = (Get-Command node).Source

# 项目本地 npm 缓存（避免污染全局、也规避沙箱缓存路径问题）
$env:NPM_CONFIG_CACHE = Join-Path $proj '.npm-cache'

Write-Host "installing dsh (hoisted) into runtime..."
Remove-Item $runtime -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
Set-Content -Path (Join-Path $runtime 'package.json') -Value '{ "dependencies": { "@deepseek-ai/dsh": "0.1.1-rc.1" } }'
Push-Location $runtime
npm install --no-audit --no-fund --registry=https://registry.npmmirror.com
Pop-Location

Write-Host "pruning dev artifacts (.d.ts/.map/.ts)..."
Get-ChildItem $runtime -Recurse -File -Include *.d.ts, *.d.ts.map, *.map, *.ts -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

# Prune pathologically deep paths (defense in depth). A nested package can exceed
# Windows MAX_PATH; such files cannot be renamed by the NSIS uninstaller, which makes
# every update abort with exit code 2 ("Failed to uninstall old application files").
# Real runtime files never need a path longer than ~250 chars - deeper ones are
# self-referential package copies and safe to drop.
Get-ChildItem $runtime -Recurse -Force -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName.Length -gt 250 } |
  Sort-Object { $_.FullName.Length } -Descending |
  ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host "pruned paths longer than 250 chars"

Write-Host "copying node.exe..."
Copy-Item $nodeExe (Join-Path $runtime 'node.exe') -Force

$dshVer = (Get-Content (Join-Path $runtime 'node_modules\@deepseek-ai\dsh\package.json') | ConvertFrom-Json).version
@{ dsh = $dshVer; node = (node -v); builtAt = (Get-Date -Format o) } | ConvertTo-Json | Set-Content (Join-Path $runtime 'runtime.json')
$size = (Get-ChildItem $runtime -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
$max = 0
Get-ChildItem $runtime -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { if ($_.FullName.Length -gt $max) { $max = $_.FullName.Length } }
Write-Host "runtime ready: dsh=$dshVer node=$(node -v) size=$([math]::Round($size,1))MB maxPath=$max"
