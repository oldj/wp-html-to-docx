import { describe, it, expect } from 'vitest'
import { parseHtmlBodyChildren } from '../parser/parseHtml.js'
import { BuildContext } from './buildContext.js'
import { buildIr } from './buildIr.js'
import type { Block } from '../types.js'

function build(html: string): Block[] {
  return buildIr(parseHtmlBodyChildren(html), new BuildContext({}))
}

describe('buildIr - math IR', () => {
  it('独立 <math>（无 display=block）按 phrasing content 处理，包进 paragraph 的行内 math', () => {
    const ir = build('<math><mn>1</mn><mo>+</mo><mn>2</mn></math>')
    expect(ir).toHaveLength(1)
    expect(ir[0]?.kind).toBe('paragraph')
    if (ir[0]?.kind !== 'paragraph') throw new Error('expected paragraph')
    const math = ir[0].inlines.find((i) => i.kind === 'math')
    if (math?.kind !== 'math') throw new Error('expected math inline')
    expect(math.mathml).toContain('<math')
    expect(math.mathml).toContain('mn')
  })

  it('display="block" 升级为块级 math IR', () => {
    const ir = build('<math display="block"><mn>1</mn></math>')
    if (ir[0]?.kind !== 'math') throw new Error('expected math block')
    expect(ir[0].display).toBe('block')
  })

  it('p 内的 math 提升为 Inline.kind=math，文本不污染', () => {
    const ir = build('<p>before <math><mn>1</mn></math> after</p>')
    expect(ir[0]?.kind).toBe('paragraph')
    if (ir[0]?.kind !== 'paragraph') throw new Error('expected paragraph')
    const kinds = ir[0].inlines.map((i) => i.kind)
    expect(kinds).toContain('math')
    const text = ir[0].inlines
      .map((i) => (i.kind === 'text' ? i.text : ''))
      .join('')
    expect(text).toContain('before')
    expect(text).toContain('after')
    // MathML 内的 "1" 不应作为段落文本泄漏
    expect(text).not.toMatch(/\b1\b/)
    // math Inline 应保留原始 MathML 字符串供后续转换
    const math = ir[0].inlines.find((i) => i.kind === 'math')
    if (math?.kind !== 'math') throw new Error('expected math inline')
    expect(math.mathml).toContain('<math')
    expect(math.mathml).toContain('<mn>1</mn>')
  })

  it('回归 B1：<td> 内文本+math 留在同一段落，不被切块', () => {
    // 改造前的 bug：math 被当块级，导致前文 "x = " 与 math 被强行拆成两段
    const ir = build('<table><tr><td>x = <math><mn>1</mn></math></td></tr></table>')
    if (ir[0]?.kind !== 'table') throw new Error('expected table block')
    const cell = ir[0].rows[0]?.cells[0]
    if (cell === undefined) throw new Error('expected cell')
    // 单元格内只应有 1 个段落（包含文本 + 行内 math），而不是 2 段
    expect(cell.children).toHaveLength(1)
    const para = cell.children[0]
    if (para?.kind !== 'paragraph') throw new Error('expected paragraph in cell')
    const kinds = para.inlines.map((i) => i.kind)
    expect(kinds).toEqual(expect.arrayContaining(['text', 'math']))
  })
})
