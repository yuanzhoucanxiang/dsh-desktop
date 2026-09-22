# v0.1.42 发布验收

源码提交：ac00c15d0f28c324397bd48fe08a36f001723fb0。标签 v0.1.42。Release ID 393502728。

Windows 在工作区外的 %TEMP%/dsh-release-0.1.42 快照构建：使用本地 Electron dist，先 dir，再生成 app-update.yml，再 NSIS，最后生成并严格核对 latest.yml。未修改内核，未替换正在运行的正式版。

- 新版本真包验收 9/9。
- NSIS 实际载荷解出：主进程与 19 个写作模式文件一致；8 PASS / 0 FAIL / 1 待跑（真实 profile 未同步）。
- 解出程序全隔离冷启动 SMOKE_OK，退出码 0。
- Windows 三项远端资产 size/SHA256 与本地一致；latest.yml version/size/SHA512 严格校验通过。
- 代码构建一致性、shell-hardening、git-review 本轮重跑通过；功能门禁 24 步为版本号变更前相同实现的整合验收。

尚不冒充完成：NSIS 安装向导交互与注册表安装、macOS 实机、完整 IPC 面、更新下载清单缺失时的强制哈希闭环。macOS CI 构建结果与最终公开状态后附。

署名：Codex，2026-09-22

2026-09-22：v0.1.42 已公开为 Latest，Release ID 393502728，代码 ac00c15。Windows 安装器/blockmap/latest.yml 与 macOS DMG/latest-mac.yml 五项资产全部 uploaded，size/SHA256 与两份清单 SHA512 一致；macOS CI 35695937072 成功。Windows 真包 9/9，NSIS 实际载荷冷启动 SMOKE_OK。未替换本机正式安装，预览保持运行。证据 docs/audits/release-0.1.42/。— Codex
