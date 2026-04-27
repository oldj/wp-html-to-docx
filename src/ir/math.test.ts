import { describe, it, expect } from 'vitest'
import { parseHtmlBodyChildren } from '../parser/parseHtml.js'
import { BuildContext } from './buildContext.js'
import { buildIr } from './buildIr.js'
import type { Block } from '../types.js'

function build(html: string): Block[] {
  return buildIr(parseHtmlBodyChildren(html), new BuildContext({}))
}

describe('buildIr - math IR', () => {
  it('块级 <math> 产 math IR block，display=inline (默认)', () => {
    const ir = build('<math><mn>1</mn><mo>+</mo><mn>2</mn></math>')
    expect(ir).toHaveLength(1)
    expect(ir[0]?.kind).toBe('math')
    if (ir[0]?.kind !== 'math') throw new Error('expected math')
    expect(ir[0].display).toBe('inline')
    expect(ir[0].mathml).toContain('<math')
    expect(ir[0].mathml).toContain('mn')
  })

  it('display="block" 标记为 block', () => {
    const ir = build('<math display="block"><mn>1</mn></math>')
    if (ir[0]?.kind !== 'math') throw new Error('expected math')
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
})
