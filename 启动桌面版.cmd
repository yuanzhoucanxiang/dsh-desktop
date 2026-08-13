@echo off
rem DeepSeek Harness Desktop 启动脚本（双击运行，不残留控制台窗口）
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo 首次使用请先在项目目录运行: npm install
  pause
  exit /b 1
)
rem 注意：应用路径用 %~dp0. 结尾加点的写法，避免 %~dp0 尾部反斜杠
rem 让 cmd 把右引号转义成字面引号（经典坑）
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."