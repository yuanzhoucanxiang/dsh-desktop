# 可见隔离预览（2026-09-20）

实例已启动并**保持运行**，请由你关闭窗口。

元数据：[`preview.json`](./preview.json)

| 项 | 值（以 preview.json 为准） |
|---|---|
| 打包 | `%TEMP%\wm-world-settings-20260920\win-unpacked` |
| 可执行文件 | `...\DeepSeek Harness Desktop.exe` |
| 隔离 base | `%TEMP%\dsh-preview\writing-world-20260920-*` |
| DSH_HOME / DSH_DESKTOP_HOME / USER_DATA / LOCALAPPDATA | 均在 base 下 |
| 示例库 | `base\library`，示例项目「雾港夜航」 |
| 版本 | 仓库 `package.json` 0.1.40 + 工作树世界观实现（包内 plugin/writing-mode 含 setting-projection） |

## 建议试用（六步）

1. 打开写作模式，确认库根为预览库
2. 打开「雾港夜航」
3. 与写作伙伴讨论世界观（例如雾季禁航）
4. 勾选相关消息 →「选入整理」→「整理为设定」
5. 编辑候选 →「确认设定」
6. 查看 `bible/世界观整理.md` 与项目备忘；改设定后再聊，看注入是否只含结论+边界

与正式安装版并行（userData 隔离）。未发布、未替换正式版。

— 署名：ox-alpha
