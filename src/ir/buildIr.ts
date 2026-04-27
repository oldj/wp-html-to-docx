// DOM → IR walker

import type { Block, BlockAlign, TableCell, TableRow } from '../types.js'
import {
  adapter,
  getAttr,
  isElement,
  isTextNode,
  type ParsedElement,
  type ParsedNode,
} from '../parser/parseHtml.js'
import { collectInlines, isInlineTag } from './inlineCollector.js'
import type { BuildContext } from './buildContext.js'
import { isWhitespaceOnly } from '../utils/html.js'
import { parseInlineStyle, parsePageBreaks, parseTextAlign } from '../utils/css.js'
import { serializeNode } from '../utils/serializeNode.js'

const HEADING_LEVELS: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
}

/** list 走查时维护的栈帧 */
type ListFrame = {
  ordered: boolean
  reference: string
  level: number
}

export function buildIr(nodes: ParsedNode[], ctx: BuildContext): Block[] {
  return walkBlocks(nodes, ctx, [])
}

function walkBlocks(
  nodes: ParsedNode[],
  ctx: BuildContext,
  listStack: ListFrame[],
): Block[] {
  const out: Block[] = []
  let inlineBuffer: ParsedNode[] = []
  const flushInline = (): void => {
    if (inlineBuffer.length === 0) return
    const inlines = collectInlines(inlineBuffer)
    if (inlines.length > 0) {
      out.push({ kind: 'paragraph', inlines })
    }
    inlineBuffer = []
  }

  for (const node of nodes) {
    if (isTextNode(node)) {
      if (!isWhitespaceOnly(node.value)) inlineBuffer.push(node)
      continue
    }
    if (!isElement(node)) continue

    const tag = node.tagName
    // <math> 默认按 phrasing content 处理（与 HTML5 一致），与前后文本同段；
    // 仅 display="block" 时才升级到块级，走下面的 'math' case 产独立段
    if (isInlineTag(tag) || (tag === 'math' && getAttr(node, 'display') !== 'block')) {
      inlineBuffer.push(node)
      continue
    }
    flushInline()

    // 块级 CSS page-break-before/after：标准 CSS 语义，before 在前 / after 在后；
    // <hr class="page-break"> 和 <page-break> 自身就是分页符，不再叠加
    const sides = pageBreakSides(node)
    if (sides.before) out.push({ kind: 'pageBreak' })
    out.push(...emitBlockForElement(node, ctx, listStack))
    if (sides.after) out.push({ kind: 'pageBreak' })
  }
  flushInline()
  return out
}

/** 把单个块级元素映射为 Block[]（可能是多个，如 ul/ol 平铺） */
function emitBlockForElement(
  node: ParsedElement,
  ctx: BuildContext,
  listStack: ListFrame[],
): Block[] {
  const tag = node.tagName

  const heading = HEADING_LEVELS[tag]
  if (heading !== undefined) {
    return [
      {
        kind: 'heading',
        level: heading,
        inlines: collectInlines(adapter.getChildNodes(node)),
        align: blockAlign(node),
      },
    ]
  }

  switch (tag) {
    case 'p':
      return [
        {
          kind: 'paragraph',
          inlines: collectInlines(adapter.getChildNodes(node)),
          align: blockAlign(node),
        },
      ]
    case 'ul':
    case 'ol':
      return walkList(node, tag === 'ol', ctx, listStack)
    case 'li':
      // 浮在 list 外的 li：按 paragraph 处理（parse5 通常会修正，但兜底）
      return [
        {
          kind: 'paragraph',
          inlines: collectInlines(adapter.getChildNodes(node)),
          align: blockAlign(node),
        },
      ]
    case 'blockquote':
      return [
        {
          kind: 'blockquote',
          children: walkBlocks(adapter.getChildNodes(node), ctx, listStack),
        },
      ]
    case 'hr':
      // <hr class="page-break"> 替代为分页符（不再画横线）
      if (hasClass(node, 'page-break')) return [{ kind: 'pageBreak' }]
      return [{ kind: 'hr' }]
    case 'pre':
      return [{ kind: 'pre', text: extractPreText(node) }]
    case 'table':
      return [{ kind: 'table', rows: walkTable(node, ctx) }]
    case 'math':
      return [
        {
          kind: 'math',
          mathml: serializeNode(node),
          display: getAttr(node, 'display') === 'block' ? 'block' : 'inline',
        },
      ]
    case 'page-break': {
      // parse5 不识别 `<page-break/>` 自闭合，后续兄弟节点会被解析为它的子节点；
      // 因此把子节点继续按块级处理，附在分页符之后，避免丢内容
      const childBlocks = walkBlocks(adapter.getChildNodes(node), ctx, listStack)
      return [{ kind: 'pageBreak' }, ...childBlocks]
    }
    default:
      // 未知块级容器：递归其内部
      return walkBlocks(adapter.getChildNodes(node), ctx, listStack)
  }
}

/** 从元素 inline style 取分页指令；不含 style 属性时返回 { before:false, after:false } */
function pageBreakSides(el: ParsedElement): { before: boolean; after: boolean } {
  const style = getAttr(el, 'style')
  if (style === undefined) return { before: false, after: false }
  return parsePageBreaks(parseInlineStyle(style))
}

/** 元素的 class 属性是否包含某个精确 token */
function hasClass(el: ParsedElement, name: string): boolean {
  const cls = getAttr(el, 'class')
  if (cls === undefined) return false
  return cls.split(/\s+/).includes(name)
}

/**
 * 走查一个 ul / ol。
 * - 若上层栈顶同类型 list，复用 reference，level + 1
 * - 否则注册新 reference，level = 0
 * - 嵌套 list 在 IR 层平铺：先输出当前 li 的 list-item，再追加嵌套 list 的扁平结果
 */
