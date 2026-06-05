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

function irPreserve(html: string): Block[] {
  const nodes = parseHtmlBodyChildren(html)
  const ctx = new BuildContext({ preserveWhitespace: true })
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
    for (
      let level = 1 as 1 | 2 | 3 | 4 | 5 | 6;
      level <= 6;
      level = (level + 1) as 1 | 2 | 3 | 4 | 5 | 6
    ) {
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
      inlines: [{ kind: 'text', text: 'x', style: { link: 'https://x.com', bold: true } }],
    })
  })

  it('href 协议白名单：javascript: 被拒，文本保留但不挂 link', () => {
    const block = ir('<p><a href="javascript:alert(1)">x</a></p>')[0] as {
      inlines: { kind: string; text?: string; style?: { link?: string } }[]
    }
    expect(block.inlines[0]?.text).toBe('x')
    expect(block.inlines[0]?.style?.link).toBeUndefined()
  })

  it('href 协议白名单：data: 被拒', () => {
    const block = ir('<p><a href="data:text/html,evil">x</a></p>')[0] as {
      inlines: { style?: { link?: string } }[]
    }
    expect(block.inlines[0]?.style?.link).toBeUndefined()
  })

  it('href 大小写不敏感：JaVaScRiPt: 同样被拒', () => {
    const block = ir('<p><a href="JaVaScRiPt:alert(1)">x</a></p>')[0] as {
      inlines: { style?: { link?: string } }[]
    }
    expect(block.inlines[0]?.style?.link).toBeUndefined()
  })

  it('href 锚点 / 相对路径 / mailto / tel 都放行', () => {
    const cases = ['#sec', '/path', './rel', '../up', '?q=1', 'mailto:a@b.com', 'tel:123']
    for (const href of cases) {
      const block = ir(`<p><a href="${href}">x</a></p>`)[0] as {
        inlines: { style?: { link?: string } }[]
      }
      expect(block.inlines[0]?.style?.link).toBe(href)
    }
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

describe('buildIr - preserveWhitespace 选项', () => {
  it('开启后，行首/行中/行尾的连续半角空格保留', () => {
    expect(irPreserve('<p>   foo   bar   </p>')[0]).toMatchObject({
      inlines: [{ kind: 'text', text: '   foo   bar   ', style: {} }],
    })
  })

  it('开启后，全角空格 U+3000 也按原样保留', () => {
    expect(irPreserve('<p>　　foo　　bar</p>')[0]).toMatchObject({
      inlines: [{ kind: 'text', text: '　　foo　　bar', style: {} }],
    })
  })

  it('开启后，含换行/缩进的空白仍折叠（避免格式化 HTML 源把缩进当内容）', () => {
    // 文本节点值是 "\n   foo   bar\n"：两端含 \n 的空白 → 折叠为单空格；
    // 中间纯空格序列 "   " → 原样保留
    expect(irPreserve('<p>\n   foo   bar\n</p>')[0]).toMatchObject({
      inlines: [{ kind: 'text', text: ' foo   bar ', style: {} }],
    })
  })

  it('未开启时默认行为不变（仍折叠为单空格）', () => {
    expect(ir('<p>   foo   bar   </p>')[0]).toMatchObject({
      inlines: [{ kind: 'text', text: ' foo bar ', style: {} }],
    })
  })
})

describe('buildIr - 脚注', () => {
  // 局部 helper：同时拿到 blocks 与 ctx，便于断言 ctx.footnotes
  function build(html: string): { blocks: Block[]; ctx: BuildContext } {
    const nodes = parseHtmlBodyChildren(html)
    const ctx = new BuildContext({})
    return { blocks: buildIr(nodes, ctx), ctx }
  }

  it('引用发射 footnoteRef，定义注册进 ctx.footnotes', () => {
    const { blocks, ctx } = build(
      '<p>x<sup class="wp-footnote-ref"><a href="#fn-1">[1]</a></sup></p>' +
        '<div class="footnotes"><ol><li id="fn-1">note</li></ol></div>',
    )
    expect(blocks).toEqual<Block[]>([
      {
        kind: 'paragraph',
        inlines: [
          { kind: 'text', text: 'x', style: {} },
          { kind: 'footnoteRef', target: 'fn-1' },
        ],
      },
    ])
    const entry = ctx.footnotes.get('fn-1')
    expect(entry?.number).toBe(1)
    expect(entry?.blocks).toEqual<Block[]>([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'note', style: {} }] },
    ])
  })

  it('定义容器不进 Block[]（div.footnotes 被跳过）', () => {
    const { blocks } = build(
      '<p>x</p><div class="footnotes"><ol><li id="fn-1">note</li></ol></div>',
    )
    expect(blocks).toEqual<Block[]>([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'x', style: {} }] },
    ])
  })

  it('回跳箭头从脚注内容剥离', () => {
    const { ctx } = build(
      '<p>x<sup class="wp-footnote-ref"><a href="#fn-1">[1]</a></sup></p>' +
        '<div class="footnotes"><ol><li id="fn-1">note' +
        '<a href="#fnref-1" class="footnote-backref">↩</a></li></ol></div>',
    )
    expect(ctx.footnotes.get('fn-1')?.blocks).toEqual<Block[]>([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'note', style: {} }] },
    ])
  })

  it('多脚注按定义顺序编号（fn-1→1、fn-2→2）', () => {
    const { ctx } = build(
      '<div class="footnotes"><ol><li id="fn-1">a</li><li id="fn-2">b</li></ol></div>',
    )
    expect(ctx.footnotes.get('fn-1')?.number).toBe(1)
    expect(ctx.footnotes.get('fn-2')?.number).toBe(2)
  })

  it('重复定义同一 id：只注册一次（沿用首个编号与内容）', () => {
    const { ctx } = build(
      '<div class="footnotes"><ol><li id="fn-1">first</li><li id="fn-1">second</li></ol></div>',
    )
    expect(ctx.footnotes.size).toBe(1)
    expect(ctx.footnotes.get('fn-1')?.number).toBe(1)
    expect(ctx.footnotes.get('fn-1')?.blocks).toEqual<Block[]>([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'first', style: {} }] },
    ])
  })

  it('普通 <sup>（无脚注 class）不发射 footnoteRef，而是产生上标', () => {
    const { blocks } = build('<p>E=mc<sup>2</sup></p>')
    expect(blocks).toEqual<Block[]>([
      {
        kind: 'paragraph',
        inlines: [
          { kind: 'text', text: 'E=mc', style: {} },
          { kind: 'text', text: '2', style: { superScript: true } },
        ],
      },
    ])
  })

  it('脚注 class 但无可解析锚点：退回普通上标处理', () => {
    const { blocks } = build('<p><sup class="wp-footnote-ref">x</sup></p>')
    expect(blocks).toEqual<Block[]>([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'x', style: { superScript: true } }] },
    ])
  })
})
