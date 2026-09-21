# v0.1.41 发布验收

真实官方模型五类故事场景与两个真实窗口并发已通过，见 ../live/README.md。Windows NSIS构建完成，更新清单文件名/大小/SHA512一致；Windows资产哈希见 windows-assets.json。最终完整门禁及远端发布结果随后补记。

构建目录：%TEMP%/wm-release-0.1.41。NSIS隔离安装、macOS实机、受控离线等未验收项见 docs/releases/v0.1.41.md。署名：Codex

最终 verify:writing-all 21 步通过，退出0；真包9/9，17文件哈希一致。原始输出 gate.log。

发布标签 v0.1.41 指向 738066a28fb52d9d24240596bb02e753b2d60143（应用实现 b3a72eb，后续仅证据日志）。package.json 中包比对 PASS；其 profile NOT_RUN 指用户旧版默认 profile，未替换用户安装；门禁在全新隔离 profile 的17文件哈希已实际通过。

实际NSIS安装器已解包核对17文件与主进程依赖闭包；解出的应用在全新隔离环境SMOKE_OK（installer-payload.json / installer-smoke.json）。这不等于执行安装向导或验证注册表。

发布完成：v0.1.41 已公开并设为 Latest，五项资产均 uploaded；Windows三件套远端大小及SHA256与本地一致，Windows更新清单逐字节一致，macOS更新清单的版本/文件名/大小与DMG相符。macOS工作流35517832469成功，未做macOS实机验收。重复草稿已清理，仅保留Release 392470415。发布地址：https://github.com/yuanzhoucanxiang/dsh-desktop/releases/tag/v0.1.41 。
