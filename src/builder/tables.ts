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

const HEADER_SHADING = 'EFEFEF'

export function buildTable(rows: IRRow[], ctx: BuildContext, indent?: number): Table {
  const indented = indent !== undefined && indent > 0
  // 默认 100% 占满文本列；被嵌入 list 时切到 auto 由内容自适应宽度，
  // 否则 tblInd + 100% 宽会让表格右溢出页面右边距
  const opts: ITableOptions = indented
    ? {
        rows: rows.map((row) => buildRow(row, ctx)),
        width: { size: 0, type: WidthType.AUTO },
        indent: { size: indent, type: WidthType.DXA },
      }
    : {
        rows: rows.map((row) => buildRow(row, ctx)),
        width: { size: 100, type: WidthType.PERCENTAGE },
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
  return buildTable(block.rows, ctx, block.indent)
}
