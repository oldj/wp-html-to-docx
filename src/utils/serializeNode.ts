// 简化的 outerHTML 序列化：把 parse5 元素递归还原为字符串
// 仅供保留原文 MathML 用；不涉及完整 HTML 字符引用解析与命名空间处理
//
// 注意：parse5 在解析时已把 HTML entities 解码为字面字符（如 `&lt;` → `<`），
// 因此重新拼出 XML 时必须把 `<`、`>`、`&` 转义回 entity，否则会产出非法 XML，
// 导致下游 mathml2omml 解析失败、整段 math 退回 [math] 占位

import { adapter, isElement, isTextNode, type ParsedElement } from '../parser/parseHtml.js'

export function serializeNode(node: ParsedElement): string {
  let inner = ''
  for (const child of adapter.getChildNodes(node)) {
    if (isTextNode(child)) {
      inner += escapeText(child.value)
      continue
    }
    if (isElement(child)) {
      inner += serializeNode(child)
    }
  }
  const attrs = node.attrs.map((a) => ` ${a.name}="${escapeAttr(a.value)}"`).join('')
  return `<${node.tagName}${attrs}>${inner}</${node.tagName}>`
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  // 属性值用双引号包裹：必须转 `"`；同时转 `<` 与 `&` 以保证整体合法
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}
