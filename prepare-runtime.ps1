# Prepare self-contained kernel runtime: hoisted npm install (short paths) + node.exe
# Usage: powershell -ExecutionPolicy Bypass -File prepare-runtime.ps1
#
# KEEP THIS FILE ASCII-ONLY (same rule as build.ps1 / install-update.ps1 / release.ps1).
# Windows PowerShell 5.1 reads a .ps1 without a UTF-8 BOM as ANSI/GBK; non-ASCII bytes
# then decode as double-byte chars that can swallow the line ending and break the parser.
# Editors and agents routinely rewrite files without a BOM, so the only durable fix is:
# no non-ASCII bytes. scripts/verify-release-artifacts.mjs enforces this for every .ps1
# in the build/release path.
$ErrorActionPreference = 'Stop'
$proj = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtime = Join-Path $proj 'runtime'
$nodeExe = (Get-Command node).Source

# Project-local npm cache: keeps the global cache clean and sidesteps sandboxed
# cache-path problems. (U5: this comment used to be Chinese -- see the header.)
$env:NPM_CONFIG_CACHE = Join-Path $proj '.npm-cache'

Write-Host "installing dsh (hoisted) into runtime..."
Remove-Item $runtime -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
Set-Content -Path (Join-Path $runtime 'package.json') -Value '{ "dependencies": { "@deepseek-ai/dsh": "0.1.7-rc.2" } }'
Push-Location $runtime
# Official registry: the mirror lags/misses @deepseek-ai subpackages after a kernel bump
# (docs/kernel-upgrade-checklist.md section 1), and a half-installed kernel tree is fatal.
npm install --no-audit --no-fund --registry=https://registry.npmjs.org
Pop-Location

Write-Host "pruning dev artifacts (.d.ts/.map/.ts)..."
Get-ChildItem $runtime -Recurse -File -Include *.d.ts, *.d.ts.map, *.map, *.ts -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "copying node.exe..."
Copy-Item $nodeExe (Join-Path $runtime 'node.exe') -Force

$dshVer = (Get-Content (Join-Path $runtime 'node_modules\@deepseek-ai\dsh\package.json') | ConvertFrom-Json).version
@{ dsh = $dshVer; node = (node -v); builtAt = (Get-Date -Format o) } | ConvertTo-Json | Set-Content (Join-Path $runtime 'runtime.json')
$size = (Get-ChildItem $runtime -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
$max = 0
Get-ChildItem $runtime -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { if ($_.FullName.Length -gt $max) { $max = $_.FullName.Length } }
Write-Host "runtime ready: dsh=$dshVer node=$(node -v) size=$([math]::Round($size,1))MB maxPath=$max"
