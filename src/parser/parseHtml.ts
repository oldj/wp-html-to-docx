// parse5 包装：把 HTML 字符串解析成默认 tree-adapter 的 DOM 树
// parse5 自动补全 HTML5 隐式节点（如 tbody），保证 walker 处理简单

import { parse, parseFragment } from 'parse5'
import { defaultTreeAdapter } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'

export type ParsedNode = DefaultTreeAdapterMap['node']
export type ParsedElement = DefaultTreeAdapterMap['element']
export type ParsedTextNode = DefaultTreeAdapterMap['textNode']
export type ParsedDocument = DefaultTreeAdapterMap['document']

export const adapter = defaultTreeAdapter

/**
 * 创建文本节点的工厂。封装 adapter 的实现细节，便于将来切换 tree-adapter 时只改这一处。
 */
export function createTextNode(value: string): ParsedTextNode {
  return adapter.createTextNode(value)
}

/**
 * 解析 HTML 字符串。优先把内容解析为 fragment（更宽松、不强求 <html><body> 包裹），
 * 若用户传入完整文档则正确识别。这里统一返回 body 等价的 children 列表。
 */
export function parseHtmlBodyChildren(html: string): ParsedNode[] {
  const trimmed = html.trim()
  // 完整文档：含 <html> 或 <!doctype>
  if (/^<!doctype/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    const doc = parse(html)
    const body = findBody(doc)
    return body ? adapter.getChildNodes(body) : []
  }
  // 片段
  const frag = parseFragment(html)
  return adapter.getChildNodes(frag)
}

function findBody(node: ParsedNode): ParsedElement | null {
  if ('tagName' in node && node.tagName === 'body') {
    return node
  }
  // 仅 document / element 才有 children
  const children =
    'childNodes' in node && Array.isArray(node.childNodes) ? node.childNodes : []
  for (const child of children) {
    const found = findBody(child)
    if (found) return found
  }
  return null
}

export function isElement(node: ParsedNode): node is ParsedElement {
  return 'tagName' in node && typeof node.tagName === 'string' && 'childNodes' in node
}

export function isTextNode(node: ParsedNode): node is ParsedTextNode {
  return 'nodeName' in node && node.nodeName === '#text'
}

export function getAttr(el: ParsedElement, name: string): string | undefined {
  const attr = el.attrs.find((a) => a.name === name)
  return attr?.value
}
