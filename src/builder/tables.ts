// 表格 builder
// MVP：列宽均分（auto），thead 行加粗 + 灰底；不支持单元格合并

import {
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  WidthType,
  type FileChild,
  type ITableCellOptions,
} from 'docx'
import type { Block, TableCell as IRCell, TableRow as IRRow } from '../types.js'
import type { BuildContext } from '../ir/buildContext.js'
import { blocksToChildren } from './blocks.js'

const HEADER_SHADING = 'EFEFEF'

export function buildTable(rows: IRRow[], ctx: BuildContext): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row) => buildRow(row, ctx)),
  })
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
  return buildTable(block.rows, ctx)
}
