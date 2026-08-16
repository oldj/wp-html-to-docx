// 表格 builder
// 表宽默认满宽（可由 <table style="width: X%"> 收窄）；thead 行自动加粗 + 灰底（HEADER_SHADING）。
// 支持 colspan / rowspan（>1 时透传给 docx）。
// HTML 的 colgroup / col 列宽由 IR 归一化成百分比传进来，落到 OOXML 的 tblGrid + 固定布局；
// 没有 colgroup 时不下发网格，交给 Word 等分（docx 库的默认行为）。

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
} from 'docx'
import type { Block, TableCell as IRCell, TableRow as IRRow } from '../types.js'
import type { BuildContext } from '../ir/buildContext.js'
import { blocksToChildren } from './blocks.js'
import { DEFAULT_OPTIONS } from '../options.js'
import { pageContentWidthTwip, toTwip } from '../utils/units.js'

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
  const { indent, cellPaddingPx, columnWidths, widthPct } = layout
  const indented = indent !== undefined && indent > 0
  const margins = resolveCellMargins(ctx, cellPaddingPx)
  const builtRows = rows.map((row) => buildRow(row, ctx))
  const grid = resolveGrid(ctx, columnWidths, widthPct, indented ? indent : 0)

  // 默认 100% 占满文本列；被嵌入 list 时切到 auto 由内容自适应宽度，
  // 否则 tblInd + 100% 宽会让表格右溢出页面右边距。
  // 有显式网格时缩进表格同样走 auto —— 此时宽度已由 gridCol 的绝对值定死，不需要百分比。
  const width = indented
    ? { size: 0, type: WidthType.AUTO }
    : { size: widthPct ?? 100, type: WidthType.PERCENTAGE }

  const opts: ITableOptions = {
    rows: builtRows,
    width,
    ...(indented ? { indent: { size: indent, type: WidthType.DXA } } : {}),
    margins: { ...margins, marginUnitType: WidthType.DXA },
    // 只有拿到显式列宽才下发网格并锁死布局：autofit 会按内容重算列宽，
    // 会把好不容易保留下来的比例冲掉；没有列宽时保持 autofit（等分 + 内容自适应）。
    ...(grid !== undefined ? { columnWidths: grid, layout: TableLayoutType.FIXED } : {}),
  }
  return new Table(opts)
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
 */
function resolveGrid(
  ctx: BuildContext,
  columnWidths: number[] | undefined,
  widthPct: number | undefined,
  indent: number,
): number[] | undefined {
  if (columnWidths === undefined || columnWidths.length === 0) return undefined
  const available = Math.max(1, pageContentWidthTwip(ctx.options) - indent)
  const tableTwip = Math.max(1, Math.round((available * (widthPct ?? 100)) / 100))

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

function buildRow(row: IRRow, ctx: BuildContext): TableRow {
  return new TableRow({
    tableHeader: row.isHeader,
    children: row.cells.map((cell) => buildCell(cell, row.isHeader, ctx)),
  })
}

function buildCell(cell: IRCell, isHeader: boolean, ctx: BuildContext): TableCell {
  const innerChildren = blocksToChildren(cell.children, ctx)
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
