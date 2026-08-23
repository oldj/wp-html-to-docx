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

  it('嵌套异类型 ul → ol：创建新 reference，但 level 仍按嵌套深度递增', () => {
    // 深度按任意列表祖先计数：ul 里的 ol 是第二层，缩进要比外层多一级；
    // 此前异类型嵌套从 level 0 重新起算，内层与外层缩进相同、看不出层次
    const { ir, ctx } = build('<ul><li>a<ol><li>b</li></ol></li></ul>')
    expect(ir).toHaveLength(2)
    if (ir[0]?.kind !== 'list-item' || ir[1]?.kind !== 'list-item') {
      throw new Error('expected list-item')
    }
    expect(ir[0].ref.reference).not.toBe(ir[1].ref.reference)
    expect(ir[0].ref.level).toBe(0)
    expect(ir[1].ref.level).toBe(1)
    expect(ctx.numbering).toHaveLength(2)
    expect(ctx.numbering[0]?.levels[0]?.format).toBe('bullet')
    // 新 reference 的第二层是有序列表的二级默认形态（a.），不是 decimal
    expect(ctx.numbering[1]?.levels[1]?.format).toBe('lowerLetter')
  })

  it('默认层级方案：ol 三级一循环 1. a. i.，ul 循环 • ◦ ▪', () => {
    const { ctx } = build('<ol><li>a</li></ol><ul><li>b</li></ul>')
    const ol = ctx.numbering[0]?.levels ?? []
    const ul = ctx.numbering[1]?.levels ?? []
    expect(ol.map((l) => l.format)).toEqual([
      'decimal',
      'lowerLetter',
      'lowerRoman',
      'decimal',
      'lowerLetter',
      'lowerRoman',
      'decimal',
      'lowerLetter',
    ])
    expect(ol.map((l) => l.text)).toEqual(['%1.', '%2.', '%3.', '%4.', '%5.', '%6.', '%7.', '%8.'])
    expect(ul.map((l) => l.text)).toEqual(['•', '◦', '▪', '•', '◦', '▪', '•', '◦'])
    expect(ul.every((l) => l.format === 'bullet')).toBe(true)
  })

  it('data-list-style 指定格式：该列表拥有专属 reference，仅自身层级用指定格式', () => {
    const { ir, ctx } = build(
      '<ol data-list-style="upper-roman" style="list-style-type: upper-roman"><li>a<ol><li>b</li></ol></li></ol>',
    )
    if (ir[0]?.kind !== 'list-item' || ir[1]?.kind !== 'list-item') {
      throw new Error('expected list-item')
    }
    // 内层没有自己的格式 → 复用外层 reference，落在第二层
    expect(ir[1].ref.reference).toBe(ir[0].ref.reference)
    expect(ir[1].ref.level).toBe(1)
    expect(ctx.numbering).toHaveLength(1)
    const levels = ctx.numbering[0]?.levels ?? []
    expect(levels[0]?.format).toBe('upperRoman')
    // 外层的指定格式不下渗：第二层仍是层级默认的 a.
    expect(levels[1]?.format).toBe('lowerLetter')
  })

  it('嵌套列表自己指定了格式：注册专属 reference，覆盖的是它所在的层', () => {
    const { ir, ctx } = build(
      '<ol><li>a<ol data-list-style="decimal"><li>b</li></ol></li><li>c</li></ol>',
    )
    if (ir[0]?.kind !== 'list-item' || ir[1]?.kind !== 'list-item' || ir[2]?.kind !== 'list-item') {
      throw new Error('expected list-item')
    }
    expect(ir[1].ref.reference).not.toBe(ir[0].ref.reference)
    expect(ir[1].ref.level).toBe(1)
    // 外层第二项仍回到外层 reference
    expect(ir[2].ref.reference).toBe(ir[0].ref.reference)
    expect(ctx.numbering).toHaveLength(2)
    const inner = ctx.numbering[1]?.levels ?? []
    expect(inner[1]?.format).toBe('decimal')
    expect(inner[0]?.format).toBe('decimal')
  })

  it('格式来源优先级：data-list-style > style 的 list-style-type > type 属性', () => {
    const pick = (html: string): string | undefined =>
      build(html).ctx.numbering[0]?.levels[0]?.format
    expect(
      pick(
        '<ol data-list-style="lower-roman" style="list-style-type: upper-alpha" type="1"><li>a</li></ol>',
      ),
    ).toBe('lowerRoman')
    expect(pick('<ol style="list-style-type: upper-alpha" type="1"><li>a</li></ol>')).toBe(
      'upperLetter',
    )
    expect(pick('<ol type="I"><li>a</li></ol>')).toBe('upperRoman')
    expect(pick('<ol type="i"><li>a</li></ol>')).toBe('lowerRoman')
    expect(pick('<ol type="a"><li>a</li></ol>')).toBe('lowerLetter')
  })

  it('中文数字与 none：映射到对应的 OOXML 格式，顿号作后缀', () => {
    const levels = (html: string) => build(html).ctx.numbering[0]?.levels ?? []
    const cjk = levels('<ol data-list-style="cjk-decimal"><li>a</li></ol>')
    expect(cjk[0]).toMatchObject({ format: 'ideographDigital', text: '%1、' })
    const simp = levels('<ol data-list-style="simp-chinese-informal"><li>a</li></ol>')
    expect(simp[0]).toMatchObject({ format: 'chineseCounting', text: '%1、' })
    const trad = levels('<ol data-list-style="trad-chinese-informal"><li>a</li></ol>')
    expect(trad[0]).toMatchObject({ format: 'taiwaneseCounting', text: '%1、' })
    const none = levels('<ul data-list-style="none"><li>a</li></ul>')
    expect(none[0]).toMatchObject({ format: 'none', text: '' })
  })

  it('ul 的项目符号可指定；ul 上写编号格式、ol 上写项目符号一律忽略', () => {
    const { ctx } = build(
      '<ul data-list-style="square"><li>a</li></ul>' +
        '<ul data-list-style="decimal"><li>b</li></ul>' +
        '<ol data-list-style="circle"><li>c</li></ol>' +
        '<ol style="list-style-type: url(x)"><li>d</li></ol>',
    )
    expect(ctx.numbering[0]?.levels[0]).toMatchObject({ format: 'bullet', text: '▪' })
    expect(ctx.numbering[1]?.levels[0]).toMatchObject({ format: 'bullet', text: '•' })
    expect(ctx.numbering[2]?.levels[0]?.format).toBe('decimal')
    expect(ctx.numbering[3]?.levels[0]?.format).toBe('decimal')
  })

  it('options.listLevels：全局层级方案按深度循环，元素自身指定的格式仍优先', () => {
    const nodes = parseHtmlBodyChildren(
      '<ol><li>a<ol><li>b<ol><li>c<ol><li>d</li></ol></li></ol></li></ol></li></ol>' +
        '<ul><li>x</li></ul>' +
        '<ol data-list-style="lower-roman"><li>y</li></ol>',
    )
    const ctx = new BuildContext({
      listLevels: {
        ordered: ['simp-chinese-informal', 'decimal'],
        bullet: ['square'],
      },
    })
    buildIr(nodes, ctx)
    const ol = ctx.numbering[0]?.levels ?? []
    // 两项方案按深度循环：一、/ 1. / 一、/ 1. …
    expect(ol.slice(0, 4).map((l) => l.format)).toEqual([
      'chineseCounting',
      'decimal',
      'chineseCounting',
      'decimal',
    ])
    expect(ol[0]?.text).toBe('%1、')
    const ul = ctx.numbering[1]?.levels ?? []
    expect(ul.every((l) => l.text === '▪')).toBe(true)
    // 元素自己指定的格式压过全局方案
    expect(ctx.numbering[2]?.levels[0]?.format).toBe('lowerRoman')
    // 但它的其余层仍走全局方案
    expect(ctx.numbering[2]?.levels[1]?.format).toBe('decimal')
  })

  it('options.listLevels：非法项跳过并 warn，整组非法时回退默认方案', () => {
    const warnings: string[] = []
    const nodes = parseHtmlBodyChildren('<ol><li>a</li></ol><ul><li>b</li></ul>')
    const ctx = new BuildContext({
      listLevels: { ordered: ['upper-alpha', 'nope', 'circle'], bullet: ['decimal'] },
      logger: (level, msg) => {
        if (level === 'warn') warnings.push(msg)
      },
    })
    buildIr(nodes, ctx)
    // ordered：只剩 upper-alpha 一项 → 各层全是 upperLetter；'circle' 是项目符号，对 ol 不合法
    const ol = ctx.numbering[0]?.levels ?? []
    expect(ol.every((l) => l.format === 'upperLetter')).toBe(true)
    // bullet 整组非法 → 回退 • ◦ ▪
    const ul = ctx.numbering[1]?.levels ?? []
    expect(ul.slice(0, 3).map((l) => l.text)).toEqual(['•', '◦', '▪'])
    expect(warnings).toHaveLength(3)
    expect(warnings.some((w) => w.includes('listLevels.ordered') && w.includes('"nope"'))).toBe(
      true,
    )
    expect(warnings.some((w) => w.includes('listLevels.bullet') && w.includes('"decimal"'))).toBe(
      true,
    )
  })

  it('ol 的 start 属性：起始序号写进专属 reference 的对应层', () => {
    const { ctx } = build('<ol start="5"><li>a<ol><li>b</li></ol></li></ol>')
    expect(ctx.numbering).toHaveLength(1)
    const levels = ctx.numbering[0]?.levels ?? []
    expect(levels[0]?.start).toBe(5)
    // 内层没指定，仍从 1 起
    expect(levels[1]?.start).toBe(1)
  })

  it('start="1" 或非法 start 不算指定：不额外注册 reference，嵌套列表照常复用父 reference', () => {
    const one = build('<ol><li>a<ol start="1"><li>b</li></ol></li></ol>')
    expect(one.ctx.numbering).toHaveLength(1)
    const bad = build('<ol><li>a<ol start="x"><li>b</li></ol></li></ol>')
    expect(bad.ctx.numbering).toHaveLength(1)
  })

  it('同一个 li 内的相邻子列表各自独立编号：第二个另起 reference', () => {
    // 中间没有父项编号递增，Word 不会重启下层计数；若两个子列表共用同一个 (numId, ilvl)，
    // 第二个会接着编成 b.，而不是重新从 a. 起。第二个必须另起 reference。
    const { ir, ctx } = build('<ol><li>a<ol><li>b</li></ol><ol><li>c</li></ol></li></ol>')
    expect(ctx.numbering).toHaveLength(2)
    const items = ir.filter((b) => b.kind === 'list-item')
    expect(items).toHaveLength(3)
    const refs = items.map((b) => (b.kind === 'list-item' ? b.ref : undefined))
    expect(refs.map((r) => r?.level)).toEqual([0, 1, 1])
    expect(refs[1]?.reference).toBe(refs[0]?.reference)
    expect(refs[2]?.reference).not.toBe(refs[1]?.reference)
  })

  it('下一个 li 的首个子列表仍复用父 reference（父项编号递增会重启下层计数）', () => {
    const { ir, ctx } = build('<ol><li>a<ol><li>x</li></ol></li><li>b<ol><li>y</li></ol></li></ol>')
    expect(ctx.numbering).toHaveLength(1)
    const refs = ir.map((b) => (b.kind === 'list-item' ? b.ref.reference : null))
    expect(new Set(refs).size).toBe(1)
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

  it('<table cellpadding="N"> 在 IR 中保留为 cellPaddingPx 字段（像素）', () => {
    const { ir } = build('<table cellpadding="8"><tr><td>x</td></tr></table>')
    expect(ir[0]).toMatchObject({ kind: 'table', cellPaddingPx: 8 })
  })

  it('cellpadding 缺省 / 非法值：cellPaddingPx 为 undefined（让 builder 走 options 默认）', () => {
    expect(build('<table><tr><td>x</td></tr></table>').ir[0]).not.toHaveProperty('cellPaddingPx')
    expect(build('<table cellpadding="abc"><tr><td>x</td></tr></table>').ir[0]).not.toHaveProperty(
      'cellPaddingPx',
    )
    expect(build('<table cellpadding="-3"><tr><td>x</td></tr></table>').ir[0]).not.toHaveProperty(
      'cellPaddingPx',
    )
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

  it('li 内 footnotes 容器（前后均有文本）：脚注照常注册、正文不渲染，且对文本流透明', () => {
    // isSuppressedBlock 由 emitBlockForElement 与 walkListItem 共用（单一数据源）；命中时提前
    // return 不 flush 缓冲，使前后文本 "txt"/"tail" 并入同段、不被打断。
    const { ir, ctx } = build(
      '<ul><li>txt<div class="footnotes"><ol><li id="fn-1">def</li></ol></div>tail</li></ul>',
    )
    expect(ir).toHaveLength(1)
    expect(ir[0]).toMatchObject({
      kind: 'list-item',
      inlines: [{ kind: 'text', text: 'txttail', style: {} }],
    })
    // 预扫描照常把脚注注册进 ctx（与是否嵌在 li 内无关）
    expect(ctx.footnotes.get('fn-1')?.number).toBe(1)
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
