import MarkdownIt from 'markdown-it'
import createDOMPurify, { type WindowLike } from 'dompurify'

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false })
markdown.disable(['link', 'image', 'autolink'])

export function renderDesignerMarkdown(source: string, browserWindow: WindowLike): string {
  const rendered = markdown.render(source)
  return createDOMPurify(browserWindow).sanitize(rendered, {
    ALLOWED_TAGS: ['p', 'br', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote'],
    ALLOWED_ATTR: []
  })
}
