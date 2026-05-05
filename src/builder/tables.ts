// 表格 builder
// 列宽统一按 100% 表宽自动分配；thead 行自动加粗 + 灰底（HEADER_SHADING）。
// 支持 colspan / rowspan（>1 时透传给 docx）；HTML 上的 colgroup / col 暂不读取

import {
  Paragraph,
  ShadingType,
  Table,
  TableCell,
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
import { toTwip } from '../utils/units.js'

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

export function buildTable(
  rows: IRRow[],
  ctx: BuildContext,
  indent?: number,
  cellPaddingPx?: number,
): Table {
  const indented = indent !== undefined && indent > 0
  const margins = resolveCellMargins(ctx, cellPaddingPx)
  // 默认 100% 占满文本列；被嵌入 list 时切到 auto 由内容自适应宽度，
  // 否则 tblInd + 100% 宽会让表格右溢出页面右边距
  const builtRows = rows.map((row) => buildRow(row, ctx))
  const opts: ITableOptions = indented
    ? {
        rows: builtRows,
        width: { size: 0, type: WidthType.AUTO },
        indent: { size: indent, type: WidthType.DXA },
        margins: { ...margins, marginUnitType: WidthType.DXA },
      }
    : {
        rows: builtRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
        margins: { ...margins, marginUnitType: WidthType.DXA },
      }
  return new Table(opts)
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
  return buildTable(block.rows, ctx, block.indent, block.cellPaddingPx)
}
