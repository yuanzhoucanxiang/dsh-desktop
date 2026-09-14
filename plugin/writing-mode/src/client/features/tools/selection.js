/**
 * 编辑器选区取值（P1-① 从 app/WritingModeApp.js 搬出；行为不变）。
 * 由闭包捕获 taRef/content 改为显式入参：{ ta, content }。
 * 语义（chat E2E 断言）：有选区就只取选区；无选区退化为光标前后窗口；都取不到才退前 4000 字。
 */
export function selectionText({ ta, content }) {
  if (!ta) return content.slice(0, 4000)
  const s = ta.selectionStart
  const e = ta.selectionEnd
  if (typeof s === 'number' && typeof e === 'number' && e > s) {
    return content.slice(s, e)
  }
  return content.slice(Math.max(0, (s || 0) - 400), (s || 0) + 1600) || content.slice(0, 2000)
}
