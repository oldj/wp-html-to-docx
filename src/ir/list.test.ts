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
})
