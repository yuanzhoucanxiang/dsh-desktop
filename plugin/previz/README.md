# `@dsh-local/previz` —— 白模预演模式（P0 demo）

把 `blender-previz` 的 P0 引擎包成工作台的一个外部工具型模式。**它只是兼容外壳**：
引擎本身可直接用 `blender-previz/scripts/previz.mjs` 或 `lib/pipeline.mjs` 调用，不需要工作台。

- **直接调用**：`node scripts/previz.mjs demo fixtures/boutique --out demo-out`（在 `blender-previz` 下）；
  也可先 `previz import storyboard.csv` 生成 `shots.json` 再跑。本插件 host 也调 vendored 的 `engine/scripts/run-demo.mjs`。
- **状态**：探测 Blender / ffmpeg（3s 有界、2s 缓存），接缝/瓷砖显示「Blender 未启动 / 渲染中 42%」；
- **任务**：一个「运行 demo」= 构建 + 渲染 + 编码 + QC；可取消（只杀自己 spawn 的进程树）；
- **产物**：animatic.mp4、`animatic_burnin.mp4`（有则列出）、俯视平面图、3×3 接触表（带镜号/首中尾标签）、QC 报告、facts、`shots.csv`、`timeline.otio`、每镜 mp4；
- **P1 质量**：引擎已做遮挡/越轴/屏幕方向/脚部接触 QC；工作台面板只展示产物，烧字用 `previz burn-in`；
- **预览**：面板里直接播 animatic / 看平面图；要实时拖机位点「打开 Blender」。

## 目录

```text
plugin/previz/
  index.js              # host：/api/previz?route=state|probe|demo|cancel|open-blender|artifact
  client.js             # 构建产物（npm run build:previz）
  src/client/           # entry / mode / panel / entry / overlay / store / api
  lib/http.js           # 环回 + Host/Origin + body 读取（复制自 workbench，不跨插件 import）
  engine/               # vendored blender-previz 运行时子集（lib/blender/scripts/fixtures；不含测试）
  runtime-manifest.json # profile 同步清单
  test/host.mjs         # 纯函数/host 探测测试
```

## 开发

```powershell
cd E:\Deepseek harness\dsh-desktop
npm run build:previz
node plugin/previz/test/host.mjs
```

## 当前边界（P2 原型，别当成品）

- 只跑**固定的 boutique demo**（2 人 3 镜 9 秒），还没有项目选择/剧本导入；
- 引擎是 **vendored 副本**：源在 `E:\Deepseek harness\blender-previz`，改引擎要重新同步；
- 任务进度按日志行估算（20/45/70/90/99%），不是逐帧精确；
- 没有「最近产物」面板的跨模式入口；产物只在本模式面板里列；
- 预览是渲染结果，不是 Blender 实时视口；实时调整走「打开 Blender」；
- 工作台侧启动/取消/最近产物 UI 仍未做（模式面板里有自己的运行/取消按钮）。
