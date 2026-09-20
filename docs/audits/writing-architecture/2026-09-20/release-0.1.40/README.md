# v0.1.40 发布验收

- 发布标签：v0.1.40，提交 b6db6a4a1907ed8d6528564b1f9be4f9e37125c9。
- Windows 载荷构建于 e0096a8；后续 b6db6a4 仅修改控制器回归沙箱和文档，应用载荷不变。
- 严格门禁 verify:writing-all：19 步，退出码 0；真包 9/9。原始输出见 gate.log。日志中 dirty 包括测试结果回写、测试沙箱修复和已有未跟踪文件，并非未记录的应用改动。
- 发布前 manifest/asar 校验通过；上传时工作区已有后续开发改动，故另按标签复核全部 15 个发布文件（仅归一 Git LF / Windows CRLF）。结果与文件哈希见 tag-package.json。后续未提交代码未纳入发布。
- Windows 安装器：229978627 字节；SHA256 6e24484a028ba060ad06f782a5dc7ecb53dd5ce54eac908d8207b177a7041cfa。
- latest.yml 的文件名、字节数、SHA512 与安装器一致；远端清单与本地逐字节一致。
- macOS arm64 工作流成功：https://github.com/yuanzhoucanxiang/dsh-desktop/actions/runs/35482442949 。DMG 与 latest-mac.yml 已上传，未签名，未做 macOS 实机验收。
- NSIS 安装器已构建，尚未进行隔离安装；未替用户安装或关闭正式桌面。受控离线、长上下文压缩后续聊等未验收项仍按发布说明保留。

署名：Codex
发布完成：五项资产均 uploaded，Latest=v0.1.40；Windows 三件套远端大小及 SHA256 全部匹配，详见 remote-assets.json。
