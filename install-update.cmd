@echo off
REM Double-click helper: closes DeepSeek Harness Desktop (and its kernel node.exe),
REM then runs the newest dsh-desktop-*-setup.exe silently and restarts the app.
REM Keep this file ASCII-only (see the note in install-update.ps1).
setlocal
cd /d "%~dp0"
echo.
echo === DeepSeek Harness Desktop - update helper ===
echo.
echo Step 1: dry run (nothing will be changed)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-update.ps1" -DryRun %*
echo.
echo ---------------------------------------------------------------
echo The dry run above shows what is still running.
echo Press any key to close the app and INSTALL, or close this window to abort.
echo ---------------------------------------------------------------
pause >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-update.ps1" %*
echo.
echo Exit code: %ERRORLEVEL%
pause
