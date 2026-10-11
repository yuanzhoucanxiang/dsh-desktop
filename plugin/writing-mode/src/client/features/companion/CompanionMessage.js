import { memo } from 'react'
import * as jsx from 'react/jsx-runtime'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { rewriteJumpLinks, parseJumpHref } from './jump.js'
import { parseChoiceBlock } from './choices.js'

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
// onChoose 与 onJumpToFile 同样进闭包：memo 依赖它们的稳定性（调用方 useCallback 保证）
export const CompanionMessage = memo(function CompanionMessage({ text, kind, onJumpToFile, onChoose }) {
  if (kind !== 'assistant') return jsx.jsx('div', { className: 'dshWmMessageText', children: text })
  // 「【选择】」块（2026-10-11）：伙伴按人设约定把选项放在回复末尾，这里把它从正文里摘掉、渲染成按钮
  // （摘掉是为了不重复——文字里已经列过一遍）。解析不出来就原样显示，不猜、不误伤普通列表。
  const choice = parseChoiceBlock(text)
  const markdown = jsx.jsx(Markdown, {
    remarkPlugins: plugins,
    components: components(onJumpToFile),
    skipHtml: true,
    urlTransform: urlPolicy,
    children: rewriteJumpLinks(choice ? choice.body : text || ''),
  }, 'md')
  if (!choice) return jsx.jsx('div', { className: 'dshWmMessageText dshWmMarkdown', children: markdown })
  return jsx.jsxs('div', {
    className: 'dshWmMessageText dshWmMarkdown',
    children: [
      markdown,
      jsx.jsx('div', {
        className: 'dshWmChoices',
        children: choice.options.map((label) => jsx.jsx('button', {
          type: 'button',
          className: 'dshWmChoice',
          'data-wm-choice': label,
          onClick: () => { if (onChoose) onChoose(label) },
          children: label,
        }, label)),
      }, 'ch'),
    ],
  })
})
