; ════════════════════════════════════════════════════════════════════════════
; 自定义 NSIS 片段（由 package.json 的 build.nsis.include 引入）
;
; 为什么需要它：
;   electron-builder 默认的 CHECK_APP_RUNNING 在发现应用还在跑时会弹窗
;   （$(appRunning) / $(appCannotBeClosed)）要求用户"先完全关闭应用"。
;   本应用有两个特点，会让这个弹窗几乎必然出现：
;     1. 默认「关闭窗口 = 最小化到托盘」——用户以为退出了，进程其实还活着；
;     2. 内核是从**安装目录内**运行的 node.exe（resources\runtime\node.exe），
;        它不退出就一直锁着安装目录里的文件，安装器覆盖不了。
;   官方给了覆盖点：定义 customCheckAppRunning 宏，默认那套就不会插入
;   （见 app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh:37）。
;
; 这里的策略：不问用户，直接把「我们自己的」进程收干净再继续装。
;   · 应用主进程/helper：按可执行文件名先温和关闭、再强杀（都是本应用的进程）
;   · 内核 node.exe：**只杀可执行路径位于本次安装目录内**的那些，
;     绝不碰用户机器上其它 node 进程（用 PowerShell 按 ExecutablePath 精确过滤）
;
; 可用变量（由 CHECK_APP_RUNNING 在分派前准备好）：$CmdPath、$PowerShellPath
; ════════════════════════════════════════════════════════════════════════════

!macro customCheckAppRunning
  ; 编译期回声：构建日志里看到这行，就证明本文件真的被 electron-builder 编进安装器了。
  ; 注意：本文件是 UTF-8 无 BOM，makensis 可能按 ANSI 读 —— 所以**所有会显示给用户的
  ; 字符串一律用 ASCII**（中文注释不影响编译，但 DetailPrint/warning 用中文会变乱码）。
  !warning "DSH: customCheckAppRunning override is active (no 'please close the app' prompt)"
  DetailPrint "Closing running ${PRODUCT_NAME} processes..."

  ; 1) 先给主进程一个体面退出的机会（能落盘设置）
  ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  Sleep 1500

  ; 2) 还在就强杀（含渲染/GPU helper，都是同名进程）
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    DetailPrint "Force closing ${APP_EXECUTABLE_FILENAME}..."
    ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    Sleep 800
  ${EndIf}

  ; 3) 关键一步：内核 node.exe 跑在安装目录里，不收掉它文件就一直被占用。
  ;    只杀 ExecutablePath 在 $INSTDIR 下的 node.exe —— 精确到路径，不误伤。
  ${If} ${FileExists} "$INSTDIR\resources\runtime\node.exe"
    DetailPrint "Releasing kernel node.exe inside the install dir..."
    nsExec::ExecToLog '"$PowerShellPath" -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter $\"Name=$\'node.exe$\'$\" -ErrorAction SilentlyContinue | Where-Object { $$_.ExecutablePath -like $\'$INSTDIR\*$\' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
    Pop $R1
    Sleep 600
  ${EndIf}

  ; 4) 释放 nsProcess DLL，避免安装目录里留下占用
  ${nsProcess::Unload}
!macroend
