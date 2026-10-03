'use strict'

/**
 * 协议无关的「同源」判据（零 Electron 依赖，可被普通 node 单测）。
 *
 * 为什么需要：WHATWG URL 对**非标准协议**（我们自注册的 `dsh-app:` 就是）返回
 * `origin === 'null'`，而 `new URL('dsh-app://app/...').origin === 'null'` 与常量
 * `APP_ORIGIN = 'dsh-app://app'` 永远不相等。直接拿 `.origin` 比会在协议模式下
 * 把所有 dsh-app 地址判成"不同源"——表现为页内链接点了不跳转、`sendToFocused`
 * 永远不发命令（2026-10-03 做作品档案窗口时撞出来）。
 *
 * 这里退一步用 `protocol + '//' + host` 作键：标准协议下与 origin 同形
 * （`http://127.0.0.1:4567`），非标准协议下也能得到 `dsh-app://app`。
 */

function originKey(url) {
  try {
    const u = new URL(String(url))
    if (u.origin && u.origin !== 'null') return u.origin
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

/** 两个地址是否同源（任一侧解析失败一律算不同源，宁严不松）。 */
function sameOrigin(a, b) {
  const ka = originKey(a)
  const kb = originKey(b)
  return Boolean(ka) && ka === kb
}

module.exports = { originKey, sameOrigin }
