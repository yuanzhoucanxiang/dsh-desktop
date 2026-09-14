# 写作模式 v2 已知问题与剩余边界（提交 b44c1c9，复核返工后）

> 本轮（复核退回后）已修：新包启动失败、旧消息被当受理证据、采用候选丢原稿、恢复另建会话、
> 备忘失败仍照发、同步越界、引用指纹丢失、矩阵缺 A01–A03。下面保留的是仍未做/仍有边界的部分。

按"影响 × 是否可绕过"排序。没有一项会让作者的稿件/设置处于风险中；未验证项见 `acceptance.md` 末表。

## 1. 两窗口并发只到 fixture 级，未做两个真实 Electron 窗口并发（重要）

- 现状：`connect()` 的跨窗口仲裁由 `lib/coordination.js`（真实 host 模块、真实文件锁）验证，
  进程内共用由 adapter 的 inflight 表验证；两者都在 fixture 里用**两个 adapter 实例**模拟两个窗口。
- 未覆盖：两个真实窗口同时首次关联同作品的端到端时序（IPC/渲染时序差异）。
- 为什么可以接受：协调记录是**跨进程持久**的，真正的仲裁依据（claim/confirm 与 token 语义）已在 host 层验证；
  渲染层差异不改变"只创建一个会话"的结论。
- 要补的话：加一套两窗口 Electron E2E（同时点"会话设置"），断言 `sessions.create` 只被调用一次。

## 2. 无法证明归属的历史遗留文件会一直留在 profile（设计如此）

- 现状：旧版（P1-② 之前）全量递归同步把 `test/`、`src/` 种进过用户机器；受管记录当时不存在，
  因此外壳**不会**删除它们（只在启动日志里上报"非受管文件保留 N 个"）。
- 影响：这几 KB 死文件长期存在，不影响功能；`verify:writing-package` 会把它列为 extra。
- 取舍：宁可留垃圾，也不删用户文件（方案明确要求"无法证明归属就保留并记录"）。

## 3. NSIS 安装未在隔离目录验证（NOT_RUN）

- 现状：本轮没有新构建安装包。`build.ps1` 把产物写在**工作区内** `dist/`，而 ZCode 会话会锁住
  `dist\win-unpacked\resources\app.asar`；工作区规则要求构建产物出 `%TEMP%`。
- 已覆盖：打包 filter ↔ manifest 静态逐文件一致；空环境冷启动（应用自行同步 plugin）与升级路径实测通过。
- 要补的话：在普通终端 `npm run dist`，然后
  `node scripts/verify-writing-package.mjs --package "<dist/win-unpacked>" --profile "<隔离 home>"`。

## 4. 离线加载未做受控网络限制（NOT_RUN）

本地资源、模式开启、编辑保存都不依赖网络（E2E 全在本地内核上跑），但没有构造受限网络环境来证明这一点。

## 5. 跨轮备忘去重未做（方案明确的前置条件未满足）

方案要求"仅在验证 compaction API 之后"才做去重优化。本轮**没有**去重逻辑，
因此每次发送都会带完整（预算内）备忘快照；压缩后的连续性不承诺。

## 6. 真实模型体验三场景未跑（NOT_RUN）

不索取密钥明文、不复制正式凭据到日志。已把场景脚本与判据写进 `preview.md`，拿到获授权的测试配置后可直接执行。

## 7. 作品目录移动后的备忘迁移未做

备忘按作品目录（realpath）落在 `<作品>/state/writing-memory.json`，随作品一起移动；
但**已存在的**备忘不会自动跟随目录改名生效，协调记录按作品身份的桶也不会迁移（会当成新作品）。
现状安全（不会串到别的作品），只是需要作者在移动后重新确认一次。

## 8. 窄窗口/超长历史未做专门视觉回归（PARTIAL）

样式与滚动行为有既有约束和部分 E2E 覆盖，但没有专门的窄窗口尺寸矩阵截图比对。

## 9. UI 层若干"未接到底"的入口

- `hasUnknown`（未知节点）已进快照，但 UI 只是照常渲染摘要，没有单独的"未知活动"视觉区分。
- 记忆历史的 before/after 对照只在文本不同时显示差异行，未做行级 diff。

— ox-alpha

## 10. NSIS 安装器未在隔离用户环境执行（NOT_RUN）

本轮已能**离线构建真包**（`scripts/rebuild-package-tmp.mjs`：electron-builder API + 本地 electron dist，
输出到 `%TEMP%`）并完成真包冷启动/首启种子/主题验收。安装器（`--win nsis --prepackaged`）会写注册表与
程序目录，未在隔离用户环境执行；需要时在**普通终端**（不在 ZCode 会话里，避免锁 `app.asar`）跑：

```bash
cd dsh-desktop
node scripts/rebuild-package-tmp.mjs                                   # 出 dir 包到 %TEMP%
WM_PKG=%TEMP%/wm-v2-rebuild-<ver> node scripts/verify-writing-packaged.mjs
node scripts/verify-writing-package.mjs --package "%TEMP%/wm-v2-rebuild-<ver>/win-unpacked"
# 需要安装器时：electron-builder --win nsis --prepackaged <dir包>/win-unpacked --publish never
```

## 11. 主题 UI 冒烟的断言口径（本轮修正）

旧断言查 `:root` 上的 `--dsw-alias-bg-base`（本内核该令牌不在 `:root`，实测恒为空串）与
`#palis-theme-crt`（新版 PALIS 设计已主动移除该覆盖层）——**结构上永远不可能通过**。
现改为验证真实契约：`data-palis-theme` 往返 + 注入样式表存在 + 调色值确实写在样式表里 + 关闭后移除。
开发态跑 ui-smoke 需要内置插件（palis）在隔离 profile 里，`verify:ui-smoke` 已用**生产种子模块**
（`lib/builtin-seed.js` + `dist/builtin-plugins`）装入，不再依赖用户机器上的插件。

## 12. C01 应用层拆分仍不完整（PARTIAL）

已做：`entry.js` 3526→165 行；`app/` 只留装配；`features/{editor,library,companion,memory,tools,settings}`、
`adapters/services/state/styles` 就位；会话获取与发送、草稿生命周期、备忘读写、引用来源、会话投影
均已走 adapter / 纯函数模块。
未做：`WritingModeApp.js` 仍有约 1.5k 行，内含新建项目与文稿、库切换、文字工具执行、保存定时与多块界面。
继续拆分要把这些块提成真正的组件/控制器（不是改名），每步都要有 E2E 兜底（现有三套 E2E + 原 32 条基线
+ 复核 UI 探针可作为安全网）。
