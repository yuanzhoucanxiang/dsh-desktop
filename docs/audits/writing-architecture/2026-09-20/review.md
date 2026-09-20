# 写作伙伴阅读体验改进（2026-09-20）

接续 [9 月 19 日独立复核与真实模型验收](../2026-09-19/review.md)。9 月 20 日经用户授权，代码、日志与验收材料纳入本次提交；尚未发布。

## 改动

- 独立写作右栏支持助手回复的标题、粗体、引用、列表、表格、代码与网页链接，不再显示成 Markdown 源码。
  `CompanionMessage` 是写作模式自己的组件，没有嵌入 Harness 的欢迎页或整套输入界面。
- 已完成消息以 React memo 避免随输入和后续流式消息反复解析；原始会话与候选文本保持不变。
- 网页链接由已有桌面外链机制打开；不执行原始 HTML，不自动请求模型输出里的图片 URL。
- 实际测试发现单行备忘输入框会去掉候选文本的换行，改为多行编辑。验证多段原文经编辑、保存仍保留换行与助手来源。
- 构建期加入 `react-markdown` / `remark-gfm`，随 client.js 打包，React 仍由 Harness 提供。
  采用库的组件渲染方式，未使用 `dangerouslySetInnerHTML`（[库文档](https://github.com/remarkjs/react-markdown)）。
  构建按实际依赖集合保留第三方许可证注释；生成文件为 692,373 字节（上轮 218,177 字节），体积增长是明确成本。
- 新增 `verify:writing-reading`，接入 `verify:writing-all` 与 `verify:writing-quick`。严格门禁现为 19 步，快速入口为 18 步；本轮采用针对改动的检查，未把它报为全门禁重跑。

## 验证

| 验证 | 结果与范围 |
|---|---|
| 阅读测试 | 3 组 PASS：半截流式 Markdown→完整排版；原始候选编辑保存；侧栏与长历史 |
| 链接 / HTML / 图片 | 不安全协议无可点击链接；无 script/img 执行或自动图片请求；网页链接带新窗和 noopener |
| 侧栏几何 | 980 / 1280 / 1500 CSS 像素，长代码留在自身滚动区，消息与输入未超出侧栏 |
| 视觉查看 | 已打开检查 [980px](reading-980.png) 与测试结果；其他尺寸有几何证据，1500px 截图存档 |
| 聊天 UI 回归 | 5 组通过，包含候选编辑/确认后来源保留 |
| 草稿基线 | 33 条通过，见 baseline-ui-results.json |
| 真实内核 | 原生会话、输入共享和引用切换通过，见 native.log；本轮未新增模型请求 |
| 构建 / 架构 | 确定性、语法、模块边界、跨模块 import 检查及敏感性自检通过 |
| 新真包 | `%TEMP%/wm-reading-final-2026-09-20`，资源/插件逐文件匹配；冷启动、种子、主题等 9/9，见 packaged.log |

`package.json`（本目录）是包校验结果，不是 npm 项目。原正式 profile 仍为旧版，因此该结果的 profile 项是 NOT_RUN；真包隔离 profile 的比对在 packaged.log 中通过。

依赖检查记录：npm audit 报的 3 个 high 条目为 `@xmldom/xmldom`、`fast-uri`、`js-yaml`，与改动前 lockfile 版本相同，未在本轮做无关依赖升级。

## 可见预览与下一步

预览从新真包启动，路径与 PID 见 [preview/preview.json](preview/preview.json)。保留临时《灯塔来信》的六轮真实对话与 v1/v2，保持运行，由用户关闭。
9 月 19 日的预览进程在本轮开始时已经不在运行，没有关闭用户桌面。

本轮只改善阅读与多行候选编辑，没有给 AI 添加固定字数、回合、任务表或额外确认步骤。
实际模型回答偏长、经常报告内部文件路径的问题仍属于后续表达体验优化，尚未改 persona。
受控离线、NSIS 安装、macOS 实机、压缩后续聊、作品移动、跨 host 并发仍未验收。

署名：Codex
