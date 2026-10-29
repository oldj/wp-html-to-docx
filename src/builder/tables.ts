// 表格 builder
// 表宽默认满宽（可由 <table style="width: X%"> 收窄）；thead 行自动加粗 + 灰底（HEADER_SHADING）。
// 支持 colspan / rowspan（>1 时透传给 docx）。
// HTML 的 colgroup / col 列宽由 IR 归一化成百分比传进来，落到 OOXML 的 tblGrid + 固定布局；
// 没有 colgroup 时不下发网格，交给 Word 等分（docx 库的默认行为）。
// 单元格里的表格以该单元格的内容宽度（而非版心）为可用宽度，见 availableWidthTwip。

import {
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  WidthType,
  type FileChild,
  type ITableCellOptions,
  type ITableOptions,
  type ITableWidthProperties,
} from 'docx'
import type { Block, TableCell as IRCell, TableRow as IRRow } from '../types.js'
import type { BuildContext } from '../ir/buildContext.js'
import { gridColumnCount } from '../ir/buildIr.js'
import { blocksToChildren } from './blocks.js'
import { DEFAULT_OPTIONS } from '../options.js'
import { pageContentWidthTwip, toTwip } from '../utils/units.js'
import { silentWarn } from '../utils/log.js'

const HEADER_SHADING = 'EFEFEF'
/** HTML <table cellpadding="N"> 中 N 是像素，转 dxa：1px = 15 twip（基于 96dpi 标准换算） */
const PX_TO_DXA = 15

/**
 * 解析最终单元格内边距（dxa），优先级：
 * 1. HTML `<table cellpadding="N">`（覆盖所有四边）
 * 2. options.tableCellMargin（用户自定义默认）
 * 3. DEFAULT_OPTIONS.tableCellMargin（库内置默认，避免单元格紧贴）
 *
 * 单位绑定原则：每边的单位与「值的来源」绑定 —— 用户给值就用 user.unit，
 * fallback 到默认值就用 def.unit。避免用户只传 `{ unit: 'mm' }` 时把内置 pt 默认
 * (2,5,2,5) 错按 mm 解释成过大的 113/283 dxa。
 */
function resolveCellMargins(
  ctx: BuildContext,
  cellPaddingPx?: number,
): { top: number; right: number; bottom: number; left: number } {
  if (cellPaddingPx !== undefined) {
    const dxa = cellPaddingPx * PX_TO_DXA
    return { top: dxa, right: dxa, bottom: dxa, left: dxa }
  }
  const user = ctx.options.tableCellMargin
  const def = DEFAULT_OPTIONS.tableCellMargin
  const userUnit = user?.unit ?? def.unit
  const side = (userVal: number | undefined, defVal: number): number =>
    userVal !== undefined ? toTwip(userVal, userUnit) : toTwip(defVal, def.unit)
  return {
    top: side(user?.top, def.top),
    right: side(user?.right, def.right),
    bottom: side(user?.bottom, def.bottom),
    left: side(user?.left, def.left),
  }
}

/** 表格的宽度/缩进相关输入，全部来自 IR 的 table 块 */
export type TableLayout = {
  indent?: number
  cellPaddingPx?: number
  /** 各列占表宽的百分比，合计 100；缺省则不下发 tblGrid */
  columnWidths?: number[]
  /** 表宽占版心的百分比，缺省按 100% */
  widthPct?: number
}

/** gridCol 的最小宽度（twip）。0 宽列在 Word 里会被吞掉或渲染异常，兜个下限 */
const MIN_GRID_COL_TWIP = 1

