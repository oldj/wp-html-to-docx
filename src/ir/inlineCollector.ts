// 内联节点扁平化
// 把嵌套的内联标签 (<p>hi <strong>w<em>!</em></strong></p>) 折叠成平铺 Inline[]
// 每个 Inline 后续 1:1 映射 TextRun / ExternalHyperlink+TextRun / ImageRun

import type { Inline, InlineStyle } from '../types.js'
import {
  adapter,
  getAttr,
  isElement,
  isTextNode,
  type ParsedNode,
} from '../parser/parseHtml.js'
import { collapseWhitespace } from '../utils/html.js'

/** 内联级标签集合 */
const INLINE_TAGS = new Set([
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'del',
  'a',
  'br',
  'img',
  'code',
  'sub',
  'sup',
  'mark',
])

export function isInlineTag(tag: string): boolean {
  return INLINE_TAGS.has(tag)
}

/**
 * 收集 nodes 下所有内联节点（递归展开样式标签），返回扁平 Inline[]
 * 块级节点会被忽略（调用方应在块级 walker 中先剥离它们）
 */
export function collectInlines(
  nodes: ParsedNode[],
  activeStyle: InlineStyle = {},
): Inline[] {
  const out: Inline[] = []
  for (const node of nodes) {
    collectOne(node, activeStyle, out)
  }
  return mergeAdjacentText(out)
}

function collectOne(
  node: ParsedNode,
  activeStyle: InlineStyle,
  out: Inline[],
): void {
  if (isTextNode(node)) {
    const text = collapseWhitespace(node.value)
    if (text.length === 0) return
    out.push({ kind: 'text', text, style: { ...activeStyle } })
    return
  }
  if (!isElement(node)) return

  const tag = node.tagName

  if (tag === 'br') {
    out.push({ kind: 'break' })
    return
  }
  if (tag === 'math') {
    // 行内 math 占位：MVP 不展开 MathML 内部内容，避免污染父段落
    out.push({ kind: 'text', text: '[math]', style: { ...activeStyle } })
    return
  }
  if (tag === 'img') {
    const src = getAttr(node, 'src') ?? ''
    if (!src) return
    const alt = getAttr(node, 'alt')
    out.push({ kind: 'image', src, alt, style: { ...activeStyle } })
    return
  }

  // 样式包装：把当前样式叠加后递归
  const childStyle = applyTagStyle(tag, activeStyle, node)
  const children = adapter.getChildNodes(node)
  for (const c of children) {
    collectOne(c, childStyle, out)
  }
}

function applyTagStyle(
  tag: string,
  base: InlineStyle,
  el: import('../parser/parseHtml.js').ParsedElement,
): InlineStyle {
  switch (tag) {
    case 'strong':
    case 'b':
      return { ...base, bold: true }
    case 'em':
    case 'i':
      return { ...base, italic: true }
    case 'u':
      return { ...base, underline: true }
    case 's':
    case 'strike':
    case 'del':
      return { ...base, strike: true }
    case 'code':
      return { ...base, code: true }
    case 'a': {
      const href = getAttr(el, 'href')
      return href ? { ...base, link: href } : { ...base }
    }
    case 'span':
    default:
      // 未知或纯包装标签：透传样式
      return base
  }
}

/**
 * 合并相邻同样式的 text Inline，避免在 docx 输出中产生过多空 run
 */
function mergeAdjacentText(items: Inline[]): Inline[] {
  const out: Inline[] = []
  for (const item of items) {
    const prev = out[out.length - 1]
    if (
      prev !== undefined &&
      prev.kind === 'text' &&
      item.kind === 'text' &&
      sameStyle(prev.style, item.style)
    ) {
      prev.text += item.text
      continue
    }
    out.push(item)
  }
  return out
}

function sameStyle(a: InlineStyle, b: InlineStyle): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.strike === !!b.strike &&
    !!a.code === !!b.code &&
    (a.link ?? '') === (b.link ?? '')
  )
}
