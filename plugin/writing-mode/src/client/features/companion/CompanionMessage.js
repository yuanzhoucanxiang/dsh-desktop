import { memo } from 'react'
import * as jsx from 'react/jsx-runtime'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Links use the desktop shell's existing external-browser policy. Manuscript
// paths remain readable text; a model response cannot navigate the editor.
function webLink(url) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : ''
  } catch { return '' }
}

function MessageLink({ href, children }) {
  const safe = webLink(href)
  return safe
    ? jsx.jsx('a', { href: safe, target: '_blank', rel: 'noopener noreferrer', children })
    : jsx.jsx('span', { children })
}

const plugins = [remarkGfm]
const components = {
  a: MessageLink,
  // Do not turn a streamed image URL into an automatic network request. The
  // author can open it explicitly, just like other source links.
  img: ({ src, alt }) => jsx.jsx(MessageLink, { href: src, children: alt || '查看图片' }),
  table: ({ children }) => jsx.jsx('div', {
    className: 'dshWmMarkdownTable', tabIndex: 0, role: 'region', 'aria-label': '表格，可横向滚动',
    children: jsx.jsx('table', { children }),
  }),
}

// Finished messages do not need to reparse when the input or a later streaming
// message changes. Raw author text and candidate source snapshots stay intact.
export const CompanionMessage = memo(function CompanionMessage({ text, kind }) {
  if (kind !== 'assistant') return jsx.jsx('div', { className: 'dshWmMessageText', children: text })
  return jsx.jsx('div', {
    className: 'dshWmMessageText dshWmMarkdown',
    children: jsx.jsx(Markdown, { remarkPlugins: plugins, components, skipHtml: true, urlTransform: webLink, children: text || '' }),
  })
})
