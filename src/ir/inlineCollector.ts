// 内联节点扁平化
// 把嵌套的内联标签 (<p>hi <strong>w<em>!</em></strong></p>) 折叠成平铺 Inline[]
// 每个 Inline 后续 1:1 映射 TextRun / ExternalHyperlink+TextRun / ImageRun

import type { Inline, InlineStyle } from '../types.js'
import {
  adapter,
  getAttr,
  isElement,
  isTextNode,
  type ParsedElement,
  type ParsedNode,
} from '../parser/parseHtml.js'
import { collapseWhitespace } from '../utils/html.js'
import {
  isBoldWeight,
  parseColor,
  parseFontFamily,
  parseFontSizeHalfPt,
  parseInlineStyle,
} from '../utils/css.js'

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

function applyTagStyle(tag: string, base: InlineStyle, el: ParsedElement): InlineStyle {
  // 第一层：标签语义带来的固定样式（<strong> = bold，<em> = italic 等）
  let style = base
  switch (tag) {
    case 'strong':
    case 'b':
      style = { ...style, bold: true }
      break
    case 'em':
    case 'i':
      style = { ...style, italic: true }
      break
    case 'u':
      style = { ...style, underline: true }
      break
    case 's':
    case 'strike':
    case 'del':
      style = { ...style, strike: true }
      break
    case 'code':
      style = { ...style, code: true }
      break
    case 'a': {
      const href = getAttr(el, 'href')
      if (href) style = { ...style, link: href }
      break
    }
    // span / mark / sub / sup 等：仅透传，由 inline style 决定外观
  }
  // 第二层：inline `style` 属性按 plan.md「进阶 B」范围内叠加
  return mergeInlineCss(style, getAttr(el, 'style'))
}

/**
 * 把元素 `style` 属性中支持的字段叠加到当前 InlineStyle 上。
 * 设计原则：仅做加法（增加样式），不做减法（不会把 normal 重置 bold）。
 * 这样实现成本低，且符合「不做完整 cascade」的项目定位。
 */
function mergeInlineCss(base: InlineStyle, source: string | undefined): InlineStyle {
  if (source === undefined) return base
  const decls = parseInlineStyle(source)
  if (Object.keys(decls).length === 0) return base
  let style = base
  if (isBoldWeight(decls['font-weight'])) style = { ...style, bold: true }
  if (decls['font-style']?.toLowerCase() === 'italic') style = { ...style, italic: true }
  // text-decoration 可能包含多个值，如 "underline line-through"
  const deco = decls['text-decoration-line'] ?? decls['text-decoration']
  if (deco !== undefined) {
    const tokens = deco.toLowerCase().split(/\s+/)
    if (tokens.includes('underline')) style = { ...style, underline: true }
    if (tokens.includes('line-through')) style = { ...style, strike: true }
  }
  const color = parseColor(decls['color'])
  if (color !== undefined) style = { ...style, color }
  // background 简写或 background-color 都接受；只取首个 token 解析为颜色
  const bgRaw = decls['background-color'] ?? decls['background']
  if (bgRaw !== undefined) {
    const bg = parseColor(bgRaw.split(/\s+/)[0])
    if (bg !== undefined) style = { ...style, bgColor: bg }
  }
  const fontSize = parseFontSizeHalfPt(decls['font-size'])
  if (fontSize !== undefined) style = { ...style, fontSize }
  const fontFamily = parseFontFamily(decls['font-family'])
  if (fontFamily !== undefined) style = { ...style, fontFamily }
  return style
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
    (a.link ?? '') === (b.link ?? '') &&
    (a.color ?? '') === (b.color ?? '') &&
    (a.bgColor ?? '') === (b.bgColor ?? '') &&
    (a.fontSize ?? 0) === (b.fontSize ?? 0) &&
    (a.fontFamily ?? '') === (b.fontFamily ?? '')
  )
}
