@echo off
rem Upgrade to 0.1.4 (pruned runtime, fixes uninstall): kill app, DELETE old dir, fresh install, verify, relaunch.
rem Double-click to run. Conversation pauses until the new app opens.
setlocal
set "DIR=C:\Users\DL\AppData\Local\Programs\DeepSeek Harness Desktop"
set "SETUP=E:\Deepseek harness\dsh-desktop\dist\dsh-desktop-0.1.4-setup.exe"

echo [1/5] Closing app...
taskkill /IM "DeepSeek Harness Desktop.exe" /F /T >nul 2>&1
timeout /t 3 /nobreak >nul
taskkill /IM "DeepSeek Harness Desktop.exe" /F /T >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/5] Removing old install (clears >260-char files)...
if exist "%DIR%" rmdir /s /q "%DIR%"
timeout /t 2 /nobreak >nul
if exist "%DIR%" (
  echo ERROR: install dir still exists - a process is locking it.
  pause
  exit /b 1
)

echo [3/5] Installing 0.1.4 (silent)...
if not exist "%SETUP%" (
  echo ERROR: installer not found: %SETUP%
  pause
  exit /b 1
)
start /wait "" "%SETUP%" /S
timeout /t 3 /nobreak >nul

echo [4/5] Verifying...
set "EXE=%DIR%\DeepSeek Harness Desktop.exe"
if not exist "%EXE%" (
  echo ERROR: app not found after install.
  pause
  exit /b 1
)
for /f "usebackq tokens=1" %%v in (`powershell -NoProfile -Command "(Get-Item '%EXE%').VersionInfo.FileVersion"`) do set "VER=%%v"
echo Installed version: %VER%
if exist "%DIR%\resources\app-update.yml" (echo Update config: OK) else (echo WARN: app-update.yml missing)

echo [5/5] Launching new version...
start "" "%EXE%"
echo Done. Restore this conversation from the session list.
timeout /t 5 /nobreak >nul
