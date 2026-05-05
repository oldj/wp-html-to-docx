// DOM → IR walker

import type { Block, BlockAlign, Inline, TableCell, TableRow } from '../types.js'
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

/**
 * <li> 内必须以「独立块」形式输出的结构。
 * 这些标签若被当作 phrasing 容器去递归子节点，会丢失自身结构（表格行列、pre 等宽与空白、blockquote 视觉）。
 * 遇到时关闭当前 list-item 段落、调用 emitBlockForElement 整体输出，类似嵌套 list 的处理。
 * 注意：div / p / h1-h6 / section / article 等仍按 phrasing 容器递归 —— 这些是「内容包装器」，
 * 拍扁到当前 list-item 是符合预期的。
 */
const LI_STANDALONE_BLOCK_TAGS: ReadonlySet<string> = new Set(['table', 'pre', 'blockquote', 'hr'])

/**
 * 每层 list 的左缩进（twip）。与 builder/numbering.ts 的 INDENT_PER_LEVEL 数值一致；
 * 这里独立维护一份是为了避免 IR 层反向依赖 builder 层 —— 若调整对齐策略需同步两处。
 */
const LIST_LEVEL_INDENT = 720

/**
 * 把 list 缩进附加到一个 standalone block 上。
 * 仅 table / pre / hr / blockquote 持有 indent 字段；其他类型（如外部不该出现的）忽略。
 */
function attachListIndent(block: Block, indent: number): void {
  if (
    block.kind === 'table' ||
    block.kind === 'pre' ||
    block.kind === 'hr' ||
    block.kind === 'blockquote'
  ) {
    block.indent = indent
  }
}

export function buildIr(nodes: ParsedNode[], ctx: BuildContext): Block[] {
  return walkBlocks(nodes, ctx, [])
}