export function buildTable(rows: IRRow[], ctx: BuildContext, layout: TableLayout = {}): Table {
  const { cellPaddingPx, columnWidths, widthPct } = layout
  const indent = layout.indent !== undefined && layout.indent > 0 ? layout.indent : 0
  const margins = resolveCellMargins(ctx, cellPaddingPx)
  const tableTwip = tableWidthTwip(ctx, widthPct, indent)
  const grid =
    columnWidths !== undefined && columnWidths.length > 0
      ? resolveGrid(columnWidths, tableTwip)
      : undefined
  // 各列宽度，用来推算每个单元格给内容（含嵌套表格）留的宽度：有网格按网格，
  // 否则按列数等分 —— 与 docx 为无网格表格推导 tblGrid 的口径一致
  const columns = grid ?? equalColumns(tableTwip, gridColumnCount(rows))
  const builtRows = rows.map((row) => buildRow(row, ctx, columns, margins))
  const width = resolveTableWidth(widthPct, indent, grid !== undefined, tableTwip)

  const opts: ITableOptions = {
    rows: builtRows,
    width,
    ...(indent > 0 ? { indent: { size: indent, type: WidthType.DXA } } : {}),
    margins: { ...margins, marginUnitType: WidthType.DXA },
    // 只有拿到显式列宽才下发网格并锁死布局：autofit 会按内容重算列宽，
    // 会把好不容易保留下来的比例冲掉；没有列宽时保持 autofit（等分 + 内容自适应）。
    ...(grid !== undefined ? { columnWidths: grid, layout: TableLayoutType.FIXED } : {}),
  }
  return new Table(opts)
}

/**
 * 表格的可用宽度（twip）：在表格单元格内时是该单元格的内容宽度，否则是版心宽度。
 * 纸张名非法的警告由 buildSection 统一发出一次，逐表重算时静默。
 */
function availableWidthTwip(ctx: BuildContext): number {
  const stack = ctx.cellContentWidths
  return stack[stack.length - 1] ?? pageContentWidthTwip(ctx.options, silentWarn)
}

/** 表格实际宽度（twip）：可用宽度扣掉列表缩进后，再乘表宽百分比（缺省 100%） */
function tableWidthTwip(ctx: BuildContext, widthPct: number | undefined, indent: number): number {
  const available = Math.max(1, availableWidthTwip(ctx) - indent)
  return Math.max(1, Math.round((available * (widthPct ?? 100)) / 100))
}

/** 把表宽等分成 count 列（count 至少按 1 算） */
function equalColumns(tableTwip: number, count: number): number[] {
  const n = Math.max(1, count)
  return Array.from({ length: n }, () => tableTwip / n)
}

/**
 * 表宽（`tblW`）：
 * - 未缩进：百分比，默认 100% 占满文本列。
 * - 列表内的缩进表格：`tblInd` + 100% 会右溢出，改写绝对宽度「(可用宽度 − 缩进) × 百分比」。
 *   不能留 auto —— docx 会按整个可用宽度推导 `tblGrid`，Word 按内容自适应看不出问题，
 *   但 Google Docs / Pages / LibreOffice 以网格为准，表格会溢出右边距一个缩进量。
 *   写成 dxa 后 docx 按这个宽度等分网格，且不写 `tcW`，Word 仍可在该宽度内自适应列宽。
 * - 已有显式网格时用 auto：宽度已由 gridCol 的绝对值定死。
 *
 * 可用宽度在表格单元格内是该单元格的内容宽度（见 availableWidthTwip），所以单元格里的列表表格
 * 同样拿到准确的绝对宽度，不会按版心撑破单元格。
 *
 * @param tableTwip 表格实际宽度（twip），见 tableWidthTwip
 */
function resolveTableWidth(
  widthPct: number | undefined,
  indent: number,
  hasGrid: boolean,
  tableTwip: number,
): ITableWidthProperties {
  if (indent === 0) return { size: widthPct ?? 100, type: WidthType.PERCENTAGE }
  if (hasGrid) return { size: 0, type: WidthType.AUTO }
  return { size: tableTwip, type: WidthType.DXA }
}

/**
 * 把百分比列宽换算成 OOXML 的 `tblGrid`（twip）。
 *
 * 为什么用绝对 twip 而不是给每个单元格设 `tcW pct`：`tblGrid` 是 Word 在固定布局下唯一
 * 权威的列宽来源，而 `tcW` 只是「首选宽度」，autofit 下会被内容重算；且 `tcW` 要正确处理
 * colspan 就得逐格追踪它占据的网格列（还要算上上方行 rowspan 的占位），复杂且易错。
 * 实测参照组 pandoc 也只写 `tblGrid` + `tblLayout fixed`，Word 里比例精确保留。
 *
 * 绝对值取「版心宽度 × 表宽百分比」，与 `tblW pct` 相互印证：即便某些渲染器不按百分比缩放
 * 网格，这份绝对值本身也已经是正确的排版结果。
 *
 * @param tableTwip 表格实际宽度（twip），见 tableWidthTwip
 */
