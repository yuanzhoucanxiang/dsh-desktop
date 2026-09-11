/**
 * 项目模板：新建项目时生成契约骨架（project.md + bible + outline）。
 * 结构对齐 CONTRACT.md 与 writing-studio 六阶段。
 */

/** @typedef {{ id:string, name:string, genre:string, description:string, form:'novel'|'screenplay'|'shortdrama', files: Array<{ rel:string, body:string }> }} ProjectTemplate */

const novelFiles = (title, premise) => [
  {
    rel: 'project.md',
    body: `# 立项书

作品名：${title}
形态：小说（长篇连载）
题材类型：
频道与受众：
目标平台：
篇幅体量：
一句话前提：${premise}
核心冲突：
主题：
风格基调：
视角人称：第三人称限知
更新节奏：
验收标准：单章 CJK 1800–3200；章末强钩；量化门禁全过；评审全绿放行。

## 小说线补充

金手指名称：
能力：
门槛：
代价：
如何推动主线：

## 进度

| 版本 | 状态 | 说明 |
|---|---|---|
`,
  },
  {
    rel: 'bible/world.md',
    body: `# 世界观

## 世界规则

## 势力 / 资源 / 局势

（随剧情更新世界状态）
`,
  },
  {
    rel: 'bible/characters.md',
    body: `# 角色卡

## 主角

| 字段 | 内容 |
|---|---|
| 身份 | |
| 外在目标 | |
| 深层需求 | |
| 核心恐惧 | |
| 缺陷 | |
| 底线 | |
| 语言指纹（句长/口头禅/语域/禁忌） | |
| 弧光 | |
`,
  },
  {
    rel: 'bible/relationships.md',
    body: `# 关系网

| 关系 | 起点 | 变化节点 | 现状 |
|---|---|---|---|
`,
  },
  {
    rel: 'bible/timeline.md',
    body: `# 事件时间线

| 时间 | 地点 | 发生了什么 | 涉及角色 | 造成的变化 |
|---|---|---|---|---|
`,
  },
  {
    rel: 'outline/structure.md',
    body: `# 卷纲

| 卷 | 名称 | 起止章 | 核心目标 | 情绪走向 | 冲突阶梯 |
|---|---|---|---|---|---|
`,
  },
  {
    rel: 'outline/units.md',
    body: `# 章纲

| 章号 | 章名 | 本章新事件 | 情绪值 | 因果链 | 伏笔 | 章末钩子 |
|---|---|---|---|---|---|---|
`,
  },
  {
    rel: 'outline/foreshadow.md',
    body: `# 伏笔台账

| 名称 | 埋设位置 | 计划回收 | 状态 | 陈旧度 |
|---|---|---|---|---|
`,
  },
  {
    rel: 'state/character-state.md',
    body: `# 角色状态

| 角色 | 当前目标 | 知道什么 | 不知道什么 | 资源伤势 | 关系变化 | 情绪 |
|---|---|---|---|---|---|---|
`,
  },
]

const screenplayFiles = (title, premise, formLabel) => [
  {
    rel: 'project.md',
    body: `# 立项书

作品名：${title}
形态：${formLabel}
题材类型：
目标平台：
一句话前提：${premise}
核心冲突：
主题：
风格基调：
验收标准：Fountain 六元素齐备；门禁全过；评审放行。

## 剧本线补充

logline：
主控思想（价值＋原因）：
载体：${formLabel}

## 进度

| 版本 | 状态 | 说明 |
|---|---|---|
`,
  },
  {
    rel: 'bible/world.md',
    body: `# 世界观

## 规则 / 禁止项

## 世界状态

`,
  },
  {
    rel: 'bible/characters.md',
    body: `# 角色卡

## 主角

| 字段 | 内容 |
|---|---|
| 身份 / 年龄 | |
| 外在目标 | |
| 深层需求 | |
| 核心恐惧 | |
| 语言指纹 | （句长、口头禅、禁忌词） |
| 弧光 | |
`,
  },
  {
    rel: 'bible/relationships.md',
    body: `# 关系网

| 关系 | 起点 | 变化节点 | 现状 |
|---|---|---|---|
`,
  },
  {
    rel: 'bible/timeline.md',
    body: `# 故事钟 / 时间线

| 时间 | 地点 | 事件 | 角色 | 变化 |
|---|---|---|---|---|
`,
  },
  {
    rel: 'outline/structure.md',
    body: `# 三幕骨架 + 节拍

（短剧可压缩为强卡点表；电影用 15 节拍）

| 节拍 | 落点（场次/秒） | 内容 |
|---|---|---|
| 开场钩子 | | |
| 激励事件 | | |
| 中点 | | |
| 第二幕衔接 | | |
| 结局 / 集尾卡点 | | |
`,
  },
  {
    rel: 'outline/units.md',
    body: `# 分场大纲

| 场号 | slugline | 目的 | 冲突 | 转折 | 角色 | 时长 |
|---|---|---|---|---|---|---|
`,
  },
  {
    rel: 'outline/foreshadow.md',
    body: `# 伏笔台账

| 名称 | 埋设 | 回收 | 状态 |
|---|---|---|---|
`,
  },
  {
    rel: 'state/character-state.md',
    body: `# 角色状态

| 角色 | 目标 | 已知 | 未知 | 关系 | 情绪 |
|---|---|---|---|---|---|
`,
  },
  {
    rel: 'draft/script/.gitkeep',
    body: '',
  },
]

/** @type {ProjectTemplate[]} */
export const PROJECT_TEMPLATES = [
  {
    id: 'novel',
    name: '小说 · 长篇连载',
    genre: '小说',
    form: 'novel',
    description: 'project + bible + 卷纲章纲 + 台账；正文走 draft/novel/ 第N章-vX.md',
    files: (title, premise) => novelFiles(title, premise),
  },
  {
    id: 'shortdrama',
    name: '短剧 · 竖屏',
    genre: '短剧',
    form: 'shortdrama',
    description: 'Fountain 第N集-vX；强卡点与分场表',
    files: (title, premise) => screenplayFiles(title, premise, '短剧（竖屏 9:16）'),
  },
  {
    id: 'screenplay',
    name: '电影 / 剧集',
    genre: '剧本',
    form: 'screenplay',
    description: 'Fountain actN-vX 或 第N集-vX；三幕 + 节拍',
    files: (title, premise) => screenplayFiles(title, premise, '电影／剧集'),
  },
]

export function getTemplate(id) {
  return PROJECT_TEMPLATES.find((t) => t.id === id) || PROJECT_TEMPLATES[0]
}

/** 生成项目文件列表（已替换标题/前提）。 */
export function renderTemplate(templateId, title, premise) {
  const t = getTemplate(templateId)
  const name = String(title || '未命名项目').trim() || '未命名项目'
  const p = String(premise || '').trim() || '（待补）'
  return {
    id: t.id,
    name: t.name,
    form: t.form,
    projectTitle: name,
    files: t.files(name, p),
  }
}

export function listTemplates() {
  return PROJECT_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    genre: t.genre,
    description: t.description,
    form: t.form,
  }))
}
