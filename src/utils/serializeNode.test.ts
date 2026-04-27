// 验证 serializeNode 在重新拼出 XML 时正确转义文本与属性中的特殊字符。
// 直接测 helper：不依赖 mathml2omml，避免被下游容错掩盖。

import { describe, it, expect } from 'vitest'
import { parseFragment, defaultTreeAdapter, type DefaultTreeAdapterMap } from 'parse5'
import { isElement } from '../parser/parseHtml.js'
import { serializeNode } from './serializeNode.js'

function firstElement(html: string): DefaultTreeAdapterMap['element'] {
  const frag = parseFragment(html)
  for (const node of defaultTreeAdapter.getChildNodes(frag)) {
    if (isElement(node)) return node
  }
  throw new Error('no element in fragment')
}

describe('serializeNode - 文本中的 XML 特殊字符被转义', () => {
  it('text 节点中的 < / > / & 被转回 entity（避免产出非法 XML）', () => {
    // parse5 在解析时会把 &lt; 解码为字面 `<`；序列化必须再转回去
    const el = firstElement('<math><mo>&lt;</mo></math>')
    const out = serializeNode(el)
    expect(out).toContain('<mo>&lt;</mo>')
    // 特别确保没有暴露原始字符
    expect(out).not.toMatch(/<mo><<\/mo>/)
  })

  it('text 中的 & 被转义（避免被解析器视为 entity 起始）', () => {
    const el = firstElement('<mi>a&amp;b</mi>')
    expect(serializeNode(el)).toBe('<mi>a&amp;b</mi>')
  })

  it('text 中的 > 被转义', () => {
    const el = firstElement('<mo>&gt;</mo>')
    expect(serializeNode(el)).toBe('<mo>&gt;</mo>')
  })
})

describe('serializeNode - 属性值转义', () => {
  it('属性值中的双引号被转 &quot;', () => {
    const el = firstElement('<span title="say &quot;hi&quot;">x</span>')
    const out = serializeNode(el)
    expect(out).toContain('title="say &quot;hi&quot;"')
  })

  it('属性值中的 < 被转 &lt;（避免破坏起止标签）', () => {
    const el = firstElement('<span data-x="a&lt;b">x</span>')
    expect(serializeNode(el)).toContain('data-x="a&lt;b"')
  })

  it('属性值中的 & 被转 &amp;', () => {
    const el = firstElement('<span data-x="a&amp;b">x</span>')
    expect(serializeNode(el)).toContain('data-x="a&amp;b"')
  })
})

describe('serializeNode - 递归 / 普通元素', () => {
  it('嵌套子元素与文本混排', () => {
    const el = firstElement('<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>')
    expect(serializeNode(el)).toBe('<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>')
  })
})