function resolveGrid(columnWidths: number[], tableTwip: number): number[] {
  // 逐列取整并让最后一列吃掉累计误差，保证 gridCol 之和精确等于表宽（差几 twip 会让 Word 重算）
  const out: number[] = []
  let used = 0
  for (let i = 0; i < columnWidths.length; i += 1) {
    const isLast = i === columnWidths.length - 1
    const raw = isLast ? tableTwip - used : Math.round((tableTwip * columnWidths[i]!) / 100)
    const w = Math.max(MIN_GRID_COL_TWIP, raw)
    used += w
    out.push(w)
  }
  return out
}

type CellMargins = ReturnType<typeof resolveCellMargins>

/**
 * @param columns 各网格列宽（twip）。单元格按其起始列与 colspan 取宽度；起始列按同行前面单元格的
 *   colspan 累加，不追踪上方行 rowspan 的占位 —— 与 docx 推算嵌套表格可用宽度（getCellWidth）同一口径
 */
function buildRow(
  row: IRRow,
  ctx: BuildContext,
  columns: number[],
  margins: CellMargins,
): TableRow {
  let column = 0
  const children = row.cells.map((cell) => {
    const span = cell.colSpan ?? 1
    const cellTwip = spannedWidth(columns, column, span)
    column += span
    return buildCell(cell, row.isHeader, ctx, cellTwip - margins.left - margins.right)
  })
  return new TableRow({ tableHeader: row.isHeader, children })
}

/** 从第 start 列起 span 列的总宽；畸形表格（单元格超出网格列数）时超出部分按最后一列宽度估算 */
function spannedWidth(columns: number[], start: number, span: number): number {
  const fallback = columns[columns.length - 1] ?? 0
  let sum = 0
  for (let i = start; i < start + span; i += 1) sum += columns[i] ?? fallback
  return sum
}

/**
 * @param contentTwip 该单元格可容纳内容的宽度（单元格宽扣掉左右内边距），
 *   作为其中嵌套表格的可用宽度（见 availableWidthTwip）
 */
function buildCell(
  cell: IRCell,
  isHeader: boolean,
  ctx: BuildContext,
  contentTwip: number,
): TableCell {
  ctx.cellContentWidths.push(Math.max(1, Math.round(contentTwip)))
  let innerChildren: FileChild[]
  try {
    innerChildren = blocksToChildren(cell.children, ctx)
  } finally {
    ctx.cellContentWidths.pop()
  }
  const children = ensureCellChildren(innerChildren)
  const opts: ITableCellOptions = {
    children,
    columnSpan: cell.colSpan && cell.colSpan > 1 ? cell.colSpan : undefined,
    rowSpan: cell.rowSpan && cell.rowSpan > 1 ? cell.rowSpan : undefined,
    shading: isHeader
      ? { type: ShadingType.CLEAR, color: 'auto', fill: HEADER_SHADING }
      : undefined,
  }
  return new TableCell(opts)
}

function ensureCellChildren(items: FileChild[]): (Paragraph | Table)[] {
  const filtered = items.filter(
    (i): i is Paragraph | Table => i instanceof Paragraph || i instanceof Table,
  )
  if (filtered.length === 0) {
    return [new Paragraph({ children: [] })]
  }
  return filtered
}

export function tableBlockToFileChild(
  block: Extract<Block, { kind: 'table' }>,
  ctx: BuildContext,
): FileChild {
  return buildTable(block.rows, ctx, {
    indent: block.indent,
    cellPaddingPx: block.cellPaddingPx,
    columnWidths: block.columnWidths,
    widthPct: block.widthPct,
  })
}
