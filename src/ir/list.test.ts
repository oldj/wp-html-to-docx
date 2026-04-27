import { describe, it, expect } from 'vitest'
import { parseHtmlBodyChildren } from '../parser/parseHtml.js'
import { BuildContext } from './buildContext.js'
import { buildIr } from './buildIr.js'
import type { Block } from '../types.js'

function build(html: string): { ir: Block[]; ctx: BuildContext } {
  const nodes = parseHtmlBodyChildren(html)
  const ctx = new BuildContext({})
  return { ir: buildIr(nodes, ctx), ctx }
}

describe('buildIr - 列表', () => {
  it('单层 ul：每个 li 产生 list-item，复用同一 reference，level 0', () => {
    const { ir, ctx } = build('<ul><li>a</li><li>b</li></ul>')
    expect(ir).toHaveLength(2)
    expect(ir[0]).toMatchObject({ kind: 'list-item', ref: { level: 0 } })
    expect(ir[1]).toMatchObject({ kind: 'list-item', ref: { level: 0 } })
    if (ir[0]?.kind !== 'list-item' || ir[1]?.kind !== 'list-item') {
      throw new Error('expected list-item')
    }
    expect(ir[0].ref.reference).toBe(ir[1].ref.reference)
    expect(ctx.numbering).toHaveLength(1)
  })

  it('单层 ol：注册 decimal numbering', () => {
    const { ctx } = build('<ol><li>a</li></ol>')
    expect(ctx.numbering).toHaveLength(1)
    expect(ctx.numbering[0]?.levels[0]?.format).toBe('decimal')
  })

  it('嵌套同类型 ul：复用 reference，level 递增', () => {
    const { ir, ctx } = build('<ul><li>a<ul><li>b</li></ul></li></ul>')
    expect(ir).toHaveLength(2)
    if (ir[0]?.kind !== 'list-item' || ir[1]?.kind !== 'list-item') {
      throw new Error('expected list-item')
    }
    expect(ir[0].ref.level).toBe(0)
    expect(ir[1].ref.level).toBe(1)
    expect(ir[0].ref.reference).toBe(ir[1].ref.reference)
    expect(ctx.numbering).toHaveLength(1)
  })

  it('嵌套异类型 ul → ol：创建新 reference，从 level 0 开始', () => {
    const { ir, ctx } = build('<ul><li>a<ol><li>b</li></ol></li></ul>')
    expect(ir).toHaveLength(2)
    if (ir[0]?.kind !== 'list-item' || ir[1]?.kind !== 'list-item') {
      throw new Error('expected list-item')
    }
    expect(ir[0].ref.reference).not.toBe(ir[1].ref.reference)
    expect(ir[1].ref.level).toBe(0)
    expect(ctx.numbering).toHaveLength(2)
    expect(ctx.numbering[0]?.levels[0]?.format).toBe('bullet')
    expect(ctx.numbering[1]?.levels[0]?.format).toBe('decimal')
  })

  it('li 内含内联格式：保留样式', () => {
    const { ir } = build('<ul><li><strong>x</strong></li></ul>')
    expect(ir[0]).toMatchObject({
      kind: 'list-item',
      inlines: [{ kind: 'text', text: 'x', style: { bold: true } }],
    })
  })

  it('li 内多个块级子节点展平时保留文本边界', () => {
    const { ir } = build('<ul><li><p>one</p><p>two</p></li></ul>')
    expect(ir[0]).toMatchObject({
      kind: 'list-item',
      inlines: [{ kind: 'text', text: 'one two', style: {} }],
    })
  })

  it('li 内块级 + 紧跟裸文本时保留文本边界', () => {
    // <p>foo</p>bar 这种「块级后接裸文本」的边界，曾被遗漏导致拼成 "foobar"
    const { ir } = build('<ul><li><p>foo</p>bar</li></ul>')
    expect(ir[0]).toMatchObject({
      kind: 'list-item',
      inlines: [{ kind: 'text', text: 'foo bar', style: {} }],
    })
  })

  it('li 内裸文本 + 紧跟块级时保留文本边界', () => {
    // 反向边界：foo<p>bar</p>，验证两端任一为块级都会插入分隔
    const { ir } = build('<ul><li>foo<p>bar</p></li></ul>')
    expect(ir[0]).toMatchObject({
      kind: 'list-item',
      inlines: [{ kind: 'text', text: 'foo bar', style: {} }],
    })
  })

  it('嵌套 ul 被 div 包裹时仍保留列表语义', () => {
    // 防回归：曾经 <li><div><ul>...</ul></div></li> 会被把 <ul> 当 inline 文本展平
    const { ir, ctx } = build('<ul><li><div><ul><li>x</li></ul></div></li></ul>')
    // 外层 li（空内容）+ 内层 li（'x'）
    expect(ir).toHaveLength(2)
    expect(ir[0]).toMatchObject({ kind: 'list-item', ref: { level: 0 } })
    expect(ir[1]).toMatchObject({ kind: 'list-item', ref: { level: 1 } })
    if (ir[1]?.kind !== 'list-item') throw new Error('expected list-item')
    expect(ir[1].inlines).toEqual([{ kind: 'text', text: 'x', style: {} }])
    // 嵌套层级被正确注册（外层 + 内层共用同 reference 但不同 level）
    expect(ctx.numbering).toHaveLength(1)
  })

  it('嵌套 ul 被 div 包裹 + 同级文本：嵌套列表抽出，文本仍在 li.inlines', () => {
    const { ir } = build('<ul><li>foo<div><ul><li>x</li></ul></div>baz</li></ul>')
    // 外层 li 含 'foo baz'，内层 li 含 'x'
    expect(ir).toHaveLength(2)
    if (ir[0]?.kind !== 'list-item') throw new Error('expected list-item')
    // 'foo' 在 div 之前 + 'baz' 在 div 之后，中间分别由 block-boundary 插入空格
    expect(ir[0].inlines).toEqual([{ kind: 'text', text: 'foo baz', style: {} }])
    if (ir[1]?.kind !== 'list-item') throw new Error('expected nested list-item')
    expect(ir[1].inlines).toEqual([{ kind: 'text', text: 'x', style: {} }])
    expect(ir[1].ref.level).toBe(1)
  })
})

