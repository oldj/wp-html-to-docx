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
import { parseInlineStyle, parseTextAlign } from '../utils/css.js'
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

    const heading = HEADING_LEVELS[tag]
    if (heading !== undefined) {
      out.push({
        kind: 'heading',
        level: heading,
        inlines: collectInlines(adapter.getChildNodes(node)),
        align: blockAlign(node),
      })
      continue
    }

    switch (tag) {
      case 'p':
        out.push({
          kind: 'paragraph',
          inlines: collectInlines(adapter.getChildNodes(node)),
          align: blockAlign(node),
        })
        continue
      case 'ul':
      case 'ol':
        out.push(...walkList(node, tag === 'ol', ctx, listStack))
        continue
      case 'li':
        // 浮在 list 外的 li：按 paragraph 处理（parse5 通常会修正，但兜底）
        out.push({
          kind: 'paragraph',
          inlines: collectInlines(adapter.getChildNodes(node)),
          align: blockAlign(node),
        })
        continue
      case 'blockquote':
        out.push({
          kind: 'blockquote',
          children: walkBlocks(adapter.getChildNodes(node), ctx, listStack),
        })
        continue
      case 'hr':
        out.push({ kind: 'hr' })
        continue
      case 'pre':
        out.push({ kind: 'pre', text: extractPreText(node) })
        continue
      case 'table':
        out.push({ kind: 'table', rows: walkTable(node, ctx) })
        continue
      case 'math':
        // MVP 仅识别并保留 MathML 字符串，渲染为 [math] 占位段落
        // 进阶阶段 A 接入 mathml2omml 做真实转换
        out.push({
          kind: 'math',
          mathml: serializeNode(node),
          display: getAttr(node, 'display') === 'block' ? 'block' : 'inline',
        })
        continue
      default:
        // 未知块级容器：递归其内部
        out.push(...walkBlocks(adapter.getChildNodes(node), ctx, listStack))
    }
  }
  flushInline()
  return out
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
