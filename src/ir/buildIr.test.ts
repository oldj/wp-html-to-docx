import { describe, it, expect } from 'vitest'
import { parseHtmlBodyChildren } from '../parser/parseHtml.js'
import { BuildContext } from './buildContext.js'
import { buildIr } from './buildIr.js'
import type { Block } from '../types.js'

function ir(html: string): Block[] {
  const nodes = parseHtmlBodyChildren(html)
  const ctx = new BuildContext({})
  return buildIr(nodes, ctx)
}

describe('buildIr - 文本块', () => {
  it('空字符串产生 0 个块', () => {
    expect(ir('')).toEqual([])
  })

  it('单段 paragraph', () => {
    expect(ir('<p>hello</p>')).toEqual<Block[]>([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'hello', style: {} }] },
    ])
  })

  it('h1-h6 按级别识别', () => {
    for (let level = 1 as 1 | 2 | 3 | 4 | 5 | 6; level <= 6; level = (level + 1) as 1 | 2 | 3 | 4 | 5 | 6) {
      const result = ir(`<h${level}>t</h${level}>`)
      expect(result).toEqual<Block[]>([
        { kind: 'heading', level, inlines: [{ kind: 'text', text: 't', style: {} }] },
      ])
    }
  })

  it('顶层散落文本聚合为 paragraph', () => {
    const result = ir('hello world')
    expect(result).toEqual<Block[]>([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'hello world', style: {} }] },
    ])
  })

  it('多个相邻段落保持顺序', () => {
    const result = ir('<p>a</p><p>b</p>')
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ kind: 'paragraph' })
    expect(result[1]).toMatchObject({ kind: 'paragraph' })
  })
})

describe('buildIr - 内联样式', () => {
  it('strong 与 b 都映射为 bold', () => {
    expect(ir('<p><strong>x</strong></p>')[0]).toMatchObject({
      inlines: [{ kind: 'text', text: 'x', style: { bold: true } }],
    })
    expect(ir('<p><b>x</b></p>')[0]).toMatchObject({
      inlines: [{ kind: 'text', text: 'x', style: { bold: true } }],
    })
  })

  it('em 与 i 都映射为 italic', () => {
    expect(ir('<p><em>x</em></p>')[0]).toMatchObject({
      inlines: [{ kind: 'text', text: 'x', style: { italic: true } }],
    })
    expect(ir('<p><i>x</i></p>')[0]).toMatchObject({
      inlines: [{ kind: 'text', text: 'x', style: { italic: true } }],
    })
  })

  it('u / s / code', () => {
    expect(ir('<p><u>x</u></p>')[0]).toMatchObject({
      inlines: [{ kind: 'text', text: 'x', style: { underline: true } }],
    })
    expect(ir('<p><s>x</s></p>')[0]).toMatchObject({
      inlines: [{ kind: 'text', text: 'x', style: { strike: true } }],
    })
    expect(ir('<p><code>x</code></p>')[0]).toMatchObject({
      inlines: [{ kind: 'text', text: 'x', style: { code: true } }],
    })
  })

  it('嵌套 strong+em → 同时 bold & italic', () => {
    const block = ir('<p><strong>a<em>b</em></strong></p>')[0]
    expect(block).toMatchObject({
      kind: 'paragraph',
      inlines: [
        { kind: 'text', text: 'a', style: { bold: true } },
        { kind: 'text', text: 'b', style: { bold: true, italic: true } },
      ],
    })
  })

  it('合并相邻同样式 text', () => {
    const block = ir('<p><strong>a</strong><strong>b</strong></p>')[0]
    expect(block).toMatchObject({
      inlines: [{ kind: 'text', text: 'ab', style: { bold: true } }],
    })
  })
})

describe('buildIr - 链接与换行', () => {
  it('a 标签产生 link 样式', () => {
    expect(ir('<p><a href="https://x.com">x</a></p>')[0]).toMatchObject({
      inlines: [{ kind: 'text', text: 'x', style: { link: 'https://x.com' } }],
    })
  })

  it('a 内嵌 strong：link 与 bold 共存', () => {
    expect(ir('<p><a href="https://x.com"><strong>x</strong></a></p>')[0]).toMatchObject({
      inlines: [
        { kind: 'text', text: 'x', style: { link: 'https://x.com', bold: true } },
      ],
    })
  })

  it('br 产生 break inline', () => {
    expect(ir('<p>a<br/>b</p>')[0]).toMatchObject({
      inlines: [
        { kind: 'text', text: 'a', style: {} },
        { kind: 'break' },
        { kind: 'text', text: 'b', style: {} },
      ],
    })
  })
})

describe('buildIr - 空白与实体', () => {
  it('折叠多个空白', () => {
    expect(ir('<p>a   \n  b</p>')[0]).toMatchObject({
      inlines: [{ kind: 'text', text: 'a b', style: {} }],
    })
  })

  it('解码 HTML 实体', () => {
    expect(ir('<p>&amp; &lt; &nbsp;</p>')[0]).toMatchObject({
      inlines: [{ kind: 'text', text: '& < ', style: {} }],
    })
  })

  it('忽略纯空白文本节点（不产生空段）', () => {
    expect(ir('  \n  ')).toEqual([])
  })
})
