/**
 * 写作伙伴的提示词模板（P1-① 从 app/WritingModeApp.js 搬出；文案与行为不变）。
 */

/** 把文稿/选区交给写作伙伴修订。payload 为空时退回"帮我完善当前文稿"。 */
export function assistantPrompt(payload) {
  return payload
    ? `请作为写作助手处理下面的文稿：\n\n${payload}`
    : '请作为写作助手，帮我完善当前文稿。'
}

/** 把评审报告交给写作主理按报告修订。 */
export function reviewPrompt({ reportContent, reportPath }) {
  return (
    '请作为写作主理，严格按下列评审报告修订对应文稿（只改 draft/bible/outline/state，报告本身不要改）。\n' +
    '先读报告与 draft 当前版本，再输出修改计划并执行；完成后把新版本号写入 project.md。\n\n' +
    '=== 评审报告 ===\n' +
    reportContent +
    '\n\n=== 报告路径 ===\n' +
    reportPath +
    '\n'
  )
}
