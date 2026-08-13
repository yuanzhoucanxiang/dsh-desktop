# Prepare self-contained kernel runtime: copy global dsh package tree + node.exe into runtime/
# Usage: powershell -ExecutionPolicy Bypass -File prepare-runtime.ps1
$ErrorActionPreference = 'Stop'
$proj = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtime = Join-Path $proj 'runtime'
$dshGlobal = Join-Path (npm root -g) '@deepseek-ai\dsh'
if (-not (Test-Path $dshGlobal)) { throw "global dsh not found: $dshGlobal" }
$nodeExe = (Get-Command node).Source

Write-Host "copying dsh kernel tree (with nested deps)..."
Remove-Item $runtime -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $runtime 'node_modules\@deepseek-ai') | Out-Null
Copy-Item $dshGlobal (Join-Path $runtime 'node_modules\@deepseek-ai\dsh') -Recurse -Force

Write-Host "copying node.exe..."
Copy-Item $nodeExe (Join-Path $runtime 'node.exe') -Force

$dshVer = (Get-Content (Join-Path $dshGlobal 'package.json') | ConvertFrom-Json).version
@{ dsh = $dshVer; node = (node -v); builtAt = (Get-Date -Format o) } | ConvertTo-Json | Set-Content (Join-Path $runtime 'runtime.json')
$size = (Get-ChildItem $runtime -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host "runtime ready: dsh=$dshVer node=$(node -v) size=$([math]::Round($size,1)) MB"
