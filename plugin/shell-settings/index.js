/**
 * Host half of the shell-settings bridge plugin. All UI lives in client.js.
 *
 * 桌面外壳在内核 Web 设置的「插件」分区贡献一个「桌面外壳」标签页：
 * 展示外壳版本与更新状态，并提供「打开桌面设置 / 检查更新 / 重启并安装」。
 * 数据与动作全部经外壳 preload 暴露的 window.dshShell 桥（内核零修改：
 * 本插件只消费官方 settings.plugins.tab 插槽契约，不碰内核私有 DOM）。
 *
 * 宿主半侧无需任何内核服务——保持最小可挂载形状即可（UI 全在浏览器侧）。
 */
export const name = 'shell-settings'
export const inject = []
export function apply(_ctx) {}
