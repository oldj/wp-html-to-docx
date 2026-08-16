import { describe, it, expect } from 'vitest'
import { parseHtmlBodyChildren } from '../parser/parseHtml.js'
import { BuildContext } from './buildContext.js'
import { buildIr } from './buildIr.js'
import type { Block } from '../types.js'

function build(html: string): Block[] {
  return buildIr(parseHtmlBodyChildren(html), new BuildContext({}))
}

describe('buildIr - table', () => {
  it('简单 2x2 表（无 thead）：所有行非 header', () => {
    const ir = build('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>')
    expect(ir).toHaveLength(1)
    if (ir[0]?.kind !== 'table') throw new Error('expected table')
    expect(ir[0].rows).toHaveLength(2)
    expect(ir[0].rows[0]?.isHeader).toBe(false)
    expect(ir[0].rows[0]?.cells).toHaveLength(2)
  })

  it('thead 内的行标记为 header', () => {
    const ir = build(
      '<table><thead><tr><th>h1</th><th>h2</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
    )
    if (ir[0]?.kind !== 'table') throw new Error('expected table')
    expect(ir[0].rows).toHaveLength(2)
    expect(ir[0].rows[0]?.isHeader).toBe(true)
    expect(ir[0].rows[1]?.isHeader).toBe(false)
  })

  it('全 th 行（无 thead 包裹）也识别为 header', () => {
    const ir = build('<table><tr><th>x</th><th>y</th></tr><tr><td>a</td><td>b</td></tr></table>')
    if (ir[0]?.kind !== 'table') throw new Error('expected table')
    expect(ir[0].rows[0]?.isHeader).toBe(true)
    expect(ir[0].rows[1]?.isHeader).toBe(false)
  })

  it('parse5 自动补 tbody（HTML 容错）', () => {
    // 直接 <table><tr> 而无 tbody，parse5 会补全；buildIr 应正确收集
    const ir = build('<table><tr><td>x</td></tr></table>')
    if (ir[0]?.kind !== 'table') throw new Error('expected table')
    expect(ir[0].rows).toHaveLength(1)
  })

  it('单元格 colspan / rowspan', () => {
    const ir = build('<table><tr><td colspan="2">x</td></tr></table>')
    if (ir[0]?.kind !== 'table') throw new Error('expected table')
    expect(ir[0].rows[0]?.cells[0]?.colSpan).toBe(2)
  })

  it('单元格内嵌套段落与列表', () => {
    const ir = build('<table><tr><td><p>x</p><ul><li>a</li></ul></td></tr></table>')
    if (ir[0]?.kind !== 'table') throw new Error('expected table')
    const cell = ir[0].rows[0]?.cells[0]
    expect(cell?.children).toHaveLength(2)
    expect(cell?.children[0]).toMatchObject({ kind: 'paragraph' })
    expect(cell?.children[1]).toMatchObject({ kind: 'list-item' })
  })
})

/** 取出唯一一个 table 块，找不到直接抛错（避免用例在 IR 形状变化时静默通过） */
function buildTableBlock(html: string): Extract<Block, { kind: 'table' }> {
  const ir = build(html)
  const table = ir.find((b) => b.kind === 'table')
  if (table?.kind !== 'table') throw new Error('expected table')
  return table
}

/** 列宽断言容差：归一化后是浮点数，比较到小数点后 4 位即可 */
function expectWidths(actual: number[] | undefined, expected: number[]): void {
  expect(actual).toHaveLength(expected.length)
  actual?.forEach((w, i) => expect(w).toBeCloseTo(expected[i]!, 4))
}

describe('buildIr - table 列宽（colgroup / col）', () => {
  it('百分比 col 归一化为合计 100 的列宽（1:3:5）', () => {
    const table = buildTableBlock(
      '<table><colgroup><col style="width: 11.1111%" /><col style="width: 33.3333%" /><col style="width: 55.5556%" /></colgroup><tr><td>a</td><td>b</td><td>c</td></tr></table>',
    )
    expectWidths(table.columnWidths, [100 / 9, 300 / 9, 500 / 9])
  })

  it('像素 col 只取比例，结果与等比例的百分比写法一致', () => {
    const table = buildTableBlock(
      '<table><colgroup><col width="100"><col width="300"><col width="500"></colgroup><tr><td>a</td><td>b</td><td>c</td></tr></table>',
    )
    expectWidths(table.columnWidths, [100 / 9, 300 / 9, 500 / 9])
  })

  it('<col span="2"> 展开成两个等宽列（不是均分一份）', () => {
    const table = buildTableBlock(
      '<table><colgroup><col span="2" style="width: 20%"><col style="width: 60%"></colgroup><tr><td>a</td><td>b</td><td>c</td></tr></table>',
    )
    expectWidths(table.columnWidths, [20, 20, 60])
  })

  it('colspan 单元格按跨列数计入网格列数，列宽照常保留', () => {
    const table = buildTableBlock(
      '<table><colgroup><col style="width: 20%"><col style="width: 30%"><col style="width: 50%"></colgroup><tr><td colspan="2">ab</td><td>c</td></tr></table>',
    )
    expectWidths(table.columnWidths, [20, 30, 50])
  })

  it('没有 colgroup 时不产出列宽', () => {
    const table = buildTableBlock('<table><tr><td>a</td><td>b</td></tr></table>')
    expect(table.columnWidths).toBeUndefined()
  })

  it('有列没声明宽度时整体放弃（无法推断其余列）', () => {
    const table = buildTableBlock(
      '<table><colgroup><col style="width: 20%"><col></colgroup><tr><td>a</td><td>b</td></tr></table>',
    )
    expect(table.columnWidths).toBeUndefined()
  })

  it('col 数与网格列数不一致时整体放弃（避免 tblGrid 与 gridSpan 错位）', () => {
    const table = buildTableBlock(
      '<table><colgroup><col style="width: 20%"><col style="width: 80%"></colgroup><tr><td>a</td><td>b</td><td>c</td></tr></table>',
    )
    expect(table.columnWidths).toBeUndefined()
  })

  it('无法识别的宽度取值（auto）视同缺宽', () => {
    const table = buildTableBlock(
      '<table><colgroup><col style="width: auto"><col style="width: 80%"></colgroup><tr><td>a</td><td>b</td></tr></table>',
    )
    expect(table.columnWidths).toBeUndefined()
  })
})

describe('buildIr - table 表宽', () => {
  it('style="width: X%" 读成 widthPct', () => {
    const table = buildTableBlock(
      '<table style="width: 57.1429%; table-layout: fixed"><tr><td>a</td></tr></table>',
    )
    expect(table.widthPct).toBeCloseTo(57.1429, 4)
  })

  it('遗留属性 width="50%" 同样识别', () => {
    const table = buildTableBlock('<table width="50%"><tr><td>a</td></tr></table>')
    expect(table.widthPct).toBe(50)
  })

  it('绝对宽度（px）不产出 widthPct，交给 builder 按满宽处理', () => {
    const table = buildTableBlock('<table style="width: 600px"><tr><td>a</td></tr></table>')
    expect(table.widthPct).toBeUndefined()
  })

  it('超过 100% 的表宽钳到满宽，避免溢出版心', () => {
    const table = buildTableBlock('<table style="width: 150%"><tr><td>a</td></tr></table>')
    expect(table.widthPct).toBe(100)
  })

  it('没写宽度时不产出 widthPct', () => {
    const table = buildTableBlock('<table><tr><td>a</td></tr></table>')
    expect(table.widthPct).toBeUndefined()
  })
})
