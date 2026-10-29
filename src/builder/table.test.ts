import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { htmlToDocx } from '../index.js'
import type { HtmlToDocxOptions } from '../options.js'
import { pageContentWidthTwip } from '../utils/units.js'

async function getDocumentXml(html: string, options?: HtmlToDocxOptions): Promise<string> {
  const u8 = await htmlToDocx(html, options)
  const files = unzipSync(u8)
  const xml = files['word/document.xml']
  if (xml === undefined) throw new Error('document.xml missing')
  return strFromU8(xml)
}

/** 抽出 <w:tblGrid> 里各 gridCol 的 twip 宽度（按出现顺序） */
function getGridCols(xml: string): number[] {
  const grid = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(xml)
  if (grid === null) throw new Error('tblGrid missing')
  return [...grid[1]!.matchAll(/<w:gridCol\s+w:w="(\d+)"\s*\/>/g)].map((m) => parseInt(m[1]!, 10))
}

/** 按出现顺序抽出所有 <w:tblGrid> 的 gridCol（外层表格先于其内嵌套表格出现） */
function getAllGrids(xml: string): number[][] {
  return [...xml.matchAll(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/g)].map((g) =>
    [...g[1]!.matchAll(/<w:gridCol\s+w:w="(\d+)"\s*\/>/g)].map((m) => parseInt(m[1]!, 10)),
  )
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

/** 默认单元格左右内边距之和（twip）：DEFAULT_OPTIONS.tableCellMargin 左右各 5pt = 100 twip */
const DEFAULT_CELL_MARGIN_X = 200

/** 抽出 <w:tblW> 的 type / w 属性 */
function getTblW(xml: string): { type: string; w: string } {
  const m = /<w:tblW\s+w:type="([^"]*)"\s+w:w="([^"]*)"\s*\/>/.exec(xml)
  if (m === null) throw new Error('tblW missing')
  return { type: m[1]!, w: m[2]! }
}

const COLGROUP_1_3_5 =
  '<colgroup><col style="width: 11.1111%" /><col style="width: 33.3333%" /><col style="width: 55.5556%" /></colgroup>'

describe('builder XML - table', () => {
  it('table 产出 <w:tbl>', async () => {
    const xml = await getDocumentXml('<table><tr><td>x</td></tr></table>')
    expect(xml).toContain('<w:tbl>')
    expect(xml).toContain('<w:tr')
    expect(xml).toContain('<w:tc>')
  })

  it('thead 行带 shading 与 tblHeader', async () => {
    const xml = await getDocumentXml(
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>',
    )
    // 表头行渲染为 tblHeader
    expect(xml).toContain('<w:tblHeader')
    // 表头 cell 含填充色（EFEFEF）
    expect(xml).toMatch(/w:fill="EFEFEF"/i)
  })

  it('colspan 产出 gridSpan', async () => {
    const xml = await getDocumentXml('<table><tr><td colspan="2">x</td></tr></table>')
    expect(xml).toMatch(/<w:gridSpan[^>]*w:val="2"/)
  })

  it('单元格内嵌套列表 → numPr', async () => {
    const xml = await getDocumentXml('<table><tr><td><ul><li>a</li></ul></td></tr></table>')
    expect(xml).toContain('<w:numPr>')
  })
})

describe('builder XML - 表格列宽（colgroup → tblGrid）', () => {
  it('百分比 colgroup 落到 gridCol，比例精确保留且合计等于版心宽度', async () => {
    const xml = await getDocumentXml(
      `<table>${COLGROUP_1_3_5}<tr><td>a</td><td>b</td><td>c</td></tr></table>`,
    )
    const cols = getGridCols(xml)
    const content = pageContentWidthTwip({})
    expect(cols).toHaveLength(3)
    // 每列都落在「版心 × 该列占比」上（取整误差 ≤1 twip）
    for (const [i, share] of [1 / 9, 3 / 9, 5 / 9].entries()) {
      expect(cols[i]!).toBeGreaterThanOrEqual(Math.round(content * share) - 1)
      expect(cols[i]!).toBeLessThanOrEqual(Math.round(content * share) + 1)
    }
    // 合计必须精确等于版心宽度：差几 twip 就会让 Word 重算列宽，比例随之走样
    expect(cols.reduce((a, b) => a + b, 0)).toBe(content)
  })

  it('有列宽时锁定为固定布局，否则 autofit 会按内容重算把比例冲掉', async () => {
    const xml = await getDocumentXml(
      `<table>${COLGROUP_1_3_5}<tr><td>a</td><td>b</td><td>c</td></tr></table>`,
    )
    expect(xml).toContain('<w:tblLayout w:type="fixed"/>')
  })

  it('没有 colgroup 时维持原行为：不锁固定布局，gridCol 仍是等分', async () => {
    const xml = await getDocumentXml('<table><tr><td>a</td><td>b</td></tr></table>')
    expect(xml).not.toContain('<w:tblLayout')
    // 无显式网格时由 docx 按版心宽度等分（9.15 起不再写 100 twip 占位）
    const cols = getGridCols(xml)
    expect(cols).toHaveLength(2)
    expect(new Set(cols).size).toBe(1)
    // docx 9.15 起 pct 以五十分之一百分比写出：5000 = 100%
    expect(getTblW(xml)).toEqual({ type: 'pct', w: '5000' })
  })

  it('像素 colgroup 与等比例的百分比写法产出同一份 gridCol', async () => {
    const pxXml = await getDocumentXml(
      '<table><colgroup><col width="100"><col width="300"><col width="500"></colgroup><tr><td>a</td><td>b</td><td>c</td></tr></table>',
    )
    const pctXml = await getDocumentXml(
      `<table>${COLGROUP_1_3_5}<tr><td>a</td><td>b</td><td>c</td></tr></table>`,
    )
    expect(getGridCols(pxXml)).toEqual(getGridCols(pctXml))
  })

  it('<col span="2"> 展开成两个等宽 gridCol', async () => {
    const xml = await getDocumentXml(
      '<table><colgroup><col span="2" style="width: 20%"><col style="width: 60%"></colgroup><tr><td>a</td><td>b</td><td>c</td></tr></table>',
    )
    const cols = getGridCols(xml)
    expect(cols).toHaveLength(3)
    expect(cols[0]).toBe(cols[1])
    expect(cols[2]! / cols[0]!).toBeCloseTo(3, 2)
  })

  it('colspan 单元格不影响网格：tblGrid 三列 + gridSpan 2 同时成立', async () => {
    const xml = await getDocumentXml(
      '<table><colgroup><col style="width: 20%"><col style="width: 30%"><col style="width: 50%"></colgroup><tr><td colspan="2">ab</td><td>c</td></tr><tr><td>a</td><td>b</td><td>c</td></tr></table>',
    )
    const cols = getGridCols(xml)
    expect(cols).toHaveLength(3)
    expect(cols[1]! / cols[0]!).toBeCloseTo(1.5, 2)
    expect(cols[2]! / cols[0]!).toBeCloseTo(2.5, 2)
    expect(xml).toMatch(/<w:gridSpan[^>]*w:val="2"/)
  })

  it('col 数与网格列数不一致时退回等分，不写出错位的网格', async () => {
    const xml = await getDocumentXml(
      '<table><colgroup><col style="width: 20%"><col style="width: 80%"></colgroup><tr><td>a</td><td>b</td><td>c</td></tr></table>',
    )
    const cols = getGridCols(xml)
    expect(cols).toHaveLength(3)
    expect(new Set(cols).size).toBe(1)
    expect(xml).not.toContain('<w:tblLayout')
  })

  it('页面尺寸变化时 gridCol 跟着版心宽度走', async () => {
    const html = `<table>${COLGROUP_1_3_5}<tr><td>a</td><td>b</td><td>c</td></tr></table>`
    const a5 = await getDocumentXml(html, { page: { size: 'A5' } })
    const a4 = await getDocumentXml(html)
    expect(getGridCols(a5).reduce((a, b) => a + b, 0)).toBe(
      pageContentWidthTwip({ page: { size: 'A5' } }),
    )
    expect(getGridCols(a5).reduce((a, b) => a + b, 0)).toBeLessThan(
      getGridCols(a4).reduce((a, b) => a + b, 0),
    )
  })

  it('list 内的缩进表格：网格按「版心 − 缩进」分配，表宽走 auto 不再溢出', async () => {
    const xml = await getDocumentXml(
      '<ul><li>x<table><colgroup><col style="width: 25%"><col style="width: 75%"></colgroup><tr><td>a</td><td>b</td></tr></table></li></ul>',
    )
    const indent = parseInt(/<w:tblInd\s+w:type="dxa"\s+w:w="(\d+)"/.exec(xml)![1]!, 10)
    expect(indent).toBeGreaterThan(0)
    const cols = getGridCols(xml)
    expect(cols.reduce((a, b) => a + b, 0)).toBe(pageContentWidthTwip({}) - indent)
    expect(cols[1]! / cols[0]!).toBeCloseTo(3, 2)
    expect(getTblW(xml)).toEqual({ type: 'auto', w: '0' })
  })

  it('list 内无 colgroup 的缩进表格：tblW 与网格合计都是「版心 − 缩进」，不按整版心推网格', async () => {
    // 防回归：docx 9.15 起 auto 宽表格按整个版心等分 gridCol，叠加 tblInd 后
    // Google Docs / Pages / LibreOffice（以网格为准）里表格会溢出右边距一个缩进量
    const xml = await getDocumentXml(
      '<ul><li>x<table><tr><td>a</td><td>b</td></tr></table></li></ul>',
    )
    const indent = parseInt(/<w:tblInd\s+w:type="dxa"\s+w:w="(\d+)"/.exec(xml)![1]!, 10)
    const expected = pageContentWidthTwip({}) - indent
    expect(getTblW(xml)).toEqual({ type: 'dxa', w: String(expected) })
    const cols = getGridCols(xml)
    expect(cols).toHaveLength(2)
    expect(cols.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(expected)
    expect(cols.reduce((a, b) => a + b, 0)).toBeGreaterThan(expected - cols.length)
    // 没有显式列宽：不写 tcW、不锁固定布局，Word 仍可在该宽度内按内容自适应
    expect(xml).not.toContain('<w:tcW')
    expect(xml).not.toContain('<w:tblLayout')
  })

  it('list 内缩进表格的百分比表宽按「版心 − 缩进」折算', async () => {
    const xml = await getDocumentXml(
      '<ul><li>x<table style="width: 50%"><tr><td>a</td><td>b</td></tr></table></li></ul>',
    )
    const indent = parseInt(/<w:tblInd\s+w:type="dxa"\s+w:w="(\d+)"/.exec(xml)![1]!, 10)
    const expected = Math.round((pageContentWidthTwip({}) - indent) / 2)
    expect(getTblW(xml)).toEqual({ type: 'dxa', w: String(expected) })
  })

  it('表格单元格内的列表缩进表格：dxa 宽按「单元格内容宽 − 缩进」计算，不按版心撑破单元格', async () => {
    const xml = await getDocumentXml(
      '<table><tr><td><ul><li>x<table><tr><td>a</td><td>b</td></tr></table></li></ul></td></tr></table>',
    )
    const widths = [...xml.matchAll(/<w:tblW\s+w:type="([^"]*)"\s+w:w="([^"]*)"\s*\/>/g)].map(
      (m) => ({ type: m[1], w: m[2] }),
    )
    // 外层单列满宽：单元格内容宽 = 版心 − 默认左右内边距（各 5pt = 100 twip）
    const cellContent = pageContentWidthTwip({}) - DEFAULT_CELL_MARGIN_X
    expect(widths).toEqual([
      { type: 'pct', w: '5000' },
      { type: 'dxa', w: String(cellContent - 720) },
    ])
  })

  it('离开单元格后宽度栈复位：表格之后的列表缩进表格仍按版心写 dxa 宽', async () => {
    // 防回归：若单元格内容宽度只压栈不出栈，表格之后的列表表格会按某个单元格的宽度计算
    const xml = await getDocumentXml(
      '<table><tr><td>a</td></tr><tr><td>b</td></tr></table>' +
        '<ul><li>x<table><tr><td>c</td></tr></table></li></ul>',
    )
    const widths = [...xml.matchAll(/<w:tblW\s+w:type="([^"]*)"\s+w:w="([^"]*)"\s*\/>/g)].map(
      (m) => m[1],
    )
    expect(widths).toEqual(['pct', 'dxa'])
  })
})

describe('builder XML - 单元格内嵌套表格按父单元格宽度排版', () => {
  // 防回归：此前嵌套表格的 colgroup 网格按整个版心换算并锁定固定布局，Word 里会撑破外层单元格
  const COLGROUP_1_3 = '<colgroup><col style="width: 25%"><col style="width: 75%"></colgroup>'
  const INNER = `<table>${COLGROUP_1_3}<tr><td>a</td><td>b</td></tr></table>`

  it('外层两列等分：内层 colgroup 网格合计 = 外层单元格宽 − 左右内边距，比例保留', async () => {
    const xml = await getDocumentXml(`<table><tr><td>左</td><td>${INNER}</td></tr></table>`)
    const [outer, inner] = getAllGrids(xml)
    expect(outer).toHaveLength(2)
    expect(sum(inner!)).toBe(Math.round(pageContentWidthTwip({}) / 2 - DEFAULT_CELL_MARGIN_X))
    expect(inner![1]! / inner![0]!).toBeCloseTo(3, 2)
  })

  it('外层有 colgroup：内层按所在列的实际宽度计算', async () => {
    const xml = await getDocumentXml(
      `<table>${COLGROUP_1_3}<tr><td>窄</td><td>${INNER}</td></tr></table>`,
    )
    const [outer, inner] = getAllGrids(xml)
    expect(sum(inner!)).toBe(outer![1]! - DEFAULT_CELL_MARGIN_X)
  })

  it('跨列单元格：内层按所跨各列的总宽计算', async () => {
    const xml = await getDocumentXml(
      `<table><tr><td colspan="2">${INNER}</td></tr><tr><td>a</td><td>b</td></tr></table>`,
    )
    const [, inner] = getAllGrids(xml)
    expect(sum(inner!)).toBe(pageContentWidthTwip({}) - DEFAULT_CELL_MARGIN_X)
  })

  it('cellpadding 覆盖内边距时，内层宽度扣除的是实际内边距', async () => {
    // cellpadding="10"：10px × 15 = 150 twip，左右合计 300
    const xml = await getDocumentXml(`<table cellpadding="10"><tr><td>${INNER}</td></tr></table>`)
    const [, inner] = getAllGrids(xml)
    expect(sum(inner!)).toBe(pageContentWidthTwip({}) - 300)
  })

  it('两层嵌套：每一层都以上一层单元格的内容宽度为准', async () => {
    const xml = await getDocumentXml(
      `<table><tr><td>a</td><td><table><tr><td>b</td><td>${INNER}</td></tr></table></td></tr></table>`,
    )
    const [, middle, inner] = getAllGrids(xml)
    // 中间层无 colgroup，由 docx 按其所在单元格推导网格；最内层按中间层右列的内容宽度计算
    expect(middle).toHaveLength(2)
    const middleCell = Math.round(pageContentWidthTwip({}) / 2 - DEFAULT_CELL_MARGIN_X)
    expect(sum(inner!)).toBe(Math.round(middleCell / 2 - DEFAULT_CELL_MARGIN_X))
  })
})

describe('builder XML - 表宽（table width）', () => {
  it('style="width: X%" 落到 tblW pct，并按该比例缩小网格', async () => {
    const xml = await getDocumentXml(
      '<table style="width: 50%"><colgroup><col style="width: 25%"><col style="width: 75%"></colgroup><tr><td>a</td><td>b</td></tr></table>',
    )
    expect(getTblW(xml)).toEqual({ type: 'pct', w: '2500' })
    const cols = getGridCols(xml)
    expect(cols.reduce((a, b) => a + b, 0)).toBe(Math.round(pageContentWidthTwip({}) / 2))
    expect(cols[1]! / cols[0]!).toBeCloseTo(3, 2)
  })

  it('没写宽度时仍是满宽 100%（历来行为不变）', async () => {
    const xml = await getDocumentXml(
      `<table>${COLGROUP_1_3_5}<tr><td>a</td><td>b</td><td>c</td></tr></table>`,
    )
    expect(getTblW(xml)).toEqual({ type: 'pct', w: '5000' })
  })
})
