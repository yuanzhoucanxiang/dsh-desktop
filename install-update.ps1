# install-update.ps1 - deterministic installer runner for DeepSeek Harness Desktop
#
# WHY THIS EXISTS
#   The NSIS installer refuses to proceed (or the old uninstaller aborts with
#   exit code 2) whenever anything from the previous install is still alive:
#     * the app itself (closing its window only hides it to the tray!)
#     * its GPU/renderer helper processes (same exe name)
#     * the kernel node.exe, which runs FROM INSIDE the install dir and therefore
#       keeps a file lock on resources\runtime\node.exe
#   Doing that cleanup from INSIDE the installer is fragile: when the update is
#   started from the app, the installer is a CHILD of the app, so a tree-kill of
#   the app also kills the installer.
#   This script does the cleanup from OUTSIDE, then runs the installer silently,
#   then verifies the result. Nothing can "detect itself" as running.
#
# KEEP THIS FILE ASCII-ONLY.
#   Windows PowerShell 5.1 reads a .ps1 without a UTF-8 BOM as ANSI/GBK; non-ASCII
#   text then breaks the parser, and editors keep stripping the BOM. So: ASCII only.
#
# USAGE
#   powershell -ExecutionPolicy Bypass -File install-update.ps1 -DryRun
#       Report what it WOULD do. Changes nothing. Run this first if unsure.
#   powershell -ExecutionPolicy Bypass -File install-update.ps1
#       Use the newest dsh-desktop-*-setup.exe found in Downloads / script dir / dist.
#   powershell -ExecutionPolicy Bypass -File install-update.ps1 -Download
#       Fetch the latest installer from GitHub Releases first.
#   powershell -ExecutionPolicy Bypass -File install-update.ps1 -Installer "C:\path\to\setup.exe"
#   Extra switches: -NoLaunch (do not start the app afterwards)
#                   -Interactive (show the installer UI instead of silent /S)

param(
  [string]$Installer = '',
  [switch]$Download,
  [switch]$DryRun,
  [switch]$NoLaunch,
  [switch]$Interactive,
  [int]$LockTimeoutSec = 40
)

$ErrorActionPreference = 'Stop'
$APP_NAME  = 'DeepSeek Harness Desktop'
$APP_EXE   = "$APP_NAME.exe"
$REPO      = 'yuanzhoucanxiang/dsh-desktop'
$step      = 0

function Say([string]$msg) {
  $script:step++
  Write-Host ("[{0}] {1}" -f $script:step, $msg)
}
function Note([string]$msg) { Write-Host ("      {0}" -f $msg) }
function Fail([string]$msg) { Write-Host ""; Write-Host ("FAILED: {0}" -f $msg) -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- install dir
# Facts verified on a real machine (0.1.10 install):
#   HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<GUID>
#       DisplayName     = "DeepSeek Harness Desktop 0.1.10"   <- includes the version!
#       DisplayVersion  = "0.1.10"
#       UninstallString = "<dir>\Uninstall DeepSeek Harness Desktop.exe" /currentuser
#       InstallLocation = ""                                  <- empty here
#   HKCU\Software\<GUID>
#       InstallLocation = "C:\Users\<u>\AppData\Local\Programs\DeepSeek Harness Desktop"
# So: match DisplayName with -like, and take the directory from (in order)
# Software\<GUID>\InstallLocation, the Uninstall key's InstallLocation, or the
# parent folder of UninstallString.
function Get-InstallInfo {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    foreach ($key in Get-ChildItem $root -ErrorAction SilentlyContinue) {
      $p = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
      if (-not $p -or -not $p.DisplayName) { continue }
      if ($p.DisplayName -notlike "*$APP_NAME*") { continue }

      $dir = ''
      $hive = if ($root.StartsWith('HKCU')) { 'HKCU:' } else { 'HKLM:' }
      $guidKey = "$hive\Software\$($key.PSChildName)"
      if (Test-Path $guidKey) {
        $g = Get-ItemProperty $guidKey -ErrorAction SilentlyContinue
        if ($g -and $g.InstallLocation) { $dir = $g.InstallLocation }
      }
      if (-not $dir -and $p.InstallLocation) { $dir = $p.InstallLocation }
      if (-not $dir -and $p.UninstallString) {
        $u = ($p.UninstallString -replace '"', '').Trim()
        $u = ($u -split '\s+/')[0]
        if ($u) { $dir = Split-Path -Parent $u }
      }

      return [pscustomobject]@{
        Dir         = $dir
        Version     = $p.DisplayVersion
        DisplayName = $p.DisplayName
        Uninstaller = $p.UninstallString
        Key         = $key.PSPath
      }
    }
  }
  $guess = Join-Path $env:LOCALAPPDATA "Programs\$APP_NAME"
  if (Test-Path $guess) {
    return [pscustomobject]@{ Dir = $guess; Version = '(unknown)'; DisplayName = '(no registry entry)'; Uninstaller = ''; Key = '' }
  }
  return $null
}

