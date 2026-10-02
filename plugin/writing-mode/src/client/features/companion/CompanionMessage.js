import { memo } from 'react'
import * as jsx from 'react/jsx-runtime'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rewriteJumpLinks, parseJumpHref } from './jump.js'

// Links use the desktop shell's existing external-browser policy.
// v0.1.40 的旧决策是「模型输出不能导航编辑器」；本版起改为**点击制**跳回：
// [[文稿名]] 只渲染成 chip，作者点了才跳，且目标只能解析到作者自己的库内文件
// （见 jump.js——解析不到就停在原地提示）。模型文字本身仍然移动不了编辑器。
function webLink(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : ''
  } catch { return '' }
}

function urlPolicy(url) {
  if (webLink(url)) return webLink(url)
  if (parseJumpHref(String(url ?? ''))) return String(url)
  return ''
}

function MessageLink({ href, children, onJumpToFile }) {
  const jumpName = parseJumpHref(href)
  if (jumpName) {
    return jsx.jsx('button', {
      type: 'button',
      className: 'dshWmJumpRef',
      'data-wm-jump-ref': jumpName,
      title: '跳到这篇文稿',
      onClick: () => { if (onJumpToFile) onJumpToFile(jumpName) },
      children,
    })
  }
  const safe = webLink(href)
  return safe
    ? jsx.jsx('a', { href: safe, target: '_blank', rel: 'noopener noreferrer', children })
    : jsx.jsx('span', { children })
}

const plugins = [remarkGfm]
// onJumpToFile 进闭包：memo 依赖它的稳定性（调用方 useCallback 保证）
const components = (onJumpToFile) => ({
  a: (props) => jsx.jsx(MessageLink, { ...props, onJumpToFile }),
  // Do not turn a streamed image URL into an automatic network request. The
  // author can open it explicitly, just like other source links.
  img: ({ src, alt }) => jsx.jsx(MessageLink, { href: src, children: alt || '查看图片' }),
  table: ({ children }) => jsx.jsx('div', {
    className: 'dshWmMarkdownTable', tabIndex: 0, role: 'region', 'aria-label': '表格，可横向滚动',
    children: jsx.jsx('table', { children }),
  }),
})

// Finished messages do not need to reparse when the input or a later streaming
// message changes. Raw author text and candidate source snapshots stay intact.
export const CompanionMessage = memo(function CompanionMessage({ text, kind, onJumpToFile }) {
  if (kind !== 'assistant') return jsx.jsx('div', { className: 'dshWmMessageText', children: text })
  return jsx.jsx('div', {
    className: 'dshWmMessageText dshWmMarkdown',
    children: jsx.jsx(Markdown, {
      remarkPlugins: plugins,
      components: components(onJumpToFile),
      skipHtml: true,
      urlTransform: urlPolicy,
      children: rewriteJumpLinks(text || ''),
    }),
  })
})
