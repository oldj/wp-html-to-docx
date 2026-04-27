// 简化的 outerHTML 序列化：把 parse5 元素递归还原为字符串
// 仅供保留原文 MathML 用；不涉及完整 HTML 字符引用解析与命名空间处理

import { adapter, isElement, isTextNode, type ParsedElement } from '../parser/parseHtml.js'

export function serializeNode(node: ParsedElement): string {
  let inner = ''
  for (const child of adapter.getChildNodes(node)) {
    if (isTextNode(child)) {
      inner += child.value
      continue
    }
    if (isElement(child)) {
      inner += serializeNode(child)
    }
  }
  const attrs = node.attrs.map((a) => ` ${a.name}="${escapeAttr(a.value)}"`).join('')
  return `<${node.tagName}${attrs}>${inner}</${node.tagName}>`
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