# ---------------------------------------------------------------- installer file
function Resolve-Installer {
  if ($Installer) {
    if (-not (Test-Path $Installer)) { Fail "installer not found: $Installer" }
    return (Resolve-Path $Installer).Path
  }
  # NOTE: use $PSScriptRoot, not $MyInvocation.MyCommand.Path -- inside a function
  # the latter refers to the function, not the script, and comes back null.
  $here = $PSScriptRoot
  $dirs = @(
    (Join-Path $env:USERPROFILE 'Downloads'),
    $here,
    (Join-Path $here 'dist')
  ) | Where-Object { $_ -and (Test-Path $_) }
  $cand = @()
  foreach ($d in $dirs) {
    $cand += Get-ChildItem $d -Filter 'dsh-desktop-*-setup.exe' -File -ErrorAction SilentlyContinue
  }
  if (-not $cand) { return '' }
  return ($cand | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}

function Get-LatestFromGitHub {
  Say "downloading the latest installer from GitHub Releases..."
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
  $api = "https://api.github.com/repos/$REPO/releases/latest"
  $rel = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'dsh-desktop-installer' } -UseBasicParsing
  $asset = $rel.assets | Where-Object { $_.name -like '*-setup.exe' } | Select-Object -First 1
  if (-not $asset) { Fail "release $($rel.tag_name) has no *-setup.exe asset" }
  $out = Join-Path $env:TEMP $asset.name
  Note "$($rel.tag_name) -> $($asset.name) ($([math]::Round($asset.size/1MB,1)) MB)"
  if ($DryRun) { Note "DRY RUN: would download to $out"; return $out }
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $out -UseBasicParsing
  Note "saved: $out"
  return $out
}

# ---------------------------------------------------------------- process cleanup
function Get-AppProcesses {
  Get-Process -Name ([System.IO.Path]::GetFileNameWithoutExtension($APP_EXE)) -ErrorAction SilentlyContinue
}
function Get-KernelProcesses([string]$dir) {
  if (-not $dir) { return @() }
  $prefix = $dir.TrimEnd('\')
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, 'OrdinalIgnoreCase') }
}
function Test-FileUnlocked([string]$path) {
  if (-not (Test-Path $path)) { return $true }
  try {
    $fs = [System.IO.File]::Open($path, 'Open', 'ReadWrite', 'None')
    $fs.Close(); $fs.Dispose()
    return $true
  } catch { return $false }
}

# ================================================================ main
Write-Host ""
Write-Host "=== $APP_NAME - update helper ==="
Write-Host ""

Say "locating the current installation..."
$info = Get-InstallInfo
if ($info) {
  Note "name    : $($info.DisplayName)"
  Note "dir     : $($info.Dir)"
  Note "version : $($info.Version)"
  if ($info.Uninstaller) { Note "uninst  : $($info.Uninstaller)" }
} else {
  Note "no existing installation found (a fresh install is fine too)"
}

Say "locating the installer package..."
if ($Download) {
  $pkg = Get-LatestFromGitHub
} else {
  $pkg = Resolve-Installer
  if (-not $pkg) {
    Note "no dsh-desktop-*-setup.exe found in Downloads / script dir / dist"
    Note "re-run with -Download to fetch it, or pass -Installer <path>"
    Fail "installer package not found"
  }
}
Note "package : $pkg"

