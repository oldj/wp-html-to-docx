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
    const ir = build('<table><thead><tr><th>h1</th><th>h2</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>')
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