function walkList(
  node: ParsedElement,
  ordered: boolean,
  ctx: BuildContext,
  listStack: ListFrame[],
): Block[] {
  const top = listStack[listStack.length - 1]
  let frame: ListFrame
  if (top !== undefined && top.ordered === ordered) {
    frame = { ordered, reference: top.reference, level: Math.min(top.level + 1, 7) }
  } else {
    frame = { ordered, reference: ctx.registerList(ordered), level: 0 }
  }

  const out: Block[] = []
  const newStack = [...listStack, frame]
  for (const child of adapter.getChildNodes(node)) {
    if (!isElement(child)) continue
    const tag = child.tagName
    if (tag !== 'li') continue
    out.push(...walkListItem(child, frame, ctx, newStack))
  }
  return out
}

/**
 * 走查一个 <li>。
 * - 当前 li 的直系内联文本 → list-item.inlines
 * - 嵌套 ul/ol → 递归后追加（共享或新建 reference 由 walkList 决定）
 * - li 内的其它块级（如 p）：阶段 1 简化处理为内联展平
 */
function walkListItem(
  node: ParsedElement,
  frame: ListFrame,
  ctx: BuildContext,
  listStack: ListFrame[],
): Block[] {
  const inlineNodes: ParsedNode[] = []
  const blockTail: Block[] = []

  for (const child of adapter.getChildNodes(node)) {
    if (isElement(child)) {
      const tag = child.tagName
      if (tag === 'ul' || tag === 'ol') {
        // 嵌套列表，平铺到 blockTail
        blockTail.push(...walkList(child, tag === 'ol', ctx, listStack))
        continue
      }
      // math / page-break 是 phrasing 元素，整体保留以便 collectInlines 输出 math/pageBreak Inline
      // （否则会落到下面「展平包装」分支，导致 MathML 内文本泄漏或 page-break 丢失）
      if (tag === 'math' || tag === 'page-break') {
        inlineNodes.push(child)
        continue
      }
      // 其它块级（如 p / div）：把其内联子节点展平到当前 li
      // 这一步保守地避免在 li 内引入嵌套段落，破坏列表项的连贯性
      if (!isInlineTag(tag)) {
        inlineNodes.push(...adapter.getChildNodes(child))
        continue
      }
    }
    inlineNodes.push(child)
  }

  const inlines = collectInlines(inlineNodes)
  const out: Block[] = [
    {
      kind: 'list-item',
      inlines,
      ref: { reference: frame.reference, level: frame.level },
      align: blockAlign(node),
    },
    ...blockTail,
  ]
  return out
}

/** 从块级元素的 inline `style="text-align: ..."` 取出对齐值 */
function blockAlign(el: ParsedElement): BlockAlign | undefined {
  const decls = parseInlineStyle(getAttr(el, 'style'))
  return parseTextAlign(decls['text-align'])
}

/**
 * 走查 <table>。parse5 自动补全 thead/tbody，因此可以放心展开。
 * 收集所有 tr，记录是否处于 thead 或者 tr 内 th 占多数。
 */
function walkTable(node: ParsedElement, ctx: BuildContext): TableRow[] {
  const rows: TableRow[] = []
  collectRows(node, false, ctx, rows)
  return rows
}

function collectRows(
  node: ParsedElement,
  inHeader: boolean,
  ctx: BuildContext,
  out: TableRow[],
): void {
  for (const child of adapter.getChildNodes(node)) {
    if (!isElement(child)) continue
    const tag = child.tagName
    if (tag === 'thead') {
      collectRows(child, true, ctx, out)
      continue
    }
    if (tag === 'tbody' || tag === 'tfoot') {
      collectRows(child, inHeader, ctx, out)
      continue
    }
    if (tag === 'tr') {
      out.push(walkTableRow(child, inHeader, ctx))
      continue
    }
    if (tag === 'caption' || tag === 'colgroup' || tag === 'col') continue
  }
}

function walkTableRow(
  node: ParsedElement,
  inHeader: boolean,
  ctx: BuildContext,
): TableRow {
  const cells: TableCell[] = []
  let thCount = 0
  let cellCount = 0
  for (const child of adapter.getChildNodes(node)) {
    if (!isElement(child)) continue
    const tag = child.tagName
    if (tag !== 'th' && tag !== 'td') continue
    cellCount += 1
    if (tag === 'th') thCount += 1
    cells.push(walkTableCell(child, ctx))
  }
  // 行级判定：thead 内 / 全部 th → header 行
  const isHeader = inHeader || (cellCount > 0 && thCount === cellCount)
  return { isHeader, cells }
}

function walkTableCell(node: ParsedElement, ctx: BuildContext): TableCell {
  const colSpan = parsePositiveInt(getAttr(node, 'colspan'))
  const rowSpan = parsePositiveInt(getAttr(node, 'rowspan'))
  const children = walkBlocks(adapter.getChildNodes(node), ctx, [])
  // 单元格至少给一个 paragraph，避免 docx 拒绝空 cell
  const safeChildren: Block[] =
    children.length > 0 ? children : [{ kind: 'paragraph', inlines: [] }]
  return {
    children: safeChildren,
    colSpan,
    rowSpan,
  }
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = parseInt(value, 10)
  if (!Number.isFinite(n) || n <= 1) return undefined
  return n
}

/** 提取 <pre> 内的纯文本（保留所有空白） */
function extractPreText(node: ParsedElement): string {
  let out = ''
  for (const child of adapter.getChildNodes(node)) {
    if (isTextNode(child)) {
      out += child.value
      continue
    }
    if (!isElement(child)) continue
    // <pre><code>...</code></pre> 是常见模式
    out += extractPreText(child)
  }
  return out
}