Say "checking what is still running..."
$apps = @(Get-AppProcesses)
$kern = @(Get-KernelProcesses $info.Dir)
Note ("app processes    : {0}" -f $apps.Count)
foreach ($p in $apps) { Note ("  pid {0}" -f $p.Id) }
Note ("kernel node.exe  : {0}" -f $kern.Count)
foreach ($p in $kern) { Note ("  pid {0}  {1}" -f $p.ProcessId, $p.ExecutablePath) }
$lockPath = if ($info) { Join-Path $info.Dir 'resources\runtime\node.exe' } else { '' }
if ($lockPath) {
  Note ("file lock on runtime node.exe : {0}" -f $(if (Test-FileUnlocked $lockPath) { 'free' } else { 'LOCKED' }))
}

if ($DryRun) {
  Write-Host ""
  Write-Host "DRY RUN - nothing was changed."
  Write-Host "Next: run the same command without -DryRun to close the app and install."
  exit 0
}

Say "closing the app (window close only hides it to the tray, so force it)..."
foreach ($p in $apps) { try { $null = $p.CloseMainWindow() } catch {} }
Start-Sleep -Milliseconds 1200
for ($i = 1; $i -le 15; $i++) {
  $left = @(Get-AppProcesses)
  if (-not $left) { break }
  foreach ($p in $left) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {} }
  Start-Sleep -Milliseconds 600
}
$left = @(Get-AppProcesses)
if ($left) { Fail ("app is still running after 15 attempts (pids: {0}). Try again from an elevated PowerShell." -f (($left | ForEach-Object { $_.Id }) -join ',')) }
Note "app closed"

Say "stopping the kernel node.exe inside the install dir..."
foreach ($p in @(Get-KernelProcesses $info.Dir)) {
  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Note ("killed pid {0}" -f $p.ProcessId) } catch {}
}
Note "only node.exe under the install dir is touched; other node processes are left alone"

Say "waiting for the file lock to clear..."
$deadline = (Get-Date).AddSeconds($LockTimeoutSec)
$free = $true
if ($lockPath) {
  while ((Get-Date) -lt $deadline) {
    if (Test-FileUnlocked $lockPath) { break }
    Start-Sleep -Milliseconds 500
  }
  $free = Test-FileUnlocked $lockPath
}
if (-not $free) {
  Note "still locked: $lockPath"
  Note "something outside this script holds it (antivirus / Explorer preview / another shell)"
  Fail "runtime node.exe is still locked after $LockTimeoutSec s"
}
Note "no file lock"

Say "running the installer..."
$args = @()
if (-not $Interactive) { $args += '/S' }
Note ("command : `"{0}`" {1}" -f $pkg, ($args -join ' '))
$proc = Start-Process -FilePath $pkg -ArgumentList $args -Wait -PassThru
Note ("installer exit code : {0}" -f $proc.ExitCode)
if ($proc.ExitCode -ne 0) {
  Note "non-zero exit. Re-run with -Interactive to watch the installer UI and read its details pane."
  Fail "installer returned $($proc.ExitCode)"
}

Say "verifying the installed version..."
Start-Sleep -Seconds 2
$after = Get-InstallInfo
if (-not $after) { Fail "cannot find the installation afterwards" }
Note "dir     : $($after.Dir)"
Note "version : $($after.Version)"
$exe = Join-Path $after.Dir $APP_EXE
if (-not (Test-Path $exe)) { Fail "app exe missing: $exe" }
$fileVer = (Get-Item $exe).VersionInfo.ProductVersion
Note "exe ProductVersion : $fileVer"
if ($info -and $info.Version -eq $after.Version) {
  Note "WARNING: registry version did not change ($($after.Version)) - the package may be the same build"
}

if (-not $NoLaunch) {
  Say "starting the app..."
  Start-Process -FilePath $exe | Out-Null
  Note "launched"
}

Write-Host ""
Write-Host "DONE. installed version = $($after.Version)"
exit 0