describe('buildIr - blockquote / hr / pre', () => {
  it('blockquote 包含子段', () => {
    const { ir } = build('<blockquote><p>x</p><p>y</p></blockquote>')
    expect(ir).toHaveLength(1)
    expect(ir[0]).toMatchObject({ kind: 'blockquote' })
    if (ir[0]?.kind !== 'blockquote') throw new Error('expected blockquote')
    expect(ir[0].children).toHaveLength(2)
  })

  it('hr 单独成块', () => {
    const { ir } = build('<hr/>')
    expect(ir).toEqual<Block[]>([{ kind: 'hr' }])
  })

  it('pre 完整保留空白与换行', () => {
    const { ir } = build('<pre>line1\n  line2\nline3</pre>')
    expect(ir).toEqual<Block[]>([{ kind: 'pre', text: 'line1\n  line2\nline3' }])
  })

  it('pre 内嵌 code：文本继续抽取', () => {
    const { ir } = build('<pre><code>x\ny</code></pre>')
    expect(ir).toEqual<Block[]>([{ kind: 'pre', text: 'x\ny' }])
  })

  it('嵌套 blockquote：内层完整保留，并能含 p + ul', () => {
    // walkBlocks 对 blockquote 子节点递归走自己；嵌套层数与混合内容应当无损保留
    const { ir } = build(
      '<blockquote><blockquote><p>inner</p><ul><li>x</li></ul></blockquote></blockquote>',
    )
    expect(ir).toHaveLength(1)
    if (ir[0]?.kind !== 'blockquote') throw new Error('expected outer blockquote')
    const outerChildren = ir[0].children
    expect(outerChildren).toHaveLength(1)
    if (outerChildren[0]?.kind !== 'blockquote') throw new Error('expected inner blockquote')
    const innerChildren = outerChildren[0].children
    // 内层应有一个 paragraph 与一个 list-item
    const kinds = innerChildren.map((b) => b.kind)
    expect(kinds).toContain('paragraph')
    expect(kinds).toContain('list-item')
  })
})

describe('buildIr - 空场景兜底', () => {
  it('空 HTML 字符串 → 0 个 block', () => {
    const { ir } = build('')
    expect(ir).toEqual([])
  })

  it('纯空白 HTML → 0 个 block（空白文本节点不产生空段）', () => {
    const { ir } = build('   \n\t  ')
    expect(ir).toEqual([])
  })

  it('空 <li> → list-item.inlines 为空数组，不抛错', () => {
    const { ir } = build('<ul><li></li></ul>')
    expect(ir).toHaveLength(1)
    if (ir[0]?.kind !== 'list-item') throw new Error('expected list-item')
    expect(ir[0].inlines).toEqual([])
  })

  it('空 <td> → cell 至少含一个空 paragraph，避免 docx 拒绝空 cell', () => {
    const { ir } = build('<table><tr><td></td></tr></table>')
    if (ir[0]?.kind !== 'table') throw new Error('expected table')
    const cell = ir[0].rows[0]?.cells[0]
    expect(cell).toBeDefined()
    expect(cell?.children).toHaveLength(1)
    expect(cell?.children[0]).toMatchObject({ kind: 'paragraph', inlines: [] })
  })
})
