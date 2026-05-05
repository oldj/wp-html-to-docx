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

  it('li 内多个 <p>：合并为单个 list-item，段间用软换行连接（编号仅一次）', () => {
    const { ir } = build('<ul><li><p>one</p><p>two</p></li></ul>')
    expect(ir).toHaveLength(1)
    expect(ir[0]).toMatchObject({
      kind: 'list-item',
      inlines: [
        { kind: 'text', text: 'one', style: {} },
        { kind: 'break' },
        { kind: 'text', text: 'two', style: {} },
      ],
    })
  })

  it('li 内块级 + 紧跟裸文本：单段 list-item，段间用软换行', () => {
    const { ir } = build('<ul><li><p>foo</p>bar</li></ul>')
    expect(ir).toHaveLength(1)
    expect(ir[0]).toMatchObject({
      kind: 'list-item',
      inlines: [
        { kind: 'text', text: 'foo', style: {} },
        { kind: 'break' },
        { kind: 'text', text: 'bar', style: {} },
      ],
    })
  })

  it('li 内裸文本 + 紧跟块级：单段 list-item，段间用软换行', () => {
    const { ir } = build('<ul><li>foo<p>bar</p></li></ul>')
    expect(ir).toHaveLength(1)
    expect(ir[0]).toMatchObject({
      kind: 'list-item',
      inlines: [
        { kind: 'text', text: 'foo', style: {} },
        { kind: 'break' },
        { kind: 'text', text: 'bar', style: {} },
      ],
    })
  })

  it('嵌套 list 内层 li 含多 <p>：内层 list-item 的多段也用软换行合并', () => {
    const { ir } = build('<ul><li>a<ul><li><p>x</p><p>y</p></li></ul></li></ul>')
    // 期望: [list-item('a', lv0), list-item([x, break, y], lv1)]
    expect(ir).toHaveLength(2)
    expect(ir[1]).toMatchObject({
      kind: 'list-item',
      ref: { level: 1 },
      inlines: [
        { kind: 'text', text: 'x', style: {} },
        { kind: 'break' },
        { kind: 'text', text: 'y', style: {} },
      ],
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

  it('li 内 3 个 <p>：合并为单 list-item，含 2 个软换行（验证 break 间隔，不只是首尾）', () => {
    const { ir } = build('<ul><li><p>a</p><p>b</p><p>c</p></li></ul>')
    expect(ir).toHaveLength(1)
    if (ir[0]?.kind !== 'list-item') throw new Error('expected list-item')
    const breakCount = ir[0].inlines.filter((i) => i.kind === 'break').length
    expect(breakCount).toBe(2)
    expect(ir[0].inlines).toEqual([
      { kind: 'text', text: 'a', style: {} },
      { kind: 'break' },
      { kind: 'text', text: 'b', style: {} },
      { kind: 'break' },
      { kind: 'text', text: 'c', style: {} },
    ])
  })

  it('li 内 <pre> + 后续文本：拆为空 list-item / pre / list-continuation（与 hr 路径对称）', () => {
    const { ir } = build('<ul><li><pre>code</pre>after</li></ul>')
    expect(ir).toHaveLength(3)
    expect(ir[0]).toMatchObject({ kind: 'list-item', inlines: [] })
    expect(ir[1]).toEqual<Block>({ kind: 'pre', text: 'code', indent: 720 })
    expect(ir[2]).toMatchObject({
      kind: 'list-continuation',
      level: 0,
      inlines: [{ kind: 'text', text: 'after', style: {} }],
    })
  })

  it('li 内连续两个 standalone 块：均独立产出，不互相吞并', () => {
    // 验证一个 standalone 块结束后，下一个 standalone 块的 ensureFirstEmitted 不会再插入空占位
    const { ir } = build(
      '<ul><li>foo<table><tr><td>x</td></tr></table><pre>code</pre>bar</li></ul>',
    )
    expect(ir).toHaveLength(4)
    expect(ir[0]).toMatchObject({
      kind: 'list-item',
      inlines: [{ kind: 'text', text: 'foo', style: {} }],
    })
    expect(ir[1]).toMatchObject({ kind: 'table' })
    expect(ir[2]).toEqual<Block>({ kind: 'pre', text: 'code', indent: 720 })
    expect(ir[3]).toMatchObject({
      kind: 'list-continuation',
      level: 0,
      inlines: [{ kind: 'text', text: 'bar', style: {} }],
    })
  })

  it('嵌套 li 内含 <table>：内层 li 占外层一个序号，table 紧随其后输出', () => {
    const { ir } = build('<ul><li>a<ul><li>b<table><tr><td>x</td></tr></table></li></ul></li></ul>')
    // 顺序: [外层 list-item('a', lv0), 内层 list-item('b', lv1), table]
    expect(ir).toHaveLength(3)
    expect(ir[0]).toMatchObject({ kind: 'list-item', ref: { level: 0 } })
    expect(ir[1]).toMatchObject({ kind: 'list-item', ref: { level: 1 } })
    expect(ir[2]).toMatchObject({ kind: 'table' })
  })

  it('li 内 <table>：保持表格结构，外层 li 占位空 list-item', () => {
    const { ir } = build('<ul><li><table><tr><td>x</td></tr></table></li></ul>')
    expect(ir).toHaveLength(2)
    expect(ir[0]).toMatchObject({ kind: 'list-item', inlines: [] })
    expect(ir[1]).toMatchObject({ kind: 'table' })
  })

  it('li 内含文本 + <table> + 文本：拆为 list-item / table / list-continuation', () => {
    const { ir } = build('<ul><li>foo<table><tr><td>x</td></tr></table>bar</li></ul>')
    expect(ir).toHaveLength(3)
    expect(ir[0]).toMatchObject({
      kind: 'list-item',
      inlines: [{ kind: 'text', text: 'foo', style: {} }],
    })
    expect(ir[1]).toMatchObject({ kind: 'table' })
    expect(ir[2]).toMatchObject({
      kind: 'list-continuation',
      level: 0,
      inlines: [{ kind: 'text', text: 'bar', style: {} }],
    })
  })

  it('li 内 <pre>：保持 pre 结构，不被拍扁为内联', () => {
    const { ir } = build('<ul><li><pre>line1\n  line2</pre></li></ul>')
    expect(ir).toHaveLength(2)
    expect(ir[0]).toMatchObject({ kind: 'list-item', inlines: [] })
    expect(ir[1]).toEqual<Block>({ kind: 'pre', text: 'line1\n  line2', indent: 720 })
  })

  it('li 内 standalone 块继承 list 缩进：table / pre / blockquote / hr 各带 indent=720（level 0）', () => {
    // 防回归：list 内独立块视觉上应跟随列表缩进，否则飘到文档左边距
    const { ir } = build(
      '<ul><li>x<table><tr><td>y</td></tr></table><pre>p</pre><blockquote><p>q</p></blockquote><hr></li></ul>',
    )
    // [list-item('x'), table+indent, pre+indent, blockquote+indent, hr+indent]
    expect(ir).toHaveLength(5)
    expect(ir[1]).toMatchObject({ kind: 'table', indent: 720 })
    expect(ir[2]).toMatchObject({ kind: 'pre', indent: 720 })
    expect(ir[3]).toMatchObject({ kind: 'blockquote', indent: 720 })
    expect(ir[4]).toMatchObject({ kind: 'hr', indent: 720 })
  })

  it('嵌套 li (level 1) 内的 standalone 块缩进 = 1440', () => {
    const { ir } = build('<ul><li>a<ul><li>b<table><tr><td>x</td></tr></table></li></ul></li></ul>')
    expect(ir).toHaveLength(3)
    expect(ir[2]).toMatchObject({ kind: 'table', indent: 1440 })
  })

  it('顶层 standalone 块（不在 list 内）不带 indent', () => {
    // 防回归：保证 indent 注入仅在 li 内发生，顶层用法不受影响
    const { ir } = build('<table><tr><td>x</td></tr></table>')
    expect(ir).toHaveLength(1)
    expect(ir[0]).toMatchObject({ kind: 'table' })
    if (ir[0]?.kind !== 'table') throw new Error('expected table')
    expect(ir[0].indent).toBeUndefined()
  })

  it('li 内 <blockquote>：保持 blockquote 结构', () => {
    const { ir } = build('<ul><li>foo<blockquote><p>q</p></blockquote></li></ul>')
    expect(ir).toHaveLength(2)
    expect(ir[0]).toMatchObject({
      kind: 'list-item',
      inlines: [{ kind: 'text', text: 'foo', style: {} }],
    })
    expect(ir[1]).toMatchObject({ kind: 'blockquote' })
  })

  it('li 内 <hr class="page-break">：生成分页符块而非吞掉', () => {
    const { ir } = build('<ul><li>before<hr class="page-break">after</li></ul>')
    expect(ir).toHaveLength(3)
    expect(ir[0]).toMatchObject({ kind: 'list-item' })
    expect(ir[1]).toEqual<Block>({ kind: 'pageBreak' })
    expect(ir[2]).toMatchObject({ kind: 'list-continuation' })
  })

  it('嵌套 ul 被 div 包裹 + 同级文本：嵌套列表抽出，前后裸文本拆为列表项与延续段', () => {
    const { ir } = build('<ul><li>foo<div><ul><li>x</li></ul></div>baz</li></ul>')
    // 顺序: [list-item('foo'), 嵌套 list-item('x'), list-continuation('baz')]
    expect(ir).toHaveLength(3)
    if (ir[0]?.kind !== 'list-item') throw new Error('expected list-item')
    expect(ir[0].inlines).toEqual([{ kind: 'text', text: 'foo', style: {} }])
    if (ir[1]?.kind !== 'list-item') throw new Error('expected nested list-item')
    expect(ir[1].inlines).toEqual([{ kind: 'text', text: 'x', style: {} }])
    expect(ir[1].ref.level).toBe(1)
    if (ir[2]?.kind !== 'list-continuation') throw new Error('expected list-continuation')
    expect(ir[2].inlines).toEqual([{ kind: 'text', text: 'baz', style: {} }])
    expect(ir[2].level).toBe(0)
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