function walkBlocks(nodes: ParsedNode[], ctx: BuildContext, listStack: ListFrame[]): Block[] {
  const out: Block[] = []
  let inlineBuffer: ParsedNode[] = []
  const flushInline = (): void => {
    if (inlineBuffer.length === 0) return
    const inlines = collectInlines(inlineBuffer, ctx.options.preserveWhitespace ?? false)
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

    // 块级 CSS page-break-before/after：按标准语义把分页符插在元素前/后。
    // 元素自身的产物（hr / pageBreak / 普通段落 …）由 emitBlockForElement 决定；
    // 当用户同时在 <hr class="page-break"> 上又写了 page-break-after CSS 时，会
    // 叠加产生 2 个分页符——视为用户冲突写法，不特判
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
        inlines: collectInlines(
          adapter.getChildNodes(node),
          ctx.options.preserveWhitespace ?? false,
        ),
        align: blockAlign(node),
      },
    ]
  }

  switch (tag) {
    case 'p':
      return [
        {
          kind: 'paragraph',
          inlines: collectInlines(
            adapter.getChildNodes(node),
            ctx.options.preserveWhitespace ?? false,
          ),
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
          inlines: collectInlines(
            adapter.getChildNodes(node),
            ctx.options.preserveWhitespace ?? false,
          ),
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
    case 'wp-page-break': {
      // parse5 不识别 `<wp-page-break/>` 自闭合，后续兄弟节点会被解析为它的子节点；
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
 *
 * 段切分与合并规则：
 * - 直系内联节点 / 文本 → 收入当前段缓冲
 * - 块级元素（<p>/<div>/<h*> 等）→ 关闭当前段；其内部子节点继续递归，结束后再关闭一段
 *   每个块级容器对应「一段」inlines，多个段会被同一个 list-item 收纳（段间以 {kind:'break'} 连接）
 * - 嵌套 <ul>/<ol> → 关闭当前 list-item 并输出嵌套 list-item 块
 * - <math> / <wp-page-break> → 视为 phrasing，留在当前段缓冲中
 *
 * 输出形态：
 * - 多段并存时合并为单个 `list-item`，段间通过软换行 (`{kind:'break'}`) 分隔，
 *   等价于 docx 的 `<w:br/>`：编号只出现在首段，后续段在同一段落内自动换行对齐
 * - 嵌套列表打断当前 list-item，按出现顺序输出嵌套块
 * - 嵌套列表「之后」若仍有文本/块级内容，归入 `list-continuation`：
 *   单独一段、缩进对齐到 list 文本起点、不带编号 / 项目符号
 *   （这种结构无法塞回上一段，只能另起段落）
 * - 完全空的 <li> 兜底产出一个空 list-item 占位
 */
function walkListItem(
  node: ParsedElement,
  frame: ListFrame,
  ctx: BuildContext,
  listStack: ListFrame[],
): Block[] {
  const out: Block[] = []
  let buffer: ParsedNode[] = []
  let segments: Inline[][] = []
  let firstItemEmitted = false
  const itemAlign = blockAlign(node)
  const preserveWs = ctx.options.preserveWhitespace ?? false

  // 把 buffer 收成一段 inlines 推入 segments
  const flushBuffer = (): void => {
    if (buffer.length === 0) return
    const inlines = collectInlines(buffer, preserveWs)
    buffer = []
    if (inlines.length > 0) segments.push(inlines)
  }

  // 把已积累的 segments 输出为一个块：首次为 list-item，后续为 list-continuation
  const flushSegments = (): void => {
    flushBuffer()
    if (segments.length === 0) return
    const merged = joinSegmentsWithBreak(segments)
    segments = []
    if (!firstItemEmitted) {
      out.push({
        kind: 'list-item',
        inlines: merged,
        ref: { reference: frame.reference, level: frame.level },
        align: itemAlign,
      })
      firstItemEmitted = true
      return
    }
    out.push({
      kind: 'list-continuation',
      inlines: merged,
      level: frame.level,
      align: itemAlign,
    })
  }

  // 嵌套 list 必须出现在外层 li 之后；若尚未产出 list-item，先补空占位
  const ensureFirstEmitted = (): void => {
    if (firstItemEmitted) return
    out.push({
      kind: 'list-item',
      inlines: [],
      ref: { reference: frame.reference, level: frame.level },
      align: itemAlign,
    })
    firstItemEmitted = true
  }

  const visit = (child: ParsedNode): void => {
    if (isElement(child)) {
      const tag = child.tagName
      if (tag === 'ul' || tag === 'ol') {
        flushSegments()
        ensureFirstEmitted()
        out.push(...walkList(child, tag === 'ol', ctx, listStack))
        return
      }
      if (LI_STANDALONE_BLOCK_TAGS.has(tag)) {
        // 必须独立的复杂块（table / pre / blockquote / hr）：关闭当前段，
        // 整体复用 emitBlockForElement 的产物，避免结构被内联拍扁。
        // 紧随其后的内容（若有）会在下一次 flushSegments 时归入 list-continuation。
        // 同时把 list 缩进透传给这些块，让它们视觉上跟随列表项缩进，
        // 而不是飘到文档左边距 —— 与浏览器渲染 <li><table> 的直觉一致
        flushSegments()
        ensureFirstEmitted()
        const blocks = emitBlockForElement(child, ctx, listStack)
        const levelIndent = LIST_LEVEL_INDENT * (frame.level + 1)
        for (const b of blocks) attachListIndent(b, levelIndent)
        out.push(...blocks)
        return
      }
      if (tag === 'math' || tag === 'wp-page-break') {
        buffer.push(child)
        return
      }
      if (!isInlineTag(tag)) {
        // 一般块级容器（div / p / h1-h6 / section / article 等）：前后各 flush 一次，
        // 使每个容器产生独立的一段，同一 list-item 内部多段最终通过 break 连接
        flushBuffer()
        for (const grand of adapter.getChildNodes(child)) {
          visit(grand)
        }
        flushBuffer()
        return
      }
    }
    buffer.push(child)
  }

  for (const child of adapter.getChildNodes(node)) {
    visit(child)
  }
  flushSegments()
  // 完全空的 <li>：兜底产出空 list-item，避免列表项消失
  ensureFirstEmitted()
  return out
}

/** 将多段 inlines 合并为单个 inlines，段间插入软换行 {kind:'break'} */
function joinSegmentsWithBreak(segments: Inline[][]): Inline[] {
  const out: Inline[] = []
  segments.forEach((seg, i) => {
    if (i > 0) out.push({ kind: 'break' })
    out.push(...seg)
  })
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

function walkTableRow(node: ParsedElement, inHeader: boolean, ctx: BuildContext): TableRow {
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
