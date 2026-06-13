import { describe, it, expect } from 'vitest'
import { parseHtmlBodyChildren } from '../parser/parseHtml.js'
import { collectInlines } from './inlineCollector.js'
import type { Inline } from '../types.js'

// 从 collectInlines 输出里取出首个 image inline
function imageInline(html: string): Extract<Inline, { kind: 'image' }> {
  const inlines = collectInlines(parseHtmlBodyChildren(html))
  const img = inlines.find((i): i is Extract<Inline, { kind: 'image' }> => i.kind === 'image')
  if (img === undefined) throw new Error('no image inline collected')
  return img
}

describe('collectInlines - img data-full-width 解析', () => {
  it('data-full-width="1"：标记 fullWidth=true', () => {
    expect(imageInline('<img src="a.png" data-full-width="1"/>').fullWidth).toBe(true)
  })

  it('无 data-full-width 属性：fullWidth=false（恒为布尔，非 undefined）', () => {
    expect(imageInline('<img src="a.png"/>').fullWidth).toBe(false)
  })

  it('严格匹配 "1"：其它值（"0" / "true" / 空）均不视为满宽', () => {
    expect(imageInline('<img src="a.png" data-full-width="0"/>').fullWidth).toBe(false)
    expect(imageInline('<img src="a.png" data-full-width="true"/>').fullWidth).toBe(false)
    expect(imageInline('<img src="a.png" data-full-width=""/>').fullWidth).toBe(false)
  })

  it('满宽与显式 width/height 并存：IR 阶段原样保留 width/height，优先级留给 builder 决定', () => {
    const img = imageInline('<img src="a.png" width="50" height="50" data-full-width="1"/>')
    expect(img.fullWidth).toBe(true)
    expect(img.width).toBe('50')
    expect(img.height).toBe('50')
  })
})
