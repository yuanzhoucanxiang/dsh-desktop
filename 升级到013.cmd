@echo off
rem Upgrade to 0.1.3 (fixed build): close app, install silently, verify, relaunch.
rem Double-click to run. The current conversation will pause until the new app opens.
setlocal
set "DIR=C:\Users\DL\AppData\Local\Programs\DeepSeek Harness Desktop"
set "SETUP=E:\Deepseek harness\dsh-desktop\dist\dsh-desktop-0.1.3-setup.exe"

echo [1/4] Closing app...
taskkill /IM "DeepSeek Harness Desktop.exe" /F /T >nul 2>&1
timeout /t 3 /nobreak >nul
taskkill /IM "DeepSeek Harness Desktop.exe" /F /T >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/4] Installing 0.1.3 (silent)...
if not exist "%SETUP%" (
  echo ERROR: installer not found: %SETUP%
  pause
  exit /b 1
)
start /wait "" "%SETUP%" /S
timeout /t 3 /nobreak >nul

echo [3/4] Verifying...
set "EXE=%DIR%\DeepSeek Harness Desktop.exe"
if not exist "%EXE%" (
  echo ERROR: app not found after install.
  pause
  exit /b 1
)
for /f "usebackq tokens=1" %%v in (`powershell -NoProfile -Command "(Get-Item '%EXE%').VersionInfo.FileVersion"`) do set "VER=%%v"
echo Installed version: %VER%
if not "%VER%"=="0.1.3" (
  echo WARN: version is %VER%, expected 0.1.3
)
if exist "%DIR%\resources\app-update.yml" (
  echo Update config: OK
) else (
  echo WARN: app-update.yml missing - auto-update download will fail!
)

echo [4/4] Launching new version...
start "" "%EXE%"
echo Done. Restore this conversation from the session list in the new app.
timeout /t 5 /nobreak >nul
