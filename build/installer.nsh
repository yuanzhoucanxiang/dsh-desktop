; ════════════════════════════════════════════════════════════════════════════
; 自定义 NSIS 片段（由 package.json 的 build.nsis.include 引入）
;
; 背景：electron-builder 默认的 CHECK_APP_RUNNING 一旦发现应用在跑，就弹窗要用户
; 手动关闭（allowOnlyOneInstallerInstance.nsh 行 120 $(appRunning) /
; 行 156 $(appCannotBeClosed)）。本应用有两个特点让它几乎必然出现：
;   1. 默认「关闭窗口 = 最小化到托盘」——用户以为退出了，进程其实还活着；
;   2. 内核是从**安装目录内**运行的 node.exe（resources\runtime\node.exe），
;      它不退出就一直锁着安装目录里的文件。
; 官方覆盖点是 customCheckAppRunning（同文件行 37 的 !ifmacrodef）。
;
; ⚠ v0.1.12 的教训（本文件第一版自己引入的回归，必须记住）：
;   · 只调用了**一次** nsProcess::KillProcess。Electron 是多进程，4~5 个同名进程
;     一次杀不干净 → 老卸载器（旧版本自带、不含本修复）自我中断、退出码 2 →
;     安装器报 "Failed to uninstall old application files ... : 2"。
;     ⇒ 改成 taskkill /F /T /IM（一次干掉所有同名进程）+ 循环校验直到没有。
;   · 只按 $INSTDIR 过滤内核 node.exe。但 uninstallOldVersion 用的是注册表里的
;     InstallLocation（installUtil.nsh 行 169），两者可能不同 ⇒ 过滤可能整个 no-op。
;     ⇒ 改成同时覆盖 $INSTDIR 与 HKCU/HKLM 的 InstallLocation。
;   · 上一版只验证了"宏被编进去了"，没验证"真的清干净了" ⇒ 现在每步都 DetailPrint，
;     并用重命名探测文件锁，把结论写进安装日志（失败时用户能直接把日志给我）。
;
; 可用变量：$CmdPath、$PowerShellPath（由 CHECK_APP_RUNNING 在分派前准备好）。
; 注意：本文件是 UTF-8 无 BOM，makensis 可能按 ANSI 读 ——
;       所有会显示给用户的字符串一律 ASCII，中文只写在注释里。
; ════════════════════════════════════════════════════════════════════════════

; 杀掉可执行路径位于 `dir` 之下的 node.exe（内核）；dir 为空/不存在时 PowerShell 侧自然跳过。
; 按路径前缀精确匹配，绝不动用户机器上其它 node 进程。
; 注意：不要用 ${dir} 拼 NSIS 标签名 —— 展开后会得到带 $ 的非法标签（第一版踩过）。
!macro DshKillKernelUnder dir
  nsExec::ExecToLog '"$PowerShellPath" -NoProfile -ExecutionPolicy Bypass -Command "$$root=$\'${dir}$\'; if ($$root -and (Test-Path -LiteralPath $$root)) { Get-CimInstance Win32_Process -Filter $\"Name=$\'node.exe$\'$\" -ErrorAction SilentlyContinue | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$root,$\'OrdinalIgnoreCase$\') } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue } }"'
  Pop $R1
  DetailPrint "DSH: kernel cleanup under ${dir} -> $R1"
!macroend

!macro customCheckAppRunning
  ; 编译期回声：构建日志出现这行 = 本文件真的被编进安装器/卸载器（不是"写了没生效"）。
  ; ⚠ 必须用 !echo 而不是 !warning —— electron-builder 给 makensis 开了"warning 即 error"，
  ;   用 !warning 会让 NSIS 编译直接失败（而 build.ps1 曾经不检查退出码，于是留着旧 exe
  ;   假装成功，把我骗过一次）。
  !echo "DSH: customCheckAppRunning override v2 is active (force-close, no prompt)"
  DetailPrint "DSH: closing running ${PRODUCT_NAME} and its kernel..."

  ; ── 1. 先给主进程一个体面退出的机会（能把设置落盘）────────────────────────
  ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  Sleep 1200

  ; ── 2. taskkill 一次干掉所有同名进程（主进程 + GPU/渲染 helper）───────────
  ;      /T 连子进程一起收，顺带带走作为子进程的内核 node.exe
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $R1
  DetailPrint "DSH: taskkill app -> $R1"
  Sleep 900

  ; ── 3. 循环校验：直到真的一个都不剩（最多 10 轮，约 7 秒）─────────────────
  StrCpy $R2 0
  dsh_kill_loop:
    IntOp $R2 $R2 + 1
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0                      ; 0 = 还找得到
      ${If} $R2 < 10
        nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
        Pop $R1
        Sleep 700
        Goto dsh_kill_loop
      ${Else}
        DetailPrint "DSH: WARNING app still present after $R2 attempts"
      ${EndIf}
    ${EndIf}
  DetailPrint "DSH: app closed after $R2 attempt(s)"

  ; ── 4. 内核 node.exe：三个候选目录都清（$INSTDIR 未必等于旧安装目录）─────
  ReadRegStr $R3 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R4 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  DetailPrint "DSH: kernel dirs: [$INSTDIR] [$R3] [$R4]"
  !insertmacro DshKillKernelUnder "$INSTDIR"
  !insertmacro DshKillKernelUnder "$R3"
  !insertmacro DshKillKernelUnder "$R4"
  Sleep 700

  ; ── 5. 验证文件锁真的没了：能重命名 = 没有句柄占着它 ──────────────────────
  StrCpy $R5 "$R3"
  ${If} $R5 == ""
    StrCpy $R5 "$INSTDIR"
  ${EndIf}
  ${If} ${FileExists} "$R5\resources\runtime\node.exe"
    ClearErrors
    Rename "$R5\resources\runtime\node.exe" "$R5\resources\runtime\node.exe.dshlock"
    ${If} ${Errors}
      DetailPrint "DSH: WARNING kernel node.exe still locked in $R5"
    ${Else}
      Rename "$R5\resources\runtime\node.exe.dshlock" "$R5\resources\runtime\node.exe"
      DetailPrint "DSH: kernel node.exe is free (no file lock)"
    ${EndIf}
  ${EndIf}

  ; ── 6. 释放 nsProcess DLL，别让它自己占住安装目录 ─────────────────────────
  ${nsProcess::Unload}
!macroend
