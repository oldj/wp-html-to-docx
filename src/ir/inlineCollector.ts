// 内联节点扁平化
// 把嵌套的内联标签 (<p>hi <strong>w<em>!</em></strong></p>) 折叠成平铺 Inline[]
// 每个 Inline 后续 1:1 映射 TextRun / ExternalHyperlink+TextRun / ImageRun

import type { Inline, InlineStyle } from '../types.js'
import {
  adapter,
  getAttr,
  hasClass,
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
import { serializeNode } from '../utils/serializeNode.js'

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
 *
 * @param preserveWhitespace 是否对文本节点保留连续空格（含全角空格 U+3000）；
 *   见 utils/html.ts 中 `collapseWhitespace` 的保守保留语义
 * @param baseStyle 初始样式。块级 walker 把「产生该块的元素自身的 style 文本样式」
 *   （如 `<p style="color:red">`）经 inlineStyleFromElement 解析后传入，
 *   实现块级样式向段内文本的单链下发（不做完整 cascade）
 */
export function collectInlines(
  nodes: ParsedNode[],
  preserveWhitespace = false,
  baseStyle: InlineStyle = {},
): Inline[] {
  const out: Inline[] = []
  for (const node of nodes) {
    collectOne(node, baseStyle, out, preserveWhitespace)
  }
  return mergeAdjacentText(out)
}

/**
 * 把元素自身 `style` 属性中支持的文本样式叠加到 base 上，返回新 InlineStyle。
 * 供块级 walker（buildIr）从 p / h* / li / td 等块级元素提取文本样式后
 * 作为 collectInlines 的 baseStyle 下发；元素无 style 时原样返回 base。
 */
export function inlineStyleFromElement(el: ParsedElement, base: InlineStyle = {}): InlineStyle {
  return mergeInlineCss(base, getAttr(el, 'style'))
}

function collectOne(
  node: ParsedNode,
  activeStyle: InlineStyle,
  out: Inline[],
  preserveWhitespace: boolean,
): void {
  if (isTextNode(node)) {
    const text = collapseWhitespace(node.value, preserveWhitespace)
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
  if (tag === 'wp-page-break') {
    // 行内分页：<p>foo<wp-page-break/>bar</p> 这种用法，与文本同段
    // 注意 parse5 不识别自闭合：<wp-page-break/> 后续兄弟节点会被解析为它的子节点，
    // 因此这里要把子节点继续作为「跟随兄弟」处理，避免丢内容
    out.push({ kind: 'pageBreak' })
    for (const c of adapter.getChildNodes(node)) {
      collectOne(c, activeStyle, out, preserveWhitespace)
    }
    return
  }
  if (tag === 'math') {
    // 保留 MathML 原文；后续在 collectMath 阶段异步转 OMML，渲染层据此输出 m:oMath。
    // 转换失败 / 依赖缺失时，渲染层退回 TeX 源码或 [math] 占位
    out.push({ kind: 'math', ...readMathElement(node) })
    return
  }
  // KaTeX：span.katex 里同时有 MathML 副本（.katex-mathml）和供浏览器排版的 .katex-html。
  // 后者是一堆定位用的 span，拍平后成了「E=mc2」「∫01x2dx=31」这类乱字符，还与公式重复。
  // 只在确有 MathML 副本时丢弃排版层；KaTeX 的纯 HTML 输出（无 .katex-mathml）里
  // 排版层是唯一内容，仍按普通文本收集。判据刻意收窄到 KaTeX 结构，不泛化为忽略
  // aria-hidden，以免误删其他来源中可见的装饰内容。
  if (hasClass(node, 'katex')) {
    const mathmlPart = adapter
      .getChildNodes(node)
      .find((c) => isElement(c) && hasClass(c, 'katex-mathml'))
    if (mathmlPart !== undefined) {
      collectOne(mathmlPart, applyTagStyle(tag, activeStyle, node), out, preserveWhitespace)
      return
    }
  }
  if (tag === 'img') {
    const src = getAttr(node, 'src') ?? ''
    if (!src) return
    const alt = getAttr(node, 'alt')
    // 采集尺寸：优先 HTML width/height 属性，缺失时回退到 inline style 的 width/height。
    // 原样保留字符串（"300" 像素 / "100%" 百分比 / "300px"），换算交给 builder 阶段。
    const width = getAttr(node, 'width') ?? cssLength(node, 'width')
    const height = getAttr(node, 'height') ?? cssLength(node, 'height')
    // 满宽语义标记：占满版心可用宽度，优先级高于 width
    const fullWidth = getAttr(node, 'data-full-width') === '1'
    out.push({ kind: 'image', src, alt, width, height, fullWidth, style: { ...activeStyle } })
    return
  }
  // 脚注引用：<sup class="wp-footnote-ref"><a href="#fn-1">[1]</a></sup>
  // 命中专用 class（兼容 markdown-it 的 footnote-ref）且能解析到 #fragment 锚点时，
  // 提升为脚注引用并丢弃 [1] 占位文本；渲染层据 target 在 ctx.footnotes 查数字 id。
  // 无可解析锚点时不拦截，退回普通 sup（继续走下方样式包装，与改造前行为一致）。
  if (tag === 'sup' && (hasClass(node, 'wp-footnote-ref') || hasClass(node, 'footnote-ref'))) {
    const target = findFragmentAnchor(node)
    if (target !== undefined) {
      out.push({ kind: 'footnoteRef', target })
      return
    }
  }

  // 样式包装：把当前样式叠加后递归
  const childStyle = applyTagStyle(tag, activeStyle, node)
  const children = adapter.getChildNodes(node)
  for (const c of children) {
    collectOne(c, childStyle, out, preserveWhitespace)
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
    case 'sub':
      // 普通下标。注意：带 footnote-ref class 的 <sup> 已在 collectOne 中提前拦截为
      // footnoteRef，不会走到这里，故此处无需为脚注特判。
      style = { ...style, subScript: true }
      break
    case 'sup':
      // 普通上标（参见 sub 的脚注说明）
      style = { ...style, superScript: true }
      break
    case 'a': {
      const link = normalizeHref(getAttr(el, 'href'))
      if (link !== undefined) style = { ...style, link }
      break
    }
    // span / mark 等：仅透传，由 inline style 决定外观
  }
  // 第二层：inline `style` 属性按 plan.md「进阶 B」范围内叠加
  return mergeInlineCss(style, getAttr(el, 'style'))
}

/**
 * 读取 <math> 元素：序列化原文、display 声明，以及 TeX 源码（若有）。
 * 行内收集与块级 walker 共用，保证两条路径对同一个 <math> 得出一致的 IR。
 */
export function readMathElement(node: ParsedElement): {
  mathml: string
  display: 'inline' | 'block'
  tex?: string
} {
  const tex = findTexAnnotation(node)
  return {
    mathml: serializeNode(node),
    display: getAttr(node, 'display') === 'block' ? 'block' : 'inline',
    ...(tex !== undefined ? { tex } : {}),
  }
}

/**
 * 取 `<semantics>` 下 `<annotation encoding="application/x-tex">` 的文本。KaTeX 默认输出就有；
 * MathJax 3 的默认输出没有，这类公式只能靠 mathml2omml。
 * 没有或为空时返回 undefined。
 */
function findTexAnnotation(el: ParsedElement): string | undefined {
  for (const child of adapter.getChildNodes(el)) {
    if (!isElement(child)) continue
    if (
      child.tagName === 'annotation' &&
      getAttr(child, 'encoding')?.trim().toLowerCase() === 'application/x-tex'
    ) {
      const tex = textContent(child).trim()
      return tex.length > 0 ? tex : undefined
    }
    const nested = findTexAnnotation(child)
    if (nested !== undefined) return nested
  }
  return undefined
}

function textContent(el: ParsedElement): string {
  let out = ''
  for (const child of adapter.getChildNodes(el)) {
    if (isTextNode(child)) out += child.value
    else if (isElement(child)) out += textContent(child)
  }
  return out
}

/**
 * 在元素子树中查找第一个 href 以 # 开头的 <a>，返回去掉 # 的锚点 id。
 * 用于从 <sup><a href="#fn-1">[1]</a></sup> 取出脚注目标 'fn-1'。
 */
function findFragmentAnchor(el: ParsedElement): string | undefined {
  for (const child of adapter.getChildNodes(el)) {
    if (!isElement(child)) continue
    if (child.tagName === 'a') {
      const href = getAttr(child, 'href')
      if (href !== undefined && href.startsWith('#') && href.length > 1) {
        return href.slice(1)
      }
    }
    const nested = findFragmentAnchor(child)
    if (nested !== undefined) return nested
  }
  return undefined
}

/**
 * 把 `<a href>` 归一为可写进 docx 的链接目标，无法安全或有意义地落到 Word 时返回 undefined（只保留文字）：
 * - http / https / mailto / tel / ftp（大小写不敏感）：原样保留
 * - `//host/path`（协议相对）：补成 `https://host/path`
 * - `#id`：保留，渲染期按 ctx.anchors 转成文档内链接（目标不存在时同样只保留文字）
 * - 相对路径（`/foo`、`./foo`、`../foo`、`?q=1`、`page.html`）：docx 脱离了原网站，
 *   Word 会把它解析为相对文档所在位置，点开必然失败，故去掉链接
 * - javascript: / data: 等：避免不可信 HTML 把脚本 / 数据 URL 写进 docx，去掉链接
 */
function normalizeHref(href: string | undefined): string | undefined {
  const trimmed = href?.trim() ?? ''
  if (trimmed.length === 0) return undefined
  if (trimmed.startsWith('#')) return trimmed.length > 1 ? trimmed : undefined
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  return /^(https?|mailto|tel|ftp):/i.test(trimmed) ? trimmed : undefined
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
    (a.fontFamily ?? '') === (b.fontFamily ?? '') &&
    !!a.superScript === !!b.superScript &&
    !!a.subScript === !!b.subScript
  )
}

/**
 * 从元素 inline style 中取 width / height（仅这两个属性，不含 max-width）。
 * 仅作为 HTML width/height 属性缺失时的兜底，主要服务粘贴自网页的 `<img style="width:..">`。
 */
function cssLength(el: ParsedElement, prop: 'width' | 'height'): string | undefined {
  const style = getAttr(el, 'style')
  if (!style) return undefined
  // (?:^|;) 前缀确保不会匹配到 max-width / min-width 里的 "width"
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(style)
  return m?.[1]?.trim()
}
